# Workflow Transition Graph Spec

Status: ODEU implementation spec for canonical workflow transitions in `codex-review-shell`.

## Purpose

Define the shell's workflow topology as explicit objects, evidence, lawful transitions, and code artefacts.

The goal is to prevent future fixes from being driven by scattered UI symptoms. A user-facing affordance should bind to an existing canonical transition whenever it intends the same semantic effect. New code should be introduced only when the ODEU map shows that the required canonical object or transition does not yet exist.

## Proof Case

The project activation bug exposed the missing transition map.

Two actions looked similar:

- click a Codex thread in the Threads tab
- click a project that has a linked Codex thread

They were not equivalent in code because project metadata did not always carry enough Codex identity to enter the same transition path as manual thread selection.

Correct semantic transition:

```text
Project.click(projectId)
  -> ActivateProject(projectId)
  -> resolve active LaneBinding
  -> resolve ChatGPTThread binding
  -> resolve CodexThread binding
  -> SelectChatGPTThread(projectId, chatThreadId)
  -> SelectCodexThread(projectId, threadId, sourceHome, sessionFilePath)
  -> update banners from successful runtime state
```

Anti-pattern:

```text
Project.click(projectId)
  -> update selected project state
  -> update labels
  -> infer that the Codex surface is now on the linked thread
```

## ODEU Model

### Objects

`Project`

- Persistent project binding for one workspace.
- Owns ChatGPT thread references and lane bindings.
- Current storage: `workspace-config.json`, `projects[]`.

`ChatGPTThread`

- Lightweight project-local reference to a ChatGPT conversation URL.
- Current storage: `projects[].chatThreads[]`.
- Runtime opening is URL-based.

`CodexThread`

- Discovered Codex session/thread metadata.
- Runtime identity must include at least `threadId`; cross-home replay also needs `sourceHome` and preferably `sessionFilePath`.
- Current evidence source: `codex-threads:list` discovery and transcript files owned by Codex homes.

`LaneBinding`

- Project-local semantic pairing between one Codex thread ref and one project ChatGPT thread.
- Current storage: `projects[].laneBindings[]`.
- Required fields:

```ts
type LaneBinding = {
  id: string;
  lane: "review" | "architecture" | "brainstorming" | "research" | "debugging" | "planning" | "custom";
  label: string;
  codexThreadRef: CodexThreadRef;
  chatThreadId: string;
  isDefaultForLane: boolean;
  openOnProjectActivate: boolean;
  lastActivatedAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};
```

`CodexThreadRef`

```ts
type CodexThreadRef = {
  threadId: string;
  originator?: string;
  titleSnapshot?: string;
  cwdSnapshot?: string;
  sourceHome?: string;
  sessionFilePath?: string;
};
```

`SurfaceSession`

- Runtime state for the embedded left/right panes.
- ChatGPT surface is URL-loaded.
- Codex surface is app-server-backed and receives `open-thread-request` shell events.
- Codex surface must report thread-open state back to the shell before the shell treats a Codex thread as active truth.

`ActivationEpoch`

- Main-process generation id for project/surface activation.
- Prevents late BrowserView loads from older project selections from mutating active surface truth.
- Every `ActivateProject`-created surface load should carry the active epoch.

`ThreadDiscoveryRecord`

- Addressable discovered thread record.
- Must not be confused with persisted project binding.
- Discovery can be stale or unavailable; bindings degrade rather than disappear.

`ThreadAnalyticsSnapshot`

- Derived, cached analytic facts about Codex threads.
- Current storage: `thread-analytics.sqlite`.
- Must not become authoritative thread identity.

`CodexRuntimeCapabilityProfile`

- First-class profile for the attached Codex executable and app-server protocol.
- It decides which UX affordances are lawful to expose.
- It must support vanilla Codex and custom fork extensions.

Suggested shape:

```ts
type CodexRuntimeCapabilityProfile = {
  executableIdentity: {
    binaryPath: string;
    resolvedPath?: string;
    codexVersion?: string;
    forkName?: string;
    commitSha?: string;
  };
  protocolVersion: {
    appServer?: string;
    schemaGeneratedAt?: string;
    schemaSource: "generated" | "bundled" | "unknown";
  };
  transports: {
    websocket: boolean;
    stdio: boolean;
    remoteAuth: boolean;
  };
  serverRequests: string[];
  threadOperations: {
    list: boolean;
    read: boolean;
    resume: boolean;
    openById: boolean;
    openBySessionFile: boolean;
    persistExtendedHistory: boolean;
  };
  contentItemTypes: string[];
  approvalModes: string[];
  forkExtensions: Record<string, unknown>;
  securityConstraints: {
    bearerOverLoopbackOnly: boolean;
    safeFileRoots: string[];
  };
};
```

### Evidence

Evidence is the source that permits a transition.

- `workspace-config.json` proves selected project, project thread refs, and lane bindings.
- `codex-threads:list` proves currently discovered Codex threads.
- `codex-thread:transcript` proves read-only transcript renderability.
- `codex:select-thread` result proves a runtime thread-open request was accepted, not that the thread rendered.
- `codex-surface:thread-state` proves whether the Codex surface rendered stored transcript, live-attached, or failed.
- `chatgpt:select-thread` result proves project ChatGPT active thread was persisted and URL loaded.
- `codex-surface:event` with `open-thread-request` proves the main process requested a Codex surface transition.
- `app-server` schema/capability profile proves whether a UX action is supported by the attached Codex executable.
- `thread-analytics.sqlite` proves analytics were computed from a specific fingerprint.

### Codex Thread Evidence Ladder

Do not collapse request acceptance, rendering, and live attachment into one state.

```text
requested:
  main process accepted SelectCodexThread

dispatched:
  shell sent or encoded an open-thread-request for the Codex surface

rendered_stored:
  Codex surface rendered stored transcript for threadId/sourceHome

attached_live:
  Codex surface successfully read/resumed the thread through app-server

failed:
  requested thread could not be rendered or attached
```

Recommended surface-to-shell event:

```ts
type CodexSurfaceThreadState = {
  projectId: string;
  threadId: string;
  sourceHome?: string;
  sessionFilePath?: string;
  status: "requested" | "dispatched" | "rendered_stored" | "attached_live" | "failed";
  title?: string;
  evidence?: string;
  error?: string;
  at: string;
};
```

Banner and active-thread truth should update from `rendered_stored` or `attached_live`, not merely from `requested`.

### Deontic Rules

- UI labels must follow successful runtime transitions; labels must not substitute for runtime state.
- A project activation with an openable `LaneBinding` must use the same canonical thread-selection paths as manual thread clicks.
- `initialThreadId` in the Codex surface payload is a startup/render hint.
- `codex:select-thread` is the canonical `SelectCodexThread` transition edge.
- Active Codex-thread truth must update only after Codex surface render/live-attach evidence.
- Persistent bindings must store enough identity to replay the transition later.
- Discovery records are evidence, not authority. A missing discovered record marks a binding unresolved; it does not delete the binding.
- A UX affordance must be hidden, disabled, or degraded unless the `CodexRuntimeCapabilityProfile` confirms the capability.
- New UI affordances must not duplicate transition logic. They should call canonical transition functions.
- Config saves may create/update bindings. Mere transient selection must not create durable bindings unless the user uses an explicit save/create action.
- Runtime capability must not be inferred from old config flags alone.
- Main-process surface loads must be guarded by an activation epoch so stale project activations cannot overwrite newer BrowserView state.

### Utility

The user wants the shell to restore and coordinate a dual-partner working context.

Therefore:

- project click should restore both lanes when bindings exist
- manual thread click should focus one lane without silently mutating project bindings
- project creation/edit should be able to bind both partners explicitly
- thread analytics should be derived from real thread evidence, cached, and refreshed only when fingerprints change
- fork-specific Codex capabilities should surface as explicit, safe UX affordances

## Canonical Transition Map

### `ActivateProject`

User affordance:

- Project list row click.

Renderer entry:

- `selectProject(projectId)` in `src/renderer/app.js`.

Preload/IPC:

- `bridge.selectProject(projectId)`
- `ipcMain.handle("project:select")`

