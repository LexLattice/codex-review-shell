# Codex Review Shell ODEU Profile

Authority layer: support / architecture draft.

Grounding:

```text
/home/rose/work/LexLattice/odeu/docs/support/principled_recursive_odeu_meta_program_experimental_v46.md
/home/rose/work/LexLattice/odeu/docs/support/general_program_ontology_derived_v1_7.md
```

This document adapts the ODEU meta-program and General Program Ontology to the
`codex-review-shell` app. It is not a replacement for the upstream ODEU docs.
It is the local profile that says which ontology branches matter for this app,
which state objects own runtime truth, and which gates should block unsafe UI
or implementation shortcuts.

## Core Thesis

`codex-review-shell` is not one renderer wrapped around two chat panes. It is a
multi-surface workbench that coordinates runtime truth, transcript evidence,
project resources, ChatGPT handoffs, sub-agent graphs, browser/file viewports,
and local workspace authority.

The app should therefore be treated as a stateful interactive program with
explicit state objects and projections:

```text
runtime/provider evidence
  -> normalized state objects
  -> surface projections
  -> user actions
  -> main-process transitions
  -> refreshed evidence
```

The UI may project state. It must not mint state truth.

## Imported GPO Classes

The local app profile imports these General Program Ontology classes:

| GPO Class | Why It Applies Here |
| --- | --- |
| Long-running / interactive / networked tool | Codex app-server, WebSocket/IPC, ChatGPT WebContents, native Electron views, live thread status. |
| Config/stateful tool | Project bindings, provider config, runtime overrides, workspace paths, stash state, attachment drafts. |
| Renderer-heavy tool | Transcript Markdown, thought/process projection, middle file viewer, web/file tabs, runtime chips. |
| Producer-stream reducer / event summarizer | App-server events, stored JSONL rows, usage ledger rows, sub-agent events, analytics summaries. |
| Capability / protocol / visualizer program | Runtime capability profile, provider settings projection, app-server schema, drawer/header capability display. |
| Reactive scheduler / watcher / supervisor tool | Reload/restart, thread restore, app-server lifecycle, live turn state, attachment/drop events, middle-view bounds. |

Safe abstraction boundary:

```text
Do not generalize exact labels, CSS classes, or one-off UI text.
Generalize state ownership, evidence source, transition law, projection shape,
and preservation sentinels.
```

Local parent profile:

```text
MULTI_SURFACE_AGENTIC_WORKBENCH
```

Trigger:

```text
An app coordinates multiple AI/runtime/browser/workspace surfaces where state,
resource authority, handoff routes, transcripts, provider capabilities, and
workspace mutation are split across processes or panes.
```

Inherited obligations:

```text
surface identity and role preservation
project/workspace binding topology
provider/runtime capability evidence
thread/session/turn lifecycle
transcript normalization and projection
sub-agent graph and primary/child identity
handoff macro route law
resource path/download/attachment topology
IPC/preload/main/backend authority split
remote WebContents trust boundary
usage/analytics derivation and freshness
runtime/settings mutation scope
observation ecology and stale-event law
preservation replay locks for shared renderers/routes
```

## Kernel Operators

Use the ODEU kernel operators as local design questions:

| Operator | Local Use |
| --- | --- |
| Factor | Identify the state object or artifact boundary before patching a surface. |
| Partition | Split unknown/unsupported/stale/available instead of one boolean. |
| Bind | Bind messages, agents, files, threads, projects, and workspaces to explicit identities. |
| Transform | Keep parsers, reducers, formatters, and projections separate. |
| Sequence | Model lifecycle order: load, attach, stream, complete, restart, restore. |
| Expose | Name what the user can observe: chip, row, menu item, tab, transcript card, file viewport. |
| Compose | Check interactions between surfaces sharing one state object. |
| Warrant | Require evidence source and confidence before authority-bearing UI claims. |

## Local HOB / OTB / BRL Split

The local profile has two layers:

```text
Product behavior ontology:
  state objects, projections, transitions, resources, surfaces

Application-governance overlay:
  HOB inheritance, OTB transition legality, BRL replay locks, PR batons
```

### HOB: Obligation Inheritance

HOB asks:

```text
When this state-object class applies, which child obligations are inherited?
```

Each nontrivial state object should declare child obligations as:

