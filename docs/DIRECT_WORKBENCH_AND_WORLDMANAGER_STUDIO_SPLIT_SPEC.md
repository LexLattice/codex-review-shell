# Direct Workbench And WorldManager Studio Split

Status: phase 2 active — Direct Workbench and WorldManager Studio share a
reviewed Direct kernel; DW-I1 thread intake is implemented.

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
  base_profile: artifact_inspector_alternate
  derivative_profile: direct_experience_split_v0
  profile_status: proposed_local
```

## Purpose

The application has two primary experiences with different controlling utility
hierarchies and interaction laws:

```text
Direct Workbench
  user -> active Direct thread -> tools/results
  controlling U: the active thread and task

WorldManager Studio
  user -> semantic settlement -> governed roles/worldstate
  controlling U: the admitted world/project hierarchy
```

This is an operational boundary, not a theme switch. Both experiences reuse the
Direct runtime kernel, but they do not claim the same conversational identity,
authority, or persistence semantics.

## Source Pack

Host sources:

- `src/main.js`
- `src/main/app-experience.js`
- `src/renderer/t3-direct-surface.html`
- `src/renderer/t3-direct-surface.js`
- `src/renderer/world-manager-surface.html`
- `src/renderer/world-manager-surface.js`
- `scripts/run-electron.mjs`
- `start-codex-review-shell.cmd`

Related specifications:

- `DIRECT_T3_ALTERNATE_GUI_EXPERIMENT.md`
- `DIRECT_WORKBENCH_THREAD_INTAKE_SPEC.md`
- `DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md`
- `DIRECT_WORLD_MANAGER_SEMANTIC_STANDBY_FRONTIER.md`

The T3-derived geometry remains a bounded frontend import. It provides layout
mechanics for Direct Workbench and owns no runtime or semantic authority.

## Shared Kernel, Separate Control Planes

```text
Direct runtime kernel
  provider/auth
  thread execution
  host substrates
  tools and approvals
  agent scheduling
  persistence and event capture

Experience projections
  Direct Workbench
    direct-thread control plane
    conventional Codex interaction law

  WorldManager Studio
    worldmanager-semantic control plane
    settlement, admission, and worldstate law
```

WorldManager may delegate implementation to Direct runtime workers. That does
not make a Direct Workbench conversation WorldManager-governed. Likewise, a
Direct result enters worldstate only through an explicit future import or
promotion operation.

## Experience Identity Contract

The canonical launch selector is:

```text
CODEX_EXPERIENCE=direct-workbench
CODEX_EXPERIENCE=world-manager-studio
CODEX_EXPERIENCE=legacy-shell
```

The older `CODEX_DIRECT_T3_GUI`, `CODEX_WORLD_MANAGER`, and
`CODEX_WORLD_MANAGER_MOCKUP` variables remain compatibility inputs. The main
process resolves them once into a frozen experience descriptor and projects a
non-authoritative public witness into the renderer bootstrap:

```text
appExperience {
  id
  label
  controlPlane
  interactionLaw
  rendererDocument
  variant
}
```

The renderer may display this witness. It cannot select or upgrade its own
experience.

## Invariants

- Direct Workbench messages reach the selected Direct thread without mandatory
  WorldManager settlement, reconciliation, or admission.
- WorldManager Studio messages enter the WorldManager semantic ingress path.
- Direct Workbench cannot call WorldManager authority-bearing IPC merely because
  both experiences reuse a preload and runtime process.
- Experience selection happens before the renderer document is selected.
- A renderer document cannot mint a different control-plane identity.
- Existing legacy shell and legacy launch flags remain available during the
  transition.
- Visible labels state which control plane is active.
- A layout preference changes no thread, worldstate, policy, or authority fact.

## Morphic Topology

Direct Workbench:

- navigation region: projects and Direct thread directory;
- primary work region: active Direct transcript and composer;
- evidence region: runtime and analytics inspectors;
- trust-boundary surface: persistent `Direct thread control plane` witness;
- handoff boundary: future explicit import into WorldManager.

WorldManager Studio:

- primary work region: unified WorldManager communication surface;
- evidence region: project ecology and semantic inspectors;
- governance region: decisions, admission, and lifecycle controls;
- trust-boundary surface: persistent `WorldManager semantic control plane`
  witness;
- handoff boundary: authorized delegation to Direct runtime workers.

The split changes identity and routing, not the responsive geometry already
defined by each surface.

## Thread Ingestion Taxonomy

The split defines three operations and does not collapse them into one generic
import:

```text
Direct Workbench
  1. resume_original_thread
  2. transplant_into_fresh_direct_thread

WorldManager Studio
  3. ingest_as_worldstate_evidence
```

Shared transcript acquisition and normalization may be reused. Identity,
context compilation, admission, and target U diverge after normalization.
DW-I1 now implements Direct operations 1 and 2 through one typed, renderer-safe
intake projection. WorldManager operation 3 remains deferred.

## Launch Surfaces

Canonical development commands:

```text
npm run dev:direct-workbench
npm run dev:world-manager-studio
npm run dev:world-manager-studio:mock
```

Canonical Windows launchers:

```text
start-direct-workbench.cmd
start-world-manager-studio.cmd
start-world-manager-studio-mock.cmd
```

The previous `dev:t3`, `dev:worldmanager`, `dev:worldmanager:mock`, and
`start-codex-review-shell-t3.cmd` names remain compatibility aliases.

## Deferred Work

- add provider-specific resume adapters beyond the current App Server durable
  thread identity path;
- implement WorldManager semantic ingestion and admission of external threads;
- decide whether simultaneous Direct Workbench and WorldManager Studio processes
  use separate Electron partitions while sharing canonical stores;
- narrow the renderer preload into experience-specific capability projections.

## Verification

Observed through real Electron windows under the headless/Xvfb harness:

```text
npm run direct:experience-split
npm run direct:thread-intake
npm run direct:t3-alternate-gui
npm run direct:t3-alternate-gui:electron
node scripts/direct-world-manager-launch-routing-regression.mjs
node scripts/direct-world-manager-semantic-ui-regression.mjs
node scripts/direct-world-manager-k1-ui-regression.mjs
node scripts/direct-world-manager-k4-ui-regression.mjs
node scripts/direct-world-manager-project-genesis-ui-regression.mjs
npm run check:main-syntax
```

The Direct Workbench Electron smoke verifies the bootstrap identity, visible
control-plane witness, restored project binding, Runtime/Analytics tenants, and
the project-bound thread-intake evidence dock, then attempts a WorldManager
snapshot call from the trusted Direct renderer.
The main process rejects it before initializing the WorldManager service. The
WorldManager launch smoke verifies the separate production document, title,
and semantic control-plane bootstrap envelope.
