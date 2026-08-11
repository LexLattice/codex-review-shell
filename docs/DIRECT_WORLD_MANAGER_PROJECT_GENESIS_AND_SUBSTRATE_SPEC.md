# Direct WorldManager Project Genesis And Substrate Constitution

Status: `WM-K5G`, `WM-K6G`, `WM-K6G.1`, and `WM-ENV1` are implemented and
locally regression-proven. Project-genesis open decisions are promoted through
the `WM-SC3` semantic artifact kernel. An admitted project can now be bound to
a native WSL or Windows workspace, proved through a harmless resident probe,
and frozen into an immutable WorkThread environment binding and exact step
snapshot. Authoritative hierarchical project-world activation remains the next
constitutional slice.

Date: 2026-07-31.

Parent specifications:

- [Direct World Manager Agent-World And Unified UX Spec](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md)
- [Direct WorldManager Keyboard Pipeline Integration Spec](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md)
- [Direct Wave 24 Environment And Async Work Spec](./DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md)

## Practical Goal

From the unified WorldManager conversation, the operator can describe a new
project, inspect a grounded ranking of currently realizable agent substrates,
admit one project constitution, and recover the same default substrate after
restart.

The admitted default is a project-level constitutional binding:

```text
Project constitution default
  -> inherited by new project threads
  -> immutable inside an existing thread runtime binding
  -> changed only by a later explicit project-port operation
```

An admitted project without a provisioned workspace renders truthfully as:

```text
canonical · awaiting provisioning
```

Such a constitution is a project-level semantic object but not yet a
focusable runtime project. Project-card activation therefore follows:

```text
click project card
  -> inspect the same project object

explicit "Make active context"
  -> available only to configured runtime projects

canonical + awaiting_workspace_provisioning
  -> inspection available
  -> runtime focus unavailable

canonical + workspace_provisioned
  -> native Direct runtime is addressable
  -> environment lineage is inspectable
  -> authoritative project-world focus remains unavailable
     until a separate worldmodel activation transition
```

Candidate `openDecisions` are migrated idempotently into the `WM-SC3` semantic
artifact registry. They receive stable identity, revision lineage,
semantic-relay or explicitly authored resolution modes, exact candidate
provenance, and `project_open_decisions` shelf membership. They are not
confused with historical remand lineages. Their resolution contracts use the
implemented `WM-SC5` governed transition path; resolving a decision does not
implicitly authorize substrate provisioning or a port operation.

Project identity becomes visible immediately after a reconciled
`ProjectConstitutionCandidate` is registered:

```text
candidate + reconciled + not_reviewed
  -> provisional Project Ecology card
  -> counted separately from established projects
  -> inspection available
  -> runtime focus unavailable

candidate + reconciled + reviewed
  -> same project id and same card identity
  -> explicit admission available

admitted + awaiting_workspace_provisioning
  -> same project id becomes canonical
  -> candidate count decrements; established-project count increments
  -> no duplicate card
  -> runtime focus remains unavailable
```

provisioned
  -> same canonical project identity acquires ProjectWorkspaceBinding
  -> raw native locator remains backend-private
  -> resident adapter proves platform, project, workspace, and process identity
  -> WorkThread receives immutable ThreadEnvironmentBinding
  -> the activation step receives an exact StepEnvironmentSnapshot
  -> project remains non-focusable until project-world graph activation

## Authority And Evidence Pipeline

```text
current user project idea
  -> world-scoped project_initialization settlement
  -> harness-observed RealizationOptionSnapshot
  -> compiled WorldManager project-genesis role
  -> typed ProjectGenesisResult
  -> WorldManager reconciliation
  -> ProjectConstitutionCandidate
  -> same-context evidence review
  -> explicit operator admission
  -> canonical ProjectConstitution
  -> immutable ProjectRuntimeDefaultBinding
  -> explicit native workspace selection
  -> backend-private ProjectWorkspaceLocator
  -> harmless resident EnvironmentProbeReceipt
  -> canonical ProjectWorkspaceBinding
  -> immutable ThreadEnvironmentBinding
  -> exact StepEnvironmentSnapshot
```

The harness owns realization discovery. The model may rank only the options in
the supplied snapshot and cannot turn an unavailable substrate into an
available one. The UI projects evidence and authority; it does not mint either.

## Contracts

### Realization option snapshot

```text
RealizationOptionSnapshot {
  snapshotId
  controlPlaneEnvironmentId
  options[] {
    environmentId
    environmentKind
    displayLabel
    availability
    admissionState
    nativeProcess
    residentExecutorSupport
    defaultShell
    capabilityClasses
    evidenceRefs
  }
  observedAt
  digest
}
```

Availability is one of:

```text
ready
degraded
unavailable
unknown
```

Only `admissionState = eligible` can become the primary project substrate.

### Typed WorldManager result