```text
covered
proved irrelevant
pass-through
deferred with risk
blocked pending evidence
```

Example:

```text
AttachmentDraftSet applies
  -> source identity
  -> type evidence
  -> staging route
  -> provider disposition
  -> preview projection
  -> submit boundary
  -> cleanup lifecycle
  -> privacy/redaction
  -> preservation sentinels
```

### OTB: Transition Legality

OTB asks:

```text
Is this phase/action/feature transition legal?
```

The canonical transition graph starts from:

```text
docs/WORKFLOW_TRANSITION_GRAPH_SPEC.md
```

Every nontrivial feature should emit a transition claim:

```yaml
transition_claim:
  transition_id: SelectCodexThread
  from_state: selected_project_with_codex_binding
  to_state: codex_surface_thread_open_requested
  object_refs:
    - SurfaceBinding
    - ThreadRestoreTarget
    - RuntimeProviderProfile
  evidence_required:
    - workspace-config binding
    - app-server available or degraded transcript path
    - codex-surface:thread-state after dispatch
  evidence_forbidden:
    - renderer label as active-thread truth
    - stale discovery record as binding authority
  allowed_next_states:
    - rendered_stored
    - attached_live
    - failed_with_diagnostic
  blocked_promotions:
    - requested_as_rendered
    - dispatched_as_attached
```

### BRL: Behavior Replay Locks

BRL asks:

```text
Did this patch preserve previously locked behavior on protected surfaces?
```

BRL does not decide whether a patch is semantically wrong. It says a protected
observation changed and therefore needs review.

Recommended manifest shape:

```yaml
lock_id: middle_file_markdown_paths_preserved
owner_surface: AssistantMarkdownTypedProjection
protected_surfaces:
  - middle_file_markdown
  - codex_final_message_markdown
  - sub_agent_message_markdown
probe_command: npm run odeu:brl -- middle_file_markdown_paths_preserved
raw_surfaces:
  - rendered_dom_text
  - action_router_invocation
  - file_ref_open_result
canonicalization_profile: dom_text_without_timestamps
expected_hash_provenance: previous_green_candidate
failure_meaning: protected_projection_changed_not_product_truth
```

## State Object Ledger

Every feature should name which state object owns the truth. If no state object
exists, create or document one before spreading logic across surfaces.

