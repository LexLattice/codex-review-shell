# Recursive ODEU Control Method for WorldManager

**Status:** implementation handoff / architecture synthesis v0.1  
**Primary target:** `codex-review-shell-codex-direct-chatgpt-harness`  
**Adjacent governed-runtime substrate:** ADEU Studio `agentic_de_*` continuation, communication, permission, and effect artifacts  
**First proof case:** initialize a new project, derive its project constitution, recommend and bind its execution substrate, and return a versioned project state without losing semantic or authority provenance

---

## 1. Direct thesis

WorldManager should use the same typed recursive ODEU method both:

1. to reason about and advance the user’s projects; and
2. to develop and revise WorldManager itself.

The shared architecture is:

```text
present focus seed
  -> resolve jurisdiction and owner
  -> construct local ODEU
  -> unfold four source-slot-specific directions
       back  = causal ancestry / prerequisites / source basis
       front = purpose / intended future / downstream effects
       up    = governing abstraction / shared ancestry / scope owner
       down  = realization / substrate / implementation mechanism
  -> construct ODEU for every admitted child option
  -> recurse under explicit budget and closure contracts
  -> canonicalize shared endpoints into a DAG
  -> audit shared assumptions through the upward path
  -> diff and join child returns
  -> fold a typed delta into a new parent revision
  -> close, remand, escalate, or reopen the parent
```

The reasoner remains semantically open inside each node. The transition grammar, authority boundaries, return law, and persistence topology remain structurally closed.

Compact law:

> **The reasoner authors meaning; the typed DAG governs how meaning may unfold, meet, and return.**

For WorldManager specifically:

> **WorldManager owns jurisdiction, project/world-state revision, and recursive control—not arbitrary object-level truth and not ambient execution authority.**

---

## 2. Why WorldManager needs the method at two levels

Without recursive control, the project agent and its builders fail in the same structural way.

At project runtime:

```text
local request or implementation observation
  -> salient interpretation
  -> premature project-state mutation
```

During WorldManager development:

```text
local defect or awkward workflow
  -> salient patch idea
  -> premature control-plane mutation
```

Examples:

```text
Runtime:
“the user mentioned this while project X was active”
  -> silently bind the message to project X

Development:
“Codex tried a missing tool and then fell back”
  -> patch one fallback path locally
```

The lawful route is instead:

```text
observation
  -> private candidate diagnosis
  -> local ODEU
  -> back/front/up/down expansion
  -> shared endpoint and ancestry audit
  -> architecture or project-law proposal
  -> typed validation
  -> versioned parent revision
```

This is the WorldManager equivalent of preventing the ARC robot from getting lost in pixels. It prevents the builders from getting lost in patches and prevents the WorldManager from getting lost in transcript fragments.

---

## 3. Existing substrate: extend, do not replace

The direct-harness branch already contains most neighboring control surfaces.

### 3.1 Recursive build method

`docs/DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md` already establishes:

```text
capability law
  -> semantic ontology pass
  -> recursive operator descent
  -> behavior branch tree
  -> terminalization
  -> probe coverage
  -> implementation map
  -> observations
  -> theory repair before code repair
```

The new WorldManager method generalizes that from building one harness capability to governing arbitrary project and world reasoning.

### 3.2 Workflow-transition authority

`docs/META_ORCHESTRATOR_LOOP_ODEU_SPEC.md` and
`src/main/direct/bridge/meta-orchestrator-shadow.js` already separate:

```text
worker completion claim
  != routable artifact
  != validated artifact
  != lawful workflow advancement
```

That artifact-transition loop should remain the operational workflow layer. It must not be confused with the semantic recursive DAG introduced here.

### 3.3 Meta-session governance

`docs/DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md` and
`src/main/direct/meta-session/*` already provide:

- session jurisdiction;
- locked run contracts;
- three-depth governor/orchestrator/worker authority;
- transition claims and guards;
- cross-context routing;
- obligation inheritance;
- upstream discriminator records;
- replay locks;
- append-only ledger and current pointers.

WorldManager should sit above and integrate these surfaces rather than duplicate them.

### 3.4 WorkThread identity

`docs/DIRECT_WORK_THREAD_FOUNDATION_SPEC.md`,
`src/main/direct/bridge/work-thread-registry.js`, and
`src/main/direct/bridge/work-thread-alignment.js` already establish:

```text
WorkThread
  = project ontology
  + workspace/branch identity
  + objective
  + constraints
  + authority boundary
  + obligations
  + linked Codex/ChatGPT surfaces
```

They also establish the critical law:

```text
work-target resolution != routing authority
context citation != endorsement
transition envelope != mutation permission
```

WorkThread should become the operational thread anchor for recursive ODEU nodes, not be replaced by them.

### 3.5 Context, memory, and frontier

The current context stack already distinguishes:

- context policy;
- context projection;
- context pack;
- request manifest;
- durable memory;
- omission ledger;
- maintenance manifest;
- frontier baton;
- provider input projection.

The recursive method must consume these as typed evidence and projections. It must not turn transcript, memory, or baton state into hidden project law.

### 3.6 Governance and semantic routing

`src/main/direct/governance/broker.js` already contains diagnostic/shadow surfaces for:

- governance packets;
- compiled prompt layers;
- workflow transition graphs;
- semantic-broker candidates;
- work-target preflight;
- fallback and ask-human posture.

The WorldManager layer should provide the authoritative semantic objects that a future promoted router consumes. It should not turn the current diagnostic broker directly into a sovereign classifier.

### 3.7 Governed continuation and effects

ADEU Studio’s `agentic_de_*` family already supplies adjacent execution semantics:

```text
seed intent
  -> task charter
  -> task residual
  -> loop-state ledger
  -> continuation decision
  -> action proposal
  -> membrane checkpoint
  -> single-step action ticket
  -> observed effect / conformance
  -> reintegration
  -> residual refresh
```

