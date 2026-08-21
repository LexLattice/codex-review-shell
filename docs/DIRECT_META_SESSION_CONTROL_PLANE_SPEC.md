# Direct Meta-Session Control Plane Spec

Status: high-level design specification for the long-lived
`codex/direct-chatgpt-harness` branch.

Source context: ProgramBench/ADEU-studio experiments exposed the failure mode.
This document translates that lesson into the Direct harness architecture.

Related docs:

- [META_ORCHESTRATOR_LOOP_ODEU_SPEC.md](./META_ORCHESTRATOR_LOOP_ODEU_SPEC.md)
- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_META_SESSION_CONTROL_PLANE_IMPLEMENTATION_SPEC.md](./DIRECT_META_SESSION_CONTROL_PLANE_IMPLEMENTATION_SPEC.md)
- [DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md](./DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md)
- [DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md](./DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

## Purpose

Define the Direct harness layer that can run a three-depth agentic stack:

```text
human
  -> meta-session governor / meta-orchestrator
      -> session orchestrator
          -> workers
```

The goal is not merely nested delegation. The goal is to make procedural
identity, jurisdiction, instruction inheritance, and run authority first-class
harness objects.

The ProgramBench lesson is:

```text
An orchestrator that both governs procedure and chases the task objective will
eventually drift toward "win the task" behavior under U-pressure.
```

Direct needs a narrower authority above the ordinary orchestrator:

```text
meta-orchestrator U:
  preserve procedure identity and session jurisdiction

orchestrator U:
  solve the scoped task inside the locked contract

worker U:
  produce the required phase artifact only
```

## Core Thesis

`Session` is not a thread id, project folder, branch, chat transcript, or agent
process. It is a meta-artifact above those objects.

```text
Session
  owns purpose, jurisdiction, active contracts, contexts, authority, run state,
  amendment law, evidence ledgers, and cross-context routing.

ExecutionContext
  is one concrete place work can happen: a thread, folder, branch, runtime lane,
  or external workspace.

RunContract
  is the locked ODEU/profile artifact that governs one workflow under the
  Session.
```

This separation lets a single meta-session own multiple active work branches
without relying on the human or the local orchestrator to keep context
jurisdictions separate in prose.

Example:

```text
Session: codex-review-shell
  context A:
    repo: /home/rose/work/LexLattice/codex-review-shell-direct
    branch: main
    jurisdiction: baseline, UX, app-server compatibility

  context B:
    repo: /home/rose/work/LexLattice/codex-review-shell-direct
    branch: main
    jurisdiction: Direct provider path and harness-native control plane
```

A human can speak in the meta-session surface. The meta-orchestrator routes the
input to the correct context or asks for disambiguation when the jurisdiction is
not inferable.

## Implementation Naming Law

This document uses `Session` for the conceptual layer, but implementation
artifacts must use `MetaSession` names to avoid colliding with the existing
Direct provider session store.

```text
DirectSessionStore:
  owns provider/runtime sessions, turns, tool obligations, and local results

DirectMetaSessionStore:
  owns procedure identity, context registries, run contracts, transition claims,
  instruction packages, route artifacts, current pointers, and the
  meta-session event ledger
```

Implementation schemas should use explicit names:

```text
direct_meta_session@1
direct_execution_context_registry@1
direct_run_contract@1
direct_instruction_package@1
direct_cross_context_route@1
direct_transition_guard_result@1
direct_meta_current_pointer_set@1
direct_meta_session_event_ledger@1
```

Law:

```text
MetaSessionStore != DirectSessionStore
provider session id != meta-session id
turn recovery state != meta-session lifecycle state
```

## Non-Goals

- Do not make the meta-orchestrator a hidden technical super-agent.
- Do not let the meta-orchestrator patch code, chase scores, interpret object
  failures, or override auditors by default.
- Do not treat a Codex thread id as the Session identity.
- Do not treat a repo path or branch as the Session identity.
- Do not let worker prompts blindly inherit all project `AGENTS.md` content.
- Do not allow contract amendments through ordinary assistant prose.
- Do not promote sub-agent transcript text into parent authority without a
  typed witness.
- Do not let UI tab selection or labels mutate Session truth.

## Authority Split

```text
Human:
  creates sessions, approves high-risk amendments, can override/stop/archive.

Meta-session governor:
  owns session jurisdiction, contract locking, transition legality,
  run classification, cross-context routing, amendment gating, and stop policy.

Session orchestrator:
  owns task planning and object-level work routing inside the locked contract.

Worker:
  owns one phase artifact or bounded analysis packet.

Auditor/HOB role:
  owns object-level validation for a declared artifact class.

Deterministic harness broker:
  enforces locked policy exogenously: transition guard, instruction compiler,
  context compiler, ledger append, authority gate, and run reclassification.
```

Law:

```text
orchestrator intent != transition authority
worker completion claim != validated artifact
meta-orchestrator judgment != object-level correctness
contract diagnostic != enforce mode
contract amendment != ordinary run event
```

## ODEU Layers

The local `CODEX_REVIEW_SHELL_ODEU_PROFILE.md` adds an important implementation
method that this spec should reuse:

```text
state object
  -> transition claim
  -> authority evidence
  -> protected surfaces
  -> validation row
```

For the meta-session control plane, this means every new capability starts by
naming the state object that owns truth, then the legal transition, then the
evidence that permits mutation or status projection. UI affordances and worker
packets are downstream projections of that chain.

### Session Meta-ODEU

The Session has its own ODEU profile:

```yaml
ontology:
  session
  execution_context
  run_contract
  role_profile
  transition_request
  evidence_ledger
  amendment_epoch
  cross_context_route

deontics:
  who may create, lock, amend, reclassify, stop, archive, fork, and route

epistemics:
  what evidence proves active context, current run state, jurisdiction,
  contract version, contamination state, and worker status

utility:
  preserve session continuity, jurisdiction boundaries, and procedure identity
```

### Local Run ODEU

Each thread/workspace/run has a narrower local profile:

```yaml
ontology:
  task artifacts
  phase artifacts
  worker outputs
  local evidence
  local blockers

deontics:
  allowed tools, phase transitions, worker roles, mutation boundaries

epistemics:
  required evidence per phase, report schema, validation gate

utility:
  complete the scoped task under the locked contract
```

The local run ODEU is subordinate to the Session meta-ODEU.

## HOB / OTB / BRL For MetaSession

The current shell profile separates three useful obligations. The meta-session
control plane should import that split directly.

### HOB: Obligation Inheritance

HOB asks:

```text
When this MetaSession state-object class applies, which child obligations are
inherited?
```

Every nontrivial MetaSession state object must mark child obligations as:

```text
covered
proved_irrelevant
pass_through
deferred_with_risk
blocked_pending_evidence
```

Example:

```text
DirectRunContract applies
  -> jurisdiction evidence
  -> role graph
  -> transition policy
  -> amendment policy
  -> instruction inheritance policy
  -> source-ref redaction
  -> stale-context policy
  -> recovery policy
  -> validation probes
```

### OTB: Transition Legality

OTB asks:

```text
Is this phase/action/session transition legal?
```

Every nontrivial action emits a transition claim before mutation:

```yaml
transition_claim:
  transition_id: AcceptCrossContextRoute
  from_state: route_proposed
  to_state: route_accepted
  object_refs:
    - DirectMetaSession
    - DirectRunContract
    - DirectExecutionContextRegistry
  evidence_required:
    - active_contract_digest
    - proposal_digest
    - context_digest_match
    - ledger_head_match
  evidence_forbidden:
    - renderer tab selection as active context truth
    - stale route proposal as dispatch authority
  allowed_failure_states:
    - route_stale
    - context_jurisdiction_ambiguous
    - human_approval_required
```

### BRL: Behavior Replay Locks

BRL asks:

```text
Did this patch preserve previously locked behavior on protected surfaces?
```

Meta-session work touches shared renderer/status concepts, so preservation locks
should exist before extracting or enforcing common projection logic. Example:

```yaml
lock_id: meta_session_context_identity_projection_preserved
owner_surface: MetaSessionStatusProjection
protected_surfaces:
  - direct_runtime_status_drawer
  - operation_history_rows
  - future_meta_session_workbench
canonicalization_profile: renderer_safe_text_without_timestamps
failure_meaning: protected_projection_changed_not_product_truth
```

BRL does not decide whether a patch is correct. It says a protected observation
changed and needs review.

## Upstream Discriminator Law

The recursive ODEU meta-program adds one method that matters especially for a
new control plane: when two behavior branches conflict, do not choose a broad
local patch merely because one branch is currently red.

Repair path:

```text
branch A expected behavior conflicts with branch B expected behavior
  -> move upward to the smallest shared state object, transition, or projection
  -> name the flat rule that made the branches collide
  -> derive the missing upstream discriminator
  -> create counterfactual probes that differ only by that discriminator
  -> retain the previously green branch as a regression lock
  -> implement only after the discriminator is explicit in the contract
```

For this spec, an upstream-discriminator row is required when app-server/direct,
meta-session/local-session, current/stale projection, shadow/enforce, or
parent/child context behavior would otherwise be handled by one flattened rule.

```ts
type DirectMetaUpstreamDiscriminatorRowV1 = {
  schemaVersion: "direct_meta_upstream_discriminator_row@1";
  rowId: string;
  ownerStateObjectId: string;
  conflictingBranches: Array<{
    branchId: string;
    rendererSafeSummary: string;
    expectedLawRef: string;
    regressionLockRef?: string;
  }>;
  proposedDiscriminator: {
    discriminatorId: string;
    discriminatorKind:
      | "runtime_source_class"
      | "authority_mode"
      | "projection_freshness"
      | "context_jurisdiction"
      | "contract_epoch"
      | "surface_trust"
      | "worker_depth"
      | "other";
    rendererSafeRule: string;
  };
  counterfactualProbeRefs: string[];
  status:
    | "proposed"
    | "observed"
    | "specified_by_contract"
    | "rejected"
    | "blocked";
  rawTextIncluded: false;
  digest: string;
};
```

This keeps the control plane from resolving design conflicts by accidental
precedence. The desired artifact is the discriminator, not a stronger
downstream special case.

## MetaSession State Object Descriptor

Phase 1A should produce machine-readable descriptors, not only prose. Recommended
shape:

```ts
type DirectMetaStateObjectDescriptorV1 = {
  schemaVersion: "direct_meta_state_object_descriptor@1";
  id: string;
  ownerKind:
    | "meta_session_state"
    | "context_registry_state"
    | "contract_state"
    | "instruction_state"
    | "transition_state"
    | "route_state"
    | "ledger_state"
    | "projection_state";
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
      | "direct_runtime_status"
      | "surface_event"
      | "stored_artifact"
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

This is the bridge from the conceptual profile to an executable local ODEU
contract.

## Execution Context Schema

`ExecutionContext` must be a typed object, not a path, label, tab, or branch
string.

```ts
type DirectExecutionContextV1 = {
  schemaVersion: "direct_execution_context@1";
  contextId: string;
  contextKind:
    | "repo_workspace"
    | "chat_thread"
    | "direct_runtime_lane"
    | "app_server_lane"
    | "external_workspace"
    | "imported_legacy";
  jurisdiction: SessionJurisdictionV1;
  workspaceBindingDigest?: string;
  repoRootEvidenceDigest?: string;
  branchEvidenceDigest?: string;
  threadBindingDigest?: string;
  runtimeLaneDigest?: string;
  sourceClass:
    | "direct_native"
    | "app_server"
    | "legacy_imported"
    | "fixture"
    | "diagnostic";
  rendererSafeLabel: string;
  rawPathIncluded: false;
  activeStateDigest: string;
};
```

Two contexts with the same repo label, branch name, or thread title remain
separate unless they share the same `contextId` and digest-verified binding
evidence.

## Locked Contract Lifecycle

MetaSession lifecycle and run-contract lifecycle are separate state machines:

```ts
type DirectMetaSessionStatusV1 =
  | "open"
  | "stopped"
  | "archived"
  | "forked";

type DirectRunContractStatusV1 =
  | "draft"
  | "locked"
  | "active"
  | "superseded"
  | "retired";
```

`amended` is not a durable terminal contract state. An amendment creates a new
contract version and epoch, and the previous contract becomes `superseded`.

Epoch law:

```text
contractVersion:
  increments on content-level contract amendment

sessionEpoch:
  increments when the active contract pointer changes or enforcement posture
  changes

activationEpoch:
  the epoch value cited by runtime artifacts
```

Every instruction package, transition request, route, worker packet, and guard
result must cite:

```text
sessionId
contractId
contractVersion
sessionEpoch
contextId
observedLedgerHead
```

### 1. Preparation

The meta-orchestrator builds a concrete profile from the task:

```text
human intent
  -> session jurisdiction
  -> candidate execution contexts
  -> procedure family
  -> role graph
  -> artifact classes
  -> transition graph
  -> authority and stop policy
  -> instruction inheritance policy
```

This can use ADEU/programbench-style profiles as templates, but the output is a
session-local contract.

### 2. Lock

The harness emits a locked artifact:

```ts
type DirectRunContractV1 = {
  schemaVersion: "direct_run_contract@1";
  sessionId: string;
  contractId: string;
  contractVersion: number;
  sessionEpoch: number;
  status: DirectRunContractStatusV1;
  purpose: string;
  jurisdiction: SessionJurisdictionV1;
  contexts: DirectExecutionContextV1[];
  roleProfiles: DirectRoleRuntimeProfileV1[];
  transitionPolicy: DirectTransitionPolicyV1;
  instructionPolicy: DirectInstructionInheritancePolicyV1;
  amendmentPolicy: DirectAmendmentPolicyV1;
  stopPolicy: DirectStopPolicyV1;
  evidencePolicy: DirectEvidencePolicyV1;
  createdAt: string;
  lockedAt?: string;
  sourceRefs: DirectSourceRefV1[];
  sourceDigest: string;
  digest: string;
};
```

Once locked, the contract becomes active only through a harness event. A model
cannot activate it merely by saying it is active.

### 3. Activation

Activation installs the contract into harness-level policy:

```text
locked contract
  -> active session pointer
  -> instruction compiler inputs
  -> transition guard inputs
  -> context compiler scope
  -> ledger append policy
  -> UI/status projection
```

Activation creates a new epoch. All subsequent turn, worker, and transition
events must cite the active contract id and epoch.

### 4. Runtime

During runtime, every meaningful state mutation is a typed event:

```text
UserIntentReceived
ContextRouteProposed
ContextRouteAccepted
RunContractActivated
TransitionRequested
TransitionAllowed
TransitionDenied
WorkerPacketIssued
WorkerArtifactSubmitted
AuditArtifactSubmitted
RunReclassified
AmendmentRequested
AmendmentAccepted
SessionStopped
```

### 5. Amendment

Amendments are allowed only through the amendment policy:

```text
ordinary clarification:
  may update task brief if policy allows

procedure change:
  requires contract amendment event and new epoch

authority expansion:
  requires explicit human approval unless pre-authorized

contamination or skipped gate:
  reclassifies the run before any continuation
```

### 6. Close, Archive, Fork

Closing a Session produces a final state artifact:

```text
final status
active contexts
latest contract epochs
unresolved obligations
cross-context handoffs
evidence ledger refs
summary for future meta-session governance
```

Forking creates a new Session or child Session with explicit lineage.

## Three-Depth Runtime Model

### L1: Meta-Session Governor

Responsibilities:

```text
session creation and selection
jurisdiction routing
contract compilation and locking
transition legality checks
run reclassification
stop/amendment authority
status normalization across contexts
handoff between contexts
```

Forbidden by default:

```text
object-level patches
benchmark score chasing
technical audit substitution
worker transcript rewriting
silent procedure changes
```

### L2: Session Orchestrator

Responsibilities:

```text
task planning inside contract
worker packet construction
artifact collection
object-level repair planning
status reports to meta-session governor
```

The orchestrator may be smart and adaptive, but it is not sovereign. It routes
through the active contract.

### L3: Workers

Responsibilities:

```text
bounded phase work
typed artifact output
required evidence references
handoff notes
blocker reporting
```

Workers do not receive irrelevant inherited repo policy by default. They receive
a compiled role package.

## Instruction Compiler

`AGENTS.md` is an input source, not an active contract.

The instruction compiler produces per-role packages:

```text
base non-negotiable system/developer rules
  + active Session meta-ODEU constraints
  + local run ODEU constraints
  + role-specific contract
  + task packet
  + relevant repo constraints
  + explicit omissions ledger
```

For ProgramBench-style workers, this prevents the common bad inheritance:

```text
worker doing adversarial phase analysis
  receives parent repo PR hygiene, release workflow, and generic project notes
  instead of the phase-specific artifact law
```

Suggested policy:

```yaml
instruction_inheritance:
  mode: selective
  project_agents_policy:
    default: constraints_only
    include_sections:
      - safety
      - filesystem boundaries
      - deterministic command constraints
      - repo-specific test invocation when relevant
    exclude_sections:
      - PR hygiene
      - release workflow
      - unrelated deployment notes
      - stale chat-specific instructions
  omission_ledger: required
```

Instruction packages are durable artifacts:

```ts
type DirectInstructionPackageV1 = {
  schemaVersion: "direct_instruction_package@1";
  packageId: string;
  sessionId: string;
  contractId: string;
  contractVersion: number;
  sessionEpoch: number;
  roleId: string;
  targetContextId: string;
  includedSourceRefs: DirectSourceRefV1[];
  omittedSourceRefs: DirectInstructionOmissionV1[];
  compiledMessagesDigest: string;
  authoritySummary: string[];
  forbiddenActions: string[];
  outputArtifactSchemaRef: string;
  rawCompiledPromptIncluded: false;
};
```

Workers still need concrete instructions at launch. Split the durable record
from the ephemeral launch envelope:

```text
DirectInstructionPackageV1:
  persisted source refs, omissions, authority summary, output schema, digest

DirectInstructionLaunchEnvelopeV1:
  just-in-time raw compiled messages for one launch attempt
  not persisted by default
  rebuilt from package refs and source artifacts
```

The launch envelope must cite the package digest and is discarded after the
launch attempt unless a separate opt-in diagnostic artifact is requested.

## Transition Guard

The transition guard is deterministic for enforceable legality. Semantic broker
recommendations may classify ambiguity, propose routes, or request human review,
but they do not create enforce authority without deterministic guard support and
contract policy.

Split the transition layer into three artifacts:

```text
DirectTransitionGuard:
  deterministic schema/evidence/phase/authority validation

DirectSemanticTransitionRecommendation:
  semantic classification, ambiguity, suggested route, and ask-human posture

DirectTransitionAdjudication:
  combines deterministic guard, semantic recommendation, and human approval
  policy
```

Rule:

```text
semantic recommendation may increase uncertainty, ask-human, or require
amendment; semantic recommendation alone may not create enforce authority
```

The transition guard gates the orchestrator, not just workers.

Example ProgramBench law:

```yaml
run_goal: pure_mp_end_to_end_with_5_4_mini_workers
current_phase: P1C
allowed_next:
  - P1D
forbidden_until_phase:
  official_eval:
    - implementation_patch
    - source_tail
    - score_chasing
required_phase_sequence:
  - P0
  - P1A
  - P1B
  - P1C
  - P1D
  - P2
  - P3
  - P4
  - P5
  - P6
  - P7
contamination_rules:
  skipped_required_phase: reclassify_run
  interrupted_worker_without_gate: reclassify_run
  patch_before_declared_eval: reclassify_run
```

Guard result:

```ts
type DirectTransitionGuardResultV1 = {
  schemaVersion: "direct_transition_guard_result@1";
  requestId: string;
  sessionId: string;
  contractId: string;
  contractVersion: number;
  sessionEpoch: number;
  mode: "shadow" | "enforce_unavailable" | "enforce";
  decision: "allow" | "deny" | "ask_human" | "reclassify" | "stop";
  effect:
    | "diagnostic_only"
    | "runtime_block_applied"
    | "runtime_route_mutated"
    | "runtime_stop_applied";
  reasonCode: string;
  requiredEvidenceRefs: string[];
  missingEvidenceRefs: string[];
  nextAllowedTransitions: string[];
  createdAt: string;
};
```

Invariant:

```text
mode=shadow -> effect=diagnostic_only
mode=enforce_unavailable -> effect=diagnostic_only
```

## Cross-Context Routing

The meta-session surface can accept a human message without requiring the human
to manually switch chats or workspaces.

Routing law:

```text
human message
  -> classify against active Session jurisdiction
  -> identify target context(s)
  -> propose route when ambiguous
  -> dispatch only after allowed route
  -> return normalized status/questions to meta-session
```

The route itself is evidence:

```ts
type DirectCrossContextRouteV1 = {
  schemaVersion: "direct_cross_context_route@1";
  routeId: string;
  sessionId: string;
  contractId: string;
  contractVersion: number;
  sessionEpoch: number;
  sourceSurface: "meta_session_chat" | "local_thread" | "ui_action";
  targetContextIds: string[];
  observedContextDigestsAtProposal: Record<string, string>;
  observedContextDigestsAtDispatch?: Record<string, string>;
  observedLedgerHeadAtProposal: string;
  observedLedgerHeadAtDispatch?: string;
  routeProposalDigest?: string;
  routeKind: "dispatch" | "status_request" | "question" | "handoff" | "broadcast";
  confidence: "high" | "medium" | "low";
  ambiguity: string[];
  humanApproved: boolean;
  staleBlockerCode?: DirectMetaSessionBlockerCodeV1;
  createdAt: string;
};
```

Cross-context route lifecycle:

```text
cross_context_route_proposed
  -> cross_context_route_accepted
  -> cross_context_route_dispatched | cross_context_route_dispatch_blocked
```

The accepted/dispatch artifact cites the proposal digest plus context digests
and ledger heads observed at proposal and dispatch. If any target context
changed, dispatch fails closed and writes attempt history without mutating the
target runtime.

Rules:

```text
ambiguous jurisdiction -> ask or propose route
multi-context mutation -> explicit route event
local answer to meta-session -> normalized report, not raw transcript splice
context switch -> active context evidence update
```

## Observability Model

The meta-orchestrator does not need raw worker transcripts by default. It needs
typed status and evidence.

```text
L3 worker:
  progress witness, artifact refs, blocker refs, confidence, required next gate

L2 orchestrator:
  phase report, worker graph summary, transition request, audit recommendation

L1 meta-session governor:
  session status, context state, contract epoch, transition decisions,
  run classification, unresolved obligations
```

This extends the existing Direct sub-agent observability posture. PR 10-style
diagnostics are display-only. A later choreography layer may add spawn/wait/send
authority, but only after the Session contract can express and gate that
authority.

## Required Hardening Before Implementation

This spec is intentionally above the existing Direct runtime paths. The first
implementation must therefore prove that the meta-session layer is an evidence
and control plane, not a hidden execution shortcut.

### 1. Source-Of-Truth Chain

The meta-session control plane must not introduce a shadow transcript, shadow
thread store, or shadow project config.

Canonical ordering:

```text
project/workspace binding
  -> execution context registry
  -> active session pointer
  -> locked run contract
  -> instruction package / route / transition artifacts
  -> local runtime controller or worker dispatch
  -> event ledger append
  -> renderer-safe projection
```

Rules:

```text
UI selection != active Session pointer
thread id != Session identity
repo path != ExecutionContext identity
branch name != jurisdiction proof
worker transcript != meta-session evidence unless projected through a witness
```

Every context-bound action must cite the active `sessionId`, `contractId`,
`contractVersion`, `sessionEpoch`, `contextId`, and source digest it observed.

### 2. Current Pointers And Attempt History

The storage layer needs explicit current pointers rather than one generic
"current meta session" record:

```text
current_meta_session_id
current_run_contract_id
current_execution_context_registry_id
current_instruction_package_set_id
current_transition_policy_id
current_route_projection_id
current_meta_session_event_ledger_head
```

Pointer sets are scoped:

```ts
type DirectMetaCurrentPointerSetV1 = {
  schemaVersion: "direct_meta_current_pointer_set@1";
  pointerSetId: string;
  scopeKind: "global" | "surface" | "meta_session" | "execution_context";
  scopeId: string;
  currentMetaSessionId?: string;
  currentContractId?: string;
  currentContractVersion?: number;
  currentSessionEpoch?: number;
  currentContextRegistryId?: string;
  currentLedgerHead?: string;
  pointerSetDigest: string;
};
```

Pointer law:

```text
valid artifact -> may become current
blocked/failed/raw-exposure artifact -> attempt history only
stale artifact -> readable diagnostic, not authority
corrupt artifact -> minimal safe status only
```

Attempt records should preserve failed compile, stale route, denied transition,
raw-exposure blocked, and schema-invalid states without replacing the last valid
current pointer.

### 3. Schema Validation And Raw-Exposure Law

Before any artifact becomes current:

```text
build object
validate schema
compute source digest and artifact digest
run raw-exposure scan
append ledger event
update current pointer
project renderer-safe status
```

If validation or raw-exposure scan fails, write only a minimal safe failure
artifact with:

```text
session authority unchanged
current pointers unchanged
rawTextIncluded=false
rawTranscriptIncluded=false
rawPathIncluded=false
rawChatGptUrlIncluded=false
```

Shared raw-exposure scanner contract:

```text
rawTextIncluded
rawTranscriptIncluded
rawPathIncluded
rawChatGptUrlIncluded
rawProviderPayloadIncluded
rawToolOutputIncluded
privateTokenIncluded
secretLikeValueIncluded
```

Failure writes only `direct_meta_session_attempt_failure@1` with a
renderer-safe reason and no raw payload.

### 3a. Canonical Digest Domains

The meta-session layer should reuse stable canonical JSON and SHA-256, but every
artifact class needs an explicit digest domain:

```text
artifactDigest = sha256(
  "<schemaVersion>\0" + canonical_json_v1(artifact_without_digest)
)
```

Apply this to:

```text
meta-session digest
context registry digest
contract digest
instruction package digest
transition claim digest
guard result digest
route proposal digest
ledger event digest
current pointer set digest
```

Do not compare digests across artifact classes unless the domain/schema version
matches.

### 4. Instruction Package Non-Storage

`DirectInstructionPackageV1` should not store raw compiled prompt text by
default. It should store:

```text
included source refs
omitted source refs
compiled message digest
renderer-safe authority summary
role/output schema refs
raw compiled text included = false
```

If a future debugger needs raw compiled messages, that must be a separate
opt-in diagnostic artifact with retention/redaction policy. It must not be the
artifact used for normal worker launch.

### 5. Cross-Context Staleness

`DirectCrossContextRouteV1` must bind the route to the context state that was
classified:

```ts
type DirectCrossContextRouteV1 = {
  schemaVersion: "direct_cross_context_route@1";
  routeId: string;
  sessionId: string;
  contractId: string;
  contractVersion: number;
  sessionEpoch: number;
  sourceSurface: "meta_session_chat" | "local_thread" | "ui_action";
  targetContextIds: string[];
  observedContextDigestsAtProposal: Record<string, string>;
  observedContextDigestsAtDispatch?: Record<string, string>;
  observedLedgerHeadAtProposal: string;
  observedLedgerHeadAtDispatch?: string;
  routeProposalDigest?: string;
  routeKind: "dispatch" | "status_request" | "question" | "handoff" | "broadcast";
  confidence: "high" | "medium" | "low";
  ambiguity: string[];
  humanApproved: boolean;
  staleBlockerCode?: DirectMetaSessionBlockerCodeV1;
  createdAt: string;
};
```

If any target context changed between route proposal and dispatch, dispatch must
fail closed with a stable stale-state blocker.

### 6. Stable Blocker Codes

Add a stable blocker-code taxonomy early:

```ts
type DirectMetaSessionBlockerCodeV1 =
  | "session_missing"
  | "session_pointer_stale"
  | "contract_missing"
  | "contract_digest_mismatch"
  | "contract_epoch_stale"
  | "context_missing"
  | "context_digest_mismatch"
  | "context_jurisdiction_ambiguous"
  | "route_stale"
  | "transition_not_allowed"
  | "required_evidence_missing"
  | "worker_authority_missing"
  | "amendment_required"
  | "human_approval_required"
  | "raw_exposure_blocked"
  | "schema_invalid"
  | "ledger_corrupt"
  | "enforce_mode_unavailable"
  | "sub_agent_choreography_unavailable";
```

Renderer copy can be friendlier, but reports and tests should assert these
stable codes.

### 7. Shadow Vs Enforce Boundary

The initial control-plane artifacts are diagnostic/shadow only. A transition
guard decision of "would deny" must not block, reroute, degrade, or mutate an
active runtime path until a separate enforce-mode capability is implemented and
activated for the specific Session epoch.

Law:

```text
shadow guard decision carries effect=diagnostic_only
semantic broker recommendation != route mutation
contract compile success != enforce authority
enforce mode flag != global default
```

Any runtime block, route mutation, worker dispatch mutation, or status
degradation caused by a shadow result is a contract violation.

Enforced contract mode must remain future/flagged and must cite exact evidence
that the target workflow supports fail-closed transitions without losing
recovery state.

### 8. App-Server And Direct Source-Class Split

Nested workers may eventually be backed by:

```text
app-server sub-agent/collab evidence
Direct-native AgentRun records
imported/legacy run evidence
fixture diagnostics
```

Those sources must not collapse into one authority class.

```text
app-server child evidence != Direct worker authority
Direct AgentRun record != app-server collab continuity
legacy imported run != live worker state
fixture worker graph != choreography proof
```

The first implementation should project source class, confidence, and
non-authority flags. Spawn/wait/send/close remain unavailable until a later
contract-gated choreography spec promotes them.

### 9. Event Ledger Invariants

All meaningful MetaSession mutations should append typed ledger events:

```text
meta_session_created
execution_context_registered
run_contract_drafted
run_contract_locked
run_contract_activated
instruction_package_recorded
cross_context_route_proposed
cross_context_route_accepted
transition_guard_evaluated
worker_packet_issued
worker_witness_recorded
audit_artifact_recorded
run_reclassified
amendment_requested
amendment_accepted
session_stopped
session_archived
```

Each event cites ids/digests only. The ledger is append-only for v0; corrections
are new events, not rewrites.

Ledger events form a hash chain:

```text
sequence
previousEventDigest
eventDigest
ledgerHeadDigest
```

All current pointer sets cite a ledger head. If the ledger is corrupt, no
current pointer may advance and renderer status falls back to minimal safe
recovery state.

### 10. Surface And IPC Authority Catalog

The future meta-session workbench will span multiple app surfaces. It must reuse
the shell ODEU profile's `SurfaceTrustProfile`, `IpcChannelContract`, and
`WebContentsSecurityProfile` posture rather than adding generic renderer
commands.

Any meta-session UI or route-control IPC must declare:

```text
surface role
target trust profile
preload bridge profile
main handler contract
allowed sender roles
authority evidence
mutation scope
result projection
BRL sentinels
```

Rules:

```text
renderer bridge access != authority
configured URL target != trusted local surface
remote DOM != meta-session evidence
main owns connection/auth/workspace-command authority
generic route/dispatch IPC is forbidden without an IpcChannelContract row
```

The first implementation should expose only minimal renderer-safe status reads.
Mutation routes such as accept route, activate contract, amend contract, stop
session, or spawn worker require explicit IPC contracts and sender-role checks.

## UI Surface

The Direct shell should eventually expose a meta-session workbench:

```text
session list
active session dashboard
context map: threads, branches, folders, lanes
active contract and epoch
role graph
transition graph status
current blockers
worker/orchestrator status witnesses
cross-context routing queue
amendment and stop controls
evidence ledger explorer
```

User-facing invariant:

```text
The UI must show which Session and context a statement/action belongs to before
the harness treats it as authoritative.
```

## Failure Modes This Prevents

- The orchestrator skips a required adversarial phase because the target score is
  close.
- The orchestrator patches after seeing eval feedback, while still describing
  the run as a pure-method experiment.
- A worker inherits broad repo `AGENTS.md` instructions that are irrelevant to
  the phase and pollute the output.
- Two long-lived branches are mixed in one chat and local context bleeds across
  them.
- A thread id is mistaken for durable session identity.
- A UI tab or selected project label implies a context transition that was never
  proved.
- A sub-agent transcript is treated as parent-context truth without a typed
  witness.
- A procedure change happens through prose rather than a contract amendment.

## Implementation Plan

Recommended module boundary:

```text
src/main/direct/meta-session/
  constants.js
  digest.js
  source-ref.js
  blocker-codes.js
  schemas.js
  raw-exposure.js
  store.js
  current-pointers.js
  ledger.js
  execution-context.js
  contract.js
  instruction-package.js
  transition-claim.js
  transition-guard.js
  cross-context-route.js
  projection.js
  index.js
```

Recommended regression script:

```text
scripts/direct-meta-session-control-plane-regression.mjs
npm script: direct:meta-session-control-plane
```

Do not implement the whole spec in one PR.

### Phase 1A: Schemas, Store, Pointers, Ledger

In scope:

```text
DirectMetaSessionStore
meta-session create/open/archive/stopped fixture states
execution context registry artifacts
state object descriptors
contract draft/lock/activate artifacts
current pointer set
attempt history records
ledger append with hash chain
domain-separated digests
transition claim fixture rows
upstream-discriminator fixture rows
BRL replay-lock manifest fixture rows
schema validation before pointer update
raw-exposure minimal blocker
renderer-safe status projection
stable blocker codes
fixture regression script
```

Out of scope:

```text
actual worker spawning
instruction compiler launch envelope
runtime transition blocking
semantic broker rerouting
enforced mode
sub-agent choreography
generic meta-session mutation IPC
UI workbench beyond minimal status projection
```

### Phase 1: Artifact Schema And Ledger

Add schemas/projections for:

```text
direct_meta_session@1
direct_execution_context@1
direct_execution_context_registry@1
direct_run_contract@1
direct_role_runtime_profile@1
direct_instruction_package@1
direct_cross_context_route@1
direct_transition_guard_result@1
direct_meta_state_object_descriptor@1
direct_meta_upstream_discriminator_row@1
direct_meta_current_pointer_set@1
direct_meta_session_event_ledger@1
```

Mode: diagnostic/shadow only.

Also add:

```text
current pointer records
attempt history records
stable blocker-code enum
HOB obligation-status rows
OTB transition-claim rows
upstream-discriminator rows for branch conflicts
BRL replay-lock manifest rows
schema validation before pointer update
raw-exposure scan before renderer projection
```

### Phase 2: Instruction Compiler

Implement selective inheritance:

```text
AGENTS.md / repo policy / session contract / role contract
  -> compiled role instruction package
  -> omission ledger
  -> digest cited by worker launch
```

No runtime worker authority expansion yet.

The normal instruction package stores digests and source refs, not raw compiled
prompt text.

### Phase 3: Transition Guard Shadow Mode

Use locked contracts to classify requested transitions:

```text
allowed
denied
missing evidence
requires human
would reclassify
```

Shadow mode reports decisions without blocking normal work.

Shadow decisions must be observable in the ledger and UI, but cannot mutate
runtime routing, provider input, worker spawning, app-server state, Direct
runtime state, right-pane ChatGPT, or handoff queues.

### Phase 4: Enforced Contract Mode

Allow a contract to declare enforce mode for known-safe procedures:

```text
deny illegal phase transition
block authority expansion
require amendment event
reclassify contaminated runs
stop on declared terminal violations
```

Enforcement must be opt-in per Session/contract epoch.

This phase is unavailable until separate evidence proves fail-closed transition
blocking, recovery, stale-action handling, and UI rejection behavior for the
target workflow class.

### Phase 5: Three-Depth Runtime

Add controlled L2/L3 agent choreography:

```text
meta-session governor can spawn/select orchestrator contexts
orchestrator can spawn/select workers only through contract authority
workers report typed witnesses
meta-session sees high-level graph/status and transition requests
```

This phase depends on sub-agent observability and containment graduating from
display-only diagnostics to contract-gated choreography.

Suggested sequencing after Phase 1A:

```text
Phase 1B: instruction package records and omission ledger
Phase 1C: shadow transition guard and transition claim artifacts
Phase 1D: cross-context route proposal/accept/dispatch with staleness blocking
Phase 1E: minimal status projection
Phase 2+: enforce mode only after shadow diagnostics and recovery are proved
```

## Acceptance Criteria

- A single Session can own at least two execution contexts with separate
  jurisdictions and no implicit context bleed.
- Two execution contexts with the same repo label but different context ids do
  not collapse.
- UI selected tab state does not mutate the active meta-session pointer.
- A human message in the meta-session surface routes to the correct context or
  produces an ambiguity prompt.
- A locked contract has a durable digest, epoch, authority policy, stop policy,
  amendment policy, and role graph.
- A worker receives a targeted instruction package instead of blindly inheriting
  all parent `AGENTS.md` material.
- Instruction packages store source refs, omission refs, and digests; raw
  compiled prompt text is excluded by default.
- A transition request cites contract id and epoch and receives an allow/deny/
  ask/reclassify/stop decision.
- Cross-context routes cite observed context digests and fail closed if the
  target context changed before dispatch.
- Stale route dispatch writes attempt failure and leaves current pointers
  unchanged.
- A ProgramBench-style pure run can be reclassified when a required phase is
  skipped or a forbidden action occurs.
- Contract amendments create a new epoch and leave the prior epoch auditable.
- Amendment invalidates older instruction packages for future launch unless a
  compatibility policy explicitly allows reuse.
- UI/session status distinguishes Session, thread, repo, branch, and active run.
- Shadow transition diagnostics cannot block or reroute runtime actions.
- Shadow guard results carry `effect=diagnostic_only`.
- Enforce mode cannot be enabled by config flag alone without contract epoch
  support and workflow-class proof.
- App-server sub-agent evidence, Direct-native worker records, imported evidence,
  and fixture diagnostics remain separate source classes.
- Raw path, raw provider payload, raw transcript text, or raw compiled prompt
  text in normal artifacts blocks current pointer update.
- Ledger hash-chain corruption blocks pointer advancement.
- Contract digest mismatch returns a stable blocker code.
- Worker artifact submitted without contract id, contract version, session
  epoch, and context id is rejected.
- Route confidence `low` requires ask/propose, not dispatch.
- Renderer projection never includes raw path, raw provider payload, raw
  transcript text, or raw compiled prompt text.
- Every Phase 1A state object has a descriptor with code anchors, evidence
  authority, status lattice, projection refs, and validation refs.
- HOB child obligations have explicit statuses: covered, proved irrelevant,
  pass-through, deferred with risk, or blocked pending evidence.
- Mutation-capable routes require an OTB transition claim before they can become
  enforceable route actions.
- Conflicting behavior branches require an upstream-discriminator row before
  patching one branch can override another.
- Shared projections and future workbench surfaces require BRL replay-lock
  manifests before refactors can claim preserved behavior.
- Phase 1A meta-session IPC is status-read-only; mutation IPC requires an
  explicit `IpcChannelContract` and sender-role checks.

## Open Questions

- Exact import bridge for ADEU-studio ProgramBench run artifacts into Direct
  session contracts.
- Whether nested agent execution should use upstream Codex app-server
  primitives, Direct-native worker records, or both behind a source-class split.
- Which parts of transition legality can be deterministic on day one and which
  need a semantic broker recommendation plus human approval.
- How much of the meta-session workbench belongs in the Direct shell versus a
  separate session-governor surface.
- Whether enforced mode should initially be limited to benchmark/procedure
  experiments before general coding workflows.
