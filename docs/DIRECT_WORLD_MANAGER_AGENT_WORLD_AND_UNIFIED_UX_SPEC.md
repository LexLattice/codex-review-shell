# Direct World Manager Agent-World And Unified UX Spec

Status: design doctrine and staged implementation target. A narrow exploratory
vertical slice is implemented in the
[Direct WorldManager Semantic Mockup](./DIRECT_WORLD_MANAGER_SEMANTIC_MOCKUP.md);
the production `WM-K1` through `WM-K4` slices now implement durable ingress,
graph-bound settlement, typed task constitution, trusted role-template
compilation, AgentInstantiation manifests, fail-closed projection agreement,
persisted Direct manager turns, terminal AgentResult relay, semantic-inbox
delivery, and advisory WorldManager reconciliation. The complete target
remains unimplemented. The production-oriented,
keyboard-first integration sequence is specified in
[Direct WorldManager Keyboard Pipeline Integration Spec](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md).
The semantic-ingress, semantic-history, context-tool, ARO, and thought-paint
refinement is specified in
[Direct WorldManager Semantic Context, ARO, And Thought Tools Design](./DIRECT_WORLD_MANAGER_SEMANTIC_CONTEXT_ARO_AND_THOUGHT_TOOLS_DESIGN.md).

Date: 2026-07-26.

This spec refines the human-facing target in
[Direct Wave 26](./DIRECT_WAVE26_HIERARCHICAL_WORLDMODEL_PROJECT_MANAGER_SPEC.md).
It does not replace the accepted hierarchical-worldmodel substrate, its custody
rules, or its current bounded implementation status. The semantic mockup proves
one planning interaction with provisional local contracts and a dedicated
renderer. Production K4 now supplies the bounded provider-backed manager
runtime and completion relay, but does not claim proposal admission, canonical
user-policy admission, general execution-role compilation, the completed
production unified renderer, or a voice bridge.

## Purpose

Define one coherent product architecture joining:

```text
the persistent World Manager relationship
the unified text and voice communications plane
Project Manager and worker differentiation
semantic worldstate admission
project policy persistence and inheritance
role-system-prompt compilation
bounded agent-world instantiation
completion semantic relay
progressive semantic transparency
minimal-by-default project UX
```

The central correction is:

```text
The user should not have to operate an artificial bureaucracy of agents.

The user ordinarily speaks through one World Manager-governed communications
surface.

Different reasoning roles may formulate responses and perform work, but the
surface preserves one relationship, one semantic lineage, and truthful
provenance.
```

The product is therefore not:

```text
one agent with sub-agents
```

It is:

```text
agents coordinated by a supra-agent
```

The World Manager is the constitutional, semantic, and continuity layer above
project-local and task-local agents. It is not merely the most senior worker.

## Root Doctrine

Standing formulations:

> Meaning is authored semantically, persisted canonically, inherited
> mechanically, projected selectively, and enforced causally.

> The World Manager settles the semantic world. The harness compiles that
> world into a bounded agent instance. The prompt gives the instance explicit
> self-understanding; the runtime gives its constitution causal force.

> At the surface, show coherent agency. At depth, reveal truthful
> differentiation. Preserve one semantic lineage through every layer.

> One body from the outside; a governed ecology of reasoning organs from
> within.

Operationally:

```text
reason semantically once when meaning is established
  -> persist the correct abstract object
  -> propagate its lawful consequences mechanically
  -> invoke semantic reasoning again only at a real semantic boundary
```

The worldstate is not semantic merely because it is a graph or because rows
carry labels such as `local_git_only`. It becomes semantic because an
authorized reasoner successfully identifies, scopes, relates, and admits the
abstract object those labels denote.

## Relationship To Existing Direct Doctrine

This spec preserves:

```text
UserWorld
  -> ProjectWorld
    -> WorkThreadWorld
      -> AgentRun / operation evidence
```

and:

```text
World Manager
  -> Project Manager
    -> Thread Manager
      -> worker / specialist / auditor
```

It refines the earlier surface description:

```text
earlier target:
  World Manager chat
  Project Manager chat per project

refined target:
  one persistent World Manager-governed communications plane
  Project Managers formulate project-scoped responses inside that plane
  project surfaces provide focus, evidence, and semantic anatomy
  direct Project Manager contact remains representable but is not a second
  mandatory user-facing communications system
```

The distinction is:

```text
where the user speaks
!= who interprets the message
!= who formulates the response
!= who may admit a canonical state transition
!= who executes the resulting contract
```

These functions may be unified experientially while remaining differentiated
semantically.

## Maturity Boundary

Repo-grounded current truth:

- Wave 26 provides accepted local fixture/headless substrate for hierarchical
  worldmodel nodes, Project Managers, semantic ingress, graph-first manager
  context, project-memory propagation, and convergence/governance games.
- Direct context packs and request manifests already distinguish harness
  policy, current user intent, historical evidence, tool-result evidence, and
  status evidence.
- Direct obligation/tool context already preserves the law that provider
  output and tool evidence do not mint local authority.

Still target-only here:

```text
resident World Manager service
unified World Manager communications renderer
automatic completed-turn semantic relay
final-message-anchored AgentResult ingestion
canonical PolicyObject family described below
deterministic policy-closure compiler
versioned role-template compiler
AgentInstantiation and manifest
projection-agreement validator
dependency-sensitive staleness invalidation
voice transport integration
progressive semantic anatomy UI
```