It also preserves communication, office binding, rewitness, workspace continuity, repo write leases, external assistant bridges, and delegated-worker reconciliation.

The recursive ODEU DAG should compile meaning and work structure into that governed execution lane. It must not replace action tickets, permission envelopes, effect evidence, or reintegration.

---

## 4. Three coupled graphs and one event ledger

WorldManager should keep three related but non-collapsed DAGs.

### 4.1 World/project semantic DAG

Represents what the user’s world and projects mean:

- ideas;
- projects;
- goals;
- principles;
- constraints;
- causal dependencies;
- intended effects;
- architecture options;
- environment constitutions;
- shared infrastructure;
- unresolved alternatives.

This graph answers:

> What is the object, why does it matter, what governs it, and how may it be realized?

### 4.2 Project-delivery DAG

Represents what work must occur:

- work threads;
- work packets;
- implementation leaves;
- audits;
- fixes;
- decisions;
- closeouts;
- next-arc seeds.

This graph answers:

> What artifact or validated transition is required next?

### 4.3 WorldManager self-development DAG

Represents reasoning about WorldManager itself:

- observed failures;
- candidate diagnoses;
- architecture laws;
- control-plane constraints;
- implementation options;
- patches;
- probes;
- regression locks;
- architecture revisions.

This graph answers:

> What governing design law explains the defect, and what bounded implementation follows from it?

### 4.4 Temporal event ledger

Runtime events remain an append-only temporal sequence:

- messages;
- route proposals;
- worker launches;
- artifacts submitted;
- transition decisions;
- actions executed;
- effects observed;
- parent revisions created.

The event ledger is not the semantic DAG. It records what happened. The DAG records what the objects and inferential relations are.

Critical non-collapse law:

```text
runtime event != semantic node
semantic relation != execution permission
project conclusion != validated implementation
world-level convergence != automatic global policy
```

---

## 5. Authority hierarchy

The implementation should preserve this authority split.

### Human / world owner

Owns:

- ultimate world-level purpose;
- constitutional approvals;
- high-risk forks;
- project creation, closure, and deletion;
- authority-changing environment migrations;
- final override, pause, and escalation.

### WorldManager

Owns:

- present-focus anchoring;
- jurisdiction resolution across world, project, thread, and general lanes;
- project creation and project-manager binding;
- world-level semantic identity;
- cross-project shared-node canonicalization;
- world-level scope promotion;
- world-state revision;
- global closure, escalation, and unresolved-question routing.

WorldManager does not automatically own:

- object-level technical correctness;
- implementation auditing;
- action execution;
- permission grants not delegated by constitution;
- arbitrary mutation of project-local law.

### ProjectManager

Owns:

- project charter and project ODEU root;
- project constitution;
- `ProjectEnvironmentConstitution`;
- project-local node identity and shared constraints;
- project work-thread creation;
- project-level joins and parent revisions;
- project closure and residual frontier.

A ProjectManager may be a model role, a state object, or both. Its authority must be artifact-defined rather than inferred from which model happens to be speaking.

### ThreadManager / session orchestrator

Owns:

- one WorkThread;
- the active recursive node and slot frontier;
- exact slot-contract selection;
- child work-packet construction;
- budget and recursion scheduling;
- sibling-result collection;
- local diff/join;
- return packet to the ProjectManager.

It does not unilaterally revise the project constitution.

### Synthetic reasoner

Owns:

- semantic candidate generation inside the supplied node and slot contract;
- relation witnesses;
- explicit uncertainty and contradiction reporting;
- candidate parent implications.

It returns typed candidates, not unrestricted prose as authoritative state.

### Worker

Owns one bounded expansion, implementation leaf, audit, or evidence packet. It may not mark the parent closed merely because it completed its local work.

### Auditor

Owns object-level validation for the declared artifact class. The WorldManager and meta-orchestrator may consume an audit verdict but may not silently substitute their own object-level judgment.

### Harness

Owns:

- schema validation;
- slot-contract enforcement;
- scheduling;
- identity and deduplication;
- transition guards;
- join invocation;
- pointer advancement;
- persistence;
- replay/idempotency;
- authority/effect routing.

### Ledger

Owns durable provenance:

- nodes;
- edges;
- revisions;
- evidence refs;
- route decisions;
- joins;
- promotions;
- action/effect lineage;
- failures and remands.

---

## 6. Present-focus anchoring and jurisdiction resolution

The recursive method begins before ODEU expansion. WorldManager must first determine **what the current utterance or event is about and which owner has jurisdiction**.

Possible lanes include:

```text
world-level idea or policy
new-project formation
existing project
specific WorkThread
specific recursive node
WorldManager self-development
cross-project shared infrastructure
general conversation
external communication / assistant bridge
unresolved or ambiguous
```

Example:

```text
“How was the weekend?”
```

should not be forced into whichever project was active most recently. It belongs to a general-conversation lane unless explicit context says otherwise.

Example:

```text
“Continue with SE-4 implementation.”
```

may resolve to a project and WorkThread from navigation state, selected node, current frontier, and explicit references.

The UX law remains:

> **Navigation locates the object; language specifies what to do with it.**

Language need not restate the entire object identity when the navigation state already supplies a valid referent. Conversely, language alone must not invent a project binding when navigation and evidence do not resolve one.

Suggested artifact:

