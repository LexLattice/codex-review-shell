# Direct Wave 21: Agent Continuity And Governed Memory

Status: planning spec for Wave 21.

Detailed PR range:

```text
PR 126-131
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_WORK_THREAD_FOUNDATION_SPEC.md
docs/DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md
docs/DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_ROLE_LANE_TOOL_BUNDLE_COMPOSER_SPEC.md
```

## Purpose

Add `Agent` as a first-order Direct primitive above thread/session.

Current Direct persistence already has stable transcript/session semantics:

```text
Direct session/thread = persisted interaction witness
Direct turn = provider/runtime event inside that witness
Context pack = selected bridge information for a concrete turn
Request manifest = provider request-shape authorization evidence
WorkThread = human work-world/objective lane
```

The missing primitive is durable institutional actor identity:

```text
Agent = role-bearing continuity across threads, runs, memories, capabilities,
authority boundaries, and work threads.
```

Wave 21 must not replace thread/session. It must add an explicit layer above
thread/session so the same resident agent, auditor, worker, researcher, or
orchestrator can operate across multiple threads without losing identity or
laundering transcript evidence into memory.

## Core Doctrine

Standing law:

```text
Agent is the institutional actor.
Thread is an interaction/evidence witness.
Turn is one provider/runtime event inside a thread.
Memory is governed derived knowledge from evidence.
Context is selected bridge information for a concrete turn.
```

Operational laws:

```text
Agent != Thread.
Thread != Memory.
Memory != Context.
Context != Provider Truth.
Provider Output != Local Authority.
Local Authority != World Truth until execution evidence exists.
```

Memory law:

```text
Transcript is evidence.
Memory is a governed derivation from evidence.
Context is a selected projection from memory + current thread + work thread
+ authority state.
```

Anti-laundering law:

```text
Raw transcript does not become memory.
Memory does not become instruction.
Status does not become authority.
Tool result does not become project truth.
```

## Current Code Posture

The Direct code already carries agent-like fields on sessions:

```text
agentKind
agentThreadId
parentThreadId
primaryThreadId
agentLabel
agentRole
roleHandoffPacketId
workerStartTransitionId
workerContextPacketId
workerGraphAlignmentId
workThreadId
```

These fields are useful but still thread/session-local. Wave 21 turns them into
references to explicit objects:

```text
session.agentId
session.agentRunId
session.workThreadId
session.parentThreadId
session.primaryThreadId
```

The existing fields should remain readable for compatibility during migration.

## Object Model

### AgentClassSpec

Existing role/capability template concept. Examples:

```text
primary_coder
architecture_auditor
implementation_worker
researcher
orchestrator
closeout_worker
```

Wave 21 does not need to redesign `AgentClassSpec`; it should reference the
existing role-lane and capability models.

### AgentIdentity

Durable institutional actor.

```ts
type AgentIdentityKey = {
  projectId: string;
  agentClass: string;
  roleLane: string;
  ontologyProfileDigest?: string;
  capabilityProfileDigest?: string;
  authorityBoundaryDigest?: string;
  memoryScopeDigest?: string;
  stableNamespace: "project" | "work_thread" | "explicit_cross_project";
};

type AgentBackfillPolicy = {
  grouping:
    | "project_resident_default"
    | "project_role_lane"
    | "project_role_lane_work_thread"
    | "manual_only";
  confidence: "exact" | "derived" | "low";
  mayAutoMerge: boolean;
  mayAutoSplit: boolean;
};
```

```ts
type AgentIdentity = {
  schema: "direct_agent_identity@1";

  agentId: string;
  projectId: string;

  identityKey: AgentIdentityKey;
  identityKeyDigest: string;
  identityConfidence:
    | "exact"
    | "backfilled"
    | "derived_from_session_fields"
    | "manual"
    | "unknown";
  backfillPolicy?: AgentBackfillPolicy;

  agentClass: string;
  roleLane: string;
  displayName: string;

  ontologyProfileRef?: EvidenceRef;
  capabilityProfileRef?: EvidenceRef;
  authorityBoundaryRef?: EvidenceRef;
  memoryScopeRef?: EvidenceRef;

  scope: {
    projectId: string;
    workThreadIds: string[];
    crossProject: false;
  };

  linkedThreadIds: string[];
  activeRunIds: string[];

  status:
    | "active"
    | "idle"
    | "suspended"
    | "archived"
    | "unknown";
  statusReason?: string;
  statusUpdatedBy?: "harness" | "operator" | "migration" | "fixture";

  supersedesAgentId?: string;
  supersededByAgentId?: string;
  splitFromAgentId?: string;

  sourceRefs: EvidenceRef[];
  createdAt: string;
  updatedAt: string;
  digest: string;

  rawTextIncluded: false;
  rawPathIncluded: false;
};
```

