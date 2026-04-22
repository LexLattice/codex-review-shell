# Thread Linking Spec

Status: implementation design spec for the middle-plane `Threads` workbench tab.

## Purpose

Define how the shell should discover, present, and link Codex and ChatGPT threads without trying to own either system's conversations.

The shell should own only project-local orchestration metadata:

- which Codex thread is relevant to a project lane
- which project-attached ChatGPT thread is relevant to a project lane
- which lane binding should open by default or was last active

It should not own thread contents, thread lifecycle, or thread persistence for either Codex or ChatGPT.

## Product doctrine

- Codex owns Codex threads.
- ChatGPT owns ChatGPT threads.
- This app owns project-aware thread references and lane bindings.
- The middle plane should expose thread linking as a clean dedicated work surface, not as another box in the existing crowded control tab.

## Middle-plane shape

Add a dedicated `Threads` tab in the middle plane.

That tab should enforce a hard vertical split:

- left half: Codex thread list
- right half: ChatGPT thread list

The split is important because it turns linking into a spatial operation rather than a form-driven one.

This tab should be treated as a clean workbench surface for thread orchestration during the build phase. It should not inherit the current stacked-card clutter of the main control view.

## Primary workflow

The primary workflow is not thread creation. It is thread linking.

The user should be able to:

1. choose a project
2. choose a lane
3. browse available Codex threads on the left
4. browse available ChatGPT threads on the right
5. create or update a lane binding by linking one Codex thread with one ChatGPT thread

The most natural gesture is drag and drop:

- drag a Codex thread onto a ChatGPT thread
- or drag a ChatGPT thread onto a Codex thread

The result should be:

- create a new lane binding for the active project
- or replace the existing binding for that lane after confirmation if one already exists

## Lane model

Generic pairings are not enough. The shell needs semantic lane bindings.

The first implementation should align with the repo's existing ChatGPT thread-role vocabulary:

- `review`
- `brainstorming`
- `architecture`
- `research`
- `debugging`
- `planning`
- `custom`

If the product later wants additional labels such as `design` or `implementation`, those should be introduced deliberately rather than as near-synonyms for the current role set.

Each project may have multiple lane bindings.

That matters because one repo may have:

- several Codex work threads on different modules
- several ChatGPT threads serving different functions

Example:

- a Codex work thread for one module
- a ChatGPT review thread for that module
- a ChatGPT brainstorming thread for that same module
- a ChatGPT proto-design thread for that same module

The shell should route lane-aware actions through these bindings.

Example:

- `Send for review` should target the ChatGPT thread that owns the project's `review` lane
- an architecture-oriented relay action should target the thread that owns the `architecture` lane

## Metadata ownership

The shell should store only lightweight references plus pairing metadata.

It should not duplicate or ingest full thread transcripts into project config.

### Project metadata

Each project should keep the current `chatThreads` registry and gain an additive `laneBindings` collection layered on top of it.

`chatThreads` remains the project-local lightweight ChatGPT thread registry.

`laneBindings` becomes the pairing and routing layer.

Suggested shape:

```json
{
  "chatThreads": [
    {
      "id": "thread_review_primary",
      "role": "review",
      "title": "Primary review",
      "url": "https://chatgpt.com/c/...",
      "notes": "Main review thread",
      "isPrimary": true,
      "pinned": true,
      "archived": false
    }
  ],
  "laneBindings": [
    {
      "id": "binding_review_primary",
      "lane": "review",
      "label": "Module A review",
      "codexThreadRef": {
        "threadId": "019d6fe7-d387-7792-8ead-787ddfd813e8",
        "originator": "Codex Desktop",
        "titleSnapshot": "Module A fix work",
        "cwdSnapshot": "/home/rose/work/LexLattice/odeu"
      },
      "chatThreadId": "thread_review_primary",
      "isDefaultForLane": true,
      "openOnProjectActivate": true,
      "lastActivatedAt": "2026-04-22T00:00:00.000Z",
      "status": "resolved",
      "createdAt": "2026-04-22T00:00:00.000Z",
      "updatedAt": "2026-04-22T00:00:00.000Z"
    }
  ],
  "lastActiveBindingId": "binding_review_primary"
}
```

