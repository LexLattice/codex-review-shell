# Direct Legacy Import Checkpoint Spec

Status: implementation specification for the next direct-runtime bundle on the
long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)

## Purpose

Add the first app-visible legacy import gate for the direct Codex runtime:

```text
explicit legacy Codex JSONL source
  -> source evidence candidate
  -> validation report
  -> direct checkpoint candidate
  -> materialized direct read-only session
  -> optional checkpoint-validated marker when all gates pass
```

This bundle moves imported Codex CLI / `codex app-server` history into the
direct harness without pretending that legacy sessions are native direct
sessions.

The core invariant is:

```text
imported transcript evidence != runnable direct session truth
```

Imported messages, tool calls, approvals, file changes, errors, and timestamps
are evidence. They do not grant local authority, do not replay tools, and do
not imply that the direct backend can continue from the original provider
state.

## Decision

Implement Phase 6A of the direct runtime replacement track:

```text
Codex surface / middle control plane
  -> direct import controller
    -> source discovery from explicit legacy JSONL input
    -> import candidate builder
    -> checkpoint candidate builder
    -> checkpoint validation report
    -> direct session materializer
      -> DirectSessionStore
```

This spec turns the existing import helpers into an app-visible workflow. It
does not yet send a live direct request from an imported checkpoint.

The next implementation should prove:

- the app can import a selected legacy Codex JSONL session into a direct
  read-only session;
- the import report explains exactly why the session is or is not
  checkpoint-validated;
- checkpoint-validated imports become eligible for a later direct continuation
  path;
- imported tool calls and approvals remain non-authoritative.

## Boundary

This bundle changes only the direct branch and only the left Codex lane import
surface.

It does not:

- make `direct` mode available;
- make direct runtime the default;
- require or start `codex app-server`;
- import credentials or `~/.codex/auth.json`;
- scan the user's default Codex profile automatically;
- execute, approve, or replay imported tool calls;
- continue an imported session with a live model request;
- infer future workspace authority from imported approvals;
- modify right-pane ChatGPT bindings;
- import ChatGPT web threads;
- expose raw source absolute paths, raw transcript records, auth material, or
  unredacted diagnostics to the renderer.

`legacy-app-server` remains the reliable runtime. Imported direct sessions stay
quarantined; checkpoint validation can only mark future continuation
eligibility. No imported session makes the composer runnable in this bundle.

## Current Substrate

Already available:

- `buildImportCandidate(records, options)` in
  `src/main/direct/import/codex-jsonl-import.js`;
- `buildDirectCheckpointCandidate(importCandidate, options)`;
- `validateDirectCheckpointCandidate(checkpointCandidate, options)`;
- `materializeDirectImportSession(checkpointCandidate, options)`;
- direct session store support for `compactionCheckpoints`,
  `sourceClass`, `runtimeMode`, `importState`, `readOnlyImported`, and
  `continuationEligible`;
- direct smoke coverage for imported read-only and checkpoint-validated
  materialization;
- runtime status language that distinguishes `legacy-app-server`,
  `direct-experimental`, `imported-readonly`, and imported checkpoint states.

Missing:

```text
explicit import source selection/listing
  -> report stored in diagnostics/imports
  -> materialized direct session with turn files
  -> renderer-visible import state
  -> checkpoint eligibility surfaced truthfully
  -> no automatic continuation
```

## Import State Model

Use the existing quarantine states:

```ts
type ImportedSessionState =
  | "imported-unvalidated"
  | "imported-readonly"
  | "imported-validation-failed"
  | "import-canceled"
  | "checkpoint-candidate"
  | "checkpoint-validated";
```

State meaning:

| State | Meaning | Runnable |
| --- | --- | --- |
| `imported-unvalidated` | Source parsed, but no validation report has been produced. | No |
| `imported-readonly` | Import materialized as transcript evidence only. | No |
| `imported-validation-failed` | Required source, role, or timestamp gates failed. | No |
| `import-canceled` | User canceled import before a complete candidate/report/session was produced. | No |
| `checkpoint-candidate` | Enough evidence exists to build a direct checkpoint candidate, but some continuation gate remains missing. | No |
| `checkpoint-validated` | The checkpoint passes deterministic local validation and may be offered to a later direct checkpoint-continuation flow. | Not in this bundle |

Do not overload `completed`, `failed`, or `checkpoint_required` alone to express
import state. Direct session summaries, turns, runtime status, and renderer
items must carry explicit import-state fields.

