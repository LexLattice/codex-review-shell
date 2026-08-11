# Direct Workbench Runtime-Neutral Thread Directory

Status: DW-T1 implemented and headless-observed, 2026-08-11.

## Run Stance And Source Pack

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: runtime_exercised
  runtime: headless_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: direct_workbench_runtime_neutral_thread_directory_v0
  profile_status: adopted_local
```

Doctrine and borrowed references:

- Morphic UX `artifact_inspector_advisory_workbench` doctrine;
- T3-informed Direct Workbench geometry already adopted by this repository.

Host sources:

- `src/main/codex-app-server.js`
- `src/main/codex-surface-session.js`
- `src/main/direct/controller/fixture-controller.js`
- `src/main/direct/controller/live-text-controller.js`
- `src/main/direct/thread/thread-deck.js`
- `src/renderer/codex-surface.js`
- `src/renderer/t3-direct-surface.html`
- `src/renderer/t3-direct-surface.css`

Upstream protocol sources inspected from the locally tracked Codex fork:

- `codex-rs/app-server-protocol/src/protocol/v2.rs` `ThreadListParams`;
- `codex-rs/app-server-protocol/src/protocol/v2.rs` `ThreadListResponse`;
- `codex-rs/app-server-protocol/src/protocol/v2.rs` `Thread` and `ThreadStatus`.

Related specifications:

- `DIRECT_WORKBENCH_AND_WORLDMANAGER_STUDIO_SPLIT_SPEC.md`
- `DIRECT_WORKBENCH_PROJECT_DIRECTORY_SPEC.md`
- `DIRECT_WORKBENCH_THREAD_INTAKE_SPEC.md`
- `DIRECT_T3_ALTERNATE_GUI_EXPERIMENT.md`

## Purpose

Direct Workbench must preserve the familiar thread-first Codex workflow across
both runtime paths. The existing rail is already a useful Direct-native artifact,
but it is enabled only for the Direct live-text transport. App Server projects
can start or resume threads through the transcript surface while their project
sidebar still claims that no native directory is available.

DW-T1 aligns the existing rail, Direct thread deck, and App Server thread
protocol behind one renderer-safe directory model. It does not introduce
WorldManager semantic ingestion, cross-project thread admission, or a second
canonical thread store.

## UX Bundle

```text
primary operator: expert operator using conventional Codex thread workflows
risk: medium; focus changes live provider/runtime attachment
trust sensitivity: project scope, runtime path, active work, and source identity
interaction mode: inspect evidence -> request focus -> observe attachment

utility ranking:
  1. resume the correct project-scoped thread through the correct runtime
  2. make recent cross-surface threads quickly reachable
  3. preserve current work and pending authorization requests
```

Required evidence before focus:

- thread title and current/target posture;
- source surface such as CLI, VS Code, Exec, App Server, or Direct;
- runtime path and continuation mode;
- last-updated and running/recoverable state;
- visible blocker when current work prevents switching.

## Invariants And Morphable Choices

Invariants:

- the active project connection bounds all listing and focus operations;
- App Server listing is additionally filtered by the active project workspace;
- Direct listing remains scoped by the main-owned project context;
- App Server focus uses provider resume/read authority; Direct focus uses the
  Direct controller's project-scoped read contract;
- an active turn or unresolved provider request belonging to the current thread
  identity blocks focus away from it;
- a rendered/requested thread ID without live attachment remains retryable;
- the renderer may request a thread transition but may not mint thread identity,
  provider continuity, or mutation authority;
- configured, loading, available, opening, active, blocked, failed, and partial
  states remain materially distinct;
- raw `cwd`, rollout path, source home, session path, and pagination cursors do
  not enter the bounded directory model;
- no WorldManager state or semantic history is affected.

Morphable choices:

- the directory is vertical in the desktop sidebar and horizontal in the
  existing narrow workbench projection;
- evidence may be two lines at full width and collapse to state posture when the
  sidebar is intentionally collapsed;
- the bounded row limit and future search disclosure may change without changing
  thread identity or focus law.

## Local Morph Profile

```yaml
density: medium
navigation_mode: hub_and_spoke
information_posture: task_first
interaction_tempo: guided
salience_posture: action_and_diagnostics_prominent
state_exposure: progressive
command_posture: safe_buffered
```

This remains inside the borrowed alternate profile. The local derivative names
the runtime-neutral thread evidence and focus contract.

## Surface Topology

```text
bounded Direct Workbench
  navigation region
    project identity and project directory
    thread-directory lane
      new-thread action
      directory status surface
      project-scoped thread rows
        identity
        source/runtime evidence
        lifecycle evidence
        focus gate
      refresh action
  primary work region
    authoritative active transcript
  status region
    active runtime and turn posture
    visible focus transition/failure
  trust-boundary lane
    Direct thread control-plane witness