### Important constraints

- The stored reference must be enough to reopen the thread later.
- Snapshot fields are advisory and may be stale.
- The source systems remain authoritative.
- If a referenced thread disappears, the binding should degrade gracefully and be shown as unresolved rather than silently deleted.
- `laneBindings` must not duplicate the existing `chatThreads` metadata model.
- If the user links a discovered ChatGPT thread that is not yet part of the project, the shell should first import or attach it into `chatThreads`, then bind the lane to that attached thread by id.

### Default semantics

The shell should not use one coarse `isDefault` flag for everything.

The model needs to distinguish between:

- default binding for a lane
- binding that should open when the project activates
- last active binding

Recommended fields:

- `isDefaultForLane`
- `openOnProjectActivate`
- `lastActivatedAt`
- project-level `lastActiveBindingId`

Suggested activation precedence:

1. explicit `lastActiveBindingId` if still resolvable
2. binding marked `openOnProjectActivate`
3. lane-specific default when the shell is opening a specific lane
4. current fallback behavior

## Project activation behavior

When the user selects a project from the project list, the shell should use lane-binding metadata to open the relevant conversations.

This must be phased against current repo capability.

ChatGPT already supports explicit thread switching in the current app.

Codex does not yet support opening or resuming a specific discovered thread from the left pane. The current Codex surface starts a fresh thread when it comes up.

So:

- ChatGPT thread activation can be part of the early implementation
- Codex thread activation must wait until the left pane supports selecting or resuming a specific thread

Early version:

- open the project's linked ChatGPT thread using the current project-local `chatThreads` model
- keep Codex references visible and bindable without promising left-pane restore yet
- otherwise fall back to the current unlinked/default behavior

Later version, after Codex resume support exists:

- load the linked Codex thread in the left pane
- load the linked ChatGPT thread in the right pane

## Codex side discovery

For now, the shell only needs to expose threads currently visible from:

- VS Code Codex usage
- Codex app or Codex Desktop usage

Codex thread discovery should be provided by a discovery adapter rather than hardcoded as one workstation-specific assumption.

Suggested concept:

- `CodexThreadSource`

The first implementation may read from the active WSL Codex session corpus in the current environment. Discovery roots should be environment- or config-driven rather than treated as a permanent product invariant.

Relevant source metadata already exists in stored session files, for example:

- `codex_vscode`
- `Codex Desktop`
- `codex_cli_rs`
- `codex_exec`
- `codex-tui`

For the first thread browser, the Codex side should show at least:

- thread title
- origin/source badge
- cwd or workspace hint
- recency

And it should filter or highlight the primary origins of interest:

- `codex_vscode`
- `Codex Desktop`

Important implementation boundary:

- Codex thread discovery is Phase A
- Codex thread activation is Phase B after explicit resume/open support exists in the left pane

## ChatGPT side discovery

The right pane already runs an authenticated ChatGPT web session inside Electron.

The shell should attempt to derive the ChatGPT thread list from that authenticated session while keeping the native ChatGPT sidebar hidden in the right pane.

That means:

- the right pane remains a clean chat surface
- the middle pane owns thread browsing and navigation

This is likely to be best-effort rather than official.

Two likely implementation paths:

- derive recent threads from the authenticated ChatGPT page state or DOM
- use the same authenticated browser session to call the internal conversation-list requests used by the ChatGPT web app

The first implementation should optimize for usefulness, not perfection.

The shell only needs enough metadata to let the user browse and link recent relevant ChatGPT threads.

Manual attach must remain a first-class fallback.

Even after discovery exists, the user should still be able to:

- paste a ChatGPT thread URL manually
- attach it into the project's `chatThreads`
- bind it to a lane

That preserves the current repo's manual attach/edit model and avoids making ChatGPT discovery a hard dependency.

## Threads tab UX

The `Threads` tab should have three conceptual areas:

- lane context
- Codex thread list
- ChatGPT thread list

### Lane context

The active lane should be explicit.

The user should be able to:

- pick an existing lane
- create a new custom lane
- see whether the selected lane is currently linked or unlinked

### Codex thread list

The left list should prioritize:

- recent threads
- likely relevant threads for the current workspace
- visible origin badges such as `VS Code` and `Desktop`

Suggested row fields:

- title
- origin badge
- cwd or workspace hint
- last updated time

### ChatGPT thread list

The right list should prioritize:

- recent threads
- likely relevant threads
- title and last activity

Suggested row fields:

- title
- last updated time
- url or source hint when useful

### Linking action

The primary linking gesture should be drag and drop.

Fallback actions should also exist:

- select left thread
- select right thread
- click `Link for lane`

### Existing bindings

The tab should also show the current project's existing lane bindings, for example as chips, rows, or a compact strip:

- `review`
- `brainstorming`
- `architecture`

Each binding should support:

- open
- relink
- unlink
- mark default

## Relation to current thread deck

The repo already has a project-bound ChatGPT thread deck in the middle plane.

The new `Threads` tab should not create a competing second thread-management system.

The convergence path should be:

- current Overview or control surfaces keep a compact summary of attached ChatGPT threads
- deeper thread attach, discovery, and lane-linking workflows move into the dedicated `Threads` tab
- over time, thread editing and binding workflows converge into the `Threads` workbench instead of being split across unrelated cards

The first implementation does not need to remove the existing thread deck immediately, but it should treat it as a compact summary surface rather than the long-term primary thread-linking workbench.

## Action routing

Lane bindings are not just organizational. They are routing metadata for shell actions.

Examples:

- `Send for review` resolves the active project's `review` lane and targets that ChatGPT thread
- an architecture handoff resolves the `architecture` lane
- a brainstorming relay resolves the `brainstorming` lane

If the required lane is missing:

- the shell should not guess silently
- it should prompt the user to choose or create a binding

## Failure handling

The shell should assume references can drift.

Examples:

- a Codex thread no longer exists
- a ChatGPT thread is no longer available
- the ChatGPT thread list cannot be fetched
- a stored title snapshot no longer matches current reality

In those cases:

- keep the binding record
- assign an explicit status
- allow relinking
- do not silently delete project metadata

Suggested binding statuses:

- `resolved`
- `missing_codex_thread`
- `missing_chatgpt_thread`
- `chatgpt_discovery_unavailable`
- `stale_snapshot`
- `manually_attached`

## Phased implementation

### Phase 1

- add a `Threads` tab to the middle plane
- hard-split the tab into Codex left and ChatGPT right
- keep current Overview and control surfaces intact
- read Codex threads through a discovery adapter
- show origin badges and recency
- on the ChatGPT side, use project-local `chatThreads` plus manual attach/import as the initial source of truth
- add project-local `laneBindings` metadata as an additive overlay

### Phase 2

- add ChatGPT recent-thread discovery from the authenticated web session
- support importing discovered ChatGPT threads into `chatThreads`
- support manual link creation, relinking, and unlinking
- support lane defaults and explicit last-active binding semantics
- support opening linked ChatGPT threads from lane activation

### Phase 3

- add drag and drop linking
- route lane-aware shell actions through binding resolution
- preserve manual ChatGPT attach as a supported fallback

### Phase 4

- add explicit Codex thread open or resume support in the left pane
- bind lane activation to left-pane Codex thread switching
- bind project activation to full Codex and ChatGPT pair restore

## Non-goals for early implementation

- owning or copying full thread transcripts into project config
- creating or deleting Codex threads from this tab
- creating or deleting ChatGPT threads from this tab
- fully replacing source-system thread management
- pretending Codex thread activation already exists before the left pane supports it
- solving every archived or historical edge case before recent-thread linking works

## Short version

The shell should add a dedicated `Threads` tab with a hard left-right split:

- left: Codex threads
- right: ChatGPT threads

The tab should let the user link threads by semantic lane per project.

The shell stores only lightweight pairing metadata on top of the existing project-local `chatThreads` model.

ChatGPT activation can happen earlier because the repo already supports it.

Codex activation must remain a later phase until the left pane supports opening or resuming a specific discovered thread.