Identity guidance:

```text
agentId must not be only a thread id.
agentId must not be only a display label.
agentId must include enough project/role/class/ontology posture to avoid
collisions.
agentId should be derived from AgentIdentityKey or cite the exact identity key
used.
```

Default resident backfill:

```text
agentId = direct_agent_<projectId>_primary_coder
agentClass = primary_coder
roleLane = implementation
linkedThreadIds = existing direct sessions in project
identityConfidence = backfilled
backfillPolicy.grouping = project_role_lane
```

Agent identity lifecycle:

```text
active -> idle | suspended | archived
idle -> active | suspended | archived
suspended -> active | archived
archived -> active only through explicit restore
unknown -> active only after identity validation
```

Default resident backfill may auto-create one `primary_coder` implementation
agent per project, but must preserve session-level evidence and mark the
identity as backfilled/derived rather than exact manual truth. Future merge/split
operations must preserve supersession links instead of mutating identity history
silently.

### AgentRun

Bounded activation of an AgentIdentity.

Resident agents have long-lived identities, not one immortal run. Bounded
actions still need runs:

```text
spawned worker for one task
audit pass for one PR
headless route
closeout
diagnostic
```

```ts
type AgentRun = {
  schema: "direct_agent_run@1";

  agentRunId: string;
  agentId: string;
  projectId: string;

  runKind:
    | "resident"
    | "resident_thread"
    | "resident_headless"
    | "resident_recovery"
    | "spawned_worker"
    | "audit_pass"
    | "headless_route"
    | "memory_extraction"
    | "context_maintenance"
    | "closeout"
    | "diagnostic";

  objective: {
    objectiveKind:
      | "interactive_resident"
      | "worker_task"
      | "audit"
      | "memory_extraction"
      | "context_maintenance"
      | "headless_route"
      | "diagnostic";
    objectiveDigest?: string;
    objectivePreview?: string;
  };

  outputContract?: {
    expectedArtifactKinds: string[];
    resultEnvelopePolicyId?: string;
  };

  parentAgentId?: string;
  parentAgentRunId?: string;
  parentThreadId?: string;

  threadIds: string[];
  workThreadId?: string;

  startedAt: string;
  endedAt?: string;

  lifecycle:
    | "planned"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled"
    | "handoff_unknown"
    | "recovery_required";

  contextPacketRefs: string[];
  requestManifestRefs: string[];
  resultEnvelopeRefs: string[];
  usageRefs: string[];

  authorityBoundaryRef?: EvidenceRef;
  sourceRefs: EvidenceRef[];
  digest: string;
};
```

Resident identity persists across threads; resident runs are bounded by
session/thread/headless/task/maintenance activation episodes. A single
never-ending resident run is forbidden because it destroys provenance and usage
attribution.

### AgentThreadLink

Thread/session association witness. This prevents `linkedThreadIds` from
becoming a lossy array with no lifecycle or provenance.

```ts
type AgentThreadLink = {
  schema: "direct_agent_thread_link@1";

  linkId: string;
  agentId: string;
  agentRunId?: string;
  projectId: string;
  threadId: string;
  workThreadId?: string;

  linkKind:
    | "resident_primary"
    | "worker_thread"
    | "audit_thread"
    | "headless_thread"
    | "imported_witness"
    | "derived_projection";

  relationship:
    | "owned_by_agent"
    | "agent_participated"
    | "agent_observed"
    | "parent_child"
    | "imported_evidence"
    | "derived_projection";

  status:
    | "active"
    | "closed"
    | "archived"
    | "stale"
    | "unknown";

  sourceRefs: EvidenceRef[];
  createdAt: string;
  updatedAt: string;
  digest: string;
};
```

Thread-link rules:

```text
A thread may have one primary resident owner link per project.
A thread may have multiple observed/evidence links.
A worker thread must cite parent agent/run/thread if known.
Thread links are evidence of relationship, not memory and not authority.
```

### AgentMemoryRow

Durable admitted memory. It is not raw transcript and not provider context by
itself.

