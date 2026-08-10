# Direct Wave 16 Sub-Agent Lifecycle, Follow-Up, Compatibility, And Transcript Maturity Spec

Status: planning spec for Wave 16.

Primary branch:

```text
codex/direct-chatgpt-harness
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_WAVE15_RESIDENT_SUB_AGENT_MVP_SPEC.md
docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md
docs/DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
docs/DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md
docs/SUB_AGENT_TRANSCRIPT_PROJECTION_SPEC.md
docs/SUB_AGENT_META_TAGS_AND_TABBED_PANEL_SPEC.md
```

## Purpose

Wave 15 made the first direct sub-agent slice resident-callable:

```text
spawn_agent
list_agents
inspect_agent
bounded wait_agent
sanitized result admission
operator activity projection
```

Wave 16 matures that slice into a controlled multi-turn sub-agent surface:

```text
child lifecycle state becomes explicit truth
legacy compatibility names become projections, not authority
child transcript views become direct-native and non-flattening
follow-up/send becomes policy-gated
close/interrupt/resume become lifecycle-gated
operator and resident witnesses explain what is available and why
```

The goal is not to make sub-agents fully autonomous collaborators yet. The goal
is to add the next layer of controlled interaction while preserving the Wave 15
law that child work is not the primary transcript and E-channel observation is
not interference authority.

## Core Doctrine

Standing laws:

```text
lifecycle state != lifecycle mutation authority
legacy compatibility name != direct-native authority
child transcript projection != primary transcript evidence
follow-up message != new spawn
follow-up message != implicit child tool inheritance
wait result != permission to mutate child lifecycle
observe-only policy removes interference controls from the actor that accepted it
close/interrupt/resume require explicit lifecycle authority and terminal/stale evidence
```

Wave 16 must continue to consume the Wave 14.5 ODEU live-capability kernel:

```text
capability row
  -> promotion decision
  -> activation row
  -> declaration snapshot
  -> per-call authority decision
  -> live transaction
  -> result envelope
  -> context admission
  -> usability proof / resident witness / operator witness
```

No Wave 16 action may bypass those kernels by relying on UI state, legacy names,
or plain thread ids.

## Scope

In scope:

```text
read-only lifecycle state for all known direct sub-agents
legacy compatibility mapping to direct-native status rows
turn-scoped and full-history child transcript projection
no-interference / observe-only policy witness
policy-gated send_message / followup_task
operator-gated close_agent / interrupt_agent / resume_agent where support exists
headless and manual usability gates for lifecycle, follow-up, transcript, and compatibility
```

Out of scope:

```text
recursive spawn
child inherited tools
bulk fan-out
unbounded wait
unscoped child transcript injection into the primary transcript
legacy v1 names as governing ontology
autonomous lifecycle mutation without per-call authority
provider-specific resume simulation when the provider cannot resume
```

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| AgentLifecycleStateModel | support artifact | build | canonical direct-native child lifecycle/readiness/staleness state |
| AgentCompatibilityNameMapper | support artifact | build | maps legacy vanilla-compatible names to direct-native rows without granting authority |
| AgentLifecycleAuthorityMatrix | support artifact | build | declares which lifecycle actions can be considered, blocked, or operator-gated |
| SubAgentTranscriptProjectionV2 | surface/support artifact | align/build | turn-scoped and full-history child transcript projection, never primary flattening |
| SubAgentInteractionPolicyEnvelope | support artifact | build | no-interference, observe-only, follow-up-allowed, and lifecycle-control policy witness |
| SubAgentFollowupMailboxLedger | canonical evidence | build | idempotent follow-up/send requests, target validation, delivery/result refs |
| AgentLifecycleTransitionLedger | canonical evidence | build | close/interrupt/resume transition attempts and outcomes |
| AgentCancellationWitness | support artifact | build | cancellation/interrupt evidence, provider support, terminal-state witness |
| AgentResumeViabilityWitness | support artifact | build | proves resume is supported or blocks with reason |
| SubAgentOperatorLifecycleProjection | surface artifact | build | operator-visible status/actions/proof rows without minting authority |
| SubAgentHeadlessScenarioSuite | support artifact | build | executable headless scenarios for lifecycle/follow-up/transcript behavior |

