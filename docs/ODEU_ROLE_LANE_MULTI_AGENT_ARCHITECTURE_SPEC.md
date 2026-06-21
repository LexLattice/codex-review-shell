# ODEU Role-Lane Multi-Agent Architecture Spec

Status: architecture draft for Direct harness planning.

## Purpose

Define the high-level multi-agent architecture where a unified user-facing
conversation is backed by role-purified institutional lanes. This spec is not a
tool implementation plan. It defines the ODEU invariants that should govern
future work on resident agents, sub-agents, skills, MCP, guardrails, memory,
analytics, and cross-lane routing.

The central stance:

```text
Unified human conversation != unified internal agent.

The system should feel like one coherent intelligence to the human, while
internally preserving role, evidence, policy, memory, tool, and observer
boundaries.
```

## Non-Goals

- No proposal to expose all tools to one resident model.
- No global memory object shared by every role.
- No raw transcript relay from the front model to specialists.
- No policy model with direct execution authority.
- No cross-lane transcript access by semantic relevance alone.
- No implementation-specific claim that Direct already supports every lane.

## Core Doctrine

An ODEU multi-agent system is a ledgered institution of role-purified lanes.
Each lane owns a bounded object world, evidence substrate, decision law, utility
function, memory scope, tool surface, analytics schema, observer set, and export
contract.

The human may see:

```text
one conversation
one assistant
one coherent interaction
```

The harness should maintain:

```text
front conversation lane
semantic routing lane
specialist role lanes
care/policy lanes
audit lanes
execution lanes
cross-lane export ledgers
```

Any request-time compiler or composer that sits between these lanes must remain
subordinate to already-lawful artifacts. It may combine lane selection, route,
authority, runtime, and capability evidence into provider request shape. It must
not become a hidden super-agent that decides user intent, creates roles, grants
permission, or rewrites policy.

## Constitutional Invariants

### Raw Utterance Is Not The Task

A user message is evidence from which one or more task objects are
reconstructed.

```text
raw utterance
  -> semantic parse artifact
  -> normalized lane request(s)
  -> lane processing
  -> user-facing synthesis
```

The raw utterance belongs to the unified conversation ledger. The normalized
request belongs to a role lane.

### Semantic Relevance Is Not Access Permission

Information from one lane may be relevant to another lane without being
directly shareable.

Example:

```text
care lane evidence:
  "student is hungry and distressed"

biology lane allowed export:
  learning_readiness = low
  reason_class = fatigue_or_hunger
  detail_level = minimal
```

The biology tutor may receive the readiness signal. It does not receive the raw
care transcript.

### Semantic Judgment Is Not Causal Authority

Models may classify, propose, summarize, or assess. They do not own final
causal permission.

```text
resident model proposes action
guardrail model classifies risk
deterministic policy resolves decision
capability runner enforces token
ledger records the chain
```

The runner, not a model, is the final causal gate.

### Role Memory Is Not Global Memory

Every lane has its own memory scope.

```text
biology memory != care memory
teacher analytics != child private disclosure
project worker memory != governance/audit memory
```

Cross-lane memory movement requires a typed export artifact and policy gate.

### Tool Existence Is Not Tool Authorization

The system can know a tool exists without declaring it to the resident model in
the current request.

Tool posture must be expressible as:

```text
callable_now
known_available_but_not_declared
disabled_by_policy
operator_gated
unsupported_by_provider
requires_setup
future_wave
unknown
```

The request-time tool composer is therefore a compiler:

```text
RoleLaneSelection
+ NormalizedLaneRequest
+ ActivationSnapshot
+ RuntimeFacts
+ DeclarationPolicy
+ AuthorityTemplates
= ProviderDeclaredToolBundle
+ ResidentCapabilityCatalogue
+ CompositionWitness
```

It is not an authority source.

Forbidden composer responsibilities:

```text
decide what the user meant
decide which role should exist
grant capability authority
rewrite lane policy
promote a tool solely because it exists
```

### Observer Access Is Role-Scoped

An observer receives only the lane substrate they are institutionally
authorized to inspect.

Example:

```text
biology teacher assistant:
  can inspect biology learning progress
  cannot inspect care-lane private notes
```

### Every Transition Has A Witness

No lane mutation, cross-lane export, capability execution, or role handoff is
lawful without a typed witness.

Required witness classes:

```text
raw_utterance
semantic_parse
normalized_lane_request
policy_assessment
policy_decision
capability_token
specialist_result
cross_lane_export
user_facing_synthesis
audit_record
```

## ODEU Layering

Each role lane has its own ODEU packet:

```text
O: object world
   What kinds of objects this lane may process.

E: evidence substrate
   What evidence this lane may read, produce, retain, and export.

D: decision law
   What rules map evidence and requests to allowed lane transitions.

U: utility/function
   What this lane exists to optimize or preserve.
```

Example:

```text
Biology tutor lane
O:
  biology concepts, student attempts, assignments, misconceptions, quizzes

E:
  biology-specific student requests, biology tutor outputs, biology tool
  results, teacher biology assignments, concept mastery analytics

D:
  homework-help policy, age/grade appropriateness, no full assignment
  completion, no care-lane access without export

U:
  improve biology understanding through authorized instructional help
```

## Role Taxonomy

### Front Model

Purpose:

```text
natural conversation
semantic parsing
mixed-intent splitting
route selection
specialist handoff
final synthesis
```

Authority:

```text
no direct tools
no specialist memory access except through lane exports
no execution authority
```

### Specialist Agent

Purpose:

```text
domain work inside one lane
```

Examples:

```text
biology tutor
math tutor
implementation worker
auditor worker
care model
project broker
governance reviewer
```

Authority:

```text
lane-scoped tools
lane-scoped memory
lane-scoped analytics
lane-scoped observer/export rules
```

### Guardrail Observer

Purpose:

```text
emit schema-bound semantic assessments
```

Authority:

```text
no tool execution
no direct capability enable/disable
no workflow pointer mutation
```

### Deterministic Policy Resolver

Purpose:

```text
map typed assessments and lane law to allow/deny/narrow/escalate decisions
```

Authority:

```text
transition authority over policy outcome
no object-level semantic invention
```

### Capability Runner

Purpose:

```text
enforce scoped capability tokens
execute or deny causal actions
record results
```

Authority:

```text
causal gate over filesystem, commands, network, MCP, hosted tools, sub-agents,
and external effects
```

### Auditor Agent

Purpose:

```text
object-level validation of artifacts against an intent contract
```

Authority:

```text
audit verdict authority
no workflow pointer mutation unless assigned by StepContract
```

### Meta-Orchestrator

Purpose:

```text
maintain plan pointer
validate artifact class/provenance/position
route next worker/auditor
apply transition law
```

Authority:

```text
transition authority
not object-level technical authority
```

## Canonical Event Chain

```text
UserMessageReceived
RawUtteranceRecorded
SemanticParseStarted
SemanticParseSubmitted
LaneRequestCreated
LaneRequestPolicyChecked
LaneRequestAccepted
SpecialistTurnStarted
SpecialistArtifactSubmitted
LaneResultPolicyChecked
CrossLaneExportCreated
UserFacingSynthesisStarted
UserFacingResponseSubmitted
AuditLedgerUpdated
```

Important distinction:

```text
LaneRequestAccepted != LaneResultValid
CrossLaneExportAdmissible != RawEvidenceShareable
GuardrailAssessmentValid != ActionAllowed
```

## Mixed-Intent Handling

Mixed human prompts should be split into lane-valid objects.

Example raw utterance:

```text
I need help with biology homework, but I'm hungry and I also don't get why my
teacher marked my answer wrong.
```

Normalized split:

```json
{
  "sourceMessageId": "u_msg_1842",
  "normalizedRequests": [
    {
      "targetLane": "biology_tutor",
      "intent": "homework_help",
      "topic": "biology",
      "task": "help understand assignment and teacher correction",
      "sourceSpan": "I need help with biology homework ... why my teacher marked my answer wrong"
    },
    {
      "targetLane": "care_model",
      "intent": "basic_need",
      "needType": "hunger",
      "task": "support break/snack handling",
      "sourceSpan": "I'm hungry"
    }
  ]
}
```

The biology tutor does not receive the raw hunger disclosure. The care model
does not receive the full biology task unless authorized.

## Cross-Lane Export Contract

Cross-lane information movement must use a typed export artifact:

```ts
type CrossLaneExportArtifact = {
  schema: "cross_lane_export_artifact@1";
  exportId: string;
  sourceLaneId: string;
  targetLaneId: string;
  sourceArtifactRefs: EvidenceRef[];
  exportKind:
    | "readiness_signal"
    | "progress_summary"
    | "risk_signal"
    | "assignment_status"
    | "misconception_cluster"
    | "capability_status"
    | "audit_digest";
  detailLevel: "minimal" | "summary" | "bounded_excerpt" | "full_artifact_ref";
  payload: Record<string, unknown>;
  rawTranscriptIncluded: false;
  permissionBasis: string;
  expiresAt?: string;
  policyDecisionRef: string;
  createdAt: string;
};
```

Rules:

```text
No raw transcript export by default.
No cross-lane export without source and target lane IDs.
No export without policy decision reference.
No export can expand its own permission by being useful.
Expiry must be explicit for transient state signals.
```

## Guardrail And Policy Split

The guardrail model is a witness, not a sovereign.

Allowed guardrail output:

```json
{
  "assessmentType": "capability_risk",
  "targetObjectClass": "project_source_file",
  "scopeRelation": "within_requested_task",
  "reversibility": "medium",
  "externalSideEffectLevel": "none",
  "dataExposureLevel": "local_workspace",
  "userAuthorization": "present",
  "uncertainty": "low"
}
```