No schema below should be described as implemented until code, persistence,
regressions, and runtime witnesses exist.

## Product Model: One Communications Plane

The persistent conversation is not a chat with one natural-language persona. It
is a unified communications plane governed by the World Manager.

The World Manager contains several logically distinct functions:

```text
semantic ingress
  identifies the addressed world, project, task class, and likely effects

semantic router
  selects the role that should formulate the response or perform the work

communications governor
  preserves one conversation, speaker provenance, scope, and event lineage

worldstate governor
  evaluates candidate semantic changes against higher goals and current graph

admission authority
  admits, remands, defers, rejects, splits, or supersedes canonical changes
```

These functions may have separate runtime implementations. They remain aspects
of one constitutional World Manager identity.

The ingress/router path may use a lower-cost bounded semantic role when the
ontology and stakes permit it. Natural-language category membership remains a
semantic judgment: conversation, project genesis, planning, execution, review,
negation, hypothetical language, and mixed intent must not be defined by
keyword or regular-expression tables. Deterministic bindings are reserved for
relations that are already exact, such as typed controls, validated IDs,
canonical graph refs, and mechanical policy inheritance. Deeper WorldManager
reasoning is required when scope, meaning, authority, or policy is materially
ambiguous.

## Canonical Planning Flow

Planning is a first-class governed lifecycle, not casual dialogue followed by
an untracked implementation request.

```text
user:
  "Plan the next five features."

World Manager ingress:
  resolves project + planning task class

semantic router:
  delegates formulation to the owning Project Manager

Project Manager:
  returns a human-facing response + typed PlanProposal

unified communications plane:
  renders the response immediately with project/role provenance

World Manager:
  consumes the same AgentResult in parallel
  evaluates it against global goals, cross-project dependencies, budgets,
  standing policy, and semantic blind spots

worldstate:
  registers the proposal as candidate, not canonical

user and Project Manager:
  refine versioned proposal artifacts through the same communications plane

user:
  greenlights the settled plan

World Manager:
  resolves the authority and scope of that approval
  admits the final plan
  creates or ratifies an ImplementationContract
  persists both admission and contract

Project Manager:
  receives the contract and delegates bounded implementation worlds
```

The Project Manager is the primary project-planning reasoner. The World Manager
does not micro-audit every local design choice. It maintains the higher-level
posture:

```text
what this plan achieves relative to project and user goals
which cross-project constraints or opportunities matter
which semantic blind spots remain
which continuations are globally attractive
which budget and authority boundaries apply
whether the proposal may become canonical
```

## Semantic Event And Lineage

All visible depths must remain projections of the same canonical semantic
event.

```ts
type SemanticEvent = {
  schema: "direct_semantic_event@1";

  semanticEventId: string;
  lineageRootId: string;
  parentSemanticEventIds: string[];

  ingressRef: SourceRef;
  userIntentRef?: SourceRef;
  taskSettlementRef?: SourceRef;
  routingDecisionRef?: SourceRef;
  agentInstantiationRef?: SourceRef;
  agentResultRef?: SourceRef;
  proposalArtifactRefs: SourceRef[];
  admissionDecisionRefs: SourceRef[];
  implementationContractRefs: SourceRef[];
  executionLineageRefs: SourceRef[];
  worldstateDeltaRefs: SourceRef[];
  substrateEvidenceRefs: SourceRef[];

  presentationState:
    | "received"
    | "routed"
    | "responded"
    | "reconciling"
    | "candidate_registered"
    | "decision_required"
    | "admitted"
    | "executing"
    | "completed"
    | "remanded"
    | "failed";

  sourceScopeRevisions: ScopedWorldmodelRevisionRef[];
  digest: string;
};
```

The lineage invariant:

```text
one user utterance
  -> one or more explicitly split routed requests
  -> one role instantiation per routed assignment
  -> typed proposals/results
  -> explicit admission decisions
  -> implementation contracts
  -> execution and evidence lineages
```

If one utterance contains unrelated global and project changes, semantic
ingress may split it. The split must remain visible as child events of one
ingress lineage rather than pretending only one meaning existed.

## Completion Semantic Relay

Completed turns contain two different evidence classes.

### Deterministic telemetry

```text
turn identity
start/end time
provider/backend/environment
model and effort when evidenced
tool calls and tool classes
approvals and effects
files or artifacts touched
token/usage evidence
runtime result and interruption state
```

Telemetry does not require a semantic model to identify what mechanically
happened.

### Semantic result

The final assistant response is the semantic anchor for interpreting what the
turn achieved. It is not automatically canonical truth and is not sufficient
as the only persisted result.

```ts
type AgentResult = {
  schema: "direct_agent_result@1";

  agentResultId: string;
  agentInstantiationId: string;
  semanticEventId: string;

  userFacingResponseRef: SourceRef;
  finalAssistantMessageRef: SourceRef;
  semanticArtifactRefs: SourceRef[];
  worldstateChangeProposalRefs: SourceRef[];

  completionClaimRef?: SourceRef;
  unresolvedQuestionRefs: SourceRef[];
  policyConflictRefs: SourceRef[];
  scopeConflictRefs: SourceRef[];
  evidenceRefs: SourceRef[];
  telemetryEnvelopeRef: SourceRef;

  returnContractRef: SourceRef;
  sourceScopeRevisions: ScopedWorldmodelRevisionRef[];
  digest: string;
};
```

Relay law:

```text
Project Manager or worker completes
  -> user-facing response may render immediately
  -> the same AgentResult enters the World Manager semantic inbox
  -> World Manager reconciles it asynchronously
  -> semantic changes remain candidates until admitted
  -> admission/remand status projects back into the same visible event
```

The UI should not flatten this into generic `thinking`. It should report
truthful transitions:

```text
Project Manager replied
World Manager reconciling proposal
Proposal registered as candidate
Worldstate update requires confirmation
Plan admitted
Implementation contract created
```

## Worldstate Policy Objects

Project and user preferences should be established semantically once and
persisted as governed policy objects. Workers should not repeatedly rediscover
them from conversation or infer their scope from an `AGENTS.md` file.

```ts
type PolicyObject = {
  schema: "direct_policy_object@1";

  policyId: string;
  identity: string;
  ownerRef: SourceRef;

  scopeSelector: {
    userWorldId?: string;
    projectIds?: string[];
    workThreadIds?: string[];
    taskTypes?: string[];
    phases?: string[];
    environments?: string[];
    roleKinds?: string[];
  };

  governedActionClasses: string[];
  deonticForce:
    | "required"
    | "permitted"
    | "prohibited"
    | "preferred"
    | "discouraged";
  policyStrength:
    | "hard_constraint"
    | "default"
    | "preference"
    | "advisory";

  inheritanceRuleRef: SourceRef;
  exceptionRuleRef?: SourceRef;
  precedence: number;

  enforcementModes: Array<
    | "capability_denial"
    | "approval_gate"
    | "runtime_precondition"
    | "postcondition_validation"
    | "prompt_instruction"
    | "audit_only"
  >;

  provenanceRefs: SourceRef[];
  authorityDecisionRef: SourceRef;
  supersedesPolicyRef?: SourceRef;
  policyRevision: number;
  status: "candidate" | "active" | "superseded" | "revoked" | "expired";
  digest: string;
};
```

Example semantic policy:

```text
PolicyObject: LocalOnlyDevelopment

scope:
  Project B

governs:
  push
  publish
  create_remote_branch
  create_pull_request

force:
  prohibited

inherits_to:
  implementation
  repair
  audit
  refactor

exception:
  explicit project-scoped user authorization
```

This is not merely a stored sentence. It is an admitted object with scope,
force, target action classes, inheritance, exception behavior, provenance, and
revision.

### Policy scope hierarchy

```text
global user default
  -> workspace
    -> project
      -> project + task class
        -> planning period / goal
          -> WorkThread / implementation contract
            -> one run or one action exception
```

Precedence must be explicit. `Last write wins` is not a sufficient semantic
policy.

### Exceptions

An exception is a bounded authority grant, not deletion of the parent policy.

```ts
type PolicyException = {
  schema: "direct_policy_exception@1";

  policyExceptionId: string;
  parentPolicyRef: SourceRef;
  authorizingRoleRef: SourceRef;

  taskRef?: SourceRef;
  actionClass: string;
  targetRef?: SourceRef;
  permittedEffect: string;
  exclusions: string[];

  effectiveWorldstateRevision: number;
  expiresAt?: string;
  expiresWhen?: "action_consumed" | "task_closed" | "work_thread_closed";
  useLimit?: number;
  usedCount: number;

  authorityDecisionRef: SourceRef;
  provenanceRefs: SourceRef[];
  status: "candidate" | "active" | "consumed" | "expired" | "revoked";
  digest: string;
};
```

For example:

```text
Permit one push of branch release-audit for Task T.
Do not permit pull-request creation or merge.
Expire when the push is consumed or Task T closes.
```

The parent `LocalOnlyDevelopment` policy remains active before and after the
exception.

## Semantic Settlement And Mechanical Inheritance

For a new request, the World Manager may only need to settle:

```text
project = Project B
task type = C
phase = implementation
environment = local repository
likely effects = inspect, edit, test, commit, publish
```

This is semantic because it binds the request to the correct project and task
ontology.

After those bindings exist, the harness computes the obligation closure
deterministically:

```text
semantic worldstate
  -> project/task/effect settlement
  -> policy selector match
  -> inherited obligation closure
  -> precedence and exception resolution
  -> conflict detection
  -> ResolvedTaskConstitution
  -> minimal high-salience prompt projection
  -> capability and approval projection
  -> runtime enforcement
```

```ts
type TaskSettlement = {
  schema: "direct_task_settlement@1";

  taskSettlementId: string;
  semanticEventId: string;
  projectRef: SourceRef;
  taskTypeRef: SourceRef;
  phaseRef?: SourceRef;
  roleRef: SourceRef;
  environmentRef: SourceRef;
  requestedEffectClasses: string[];
  inferredEffectClasses: string[];

  confidence: "exact" | "high" | "derived" | "ambiguous";
  ambiguityRefs: SourceRef[];
  explicitOverrideCandidateRefs: SourceRef[];
  sourceRefs: SourceRef[];
  sourceScopeRevisions: ScopedWorldmodelRevisionRef[];
  digest: string;
};
```

```ts
type ResolvedTaskConstitution = {
  schema: "direct_resolved_task_constitution@1";

  taskConstitutionId: string;
  taskSettlementRef: SourceRef;

  projectIdentityRef: SourceRef;
  taskIdentityRef: SourceRef;
  roleRef: SourceRef;
  goalRefs: SourceRef[];

  inheritedObligationRefs: SourceRef[];
  requiredActionClasses: string[];
  permittedActionClasses: string[];
  prohibitedActionClasses: string[];
  activeExceptionRefs: SourceRef[];

  requiredEvidenceRefs: SourceRef[];
  completionConditionRefs: SourceRef[];
  escalationConditionRefs: SourceRef[];
  budgetRef?: SourceRef;

  sourcePolicyRefs: SourceRef[];
  sourceScopeRevisions: ScopedWorldmodelRevisionRef[];
  policyClosureDigest: string;
  digest: string;
};
```