```text
ProjectGenesisResult {
  schema: direct_world_manager_project_genesis_result@1
  semanticSummary
  projectConstitution {
    proposedProjectId
    name
    summary
    primaryAgentEnvironmentId
    allowedEnvironmentIds
    gitAuthorityEnvironmentId
  }
  realizationRecommendations[] {
    rank
    environmentId
    rationale[]
    tradeoffs[]
  }
  openDecisions[]
}
```

### Candidate and admission

```text
ProjectConstitutionCandidate {
  candidateId
  sourceSemanticEventRef
  realizationSnapshotRef
  proposedProjectId
  identity
  purpose
  primaryAgentEnvironmentId
  allowedEnvironmentIds
  gitAuthorityEnvironmentId
  rankedRecommendations
  evidenceReviewState
  reconciliationState
  lifecycle
}

ProjectConstitution {
  projectId
  identity
  purpose
  primaryAgentEnvironmentId
  allowedEnvironmentIds
  gitAuthorityEnvironmentId
  constitutionRevision
  authorityEpoch
  activationState
  admittedFromCandidateRef
  admissionDecisionRef
}

ProjectRuntimeDefaultBinding {
  projectId
  constitutionRef
  defaultEnvironmentId
  allowedEnvironmentIds
  gitAuthorityEnvironmentId
  bindingRevision
  threadInheritanceRule
}
```

### ENV1 substrate runtime

```text
ProjectWorkspaceLocator {                 # backend-private
  projectId
  environmentId
  workspaceKind
  nativeWorkspacePath
  distro?
  windowsNodePath?
  rendererProjectionAllowed: false
  semanticAuthority: none
}

EnvironmentProbeReceipt {
  projectId
  environmentId
  workspaceKind
  adapterKind
  probeState
  nativePlatform
  backendSessionRef
  processContinuityObserved
  workspaceIdentityMatched
  capabilityClasses
  blockerCodes
  executionAuthority: probe_only
  workspaceMutationEffect: false
}

ProjectWorkspaceBinding {
  projectId
  runtimeDefaultBindingRef
  environmentId
  workspaceKind
  workspaceIdentityDigest
  locatorRef
  probeRef
  adapterAuthority: execution_only
  portOperationRequiredToChange: true
}

ThreadEnvironmentBinding {
  projectId
  threadId
  workThreadId
  projectRuntimeDefaultRef
  workspaceBindingRef
  primaryEnvironmentId
  selectedEnvironmentIds
  allowedEnvironmentIds
  immutableForThreadLifetime: true
}

StepEnvironmentSnapshot {
  threadEnvironmentBindingRef
  stepId
  primaryEnvironmentId
  readyEnvironments
  selectedEnvironmentIds
  snapshotPosture: exact_ready_step_environments
}

ChildEnvironmentInheritance {
  parentStepEnvironmentSnapshotRef
  childThreadId
  primaryEnvironmentId
  inheritedEnvironmentIds
  inheritanceMode: exact_parent_step_snapshot
  ambientProjectDefaultReevaluated: false
}
```

Raw paths are operational substrate coordinates, not semantic truth. They are
stored only in the backend-private locator. Renderer and provider packets carry
typed refs, identity digests, readiness posture, and exact environment IDs.

The project default is consulted when a new top-level thread is constituted.
Once a step starts, its environment snapshot is fixed. A child worker inherits
that exact parent-step snapshot; it does not re-read an ambient project default.
Changing the project default therefore requires a future explicit port
operation and never rewrites already-bound threads.

Admission is idempotent by candidate id and fails closed when:

- evidence review is incomplete;
- WorldManager reconciliation is incomplete;
- the selected realization option is no longer eligible;
- the project id already belongs to a different constitution;
- the candidate or realization snapshot digest is stale.

## Morphic UX Bundle