```yaml
world_focus_resolution:
  schema: direct_world_focus_resolution@1
  focus_resolution_id: string
  source_surface: meta_session_chat | local_thread | ui_action | connector
  source_event_ref: string
  bounded_focus_seed_summary: string
  navigation_anchor_refs: []
  explicit_referent_refs: []
  candidate_jurisdictions: []
  selected_jurisdiction:
    scope_kind: world | project | work_thread | recursive_node | general | unresolved
    owner_ref: string | null
  indexical_resolution_witnesses: []
  ambiguity_codes: []
  route_posture: selected | proposal_only | unresolved | ask_human | general_lane
  mutation_allowed: false
  provider_call_allowed: false
  evidence_refs: []
```

A focus resolution establishes semantic targeting. It grants no action authority.

---

## 7. Local ODEU for every seed and child

After jurisdiction is resolved, the selected owner constructs a local ODEU node.

### O — ontology

What entities, relations, boundaries, states, identities, or laws are in focus?

WorldManager examples:

- project;
- WorkThread;
- objective;
- user commitment;
- architecture option;
- project environment;
- tool capability;
- workspace binding;
- agent role;
- shared world constraint;
- communication act;
- unresolved fork.

### D — present context and lawful transition posture

What present demand activated the node, and what is required, allowed, prohibited, deferred, or approval-gated?

Examples:

- the user is starting a project and a primary environment must be selected;
- a project is active but the message is outside its jurisdiction;
- a worker may inspect but not patch;
- an environment migration requires human approval;
- a thread may generate options but may not promote one into project law;
- a task is complete and must stop rather than continue from residual habit.

### E — entitlement and evidence

What warrants the current representation, relation, route, conclusion, or revision?

Examples:

- explicit user statement;
- navigation selection;
- prior project constitution;
- validated artifact;
- audit verdict;
- runtime probe;
- workspace evidence;
- cross-project convergence;
- exact source refs;
- unresolved posture where evidence is insufficient.

### U — purpose and relevance

Why does this distinction or operation matter now? What present demand or represented future does it serve?

Examples:

- preserve project continuity;
- choose the right substrate;
- avoid cross-project contamination;
- reach a future implementation state;
- reduce user restatement burden;
- select the minimum sufficient worker context;
- maintain auditability;
- prevent local patches from becoming accidental architecture.

Suggested node:

```yaml
recursive_odeu_node:
  schema: direct_recursive_odeu_node@1
  node_id: string
  node_revision: integer
  scope_kind: world | project | work_thread | architecture_self
  scope_owner_ref: string
  seed_ref: string
  parent_node_refs: []
  source_transition_refs: []
  identity_key: string
  ontology: {}
  deontics: {}
  epistemics: {}
  utility: {}
  claim_posture: candidate | inferred | validated | blocked | superseded | retracted
  visibility_posture: private | salient_uncommitted | project_public | world_public
  law_owner_ref: string | null
  evidence_refs: []
  open_slot_refs: []
  closure_posture: open | locally_closed | blocked | remanded | superseded
```

---

## 8. Four typed directions in WorldManager

Every eligible O, D, E, or U item may unfold in four directions. The direction is always combined with the exact source type and source ODEU slot.

### 8.1 Back — causal ancestry, prerequisites, and source basis

Back asks:

- What produced or motivated this object?
- What must already hold?
- Which prior commitment, source, dependency, or action explains it?
- What evidence licensed the current claim?

For `ProjectSeed.back`, admissible children may include:

- originating user need;
- prior idea;
- source artifact;
- stakeholder demand;
- inherited world constraint;
- prior project dependency;
- failed existing workflow;
- assumption requiring validation.

For `ImplementationLeaf.back`, admissible children may include:

- required interface;
- prerequisite schema;
- dependency;
- test fixture;
- authority grant;
- environment/tool requirement.

For `RouteDecision.back`, admissible children may include:

- navigation evidence;
- explicit mention;
- WorkThread identity;
- current frontier;
- ambiguity evidence.

### 8.2 Front — purpose, represented future, and downstream effects

Front asks:

- What future state is this meant to produce?
- Which user outcome, capability, beneficiary, or downstream transition does it serve?
- What becomes possible or impossible if it succeeds?

For `ProjectSeed.front`, admissible children may include:

- intended capability;
- success state;
- user-visible outcome;
- operational future;
- acceptance criterion;
- risk to avoid;
- future project dependency.

For `ArchitectureOption.front`, admissible children may include:

- supported workflows;
- future extensibility;
- authority consequences;
- maintenance burden;
- observability;
- failure modes.

For `ToolAdditionOption.front`, admissible children may include:

- tasks enabled;
- risk introduced;
- cross-environment consequences;
- future lock-in;
- required governance.

### 8.3 Up — governing abstraction, shared ancestry, and scope owner

Up asks:

- What larger law or category governs this object?
- What hidden assumption generated several branches?
- Which owner has authority over the discovered law?
- Is the finding local to one thread, general to a project, or world-level?
- Are apparently independent supports descendants of the same meta-root?

For `ProjectEnvironmentChoice.up`, admissible children may include:

- project environment policy;
- canonical workspace law;
- Git authority law;
- tool-admission law;
- user sovereignty over topology changes.

For `RepeatedLocalFailure.up`, admissible children may include:

- missing architecture discriminator;
- shared authority confusion;
- shared context contamination source;
- missing artifact boundary;
- overly broad fallback rule.

Up is also the scope-promotion and anti-double-counting path.

### 8.4 Down — realization, substrate, and implementation

Down asks:

- How is this represented, implemented, measured, routed, or executed?
- Which environment, module, package, schema, worker, test, or effect realizes it?

For `ProjectSeed.down`, admissible children may include:

- architecture families;
- capability decomposition;
- project constitution;
- environment constitution;
- WorkThreads;
- implementation modules;
- evaluation strategy.

For `ProjectEnvironmentConstitution.down`, admissible children may include:

- WSL or Windows environment records;
- workspace bindings;
- Git authority environment;
- task-routing policies;
- executor requirements;
- tool capability manifests;
- bridge requirements;
- migration mechanics.

