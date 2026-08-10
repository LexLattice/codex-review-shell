# Direct Renderer Transcript Projection Spec

Status: implementation specification for the next direct-runtime storage bundle
on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md](./DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md)
- [DIRECT_IMPORT_UX_STATUS_SPEC.md](./DIRECT_IMPORT_UX_STATUS_SPEC.md)
- [DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md](./DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)
- [CODEX_TRANSCRIPT_PRESENTATION_AND_COMPOSER_PROJECTION_SPEC.md](./CODEX_TRANSCRIPT_PRESENTATION_AND_COMPOSER_PROJECTION_SPEC.md)
- [CODEX_SURFACE_PROJECT_RENDERING_SPEC.md](./CODEX_SURFACE_PROJECT_RENDERING_SPEC.md)

## Purpose

Add the first real projection module on top of the new direct thread store:

```text
direct/indexed session artifacts
  -> renderer_transcript projection
  -> compact_transcript projection
  -> renderer-safe transcript read model
```

The previous bundle introduced `DirectThreadStore` in `index_only` mode. It can
index existing `DirectSessionStore` JSON artifacts, write rollout manifests, and
record operation-ledger events. The next logical step is to prove that the app
can build a safe, versioned information-management projection from those
artifacts without treating raw JSON/session files as normal renderer input.

The core invariant remains:

```text
canonical rollout/session artifacts preserve what happened
renderer transcript projection is a rebuildable working view
```

## Decision

Implement a `renderer_transcript` projection builder for direct-owned and
materialized imported sessions, plus a minimal `compact_transcript` projection
derived from the renderer-safe output.

Initial module:

```text
DirectRendererTranscriptProjectionBuilder
  -> reads direct thread store indexes and existing DirectSessionStore artifacts
  -> writes direct_projections/direct_projection_items
  -> exposes renderer-safe transcript summaries/items

DirectCompactTranscriptProjectionBuilder
  -> consumes renderer_transcript items, not raw artifacts
  -> writes compact_transcript projection rows
  -> prepares future search/context/compaction experiments without becoming
     model context in this bundle
```

This bundle should keep the store mode at:

```ts
DirectThreadStoreMode = "index_only";
```

It may add read APIs for projections, but it must not make direct turn starts
depend on projections yet. Context construction, compaction, merge, prune, fork,
and full renderer routing come later.

## Authority Law

A projection is a read model. It is not runtime authority.

Hard rules:

- a projection may explain transcript runnability, but it cannot enable the
  Codex composer;
- only `DirectRuntimeStatus` and the live session/runtime controller can allow a
  new turn to start;
- a projection may show imported, derived, hidden, archived, or blocked state,
  but it cannot grant provider continuity;
- a projection may expose non-executable tool/approval evidence, but it cannot
  approve, decline, execute, retry, or continue any obligation;
- a projection may be used for display and parity checks in this bundle, but it
  cannot be used as model context.

Renderer composer fields are therefore advisory:

```ts
type ProjectionComposerHint = {
  projectionHint:
    | "direct-native"
    | "imported-readonly"
    | "non-runnable-projection"
    | "checkpoint-continuation"
    | "runtime-not-attached";
  enabledByProjection: boolean;
  authoritative: false;
  controlAuthority: "runtime-status";
};
```

Source-class mapping:

```text
direct-native:
  projection hint may be true only if runtime status also permits a turn

imported-readonly:
  projection hint is false

import-checkpoint-continuation:
  composer state belongs to the new native continuation session, not the
  imported source transcript

derived-projection / merged-projection:
  projection hint is false unless a later fork/checkpoint policy creates a new
  native direct session

forked-direct-native:
  projection hint may be true only if runtime continuity/fresh-session policy is
  accepted by the live runtime
```

## Why This Next

The storage substrate now has:

- SQLite schema and health status;
- rollout manifest indexing from current direct sessions;
- append-only operation ledger events;
- renderer-safe store status.

The missing bridge is:

```text
indexed artifact facts -> useful transcript projection
```

Without this module, later context packs and compaction would either:

- read raw session/rollout artifacts directly; or
- invent one-off projection code per feature.

Both would violate the storage doctrine. The renderer transcript projection is
the smallest useful projection that can prove the pattern.

## Boundary

This bundle changes only direct branch storage/projection infrastructure.

