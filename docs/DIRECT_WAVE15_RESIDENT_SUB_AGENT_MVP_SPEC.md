# Direct Wave 15 Resident Sub-Agent MVP Spec

Status: planning spec for Wave 15.

Primary branch:

```text
codex/direct-chatgpt-harness
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md
docs/DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
docs/DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md
```

## Purpose

Wave 15 promotes the existing direct sub-agent substrate into the first
resident-callable live capability family.

The goal is narrow:

```text
resident agent
  -> can spawn one bounded child agent
  -> can list known child agents
  -> can inspect a child agent through an E-channel witness
  -> can bounded-wait for a child agent without deadlock/replay risk
  -> can consume a sanitized child result through result/context admission
```

The goal is not to create a mature multi-agent institution. That comes later.

Wave 15 should consume the Wave 14.5 ODEU live-capability kernel instead of
inventing family-local enabled flags:

```text
capability row
  -> promotion decision
  -> activation row
  -> declaration snapshot
  -> per-call authority decision
  -> live transaction
  -> result envelope
  -> context admission
  -> resident/operator witness
  -> usability proof
```

## Existing Substrate

Existing files already provide pieces that Wave 15 should adapt, not rewrite:

```text
src/main/direct/agents/live-tool-surface.js
src/main/direct/agents/provider-backed-route.js
src/main/direct/agents/runtime-substrate.js
src/main/direct/agents/observability.js
src/main/direct/agents/inspect-wait-containment.js
src/main/direct/bridge/sub-agent-governance-envelope.js
src/main/direct/bridge/resident-epistemic-snapshot.js
src/main/direct/bridge/resident-tool-epistemic-catalog.js
```

Current posture:

```text
local graph/mailbox/lifecycle surface exists
provider-backed child execution route exists
text-only / restricted tool surfaces exist
sub-agent observability and no-interference evidence exists
resident-callable provider declaration is not yet kernel-backed
result admission is not yet standardized through Wave 14.5 objects
usability proof/witness rows are not yet emitted for sub-agent tools
```

## Core Doctrine

Standing laws:

```text
spawn authority != child authority
child result != primary Codex final answer
child transcript != primary transcript
E-channel visibility != interference authority
wait != replay
wait != indefinite blocking
inspect != transcript flattening
provider-backed child execution != recursive tool inheritance
resident-callable declaration != per-call authorization
```

The parent agent may know the child state through an E-channel witness without
being allowed to send follow-up messages, interrupt, resume, close, or mutate
the child context.

Wave 15 child agents are **single-shot text-only workers**:

```text
one bounded task in
one bounded child run
one terminal result summary out
```

They are not continuing collaborators, recursive delegates, or child sessions
with inherited tools.

Wave 15 supports one child per spawn call and bounded child execution. Multiple
children may exist in the graph over time, but the resident-callable operation
is a bounded worker run, not a full multi-agent institution.

## First Usable Slice

Resident-callable in Wave 15:

```text
spawn_agent
list_agents
inspect_agent
wait_agent
```

Result admitted in Wave 15:

```text
sanitized child result summary
child status / terminal state
child usage attribution when available
result-envelope and context-admission refs
```

Still diagnostic after Wave 15:

```text
full child transcript browsing
legacy compatibility names
interference/no-interference visualization details
child tool inheritance posture
sub-agent token split beyond available provider evidence
```

Still blocked or future-wave:

```text
send_message / followup_task
close_agent
interrupt_agent
resume_agent
recursive child spawning
child inherited parent tools
child output flattening into primary transcript
batch fan-out
operator-editable child context
```

Activation scope:

```text
PR 92 activation rows are shadow/test activations only:
  shadow_only
  fixture_only
  headless_test_only

They must not become resident-callable provider declarations.

Only PR 95 may produce:
  resident_callable_live_provider_declared

and only after PR 94 proves provider-backed spawn/run, result reduction, result
envelope, context admission, and negative flattening checks.
```

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| SubAgentCapabilityProfile | support artifact | align/build | maps spawn/list/inspect/wait to ODEU capability lifecycle rows |
| ResidentSubAgentToolDeclaration | support artifact | build | declares resident-visible/requestable/callable tool surface only after activation proof |
| SubAgentSpawnRequestEnvelope | authority artifact | align/build | bounded child creation intent, no recursive spawn, no inherited tools |
| SubAgentSpawnPlan | authority artifact | build | pre-provider spawn plan with context, model/effort policy, idempotency, and no-inherited-authority flags |
| SubAgentSpawnIdempotencyLedger | evidence artifact | build | duplicate suppression by request key and child identity |
| SubAgentPerCallAuthorityAdapter | authority artifact | build | emits ODEU per-call authority decisions for spawn/list/inspect/wait |
| SubAgentLiveTransactionAdapter | evidence artifact | build | wraps concrete sub-agent operations in ODEU transaction lifecycle rows |
| SubAgentWaitNoDeadlockPolicy | authority artifact | align/build | timeout, max depth, cancellation/handoff posture, no indefinite waits |
| SubAgentWaitPlan | authority artifact | build | wait graph digest, cycle check, lifecycle state, and replayAllowed=false |
| SubAgentEChannelWitness | observability artifact | align | resident-safe status/progress without transcript or interference authority |
| SubAgentResultReducerPolicy | support artifact | build | summary-only reducer before result envelope/admission |
| SubAgentResultEnvelopeAdapter | evidence artifact | build | emits ODEU result envelope for child result/status |
| SubAgentContextAdmissionAdapter | context artifact | build | admits only sanitized child result/status into context |
| SubAgentResultAdmissionEnvelope | context artifact | build | family-specific proof that child transcript/prompt/payload were not flattened |
| SubAgentUsageAttributionRow | evidence artifact | build | attributes child tokens/model/effort to child thread/agent when exposed |
| SubAgentUsabilityProof | proof artifact | build | proves first usable slice with deterministic evidence, not self-report alone |

## Tool Contracts

### `spawn_agent`

Input:

```ts
type SpawnAgentInput = {
  task: string;
  agentRole?: "researcher" | "auditor" | "summarizer" | "implementation_observer" | "child_worker";
  model?: string;
  reasoningEffort?: string;
  idempotencyKey?: string;
  noInterferencePolicy?: "observe_only" | "no_parent_followup" | "none";
};
```

Wave 15 rules:

```text
- task is required and must be bounded/truncated before provider transport.
- idempotencyKey is required or deterministically derived from safe metadata.
- duplicate idempotency key must not spawn a second child.
- child tools are disabled by default.
- recursive spawn is disabled.
- parent follow-up/interference is disabled except observe/wait/inspect.
- provider request starts only after ODEU per-call authority allows it.
- spawn result produces child identity, E-channel witness, and transaction refs.
```

`agentRole`, `model`, and `reasoningEffort` are policy-bound. They are not
free authority strings:

```text
unknown agentRole -> default child_worker or block unknown_agent_role
requested model not in route/profile allowlist -> block or degrade with witness
requested reasoning effort not in allowed set -> block or degrade with witness
role/model/effort choices are evidence, not operator billing truth
```

Canonical idempotency input:

```ts
type SubAgentSpawnIdempotencyKeyInput = {
  parentWorkThreadId: string;
  parentThreadId: string;
  parentTurnId: string;
  taskDigest: string;
  agentRole?: string;
  model?: string;
  reasoningEffort?: string;
  noInterferencePolicy: string;
  spawnPolicyDigest: string;
};
```

Idempotency law:

```text
same key + same canonical input -> return existing child identity/status
same key + different canonical input -> block idempotency_conflict
missing key and derivation unavailable -> block before provider transport
raw task text is never part of the key; use digest/evidence refs
```

Pre-provider spawn plan:

```ts
type SubAgentSpawnPlan = {
  spawnPlanId: string;
  parentWorkThreadId: string;
  parentThreadId: string;
  parentTurnId: string;
  taskDigest: string;
  taskPreview: string;
  agentRole: string;
  model?: string;
  reasoningEffort?: string;
  childToolsEnabled: false;
  recursiveSpawnEnabled: false;
  inheritedParentAuthority: false;
  noInterferencePolicy: "observe_only" | "no_parent_followup" | "none";
  contextPackId: string;
  requestManifestId: string;
  perCallAuthorityDecisionId: string;
  idempotencyKey: string;
};
```

Spawn returns child identity/status. It does not automatically block the parent
turn. `wait_agent` is the only operation that waits.

### `list_agents`

Input:

```ts
type ListAgentsInput = {
  scope?: "current_turn" | "current_thread" | "current_work_thread";
};
```

Wave 15 rules:

```text
- read-only operation.
- default scope is current_thread.
- current_work_thread is explicit.
- resident tools do not expose project-global listing.
- must cite current primary thread/work-thread scope.
- returns renderer/resident-safe agent summaries.
- must not include raw child prompt, raw child transcript, or raw provider payload.
```