For `ArchitectureOption.down`, admissible children may include:

- packages;
- data structures;
- APIs;
- state machines;
- worker roles;
- fixtures;
- implementation leaves.

---

## 9. Slot-specific transition contracts

The system must not have one generic `back`, `front`, `up`, or `down` prompt.

The legal expansion depends on:

```text
exact parent node type
exact parent revision
exact ODEU source slot
exact directional slot identity
scope owner
current project constitution
current evidence and authority posture
```

Suggested contract:

```yaml
slot_contract:
  schema: direct_recursive_odeu_slot_contract@1
  slot_contract_id: string
  parent_node_type: string
  parent_revision: integer
  parent_scope_kind: world | project | work_thread | architecture_self
  source_odeu_slot: O | D | E | U
  direction: back | front | up | down
  slot_identity: string
  licensed_question: string
  admissible_child_types: []
  candidate_generation_contract: {}
  required_relation_kinds: []
  cardinality: one | optional_one | many | bounded_many
  evidence_requirements: []
  forbidden_inferences: []
  allowed_scope_postures: []
  recursion_policy:
    max_depth: integer
    max_children: integer
    novelty_threshold: string
    stop_on_fixpoint: boolean
  identity_policy_ref: string
  join_contract_ref: string
  completion_condition: string
  remand_condition: string
```

Examples:

```text
ProjectSeed.U.front
  -> success states, beneficiaries, intended effects, stop conditions

ProjectSeed.O.down
  -> architecture families, constitutions, WorkThread families

ProjectEnvironmentConstitution.D.down
  -> allowed environments, task routes, executor requirements

ToolUnavailable.E.up
  -> capability-admission law, not an implementation fallback

WorkThreadObjective.U.back
  -> project purpose and current residual frontier

ImplementationLeaf.E.front
  -> observable acceptance evidence and downstream consumers
```

The rule remains:

> **Semantic content stays open; transition grammar stays closed.**

---

## 10. Desire, aspiration, and project planning

WorldManager planning should explicitly support the prospective roundtrip discussed in the ODEU method.

A present demand may directly push action:

```text
present D
  -> selected U
  -> immediate action
```

But project formation usually requires aspiration:

```text
represented future state
  -> derive required precursor states backward
  -> select present work
  -> execute forward
  -> validate the future state
```

For a new project:

```text
present idea
  -> intended future capability
  -> required project laws and architecture
  -> required environment and tools
  -> required WorkThreads and implementation leaves
  -> present next action
```

So the front path does not merely list consequences. It constructs the future criterion. Back then derives prerequisites from that future. Down realizes them. Execution moves forward causally. Evidence returns upward and backward into revised parent states.

Compact project loop:

```text
seed now
  -> future success representation
  -> prerequisite DAG
  -> executable leaves now
  -> forward effects
  -> evidence
  -> parent revision
```

---

## 11. Semantic DAG, recursive runtime, and versioned return

The persistent semantic graph should remain acyclic.

Operational recursion may revisit a parent, but it must do so through a new revision:

```text
Parent@1
  -> child options
  -> child ODEU loops
  -> convergence records
  -> join record
  -> ParentDelta
  -> Parent@2
```

Do not create a semantic back-edge from child to the same mutable parent object.

The runtime scheduler may select `Parent@2` and continue. The historical derivation remains inspectable.

Suggested return packet:

```yaml
recursive_odeu_parent_return:
  schema: direct_recursive_odeu_parent_return@1
  return_id: string
  parent_revision_ref: string
  child_node_refs: []
  delta_O: []
  delta_D: []
  delta_E: []
  delta_U: []
  shared_endpoint_refs: []
  convergence_record_refs: []
  contradiction_refs: []
  preserved_alternative_refs: []
  scope_promotion_proposal_refs: []
  residual_open_slot_refs: []
  join_posture:
    clean_join |
    join_with_alternatives |
    conflict_requires_reentry |
    blocked_missing_evidence |
    remand_child_generation
  resulting_parent_revision_ref: string | null
```

Law:

> **Re-entry revises the parent; it does not erase the path by which the revision was earned.**

---

## 12. Shared endpoints and rational reinforcement

A DAG is required because distant branches may converge on the same constraint, mechanism, policy, or causal object.

Example:

```text
WSL task routing analysis
Git consistency analysis
workspace mutation safety analysis
cross-environment recovery analysis
  -> canonical Git authority must belong to one declared environment
```

The endpoint matters not because one reasoner expressed confidence, but because distinct trajectories reached it.

Reinforcement should increase with:

- distance among source nodes;
- diversity of directions;
- diversity of ODEU source slots;
- diversity of evidence classes;
- diversity of project or module origins;
- specificity of the shared endpoint;
- residual independence after upward ancestry audit.

Raw incoming path count is invalid. The upward path must expose shared assumptions and duplicate derivations.

Suggested convergence record:

```yaml
recursive_odeu_convergence_record:
  schema: direct_recursive_odeu_convergence_record@1
  convergence_id: string
  endpoint_node_ref: string
  incoming_path_refs: []
  source_node_refs: []
  source_scope_refs: []
  source_direction_set: []
  source_odeu_slot_set: []
  discovered_meta_root_refs: []
  independence_classes: []
  duplicate_derivation_refs: []
  residual_independent_support_refs: []
  convergence_posture:
    local_echo |
    shared_ancestry_convergence |
    multi_root_project_convergence |
    cross_project_convergence |
    cross_direction_fixed_point
```

Do not initially compress this into a single confidence number. Preserve the anatomy of convergence.

---

## 13. Upward path as scope and ancestry auditor

The upward path has four related jobs.

### 13.1 Extract hidden assumptions

