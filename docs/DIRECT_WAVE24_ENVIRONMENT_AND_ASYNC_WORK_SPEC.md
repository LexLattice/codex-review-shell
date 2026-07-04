# Direct Wave 24: Environment Topology, Cross-Env Tools, And Async Work

Status: planning spec for Wave 24.

Detailed PR range:

```text
PR 144-149
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md
docs/DIRECT_ROLE_LANE_TOOL_BUNDLE_COMPOSER_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
docs/DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md
docs/DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md
docs/DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md
```

## Purpose

Wave 23 made the active worldmodel, manager role, worker boot packet, and
authorization route explicit. Wave 24 turns the next execution consequences
into first-class direct-harness objects:

```text
execution environment truth
cross-environment tool routing
plugin-specialist delegation
registered async work
harness-managed wakeups
```

The root practical issue is that the resident model should not discover
workspace and tool topology by failing at runtime. It should know, from its
booted worldmodel and tool catalog:

```text
where the current turn is executing
which environment owns each tool
which tools require temporary environment transition
which tools are better delegated to a specialist worker
which long-running work is registered with the harness
how the model will be woken when that work reaches a condition
```

## Root Law

```text
Execution location is part of the active worldmodel, not an inference from
tool availability.
```

The model must not have to reason like this:

```text
try browser plugin
fail because this turn is in WSL
infer browser plugin lives on Windows
invent fallback
```

The intended posture is:

```text
tool catalog says browser control is available through Windows environment
main worker is currently in WSL
harness offers either a cross-env tool session or browser-specialist worker
worker requests the appropriate transition/delegation
harness records environment transition evidence
worker receives the result evidence back in its WSL work context
```

## Standing Laws

```text
Thread default environment != per-turn execution environment.
Tool availability != permission to use tool.
Cross-env tool use != workspace mutation authority.
Plugin session != ambient process authority.
Long-running process != model polling obligation.
Async work id is a harness object, not a prose nickname.
Harness wakeup is a typed continuation, not a hidden assistant message.
```

## V0 Execution Posture

Wave 24 should not over-gate basic direct interaction.

V0 posture:

```text
make environment and async work truth observable first
make tool catalog routing explicit first
prefer specialist delegation for plugins that require a distinct environment
keep strict blockers for workspace escape, destructive/account/external mutation,
and unsupported environment mapping
record witness/remand rows for weaker or experimental topology gaps
stage stricter stale-topology, compatibility, and policy-precedence blockers
behind headless/manual proof instead of blocking ordinary manager flow
```

This wave should not promote broad shell, arbitrary browser automation, plugin
installation, MCP mutation, or account mutations. It defines the execution
substrate needed before those can be safely promoted.

## Transition-Law Addendum

These laws are implementation requirements, but V0 should enforce them in a
graduated way. Dangerous routes block immediately; immature topology/policy
questions produce witnesses and remands first.

```text
Environment truth is not authority.
Tool route validity is not permission.
Specialist delegation does not change the parent worker's execution
environment.
Path mappings are denied unless explicit, bounded, and evidence-backed.
Async work must be registered by stable workId before status can be queried.
Long-running work should be started atomically with registration or adopted
with evidence.
Harness polling is not model reasoning.
Wake events are typed, idempotent continuations.
Process completion is not task success; contract satisfaction must be checked.
Stale topology, stale worldmodel, or unsupported environment mapping produces
remand unless a compatibility witness proves the changed fields irrelevant.
```

Strict-now:

```text
workspace escape
cross-env workspace mutation without explicit authority
destructive/account/external mutation
unsupported environment mapping
duplicate wake delivery to the same agent run without explicit requeue
```

Witness-first:

```text
non-dangerous stale topology compatibility
non-mutating plugin-specialist route quality
missing optional progress signal
weak but non-dangerous async closure evidence
```

## What We Need To Add

### 1. Environment Topology

Direct needs a canonical environment map that describes where work can execute.

