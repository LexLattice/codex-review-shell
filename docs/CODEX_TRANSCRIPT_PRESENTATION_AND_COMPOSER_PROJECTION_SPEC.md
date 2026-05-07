# Codex Transcript Presentation And Composer Projection Spec

Status: implementation spec for the next Codex surface fix line.

Related docs:

- [CODEX_SURFACE_RELOAD_HISTORY_MARKDOWN_SPEC.md](./CODEX_SURFACE_RELOAD_HISTORY_MARKDOWN_SPEC.md)
- [CODEX_SURFACE_PROJECT_RENDERING_SPEC.md](./CODEX_SURFACE_PROJECT_RENDERING_SPEC.md)
- [CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md](./CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md)
- [CODEX_RUNTIME_HEADER_DRAWER_SPEC.md](./CODEX_RUNTIME_HEADER_DRAWER_SPEC.md)
- [COMPOSER_RUNTIME_BAND_ODEU_DEBUG.md](./COMPOSER_RUNTIME_BAND_ODEU_DEBUG.md)

## Morphic Stance

```yaml
task_mode: design
execution_mode: standard
grounding_status: repo_grounded_from_prior_inspection
implementation_inspection_status: implementation_inspected_prior_pass
runtime_observation_status: not_observed_for_this_spec_review
```

This spec integrates prior implementation inspection of the Codex surface and
stored transcript path. It does not claim a fresh live runtime observation for
the current review pass.

## Purpose

Define two bounded workstreams that may share one implementation PR but must not
leak responsibilities into each other:

```text
A. Transcript/projection parity
B. Composer/runtime bottom-band projection
```

The governing principle:

```text
Stored/restarted threads should look ontologically equivalent to live turns, but
the UI must not manufacture runtime state, quota state, file authority, or access
authority while doing that.
```

## Source Pack

Doctrine sources:

- Morphic UX frontend skill.
- Runtime/provider/header specs listed above.

Host implementation sources:

- `src/backend/wsl-agent.js`
- `src/renderer/codex-surface.js`
- `src/renderer/codex-surface.css`
- `src/main.js`
- `src/preload.js`

Observed problem source:

- Stored Codex session logs contain `function_call`, `function_call_output`,
  `exec_command_end`, `patch_apply_end`, custom tool calls, and reasoning rows.
- The current stored transcript extractor only emits flattened
  user/assistant/system message entries.

## Artifact Inventory

| Artifact | Class | Workstream | Host-owned semantics |
| --- | --- | --- | --- |
| `StoredCodexEventNormalizer` | support artifact | A | Convert raw stored JSONL rows into a canonical transcript presentation model |
| `CodexTranscriptPresentationModel` | support artifact | A | Shared stored/live transcript shape consumed by renderers |
| `StoredThoughtProcessProjection` | support artifact | A | Render persisted reasoning/tool/patch groups without live lifecycle side effects |
| `AssistantMarkdownTypedProjection` | support artifact | A | Safe Markdown projection with typed-token semantic preservation |
| `TypedTokenActionRouter` | support artifact | A | Central URL/file/ref action routing for Markdown and typed-token rendering |
| `MessageCopyAction` | surface artifact | A | Per-message raw-text copy affordance |
| `QuotaCompactWitness` | surface artifact | B | Compact quota percentage plus reset witness in the composer band |
| `QuotaCompactFormatter` | support artifact | B | Pure formatter for sanitized provider quota windows |
| `ComposerRuntimePickerProjection` | surface artifact | B | Access/model/reasoning/speed quick picker |
| `ComposerOverrideAxisState` | support artifact | B | Per-axis override/default/unsupported state |

## Invariants

- Stored rows must normalize into a versioned presentation model before DOM
  rendering.
- Stored rows must not be replayed through live event lifecycle handlers.
- Stored and live transcript rendering may share pure projection functions.
- Evidence-bearing tool and patch rows must not be silently dropped.
- Markdown parser owns syntax structure.
- Typed-token classifier owns token semantics.
- URL/file action router owns actions.
- Provider quota and runtime settings projections must come from sanitized
  runtime/provider evidence.
- Missing capability is not permission.
- Composer overrides are next-turn scoped unless a separate drawer/default
  contract explicitly says otherwise.

## A. Transcript And Projection Parity

### Presentation Model

Add a canonical model between raw JSONL and UI rendering:

```text
Raw stored JSONL
  -> StoredCodexEventNormalizer
  -> CodexTranscriptPresentationModel
  -> renderer
```

Suggested shape:

```ts
type CodexTranscriptPresentationModel = {
  schemaVersion: 1;
  threadId: string;
  source: "stored_jsonl" | "live_thread" | "hybrid";
  sourceHome?: string;
  sessionFilePath?: string;
  turns: CodexTranscriptTurn[];
  orphanItems: StoredProcessItem[];
  warnings: TranscriptProjectionWarning[];
};

type CodexTranscriptTurn = {
  turnKey: string;
  turnId?: string;
  sourceRows: SourceRowRef[];
  userMessages: ChatMessageProjection[];
  assistantFinalMessages: ChatMessageProjection[];
  thoughtItems: StoredProcessItem[];
  status: "complete" | "partial" | "failed" | "unknown";
};

type SourceRowRef = {
  rowIndex: number;
  eventId?: string;
  itemId?: string;
  callId?: string;
  kind: string;
};
```

Every normalized message, thought, tool, and patch item should carry:

```ts
sourceRows: SourceRowRef[];
sourceFile?: string;
sourceOrderStart: number;
sourceOrderEnd: number;
```

### Raw Row Mapping

Normalize these raw rows:

| Raw row | Projection |
| --- | --- |
| `event_msg.user_message` | user message |
| `response_item.message role=user` | user message |
| `event_msg.agent_message phase=commentary` | thought assistant item |
| `response_item.message role=assistant phase=commentary` | thought assistant item |
| `event_msg.agent_message phase=final_answer` | final assistant message |
| `response_item.message role=assistant phase=final_answer` | final assistant message |
| `response_item.function_call name=exec_command` | command lifecycle item |
| `event_msg.exec_command_end` | command completion detail |
| `response_item.function_call_output` | command/tool output detail |
| `event_msg.patch_apply_end` | patch/file-change item |
| `response_item.custom_tool_call` | dynamic tool lifecycle item |
| `response_item.custom_tool_call_output` | dynamic tool output detail |
| `response_item.reasoning` | reasoning item when visible summary/content exists |

Unknown tool-like rows should be preserved as diagnostic process items if they
have useful visible payload.

### Turn And Call Grouping

Turn ownership:

- Use `payload.turn_id` or `payload.turnId` first.
- Fallback to the latest `turn_context` only when the row is temporally adjacent
  and confidence is acceptable.
- If ownership is weak, preserve the item as an orphan diagnostic item near its
  chronological position instead of forcing false ownership.

Call lifecycle grouping:

- Merge command/tool start, completion, and output rows by `call_id`.
- Preserve lifecycle status:
  `started`, `completed`, `failed`, `partial`, or `unknown`.
- Preserve `command`, `cwd`, `exitCode`, `stdout`, `stderr`, `durationMs`, and
  output previews when available.
- Preserve patch status as `applied`, `failed`, `partial`, or `unknown`.
- Preserve patch changed files and summary when available.

### Deduplication

Deduplicate conservatively. Do not dedupe purely by text.

Allowed dedupe evidence:

- rows share stable item id, event id, or call id;
- adjacent schema-equivalent duplicates in the same turn and phase;
- same role, same phase, same normalized text, and same local row window.

If dedupe confidence is ambiguous, preserve the repeated text and add a
projection warning rather than dropping content.

### Stored Rendering Rule

Stored rendering should call the same pure thought-process DOM projection used by
live rendering after live events have been normalized.

Stored JSONL rows must not be replayed through live event lifecycle handlers.
Those handlers may mutate active turn state, request registries, streaming state,
retry state, or approval state.

### Thought Process Grouping

The stored and live projection should use the same grouping:

```text
Thought process / Process evidence
  reasoning/commentary text
  Shell / tool calls
  Patches
  other diagnostic process items
```

Rules:

- `Thought process (N)` counts visible evidence items after filtering.
- Empty reasoning/commentary does not count.
- Tool calls and patches count.
- Empty reasoning sentinel text such as `No reasoning text.` remains hidden.
- If a turn has only tool calls/patches and no visible reasoning/commentary, the
  parent label may be `Process evidence (N)` or `Tool activity (N)` to avoid
  implying hidden reasoning.