Forbidden guardrail output:

```json
{
  "allow": true,
  "disableCapability": "filesystem_write"
}
```

The deterministic policy resolver owns:

```text
assessment predicates + lane law -> decision
```

## Capability Tokens

Capability should be scoped per lane, operation, target, and time.

```ts
type CapabilityToken = {
  schema: "capability_token@1";
  tokenId: string;
  laneId: string;
  roleId: string;
  capability: string;
  allowedOperations: string[];
  scope: {
    allowedTargets: string[];
    deniedTargets: string[];
  };
  ttlSteps: number;
  maxOperations: number;
  requiresPreview: boolean;
  policyDecisionRef: string;
  issuedAt: string;
  expiresAt?: string;
};
```

The runner checks the token on every call.

## Data Model

```ts
type RoleLane = {
  schema: "role_lane@1";
  laneId: string;
  roleId: string;
  displayName: string;
  objectClasses: string[];
  evidenceScope: EvidenceScope;
  memoryScope: MemoryScope;
  toolScope: ToolScope;
  analyticsScope: AnalyticsScope;
  observerScope: ObserverScope;
  exportPolicyRefs: string[];
  laneLawRefs: string[];
  utilityContractRef: string;
};

type RoleLaneSelection = {
  schema: "role_lane_selection@1";
  selectionId: string;
  laneId: string;
  laneKind:
    | "front_conversation"
    | "implementation_worker"
    | "review_auditor"
    | "meta_orchestrator"
    | "sub_agent_worker"
    | "discovery_research"
    | "provider_hosted_web"
    | "image_artifact"
    | "memory_compaction"
    | "headless_daemon";
  agentClassSpecRef: EvidenceRef;
  normalizedLaneRequestRef?: EvidenceRef;
  controlledRouteRef?: EvidenceRef;
  roleHandoffPacketRef?: EvidenceRef;
  authorityBoundaryRef: EvidenceRef;
  laneLawRefs: EvidenceRef[];
  selectedAt: string;
};

type SemanticParseArtifact = {
  schema: "semantic_parse_artifact@1";
  parseId: string;
  sourceMessageId: string;
  sourceSpans: SourceSpanRef[];
  normalizedRequests: NormalizedLaneRequest[];
  ambiguityRows: SemanticAmbiguityRow[];
  policySignals: PolicySignal[];
  createdAt: string;
};

type NormalizedLaneRequest = {
  schema: "normalized_lane_request@1";
  requestId: string;
  sourceMessageId: string;
  targetLaneId: string;
  intentClass: string;
  taskObject: Record<string, unknown>;
  sourceSpanRefs: SourceSpanRef[];
  omittedSourceSpanRefs: SourceSpanRef[];
  policyTemplateRefs: string[];
  contextPacketRef?: string;
  authorityBoundaryRef: string;
};
```

## Analytics Implication

Analytics belong to role lanes, not to the global chat by default.

Example biology analytics:

```text
photosynthesis:
  understands sunlight -> energy relation
  weak on chlorophyll role
  confuses oxygen and carbon dioxide direction
  can define glucose but not explain its function
```

These analytics are derived from biology-lane evidence, not from unrestricted
global transcript mining.

## Direct Harness Implication

For our Direct harness, the same architecture should govern:

```text
implementation lane
review/audit lane
sub-agent worker lane
MCP discovery lane
provider-hosted web lane
image artifact lane
memory/compaction lane
headless daemon lane
project broker lane
```

The resident agent should not receive a flat global tool list. It should receive
a lane-scoped capability catalogue and provider-declared tool bundle for the
current role, WorkThread, objective, and authority boundary.

Direct should bind role lanes to existing role artifacts rather than inventing a
parallel role ontology:

```text
RoleLane
  binds to AgentClassSpec
  cites WorkThread resolution
  cites controlled route / handoff packet when present
  cites normalized lane request
  cites authority boundary
```

That preserves the institutional lane as a higher-level ODEU object while
keeping `AgentClassSpec` as the concrete agent-role contract already used by
the Direct harness.

## Acceptance Criteria

- A role lane can be described without referencing UI widgets or provider
  request fields.
- A raw user utterance can split into multiple normalized lane requests.
- A specialist lane can operate without seeing raw mixed-intent prompts.
- Cross-lane export requires a typed artifact and policy decision.
- Guardrail assessments are schema-bound predicates, not commands.
- Capability tokens are scoped and checked by the runner.
- Tool availability is represented separately from current-call authority.
- Role memory, analytics, observers, and tools are lane-scoped by default.
- Request-time composers are compilers over existing lane/request/authority
  artifacts, not new authority sources.
- Role-lane selection binds to existing agent-role artifacts instead of
  creating a parallel uncontrolled role ontology.