| State Object | Producers | Consumers | Primary Law |
| --- | --- | --- | --- |
| `RuntimeProviderProfile` | Project config, app-server probe, provider schema, runtime discovery | Runtime constitution, drawer, composer picker | Provider label/config is not capability authority. |
| `RuntimeConstitution` | Provider profile, account/rate-limit evidence, workspace/Git evidence, thread status | Header, drawer, bottom band, analytics | Runtime truth is evidence-backed and fail-closed. |
| `RuntimeSettingsProjection` | Provider profile, app-server schema, account capabilities | Header controls, composer picker, runtime drawer | Mutation controls require explicit scope evidence. |
| `ThreadRestoreTarget` | Thread-state events, stored transcript render, live attach | Reload runtime, startup restore | Failed/latest events do not erase last usable restore target. |
| `TranscriptPresentationModel` | Stored JSONL normalizer, live app-server events | Codex transcript, load-more, thought process | Stored and live share pure projection, not lifecycle handlers. |
| `ThoughtProcessProjection` | Reasoning/tool/patch items, stored process rows | Thought/process accordion | Empty reasoning is filtered; tools/patches remain evidence. |
| `AgentConversationGraph` | Collab tool calls, sub-agent metadata, notification rows | Main sub-agent activity bubble, right sub-agent tab | Child-agent messages are not operator or primary Codex messages. |
| `ComposerDraftState` | Text input, attachments, active-turn state, queued/steer disposition | Composer input, send/steer/queue controls | Stop is separate from send; active turn changes disposition, not authorship. |
| `AttachmentDraftSet` | File picker, drag/drop, clipboard image, staging manifest | Composer chips, submit packet | Attachment intake is not provider-consumed payload until submit evidence exists. |
| `ProjectStash` | Codex file context menu, selected file refs, middle project tab | Send bundle to ChatGPT | Stash is project-local handoff preparation, not transcript evidence. |
| `MiddleFileState` | Codex file click, ChatGPT download import, host/project file read | Middle Files tab | File viewer is read-only projection, not source truth mutation. |
| `MiddleWebState` | Link router, WebContentsView navigation, web history | Middle Web tab | Imported web pages are utility surfaces, not project evidence. |
| `SurfaceBinding` | Project config, user linking, ChatGPT/Codex thread metadata | Thread workbench, handoff macros | Linked surfaces must remain explicit and scoped to project/thread. |
| `UsageLedger` | App-server events, token/rate-limit snapshots, tool/turn rows | Usage drawer, analytics | Ledger captures neutral usage evidence; ADEU/ProgramBench interprets later. |
| `ThreadAnalyticsSnapshot` | Stored transcript analyzer, session file mtime/index | Analytics tab, thread browser | Analytics are derived snapshots with freshness evidence. |
| `WorkspaceBackendStatus` | WSL/local backend probes, project config | Project controls, file reveal/open, attachment staging | Workspace authority lives in backend evidence, not renderer paths. |
| `AppServerRequestRegistry` | App-server request/response lifecycle | Approval/request cards, dynamic tool results, runtime status | Pending requests must close on reload/connection loss and cannot be approved by renderer-only state. |
| `CodexTurnLifecycleState` | Turn started/completed events, sub-agent activity, queued/steer actions | Composer status, send/steer/queue/stop controls, transcript activity | Absence of a final message is not idle; turn activity must follow runtime evidence. |
| `ProviderCapabilityEvidenceStore` | Runtime probes, app-server schema, provider/account evidence | Runtime controls, composer menus, attachments, quota/context witnesses | Capability absence is not permission; fallback labels do not enable mutation. |
| `ContextMenuCommandRegistry` | Renderer target descriptors, main-process menu policy | Right-click menus, file/stash/link actions | Context menu action is allowlisted command routing, not authority. |
| `ChatgptDownloadImportState` | ChatGPT download events, host temp path, project import route | ChatGPT-to-Codex macro, middle file tab | Downloaded remote files are untrusted until imported and validated by main/backend. |
| `ExternalNavigationPolicy` | Link intent router, URL policy, web history | Middle Web tab, external-open actions | URL labels and page titles are not project truth; all navigation is policy-gated. |
| `IpcChannelContract` | Preload bridge declarations, `ipcMain` handlers | Renderer actions, main/backend routes | Renderer access to a bridge method is not authority to perform the action. |
| `WebContentsSecurityProfile` | ChatGPT, Codex, middle web/file surfaces | Injection, downloads, link routing, context menus | Remote DOM is not evidence; injected scripts are best-effort UI aids. |
| `GeometryLayoutState` | Resize/layout reports, native view bounds, activation epoch | Middle Web view, composer band, pane zoom | Stale geometry must not overlay inactive surfaces. |
| `CodexSurfaceRequestState` | Codex surface requests, notifications, responses | Thread load, server requests, runtime reload | Request ids are scoped; stale activation epochs cannot mutate current state. |
| `OdeuTransitionCatalog` | Workflow specs, feature batons, state object ledger | PR reviews, future validation scripts | Actions must map to named transitions before mutation. |
| `BehavioralReplayLockSet` | Protected fixtures, sentinel manifests, smoke commands | Shared renderer/router preservation | Adjacent surfaces import sentinels when duplicated projection logic changes. |

## Transition Catalog

Start with these local transitions:

```text
ActivateProject
SelectChatGPTThread
SelectCodexThread
CreateOrUpdateProjectBinding
CreateOrUpdateLaneBinding
DiscoverCodexThreads
DiscoverChatGPTThreads
OpenMiddleFile
OpenMiddleWeb
StageAttachment
SubmitTurnWithAttachments
SendProjectStashToChatGPT
ImportChatGPTDownloadToProject
AttachWorkspace
UpdateRuntimePreferences
RespondToCodexServerRequest
UpdateThreadAnalytics
ReloadCodexRuntime
StopCodexTurn
SteerActiveCodexTurn
QueueCodexTurnMessage
```

Each transition should name:

```text
source state
target state
state objects touched
required evidence
forbidden evidence shortcuts
allowed failure states
stale-event rejection rule
preservation sentinels
```

## Authority Matrices

### Provider / Runtime Capability

Runtime capability authority comes from normalized provider/runtime evidence:

```text
app-server schema
runtime probe
provider profile
account/rate-limit evidence
workspace backend evidence
```

