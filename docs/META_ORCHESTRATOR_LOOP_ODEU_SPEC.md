# Meta-Orchestrator Loop ODEU Spec

Status: design specification for artifact-mediated long-horizon workflow loops in
`codex-review-shell` and the future direct OAI harness.

Related docs:

- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)
- [CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md](./CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Define the ODEU contract for long-horizon workflow loops where work is advanced
by role-specific agents and the loop is controlled by an explicit
meta-orchestrator.

The core product goal is not merely "keep a task running." It is:

```text
preserve the lawful sequence of a multi-step workflow
  -> require the right artifact class at each step
  -> route artifacts to the right role
  -> mutate workflow state only through explicit transition events
```

This differs from vanilla Codex `/goal`, where one agent can work, self-audit,
and mark the goal complete. That is useful as a CLI primitive, but it collapses
too many authorities into one turn for ODEU-grade workflows.

## Boundary

The meta-orchestrator is a workflow-transition authority, not an object-level
auditor.

```text
ImplementationWorker
  produces object-level work and implementation evidence

AuditWorker
  validates object-level claims against the intent contract and evidence

MetaOrchestrator
  validates artifact class, provenance, step position, and branch eligibility

Controller
  persists events, launches turns, attaches artifacts, and mutates run state
```

Law:

```text
Auditor has object-level validation authority.
MetaOrchestrator has workflow-transition authority.
Controller has persistence and execution authority.
```

## Non-Goals

- Do not make the meta-orchestrator a hidden super-agent that judges technical
  correctness.
- Do not let implementation workers mark workflow goals complete directly.
- Do not treat assistant prose such as "done" as a workflow transition.
- Do not let UI labels or selected tabs mutate workflow state without controller
  events.
- Do not require every loop to use the same roles. The role graph is plan-owned.
- Do not make vanilla Codex `/goal` the final model. It can be one upstream
  primitive or compatibility path.

## Proof Case: Vanilla Goal Collapse

Vanilla Codex `rust-v0.128.0` introduces persisted thread goals behind the
under-development `goals` feature. The broad dynamic is:

```text
/goal <objective>
  -> persist active thread goal
  -> same agent continues work when idle
  -> same agent performs completion audit inside continuation prompt
  -> same agent calls update_goal(status = complete)
```

That is pragmatic for a CLI, but ODEU identifies three different authorities:

```text
Advancer role:
  pursue the objective through concrete work

Auditor role:
  distrust completion claims and validate evidence against intent

Controller/meta role:
  decide whether a lifecycle transition is allowed
```

Correct ODEU split:

```text
ImplementationTurnFinished
  -> ImplementationEvidenceSubmitted
  -> MetaOrchestrator checks routability only
  -> AuditWorkPacketIssued
  -> AuditArtifactSubmitted
  -> MetaOrchestrator applies branch law
  -> NextWorkPacketIssued or WorkflowCompleted
```

Critical distinction:

```text
RoutableEvidence != ValidEvidence
```

`RoutableEvidence` means the artifact is structurally admissible for audit.
`ValidEvidence` means the auditor certified that the evidence actually supports
the implementation claim.

## ODEU Model

### Objects

`MetaPlan`

- Durable plan template for a repeating or branching workflow.
- Defines phases, steps, role assignments, required artifact classes, branch
  rules, and loop pattern.
- Example pattern: `5-1-5-1-5`, where each `5` is a structured work/review/fix
  micro-loop and each `1` initiates the next arc.

```ts
type MetaPlan = {
  id: string;
  name: string;
  version: number;
  pattern: string;
  phases: WorkflowPhase[];
  branchRules: BranchRule[];
  createdAt: string;
  updatedAt: string;
};
```

`WorkflowRun`

- One live execution of a `MetaPlan`.
- Owns the current pointer, run state, evidence ledger, and transition log.

```ts
type WorkflowRun = {
  id: string;
  planId: string;
  projectId: string;
  arcId?: string;
  status:
    | "draft"
    | "active"
    | "waiting_for_artifact"
    | "audit_pending"
    | "blocked"
    | "paused"
    | "complete"
    | "failed";
  currentPhaseId: string;
  currentStepId: string;
  currentIteration: number;
  evidenceLedgerId: string;
  createdAt: string;
  updatedAt: string;
};
```

`WorkflowPhase`

- Named segment of a plan.
- Can represent an implementation arc, audit/fix loop, closeout bundle, or next
  arc initiation.

```ts
type WorkflowPhase = {
  id: string;
  label: string;
  stepIds: string[];
  repeat?: {
    maxIterations?: number;
    untilArtifactClass?: ArtifactClass;
  };
};
```

`StepContract`

- The lawful contract for one step.
- Defines who may execute the step, what inputs they receive, what artifact
  class they must emit, and what evidence is required.

```ts
type StepContract = {
  id: string;
  label: string;
  role: WorkflowRole;
  intentContractRef: string;
  allowedInputs: ArtifactClass[];
  requiredOutput: ArtifactClass;
  requiredEvidence: EvidenceRequirement[];
  completionSignalSchema: string;
  timeoutPolicy?: StepTimeoutPolicy;
  onMissingEvidence: "retry_step" | "request_evidence" | "pause" | "escalate";
};
```

`IntentContract`

- The object-level intent being worked against.
- For implementation and audit steps, this is the canonical source for what
  counts as done.

```ts
type IntentContract = {
  id: string;
  title: string;
  objective: string;
  successCriteria: string[];
  explicitNonGoals: string[];
  constraints: string[];
  sourceRefs: EvidenceRef[];
  createdAt: string;
};
```

`WorkPacket`

- Controller-issued input bundle for a role-specific turn.
- A worker should execute the packet, not infer workflow topology.

```ts
type WorkPacket = {
  id: string;
  runId: string;
  stepId: string;
  role: WorkflowRole;
  intentContractRef: string;
  inputArtifactRefs: string[];
  instructions: string;
  requiredOutput: ArtifactClass;
  createdAt: string;
};
```

`WorkflowArtifact`

- Typed institutional object emitted by a role.
- Artifacts are the routing substrate. They are not loose messages.

```ts
type WorkflowArtifact = {
  id: string;
  runId: string;
  stepId: string;
  role: WorkflowRole;
  class: ArtifactClass;
  producerThreadId?: string;
  producerTurnId?: string;
  provenance: ArtifactProvenance;
  payload: unknown;
  evidenceRefs: EvidenceRef[];
  createdAt: string;
};
```

`EvidenceLedger`

- Append-only list of artifact and evidence references for a workflow run.
- Supports provenance, replay, analytics, and branch-rule evaluation.

`WorkflowTransitionEvent`

- Controller-owned persisted event that mutates workflow state.
- No workflow pointer changes without a transition event.

```ts
type WorkflowTransitionEvent = {
  id: string;
  runId: string;
  fromStepId: string;
  toStepId?: string;
  fromStatus: WorkflowRun["status"];
  toStatus: WorkflowRun["status"];
  reason:
    | "artifact_routable"
    | "artifact_rejected"
    | "audit_green"
    | "audit_yellow"
    | "audit_red"
    | "audit_blocked"
    | "invalid_evidence"
    | "manual_pause"
    | "manual_resume"
    | "budget_limited"
    | "plan_complete";
  triggeringArtifactId?: string;
  branchRuleId?: string;
  createdAt: string;
};
```

### Roles

`ImplementationWorker`

- Produces implementation changes and implementation evidence.
- May inspect, edit, run commands, open PRs, and report blockers within its
  authority profile.
- Must not mark the workflow complete.
- Must not certify its own evidence as valid.

`AuditWorker`

- Validates object-level claims against the `IntentContract`.
- May inspect files, run verification, review PR state, and produce an
  `AuditArtifact`.
- Must not perform substantive implementation work unless the current step
  explicitly assigns a fix role.

`FixWorker`

- Consumes audit findings and emits a bounded fix artifact.
- Should be scoped by the defects or required fixes in the prior audit.

`CloseoutWorker`

- Produces closure packet, release notes, PR summary, handoff bundle, or next arc
  seed.
- Does not decide object-level correctness unless the plan assigns it an audit
  step.

`InitiationWorker`

- Produces the next arc starter packet or next intent contract.
- Useful for `5-1-5-1-5` patterns where the `1` step prepares the next loop.

`MetaOrchestrator`

- Maintains the run pointer and applies branch law.
- Validates artifact presence, class, provenance, schema, step attachment, and
  routing eligibility.
- Must not substitute for the `AuditWorker`.

`Controller`

- Persists event log and artifacts.
- Launches role turns.
- Applies state mutations.
- Owns idempotency, retries, cancellation, and renderer notifications.

### Artifact Classes

```ts
type ArtifactClass =
  | "intent_contract"
  | "implementation_evidence"
  | "audit"
  | "fix_evidence"
  | "closeout"
  | "next_arc_seed"
  | "blocker"
  | "operator_decision"
  | "diagnostic";
```

`ImplementationEvidenceArtifact`

```ts
type ImplementationEvidenceArtifact = {
  statusClaim: "done" | "partial" | "blocked" | "needs_review";
  scopeDeclaration: string;
  changedFiles: Array<{
    path: string;
    changeKind: "created" | "modified" | "deleted" | "moved" | "unknown";
  }>;
  testEvidence: Array<{
    command: string;
    status: "passed" | "failed" | "not_run" | "partial";
    summary: string;
    logRef?: string;
  }>;
  externalRefs: Array<{
    kind: "pr" | "issue" | "doc" | "web" | "other";
    urlOrId: string;
    summary?: string;
  }>;
  unresolvedIssues: string[];
  completionClaim?: string;
  intentContractRef: string;
  workerNotes?: string;
};
```

`AuditArtifact`

```ts
type AuditArtifact = {
  verdict:
    | "green"
    | "yellow"
    | "red"
    | "blocked"
    | "invalid_evidence";
  fulfilledIntentContract: "yes" | "partial" | "no" | "unverifiable";
  checklist: Array<{
    criterion: string;
    status: "pass" | "fail" | "unknown" | "not_applicable";
    evidenceRefs: EvidenceRef[];
    notes?: string;
  }>;
  defects: Array<{
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    evidenceRefs: EvidenceRef[];
    requiredFix?: string;
  }>;
  requiredFixes: string[];
  residualRisks: string[];
  advancementRecommendation:
    | "advance"
    | "fix_then_reaudit"
    | "retry_implementation"
    | "escalate_to_user"
    | "pause";
};
```

`CloseoutArtifact`

```ts
type CloseoutArtifact = {
  summary: string;
  mergedOrReadyState?: string;
  evidenceRefs: EvidenceRef[];
  followUps: string[];
  nextArcSeedRef?: string;
};
```

### Evidence

`EvidenceRef`

```ts
type EvidenceRef = {
  id: string;
  kind:
    | "file"
    | "command_output"
    | "test_result"
    | "git_diff"
    | "pull_request"
    | "review_comment"
    | "thread_message"
    | "artifact"
    | "runtime_event"
    | "operator_input"
    | "web_link";
  label: string;
  uri?: string;
  observedAt: string;
  confidence: "proven" | "declared" | "configured" | "observed" | "inferred" | "unknown";
};
```

Evidence rules:

- Worker evidence can be routable without being valid.
- Audit evidence can certify object-level validity only within the auditor's
  assigned scope.
- Meta-orchestrator evidence checks are structural and provenance-level.
- Controller events are the only evidence that a workflow transition occurred.

## Deontic Rules

The meta-orchestrator may check:

- Does the artifact exist?
- Is it attached to the expected run and step?
- Was it produced by a role authorized for that step?
- Does it match the required artifact class?
- Does it satisfy the required schema?
- Does it include required references by class?
- Is this artifact the expected next artifact for the current pointer?
- Which branch rule applies to this artifact class/verdict?
- Which role should receive the next work packet?

The meta-orchestrator must not check:

- Is the implementation technically correct?
- Are the tests semantically sufficient?
- Does the implementation fulfill the design intent?
- Are architectural claims true?
- Is a PR review substantively right?

Those object-level checks belong to the role assigned to object-level validation,
usually `AuditWorker`.

Constitutional law:

```text
Object-level validity must be certified by the role assigned to object-level validation.

The meta-orchestrator may only consume that certification as a typed artifact
when applying high-level transition law.
```

## Event Sequence

Canonical implementation-to-audit path:

```text
WorkflowRunStarted
WorkPacketIssued(role = ImplementationWorker)
ImplementationStepStarted
ImplementationTurnFinished
ImplementationEvidenceSubmitted
EvidenceRoutabilityChecked
EvidenceRoutableAccepted
WorkPacketIssued(role = AuditWorker)
AuditStepStarted
AuditArtifactSubmitted
AuditArtifactClassified
BranchRuleApplied
WorkflowTransitionSelected
NextWorkPacketIssued
```

Failure path for malformed evidence:

```text
ImplementationEvidenceSubmitted
EvidenceRoutabilityChecked
EvidenceRoutableRejected(reason = schema/provenance/missing_refs)
WorkflowTransitionEvent(reason = invalid_evidence)
WorkPacketIssued(role = ImplementationWorker, task = produce proper evidence)
```

Audit green path:

```text
AuditArtifactSubmitted(verdict = green)
BranchRuleApplied(audit_green)
WorkflowTransitionEvent(toStep = closeout_or_next_phase)
WorkPacketIssued(next role)
```

Audit yellow path:

```text
AuditArtifactSubmitted(verdict = yellow)
BranchRuleApplied(audit_yellow)
WorkflowTransitionEvent(toStep = fix)
WorkPacketIssued(role = FixWorker, input = requiredFixes)
```

Audit red path:

```text
AuditArtifactSubmitted(verdict = red)
BranchRuleApplied(audit_red)
WorkflowTransitionEvent(toStep = implementation_retry_or_escalation)
```

Blocked path:

```text
BlockerArtifactSubmitted
MetaOrchestrator validates blocker class/provenance
WorkflowTransitionEvent(toStatus = blocked)
OperatorDecisionRequested
```

## Branch Rules

Branch rules map admissible artifact classes and verdicts to next lawful
transitions.

```ts
type BranchRule = {
  id: string;
  fromStepId: string;
  when: {
    artifactClass: ArtifactClass;
    verdict?: string;
    statusClaim?: string;
  };
  requireArtifactClass?: ArtifactClass;
  next:
    | { action: "advance"; toStepId: string }
    | { action: "retry"; stepId: string; reason: string }
    | { action: "route"; role: WorkflowRole; stepId: string }
    | { action: "pause"; reason: string }
    | { action: "complete" }
    | { action: "escalate"; target: "operator" | "design_thread" | "review_thread" };
};
```

Example `5-1-5-1-5` plan:

```text
Phase A: implementation arc micro-loop (5)
  1. Implement slice
  2. Produce implementation evidence
  3. Audit evidence
  4. Fix audit findings
  5. Closeout/promote slice

Phase B: next arc initiation (1)
  1. Produce next arc starter packet

Phase C: implementation arc micro-loop (5)
  ...
```

The exact five-step structure is plan-specific. The invariant is that each
position has a step contract and required artifact class.

## State Machine

Recommended `WorkflowRun.status` transitions:

```text
draft -> active
active -> waiting_for_artifact
waiting_for_artifact -> audit_pending
audit_pending -> active
audit_pending -> blocked
audit_pending -> complete
active -> paused
paused -> active
active -> blocked
blocked -> active
blocked -> failed
active -> complete
```

Recommended step statuses:

```text
not_started
issued
running
artifact_submitted
routable
rejected
auditing
passed
failed
blocked
complete
```

Rules:

- `complete` requires a controller transition event.
- Advancement past an audit gate requires an `AuditArtifact` unless the current
  `StepContract` explicitly skips audit.
- A malformed implementation evidence artifact can route to evidence repair, not
  audit.
- Manual operator override must create an `operator_decision` artifact.

## Controller Responsibilities

The controller must own:

- Persistent `MetaPlan`, `WorkflowRun`, `WorkflowArtifact`, and
  `WorkflowTransitionEvent` storage.
- Idempotent turn launching for work packets.
- Artifact attachment and provenance.
- Run pointer mutation.
- Retry and cancellation semantics.
- Notifications to shell surfaces.
- Capability gating for which runtime provider can execute each role.

The controller must not:

- Infer object-level completion from assistant text.
- Silently skip an expected artifact class.
- Mutate the run pointer from renderer-only state.
- Route an artifact to audit after provenance/schema rejection.

## Storage Sketch

V0 can use a lightweight SQLite store:

```text
workflow_plans
workflow_runs
workflow_steps
workflow_artifacts
workflow_evidence_refs
workflow_transition_events
workflow_work_packets
```

Fingerprints:

- Artifact fingerprint should include class, payload canonical hash,
  evidence ref IDs, producer role, step ID, and run ID.
- Transition event fingerprint should include run ID, from/to step, reason,
  triggering artifact, and branch rule ID.

This supports dedupe and replay:

```text
same artifact submitted twice -> do not launch duplicate audit
same branch event replayed -> do not advance twice
```

## Runtime Provider Mapping

### Codex CLI / App-Server Compatibility Path

Vanilla `/goal` can be treated as a provider primitive:

```text
thread/goal/set
thread/goal/get
thread/goal/clear
thread/goal/updated
thread/goal/cleared
```

But in the loop system, these are not enough to certify workflow completion.
They can provide:

- A persisted local objective.
- Idle continuation behavior.
- Token/time accounting.
- Goal status witnesses.

They should not provide:

- Final loop advancement by worker self-certification.
- Audit gate bypass.
- Meta-plan branch decisions.

Compatibility rule:

```text
Codex /goal status can mirror or support WorkflowRun status.
WorkflowRun status remains controller-owned.
```

### Direct OAI Harness Path

The direct harness should model goal/loop behavior natively:

```text
StartRoleTurn(WorkPacket)
SubmitArtifact(WorkflowArtifact)
CheckRoutability(Artifact)
IssueAuditPacket(Artifact)
ApplyBranchRule(AuditArtifact)
PersistTransition(Event)
```

Do not port vanilla self-certification as the default. If a direct provider has
its own goal primitives, project them into the provider profile and decide
whether they are evidence sources, not workflow authorities.

## Shell UX Implications

The shell should eventually expose:

- Current workflow run, phase, step, and role.
- Required artifact class for the active step.
- Latest implementation evidence artifact.
- Audit artifact and verdict.
- Branch transition selected by the meta-orchestrator.
- Event log of controller-owned transitions.
- Manual pause/resume/escalation actions.

The shell should not expose:

- A free-form "mark complete" button that bypasses audit gates.
- A meta-orchestrator chat surface that performs technical review.
- Hidden branch mutations triggered by banner labels or tab selection.

Useful UI states:

```text
active: implementation worker running
waiting_for_evidence: worker finished but no admissible artifact
audit_pending: routable evidence accepted and audit packet issued
audit_failed: audit artifact requires fixes
blocked: blocker artifact or branch rule requires operator input
closeout_pending: audit green but closeout artifact missing
complete: controller persisted terminal transition
```

## Implementation Phases

Phase 0: Static schema and doc alignment

- Add type definitions for plans, runs, artifacts, evidence refs, and events.
- Add artifact class registry.
- Add branch rule evaluator interface.
- No agent launching yet.

Phase 1: Local event ledger

- Persist workflow runs and transition events.
- Let the shell create a run from a fixed demo plan.
- Allow manual artifact submission for testing.
- Validate artifact class/schema/provenance.

Phase 2: Work packet routing

- Generate `WorkPacket` objects from the active `StepContract`.
- Route work packets to the selected runtime provider.
- Store resulting implementation evidence artifacts.

Phase 3: Audit routing

- After routable implementation evidence, issue an audit work packet.
- Store audit artifacts.
- Apply branch rules from audit verdicts.

Phase 4: Loop patterns

- Support reusable patterns such as `5-1-5-1-5`.
- Add next-arc initiation steps.
- Add retry/fix/escalation branches.

Phase 5: Provider integration

- Map Codex CLI `/goal` primitives as optional witnesses.
- Add direct OAI harness role execution.
- Add quota/context/runtime constraints to step scheduling.

## Acceptance Criteria

- Meta-orchestrator code cannot mark object-level validity by itself.
- Implementation worker output cannot advance past an audit gate without an
  admissible `AuditArtifact`.
- `RoutableEvidence` and `ValidEvidence` are separate states.
- Every workflow pointer mutation is represented by a persisted
  `WorkflowTransitionEvent`.
- Artifact schema validation happens before routing.
- Role provenance is checked before branch rules apply.
- Missing required evidence routes to evidence repair, pause, or escalation
  according to the `StepContract`.
- Manual override requires an `operator_decision` artifact.
- The UI distinguishes worker claims, auditor verdicts, and controller
  transitions.
- Codex CLI `/goal` support, if used, is treated as provider evidence and not as
  authoritative workflow completion.

## Open Questions

- Should v0 store artifacts as JSON payloads in SQLite, files on disk with DB
  indexes, or both?
- Should audit workers be separate runtime sessions, separate agents inside one
  provider, or provider-neutral role turns?
- How much of the `IntentContract` should be generated from a ChatGPT planning
  thread versus authored directly in the shell?
- Should branch rules be declarative JSON first, or code-owned functions with
  serialized summaries?
- What is the smallest useful demo loop for this shell: a two-step
  implement/audit loop, or the full `5-1-5-1-5` ADEU pattern?
