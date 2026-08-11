# Direct Workbench Project Lifecycle Governance

Status: DW-P3 implemented and headless-observed, 2026-08-11.

## Run Stance And Source Pack

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: headless_observed
profile_lineage:
  base_profile: artifact_inspector_reference
  derivative_profile: direct_workbench_project_lifecycle_v0
  profile_status: proposed_local
```

Doctrine and borrowed references:

- Morphic UX destructive-action, evidence-before-commit, and explicit-authority
  doctrine;
- the T3-informed Direct Workbench geometry already adopted here.

Host sources:

- `src/main.js`
- `src/main/direct/project/project-directory.js`
- `src/preload-codex-surface.js`
- `src/renderer/t3-direct-surface.html`
- `src/renderer/t3-direct-surface.css`
- `src/renderer/t3-direct-surface.js`
- `src/renderer/direct-project-directory-surface.js`

Related specifications:

- `DIRECT_WORKBENCH_PROJECT_DIRECTORY_SPEC.md`
- `DIRECT_WORKBENCH_PROJECT_BINDING_EDITOR_SPEC.md`
- `DIRECT_WORKBENCH_AND_WORLDMANAGER_STUDIO_SPLIT_SPEC.md`

## Purpose

DW-P1 made project bindings inspectable and switchable. DW-P2 made them
creatable and editable. DW-P3 adds the missing lifecycle law:

```text
active binding
  -> archive (reversible)

archived binding
  -> restore (reversible)
  -> delete binding identity (destructive)
```

Archive removes an inactive binding from the ordinary working set without
removing its configuration. Delete removes only an already archived shell
binding. Neither operation deletes workspace files, Git state, Codex sessions,
thread-store evidence, or WorldManager state.

## UX Bundle

```text
user archetype: expert operator
risk: high for binding deletion; medium for archive/restore
trust sensitivity: lifecycle posture and substrate effects must be explicit
interaction: inspect target -> inspect eligibility and effects -> request transition -> observe receipt

utility ranking:
  1. prevent accidental loss of project binding identity
  2. keep inactive project catalogs manageable
  3. make recovery and residual evidence explicit
```

Invariants:

- the selected project can never be archived or deleted;
- a project with active work can never change lifecycle state;
- archive preserves the complete binding and is reversible;
- restore returns the same project identity and binding revision lineage;
- delete is admitted only from archived state;
- delete requires the exact main-projected confirmation phrase;
- at least one active project binding always remains;
- archived projects cannot be activated or edited until restored;
- the main process owns lifecycle validation, persistence, and idempotency;
- renderer controls express lifecycle authority but cannot mint it;
- project files, Git state, transcripts, Direct stores, and WorldManager state
  are never mutated by lifecycle operations.

Morphable choices:

- archived rows may be hidden by default and revealed within the same directory;
- the lifecycle evidence dock may become the existing bounded overlay at narrow
  widths;
- reversible and destructive action groups may stack responsively.

Chosen profile:

```yaml
density: high
navigation_mode: split_pane
information_posture: evidence_first
interaction_tempo: expert_fast_path
salience_posture: evidence_and_status_prominent
state_exposure: full_explicit
command_posture: dual_lane
```

## Surface Topology

```text
bounded Direct Workbench
  navigation region
    project directory
      active rows
      same-context archived reveal
      lifecycle state and blockers
      Manage advisory action

  primary work region
    active transcript and composer remain visible on desktop

  lifecycle evidence dock
    target identity and revision lane
    substrate/runtime/residual-evidence lane
    eligibility and blocker surface
    reversible action cluster
      Archive | Restore
    destructive action cluster
      exact confirmation input
      Delete binding
```

The destructive cluster is later and visually separate from archive/restore.
Delete never appears as an ordinary project-row action.

## Artifact Decisions

| Artifact | Decision | Host-owned semantics |
| --- | --- | --- |
| project lifecycle state | extend normalized project binding with typed active/archived state | admissible transitions, restart persistence, selected-project invariant |
| lifecycle draft | build a renderer-safe revision-bound evidence projection | target identity, effects, blockers, confirmation phrase |
| lifecycle mutation | extend the main-owned project mutation coordinator | revalidation, idempotency, persistence, deletion boundary |
| lifecycle dock | compose inside the existing Direct Workbench dock geometry | evidence posture, reversible/destructive separation, responsive reachability |

## Persisted Lifecycle Object

```text
lifecycle
  state: active | archived
  archivedAt
  restoredAt
  updatedAt
