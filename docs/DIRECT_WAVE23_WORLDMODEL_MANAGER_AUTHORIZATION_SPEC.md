# Direct Wave 23: ODEU Worldmodel Manager And Role-Indexed Authorization

Status: planning spec for Wave 23.

Detailed PR range:

```text
PR 138-143
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_WAVE21_AGENT_CONTINUITY_MEMORY_SPEC.md
docs/DIRECT_AGENTIC_TESTING_GAME_MATRIX_SPEC.md
docs/DIRECT_ROLE_LANE_TOOL_BUNDLE_COMPOSER_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md
```

## Purpose

Introduce a standing `ODEUWorldmodelManager` role as the direct harness control
plane for active interaction truth, worker boot packets, and role-indexed
authorization.

The resident worker should not start from an untyped prompt plus ambient tools.
It should start from a scoped active worldmodel:

```text
ActiveInteractionWorldmodel
  -> WorkerBootPacket
  -> RoleLaneToolBundle
  -> AuthorizationChannel
  -> lawful worker transitions
```

The manager owns durable worldmodel and policy state:

```text
user/project preferences
active work threads
agent identities and roles
task ODEU profiles
environment/tool ODEU profiles
model self-ODEU profiles
interaction/governance ODEU profiles
constitutional policies
self-binding preferences
exception rules
authorization decisions
```

Workers do task work. They do not renegotiate constitutional policy with the
human in the middle of the task. When blocked, they emit typed authorization
requests to the manager.

## Practical Target

Wave 23 must be testable as a real interaction pattern, not only as a schema
layer.

The target user-facing flow is:

```text
human opens a direct chat with the ODEU Worldmodel Manager
  -> manager understands active user/project/work-world profile
  -> human gives a high-level objective
  -> manager creates or selects a WorkThread
  -> manager delegates the scoped task to a Thread Manager
  -> Thread Manager either carries the task itself or spawns worker agents
  -> workers receive scoped boot packets and authority routes
  -> blocked actions route back through manager policy
  -> manager reports progress, decisions, remands, and closure evidence
```

This is recursive constitutional relay over scoped worlds:

```text
Worldmodel Manager
  owns global/project/work-world constitution and active worldmodel

Thread Manager
  owns one WorkThread execution world under delegated constitution

Worker Agent
  owns one scoped task/run under Thread Manager authority

Sub-worker Agent
  owns one narrower delegated packet under inherited constraints
```

Each relay step must carry:

```text
scope
objective
role
ODEU projection
authority boundary
allowed escalation route
omissions
source refs
digest
```

The manager chat is therefore not a normal worker thread. It is the direct
control-plane conversation for inspecting and changing worldmodel state,
creating work threads, and issuing delegation packets.

## V0 Execution Posture

Wave 23 must not recreate the earlier failure mode where basic interaction is
blocked by immature gates.

V0 posture:

```text
schemas and ledgers are strict enough to produce reliable witnesses
manager chat and delegation are usable first
authorization routing is observable first
strict enforcement starts in shadow/report mode unless the action is already
dangerous under existing policy
hard blockers are enabled only after headless/manual testing proves the dynamic
```

This means several hardening laws are recorded now but do not all become
runtime blockers in PR 138-143:

```text
child-boundary subset proof:
  V0 emits comparison witness; strict block is future toggle except for obvious
  broadening of dangerous action classes

policy precedence:
  V0 emits resolution trace; strict fail-closed policy engine can be promoted
  after test data

stale revision compatibility:
  V0 warns/remands for stale manager decisions; strict rejection is future
  unless the target action is destructive/account/external mutation

admin-mode ceremony:
  V0 requires explicit admin-mode for durable policy writes; richer ceremony
  and expiry UX can mature after first tests
```

## Root Law

```text
No model action before model-situation typing.
```

The "proper prompt" is not a prompt. It is a booted interaction worldmodel.

```text
worker action
  requires active worldmodel
  requires role identity
  requires scoped context
  requires tool-capability truth
  requires authority route
```

Relevance is not a flat keyword relation. Information is relevant when it can
change at least one active ODEU lane:

```text
O: objects, relations, possible states
E: known, unknown, inferred, stale, accepted, refuted
D: allowed, forbidden, required, gated, locked
U: priority, cost, risk, success, tradeoff ranking
```

## Role-Indexed Authorization Law

The same biological human can occupy different authority roles:

```text
user-mode:
  local task preference; fast, outcome-seeking, possibly tired or rushed

admin-mode:
  standing policy formation; slow, reflective, constitutional

manager-mode:
  applies existing policy to concrete cases

worker-mode:
  executes local task under scoped permissions

escalation-mode:
  requests explicit human judgment only when policy cannot decide
```

Therefore:

```text
A casual user yes is not automatically constitutional authority.
```

Permission is not a mood-sensitive answer. Permission is a typed deontic
transition inside a role-indexed worldmodel.

Workers must not ask the human directly for policy-sensitive authority. They
must report the blocked action to the Worldmodel Manager:

```text
worker reaches blocked action
  -> AuthorizationRequest
  -> manager evaluates standing policy, exception rules, and role state
  -> AuthorizationDecision
  -> worker receives grant/deny/remand/escalation result
```

The manager may escalate to the human only through the correct mode:

```text
local confirmation:
  asks user-mode for a one-case decision allowed by standing policy

admin-mode:
  opens a constitutional policy decision frame for standing policy changes
```

Some decisions are not valid in ordinary user-mode. They require explicit
admin-mode.

## Active Interaction Worldmodel

### Four ODEU Lanes

```ts
type WorldScopeRef =
  | {
      scopeKind: "global_user";
      userProfileId: string;
    }
  | {
      scopeKind: "project";
      userProfileId: string;
      projectId: string;
    }
  | {
      scopeKind: "work_thread";
      userProfileId: string;
      projectId: string;
      workThreadId: string;
    }
  | {
      scopeKind: "session";
      userProfileId: string;
      sessionId: string;
      projectId?: string;
      workThreadId?: string;
    };

type ActiveInteractionWorldmodel = {
  schema: "direct_active_interaction_worldmodel@1";

  worldmodelId: string;
  rootWorldmodelId: string;
  parentWorldmodelId?: string;
  scope: WorldScopeRef;
  managerAgentId: string;
  subjectAgentId?: string;
  activeThreadId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  previousDigest?: string;

  task: TaskOdeuLane;
  environment: ArtifactEnvironmentOdeuLane;
  modelSelf: ModelSelfOdeuLane;
  governance: InteractionGovernanceOdeuLane;

  sourceRefs: SourceRef[];
  staleRefs: SourceRef[];
  unknowns: WorldmodelUnknown[];
  openRemands: WorldmodelRemand[];
  digest: string;
};
```

Scope law:

```text
WorkThreadId is not required before a WorkThread exists.
The manager may first operate at global_user, project, or session scope.
WorkThread scope begins only after selection or creation.
Nested worlds cite rootWorldmodelId and parentWorldmodelId.
```

#### Task ODEU

```text
O: task object, project objects, artifacts, specs, tests, goals
E: inspected evidence, accepted claims, unknowns, stale facts
D: task constraints, forbidden moves, gates, locks, required transitions
U: success criteria, tradeoffs, score/speed/correctness priorities
```

#### Artifact / Environment ODEU

```text
O: repo, workspace, filesystem, tools, APIs, harnesses, runtime state
E: inspected files, command outputs, runtime facts, ledgers, source truth refs
D: edit boundaries, command boundaries, tool authority, safe/unsafe actions
U: most valuable environment affordances for the current phase
```

#### Model Self-ODEU

```text
O: agent identity, role, lane, capability posture, failure modes
E: what this worker knows directly, can inspect, or must infer
D: when to test, ask, remand, stop, or route authorization
U: attention/action budget, expected rigor, autonomy posture
```

#### Interaction / Governance ODEU

```text
O: human, manager, worker, harness, provider, ledgers, context packets
E: accepted/provisional/disputed/pending claims and evidence
D: who can commit, revise, close, promote, defer, authorize, or escalate
U: purpose of this interaction phase and long-horizon agency preservation
```

