# Codex Surface Reload, History, Thought, And Markdown Spec

Status: implementation spec for a focused set of Codex surface UX/runtime fixes.

Related docs:

- [CODEX_SURFACE_PROJECT_RENDERING_SPEC.md](./CODEX_SURFACE_PROJECT_RENDERING_SPEC.md)
- [CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md](./CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md)
- [CODEX_RUNTIME_HEADER_DRAWER_SPEC.md](./CODEX_RUNTIME_HEADER_DRAWER_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [MIDDLE_PANE_WEB_TAB_SPEC.md](./MIDDLE_PANE_WEB_TAB_SPEC.md)

## Purpose

Define the implementation contract for five near-term Codex surface tweaks:

1. Reload Codex should restart the actual Codex runtime/executable and restore
   the active thread.
2. Empty reasoning items should not render inside Thought process.
3. Loading older transcript messages should preserve the latest visible messages.
4. The transcript expansion banner should support both incremental load and
   load-all.
5. Final assistant messages should receive a safe lightweight Markdown
   projection while preserving typed links/files.

These must be implemented as bounded artifacts, not scattered widget patches.

## Current Implementation Risks

Current `surface:reload("codex")` reloads the Codex surface but does not
guarantee the app-server process is restarted. In managed mode,
`loadCodexSurface()` can reuse the existing ready session when the runtime
descriptor key is unchanged.

Current thread restore evidence is also split:

- the Codex renderer emits `thread-state` with `threadId`, `sourceHome`,
  `sessionFilePath`, `title`, status, activation epoch, and evidence;
- the shell renderer keeps only opened thread id/title for successful open state;
- the main process does not retain a restore target for runtime restart.

Current history expansion rerenders from `state.historyData`, while live deltas
can exist only in DOM/state maps. A bulk rerender can therefore drop newer live
output if the render source is stale.

Current Thought process rendering creates DOM before filtering and falls back to
visible text such as `No reasoning text.`.

Current assistant-message rendering uses typed-token projection, but not
Markdown structure.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `CodexRuntimeReloadController` | support artifact | build | restart provider/runtime, preserve restore evidence, no binding mutation |
| `CodexThreadRestoreTargetStore` | support artifact | build | last successful and in-flight thread restore evidence |
| `ThoughtItemProjection` | support artifact | build | filter empty thought items without dropping tool evidence |
| `TranscriptHistoryWindowModel` | support artifact | build | lower-bound expansion without upper-bound loss |
| `TranscriptLoadExpansionControls` | surface artifact | build | load 10 more / load all transcript affordance |
| `AssistantMarkdownProjection` | support artifact | build | safe final-answer Markdown projection with typed-token preservation |

## 1. Codex Runtime Reload

Do not overload generic surface reload further.

Keep this distinction:

```text
surface:reload("codex")
  reload current webcontents/surface

codex:reload-runtime
  restart provider/runtime executable and restore active thread
```

Recommended bridge:

```ts
workspaceShell.reloadCodexRuntime(options?)
ipcMain.handle("codex:reload-runtime", ...)
```

### Restore Target

Main process should own restore evidence:

```ts
type CodexThreadRestoreTarget = {
  projectId: string;
  threadId: string;
  sourceHome: string;
  sessionFilePath: string;
  title: string;
  status:
    | "requested"
    | "dispatched"
    | "rendered_stored"
    | "attached_live"
    | "failed";
  evidence: string;
  activationEpoch: number;
  observedAt: string;
  usableForRestore: boolean;
};
```

Maintain:

```ts
lastSuccessfulCodexThreadByProject: Map<string, CodexThreadRestoreTarget>
latestCodexOpenTargetByProject: Map<string, CodexThreadRestoreTarget>
latestCodexThreadFailureByProject: Map<string, CodexThreadRestoreTarget>
```

Do not let a later `failed` event erase the last successful restore target.
A common successful fallback sequence is:

```text
rendered_stored
failed live attach
```

The stored render is still usable for restore.

### Restore Priority

```text
1. last successful thread-state for current project:
   attached_live first, rendered_stored second

2. latest in-flight open target:
   requested/dispatched, only if newer than last success and representing the
   currently selected/opening Codex thread

3. renderer restore hint:
   opened/selected Codex thread, including sourceHome/sessionFilePath when
   available

4. active project lane binding codexThreadRef:
   read-only fallback only; do not call project activation binding logic

5. no restore:
   restart runtime and load empty/ready Codex surface
```

### Transition

```text
ReloadCodexRuntime
  -> capture restore target
  -> read fresh current project from saved config by projectId
  -> allocate new activationEpoch
  -> close/mark pending server requests as connection-closed
  -> dispose CodexSurfaceSession
  -> dispose CodexAppServerManager
  -> start app-server from current persisted provider/binary config
  -> load Codex surface with initialThreadId/sourceHome/sessionFilePath/title
  -> renderer performs normal stored render + live attach
  -> renderer emits thread-state evidence
  -> shell reports reload result from thread-state evidence
```

### Edges

- Managed mode restarts the executable/app-server.
- URL and fallback modes do not pretend an executable was restarted; they should
  disable runtime reload or degrade to plain surface reload with explicit copy.
- Future `direct_oai` provider reload must not silently route through the Codex
  executable provider when unavailable.
- Active turns or pending approvals need a warning because runtime restart will
  terminate the current runtime session.
- Pending approval/request cards become `connection-closed` or
  `runtime-restarted`, not pending.
- Reload uses current persisted runtime/provider config but does not mutate lane
  bindings.
- Restore source home should be used when available; otherwise use project
  default Codex home.
- Startup failure should still load degraded local surface with restore target
  so stored transcript fallback can render.

Acceptance:

- Updating the `codex` executable then pressing Reload uses the new executable.
- Same thread reopens after reload when `threadId` is known.
- Stored transcript fallback can render even when live attach fails.
- A later failed live attach does not erase the last stored/live restore target.
- Stale thread-state events from the old surface are ignored by activation epoch.

## 2. Thought Item Projection

Current rendering creates the Thought process node before filtering and uses
fallback content for empty reasoning.

Add projection helpers:

```ts
function normalizeThoughtItemBody(item): string;
function shouldRenderThoughtItem(item): boolean;
function projectThoughtItemsForRender(items): {
  reasoningItems: CodexItem[];
  toolItems: CodexItem[];
  otherItems: CodexItem[];
  visibleCount: number;
};
```

Rules:

- Empty reasoning body is omitted.
- Empty commentary-phase assistant thought is omitted.
- Body equal to `No reasoning text.` is treated as empty sentinel text.
- Whitespace-only body is empty.
- Structured content arrays should extract string/text fields before deciding
  emptiness.
- Tool-like items remain visible even with sparse body because their
  identity/status is evidence.
- Filtering happens before `ensureMessage()` creates a Thought process node.
- If no visible items remain, remove any existing Thought process node for that
  turn.
- Pending scheduled thought renders must also use the filtered projection.

Acceptance:

- No visible `No reasoning text.` inside Thought process.
- Empty reasoning-only turns do not create empty Thought process boxes.
- Streaming thoughts appear only when content becomes renderable.
- Tool calls remain visible as collapsed evidence.

## 3. Transcript History Window Model

Replace the single pagination counter with an explicit window model.

```ts
type HistoryWindowMode = "tail" | "expanded" | "all";

type HistoryWindowState = {
  logicalThreadKey: string;
  mode: HistoryWindowMode;
  loadedUserMessagePages: number;
  renderRevision: number;
};

type TranscriptRenderSource = {
  threadId: string;
  storedSnapshot?: StoredTranscriptSnapshot;
  liveThread?: CodexThread;
  liveOverlayTurns: CodexTurn[];
  upperWatermark: string;
  updatedAt: string;
};
```

Use a logical thread key such as `thread:<threadId>`, not separate
`stored:<threadId>` and `thread:<threadId>` keys, so stored-to-live attach for
the same thread preserves expansion mode.

Invariant:

```text
History expansion changes only the lower bound.
The upper bound is monotonic and must include latest known stored, live, and
overlay items.
```

Before bulk rerender:

```text
refresh thread/read if connected and supported
refresh stored transcript if needed
merge refreshed base with live overlay
compute lower bound from HistoryWindowState
render lower bound through latest known upper bound
```

If refresh fails, keep the newest known source and live overlay.

Split current clearing semantics:

```ts
clearRenderedDomState()
resetThreadSessionState()
```

Load-more should clear rendered DOM and DOM maps, but must not wipe durable live
overlay, prompt retry state, active-turn state, or server-request state unless a
different thread opens.

Acceptance:

- Stored-to-live attach for the same thread preserves expansion mode/pages.
- Load-more/load-all does not clear active turn state, prompt retry state, live
  overlay state, or server-request state.
- Refetch failure does not drop newer local/live items.
- A render revision prevents stale bulk renders from affecting a newly opened
  thread.

## 4. Transcript Load Expansion Controls

Use a transcript history expansion banner, not the runtime top header.

```text
[ N older user messages hidden ] [ Load 10 more ] [ Load all ]
```

Behavior:

- `Load 10 more` sets mode to `expanded` and increments
  `loadedUserMessagePages`.
- `Load all` sets mode to `all` and renders all currently known transcript
  entries.
- If refetch succeeds before render, `all` includes refreshed source.
- If refetch fails, `all` means newest local source plus live overlay.
- `Load all` uses render revision so a thread switch cancels stale work.
- For very large transcripts, show `Rendering all...` or chunk the render.
- After `Load all`, hide the banner for that logical thread.
- Switching thread resets mode to `tail`.

Layout:

```css
.transcript-load-more {
  display: flex;
  flex-wrap: wrap;
  max-width: min(860px, 95%);
}

.transcript-load-more-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

Acceptance:

- Latest messages remain after `Load 10 more`.
- `Load all` renders all currently known transcript content.
- Stored-to-live attach does not collapse an expanded transcript.
- The banner does not create horizontal overflow in narrow panes.

## 5. Assistant Markdown Projection

Boundary:

```text
AssistantMarkdownProjection is a renderer projection for final assistant
messages.

It is not a general Markdown renderer for tool output, command output, thought
body, approval cards, or request cards.
```

Integration:

```ts
function setMessageText(id, role, text, title = "") {
  if (role === "assistant") {
    renderFinalAssistantContent(bubble, text);
  } else {
    renderTypedContent(bubble, text);
  }
}
```

Streaming:

```text
item/agentMessage/delta
  -> append plain text while streaming

turn/completed
  -> finalizeMessageTypedContent(finalAssistantId)
  -> for assistant final: renderFinalAssistantContent()
```

Stored final assistant messages can render through Markdown projection
immediately.

Parser order:

```text
Block parser:
  fenced code
  headings
  blockquotes
  lists
  dividers
  semantic chains
  paragraphs

Inline parser:
  markdown links
  inline code
  bold
  italic
  arrows
  raw URLs / files / line refs through existing typed-token tokenizer
```

Supported v0 markers:

~~~text
```fences```       -> styled code block with optional language label
`inline code`      -> inline code pill
# / ## headings    -> compact heading styling
**bold**           -> strong text
*italic*           -> subtle italic text
- / * bullets      -> styled list markers
1. ordered lists   -> styled ordered markers
> blockquotes      -> left-border quote block
---                -> divider when whole trimmed line
[label](url)       -> safe clickable URL token
-> / =>            -> semantic arrow token
[x] / [ ]          -> visual task marker, not interactive checkbox
~~~

For semantic chains:

```text
semantic intent contract
-> provider capability/profile/event/evidence obligations
-> direct runtime/harness spec
```

Render arrows distinctly:

```text
semantic intent contract
→ provider capability/profile/event/evidence obligations
→ direct runtime/harness spec
```

No authority semantics are inferred from arrows.

Security and compatibility:

- Raw HTML renders as text.
- Do not use `innerHTML`.
- `javascript:`, `data:`, `file:`, and custom-protocol Markdown links are inert.
- Markdown links call the same safe typed URL path as raw URLs.
- Unclosed code fences render safely through EOF or degrade to text.
- Headings apply only at line start.
- `*italic*` must not break bullet parsing.
- Nested Markdown support is intentionally shallow in v0.
- Project/file typed tokens still work outside code fences.
- Do not tokenize inside code fences in v0.
- Copy should use `bubble.dataset.rawText` as original source.

Acceptance:

- Markdown projection applies to final assistant messages only.
- Streaming assistant deltas remain plain until finalization.
- Existing clickable files/links still work.
- Raw HTML is inert text.
- Invalid or unsafe links are inert.
- Code fences are readable and cannot inject markup.

## Implementation Order

1. Add `CodexThreadRestoreTargetStore` and `CodexRuntimeReloadController`.
2. Wire `codex:reload-runtime`; leave `surface:reload` as plain surface reload.
3. Add `ThoughtItemProjection` and filter before DOM creation.
4. Add `TranscriptHistoryWindowModel` and split DOM clearing from thread-state
   clearing.
5. Add `TranscriptLoadExpansionControls`.
6. Add `AssistantMarkdownProjection` for final assistant messages only.
7. Add focused smoke checks for restore, filtering, pagination, and Markdown
   safety.

## Overall Acceptance Criteria

- Runtime reload is a provider/runtime transition, not a webcontents reload.
- Reload uses fresh persisted project config and a new activation epoch.
- Pending approvals/requests are visibly closed or marked connection-closed.
- Empty thought items do not create empty Thought process boxes.
- Transcript expansion never drops newer known items.
- Load all renders all currently known content and hides the expansion banner.
- Markdown projection is safe, final-answer-scoped, and preserves typed-token
  actions.