```ts
type AgentMemoryRow = {
  schema: "direct_agent_memory_row@1";

  memoryId: string;
  agentId: string;
  projectId: string;

  scope: {
    projectId: string;
    workThreadId?: string;
    roleLane?: string;
    memoryScope:
      | "agent_private"
      | "project_role"
      | "work_thread"
      | "cross_project_explicit";
  };

  kind:
    | "preference"
    | "project_fact"
    | "decision"
    | "constraint"
    | "open_question"
    | "risk"
    | "pattern"
    | "procedure";

  contentSummary: string;
  contentSummaryDigest: string;
  summaryPolicyId: string;
  rawSourceQuoted: false;

  provenance: {
    sourceThreadIds: string[];
    sourceTurnIds: string[];
    sourceArtifactRefs: EvidenceRef[];
    extractionTransitionId: string;
  };

  confidence:
    | "exact"
    | "high"
    | "derived"
    | "candidate"
    | "stale"
    | "conflicted";

  authorityUse:
    | "context_evidence"
    | "preference_hint"
    | "constraint_candidate"
    | "not_authoritative";

  contextEligibility:
    | "eligible"
    | "eligible_with_warning"
    | "not_eligible_candidate"
    | "not_eligible_stale"
    | "not_eligible_conflicted"
    | "not_eligible_rejected"
    | "not_eligible_out_of_scope";

  conflictState:
    | "none"
    | "conflicts_with_current_user"
    | "conflicts_with_newer_memory"
    | "conflicts_with_workspace_evidence"
    | "conflicts_with_policy"
    | "unknown";

  conflictResolution:
    | "current_user_wins"
    | "newer_evidence_wins"
    | "memory_omitted"
    | "manual_review_required"
    | "unknown";

  revision: number;
  supersedesMemoryId?: string;
  supersededByMemoryId?: string;

  expiresAt?: string;
  invalidationRule?: string;

  auditState:
    | "unaudited"
    | "accepted"
    | "rejected"
    | "needs_review";

  createdAt: string;
  updatedAt: string;
  digest: string;

  rawTranscriptIncluded: false;
  rawPathIncluded: false;
  rawSecretIncluded: false;
};
```

V0 context eligibility:

```text
Eligible by default only when:
  auditState = accepted
  confidence = exact | high | derived
  authorityUse != not_authoritative
  contextEligibility = eligible | eligible_with_warning
  scope matches current project/workThread/roleLane
  not expired
  not conflicted
```

V0 context-eligible memory kinds:

```text
preference
decision
constraint
open_question
risk
procedure
```

Conditionally eligible:

```text
project_fact, only with confidence = exact | high and auditState = accepted
```

Not eligible by default:

```text
pattern
derived/candidate project_fact
anything stale/conflicted/rejected/out-of-scope
```

Conflict law:

```text
current user intent beats memory.
current workspace/tool evidence beats memory.
accepted newer memory beats older stale memory.
conflicted memory is omitted unless a later explicit review transition resolves
the conflict.
```

Memory rows must preserve revision/supersession instead of silently overwriting
historical memory.

### AgentMemoryExtractionTransition

Even manual/fixture memory rows need a first-class extraction transition.

```ts
type AgentMemoryExtractionTransition = {
  schema: "direct_agent_memory_extraction_transition@1";

  extractionTransitionId: string;
  agentId: string;
  projectId: string;

  sourceRefs: EvidenceRef[];
  extractionMode:
    | "manual_fixture"
    | "operator_curated"
    | "model_suggested"
    | "automated_candidate";

  outputMemoryIds: string[];
  rawTranscriptIncluded: false;
  extractionPolicyId: string;
  createdAt: string;
  digest: string;
};
```

PR 131 may add richer candidate/review/admission records, but PR 128 must not
leave `extractionTransitionId` as an opaque string.

### AgentMemoryContextProjection

Context-safe selection over memory rows for a concrete request.

```ts
type AgentMemoryContextProjection = {
  schema: "direct_agent_memory_context_projection@1";

  projectionId: string;
  agentId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  workThreadId?: string;

  selectionPolicyId: string;
  budgetPolicyId?: string;
  contextPackId?: string;
  requestManifestId?: string;

  selectedMemoryRefs: Array<{
    memoryId: string;
    digest: string;
    authorityUse: string;
    contextRole:
      | "preference_hint"
      | "decision_evidence"
      | "constraint_candidate"
      | "open_question"
      | "risk_note"
      | "procedure_hint";
    inclusionReason: string;
  }>;

  omittedCounts: {
    stale: number;
    conflicted: number;
    rejected: number;
    outOfScope: number;
    overBudget: number;
  };

  sourceRefs: EvidenceRef[];
  projectionDigest: string;
  rawMemoryTextIncluded: false;
};
```