Main process:

- `applyProjectActivationBinding(project)`
- `loadProjectSurfaces(project, binding)`
- `loadChatgptSurface(project, threadId)`
- `codexSurfaceOptionsForBinding(binding)`
- `loadCodexSurface(project, codexOptions)`

Canonical commitment edge:

- `initialThreadId` in `codexOptions` is only a startup hint.
- The canonical Codex thread-open transition remains `SelectCodexThread`.
- If the startup hint opens the thread successfully, the Codex surface must emit thread-state evidence.

Renderer follow-up:

- `openProjectCodexBinding(project, activationBinding, snapshot)`

Storage read/write:

- `selectedProjectId`
- `projects[].activeChatThreadId`
- `projects[].lastActiveThreadId`
- `projects[].lastActiveBindingId`
- `projects[].laneBindings[].lastActivatedAt`

Success evidence:

- `project:select` returns `activationBinding`.
- ChatGPT surface loads bound URL.
- Codex surface emits `rendered_stored` or `attached_live` for the bound thread.

Rule:

- `ActivateProject` may update banners only as a consequence of resolved project, binding, and runtime transition state.
- `ActivateProject` must carry an activation epoch through main-process surface loading and renderer follow-up. Late completions from older epochs must be ignored.

### `SelectChatGPTThread`

User affordance:

- Project ChatGPT thread row click.
- Project activation when binding has `chatThreadId`.

Renderer entry:

- `selectThread(threadId)` in `src/renderer/app.js`.

Preload/IPC:

- `bridge.selectChatThread(projectId, threadId)`
- `ipcMain.handle("chatgpt:select-thread")`

Main process:

- validate thread exists and is not archived
- update active thread ids
- `loadChatgptSurface(project, thread.id)`

Storage read/write:

- `projects[].chatThreads[].lastOpenedAt`
- `projects[].activeChatThreadId`
- `projects[].lastActiveThreadId`

Success evidence:

- IPC returns `{ config, project, thread }`.
- ChatGPT surface URL changes to the selected thread URL.

Rule:

- ChatGPT thread selection is URL-based and project-local. It must not create Codex bindings.

### `SelectCodexThread`

User affordance:

- Codex thread row click in Threads tab.
- Project activation when binding has `codexThreadRef`.

Renderer entry:

- `selectCodexThread(threadId, sourceHome, sessionFilePath)` in `src/renderer/app.js`.
- `openProjectCodexBinding(project, binding, snapshot)` for project activation.

Preload/IPC:

- `bridge.selectCodexThread(projectId, threadId, sourceHome, sessionFilePath)`
- `ipcMain.handle("codex:select-thread")`

Main process:

- `requestCodexThreadOpen(projectId, threadId, sourceHome, sessionFilePath)`
- `ensureCodexAppServerManager().ensureForProject(project, { codexHome })`
- `loadCodexSurface(project, { initialThreadId, initialThreadSourceHome, initialThreadSessionFilePath })`
- send `codex-surface:event` with `type: "open-thread-request"`

Codex surface:

- `handleBridgeEvent(event)`
- `openThreadFromEvent(event)`
- app-server `thread/read`/resume path, with transcript fallback where needed

Storage read/write:

- no project binding is created by transient manual selection
- renderer state tracks `selectedCodexThreadId`, `openedCodexThreadId`, `openedCodexThreadTitle`
- durable identity comes from `LaneBinding.codexThreadRef` only when saved explicitly

Success evidence:

- `codex:select-thread` returning `{ ok: true, threadId, sourceHome }` means requested.
- `codex-surface:event` delivery or startup payload means dispatched.
- `codex-surface:thread-state` with `rendered_stored` or `attached_live` means user-visible success.

Rule:

- All affordances that open a Codex thread must terminate in this transition. Do not duplicate app-server reload/home-switch logic elsewhere.

### `CreateOrUpdateProjectBinding`

User affordance:

- New project drawer save.
- Edit project drawer save.

Renderer entry:

- `projectFromForm()`
- `handleProjectFormSubmit(event)`

Canonical sub-steps:

- resolve selected ChatGPT dropdown or URL into a primary `ChatGPTThread`
- resolve selected Codex dropdown into `CodexThreadRef`
- upsert default/open `LaneBinding` when Codex is selected
- clear primary Codex binding when the user chooses no Codex binding
- save config
- call `selectProject(project.id)`

Storage read/write:

- `projects[].chatThreads[]`
- `projects[].activeChatThreadId`
- `projects[].lastActiveThreadId`
- `projects[].laneBindings[]`
- `projects[].lastActiveBindingId`

Success evidence:

- saved project contains both `chatThreads[]` and `laneBindings[]`
- subsequent `ActivateProject` opens both planes

Rule:

- Project creation/edit is allowed to persist a binding. Normal thread browsing is not.

### `CreateOrUpdateLaneBinding`

User affordance:

- Threads workbench `Link selected threads`.

Renderer entry:

- `saveLaneBinding()`

Storage read/write:

- `projects[].laneBindings[]`
- `projects[].lastActiveBindingId`

Canonical fields:

- `codexThreadRef.threadId`
- `codexThreadRef.originator`
- `codexThreadRef.titleSnapshot`
- `codexThreadRef.cwdSnapshot`
- `codexThreadRef.sourceHome`
- `codexThreadRef.sessionFilePath`
- `chatThreadId`
- `isDefaultForLane`
- `openOnProjectActivate`

Success evidence:

- lane binding appears in Threads workbench
- project activation can replay the binding

Rule:

- This transition composes two selected references into a project-local relation. It does not own source thread contents.

### `DiscoverCodexThreads`

User affordance:

- Refresh Codex in Threads tab.
- App/project load refresh.

Renderer entry:

- `loadCodexThreads()`

Preload/IPC:

- `bridge.listCodexThreads(projectId)`
- `ipcMain.handle("codex-threads:list")`

Main process:

- `listCodexThreads(projectId)`
- workspace backend discovery, with fallbacks

Storage read/write:

- no project config mutation
- discovery results may feed analytics cache

Success evidence:

- `state.codexThreads` contains addressable records
- records include `threadId`, `sourceHome`, `sessionFilePath` when available

Rule:

- Discovery records can satisfy or enrich a binding, but cannot replace persisted binding authority.

### `DiscoverChatGPTThreads`

User affordance:

- Refresh recent ChatGPT threads.
- Project drawer ChatGPT dropdown.

Renderer entry:

- `loadChatgptRecentThreads({ refresh })`

Preload/IPC:

- `bridge.listCachedChatgptRecentThreads(limit)`
- `bridge.listChatgptRecentThreads(limit, { refresh })`
- `ipcMain.handle("chatgpt:cached-threads")`
- `ipcMain.handle("chatgpt:recent-threads")`

Storage read/write:

- `chatgpt-thread-cache.json`
- project config only changes if user imports/selects/saves

Success evidence:

- recent/project ChatGPT threads appear in right thread browser and project drawer dropdown

Rule:

- ChatGPT discovery is evidence for attaching/importing threads; it is not a project binding until saved.

### `RenderCodexThread`

User affordance:

- Selecting a Codex thread.
- Project activation.
- Codex surface reload with initial thread hints.

Bridge event:

- `codex-surface:event` with:

```ts
type OpenThreadRequest = {
  type: "open-thread-request";
  threadId: string;
  sourceHome?: string;
  sessionFilePath?: string;
  title?: string;
  at: string;
};
```

Codex surface entry:

- `handleBridgeEvent(event)`
- `openThreadFromEvent(event)`

Canonical behavior:

- render stored transcript quickly when available
- attach live app-server session in parallel when possible
- switch Codex home when `sourceHome` requires it
- avoid requiring a second click after home switch

Rule:

- Rendering a thread and activating Codex runtime are separable, but the UX should attempt both when capability permits.
- A stored transcript render may satisfy visibility, but only app-server read/resume evidence satisfies live attachment.

### `AttachCodexRuntime`

User affordance:

- Project activation.
- Codex surface load/reload.
- Selecting a Codex thread that requires another `CODEX_HOME`.