## Worldmodel Manager

```ts
type ODEUWorldmodelManagerProfile = {
  schema: "direct_odeu_worldmodel_manager_profile@1";

  managerAgentId: string;
  projectId?: string;
  userProfileId: string;
  scope:
    | "global_user"
    | "project"
    | "work_thread"
    | "session";

  ownsLedgers: Array<
    | "active_worldmodel"
    | "constitutional_policy"
    | "self_binding_preference"
    | "authorization_decision"
    | "worker_boot_packet"
    | "worldmodel_remand"
  >;

  canApplyPolicy: true;
  canModifyPolicyWithoutAdminMode: false;
  canEscalateToUser: true;
  canGrantWorkerAuthority: true;
  canExecuteWorkerTask: false;
};
```

Manager invariants:

```text
manager owns worldmodel integrity
manager applies policy
manager does not perform worker task work
manager does not hide policy changes inside task execution
manager does not treat every user utterance as admin-mode
manager logs every authorization transition
```

## Thread Manager And Recursive Relay

The Thread Manager is the per-WorkThread execution coordinator. It is not the
same as the Worldmodel Manager.

```ts
type ThreadManagerProfile = {
  schema: "direct_thread_manager_profile@1";

  threadManagerAgentId: string;
  managerAgentId: string;
  workThreadId: string;
  worldmodelId: string;
  worldmodelRevision: number;
  scope: "work_thread";

  canExecuteTaskDirectly: boolean;
  canSpawnWorkers: boolean;
  canModifyConstitutionalPolicy: false;
  authorizationRouteRef: string;
  inheritedPolicyRefs: SourceRef[];
  delegatedAuthorityBoundary: AuthorityBoundaryRef;
};
```

### Authority Boundary

Wave 23 needs a concrete authority object so delegation can be compared without
inventing ad hoc string rules.

```ts
type AuthorityBoundary = {
  schema: "direct_authority_boundary@1";

  boundaryId: string;
  parentBoundaryId?: string;
  worldmodelId: string;
  worldmodelRevision: number;

  allowedActionClasses: string[];
  deniedActionClasses: string[];
  managerDiscretionActionClasses: string[];
  explicitUserConfirmationRequiredActionClasses: string[];
  adminModeRequiredActionClasses: string[];

  allowedToolFamilies: string[];
  deniedToolFamilies: string[];
  targetScopeBounds: TargetScopeBound[];

  riskCeiling: "low" | "medium" | "high" | "critical";
  irreversibleActionAllowed: boolean;
  canSpawnWorkers: boolean;
  maxDelegationDepth: number;

  escalationRouteRef: string;
  policyRefs: SourceRef[];
  digest: string;
};
```

Boundary comparison posture:

```text
V0 emits validateChildBoundary(parent, child) as a comparison witness.
Strict child ⊆ parent blocking starts for dangerous broadening only.
Full strict subset enforcement is future hardening after manager/thread tests.
```

The child boundary should never intentionally broaden:

```text
action classes
tool families
target scopes
risk ceiling
irreversibility
delegation depth
escalation route
```

The Worldmodel Manager creates delegation packets:

```ts
type WorkThreadDelegationPacket = {
  schema: "direct_work_thread_delegation_packet@1";

  delegationId: string;
  fromManagerAgentId: string;
  toThreadManagerAgentId: string;
  workThreadId: string;
  worldmodelId: string;
  worldmodelRevision: number;

  objective: string;
  utilityPosture: string;
  taskOdeuProjection: TaskOdeuProjection;
  environmentProjection: EnvironmentOdeuProjection;
  authorityBoundary: AuthorityBoundaryRef;
  allowedDelegationDepth: number;
  allowedWorkerClasses: string[];
  forbiddenWorkerClasses: string[];
  escalationRouteRef: string;
  sourceRefs: SourceRef[];
  omissions: BootPacketOmission[];
  digest: string;
};
```

Relay law:

```text
delegation narrows authority; it does not broaden it
child worlds inherit constraints unless explicitly narrowed further
child worlds cannot rewrite parent constitutional policy
thread manager can request authorization; it cannot grant itself new authority
worker can request authorization; it cannot ask user directly for policy
```