Example compiled result:

```text
Resolved task constitution

required:
  preserve project invariants
  run focused tests

permitted:
  inspect files
  edit files
  create local commits

forbidden:
  push
  publish
  create pull request
  mutate remote repository
```

The closure may be cached by a key such as:

```text
Project B
+ task type C
+ phase implementation
+ effect-class set
+ relevant policy-graph revisions
```

Semantic reasoning is required again when:

```text
project or task classification is ambiguous
scope changes materially
two policies conflict
an exception is requested
the action crosses world boundaries
the task changes type
the user appears to establish or revise standing policy
```

Repeated inheritance should otherwise behave more like type checking than
philosophical reinterpretation.

## System Prompt And Agent-World Compilation

The true compiled object is larger than a system prompt. It is an agent-world
instantiation.

```text
AgentInstantiation
  role constitution
  actor/project/task bindings
  resolved policy closure
  relevant worldstate projection
  authority envelope
  capability envelope
  budget
  evidence-access contract
  completion evaluator
  output/return schema
```

The system prompt is its language-facing projection:

```text
ResolvedTaskConstitution
  -> AgentInstantiation
     ├─ system prompt
     ├─ tools and capabilities
     ├─ filesystem/network permissions
     ├─ approval gates
     ├─ budget controller
     ├─ evidence-access contract
     ├─ completion evaluator
     └─ worldstate return contract
```

### Fixed identity, compiled situation

Identity:

```text
what kind of reasoner this is
what authority it can ever possess
what responsibilities define the role
```

Situation:

```text
which project
which task
which policies
which evidence
which goals
which budget
which temporary constraints and exceptions
```

The World Manager owns a fixed constitutional kernel. Dynamic worldstate may
inform it but may not redefine its root identity or admission responsibilities.

Other roles should use trusted, versioned templates:

```text
trusted role template
+ settled worldstate bindings
+ scoped authority
+ current task constitution
-> concrete AgentInstantiation
```

The World Manager chooses the semantic bindings. The harness renders the
template deterministically. A model should not freely author a new system
prompt for every child.

### Prompt compilation layers

```text
1. Role kernel
   Fixed role identity, duties, and permanent authority ceiling.

2. Actor and project binding
   The concrete manager/worker and governed project.

3. Standing project constitution
   Canonical goals, policies, preferences, and project boundaries.

4. Task constitution
   Task type, obligations, capabilities, budget, and completion rules.

5. Turn directive
   Immediate request, refinement, or bounded temporary exception.

6. Evidence context
   Relevant artifacts and history, explicitly framed as evidence.
```

Lifetime classes:

| Lifetime | Examples |
| --- | --- |
| role | Project Manager duties and permanent authority ceiling |
| project | project identity, standing policies, long-term goals |
| active period | roadmap, budget, current phase |
| task/WorkThread | implementation contract, effects, required evidence |
| turn | current question, refinement, temporary focus |

Stable template and project layers should remain early and cacheable. Volatile
turn and evidence layers should remain later and bounded.

### Instruction admission

Only trusted typed abstractions may become constitutional instructions:

```text
canonical PolicyObject
  -> trusted renderer
  -> system/developer policy projection

raw repository or web text
  -> EvidenceArtifact
  -> never direct instruction authority

semantic review + valid authority
  -> candidate PolicyObject

World Manager admission
  -> canonical PolicyObject
  -> eligible for future trusted projection
```

An `AGENTS.md` file may be a repository-native instruction source and a policy
candidate. It is not automatically the canonical project-preference store.
Project policy should be available even when the worker never opens that file,
and its resolved discriminators should appear at a high-salience prompt layer.

## AgentInstantiation

```ts
type AgentInstantiation = {
  schema: "direct_agent_instantiation@1";

  agentInstantiationId: string;
  semanticEventId: string;

  roleTemplateRef: SourceRef;
  actorBindingRef: SourceRef;
  projectBindingRef: SourceRef;
  taskBindingRef: SourceRef;

  taskConstitutionRef: SourceRef;
  graphProjectionRef: SourceRef;
  authorityEnvelopeRef: SourceRef;
  capabilityEnvelopeRef: SourceRef;
  budgetRef?: SourceRef;
  evidenceAccessContractRef: SourceRef;
  completionEvaluatorRef: SourceRef;
  outputContractRef: SourceRef;

  promptProjectionRef: SourceRef;
  runtimeProfileRef: SourceRef;
  sourceScopeRevisions: ScopedWorldmodelRevisionRef[];
  manifestRef: SourceRef;
  status:
    | "compiled"
    | "active"
    | "paused_stale"
    | "completed"
    | "failed"
    | "revoked";
  digest: string;
};
```

```ts
type AgentInstantiationManifest = {
  schema: "direct_agent_instantiation_manifest@1";

  instanceId: string;
  roleTemplateId: string;
  roleTemplateRevision: number;
  actorBindingRef: SourceRef;
  projectBindingRef: SourceRef;
  taskBindingRef: SourceRef;

  worldstateRevisionRefs: ScopedWorldmodelRevisionRef[];
  policyClosureRef: SourceRef;
  exceptionRefs: SourceRef[];
  projectedObjectRefs: SourceRef[];

  promptDigest: string;
  capabilityDigest: string;
  authorityDigest: string;
  evaluatorDigest: string;
  outputContractDigest: string;
  compilerRevision: string;
  digest: string;
};
```