Main process:

- `CodexAppServerManager.ensureForProject(project, options)`
- `codex app-server --listen ws://127.0.0.1:PORT`
- `CodexSurfaceSession.connect(connection)`

Capability requirement:

- produce or retrieve `CodexRuntimeCapabilityProfile`
- expose only confirmed transport, thread, approval, content, and fork-extension features

Current storage:

- runtime options in `projects[].surfaceBinding.codex`
- transient active connection in main process

Target storage/cache:

- local derived capability cache keyed by executable identity and version
- generated schema path or schema metadata, not raw secrets

Rule:

- Runtime capability is a first-class evidence object. UX must not infer fork capabilities from project name, thread source, or stale flags.

## Transition Capability Matrix

This matrix bridges workflow topology and Codex runtime capability evidence.

| Transition | Required capability/evidence | Degraded behavior |
| --- | --- | --- |
| `ActivateProject` | project config, resolvable `LaneBinding`, active `ActivationEpoch` | Select project and ChatGPT lane; show unresolved Codex binding if Codex evidence is missing. |
| `SelectCodexThread` | `threadId`; read-only render requires transcript evidence; live attach requires `thread/read` or `thread/resume`; cross-home open requires `sourceHome` support | Keep current Codex pane if no render evidence; show unresolved binding/status diagnostic. |
| `SelectChatGPTThread` | project-local `ChatGPTThread.url` | Keep project selected; show ChatGPT thread invalid/unloadable status. |
| `RenderCodexThread` | transcript parser or app-server thread read/resume | Render stored transcript when live attach fails; disable composer unless live app-server capability exists. |
| `StartCodexTurn` | existing live thread plus `turn/start`, or `thread/start` plus `turn/start`; model/reasoning authority allowed by profile | Disable composer with capability diagnostic. |
| `RespondToCodexServerRequest` | supported server request method and schema-verified response shape | Show diagnostic and send unsupported JSON-RPC error for unknown methods. |
| `UpdateThreadAnalytics` | discovered thread with stable `threadKey` and transcript fingerprint | Mark thread unavailable or stale; do not mutate project binding. |
| `AttachCodexRuntime` | transport evidence, initialize success, schema/capability profile | Keep read-only surface available when transcript evidence exists; disable live actions. |

### `RespondToCodexServerRequest`

User affordance:

- Approval/input/request card in Codex surface or middle-plane pending queue.

Preload/IPC:

- `bridge.respondCodexRequest(key, result)`
- `ipcMain.handle("codex:respond-request")`
- `bridge.focusCodexRequest(key)`
- `ipcMain.handle("codex:focus-request")`

Main process:

- `findCodexSurfaceSessionForRequest(requestKey)`
- `CodexSurfaceSession.respondServerRequest(requestKey, result)`

Storage:

- pending request registry is main-process runtime state
- future diagnostic history may be persisted separately

Rule:

- Server requests are connection-scoped. Pending request identity must include connection id plus request id.

### `UpdateThreadAnalytics`

User affordance:

- Analytics tab update button.
- Selecting a thread in analytics tab.

Preload/IPC:

- `thread-analytics:list`
- `thread-analytics:update`
- `thread-analytics:detail`

Main process:

- `listThreadAnalytics(projectId)`
- `updateThreadAnalytics(projectId, { scope })`
- `getThreadAnalyticsDashboard(projectId, threadKey)`

Storage:

- `thread-analytics.sqlite`

Canonical key:

- `buildThreadKey(sourceHome, threadId)`

Rule:

- Analytics may cache derived facts. It must update only when a real fingerprint changes or a new thread appears.

## Storage Map

### `workspace-config.json`

Authoritative for:

- selected project
- project workspace
- surface binding config
- project-local ChatGPT thread refs
- lane bindings
- active/default binding ids
- watched artifact and handoff metadata

Not authoritative for:

- Codex transcript contents
- ChatGPT transcript contents
- runtime app-server capability
- analytics facts

### `chatgpt-thread-cache.json`

Authoritative for:

- last discovered ChatGPT recent/project thread list cache

Not authoritative for:

- project binding membership
- ChatGPT conversation contents

### `thread-analytics.sqlite`

Authoritative for:

- computed analytics snapshots and fingerprints

Not authoritative for:

- current runtime thread selection
- project lane binding identity

### Codex transcript/session files

Authoritative for:

- historical Codex thread content
- thread metadata that Codex owns

Not authoritative for:

- project-level semantic lane binding unless copied into `CodexThreadRef`

### Codex runtime capability cache

Target future storage:

- generated schema metadata
- executable/version identity
- supported method/type lists
- fork extension flags

Not allowed:

- raw bearer tokens
- unverifiable claims copied from UI config

## Capability Profile Rules

The `CodexRuntimeCapabilityProfile` should gate these UX classes:

- thread list/read/resume/open
- live turn rendering
- server-initiated approvals and input requests
- content item rendering types
- fork-specific extended metadata
- analytics source availability
- remote auth and transport choices

Derivation order:

1. Generated app-server schema for the active executable.
2. Runtime app-server initialize/capability response.
3. Known bundled schema for a pinned executable version.
4. Conservative unknown profile.

Unknown profile behavior:

- keep basic project/chat thread UX available
- disable fork-only affordances
- expose diagnostics that capability is unknown
- never auto-enable approval/input/extension flows

## Canonical Code Artefact Direction

The current code already has canonical functions, but the topology is still implicit. The target refactor is to make transition boundaries explicit.

Suggested future module:

```text
src/renderer/workflow-transitions.js
```

Suggested exports:

```ts
activateProject(projectId): Promise<ProjectActivationResult>;
selectChatgptThread(projectId, threadId): Promise<ChatThreadSelectionResult>;
selectCodexThread(projectId, ref: CodexThreadRef): Promise<CodexThreadSelectionResult>;
upsertLaneBinding(projectId, bindingDraft): Promise<LaneBinding>;
resolveActivationBinding(project): LaneBinding | null;
resolveCodexThreadRef(binding, discovery): CodexThreadRefResolution;
```

Suggested future main-process module:

```text
src/main/workflow-transitions.js
```

Main-process responsibilities:

- config mutation
- BrowserView load/reload
- Codex app-server lifecycle
- capability-profile derivation
- request-scoped evidence and diagnostics

Renderer responsibilities:

- user intent capture
- optimistic UI selection only when clearly marked transient
- calling canonical bridge transitions
- rendering transition result or unresolved state

## Acceptance Criteria

- A project with a valid open-on-activate lane binding opens both ChatGPT and Codex through canonical selection paths.
- Manual Codex thread clicks and project activation use the same `codex:select-thread` transition when a runtime switch is needed.
- New/edit project save can persist both ChatGPT and Codex sides of the binding.
- Clearing the Codex dropdown removes the primary project Codex binding instead of leaving stale activation state.
- Banners and active labels update from resolved state, not from isolated label writes.
- Codex active-thread banners update only after `rendered_stored` or `attached_live` evidence.
- Overlapping project activations cannot let an older surface load overwrite a newer project selection.
- Unsupported Codex executable capabilities are hidden/disabled from the UX.
- The docs map every user-facing thread/project affordance to a function, IPC channel, and storage field.

## Validation Checklist

- `npm run validate`
- `npm run smoke`
- create a project while a ChatGPT and Codex thread are selected, then click the project and verify both panes switch
- edit a project to change only the Codex thread, then verify project activation replays the new `CodexThreadRef`
- clear the Codex thread in edit mode and verify project activation no longer switches the Codex pane
- rapidly switch projects and verify stale activation epochs cannot overwrite the visible panes
- verify `codex-surface:thread-state` distinguishes requested, stored-rendered, live-attached, and failed states
- run with a vanilla Codex executable and verify fork-only affordances are not exposed unless capability evidence exists
- run with the custom fork and verify capability-profile diagnostics show the fork extensions that the UX uses

## Non-Goals

- No generic ontology editor.
- No ownership of ChatGPT or Codex transcript persistence.
- No automatic creation of project bindings from transient browsing.
- No auto-approval rules.
- No fork-specific UX without capability evidence.