```

Desktop-to-narrow rearrangement is a bounded workbench position shift. Evidence
remains same-context reachable and focus does not require a route transition.

## Artifact Decisions

| Artifact | Decision | Host-owned semantics |
| --- | --- | --- |
| Direct thread deck | align | project identity, Direct continuity, action eligibility |
| App Server thread protocol | wrap | workspace filter, provider continuation, source evidence |
| runtime-neutral directory model | build once as a pure renderer artifact | normalization, raw-exposure law, state labels, partial posture |
| existing Morphic/T3 thread rail | compose | evidence layout, current/opening/blocked distinction, responsive behavior |
| runtime focus adapter | compose from existing functions | Direct read versus App Server resume/read, rollback-on-failure posture |
| fixture thread inventory | extend for verification | deterministic list/read evidence only; no production authority |

The imported protocol and existing rail own mechanics. Direct Workbench still
owns why the directory exists, how evidence is interpreted, which gates apply,
and how a focus request changes the visible work context.

## Runtime-Neutral Directory Model

```text
direct_workbench_thread_directory@1
  projectId
  runtimePath
  runtimeLabel
  observedAt
  status
  partial
  counts
  rows[]
    threadId
    displayTitle
    runtimePath
    sourceKind
    sourceLabel
    lifecycleState
    activeTurnCount
    modelLabel
    turnCount
    createdAt
    updatedAt
    continuationMode
    continuationLabel
    focusEligible
    blockerCodes[]
  rawPathExposed: false
  rawCursorExposed: false
```

The model accepts both native response shapes:

```text
Direct:     { threads, deck }
App Server: { data, nextCursor }
```

It retains only bounded display and action evidence. `nextCursor` becomes the
boolean `partial`; raw cursor and workspace/path fields are discarded.

## Listing And Focus Contract

The request adapter supplies:

```text
limit: 40
sortKey: updated_at
sortDirection: desc
cwd: active project workspace root
```

The Direct controller ignores renderer-supplied project identity and scopes the
request through its main-owned project context. App Server applies its exact
`cwd` filter so CLI, VS Code, Exec, and App Server threads from the same project
can appear without cross-project scavenging.

Focus settlement is runtime-specific:

```text
Direct fixture/live text
  -> thread/read
  -> apply Direct thread result

App Server
  -> thread/resume
  -> thread/read fallback only where the existing capability contract permits
  -> apply provider thread result
```

Before leaving the current thread, the renderer rechecks:

1. no current turn is starting, running, or stopping;
2. no provider/server request remains pending or responding;
3. no other directory focus transition is in progress;
4. the row still has a provider/runtime focus action;
5. the target differs from the active thread.

Failure occurs before transcript replacement where provider resume/read fails.
The existing active transcript therefore remains authoritative and the row/status
surface renders the failure.

## State Rendering

- `loading`: directory stays visible with an explicit refresh posture;
- `available`: source/runtime evidence is visible and focus is enabled;
- `active`: only the currently attached thread receives authoritative styling;
- `running`: runtime-observed activity, not a completion claim;
- `blocked`: focus remains visible but disabled beside its reason;
- `opening`: target row and directory status show an in-progress transition;
- `failed`: warning posture preserves the prior active thread;
- `partial`: returned rows are valid, while the surface admits more exist.

## Verification

Focused fixtures must prove:

- Direct `{threads, deck}` and App Server `{data, nextCursor}` normalize into the
  same safe model;
- App Server source, epoch timestamps, object status, and partial posture are
  rendered without `cwd`, path, or cursor exposure;
- Direct deck blockers remain binding;
- current active work and pending provider requests block focus away;
- pending requests from background threads do not block focus, and an
  unattached matching thread ID remains eligible for provider recovery;
- Direct fixture list/read stays project-scoped;
- App Server requests include the exact active workspace filter;
- the Electron surface lists, creates, and switches deterministic Direct fixture
  threads and isolates the inventory across project activation;
- the narrow projection keeps the directory same-context reachable.

## Deferred

- server-backed search and cursor pagination controls;
- archive, rename, fork, rollback, and delete actions;
- cross-project or cross-machine thread discovery;
- provider-specific continuation adapters beyond Direct and App Server;
- WorldManager semantic ingestion and admission of external thread evidence.
