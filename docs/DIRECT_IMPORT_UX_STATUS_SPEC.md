# Direct Import UX And Status Integration Spec

Status: implementation specification for the next direct-runtime bundle on the
long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md](./DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)

## Purpose

Make the direct legacy import backend usable from the app without weakening the
direct-runtime boundary.

The previous import checkpoint bundle implemented the main-process path:

```text
explicit Codex JSONL source
  -> import candidate
  -> checkpoint validation report
  -> materialized imported direct session
  -> restart-safe import artifacts
```

This bundle adds the product surface and status integration:

```text
middle-plane import workbench
  -> main-owned source handles
  -> renderer-safe source summaries
  -> import report view
  -> materialized imported transcript view
  -> direct runtime status import summary
```

The core invariant remains:

```text
imported transcript evidence != runnable direct session truth
```

No imported session makes the Codex composer runnable in this bundle.

## Boundary

This bundle changes only the direct branch, the middle control plane, direct
runtime status, and renderer-safe imported transcript display.

It does not:

- make `direct` mode available;
- make direct runtime the default;
- start or require `codex app-server`;
- import credentials or `~/.codex/auth.json`;
- scan default `CODEX_HOME` automatically;
- expose raw absolute source paths to renderer state;
- expose raw JSONL records or raw source lines;
- execute, approve, or replay imported tool calls;
- continue an imported checkpoint with a live model request;
- modify right-pane ChatGPT thread bindings;
- import ChatGPT web threads;
- add a raw ODEU/profile browser as product UI.

The workflow is left-lane import evidence only. The right ChatGPT pane remains
a separate real ChatGPT review/world-model surface.

## Current Substrate

Already available after the legacy import checkpoint bundle:

- `DirectImportController` under `src/main/direct/import/import-controller.js`;
- IPC/preload methods for source listing, source inspection, candidate build,
  checkpoint build, materialization, report reads, and cancellation;
- `DirectSessionStore` import artifact persistence and import index recovery;
- `buildRendererSafeImportSession(session)` projection;
- materialized imported sessions with `runtimeMode = "imported-readonly"`;
- validation states:

```ts
type ImportedSessionState =
  | "imported-unvalidated"
  | "imported-readonly"
  | "imported-validation-failed"
  | "import-canceled"
  | "checkpoint-candidate"
  | "checkpoint-validated";
```

Canonicalization rule:

```text
checkpointed-runnable -> checkpoint-validated
```

Older persisted artifacts may still contain the legacy helper name
`checkpointed-runnable`. Load paths and renderer projections must map it to
`checkpoint-validated`. Renderer labels must say:

```text
Checkpoint validated
Continuation not started
Composer disabled
```

Renderer-facing UI must not use the word `runnable` for imported checkpoint
state in this bundle.

Missing:

```text
main-owned source handles
native source picker
import workbench UI
report panel
import artifact/session list
runtime status import summary
imported transcript badge/card rendering in middle plane
hide/unhide failed or corrupted import records
```

## UX Placement

Add a middle-plane import workbench. Prefer a new middle tab:

```text
Overview | Threads | Imports | Analytics | Web
```

Rationale:

- imports are project-scoped operational work, not runtime settings;
- the threads tab is already dense with Codex/ChatGPT thread linking;
- import reports and materialized imported sessions need enough horizontal
  room for scan-friendly lists and detail panels.

The Imports tab should be a dense workbench, not a landing page. It should use:

- a toolbar for source selection and refresh;
- a compact source list;
- a report/detail panel;
- status badges for import state;
- non-executable tool/approval evidence cards;
- clear empty states only when there is no import evidence for the selected
  project.

Do not show instructional long-form text in the app. Use short labels and
status lines.

## Source Handle Model

The renderer must not receive raw source absolute paths. The current controller
returns safe source summaries with `sourcePath = ""`, which is correct but not
enough for a selectable UI.

Add a main-owned source handle layer:

```ts
type DirectImportSourceHandle = {
  handleId: string;
  projectId: string;
  createdAt: string;
  expiresAt: string;
  sourcePath: string;          // main-process private
  sourceRoot?: string;         // main-process private
  sourceFileSha256?: string;
  sourceFileSizeBytes?: number;
  sourceSelectionMode:
    | "native-file-picker"
    | "native-root-picker"
    | "explicit-test-handle"
    | "explicit-configured-source-root";
};

type RendererSafeImportSource = {
  handleId: string;
  sourceDisplayName: string;
  sourceRootDisplayName: string;
  sourceClass: "codex-cli-jsonl" | "codex-app-server-jsonl" | "shell-archive-jsonl";
  sourceFileSizeBytes: number;
  sourceFileMtimeMs?: number;
  sourceEvidenceKey?: string; // local HMAC/evidence key, not raw source sha256
  duplicateMatched?: boolean;
  threadId?: string;
  timestampStart?: string;
  timestampEnd?: string;
  recordCount?: number;
  sourceSelectionMode:
    | "native-file-picker"
    | "native-root-picker"
    | "explicit-test-handle"
    | "explicit-configured-source-root";
  defaultCodexHomeScanned: false;
  rawPathExposed: false;
};
```

Rules:

- `handleId` must be cryptographically random and unguessable;
- source handles are scoped to project id;
- source handles expire and are cleared on app restart unless already
  materialized as an import artifact;
- `handleId` is safe for renderer state;
- raw paths remain in main process only;
- raw `sourceFileSha256` remains main-process private and is not exposed to the
  renderer by default;
- duplicate detection may use private `sourceFileSha256 + threadId + timestamp
  range`, but renderer state receives only duplicate status or a local
  HMAC/evidence key;
- renderer calls import actions with `handleId`, not `sourcePath`;
- diagnostics may retain source paths only in app-private records.

Handle lifecycle:

```text
expired handle:
  Source selection expired. Choose the file again.

wrong project:
  Source selection belongs to another project.

app restart:
  handles are cleared; renderer state cannot reconstruct source paths

already materialized:
  follow-up report/transcript actions use importId/sessionId, not handleId
```

## Source Selection

Add main-process source picker IPC:

```text
direct-import:choose-source-file
direct-import:choose-source-root
```

These handlers use Electron native dialogs and return only
`RendererSafeImportSource` entries.

Allowed selection:

```text
single JSONL file
explicit legacy Codex source directory
explicit shell archive directory/file if represented as JSONL-like evidence
```

Not allowed:

```text
automatic default CODEX_HOME scan
default-codex-home-auto-scan source selection mode
right-pane ChatGPT scraping
browser local storage scraping
credential import
symlink source root
```

Directory listing must keep the existing safety behavior:

- skip symlinks;
- tolerate unreadable child directories;
- cap source count;
- never follow traversal outside the selected root;
- never expose raw child file paths to renderer state.

Main-process enforcement:

- reject NUL and control characters in selected paths;
- realpath the selected root before creating a handle;
- realpath every candidate file before listing or inspecting it;
- require candidate realpath to remain under the selected root realpath;
- reject symlink source roots;
- skip symlink children.

Legacy import source selection is host-side unless WSL-native picking is
explicitly implemented through the workspace backend. Selecting a legacy JSONL
source does not imply workspace authority or current WSL workspace equivalence.
If WSL-native import source picking is added later, route it through the
workspace backend rather than treating `\\wsl$` browsing as authoritative.

## Import Workflow

The first app-visible workflow is:

```text
choose source
  -> inspect source
  -> build checkpoint/report
  -> materialize read-only import
  -> open imported transcript/report detail
```

Use an explicit action for each step, but make the normal happy path efficient:

```text
Choose file/root -> selected source appears
Inspect -> source summary and warnings
Import -> checkpoint/report/materialized session
Open -> imported transcript detail
```

Renderer state should track:

```ts
type DirectImportWorkbenchState = {
  projectId: string;
  requestGeneration: number;
  status: "idle" | "choosing" | "inspecting" | "validating" | "materializing" | "failed";
  selectedHandleId: string;
  activeOperationId: string;
  sources: RendererSafeImportSource[];
  imports: RendererSafeImportSessionSummary[];
  selectedImportId: string;
  selectedSessionId: string;
  report: RendererSafeImportReport | null;
  lastError: string;
};
```

All long operations must be represented as pending states in the workbench. The
user should never have to infer whether import is still running.

Operation state:

```ts
type DirectImportOperation = {
  operationId: string;
  projectId: string;
  kind: "inspect" | "validate" | "materialize" | "revalidate";
  status: "pending" | "completed" | "failed" | "canceled";
  startedAt: string;
};
```

Project-generation rules:

- if the selected project changes while choose/inspect/validate/materialize is
  pending, the renderer discards the stale response;
- main-process IPC validates `projectId` against every source handle, import
  id, and materialized session id;
- operation responses include `operationId` and project id so stale renderer
  updates can be ignored.

The UI should offer Cancel for inspection, validation, materialization, and
revalidation when the main controller can cancel the active operation.

## Renderer-Safe Import List

Extend main-process import/session store access with a renderer-safe list:

```ts
type RendererSafeImportSessionSummary = {
  sessionId: string;
  importId: string;
  title: string;
  importState: ImportedSessionState;
  materializationKind:
    | "readonly-transcript"
    | "checkpoint-candidate"
    | "checkpoint-validated";
  continuationEligible: boolean;
  continuationRunnableNow: false;
  sourceDisplayName: string;
  sourceRootDisplayName: string;
  sourceClass: string;
  recordCount: number;
  timestampStart?: string;
  timestampEnd?: string;
  warningsCount: number;
  blockersCount: number;
  recoveryState?: "healthy" | "partial" | "corrupted" | "missing-source" | "report-only";
  hidden?: boolean;
  composer: {
    enabled: false;
    reason:
      | "imported-readonly"
      | "checkpoint-validation-only"
      | "live-continuation-not-implemented";
  };
};
```

Rules:

- no raw path;
- no raw JSONL line;
- no raw source record;
- no raw auth-like material;
- no imported system/developer/runtime policy text unless already accepted as
  renderer-safe transcript evidence;
- no action on imported tool calls besides viewing evidence.

`composer.enabled = false` is a main-process session projection, not a CSS-only
state. If an imported session is ever opened in the left Codex surface, the
surface must receive this field and disable input from the session truth.

## Report Panel

The import report panel should show:

- import state;
- source display name and class;
- record count and timestamp range;
- workspace match status, method, and confidence;
- gate table;
- warnings;
- blockers;
- recovery state;
- continuation eligibility truth.

Renderer-safe report shape:

```ts
type RendererSafeImportReport = {
  importId: string;
  reportId: string;
  state: ImportedSessionState;
  source: {
    sourceDisplayName: string;
    sourceRootDisplayName: string;
    sourceClass: string;
    recordCount: number;
    timestampStart?: string;
    timestampEnd?: string;
  };
  workspaceMatch: {
    status: "matched" | "mismatch" | "unknown" | "ambiguous";
    selectedWorkspaceKind: "wsl" | "local" | "unknown";
    selectedWorkspaceDisplay: string;
    sourceCwdDisplay?: string;
    matchMethod: string;
    confidence: string;
  };
  gates: Array<{
    id: string;
    label: string;
    passed: boolean;
    severity: "info" | "warning" | "blocker";
  }>;
  counts: {
    records: number;
    messages: number;
    toolCalls: number;
    toolResults: number;
    approvals: number;
    fileChanges: number;
    errors: number;
    unknown: number;
  };
  warnings: Array<{ code: string; message: string }>;
  blockers: Array<{ code: string; message: string }>;
  continuation: {
    eligible: boolean;
    runnableNow: false;
    reason: string;
  };
  rawPathExposed: false;
  rawRecordsExposed: false;
};
```

Do not expose report internals as raw JSON. The panel is a curated projection.