```text
local derivation
  -> governing premise, ontology, policy, or evaluation criterion
```

### 13.2 Factor duplicate derivations

```text
shared root A
  -> branch B -> endpoint X
  -> branch C -> endpoint X
```

This is one ancestral support class with two downstream expressions, not two fully independent reasons.

### 13.3 Determine the lawful owner

A discovery may belong to:

- one recursive node;
- one WorkThread;
- one project;
- a shared infrastructure project;
- WorldManager constitution;
- user/world constitution.

The upward path identifies the smallest owner that explains the finding without erasing local differences.

### 13.4 Propose, but not silently perform, scope promotion

A project-local discovery must not automatically become world law.

```text
thread finding
  -> project promotion proposal
  -> project-level validation
  -> project law revision
```

```text
cross-project shared endpoint
  -> world-level promotion candidate
  -> shared-ancestry audit
  -> scope and conflict review
  -> explicit WorldManager or human approval where required
  -> world law revision
```

This prevents one project’s convenient local rule from contaminating all other projects.

---

## 14. ProjectEnvironmentConstitution as the first concrete down-path law

The first proof case should use the already-settled project-environment concept.

```yaml
ProjectEnvironmentConstitution:
  projectId: string
  revision: integer
  primaryEnvironmentId: string
  allowedEnvironmentIds: []
  workspaceBindings: []
  gitAuthorityEnvironmentId: string
  environmentTaskPolicies: []
  executorRequirements: []
  topologyRevision: integer
  evidenceRefs: []
```

Its role is not merely configuration. It is project law governing where work may occur and which environment owns canonical effects.

### Required invariants

- every project has one declared primary environment;
- every executable route targets an allowed environment;
- workspace bindings are explicit;
- Git authority belongs to one declared environment;
- task-type routing is explicit rather than inferred from the currently available shell;
- executor requirements are checked before dispatch;
- Windows/WSL mirrors do not become competing canonical workspaces;
- topology changes create new constitution revisions;
- migration is a constitutional fork, not a local path edit;
- tool installation or removal is a constitutional decision when it changes the project toolbox or authority surface.

### Missing-tool law

When a worker attempts to use a tool unavailable in the selected environment, the lawful response is not automatically:

```text
silent fallback
or
silent installation
```

It should generate a typed fork:

```text
tool unavailable
  -> use an admitted alternative
  -> route task to another allowed environment
  -> propose tool admission/install
  -> preserve explicit prohibition
  -> block and ask for constitutional decision
```

The system should distinguish:

```text
“this tool does not exist here”
from
“this tool should not exist here”
```

Those are different world states and different deontic postures.

### First project-initialization roundtrip

```text
new project idea
  -> ProjectSeed ODEU
  -> front: intended capability and success state
  -> back: originating constraints and user commitments
  -> up: project class and governing world policies
  -> down: architecture options and environment requirements
  -> environment option ODEUs
  -> compare and join
  -> recommended ProjectEnvironmentConstitution
  -> human approval where authority/topology requires it
  -> Project@2 with bound constitution
```

---

## 15. WorkThread as the operational recursive anchor

A project may contain many semantic nodes and many operational threads. WorkThread should bind the operational unit to the project DAG.

Extend or reference the existing WorkThread with:

```text
projectConstitutionRef
projectEnvironmentConstitutionRef
recursiveOdeuRootNodeRef
activeRecursiveNodeRef
activeSlotContractRef
frontierBatonRef
parentReturnObligationRef
```

Do not turn WorkThread into the entire semantic graph. It should remain the active-work anchor:

```text
project ontology
+ workspace/branch identity
+ current objective
+ authority boundary
+ open obligations
+ context projection
+ recursive frontier
```

The ThreadManager uses it to launch bounded node/slot work.

Critical law:

```text
selected WorkThread
  != authority to mutate it

active recursive node
  != authority to promote its candidates

completed worker output
  != parent closure
```

---

## 16. Context, memory, and frontier projection

The recursive DAG may be large. Workers should never receive the entire world state by default.

For each node expansion, compile a bounded context package containing:

```text
current seed
current ODEU state
exact slot contract
relevant ancestor projection
relevant project/world constitution refs
selected sibling findings
known convergence refs
open contradictions
budget and closure requirements
required output schema
explicit omission ledger
```

The context compiler should reuse the current context-pack/request-manifest substrate.

### Memory law

- user/world memory belongs at WorldManager scope;
- project operational memory belongs at ProjectManager scope;
- WorkThread memory belongs to the thread scope;
- worker scratch state remains worker-local unless returned as an artifact;
- raw transcript is evidence, not canonical memory;
- summaries are projections, not automatic law;
- cross-project memory transfer requires an explicit shared node or route.

### Frontier baton law

The baton should identify:

- active parent revision;
- open slots;
- selected slot contract;
- current children;
- owed joins;
- blockers;
- return target.

It is a control pointer, not task law, semantic truth, or replay authority.

### Omission law

Every worker package should record what potentially relevant world/project context was intentionally omitted and why. This prevents selective context from becoming invisible semantic distortion.

---

## 17. Semantic routing and communication

WorldManager must distinguish conversational, semantic, operational, and authority acts.

A message may function as:

- general conversation;
- world-level idea;
- project specification;
- node-local detail;
- request for analysis;
- implementation instruction;
- approval;
- rejection;
- constitutional amendment proposal;
- status query;
- communication to another agent;
- ambiguous candidate requiring clarification or safe default.

Punctuation and surface grammar do not determine the operational route alone.

For example:

```text
“Let’s continue with SE-4 implementation?”
```

may operationally mean:

```text
assess whether continuation is optimal
  -> if yes, proceed through governed implementation path
  -> otherwise, return a better proposal
```