```ts
type DirectEnvironmentKind =
  | "wsl"
  | "windows"
  | "local"
  | "remote"
  | "unknown";

type DirectEnvironmentRef = {
  schema: "direct_environment_ref@1";
  environmentId: string;
  environmentKind: DirectEnvironmentKind;
  displayLabel: string;
  workspaceEvidenceKey?: string;
  pathMappingRef?: string;
  defaultShell?: "bash" | "powershell" | "cmd" | "none" | "unknown";
  availableToolFamilyRefs: SourceRef[];
  sourceRefs: SourceRef[];
  digest: string;
};

type DirectEnvironmentTopology = {
  schema: "direct_environment_topology@1";
  topologyId: string;
  projectId: string;
  defaultEnvironmentId: string;
  environments: DirectEnvironmentRef[];
  mappings: EnvironmentPathMapping[];
  constraints: EnvironmentConstraint[];
  revision: number;
  previousDigest?: string;
  observedAt: string;
  expiresAt?: string;
  digest: string;
};

type EnvironmentPathMapping = {
  schema: "direct_environment_path_mapping@1";
  mappingId: string;
  fromEnvironmentId: string;
  toEnvironmentId: string;
  fromRootEvidenceKey: string;
  toRootEvidenceKey: string;
  direction: "one_way" | "two_way";
  mappingKind:
    | "wsl_windows_path"
    | "mounted_workspace"
    | "remote_mount"
    | "manual";
  readAllowed: boolean;
  writeAllowed: boolean;
  destructiveWriteAllowed: false;
  evidenceRefs: SourceRef[];
  digest: string;
};

type EnvironmentConstraint = {
  schema: "direct_environment_constraint@1";
  constraintId: string;
  environmentId: string;
  constraintKind:
    | "read_only"
    | "no_workspace_mutation"
    | "no_network"
    | "plugin_only"
    | "manual_confirmation_required"
    | "unknown";
  rationale: string;
  evidenceRefs: SourceRef[];
  digest: string;
};
```

The topology answers:

```text
default project execution is WSL
browser control runs in Windows
workspace backend owns WSL path truth
Windows browser worker may observe UI but may not mutate workspace files
path translation exists or does not exist
```

### 2. Per-Turn Execution Environment

Threads keep a default environment, but a turn can select or temporarily enter
another environment.

```ts
type TurnExecutionEnvironment = {
  schema: "direct_turn_execution_environment@1";
  turnId: string;
  threadId: string;
  workThreadId?: string;
  defaultEnvironmentId: string;
  residentEnvironmentId: string;
  selectedToolEnvironmentId?: string;
  delegatedSpecialistEnvironmentId?: string;
  selectionKind:
    | "thread_default"
    | "explicit_turn_override"
    | "tool_scoped_transition"
    | "specialist_worker_delegation";
  reason:
    | "default_work"
    | "tool_requires_environment"
    | "human_selected"
    | "manager_selected"
    | "authorization_route"
    | "unknown";
  authorityDecisionRef?: SourceRef;
  topologyRef: SourceRef;
  sourceRefs: SourceRef[];
  digest: string;
};
```

This split prevents false reporting. If a WSL implementer delegates browser
verification to a Windows specialist, the parent worker remains in WSL:

```text
residentEnvironmentId = wsl
delegatedSpecialistEnvironmentId = windows
selectionKind = specialist_worker_delegation
```

The parent only receives returned evidence unless a separate tool-scoped
transition is explicitly authorized.

The resident boot packet and tool catalog should expose this as compact truth:

```text
Current turn environment: WSL
Workspace root: project workspace evidence key
Browser control: available via Windows specialist worker
Cross-env writes: not allowed
```

### 3. Cross-Environment Tool Sessions

Some tools can run in a non-default environment without changing the whole
thread.

```ts
type EnvironmentTransitionWitness = {
  schema: "direct_environment_transition_witness@1";
  transitionId: string;
  sourceAgentId: string;
  sourceTurnId: string;
  fromEnvironmentId: string;
  toEnvironmentId: string;
  trigger:
    | "tool_call"
    | "manager_authorization"
    | "specialist_delegation"
    | "manual_operator";
  toolName?: string;
  scope:
    | "single_tool_call"
    | "tool_session"
    | "worker_run"
    | "turn";
  allowedActions: string[];
  forbiddenActions: string[];
  startedAt: string;
  endedAt?: string;
  status: "started" | "completed" | "failed" | "abandoned" | "unknown";
  resultEvidenceRefs: SourceRef[];
  digest: string;
};
```

V0 should support the data model and routing witnesses before giving workers
unbounded cross-env tool execution.

Environment-sensitive actions must cite both route validity and authorization
validity:

```text
environment route valid -> the action can be located
authorization decision valid -> the action may be performed
```

Initial action classes:

```text
cross_env_tool_session
plugin_specialist_delegation
browser_verification
workspace_path_translation
async_process_registration
async_work_cancel
async_provider_wake
external_job_registration
```

### 4. Plugin-Specialist Worker Delegation

Standalone plugins are often better handled by a bounded worker whose attention
and environment match the plugin contract.