```yaml
ux_domain_packet:
  primary_user: expert_operator
  tasks:
    - describe_project
    - compare_realization_options
    - inspect_candidate_lineage
    - admit_project_constitution
    - select_native_workspace
    - inspect_environment_lineage
  risk_level: high
  trust_sensitivity: authority_and_evidence_sensitive
  interaction_mode: analysis_then_commit
  utility_ranking:
    - truth_calibration
    - error_prevention
    - operator_speed

ux_morph_ir:
  invariants:
    - realization evidence visible before admission
    - recommendation remains advisory
    - candidate and canonical states materially distinct
    - admission is an explicit operator action
    - unavailable options remain visible with their blocker
    - provisioning absence is never rendered as readiness
    - raw native locators never enter renderer projection
    - provisioned substrate is distinct from project-world activation
    - child threads inherit the exact parent-step environment snapshot
  morphable:
    - recommendation card density
    - progressive evidence disclosure
    - narrow-layout stacking

ux_surface_projection:
  workbench_root: bounded-worldmanager-workbench
  regions:
    - unified-communications-region
    - project-ecology-region
    - same-context-semantic-evidence-region
  lanes:
    - project-genesis-candidate-lane
    - realization-evidence-lane
    - advisory-recommendation-lane
    - constitution-commit-lane
    - native-substrate-provisioning-lane
  action_clusters:
    - inspect-evidence
    - admit-constitution
    - provision-native-substrate
  state_surfaces:
    - candidate
    - evidence-reviewed
    - canonical-awaiting-provisioning
    - canonical-substrate-provisioned
    - worldmodel-activation-pending
    - blocked-or-stale

ux_interaction_contract:
  candidate_precondition: validated typed result and reconciled lineage
  review_consequence: evidenceReviewState becomes reviewed
  admission_precondition: candidate + reviewed + reconciled + eligible realization
  admission_consequence: canonical constitution and runtime default binding
  provisioning_precondition: canonical constitution + eligible default + explicit native workspace
  provisioning_consequence: private locator + ready probe + canonical workspace binding + immutable WorkThread environment snapshot
  failure_surface: visible blocker; candidate remains non-canonical
```

Profile lineage:

```yaml
base_profile: artifact_inspector_alternate
derivative_profile: worldmanager_project_genesis_admission
profile_status: proposed_local
axes:
  density: medium
  navigation_mode: hub_and_spoke
  information_posture: task_first
  interaction_tempo: guided
  salience_posture: action_and_diagnostics_prominent
  state_exposure: progressive
  command_posture: safe_buffered
```

Evidence remains same-context reachable through the existing semantic-zoom
surface. Responsive layouts may stack the candidate and evidence lanes but may
not hide realization availability or the admission gate behind a route change.

## Implementation Stages

### WM-K5G — genesis candidate

- discover native realization options;
- settle `project_initialization` at user-world scope;
- compile the dedicated WorldManager role/output contract;
- persist a validated constitution candidate after reconciliation;
- render ranked options as advisory evidence.

### WM-K6G — semantic admission

- record same-context evidence review;
- require explicit candidate-id admission;
- persist the canonical project constitution;
- persist the immutable project runtime default binding;
- render `canonical · awaiting provisioning`;
- verify restart reconstruction and ledger continuity.

### WM-ENV1 — native project substrate and thread inheritance

- accept an explicit native workspace only after constitution admission;
- keep raw WSL/Windows locators backend-private;
- attach the Direct resident adapter with workspace hygiene disabled for the
  activation probe;
- prove native platform, project id, workspace identity, process continuity,
  and capability classes;
- persist the canonical `ProjectWorkspaceBinding` in the same control-plane DB;
- create a real project-substrate WorkThread;
- freeze its primary environment in an immutable thread binding;
- persist the exact ready environment set for the activation step;
- carry typed environment refs into Direct worker provider context;
- materialize exact parent-step inheritance when a worker session is created;
- require a future explicit port operation to change a bound project default.

### Following constitutional slice

- promote the provisioned project into the authoritative hierarchical
  worldmodel without bypassing graph governance;
- make project focus depend on that exact graph-activation witness;
- define the explicit project-port operation and custody migration protocol;
- add multi-environment step selection when a task lawfully requires both WSL
  and Windows rather than only the project primary.

## Implemented Evidence

The local implementation now includes:

- harness-owned WSL/Windows realization discovery;
- a native Windows resident workspace-agent transport launched from WSL;
- world-scoped `project_initialization` settlement;
- a dedicated compiled WorldManager project-genesis role and strict result
  contract;
- persisted realization snapshots and non-canonical constitution candidates;
- same-context evidence review and explicit operator admission IPC;
- canonical project constitutions and immutable runtime-default bindings;
- backend-private native workspace locators and canonical renderer-safe
  workspace bindings;
- harmless readiness receipts for native WSL and native Windows resident
  processes;
- real WorkThread environment bindings, exact step snapshots, and child
  inheritance contracts;
- typed environment refs in the Direct worker context packet;
- a project-genesis provisioning form and truthful
  `worldmodel activation pending` posture;
- restart reconstruction with ledger verification;
- backward-compatible restart reconstruction for pre-K5G compilations whose
  pinned role-template registry and renderer summary predate the realization
  evidence fields;
- a project-genesis workbench card and semantic-zoom authority witness.

Regression witnesses:

```text
npm run direct:world-manager-project-genesis
npm run direct:world-manager-project-genesis-ui
npm run direct:project-substrate-runtime
npm run direct:native-project-substrate-executors
```

The native executor regression observed `platform = win32` from the resident
Windows Node process and `platform = linux` from the WSL process. Both reused
the same attached session for a second request, and both activation probes
reported zero workspace-hygiene mutation. This proves native substrate
identity and Direct adapter continuity. It does not claim authoritative
project-world graph activation.