The testable practical shape:

```text
manager chat:
  "start a work thread for X"

manager:
  creates WorkThread
  creates ThreadManagerProfile
  emits WorkThreadDelegationPacket

thread manager:
  either executes if simple
  or emits WorkerBootPacket / spawn request if complex
```

## Constitutional Policy Profile

```ts
type ConstitutionalPolicyProfile = {
  schema: "direct_constitutional_policy_profile@1";

  profileId: string;
  ownerUserId: string;
  scope:
    | "global_user"
    | "project"
    | "work_thread"
    | "agent_class"
    | "tool_family"
    | "action_class";

  policies: ConstitutionalPolicyRule[];
  defaultDecision: "deny" | "manager_discretion" | "explicit_user_confirmation";
  selfBindingRecords: SelfBindingPreferenceRecord[];
  updatedAt: string;
  digest: string;
};
```

Policy rules are typed, scoped, and exception-bearing:

```ts
type ConstitutionalPolicyRule = {
  ruleId: string;
  actionClass: string;
  scopeSelector: PolicyScopeSelector;
  defaultPosture:
    | "allow"
    | "deny"
    | "manager_discretion"
    | "explicit_user_confirmation_required"
    | "admin_mode_required";
  exceptions: PolicyExceptionRule[];
  evidenceRequirements: EvidenceRequirement[];
  escalationRule: EscalationRule;
  rationale: string;
  sourceRefs: SourceRef[];
};
```

### Policy Resolution Trace

V0 records how policy would resolve an authorization request. It should not yet
block ordinary manager-chat experimentation unless the action is already in a
dangerous class.

```ts
type PolicyResolutionTrace = {
  schema: "direct_policy_resolution_trace@1";

  traceId: string;
  requestId: string;
  matchedPolicyRefs: SourceRef[];
  defaultPolicyRef?: SourceRef;

  dominantPosture:
    | "deny"
    | "admin_mode_required"
    | "explicit_user_confirmation_required"
    | "manager_discretion"
    | "allow";

  exceptionApplied?: {
    exceptionRef: SourceRef;
    beforePosture: string;
    afterPosture: string;
    evidenceRefs: SourceRef[];
  };

  evidenceSatisfied: boolean;
  missingEvidence: EvidenceRequirement[];
  rationale: string;
  digest: string;
};
```

Precedence law, recorded in V0 and promoted gradually:

```text
Default: fail closed for dangerous action classes; warn/remand for safe
control-plane experimentation.

When policies conflict:
  deny dominates allow
  admin_mode_required dominates explicit_user_confirmation
  explicit_user_confirmation dominates manager_discretion
  manager_discretion dominates allow

More specific policy can narrow parent policy.
More specific policy cannot broaden parent policy unless the broadening rule
was itself created by explicit admin-mode authority.
Evidence requirements accumulate unless explicitly superseded by admin-mode.
```

Example:

```text
Raw preference:
  "I usually want Codex to avoid broad refactors."

Constitutional policy:
  default: prefer minimal diffs
  exception: broad refactor allowed when local patch violates architecture or
    cannot pass tests
  manager discretion: allowed after evidence review for repo-local internals
  escalation: admin-mode required for public API or project philosophy changes
```

## Worker Boot Packet

Workers receive a compact, role-scoped projection, not the full manager ledger.

```ts
type WorkerBootPacket = {
  schema: "direct_worker_boot_packet@1";

  bootPacketId: string;
  worldmodelId: string;
  worldmodelRevision: number;
  workerAgentId: string;
  agentRunId: string;
  roleLaneId: string;
  workThreadId: string;
  threadId?: string;

  taskProfile: TaskOdeuProjection;
  environmentProfile: EnvironmentOdeuProjection;
  selfProfile: ModelSelfOdeuProjection;
  governanceProfile: GovernanceOdeuProjection;

  callableToolBundleRef: string;
  unavailableCapabilityCatalogRef: string;
  authorizationChannelRef: string;

  omissions: BootPacketOmission[];
  staleWarnings: BootPacketStaleWarning[];
  sourceRefs: SourceRef[];
  digest: string;
};
```

