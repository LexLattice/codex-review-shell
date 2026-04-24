# Thread Analytics Spec

Status: implementation design spec for the middle-plane `Analytics` tab and local Codex thread analytics store.

## Purpose

Define how the shell should ingest Codex thread temporal and structural facts into a local analytics store and render dashboards without depending on live thread activation.

The shell should own only derived analytics and cached scan state.

It should not own Codex thread contents as an authoritative source, thread lifecycle, or thread persistence.

## Product doctrine

- Codex owns Codex threads and their raw rollout logs.
- This app owns derived analytics snapshots built from those logs.
- Analytics should load from persisted local state first, not from a live surface.
- Updating analytics should be an explicit user action in v0.
- Clicking a thread in the analytics surface should select it for dashboard rendering, not open it as a chat.
- Every metric should declare its evidence grade:
  - `exact`
  - `estimated`
  - `rollout-derived`

## V0 scope

- Add a dedicated `Analytics` tab in the middle plane.
- Scope the first implementation to Codex threads only.
- Persist analytics in a local SQLite database under Electron `userData`.
- Render dashboards entirely from the local analytics database.
- Default the analytics list and update run to the selected project scope.
- Keep an explicit optional scope switch for cross-project / all-home scans.
- Add a manual `Update analytics` action that scans only:
  - new threads that have never been processed
  - existing threads whose source fingerprint has changed
- Do not auto-refresh all analytics on app startup.
- Load previously computed analytics immediately on startup.

## Why Codex first

Codex threads have a stable local source of truth:

- `session_index.jsonl` for lightweight discovery
- rollout JSONL session files for temporal facts and item ontology

ChatGPT threads do not currently have an equivalent stable local event log in this app. Their discovery path is best-effort DOM/cache extraction, which is not a strong enough substrate for the first analytics system.

## Source ontology and evidence boundary

The analytics scanner should be grounded in the canonical Codex ontology documented in [CODEX_APP_SERVER_ONTOLOGY.md](./CODEX_APP_SERVER_ONTOLOGY.md).

Important boundaries:

- `Thread.createdAt` and `Thread.updatedAt` are reliable thread-level timestamps.
- `Turn.startedAt`, `Turn.completedAt`, `Turn.durationMs`, and `Turn.status` are reliable turn-level facts.
- Some item variants carry their own `durationMs`, especially:
  - `commandExecution`
  - `mcpToolCall`
  - `dynamicToolCall`
- Most item variants do not have their own absolute timestamps in the final v2 thread model.
- Raw rollout JSONL lines do carry line-level timestamps, which are suitable for event density and waterfall series.

The scanner must not claim item-level precision that is not actually present in the source data.

## Middle-plane shape

Add a third middle-plane tab:

- `Overview`
- `Threads`
- `Analytics`

The `Analytics` tab should be optimized for reading dashboards, not for thread orchestration.

Recommended layout:

- left column: slim Codex analytics thread list
- right column: analytics dashboard for the selected thread

The right panel should not attempt to render the transcript itself.

## Primary workflow

The primary workflow is not chat activation. It is analytics selection and refresh.

The user should be able to:

1. open the `Analytics` tab
2. see already-ingested threads immediately from the local database
3. click a thread row to load its saved dashboard
4. click `Update analytics` to scan for:
   - new threads
   - changed threads
5. re-open any thread and see refreshed analytics if its source changed

If a thread is not yet in the analytics database, it should not appear until the next analytics update run.

## Architecture

The system should follow a simple pipeline:

1. discover candidate Codex threads from `session_index.jsonl`
2. compute a cheap source fingerprint for each thread
3. compare against the latest stored analytics snapshot
4. ingest only threads that are new or stale
5. normalize analytics-relevant facts into the local database
6. compute materialized metrics and chart series
7. render dashboards from the database only

The renderer should never need to parse rollout JSONL directly.

## Scope model

Analytics should be project-first by default.

- Default scope: selected project
- Source filter baseline: lane-linked Codex threads for that project, then project workspace/cwd-compatible discovered threads
- Explicit secondary scope: all configured Codex homes
- Persisted snapshots are global, but list rendering should be filtered by current scope

This keeps analytics native to the workflow control plane instead of behaving like a global Codex history browser.