It does:

- build versioned `renderer_transcript` projections;
- build versioned `compact_transcript` projections from renderer-safe
  projection items;
- store projection metadata in `direct_projections`;
- store bounded renderer-safe rows in `direct_projection_items`;
- cite source rollout/session ids, turn ids, source event ranges, builder
  version, policy id, and digests;
- expose safe projection read APIs to main-process callers;
- mark projections stale when source manifests, operation ledger state, builder
  version, or policy version changes;
- keep imported-readonly and checkpoint-continuation source semantics visible;
- add smoke tests for projection rebuild, truncation, staleness, and raw
  exposure flags.

It does not:

- remove the existing direct session JSON read path;
- make renderer projection reads the only Codex surface path;
- build model context packs;
- enable compaction/resume;
- implement merge/prune/fork/bridge UI;
- implement full-text search;
- route right-pane ChatGPT transcript content into the direct store;
- make production `direct` mode available.

## Projection Contract

Projection kind:

```ts
projectionKind = "renderer_transcript" | "compact_transcript";
```

Required versions:

```ts
rendererTranscript = {
  projectionVersion: "renderer_transcript@1",
  builderVersion: "direct_renderer_transcript_builder@1",
  policyId: "direct_renderer_transcript_policy@1",
};

compactTranscript = {
  projectionVersion: "compact_transcript@1",
  builderVersion: "direct_compact_transcript_builder@1",
  policyId: "direct_compact_transcript_policy@1",
};
```

The renderer projection is renderer-safe by construction. It is not an exact raw
event stream and not model context.

```ts
type DirectRendererTranscriptProjection = {
  projectionId: string;
  projectId: string;
  threadId: string;
  projectionKind: "renderer_transcript";
  projectionVersion: "renderer_transcript@1";
  builderVersion: "direct_renderer_transcript_builder@1";
  policyId: "direct_renderer_transcript_policy@1";
  status: "valid" | "stale" | "superseded" | "failed" | "blocked";

  source: {
    rolloutIds: string[];
    sessionId?: string;
    operationIds: string[];
    eventRangeDigest: string;
    sourceProjectionIds: string[];
    sourceManifestDigest: string;
  };

  safety: {
    rendererSafe: true;
    rawPathExposed: false;
    rawCredentialsExposed: false;
    rawBackendFrameExposed: false;
    rawRequestBodyExposed: false;
    rawImportedJsonlExposed: false;
    unboundedToolResultExposed: false;
  };

  caps: {
    maxItems: number;
    maxTextCharsPerItem: number;
    maxTotalTextChars: number;
    maxToolResultPreviewChars: number;
    truncated: boolean;
    omittedCounts: Record<string, number>;
  };

  continuity: {
    sourceClass:
      | "direct-native"
      | "imported-readonly"
      | "import-checkpoint-continuation"
      | "derived-projection"
      | "merged-projection"
      | "forked-direct-native";
    nativeDirectSession: boolean;
    providerContinuityAvailable: boolean;
    composerEnabled: boolean;
    continuityState:
      | "provider_continuity_available"
      | "fresh_session_only"
      | "checkpoint_required"
      | "non_runnable_projection"
      | "unknown";
  };

  integrity: {
    projectionDigest: string;
    algorithm: "sha256" | "hmac-sha256";
  };
};
```

Current projection pointers must be projection-kind-specific. A single
`direct_threads.current_projection_id` pointer is not sufficient once both
`renderer_transcript` and `compact_transcript` exist.

Use either explicit columns:

```sql
direct_threads.current_renderer_projection_id
direct_threads.current_compact_projection_id
direct_threads.last_renderer_projection_attempt_id
direct_threads.last_compact_projection_attempt_id
```

or a current-by-kind table:

```sql
create table direct_thread_current_projections (
  thread_id text not null,
  projection_kind text not null,
  projection_id text not null,
  last_attempt_projection_id text,
  updated_at text not null,
  primary key (thread_id, projection_kind)
);
```

Rules:

- renderer read APIs never resolve a compact projection as the current renderer
  transcript;
- compact read APIs never resolve a renderer projection as the compact current;
- blocked or failed build attempts may update `last_attempt_projection_id`, but
  must not replace the current safe pointer;
- current pointers advance only after transactional write verification.

## Compact Transcript Contract