## Transcript Detail

The imported transcript detail may live in the Imports tab in this bundle. It
does not need to replace the left Codex panel yet.

Render transcript items with imported/source badges:

| Evidence | UI behavior |
| --- | --- |
| user message | renderer-safe message item |
| assistant message | renderer-safe message item |
| tool call | non-executable evidence card |
| tool result | non-executable evidence card |
| approval | historical fact, not permission |
| file change | summary card only |
| command | summary card only |
| compaction | summary/checkpoint card |
| unknown | warning row, no raw payload |

Imported tool/approval cards must not show Approve, Decline, Cancel, Run, Apply,
Retry, or Continue controls.

The transcript detail may include a button to open the materialized imported
session in the left Codex surface only if that renderer path consumes
`RendererSafeImportSession` and keeps the composer disabled. If that path is
not complete, the Imports tab detail is enough for this bundle.

Default for this bundle:

```text
Imports tab detail only.
```

`Open in left Codex surface` is deferred unless the implementation also adds
smoke coverage for:

- composer disabled by main-process imported-session state;
- no direct turn start;
- imported tool cards non-executable;
- renderer-safe projection only;
- switching back to live direct or app-server does not mutate import records.

Rendering caps:

```ts
const MAX_RENDERER_IMPORT_ITEMS = 2000;
const MAX_RENDERER_TEXT_CHARS_PER_ITEM = 16000;
const MAX_RENDERER_TOTAL_TEXT_CHARS = 1_000_000;
```

Imported transcript rows should be virtualized or capped. Truncation must be
visible with a `truncated for display` marker; full source evidence remains only
in private app-owned import artifacts.

## Runtime Status Integration

Extend `DirectRuntimeStatus` with an import summary:

```ts
type DirectImportRuntimeStatus = {
  available: boolean;
  sourceSelectionAvailable: boolean;
  importedSessionCount: number;
  checkpointCandidateCount: number;
  checkpointValidatedCount: number;
  validationFailedCount: number;
  canceledCount: number;
  corruptedCount: number;
  hiddenCount: number;
  lastImportUpdatedAt: string;
  continuationEligibleCount: number;
  continuationRunnableNowCount: 0;
  rawPathsExposed: false;
  rawRecordsExposed: false;
};
```

Add it under:

```ts
directRuntimeStatus.imports
```

Runtime status rules:

- import availability does not make `directRuntime.turnRunnable` true;
- checkpoint validation does not make `turns.canStart` true;
- import count/recovery state may appear in the Overview runtime status area;
- raw paths and raw records exposure flags must always be false.

## Hide And Cleanup

Support import record cleanup without touching the original source file.

Add main-process actions:

```text
direct-import:list-imports
direct-import:hide
direct-import:unhide
```

Behavior:

| Action | Effect |
| --- | --- |
| hide | Marks import hidden in the app import index. Does not delete artifacts or source. |
| unhide | Restores hidden import to lists. |

Hard deletion is deferred for this UX bundle. Deleting app-owned import
artifacts, materialized sessions, turn files, diagnostics, and indexes is useful
but not required to make the import workflow usable.

If a later bundle implements hard deletion, require:

- explicit confirmation;
- `importId` only, never path;
- deletion plan preview from main process;
- every target realpaths under the direct session store root;
- no deletion if recovery state is corrupted or partial until a safe artifact
  map can be built;
- never delete source JSONL;
- never delete `CODEX_HOME`;
- rebuild indexes after deletion.

## Duplicate Imports

The UI should not create confusing duplicates by default.

When the selected source matches an existing import by:

```text
private sourceFileSha256 + threadId + timestamp range
```

show the existing import and offer:

```text
Open existing
Revalidate
New attempt
```

`Revalidate` creates a new validation report/attempt but does not silently
mutate old reports. `New attempt` must make lineage clear.

## Error Handling

Errors must be visible and actionable without exposing private paths.

Examples:

| Error | Renderer-safe message |
| --- | --- |
| missing source handle | Source selection expired. Choose the file again. |
| source too large | Source exceeds import size cap. |
| record cap exceeded | Source has too many records for this import pass. |
| auth material observed | Import contains auth-like material and cannot be materialized. |
| workspace mismatch | Source workspace could not be matched to this project. |
| corrupt artifact | Stored import record is corrupted; revalidate or hide it. |
| canceled | Import canceled before materialization. |

Do not include raw file paths in error messages shown in the renderer.

Auth-material blockers should be non-revealing:

```ts
type RendererSafeAuthMaterialBlocker = {
  code: "auth_material_observed";
  message: "Import contains auth-like material and cannot be materialized.";
  count?: number;
  categories?: Array<"token" | "cookie" | "authorization-header" | "session-id" | "unknown">;
};
```

Do not render exact source keys, values, headers, cookies, or raw matched text
outside private redacted diagnostics.

## Security And Privacy

The renderer never receives:

- raw source absolute path;
- raw source SHA-256 digest by default;
- raw source JSONL text;
- raw source JSONL lines;
- raw source records;
- raw credentials or auth-like material;
- raw backend frames;
- raw provider request bodies.

The app must not put source paths into:

- DOM attributes;
- localStorage/sessionStorage;
- project config;
- right-pane handoff text;
- exported project reports by default.

Native dialog selections are main-process private. Renderer state stores only
`handleId` and renderer-safe labels.

User-confirmed workspace matches are metadata only. A user confirmation may set:

```text
workspaceMatch.status = matched
workspaceMatch.matchMethod = user-confirmed
```

It must not:

- grant filesystem authority;
- make imported approvals authoritative;
- make imported tool calls replayable;
- make continuation runnable now;
- bypass current project workspace binding.

## ODEU Mapping

This bundle does not create new upstream capability law. It exposes accepted
local import capabilities in product UI.

Suggested local capability ids:

```text
import.ui.source_handle.accepted
import.ui.source_selection.accepted
import.ui.report_projection.accepted
import.ui.transcript_projection.accepted
import.ui.hide_record.accepted
import.status.summary.accepted
```

These do not imply:

```text
direct checkpoint continuation accepted
imported tool replay accepted
imported approval authority accepted
direct mode default accepted
right-pane thread import accepted
```

## Implementation Plan

### Phase 0: State And Projection Cleanup

- Canonicalize `checkpoint-validated`.
- Map old `checkpointed-runnable` artifacts to `checkpoint-validated`.
- Add `composer.enabled = false` to renderer-safe import sessions.
- Remove raw `sourceFileSha256` from renderer-safe shapes or replace it with a
  local HMAC/evidence key.

### Phase 1: Source Handle Registry

- Add cryptographically random source handles.
- Scope handles by project id.
- Enforce expiry and restart clearing.
- Realpath source/root validation.
- Reject symlink roots and skip symlink children.
- Add explicit source selection mode.
- Mark test-only handles as `explicit-test-handle`.

### Phase 2: Renderer-Safe Import Status

- Add import summary to `DirectSessionStore.status()` or a companion method.
- Add renderer-safe import list projection.
- Add `directRuntimeStatus.imports`.
- Keep `continuationRunnableNowCount = 0`.
- Include recovery-state counts.

### Phase 3: Imports Tab Skeleton

- Add `Imports` middle tab.
- Add source toolbar, import list, detail panel, and loading/error states.
- Wire refresh/list imports.
- Avoid nested cards; use workbench panels and compact rows.
- Add project-generation guards.

### Phase 4: Import Flow

- Wire choose source -> inspect -> validate -> materialize.
- Show duplicate import choices.
- Show workspace confirmation only as an explicit gate when needed.
- Never auto-materialize sources selected from default locations.
- Add operation ids and cancellation where supported.

### Phase 5: Report And Transcript Detail

- Render gate table, counts, warnings, blockers, and recovery state.
- Render imported transcript items with source badges.
- Render imported tool/approval evidence as non-executable cards.
- Keep composer disabled for imported sessions.
- Add virtualization/caps and visible truncation markers.