The context builder should consume this projection, not arbitrary memory rows.
PR 129 may produce memory context projections only from explicit fixture/manual
selection. Default provider input must remain unchanged unless a test flag or
explicit context policy enables memory projection inclusion.

## Context Source Classes

Wave 21 should refactor context-pack inputs toward typed source classes:

```ts
type DirectContextSourceRef = {
  sourceKind:
    | "current_user_prompt"
    | "recent_thread_witness"
    | "work_thread_state"
    | "agent_identity"
    | "agent_run"
    | "agent_memory"
    | "agent_memory_projection"
    | "agent_capability_status"
    | "authority_boundary"
    | "tool_result"
    | "runtime_status"
    | "frontier_baton"
    | "omission_ledger"
    | "governance_packet";

  sourceId: string;
  digest: string;
  sourceConfidence:
    | "exact"
    | "accepted"
    | "derived"
    | "diagnostic"
    | "unknown";
  freshness:
    | "fresh"
    | "stale"
    | "unknown";
  authority:
    | "current_instruction"
    | "historical_evidence"
    | "memory_evidence"
    | "preference_hint"
    | "constraint_candidate"
    | "status_witness"
    | "tool_result_evidence"
    | "governance_constraint"
    | "agent_identity_witness";
};
```

Every included memory/status/work-thread/agent item must appear in source refs
or be counted in omission markers.

Agent identity must use `agent_identity_witness`, not historical evidence.
Capability/status rows must cite the tool capability registry, promotion
decision if relevant, activation registry, and resident epistemic snapshot
source. Agent identity alone never implies tool availability.

## Storage Plan

Add an `AgentRegistryStore` under the Direct session root:

```text
direct-agents.sqlite or direct-agent-registry.sqlite
agent-identities/
agent-runs/
agent-memory/
agent-memory-projections/
```

The store may start as SQLite plus private JSON artifacts, matching existing
Direct persistence style.

Required indices:

```text
agentId -> AgentIdentity
agentId -> AgentRun[]
agentId -> linked Thread ids
threadId -> AgentThreadLink[]
agentId + memoryScope -> AgentMemoryRow[]
projectId + roleLane -> AgentIdentity[]
```

Raw prompt/transcript text must not be stored in registry rows unless explicitly
designed as app-private evidence and scanned. Default registry projections must
be renderer-safe.

## Migration And Backfill

Wave 21 must not rewrite existing session/thread storage.

Backfill posture:

```text
read existing direct sessions
group by projectId + roleLane + agentClass + identity evidence
create default resident AgentIdentity per project + primary roleLane
create AgentThreadLink rows for existing sessions
write optional session.agentId/session.agentRunId only in compatibility-safe
paths
```

V0 default:

```text
projectId + roleLane=implementation + agentClass=primary_coder
```

Backfill must not merge by display label. If the old session fields imply
auditor/worker/researcher identity, create a separate derived/backfilled agent
or leave the link as unknown-agent evidence rather than over-merging into the
resident primary coder.

Existing fields remain valid:

```text
agentKind
agentThreadId
parentThreadId
primaryThreadId
agentLabel
agentRole
workThreadId
```

But new code should prefer:

```text
agentId
agentRunId
AgentThreadLink
AgentIdentity
AgentRun
```

## PR Sequence

### PR 126: Agent Registry Substrate

Build:

```text
AgentRegistryStore
AgentIdentity schema
AgentIdentityKey
AgentBackfillPolicy
AgentThreadLink schema
default resident agent backfill
renderer-safe registry status projection
```

Acceptance:

```text
existing direct sessions are not rewritten destructively
default project resident agent can be built from existing sessions
default resident agent is marked identityConfidence=backfilled, not exact
default resident backfill groups by project + roleLane, not display label
thread links cite session/thread evidence
agent identity is not inferred from display labels alone
identity lifecycle transitions are explicit
registry status reports healthy/degraded/recovery states
```

Non-goals:

```text
no memory admission
no context injection
no resident behavior change
no session/thread replacement
```