Project config, command names, labels, and fork examples may explain UI text.
They must not enable mutation by themselves.

### Direct Harness Capability Boundary

Direct runtime support is a sibling authority domain, not an implicit extension
of the vanilla app-server path.

Rules:

```text
Canonical capability rows live in the direct harness matrix.
Fork examples are crosswalk evidence, not shell support.
Direct provider support, app-server support, and standalone shell support are separate.
Renderer affordances can be visible as diagnostics, but mutation is enabled only
when the relevant canonical row has exact or accepted evidence for that scope.
```

### IPC / Preload Authority

Every IPC/preload route should be cataloged as:

```text
renderer-visible method
preload parameter shape
ipcMain handler validation
main/backend authority route
result projection
failure diagnostic
preservation sentinel
```

Blocking rule:

```text
Renderer access to an IPC method is not authority to perform the action.
The main process must revalidate identity, project binding, path route,
provider capability, and user gesture where applicable.
```

### WebContents / Remote Surface Authority

Remote surfaces include:

```text
ChatGPT WebContents
Codex local surface WebContents
middle Web tab WebContents
middle File tab renderer projection
```

Rules:

```text
remote page DOM is not project evidence
remote page URL is not thread identity unless bound and validated
injected scripts are best-effort UI aids, not protocol authority
ChatGPT download links are untrusted until main-process import validates route
middle-web history is utility state, not project evidence
external-open requires URL policy
```

## Local Gates

### 1. Projection Renderer Separation Gate

Trigger:

```text
UI bug involves Markdown, transcript rendering, thought process, file viewer,
web viewer, chips, tables, diagnostics, or compact/expanded views.
```

Required split:

```text
raw event/input
  -> normalized model
  -> projection model
  -> DOM/native-view renderer
  -> user action router
```

Blocking rule:

```text
Do not patch one visible string or CSS block if multiple surfaces consume the
same projection. First identify the projection artifact.
```

Recent example:

```text
Middle file Markdown needed document projection rules, not chat-preview rules.
```

### 2. Product State Object Ownership Gate

Trigger:

```text
Two or more surfaces show or mutate related data.
```

Required row:

```yaml
product_state_object:
  object_ref: string
  producers: []
  consumers: []
  invariants: []
  projections: []
  mutation_routes: []
  stale_event_risks: []
```

Blocking rule:

```text
Do not independently patch header, drawer, bottom band, analytics, transcript,
or middle-plane widgets when they are projections of one latent state object.
```

### 3. Control Schema Reachability Gate

Trigger:

```text
Feature depends on app-server capability, provider settings, runtime mutation,
approval/access policy, model/reasoning/speed, attachment payload support, or
ChatGPT/Codex macro behavior.
```

Required questions:

```text
Is the control visible?
Is it supported?
Which scope is supported?
Which process owns mutation?
Which refreshed evidence confirms mutation?
What is the disabled-visible reason?
```

Blocking rule:

```text
Project config, provider label, command name, or UI state may explain labels.
They do not enable mutation.
```

### 4. Observation Ecology Gate

Trigger:

```text
Bug involves active/idle status, app reload, thread restore, web/native view
bounds, WSL backend availability, downloads, startup, or delayed event streams.
```

Required split:

```text
process state
transport state
thread state
turn state
stored transcript state
UI projection state
stale/replayed event state
```

Blocking rule:

```text
Do not infer idle or success from absence of one event stream when another
authority-bearing stream can still be active.
```

Recent example:

```text
Sub-agent phase output could make the send button appear idle while the primary
turn was still active.
```

### 5. Resource Route Topology Gate

Trigger:

```text
Feature opens, reveals, copies, downloads, stages, sends, or stashes a file/link.
```

Required split:

```text
display label
workspace-relative path
fallback/evidence path
absolute backend path
host download path
staged workspace path
provider/chat handoff path
```

Blocking rule:

```text
Renderer-visible paths are references, not authority. Main/backend must resolve
and revalidate before reveal, stash, submit, or handoff.
```

Recent example:

```text
Short final-message paths may resolve through same-turn patch evidence only
after direct resolution fails and the suffix match is unique.
```

### 6. Handoff Macro Gate

Trigger:

```text
Feature transfers content between Codex, ChatGPT, middle file/web tabs, project
stash, or download folders.
```