That interpretation is context- and structure-dependent. It should be represented as a typed communication interpretation, not hard-coded as the universal meaning of `?`.

The current communication membrane and rewitness concepts are useful here:

```text
message received
  -> communication-only packet
  -> jurisdiction and illocution interpretation
  -> optional witness/promotion proposal
  -> office/project binding check
  -> route or remain communication-only
```

No message becomes project law merely because it occurred in a project-adjacent chat.

---

## 18. From semantic node to project work

A recursive ODEU child may terminate as an implementation or validation leaf. That does not mean the semantic DAG should execute it directly.

The lawful bridge is:

```text
validated semantic leaf
  -> project work requirement
  -> WorkThread or workflow-step creation
  -> typed work packet
  -> worker artifact
  -> audit artifact where required
  -> workflow transition
  -> effect authority path
  -> observed result
  -> semantic parent return
```

Keep these distinctions:

```text
semantic necessity
  != implementation evidence

implementation evidence
  != valid implementation

valid implementation
  != permission to execute or merge

observed effect
  != satisfaction of the parent purpose
```

The meta-orchestrator may enforce artifact order. The auditor certifies object-level validity. The permission/effect lane authorizes and records actions. The recursive ODEU parent decides what the validated result changes semantically.

---

## 19. WorldManager self-development must dogfood the same method

Any change to WorldManager should begin as a seed in the self-development scope.

Example defect:

```text
Codex tries a tool unavailable in WSL, then silently falls back.
```

Local patch thinking might produce:

```text
add another fallback in this command path
```

Recursive ODEU should instead produce:

```text
O:
  tool capability, environment, task route, fallback behavior

D:
  current project permits WSL/Windows but tool authority is under-specified

E:
  runtime trace shows unavailable tool and fallback

U:
  preserve optimal toolbox without violating project intent
```

Then:

```text
back
  -> where did the task route and capability assumption originate?

front
  -> what future workflows and risks follow from each choice?

up
  -> shared law: unavailable capability requires an explicit constitutional fork

 down
  -> capability manifest, route gate, install proposal, UI decision, tests
```

If the same endpoint is reached from WSL routing, project activation, delegated workers, and tool promotion, it becomes strongly reinforced as a WorldManager architecture law.

Only then should implementation leaves be generated.

Self-development rule:

> **No local patch may become control-plane law without returning through its architecture parent.**

---

## 20. Proposed artifact family

Codex should first map existing owners and reuse current identity/digest conventions. The minimum logical family is below.

### 20.1 Focus and jurisdiction

```text
direct_world_focus_resolution@1
```

Owns semantic targeting only.

### 20.2 Project constitution

```text
direct_project_constitution@1
direct_project_environment_constitution@1
```

Own project law and environment topology.

### 20.3 Recursive semantics

```text
direct_recursive_odeu_node@1
direct_recursive_odeu_slot_contract@1
direct_recursive_odeu_directional_expansion@1
direct_recursive_odeu_convergence_record@1
direct_recursive_odeu_join_record@1
direct_recursive_odeu_parent_return@1
```

### 20.4 Scope promotion

```text
direct_recursive_odeu_scope_promotion_proposal@1
direct_recursive_odeu_scope_promotion_decision@1
```

Required for thread -> project and project -> world promotion.

### 20.5 World and project revisions

```text
direct_project_state_revision@1
direct_world_state_revision@1
```

These reference parent deltas rather than overwriting canonical history.

### 20.6 Scheduler state

```text
direct_recursive_odeu_frontier@1
direct_recursive_odeu_run_status@1
```

These are control projections, not semantic authority.

---

## 21. Directional expansion and typed join

The reasoner should return a structured expansion:

```yaml
directional_expansion:
  schema: direct_recursive_odeu_directional_expansion@1
  expansion_id: string
  source_node_ref: string
  source_slot_ref: string
  slot_contract_ref: string
  candidate_node_refs: []
  relation_witnesses: []
  uncertainty_refs: []
  contradiction_refs: []
  parent_implications: []
  scope_promotion_candidates: []
  proposed_frontier: []
  completion_posture: complete | partial | blocked | remand
```

Joining must also be typed.

```yaml
join_contract:
  equivalence_rules: []
  identity_rules: []
  contradiction_rules: []
  dependency_rules: []
  comparison_dimensions: []
  convergence_rules: []
  promotion_conditions: []
  remand_conditions: []
  parent_delta_schema_ref: string
```

The fold phase asks:

- Which children identify the same object?
- Which are compatible specializations?
- Which are alternatives?
- Which compose a larger solution?
- Which conflict?
- Which depend on the same hidden premise?
- Which findings belong at a higher scope?
- What changed in O, D, E, or U for the parent?
- Which uncertainty remains genuinely open?

The output is a typed delta, not a prose recap.

---

## 22. Identity, canonicalization, and scope

Two branches using different wording must not automatically become separate nodes. Similar wording must not be merged when owner, scope, or defining relation differs.

Canonical identity should consider:

- node type;
- referent;
- scope kind and owner;
- law owner;
- defining relation;
- temporal/version boundary;
- semantic payload;
- authority posture.

Join classifications should include:

```text
exact_same_node
compatible_specialization
compatible_scope_extension
alias_candidate
shared_mechanism_different_owner
live_alternative
true_conflict
version_successor
```

A project-specific “Git authority is WSL” node must not merge with a world-level universal claim that all projects must use WSL. They may share a higher node such as “one declared environment owns canonical Git effects.”

---

## 23. Boundedness and closure

Recursive openness needs explicit bounds.

Each run should preserve:

- depth budget;
- node budget;
- child cardinality;
- semantic novelty threshold;
- identity deduplication;
- fixpoint detection;
- slot completion conditions;
- unresolved-question escalation;
- per-scope promotion budget;
- user-attention budget;
- implementation cost budget where applicable.