Avoid naming or UI that implies imported sessions are runnable now. The old
helper term `checkpointed-runnable` should be treated as legacy wording. New
implementation should use `checkpoint-validated` or carry an explicit
eligibility split:

```ts
type ImportRuntimeEligibility = {
  checkpointValidated: boolean;
  directContinuationEligible: boolean;
  directContinuationRunnableNow: false;
  runnableScope: "none" | "future-checkpoint-continuation-only";
};
```

Hard rule:

```text
No imported session makes the composer runnable in this bundle.
```

## Source Selection

Imports must start from explicit user/project intent.

Allowed sources for this bundle:

```text
single selected Codex JSONL file
explicit selected legacy Codex home directory
explicit selected codex-review-shell archived transcript file, only if it is
  already represented as JSONL-like evidence
```

Not allowed:

```text
implicit scan of default CODEX_HOME
credential import
right-pane ChatGPT thread scraping
browser local storage scraping
automatic import on app startup
```

The controller may list candidate JSONL files only after the user has selected
or configured a legacy source root for the project.

Source identity must be preserved in main-process storage:

```ts
type DirectImportSourceIdentity = {
  sourceClass: "codex-cli-jsonl" | "codex-app-server-jsonl" | "shell-archive-jsonl";
  sourcePath: string;        // main-process private absolute path
  sourceDisplayName: string; // renderer-safe basename or project-relative label
  sourceRootId: string;
  sourceRootDisplayName: string;
  sourceFileSizeBytes: number;
  sourceFileSha256: string;
  sourceFileMtimeMs?: number;
  threadId: string;
  timestampStart: string;
  timestampEnd: string;
  recordCount: number;
  importedAt: string;
};
```

Renderer state should receive display labels and stable ids, not raw absolute
paths by default. Diagnostics may retain raw source paths only in private
main-process import records.

Candidate, checkpoint, validation report, materialized session, and turn must
all reference the same `sourceFileSha256` and `importId`. This prevents a file
from being inspected, modified, and then materialized as if it were the same
source.

Every import artifact carries deterministic lineage:

```ts
type DirectImportLineage = {
  importId: string;
  sourceId: string;
  candidateId: string;
  checkpointId?: string;
  validationReportId: string;
  materializedSessionId?: string;
  materializedTurnId?: string;
  attemptNumber: number;
  supersedesImportId?: string;
};
```

Duplicate import behavior:

```text
same sourceFileSha256 + same threadId + same timestamp range:
  show existing import record by default
```

The user may then open the existing import, revalidate it with the current
parser, or create a new import attempt. Revalidation creates a new report and
lineage attempt; it must not silently mutate old reports.

## Import Controller

Add a direct import controller under:

```text
src/main/direct/import/import-controller.js
```

Suggested API:

```ts
type DirectImportController = {
  listSources(project, params): Promise<DirectImportSourceSummary[]>;
  inspectSource(project, params): Promise<DirectImportInspection>;
  buildCandidate(project, params): Promise<DirectImportCandidateReport>;
  buildCheckpoint(project, params): Promise<DirectCheckpointReport>;
  materialize(project, params): Promise<DirectMaterializedImportSession>;
  readReport(project, params): Promise<DirectImportReport>;
  cancelImport(project, params): Promise<void>;
};
```

IPC should stay main-owned. The renderer should not parse legacy JSONL, read
source files directly, or receive raw records.

Suggested IPC names:

```text
direct-import:list-sources
direct-import:inspect-source
direct-import:build-candidate
direct-import:build-checkpoint
direct-import:materialize
direct-import:read-report
direct-import:cancel
```

The controller should be callable from the middle plane or project settings
surface, not from the right ChatGPT pane.

Default caps:

```ts
const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 200_000;
const MAX_RENDERER_TRANSCRIPT_ITEMS = 2_000;
const MAX_RENDERER_TEXT_CHARS_PER_ITEM = 16_000;
const MAX_RAW_RECORD_BYTES = 2 * 1024 * 1024;
```

If caps are exceeded, read-only import may still be possible only if a safe
summary can be produced. Checkpoint eligibility is blocked unless the parser
fully validates the source. Import parsing should be chunked or streaming where
possible and cancellable from UI.

Canceled imports write a terminal report with `state = "import-canceled"`.
Partial candidates are not materialized as sessions.

## Evidence Graph

The candidate builder should preserve a normalized evidence graph, not only a
flat transcript.

Minimum evidence node classes:

```ts
type DirectImportEvidenceKind =
  | "message"
  | "reasoning_summary"
  | "tool_call"
  | "tool_result"
  | "approval"
  | "file_change"
  | "command"
  | "error"
  | "compaction"
  | "event"
  | "unknown";
```

For each node:

```ts
type DirectImportEvidenceNode = {
  seq: number;
  timestamp: string;
  factKind: DirectImportEvidenceKind;
  subtype: string;
  role?: string;
  text?: string;
  sourceType: string;
  sourceHash: string;
  rawRecordStoredInMain: boolean;
  rendererSafe: boolean;
};
```

The renderer can display transcript-safe projections. Full raw source records
belong only in private diagnostics.

Unknown record classifications must be auditable:

```ts
type UnknownRecordClassification = {
  sourceHash: string;
  seq: number;
  classification:
    | "non-semantic"
    | "semantic-unknown"
    | "security-sensitive"
    | "parser-unsupported";
  classifiedBy: "rule" | "manual";
  ruleId?: string;
};
```

Manual classification is out of scope for this bundle. Only rule-based
`non-semantic` unknowns can avoid blocking checkpoint validation.

## Validation Report

Every import attempt must produce a report.

```ts
type DirectImportValidationReport = {
  schema: "direct_codex_import_validation_report@1";
  reportId: string;
  lineage: DirectImportLineage;
  parserVersion: string;
  normalizerVersion: string;
  checkpointBuilderVersion: string;
  redactionVersion: string;
  materializerVersion?: string;
  generatedAt: string;
  source: DirectImportSourceIdentity;
  workspaceMatch: DirectImportWorkspaceMatch;
  state: ImportedSessionState;
  gates: {
    sourceFilePathPreserved: boolean;
    sourceThreadIdPreserved: boolean;
    sourceTimestampsRetained: boolean;
    roleBoundariesPreserved: boolean;
    userVisibleTextPreserved: boolean;
    assistantMessagesPreserved: boolean;
    toolCallsPaired: boolean;
    unresolvedImportedToolCallsClear: boolean;
    importedApprovalsCarryAuthority: false;
    importedToolCallsAutoReplayable: false;
    workspaceIdentityMatched: boolean;
    rendererRawRecordsExposed: false;
    rawAuthMaterialObserved: false;
  };
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
  warnings: DirectImportWarning[];
  blockers: DirectImportBlocker[];
};
```

Workspace matching is structured:

```ts
type DirectImportWorkspaceMatch = {
  status: "matched" | "mismatch" | "unknown" | "ambiguous";
  selectedProjectId: string;
  selectedWorkspaceKind: "wsl" | "local";
  selectedWorkspaceDisplay: string;
  sourceCwdDisplay?: string;
  sourceCwdHash?: string;
  sourceWorkspaceKindEvidence?: "wsl" | "local" | "unknown";
  matchMethod:
    | "exact-linux-path"
    | "exact-local-path"
    | "repo-root-fingerprint"
    | "git-remote-and-head"
    | "user-confirmed"
    | "none";
  confidence: "high" | "medium" | "low" | "none";
};
```

Validation report rules:

- `importedApprovalsCarryAuthority` is always false.
- `importedToolCallsAutoReplayable` is always false.
- Missing source timestamps block `checkpoint-validated`.
- Unpaired imported tool calls block `checkpoint-validated`.
- Unknown record types do not necessarily block read-only import, but they block
  checkpoint validation unless the unknown payload is explicitly classified
  as non-semantic.
- Raw auth material in the source blocks materialization until redaction
  succeeds.
- Only `workspaceMatch.status = "matched"` with `confidence = "high"` or
  explicit `matchMethod = "user-confirmed"` may allow checkpoint validation.
- Imported `cwd` never grants workspace authority.
- For WSL projects, do not infer equivalence from `\\wsl$` or Windows mirror
  paths. Use the workspace backend or a repo fingerprint.
- Changing parser, normalizer, checkpoint-builder, redaction, or materializer
  version does not silently mutate old imports. Revalidation creates a new
  report.

## Checkpoint Candidate

A checkpoint candidate is a direct-native summary seed derived from imported
evidence. It is not a provider continuity handle.

Minimum checkpoint shape:

```ts
type DirectImportCheckpoint = {
  checkpointId: string;
  source: DirectImportSourceIdentity;
  state: ImportedSessionState;
  eligibility: ImportRuntimeEligibility;
  title: string;
  messages: Array<{
    seq: number;
    role: "user" | "assistant" | "system" | "tool" | string;
    text: string;
    timestamp: string;
    sourceType: string;
  }>;
  unresolvedObligations: Array<{
    seq: number;
    kind: string;
    reason: string;
    autoReplayable: false;
    requiresFreshAuthority: true;
  }>;
  sourceTimestampRange: {
    start: string;
    end: string;
  };
  validationReportId: string;
};
```

Checkpoint validation may mark `checkpoint-validated` only when:

- source path, source root, thread id, and timestamp range are preserved;
- source file hash, source size, and import lineage match candidate and report;
- role boundaries are preserved;
- user-visible text exists;
- assistant-visible transcript text exists or the source clearly ended before an
  assistant response;
- unresolved imported tool calls are clear;
- imported approvals are not treated as authority;
- workspace identity has been matched to the selected project or explicitly
  marked unknown and ineligible for checkpoint continuation;
- no raw auth material is present in the checkpoint;
- no raw absolute source path is exposed to renderer state.

Imported system, developer, and runtime-policy messages are evidence only. They
must not automatically become direct runtime instructions. Future checkpoint
continuation may use user/assistant visible transcript text by default; imported
system/developer policy text requires explicit checkpoint policy acceptance.

## Materialization

Materialization writes a direct session for display and future checkpoint work.
Separate read-only display materialization from checkpoint validation:

```ts
type DirectImportMaterializationKind =
  | "readonly-transcript"
  | "checkpoint-candidate"
  | "checkpoint-validated";
```

All imported materializations remain imported evidence:

```ts
{
  readOnlyImported: true;
  nativeDirectSession: false;
}
```

The implementation must persist:

```text
direct-sessions/
  sessions/<session-id>/session.json
  turns/<session-id>/<turn-id>.json
  events/<session-id>/<turn-id>.normalized.jsonl     // optional empty/import events
  diagnostics/<session-id>/<import-report-id>.redacted.jsonl
  imports/<import-id>/candidate.json
  imports/<import-id>/checkpoint.json
  imports/<import-id>/validation-report.json
```

Current helper behavior that only updates the session summary is not enough for
this bundle. A materialized import must survive restart through both
`readSession` and `readTurn`.

Materialized session fields:

```ts
{
  sourceClass: "legacy-codex-jsonl-import",
  runtimeMode: "imported-readonly",
  materializationKind: DirectImportMaterializationKind,
  importState: ImportedSessionState,
  readOnlyImported: true,
  nativeDirectSession: false,
  continuationEligible: boolean,
  importLineage: DirectImportLineage,
  importSource: DirectImportSourceIdentity,
  directImportCheckpoint: DirectImportCheckpoint,
  compactionCheckpoints: [...]
}
```

Turn fields:

```ts
{
  imported: true,
  sourceClass: "legacy-codex-jsonl-import",
  importLineage: DirectImportLineage,
  importState: ImportedSessionState,
  checkpointId: string,
  state: "checkpoint_required" | "completed",
  continuationEligible: boolean
}
```

`checkpoint-validated` may use turn state `completed` only to indicate that
the imported transcript materialized cleanly. It must not imply that a live
direct backend continuation has already happened.

Renderer-safe projection is explicit:

```ts
type RendererSafeImportSession = {
  sessionId: string;
  importId: string;
  title: string;
  importState: ImportedSessionState;
  labels: string[];
  source: {
    sourceDisplayName: string;
    sourceRootDisplayName: string;
    sourceClass: string;
    recordCount: number;
    timestampStart?: string;
    timestampEnd?: string;
  };
  reportSummary: {
    warningsCount: number;
    blockersCount: number;
    gates: Record<string, boolean>;
  };
  transcriptItems: RendererSafeImportedItem[];
  continuation: {
    eligible: boolean;
    runnableNow: false;
    reason: string;
  };
};
```

Renderer never receives `DirectImportSourceIdentity.sourcePath`, raw JSONL
lines, or `rawRecordStoredInMain` payloads.

## Continuation Boundary

This bundle does not send a live model request from an imported checkpoint.

It may set:

```text
continuationEligible = true
```

only for `checkpoint-validated` imports.

In new implementation language this means:

```text
importState = checkpoint-validated
eligibility.directContinuationEligible = true
eligibility.directContinuationRunnableNow = false
```

It must not:

- call the direct Responses transport;
- attach `previous_response_id` from a legacy source;
- build a tool-result continuation from imported tool evidence;
- continue from imported approvals;
- auto-start a new direct turn.