## Host and backend split

The shell runs as host Electron UI + workspace backend bridge.

- Host side responsibilities:
  - SQLite lifecycle and writes (`thread-analytics.sqlite`)
  - scan-run orchestration
  - dashboard reads
- Workspace backend responsibilities:
  - discover Codex threads and resolve rollout file paths from workspace-accessible homes
  - stream source data requested by the host scanner

In v0, parsing may run in backend-assisted mode for WSL paths, but persistence remains host-owned and authoritative.

## Storage

Use a local SQLite database stored in Electron `userData`.

Suggested filename:

- `thread-analytics.sqlite`

Suggested tables:

```sql
create table analytics_threads (
  thread_key text primary key,
  source_home text not null,
  thread_id text not null,
  session_file_path text not null,
  title_snapshot text not null,
  cwd_snapshot text not null,
  originator text not null,
  created_at text,
  last_session_updated_at text,
  is_subagent integer not null default 0,
  first_seen_at text not null,
  last_seen_at text not null,
  last_scan_status text not null default 'ready',
  current_snapshot_id integer,
  unique (source_home, thread_id)
);

create table analytics_snapshots (
  id integer primary key,
  thread_key text not null references analytics_threads(thread_key),
  analyzer_version text not null,
  session_updated_at text,
  file_mtime_ms integer not null,
  file_size_bytes integer not null,
  line_count integer not null,
  last_rollout_at text,
  tail_hash text not null,
  processed_at text not null,
  parse_status text not null,
  error_message text
);

create table analytics_events (
  snapshot_id integer not null references analytics_snapshots(id),
  seq integer not null,
  at text,
  turn_id text,
  turn_ordinal integer,
  fact_kind text not null,
  subtype text,
  phase text,
  status text,
  duration_ms integer,
  payload_json text,
  primary key (snapshot_id, seq)
);

create table analytics_metrics (
  snapshot_id integer not null references analytics_snapshots(id),
  metric_key text not null,
  num_value real,
  text_value text,
  unit text,
  evidence_grade text not null,
  primary key (snapshot_id, metric_key)
);

create table analytics_series (
  snapshot_id integer not null references analytics_snapshots(id),
  series_key text not null,
  ordinal integer not null,
  x_value text,
  y_value real,
  payload_json text,
  primary key (snapshot_id, series_key, ordinal)
);

create table analytics_scan_runs (
  id integer primary key,
  mode text not null,
  started_at text not null,
  completed_at text,
  discovered_count integer not null default 0,
  processed_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  notes text
);

create table analytics_project_links (
  project_id text not null,
  thread_key text not null references analytics_threads(thread_key),
  lane text,
  binding_id text,
  linked_at text,
  last_seen_at text not null,
  primary key (project_id, thread_key)
);
```

Important storage constraints:

- The database should store only analytics-relevant normalized facts.
- Full message bodies should not be duplicated into the analytics database in v0.
- The database should support multiple snapshots over time, but only one `current_snapshot_id` should be considered active for dashboard rendering.

## Thread identity and source model

The thread identity model should match current Codex discovery behavior:

- `threadId` is the stable thread identity
- `sourceHome` identifies the Codex home the rollout belongs to
- `sessionFilePath` points to the discovered rollout file

`thread_id` alone is not a safe global key when scanning multiple homes.

Use one of:

- materialized `thread_key = source_home + "::" + thread_id`
- or equivalent composite `(source_home, thread_id)` identity

All snapshot/event/metric rows should anchor to `thread_key`.

Snapshot title and cwd fields are advisory only. Raw rollout files remain authoritative.

Subagent sessions should be excluded by default in the analytics list, matching the current top-level Codex thread browser behavior.

## Fingerprinting and staleness detection

The analytics refresh path should not rely on file size alone.

Use a two-stage fingerprint:

### 1. Cheap discovery fingerprint

Used to decide whether a thread needs deeper parsing.

Fields:

- `threadId`
- `sourceHome`
- `sessionFilePath`
- `session_index.updated_at`
- file `mtimeMs`
- file size in bytes
- `analyzer_version`

If the cheap fingerprint is unchanged from the current snapshot, the thread can be skipped without reading the full rollout file.