### PR 127: AgentRun And Session Linking

Build:

```text
AgentRun schema
agentRun lifecycle transitions
run objective and optional output contract
session.agentId / session.agentRunId optional fields
compatibility mapper from old session agent fields
AgentThreadLink relationship field and uniqueness rules
agent-run/thread indices
```

Acceptance:

```text
resident identity is durable, but resident AgentRuns are bounded per
thread/session/headless/task activation
spawned worker/audit/headless fixtures can cite agentId + agentRunId
AgentRun objective explains what the run was for
threadSnapshotFromSession exposes agent refs without breaking old fields
thread link relationship distinguishes ownership, participation, observation,
parent/child, imported evidence, and derived projection
stale/missing agent refs degrade to unknown_agent, not primary agent
```

Non-goals:

```text
no new sub-agent capabilities
no authority inheritance from parent agent
no automatic cross-thread memory
```

### PR 128: Agent Memory Store V0

Build:

```text
AgentMemoryStore
AgentMemoryRow schema
AgentMemoryExtractionTransition schema
manual/fixture memory rows only
memory provenance validator
renderer-safe memory inventory projection
```

Acceptance:

```text
memory row requires agentId and source provenance
memory row cannot be created from transcript without a real
AgentMemoryExtractionTransition artifact
memory row cannot authorize action
memory row has contextEligibility, conflictState/conflictResolution, revision,
supersession, contentSummaryDigest, and summaryPolicyId
candidate/stale/conflicted/rejected rows are visible but not context-eligible
only accepted/fresh/scoped memory kinds are context-eligible in V0
raw transcript/path/secret fields are absent from default projections
```

Non-goals:

```text
no automatic memory extraction
no memory included in provider context by default
no cross-project memory
```

### PR 129: Agent Context Source-Class Refactor

Build:

```text
DirectContextSourceRef normalizer
AgentMemoryContextProjection schema
context-pack source-class adapter
context pack sourceRefs for agent identity/run/memory projection
omission counters for out-of-scope/stale/rejected memory
selectionPolicyId and contextRole per selected memory ref
```

Acceptance:

```text
existing recent-dialogue context behavior remains compatible
context packs can cite agent identity/run without treating it as instruction
context packs can cite memory projection only as memory_evidence/preference_hint
context source refs include sourceConfidence and freshness
agent identity refs use agent_identity_witness
memory rows are never consumed directly by provider input builder
every selected memory row has source ref and digest
default provider input remains unchanged unless explicit fixture/manual memory
projection selection is enabled
```

Non-goals:

```text
no automatic memory selection
no hidden provider continuity
no memory-derived authority
```

### PR 130: Resident Agent Epistemic Snapshot

Build:

```text
structured resident identity/continuity/capability snapshot
owned/linked thread summary with counts by default
memory scope inventory
agent capability/status catalogue bridge
context policy hook for compact "who am I / what scopes exist" witness
```

Acceptance:

```text
resident can know its agentId, role lane, current WorkThread, linked threads,
memory scopes, and active/blocked capability state
snapshot separates identity, continuity, and capability witness sections
resident context uses linked-thread counts/current refs, not full linkedThreadIds
by default
capability/status catalogue rows cite registry/promotion/activation evidence
agent snapshot is status/evidence, not authority
resident self-report tests distinguish agent identity from current thread
renderer exposes compact snapshot without raw private memory
```

Non-goals:

```text
no mutable memory through resident tool calls
no new tool families
no broad cross-thread transcript exposure
```

### PR 131: Agent Memory Admission Workflow And Proof Gate

Build:

```text
memory candidate envelope
memory extraction transition
memory admission transition
accept/reject/review states
memory supersession and conflict resolution
headless fixture for transcript/artifact -> candidate -> accepted memory
context eligibility proof gate
negative matrix for laundering attempts
roadmap/audit completion update
```

Acceptance:

```text
accepted memory requires extraction/admission evidence
rejected/needs_review/candidate memory is not context-eligible by default
accepted memory can appear only through AgentMemoryContextProjection
memory cannot override current user intent
newer workspace/tool/current-user evidence can force omission or review
memory cannot authorize read/patch/command/sub-agent/provider-hosted actions
headless tests prove agent identity, thread witness, memory, and context remain
separate
```

Non-goals:

```text
no autonomous memory mining daemon
no cross-project memory
no automatic durable memory from provider-hosted or MCP results
no user-facing memory editor beyond minimal proof fixtures
```