```

Normalization guarantees at least one active project. `selectedProjectId` is
resolved only from active projects. Old configs without the object normalize to
`active` without migration loss.

## Directory Projection

Each renderer-safe row adds:

```text
lifecycle
  state
  archivedAt
  canArchive
  canRestore
  canDelete
  blockerCodes[]
```

The directory also exposes active and archived counts. Archived rows remain
non-selectable and are hidden by default only as a presentation choice; they
remain same-context reachable through the directory reveal.

## Lifecycle Draft Contract

```text
direct_workbench_project_lifecycle_draft@1
  sourceProjectId
  projectId
  expectedCatalogRevision
  expectedProjectRevision
  target
    displayName
    lifecycleState
    substrateLabel
    runtimeLabel
    restoreLabel
  actions
    archive
      eligible
      blockerCodes[]
    restore
      eligible
      blockerCodes[]
    delete
      eligible
      blockerCodes[]
      requiredConfirmation
  effects
    projectBindingPreserved
    workspaceFilesDeleted: false
    gitStateDeleted: false
    threadEvidenceDeleted: false
    worldManagerStateAffected: false
```

## Mutation Contract

The renderer submits only:

```text
clientLifecycleId
action: archive | restore | delete
sourceProjectId
projectId
expectedCatalogRevision
expectedProjectRevision
confirmation
```

Main revalidates:

1. trusted Direct Workbench sender and selected source identity;
2. no activation or project mutation is in progress;
3. catalog and target binding revisions are current;
4. target exists and is not selected;
5. target has no active Direct or provider work;
6. archive starts from active and restore/delete start from archived;
7. at least one active binding remains;
8. delete confirmation matches the projected phrase exactly.

Lifecycle client IDs are idempotent for one source/target/action signature and
fail closed if reused for another transition.

## State Rendering

- `loading`: draft acquisition, never an empty lifecycle claim;
- `ready`: target, effects, eligibility, and blockers visible;
- `applying`: all lifecycle controls gated while main revalidates;
- `archived`: quiet non-authoritative row, never selectable;
- `failed`: stable reason beside the retained evidence and retry path;
- `completed`: directory counts and rows update only from main receipt evidence.

## Verification Plan

Focused contract fixtures must prove:

- old config normalization and all-archived recovery preserve one active project;
- archived projects cannot be selected, activated, or edited;
- active, selected, busy, stale, wrong-state, and last-active gates fail closed;
- archive and restore preserve identity and configuration;
- delete requires archived state and an exact confirmation phrase;
- lifecycle receipts are idempotent and renderer safe.

Electron/Xvfb must prove:

- archived projects disappear from the default working set but remain
  same-context reachable;
- restore returns the same row and identity;
- delete is disabled until exact confirmation and removes only the binding;
- active project Manage renders its archive blocker;
- existing project switching, thread restoration, editor, and narrow geometry
  remain intact.

## Implemented Slice

- normalized project bindings now persist an `active` or `archived` lifecycle;
- config normalization recovers one active project if a malformed catalog is
  entirely archived and never selects an archived binding;
- main exposes revision-bound lifecycle drafts and idempotent archive, restore,
  and delete receipts through Direct-Workbench-only IPC;
- lifecycle draft responses are request-gated so stale target evidence cannot
  replace a newer Manage selection or a closed dock;
- failed atomic persistence restores the exact pre-mutation in-memory catalog
  before the failed receipt and directory projection are emitted;
- archive and restore retain the same project identity and complete binding;
- delete removes only an archived config binding after exact phrase
  confirmation;
- the project directory hides archived rows by default while preserving an
  explicit same-context reveal and active/archived counts;
- a dedicated lifecycle dock separates reversible disposition from destructive
  binding removal and keeps preservation evidence visible.

Observed under Electron/Xvfb through the production Direct Workbench surface:

```text
create inactive binding
  -> archive
  -> verify hidden default and archived reveal
  -> restore same project ID
  -> archive again
  -> reject incomplete confirmation
  -> delete archived binding
  -> verify config-only removal

forced atomic persistence failure
  -> emit failed lifecycle receipt
  -> retain active binding in memory and on disk
  -> retry successfully after persistence recovers
```

Commands:

```text
npm run direct:project-directory
npm run direct:t3-alternate-gui
npm run direct:t3-alternate-gui:electron
```

## Deferred

- workspace reachability probes and directory picker;
- substrate discovery and ranked provisioning suggestions;
- constitutional port operations;
- archive retention policy or automated cleanup;
- re-admission of orphaned session evidence after binding deletion;
- remote and cross-machine project catalogs.
