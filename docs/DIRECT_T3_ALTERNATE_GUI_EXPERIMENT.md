# T3-Informed Alternate Direct GUI Experiment

Status: geometry experiment promoted into Direct Workbench, 2026-08-10.

This experiment placed a T3-informed shell geometry over the existing Direct
renderer/runtime contract. The geometry is now the frontend of the named
Direct Workbench experience. It is not a second Direct implementation and not
a WorldManager semantic slice. The experience boundary is specified in
`DIRECT_WORKBENCH_AND_WORLDMANAGER_STUDIO_SPLIT_SPEC.md`.

## Run Stance

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
  derivative_profile: direct_shell_t3_alternate_gui_v0
  profile_status: proposed_local
```

## Source Pack

Reference repository:

- local checkout: `/home/rose/work/t3code`
- inspected revision: `2c7267ad43a05cf3e30343400c76fd9ac47698e7`
- license: MIT

Primary reference artifacts:

- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/RightPanelTabs.tsx`
- `apps/web/src/rightPanelStore.ts`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/settings/settingsLayout.tsx`
- `apps/web/src/components/CommandPalette.tsx`

Host artifacts:

- `src/main.js`
- `src/preload-codex-surface.js`
- `src/renderer/codex-surface.html`
- `src/renderer/codex-surface.css`
- `src/renderer/codex-surface.js`

No T3 backend, state store, provider contract, server package, or semantic
command grammar is imported. The T3 React frontend depends on its monorepo
contracts, client runtime, Effect atoms, TanStack Router, Zustand state, and
server resource model. Transplanting it whole would produce a second control
plane and obscure which runtime owns an action. The bounded import therefore
uses its current shell topology and interaction mechanics while retaining the
already working Direct renderer bridge.

## Structural Reading

T3's current dynamic geometry settles into these main regions:

```text
resizable/collapsible project + thread sidebar
  | primary thread workspace
  |-- compact thread header
  |-- central agent transcript
  |-- inline plan/result artifacts
  |-- anchored composer
  |
  + optional thread-scoped right-panel surface
       browser | terminal | files | file | diff | agents

settings replaces the sidebar's normal content
command palette provides cross-region navigation/actions
small viewports convert side regions into sheets
```

The right panel is a shallow workspace model: it owns ordered surface
descriptors and the active surface while each feature owns its durable state.
Only one surface is visually active. This is useful geometry for Direct even
though Direct's current v0 tenants are Runtime and Analytics.

## Invariants And Morphable Properties

Invariants:

- existing Direct IPC/preload/session contracts remain the only operational
  backend;
- the renderer receives the main process encoded bootstrap payload and cannot
  select a different connection or project authority;
- transcript events, approvals, attachments, thread restore, runtime settings,
  and Direct projections keep their present owners;
- unavailable tenants are visibly unavailable; no placeholder may imply a
  terminal, browser, file tree, or diff backend exists;
- WorldManager stores and IPC are untouched by this experiment;
- the normal three-plane shell and WorldManager launch modes remain available.

Morphable:

- region geometry, spacing, colors, type scale, borders, and icon treatment;
- thread directory orientation and density;
- whether inspectors overlay, dock inline, or become responsive sheets;
- local UI preference for collapsed navigation and selected inspector;
- labels and compact explanatory copy that do not alter semantic meaning.

## V0 Artifact Inventory

| Artifact | Truth source | Visible region | Authority |
| --- | --- | --- | --- |
| selected project | signed/encoded main-process bootstrap payload | left sidebar/header | display only |
| project directory | typed renderer-safe main-process projection | bounded sidebar reveal | evidence-gated main-owned activation |
| project binding editor | revision-bound typed draft and main mutation receipt | right dock | provisional create/edit request; main owns identity, persistence, reload, and rollback |
| project lifecycle | revision-bound typed lifecycle draft and main receipt | right dock plus archived directory reveal | reversible archive/restore; archived-only exact-confirmation binding deletion |
| Direct thread directory | bounded normalization of Direct thread deck or App Server `thread/list` | left sidebar | runtime-specific read/resume focus gate and existing new-thread action |
| transcript and turn state | existing `codex-surface:event` stream | central workspace | existing composer/turn protocol |
| model, effort, access, quota, context | existing Direct runtime witness and preference APIs | composer/header | existing controls only |
| Runtime inspector | existing runtime constitution/projection | right dock | existing read/control actions |
| Analytics inspector | existing runtime analytics projection | right dock | display only |
| Thread intake | typed main-process intake projection and read-only import store | right dock | evidence-gated resume or fresh Direct continuation |
| terminal/files/diff/browser | no v0 Direct tenant adapter | utility rail | disabled with explicit explanation |

## Evidence And Authority Rules

```text
visible success
  requires the same existing runtime or receipt witness

button enabled
  requires an existing renderer action and backend capability

surface unavailable
  remains disabled and says why

alternate layout selected
  changes no project, thread, runtime, policy, or worldstate fact
```

The utility rail is navigation, not authorization. Opening Runtime or
Analytics reveals existing evidence. It creates no new evidence and grants no
effect.

## Responsive Law

- Above 1100 px, the thread directory is a stable left column and inspectors
  dock at the right edge.
- Between 720 and 1100 px, the thread directory compresses and inspectors become
  overlays.
- Below 720 px, the directory becomes a compact horizontal thread strip and
  the utility rail moves into the header band.
- The composer and active turn controls must remain reachable at every width.

## Launch Boundary

Direct Workbench is explicit:

```text
CODEX_EXPERIENCE=direct-workbench node ./scripts/run-electron.mjs .
```

or:

```text
npm run dev:direct-workbench
```

The old `CODEX_DIRECT_T3_GUI=1` and `npm run dev:t3` entrypoints remain
compatibility aliases. Direct Workbench opens one full-window Direct
`WebContentsView` using the existing Codex surface preload and connection
authority. Selecting another experience requires no data migration.

## Current Verification

The v0 surface has been launched under an isolated Xvfb profile through the
real Electron main process. The observed document was
`t3-direct-surface.html`; the window reached the existing Direct/Appserver
connection boundary, rendered the three-region geometry, and exited cleanly.
An isolated fixture-backed Electron interaction smoke additionally opens the
real Runtime, Analytics, and Thread Intake tenants, proves their exclusive
right-panel selection, lists and focuses project-scoped Direct fixture threads,
keeps directory rows adjacent to their heading, inspects the project substrate
and both identity dispositions, switches from a WSL project to a Windows
project through the main-owned project directory, proves the thread inventory
changes with project scope, restores the target thread binding, collapses and
restores the thread sidebar, records screenshots, and fails on renderer
console/page errors. It also exercises an inactive binding through archive,
same-context archived reveal, same-ID restore, and archived-only exact-phrase
deletion while proving no substrate or thread evidence is deleted. The focused source regression also
proves that the alternate document preserves every DOM identity required by
the base Codex renderer contract, retains trusted managed-surface URL
recognition, and keeps unavailable tenants disabled.

```text
npm run direct:t3-alternate-gui  -> passed
npm run direct:t3-alternate-gui:electron -> passed
npm run direct:project-directory -> passed
npm run direct:thread-directory  -> passed
npm run direct:thread-intake     -> passed
npm run check:main-syntax        -> passed
isolated Electron/Xvfb smoke     -> exit 0
```

## Deferred Tenants

Later bounded slices may connect existing or new Direct adapters for terminal,
file tree/file preview, diff, browser preview, and command palette. Each must
name its owner, authority, evidence, responsive behavior, and recovery posture
before its utility-rail control becomes enabled.