A node may close only when:

- all required slots are satisfied, proved irrelevant, deferred with explicit risk, or blocked with required evidence stated;
- required joins are complete;
- contradictions are resolved or preserved as live alternatives;
- parent implications are emitted;
- scope-promotion candidates are decided or explicitly deferred;
- no child is silently omitted from a required cardinality contract.

The “every item must be decided” principle applies to required slot members. A default no-op may be valid, but it must still be recorded as the decision.

---

## 24. Proposed implementation ownership

Prefer one new bounded module family:

```text
src/main/direct/world-manager/
  constants.js
  schemas.js
  ids.js
  store.js
  focus-resolution.js
  project-constitution.js
  environment-constitution.js
  slot-contract-registry.js
  scheduler.js
  identity.js
  convergence.js
  join.js
  projection.js
```

Integrate rather than duplicate:

| Existing owner | Integration |
|---|---|
| `bridge/work-thread-registry.js` | bind project constitution, recursive root, active node, and frontier refs |
| `bridge/work-thread-alignment.js` | carry recursive/project authority refs without granting mutation |
| `meta-session/store.js` | bind WorldManager/project manager sessions and reuse ledger/pointer discipline |
| `governance/broker.js` | consume focus/slot artifacts for shadow routing; do not auto-authorize initially |
| `thread/context-pack.js` | compile bounded node/slot worker context and omission ledger |
| `bridge/meta-orchestrator-shadow.js` | route implementation/audit artifacts generated from terminal semantic leaves |
| `runtime/project-activation.js` | consume the environment constitution rather than infer project runtime from UI state |
| sub-agent authority modules | launch one exact slot/leaf role with bounded capability |
| operation ledger | persist scheduler, join, promotion, and parent-revision events |

The direct-harness branch should remain the implementation target. ADEU `agentic_de_*` artifacts may be used as semantic references or future interoperability targets, but the first slice should not create a second runtime stack.

---

## 25. First implementation slice: new-project initialization

Do not begin with universal reasoning over every WorldManager function. Prove the architecture on one complete path.

### Phase A — repo-grounded owner map

Locate and document current owners for:

- selected project identity;
- WorkThread identity;
- meta-session jurisdiction;
- runtime path/project activation;
- workspace binding;
- context pack/request manifest;
- cross-context routing;
- worker launch;
- workflow artifact transition;
- permission/effect execution;
- operation ledger and current pointers.

Mark each as:

```text
canonical authority
derived projection
diagnostic/shadow
effect authority
evidence-only
```

### Phase B — focus and project seed

Add a shadow-only `direct_world_focus_resolution@1` for:

```text
“Start a new project whose purpose is X.”
```

It must resolve to `new_project_formation`, not an existing project or general lane.

Create:

```text
ProjectSeed@1
  -> local ODEU
```

### Phase C — initial slot registry

Implement only the slot contracts needed for:

```text
ProjectSeed.back
ProjectSeed.front
ProjectSeed.up
ProjectSeed.down
ProjectEnvironmentConstitution.down
EnvironmentOption ODEU
```

### Phase D — project aspiration loop

From the represented future success state, derive:

- project completion criteria;
- capability requirements;
- architecture families;
- environment requirements;
- initial WorkThread families;
- stop conditions.

### Phase E — environment constitution

Generate a bounded ranked set of environment options and ODEU-process each one.

Produce:

```text
recommended ProjectEnvironmentConstitution
preserved alternatives
tradeoff evidence
approval requirement
```

No environment binding changes until the required authority path succeeds.

### Phase F — WorkThread and context binding

Create the first WorkThread with refs to:

- project constitution;
- environment constitution;
- recursive root node;
- active frontier;
- authority boundary.

Build a worker context pack from exact node/slot contracts.

### Phase G — join and parent revision

Canonicalize shared endpoints, run the upward ancestry/scope audit, produce a typed join and parent delta, then create `Project@2`.

### Phase H — governed execution bridge

Convert one terminal implementation leaf into a work packet and route it through existing implementation/audit/effect controls. Return observed evidence to the semantic parent.

### Phase I — dogfood requirement

Use the recursive ODEU method itself to design and review every implementation phase above. The implementation PR should include the self-development DAG or equivalent artifact refs that explain why each code change follows from the architecture parent rather than from a local patch impulse.

---

## 26. Acceptance tests

### Focus and jurisdiction

1. A general conversational message does not bind to the active project merely because that project was last used.
2. A message with a valid navigation-selected node resolves to that node without requiring the user to restate its full identity.
3. An ambiguous cross-project message remains proposal-only or unresolved.
4. Focus resolution never grants provider-call, routing, or mutation authority.
5. A stale navigation anchor fails closed or remands resolution.

### Recursive structure

6. Every child records source node, source ODEU slot, direction, slot contract, and relation witness.
7. A child type not licensed by the exact source-slot contract is rejected.
8. Every admitted option receives its own ODEU or an explicit typed exclusion.
9. Parent return creates a new parent revision and no semantic cycle.
10. Required slot cardinality cannot be satisfied by silently omitting candidates.
11. Depth, node, novelty, and fixpoint bounds are deterministic and inspectable.

### Convergence and upward audit

12. Equivalent endpoints from different branches canonicalize to one node.
13. The convergence record preserves source distance and directional diversity.
14. Shared meta-ancestry is factored rather than double-counted.
15. A project-local convergence does not automatically become world law.
16. Cross-project convergence creates a world-scope promotion proposal, not an automatic promotion.
17. Different owner/scope claims with similar wording are not incorrectly merged.

### Project constitution and environment