- Patches are nested under a standalone collapsed parent named `Patches`.
- Sparse command/tool/patch evidence still shows title and status.

### History Window Compatibility

Stored transcript normalization happens before history-window selection.

The history window selects complete turns/message windows from the normalized
presentation model. Hidden older turns keep their normalized thought/tool/patch
items out of the DOM until expanded.

Stored-to-live attach for the same thread should preserve the same transcript
window mode.

## Markdown, Typed Tokens, And Actions

### Projection Boundary

Final assistant Markdown remains safe and text-based.

```text
Markdown parser
  -> syntax structure
Typed-token classifier
  -> file/url/command/symbol semantics
TypedTokenActionRouter
  -> click actions and policy checks
```

### Inline Tokens

Inline backticks render as inline code by default.

If the typed-token classifier identifies a high-confidence file ref, URL, commit,
symbol, or known command token, apply typed-token color semantics inside the
inline-code shell.

Only file refs and URLs get actions in v0. Command-looking inline code is styled,
not executable.

### Markdown Links

Rules:

- `http` and `https` links route through the URL opener.
- Relative Markdown links resolve against the active project workspace root.
- Normalize and reject traversal outside the workspace.
- If target cannot be resolved or is outside the workspace, render an inert
  unresolved file token with a tooltip.
- Unsafe protocols such as `javascript:`, `data:`, `file:`, and unknown custom
  protocols render as inert diagnostic tokens with a reason.

Common supported local forms:

```text
docs/foo.md
./docs/foo.md
../docs/foo.md       # only if normalized target remains inside workspace
docs/foo.md#section
src/foo.ts:42
src/foo.ts#L42
```

### Code Fences

Rules:

- Code fences do not tokenize internally in v0.
- Unclosed code fences render safely through EOF.
- Language labels are text-only.
- Raw HTML renders as text.
- Copying a message copies original raw text, not projected DOM.

## Message Copy Action

Add a small copy button below each primary message bubble.

Rules:

- The button belongs to a message action row, not the message body.
- The action row should not shift layout when copied/failed state appears.
- The button is visible on hover/focus and keyboard reachable.
- Copy raw source text, not rendered Markdown/HTML.
- Live streamed assistant messages append `bubble.dataset.rawText` during
  streaming and finalize it on completion.
- Stored assistant messages copy the deduplicated displayed source text joined
  with the same separators used for visible projection.
- User messages preserve original user text exactly.
- Clipboard failure shows local message-level feedback only.
- Copy does not create transcript evidence or runtime state.
- v0 copies primary chat message text only, not hidden thought/tool/patch payloads.

## B. Composer Runtime Bottom-Band Projection

### Quota Compact Witness

The bottom composer band should display the same provider quota evidence already
available in the full runtime drawer when that evidence exists.

Suggested state:

```ts
type QuotaCompactWitnessState = {
  status: "available" | "stale" | "not_exposed" | "unavailable" | "unknown";
  primaryWindow?: "five_hour" | "weekly" | "other";
  percent?: number;
  resetAt?: string;
  resetLabel?: string;
  observedAt?: string;
  source: "provider_quota" | "runtime_constitution";
};
```

Display rules:

- Format provider-exposed reset timestamps in local display time.
- Show 5-hour reset as 24-hour time, for example `5h 42% - resets 18:00`.
- Show weekly reset as day plus 24-hour time, for example
  `W 71% - resets Tue 18:00`.
- If reset timestamp is missing, show `reset not exposed`.
- Do not calculate a reset timestamp from a known window length.
- If evidence is stale, show stale/degraded posture rather than a fresh-looking
  percentage.
- Clicking or hovering the compact witness should open or explain the Usage
  section.

Multiple quota windows:

- If both five-hour and weekly quota are available, the compact band shows the
  most constrained window by percentage.
- When space allows, show a secondary compact witness.
- Full details remain in the runtime drawer/menu.

Examples:

```text
5h 93% - resets 18:00
W 98% - resets Tue 18:00
5h 93% - W 98%
```

The bottom band consumes sanitized runtime constitution/provider quota state. It
must not call raw quota methods directly.

### Runtime Default Scope

Disambiguate default labels by surface:

```text
Composer picker:
  Runtime default
  No next-turn override

Drawer/project defaults:
  Provider default
  Clear project default
```

For the bottom/composer picker:

```ts
type ComposerOverrideAxis =
  | "model"
  | "reasoning_effort"
  | "service_tier"
  | "approval_policy"
  | "sandbox_policy";
```

Rules:

- Selecting `Runtime default` clears only that axis override.
- It does not clear other active overrides.
- It does not mutate project defaults.
- It does not imply the runtime has a known provider default unless provider
  evidence says so.
- Speed/service-tier choices appear only when the provider settings projection
  exposes them.
- If service-tier choices are not exposed, show `Runtime default` as read-only
  or degraded with an explanation.
- Do not invent `fast` or `flex` entries from static labels.

### Access Picker

The composer access picker is next-turn scoped only.

Rules:

- Authority-sensitive changes require visible scope.
- Elevating permissions requires confirmation if the runtime supports that
  transition.
- Unsupported approval/sandbox mutation remains disabled-visible.
- The bottom band must not silently promote sandbox, network, write roots, or
  danger/full-access state.

## Security And Privacy

- Stored JSONL can contain tool output, local paths, environment hints, and
  occasional sensitive material.
- Message copy copies only visible primary chat message raw text in v0.
- Hidden thought/tool/patch payloads are not copied by primary message copy.
- Diagnostic unknown tool rows render with `textContent` and stay collapsed by
  default.
- No raw provider quota payload, auth token, cookie, or transport secret is
  exposed to renderer state.
- URL/file actions route through allowlisted bridge methods.

## Implementation Order

1. Add `CodexTranscriptPresentationModel` and `StoredCodexEventNormalizer`.
2. Adapt stored rendering to pure shared projection functions, not live event
   replay.
3. Add `StoredThoughtProcessProjection` grouping for reasoning/commentary,
   shell/tool calls, and patches.
4. Add `AssistantMarkdownTypedProjection` with shared `TypedTokenActionRouter`.
5. Add `MessageCopyAction` for primary chat messages.
6. Add `QuotaCompactFormatter` consuming sanitized runtime constitution quota
   state.
7. Add `ComposerOverrideAxisState` and runtime-default entries for
   model/reasoning/speed/access.
8. Add focused fixtures/tests for stored JSONL normalization, Markdown/token
   routing, quota formatting, and override clearing.

## Acceptance Criteria

Stored transcript projection:

- Stored rows normalize into versioned `CodexTranscriptPresentationModel`.
- Stored rows are not replayed through live event lifecycle handlers.
- Every rendered stored thought/tool/patch item has source-row provenance.
- Duplicate final/commentary rows are deduped conservatively.
- Repeated legitimate text is preserved.
- Orphan tool-like rows are preserved as diagnostic items instead of dropped.
- Restarting a long stored thread shows shell/tool calls and patches inside
  collapsed process groups.

Thought process:

- Thought/process count reflects visible items after filtering.
- Empty reasoning/commentary is hidden and not counted.
- Sparse command/tool/patch evidence shows status/title even without body text.
- Patches show applied/failed/unknown status when available.
- Patches are nested under a standalone `Patches` parent.

Markdown and typed tokens:

- Markdown rendering and typed-token rendering share one action router.
- Relative links cannot resolve outside the active workspace.
- Relative repo file links render as file refs, not unsupported URL protocols.
- Unsafe Markdown links are inert with a reason.
- Inline command-looking code is not executable.
- Code fences do not tokenize internally.
- Typed-token color parity is restored for files, URLs, commands, symbols, and
  commits.

Copy:

- Copy button is keyboard reachable and does not shift layout.
- Live assistant raw text updates through streaming and finalization.
- Copy uses raw primary message text only, not hidden thought/tool/patch payloads.

Quota:

- Compact quota display handles multiple windows with a defined selection policy.
- Stale quota evidence renders stale/degraded.
- Reset labels are formatted from provider-exposed timestamps only.
- Bottom band does not call raw quota methods directly.
- Five-hour reset uses 24-hour time.
- Weekly reset uses day of week plus 24-hour time.

Runtime defaults:

- Composer `Runtime default` clears only the next-turn override for that axis.
- Project/provider default semantics are labeled separately from composer
  override semantics.
- Service tier/speed choices appear only when provider settings projection
  exposes them.
- Access overrides remain next-turn scoped and authority-gated.

Validation:

- `npm run validate` passes.
- `npm run smoke` passes or any environment-only smoke limitations are recorded.