Required row:

```yaml
handoff_macro:
  source_surface: string
  target_surface: string
  project_binding_ref: string
  resource_refs: []
  prompt_template: string
  staging_or_download_route: string
  required_user_gesture: bool
  failure_diagnostics: []
```

Blocking rule:

```text
Do not silently route through a linked thread unless the binding is unique and
current for the active project.
```

### 7. Preservation Sentinel Gate

Trigger:

```text
Fix touches shared renderer/tokenizer/context menu/workspace routing/runtime
state.
```

Required preservation checks:

```text
existing successful flow still works
unknown/unsupported state does not render as success
same-turn fallback remains secondary
stored/live transcript parity holds
renderer does not receive new raw authority
```

Blocking rule:

```text
Every accepted win becomes a regression sentinel for adjacent fixes.
```

### 8. IPC And Preload Authority Gate

Trigger:

```text
Feature adds or changes any bridge method, IPC handler, shell event, surface
event, file path argument, URL argument, command argument, or provider mutation
request.
```

Required split:

```text
renderer-visible method
preload bridge parameter shape
ipcMain handler validation
main/backend authority route
result projection
failure diagnostic
preservation sentinel
```

Blocking rule:

```text
Renderer access to a preload bridge never grants authority. Main/backend must
revalidate identity, project binding, path route, capability, and user gesture.
```

### 9. WebContents And Remote Surface Gate

Trigger:

```text
Feature observes or mutates ChatGPT WebContents, Codex WebContents, middle-web
navigation, download handling, injected scripts, or external-open behavior.
```

Required split:

```text
remote DOM observation
URL/navigation policy
download/import route
project/thread binding evidence
main-process validation
renderer projection
```

Blocking rule:

```text
Remote page state and injected-script success are not protocol authority.
They can start a routed request; they cannot prove project/runtime truth.
```

## Feature Baton Template

Before implementing nontrivial app work, create a short baton:

```yaml
feature_baton:
  feature_id: string
  objective: string
  posture: prototype | scoped | gold_candidate

  hob:
    activated_state_objects: []
    inherited_child_obligations: []
    irrelevant_or_deferred_children: []

  otb:
    transition_claims: []
    allowed_inputs: []
    forbidden_inputs: []
    legal_next_states: []
    blocked_promotions: []

  brl:
    protected_surfaces: []
    preservation_sentinels: []
    replay_manifest_refs: []
    acceptable_uncovered_risk: []

  implementation:
    files_expected_to_touch: []
    forbidden_files_or_owners: []
    main_process_routes: []
    backend_routes: []
    renderer_surfaces: []

  validation:
    smoke_commands: []
    fixture_refs: []
    manual_runtime_checks: []
    evidence_to_capture: []
```

Minimum acceptance:

```text
The baton names the state object.
The implementation changes that object or one projection of it.
The validation checks at least one preservation sentinel.
```

## PR Review Checklist

Use this checklist when reviewing substantial PRs:

```text
1. Which state object owns the truth?
2. Are producers and consumers both named?
3. Does renderer logic derive authority from labels, paths, or stale config?
4. Are unsupported/unknown/stale states represented explicitly?
5. Does a user action cross into main/backend before mutation?
6. Are stored and live event paths equivalent where they should be?
7. Are sub-agent/primary/operator identities preserved?
8. Are file/link/download/stash routes revalidated outside the renderer?
9. Is there a stale-event or reload race?
10. What previous bug is now a preservation sentinel?
11. Which OTB transition claim does this action instantiate?
12. Which BRL locks are imported by the touched owner surfaces?
13. Did the patch expose a new IPC/preload authority route?
14. Did a WebContents-derived fact get promoted to project/runtime evidence?
15. Did a provider/fork capability row enable mutation without exact or accepted evidence?
16. Does a late/stale event from an older activation epoch still have a mutation route?
17. Does the patch change duplicated projection logic in only one renderer context?
18. Are manual smoke checks enough, or is this now a replay-lock candidate?
```

## First Local Catalog To Build

The first useful implementation artifact is a machine-readable state object
ledger, not another broad ontology document.

Recommended catalog family:

```text
src/shared/odeu/state-ledger.js
src/shared/odeu/transition-catalog.js
src/shared/odeu/capability-authority.js
src/shared/odeu/replay-locks.js
src/shared/odeu/owner-surface-map.js
```