Boot packet laws:

```text
boot packet is context, not authority by itself
boot packet cites worldmodel revision
boot packet contains omissions explicitly
boot packet does not expose irrelevant private lanes
boot packet does not include full policy ledger unless needed
worker cannot modify boot packet truth
worker requests authorization through the cited channel
```

## Authorization Request / Decision

```ts
type AuthorizationRequest = {
  schema: "direct_authorization_request@1";

  requestId: string;
  workerAgentId: string;
  agentRunId: string;
  workThreadId: string;
  threadId?: string;
  worldmodelId: string;
  worldmodelRevision: number;

  requestedAction: {
    actionClass: string;
    toolName?: string;
    targetKind: string;
    targetRefs: SourceRef[];
    scope: string;
    reversibility: "reversible" | "partly_reversible" | "irreversible" | "unknown";
    riskLevel: "low" | "medium" | "high" | "critical";
  };

  workerClaim: {
    whyNeeded: string;
    expectedBenefit: string;
    knownRisks: string[];
    alternativesConsidered: string[];
  };

  evidenceRefs: SourceRef[];
  proposedMode:
    | "manager_discretion"
    | "explicit_user_confirmation"
    | "admin_mode";
};
```

```ts
type AuthorizationDecision = {
  schema: "direct_authorization_decision@1";

  decisionId: string;
  requestId: string;
  managerAgentId: string;
  worldmodelId: string;
  worldmodelRevision: number;

  decision:
    | "grant"
    | "deny"
    | "remand"
    | "escalate_user_confirmation"
    | "escalate_admin_mode";

  authorityScope?: string;
  expiresAt?: string;
  oneShot: boolean;
  conditions: string[];
  rationale: string;
  policyRefs: SourceRef[];
  evidenceRefs: SourceRef[];
  rawUserTextExposedToWorker: false;
  revisionCompatibility: RevisionCompatibility;
  currentWorldmodelRevision: number;
  currentWorldmodelDigest: string;
};
```

```ts
type RevisionCompatibility =
  | "exact_revision"
  | "compatible_newer_revision"
  | "stale_rejected"
  | "stale_remand_required";
```

Decision laws:

```text
grant is scoped, time-bounded, and cited
deny includes a blocked-action reason
remand asks worker for missing evidence or safer alternatives
user confirmation does not modify standing policy
admin-mode can modify standing policy only through policy-update transition
worker sees the decision result, not the whole constitutional deliberation
```

Stale revision posture:

```text
V0 records revisionCompatibility.
Destructive/account/external mutation requests cannot be granted blindly from
stale worker requests.
Safe manager-chat and delegation tests may continue with compatible_newer_revision
when changed lanes are not relevant, but the trace must say why.
```

## Admin-Mode Policy Update

```ts
type AdminModePolicyUpdate = {
  schema: "direct_admin_mode_policy_update@1";

  updateId: string;
  policyProfileId: string;
  userRoleState: "admin_mode";
  changeKind:
    | "create_policy"
    | "modify_policy"
    | "retire_policy"
    | "add_exception"
    | "remove_exception";

  actionClass: string;
  beforeDigest?: string;
  afterDigest: string;
  expectedBenefits: string[];
  failureModes: string[];
  exceptionRules: PolicyExceptionRule[];
  futureAutomationAllowed: boolean;
  futureEscalationRequiredWhen: string[];
  sourceRefs: SourceRef[];
};
```

```ts
type UserRoleState = {
  schema: "direct_user_role_state@1";

  userProfileId: string;
  sessionId: string;
  roleState:
    | "user_mode"
    | "local_confirmation_mode"
    | "admin_mode"
    | "policy_review_mode";

  enteredAt: string;
  expiresAt?: string;
  enteredByTransition:
    | "default_session_start"
    | "manager_local_escalation"
    | "explicit_admin_mode_entry"
    | "admin_mode_exit";

  purpose: string;
  activePolicyProfileId?: string;
  sourceRefs: SourceRef[];
  digest: string;
};
```

