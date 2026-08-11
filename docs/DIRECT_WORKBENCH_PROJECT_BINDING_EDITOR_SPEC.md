# Direct Workbench Project Binding Editor

Status: DW-P2 implemented and headless-observed, 2026-08-11.

## Run Stance And Source Pack

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: live_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: direct_workbench_project_binding_editor_v0
  profile_status: proposed_local
```

Doctrine and borrowed references:

- Morphic UX evidence-before-commit and authority-boundary doctrine;
- the T3-informed Direct Workbench geometry already adopted here.

Host sources:

- `src/main.js`
- `src/main/direct/project/project-directory.js`
- `src/main/direct/runtime/runtime-path-selection.js`
- `src/preload-codex-surface.js`
- `src/renderer/t3-direct-surface.html`
- `src/renderer/t3-direct-surface.css`
- `src/renderer/t3-direct-surface.js`
- `src/renderer/direct-project-directory-surface.js`

Related specifications:

- `DIRECT_WORKBENCH_PROJECT_DIRECTORY_SPEC.md`
- `DIRECT_WORKBENCH_AND_WORLDMANAGER_STUDIO_SPLIT_SPEC.md`
- `DIRECT_T3_ALTERNATE_GUI_EXPERIMENT.md`

## Purpose

DW-P1 made configured projects inspectable and switchable, but operators still
had to leave Direct Workbench to create or edit a binding. DW-P2 adds a bounded
Direct-native editor for the small project constitution required by ordinary
work:

- project display identity;
- invariant workspace substrate and locator;
- default agent runtime path.

It does not add deletion, substrate discovery, port operations, remote project
catalogs, or WorldManager semantic admission.

## UX Bundle

```text
user archetype: expert operator
risk: medium; active binding edits can dispose and reload a runtime
trust sensitivity: proposed fields must not look persisted before main admits them
interaction: open revision-bound draft -> inspect evidence -> edit -> request commit -> observe result

utility ranking:
  1. truthful project/runtime binding
  2. fast project setup and correction
  3. same-context continuity with the active transcript and project directory
```

Invariants:

- the renderer receives and edits a provisional draft; it never writes config;
- main assigns new project identity and owns normalization and persistence;
- the inspected catalog and edited-project revisions must still be current;
- raw workspace locators appear only in the explicit trusted editor, never in
  the compact directory projection;
- provider secrets, remote auth, binary paths, and unrelated project settings
  never enter the editor projection;
- active work blocks edits to either the current or an inactive target project;
- a successful active-project edit reloads the runtime from the admitted
  binding; failure restores the previous config and runtime;
- create and inactive edit preserve the current active project and thread;
- no operation mutates WorldManager state.

Morphable choices:

- the editor may occupy the desktop dock or the existing bounded overlay at
  smaller widths;
- sections may stack and labels may wrap;
- completed feedback may collapse once the revised directory is visible.

Chosen profile:

```yaml
density: medium
navigation_mode: hub_and_spoke
information_posture: task_first
interaction_tempo: guided
salience_posture: action_and_diagnostics_prominent
state_exposure: progressive
command_posture: safe_buffered
```

## Surface Topology

```text
bounded Direct Workbench
  navigation region
    project directory
      configured project evidence
      New and Edit advisory actions

  primary work region
    active transcript and composer remain visible on desktop

  project-binding dock
    provisional identity lane
    workspace-substrate lane
    runtime lane
    commit-evidence lane
    explicit Cancel / Create-or-Save boundary
```

The editor is mutually exclusive with runtime, analytics, and thread-intake
docks. Its evidence lane stays in the same bounded workbench as the commit
action. On narrow layouts the dock becomes the existing full-height overlay;
the target identity and revision witness remain inside it.

## Artifact Decisions

| Artifact | Decision | Host-owned semantics |
| --- | --- | --- |
| project-binding draft | build a typed, purpose-specific projection | editable scope, revision witnesses, secret exclusion |
| binding mutation | extend the main-owned project directory coordinator | validation, identity assignment, idempotency, persistence, rollback |
| editor dock | compose inside the existing Direct Workbench inspector geometry | provisional posture, evidence-before-commit, responsive reachability |
| runtime selection | reuse `runtime-path-selection.js` | preserve unchanged provider bindings; translate only deliberate path changes |

## Draft Contract

```text
direct_workbench_project_binding_draft@1
  mode: create | edit
  sourceProjectId
  projectId                    # empty for create
  expectedCatalogRevision
  expectedProjectRevision      # edit only
  fields
    displayName
    workspace
      kind: wsl | windows | local
      label
      distro / linuxPath       # WSL only
      windowsPath              # Windows only
      localPath                # local only
    runtimePath
      app-server | direct-text | direct-implementation
  evidence
  authorityBoundary
```

Workspace locators are intentionally visible in this projection because they
are the primary object being inspected and changed. This does not weaken the
DW-P1 directory law: compact catalog rows still contain labels only.

## Mutation Contract

The renderer submits only:

```text
clientMutationId
mode
sourceProjectId
projectId
expectedCatalogRevision
expectedProjectRevision
fields
```

Main revalidates:

1. the sender is the trusted Direct Workbench surface for the selected source;
2. no activation or binding mutation conflicts with the request;
3. catalog and target revisions match the inspected draft;
4. edit targets exist, while create requests supply no project identity;
5. the edit target has no active Direct turn or unresolved provider work;
6. workspace kind and absolute locator shape are valid;
7. the requested runtime path belongs to the closed supported set.

Create assigns a fresh main-generated project ID and appends a normalized
binding without selecting it. Inactive edit replaces only the bounded identity,
workspace, and runtime fields. Active edit persists the new binding, reloads
the runtime, and rolls config and runtime back together if loading fails.

`clientMutationId` is idempotent for one source/mode/target signature. Reuse for
another signature fails closed.

## State Rendering

- `loading`: revision-bound draft acquisition, never an empty form claim;
- `ready`: provisional fields and commit evidence visible;
- `saving`: controls gated while main revalidates and applies;
- `failed`: stable reason beside the retained draft and retry path;
- `completed`: editor closes only after a completed receipt and the directory
  renders the admitted result;
- active-runtime reload: the fresh renderer bootstrap is the authoritative
  completion witness.

## Verification

Focused contract coverage proves:

- edit and create drafts expose only their bounded fields;
- create identity is main-owned;
- stale project revision, stale catalog, active work, invalid locators, unknown
  targets, and client-ID reuse fail closed;
- receipts are idempotent and WorldManager-neutral;
- unchanged test/provider bindings are preserved rather than silently rewritten.

The Electron/Xvfb smoke proves:

- the dock is same-context and mutually exclusive with other inspectors;
- a new local project is created without changing the active project;
- an inactive Windows project is edited without disturbing the current thread;
- the edited project can be activated with its bound thread restored;
- an active-project name edit reloads through the admitted binding;
- desktop and narrow Direct Workbench geometry still render without errors.

Commands:

```text
npm run direct:project-directory
npm run direct:t3-alternate-gui
npm run direct:t3-alternate-gui:electron
npm run direct:smoke
npm run check:main-syntax
```

## Deferred

- delete and archive project bindings;
- directory picker and substrate discovery helpers;
- validate workspace reachability before admission;
- constitutional port operations between Windows, WSL, local, and remote hosts;
- provider-specific advanced binding fields;
- WorldManager project genesis or worldstate admission;
- richer project grouping, search, and recency ranking.
