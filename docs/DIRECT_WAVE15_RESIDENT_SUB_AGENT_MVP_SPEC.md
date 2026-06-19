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

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| SubAgentCapabilityProfile | support artifact | align/build | maps spawn/list/inspect/wait to ODEU capability lifecycle rows |
| ResidentSubAgentToolDeclaration | support artifact | build | declares resident-visible/requestable/callable tool surface only after activation proof |
| SubAgentSpawnRequestEnvelope | authority artifact | align/build | bounded child creation intent, no recursive spawn, no inherited tools |
| SubAgentSpawnIdempotencyLedger | evidence artifact | build | duplicate suppression by request key and child identity |
| SubAgentPerCallAuthorityAdapter | authority artifact | build | emits ODEU per-call authority decisions for spawn/list/inspect/wait |
| SubAgentLiveTransactionAdapter | evidence artifact | build | wraps concrete sub-agent operations in ODEU transaction lifecycle rows |
| SubAgentWaitNoDeadlockPolicy | authority artifact | align/build | timeout, max depth, cancellation/handoff posture, no indefinite waits |
| SubAgentEChannelWitness | observability artifact | align | resident-safe status/progress without transcript or interference authority |
| SubAgentResultEnvelopeAdapter | evidence artifact | build | emits ODEU result envelope for child result/status |
| SubAgentContextAdmissionAdapter | context artifact | build | admits only sanitized child result/status into context |
| SubAgentUsageAttributionRow | evidence artifact | build | attributes child tokens/model/effort to child thread/agent when exposed |
| SubAgentUsabilityProof | proof artifact | build | proves first usable slice with deterministic evidence, not self-report alone |

## Tool Contracts

### `spawn_agent`

Input:

```ts
type SpawnAgentInput = {
  task: string;
  agentRole?: string;
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

### `list_agents`

Input:

```ts
type ListAgentsInput = {
  scope?: "current_turn" | "current_thread";
};
```

Wave 15 rules:

```text
- read-only operation.
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
- output is E-channel status/progress, not transcript flattening.
- no control/interference authority is granted.
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
  terminalState: "completed" | "failed" | "cancelled" | "timeout" | "unknown";
  resultSummary: string;
  resultEnvelopeId: string;
  contextAdmissionId: string;
  usageAttributionRef?: string;
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
activation rows for fixture/headless scope
declaration snapshots for resident-visible, not provider-declared by default
blocked capability rows for send/followup/close/interrupt/resume/recursive spawn
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
SubAgentSpawnIdempotencyLedger
SubAgentWaitNoDeadlockPolicy
LiveCapabilityTransaction rows for allowed/blocked calls
duplicate spawn suppression by idempotency key
target missing/stale blocking for inspect/wait
timeout/max-depth validation for wait
regression proving blocked calls happen before provider transport
```

Non-goals:

```text
no provider-backed child execution yet
no resident provider declaration
no follow-up/interference actions
```

### PR 94: Provider-Backed Spawn/Run Result Envelope And Admission

Purpose:

```text
Adapt the existing provider-backed sub-agent route to emit ODEU result and
context-admission artifacts.
```

Deliverables:

```text
provider-backed spawn/run adapter over existing route
sanitized child result envelope
context admission record for child result summary
child usage attribution row when provider usage is exposed
terminal status mapping: completed/failed/timeout/cancelled/handoff_unknown
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
resident epistemic catalog rows for callable/blocked states
capability witness rows for resident/operator surfaces
CapabilityUsabilityProof for first usable slice
headless smoke: resident asks to spawn child, inspect, wait, and consume summary
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
roadmap/audit update marking Wave 15 complete if all gates pass
```

Non-goals:

```text
no full child transcript redesign
no right-pane UX overhaul
no lifecycle/interference controls beyond inspect/wait
```

## Global Acceptance Criteria

Wave 15 is complete only when:

```text
- spawn/list/inspect/wait have ODEU capability lifecycle rows.
- Resident-callable declaration exists only after activation and proof.
- Every concrete call emits per-call authority and transaction rows.
- Duplicate spawn by same idempotency key cannot create duplicate child agents.
- Missing/stale child id blocks inspect/wait before provider transport.
- Wait has timeout/max-depth/no-deadlock evidence.
- Child provider result is wrapped in result envelope and context admission.
- Child result is summarized/admitted, not flattened into primary transcript.
- Child usage attribution is separate from parent usage when available.
- Resident/operator witness rows cite usability proof refs.
- Headless smoke proves actual spawn/list/inspect/wait/result path.
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