Admin-mode laws:

```text
admin-mode must be explicit
admin-mode is not inferred from a rushed task reply
admin-mode policy updates are durable, versioned, and reversible by policy
admin-mode decisions can bind future user-mode interactions
```

V0 admin-mode posture:

```text
durable policy mutation requires explicit admin_mode role state
ordinary manager chat starts in user_mode or manager_mode, not admin_mode
rich ceremony UI and expiry prompts are future UX hardening
```

## Action Class Registry

`actionClass` must not remain pure free text. Wave 23 introduces a registry
surface, but broad enforcement should mature after testing.

```ts
type ActionClassRegistryEntry = {
  schema: "direct_action_class_registry_entry@1";

  actionClass: string;
  family:
    | "read"
    | "write"
    | "destructive_write"
    | "external_write"
    | "network"
    | "account_mutation"
    | "agent_spawn"
    | "policy_mutation"
    | "tool_install"
    | "large_refactor"
    | "credit_consumption"
    | "public_communication";

  defaultRiskLevel: "low" | "medium" | "high" | "critical";
  defaultReversibility: "reversible" | "partly_reversible" | "irreversible" | "unknown";
  defaultAuthorizationPosture:
    | "allow"
    | "manager_discretion"
    | "explicit_user_confirmation_required"
    | "admin_mode_required"
    | "deny";

  requiredEvidence: EvidenceRequirement[];
  defaultEscalationRule: EscalationRule;
};
```

V0 registry posture:

```text
registry gives consistent names, risk, reversibility, and default posture
unknown action classes are allowed only for diagnostic/control-plane fixtures
dangerous unknown action classes are blocked or remanded
```

## Integration With Resident Tool Declarations

Future resident-callable tools must cite:

```text
active WorkerBootPacket
role lane
capability bundle composition witness
authorization channel
per-call authority route
manager policy state or absence thereof
```

This applies especially to:

```text
sub-agent spawn/send/wait/lifecycle
external writes
plugin install
headless daemon actions
rate-limit reset credit consumption
large refactors
destructive filesystem changes
network/account mutations
```

Tool catalog rows should explain why a capability is unavailable:

```text
blocked_by_policy
manager_authorization_required
explicit_user_confirmation_required
admin_mode_required
missing_worldmodel
stale_worldmodel
role_lane_not_authorized
evidence_missing
```

## Security And Privacy

```text
worker boot packets are least-context projections
raw user preference discussions are not automatically exposed to workers
raw admin-mode deliberation is not exposed to workers
workers do not see unrelated project preferences
manager ledger stores source refs and digests, not unnecessary raw payloads
authorization decisions expose bounded rationale only
policy profiles are durable but scoped
```

Sensitive lanes can export controlled signals instead of raw content:

```json
{
  "signal_type": "authorization_posture",
  "value": "explicit_user_confirmation_required",
  "detail_level": "minimal",
  "expires_after": "decision"
}
```

### Boot Packet Projection Witness

Workers should receive least-context projections, but V0 should start with a
witness before strict leakage gates become broad blockers.

```ts
type BootPacketProjectionWitness = {
  schema: "direct_boot_packet_projection_witness@1";

  bootPacketId: string;
  sourceWorldmodelId: string;
  sourceWorldmodelRevision: number;

  includedRefs: SourceRef[];
  omittedRefs: Array<{
    ref: SourceRef;
    omissionReason:
      | "irrelevant_to_scope"
      | "private_user_preference"
      | "admin_deliberation"
      | "unneeded_policy_detail"
      | "sensitive_lane"
      | "stale_or_unverified";
  }>;

  exportedSignals: Array<{
    signalType: string;
    value: string;
    detailLevel: "minimal" | "bounded" | "full";
    expiresAfter: "decision" | "thread" | "session";
  }>;

  digest: string;
};
```

Future hardening:

```text
worker boot packet fails if it contains raw admin-mode deliberation when a
bounded authorization posture signal was enough
```

## PR Plan

### PR 138: Active Interaction Worldmodel Kernel

Build schemas and validators:

```text
ActiveInteractionWorldmodel
WorldScopeRef
TaskOdeuLane
ArtifactEnvironmentOdeuLane
ModelSelfOdeuLane
InteractionGovernanceOdeuLane
WorldmodelUnknown
WorldmodelRemand
RevisionCompatibility helpers
```

Deliverables:

```text
worldmodel digest/revision helpers
root/parent/previous digest chain helpers
source-ref validation
stale/unknown/remand rows
fixture worldmodel for one existing direct session
fixture worldmodel for global_user, project, work_thread, and session scope
negative fixtures for missing O/E/D/U lanes
```

Non-goals:

```text
No live resident behavior change.
No policy decision engine.
No tool promotion.
```

### PR 139: Worldmodel Manager Role And Ledger

Add the standing manager object:

```text
ODEUWorldmodelManagerProfile
WorldmodelManagerLedger
manager-owned current pointers
manager status projection
manager chat session identity
manager cannot execute worker tasks
manager control-plane action boundary
UserRoleState scaffold
```

Deliverables:

```text
manager profile per user/project/work-thread
append-only worldmodel ledger rows
current active worldmodel pointer
manager direct chat instance marker
manager chat can inspect current worldmodel status
renderer/headless safe manager status projection
manager control-plane actions are typed separately from worker task actions
user-role-state rows for user-mode/admin-mode/manager-mode scaffolding
```

Non-goals:

```text
No admin-mode policy updates yet.
No worker authorization routing yet.
```

### PR 140: Thread Manager Delegation And Worker Boot Packets

Generate scoped thread/worker packets from the active worldmodel:

```text
ThreadManagerProfile
WorkThreadDelegationPacket
WorkerBootPacket
BootPacketOmission
BootPacketStaleWarning
AuthorityBoundary
BootPacketProjectionWitness
role-lane scoped ODEU projections
capability bundle refs
authorization channel refs
```

Deliverables:

```text
manager -> thread manager delegation packet builder
boot packet builder
boot packet digest validation
authority-boundary comparison witness
boot-packet projection witness builder
context-pack integration in shadow mode
resident self-report fixture for boot packet awareness
headless fixture where manager creates a WorkThread delegation packet
negative fixture for stale worldmodel revision
```

Non-goals:

```text
No automatic provider context injection until fixtures pass.
No broad policy ledger exposure to workers.
No full strict child-boundary blocker for every action class until test data
exists, except obvious dangerous broadening.
```

### PR 141: Role-Indexed Authorization Router

Add authorization request/decision routing:

```text
AuthorizationRequest
AuthorizationDecision
ActionClassRegistryEntry
PolicyResolutionTrace scaffold
manager discretion decision path
explicit user confirmation decision path scaffold
admin-mode escalation decision path scaffold
```

Deliverables:

```text
request builder from blocked worker/tool action
decision validator
decision ledger rows
action-class registry seed data
policy resolution trace rows in shadow/report posture
revision compatibility recorded on every decision
worker continuation envelope for grant/deny/remand/escalation
fixtures for broad refactor, destructive delete, read-only action
```

Non-goals:

```text
No actual destructive action promotion.
No casual worker-to-user permission prompts for policy-sensitive actions.
No full fail-closed policy engine for all safe/control-plane cases until
headless/manual behavior is observed.
```

### PR 142: Constitutional Policy And Self-Binding Records

Add durable policy profiles:

```text
ConstitutionalPolicyProfile
ConstitutionalPolicyRule
PolicyExceptionRule
SelfBindingPreferenceRecord
AdminModePolicyUpdate
PolicyResolutionTrace
```

Deliverables:

```text
policy profile store
self-binding preference parser fixtures
admin-mode update envelope
policy digest/versioning
deterministic policy precedence algorithm in shadow/trace mode
negative fixture that casual user-mode yes cannot change policy
negative fixture for child policy broadening attempt
```

Non-goals:

```text
No autonomous natural-language policy mutation.
No hidden admin-mode inference.
No broad runtime blocker for every unresolved policy conflict until tests show
the intended interaction dynamic.
```