### `inspect_agent`

Input:

```ts
type InspectAgentInput = {
  agentThreadId: string;
  detail?: "status" | "summary";
};
```

Wave 15 rules:

```text
- target identity is required.
- stale/missing child id blocks before provider transport.
- child must belong to current allowed thread/work-thread scope.
- output is E-channel status/progress, not transcript flattening.
- no control/interference authority is granted.
```

Blocked states:

```text
child_missing
child_stale
child_wrong_work_thread
child_transcript_not_visible
child_control_blocked
```

### `wait_agent`

Input:

```ts
type WaitAgentInput = {
  agentThreadId: string;
  timeoutMs?: number;
  maxWaitDepth?: number;
};
```

Wave 15 rules:

```text
- timeout is required or default bounded.
- maxWaitDepth is capped.
- wait must be cancellable/handoff-safe.
- wait cannot create provider replay.
- wait cannot block on a cycle or unknown handoff state.
- wait returns status/result refs, not raw child transcript.
```

Concrete wait plan:

```ts
type SubAgentWaitPlan = {
  waitId: string;
  parentThreadId: string;
  parentTurnId: string;
  targetAgentThreadId: string;
  waitMode: "terminal_or_timeout";
  timeoutMs: number;
  maxWaitDepth: number;
  waitGraphDigest: string;
  cycleCheck: "passed" | "failed";
  targetLifecycleAtStart:
    | "created"
    | "running"
    | "completed"
    | "failed"
    | "timeout"
    | "handoff_unknown"
    | "missing"
    | "stale";
  lifecycle:
    | "planned"
    | "blocked"
    | "waiting"
    | "target_completed"
    | "target_failed"
    | "timeout"
    | "handoff_unknown"
    | "cancelled"
    | "recovery_required";
  replayAllowed: false;
};
```

Additional wait laws:

```text
wait_agent does not create a second child run.
wait_agent does not resume provider transport.
wait_agent does not poll by sending model messages.
wait_agent can only observe existing child lifecycle state.
wait_agent cannot wait on parent, ancestor, or unknown graph node.
wait_agent returns result admission only when terminal state is exact.
handoff_unknown/unknown returns status envelope only, no child result admission.
```

Restart while wait is active:

```text
classify wait state
do not replay spawn
do not restart child provider request
resume only local observation if child lifecycle is exact
otherwise mark recovery_required
```

## Result Admission Law

Child result handling must follow:

```text
child provider output
  -> local child result record
  -> ODEU result envelope
  -> context admission record
  -> primary transcript activity summary
  -> resident witness update
```

Never:

```text
child provider output
  -> primary transcript as if main Codex answered
```

Admitted result shape:

```ts
type SubAgentAdmittedResult = {
  childAgentId: string;
  childThreadId: string;
  terminalState: "completed" | "failed" | "cancelled" | "timeout" | "handoff_unknown" | "unknown";
  summary: {
    summaryText: string;
    summaryPolicyId: string;
    sourceResultDigest: string;
    summaryDigest: string;
    truncationState: "none" | "truncated" | "omitted";
    redactionState: "none_needed" | "redacted" | "blocked";
    rawChildOutputIncluded: false;
    rawChildPromptIncluded: false;
    rawProviderPayloadIncluded: false;
  };
  resultEnvelopeId: string;
  contextAdmissionId: string;
  usageAttributionRef?: string;
};
```

Child result summary may include:

```text
task outcome
key findings
artifact refs
failure/timeout reason
omitted/truncated markers
```

Child result summary may not include:

```text
raw child prompt
full child transcript
raw provider payload
hidden system/developer text
unredacted file contents beyond result policy
```

Reducer policy:

```ts
type SubAgentResultReducerPolicy = {
  policyId: string;
  maxSummaryChars: number;
  includeArtifactRefs: boolean;
  includeUsageSummary: boolean;
  includeTranscriptQuotes: false;
  includeRawProviderPayload: false;
  includeRawPrompt: false;
};
```

Family-specific result-admission envelope:

```ts
type SubAgentResultAdmissionEnvelope = {
  envelopeId: string;
  childAgentId: string;
  childThreadId: string;
  spawnPlanId: string;
  waitPlanId?: string;
  terminalState: string;
  resultEnvelopeId: string;
  contextAdmissionId: string;
  admittedToParentContext: boolean;
  admittedToPrimaryTranscript: "activity_summary_only";
  childTranscriptFlattened: false;
  rawChildPromptIncluded: false;
  rawChildTranscriptIncluded: false;
  rawProviderPayloadIncluded: false;
};
```