## Completion Gate

Wave 21 is complete when:

```text
Direct has a first-order AgentIdentity/AgentRun layer above thread/session.
Existing sessions can be linked to agents without destructive migration.
Agent memory exists as governed, provenance-cited derivation, not transcript.
Context packs can cite agent identity/run/memory projections through typed
source refs.
Resident epistemic snapshots can explain "who am I, what threads belong to me,
what memory scopes exist, what capabilities are active/blocked" without
granting authority.
```

Global acceptance:

```text
AgentIdentity has AgentIdentityKey, identityConfidence, and backfillPolicy.
Default resident backfill is project + roleLane, not display label.
Resident primary uses durable AgentIdentity plus bounded AgentRuns.
AgentRun has objective and optional output contract.
AgentThreadLink has relationship and uniqueness rules.
AgentMemoryRow has contextEligibility, conflictState, revision/supersession,
and contentSummaryDigest.
Every memory row cites a real AgentMemoryExtractionTransition.
Memory context projection has selectionPolicyId and contextRole per selected
memory.
Context source refs include confidence/freshness.
PR 129 preserves existing context behavior unless explicit fixture/manual
memory projection is enabled.
Resident snapshot separates identity, continuity, and capability witness
sections.
Resident context does not include full linkedThreadIds by default.
Memory review is workbench/debug fixture only in Wave 21, not a full chat
memory editor.
```

## Hard Non-Goals For Wave 21

```text
Do not replace DirectSessionStore.
Do not rename sessionId/threadId to agentId.
Do not make memory thread-scoped by default.
Do not auto-admit transcript summaries as durable memory.
Do not let memory authorize actions.
Do not let agent identity imply tool availability.
Do not let child agents inherit parent authority without explicit grants.
Do not expose raw transcript/memory/path/secret data to renderer.
```

## Test Matrix

Minimum fixture coverage:

```text
existing direct project with multiple sessions -> one resident agent identity
worker session with parent thread -> child agent run and thread link
headless diagnostic run -> bounded AgentRun without memory admission
manual memory row with provenance -> accepted context-eligible row
candidate memory without extraction transition -> blocked
stale/conflicted/rejected memory -> omitted from context projection
context pack with agent identity ref -> source refs include agent evidence
context pack with memory projection -> selected memory refs and omission counts
resident self-report -> distinguishes agent from thread
negative laundering attempt -> memory cannot become instruction or authority
```

Wave 21 failure classes:

```text
agent-thread collapse:
  session/thread id treated as agent identity

memory laundering:
  transcript summary becomes durable memory without extraction/admission

context laundering:
  accepted memory enters provider context without memory projection/source refs

authority inflation:
  memory or agent identity implies tool availability

current-intent override:
  stale memory overrides current user instruction

cross-thread leakage:
  unrelated linked thread content appears in resident context

cross-project leakage:
  memory from another project appears without explicit scope

capability inference:
  agentClass=primary_coder implies read/patch/command activation

backfill overmerge:
  auditor/worker/resident sessions collapse into one agent by display label

renderer leakage:
  raw memory/source transcript/path appears in projection
```

Memory review surface:

```text
Wave 21 V0 may expose only headless fixtures and minimal debug/operator
projections. Full memory admission review belongs later in Agent Workbench /
Thread Workbench, not the normal chat transcript.
```

## Review Questions

Before implementation, confirm:

```text
1. Is Wave 21 correctly placed before future code-mode/batch/tool expansion?
2. Should resident primary agents have long-lived AgentRuns or only
   AgentIdentity plus per-thread runs?
3. Which memory kinds should be context-eligible in v0?
4. Should default resident backfill be per project only, or per project +
   roleLane?
5. Which UI surface should eventually expose memory admission review?
```

Current answers:

```text
1. Yes. Agent/run/memory identity should land before code-mode, batch, and
   larger multi-agent expansion.
2. Use durable AgentIdentity plus bounded AgentRuns. Do not create one immortal
   resident run.
3. V0 eligible: preference, decision, constraint, open_question, risk,
   procedure. project_fact only when exact/high and accepted. pattern is not
   eligible by default.
4. Backfill per project + roleLane + agentClass. For resident default:
   projectId + roleLane=implementation + agentClass=primary_coder.
5. Later memory review belongs in Agent Workbench / Thread Workbench. Wave 21
   uses headless fixtures and debug/operator projections only.
```