```ts
type PluginSpecialistWorkerContract = {
  schema: "direct_plugin_specialist_worker_contract@1";
  contractId: string;
  sourceAgentId: string;
  targetAgentClass: string;
  targetEnvironmentId: string;
  pluginFamily: string;
  objective: string;
  allowedTools: string[];
  forbiddenActions: string[];
  inputEvidenceRefs: SourceRef[];
  expectedOutputShape: string;
  evidenceReturnContract: {
    allowedEvidenceKinds: string[];
    rawPayloadAllowed: false;
    workspaceMutationAllowed: boolean;
  };
  authorizationDecisionRef?: SourceRef;
  digest: string;
};
```

Example:

```text
main worker needs browser verification
  -> asks manager/tool router for browser verification
  -> harness delegates to BrowserVerificationWorker in Windows environment
  -> worker uses browser plugin under bounded contract
  -> result returns as evidence summary to main WSL worker
```

This avoids forcing the main implementer to multitask multiple plugins inside
one turn.

### 5. Async Work Registry

Any long-running process, sub-agent, browser worker, download, test run, or
external job should become a registered work object.

```ts
type AsyncWorkRegistration = {
  schema: "direct_async_work_registration@1";
  workId: string;
  ownerAgentId: string;
  parentTurnId: string;
  workThreadId?: string;
  kind:
    | "sub_agent"
    | "process"
    | "browser_worker"
    | "download"
    | "test_run"
    | "external_job";
  targetRef: {
    pid?: number;
    subAgentId?: string;
    threadId?: string;
    browserSessionId?: string;
    artifactRef?: SourceRef;
  };
  contract: AwaitableWorkContract;
  registrationMode:
    | "pre_registered"
    | "start_registered_atomically"
    | "adopted_existing_work"
    | "manual_import";
  startedByHarness: boolean;
  adoptionEvidenceRefs?: SourceRef[];
  status:
    | "registered"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "stale"
    | "unknown";
  latestSnapshotRef?: SourceRef;
  wakePolicy: AsyncWakePolicy;
  sourceRefs: SourceRef[];
  digest: string;
};
```

The model should not poll a sub-agent or process every 30 seconds by repeatedly
calling low-level tools. It should register the work and then either continue
other work or suspend until a typed condition fires.

### 6. Awaitable Work Contracts

```ts
type AsyncCondition = {
  schema: "direct_async_condition@1";
  conditionId: string;
  kind:
    | "process_exit_code"
    | "file_exists"
    | "file_count_at_least"
    | "stdout_pattern"
    | "stderr_pattern"
    | "artifact_digest_exists"
    | "status_snapshot_field"
    | "timeout_elapsed"
    | "manual_mark";
  targetRef: SourceRef;
  operator?: "equals" | "not_equals" | "contains" | "gte" | "lte" | "exists";
  expected?: string | number | boolean;
  evidenceRequired: boolean;
  digest: string;
};

type AsyncProgressSignal = {
  schema: "direct_async_progress_signal@1";
  signalId: string;
  kind:
    | "stdout_pattern"
    | "stderr_pattern"
    | "file_count"
    | "artifact_digest"
    | "status_snapshot_field"
    | "heartbeat"
    | "manual_note";
  targetRef: SourceRef;
  summary: string;
  evidenceRefs: SourceRef[];
  digest: string;
};

type AwaitableWorkContract = {
  schema: "direct_awaitable_work_contract@1";
  purpose: string;
  expectedOutputs: string[];
  doneConditions: AsyncCondition[];
  failConditions: AsyncCondition[];
  progressSignals: AsyncProgressSignal[];
  timeoutMs?: number;
  pollStrategy:
    | "harness_default"
    | "fixed_interval"
    | "event_driven"
    | "manual_only";
  rawOutputPolicy:
    | "summary_only"
    | "bounded_excerpt"
    | "artifact_ref_only"
    | "allowed_by_contract";
};

type AsyncWakePolicy = {
  schema: "direct_async_wake_policy@1";
  wakeOwnerAgent: boolean;
  wakeThreadManager: boolean;
  wakeWorldmodelManager: boolean;
  wakeOn:
    | "completed"
    | "failed"
    | "completed_or_failed"
    | "progress_threshold"
    | "manual";
  messageShape:
    | "status_summary"
    | "evidence_packet"
    | "manager_remand"
    | "custom_contract";
};

type AsyncWorkStatusSnapshot = {
  schema: "direct_async_work_status_snapshot@1";
  snapshotId: string;
  workId: string;
  status:
    | "registered"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "stale"
    | "unknown";
  progressSummary?: string;
  matchedConditionRefs: SourceRef[];
  evidenceRefs: SourceRef[];
  observedAt: string;
  digest: string;
};

type AsyncWorkStateTransition = {
  schema: "direct_async_work_state_transition@1";
  transitionId: string;
  workId: string;
  fromStatus: string;
  toStatus: string;
  reason:
    | "registered"
    | "started"
    | "progress_snapshot"
    | "done_condition_met"
    | "fail_condition_met"
    | "timeout"
    | "cancel_requested"
    | "cancel_completed"
    | "stale_detected"
    | "manual_mark";
  evidenceRefs: SourceRef[];
  observedAt: string;
  digest: string;
};

type AsyncWorkOutcome = {
  schema: "direct_async_work_outcome@1";
  workId: string;
  processStatus: "completed" | "failed" | "timed_out" | "cancelled";
  contractStatus: "satisfied" | "violated" | "inconclusive";
  closureReportRef?: SourceRef;
  evidenceRefs: SourceRef[];
  digest: string;
};
```

