# Direct WorldManager Semantic Mockup

Status: implemented exploratory vertical slice; not a production resident
WorldManager.

Date: 2026-07-26.

Parent doctrine:
[Direct World Manager Agent-World And Unified UX Spec](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md).

Production-oriented successor:
[Direct WorldManager Keyboard Pipeline Integration Spec](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md).

Visual reference:
[Minimal Unified World Manager Storyboard](./assets/world-manager-ux/storyboard/README.md).

## Purpose

Test the defining interaction before generalizing the architecture:

```text
one user message
  -> WorldManager task settlement
  -> bounded Project Manager instantiation
  -> Project Manager final response visible in one conversation
  -> same AgentResult relayed to WorldManager reconciliation
  -> provisional PlanProposal
  -> same-context evidence inspection
  -> explicit operator greenlight
  -> canonical ImplementationContract
  -> active WorkThread without a completion claim
```

The mockup is deliberately narrower than the parent target. It proves semantic
composition and truthful projection over one project-planning task class.

## Launch

From the repository root:

```bash
npm run dev:worldmanager:mock
```

The dedicated mode opens the WorldManager workbench without the existing shell,
ChatGPT web plane, or legacy Codex console.

The header selects one of two reasoning paths:

- `Deterministic fixture`
  - exercises the complete interaction without provider transport;
- `Live Direct`
  - performs three authenticated Direct text turns:
    - WorldManager routing;
    - Project Manager formulation;
    - WorldManager reconciliation.

Live Direct fails visibly when authentication is unavailable, transport fails,
or a role does not return the required structured result. It does not silently
replace a failed live result with fixture truth.

## Implemented Contracts

The implementation in
`src/main/direct/worldmanager/semantic-mockup.js` defines:

```text
direct_world_manager_semantic_event@1
direct_world_manager_task_settlement@1
direct_world_manager_agent_instantiation@1
direct_world_manager_agent_result@1
direct_world_manager_plan_proposal@1
direct_world_manager_implementation_contract@1
direct_world_manager_semantic_mockup_state@1
direct_world_manager_semantic_mockup_projection@1
```

Every visible transition carries a stable semantic event identity, parent event
links, artifact references, epistemic state, authority state, and renderer-safe
summary.

The Project Manager instantiation is intentionally bounded:

```text
may formulate a response
may not admit canonical state
may not start implementation
has no workspace mutation capability
has no remote mutation capability
must return an AgentResult
```

The `AgentResult` keeps semantic content and deterministic telemetry separate.
Its final assistant message is the semantic anchor. Runtime, model, token
availability, tool-call count, tool names, and duration remain harness/provider
telemetry.

## Persistence

Mockup state is atomically persisted below the active Electron user-data root:

```text
world-manager-semantic-mockup/semantic-mockup-state.json
```

The persisted state excludes raw provider payloads and private chain-of-thought.
The surface exposes typed routing, constitution, result, reconciliation,
admission, contract, and lineage artifacts instead.

## UX Bundle

Run stance:

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: runtime_exercised
  runtime: not_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: worldmanager_unified_semantic_workbench
  profile_status: proposed_local
```

Source pack:

```yaml
source_pack:
  doctrine_sources:
    - docs/DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md
  visual_sources:
    - docs/assets/world-manager-ux/storyboard/README.md
    - docs/assets/world-manager-ux/storyboard/01-calm-resting-world.png
    - docs/assets/world-manager-ux/storyboard/05-semantic-zoom-and-admission.png
    - docs/assets/world-manager-ux/storyboard/06-contract-and-execution.png
  host_sources:
    - src/main/direct/worldmanager/semantic-mockup.js
    - src/main/direct/transport/codex-responses-transport.js
    - src/preload-codex-surface.js
    - src/renderer/world-manager-surface.html
    - src/renderer/world-manager-surface.css
    - src/renderer/world-manager-surface.js
  runtime_observations:
    - fixture semantic state-machine regression
    - Playwright desktop interaction
    - Playwright narrow same-context evidence morph
    - dedicated Electron startup smoke
```

Invariant topology:

```text
status region
  world posture + reasoning path

primary work region
  global infographic lane
  unified conversation lane
  one transition-request composer

project/evidence region
  active / semi-active / inactive project projections
  reconciliation surface
  proposal and admission lane
  canonical contract surface

same-context evidence lane
  TaskSettlement
  AgentInstantiation
  AgentResult
  WorldManager reconciliation
  SemanticEvent lineage
```

The proposal and evidence controls are advisory. Greenlight is a distinct
commit cluster and remains disabled until:

```text
proposal.state == candidate
proposal.reconciliationState == reconciled
proposal.evidenceReviewState == reviewed
```

The UI records inspection but does not treat inspection as admission. Only the
explicit greenlight transition creates canonical state.

## Verification

```bash
npm run direct:world-manager-semantic-mockup
npm run direct:world-manager-semantic-ui
CODEX_REVIEW_SHELL_SMOKE_EXIT_MS=5000 npm run dev:worldmanager:mock
```

The regressions prove:

- the Project Manager result becomes visible before reconciliation completes;
- candidate state is not rendered as canonical;
- early admission is rejected;
- evidence inspection does not itself admit;
- greenlight creates the canonical proposal, contract, and active WorkThread;
- active work remains distinct from completed work;
- persistence survives coordinator reconstruction;
- invalid semantic-role output fails visibly;
- narrow layout preserves same-context access to every required evidence object.

## Remaining Production Boundary

This slice does not claim:

- a continuously running resident WorldManager outside the mockup surface;
- general task classification;
- general role-template compilation;
- mechanical `PolicyObject` inheritance;
- enforcement agreement across prompt, tools, approval, evaluator, and runtime;
- revisioned proposal refinement;
- real worker execution from the mock contract;
- multi-project concurrent orchestration;
- voice or app-server routing;
- production migration of the existing renderer.

Those remain governed by the parent implementation sequence. This mockup exists
to make the interaction falsifiable before those broader systems are built.
The keyboard pipeline integration spec now defines how to replace the parallel
mock world with adapters over the accepted Direct worldmodel, session,
authorization, and WorkThread stores.

`npm run dev:worldmanager` now launches the production `WM-K2` settlement
surface. It binds to the authoritative graph and prepares graph-first manager
context, but still stops before role cognition or candidate creation. The mock
remains explicitly named and isolated so production IPC cannot silently
acquire fixture semantics.