The later checkpoint-continuation bundle must build a fresh direct request from
the checkpoint text/evidence, not from legacy provider hidden state.

## UX Requirements

The UI should label imported sessions truthfully.

Minimum labels:

```text
Imported read-only
Import validation failed
Checkpoint candidate
Checkpoint validated
Direct continuation not started
Imported tools require fresh authority
```

The transcript should render imported content as source evidence:

- messages display with imported/source badges;
- imported tool calls display as evidence, not executable cards;
- imported approvals display as historical facts, not permissions;
- imported file changes display summaries and source status;
- blockers/warnings appear in an import report panel;
- no raw JSONL record browser is exposed in normal UX.

The user should be able to:

- select/import a source;
- inspect the validation report;
- materialize a read-only imported session;
- delete or hide a failed import without deleting the original source file;
- switch the project back to `legacy-app-server` without deleting import records.

## Security And Privacy

Import reads may encounter secrets. Treat source files as sensitive.

Rules:

- never import credentials;
- never include source JSONL in project export by default;
- redact diagnostics before writing them to shared fixture/report locations;
- store raw source records only in app-private import records, if needed at all;
- detect auth-like fields (`access_token`, `refresh_token`, `Authorization`,
  cookies, session ids) and block materialization if redaction cannot remove
  them;
- do not expose raw absolute source paths to renderer diagnostics;
- do not infer workspace filesystem authority from imported `cwd` fields;
- WSL source paths remain source evidence only and do not imply current WSL
  workspace binding.

Auth-like field detection must cover nested objects, headers, cookies, session
ids, and stringified JSON where feasible. At minimum scan for:

```text
authorization
Authorization
headers.Authorization
headers.cookie
set-cookie
access_token
accessToken
refresh_token
refreshToken
id_token
session_id
csrf
bearer
oauth
```

Report export is separate from source import:

```ts
type ImportExportMode =
  | "none"
  | "redacted-report-only"
  | "redacted-report-and-renderer-safe-transcript";
```

Default export mode is `redacted-report-only`. Never export raw source JSONL,
raw source absolute paths, raw auth-like material, or raw private workspace
paths.

## ODEU Mapping

Import should create local ODEU evidence, not new upstream capability law.

Suggested capability ids:

```text
import.source.codex_jsonl.observed
import.node.message.accepted
import.node.tool_call.observed
import.node.tool_result.observed
import.node.approval.observed_non_authoritative
import.checkpoint.validation.accepted
import.materialization.accepted
import.continuation.blocked_until_checkpoint_validated
```

Accepted import capability does not imply:

```text
direct backend continuation accepted
tool replay accepted
workspace authority accepted
right-pane thread binding accepted
```

## Implementation Plan

### Phase 0: Schema And Lineage Hardening

- Add `importId`, `sourceFileSha256`, `sourceFileSizeBytes`, and import
  timestamp.
- Add parser, normalizer, checkpoint-builder, redaction, and materializer
  versions.
- Add shared lineage objects to candidate, checkpoint, report, session, and
  turn artifacts.
- Add renderer-safe projection types.

### Phase 1: Source And Report Store

- Add import root directories under the direct session store root.
- Add atomic JSON writes for candidates, checkpoints, and validation reports.
- Add import index recovery.
- Add redaction assertions for reports.

Concrete write order:

```text
1. candidate.json.tmp -> candidate.json
2. checkpoint.json.tmp -> checkpoint.json
3. validation-report.json.tmp -> validation-report.json
4. session.json.tmp -> session.json
5. turn.json.tmp -> turn.json
6. index update last, as derived cache
```

Recovery rules:

```ts
type ImportRecoveryState =
  | "healthy"
  | "partial"
  | "corrupted"
  | "missing-source"
  | "report-only";
```

On startup, rebuild the import index from durable import directories. If a
session exists without a matching report/checkpoint, mark the import corrupted
and do not expose it as checkpoint eligible.

### Phase 2: Import Controller

- Wrap existing candidate/checkpoint/materialization helpers.
- Add explicit source inspection.
- Add renderer-safe source summaries.
- Do not scan default `CODEX_HOME` automatically.
- Add duplicate-source handling and revalidation attempts.

### Phase 3: Parser Hardening

- Preserve message roles and text exactly.
- Improve tool-call/tool-result pairing where source shape allows it.
- Classify approvals as historical non-authority evidence.
- Classify file changes, command results, errors, and compaction summaries.
- Count unknown records and include them in the validation report.
- Add nested auth-like redaction scan.
- Add size caps and cancellation.