The harness performs mechanical waiting. The model consumes status/evidence
packets.

Current status is derived from append-only state transitions. Process completion
does not imply contract success:

```text
process exited 0
expected 25 trace artifacts
found 20 trace artifacts
=> processStatus = completed
=> contractStatus = violated
```

### 7. Agent-Facing Async Tools

Expose a small meta-tool family once the registry exists:

```text
register_async_work
get_async_work_status
list_async_work
cancel_async_work
await_async_work
```

These tools are not raw process tools. They operate on registered work ids and
return standard status packets.

Agent-facing law:

```text
If the model starts long-running work, it must receive or create a workId.
Future status checks use the workId.
Harness owns polling mechanics.
Wakeup packets cite the workId and contract.
```

### 8. Wakeup And Suspension Semantics

```ts
type AgentSuspensionState = {
  schema: "direct_agent_suspension_state@1";
  suspensionId: string;
  agentId: string;
  agentRunId: string;
  reason:
    | "awaiting_async_work"
    | "awaiting_authorization"
    | "awaiting_user_input"
    | "awaiting_external_event";
  awaitingWorkIds: string[];
  continuationContractRef: SourceRef;
  startedAt: string;
  expiresAt?: string;
  status: "active" | "woken" | "expired" | "cancelled";
};

type AgentWakeEvent = {
  schema: "direct_agent_wake_event@1";
  wakeEventId: string;
  idempotencyKey: string;
  targetAgentId: string;
  targetAgentRunId: string;
  reason:
    | "async_work_completed"
    | "async_work_failed"
    | "authorization_resolved"
    | "user_input_received"
    | "external_event";
  payloadRef: SourceRef;
  wakePolicyRef: SourceRef;
  consumptionMode: "exactly_once" | "at_least_once_with_dedupe";
  sourceWorkId?: string;
  createdAt: string;
  consumedAt?: string;
  status: "queued" | "delivered" | "failed" | "stale";
};
```

This lets the harness wake a model with a typed continuation rather than
requiring the model to keep attention blocked on polling.

## UX And Headless Projection

### Resident Model

The resident model should be able to answer:

```text
What environment am I currently in?
Which tools require another environment?
Can I ask for browser verification?
What async work have I registered?
What is process/sub-agent X doing?
Will I be woken when it completes?
```

### Human UX

The left plane should not become a diagnostic dashboard. The middle/control
surfaces should show:

```text
current environment
active cross-env sessions
registered async work
wake queue
specialist workers
stale/failed waits
```

### Headless

Headless tests should cover:

```text
WSL default environment projected to worker
browser tool shown as Windows/specialist-routed
unsupported path mapping produces remand
long-running process registration returns workId
status lookup by workId returns standard packet
harness wake event is emitted on completion
model does not need raw polling loop
sub-agent observe-only no-interference contract survives async wake
```

## PR Plan

### PR 144: Environment Topology And Per-Turn Environment

Add:

```text
DirectEnvironmentTopology
DirectEnvironmentRef
EnvironmentPathMapping
EnvironmentConstraint
TurnExecutionEnvironment
topology digest/revision helpers
stale-topology compatibility witness
boot-packet environment projection update
headless fixture for WSL default + Windows browser-capable topology
```

Non-goals:

```text
No live browser/plugin execution.
No per-turn UI switching.
No arbitrary environment mutation.
```

### PR 145: Environment-Aware Tool Catalog

Add:

```text
tool catalog environment owner fields
tool route classes:
  same_environment
  cross_environment_tool_session
  specialist_worker_required
  unsupported_environment
environment-sensitive action-class mapping
resident capability explanation for environment-routed tools
negative fixtures for stale/missing topology
```

