# Direct WorldManager Semantic Context, ARO, And Thought Tools Design

Status: design doctrine with `WM-SC1` through `WM-SC10` implemented and
regression-proven locally, including semantic ingress, versioned semantic
history, split child orchestration, truthful partial closure, the semantic
artifact/decision kernel, operational semantic-context import, governed
decision transitions, the versioned semantic-surface compiler, and the first
durable Abstract Reasoning Object registry/reconstruction pipeline plus its
automatic repository-initialization producer, and the first bounded ARO
current-to-target definition bridge, mutation-contract compiler, bounded
read-only realization-context mapping bridge, single-use native Direct worker
handoff, exact realization-evidence acquisition, semantic verification, drift
assessment, non-canonical closure candidacy, and generated scoped decisions.
`WM-SC9` adds the trusted thought-brush registry, append-only reversible
ContextCanvas, normal ARO-candidate extraction, and a focused temporary
semantic workbench. `WM-SC10` adds the complete unified operational ribbon,
object-centered six-depth semantic anatomy, same-event identity law,
same-context evidence gates, and modality-neutral typed interaction
contracts. Live voice transport remains a separate governed frontier. The
role-governed ledger, artifact lifecycle, audit-routing, and canonical
admission architecture is now specified as
[WM-SC11](./DIRECT_WORLD_MANAGER_EPISTEMIC_LEDGER_AND_SEMANTIC_CI_SPEC.md), but
is not implemented by this document.

Date: 2026-07-31.

Parent doctrine:

- [Direct World Manager Agent-World And Unified UX Spec](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md)
- [Direct WorldManager Keyboard Pipeline Integration Spec](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md)

Related implemented and design substrates:

- [Direct WorldManager Epistemic Ledger And Semantic CI Spec](./DIRECT_WORLD_MANAGER_EPISTEMIC_LEDGER_AND_SEMANTIC_CI_SPEC.md)
- [Direct WorldManager Project Genesis And Substrate Constitution](./DIRECT_WORLD_MANAGER_PROJECT_GENESIS_AND_SUBSTRATE_SPEC.md)
- [Direct Context Policy And Pack Spec](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [Direct Obligation Projection And Tool Context Spec](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [Direct WorldManager Semantic Mockup](./DIRECT_WORLD_MANAGER_SEMANTIC_MOCKUP.md)

This design makes five corrections and extensions:

```text
natural-language lane membership is settled semantically, not with phrase lists
chat history is preserved as raw evidence but retrieved through semantic history
context is an explicit epistemic tool
code is treated as a realization of Abstract Reasoning Objects
creativity is exposed through governed thought-paint operators
```

## Root Doctrine

Standing formulations:

> Predefine the semantic lanes, not the phrases that instantiate them.

> Time identifies when an interaction occurred. Chat identity identifies where
> it was transported. Semantic lineage identifies which history it belongs to.

> Attention is a scheduled resource. Context is the tool that schedules meaning
> into attention.

> Reason over the abstract object; mutate its realization; verify that the
> realization now witnesses the intended object.

> Code paths describe what the implementation currently distinguishes. ARO
> branches describe what reality requires the system to distinguish.

> The semantic graph supplies the space. Context tools supply the brushes.
> Operational meta-context is the canvas. Admission determines which results
> become part of the world.

The combined architecture is:

```text
raw interaction evidence
  -> WorldManager semantic settlement
  -> versioned semantic-history relations
  -> mechanically materialized semantic shelves
  -> task-bounded context imports
  -> operational meta-context
  -> ARO-centered reasoning
  -> realization inspection and mutation when required
  -> runtime and semantic verification
  -> candidate insight or worldstate delta
  -> governed admission
```

Semantic work should be performed when a real semantic boundary is crossed.
Once an abstract relation has been settled, its routine consequences should be
propagated mechanically.

## Current Repo-Grounded Boundary

The current implementation now provides the semantic-ingress root, versioned
semantic-history catalog, semantic artifact/decision kernel, task-compiled
context import, governed decision transitions, and the initial versioned
semantic-surface compiler and durable ARO registry/reconstruction kernel over
the earlier WorldManager pipeline substrate. It does not yet provide
ARO-centered code mutation or thought-paint operators.

Implemented now:

```text
append-only WorldManager semantic-event ledger
durable user and assistant messages
K2 bounded settlement and routing
fixed provider-backed WorldManager semantic-ingress role
typed and persisted SemanticSettlement plus validation/run witness
semantic settlement mechanically adapted into K2 task/routing artifacts
explicit semantic failure/remand with no lexical fallback
durable semantic-child contracts and parent-child history relations
independent K2/K3/K4 execution for each split child
one evidence-grounded parent WorldManager join turn
distinct no-silent-terminal harness notices
versioned SemanticSettlementRevision records
versioned event-to-lane/project/task/object SemanticHistoryRelation records
append-only relation-state supersession
mechanically materialized and revisioned SemanticShelf projections
atomic shelf rebuild after semantic-history correction
generic SemanticArtifact headers and typed OpenDecision artifacts
typed options, dependencies, consequences, and resolution contracts
append-only semantic-artifact revisions and lifecycle state
idempotent migration of wm_decisions and manager openDecisions
direct project_open_decisions shelf membership
task-compiled ContextRequirementSet and read-only IMPORT_CONTEXT materialization
SemanticContextBundle and OperationalMetaContextManifest lineage
expected-revision and idempotency-gated decision transitions
exact semantic-region binding on decision and project-genesis requests
versioned O/E/D/U SemanticLensProjection and projection witnesses
versioned MorphResolver registry and compiled semantic object surfaces
inline semantic artifacts, global Decision Dock, and project indicators
compiled OpenDecision, ProjectConstitutionCandidate, ProjectConstitution, and
DecisionTransitionReceipt projections
append-only ARO reconstruction candidates, review receipts, canonical ARO
revisions, admission receipts, and realization-freshness revisions
substrate-native bounded repository semantic snapshots with digest idempotency
append-only scheduled/running/completed/remanded/failed reconstruction runs
automatic project-bootstrap Direct reconstruction and exact-run retry
append-only exact-comparison ARO mutation contracts and compilation runs
mechanically derived target/current/conflict/coverage-gap mutation deltas
open-vocabulary implementation, preservation, and verification obligations
exact-region-bound compile/retry with restart recovery and no execution effects
substrate-native bounded realization-context import selected from exact ARO refs
immutable context imports and append-only realization-mapping run revisions
required Direct obligation-to-file/symbol/range semantic mapping discharge
deterministic exact-obligation/evidence/range revalidation at store admission
candidate mapping witnesses with ambiguity, omission, and freshness posture
source-identity-only renderer projection with backend-only source excerpts
immutable reviewed worker constitutions and single-use start authorizations
exact ARO WorkThread plus native Direct implementation-worker handoff
per-call read, patch, and command authority retained after worker start
required, possible, and counterfactual ARO branches plus typed semantic edges
many-to-many source/test/documentation/runtime realization bindings
branch-level coverage witnesses and current/target comparison projections
exact-region-bound ARO review and semantic-registry-only admission
live ARO comparison, intensional tree, and realization graph morphs
provisional reconstruction of legacy K2-only settlements
bounded semantic-history evidence for system-introspection turns
graph-first manager context
policy and agent-world compilation
persisted Direct role turns and typed AgentResults
semantic inbox and WorldManager reconciliation
project-genesis candidate and admission
context packs and request manifests for existing Direct paths
minimal unified WorldManager workbench and semantic zoom
```

Current limitations after `WM-SC8.4`:

```text
semantic-history selection
  now uses active relations and materialized shelves
  provides one bounded multi-turn introspection horizon
  now compiles typed ContextRequirementSet and read-only IMPORT_CONTEXT results
  remains harness-scheduled rather than a free-standing worker capability

semantic ingress
  selects one root meta-contract and persists its semantic discharge
  preserves proposed, composite, free-form, and unresolved types
  materializes split/mixed meanings as bounded semantic child contracts
  prevents recursive split discharge inside a child contract
  executes child constitutions independently and joins their outcomes once
  can request bounded semantic-history evidence

semantic decisions
  existing clarification and project-admission rows remain as operational
  compatibility bridges
  their semantic identities and manager open decisions are canonical typed
  artifacts with governed SC5 transition requests and append-only receipts
  transitions revise semantic decision state only and perform no downstream
  project effect

existing worldmodel graph
  does not yet promote the ARO registry into the hierarchical worldmodel graph
  ARO state is durable and canonical in its dedicated append-only registry
  repository initialization now schedules a bounded semantic reconstruction
  producer once per configured project and repository snapshot digest
  repository-change observation is bootstrap/retry driven rather than a
  continuous filesystem watcher

existing renderer
  consumes compiled O/E/D/U surfaces for decisions, project genesis,
  constitutions, and transition receipts
  preserves exact object identity across inline artifacts, Decision Dock,
  project indicators, inspectors, and responsive layouts
  maps current objects to binary, choice, comparison, scoped-composer,
  status-card, ARO tree, and realization-graph morphs
  exposes candidate evidence/contradictions, current/target deltas, canonical
  AROs, and coverage without allowing the UI to author reconstruction meaning
  now exposes provisional ARO mutation contracts inside the exact focused
  current/target comparison
  now exposes bounded source identity and obligation-to-file/symbol/range
  mapping witnesses without projecting imported source excerpts
  now exposes reviewed worker constitution, single-use start authority,
  native worker lineage, and independently gated tool requests
  does not yet expose accumulated runtime verification, semantic closure, or
  thought brushes
```

The old K2/K4 lexical classifier has been removed from production settlement.
Natural-language contract selection now comes only from the fixed WorldManager
semantic-ingress constitution. Exact action form, typed controls, identifiers,
scope constraints, and authority boundaries remain mechanically validated
after semantic interpretation. Semantic content is not reverse-validated
against a closed lane or subtype enumeration.

Examples such as `hey`, `:)`, `tell me a joke`, or `my invoices are eating my
life` belong in regression corpora or deterministic test fixtures. They do not
appear as production category definitions.

## Core Ontology

This design distinguishes the following objects.

### InteractionEvent

Immutable evidence of what occurred:

```text
message and turn identity
chat / thread / transport identity
time
user and assistant payload refs
tool-call and runtime evidence refs
source substrate
digest and lineage
```

### SemanticSettlement

The WorldManager's typed, inspectable judgment about what an utterance means in
the current world:

```text
speech act
semantic lane or lanes
scope and referents
task type
likely effect classes
responsible role
ambiguity posture
continuation disposition
```

The settlement is an epistemic and routing object. It grants no mutation,
admission, publication, or external-effect authority.

### SemanticHistoryRelation

A versioned relation between an event and one or more semantic histories:

```text
turn -> Project X planning lineage
turn -> conversational relationship
turn -> Policy Y revision history
turn -> ARO Z reconstruction evidence
turn -> WorkThread Q execution lineage
```

### SemanticShelf

A mechanically materialized, revisioned projection over semantic-history
relations. A shelf is not an exclusive folder and does not own the raw event.

Examples:

```text
Project X durable history
Project X open decisions
current implementation lineage
accepted user policies
conversational continuity
system-governance history
ARO reconstruction evidence
cross-project analogues
```

### ContextImport

An explicit read operation that selects, bounds, and materializes semantic
content for one agent instantiation or turn.

### OperationalMetaContext

The composite active hot memory inside which the agent currently reasons:

```text
compiled constitution
current user intent
active semantic settlement
task and completion contract
resolved policy closure
imported context bundles
active ARO view
current evidence and working artifacts
attention and output budget
```

It is not synonymous with a chat transcript.

### AbstractReasoningObject

A typed semantic object that represents the intensional demands a system,
feature, component, policy, or interaction must fulfill.

### Realization

A concrete substrate that attempts to instantiate an ARO:

```text
source code
schemas
tests
runtime processes
database structures
UI surfaces
operational procedures
```

### ThoughtBrush

A typed operator over semantic space that changes the agent's temporary
ContextCanvas without directly mutating canonical worldstate.

## WorldManager Semantic Ingress

### Semantic closure

The ingress constitution should close the full interaction space
intensionally:

```text
For every user utterance:
  interpret its meaning, speech act, referents, intended scope, and effects
  settle it into one or more applicable semantic lanes
  answer, delegate, split, clarify, or remand according to those lanes
```

This is complete as a governing contract without extensionally enumerating all
possible utterances.

The contract can fully govern the decision space without guaranteeing that
every judgment is correct. Misclassification remains possible and must be
correctable through versioned settlement evidence.

### Root ingress constitution

The fixed WorldManager system constitution should include an instruction
equivalent to:

```text
You are the semantic ingress for one unified communications plane.

Interpret every natural-language utterance according to its meaning, speech
act, referents, current discourse, intended scope, and intended effects.

Select exactly one native semantic discharge action. Its name selects the
applicable top-level meta-contract. Discharge the semantic dimensions required
by that contract through open type expressions. Ambient UI focus, open
projects, and recent activity are contextual evidence, not binding scope.

If the utterance contains a credible seed for a new durable project, apply the
Project Genesis contract. If it concerns an existing project, select the
appropriate project lane and role. If it is ordinary conversation, respond
conversationally without manufacturing project scope or effects.

When materially ambiguous, select the clarification action and state the
unresolved dimensions. When an utterance contains independently actionable
meanings, select the split action and express its child contracts.

The action arguments are a semantic discharge, not the user-facing answer. A
downstream role formulates that answer naturally. Do not claim that discharge
grants authority for canonical or external effects.
```

The exact prompt remains a trusted versioned artifact. The prose above defines
its semantic obligations, not its final provider serialization.

The operative law is:

```text
closed action form
+ open semantic content
+ mechanical reference/authority checks
+ no reverse semantic-enum validation
```

`SemanticTypeExpression` supports an exact existing type reference, a proposed
new type with differentia, a composite, a free-form characterization, or an
unresolved distinction. Novelty is representable content, not a schema error.

### Meta-lane ontology

The initial lane registry should include:

```text
conversation
  social, relational, playful, or general conversational interaction

world_governance
  user-wide priorities, policies, portfolios, budgets, or cross-project issues

project_genesis
  an idea that may establish a new durable project

project_deliberation
  planning, design, prioritization, review, or decisions for an existing project

project_execution_request
  a request that may produce operational or substrate effects

epistemic_inquiry
  requests for facts, explanations, status, evidence, or diagnosis

system_introspection
  questions about routing, authority, context, evidence, or system behavior

mixed
  an utterance containing separable assignments to multiple lanes
```

The registry is versioned and extensible. Lane definitions are semantic
contracts. They are not regular expressions.

Task types, action classes, effect classes, and responsible roles remain
separate dimensions. For example:

```text
lane:
  epistemic_inquiry

scope:
  Project X

task type:
  implementation_audit

effects:
  read_only_evidence

responsible role:
  Project Manager or auditor
```

### Semantic discharge and settlement adapter

```ts
type SemanticTypeExpression = {
  mode:
    | "existing_ref"
    | "proposed_type"
    | "composite"
    | "freeform"
    | "unresolved";
  existingTypeRef: string;
  proposedLabel: string;
  parentTypeRef: string;
  differentia: string;
  components: string[];
  freeformCharacterization: string;
};

type WorldManagerSemanticDischarge = {
  schema: "direct_world_manager_semantic_discharge@1";

  semanticDischargeId: string;
  semanticEventId: string;
  actionName:
    | "wm_discharge_world_conversation"
    | "wm_discharge_world_introspection"
    | "wm_discharge_project_ecology_concern"
    | "wm_discharge_project_concern"
    | "wm_discharge_project_genesis"
    | "wm_discharge_clarification"
    | "wm_discharge_split";

  // The selected action owns an option-specific semantic contract.
  // Its fields may contain zero or more open type expressions.
  arguments: Record<string, unknown>;
  typeExpressions: Array<{
    path: string;
    expression: SemanticTypeExpression;
  }>;

  semanticContentPosture: "open";
  grantsAuthority: false;
  createdAt: string;
  digest: string;
};

type WorldManagerSemanticSettlementAdapter = {
  schema: "direct_world_manager_semantic_settlement@2";

  semanticSettlementId: string;
  semanticEventId: string;
  ingressMessageRef: SourceRef;
  worldBindingRef: SourceRef;
  semanticDischargeRef?: SourceRef;

  settlementState:
    | "settled"
    | "clarification_required"
    | "remanded";

  // Compatibility dimensions mechanically derived for K2/K3/K4.
  laneAssignments: Array<Record<string, unknown>>;
  taskTypes: [
    | "world_conversation"
    | "project_ecology_status"
    | "cross_project_comparison"
    | "portfolio_planning"
    | "project_initialization"
    | "policy_discussion"
    | "project_planning"
    | "implementation_request"
    | "project_review"
    | "project_discussion"
  ];
  actionClasses: string[];
  effectClasses: string[];
  semanticTypeExpressions: Array<{
    path: string;
    expression: SemanticTypeExpression;
  }>;

  grantsAuthority: false;
  createdAt: string;
  compilerVersion: string;
  digest: string;
};
```

The native action call is not the user-facing answer. The current K4 adapter
uses it to compile and invoke the responsible WorldManager or Project Manager,
which then responds naturally. JSON typing therefore governs the database
discharge and compatibility adapter, not the prose content of the answer.

The seven action names are deliberately finite because they are top-level
coordination forms. Their semantic dimensions are not finite. A project concern
may select a finite K2 operational adapter while proposing a concern subtype
the worldstate has never seen before. The harness persists that subtype instead
of remanding it as an unknown enum member.

`wm_discharge_project_ecology_concern` separates authority scope from subject
scope. A status, comparison, or planning request about several projects remains
governed at user-world scope; the named or mechanically resolved projects become
bounded secondary semantic subjects. It is neither collapsed into ordinary
world conversation nor falsely assigned to one project.

### Exact mechanical bindings

Semantic settlement does not eliminate deterministic machinery. It limits that
machinery to relations that are already exact.

Mechanical bindings may include:

```text
typed admission control carrying an exact candidate id
typed evidence-review control carrying an exact artifact id
exact project, proposal, or WorkThread refs
verified current graph revisions
capability and policy closures
typed effect and authority gates
```

Mechanical bindings may constrain semantic settlement but may not silently
decide the meaning of natural language.

Examples:

```text
ambient focused project:
  a contextual prior, not binding semantic scope

exact project scope selected by the user:
  a scope constraint, but not proof that every utterance concerns project work

typed "Admit candidate C" control:
  an exact transition request, not natural-language classification

natural-language "yes":
  still requires semantic resolution of the intended target
```

### No lexical-category rule

Production ingress must not use:

```text
greeting word lists
project-seed keyword lists
planning verb lists
implementation verb lists
review verb lists
emoji lists
regular expressions that claim semantic lane membership
```

Lexical parsing remains appropriate for purely syntactic protocols such as
validated IDs, command grammar, or schema discriminators. It is not appropriate
for deciding whether an utterance is conversational, project-shaped,
effectful, negated, hypothetical, humorous, or mixed.

### Failure posture

If the semantic ingress role is unavailable:

```text
do not guess a natural-language category with lexical fallback
preserve the user message
surface semantic_settlement_unavailable
offer a manual lane/scope constraint when useful
retry as a child event
create no project, policy, contract, or operational effect
```

## Raw Ledger And Semantic History

### The raw ledger remains immutable

Every interaction first enters the raw event ledger. Semantic interpretation
never rewrites the original message, time, chat identity, runtime evidence, or
assistant response.

```ts
type RawInteractionEvent = {
  schema: "direct_raw_interaction_event@1";
  eventId: string;
  chatId: string;
  threadId?: string;
  transport: string;
  occurredAt: string;
  actor: "user" | "assistant" | "harness" | "tool";
  payloadRef: SourceRef;
  parentEventRefs: SourceRef[];
  runtimeEvidenceRefs: SourceRef[];
  digest: string;
};
```

The existing WorldManager and Direct event stores may continue to own their
native evidence. `RawInteractionEvent` may be a normalized index over exact
refs rather than a duplicated payload store.

### Semantic history is relational

A turn is not physically moved from one chat into one shelf. Versioned
relations associate it with any semantic histories to which it contributes.

```ts
type SemanticHistoryRelation = {
  schema: "direct_semantic_history_relation@1";
  relationId: string;
  sourceEventRef: SourceRef;
  semanticSettlementRef: SourceRef;

  relationKind:
    | "belongs_to_lane"
    | "continues_task"
    | "concerns_project"
    | "proposes_object"
    | "revises_object"
    | "supersedes_object"
    | "provides_evidence_for"
    | "realizes_aro"
    | "verifies_aro"
    | "conversational_continuity";

  targetRef: SourceRef;
  posture: "primary" | "secondary";
  durability:
    | "ephemeral"
    | "episodic"
    | "candidate"
    | "canonical_ref";

  confidence: "high" | "derived" | "ambiguous";
  provenanceRefs: SourceRef[];
  settlementRevision: number;
  lifecycle: "active" | "superseded" | "remanded";
  digest: string;
};
```

One chat may contain many semantic histories. One semantic history may span
many chats, devices, transports, and substrates.

### Semantic shelves

Shelves are typed materialized views:

```ts
type SemanticShelf = {
  schema: "direct_semantic_shelf@1";
  shelfId: string;
  shelfKind: string;
  anchorRefs: SourceRef[];
  selectorPolicyRef: SourceRef;
  relationRefs: SourceRef[];
  sourceEventRefs: SourceRef[];
  semanticObjectRefs: SourceRef[];
  shelfRevision: number;
  freshness: "fresh" | "stale" | "rebuilding" | "blocked";
  omissions: Record<string, number>;
  sourceDigest: string;
  digest: string;
};
```

Initial shelf families:

```text
user_world_conversational_continuity
user_world_governance
user_world_project_ecology
project_durable_history
project_active_horizon
project_open_decisions
project_accepted_policies
project_execution_lineages
task_local_history
aro_definition_and_revision
aro_realization_evidence
cross_project_peer_objects
```

Shelf membership is derived from admitted semantic relations. It is not
re-derived from raw transcript text on every request.

`user_world_project_ecology` is the bounded global portfolio view. It contains
typed `ProjectStatus` projections and current open-decision references for
known configured projects, semantic project candidates, and admitted project
constitutions. It may include their `concerns_project` relations, but it does
not import project-private durable histories. Deeper inspection still requires
an explicit per-project context import.

### Settlement revision

Semantic settlement may be corrected:

```text
original raw event remains unchanged
new settlement revision supersedes the prior settlement
affected semantic-history relations are superseded
dependent shelves are invalidated and rebuilt
dependent cached context bundles become stale
prior context manifests remain immutable evidence of what an agent received
```

Corrections may come from:

```text
user correction
WorldManager reconciliation
conflicting later evidence
project or object identity merge
ontology revision
audited migration
```

### Legacy history ingestion

Existing chat histories are imported in two phases:

```text
phase 1:
  preserve exact raw chronology, chat identity, and payload refs

phase 2:
  produce candidate semantic settlements and relations
  record model/compiler version and confidence
  keep ambiguous assignments visibly provisional
```

Legacy semantic reconstruction must never pretend to have the authority or
certainty of a settlement made contemporaneously with the original turn.

## Context As A Tool

### Context acquisition law

Context is not an automatic transcript dump. It is an explicit, inspectable
epistemic operation.

```text
semantic settlement
  -> context need
  -> ContextImport request
  -> access and policy resolution
  -> shelf selection
  -> budgeted materialization
  -> ContextBundle
  -> operational meta-context update
```

The harness may issue standard imports mechanically after task and scope have
been settled. An agent may request additional imports when it discovers a new
relevant relation. Both paths produce the same typed tool evidence.

### Context import request

```ts
type SemanticContextImportRequest = {
  schema: "direct_semantic_context_import_request@1";
  contextImportId: string;
  semanticEventId: string;
  agentInstantiationRef: SourceRef;

  purpose:
    | "conversation"
    | "planning"
    | "execution"
    | "review"
    | "aro_reconstruction"
    | "thought_brush"
    | "verification";

  anchors: Array<{
    kind: "user_world" | "project" | "task" | "aro" | "artifact";
    ref: SourceRef;
  }>;

  shelfKinds: string[];
  relationKinds: string[];

  horizon: {
    temporal?: {
      latestTurns?: number;
      since?: string;
      until?: string;
    };
    abstractionAltitude?: string;
    evidenceDepth: "summary" | "semantic_objects" | "supporting_evidence";
  };

  budget: {
    maxInputTokens: number;
    maxObjects: number;
    reserveForCurrentTurn: number;
  };

  freshness:
    | "canonical_only"
    | "fresh_candidate_allowed"
    | "historical_exact";

  rawEvidencePolicy:
    | "refs_only"
    | "bounded_on_demand"
    | "explicit_raw_selection";

  grantsAuthority: false;
  digest: string;
};
```

### Context bundle

```ts
type SemanticContextBundle = {
  schema: "direct_semantic_context_bundle@1";
  contextBundleId: string;
  contextImportRef: SourceRef;
  semanticEventId: string;
  agentInstantiationRef: SourceRef;

  sourceWorldRevisions: SourceRef[];
  sourceShelfRefs: SourceRef[];
  sourceSettlementRefs: SourceRef[];

  content: {
    semanticObjects: Array<{
      objectRef: SourceRef;
      objectClass: string;
      authorityPosture:
        | "canonical"
        | "candidate"
        | "historical_evidence"
        | "reconstructed";
      boundedProjection: unknown;
    }>;
    relevantEvents: Array<{
      eventRef: SourceRef;
      semanticSummary: string;
      relationRefs: SourceRef[];
    }>;
    policyRefs: SourceRef[];
    openDecisionRefs: SourceRef[];
    aroRefs: SourceRef[];
    evidenceRefs: SourceRef[];
  };

  selectionWitness: {
    selectorPolicyRef: SourceRef;
    includedRelationKinds: string[];
    excludedCounts: Record<string, number>;
    crossScopeExclusions: SourceRef[];
    truncation: boolean;
    estimatedTokens: number;
  };

  epistemicEffect: "operational_meta_context_extended";
  worldEffect: "none";
  grantsAuthority: false;

  freshness: "fresh" | "stale" | "blocked";
  createdAt: string;
  digest: string;
};
```

The context bundle is app-private model-input evidence. The renderer normally
shows its scope, source shelves, cost, freshness, and omissions rather than its
complete text serialization.

### Operational meta-context manifest

```ts
type OperationalMetaContextManifest = {
  schema: "direct_operational_meta_context_manifest@1";
  operationalMetaContextId: string;
  semanticEventId: string;
  agentInstantiationRef: SourceRef;

  constitutionRef: SourceRef;
  currentIntentRef: SourceRef;
  semanticSettlementRef: SourceRef;
  taskContractRef?: SourceRef;
  policyClosureRef: SourceRef;
  contextBundleRefs: SourceRef[];
  activeAroViewRefs: SourceRef[];
  evidenceRefs: SourceRef[];
  workingArtifactRefs: SourceRef[];

  attentionBudget: {
    estimatedInputTokens: number;
    reservedReasoningTokens: number;
    reservedOutputTokens: number;
  };

  sourceRevisionRefs: SourceRef[];
  stale: boolean;
  digest: string;
};
```

The manifest records the constitution of active attention without storing
private chain-of-thought.

### Raw evidence import

Raw code, logs, transcripts, and tool results remain available through narrower
evidence tools:

```text
IMPORT_RAW_EVIDENCE(event refs, bounded range)
IMPORT_CODE(realization refs, exact files or symbols)
IMPORT_RUNTIME_WITNESS(operation or test refs)
```

Raw evidence is imported when the task requires substrate inspection,
verification, diagnosis, or mutation. It is not the default representation of
project meaning.

### Context caching and invalidation

A context bundle cache key includes:

```text
agent instantiation
semantic settlement
anchor refs
shelf revisions and digests
selector policy
freshness posture
attention budget
builder version
```

Any changed dependency invalidates the cached bundle. Old bundles remain
immutable evidence of what the agent actually saw.

### Context authority

Context import:

```text
may change:
  the agent's active epistemic state

may not change:
  canonical worldstate
  project policy
  user authorization
  tool authority
  external systems
```

Imported historical text remains evidence. It cannot become system or
developer authority merely because it appears in a semantic shelf.

## Abstract Reasoning Objects

### ARO purpose

An ARO represents what a system is, what distinctions it must preserve, and
how it should behave across relevant actual and counterfactual conditions.

Code is a realization attempt:

```text
ARO demand
  -> architecture and interface choices
  -> implementation
  -> runtime behavior
  -> verification evidence
```

The ARO gives reasoning the proper semantic altitude. Existing code remains
authoritative evidence about current execution, but not the sole authority
about intended meaning.

### ARO contract

```ts
type AbstractReasoningObject = {
  schema: "direct_abstract_reasoning_object@1";
  aroId: string;
  objectClass: string;
  identity: string;
  scopeRef: SourceRef;

  posture:
    | "reconstructed_current"
    | "canonical_target"
    | "candidate_target"
    | "historical";

  altitude:
    | "principle"
    | "world"
    | "project"
    | "architecture"
    | "component"
    | "behavior"
    | "realization";

  purpose: string;
  responsibilities: string[];
  interfaces: Array<{
    interfaceId: string;
    inputs: string[];
    outputs: string[];
    preconditions: string[];
    postconditions: string[];
  }>;

  invariants: Array<{
    invariantId: string;
    statement: string;
    force: "required" | "prohibited" | "preserved";
  }>;

  intensionalBranches: Array<{
    branchId: string;
    sourceState: string;
    eventOrCondition: string;
    relevantDiscriminators: string[];
    demandedTransition: string;
    requiredEffects: string[];
    prohibitedEffects: string[];
    counterfactualAlternatives: string[];
    failurePosture: string;
    coverageState:
      | "demanded"
      | "realized"
      | "verified"
      | "unresolved"
      | "prohibited";
  }>;

  dependencyRefs: SourceRef[];
  policyRefs: SourceRef[];
  childAroRefs: SourceRef[];
  parentAroRefs: SourceRef[];
  peerRelationRefs: SourceRef[];
  realizationBindingRefs: SourceRef[];
  verificationObligationRefs: SourceRef[];
  evidenceRefs: SourceRef[];

  confidence: "admitted" | "high" | "derived" | "ambiguous";
  revision: number;
  lifecycle: "candidate" | "canonical" | "superseded" | "conflicted";
  provenanceRefs: SourceRef[];
  digest: string;
};
```

The prose fields are bounded semantic summaries. Private reasoning used to
construct them is not part of the object.

### Intensional branch law

An ARO must be capable of representing:

```text
ordinary paths
edge conditions
negative cases
mixed cases
authority failures
stale dependencies
counterfactual conditions
forbidden transitions
unknown or unresolved distinctions
```

Semantic importance is not weighted by code volume. A five-line authority
transition may be more important than a five-thousand-line ordinary path.

An edge case is therefore not a low-salience appendix. It is an explicit edge
in the abstract object.

### Current and target AROs

Code mutation requires two distinguishable objects:

```text
ReconstructedCurrentARO
  what the existing realization appears to instantiate

CanonicalTargetARO
  what the project intends the realization to instantiate
```

The desired change is an ARO delta:

```ts
type AroMutationContract = {
  schema: "direct_aro_mutation_contract@1";
  mutationContractId: string;
  currentAroRef: SourceRef;
  targetAroRef: SourceRef;
  demandedBranchDeltaRefs: SourceRef[];
  preservedInvariantRefs: SourceRef[];
  affectedRealizationBindingRefs: SourceRef[];
  verificationObligationRefs: SourceRef[];
  authorityRef: SourceRef;
  digest: string;
};
```

Reconstructing the target solely from buggy code would canonize the bug. Target
AROs may draw from:

```text
admitted user decisions
project policies
accepted specifications
tests and runtime witnesses
interface contracts
known exceptions
historical design evidence
current code
```

Conflicts remain explicit until settled.

### Realization binding

ARO-to-code mapping is many-to-many.

```ts
type AroRealizationBinding = {
  schema: "direct_aro_realization_binding@1";
  bindingId: string;
  aroRef: SourceRef;
  branchRefs: SourceRef[];

  realization: {
    kind:
      | "source_file"
      | "symbol"
      | "schema"
      | "test"
      | "database"
      | "runtime_process"
      | "ui_surface"
      | "procedure";
    substrateRef: SourceRef;
    locator: string;
  };

  realizationPosture:
    | "claimed"
    | "observed"
    | "verified"
    | "partial"
    | "nonconforming"
    | "stale";

  evidenceRefs: SourceRef[];
  sourceDigest: string;
  revision: number;
  digest: string;
};
```

One ARO may bind many source files, schemas, tests, and runtime processes. One
source file may realize parts of several AROs.

### ARO reconstruction

Repository initialization should reconstruct candidate AROs early:

```text
manifests, docs, types, schemas, tests, source, runtime evidence, git history
  -> semantic reconstruction
  -> candidate ARO graph
  -> confidence and contradiction report
  -> evidence review
  -> admission of trusted target/current objects
  -> continuous reconciliation as realizations change
```

Reconstruction outputs must distinguish:

```text
observed from realization
inferred from naming or structure
claimed by documentation
verified by tests or runtime
admitted as target meaning
unresolved contradiction
```

### ARO-centered code mutation

Normal code work becomes:

```text
1. settle the project, task, and intended effect
2. import the relevant target and reconstructed-current AROs
3. construct or select the ARO mutation contract
4. identify demanded branches and preserved invariants
5. resolve realization bindings
6. import only the relevant source, tests, and runtime witnesses
7. plan and perform the substrate mutation
8. verify realization conformance against the ARO
9. update realization bindings and evidence
10. propose any required ARO/worldstate revision for admission
```

Code should be read whenever source inspection is necessary to mutate, audit,
diagnose, or verify the realization. It should not automatically dominate
planning context merely because it is available.

### Failure localization

The ARO architecture separates:

```text
ARO construction failure:
  a required semantic branch was absent or incorrectly modeled

realization-mapping failure:
  the branch existed, but affected substrate was not associated with it

implementation-conformance failure:
  the branch and mapping were correct, but the realization violated them

verification failure:
  the realization may be correct, but available evidence did not establish it
```

This replaces the undifferentiated claim that "the code missed an edge case."

### Semantic coverage

Code coverage asks whether execution traversed branches that exist in code.
ARO coverage asks whether every demanded semantic branch has:

```text
a realization binding
an implementation posture
a verification obligation
a test or runtime witness where applicable
a visible unresolved state when any of the above is missing
```

```ts
type AroCoverageItem = {
  schema: "direct_aro_coverage_item@1";
  branchRef: SourceRef;
  demandPosture: "required" | "prohibited" | "unresolved";
  realizationBindingRefs: SourceRef[];
  verificationObligationRefs: SourceRef[];
  witnessRefs: SourceRef[];
  coverageState:
    | "unrealized"
    | "realized_unverified"
    | "verified"
    | "nonconforming"
    | "ambiguous";
  digest: string;
};
```

One hundred percent line or branch coverage may coexist with an absent semantic
branch. ARO coverage makes the absence observable.

## Thought-Paint Tools

### Purpose

Creativity should be controllable semantic motion, not accidental exposure to
more raw context.

A thought brush specifies:

```text
selection topology
semantic direction
abstraction altitude
transformation
preservation rules
attention budget
result contract
```

The user may choose a brush explicitly. The WorldManager may recommend ranked
brushes, but should not silently transform the reasoning posture when the
choice would materially change the inquiry.

### Thought brush request

```ts
type ThoughtBrushRequest = {
  schema: "direct_thought_brush_request@1";
  brushStrokeId: string;
  semanticEventId: string;
  agentInstantiationRef: SourceRef;

  brush:
    | "interpolate"
    | "switch"
    | "vertical_ascent"
    | "vertical_descent"
    | "horizontal_analogy"
    | "horizontal_contrast"
    | "causal_trace"
    | "effect_projection"
    | "counterfactual_branch"
    | "assumption_inversion"
    | "constitutional_overlay";

  anchors: SourceRef[];
  parameters: Record<string, unknown>;
  preservationRules: string[];

  attentionBudget: {
    maxInputTokens: number;
    maxResultObjects: number;
  };

  persistencePosture: "temporary_canvas";
  worldEffect: "none";
  grantsAuthority: false;
  digest: string;
};
```

### Initial brush semantics

#### Interpolate

```text
INTERPOLATE(last 10 turns)
```

Intentionally imports the selected local sequence and searches for:

```text
the connective trajectory
unfinished conceptual motion
missing intermediate distinctions
latent synthesis
```

This is a deliberate user-selected use of recent chronological evidence, not a
return to blind transcript replay.

#### Switch

```text
SWITCH(Project X)
```

Replaces the active project canvas with Project X's relevant semantic history.
It preserves the stable user/world constitution and explicit pinned objects.
It does not append Project X's entire transcript to the prior project context.

#### Vertical ascent

```text
VERTICAL_ASCENT(
  Project X,
  from = implementation,
  to = architecture
)
```

Traverses realization and abstraction relations:

```text
source and runtime behavior
  -> component ARO
  -> architecture ARO
  -> project purpose
  -> governing principle
```

Lower-level detail loses salience while its abstract demands and unresolved
contradictions remain visible.

#### Vertical descent

```text
VERTICAL_DESCENT(
  target ARO,
  to = candidate realization
)
```

Transforms abstract demands into bounded implementation obligations without
assuming that one realization is already canonical.

#### Horizontal analogy

```text
HORIZONTAL_ANALOGY(
  source = Project X,
  altitude = component architecture,
  targets = relevant projects
)
```

Aligns homologous AROs at the same altitude and returns:

```text
shared structure
material differences
transferable solutions
invalid analogies
policy or substrate distinctions that must be preserved
```

Similarity is not evidence of equivalence.

#### Horizontal contrast

Makes discriminators more salient than commonality:

```text
same problem class
different policies
different environments
different authority boundaries
different failure costs
```

#### Causal trace and effect projection

```text
CAUSAL_TRACE(result or decision)
  -> causes, evidence, authority, and prior transitions

EFFECT_PROJECTION(candidate change)
  -> likely downstream objects, projects, policies, and realizations
```

#### Counterfactual branch and assumption inversion

```text
COUNTERFACTUAL_BRANCH(ARO branch, changed condition)
ASSUMPTION_INVERSION(standing assumption)
```

These create explicit candidate branches on the temporary canvas. They do not
revise the canonical ARO until admitted.

#### Constitutional overlay

Projects applicable policy, authority, capability, and completion constraints
over another canvas:

```text
candidate plan
  + project policy closure
  + runtime capability envelope
  + authority limits
  -> constitutionally admissible option space
```

### Context canvas

```ts
type ContextCanvas = {
  schema: "direct_context_canvas@1";
  contextCanvasId: string;
  semanticEventId: string;
  baseOperationalMetaContextRef: SourceRef;
  brushStrokeRefs: SourceRef[];
  importedContextBundleRefs: SourceRef[];
  activeAnchorRefs: SourceRef[];
  altitude: string;
  temporarySemanticObjectRefs: SourceRef[];
  preservationRuleRefs: SourceRef[];
  estimatedAttentionCost: number;
  freshness: "fresh" | "stale" | "blocked";
  persistencePosture: "temporary";
  worldEffect: "none";
  digest: string;
};
```

Brushes are reversible:

```text
apply stroke
  -> create a new canvas revision

undo stroke
  -> return to its parent canvas revision

admit insight
  -> create a separate candidate semantic object
  -> review and admit through normal WorldManager authority
```

No brush can directly change canonical project state, policy, AROs, code, or
external systems.

### Brush composition

Brushes may compose:

```text
VERTICAL_ASCENT(Project X, implementation -> architecture)
  -> HORIZONTAL_ANALOGY(Project X, Projects Y and Z)
  -> VERTICAL_DESCENT(Project Y, architecture -> candidate realization)
```

Each stroke preserves:

```text
its source canvas
exact imported shelf and ARO refs
transformation contract
attention cost
omissions
result artifact refs
```

The resulting lineage is inspectable without exposing private
chain-of-thought.

## Unified UX Design

### Morphic UX run stance

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
  derivative_profile: worldmanager_operational_meta_context_canvas_v0
  profile_status: proposed_local
```

### Source pack

```yaml
source_pack:
  doctrine_sources:
    - Morphic UX frontend skill
    - borrowed artifact_inspector_advisory_workbench doctrine
  host_sources:
    - docs/DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md
    - docs/DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md
    - docs/DIRECT_WORLD_MANAGER_PROJECT_GENESIS_AND_SUBSTRATE_SPEC.md
    - docs/DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md
    - docs/DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md
    - src/main/direct/worldmanager/settlement.js
    - src/main/direct/worldmanager/service.js
    - src/main/direct/worldmanager/role-runtime.js
    - src/main/direct/worldmanager/unified-projection.js
    - src/renderer/world-manager-surface.html
    - src/renderer/world-manager-surface.js
    - src/renderer/world-manager-surface.css
  visual_sources:
    - docs/assets/world-manager-ux/storyboard/README.md
  runtime_observations: []
```

### UX domain packet

```yaml
primary_user: expert_operator_with_casual_default
device: desktop_electron
tasks:
  - converse_naturally
  - route_semantically
  - inspect_semantic_history
  - import_context
  - navigate_abstraction
  - reason_over_aros
  - mutate_realizations
  - admit_semantic_results
risk_level: high
trust_sensitivity:
  - semantic_scope
  - authority
  - context_provenance
  - realization_conformance
utility_ranking:
  - low_default_cognitive_load
  - correct_semantic_altitude
  - attention_efficiency
  - truthful_inspectability
  - creative_control
```

### Invariants

```text
one unified communications relationship
natural-language meaning is not reduced to lexical phrase matching
ambient focus never silently creates semantic scope
raw evidence remains immutable
semantic assignments remain versioned and correctable
semantic shelves never erase source provenance
context imports are explicit and budgeted
operational meta-context is inspectable through manifests, not private thought
AROs and concrete realizations remain distinguishable
candidate, reconstructed, canonical, realized, and verified remain distinct
thought brushes have no canonical or external effect
evidence remains same-context reachable before admission or mutation
UI may express but may not mint authority
```

### Morphable choices

```text
thought palette placement
brush command syntax
compact context ribbon versus expanded canvas inspector
shelf visualization as list, graph, or spatial map
ARO branch visualization
context-cost visualization
project-ecology density
keyboard, pointer, and voice affordances
```

### Derivative morph axes

```yaml
density: low_default_with_semantic_expansion
navigation_mode: unified_conversation_with_context_canvas
information_posture: outcome_first_with_context_and_aro_drilldown
interaction_tempo: conversational_fast_path_with_expert_brushes
salience_posture: current_lane_scope_altitude_and_decisions
state_exposure: progressive_explicit
command_posture: safe_buffered_dual_lane
```

### Artifact inventory

| Artifact | Decision | Posture |
| --- | --- | --- |
| Existing WorldManager workbench | Wrap and extend | Preserve unified conversation and project ecology |
| WorldManager semantic-event ledger | Reuse | Raw and lineage evidence |
| Fixed semantic ingress plus K2 adapter | Reuse and extend | WM-SC1 and WM-SC2b split orchestration implemented |
| Context packs and request manifests | Extend | Exact provider-input and import evidence |
| Hierarchical worldmodel | Extend | Canonical semantic object and ARO refs |
| Semantic-history catalog | Reuse and extend | WM-SC2 versioned event-to-meaning relations implemented |
| Semantic shelf builder | Reuse and extend | WM-SC2 mechanical materialized projections implemented |
| Semantic artifact and decision kernel | Reuse and extend | WM-SC3 first generic semantic interaction family implemented |
| Governed decision transition executor | Build once | WM-SC5 exact resolution, relay, receipt, and invalidation path implemented |
| Semantic surface compiler | Build once | Project typed objects into lawful interaction morphs |
| Context importer | Reuse and extend | WM-SC4 typed epistemic tool, budget enforcement, cache, and request lineage implemented |
| ARO registry and realization map | Build once | Intensional reasoning and substrate bindings |
| Thought brush registry | Build once | Trusted transformation contracts |
| ContextCanvas store | Build once | Temporary reversible semantic workbench |
| Operational meta-context ribbon | Reuse and extend | WM-SC4 minimal active-scope, selection, omission, cost, freshness, and request-link posture implemented |
| Semantic anatomy inspector | Extend | Settlement, imports, ARO, brush, and evidence lineage |

### Region and lane topology

```text
bounded WorldManager workbench
├─ unified communications region
│  ├─ world-posture lane
│  ├─ conversation lane
│  ├─ operational-meta-context ribbon
│  ├─ thought-palette lane
│  └─ unified composer / transition-request lane
│
├─ project ecology region
│  ├─ focused-project lane
│  ├─ semi-active project lane
│  └─ inactive project index
│
├─ context canvas region
│  ├─ active anchors lane
│  ├─ imported shelves lane
│  ├─ ARO altitude and branch lane
│  ├─ brush stack lane
│  └─ candidate-insight lane
│
└─ semantic anatomy region
   ├─ ingress settlement lane
   ├─ semantic-history relation lane
   ├─ context-import and selection-witness lane
   ├─ ARO and realization lineage lane
   ├─ evidence and verification lane
   └─ authority and admission lane
```

The context canvas and semantic anatomy are collapsed by default. They expand
inside the bounded workbench.

### Default surface

The calm resting surface should show only:

```text
unified conversation
current world/project posture
current semantic lane and scope
active abstraction altitude when non-default
active brush indicator when one is applied
pending decisions or material conflicts
project ecology summary
composer
```

It should not show all shelves, ARO edges, context manifests, or realization
bindings until the user asks for semantic depth.

### Thought palette

Thought brushes may be invoked through:

```text
natural language:
  "Compare this horizontally with my other projects."

compact controls:
  Interpolate
  Switch
  Ascend
  Descend
  Analogy
  Counterfactual

expert command grammar:
  /brush horizontal-analogy --altitude architecture --projects X,Y
```

All invocation forms compile to the same `ThoughtBrushRequest`. A visible
preview should show:

```text
anchor
direction and target
semantic altitude
estimated context cost
preservation constraints
temporary / no-world-effect posture
```

### Operational meta-context ribbon

The compact ribbon should answer:

```text
Where am I?
  user world / Project X / WorkThread Y

What interaction lane is active?
  conversation / deliberation / execution / introspection

At what semantic altitude?
  architecture / component / realization

What context was imported?
  shelf count, freshness, attention cost

What thought operation is active?
  brush stack or none
```

Expanding it reveals the exact manifest and context-import lineage.

### Evidence-before-commit

Before a code mutation, ARO admission, policy admission, or other canonical
transition, the same workbench must expose:

```text
current semantic settlement
target scope and authority
relevant target and current AROs
intensional branch delta
preserved invariants
affected realization bindings
required verification obligations
material evidence and unresolved conflicts
expected canonical or substrate effects
```

A thought canvas result alone is never sufficient evidence for admission.

### Authority boundaries

```text
semantic ingress:
  settles meaning, grants no effect authority

semantic history:
  catalogs relations, does not rewrite raw evidence

context import:
  changes epistemic state only

thought brush:
  changes temporary canvas only

ARO reconstruction:
  produces candidate meaning unless already admitted

ARO mutation contract:
  specifies intended change but does not authorize execution by itself

realization worker:
  acts only under compiled capability and effect authority

verification:
  establishes evidence, not admission

WorldManager/operator admission:
  may create canonical semantic state within scoped authority
```

### State surfaces

The UI must distinguish:

```text
semantic settlement:
  settled / ambiguous / remanded / superseded

semantic shelf:
  fresh / stale / rebuilding / blocked

context:
  imported / truncated / stale / denied

ARO:
  reconstructed / candidate target / canonical target / conflicted

realization:
  claimed / observed / partial / nonconforming / verified / stale

thought canvas:
  temporary / stale / candidate insight extracted

authority:
  advisory / candidate / validated / admitted / prohibited
```

Activity, context abundance, model confidence, and visual prominence never
imply authority or correctness.

### Responsive preservation

At narrow widths:

```text
conversation
  -> operational meta-context ribbon
  -> focused project
  -> temporary context canvas
  -> semantic anatomy
```

The current settlement, active brush, context freshness, and any required
evidence must remain reachable without leaving the bounded workbench.

## Interaction Contracts

### Ordinary conversation

```text
user:
  "How was your weekend?"

WorldManager:
  semantically settles conversation / user-world / no effects
  answers in the same role turn

harness:
  validates the typed settlement and zero-effect posture
  records conversational semantic-history relation

result:
  no project routing
  no project or canonical effect
```

No greeting or social phrase appears in production routing code.

### Project seed without project vocabulary

```text
user:
  "My invoices are eating my life."

WorldManager:
  judges that the utterance may contain a durable project seed
  may converse or offer Project Genesis according to confidence

result:
  semantic project-seed judgment
  no dependency on the words create, build, app, or project
```

### Negated project language

```text
user:
  "Do not create a project for this."

result:
  no project genesis
  explicit negative intent remains binding context
```

The presence of the words `create` and `project` cannot trigger genesis.

### Mixed interaction

```text
user:
  "Make that a Project X policy, then tell me a joke."

settlement:
  primary world/project governance child event
  secondary conversation child event

result:
  candidate policy follows governance and admission
  joke is answered conversationally
  both remain children of one ingress lineage
```

### Semantic context import

```text
settled task:
  Project X implementation planning

harness:
  IMPORT_CONTEXT(
    Project X,
    accepted policies,
    active plan,
    target AROs,
    open decisions
  )

result:
  relevant shelf bundle enters operational meta-context
  unrelated Project Y dialogue remains excluded
  exact selection witness is persisted
```

### ARO-centered mutation

```text
user:
  "Change WorldManager ingress so ordinary conversation stays conversational."

reasoning:
  import WorldManagerSemanticIngress target/current ARO
  identify conversation, project-seed, ambiguity, and mixed branches
  locate settlement.js and related templates/tests
  construct mutation contract
  patch realization
  verify ARO coverage, not only examples

result:
  greetings remain tests
  no greeting phrase table defines behavior
```

### Thought-brush composition

```text
user:
  "Ascend from the current Project X implementation, compare that architecture
  with Projects Y and Z, then suggest how it could descend into Project Y."

result:
  three inspectable brush strokes
  explicit imported shelf and ARO refs
  preserved project-policy differences
  temporary candidate insight
  no automatic Project Y mutation
```

## Persistence And Source-Of-Truth Boundaries

One semantic source of truth does not require one untyped table or the
duplication of every substrate payload.

| Truth class | Canonical owner | Posture |
| --- | --- | --- |
| Raw interaction and runtime evidence | Existing Direct and WorldManager ledgers/stores | Immutable evidence |
| Semantic settlements | WorldManager semantic control plane | Versioned semantic judgment |
| Semantic-history relations | WorldManager semantic control plane | Versioned catalog |
| Semantic shelves | Derived projection store | Rebuildable |
| User/project canonical state | Hierarchical worldmodel trust store | Canonical semantic truth |
| ARO definitions and revisions | Hierarchical worldmodel / ARO registry under WorldManager custody | Candidate or canonical by state |
| Realization bindings | ARO registry linked to exact substrate evidence | Observed/verified mappings |
| Context bundles and manifests | App-private context artifact store | Exact model-input evidence |
| ContextCanvas and brush strokes | WorldManager control plane / app-private projection store | Temporary, reversible |
| Code, tests, and runtime artifacts | Native project substrate and operation evidence stores | Concrete realization evidence |

The semantic control plane remains unique across WSL and Windows project
substrates. Native executors translate and realize work in their declared
environment; they do not create competing worldstate.

Suggested logical store additions:

```text
wm_semantic_settlements
wm_semantic_history_relations
wm_semantic_shelf_revisions
wm_context_imports
wm_operational_meta_context_manifests
wm_aros
wm_aro_branches
wm_aro_realization_bindings
wm_aro_verification_obligations
wm_context_canvases
wm_thought_brush_strokes
```

All authoritative or inspectable objects require stable IDs, schema versions,
canonical digests, provenance refs, revisions, and explicit lifecycle state.

## System-Prompt And Agent-World Compilation

The WorldManager has a fixed constitutional identity and a versioned semantic
ingress contract.

Other roles remain compiled:

```text
trusted role template
+ settled project and task
+ applicable worldstate slice
+ policy closure
+ ARO view
+ context-tool capability
+ authority and effect envelope
+ completion and return contract
-> bounded agent world
```

The root ingress role must be compilable before project settlement. It receives:

```text
fixed WorldManager ingress constitution
current user-world identity and revision
project identity index and exact refs
pending exact decision refs
ambient UI focus as non-binding evidence
current local conversational adjacency
current user utterance
native semantic-action contract
```

It does not require a preselected Project Manager. Its result selects or
constructs the downstream role assignment.

Once scope and task are settled, standard context imports and policy inheritance
can proceed mechanically.

## Implementation Sequence

### WM-SC1 — Semantic ingress replacement

Status: implemented and locally regression-proven on 2026-07-28.

Delivered:

```text
fixed WorldManager semantic-ingress role template
direct_world_manager_semantic_action_contract@1
direct_world_manager_semantic_discharge@1
direct_world_manager_semantic_settlement@2
provider-backed and deterministic-test semantic-ingress runner
native required Responses semantic-action selection
open SemanticTypeExpression persistence
mechanically derived K2 operational adapters
zero-effect conversational response path
explicit semantic-action form/reference failure posture
atomic SQLite persistence with task-settlement lineage
renderer-safe semantic-discharge evidence and semantic zoom
```

The prior `@1` strict settlement/run records remain readable historical
evidence. Production no longer emits the closed semantic classifier result.

Migration:

```text
remove isCasualConversationMessage as a production routing rule
remove classifyTask lexical category membership
retain exact typed-control and ID bindings
move natural project naming, negation, hypothetical, and mixed meaning into
the semantic ingress contract
```

Do not add lexical fallbacks when the semantic role is unavailable.

The current bounded implementation validates `split` as a semantic
disposition, materializes immutable child contracts and semantic events,
settles and compiles each child independently, executes eligible child role
turns, and passes the typed child outcomes to one parent WorldManager closure
turn. Child results remain inspectable lineage/evidence; only the parent join
is projected as the conversational answer. A child contract cannot select
`wm_discharge_split` recursively in this slice. Terminal clarification,
remand, interruption, and failure states without an AgentResult receive a
distinct non-authoritative harness notice, so the chat cannot end silently or
misrepresent a diagnostic as agent speech. The deterministic phrase-matching
runner exists only under `scripts/fixtures/`; production uses the Direct
provider-backed fixed semantic role.

### WM-SC2 — Semantic history catalog

Status: core catalog implemented and locally regression-proven on 2026-07-29.

Delivered:

```text
versioned SemanticHistoryRelation store
event-to-project/lane/task/object relations
settlement revision and supersession
append-only relation-state transitions
semantic shelf builder, invalidation, and atomic rebuild
legacy raw-history ingestion with provisional reconstruction posture
renderer-safe catalog and shelf projection
bounded multi-turn semantic-history evidence for introspection
replacement of the immediate-predecessor transcript rule
restart-safe reconstruction and historical compiler compatibility
```

`scripts/direct-world-manager-semantic-history-regression.mjs` proves that one
event can occupy several semantic histories, world and project shelves remain
distinct, corrections do not mutate raw events, affected shelves rebuild with
immutable prior revisions, restart preserves the catalog, and legacy K2-only
rows remain explicitly provisional.

### WM-SC2b — Split semantic child orchestration

Status: implemented and locally regression-proven on 2026-07-29.

Delivered:

```text
immutable direct_semantic_child_contract@1 records
durable semantic_child_materialized events
has_semantic_child SemanticHistoryRelation edges
append-only direct_semantic_split_coordination@1 revisions
child-only semantic discharge contract with recursive split unavailable
independent child settlement, graph context, policy closure, and role runtime
non-canonical child candidate preservation
one parent WorldManager join prompt grounded in typed child outcomes
one visible parent answer instead of child-agent chat bureaucracy
restart interruption witness plus idempotent continuation
no-silent-terminal diagnostic projection
```

`scripts/direct-world-manager-semantic-split-regression.mjs` proves that two
ideas can settle into different task/role constitutions, complete through four
persisted Direct role runs, preserve a non-canonical project candidate, and
join into one WorldManager answer. Its UI companion proves that the joined
answer is agent-authored while harness terminal notices remain visually and
constitutionally distinct.

### WM-SC2b.1 — Split truth, project-seed recovery, and bounded inspectors

Status: implemented and locally regression-proven on 2026-07-29.

Delivered:

```text
compiled-contract discriminator inference when every required field exists
immutable preservation of earlier remanded role results
partially_remanded as an attention state rather than completed or failed
one visible parent reply plus a distinct incomplete-child harness witness
renderer-safe child outcome summaries and semantic contract projections
preserved remanded project seeds that are not counted as projects
safe-buffered project-seed retry preparation with no automatic submission
Project Ecology Inspector with inspection separated from runtime focus
reconciled candidate-only project identities projected immediately
established-project and candidate counts rendered separately
one project-card identity across candidate, reviewed, and admitted states
canonical/unprovisioned project inspection without false focus eligibility
Decision/Outcome Inspector backed by current project open decisions
historical remands inspectable but excluded from action-required counts
```

The discriminator inference is form normalization, not semantic
reverse-validation: the harness may insert the already compiled required
schema name only when the provider returned an object containing every
required field and neither `schema` nor `type`. Missing semantic fields still
remand normally.

The Project Ecology inspector began as a bounded pre-`WM-SC6` read model. The
Decision/Outcome inspector combined the `WM-SC3` typed kernel with the bounded
`WM-SC5` transition surface. SC6 now supplies their compiled decision,
constitution, candidate, and receipt surfaces without changing the
truth/recovery or runtime-focus boundaries established by this stabilization
slice.

Regression coverage proves:

```text
a schema-less but structurally complete project-genesis discharge is admitted
a structurally incomplete discharge remains remanded
partial parent closure outranks an older admitted-constitution headline
the unified response and incomplete-child diagnostic remain distinct
clicking a project inspects it and does not silently activate runtime focus
a reconciled candidate appears in Project Ecology before admission
candidate styling and counts remain visibly provisional
evidence review updates the same project identity
admission promotes that identity without creating a duplicate card
unprovisioned canonical projects are inspection-only
retry preparation writes only to the composer
current open decisions and split outcomes are inspectable
historical remands do not inflate the open-decision metric
```

### WM-SC3 — Semantic artifact and decision kernel

Status: implemented and locally regression-proven on 2026-07-29.

Delivered:

```text
generic SemanticArtifact header
OpenDecision and DecisionOption
DecisionDependency and DecisionConsequence
DecisionResolutionContract
mechanical, semantic-relay, evidence-request, and authority-request modes
revision, supersession, stale, conflict, and resolution state
migration of wm_decisions and manager openDecisions
project_open_decisions shelf membership
```

The harness validates form, references, authority posture, and lifecycle. The
semantic role authors the meaning and alternatives.

The implementation adds:

```text
src/main/direct/worldmanager/semantic-artifact-kernel.js
  SemanticArtifactHeader
  OpenDecision
  DecisionOption
  DecisionDependency
  DecisionConsequence
  DecisionResolutionContract

wm_semantic_artifacts
  append-only revision rows
  one mechanically selected current revision per semantic identity
  exact source-state digest and provenance

control-plane migration
  manager openDecisions -> manager_open_decision
  wm_decisions -> legacy_wm_decision compatibility artifacts
  project_open_decisions shelves -> direct OpenDecision refs
```

`canonical: true` on an `OpenDecision` means that the existence and current
meaning of that unresolved decision is a canonical semantic record. It does
not authorize a choice or effect. Every header, child object, resolution
contract, and renderer projection retains `grantsAuthority: false`; operational
compatibility rows remain the only existing executable gates.

The four resolution modes declare the form of a future transition:

```text
mechanical       exact typed option
semantic_relay   scoped free-form response routed through the WorldManager
evidence_request request evidence before deciding
authority_request request an authorized actor/effect boundary
```

SC3 persists and inspects those contracts but deliberately sets transition
availability to `deferred_to_wm_sc5`. It does not add clickable resolution
controls. A legacy project-admission row may therefore appear beside
manager-authored project questions as a typed authority-request artifact while
still executing only through the existing evidence-review/admission path.

Lifecycle changes produce exact predecessor-linked revisions. Open/blocked,
resolved, superseded, stale, and conflicted meanings remain distinguishable;
resolved decisions leave the current `project_open_decisions` shelf without
deleting their revision history.

Regression coverage:

```text
scripts/direct-world-manager-semantic-artifact-kernel-regression.mjs
  validates all four resolution modes
  proves append-only stale/conflict/resolution revisions
  migrates both source families idempotently
  marks historical unresolved clarification bridges stale instead of actionable
  binds exact decision refs into project_open_decisions
  removes resolved decisions from the open shelf
  proves restart idempotency and zero authority minting

project-genesis and semantic-split UI regressions
  expose typed mode, revision, epistemic posture, and shelf binding
  expose typed options and structural relations when present
  keep the SC5 transition boundary visible
```

### WM-SC4 — Context import and operational meta-context

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
ContextRequirementSet
IMPORT_CONTEXT tool
SemanticContextBundle
selection witness
OperationalMetaContextManifest
attention budget and cross-scope enforcement
context cache and dependency invalidation
request-manifest linkage
project-ecology semantic action and task adapters
bounded user_world_project_ecology shelf
```

The implementation is centered in
`src/main/direct/worldmanager/semantic-context-kernel.js`. A settled task
mechanically compiles a `direct_context_requirement_set@1`; the harness then
executes the same typed `IMPORT_CONTEXT` read operation that an agent-requested
import can use later. Exact settled anchors select current semantic shelves,
while peer project shelves become explicit cross-scope exclusions in a
`direct_semantic_context_selection_witness@1`.

Context selection is not a binary `projectId` test. Ordinary world conversation
continues to receive only world conversational/governance shelves. A settled
`project_ecology_status`, `cross_project_comparison`, or `portfolio_planning`
task instead requires the world-anchored `user_world_project_ecology` shelf.
This preserves user-world authority while admitting bounded status evidence for
multiple project subjects. It does not pierce any project-private shelf.

The resulting `direct_semantic_context_bundle@1` contains bounded semantic
outcomes and typed semantic-object projections. It does not replay a blind
chat transcript, expose raw evidence, change worldstate, or grant authority.
Its dependency digest covers world revisions, shelf revisions, settlement
refs, semantic object revisions, selected semantic-event content, selector
policy, freshness posture, budget, and importer revision. Exact repeats reuse
the cache; changed dependencies preserve the old immutable bundle as stale and
materialize a new current bundle.

The `direct_operational_meta_context_manifest@1` binds the constitution,
current intent, settlement, policy closure, bundles, evidence, working
artifacts, attention budget, and source revisions for one agent
instantiation. The Direct context pack projects its bounded content as quoted
`semantic-context-evidence`, not as harness policy. The existing
`direct_request_manifest@1` cites the operational manifest, requirement,
import, bundle, selection witness, and source shelves. A separate
`direct_context_request_manifest_link@1` closes the persisted WorldManager
lineage after the Direct turn has built its exact request manifest.

Renderer integration is deliberately read-only. A compact operational
meta-context ribbon exposes scope, purpose, freshness, selected outcomes and
objects, token estimate, shelf kinds, open-decision count, cross-scope cut,
truncation, and request-link state. Semantic zoom exposes the same typed refs
and omission witness. Neither view can issue a hidden import or mint a loaded
state.

Proof:

```text
scripts/direct-world-manager-semantic-context-regression.mjs
  compiles context requirements from settled task and agent constitution
  keeps ordinary world conversation free of ambient portfolio state
  imports bounded project-status objects for a world-governed ecology query
  materializes typed semantic outcomes and objects within attention budgets
  excludes all peer-project shelves and witnesses the cross-scope cut
  rejects a project anchor that disagrees with settled scope
  reuses exact cache entries idempotently
  invalidates immutable cache entries when a dependency revision changes
  admits semantic context to provider input only as quoted non-authority evidence
  pins the operational context lineage in the Direct request manifest
  exposes only renderer-safe summaries with no raw evidence or world effect

scripts/direct-world-manager-k3-regression.mjs
scripts/direct-world-manager-k4-regression.mjs
  preserve the compiled-agent and persisted-role invariants with SC4 active
```

### WM-SC5 — Governed decision transitions

Deliver:

```text
DecisionTransitionRequest
exact mechanical option transitions
scoped WorldManager semantic-relay envelopes
evidence and authority request paths
expected-revision and idempotency gates
DecisionTransitionReceipt
decision-resolution history relations
shelf rebuild and context-cache invalidation after resolution
```

#### SC5 Morphic UX bundle

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: implementation_inspected
  runtime: not_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: world_manager_sc5_safe_buffered_decisions
  profile_status: proposed_local
```

SC5 began as a bounded derivative of the existing Decision / Outcome
inspector. SC6 now compiles its identity, landscape, morph, and exact region
binding while retaining SC5 as the only governed transition boundary. Its
primary user is an expert operator whose trust requirement is that evidence,
authority, and transition state remain visible in the same card.

The surface invariants are:

```text
the UI never mints authority or fabricates a transition;
every transition cites an exact decision digest and expected revision;
every submit carries an idempotency key;
blocking dependencies remain visible beside the action;
mechanical selection and canonical confirmation are separate gestures;
mechanical resolution changes only the semantic decision record;
semantic relay preserves the user's exact text and re-enters normal ingress;
semantic relay binds the exact OpenDecision object, not merely its project;
unprovisioned decision projects remain WorldManager-governed at world scope;
evidence and authority requests remain distinct non-authorizing paths;
pending, blocked, stale, failed, relayed, and resolved states remain visible;
receipts and history relations are append-only inspection objects.
```

The derivative profile keeps medium information density, a task-first
hub-and-spoke inspector, progressive disclosure for structural relations, and
safe-buffered actions. A mechanical choice first stages an exact option in the
card. A second explicit confirmation crosses the canonical decision-state
boundary. Free-form semantic, evidence, and authority requests use a scoped
inline composer and never imply that the requested evidence or authority was
granted. Latest receipts render in the same inspector after the open decision
leaves its shelf.

The renderer submits only a `DecisionTransitionRequest`. The control plane
validates the current decision, its resolution contract, exact option,
dependencies, expected revision, current projection revision, actor role, and
idempotency identity. A successful mechanical transition appends a resolution
artifact, a new `OpenDecision` revision, a decision-resolution history
relation, and a `DecisionTransitionReceipt`; it then rebuilds semantic shelves
and marks dependent operational context caches stale. A relay transition
appends a scoped envelope and pending receipt before invoking ordinary
WorldManager ingress. The final relay receipt cites that ingress without
claiming canonical resolution.

The implementation is centered in
`src/main/direct/worldmanager/decision-transition.js`. SQLite persists the
request, transition artifact, current append-only receipt revision, and
decision-resolution relation in separate tables. `DirectWorldManagerService`
exposes one governed transition endpoint. Mechanical transitions stop at the
semantic record; relay transitions use a deterministic ingress id and the
decision as an explicit scope constraint, so restart retry remains idempotent
and no parallel conversational path is invented.

The relay boundary distinguishes semantic existence from runtime
addressability. If an `OpenDecision` belongs to an admitted or candidate
project that is inspectable in Project Ecology but not present in the
configured runtime project set, the transition does not forge a runnable
project scope. The ingress carries the decision's exact artifact reference;
semantic settlement selects `semantic_decision_deliberation`; the operational
context importer admits that exact object across the otherwise world-scoped
cut; and the constitutional WorldManager formulates the response. This
explicit object binding is the only cross-scope exception. It grants neither
Project Manager launch eligibility nor downstream project authority.

The Decision / Outcome inspector derives its action morph from the resolution
mode:

```text
mechanical       exact option staging -> explicit confirmation
semantic_relay   scoped WorldManager composer
evidence_request scoped evidence composer
authority_request scoped authority composer
```

The latest receipt remains inspectable even after a resolved decision leaves
the open-decision shelf. SC6 now supplies the morph resolver, inline
conversation artifacts, and cross-surface identity while SC5 continues to own
transition validation, persistence, and receipts.

Proof:

```text
scripts/direct-world-manager-decision-transition-regression.mjs
  resolves only an exact available option under revision and idempotency gates
  keeps unsatisfied dependencies visibly blocked
  appends resolution and relay artifacts, receipts, and history relations
  preserves semantic relay, evidence, and authority as distinct paths
  grants no execution authority and performs no downstream effect
  removes a resolved decision from its semantic shelf
  stales dependent semantic and operational context caches
  exposes a renderer-safe transition projection

scripts/direct-world-manager-decision-transition-ui-regression.mjs
  requires option selection plus separate canonical confirmation
  proves selection alone submits nothing
  renders scoped composers for all non-mechanical modes
  preserves exact semantic-relay input
  keeps the authority boundary and recent receipt visible
```

### WM-SC6 — Semantic surface compiler

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
SemanticSurfaceProjection
SemanticLensProjection
SemanticProjectionWitness
SemanticRegionBinding
versioned MorphResolver registry with binary, choice-card, comparison, tree,
graph, scoped-composer, and status-card family vocabulary
live resolver entries for binary, choice-card, comparison, scoped-composer,
and status-card objects in the initial migration
inline conversation artifacts
global Decision Dock and project decision indicators
same-object identity across compact and semantic-zoom projections
migration of project-genesis admission from bespoke controls
truthful provisional, stale, blocked, submitting, and resolved states
```

#### SC6 purpose

The canonical backend is a richly connected semantic graph. The frontend is a
semantic atlas, not a graph visualizer.

A graph dump answers:

```text
What relations exist in storage?
```

The semantic surface answers:

```text
Which relations must become perceptually present for this operator,
pursuing this task, at this moment?
```

SC6 therefore compiles in two distinct stages:

```text
canonical semantic worldstate
+ selected object
+ active task
+ selected O/E/D/U lens
+ user density and abstraction-depth profile
→ SemanticLensProjection

SemanticLensProjection
+ semantic-object lifecycle
+ lawful transition contract
+ authority boundary
+ available perceptual area
→ SemanticSurfaceProjection
```

The lens chooses the semantic neighborhood. The morph chooses the lawful
spatial and interaction grammar for that neighborhood. An E projection is not
intrinsically a graph, and a U projection is not intrinsically a priority
list. Either may become a comparison, tree, timeline, compact card, graph, or
scoped composer according to the object and task.

#### ODEU landscapes

The four lenses project one canonical world:

```text
O — ontology and realization
    entities, types, parts, states, transitions, causal dependencies,
    environments, and affordances

E — epistemic standing
    claims, observations, evidence, provenance, confidence,
    contradictions, unknowns, and open experiments

D — deontic and constitutional standing
    roles, ownership, permissions, obligations, approval gates,
    policy inheritance, violations, exceptions, and authority paths

U — utility and trajectory
    goals, priorities, costs, risks, trade-offs, preferred trajectories,
    terminal conditions, and blocked horizons
```

Changing lens changes salience, adjacency, abstraction, and navigation. It
does not change canonical identity, lifecycle, epistemic standing, or
authority. The ODEU rhomb is a stable orientation control, not four unrelated
dashboard routes. The selected landscape receives the main work region; the
other three remain available as reduced boundary signals or portals.

#### Semantic lens projection

```text
SemanticLensProjection {
  semanticLensProjectionId
  subjectRef
  taskRef?
  lens
  promotedRelationKinds
  promotedObjectRefs
  boundarySignals
  suppressedRelationKinds
  abstractionDepth
  breadth
  sourceRevisionRefs
  witnessRef
  grantsAuthority = false
}
```

`promotedRelationKinds` and `promotedObjectRefs` define perceptual foreground,
not a new truth set. Suppressed relations remain available through semantic
zoom and the projection witness. Suppression must never be represented as
absence or falsity.

#### Projection witness

Every compiled landscape receives a stable witness:

```text
SemanticProjectionWitness {
  semanticProjectionWitnessId
  subjectRef
  lens
  promotedRefs
  boundarySignalRefs
  suppressedRelationKinds
  selectionReasons
  taskBindingRef?
  profileBindingRef
  viewportClass
  sourceRevisionRefs
  grantsAuthority = false
}
```

The witness makes the atlas inspectable without exposing private reasoning. It
records which typed relations governed the projection, why they were promoted,
what remained outside the foreground, and which world revisions were read.

#### Morph resolver registry

The versioned `MorphResolver` registry maps semantic form and operative state
to lawful UI morphology:

```text
semantic object kind
+ lifecycle and freshness
+ selected lens
+ transition contract
+ dependency posture
+ authority posture
+ interaction tempo
→ morph family and action cluster
```

Initial morph families:

```text
binary            two exact alternatives with staged confirmation
choice_card       finite option family with availability and effects
comparison        simultaneous competing objects or trajectories
tree              hierarchy, inheritance, or decomposition
graph             relational neighborhood where topology is primary
scoped_composer   open semantic contribution bound to an exact object
status_card       compact read-only identity and lifecycle projection
```

A registry entry may choose layout and disclosure. It may not manufacture an
action absent from the semantic object's transition contract.

#### Semantic region binding

Spatial regions are part of the semantic input channel. Writing from an
object-bound region is a digital act of pointing.

```text
SemanticRegionBinding {
  semanticRegionBindingId
  surfaceProjectionRef
  regionId
  subjectRef
  selectedLens
  taskRef?
  promotedObjectRefs
  promotedRelationKinds
  interactionContractRef
  expectedSubjectRevision
  bindingPosture = exact_region_binding
  grantsAuthority = false
}
```

The open semantic payload and exact structural address remain distinct:

```text
exact object and revision
+ selected semantic neighborhood
+ free-form semantic contribution
+ governed transition
```

Thus `fix this`, `reassess this`, or `move to X` is not underspecified when
entered inside the relevant region. The region supplies the exact subject and
revision; the utterance supplies the transformation. If the object revision
has changed, the surface must expose a stale binding and require reconciliation
rather than silently redirecting the message.

Reference resolution order becomes:

```text
exact region binding
→ explicit object reference
→ active semantic scope
→ graph relation
→ conversational salience
→ temporal-recency fallback
```

#### Same object, multiple projections

One semantic object may appear simultaneously as:

```text
compact inline conversation artifact
global Decision Dock entry
project attention indicator
expanded O/E/D/U landscape
semantic-anatomy inspection object
```

Every projection carries the same exact object ID and digest. Surface-local
state such as expanded, selected lens, draft text, or staged option is not
canonical object state. A transition receipt updates all projections through
the shared object identity.

#### Authority and truth invariants

```text
views may change salience, arrangement, abstraction, and navigation;
views may never change identity or semantic standing;
the UI may express but may not mint authority;
D displays authority but does not grant it;
E displays warrant but does not validate it;
U displays preference structure but does not canonize it;
O displays identity and realization without treating candidates as canonical;
unknown and suppressed are not rendered as absent;
provisional, stale, blocked, submitting, resolved, and canonical differ visibly;
required evidence remains same-context reachable before commit;
advisory and commit action clusters remain spatially distinct;
responsive projection may reduce breadth and depth but not identity or gates.
```

#### Initial migration

SC6 first compiles the semantic objects already governed by SC3–SC5:

```text
OpenDecision
ProjectConstitutionCandidate
ProjectConstitution
DecisionTransitionReceipt
```

The existing Decision / Outcome inspector and project-genesis admission card
become consumers of `SemanticSurfaceProjection` rather than independently
choosing controls. The same decision projections appear inline in the unified
conversation and in a global Decision Dock. Project cards receive decision
indicators keyed to the same object identities. Existing SC5 transition and
project-genesis review/admission endpoints remain the only effectful
boundaries.

#### SC6 Morphic UX bundle

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: runtime_exercised
  runtime: live_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: world_manager_sc6_semantic_atlas
  profile_status: proposed_local
morph_axes:
  density: low_default_with_semantic_expansion
  navigation_mode: unified_conversation_with_bounded_landscape_focus
  information_posture: outcome_first_with_lens_projection
  interaction_tempo: conversational_fast_path_with_inspectable_structure
  salience_posture: selected_object_lens_and_open_decisions
  state_exposure: progressive_explicit
  command_posture: safe_buffered_dual_lane
```

The ODEU lens is a semantic selection input, not an ad-hoc eighth visual morph
axis. The existing morph axes continue to govern density, navigation, state,
and command posture after the semantic neighborhood has been selected.

#### SC6 implementation and proof

The versioned compiler is implemented in
`src/main/direct/worldmanager/semantic-surface-compiler.js`. The control-plane
snapshot compiles exact `OpenDecision`, `ProjectConstitutionCandidate`,
`ProjectConstitution`, and `DecisionTransitionReceipt` projections. The
renderer consumes those projections for inline artifacts, the global Decision
Dock, project indicators, decision/genesis inspectors, transition receipts,
the O/E/D/U rhomb, and bounded semantic landscapes.

Every interactive compiled region carries an exact `SemanticRegionBinding`.
Decision transitions persist that binding in `DecisionTransitionRequest`;
project-genesis evidence review and admission validate the binding against the
current candidate before crossing their existing effect boundary. Changing
lens changes the region binding and promoted relation family while preserving
the exact subject ID and digest. A stale or forged binding fails visibly.

At SC6, tree and graph were registered lawful morph families without
fabricated live mappings for SC3–SC5 objects. SC7 now activates their first
live resolver entries only for typed ARO branch hierarchy and
realization-coverage objects.

Proof:

```text
npm run direct:world-manager-semantic-surface
  validates four O/E/D/U projections, exact witnesses and region bindings
  proves identity stability while promoted relations change
  proves binary, choice-card, scoped-composer, comparison, and status morphs
  proves compiled transition receipts, Decision Dock, and project indicators
  proves inline event identity and the no-authority/no-effect boundary

npm run direct:world-manager-semantic-surface-ui
  renders inline artifacts at the exact semantic event
  opens the same decision identity from the global Decision Dock
  changes semantic foreground and exact region binding through the ODEU rhomb
  preserves identity through responsive collapse
  carries exact region bindings through scoped composition and genesis review

npm run direct:world-manager-decision-transition
npm run direct:world-manager-decision-transition-ui
npm run direct:world-manager-project-genesis
npm run direct:world-manager-project-genesis-ui
  preserve the existing SC5 and project-genesis authority/effect boundaries
  while their surfaces are compiler-driven
```

### WM-SC7 — ARO registry and reconstruction

Status: implemented and locally regression-proven on 2026-07-30.

Deliver:

```text
AbstractReasoningObject family
intensional branch and counterfactual representation
current/target ARO distinction
realization bindings
candidate repository reconstruction
evidence and contradiction review
ARO coverage projection
explicit operator admission of a reviewed reconstruction
live tree, graph, and comparison semantic morphs
```

#### SC7 purpose and boundary

SC7 reconstructs the abstract object that a repository realization appears to
instantiate. It does not mutate code and it does not claim that reconstruction
is infallible.

The transition is:

```text
exact repository evidence
+ semantic reconstruction authored by a bounded reasoner
→ non-canonical AroReconstructionCandidate
→ same-context evidence and contradiction review
→ explicit operator admission
→ canonical current or target AbstractReasoningObject
```

Admission means:

```text
this abstract object is now the canonical semantic model used for reasoning
```

It does not mean:

```text
the code is correct
the target is realized
the evidence is verified
mutation is authorized
```

The renderer may review or admit a candidate already authored through the
semantic path. It may not author branches, counterfactuals, realization
bindings, or evidence by constructing arbitrary JSON.

The production acceptance port is intentionally harness-internal:
`registerAroReconstructionCandidate` validates and persists a candidate
already authored by a bounded semantic producer. No renderer IPC can register
or edit one. SC7 established this acceptance boundary without claiming an
automatic producer. `WM-SC7.1` below now supplies that producer and preserves
the same boundary rather than replacing it with deterministic UI-authored
meaning.

#### AbstractReasoningObject

```text
AbstractReasoningObject {
  aroId
  projectId
  conceptKey
  semanticIdentity
  purpose
  posture                  current | target
  revision
  lifecycle                candidate | active | stale | conflicted | superseded
  branches[]
  edges[]
  realizationBindings[]
  coverageWitnessRef
  counterpartRef?
  admittedFromCandidateRef?
  provenanceRefs[]
  canonical
  grantsAuthority = false
}
```

`conceptKey` joins the current and target representations of the same abstract
object without collapsing their identities. The ARO ID remains stable for one
project/concept/posture lineage; revisions are append-only.

#### Intensional branches and edges

```text
AroBranch {
  branchId
  branchKey
  branchKind
  modality                 required | possible | counterfactual
  statement
  condition?
  expectedOutcome?
  semanticState            supported | missing | contradicted | unknown
  parentBranchRef?
  provenanceRefs[]
  grantsAuthority = false
}

AroEdge {
  edgeId
  fromBranchRef
  toBranchRef
  relationKind             requires | excludes | causes | refines |
                           alternative_to | counterfactual_of
  rationale
  grantsAuthority = false
}
```

An absent required or counterfactual branch remains visible even when every
currently implemented code branch has test coverage. This is the primary
altitude correction SC7 introduces.

#### Realization binding and coverage

```text
AroRealizationBinding {
  realizationBindingId
  branchRef
  realizationKind          source | test | documentation | runtime_witness
  locator
  sourceRef
  coverageState            realized | partial | absent | stale | contradicted
  evidenceRefs[]
  observedRevisionRef?
  grantsAuthority = false
}

AroCoverageWitness {
  aroRef
  branchCount
  requiredBranchCount
  realizedBranchCount
  partialBranchCount
  absentBranchRefs
  staleBindingRefs
  contradictionRefs
  coveragePosture
  sourceRevisionRefs
  grantsAuthority = false
}
```

Coverage is branch-to-realization coverage, not line or code-branch coverage.
One abstract branch may bind to several source, test, documentation, and
runtime realizations. A source change does not alter the ARO automatically; it
stales the affected realization evidence until reconstruction or verification.

#### Reconstruction candidate and review

```text
AroReconstructionCandidate {
  candidateId
  candidateRevision
  candidateAro
  repositorySnapshotRef
  reconstructionMethod
  evidenceRefs[]
  contradictionRefs[]
  evidenceReviewState      pending | reviewed
  contradictionReviewState pending | reviewed
  lifecycle                candidate | admitted | rejected
  sourceSemanticEventRef?
  canonical = false
  grantsAuthority = false
}
```

Review is append-only and records that the operator inspected the repository
evidence, missing branches, stale bindings, and contradictions. Review does not
validate the semantic content and does not eliminate contradictions. Admission
requires the exact reviewed candidate digest and expected revision.

#### Current/target comparison

Current and target AROs remain separate canonical objects:

```text
current ARO
  what the repository presently appears to realize

target ARO
  what the admitted intended object requires
```

Their comparison projection records:

```text
shared branch keys
current-only branches
target-only branches
semantic-state conflicts
realization-coverage gaps
counterfactual gaps
```

A target-only required branch is not rendered as a code defect until a later
mutation contract adopts it as an implementation obligation. SC7 remains
descriptive and epistemic.

#### SC7 semantic surfaces

SC7 extends the SC6 compiler with live mappings:

```text
AroReconstructionCandidate → comparison
AbstractReasoningObject     → tree
AroCoverageWitness          → graph
current/target comparison   → comparison
```

The tree preserves branch hierarchy, intensional modality, and semantic state.
The graph preserves many-to-many branch/realization/evidence topology. The
same ARO identity and exact region binding survive O/E/D/U switching and
responsive collapse.

The ARO workbench uses a bounded master-detail projection rather than stacking
every semantic object at full depth:

```text
producer-status lane
  current repository reconstruction state

compact navigator lane
  reconstruction candidates
  admitted reconstruction lineage
  current/target comparisons
  canonical AROs and coverage witnesses

focused-object evidence lane
  exactly one selected semantic surface
  O/E/D/U lens
  evidence and contradictions
  branch tree, coverage graph, or comparison
  review and admission gates when applicable

trust-boundary lane
  semantic admission only; no code mutation
```

Navigator entries and inline `Open semantic object` controls preserve the
selected subject across candidate revisions and move focus to its exact
same-context detail. Selecting another object replaces the focused projection;
it does not append another full card to the document. Narrow surfaces stack the
compact navigator above the same bounded detail without changing identity or
authority.

#### SC7 Morphic UX bundle

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: dynamically_validated
  runtime: automated_browser_observed
profile_lineage:
  base_profile: artifact_inspector_reference
  derivative_profile: world_manager_sc7_focused_aro_workbench
  profile_status: implemented_local
morph_axes:
  density: high
  navigation_mode: split_pane
  information_posture: evidence_first
  interaction_tempo: expert_fast_path
  salience_posture: evidence_and_status_prominent
  state_exposure: full_explicit
  command_posture: dual_lane
```

Portable source pack:

```yaml
source_pack:
  doctrine_sources:
    - morphic-ux-frontend/SKILL.md
  borrowed_reference_sources:
    - artifact_inspector_alternate
  host_sources:
    - src/main/direct/worldmanager/aro-kernel.js
    - src/main/direct/worldmanager/control-plane-store.js
    - src/main/direct/worldmanager/control-plane.js
    - src/main/direct/worldmanager/semantic-surface-compiler.js
    - src/main/direct/worldmanager/service.js
    - src/main.js
    - src/preload-codex-surface.js
    - src/renderer/world-manager-surface.html
    - src/renderer/world-manager-surface.js
    - src/renderer/world-manager-surface.css
  related_specs:
    - DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md
    - DIRECT_WORLD_MANAGER_PROJECT_GENESIS_AND_SUBSTRATE_SPEC.md
  runtime_observations:
    - SC6 semantic-surface browser regression
    - SC7 append-only registry and restart regression
    - SC7 exact-bound review/admission service regression
    - SC7 responsive headless-browser morph regression
```

Invariant:

```text
candidate and canonical AROs remain materially distinct
current and target remain separate exact identities
missing, unknown, contradicted, realized, and verified are not conflated
repository evidence and contradiction state remain same-context reachable
review and admission are separate gestures
admission mutates semantic registry only
no UI control authors reconstruction meaning or grants code-mutation authority
responsive layout preserves ARO identity, evidence, and admission gates
```

Morphable:

```text
tree versus graph versus comparison layout
branch expansion depth
compact versus expanded evidence labels
project-card versus global-atlas entry point
desktop split versus narrow stacked projection
compact navigator disclosure depth
```

Proof:

```text
npm run check:world-manager-aro-syntax
npm run direct:world-manager-aro
npm run direct:world-manager-aro-ui
npm run direct:world-manager-semantic-surface
npm run direct:world-manager-semantic-surface-ui
```

The proof covers:

```text
append-only candidate, review, admission, and canonical ARO revision lineage
restart persistence and semantic-event ledger integrity
required, possible, and counterfactual branch typing
one-to-many branch-to-source/test realization binding
current/target shared, exclusive, and conflicting branch comparison
source-revision drift producing stale realization bindings, not ARO erasure
review blocked without an exact live SemanticRegionBinding
admission blocked before both review gates
review explicitly not certifying semantic truth
admission mutating the semantic registry while executing no code or effect
candidate comparison, canonical tree, coverage graph, and current/target morphs
inline-control and navigator focus of the exact selected object
one expanded semantic object at a time inside a bounded scroll workbench
same-context evidence/contradiction inspection and responsive identity
zero browser console/page errors in the SC7 regression
```

### WM-SC7.1 — Automatic repository reconstruction producer

Status: implemented and locally regression-proven on 2026-07-30.

#### Purpose and trigger

SC7.1 connects repository initialization to the SC7 harness-internal
candidate-registration port:

```text
configured project + declared WSL/Windows/local substrate
→ resident substrate-native repository observation
→ bounded RepositorySemanticSnapshot
→ one required native semantic reconstruction action
→ one to three non-canonical AroReconstructionCandidates
→ existing SC7 evidence review and admission gates
```

The scheduling key is:

```text
projectId + repositorySnapshotDigest
```

The service observes each configured project once during a process bootstrap.
A restart observes again but reuses an already completed run when the bounded
repository digest is unchanged. A failed or remanded run does not loop
automatically; the operator may explicitly re-observe the project substrate
and retry, up to the bounded attempt cap for one snapshot.

#### Repository evidence packet

The resident workspace agent runs inside the project's declared substrate.
Therefore Windows projects are observed by the native Windows resident agent,
WSL projects by the WSL resident agent, and local projects by the local agent.
The control-plane database remains unified.

The observation contains:

```text
Git HEAD and branch when available
dirty-state, tracked-diff, untracked-state, and manifest digests
bounded repository-relative manifest
ranked bounded excerpts from source, test, documentation, and configuration
exact stable per-file refs whose digests change when source changes
explicit truncation and evidence-catalog completeness posture
```

Sensitive path classes such as `.env`, keys, certificates, `.ssh`, and Git
configuration are never admitted as excerpt evidence. Absolute workspace paths,
credentials, and secrets are excluded. Repository-relative paths and bounded
source excerpts remain durable control-plane evidence, but the renderer
projection contains only counts, Git identity, substrate kind, and exact
snapshot/run refs; it projects neither excerpts nor relative file paths.

An observation failure is itself represented truthfully as an unavailable
snapshot with an error witness. It is never rendered as an empty successful
repository.

#### Semantic action contract

The Direct reasoner must call exactly:

```text
wm_discharge_aro_reconstruction
```

Its form carries:

```text
repository summary
selection rationale
one to three open-vocabulary reconstruction objects
intensional branches and parent relations
typed semantic edges
realization bindings to supplied evidence keys
contradiction evidence keys
```

The schema validates discharge form, finite structural relations, exact
evidence-key bindings, and authority ceilings. It does not reverse-validate
semantic content against a closed feature taxonomy. Invalid action form is
remanded with no candidate. Provider/substrate failure is failed with no
candidate. No lexical or deterministic semantic fallback exists.

#### Durable run state and restart law

`AroReconstructionRun` is append-only by revision:

```text
scheduled → running → completed | remanded | failed
```

Each revision preserves the exact repository snapshot, attempt, request
manifest, validation witness, candidate refs, telemetry summary, error, and
predecessor digest. Scheduled or running state found after restart is revised
to a visible retryable failure. Terminal state is immutable.

The source ref identity is stable per project-relative file while its digest
tracks content. When newly observed exact evidence changes, affected canonical
realization bindings are revised to stale; the canonical ARO is not erased or
silently rewritten.

#### Morphic UX projection

The existing ARO inspector gains one provisional-status lane above candidate
review:

```text
scheduled/running
  background producer state + substrate/snapshot facts

completed
  repository summary + selection rationale + candidate count

failed/remanded
  exact failure posture + bounded re-observe/retry action
```

The retry action is bound to the exact current run digest. It can schedule a
new semantic reconstruction only; it cannot review, admit, mutate code, or
grant execution authority. Evidence review and semantic-registry admission
remain visually and causally separate.

The production surface subscribes to WorldManager transitions before
automatic work is queued and keeps that subscription for the surface
lifetime. Background scheduled, running, and terminal projections therefore
arrive even while no keyboard request is active. Canonical ARO and provisional
candidate counts remain separate rather than allowing an initial zero-count
projection to stay stale.

Morphic run stance:

```yaml
task_mode: implementation
execution_mode: standard
grounding_status: repo_grounded
implementation_inspection_status: implementation_inspected
profile:
  density: high
  navigation_mode: split_pane
  information_posture: evidence_first
  interaction_tempo: expert_fast_path
  salience_posture: evidence_and_status_prominent
  state_exposure: full_explicit
  command_posture: dual_lane
invariants:
  - provisional producer state never appears canonical
  - failure is not rendered as absence or success
  - retry remains separate from review and admission
  - exact evidence is same-context reachable before admission
  - no renderer-authored semantic reconstruction
  - no reconstruction path mutates code
```

Implementation:

```text
src/backend/wsl-agent.js
src/main/direct/worldmanager/aro-reconstruction-runtime.js
src/main/direct/worldmanager/control-plane-store.js
src/main/direct/worldmanager/control-plane.js
src/main/direct/worldmanager/service.js
src/main.js
src/preload-codex-surface.js
src/renderer/world-manager-surface.{html,js,css}
```

Proof:

```text
npm run check:world-manager-aro-reconstruction-runtime-syntax
npm run direct:world-manager-aro-reconstruction-runtime
npm run direct:world-manager-aro-reconstruction-runtime-ui
npm run direct:world-manager-aro
npm run direct:world-manager-aro-ui
```

The regressions cover native resident-agent observation, sensitive-evidence
exclusion, snapshot digest idempotency, automatic bootstrap scheduling,
completed-run reuse after restart, interrupted-run recovery, provider/action
remand, substrate failure, explicit retry, no renderer source/path leakage,
same-context status rendering, exact-run retry binding, and zero browser
console/page errors.

### WM-SC7.2 — Governed current-to-target definition bridge

Status: implemented and locally regression-proven on 2026-07-30.

SC7.2 makes the current/target comparison path operationally reachable without
collapsing target authorship into repository reconstruction or code mutation.
The operator focuses one exact canonical `current` ARO and writes a free-form
target intent in that semantic region. A fixed Direct target-definition role
may produce exactly one provisional `target` ARO candidate for the same
project and `conceptKey`.

The sequence is:

```text
canonical current ARO
  -> exact semantic-region binding
  -> user-authored target intent
  -> required native target-definition discharge
  -> provisional target candidate
  -> evidence + contradiction review
  -> explicit semantic-registry admission
  -> mechanically derived current/target comparison
  -> optional SC8.1 mutation-contract compilation
```

The target reasoner receives the current intensional branch tree and the
operator's target intent. It must preserve a current branch key when semantic
identity continues, may create genuinely new target branches, may omit removed
branches, and must include relevant alternatives and counterfactuals. Current
branch keys cited by the model are resolved mechanically to exact branch refs;
an invented key remands the result.

The target is semantic, not an implementation report:

```text
posture = target
realizationBindings = []
counterpartRef = exact canonical current ARO
reconstructionMethod = semantic_target_definition
lifecycle = candidate
canonical = false
```

`AroTargetDefinitionRun` is append-only:

```text
scheduled -> running -> completed | remanded | failed
```

Scheduling is idempotent by exact current-ARO digest, optional canonical target
baseline digest, and normalized target intent. Interrupted runs become visible
retryable failures after restart. A completed result is reused only while that
semantic baseline remains current; a revised intent or later target baseline
creates a distinct candidate lineage. Admission still uses the existing two
review gates and operator action. The semantic reasoner cannot admit its own
result.

The focused ARO workbench exposes comparison prerequisites rather than silently
hiding an empty section. Before a target exists, the canonical current ARO
contains the target-intent composer. After model discharge it directs the
operator to the provisional target candidate. After admission, the derived
comparison appears in the same object navigator and leads into SC8.1.
Candidate-only coverage witnesses remain inside the candidate card and are no
longer grouped under “Canonical registry and coverage.”

SC7.2 invariants:

```text
sourceInspectionEffect = false
realizationBindingEffect = false
canonicalAdmissionEffect = false during target definition
mutationContractEffect = false
workerLaunchEffect = false
workspaceMutationEffect = false
executionAuthorityGranted = false
semanticTruthValidated = false
rendererAuthoredTarget = false
```

Implementation:

```text
src/main/direct/worldmanager/aro-target-definition.js
src/main/direct/worldmanager/control-plane-store.js
src/main/direct/worldmanager/control-plane.js
src/main/direct/worldmanager/service.js
src/main.js
src/preload-codex-surface.js
src/renderer/world-manager-surface.{js,css}
```

Proof:

```text
npm run check:world-manager-aro-target-definition-syntax
npm run direct:world-manager-aro-target-definition
npm run direct:world-manager-aro-target-definition-ui
```

The regressions prove exact-region binding, open-vocabulary target discharge,
shared/new/removed branch comparison, invented-current-branch remand, durable
run and candidate persistence, idempotent reuse, restart recovery, explicit
review/admission gates, visible comparison prerequisites, focused candidate
handoff, truthful registry grouping, and comparison reachability after
admission.

### WM-SC8 — ARO mutation lane

SC8 is split so semantic intent cannot silently become execution authority:

```text
SC8.1  exact ARO delta -> provisional mutation contract
SC8.2  realization-context import and ARO-to-code mapping
SC8.3  bounded worker constitution and execution handoff
SC8.4  realization verification and coverage witnesses
SC8.5  drift assessment, semantic closure, and governed admission
```

#### WM-SC8.1 — Provisional mutation-contract compiler

Status: implemented and locally regression-proven on 2026-07-30.

SC8.1 starts only from an exact canonical current/target comparison already
visible in the focused ARO workbench. The request must carry the exact
`SemanticRegionBinding`, comparison id/digest, current ARO ref, and target ARO
ref. A stale region, comparison, or ARO binding fails before provider launch.

The compiler separates deterministic and semantic work:

```text
harness:
  validates exact refs
  derives target-only/current-only/conflict/coverage-gap sets
  computes the operative target branch closure

Direct semantic role:
  authors open-vocabulary implementation obligations
  authors preservation constraints
  authors verification requirements and evidence kinds
  records assumptions and unresolved questions

harness:
  validates exact branch selectors and dependency keys
  requires every operative target branch to be covered
  requires every current-only branch to be preserved or addressed
  persists the provisional contract and terminal run
```

The role must call exactly:

```text
wm_discharge_aro_mutation_contract
```

The schema constrains discharge form, exact semantic bindings, finite
relations, and authority ceilings. It does not impose a closed taxonomy on
obligation kinds, verification kinds, priorities, strategies, assumptions, or
questions. Invalid form or incomplete delta coverage is remanded. Provider
failure is failed. Neither case registers a contract.

`AroMutationContract` is append-only by revision and explicitly records:

```text
exact comparison/current/target refs
optional exact repository-snapshot provenance
mechanically derived AroMutationDelta
implementation obligations with exact branch refs
preservation constraints
verification requirements
assumptions and unresolved questions
lifecycle = candidate
reviewState = pending
realizationContextState = not_imported_sc8_1
workerLaunchState = unavailable_sc8_1
```

`AroMutationCompilationRun` is also append-only:

```text
scheduled -> running -> completed | remanded | failed
```

Scheduling is operator-triggered and idempotent by exact comparison digest. A
completed result is reused. Failed/remanded runs require explicit exact-run
retry and stop after the bounded attempt cap. Scheduled/running state recovered
after restart becomes a visible retryable failure.

The focused comparison workbench preserves evidence-before-action topology:

```text
current/comparison/target/snapshot digest strip
current/target semantic delta
compilation state or failure
contract summary and strategy
implementation obligations
verification requirements
preservation/assumption/question detail
explicit disabled worker-launch boundary
```

The object navigator remains compact and only one exact semantic object is
expanded. Narrow layouts stack the navigator above a bounded focused workbench;
they do not flatten every ARO and contract into one global vertical ledger.

SC8.1 invariants:

```text
sourceInspectionEffect = false
workerLaunchEffect = false
workspaceMutationEffect = false
canonicalAdmissionEffect = false
executionAuthorityGranted = false
semanticTruthValidated = false
rendererAuthoredContract = false
```

The contract is semantic advice about what a later realization task must
achieve. It is not proof that the strategy is true, that code locations exist,
that verification passed, or that implementation is authorized.

Implementation:

```text
src/main/direct/worldmanager/aro-mutation-contract.js
src/main/direct/worldmanager/control-plane-store.js
src/main/direct/worldmanager/control-plane.js
src/main/direct/worldmanager/service.js
src/main.js
src/preload-codex-surface.js
src/renderer/world-manager-surface.{js,css}
```

Proof:

```text
npm run check:world-manager-aro-mutation-contract-syntax
npm run direct:world-manager-aro-mutation-contract
npm run direct:world-manager-aro-mutation-contract-ui
```

The regressions cover deterministic delta derivation, complete branch coverage,
open-vocabulary semantic discharge, invalid-action remand, provider failure,
durable run/contract persistence, exact-comparison reuse, stale-region
rejection, restart recovery, exact-run retry, focused workbench rendering,
responsive identity preservation, disabled worker launch, and zero source,
workspace, canonical, or authority effects.

#### WM-SC8.2 — Realization-context import and ARO-to-code mapping

Status: implemented and locally regression-proven on 2026-07-31.

SC8.2 is the read-only realization bridge. It starts from one exact SC8.1
mutation contract and imports only source context selected from that contract's
operative branch and obligation closure. Code is admitted as evidence of a
realization attempt; it does not replace the ARO as the object that determines
what must change.

The pipeline is:

```text
exact candidate mutation contract
  -> derive bounded source-path request from exact ARO realization bindings
  -> substrate-native read-only source import
  -> immutable realization-context import
  -> required Direct semantic mapping discharge
  -> exact obligation/branch <-> file/symbol/range bindings
  -> ambiguity, omission, and freshness witnesses
  -> candidate mapping witness
```

The harness owns:

```text
contract/current/target/snapshot identity validation
bounded path selection
path traversal, sensitive-path, symlink, binary, and size rejection
fresh source digests and line bounds
exact obligation and evidence-key resolution
complete obligation-accounting validation
append-only persistence and retry state
all authority ceilings
```

The Direct semantic mapper owns:

```text
which imported source locations realize each semantic obligation
mapping kind and rationale
whether each obligation is mapped, partial, unmapped, or ambiguous
open-vocabulary ambiguity and omission statements
assumptions and unresolved questions
```

The role must call exactly:

```text
wm_discharge_aro_realization_mapping
```

Its schema constrains the mapping form, exact obligation/evidence selectors,
finite source ranges, and authority posture. It does not impose a closed
taxonomy on symbols, rationales, ambiguity meanings, omission meanings,
assumptions, or questions. Every implementation obligation must be represented
exactly once. Invented obligations, evidence keys, paths, or out-of-range source
locations remand the run.

`AroRealizationContextImport` is immutable and records:

```text
exact contract/comparison/current/target/repository refs
requested, selected, rejected, and omitted path witness
bounded source evidence with relative paths, exact digests, and line bounds
repository and source-identity freshness
sourceInspectionEffect = true
workspaceMutationEffect = false
```

`AroRealizationMappingWitness` remains a candidate and records:

```text
exact context-import and contract refs
one mapping state for every implementation obligation
many-to-many source bindings with exact file/symbol/range identity
mapped/partial/unmapped/ambiguous counts
ambiguity and omission witnesses
freshness posture
reviewState = pending
workerLaunchState = unavailable_sc8_2
```

`AroRealizationMappingRun` is append-only:

```text
scheduled -> running -> completed | remanded | failed
```

Scheduling is operator-triggered and idempotent by exact contract digest plus
fresh imported-source identity. Failed or remanded runs require an explicit
exact-run retry. Interrupted scheduled/running state becomes a visible,
retryable failure after restart.

Morphic UX bundle:

```text
task_mode = implementation
execution_mode = standard
grounding_status = repo_grounded
implementation_inspection_status = implementation_inspected

reference profile = artifact_inspector_reference
density = high
navigation_mode = split_pane
information_posture = evidence_first
interaction_tempo = expert_fast_path
salience_posture = evidence_and_status_prominent
state_exposure = full_explicit
command_posture = dual_lane
```

Invariant topology:

```text
bounded workbench root:
  focused ARO comparison object

evidence region:
  exact semantic/source reference strip
  imported-source inventory
  obligation-to-source mapping matrix
  ambiguity/omission/freshness diagnostics

advisory action lane:
  import bounded realization context
  exact-run retry

handoff boundary:
  worker launch remains visible and disabled until SC8.3

trust-boundary state surfaces:
  candidate
  partial
  ambiguous
  stale
  failed/remanded
```

Required evidence remains same-context reachable inside the focused comparison
workbench. Narrow layouts may stack source inventory, mapping evidence, and
diagnostics, but may not replace the workbench, hide the authority boundary, or
style a candidate/ambiguous mapping as authoritative.

SC8.2 invariants:

```text
sourceInspectionEffect = true only through bounded read-only import
workerLaunchEffect = false
workspaceMutationEffect = false
canonicalAdmissionEffect = false
executionAuthorityGranted = false
semanticTruthValidated = false
mappingAuthoredByRenderer = false
```

The mapping witness is evidence about where a later worker should inspect or
edit. It is not evidence that the proposed change is correct, that source
mutation is authorized, or that the target ARO has been realized.

Implementation:

```text
src/backend/wsl-agent.js
src/main/direct/worldmanager/aro-realization-mapping.js
src/main/direct/worldmanager/control-plane-store.js
src/main/direct/worldmanager/control-plane.js
src/main/direct/worldmanager/service.js
src/main.js
src/preload-codex-surface.js
src/renderer/world-manager-surface.{js,css}
```

Proof:

```text
npm run check:world-manager-aro-realization-mapping-syntax
npm run direct:world-manager-aro-realization-mapping
npm run direct:world-manager-aro-realization-mapping-ui
npm run direct:container-ui-test
```

The backend regression proves exact path derivation from target ARO realization
bindings, bounded immutable import, idempotent source-identity reuse, exact
obligation accounting, invented-evidence remand, append-only run/witness
persistence, stale-region rejection before source inspection, completed-run
reuse, restart recovery, and zero worker/workspace/canonical/authority effects.
The UI regression proves exact-contract dispatch, renderer-safe source
inventory without excerpts, same-context file/symbol/range mapping,
failure/retry lineage, one focused semantic object, responsive morphology, and
an explicit disabled SC8.3 handoff. The Docker/Xvfb production smoke also
passes with realization-mapping runs included in provider-effect accounting
and with zero accidental provider, canonical, or workspace effects.

#### WM-SC8.3 — Bounded worker constitution and execution handoff

Status: implemented and locally regression-proven on 2026-07-31.

SC8.3 turns one reviewed SC8.1 contract plus one reviewed SC8.2 realization
mapping into a single-use Direct worker handoff. It does not collapse evidence
review, provider launch, and workspace-effect approval into one button.

The governed sequence is:

```text
exact contract + exact mapping + exact imported source identity
  -> refresh the mapped source identity
  -> record operator evidence-review receipt
  -> compile immutable worker constitution
  -> inspect capability, budget, completion, and authority envelopes
  -> explicit single-use operator authorization
  -> create exact ARO WorkThread
  -> start one native Direct implementation-worker turn
  -> retain per-call read / patch / command approval gates
```

The worker constitution binds:

```text
contract, mapping, context import, comparison, current ARO, target ARO
project and declared substrate
implementation obligations and exact source ranges
preservation constraints and verification requirements
trusted worker role template
available Direct tool capabilities
one-turn / bounded-tool budget
no-self-certification completion contract
single-use start authority and per-call effect approval law
```

Review and authorization are different artifacts:

```text
AroWorkerReviewReceipt:
  records that the operator inspected the exact contract and mapping
  records refreshed source-identity and capability gates
  grants no provider or workspace authority

AroWorkerConstitution:
  compiles the reviewed semantic/source inputs into a trusted Direct context
  remains immutable and inspectable
  may be ready or blocked

AroWorkerAuthorizationReceipt:
  cites one exact ready constitution and one explicit operator action
  authorizes one provider worker start
  does not authorize a patch, command, remote effect, closure, or admission

AroWorkerHandoffRun:
  scheduled -> running -> handed_off | blocked | failed
  records the native worker session, worker turn, WorkThread, and start witness
  treats restart during an uncertain start as failed and non-replayable
```

The native Direct implementation lane remains the executor. SC8.3 does not
invent a parallel patch mechanism. A worker may propose `read_file`,
`apply_patch`, and `run_command` only when the project runtime proves those
capabilities. Every resulting call still enters its existing action-specific
approval gate. The handoff acknowledgment therefore truthfully records:

```text
workerLaunchEffect = true after native start acknowledgment
providerTurnStartEffect = true after native start acknowledgment
workspaceMutationEffect = false
remoteMutationEffect = false
canonicalAdmissionEffect = false
semanticTruthValidated = false
closureCertified = false
```

Morphic UX bundle:

```text
task_mode = implementation
execution_mode = standard
grounding_status = repo_grounded
implementation_inspection_status = implementation_inspected

reference profile = artifact_inspector_reference
density = high
navigation_mode = split_pane
information_posture = evidence_first
interaction_tempo = expert_fast_path
salience_posture = evidence_and_status_prominent
state_exposure = full_explicit
command_posture = dual_lane
```

Invariant topology:

```text
bounded workbench root:
  focused current/target ARO comparison

evidence region:
  exact contract / context / mapping lineage
  refreshed source-identity gate
  obligation-to-source mapping
  preservation and verification requirements

advisory lane:
  review exact evidence and compile constitution
  inspect capability, budget, completion, and blockers

authority lane:
  authorize exactly one worker handoff
  show native worker / WorkThread lineage
  show pending per-call tool approvals

trust-boundary surfaces:
  unreviewed
  blocked
  ready for authorization
  starting
  handed off
  failed
  effect approval pending
```

Required evidence remains same-context reachable before either the start
authorization or a later effect approval. The UI only expresses receipts
created by the service; it cannot author the worker constitution, choose tools,
change the source bindings, or mint authority.

SC8.3 invariants:

```text
rendererAuthoredWorkerConstitution = false
workerSelfAuthorizesStart = false
workerStartWithoutReviewedExactInputs = false
workerStartWithoutFreshMappedSources = false
workerStartWithoutProjectCapability = false
workspaceMutationFromHandoff = false
effectApprovalInheritedFromHandoff = false
remoteMutationEffect = false
canonicalAdmissionEffect = false
semanticTruthValidated = false
closureCertified = false
```

Implementation:

```text
src/main/direct/worldmanager/aro-worker-handoff.js
src/main/direct/worldmanager/control-plane-store.js
src/main/direct/worldmanager/control-plane.js
src/main/direct/worldmanager/service.js
src/main/direct/bridge/worker-start.js
src/main/direct/controller/live-text-controller.js
src/main.js
src/preload-codex-surface.js
src/renderer/world-manager-surface.{js,css}
```

Proof:

```text
npm run check:world-manager-aro-worker-handoff-syntax
npm run direct:world-manager-aro-worker-handoff
npm run direct:world-manager-aro-worker-handoff-ui
```

The backend regression proves fresh exact-source review, capability
observation, immutable constitution compilation, explicit single-use
authorization, exact WorkThread and native worker binding, idempotent repeated
delivery, and non-replay of an uncertain interrupted start. The UI regression
proves evidence-before-authority ordering, exact semantic-region binding,
renderer-safe constitution projection, distinct start and per-call effect
gates, worker lineage, and same-context responsive morphology. Neither proof
claims a workspace mutation, remote effect, canonical admission, semantic
truth validation, or closure.

#### WM-SC8.4 — Realization evidence acquisition

Status: implemented and locally regression-proven on 2026-07-31.

SC8.4 imports what the exact SC8.3 worker actually did. It does not create a
second tool executor and does not infer semantic success from a green command.

The governed sequence is:

```text
exact handed-off worker run
  -> read exact native Direct session and turn
  -> import recorded read / patch / command results
  -> import workspace-effect summaries created by approved effects
  -> observe exact mapped repository after-state
  -> classify package-script command results as test/verification evidence
  -> compute mechanical required-evidence-kind coverage
  -> persist immutable evidence bundle and append-only acquisition run
  -> project renderer-safe evidence inventory
```

The bounded aggregate is:

```text
AroExecutionEvidenceBundle:
  exact handoff / constitution / contract / mapping lineage
  WorkerTurnWitness
  ToolResultWitness[]
  WorkspaceEffectWitness[]
  RepositoryAfterStateWitness
  VerificationCoverageWitness[]
  acquisition posture
  observed effect truth
```

Existing artifacts are aligned rather than reimplemented:

```text
Direct session and turn store
  owns provider and turn lifecycle truth

Direct read / patch / command result artifacts
  own tool result truth

DirectWorkspaceEffectSummary
  owns changed-path, policy, and recovery evidence

repositoryRealizationContext observation
  owns fresh mapped-source and repository identity

SC8.4 evidence bundle
  binds those artifacts to the exact ARO worker lineage
  computes only mechanical evidence-kind presence
```

An acquisition run is read-only and repeatable while the worker is active:

```text
scheduled -> running -> observing | acquired | failed

observing:
  worker turn or effect sequence is still active
  bundle is a truthful intermediate snapshot

acquired:
  exact worker turn is terminal
  current tool/effect/repository evidence has been captured

failed:
  acquisition failed visibly
  no execution or closure authority is created
```

`acquired` means evidence collection completed. It does not mean the
implementation is correct. Required evidence coverage is mechanical:

```text
observed:
  at least one exact witness has the requested evidence kind

missing:
  no exact witness has the requested evidence kind

ambiguous:
  evidence exists but is truncated, redacted, policy-blocked, or incomplete
```

Workspace effects are reported truthfully:

```text
workspaceMutationObserved = any recorded patch or command effect
workspaceMutationAuthorizedBySC8_4 = false
remoteMutationObserved = false
canonicalAdmissionEffect = false
semanticTruthValidated = false
closureCertified = false
```

Morphic UX bundle:

```text
task_mode = implementation
execution_mode = standard
grounding:
  doctrine = borrowed
  reference_family = borrowed
  host_repo = repo_grounded
  implementation = static_inspected
  runtime = headless_observed through the SC8.4 UI regression

base_profile = artifact_inspector_reference
derivative_profile = direct_aro_runtime_witness_workbench
profile_status = adopted_local

density = high
navigation_mode = split_pane
information_posture = evidence_first
interaction_tempo = expert_fast_path
salience_posture = evidence_and_status_prominent
state_exposure = full_explicit
command_posture = dual_lane
```

Invariant topology:

```text
same bounded ARO workbench
  evidence region:
    worker turn posture and final-output witness
    read / patch / command result inventory
    workspace-effect and policy evidence
    mapped repository before/after identity
    required evidence-kind coverage

  advisory lane:
    refresh/import execution evidence
    inspect missing, ambiguous, or active evidence

  authority lane:
    existing per-call read / patch / command decisions only

  deferred closure boundary:
    no "implementation verified" or admission control in SC8.4
    visibly points to SC8.5 semantic comparison
```

Primary evidence remains same-context reachable. The focused ARO object uses
four explicit semantic lenses — turn, tools/effects, repository, and coverage
— and renders one evidence panel at a time. At narrow widths the lens controls
reflow inside the same object; evidence does not move to a separate route or
become one long permanent stack.

Implemented substrate:

```text
aro-execution-evidence.js
  compiles renderer-safe immutable witness bundles
  computes mechanical evidence-kind presence only

wm_aro_execution_evidence_bundles
  immutable capture artifacts

wm_aro_execution_evidence_runs
  append-only scheduled/running/observing/acquired/failed lifecycle

world-manager:capture-aro-execution-evidence
  exact semantic-region-bound read-only acquisition IPC

ARO focused workbench
  compact summary plus Turn / Tools & effects / Repository / Coverage lenses
```

Local proof commands:

```bash
npm run direct:world-manager-aro-execution-evidence
npm run direct:world-manager-aro-execution-evidence-ui
```

SC8.4 invariants:

```text
rendererAuthoredEvidence = false
evidenceAcquisitionExecutesTool = false
evidenceAcquisitionMutatesWorkspace = false
greenCommandMeansSemanticSuccess = false
workerFinalMessageMeansClosure = false
missingEvidenceRenderedAsSuccess = false
workspaceEffectHidden = false
remoteMutationEffect = false
canonicalAdmissionEffect = false
semanticTruthValidated = false
closureCertified = false
```

#### WM-SC8.5 — Semantic verification and closure candidacy

Status: implemented and locally regression-proven on 2026-07-31.

SC8.5 reasons over the immutable SC8.4 evidence bundle. It is not a second
executor, it does not read arbitrary source, and it does not promote a green
command or a worker final message into semantic truth.

The governed sequence is:

```text
exact acquired SC8.4 evidence bundle
  -> recover exact contract / current / target / comparison lineage
  -> invoke one fixed semantic-verification role
  -> discharge assessments for obligations, verification claims,
     preservation constraints, and target branches
  -> materialize omitted contract objects as explicit indeterminate rows
  -> bind semantic claims back to exact witness kinds
  -> compute a deterministic fail-closed closure-candidate gate
  -> persist immutable assessment and append-only verification run
  -> optionally register scoped OpenDecision artifacts
  -> render one focused verification workbench
```

The durable objects are:

```text
AroSemanticVerificationAssessment:
  exact evidence / handoff / constitution / contract / context lineage
  exact current / target / comparison / mapping lineage
  ObligationAssessment[]
  VerificationClaimAssessment[]
  PreservationAssessment[]
  BranchAssessment[]
  DriftFinding[]
  ContinuationPath[]
  overall semantic posture
  model-authored closure recommendation

AroClosureCandidate:
  exact assessment and evidence refs
  deterministic readiness gate
  blocking finding and indeterminate-object counts
  reviewRequired = true
  canonicalAdmissionAvailable = false
  closureCertified = false

AroSemanticVerificationRun:
  scheduled -> running -> completed | remanded | failed
  exact evidence-bundle digest
  append-only revision lineage
  retryable remand/failure
```

The required native semantic action is
`wm_discharge_aro_semantic_verification`. Its schema constrains the discharge
form, not the verifier's semantic vocabulary. It requires typed collections
and exact contract keys, but prose rationales, drift categories, blindspots,
and continuation proposals remain open-ended.

Unknown object keys do not silently attach to a known contract object. They
are retained as unmapped semantic findings. Missing expected keys do not
invalidate an otherwise useful discharge; the harness creates an
`indeterminate` assessment for each omitted object. This preserves the law:

```text
semantic reasoner:
  authors meaning

harness:
  preserves identity, coverage, lineage, and authority boundaries
```

The deterministic closure gate is deliberately stricter than the semantic
recommendation:

```text
ready_for_review only if:
  evidence bundle is acquired and terminal
  every implementation obligation is assessed satisfied
  every verification requirement is assessed supported
  every preservation constraint is assessed preserved
  every required target branch is assessed realized
  no critical/high blocking drift exists
  no required assessment is indeterminate or contradicted
  SC8.4 reports no ambiguity or missing required evidence kind

otherwise:
  continue_implementation | remand_for_evidence | reject_realization
```

Even `ready_for_review` is only a candidate posture:

```text
semanticTruthAssessed = true
semanticTruthCanonical = false
reviewRequired = true
canonicalAdmissionEffect = false
canonicalAdmissionAvailable = false
closureCertified = false
```

Verifier-authored questions may be promoted to canonical `OpenDecision`
artifacts. They are project-scoped, provenance-bound to the assessment and
evidence bundle, and use the existing SC5 semantic-relay transition. They do
not resolve themselves and do not mint execution or admission authority.

Morphic UX bundle:

```text
task_mode = implementation
execution_mode = standard
grounding:
  doctrine = borrowed
  reference_family = borrowed
  host_repo = repo_grounded
  implementation = static_inspected
  runtime = headless_observed through the SC8.5 UI regression

base_profile = artifact_inspector_reference
derivative_profile = direct_aro_semantic_verification_workbench
profile_status = adopted_local

density = high
navigation_mode = split_pane
information_posture = evidence_first
interaction_tempo = expert_fast_path
salience_posture = evidence_and_status_prominent
state_exposure = full_explicit
command_posture = dual_lane
```

Invariant topology:

```text
same focused ARO workbench
  evidence region:
    exact SC8.4 bundle remains directly reachable

  semantic assessment region:
    summary posture
    obligation assessments
    semantic coverage for verification claims and target branches
    drift findings and continuation paths

  advisory lane:
    run or retry semantic verification
    focus a generated OpenDecision in the existing Decision Dock

  authority lane:
    canonical admission unavailable in SC8.5
    no success-colored admission control
```

The workbench uses Summary / Obligations / Coverage / Drift & next lenses and
renders one lens at a time. The same assessment identity is preserved through
every lens. A provisional `verified` assessment must remain visually distinct
from canonical admission.

SC8.5 invariants:

```text
rendererAuthoredAssessment = false
semanticVerificationExecutesTool = false
semanticVerificationReadsNewSource = false
semanticVerificationMutatesWorkspace = false
greenCommandMeansSemanticSuccess = false
workerFinalMessageMeansClosure = false
omittedContractObjectSilentlyPasses = false
semanticRecommendationOverridesHarnessGate = false
openDecisionGrantsAuthority = false
canonicalAdmissionEffect = false
canonicalAdmissionAvailable = false
closureCertified = false
```

Implemented substrate:

```text
aro-semantic-verification.js
  fixed semantic discharge contract
  exact witness binding
  omission-to-indeterminate materialization
  deterministic closure-candidate gate

wm_aro_semantic_verification_assessments
wm_aro_closure_candidates
wm_aro_semantic_verification_runs
  immutable result artifacts and append-only execution lineage

world-manager:verify-aro-realization
  exact semantic-region-bound advisory IPC

ARO focused workbench
  Summary / Obligations / Coverage / Drift & next lenses
  generated-decision focus
  visibly unavailable canonical-admission lane
```

Local proof commands:

```bash
npm run direct:world-manager-aro-semantic-verification
npm run direct:world-manager-aro-semantic-verification-ui
```

### WM-SC9 — Thought brushes and ContextCanvas

Implemented:

```text
thought-brush.js
  one trusted registry with 11 fixed transformation constitutions
  interpolate / switch / vertical ascent / vertical descent
  horizontal analogy / horizontal contrast
  causal trace / effect projection
  counterfactual branch / assumption inversion / constitutional overlay
  one required native wm_discharge_thought_brush action
  open semantic result vocabulary with exact source-key validation
  mechanical preservation checks for known contradictions and discriminators

ThoughtBrushRequest / ThoughtBrushResult / ThoughtBrushStroke
  exact current-canvas and source-catalog binding
  explicit altitude, attention budget, preservation rules, and target project
  temporary_canvas persistence posture
  worldEffect = none
  no tool, workspace, canonical, or external authority

wm_thought_brush_strokes
  immutable terminal semantic strokes

wm_context_canvas_revisions
  append-only current/superseded revision lineage
  composition through successive brush revisions
  switch mechanically replaces project-scoped anchors, objects, and stack
  undo restores a prior posture as a new revision
  counterfactual and inverted results remain temporary

candidate-insight extraction
  explicit exact-canvas-bound action
  materializes only an ordinary AroReconstructionCandidate
  reuses existing evidence/contradiction review and ARO admission gates
  no canonical effect occurs during extraction

world-manager:apply-thought-brush
world-manager:undo-context-canvas
world-manager:extract-context-canvas-insight
  exact current-canvas-bound production IPC

direct_context_canvas_workbench
  Morphic derivative of artifact_inspector_reference
  compact preview-first palette
  Canvas / Brush stack / Insights focused lenses
  visible temporary/no-world-effect posture
  exact-bound Apply / Undo / Extract controls
  extraction focuses the ordinary ARO evidence and admission lane
```

`switch` is a context replacement, not transcript or canvas append. Stable
world/pinned sources may remain; prior project-scoped temporary objects and
brush strokes do not. `undo` is itself append-only: it never deletes evidence
or rewrites an older canvas revision.

The semantic action schema types the discharge form. It does not impose a
closed taxonomy on result-object kinds, labels, relations, or interpretations.
The harness validates exact source identity, preservation obligations, switch
scope, and effect boundaries. An ARO-shaped insight is additionally normalized
to the existing intensional branch/edge form only when the user explicitly
extracts it for normal governance.

Local proof commands:

```bash
npm run direct:world-manager-thought-brush
npm run direct:world-manager-thought-brush-ui
```

### WM-SC10 — Complete unified UX projection

Status: implemented and locally regression-proven.

```text
operational meta-context ribbon
minimal thought palette
context canvas
settlement/shelf/import/ARO/brush semantic anatomy
same-context evidence and admission gates
keyboard and voice parity over the same typed tools
```

Implementation stance:

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: runtime_exercised
  runtime: live_observed
profile_lineage:
  base_profile: artifact_inspector_reference
  derivative_profile: unified_semantic_anatomy_workbench
  profile_status: proposed_local
```

`live_observed` here refers to the rendered Electron-compatible surface
exercised in headless Chromium with deterministic production projections; it
is not a real-account live voice or provider witness.

The unified compiler is a disposable read projection over the existing
canonical stores. It does not introduce another semantic owner:

```text
direct_unified_worldmanager_projection@1
├─ direct_operational_meta_context_ribbon@1
│  ├─ exact active event
│  ├─ scope
│  ├─ semantic lane
│  ├─ abstraction altitude
│  ├─ import freshness / shelves / cost / omissions
│  └─ temporary brush and ContextCanvas posture
│
├─ direct_semantic_anatomy_projection@1
│  └─ one direct_semantic_anatomy_event_projection@1 per ingress
│     ├─ unified outcome
│     ├─ provenance
│     ├─ governance
│     ├─ compiled agent
│     ├─ execution
│     └─ substrate
│
└─ direct_typed_interaction_parity_projection@1
   ├─ keyboard
   ├─ pointer
   └─ voice
```

Every depth carries the same exact event ID and digest. Depth adds causal and
constitutional typed refs; it does not reinterpret or replace the visible
event. Governance composes settlement, routing, shelves, imports, and
selection witnesses. Compiled-agent depth exposes the manager context, task
constitution, instantiation, and agent-world compilation. Execution and
substrate depths compose typed AgentResults, reconciliation, ARO/realization
witnesses, graph refs, repository observations, and temporary brush/canvas
lineage where available. Private reasoning remains excluded.

The frontend remains calm by default:

```text
conversation
+ compact scope / lane / altitude ribbon
+ context and active-brush posture
+ one "Inspect semantic anatomy" affordance on the exact visible event
```

Opening anatomy is a bounded focus expansion in the same workbench. Six
keyboard-reachable depth controls project the same event. Witness refs and the
admission gate remain visible together. Escape restores the ordinary
workbench. Narrow viewports stack the evidence columns and reduce the depth
navigator to two columns without changing identity or removing the gate.

Modality parity is contract parity, not transport counterfeiting. Keyboard,
pointer, and voice invocations name the same request schema for each typed
tool:

```text
submit message
inspect semantic anatomy
transition an open decision
apply a thought brush
extract a canvas insight
```

Keyboard and pointer transports are available. The voice projection reports
`transport_deferred` until the later live voice bridge is attached; it does
not claim voice availability merely because the semantic contract is ready.
No modality mints authority.

Authority boundary:

```text
the compiler reads renderer-safe projections
inspection changes disclosure only
the ribbon and anatomy perform no tool or workspace effect
same-context evidence does not admit its subject
candidate, validated, canonical, executing, and completed remain distinct
```

Local proof commands:

```bash
npm run direct:world-manager-unified-projection
npm run direct:world-manager-unified-projection-ui
```

## Acceptance Games

### Semantic ingress

```text
novel social utterance absent from the test corpus remains conversational
project seed without project vocabulary can enter genesis
negated project language does not enter genesis
hypothetical project discussion does not automatically create a project
ambient project focus does not capture unrelated conversation
explicit project scope constrains but does not counterfeit meaning
mixed global/project/conversational utterance produces child settlements
semantic ingress outage creates no lexical fallback or effect
```

Tests may enumerate utterances. Production behavior may not enumerate the
category.

### Semantic history

```text
one chat contributes to several semantic shelves
one project history spans several chats
reclassification changes shelves without changing raw events
old context manifests remain exact after reclassification
cross-project private relations never leak through a shared chat
```

### Context tool

```text
Project X task imports Project X shelves and excludes irrelevant Project Y logs
token caps produce visible truncation and omission counts
stale shelf revisions invalidate cached context
raw transcript is available only through explicit bounded evidence import
context import changes epistemic state but grants no tool or world authority
```

### Decision transitions

```text
one option-selection click cannot resolve a decision
confirmation must cite the current decision, exact option, and expected revision
idempotent replay returns the same receipt without another revision
an unsatisfied binding dependency yields a visible blocked receipt
mechanical resolution updates the decision shelf but executes no consequence
semantic relay preserves exact user input and re-enters ordinary ingress
evidence request does not manufacture evidence
authority request does not grant authority
resolved-decision context dependencies become stale before reuse
```

### ARO

```text
an absent semantic branch is visible despite complete code branch coverage
current and target ARO conflict remains explicit
one branch maps to several source and test realizations
source mutation without updated realization evidence becomes stale
verification can fail without falsely declaring the target ARO wrong
```

### Thought tools

```text
switch replaces rather than appends project context
vertical ascent preserves unresolved lower-level contradictions
horizontal analogy preserves policy and substrate differences
counterfactual results remain temporary
undo restores the prior canvas
brush result cannot mutate code or worldstate without a separate admitted path
```

### UX and authority

```text
default conversation remains calm
active lane, scope, and altitude remain visible
expanded context shows source shelves, cost, freshness, and omissions
ARO candidate and canonical target look materially different
realized and verified look materially different
thought canvas and admitted worldstate look materially different
required evidence remains same-context reachable before mutation or admission
```

## Non-Goals

This design does not:

```text
store private chain-of-thought
declare model semantic judgments infallible
replace exact runtime enforcement with model compliance
make every conversational turn durable canonical worldstate
load all code or all project history by default
claim that documentation alone defines the target ARO
claim that code alone defines the target ARO
allow a thought brush to mint authority
collapse evidence, validation, realization, and admission
```

## Final Architecture

```text
user utterance
  -> immutable ingress evidence
  -> fixed WorldManager semantic-ingress constitution
  -> typed semantic settlement
     ├─ answer conversationally
     ├─ delegate to bounded role
     ├─ split into child events
     ├─ clarify
     └─ remand
  -> versioned semantic-history relations
  -> mechanically materialized semantic shelves
  -> explicit ContextImport tool calls
  -> operational meta-context manifest
  -> ARO-centered reasoning at the selected altitude
  -> optional thought-brush transformations on a temporary ContextCanvas
  -> realization evidence import when substrate work is required
  -> ARO mutation contract and bounded execution
  -> semantic and runtime verification
  -> candidate result
  -> evidence-visible WorldManager/operator admission
  -> canonical semantic state and updated realization lineage
```

Compactly:

```text
meaning is settled semantically
history is organized relationally
context is acquired instrumentally
reasoning is anchored intensionally
creativity is navigated geometrically
realization is changed causally
truth is admitted constitutionally
```