`compact_transcript@1` is a derived working view, not a context pack and not an
assistant prompt. It exists to prove that multiple projections can coexist over
the same thread without rereading raw artifacts for every downstream feature.

Rules:

- compact projection input is the current valid `renderer_transcript`
  projection, not raw session files;
- compact projection v0 is deterministic extraction/truncation only;
- no model call or semantic summarizer is used;
- if the renderer projection is stale, superseded, failed, blocked, or
  `unsafeForRenderer`, compact projection is stale/superseded/blocked in the
  same direction and is not rebuilt from that source;
- compact items cite source renderer projection item ids and source digests;
- compact text is shorter than renderer text and carries omitted counts;
- compact projection may be used for list summaries, search previews, and future
  context-policy experiments;
- compact projection must not be used as model context until a later context
  policy explicitly accepts it.

If a later bundle introduces model-generated or semantic summaries, it must use
a new projection version such as:

```text
compact_transcript_model_summary@1
```

Compact item shape:

```ts
type DirectCompactTranscriptItem = {
  itemId: string;
  projectionId: string;
  ordinal: number;
  threadId: string;
  turnId?: string;
  summaryKind:
    | "turn_user_intent"
    | "turn_assistant_result"
    | "tool_evidence_summary"
    | "status_summary"
    | "import_evidence_summary";
  text: string;
  textDigest: string;
  textTruncated: boolean;
  sourceRendererItemIds: string[];
  sourceStableItemKeys: string[];
  omittedCounts: Record<string, number>;
  flags: {
    rendererSafe: true;
    usableForContextBuild: false;
    rawPathExposed: false;
    rawCredentialsExposed: false;
    rawBackendFrameExposed: false;
  };
};
```

## Renderer Item Shape

Projection items are stored in `direct_projection_items` as bounded rows.

Renderer-safe shape:

```ts
type DirectRendererTranscriptItem = {
  itemId: string;
  stableSourceItemKey: string;
  projectionId: string;
  ordinal: number;
  threadId: string;
  turnId?: string;

  itemKind:
    | "user_message"
    | "assistant_message"
    | "thought_summary"
    | "tool_call"
    | "tool_result"
    | "approval_decision"
    | "file_change"
    | "checkpoint_seed"
    | "status"
    | "diagnostic";

  role?: "user" | "assistant" | "tool" | "harness" | "system";
  phase?: "initial" | "continuation" | "final" | "reasoning" | "diagnostic";
  status: "complete" | "partial" | "failed" | "aborted" | "waiting" | "unknown";

  text: string;
  textDigest: string;
  textTruncated: boolean;
  omittedCounts: Record<string, number>;

  sourceRef: {
    rolloutId?: string;
    sessionId?: string;
    turnId?: string;
    sourceEventStartSeq?: number;
    sourceEventEndSeq?: number;
    sourceArtifactKind: "direct-session-json" | "direct-turn-json" | "normalized-events-jsonl" | "import-artifact";
    sourceDigest: string;
  };

  flags: {
    rendererSafe: true;
    executable: false;
    approvalAvailable: false;
    composerEnabledByItem: false;
    rawPathExposed: false;
    rawCredentialsExposed: false;
    rawBackendFrameExposed: false;
  };
};
```

No projection item may be executable. Tool and approval rows are evidence cards,
not authority controls. Authority controls remain owned by live runtime/tool
modules.

`itemId` is projection-local and may change across forced rebuilds.
`stableSourceItemKey` is deterministic from:

```text
sourceRef + itemKind + turn id/order + source event range
```

It is used for parity reports, UI diffing, compact projection references, and
future search/index joins.

## Source Inputs

First implementation may read from current `DirectSessionStore` artifacts:

```text
sessions/<session-id>/session.json
turns/<session-id>/<turn-id>.json
events/<session-id>/<turn-id>.normalized.jsonl
imports/<import-id>/*.json
imports/<import-id>/checkpoint-continuations/*.json
```

The builder must treat those files as canonical artifact inputs for this
compatibility phase and must cite their digests through `sourceRef`.

When native rollout JSONL becomes available, the same projection contract should
consume rollout manifests/events instead of direct session compatibility files.

Missing and corrupt source behavior:

```text
missing optional normalized events:
  build from session/turn summaries and include a renderer-safe status item

missing required session/turn artifact:
  projection failed or blocked depending source class and recovery state

source digest mismatch:
  mark source as corrupt/stale and do not build a valid projection

partially written turn:
  emit a status item only when artifact recovery state says the partial turn is
  safe to display
```

Fallback ordering must not hide source corruption. If a session summary is stale
or inconsistent with turn artifacts, the projection records a safe status item
or fails closed instead of silently producing a clean transcript.

## Projection Mapping

### Session Metadata

Session metadata becomes projection header/status state:

| Source | Projection |
| --- | --- |
| `session.sessionId` | `threadId` / source session ref |
| `session.projectId` | `projectId` |
| `session.title` | transcript title |
| `session.sourceClass` | continuity source class |
| `session.nativeDirectSession` | continuity flag |
| `session.importedSessionReadOnly` | `composerEnabled = false` |
| `session.status` | latest thread status |

Private workspace paths, raw imported source paths, raw file hashes, and raw
diagnostic payloads must not appear in renderer items.

### Turns

Each turn contributes an ordered group of items:

```text
user/input messages
thought/tool/status evidence
assistant/final messages
terminal status when needed
```

Ordering should match the existing surface doctrine:

```text
User message
Thought process / tool evidence
Assistant final output
Status/diagnostic fallback, if no final output exists
```

The builder must preserve turn order from `session.turns` when available and
fall back to turn artifact timestamps only when the session summary is missing
or stale.

### User Messages

Allowed source:

- turn `input` entries with `role = "user"`;
- imported materialized user transcript items already marked renderer-safe.

Projection:

```text
itemKind = "user_message"
role = "user"
executable = false
```

### Assistant Messages

Allowed source:

- normalized `message_delta` reductions;
- turn/session persisted assistant messages;
- imported materialized assistant transcript items already marked renderer-safe.

Projection:

```text
itemKind = "assistant_message"
role = "assistant"
phase = "final"
```

If only deltas exist, the builder may concatenate them into one bounded
assistant message for v0. It must keep source event range refs and set
`textTruncated` when caps apply.

### Reasoning And Commentary

Reasoning deltas remain evidence, not normal transcript text unless the source is
a renderer-safe summary accepted by prior ODEU rules.

For this bundle:

```text
reasoning_delta -> thought_summary item only when already renderer-safe
raw reasoning content -> omitted/reasoning_unsafe count
```

Do not expose raw chain-of-thought-like content. Raw reasoning text must not be
stored in:

- `direct_projection_items.text`;
- compact projection item text;
- text digests derived from raw reasoning content;
- renderer-safe diagnostics;
- renderer-safe failure summaries.

### Tool Calls And Tool Results

Tool obligations become non-executable evidence cards:

```text
itemKind = "tool_call"
role = "harness"
executable = false
approvalAvailable = false
```

Tool results become bounded summaries:

```text
itemKind = "tool_result"
role = "tool"
executable = false
```

Result content caps:

```ts
MAX_TOOL_RESULT_PREVIEW_CHARS = 4096;
```

If a read-file result was truncated before provider continuation, the projection
must preserve `truncated = true` and should not imply full file contents were
sent or shown.

### Approval Decisions

Imported approvals, declined/canceled decisions, and local authority decisions
are evidence only.

They must not render as active controls:

```text
approvalAvailable = false
executable = false
composerEnabledByItem = false
```

### Checkpoint Seeds

Import checkpoint continuation seeds may appear as special harness evidence:

```text
itemKind = "checkpoint_seed"
role = "harness"
phase = "diagnostic"
```

Seed text is app-private by default. Renderer projection may show only bounded
preview, omitted counts, and lineage labels.

### Status Versus Diagnostics

`status` items are user-visible turn/session state:

- failed;
- aborted;
- waiting;
- interrupted;
- partially recovered.

`diagnostic` items are high-level renderer-safe evidence. They must not include:

- raw stack traces by default;
- raw backend payloads;
- private file paths;
- backend URLs;
- request bodies;
- auth-like fields with values.

## Caps

Use the same default caps from the storage spec:

```ts
const MAX_RENDERER_PROJECTION_ITEMS = 2000;
const MAX_RENDERER_ITEM_TEXT_CHARS = 16_000;
const MAX_RENDERER_TOTAL_TEXT_CHARS = 1_000_000;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 4096;
```

