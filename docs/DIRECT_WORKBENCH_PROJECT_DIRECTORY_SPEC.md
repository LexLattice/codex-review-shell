# Direct Workbench Project Directory

Status: DW-P1 implemented and headless-observed, 2026-08-11.

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
  derivative_profile: direct_workbench_project_directory_v0
  profile_status: proposed_local
```

Doctrine and borrowed references:

- Morphic UX `artifact_inspector_advisory_workbench` doctrine;
- T3-informed Direct Workbench geometry already adopted by this repository.

Host sources:

- `src/main.js`
- `src/main/app-experience.js`
- `src/main/direct/runtime/runtime-path-selection.js`
- `src/preload-codex-surface.js`
- `src/renderer/t3-direct-surface.html`
- `src/renderer/t3-direct-surface.js`
- `src/renderer/t3-direct-surface.css`

Related specifications:

- `DIRECT_T3_ALTERNATE_GUI_EXPERIMENT.md`
- `DIRECT_WORKBENCH_AND_WORLDMANAGER_STUDIO_SPLIT_SPEC.md`
- `DIRECT_WORKBENCH_THREAD_INTAKE_SPEC.md`

## Purpose

Direct Workbench must be usable as a multi-project, thread-first work surface.
The current surface starts only the globally selected project and provides no
Direct-native way to inspect or activate another configured project.

DW-P1 adds a renderer-safe project directory and a main-owned activation
transition. It does not add project creation, edit project configuration, or
WorldManager project semantics.

## UX Bundle

```text
user archetype: expert operator
risk: medium; activation tears down and rebinds a runtime surface
trust sensitivity: configured substrate and runtime must remain explicit
interaction: inspect target evidence -> request activation -> observe transition

utility ranking:
  1. correct project/runtime activation
  2. fast project switching
  3. compact multi-project awareness
```

Invariants:

- the main process owns the catalog, eligibility, config mutation, and reload;
- the active project, target substrate, and target runtime are visible before
  activation;
- unknown, stale, blocked, activating, failed, and active are distinct states;
- an active turn or unresolved provider request blocks project switching;
- renderer project selection cannot mint runtime or workspace authority;
- raw workspace locators, auth material, and provider connection details do not
  enter the project-directory projection;
- project activation changes no WorldManager state.

Morphable choices:

- the directory may disclose inline in the sidebar or become a sheet at narrow
  widths;
- project-row density and secondary-label wrapping may change responsively;
- completed transition feedback may collapse after the active target is clear.

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
    project identity / directory disclosure
    project evidence rows
      configured substrate witness
      configured runtime witness
      activation eligibility and blockers
    activation request cluster
    Direct thread directory

  primary work region
    active Direct transcript and composer

  trust-boundary/status region
    Direct thread control-plane witness
    visible activation progress or failure
```

The project directory is a bounded state reveal inside the existing navigation
region. It does not replace the active transcript route. At narrow widths the
sidebar may expand or become the existing navigation sheet, but target evidence
remains reachable before activation.

## Artifact Decisions

| Artifact | Decision | Host-owned semantics |
| --- | --- | --- |
| project catalog | build one typed renderer-safe projection | identity, ordering, evidence, blockers, raw-exposure law |
| project activation | align existing config and `loadCodexSurface` owners behind a new bounded contract | revalidation, idempotency, rollback, active-turn gate |
| directory UI | compose inside the existing T3-informed sidebar | state posture, target evidence, activation boundary, responsive behavior |
| active-thread restoration | reuse the existing project activation binding | no inferred or cross-project thread identity |

## Renderer-Safe Projection

```text
direct_workbench_project_directory@1
  catalogRevision
  activeProjectId
  transition
  projects[]
    projectId
    displayName
    state
    selectable
    blockerCodes[]
    substrate
      workspaceKind
      environmentId
      displayLabel
      configured
    runtime
      runtimePath
      displayLabel
      configured
    restore
      available
      displayLabel
  authorityBoundary
```

The projection excludes `repoPath`, `localPath`, `linuxPath`, `windowsPath`,
`sourceHome`, `sessionFilePath`, raw provider URLs, remote auth, and config
mutation inputs. `catalogRevision` nevertheless commits to an internal digest of
the exact workspace, Codex runtime, and activation-binding configuration. A
private authority change therefore invalidates inspected evidence without
placing that authority-bearing value in the renderer projection.

## Activation Contract

The renderer submits only:

```text
clientActivationId
sourceProjectId
targetProjectId
expectedCatalogRevision
```

The main process first resolves a known `clientActivationId` as a bounded replay
from either the recorded source or target project. For a new activation it
revalidates:

1. the sender is the trusted Direct Workbench surface for `sourceProjectId`;
2. the expected catalog revision is current;
3. the target exists and differs from the source;
4. no other project activation is in progress;
5. no active Direct turn, in-flight App Server request, or unresolved provider
   request would be displaced;
6. the project activation binding still belongs to the target project.

Once accepted, main persists the selected project, tears down the old runtime,
loads the target runtime using the existing activation epoch, and restores only
the target project's configured thread binding. A failed load restores the prior
selected-project record and attempts to restore its surface. Client activation
IDs are idempotent across the surface reload and cannot be reused for a
different target.

## State Rendering

- `loading`: directory skeleton/status, never an empty-project claim;
- `available`: configured evidence visible and Switch action enabled;
- `blocked`: Switch remains visible but disabled beside blocker text;
- `activating`: target row and project header show an in-progress posture;
- `active`: authoritative only as the current main-owned selection;
- `failed`: warning surface with stable reason and retry path.

Activation is reversible navigation, not destructive authority. It still has a
visible boundary because it disposes and rebinds runtime state.

## Verification

Focused fixture coverage must prove:

- WSL, Windows, and local substrate projections expose labels, not locators;
- App Server, Direct text, and Direct implementation runtime bindings are
  distinguished;
- stale revision, invisible authority change, unknown target, active-turn,
  concurrent transition, and client-ID reuse fail closed;
- same request replay is idempotent before and after the target surface reload;
- renderer projections pass raw-exposure scanning;
- the Electron surface switches between WSL and Windows fixture projects,
  restores the target binding, and renders the new authoritative selection with
  no page or console errors.

## Deferred

- substrate discovery and port operations;
- cross-machine project catalogs;
- WorldManager project constitution or worldstate admission;
- richer project grouping, search, and recency ranking.