The manifest is the provenance witness answering:

```text
Who was instantiated?
In which semantic world?
Under which constitution?
What evidence could it access?
What could it physically do?
What effects was it authorized to produce?
What counted as completion?
Why did each policy apply?
```

## Compiler Invariants

### Authority attenuation

Capability and authority are different.

A child may receive a specialized mechanism that its parent does not directly
expose. It may not use that mechanism to produce effects outside the delegated
authority chain.

```text
PermittedEffects(child)
  subset_of DelegatedAuthority(parent)
  intersection TaskConstitution
  intersection ActiveExceptions
```

For example:

```text
capability:
  shell

permitted effects:
  inspect, edit, test, local commit

forbidden effects:
  remote mutation
```

### Projection agreement

All projections of one constitution must agree.

```text
prompt says local only
capability layer permits unmediated remote mutation
  -> invalid compilation
```

The harness should refuse instantiation when it can prove a contradiction.

Enforcement must be labeled honestly:

```text
causally_enforced
approval_enforced
postcondition_checked
prompt_governed
audit_only
```

If unrestricted shell/network can still produce a prohibited effect, the
system must not describe that prohibition as causally enforced.

### Dependency-sensitive staleness

An instantiation is valid against the specific semantic dependencies from which
it was compiled.

```text
relevant governing dependency changes
  -> pause, recompile, or prove compatibility
```

An unrelated Project C update should not invalidate Project B work.

Immediate suspension classes include:

```text
authority revocation
new hard prohibition affecting possible effects
contract cancellation
project archival
budget exhaustion
terminal-goal contradiction
```

Compatible or deferred classes may include:

```text
unrelated project update
additional non-governing evidence
future-roadmap candidate
historical-only change
```

### Evidence cannot promote itself

```text
untrusted evidence
  may change epistemic state after interpretation

trusted admitted policy
  may change deontic state after valid admission
```

Norm-shaped text encountered in a repository is still evidence. It becomes a
binding norm only through a valid semantic and authority transition.

## Completion And Constitutional Success

Completion is not merely a model claim and not merely passing tests.

```text
task outcome
+ required evidence
+ policy compliance
+ completion evaluator
+ closure report
= constitutionally valid completion
```

For a local-only project:

```text
implementation complete
tests pass
local commit created
no remote mutation occurred
  -> constitutionally valid completion
```

If the implementation works but the worker pushed remotely, the task is not
successfully complete under that task world.

The same task constitution used to compile the prompt and capabilities must
also govern completion evaluation.

## UX Doctrine: Organism-Shaped System

At the normal experiential level, the user encounters one coherent body:

```text
one conversation
one voice channel
one persistent relationship
one visible stream of actions and results
```

Internal multiplicity should not be imposed merely because it exists.

The system should remain one without pretending to be simple:

```text
bad extreme:
  expose every internal agent and make the user manage an agent bureaucracy

bad extreme:
  hide all differentiation behind one fictional personality that appears to
  own every interpretation, decision, action, and authority transition

target:
  experientially unified
  internally differentiated
  transparently inspectable
```

The organism analogy is a UX projection, not a claim that the architecture
must imitate biology.

```text
unified communications surface:
  skin and voice

World Manager:
  constitutional nervous system

Project Managers:
  functional reasoning organs

workers:
  recruited muscle groups and local processes

canonical worldstate:
  persistent organism-wide state and memory

E ledger:
  sensory and diagnostic system

D runtime:
  inhibitory, regulatory, and immune architecture

U hierarchy:
  active drives and coordinated goals
```

Unlike a biological organism, this system can expose its semantic anatomy while
continuing to act as one body.

## Progressive Semantic Transparency

The default surface remains calm. Depth appears in response to a concrete
epistemic need.

| Depth | Primary question |
| --- | --- |
| unified outcome | What happened, and what needs me? |
| provenance | Which role formulated or performed this? |
| governance | Why was it routed, permitted, blocked, or admitted? |
| compiled agent | In what bounded agent-world did it occur? |
| execution | What delegated work and evidence produced it? |
| substrate | Which files, calls, logs, and measurements witness it? |

Example:

```text
surface:
  "Here is the proposed plan. Two decisions need approval."

provenance:
  formulated by Direct Runtime Project Manager
  routed by World Manager
  candidate proposal, not canonical

governance:
  classified as Direct Runtime / project planning
  policy closure 91 applied
  World Manager owns admission

compiled agent:
  role template
  project and task bindings
  task constitution
  capability envelope
  budget
  completion contract

execution:
  delegated WorkThreads
  evidence acquired
  closure reports

substrate:
  files
  commits
  tool calls
  logs
  runtime measurements
```

Semantic zoom must be object-centered. The user opens the anatomy of one
response, proposal, decision, action, or result. The application should not
require a global switch into a separate expert product.

Depth law:

```text
depth adds causal and constitutional structure
depth does not replace or contradict the visible event
```

Inspectable depth exposes stable typed objects:

```text
routing decision
role assignment
policy-resolution trace
PlanProposal
authorization request
ImplementationContract
AgentInstantiationManifest
evidence report
worldstate delta
closure witness
```

It does not expose private chain-of-thought or a noisy dump of transient model
state.