## State Model

Lifecycle state should be split into axes rather than collapsed into one status:

```ts
type AgentLifecycleStateModel = {
  schema: "agent_lifecycle_state_model@1";
  agentId: string;
  childThreadId?: string;
  parentThreadId: string;
  workThreadId: string;
  lifecycleStatus:
    | "discovered"
    | "starting"
    | "running"
    | "idle"
    | "waiting"
    | "completed"
    | "failed"
    | "interrupted"
    | "closed"
    | "stale"
    | "not_found"
    | "unknown";
  transportStatus:
    | "not_started"
    | "provider_starting"
    | "provider_running"
    | "provider_terminal"
    | "provider_handoff_unknown"
    | "provider_unsupported"
    | "unknown";
  mailboxStatus:
    | "none"
    | "ready"
    | "pending_delivery"
    | "delivery_failed"
    | "delivery_unknown"
    | "closed"
    | "unknown";
  transcriptStatus:
    | "none"
    | "summary_only"
    | "turn_activity_available"
    | "full_history_available"
    | "blocked"
    | "unknown";
  usageStatus:
    | "none"
    | "exact"
    | "partial"
    | "unavailable"
    | "unknown";
  resultStatus:
    | "none"
    | "pending"
    | "summary_admitted"
    | "blocked"
    | "failed"
    | "unknown";
  controlPosture:
    | "observe_only"
    | "followup_allowed"
    | "lifecycle_operator_gated"
    | "lifecycle_resident_allowed"
    | "blocked"
    | "unknown";
  conflictState:
    | "none"
    | "source_mismatch"
    | "provider_vs_local_mismatch"
    | "legacy_mapping_mismatch"
    | "stale_projection"
    | "unknown";
  evidenceRefs: Array<{ kind: string; id?: string; digest?: string; label?: string }>;
  observedAt: string;
};
```

Rules:

```text
- Lifecycle state is evidence, not authority.
- Stale/not_found states are visible and non-mutating.
- A completed wait action does not automatically mean the child lifecycle is completed.
- A completed child result does not imply close/interrupt/resume authority.
- State rows must cite direct-native evidence, not only legacy compatibility names.
- Lifecycle, transport, mailbox, transcript, usage, result, and control posture
  must remain separate axes.
```

State precedence law:

```text
terminal exact > provider running > stale > unknown
policy blocked overrides control posture
handoff_unknown blocks lifecycle mutation and follow-up
not_found blocks all target actions
source conflict degrades action posture until reconciled
```

Reason:

```text
A child can be completed but transcript-available, running but mailbox-unavailable,
idle but provider-resume-unsupported, failed but result-summary-admitted, or
stale but full-history-projectable. One status field cannot safely represent all
of those cases.
```

## Compatibility Law

Legacy names are useful for user familiarity and vanilla parity:

```text
spawnAgent
sendInput
resumeAgent
wait
closeAgent
```

But direct-native names remain the governing ontology:

```text
spawn_agent
send_message
followup_task
wait_agent
inspect_agent
interrupt_agent
close_agent
resume_agent
```

Rules:

```text
- Legacy names map to direct-native action/status rows.
- A legacy name cannot bypass direct-native authority gates.
- Unknown legacy action maps to compatibility_unknown, not allowed.
- Compatibility rows must be inspectable by the resident and operator.
- Compatibility mapping is projection/adaptation, not a separate tool family.
- Compatibility mapping is one-way:
  legacy name -> direct-native row -> authority gate.
- Legacy names never appear in per-call authority as source authority.
```

Compatibility rows should carry:

```ts
type AgentCompatibilityNameMappingRow = {
  legacyName: string;
  directNativeName: string;
  compatibilityOnly: true;
  sourceAuthority: "direct_native_row";
  authorityBypassAllowed: false;
  mappingState: "mapped" | "unknown" | "blocked";
  evidenceRefs: Array<{ kind: string; id?: string; digest?: string; label?: string }>;
};
```

Required negative cases:

```text
spawnAgent cannot bypass spawn_agent activation.
sendInput cannot bypass send_message policy.
resumeAgent cannot bypass resume_agent provider-support witness.
wait cannot bypass wait_agent no-deadlock policy.
closeAgent cannot bypass close_agent lifecycle authority.
```