If caps are hit:

- keep projection valid if truncation is honest and renderer-safe;
- set `caps.truncated = true`;
- increment `omittedCounts`;
- mark each truncated item with `textTruncated = true`;
- never silently drop content without a count.

If caps prevent a truthful projection, mark projection `blocked` with:

```text
staleReason/securityReason = "projection_caps_exceeded"
unsafeForRenderer = true
unsafeForContextBuild = true
```

## Staleness Rules

Projection validity depends on:

- source rollout/session manifest digest;
- source turn artifact digest;
- operation ledger head digest;
- builder version;
- policy version;
- schema version;
- security/redaction policy version.

Source digest input must be canonical:

```ts
sourceDigestInput = canonicalJson({
  schema: "renderer_transcript_projection_source@1",
  threadId,
  projectionKind,
  projectionVersion,
  builderVersion,
  policyId,
  policyVersion,
  sourceManifestDigests,
  sourceTurnDigests,
  normalizedEventRangeDigests,
  operationLedgerHeadDigest,
  schemaVersion,
  securityPolicyVersion,
  caps,
});
```

Canonicalization rules:

- sorted object keys;
- stable array order;
- no projection id;
- no build attempt id;
- no timestamps except source event timestamp ranges;
- no raw auth data;
- no raw request bodies;
- no raw text bodies unless already represented by a source artifact digest.

Stale reasons:

```ts
type RendererTranscriptProjectionStaleReason =
  | "rollout_manifest_changed"
  | "session_artifact_changed"
  | "turn_artifact_changed"
  | "operation_ledger_advanced"
  | "builder_version_changed"
  | "policy_version_changed"
  | "schema_migration"
  | "security_policy_changed"
  | "manual_rebuild_requested";
```

Stale projections may remain readable if:

```text
unsafeForRenderer = false
```

They must not be used for future context builds once context building depends on
projections unless specifically admitted by a later policy.

## Rebuild Semantics

Projection rebuild is idempotent by source digest and builder policy.

Rules:

- building the same projection twice with unchanged source digest returns the
  existing valid projection unless `force = true`;
- `force = true` creates a new projection and marks the old one `superseded`;
- failed rebuilds leave the previous valid projection readable unless unsafe;
- no canonical session/rollout artifacts are mutated;
- no projection rebuild events are written into dialogue rollouts;
- operation ledger may record `rebuild_projection` when the rebuild is
  user/manual/repair initiated.

## Database Use

Use existing tables:

```text
direct_projections
direct_projection_items
direct_threads.current_projection_id
```

`direct_threads.current_projection_id` is compatibility-only and must not be
used ambiguously by new code. New code should use kind-specific current pointers
as described above.

Projection source refs should be queryable without unpacking opaque JSON blobs.
`direct_projection_items` should include, or expose through equivalent indexed
columns:

```sql
projection_id
item_id
stable_source_item_key
thread_id
turn_id
rollout_id
session_id
source_artifact_kind
source_event_start_seq
source_event_end_seq
source_digest
```

Implementation should add methods like:

```ts
class DirectThreadStore {
  buildRendererTranscriptProjection(threadId, options): DirectProjectionSummary;
  buildCompactTranscriptProjection(threadId, options): DirectProjectionSummary;
  readRendererTranscriptProjection(threadId, options): RendererSafeProjection;
  readCompactTranscriptProjection(threadId, options): RendererSafeCompactProjection;
  markProjectionStale(projectionId, reason): void;
}
```

The actual builder may live in:

```text
src/main/direct/thread/renderer-transcript-projection.js
```

`DirectThreadStore` should own writes and DB transactions. The builder should be
pure enough to test from fixture artifacts.

Projection writes are transactional:

```text
1. build projection in memory
2. scan for raw-exposure violations
3. begin SQLite transaction
4. insert direct_projections row as pending/building
5. insert direct_projection_items rows
6. verify item count and projection digest
7. mark projection valid/blocked/failed
8. update current pointer by kind only when policy allows
9. update last_attempt pointer when applicable
10. commit transaction
```

If any step fails:

- current safe pointer remains unchanged;
- previous safe projection remains readable unless unsafe;
- failed/blocked projection may remain as a diagnostic attempt;
- partial item writes must not become current.

Only one projection build may run for a given:

```text
threadId + projectionKind + policyId
```

Build lock rules:

- same source digest and same policy while a build is running returns the
  in-progress/existing projection summary;
- force rebuild while a non-force rebuild is running waits or returns
  `projection_build_in_progress`;
- two force rebuilds collapse to the first forced result unless explicitly
  requested as a separate new attempt.

## Renderer-Safe Read API

Main-process projection read returns:

```ts
type RendererSafeDirectTranscriptProjection = {
  schema: "renderer_safe_direct_transcript_projection@1";
  projectionId: string;
  projectId: string;
  threadId: string;
  title: string;
  status: "valid" | "stale" | "superseded" | "failed" | "blocked";
  staleReason?: RendererTranscriptProjectionStaleReason;
  securityReason?: string;
  unsafeForRenderer: boolean;
  unsafeForContextBuild: boolean;
  failureSummary?: string;
  sourceClass: string;
  composer: {
    projectionHint:
      | "direct-native"
      | "imported-readonly"
      | "non-runnable-projection"
      | "checkpoint-continuation"
      | "runtime-not-attached";
    enabledByProjection: boolean;
    authoritative: false;
    controlAuthority: "runtime-status";
  };
  lifecycle: {
    state: "active" | "hidden" | "archived" | "soft_deleted";
    operationIds: string[];
    rendererListVisible: boolean;
  };
  caps: {
    truncated: boolean;
    omittedCounts: Record<string, number>;
  };
  items: DirectRendererTranscriptItem[];
  rawExposure: {
    rawPathExposed: false;
    rawCredentialsExposed: false;
    rawBackendFrameExposed: false;
    rawRequestBodyExposed: false;
    rawImportedJsonlExposed: false;
  };
};
```

Read behavior:

- `blocked` projections are never returned as normal transcript items;
- `failed` projections return a safe summary only;
- `stale` projections may return items only when `unsafeForRenderer = false`;
- `superseded` projections can be read only by explicit projection id.

Large transcript reads must support slicing:

```ts
readRendererTranscriptProjection(threadId, {
  projectionId?,
  offset?,
  limit?,
  aroundTurnId?,
  includeHeader = true,
});
```

Renderer must not receive:

- raw session file path;
- raw rollout path;
- raw imported JSONL line;
- raw source file hash;
- raw credentials/auth fields;
- raw backend frames;
- unbounded tool output.

## Integration With Existing Renderer Paths

This bundle should not force the left Codex surface to switch to the projection
read model.

Safe integration options:

1. Build and verify projections only through smoke tests.
2. Expose projection counts/status in `DirectRuntimeStatus`.
3. Add optional read IPC behind a direct-only/internal flag.

Do not remove the existing direct session read path until projection read
parity is proven across:

- direct live text;
- read-only tool continuation;
- imported-readonly sessions;
- import checkpoint continuation sessions;
- interrupted/failed/aborted turns.

Store modes remain staged:

```text
index_only:
  build/read projections for tests and diagnostics; existing renderer paths stay
  authoritative for app UX.

dual_write_shadow:
  write projections after session writes; renderer can compare shadow reads but
  does not depend on them.

projection_read:
  renderer transcript reads projections first; stale/blocked projections fail
  closed or fall back only through an explicitly permitted compatibility path.

context_build_required:
  future mode; not enabled by this bundle.
```

This spec implements enough for `index_only` and prepares
`dual_write_shadow`. It must not silently advance the project/store mode.

## Security

The projection builder must scan emitted items for raw-exposure violations.

Use a two-tier raw-exposure scanner:

```ts
type RawExposureScanResult =
  | {
      severity: "block";
      reason:
        | "secret_pattern"
        | "raw_path"
        | "raw_backend_frame"
        | "raw_request_body"
        | "raw_imported_jsonl"
        | "unbounded_tool_result";
    }
  | {
      severity: "warn";
      reason: "sensitive_keyword_without_value";
    };
```

Blocking examples:

- `Authorization: Bearer <token-like>`;
- `cookie: session=...`;
- access/refresh/id token shaped values;
- raw backend frame JSON;
- raw absolute import/source paths;
- unbounded tool output.

Warning or allow examples:

- `authorization middleware failed`;
- `we need cookie handling`;
- `the API should refresh access tokens`.

Minimum scanner terms/patterns:

- `authorization`;
- `Authorization`;
- `cookie`;
- `set-cookie`;
- `access_token`;
- `refresh_token`;
- `id_token`;
- `session_id`;
- `csrf`;
- `bearer `;
- raw absolute import source paths;
- raw direct auth root paths;
- raw backend endpoint request bodies.

The scanner should inspect nested or stringified JSON-like text where feasible.

If scanner finds unsafe content:

```text
projection.status = "blocked"
unsafeForRenderer = true
unsafeForContextBuild = true
```

The failure diagnostic stays app-private and redacted.

Projection text remains app-private user/workspace transcript data even when it
is renderer-safe. It is excluded from default diagnostics/export unless a later
explicit redacted/export-approved path is used.

## Operation Ledger Interaction

For this bundle, operation ledger effects only influence visibility state:

- hidden/archived/deleted threads can still have projections;
- normal list APIs may filter them;
- renderer projection read by explicit thread id may return a safe projection
  with lifecycle labels;
- purge is not implemented.

If the operation ledger advances after projection build, mark projection stale
with:

```text
operation_ledger_advanced
```

unless the operation is known non-semantic for this projection.

Lifecycle labels should be computed from operation state:

```ts
type ProjectionLifecycle = {
  state: "active" | "hidden" | "archived" | "soft_deleted";
  operationIds: string[];
  rendererListVisible: boolean;
};
```

Normal list APIs filter hidden, archived, or soft-deleted threads according to
caller policy. Explicit thread read may still return a safe projection with
lifecycle labels. Future purge returns tombstone/summary only.

## Parity Reports

Before any future move from `index_only` toward `projection_read`, this bundle
should be able to produce parity reports comparing the old direct session read
path with projection reads.

```ts
type ProjectionParityReport = {
  sessionId: string;
  threadId: string;
  oldReadDigest: string;
  projectionReadDigest: string;
  differences: Array<{
    kind:
      | "missing_item"
      | "extra_item"
      | "text_mismatch"
      | "status_mismatch"
      | "ordering_mismatch";
    severity: "info" | "warning" | "blocking";
  }>;
};
```

Parity reports should cover:

- direct live text;
- read-only tool continuation;
- imported-readonly sessions;
- checkpoint continuation;
- failed/interrupted/aborted turns.

## Implementation Order

### Phase -1: Projection Pointer And Authority Law

- Add kind-specific current projection pointers or a current-by-kind table.
- Keep composer state advisory only.
- Prevent blocked/failed projection attempts from replacing current safe
  pointers.
- Add source-class-to-composer mapping.

### Phase 0: Projection Constants And Types

- Add projection kind/version constants.
- Add renderer caps.
- Add stale/safety reason enums.
- Add renderer-safe shape helpers.
- Add canonical source digest rules.
- Add `stableSourceItemKey`.
- Add lifecycle labels.
- Add unsafe/reason fields to read shapes.

### Phase 1: Pure Builder

- Read a session plus turn artifacts.
- Reduce input/messages/events/obligations into bounded projection items.
- Preserve source refs and digests.
- Compute projection digest.
- Enforce raw-exposure scan.

### Phase 2: Store Writes

- Add `writeProjection` and `readProjection` helpers on `DirectThreadStore`.
- Add per-thread/per-kind/per-policy build lock.
- Write `direct_projections`.
- Write `direct_projection_items`.
- Update current projection pointer by kind.
- Record failed/blocked attempts without poisoning current safe pointer.
- Supersede old projection on forced rebuild.

### Phase 2.5: Compact Projection

- Build `compact_transcript@1` from valid renderer projection rows.
- Record source renderer projection id and item ids.
- Mark compact projection blocked when renderer projection is blocked.
- Use deterministic extraction/truncation only.
- Keep `usableForContextBuild = false`.

### Phase 3: Rebuild And Staleness

- Add source digest calculation.
- Return existing projection when unchanged.
- Mark stale when manifest/source/builder/policy changes.
- Keep old safe projection readable.

### Phase 4: Renderer-Safe Read API

- Add main-process read method.
- Add pagination/slicing.
- Do not expose raw paths or raw records.
- Add projection summary to direct runtime status.

### Phase 5: Smoke Tests