18. New-project initialization produces a versioned project constitution.
19. The environment constitution declares one primary environment and one Git authority environment.
20. Tasks route only to allowed environments.
21. Missing tools produce explicit admitted alternatives or a constitutional fork.
22. Silent tool installation and silent cross-environment fallback are rejected.
23. Environment migration creates a new topology/constitution revision.
24. Authority-changing migration requires the declared human approval path.
25. WSL and Windows workspace mirrors cannot both claim canonical Git authority.

### WorkThread and context

26. A WorkThread binds the recursive root/frontier without becoming the whole semantic graph.
27. Context packs contain exact slot contracts and relevant ancestor projection.
28. Omitted potentially relevant sources appear in an omission ledger.
29. Memory and frontier baton remain evidence/control projections, not instruction authority.
30. Worker output cannot mutate the project parent directly.

### Workflow and execution

31. A terminal semantic leaf creates a typed work requirement, not an immediate effect.
32. Worker completion claims require routable artifacts.
33. Object-level correctness requires the declared audit role where the plan requires audit.
34. Action authority remains in the existing permission/effect path.
35. Observed effect returns as evidence and does not by itself prove the parent U is satisfied.
36. Duplicate artifact/event replay does not advance twice.

### WorldManager self-development

37. A local defect first creates private diagnosis candidates.
38. A control-plane patch must cite its architecture parent and parent delta.
39. Multiple distant defects may converge on one shared architecture law.
40. Previously green branches remain protected by regression locks when a discriminator is added.
41. A failed probe may remand theory, slot typing, implementation, or oracle; it is not automatically a patch instruction.

---

## 27. Failure taxonomy

Normalize at least:

```text
focus_jurisdiction_laundering
active_project_salience_route
navigation_anchor_stale
route_resolution_authority_leak
raw_transcript_as_project_memory
memory_as_instruction_authority
frontier_baton_as_task_law
illegal_slot_child_type
unprocessed_admitted_option
required_option_silent_noop
parent_reentry_cycle
unversioned_parent_mutation
duplicate_endpoint_fragmentation
shared_ancestry_double_counting
cross_scope_identity_collapse
local_rule_global_promotion
scope_owner_missing
premature_sibling_join
unresolved_conflict_erasure
semantic_leaf_direct_execution
worker_completion_self_certification
implementation_evidence_as_validity
project_constitution_as_action_ticket
residual_as_standing_authority
missing_tool_silent_install
missing_tool_silent_fallback
cross_environment_canonicality_split
environment_migration_without_fork
local_patch_without_architecture_return
```

These should be inspectable failures even when the visible project result appears successful.

---

## 28. Non-goals for the first slice

Do not yet:

- turn the semantic broker into an autonomous global router;
- migrate every current project/thread artifact into the new family;
- let the model invent slot contracts at runtime;
- create one universal ontology for all projects;
- reduce convergence to an opaque confidence score;
- persist raw hidden reasoning;
- replace MetaSession, WorkThread, context packs, workflow artifacts, or effect governance;
- grant execution authority from semantic conclusions;
- auto-promote project findings into WorldManager constitution;
- infer current project from the selected renderer tab alone;
- expose the entire world DAG to every worker;
- implement broad environment migration or tool installation in the starter PR;
- treat a passing fixture as proof of live routing or effect authority.

The first proof is narrow:

> WorldManager can resolve a new-project seed, recursively ODEU-expand it through typed slots, derive and compare environment constitutions, create a WorkThread and bounded implementation leaf, join child results into a versioned project parent, and preserve all existing authority/effect boundaries.

---

## 29. Requested Codex response before implementation

Return a repo-grounded plan containing:

1. the actual owner map for project identity, WorkThread, MetaSession, runtime selection, workspace binding, context construction, worker launch, workflow transition, effect authority, and ledgers;
2. the exact current artifact/status classification for each owner: canonical, projection, shadow, diagnostic, evidence-only, or authority-bearing;
3. which proposed artifacts can extend existing schemas and which require new owners;
4. the minimal new module/file layout;
5. the initial slot-contract registry for the new-project proof case;
6. the exact identity/canonicalization policy for recursive nodes;
7. the join and versioned-parent-return algorithm;
8. the scope-promotion path from thread to project and project to world;
9. the integration plan for WorkThread, MetaSession, context pack, frontier baton, semantic broker, meta-orchestrator, and project activation;
10. the deterministic regression matrix and fixture locations;
11. compatibility risks and no-authority-widening proof;
12. the smallest implementation order that dogfoods the method without broad architecture churn.

Then implement only the approved first slice with:

- schemas and validators;
- content-addressed identity where consistent with the repo;
- append-only lineage and current pointers;
- shadow focus routing;
- new-project recursive fixture;
- environment constitution option comparison;
- convergence/upward ancestry fixture;
- versioned parent return;
- WorkThread/context integration;
- negative authority tests;
- architecture note documenting the three coupled DAGs and event ledger;
- self-development evidence showing that the implementation itself followed the recursive ODEU method.

---

## 30. Compressed theorem

```text
A user event first resolves to a lawful semantic jurisdiction.

Every selected focus becomes an ODEU-bearing node.

Every eligible item unfolds only through an exact source-slot-specific
back/front/up/down contract.

Every admitted option receives its own ODEU treatment.

Shared endpoints are canonicalized in a DAG; the upward path exposes shared
assumptions, determines lawful scope, and prevents duplicate reinforcement.

Children return typed deltas through joins to a new parent revision.

Semantic leaves become governed work requirements, not direct effects.

WorkThread, MetaSession, context packs, workflow artifacts, permission gates,
and effect evidence retain their existing authority boundaries.

The same method governs WorldManager projects and WorldManager's own evolution.

Therefore neither the synthetic worker gets lost in local task fragments nor
its builders get lost in local patches, while semantic creativity remains open
inside a structurally closed and inspectable reasoning machine.
```