### 2. Strong processed fingerprint

Computed while parsing the rollout file for threads that appear new or stale.

Fields:

- `threadId`
- `sourceHome`
- `sessionFilePath`
- `session_updated_at`
- `file_mtime_ms`
- `file_size_bytes`
- `line_count`
- `last_rollout_at`
- `tail_hash`
- `analyzer_version`

`tail_hash` should be computed from the tail of the rollout, for example the last N non-empty lines or a bounded tail byte window.

This guards against edge cases where file size or mtime alone would miss a meaningful rewrite.

## Analyzer versioning

The scanner must include an explicit `analyzer_version`.

Any change to:

- turn-boundary logic
- event normalization
- metric definitions
- series bucketing

should increment `analyzer_version`, which forces stale recomputation even when the rollout file itself has not changed.

## Ingest model

The ingest pass should stream the rollout JSONL once for each stale thread.

During ingest the scanner should:

- resolve session metadata from the first `session_meta` row
- stream all subsequent rollout lines in order
- preserve each line timestamp as the base temporal evidence
- extract only analytics-relevant facts
- write a new snapshot and replace its materialized metrics in one transaction

The scanner should normalize facts for at least these ontology classes:

- user messages
- assistant messages, including `phase`
- reasoning items
- command executions
- MCP tool calls
- dynamic tool calls
- collaboration agent tool calls
- web searches
- file changes
- context compaction markers
- turn start / complete / abort markers
- failure markers

## Turn reconstruction requirement

Turn-level metrics are too important to approximate loosely.

The analytics scanner should reconstruct turns compatibly with the upstream Codex reducer logic used to build stored thread turns.

That means:

- explicit turn boundaries must take precedence when present
- late tool completions should be assigned to the original turn when upstream does so
- aborted and failed turns must preserve their correct status
- analytics must not infer turns simply by splitting on adjacent user messages

Implementation note:

- the scanner may either port the minimal upstream turn-history reducer into the workspace backend, or implement a dedicated helper in this repo that mirrors the upstream semantics closely
- the product implementation should not depend on the presence of a separate local Codex fork checkout

## Normalized event model

The `analytics_events` table should represent facts, not raw transcript copies.

Recommended `fact_kind` values:

- `turn_started`
- `turn_completed`
- `turn_aborted`
- `user_message`
- `assistant_message`
- `reasoning`
- `command_execution`
- `mcp_tool_call`
- `dynamic_tool_call`
- `collab_agent_tool_call`
- `web_search`
- `file_change`
- `context_compaction`
- `error`

Recommended `payload_json` contents:

- only compact analytics metadata
- identifiers needed for grouping
- small counts or labels
- no large text bodies

## Metric catalog for v0

The first version should compute a constrained, high-signal metric set.

If upstream turn-reducer parity is not proven yet, start with the safe subset below and gate turn-sensitive metrics until parity is verified.

### Exact

- `thread_wall_clock_span_ms`
- `thread_active_work_time_ms`
- `thread_utilization_ratio`
- `turn_count`
- `completed_turn_count`
- `failed_turn_count`
- `aborted_turn_count`
- `median_turn_duration_ms`
- `p90_turn_duration_ms`
- `idle_gap_total_ms`
- `max_idle_gap_ms`
- `revisit_gap_count`
- `commentary_message_count`
- `final_answer_count`
- `reasoning_item_count`
- `command_execution_count`
- `mcp_tool_call_count`
- `dynamic_tool_call_count`
- `collab_agent_tool_call_count`
- `web_search_count`
- `file_change_count`
- `context_compaction_count`
- `known_tool_duration_ms`

### Estimated

- `residual_model_time_ms`
- `reasoning_to_tool_ratio`
- `commentary_to_final_ratio`
- `mutation_intensity_score`

### Rollout-derived

- `time_to_first_agent_item_ms`
- `time_to_first_tool_ms`
- density buckets by minute or hour
- per-turn waterfall composition

`residual_model_time_ms` should be defined as:

- `thread_active_work_time_ms - known_tool_duration_ms`

This must be labeled `estimated`, not treated as pure reasoning time.

## Series and charts for v0

Materialize chart data in `analytics_series` so the renderer does not recompute it on every open.