## Usage Attribution

Wave 15 should attribute usage separately when provider evidence exists:

```text
parent turn usage
child agent usage
child model
child reasoning effort
child duration / time to first token when available
```

If exact usage is unavailable:

```text
do not infer zero
record unavailable/degraded posture
keep parent and child attribution structurally separate
```

Usage attribution row:

```ts
type SubAgentUsageAttributionRow = {
  usageAttributionId: string;
  childAgentId: string;
  childThreadId: string;
  parentThreadId: string;
  usageState:
    | "exact"
    | "provider_reported_partial"
    | "unavailable"
    | "unknown";
  unavailableReason?:
    | "provider_did_not_report"
    | "stream_interrupted"
    | "handoff_unknown"
    | "schema_unsupported"
    | "redacted";
  parentUsageMerged: false;
};
```

## Resident Visibility

The resident agent should see:

```text
sub-agent tools available/callable/blocked
current child agents and statuses
which actions are unavailable and why
no-interference policy posture
proof/witness refs when compact enough
```

The resident agent should not see by default:

```text
raw child prompt text
raw child transcript
raw provider payload
operator-only controls
full usage payloads beyond sanitized summaries
```

## Provider Declaration Boundary

Provider declaration is allowed only after:

```text
capability lifecycle rows exist
activation row allows resident-callable scope
declaration snapshot exists
per-call authority adapter exists
duplicate-spawn idempotency exists
wait no-deadlock policy exists
result envelope/context admission adapters exist
resident/operator witness rows exist
usability proof exists
headless smoke proves actual behavior
```

If any of those are missing:

```text
tool remains resident-visible or diagnostic, not resident-callable/provider-declared
```

Declaration shape:

```ts
type ResidentSubAgentToolDeclaration = {
  declarationId: string;
  activationSnapshotId: string;
  activationRegistryDigest: string;
  declaredTools: Array<
    | "spawn_agent"
    | "list_agents"
    | "inspect_agent"
    | "wait_agent"
  >;
  blockedTools: Array<
    | "send_message"
    | "followup_task"
    | "close_agent"
    | "interrupt_agent"
    | "resume_agent"
  >;
  declarationDigest: string;
  requestShapeFamily: "resident_sub_agent_mvp@1";
};
```

Declaration laws:

```text
tool call must match declaration digest
undeclared sub-agent tool call blocks
blocked tool call returns unsupported/blocked envelope
declaration is frozen per request snapshot
operator projection cannot add declared tools
```

## PR Plan

### PR 92: Sub-Agent Capability Profile And ODEU Lifecycle Adapter

Purpose:

```text
Map the existing sub-agent surface into ODEU capability lifecycle rows.
```

Deliverables:

```text
SubAgentCapabilityProfile
capability rows for spawn/list/inspect/wait
promotion decisions for first usable slice
activation rows for shadow_only/fixture_only/headless_test_only scope
declaration snapshots for resident-visible, not provider-declared by default
blocked capability rows for send/followup/close/interrupt/resume/recursive spawn
blocked rows include reason and future wave owner
no resident-callable live provider declaration
regression proving no provider transport or executor calls
```

Non-goals:

```text
no resident-callable provider declaration
no child provider turn
no result admission
```

### PR 93: Sub-Agent Per-Call Authority, Idempotency, And Wait Policy

Purpose:

```text
Add concrete authority wrappers for spawn/list/inspect/wait before execution.
```

Deliverables:

```text
SubAgentPerCallAuthorityAdapter
SubAgentSpawnPlan
SubAgentWaitPlan
SubAgentSpawnIdempotencyLedger
SubAgentWaitNoDeadlockPolicy
LiveCapabilityTransaction rows for allowed/blocked calls
canonical idempotency key input
duplicate spawn suppression by idempotency key
agentRole/model/reasoningEffort allowlist validation
target missing/stale blocking for inspect/wait
wrong work-thread blocking
timeout/max-depth validation for wait
restart/recovery cases for active wait
regression proving blocked calls happen before provider transport
```

Non-goals:

```text
no provider-backed child execution yet
no resident provider declaration
no follow-up/interference actions
```

### PR 94: Provider-Backed Spawn/Run, Result Envelope, And Context Admission

Purpose:

```text
Adapt the existing provider-backed sub-agent route to emit ODEU result and
context-admission artifacts.
```

Deliverables:

```text
provider-backed spawn/run adapter over existing route
SubAgentResultReducerPolicy
sanitized child result envelope
SubAgentResultAdmissionEnvelope
context admission record for child result summary
child usage attribution row when provider usage is exposed
usage unavailable/degraded reason when exact usage is not exposed
terminal status mapping: completed/failed/timeout/cancelled/handoff_unknown
terminal exactness requirement for result admission
handoff_unknown returns status envelope only
raw prompt/output/provider payload exclusion checks
regression proving child output is not primary transcript output
```

Non-goals:

```text
no provider-declared resident tool yet
no child transcript full-history view
no child tools
```

### PR 95: Resident Tool Declaration, Witness, And Headless Smoke

Purpose:

```text
Declare spawn/list/inspect/wait as resident-callable only after the proof chain
exists.
```

Deliverables:

```text
ResidentSubAgentToolDeclaration
declaration snapshot digest
frozen activation snapshot
resident epistemic catalog rows for callable/blocked states
capability witness rows for resident/operator surfaces
CapabilityUsabilityProof for first usable slice
headless smoke: resident asks to spawn child, inspect, wait, and consume summary
negative smoke: send/followup/close/interrupt/resume block as undeclared
negative smoke: recursive spawn inside child blocks by child tools disabled
proof that self-report is supplemental, not the proof source
```

Non-goals:

```text
no UI-first implementation
no operator control expansion
no follow-up/close/resume/interrupt
```

### PR 96: Operator Projection And Manual Usability Gate

Purpose:

```text
Expose the Wave 15 MVP safely to the operator without flattening child work into
the primary transcript.
```

Deliverables:

```text
primary transcript activity summary for spawned/running/completed child agents
operator-visible proof/status rows in settings/control surface
Sub-agents panel projection reuse or compatibility note
manual smoke gate for spawn/list/inspect/wait/result admission
analytics hook for child usage attribution when available
operator projection reads proof artifacts; it does not mint proof
roadmap/audit update marking Wave 15 complete if all gates pass
```

Non-goals:

```text
no full child transcript redesign
no right-pane UX overhaul
no lifecycle/interference controls beyond inspect/wait
no operator projection authority to declare tools, override activation, inject
child transcript, or send follow-up/interrupt/close
```

## Global Acceptance Criteria

Wave 15 is complete only when:

```text
- Wave 15 child agents are single-shot text-only workers.
- spawn/list/inspect/wait have ODEU capability lifecycle rows.
- Resident-callable declaration exists only after activation and proof.
- Resident declaration snapshot includes only spawn/list/inspect/wait.
- send/followup/close/interrupt/resume are explicitly undeclared and blocked in
  negative smoke.
- Every concrete call emits per-call authority and transaction rows.
- SpawnAgentInput agentRole/model/reasoningEffort are policy validated.
- Spawn creates SubAgentSpawnPlan before provider transport.
- Duplicate idempotency key with same canonical input returns existing child;
  same key with different input blocks.
- Spawn does not automatically block parent; wait_agent is the only waiting
  operation.
- list_agents default scope is current_thread; current_work_thread is explicit;
  no project-global resident listing.
- inspect/wait require child belongs to current allowed scope.
- Missing/stale/wrong-scope child id blocks inspect/wait before provider
  transport.
- Wait uses SubAgentWaitPlan with wait graph digest, cycle check, timeout, max
  depth, and replayAllowed=false.
- wait on handoff_unknown/unknown returns status envelope only, no child result
  admission.
- Wait has timeout/max-depth/no-deadlock evidence.
- Child output passes through SubAgentResultReducerPolicy before result envelope.
- SubAgentResultAdmissionEnvelope proves childTranscriptFlattened=false.
- Child provider result is wrapped in result envelope and context admission.
- Child result is summarized/admitted, not flattened into primary transcript.
- Child usage attribution includes unavailable/degraded reason and
  parentUsageMerged=false.
- Child usage attribution is separate from parent usage when available.
- Resident/operator witness rows cite usability proof refs.
- Headless smoke proves actual spawn/list/inspect/wait/result path.
- Operator projection cannot expand Wave 15 controls.
- All raw prompt/output/provider payload flags remain false in renderer/resident
  projection fixtures.
```

## Review Questions

Ask review specifically:

```text
1. Is the Wave 15 first usable slice narrow enough?
2. Are PR 92-96 split at the right ODEU boundaries?
3. Should provider-backed spawn/run happen before or after resident declaration?
4. Are wait timeout/deadlock/idempotency blockers sufficient?
5. Is any child-result admission too permissive for a first resident-callable slice?
```