### Phase 6: Hide Only

- Implement hide/unhide.
- Rebuild import indexes after cleanup.
- Defer hard delete.

### Phase 7: Smokes

- Source handle does not expose raw path.
- Source handle does not expose raw source SHA-256.
- Handle expiry returns safe choose-again error.
- Cross-project handle rejection.
- Choose/list/inspect/materialize happy path.
- Duplicate source shows existing import.
- Auth-material import blocks materialization and shows safe error.
- Workspace mismatch shows blocker.
- Corrupt import artifact appears as corrupted and can be hidden.
- Runtime status import summary counts states correctly.
- Renderer projection contains no raw source paths or raw records.
- Renderer state, DOM attributes, browser storage, project config, handoff
  text, and exported reports contain no raw source path or raw JSONL substring.
- No direct Responses transport call or app-server spawn occurs.

## Acceptance Criteria

- `checkpointed-runnable` is not used in renderer labels; old artifacts map to
  `checkpoint-validated`.
- Imports tab exists and is project-scoped.
- Source selection is explicit through a main-owned picker or explicit test
  handle; no default Codex home scan occurs.
- Renderer import actions use `handleId`, not raw file path.
- Source handles are cryptographically random, project-scoped, expire, and are
  cleared on restart.
- Expired handle actions fail with a safe choose-again message.
- Every import IPC validates project id against handle/import/session
  ownership.
- Import async responses are ignored if active project or request generation
  changed.
- Source roots and candidate files are realpath-contained; symlink roots are
  rejected and symlink children skipped.
- Renderer-safe source summaries contain no raw absolute paths.
- Renderer-safe source summaries do not expose raw source SHA-256; duplicate
  matching uses private main-process identity or local HMAC/evidence key.
- Import list shows state, warnings/blockers count, source display name,
  timestamp range, and recovery state.
- Import report panel shows gates, counts, warnings, blockers, workspace match,
  and continuation truth.
- Imported transcript detail renders messages and non-executable tool/approval
  evidence.
- Renderer-safe import sessions carry `composer.enabled = false` with a
  concrete reason.
- No imported session enables the Codex composer.
- Workspace confirmation does not grant authority, replay tools, or make
  continuation runnable.
- Imported transcript detail is virtualized or capped and truncation is
  labeled.
- Runtime status includes import summary counts and raw exposure flags.
- Hide/unhide failed or corrupted imports works without deleting the source
  JSONL.
- Hard delete is deferred, or protected by a main-process deletion plan
  constrained to the direct session store root.
- Duplicate imports of the same source show existing import by default.
- Source paths are not stored in renderer state, DOM attributes, browser
  storage, project config, handoff text, or exported reports.
- Raw JSONL substrings are not stored in renderer state, DOM attributes,
  browser storage, project config, handoff text, or exported reports.
- No default `CODEX_HOME` scan can be triggered by the Imports tab.
- `npm run direct:smoke` covers source handles, renderer-safe projections,
  status counts, materialization flow, and blocked/corrupt import states.

## Non-Goals

- Live continuation from checkpoint-validated imports.
- Opening imported sessions as runnable left-lane Codex conversations.
- Importing right-pane ChatGPT web threads.
- Importing credentials.
- Replaying imported tool calls.
- Write/shell/network authority expansion.
- Making direct mode default.
- Raw ODEU/profile browser UI.
- Hard deletion of import artifacts in the first UX bundle.
- Opening imported sessions in the left Codex surface unless composer-disabled
  imported-session rendering has dedicated smoke coverage.

## Exit State

After this bundle, the branch should be able to say:

```text
An explicitly selected legacy Codex JSONL source can be imported through the
app UI, inspected through a renderer-safe report, materialized as read-only
direct import evidence, displayed with truthful imported-state labels, counted
in direct runtime status, and hidden from the import workbench without exposing
raw paths or making any imported session runnable.
```