### PR 143: Tool Catalog And Agentic Game Integration

Bind worldmodel/authorization to resident affordance truth:

```text
resident tool catalog cites boot packet and manager route
unavailable capabilities explain manager/admin/user-confirmation route
agentic game matrix includes role-indexed authorization cases
headless tests verify worker asks manager, not user, for blocked authority
hardening backlog is visible from test/report output
```

Deliverables:

```text
tool catalog status reasons:
  manager_authorization_required
  explicit_user_confirmation_required
  admin_mode_required
  missing_worldmodel
  stale_worldmodel

agentic games:
  manager chat starts a WorkThread and delegates to Thread Manager
  Thread Manager either executes simple task or emits worker spawn/request packet
  recursive relay preserves narrowed authority and escalation route
  worker broad refactor remands to manager
  manager discretion grants bounded read-only action
  casual user-mode yes cannot authorize standing policy change
  admin-mode policy update creates durable exception
  worker direct-to-user policy-sensitive permission prompt is invalid
  raw admin deliberation leakage is flagged by boot-packet projection witness
```

Non-goals:

```text
No sub-agent spawn/send/lifecycle promotion yet.
No rate-limit reset credit consumption.
No external write/plugin install promotion.
```

## Acceptance Criteria

```text
- Every worker boot packet cites an active worldmodel id and revision.
- The worldmodel model supports global_user, project, work_thread, and session
  scopes.
- WorkThreadId is not required before a WorkThread exists.
- Missing O/E/D/U lanes prevent a boot packet from claiming complete-valid
  status; V0 may still keep manager chat usable with an explicit remand.
- Worker boot packet omissions are explicit and digest-backed.
- BootPacketProjectionWitness records why each worker-visible field was
  included or omitted.
- Worldmodel Manager profile cannot execute worker task actions.
- Manager control-plane actions and worker task actions are distinguished.
- AuthorizationRequest includes action class, scope, risk, reversibility,
  evidence refs, and proposed mode.
- AuthorizationDecision is scoped, cited, logged, and records revision
  compatibility.
- Action classes are routed through a registry entry, not scattered string
  checks.
- Policy resolution emits a deterministic trace; V0 strict failure is limited
  to dangerous broadening/destructive/account/external mutations.
- Manager can grant/deny/remand/escalate without exposing raw policy ledger to
  the worker.
- Casual user-mode confirmation cannot modify standing constitutional policy.
- Admin-mode policy update requires explicit admin role state.
- Tool catalog can explain manager/admin/user-confirmation routes for blocked
  capabilities.
- Headless agentic games verify behavior and harness evidence agree.
- Manager chat can create a WorkThread delegation packet without doing worker
  task work itself.
- Thread Manager receives a narrowed delegated world; V0 emits an authority
  comparison witness and blocks only obvious dangerous broadening.
- No new dangerous tool becomes resident-callable in this wave.
```

## Future Hardening Parking Lot

These are real requirements, but they should be promoted after the first
headless/manual interaction data rather than blocking basic manager chat and
delegation in PR 138-143:

```text
full child-boundary subset blocker across all action classes
full fail-closed policy precedence engine across all action classes
strict stale-revision rejection across all authorization requests
richer admin-mode entry/update/expiry/exit UX
hard boot-packet blocker for all raw admin deliberation leakage classes
universal tool preflight blocker for missing boot packet/worldmodel route
```

## Completion Gate

Wave 23 is complete when:

```text
Direct has a durable ODEU Worldmodel Manager that can build active interaction
worldmodels, produce scoped worker boot packets, route authorization requests
through role-indexed policy, distinguish user-mode from admin-mode, start a
manager-owned WorkThread delegation to a Thread Manager, and expose resident
capability truth without granting new dangerous actions.

V0 hardening produces witnesses/traces first and promotes strict blockers only
where the action is already dangerous under current authority policy.
```

Passing this wave should not mean:

```text
workers can spawn sub-agents
workers can mutate policy
workers can ask the user directly for policy-sensitive authority
casual approvals become standing rules
manager performs worker task work
worldmodel truth is inferred from transcript vibes
```