## Transcript Projection Law

Wave 16 should provide direct-native child transcript projection without
promoting child messages into the parent transcript.

Projection modes:

```text
turn_activity
  child events and messages related to one parent turn

full_child_history
  complete known child history for the child thread

result_summary
  sanitized admitted child result summary only
```

Rules:

```text
- The primary transcript shows activity summaries and links to child views.
- Child prompts and child answers render under child author identity.
- Parent-to-child messages are not "You" unless the human directly authored them.
- Child-agent answers are not primary Codex answers.
- Raw provider payloads, hidden reasoning, and raw prompt/result payloads remain excluded by default.
- Turn-scoped mode must not be confused with full child history.
```

Projection header:

```ts
type SubAgentTranscriptProjectionV2 = {
  schema: "sub_agent_transcript_projection_v2@1";
  projectionId: string;
  mode: "turn_activity" | "full_child_history" | "result_summary";
  childAgentId: string;
  childThreadId: string;
  parentThreadId: string;
  workThreadId: string;
  visibility: {
    rendererVisible: boolean;
    residentContextVisible: "none" | "summary_only" | "selected_excerpt";
    providerVisible: "not_applicable" | "not_seen" | "summary_only";
    primaryTranscriptVisible: "activity_summary_only" | "none";
  };
  childTranscriptFlattened: false;
  rawProviderPayloadIncluded: false;
  rawHiddenPromptIncluded: false;
  rawChildTranscriptIncludedInPrimary: false;
  cursor?: string;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
  sourceRefs: Array<{ kind: string; id?: string; digest?: string; label?: string }>;
  projectionDigest: string;
};
```

Context policy:

```text
turn_activity:
  operator projection by default
  resident status summary allowed

result_summary:
  context-admissible only if already sanitized/admitted

full_child_history:
  projection-only by default
  no context admission unless a future policy requests selected excerpts
```

Full child history is inspectable evidence, not model context. This prevents
context smuggling through a transcript viewer.

## Interference Policy

The parent/resident may intentionally self-bind:

```text
no_interference
observe_only
```

When that policy is active, the same actor that accepted the policy cannot use
interfering actions:

```text
send_message
followup_task
interrupt_agent
close_agent
resume_agent
```

Rules:

```text
- Observe-only still allows inspect/list/status/read-only E-channel.
- No-interference must be visible to the resident before tool choice.
- No-interference removes unavailable actions from the declaration/catalog or marks them blocked with exact reasons.
- The operator may be shown blocked actions, but cannot use them through a resident-callable path.
- Policy changes require their own authority transition; they cannot be inferred from UI selection.
```

Policy envelope:

```ts
type SubAgentInteractionPolicyEnvelope = {
  policyId: string;
  actorKind: "resident_model" | "operator" | "headless_route" | "sub_agent";
  actorId?: string;
  targetKind: "child_agent" | "child_thread" | "work_thread";
  targetId: string;
  scope: "single_child" | "parent_turn" | "parent_thread" | "work_thread";
  policy:
    | "observe_only"
    | "no_interference"
    | "followup_allowed"
    | "lifecycle_operator_gated";
  blockedActions: string[];
  allowedActions: string[];
  expiresAt?: string;
  sourceRefs: Array<{ kind: string; id?: string; digest?: string; label?: string }>;
  policyDigest: string;
};
```

Default scope:

```text
per actor + per child
```

Broader parent-turn, parent-thread, or work-thread scope must be explicit. It
must not be inferred from UI selection.

Provider declaration law:

```text
If observe-only/no-interference is active for the resident actor, then
send_message, followup_task, interrupt_agent, close_agent, and resume_agent
must not appear as callable provider-declared tools for that request, or must
route to a deterministic blocked result envelope.
```

Hiding UI controls is not sufficient.

## Follow-Up / Send Law

Follow-up turns are not the same as initial spawn:

```text
spawn_agent = create bounded child task
send_message = send one message to an existing child thread
followup_task = send a scoped follow-up with result expectation
```

Rules:

```text
- Follow-up requires a stable child identity and live/stale state check.
- Follow-up requires per-call authority and idempotency.
- Follow-up must cite the parent turn or work-thread intent that authorized it.
- Follow-up result admission uses the same result/context admission kernel.
- Follow-up cannot grant child inherited tools unless a later child-tool inheritance law exists.
- send_message/followup_task require existing stable child identity.
- If the provider/runtime cannot deliver to that existing child session, block.
- Do not create a new child as fallback.
```

Semantic API:

```text
send_message:
  message delivery to an existing child; no result expectation

followup_task:
  scoped task continuation; result expectation and optional wait/admission policy
```

Implementation may share the same mailbox ledger, but the resident-facing
concepts stay distinct.

Plans:

```ts
type SubAgentSendMessagePlan = {
  planId: string;
  targetChildThreadId: string;
  parentTurnId: string;
  messageDigest: string;
  messagePreview: string;
  idempotencyKey: string;
  expectsResult: false;
  deliveryPolicyDigest: string;
};

type SubAgentFollowupTaskPlan = {
  planId: string;
  targetChildThreadId: string;
  parentTurnId: string;
  taskDigest: string;
  taskPreview: string;
  idempotencyKey: string;
  expectsResult: true;
  resultAdmissionPolicyId: string;
  optionalWaitPolicyId?: string;
};
```

Delivery support:

```ts
deliverySupport:
  | "supported_live"
  | "supported_fixture"
  | "unsupported"
  | "unknown";

deliveryMode:
  | "same_child_session"
  | "provider_thread_message"
  | "harness_mailbox_only"
  | "unsupported";
```

If only `harness_mailbox_only` exists and the child provider will never see the
message, it is not a live follow-up. It can be a queued note, not
`send_message`.

Follow-up result admission remains summary-only:

```ts
followupResultAdmission: {
  resultEnvelopeId: string;
  contextAdmissionId?: string;
  admittedAs: "agent_result_summary" | "status_only" | "not_admitted";
  rawChildTranscriptIncluded: false;
};
```

## Lifecycle Mutation Law

Lifecycle mutation actions are authority-sensitive:

```text
close_agent
interrupt_agent
resume_agent
```

Rules:

```text
- close requires a target that is known, stable, and not already terminal unless close is idempotent.
- interrupt requires provider/runtime cancellation support or returns unsupported.
- resume requires a provider/runtime resume capability and stable session identity.
- unsupported does not become simulated success.
- every mutation emits a transition ledger row and result envelope.
- Wave 16 may make lifecycle controls operator-gated.
- Resident-callable lifecycle tools remain shadow/disabled unless a later
  explicit promotion decision enables them.
```

Initial Wave 16 posture:

```text
close_agent:
  operator-gated live only when close mode is supported

interrupt_agent:
  operator-gated live only with exact cancellation support

resume_agent:
  blocked unless exact same-session continuity exists
```

Resume support requires exact evidence:

```text
documented provider resume/continue primitive
or
live child session that accepts same-session append with provider confirmation
```

Not sufficient:

```text
known childThreadId
transcript history
replacement spawn with prior context
summary replay
```

Blocker:

```text
resume_unsupported_no_same_session_continuity
```

Cancellation witness:

```ts
type AgentCancellationWitness = {
  cancellationId: string;
  targetChildThreadId: string;
  requestedAt: string;
  providerSupport: "supported" | "unsupported" | "unknown";
  cancellationState:
    | "requested"
    | "sent_to_provider"
    | "acknowledged"
    | "terminal_interrupted"
    | "terminal_completed_before_cancel"
    | "failed"
    | "handoff_unknown";
  resultEnvelopeId?: string;
};
```

Do not treat `interrupt requested` as `interrupted`.

Close modes:

```text
local_surface_close
provider_session_close
mark_no_more_followup
unsupported
```

`local_surface_close` and `mark_no_more_followup` may be feasible before
provider session close. `provider_session_close` requires provider support.

Transition rows:

```ts
type AgentLifecycleTransitionLedgerRow = {
  transitionId: string;
  action: "close_agent" | "interrupt_agent" | "resume_agent";
  targetChildThreadId: string;
  actorKind: "operator" | "resident_model" | "headless_route";
  beforeStateRef: { kind: string; id?: string; digest?: string; label?: string };
  afterStateRef?: { kind: string; id?: string; digest?: string; label?: string };
  providerSupportWitnessRef?: { kind: string; id?: string; digest?: string; label?: string };
  perCallAuthorityDecisionId: string;
  transactionId: string;
  resultEnvelopeId?: string;
  outcome: "completed" | "blocked" | "unsupported" | "failed" | "handoff_unknown";
};
```

## PR Plan

### PR 97: Lifecycle State Model And Compatibility Mapper

Purpose:

```text
Create the direct-native lifecycle/readiness state model and map legacy names to
that model without adding lifecycle mutation authority.
```

Deliverables:

```text
AgentLifecycleStateModel
AgentCompatibilityNameMapper
AgentLifecycleAuthorityMatrix v0
resident/operator status rows for known child agents
compatibility rows for legacy names
transport/mailbox/transcript/usage/conflict axes
state precedence law
negative regression proving legacy names cannot bypass direct gates
registry and roadmap updates
```

Acceptance:

```text
- known agents project lifecycle/result/control axes separately.
- transport, mailbox, transcript, usage, and conflict axes are separately visible.
- legacy names map to direct-native rows with source refs.
- unknown legacy names are blocked as compatibility_unknown.
- compatibility rows are compatibilityOnly and cannot become source authority.
- no provider transport, lifecycle mutation, or transcript injection occurs.
```

Non-goals:

```text
no send/followup
no close/interrupt/resume
no child transcript redesign
```

### PR 98: Child Transcript Projection Maturity

Purpose:

```text
Create a direct-native child transcript projection that supports turn activity
and full child history without flattening child work into the primary transcript.
```

Deliverables:

```text
SubAgentTranscriptProjectionV2
turn_activity mode
full_child_history mode
result_summary mode
author identity projection for parent/child/controller/system/tool rows
source-row/source-event refs
visibility metadata for renderer/resident/provider/primary transcript
pagination/cursor fields for full history
raw-exposure sentinels
operator projection compatibility note
headless fixture for parent turn with one child and one admitted result
```

Acceptance:

```text
- child user messages never render as operator "You" unless human-authored.
- child agent messages never render as primary Codex final answers.
- primary transcript receives summaries/links only.
- turn_activity and full_child_history are distinguishable.
- full_child_history is projection-only by default and not admitted to context.
- full_child_history supports pagination/caps.
- raw prompt/result/provider payload flags stay false by default.
```

Non-goals:

```text
no right-pane redesign beyond projection compatibility
no lifecycle mutations
no child inherited tools
```

### PR 99: Interaction Policy And No-Interference Envelope

Purpose:

```text
Make no-interference / observe-only policy explicit before enabling follow-up
or lifecycle controls.
```

Deliverables:

```text
SubAgentInteractionPolicyEnvelope
NoInterferencePolicyWitness
resident tool catalog policy rows
operator blocked-control projection
policy digest and source refs
actor + target + scope fields
declaration/catalog removal or deterministic blocked-result proof
negative regression proving self-bound actors cannot call interfering actions
```

Acceptance:

```text
- observe-only allows list/inspect/status/wait only where otherwise authorized.
- no-interference blocks send/followup/close/interrupt/resume for the bound actor.
- blocked controls cite the policy digest and exact blocker reason.
- active observe-only/no-interference removes callable provider declarations or routes to deterministic blocked result envelopes.
- policy state is not inferred from UI labels.
```

Non-goals:

```text
no follow-up transport yet
no lifecycle mutation transport yet
no policy relaxation flow
```

### PR 100: Follow-Up And Send Message Controlled Continuation

Purpose:

```text
Enable controlled continuation with existing child agents through policy-gated
send_message / followup_task.
```

Deliverables:

```text
SubAgentFollowupMailboxLedger
SubAgentSendMessagePlan
SubAgentFollowupTaskPlan
send_message per-call authority decision
followup_task per-call authority decision
idempotency key and duplicate suppression
target validation and stale target blocking
deliverySupport / deliveryMode witness
provider-backed delivery adapter where supported
follow-up result envelope and context admission
resident witness rows
headless follow-up scenario
```

Acceptance:

```text
- follow-up requires stable child id, work-thread scope, and policy allowance.
- repeated idempotency key cannot duplicate child messages.
- stale/not_found child target blocks before provider transport.
- provider/runtime must support delivery to the existing child; no fallback spawn.
- follow-up result admission remains summary-only.
- no child tool inheritance or recursive spawn is introduced.
```

Non-goals:

```text
no close/interrupt/resume
no bulk fan-out
no legacy alias as authority source
```

### PR 101: Lifecycle Mutation Controls

Purpose:

```text
Add close/interrupt/resume as lifecycle-gated transitions with provider-support
witnesses and safe unsupported states.
```

Deliverables:

```text
AgentLifecycleTransitionLedger
AgentCancellationWitness
AgentResumeViabilityWitness
before/after lifecycle transition ledger rows
closeMode support rows
close_agent authority gate
interrupt_agent authority gate
resume_agent authority gate
provider unsupported/available rows
operator-gated projection for lifecycle actions
negative tests for terminal, stale, unsupported, and no-interference cases
```

Acceptance:

```text
- unsupported provider lifecycle action returns unsupported, not simulated success.
- close/interrupt/resume emit transition ledger rows.
- no-interference policy blocks interfering lifecycle actions.
- terminal state handling is explicit and idempotent where allowed.
- PR 101 makes lifecycle controls operator-gated first.
- resident-callable lifecycle actions remain disabled unless a later explicit promotion decision enables them.
```

Non-goals:

```text
no recursive spawn
no child inherited tools
no lifecycle action without per-call authority
no resident-callable lifecycle mutation by default
```

### PR 102: Wave 16 Usability Gate And Headless Scenario Suite

Purpose:

```text
Close Wave 16 with proof-backed operator/resident projections and executable
headless scenarios covering lifecycle, follow-up, transcript, and compatibility.
```

Deliverables:

```text
SubAgentWave16UsabilityProof
SubAgentOperatorLifecycleProjection
SubAgentResidentCapabilityWitnessRows
SubAgentHeadlessScenarioSuite
manual usability gate rows
analytics hooks for follow-up/lifecycle events where available
negative scenario matrix
roadmap/audit update marking Wave 16 complete if gates pass
```

Acceptance:

```text
- headless scenario covers lifecycle read, compatibility mapping, transcript views, no-interference block, follow-up, and lifecycle unsupported/allowed cases.
- negative scenarios cover legacy alias bypass, observe-only declaration removal, duplicate follow-up idempotency, stale child target, unsupported resume, interrupt requested vs interrupted, full-history context exclusion, and terminal close idempotency.
- operator projection reads proof artifacts and does not mint proof.
- resident knows available/disabled/blocked actions with reasons.
- primary transcript still does not flatten child transcript.
- all raw-exposure and authority sentinels remain enforced.
```

Non-goals:

```text
no UI redesign beyond proof/status projection
no Wave 17 human/control/read-only tools
no Wave 18 external discovery/MCP tools
```

## Completion Gate

Wave 16 is complete only when:

```text
1. Known child agents expose lifecycle/readiness/control posture as direct-native evidence.
2. Legacy compatibility names map to direct-native rows without authority bypass.
3. Child transcript views support turn_activity and full_child_history without primary flattening.
4. No-interference / observe-only policy removes interfering controls from the bound actor.
5. Follow-up/send is policy-gated, idempotent, target-validated, and summary-admitted.
6. close/interrupt/resume are either authority-gated and provider-supported, or explicitly unavailable.
7. Resident and operator projections explain available, disabled, blocked, and unsupported actions.
8. Headless scenarios verify the full Wave 16 behavior without relying on frontend UX.
```

## Settled Defaults

```text
1. No lifecycle mutation becomes resident-callable by default in Wave 16.
   close/interrupt/resume are operator-gated first.
2. send_message and followup_task remain separate resident-facing concepts.
   followup_task may be implemented as a typed envelope over the mailbox ledger.
3. full_child_history is projection-only by default. Context admission requires a
   future explicit selected-excerpt policy.
4. Resume support requires exact same-session continuity, not transcript replay
   or replacement spawn.
5. observe-only / no-interference defaults to per actor + per child. Broader
   parent-turn, parent-thread, or work-thread scope must be explicit.
```