- Direct native completed text turn projection.
- Failed/interrupted turn status projection.
- Read-only tool obligation/result projection.
- Imported-readonly projection keeps composer disabled.
- Checkpoint-continuation projection stays separate from imported transcript.
- Compact projection derives from renderer projection and never raw artifacts.
- Truncation flags and omitted counts.
- Raw-exposure blocker.
- Rebuild idempotency.
- Forced rebuild supersedes old projection.
- Operation-ledger advance marks projection stale.
- Blocked projection does not replace previous current safe projection.
- Compact projection cannot build from stale/blocked renderer projection.
- Raw reasoning never appears in item text, digests, compact items, or failure
  summaries.
- Renderer read pagination preserves stable item order.
- Lifecycle labels reflect hidden/archived/soft-deleted operation state.
- Projection parity report compares old read path and projected read path.

## Acceptance Criteria

- Current projection pointers are projection-kind-specific; compact projection
  cannot become the current renderer transcript.
- Projection composer state is advisory only; live runtime status remains the
  authority for composer enablement.
- Projection writes are transactional; partial item writes cannot become current.
- Build locking prevents concurrent rebuilds from racing for the same
  thread/projection kind/policy.
- `renderer_transcript` projections are stored in `direct_projections` and
  `direct_projection_items`.
- `compact_transcript` projections are stored as derived projections and cite
  their source renderer projection/item ids.
- Projection items include `stableSourceItemKey` separate from projection-local
  `itemId`.
- Projection rows cite source rollout/session/turn digests, builder version,
  policy id, event ranges, and operation ledger head.
- Source digest canonicalization excludes projection ids, build attempt ids,
  raw auth, raw request bodies, and unstable timestamps.
- Renderer-safe reads contain no raw paths, raw credentials, raw backend frames,
  raw imported JSONL, raw request bodies, or unbounded tool results.
- Renderer-safe reads expose `staleReason`, `securityReason`,
  `unsafeForRenderer`, and `unsafeForContextBuild`.
- Direct-native sessions project user/assistant/status items in stable turn
  order.
- Tool calls and approvals project as non-executable evidence.
- Imported-readonly sessions project with composer disabled.
- Import checkpoint continuation sessions remain separate from imported source
  transcript projections.
- Raw-exposure scanning distinguishes blocking secret patterns from harmless
  sensitive-topic words.
- Raw reasoning content is never stored in projection item text, compact text,
  renderer-safe diagnostics, or failure summaries.
- Status and diagnostic item kinds have separate allowlists.
- Truncation is explicit per item and in projection-level omitted counts.
- Projection rebuild is idempotent when source digests are unchanged.
- Forced rebuild supersedes the old projection without mutating source artifacts.
- Stale projections remain readable only when `unsafeForRenderer = false`.
- Missing/corrupt source artifact behavior is defined and tested.
- Lifecycle labels expose active/hidden/archived/soft-deleted state safely.
- Projection parity reports compare existing direct session reads against
  projection reads before future routing changes.
- Projection text is app-private and excluded from default diagnostics/export.
- Compact projections are never marked usable for context builds in this bundle.
- Compact projection can build only from a valid `renderer_transcript`
  projection.
- Compact projection v0 is deterministic extraction/truncation only, not model
  summarization.
- Blocked projections are recorded as attempts but do not replace the current
  safe projection pointer.
- Renderer read API supports offset/limit or equivalent slicing.
- `DirectRuntimeStatus` can report projection availability/counts without making
  direct turns runnable.
- Existing direct auth/live-text/tool/import/checkpoint/activation smokes remain
  compatible.

## Non-Goals

- Model context construction.
- Context pack persistence.
- Compaction candidate generation.
- Full-text search.
- Merge/prune/fork/bridge UI.
- Hard purge or delete UI.
- Replacing existing Codex surface renderer reads by default.
- Importing right-pane ChatGPT transcript content.
- Production `direct` mode.

## Summary

This module turns the direct thread store from an index into the first usable
projection system.

Passing this bundle should mean:

```text
The direct branch can rebuild a safe renderer transcript view from canonical
direct/imported artifacts and SQLite indexes without reading raw artifacts in
normal renderer paths.
```

It should not mean:

```text
projection context is ready for model prompts
direct mode is production
merge/prune/delete are shipped
raw rollout files are no longer canonical
right-pane ChatGPT content is imported
```