### Phase 4: Validation Report And Checkpoint Candidate

- Emit gates, counts, warnings, blockers, lineage, versions, and workspace
  match.
- Build checkpoint text/evidence seeds without provider continuity handles.
- Keep imported system/developer/runtime-policy text as evidence only.

### Phase 5: Materialized Session Persistence

- Write both `session.json` and turn JSON files.
- Persist transcript items with imported markers.
- Persist checkpoint and validation report ids on session and turn records.
- Add restart/readback smoke.

### Phase 6: Runtime Status And UI

- Surface imported session states in direct runtime status.
- Add import report panel or middle-plane import view.
- Render imported tool calls as non-executable evidence.
- Keep normal direct live composer disabled for all imported sessions in this bundle.
- Add delete/hide failed import behavior without deleting the source file.

### Phase 7: Acceptance Smokes

- Import clean message-only JSONL to `checkpoint-validated`.
- Import JSONL with unpaired tool calls to `checkpoint-candidate`.
- Import malformed/missing timestamp JSONL to `imported-validation-failed`.
- Import nested auth-like material and block materialization.
- Import unknown semantic records and block checkpoint validation.
- Detect source digest mismatch.
- Exercise file size and record count caps.
- Exercise canceled/partial import recovery.
- Verify no imported approval grants authority.
- Verify no direct transport call occurs during import.
- Verify no app-server spawn occurs during import.
- Verify renderer-safe projection has no raw paths or raw records.
- Verify restart reconstructs materialized imported session and turn.

## Acceptance Criteria

- Import source selection is explicit; no default Codex profile is scanned on
  startup.
- Source identity includes `sourceFileSha256`, file size, mtime when available,
  and import timestamp.
- Import artifacts carry shared lineage:
  `importId`, `sourceId`, `candidateId`, `checkpointId`, `validationReportId`,
  and materialized session/turn ids when present.
- Duplicate imports of the same source/thread/timestamp range resolve to the
  existing import unless the user explicitly revalidates or creates a new
  attempt.
- Parser, normalizer, checkpoint-builder, redaction, and materializer versions
  are recorded.
- Imported JSONL creates a validation report with gates, counts, warnings, and
  blockers.
- Workspace match is represented as `matched`, `mismatch`, `unknown`, or
  `ambiguous`, with method and confidence.
- Unknown record types require rule-based non-semantic classification to avoid
  blocking checkpoint validation.
- Imported system/developer/runtime-policy messages are evidence only and are
  not automatically reused as direct instructions.
- Import parsing has file-size, record-count, raw-record, and renderer-text caps
  and can be canceled.
- Partial, canceled, or corrupted imports are not exposed as checkpoint
  eligible.
- Startup can rebuild the import index from durable artifacts and mark
  partial/corrupt imports safely.
- Materialized imports write session and turn files and survive restart.
- `imported-readonly` sessions render transcript evidence but cannot run.
- `checkpoint-candidate` sessions preserve blockers and cannot run.
- `checkpoint-validated` sessions are marked continuation-eligible but do not
  automatically send a live request.
- Renderer-safe import projection contains no raw source path, raw JSONL line,
  or raw record payload.
- Imported tool calls are never executed or replayed.
- Imported approvals never imply workspace authority.
- Imported source paths are preserved in private main-process records but not
  exposed as raw renderer diagnostics.
- Raw credentials or auth-like fields in nested source records, headers,
  cookies, id tokens, session ids, or stringified JSON block materialization
  unless redacted.
- Switching back to `legacy-app-server` does not delete imported sessions,
  reports, checkpoints, or diagnostics.
- No direct Responses transport call and no app-server spawn can happen during
  import tests.
- `npm run direct:smoke` covers clean import, blocked import, materialization,
  and restart/readback.

## Non-Goals

- Live continuation from checkpoint-validated imports.
- Direct compaction request to summarize legacy history.
- Importing right-pane ChatGPT web threads.
- Importing credentials.
- Replaying imported tool calls.
- Write/shell/network tool authority.
- Making direct mode default.

## Exit State

After this bundle, the branch should be able to say:

```text
An explicitly selected legacy Codex JSONL session can be imported into the
direct harness as source evidence, validated, checkpointed, materialized, and
reloaded after restart. It remains non-runnable in this bundle. If
deterministic checkpoint gates pass, the import can be marked eligible for a
future checkpoint-continuation flow, but no composer path or live continuation
is enabled until that later bundle.
```