Initial descriptor shape:

```ts
type ShellStateObjectDescriptor = {
  id: string;
  gpoNodes: string[];
  ownerKind:
    | "runtime_state"
    | "projection_state"
    | "resource_state"
    | "transition_state"
    | "ledger_state"
    | "surface_state";
  producers: string[];
  consumers: string[];
  codeAnchors: {
    producers: string[];
    consumers: string[];
    ipcChannels: string[];
    shellEvents: string[];
    storagePaths: string[];
  };
  evidenceAuthority: Array<{
    source: string;
    authority:
      | "project_config"
      | "runtime_probe"
      | "app_server_schema"
      | "surface_event"
      | "stored_transcript"
      | "filesystem_stat"
      | "workspace_backend"
      | "user_gesture"
      | "derived_projection";
    freshness: "fresh" | "stale" | "unknown" | "failed" | "unavailable";
    enablesMutation: boolean;
  }>;
  statusLattice: string[];
  invariants: string[];
  projections: string[];
  mutationRoutes: string[];
  staleEventRisks: string[];
  unsupportedStates: string[];
  preservationSentinels: string[];
  validationRefs: string[];
};
```

This can start as documentation exported from code. Later, tests and review
tools can consume it.

Example seed row:

```js
{
  id: "ThreadRestoreTarget",
  ownerKind: "transition_state",
  gpoNodes: ["lifecycle", "diagnostics", "observation_ecology"],
  producers: [
    "codex-surface:thread-state",
    "workspace-config lane binding",
    "stored transcript discovery"
  ],
  consumers: [
    "reload runtime",
    "project activation",
    "startup restore",
    "header active-thread projection"
  ],
  codeAnchors: {
    producers: [
      "src/main.js:rememberCodexThreadRestoreTarget",
      "src/main.js:chooseCodexThreadRestoreTarget",
      "src/renderer/codex-surface.js:reportThreadState"
    ],
    consumers: [
      "src/main.js:reloadCodexRuntime",
      "src/main.js:loadCodexSurface"
    ],
    ipcChannels: ["codex-surface:thread-state", "codex:reload-runtime"],
    shellEvents: ["surface:event"],
    storagePaths: ["workspace-config.json"]
  },
  evidenceAuthority: [
    {
      source: "codex-surface:thread-state",
      authority: "surface_event",
      freshness: "fresh",
      enablesMutation: false
    },
    {
      source: "workspace-config lane binding",
      authority: "project_config",
      freshness: "unknown",
      enablesMutation: false
    }
  ],
  statusLattice: ["none", "requested", "dispatched", "rendered_stored", "attached_live", "failed", "stale"],
  invariants: [
    "requested is not rendered",
    "rendered_stored or attached_live may update active-thread truth",
    "failed/latest event does not erase last usable restore target"
  ],
  projections: ["header thread label", "runtime drawer", "reload target"],
  mutationRoutes: ["reload runtime", "project activation"],
  staleEventRisks: ["late BrowserView load", "older activation epoch", "failed reload overwriting last usable target"],
  unsupportedStates: ["no known thread target"],
  preservationSentinels: ["project activation restores linked thread", "failed reload does not clear prior target"],
  validationRefs: ["transition:SelectCodexThread", "transition:ActivateProject"]
}
```

First validation scripts:

```text
scripts/odeu-validate-state-ledger.mjs
scripts/odeu-validate-transition-catalog.mjs
scripts/odeu-validate-ipc-catalog.mjs
scripts/odeu-replay-lock-smoke.mjs
```

Package script target once stable:

```json
{
  "odeu:validate": "node ./scripts/odeu-validate-state-ledger.mjs && node ./scripts/odeu-validate-transition-catalog.mjs && node ./scripts/odeu-validate-ipc-catalog.mjs",
  "odeu:brl": "node ./scripts/odeu-replay-lock-smoke.mjs"
}
```

Do not wire this into `npm run validate` until the catalog is stable enough not
to create noisy process friction.

## Bottom Line

For `codex-review-shell`, ODEU should act as a local discipline for state
ownership and transition legality.

The practical rule is:

```text
No feature should patch a surface before naming the state object,
the evidence source, the transition route, and the preservation sentinels.
```

That is the usable adaptation of the meta-program for this app.