Non-goals:

```text
No new broad tools.
No permission grant from environment availability.
```

### PR 146: Cross-Environment Transition Witnesses

Add:

```text
EnvironmentTransitionWitness
cross-env authorization route envelope
transition lifecycle rows
boot packet + topology revision + tool route citation
single-tool-session witness fixtures
workspace mutation forbidden-by-default checks
```

Non-goals:

```text
No persistent Windows worker runtime yet.
No browser plugin live control.
```

### PR 147: Plugin-Specialist Worker Contracts

Add:

```text
PluginSpecialistWorkerContract
BrowserVerificationWorker role scaffold
delegation packet adapter from main worker to specialist worker
evidence return contract
headless fixture for WSL implementer -> Windows browser verifier
```

Non-goals:

```text
No full plugin marketplace.
No plugin install.
No unbounded browser automation.
```

### PR 148: Async Work Registry And Awaitable Contracts

Add:

```text
AsyncWorkRegistration
AwaitableWorkContract
AsyncWakePolicy
AsyncWorkStatusSnapshot
AsyncCondition
AsyncProgressSignal
AsyncWorkStateTransition
AsyncWorkOutcome
registry/store with append-only state transitions
agent-facing meta-tool schemas:
  register_async_work
  get_async_work_status
  list_async_work
  cancel_async_work
  await_async_work
fixtures for process/test/sub-agent-style work
```

Non-goals:

```text
No arbitrary process manager UI.
No automatic model wake provider call unless PR 149 opts in.
```

### PR 149: Wakeup/Suspension Continuations And Headless Games

Add:

```text
AgentSuspensionState
AgentWakeEvent
wake queue
idempotent wake delivery
typed continuation packet
headless game for:
  start long-running work
  suspend or continue other work
  harness records completion
  model receives wake packet
  model uses registered evidence instead of polling
```

Non-goals:

```text
No background autonomous task swarm.
No hidden provider spend.
No wakeup without explicit registered contract.
```

## Acceptance Criteria

```text
- Active worldmodel/boot packet can state current execution environment.
- Tool catalog can distinguish same-env, cross-env, specialist-routed, and
  unsupported tools.
- Environment availability never grants authority by itself.
- EnvironmentPathMapping is explicit, directional, root-bounded, and
  evidence-backed.
- Missing or stale topology blocks dangerous environment-routed actions and
  otherwise produces remand unless compatibility is witnessed.
- Specialist delegation does not imply the parent worker changed execution
  environment.
- Cross-env transition witnesses record from/to environment, trigger, scope,
  allowed/forbidden actions, and result evidence.
- Cross-env transition witnesses cite boot packet, topology revision,
  authorization route, and tool catalog route.
- Cross-env workspace writes are denied unless an explicit workspace authority
  ref permits them.
- Plugin-specialist delegation preserves source objective, target environment,
  allowed tools, forbidden actions, and evidence return contract.
- Async work registration produces stable work ids.
- Async work start is pre-registered, atomically registered, or explicitly
  adopted with evidence.
- Async lifecycle transitions are append-only and derive current status.
- Async completion is distinguished from contract satisfaction.
- Async status is queried by work id, not by model-invented prose names.
- Harness-owned polling/waiting is represented separately from model reasoning.
- Wake events are typed continuations with evidence refs.
- Wake events are idempotent and consumed exactly once unless requeued.
- Cancellation of async work is authorization-sensitive.
- await_async_work suspends or delegates waiting to the harness; it must not
  recreate raw polling in model space.
- Parent agents receive compact ODEU async closure reports, not raw logs by
  default.
- Workspace mutation remains bound to the authorized workspace environment.
- Unsupported or stale environment mappings produce remands, not invented
  execution.
- Headless games prove the resident model can correctly describe environment,
  tool routing, async work, and wake behavior from harness truth.
```

## Deferred Scope

```text
live browser plugin execution
computer-use worker execution
MCP mutation worker execution
plugin install/uninstall
rate-limit reset credit consumption
general shell/network environment switching
full UI for async work management
automatic background task creation without explicit contract
```

## Completion Gate

Wave 24 is complete when direct can represent and test:

```text
one active worker running in WSL
one tool or specialist worker requiring Windows
one cross-env transition witness
one registered long-running work item
one harness-managed wake event
one resident answer that accurately explains all of the above
```

At that point, later waves can safely promote live browser/plugin workers and
larger async orchestration without making the resident model guess where tools
live or poll long-running work manually.