## Unified Chat Presentation

The conversation is multiplexed while provenance remains explicit.

Default response:

```text
Direct Runtime · Project Manager

Here is the proposed five-feature plan. Two decisions need your approval.

Plan proposal v3 · Candidate
```

The `Direct Runtime · Project Manager` marker may remain visually restrained at
the default depth. Expanding it reveals:

```text
formulated by:
  Direct Runtime Project Manager

routed by:
  World Manager semantic router

task classification:
  project planning

applicable constitution:
  planning constitution v4

admission status:
  candidate
```

The composer stays unified. It may expose an optional current scope:

```text
Global
Direct Runtime
Voice Bridge
```

Scope selection is a routing constraint, not permission to bypass the World
Manager. Ordinary routing should infer scope when confidence is sufficient.

Natural-language inspection is first-class:

```text
"Why did you interpret that as project planning?"
  -> open routing witness

"Why was remote Git unavailable?"
  -> open inherited policy closure and enforcement posture

"What did the reviewer inspect?"
  -> open evidence and closure artifacts
```

The World Manager should answer from typed witnesses, not invent a post-hoc
rationale.

## Minimal-By-Default Surface

The minimal profile should show:

```text
persistent unified conversation
quiet global posture
current project context
pending decisions
ongoing actions and results
small indications that other projects remain alive
```

It should not show every policy, worker, tool call, graph relation, or project
metric by default.

The global posture surface may initially reduce to:

```text
current horizon
focused project
active-background project count
pending decisions
material worldstate conflict or risk
```

Project depth states:

### Full active

Used when the user is inspecting or interacting deeply with one project.

```text
project identity and goal
current plan/contract
Project Manager responses inside the unified conversation
decisions
evidence and semantic artifacts
active WorkThreads
project-scoped worldstate posture
```

The full project surface may alter the composer's explicit scope and reveal
project evidence. It does not need to create a separate default chat.

### Semi-active

Used when a project remains inside a larger active period but is not the current
focus.

```text
project goal/phase
milestone posture
current background operation
elapsed time
latest semantic action
blocker or decision count
small truthful activity pulse
```

The worker peek should answer `what is happening?`, not expose the entire child
transcript.

### Inactive

Used for parked, dormant, archived, or otherwise non-current projects.

```text
project identity
lifecycle posture
last meaningful activity
one or two durable project metrics
open unresolved decision count
```

Inactive must not look failed, deleted, or unhealthy merely because it is not
active.

Attention level is communicated through geometry and disclosure:

```text
full active:
  conversation + evidence + decisions + controls

semi-active:
  live posture + current operation + semantic peek

inactive:
  durable summary only
```

Activity is not success. Focus is not authority. Validated is not canonical.

## Voice

Voice is another transport into the same communications plane.

```text
spoken input
  -> normalized ingress evidence
  -> World Manager semantic settlement and routing
  -> selected role formulates response
  -> unified voice delivers response
  -> provenance remains inspectable on screen
```

The user may hear one consistent system voice even when a Project Manager
formulated the response.

```text
delivered through:
  unified system voice

formulated by:
  Direct Runtime Project Manager

routed by:
  World Manager

admitted by:
  World Manager or owning scoped commit controller
```

Voice transport, provider entitlement, or app-server availability does not
grant canonical worldstate authority. Provider/app-server events must enter the
Direct-owned semantic plane as normalized evidence and typed results.

## Morphic UX Bundle

### Run stance

```yaml
task_mode: design
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: not_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: world_manager_progressive_semantic_transparency_v0
  profile_status: proposed_local
```

### Source pack

Doctrine sources:

- Morphic UX frontend skill.
- Borrowed `artifact_inspector_advisory_workbench` reference family.

Host sources:

- [Direct Wave 26](./DIRECT_WAVE26_HIERARCHICAL_WORLDMODEL_PROJECT_MANAGER_SPEC.md)
- [Worldmodel Manager And Authorization](./DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md)
- [Context Policy And Pack](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [Obligation Projection And Tool Context](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- `src/main/direct/worldmodel/manager-context-runtime.js`
- `src/main/direct/worldmodel/semantic-ingress.js`
- `src/main/direct/worldmodel/project-memory-propagation.js`

Visual sources:

- [Atlas Workbench](./assets/world-manager-ux/atlas-workbench.png)
- [Project Constellation](./assets/world-manager-ux/project-constellation.png)
- [Editorial Cockpit](./assets/world-manager-ux/editorial-cockpit.png)
- [Minimal unified planning storyboard](./assets/world-manager-ux/storyboard/README.md)

Runtime observations:

- None for this design pass.

### UX domain packet

```text
primary user:
  expert operator who may sometimes prefer casual/result-only interaction

device:
  desktop Electron surface

risk:
  high when actions mutate repositories, external systems, policy, or
  canonical worldstate

trust sensitivity:
  authority, provenance, semantic admission, and evidence sensitive

utility ranking:
  coherent relationship
  low default cognitive load
  truthful causal inspectability
  decision quality
  operator speed
```

### Invariants

```text
one persistent communications relationship
one semantic lineage through all inspection depths
typed provenance for responses and actions
candidate, validated, admitted/canonical, stale, and conflicted remain distinct
evidence remains same-context reachable before admission or destructive action
advisory proposal and authoritative admission remain separate
project/worker activity never implies success or authority
UI may expose but may not mint authority
raw evidence never promotes itself into system instruction
private reasoning is not an inspection surface
```

### Morphable choices

```text
left/right proportions
global posture visualization
project-card versus project-rail arrangement
dark, light, or hybrid visual language
project focus expansion behavior
provenance disclosure affordance
timeline versus graph presentation
exact inactive-project density
```

### Derivative morph axes

```yaml
density: low_by_default_progressive
navigation_mode: simultaneous_context_with_object_centered_focus
information_posture: outcome_first_with_evidence_drilldown
interaction_tempo: conversational_fast_path_with_governed_review
salience_posture: conversation_decisions_and_status_prominent
state_exposure: progressive_explicit
command_posture: safe_buffered_dual_lane
```

These values form a proposed local derivative. They are not claimed as an
approved profile in the borrowed reference family.

### Region and lane map

```text
bounded World Manager workbench
├─ unified communications region
│  ├─ world-posture lane
│  ├─ conversation lane
│  ├─ semantic-artifact lane
│  └─ unified composer / transition-request lane
│
├─ project awareness region
│  ├─ focused-project lane
│  ├─ semi-active periphery lane
│  └─ inactive-project index lane
│
└─ semantic anatomy region
   ├─ provenance lane
   ├─ governance lane
   ├─ agent-instantiation lane
   ├─ execution/evidence lane
   └─ substrate witness lane
```

The anatomy region is normally collapsed into object-level lineage affordances.
It expands in the same bounded workbench rather than forcing a detached
diagnostics application.

### Action clusters

```text
advisory:
  ask, refine, compare, inspect lineage, request options

admission:
  approve candidate, remand, defer, reject, supersede

execution:
  start contract, pause, resume, cancel, request exception

destructive/external:
  project policy mutation, remote publication, destructive workspace or
  external-system action
```

Admission and destructive clusters must be visibly later than proposal and
evidence review.

### State surfaces

```text
candidate / proposed:
  visible as provisional

validated:
  evidence-backed but not canonical

canonical / admitted:
  materially distinct and tied to an admission witness

stale:
  indicates dependency revision mismatch

conflicted / ambiguous:
  never styled as success

executing:
  activity posture only

completed:
  tied to completion evaluator and closure witness
```

### Evidence-before-commit

Before admitting a plan or policy, the same bounded workbench must provide:

```text
the exact candidate artifact
material supporting evidence
scope and authority posture
applicable policy/conflict summary
expected worldstate delta
affected projects or contracts
```

The user may expand deeper evidence without losing the candidate and admission
action being evaluated.

### Responsive preservation

Desktop is primary. Narrow projections may stack:

```text
conversation
  -> focused project
  -> project periphery
  -> expanded semantic anatomy
```

The unified composer, current scope, admission posture, and required evidence
must remain reachable without a route transition. Primary evidence may use
bounded focus expansion over lower-priority project periphery when the total
workbench can display its minimal geometry.

## Visual Reference Disposition

The three exploratory mockups are retained as topology references, not approved
implementation designs:

```text
Atlas Workbench:
  strongest simultaneous status visibility
  too information-dense for the default target

Project Constellation:
  strongest visible World Manager centrality
  useful lighter visual language

Editorial Cockpit:
  strongest active/semi-active/inactive project topology
  closest structural ancestor for a future minimal variant
```

The next visual exploration should combine:

```text
Editorial Cockpit topology
+ Project Constellation calmness
+ substantially lower default information density
+ dominant unified communications surface
+ object-centered semantic zoom
```

That exploration is now represented by the
[six-frame minimal unified planning storyboard](./assets/world-manager-ux/storyboard/README.md).
It remains an exploratory reference rather than an approved implementation
surface.

## Interaction Contracts

### Ordinary routed response

```text
precondition:
  current input is durably captured

event:
  user sends message

visible consequence:
  message appears once in unified conversation
  route/scope state becomes inspectable

semantic consequence:
  TaskSettlement selects role and world slice
  AgentInstantiation is compiled
  response returns through AgentResult
```

### Plan refinement

```text
precondition:
  candidate PlanProposal exists

event:
  user requests refinement

visible consequence:
  owning Project Manager responds in the same conversation
  proposal revision changes visibly

semantic consequence:
  old proposal remains provenance
  new proposal supersedes or refines it as candidate
```

### Plan admission

```text
precondition:
  candidate, material evidence, scope, and authority are visible

event:
  user greenlights the plan

visible consequence:
  World Manager reports admission or requests clarification

semantic consequence:
  plan becomes canonical only after valid admission
  ImplementationContract is persisted and linked
```

### Policy establishment

```text
precondition:
  user and World Manager have settled meaning, scope, force, inheritance, and
  exception posture

event:
  user confirms standing policy

visible consequence:
  policy candidate and effective scope are shown

semantic consequence:
  valid authority admits PolicyObject
  future tasks inherit it mechanically
```

Hard standing policy should require deliberate confirmation appropriate to its
force. A casual `yes` must not silently become constitutional authority when
multiple pending decisions exist.

### Scope/effect transition

```text
current task:
  inspect repository

new request:
  publish result

visible consequence:
  remote-effect boundary and governing policy appear

semantic consequence:
  task constitution is re-settled
  stale instance pauses or is replaced
  exception/authority route is resolved before effect
```

### Why inspection

```text
event:
  user asks why a route, policy, restriction, or admission occurred

visible consequence:
  corresponding typed witness opens beside the original event

semantic consequence:
  none by default; inspection does not mutate authority or worldstate
```

## Direct And App-Server Boundary

The Direct path owns:

```text
canonical worldstate
semantic admission
policy objects and closure
task constitutions
agent-instantiation manifests
context selection semantics
completion relay
event lineage
UX truth projection
```

App-server/provider paths may supply capabilities Direct cannot yet reproduce,
including provider-entitled voice transport. Their outputs enter as:

```text
normalized ingress evidence
provider/runtime evidence
typed AgentResult or capability result candidates
```

They do not become an alternative canonical worldstate writer.

Host-native capabilities such as browser or computer control may later be
implemented through Direct-owned plugins/helpers. Their host location does not
change the same semantic and authority laws.

## Failure And Remand Conditions

Instantiation or action must fail, pause, or remand when:

```text
project/task settlement remains materially ambiguous
policy closure is conflicted
authority and capability projections disagree
required evidence is unavailable
governing revision is materially stale
hard policy cannot be enforced as claimed
an exception lacks valid authority or scope
completion evaluator cannot inspect required witnesses
one event's inspection layers resolve to incompatible canonical identities
```

The renderer must not repair these states cosmetically.

## Non-Goals

This spec does not authorize:

```text
implementation during the design phase
one omniscient undifferentiated assistant persona
mandatory direct chat with every worker
raw chain-of-thought inspection
automatic promotion of final assistant text to canonical truth
free-form model-authored system prompts
raw worldstate or full graph injection into every prompt
ambient cross-project access
silent standing-policy creation from casual conversation
capability expansion from role labels
hard-enforcement claims when only prompt instruction exists
one separate expert product or detached diagnostics application
biological aesthetics or a literal body-shaped UI
```

## Future Implementation Sequence

This is sequencing guidance, not an authorization to implement.

The implementation-ready decomposition, persistence boundaries, IPC contracts,
failure behavior, and first end-to-end keyboard acceptance game are defined in
the
[keyboard pipeline integration spec](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md).

### Stage 1: Semantic completion relay

```text
SemanticEvent
AgentResult
final-message anchor + deterministic telemetry separation
World Manager semantic inbox
candidate registration and visible reconciliation status
```

### Stage 2: Policy and settlement compiler

```text
PolicyObject
PolicyException
TaskSettlement
ResolvedTaskConstitution
mechanical closure and conflict witness
minimal prompt discriminator projection
```

### Stage 3: Agent-world compiler

```text
trusted role templates
AgentInstantiation
AgentInstantiationManifest
projection-agreement checks
dependency-sensitive staleness
completion evaluator and return contract
```

### Stage 4: Minimal unified UX

```text
persistent World Manager communications plane
quiet world posture
active/semi-active/inactive project projections
typed proposal and decision artifacts
object-centered semantic zoom
same-context evidence and admission
```

### Stage 5: Voice and heterogeneous runtime adapters

```text
voice as unified ingress/egress transport
app-server capability adapter
Direct canonical semantic relay
Windows/WSL/host execution profiles
one event lineage across runtime paths
```

## Acceptance Scenarios For Future Work

The target is not accepted until at least these games pass.

### Unified project planning

1. User asks in the unified conversation for five project features.
2. The owning Project Manager formulates the response.
3. The response renders with restrained provenance.
4. The World Manager concurrently registers a candidate proposal.
5. Refinements create linked versions.
6. Greenlight produces an admitted plan and ImplementationContract.
7. The same lineage remains inspectable at every step.

### Mechanical project-policy inheritance

1. Project B has an admitted local-only policy.
2. A new implementation task is classified as Project B / task type C.
3. The harness computes the effective constitution without re-reasoning the
   standing policy.
4. Prompt, capabilities, approval gates, and evaluator agree.
5. The run manifest proves which revision applied.

### Narrow exception

1. A task requests one remote branch push.
2. The standing policy blocks it.
3. The user grants a one-action project-scoped exception.
4. Pull-request creation remains forbidden.
5. The exception expires after use.
6. The parent policy remains active.

### Staleness

1. An active worker was compiled against Project B policy revision 10.
2. Revision 11 revokes a relevant authority.
3. The worker pauses before the affected effect.
4. An unrelated Project C update does not pause it.

### Semantic transparency

1. A calm surface reports one plan result.
2. Provenance opens without route replacement.
3. Governance opens from the same semantic event.
4. Agent instantiation, execution, and substrate witnesses retain the same
   lineage id.
5. No layer exposes private chain-of-thought.

### Voice parity

1. Spoken and typed versions of the same request settle to equivalent task
   ontology.
2. A Project Manager may formulate the response.
3. One system voice may deliver it.
4. On-screen provenance remains truthful.
5. Voice/app-server transport never gains worldstate admission authority.

## Final Architecture

```text
human intention
  -> unified World Manager communications plane
  -> semantic ingress and task settlement
  -> mechanical policy inheritance
  -> ResolvedTaskConstitution
  -> AgentInstantiation compiler
     ├─ role/system-prompt projection
     ├─ authority and capability envelope
     ├─ evidence-access contract
     ├─ budget controller
     ├─ completion evaluator
     └─ AgentResult return contract
  -> Project Manager / Thread Manager / worker cognition and action
  -> user-facing response + typed semantic result
  -> immediate unified presentation
  -> parallel World Manager reconciliation
  -> candidate / admit / remand / reject / supersede
  -> canonical worldstate and implementation lineage
  -> progressive semantic transparency over the same event
```

Compactly:

```text
one body at the surface
one canonical semantic lineage
many bounded reasoning organs
one governed worldstate
```