Recommended series:

- `turn_timeline`
- `activity_density`
- `work_composition`
- `tool_mix`
- `gap_map`

Recommended dashboard panels:

- summary strip
  - wall-clock span
  - active work time
  - turn count
  - failures
  - compactions
- turn timeline
- stacked work composition chart
- tool mix panel
- gap / revisit panel

## Analytics tab UX

The `Analytics` tab should behave differently from the `Threads` tab.

### Left list

Each row should show:

- thread title
- updated time
- originator badge
- analytics status badge

Suggested status values:

- `ready`
- `never processed`
- `stale`
- `processing`
- `error`
- `unavailable`

Primary row click should:

- select the thread
- load the latest saved analytics snapshot
- not navigate the Codex surface

If the product later wants thread opening from this tab, that should be a secondary explicit button, not the primary row gesture.

### Right dashboard

The right panel should:

- render the selected thread's saved metrics and charts
- show the evidence grade on metrics where ambiguity matters
- show the snapshot `processed_at` time
- show a compact warning if the current data is stale or from a failed partial ingest

### Top action bar

V0 should include:

- `Update analytics`

Strong later candidates:

- `Rebuild selected`
- `Rebuild all`
- originator filters
- project / cwd filters

## Update analytics behavior

`Update analytics` should run an incremental scan in the background.

Algorithm:

1. create a scan-run row
2. discover current Codex threads from selected scope (default project scope; all homes only when explicitly requested)
3. upsert `analytics_threads` metadata and `last_seen_at`
4. upsert `analytics_project_links` for currently resolved project relationships
5. compute each thread's cheap fingerprint
6. skip threads whose cheap fingerprint matches the current snapshot
7. stream-parse only new or stale threads
8. compute strong fingerprint, normalized events, metrics, and series
9. commit the new snapshot transactionally
10. mark scan-run counts and completion time

If a previously known thread is no longer discoverable:

- keep its prior analytics
- mark it `unavailable`
- do not delete its history

The renderer should show progress text during the update run but remain responsive.

## Startup behavior

On startup:

- open the analytics database
- load saved thread rows and their current snapshots
- render the analytics list immediately from persisted state
- do not trigger an automatic full analytics scan

This keeps startup cost bounded and aligns with the product goal of avoiding unnecessary heavy work.

## Performance goals

- Dashboard open should be near-instant for already-processed threads.
- Incremental update should avoid re-reading unchanged rollout files.
- Rollout parsing should happen off the renderer thread.
- The renderer should consume precomputed metrics and series, not raw event logs.
- Large historical thread sets should remain usable because unchanged threads are skipped.

## Error handling

If a rollout cannot be parsed:

- preserve the previous good snapshot if one exists
- write a failed snapshot record or failed scan status
- mark the thread row `error`
- show the error succinctly in the dashboard metadata

The system should degrade to stale analytics rather than blank analytics whenever possible.

## Non-goals for v0

- ChatGPT thread analytics
- live analytics tied to currently open surfaces
- transcript rendering inside the analytics tab
- automatic continuous watchers
- cross-thread comparative league tables
- prompt-quality or reasoning-quality scoring
- raw chain-of-thought interpretation beyond surfaced ontology

## Phased implementation

### Phase 1

- add the `Analytics` tab shell
- add the SQLite analytics store
- add project-scoped discovery, fingerprinting, and incremental ingest
- materialize safe baseline metrics and dashboard

### Phase 1b

- verify turn reconstruction parity against upstream reducer semantics
- enable turn-sensitive metrics once parity checks pass

### Phase 2

- add stronger charting and progress feedback
- add rebuild controls
- add list filtering by cwd, originator, and project mapping

### Phase 3

- add cross-thread aggregate views
- add project-level analytics rollups
- evaluate whether ChatGPT thread analytics has a sufficiently trustworthy source model

## Summary

The shell should treat thread analytics as a derived read model:

- source of truth: Codex rollout logs
- persistence: local SQLite analytics database
- refresh policy: explicit manual incremental update
- UI: dedicated `Analytics` tab
- main interaction: select thread for dashboard, not activate thread as chat

That keeps v0 fast, epistemically honest, and cleanly separated from the live thread surfaces.
