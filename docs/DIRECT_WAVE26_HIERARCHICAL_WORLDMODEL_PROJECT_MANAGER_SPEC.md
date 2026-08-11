# Direct Wave 26: Hierarchical Worldmodel, Project Managers, And Governed Idea Graph

Status: implemented and acceptance-audited locally; one combined GitHub PR is
pending.

## Local Implementation Status (2026-07-15)

PR151–PR157 are implemented locally as one bounded fixture/headless substrate.
The final Sol Max verification is GREEN for that scoped completion gate; the
preserved adversarial history and final verdict are in
[the Wave 26 audit](./audits/DIRECT_WAVE26_TERRA_HIGH_VS_INTENT_SOL_MAX_AUDIT_2026-07-15.md#final-acceptance-verification).
The implementation is in
`src/main/direct/worldmodel/{hierarchical-graph,project-manager,semantic-ingress,graph-projection,project-memory-propagation,project-profile-resolution,worldmodel-migration}.js`, with focused regressions including `scripts/direct-worldmodel-migration-games-regression.mjs`.

This is not a merged GitHub PR and does not claim production manager UI,
provider-context replacement, automatic transcript ingestion, or provider/runtime authority.

The accepted trust/custody boundary is local, single-process harness
persistence with opaque owner-side stores. It is not an external signer or
provider, multi-process CAS/locking proof, or hostile same-user filesystem
boundary. Manager integration is the harness-owned headless current-graph
context path, not a full renderer/provider replacement.

Detailed PR range:

```text
PR 151-157
```

Related documents:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_WAVE21_AGENT_CONTINUITY_MEMORY_SPEC.md
docs/DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md
docs/DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md
docs/DIRECT_WAVE25_RESIDENT_CHECKPOINT_COMPACTION_SPEC.md
docs/DIRECT_WORK_THREAD_FOUNDATION_SPEC.md
docs/DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md
docs/ODEU_ROLE_LANE_MULTI_AGENT_ARCHITECTURE_SPEC.md
docs/DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md
```

## Purpose

Wave 26 refines the Direct continuity architecture into one hierarchical,
versioned semantic worldmodel:

```text
User World
  -> Project Worlds
    -> WorkThread Worlds
      -> AgentRun / operation worlds
```

The hierarchy has corresponding custodial roles:

```text
World Manager
  -> Project Manager
    -> Thread Manager
      -> worker / specialist / auditor
```

The World Manager maintains user/global/cross-project semantic continuity.
Project Managers maintain project concepts, project-derived memory, progress,
and WorkThread portfolios. Thread Managers maintain bounded execution state.
Workers produce scoped evidence and closure reports.

Chat remains a user-facing ingress and an evidence artifact. It does not remain
the default continuity substrate in active model context. Once text from chat or
another artifact has been audited, typed, related to the existing worldmodel,
and admitted, future work should reuse the promoted semantic object. The source
text remains re-inspectable through exact evidence refs.

The target cognition loop is:

```text
current input or artifact evidence
  -> semantic target resolution
  -> candidate worldmodel delta
  -> contextual audit against current graph state
  -> admit / defer / reject / remand / split
  -> append-only graph transition
  -> updated materialized semantic state
  -> role-specific graph projections
```

This replaces repeated reconstruction:

```text
chat + files + tests + summaries
  -> rederive project ontology
  -> rederive goals and decisions
  -> finally interpret the new idea
```

with incremental semantic compilation:

```text
load the already-curated relevant graph
  -> interpret the new evidence as a delta
  -> inspect source artifacts only where uncertainty requires it
```

## Architectural Correction

Wave 26 does not claim that Waves 21 or 23 were implemented incorrectly. Those
waves established necessary substrate:

```text
Wave 21:
  Agent != Thread != Memory != Context
  memory has provenance, admission, conflict, and supersession

Wave 23:
  active interaction worldmodels
  Worldmodel Manager control-plane identity
  role-indexed authorization
  Thread Manager delegation
  scoped worker boot packets
```

Their first implementation intentionally collapsed some future distinctions.
Wave 23 permits Worldmodel Manager profiles at global, project, and WorkThread
scope and delegates directly from World Manager to Thread Manager. Wave 21
models memory primarily around Agent/project/role identity.

Wave 26 supersedes those target-architecture shortcuts while preserving their
artifacts as truthful implementation history:

```text
old target shortcut:
  World Manager -> Thread Manager -> worker

refined target:
  World Manager -> Project Manager -> Thread Manager -> worker

old memory center:
  agent/project/role-scoped memory rows

refined semantic custody:
  world-level memory at the user-world node
  project-derived memory at the project-world node
  WorkThread continuity at the WorkThread node
  agent-private procedural state only where genuinely agent-private

old context center:
  recent dialogue plus selected memory/context artifacts

refined manager context:
  relevant role graph projection plus current input and structured open dialogue
  targeted transcript/artifact inspection only when evidence must be revisited
```

Historical Wave 21, Wave 23, and WorkThread specs should remain readable. New
implementation and current-state docs should cite this spec when describing the
target hierarchy.

## Implementation Truth At Wave Start

| Existing substrate | Current value | Wave 26 correction or addition |
| --- | --- | --- |
| `ActiveInteractionWorldmodel` | Scoped four-lane ODEU snapshot with root/parent refs, revisions, digests, source refs, stale refs, unknowns, and remands | Treat it as a role/run projection compiled from the hierarchical graph, not the canonical long-lived graph itself |
| Worldmodel Manager | Control-plane-only profile, active pointer, append-only artifact ledger, chat marker, role state, and status projection | Restrict the refined World Manager posture to user/global/cross-project custody and add targeted project descent |
| Thread Manager and boot packets | WorkThread delegation, scoped ODEU projections, authority boundary, omissions, and worker context | Insert explicit Project Manager and ProjectWorld between World Manager and Thread Manager |
| Agent / AgentRun registry | Durable project/role/class identities and bounded runs across threads | Add durable Project Manager identities and explicit role hierarchy without replacing Agent/AgentRun |
| `AgentMemoryRow` and admission | Provenance, confidence, audit state, conflict, supersession, context eligibility, and no authority grant | Add semantic home-node/custodian ownership, project-memory admission, migration links, and no-double-inclusion law |
| `AgentMemoryContextProjection` | Explicit, bounded, source-ref-backed memory selection | Add role graph traversal/projection; retain memory projection as compatibility evidence during migration |
| Renderer transcript and `context_recent_dialogue` | Durable transcript projection and bounded historical-dialogue evidence | Keep transcript as evidence; manager context excludes historical transcript by default and loads bounded excerpts through a targeted inspection contract |
| WorkThread registry | Project id, objective, workspace/branch identity, arc, phase, authority, obligations, context ref, and linked chats | Move project ontology/charter upward into ProjectWorld; WorkThread remains a bounded operational subworld |
| Existing semantic broker diagnostics | Prompt/schema/task-route diagnostic with no mutation authority | Preserve it; add a distinct semantic-ingress broker that proposes graph target/delta candidates and also has no commit authority |
| Environment topology and specialist profiles | Resident/tool/specialist environment split, tool routes, profile contracts, and cross-environment evidence | Add evidence-backed ProjectExecutionProfileBinding and manager/worker profile resolution |
| Worldmodel manager ledger | Append-only refs to manager artifacts and active snapshots | Add append-only semantic node/edge transition history and scoped materialized current views |
| Agentic game matrix | Role, context, capability, authority, topology, behavior, and evidence fixtures | Add dual-ingress convergence, graph-first restart, transcript drill-down, stale/conflict, privacy, and migration games |
| Resident checkpoint | Strict local semantic checkpoint evidence without provider-compaction authority | Keep as WorkThread/agent continuity evidence and a possible project-memory candidate; do not make it canonical graph truth automatically |

Current implementation anchors:

- [`src/main/direct/worldmodel/kernel.js`](../src/main/direct/worldmodel/kernel.js)
  builds and validates `ActiveInteractionWorldmodel`.
- [`src/main/direct/worldmodel/manager.js`](../src/main/direct/worldmodel/manager.js)
  implements the current broad-scope Worldmodel Manager profile, ledger, pointer,
  chat marker, and control-plane boundary.
- [`src/main/direct/worldmodel/thread-manager.js`](../src/main/direct/worldmodel/thread-manager.js)
  implements Thread Manager delegation, authority boundaries, graph-adjacent ODEU
  projections, and worker boot packets.
- [`src/main/direct/bridge/agent-registry.js`](../src/main/direct/bridge/agent-registry.js)
  implements durable Agent and AgentRun identity.
- [`src/main/direct/bridge/agent-memory-store.js`](../src/main/direct/bridge/agent-memory-store.js)
  and
  [`src/main/direct/bridge/agent-memory-admission-gate.js`](../src/main/direct/bridge/agent-memory-admission-gate.js)
  implement governed agent/project memory and admission.
- [`src/main/direct/bridge/agent-context-source-refs.js`](../src/main/direct/bridge/agent-context-source-refs.js)
  implements bounded memory context projections.
- [`src/main/direct/thread/context-pack.js`](../src/main/direct/thread/context-pack.js)
  builds `context_recent_dialogue` from renderer transcript evidence.
- [`src/main/direct/bridge/work-thread-registry.js`](../src/main/direct/bridge/work-thread-registry.js)
  implements WorkThread identity, projection, and resolution.
- [`src/main/direct/worldmodel/environment-topology.js`](../src/main/direct/worldmodel/environment-topology.js)
  and related Wave 24 modules provide environment and specialist-route truth.
- [`src/main/direct/governance/broker.js`](../src/main/direct/governance/broker.js)
  is the existing diagnostic semantic broker and must remain distinct from the
  new semantic-ingress/world-delta broker.

The principal missing capabilities are therefore:

```text
ProjectManagerProfile and ProjectWorld
canonical hierarchical semantic nodes and relations
append-only semantic transitions plus scoped revision vectors
governed transcript/artifact -> idea promotion
one delta protocol shared by World Manager and Project Manager ingress
role-indexed relevant-graph projections
manager-specific graph-first context policy
project-derived memory admission and upward/downward propagation
project execution-profile resolution
compatibility migration and end-to-end proof
```

## Root Doctrine

Standing laws:

```text
Chat/thread is an ingress and evidence surface, not the semantic home of an
idea.

An idea is stored according to the worldmodel object it changes, not the chat
that received it.

Transcript is durable evidence, not permanent active continuity.

The hierarchical worldmodel is canonical semantic continuity.

Active context is a role- and task-specific projection of that graph.

World Manager and Project Manager are scoped custodians of one graph, not
owners of disconnected memories.

World-level memory is maintained at world scope.
Project-derived memory is maintained at project scope.
WorkThread output is evidence and a memory candidate until admitted.

Either human-facing manager may receive a project idea. The semantic target
determines custody and propagation.

Promotion preserves provenance, contextual audit, conflicts, revision, and
supersession.

Current graph state is a materialized view over append-only transitions.

Accepted idea != implemented artifact.
Accepted goal != achieved goal.
Design decision != current code conformance.
Graph claim != fresh runtime truth.

Profile fit != authority.
Environment availability != permission.
Worker profile selection != permission to spawn or act.
```

Context law:

```text
manager continuity = relevant graph projection
                   + changes since prior projection
                   + structured open dialogue/decision refs
                   + current input
                   + targeted evidence excerpts when required

manager continuity != permanent transcript replay
```

Promotion law:

```text
source text is evidence
broker interpretation is a candidate
admitted graph transition is continuity
```

## Non-Goals

Wave 26 does not include:

```text
automatic mining of all historical chats
raw transcript bodies stored inside semantic nodes
historical assistant text replayed as live instruction
embedding/vector search as a required V0 dependency
one giant prompt containing the entire user world
ambient cross-project graph access
general graph-editor UI
autonomous constitutional-policy mutation
worker direct writes to project/world semantic state
silent idea promotion from tool or provider output
graph claims treated as self-validating repository/runtime truth
destructive rewrite of AgentMemory, WorkThread, transcript, or manager stores
physical evidence TTL, compaction, deletion, archival, or retention tiers
full production manager UX
new tool/action authority merely because a role or profile exists
```

Physical retention is a separate later concern. Wave 26 records source
genealogy and semantic value so a later retention policy can decide which raw
evidence bodies remain hot, cold, archived, or deletable.

## Canonical Hierarchy

World hierarchy:

```text
UserWorld
├─ principles, preferences, self-bindings, and policy
├─ environment and agent-profile catalogs
├─ cross-project ideas, relations, and commitments
└─ ProjectWorld[]
   ├─ charter and terminal goals
   ├─ conceptual architecture
   ├─ admitted ideas, hypotheses, invariants, and decisions
   ├─ project memory
   ├─ environment/profile binding
   ├─ status and operational frontier
   └─ WorkThreadWorld[]
      ├─ bounded objective and plan
      ├─ evidence frontier and obligations
      ├─ delegations, remands, and closure
      └─ AgentRun / operation evidence
```

Role hierarchy:

```text
World Manager
  user-facing
  lives at the user-world/meta plane
  ordinarily sees compact project semantic heads
  descends into a project only when the current input requires it

Project Manager
  user-facing
  lives inside one detailed project slice
  owns project conceptual/operational memory and WorkThread portfolio
  receives relevant inherited world updates

Thread Manager
  observable, not directly conversational by default
  owns one bounded execution world

Worker / specialist / auditor
  observable, not directly conversational by default
  owns one scoped execution or reasoning process
```

Evidence hierarchy remains orthogonal:

```text
Thread/session = interaction witness
Turn = provider/runtime transition
Message/item/tool row = event evidence
```

Therefore:

```text
World node != Agent
Agent != Thread
Thread != Memory
Memory != Context
Context != canonical graph
Canonical graph != physical world truth
```

Session/chat should not be a canonical semantic scope. It is a source-evidence
scope used by ingress and promotion transitions.

## Semantic Scope And Custody

Custody identifies the manager responsible for maintaining the current
semantic state. It does not mean that no other lawful ingress can propose a
change.

| Target semantic state | Custodian | Other lawful ingress |
| --- | --- | --- |
| User principles, preferences, self-bindings, and constitutional policy | World Manager | Project Manager routes a candidate upward |
| Project registry and cross-project relations | World Manager | Project Manager proposes; World Manager admits/remands |
| Project charter and terminal goals | Project Manager | World Manager may submit a user-originated strategic delta after targeted descent |
| Project ideas, invariants, decisions, and architecture | Project Manager | World Manager may submit a bounded project delta; Project Manager integrates against current project revision |
| Project progress and project-derived memory | Project Manager | World Manager receives strategic projection, not ambient detailed memory |
| WorkThread plan/evidence/status | Thread Manager | Project Manager supervises and admits closure upward |
| Worker result | Worker emits evidence only | Thread/Project Manager promotes through a typed transition |
| Global environment and agent-profile catalogs | World Manager | Project Manager submits need/change candidates |
| Project execution-profile binding | Project Manager within allowed catalog; World Manager may set strategic defaults | Actual spawn/tool/action still routes through authorization |

The commit controller follows the target node, not the receiving chat:

```text
World Manager receives project idea
  -> targeted project descent
  -> project delta candidate
  -> project-node admission/commit controller
  -> Project Manager projection invalidated/refreshed

Project Manager receives the same project idea
  -> project-resident context
  -> same project delta candidate class
  -> same project-node admission/commit controller

Project Manager receives global/cross-project idea
  -> upward candidate
  -> user-world admission/commit controller
  -> affected project projections refreshed
```

Models propose semantic meaning. A deterministic/store transition controller
performs compare-and-swap, idempotency, custody, authority-route, and digest
validation before canonical mutation.

## Graph Manifest And Scoped Revisions

The graph needs independent revision domains so an unrelated change in Project
B does not stale every context or action in Project A.

```ts
type ScopedWorldmodelRevisionRef = {
  schema: "direct_scoped_worldmodel_revision_ref@1";

  scopeKind:
    | "user_world"
    | "project"
    | "work_thread"
    | "profile_catalog"
    | "environment_topology";

  projectId?: string;
  workThreadId?: string;
  revision: number;
  digest: string;
};
```

```ts
type HierarchicalWorldmodelGraph = {
  schema: "direct_hierarchical_worldmodel_graph@1";

  graphId: string;
  userProfileId: string;
  rootNodeId: string;

  projectRootRefs: Array<{
    projectId: string;
    rootNodeId: string;
    revision: number;
    digest: string;
  }>;

  scopedRevisionRefs: ScopedWorldmodelRevisionRef[];
  transitionLedgerHeadRef: SourceRef;
  currentMaterializedViewRef: SourceRef;
  materializedAt: string;
  digest: string;
};
```

Revision laws:

```text
global changes advance user-world revision
project-visible changes advance only affected project revisions
WorkThread-only progress advances the WorkThread revision
project projections cite the exact ancestor/profile/environment revisions they
inherit
stale writes remand/rebase; they do not silently merge
authority revocation propagates immediately
ordinary semantic changes apply at the next declared safe checkpoint
```

## Canonical Semantic Node

```ts
type WorldmodelSemanticNode = {
  schema: "direct_worldmodel_semantic_node@1";

  nodeId: string;
  graphId: string;

  scope: {
    scopeKind: "user_world" | "project" | "work_thread";
    userProfileId: string;
    projectId?: string;
    workThreadId?: string;
    semanticPath: string[];
  };

  nodeKind:
    | "world_root"
    | "project_root"
    | "work_thread_root"
    | "principle"
    | "preference"
    | "policy"
    | "goal"
    | "terminal_goal"
    | "idea"
    | "hypothesis"
    | "invariant"
    | "decision"
    | "constraint"
    | "open_question"
    | "risk"
    | "procedure"
    | "project_status"
    | "environment_binding"
    | "agent_profile_binding"
    | "work_thread_summary";

  abstractionLevel:
    | "world"
    | "strategic"
    | "conceptual"
    | "operational"
    | "execution";

  semanticSummary: string;
  structuredValue?: unknown;

  odeuImpact: {
    O: string[];
    E: string[];
    D: string[];
    U: string[];
  };

  lifecycle:
    | "proposed"
    | "active"
    | "deferred"
    | "rejected"
    | "superseded"
    | "refuted"
    | "stale"
    | "archived";

  epistemicStatus:
    | "observed"
    | "accepted"
    | "derived"
    | "hypothesis"
    | "unknown"
    | "disputed"
    | "refuted"
    | "stale";

  normativeForce:
    | "none"
    | "informational"
    | "preference_hint"
    | "project_commitment"
    | "binding_constraint"
    | "constitutional";

  custodianRole:
    | "world_manager"
    | "project_manager"
    | "thread_manager";

  authorizedWriterRoles: string[];
  projectionEligibility:
    | "eligible"
    | "eligible_with_warning"
    | "history_only"
    | "blocked_conflicted"
    | "blocked_stale";

  sourceRefs: SourceRef[];
  promotionTransitionRefs: SourceRef[];
  invalidationRules: string[];

  revision: number;
  supersedesNodeId?: string;
  supersededByNodeId?: string;
  createdAt: string;
  updatedAt: string;
  digest: string;
};
```

`semanticSummary` is curated semantic content, not a raw quotation. Raw source
text remains behind source refs. A node cannot omit epistemic status merely
because its semantic summary is concise.

Rejected, deferred, refuted, stale, and superseded content remains in transition
history. Only projection-eligible current nodes enter ordinary active context.

## Typed Semantic Relations

```ts
type WorldmodelSemanticEdge = {
  schema: "direct_worldmodel_semantic_edge@1";

  edgeId: string;
  graphId: string;
  fromNodeId: string;
  toNodeId: string;

  relationKind:
    | "contains"
    | "applies_to"
    | "derives_from"
    | "supports"
    | "contradicts"
    | "refines"
    | "supersedes"
    | "implements"
    | "depends_on"
    | "affects"
    | "produced_by"
    | "assigned_profile"
    | "hosted_in"
    | "relevant_to";

  epistemicStatus:
    | "accepted"
    | "derived"
    | "hypothesis"
    | "disputed"
    | "refuted"
    | "stale";

  lifecycle: "active" | "stale" | "superseded" | "refuted";
  sourceRefs: SourceRef[];
  revision: number;
  digest: string;
};
```

A semantic node has one home scope/path but may have relations that cross
project or hierarchy boundaries. Role context is therefore a graph cut, not a
naive subtree copy.

## Append-Only Semantic Transition

```ts
type WorldmodelGraphTransition = {
  schema: "direct_worldmodel_graph_transition@1";

  transitionId: string;
  graphId: string;
  deltaCandidateId: string;

  actorAgentId: string;
  actorRole:
    | "world_manager"
    | "project_manager"
    | "thread_manager"
    | "migration";

  mutations: Array<{
    mutationKind:
      | "add_node"
      | "revise_node"
      | "set_node_lifecycle"
      | "add_edge"
      | "revise_edge"
      | "set_binding";
    targetId: string;
    beforeDigest?: string;
    afterDigest: string;
  }>;

  expectedScopeRevisions: ScopedWorldmodelRevisionRef[];
  resultingScopeRevisions: ScopedWorldmodelRevisionRef[];

  authorityTraceRef: SourceRef;
  sourceRefs: SourceRef[];
  idempotencyKey: string;

  outcome:
    | "committed"
    | "duplicate_noop"
    | "stale_rejected"
    | "conflicted"
    | "remanded";

  previousTransitionDigest?: string;
  createdAt: string;
  digest: string;
};
```

Every canonical write is compare-and-swap over the touched scope revisions.
No manager silently overwrites a newer interpretation or operational state.

## Semantic Ingress

Current user messages, historical transcript passages, project artifacts,
WorkThread closures, control-panel changes, and system events all enter through
one evidence envelope:

```ts
type WorldmodelIngressEnvelope = {
  schema: "direct_worldmodel_ingress_envelope@1";

  ingressId: string;
  inputKind:
    | "current_user_message"
    | "historical_transcript_inspection"
    | "artifact_inspection"
    | "work_thread_closure"
    | "control_panel_change"
    | "system_event"
    | "migration_candidate";

  receivedByAgentId: string;
  receivedByRole:
    | "world_manager"
    | "project_manager"
    | "thread_manager";

  declaredScopeHints: Array<{
    projectId?: string;
    workThreadId?: string;
    semanticPath?: string[];
  }>;

  sourceRefs: SourceRef[];
  currentInstructionAuthority: boolean;
  rawTranscriptPersistedSeparately: true;
  rawTranscriptIncluded: false;
  createdAt: string;
  digest: string;
};
```

A current message can affect the current interaction without becoming durable
semantic state. For persistence, it matters only insofar as it produces an
admitted delta, an open dialogue/decision object, or an auditable rejected or
deferred candidate.

### Generalist Semantic-Ingress Broker

The existing Direct semantic broker is a prompt/schema/task-route diagnostic.
Wave 26 must not silently broaden that object's meaning. Add a distinct
generalist semantic-ingress broker whose only job is translation across scoped
world schemas:

```ts
type SemanticTargetResolution = {
  schema: "direct_semantic_target_resolution@1";

  resolutionId: string;
  ingressId: string;

  candidateTargets: Array<{
    scopeKind: "user_world" | "project" | "work_thread";
    projectId?: string;
    workThreadId?: string;
    semanticPath: string[];
    candidateNodeIds: string[];
    confidence: "exact" | "high" | "derived" | "ambiguous";
  }>;

  route:
    | "commit_current_scope"
    | "world_to_project_descent"
    | "project_to_world_escalation"
    | "project_to_thread_descent"
    | "multi_scope_split"
    | "remand";

  brokerMayCommit: false;
  rationale: string;
  sourceRefs: SourceRef[];
  digest: string;
};
```

The broker may:

```text
identify likely target scope/path
map source-native vocabulary into graph-native candidate types
split mixed-scope input
identify duplicates, conflicts, ambiguity, and missing context
request a bounded target projection or evidence inspection
```

The broker may not:

```text
admit its own interpretation
change policy
grant authority
rewrite current graph state
infer that relevance grants private-lane access
```

## Worldmodel Delta Candidate

```ts
type WorldmodelDeltaCandidate = {
  schema: "direct_worldmodel_delta_candidate@1";

  candidateId: string;
  ingressId: string;
  targetResolutionId: string;

  receivedByRole:
    | "world_manager"
    | "project_manager"
    | "thread_manager";

  targetScope: {
    scopeKind: "user_world" | "project" | "work_thread";
    projectId?: string;
    workThreadId?: string;
    semanticPath: string[];
  };

  abstractionLevel:
    | "world"
    | "strategic"
    | "conceptual"
    | "operational"
    | "execution";

  proposedNodeMutations: Array<{
    operation:
      | "add"
      | "revise"
      | "supersede"
      | "set_lifecycle"
      | "no_change";
    targetNodeId?: string;
    candidateNode: WorldmodelSemanticNode;
  }>;

  proposedEdgeMutations: Array<{
    operation: "add" | "revise" | "supersede" | "no_change";
    targetEdgeId?: string;
    candidateEdge: WorldmodelSemanticEdge;
  }>;

  odeuImpact: {
    O: string[];
    E: string[];
    D: string[];
    U: string[];
  };

  candidateState:
    | "candidate"
    | "needs_review"
    | "accepted_for_commit"
    | "rejected"
    | "deferred"
    | "conflicted";

  expectedScopeRevisions: ScopedWorldmodelRevisionRef[];
  sourceRefs: SourceRef[];
  digest: string;
};
```

Two ingress paths may produce differently worded broker rationales while still
converging on the same target node, normalized semantic content, and candidate
digest basis.

## Transcript As Re-Inspectable Evidence

Transcript storage remains in the existing thread/session evidence system.
Wave 26 adds typed addressing and bounded inspection, not a second transcript
store.

```ts
type TranscriptEvidenceRef = {
  schema: "direct_transcript_evidence_ref@1";

  projectId: string;
  threadId: string;
  turnIds: string[];
  messageItemIds: string[];
  transcriptStoreRef: SourceRef;
  sourceDigest: string;

  evidenceAuthority: "historical_evidence";
  inspectionState:
    | "not_loaded"
    | "bounded_excerpt_loaded"
    | "audited"
    | "stale"
    | "unavailable";

  rawTextIncluded: false;
  digest: string;
};
```

```ts
type TranscriptInspectionArtifact = {
  schema: "direct_transcript_inspection_artifact@1";

  inspectionId: string;
  evidenceRef: TranscriptEvidenceRef;
  question: string;
  boundedExcerptRef: SourceRef;
  extractedClaimCandidates: string[];
  omissions: string[];

  historicalInstructionAuthorityGranted: false;
  contextMutationGranted: false;
  digest: string;
};
```

Inspection laws:

```text
inspection is question-bound and source-cited
bounded excerpt is evidence, not current instruction
an extracted claim is not admitted semantic state
unavailable source produces remand/staleness, not invented reconstruction
raw World Manager/private transcript does not flow to a Project Manager merely
because the derived idea is relevant
```

## Governed Promotion

```ts
type WorldmodelPromotionTransition = {
  schema: "direct_worldmodel_promotion_transition@1";

  promotionId: string;
  candidateId: string;

  decidedByAgentId: string;
  decidedByRole: "world_manager" | "project_manager";

  decision:
    | "admit"
    | "reject"
    | "defer"
    | "remand"
    | "split"
    | "conflict";

  targetNodeIds: string[];
  targetEdgeIds: string[];
  duplicateOfNodeIds: string[];
  conflictRefs: SourceRef[];
  sourceRefs: SourceRef[];
  omissions: string[];
  graphTransitionRef?: SourceRef;
  digest: string;
};
```

Promotion requires:

```text
target scope/path resolved or explicitly remanded
current target graph projection inspected
candidate abstraction level and ODEU impact recorded
duplicate/conflict/supersession check
source evidence refs and freshness recorded
custody/write route validated
expected revisions still compatible
```

An idea may be preserved without being active:

```text
proposed
accepted/active
integrated or realized
deferred
rejected
superseded
refuted
invalidated/stale
```

This is how ideas are not lost without pretending that every idea is true.

## Project Manager

```ts
type ProjectManagerProfile = {
  schema: "direct_project_manager_profile@1";

  projectManagerProfileId: string;
  projectManagerAgentId: string;
  worldManagerAgentId: string;
  projectId: string;
  projectRootNodeId: string;

  humanFacingConversation: true;
  ownsProjectMemory: true;
  ownsProjectOperationalProgress: true;
  mayAdmitWorkThreadEvidence: true;
  mayCreateThreadManagerDelegation: true;
  maySubmitStrategicProjectDelta: true;
  mayUpdateGlobalWorldState: false;
  mayRouteGlobalDeltaUpward: true;
  mayReceiveWorldUpdatePackets: true;
  maySelectAuthorizedProjectProfiles: true;
  mayModifyConstitutionalPolicy: false;
  mayExecuteWorkerTasks: false;

  authorityBoundaryRef: SourceRef;
  graphProjectionPolicyRef: SourceRef;
  sourceRefs: SourceRef[];
  digest: string;
};
```

The Project Manager performs high-level project reasoning and orchestration. It
does not need to become a source-code editor, terminal babysitter, or worker.
Simple future implementations may let it carry a bounded reasoning task, but
execution authority must remain separately declared and must not follow merely
from `roleKind=project_manager`.

The intended human-facing role reachability is:

```text
World Manager chat
Project Manager chat per project

WorkThread Managers and workers:
  inspectable/observable
  steerable through owning Project Manager
  no direct user conversation by default
```

UX refinement (2026-07-26): the target product no longer requires these to be
separate top-level chat systems. The
[World Manager Agent-World And Unified UX spec](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md)
defines one persistent World Manager-governed communications plane in which a
Project Manager may formulate a project-scoped response with explicit
provenance. The role/custody distinction above remains binding; only its default
human-facing projection is refined.

## Project World State

```ts
type ProjectWorldState = {
  schema: "direct_project_world_state@1";

  projectId: string;
  projectRootNodeId: string;
  projectManagerProfileRef: SourceRef;

  charterNodeRefs: SourceRef[];
  terminalGoalNodeRefs: SourceRef[];
  conceptualModelNodeRefs: SourceRef[];
  projectMemoryNodeRefs: SourceRef[];
  acceptedDecisionNodeRefs: SourceRef[];
  openIdeaNodeRefs: SourceRef[];
  openQuestionNodeRefs: SourceRef[];
  riskNodeRefs: SourceRef[];

  activeWorkThreadRefs: SourceRef[];
  environmentBindingRefs: SourceRef[];
  executionProfileBindingRef?: SourceRef;

  statusSummaryNodeRef: SourceRef;
  openRemandRefs: SourceRef[];
  projectRevision: number;
  ancestorRevisionRefs: ScopedWorldmodelRevisionRef[];
  digest: string;
};
```

The World Manager ordinarily sees a compact project semantic head:

```text
project identity and charter
terminal goal summary
lifecycle/current phase
Project Manager identity
home environment and effective profile
active WorkThread summaries
important blockers/remands
project revision/digest
cross-project edges
```

The Project Manager sees the detailed ProjectWorld projection.

## Role-Indexed Graph Projection

```ts
type WorldmodelGraphProjection = {
  schema: "direct_worldmodel_graph_projection@1";

  projectionId: string;
  audienceAgentId: string;
  audienceRole:
    | "world_manager"
    | "project_manager"
    | "thread_manager"
    | "worker";

  entryPath:
    | "world_root"
    | "world_to_project_descent"
    | "project_resident"
    | "project_to_work_thread_descent"
    | "worker_boot";

  focalScope: {
    scopeKind: "user_world" | "project" | "work_thread";
    projectId?: string;
    workThreadId?: string;
  };

  selectionPolicyId: string;
  semanticBudget: {
    maxNodes: number;
    maxEdges: number;
    maxSummaryChars: number;
  };

  selectedNodeRefs: SourceRef[];
  selectedEdgeRefs: SourceRef[];
  inheritedGlobalNodeRefs: SourceRef[];
  changedSincePreviousProjectionRefs: SourceRef[];
  boundaryNodeRefs: SourceRef[];

  omittedCounts: {
    irrelevant: number;
    stale: number;
    conflicted: number;
    historyOnly: number;
    overBudget: number;
    unauthorized: number;
  };

  sourceScopeRevisions: ScopedWorldmodelRevisionRef[];
  rawTranscriptIncluded: false;
  projectionDigest: string;
};
```

Projection posture:

```text
World Manager:
  global principles/policies
  compact project semantic heads
  cross-project dependencies
  strategic status/profile/environment summaries
  targeted project descent only when current input requires it

Project Manager:
  detailed project goals, concepts, architecture, ideas, decisions, and memory
  inherited relevant global constraints/preferences
  operational frontier and WorkThread summaries
  no unrelated project memory

Thread Manager:
  active WorkThread plus relevant project nodes and inherited constraints

Worker:
  bounded boot packet, evidence contract, and only the graph nodes needed for
  the assigned operation
```

Boundary refs are important. They tell the model that a relation continues
outside the current projection without exposing or pretending to include the
omitted world.

World Manager targeted descent and Project Manager resident projection must
reference the same canonical ProjectWorld node ids/digests even though their
surrounding graph cuts differ.

## Relevant-Graph Selection

V0 does not require embedding search. Use typed deterministic traversal with
optional model-proposed seed candidates:

```text
1. Resolve current project, WorkThread, terminal goal, and user-input seeds.
2. Add inherited binding constraints, accepted decisions, and active goals.
3. Traverse affects, depends_on, refines, implements, supports, applies_to, and
   explicitly relevant_to edges within policy.
4. Apply audience role, custody, sensitivity, and projection eligibility.
5. Exclude history-only, conflicted, refuted, stale, or unauthorized nodes
   unless the current task is specifically auditing them.
6. Enforce node/edge/summary budgets.
7. Emit selected refs, boundary refs, omissions, and revision witness.
```

Relevance remains ODEU-relative. A node is relevant when it can change the
active objects/relations, evidence posture, lawful action space, or goal/risk
ranking for the current role and task.

## Manager Dialogue Frame And Turn Boot

The visible manager chat may be long-lived while provider cognition is fresh
per turn. Short-lived conversational dependencies must be represented as typed
state rather than recovered from an unbounded transcript.

```ts
type ManagerDialogueFrame = {
  schema: "direct_manager_dialogue_frame@1";

  dialogueFrameId: string;
  managerAgentId: string;
  managerRole: "world_manager" | "project_manager";

  activeProjectRefs: SourceRef[];
  activeTopicNodeRefs: SourceRef[];
  pendingDecisionRefs: SourceRef[];
  pendingClarificationRefs: SourceRef[];
  userRoleStateRef: SourceRef;

  expiresAfter:
    | "next_turn"
    | "decision_closed"
    | "session";

  sourceRefs: SourceRef[];
  digest: string;
};
```

This permits a message such as `yes` to be interpreted against one explicit
pending decision without replaying the prior conversation.

```ts
type ManagerTurnBootPacket = {
  schema: "direct_manager_turn_boot_packet@1";

  managerRole: "world_manager" | "project_manager";
  managerAgentId: string;
  graphProjectionRef: SourceRef;
  profileSnapshotRef: SourceRef;
  dialogueFrameRef?: SourceRef;

  openDecisionRefs: SourceRef[];
  openRemandRefs: SourceRef[];
  changesSincePreviousTurnRefs: SourceRef[];
  currentIngressRef: SourceRef;

  targetedEvidenceInspectionRefs: SourceRef[];
  historicalTranscriptIncluded: false;
  rawUnrelatedProjectStateIncluded: false;
  digest: string;
};
```

Context assembly law:

```text
World Manager boot:
  world-level graph projection
  + compact project heads
  + targeted project descent if required
  + dialogue frame
  + current input

Project Manager boot:
  detailed project graph projection
  + inherited relevant world changes
  + WorkThread frontier summaries
  + dialogue frame
  + current input

Thread Manager / worker boot:
  existing ActiveInteractionWorldmodel / WorkerBootPacket compiled from the
  relevant graph projection and authority state
```

`ActiveInteractionWorldmodel` remains valuable. Wave 26 changes its semantic
position:

```text
HierarchicalWorldmodelGraph
  -> role-scoped WorldmodelGraphProjection
  -> ActiveInteractionWorldmodel
  -> ManagerTurnBootPacket or WorkerBootPacket
```

It is a lawful active-world snapshot, not the canonical semantic store.

The generic `context_recent_dialogue` projection remains valid for ordinary
legacy/current threads. Manager profiles use a new graph-first context policy.
Historical dialogue may enter only through explicit bounded evidence
inspection or a temporary structured dialogue frame.

## Dual-Ingress Project Update

The same project-relevant idea can enter through World Manager or the owning
Project Manager. Both routes must inspect the current canonical ProjectWorld
state and reach the same target-node controller.

```text
World Manager route:
  user input
  -> world-level target resolution
  -> bounded ProjectWorld descent
  -> ProjectWorld delta candidate
  -> project-node admission/commit
  -> Project Manager projection invalidation

Project Manager route:
  user input
  -> project-resident target resolution
  -> ProjectWorld delta candidate
  -> same project-node admission/commit
  -> strategic status projection upward if relevant
```

Convergence does not require identical natural-language rationale. It requires:

```text
same canonical target node/path
same normalized semantic mutation
same source evidence posture
same custody and authority route
compatible expected project revision
extensionally equivalent resulting project state
```

A message containing both global and project content must split into multiple
scoped candidates. It must not choose one scope merely because one chat received
the message.

## Bidirectional Update Packets

Because both managers consume one canonical graph, update packets do not copy a
second source of truth. They notify, invalidate, rebase, and explain projections.

```ts
type WorldToProjectUpdatePacket = {
  schema: "direct_world_to_project_update_packet@1";

  updatePacketId: string;
  projectId: string;
  sourceGraphTransitionRefs: SourceRef[];
  affectedNodeRefs: SourceRef[];
  affectedEdgeRefs: SourceRef[];

  updateKind:
    | "goal_change"
    | "idea_admitted"
    | "global_preference_relevance"
    | "global_policy_relevance"
    | "environment_change"
    | "profile_change"
    | "cross_project_dependency";

  normativeForce:
    | "binding"
    | "candidate"
    | "informational";

  materiality:
    | "immediate_rebase"
    | "next_safe_checkpoint"
    | "next_manager_turn"
    | "future_work_only";

  expectedProjectRevision: number;
  resultingProjectRevision: number;
  sourceRefs: SourceRef[];
  digest: string;
};
```

```ts
type ProjectToWorldStatusProjection = {
  schema: "direct_project_to_world_status_projection@1";

  projectionId: string;
  projectId: string;
  projectRevision: number;

  terminalGoalNodeRefs: SourceRef[];
  currentPhase: string;
  progressSummaryNodeRef: SourceRef;
  activeWorkThreadRefs: SourceRef[];
  blockerRefs: SourceRef[];
  profileNeedRefs: SourceRef[];
  crossProjectCandidateRefs: SourceRef[];
  strategicChangeRefs: SourceRef[];

  rawProjectMemoryIncluded: false;
  rawWorkThreadEvidenceIncluded: false;
  sourceRefs: SourceRef[];
  digest: string;
};
```

```ts
type ProjectGraphUpdateAcknowledgement = {
  schema: "direct_project_graph_update_acknowledgement@1";

  acknowledgementId: string;
  updatePacketId: string;
  projectId: string;
  projectManagerAgentId: string;

  outcome:
    | "applied"
    | "already_current"
    | "scheduled_checkpoint"
    | "stale_remand"
    | "conflict_remand";

  resultingProjectionRef?: SourceRef;
  affectedWorkThreadRefs: SourceRef[];
  sourceRefs: SourceRef[];
  digest: string;
};
```

Impact laws:

```text
authority revocation or terminal-goal contradiction -> immediate rebase/block
architecture/goal change affecting active work -> next safe checkpoint or
immediate rebase according to impact evidence
ordinary new idea -> next Project Manager turn
historical-only promotion -> no active WorkThread invalidation
unrelated project change -> no Project A revision advance
```

## Hierarchical Memory

Memory is scoped semantic continuity, not one globally centralized blob and not
one disconnected store per chat.

```text
World Manager:
  user/world/cross-project memory

Project Manager:
  project concepts, decisions, patterns, risks, procedures, progress, and open
  questions derived from project work

Thread Manager:
  execution ledger, frontier, checkpoints, and closure evidence

Worker:
  local run state and evidence; no direct durable project/world memory write
```

Project memory is not a second semantic graph. It is an admitted/indexed class
of nodes in ProjectWorld. Existing `AgentMemoryRow` can remain a physical
compatibility artifact, but it must bind to at most one promoted semantic node.

```ts
type ScopedWorldMemoryBinding = {
  schema: "direct_scoped_world_memory_binding@1";

  bindingId: string;
  memoryId: string;
  memoryArtifactRef: SourceRef;
  semanticNodeId: string;
  homeScope: "user_world" | "project" | "agent_private";
  projectId?: string;
  custodianRole: "world_manager" | "project_manager" | "agent";

  compatibilityState:
    | "graph_primary"
    | "legacy_memory_primary"
    | "migration_pending"
    | "agent_private_unpromoted";

  mayEnterContextThroughLegacyMemoryProjection: boolean;
  mayEnterContextThroughGraphProjection: boolean;
  doubleInclusionForbidden: true;

  sourceRefs: SourceRef[];
  digest: string;
};
```

Work-derived project memory path:

```text
worker result
  -> WorkThread closure/evidence
  -> ProjectMemoryCandidate
  -> Project Manager contextual audit
  -> admit/defer/reject/remand
  -> ProjectWorld semantic node
  -> strategic subset projected upward only if globally/cross-project relevant
```

```ts
type ProjectMemoryCandidate = {
  schema: "direct_project_memory_candidate@1";

  candidateId: string;
  projectId: string;
  projectManagerAgentId: string;
  sourceWorkThreadRefs: SourceRef[];
  closureReportRefs: SourceRef[];

  candidateKind:
    | "project_fact"
    | "decision"
    | "invariant"
    | "constraint"
    | "open_question"
    | "risk"
    | "procedure"
    | "pattern"
    | "progress";

  proposedSemanticPath: string[];
  proposedNode: WorldmodelSemanticNode;
  expectedProjectRevision: number;
  sourceRefs: SourceRef[];
  digest: string;
};
```

Memory precedence remains:

```text
current user intent beats older memory
fresh workspace/runtime/tool evidence beats conflicting implementation memory
newer accepted semantic revision beats superseded revision
conflicted/stale memory is omitted or warning-scoped until resolved
memory never grants action authority
```

## Project Execution-Profile Resolution

The World Manager knows global control-panel state, environment topology, model
profiles, agent profiles, and cross-project resource posture. The Project
Manager knows detailed project needs. Profile resolution combines these views
without collapsing fit into authority.

```ts
type ProjectExecutionProfileBinding = {
  schema: "direct_project_execution_profile_binding@1";

  bindingId: string;
  projectId: string;
  projectRevision: number;

  homeEnvironmentRef: SourceRef;
  projectManagerProfileRef: SourceRef;
  defaultModelProfileRef: SourceRef;
  reasoningEffortProfileRef: SourceRef;
  allowedWorkerProfileRefs: SourceRef[];

  preferredSpecialistRoutes: Array<{
    operationalNeed: string;
    specialistProfileRef: SourceRef;
    environmentRef: SourceRef;
  }>;

  concurrencyLimit: number;
  delegationDepthLimit: number;
  authorizationBoundaryRef: SourceRef;
  selectionTraceRef: SourceRef;
  sourceRefs: SourceRef[];
  digest: string;
};
```

```ts
type ProjectProfileResolutionTrace = {
  schema: "direct_project_profile_resolution_trace@1";

  traceId: string;
  projectId: string;
  projectRevision: number;

  projectGoalRefs: SourceRef[];
  projectArchitectureRefs: SourceRef[];
  userControlProfileRefs: SourceRef[];
  environmentTopologyRef: SourceRef;
  candidateProfileRefs: SourceRef[];

  selectedProfileRefs: SourceRef[];
  rejectedCandidates: Array<{
    profileRef: SourceRef;
    reasonCodes: string[];
  }>;

  unresolvedNeeds: string[];
  authorityGranted: false;
  sourceRefs: SourceRef[];
  digest: string;
};
```

Profile examples:

```text
ARC project:
  home environment = WSL
  Project Manager = high-reasoning architecture/orchestration profile
  implementation workers = WSL
  browser verification = Windows specialist route

Windows administration project:
  home environment = Windows
  Project Manager = Windows-native project profile
  PowerShell/system specialists = Windows
  WSL compatibility check = bounded cross-environment specialist route
```

Actual worker spawn, tool use, account change, external write, or workspace
mutation still requires the existing authorization and environment transition
checks.

## Staleness And Artifact Truth

The semantic graph does not replace project files, tests, runtime state, or
external evidence.

Nodes that claim implementation or runtime state must cite artifact refs and
invalidation rules. When a cited artifact digest changes:

```text
implementation/conformance claim -> stale or remand
accepted goal/invariant -> remains unless the artifact was its only evidential
basis
implements edge -> stale until re-audited
affected projections -> warning or omission according to policy
```

This preserves the difference between semantic intent and causal realization.

## Compatibility And Migration

Migration is additive and evidence-preserving:

1. Create one user-world root and one ProjectWorld root per existing project.
2. Link existing WorkThread rows beneath ProjectWorld roots without replacing
   the WorkThread store.
3. Preserve existing `ActiveInteractionWorldmodel` rows as historical active
   snapshots. New rows cite the graph projection from which they were compiled.
4. Reclassify existing manager profiles:
   - `global_user` becomes/refers to World Manager;
   - `project` becomes a Project Manager migration candidate;
   - `work_thread` becomes/refers to Thread Manager.
5. Add Project Manager parent refs to new Thread Manager profiles. Preserve a
   compatibility adapter for historical direct World Manager parent refs.
6. Classify accepted `AgentMemoryRow` entries:
   - project facts, decisions, constraints, risks, procedures, patterns, and
     open questions become ProjectWorld promotion candidates;
   - genuinely agent-private procedural state remains agent-private memory;
   - possible user/global preferences require explicit World Manager review.
7. Add `ScopedWorldMemoryBinding` or equivalent promotion refs. Once graph-primary,
   a row cannot enter context through both legacy memory and graph projection.
8. Preserve provenance, confidence, conflicts, revisions, and supersession.
9. Deduplicate only by semantic scope/path plus normalized content digest. Keep
   distinct provenance even when semantic state converges.
10. Keep existing `AgentMemoryContextProjection` readable during migration.
11. Do not mine/import all historical transcripts. Promote only from explicit
    evidence candidates or targeted inspections.
12. Clarify that WorkThread no longer owns project ontology. It receives the
    relevant ProjectWorld projection plus a bounded objective and authority.

Migration witness:

```ts
type HierarchicalWorldmodelMigrationWitness = {
  schema: "direct_hierarchical_worldmodel_migration_witness@1";

  witnessId: string;
  projectId?: string;
  sourceArtifactRefs: SourceRef[];
  resultingNodeRefs: SourceRef[];
  compatibilityBindingRefs: SourceRef[];

  preservedProvenanceCount: number;
  skippedCandidateCount: number;
  conflictCount: number;
  doubleInclusionCount: 0;
  historicalTranscriptMiningPerformed: false;
  destructiveRewritePerformed: false;
  digest: string;
};
```

## PR Plan

### PR 151: Hierarchical Worldmodel Kernel

Branch:

```text
codex/direct-hierarchical-worldmodel-graph
```

Deliver:

```text
HierarchicalWorldmodelGraph
ScopedWorldmodelRevisionRef
WorldmodelSemanticNode
WorldmodelSemanticEdge
WorldmodelGraphTransition
append-only transition store
materialized current-view refs
source/digest/revision validators
compatibility ref from ActiveInteractionWorldmodel
fixture user world with two ProjectWorld roots and WorkThreads
```

Proof:

```text
unrelated Project B update does not stale Project A revision
stale compare-and-swap write remands
node home scope plus cross-scope edges remain explicit
rejected/superseded node remains in history but not active materialized view
```

Non-goals:

```text
live manager context replacement
historical transcript mining
Project Manager behavior
memory migration
```

### PR 152: Project Manager Role And Scoped Custody

Branch:

```text
codex/direct-project-manager-role
```

Deliver:

```text
ProjectManagerProfile
ProjectWorldState
World Manager global/cross-project target posture
World Manager -> Project Manager delegation packet
Project Manager -> Thread Manager delegation relationship
path-level custody/write matrix
Project Manager chat identity marker
manager-scope migration witness
historical direct World Manager -> Thread Manager compatibility adapter
```

Proof:

```text
World Manager cannot act as project worker
Project Manager cannot change global/constitutional state directly
Thread Manager parent defaults to owning Project Manager
Project Manager can autonomously update allowed project operational state
```

Non-goals:

```text
semantic ingress automation
graph-first provider context
full manager UI
new task execution authority
```

### PR 153: Semantic Ingress And Governed Idea Promotion

Branch:

```text
codex/direct-worldmodel-semantic-ingress
```

Deliver:

```text
WorldmodelIngressEnvelope
TranscriptEvidenceRef
TranscriptInspectionArtifact
distinct semantic-ingress broker packet
SemanticTargetResolution
WorldmodelDeltaCandidate
WorldmodelPromotionTransition
multi-scope split/remand
idea lifecycle and contextual audit
```

Proof:

```text
raw user input is evidence/candidate, not automatic graph truth
same project idea through either manager resolves to the same target path
broker cannot commit
bounded transcript inspection carries no current instruction authority
source-less promotion fails
```

Non-goals:

```text
autonomous transcript mining
embedding/vector retrieval requirement
silent promotion from provider/tool output
```

### PR 154: Role-Indexed Graph Context

Branch:

```text
codex/direct-worldmodel-graph-projections
```

Deliver:

```text
WorldmodelGraphProjection
world/project/WorkThread/worker selection policies
deterministic relevance traversal
boundary refs and omission witness
ManagerDialogueFrame
ManagerTurnBootPacket
changes-since-previous projection
targeted evidence drill-down
graph-first manager context-pack adapter
ActiveInteractionWorldmodel compilation witness
```

Proof:

```text
World Manager restart preserves accepted state without transcript replay
Project Manager restart preserves project state without transcript replay
World targeted descent and project-resident projection share canonical project
node ids/digests
unrelated/private nodes remain omitted with explicit counts
ordinary manager boot contains no historical transcript text
```

Non-goals:

```text
universal migration of every ordinary chat context
ambient full-graph access
general graph UI
```

### PR 155: Project Memory And Bidirectional Propagation

Branch:

```text
codex/direct-project-memory-propagation
```

Deliver:

```text
ProjectMemoryCandidate
ScopedWorldMemoryBinding
WorkThread closure -> project-memory admission
WorldToProjectUpdatePacket
ProjectToWorldStatusProjection
ProjectGraphUpdateAcknowledgement
projection invalidation and materiality rules
WorkThread/boot-packet stale impact witness
cross-project candidate escalation
```

Proof:

```text
worker closure is not project truth before Project Manager admission
Project Manager can update project progress without World Manager mediation
strategic subset flows upward without raw project memory
global relevant update reaches only affected projects
goal/authority change stales affected WorkThreads
legacy and graph memory cannot both enter one context
```

Non-goals:

```text
worker direct graph writes
automatic cross-project memory promotion
parent overwrite of newer project operational state
```

### PR 156: Project Execution-Profile Resolution

Branch:

```text
codex/direct-project-profile-selection
```

Deliver:

```text
ProjectExecutionProfileBinding
ProjectProfileResolutionTrace
control-profile/worldmodel input refs
home-environment selection
Project Manager model/effort binding
allowed worker profile set
preferred specialist routes
profile-change project update packet
```

Proof:

```text
profile selection cites project goals/architecture, control state, topology, and
catalog evidence
WSL project can select a Windows browser specialist route
Windows-native project can bind a Windows Project Manager profile
profile selection grants no spawn/tool/action authority
unavailable or ambiguous profile need produces remand
```

Non-goals:

```text
live arbitrary environment mutation
unbounded worker spawn
capability grant from catalog presence
```

### PR 157: Compatibility Migration And Agentic Games

Branch:

```text
codex/direct-worldmodel-migration-games
```

Deliver:

```text
manager-scope migration adapter
AgentMemory -> semantic-node compatibility adapter
WorkThread ProjectWorld parent linkage
no-double-inclusion witness
fixture migration reports
dual-ingress convergence games
manager restart/context games
transcript drill-down game
stale/conflict/privacy/profile negative games
implementation audit and status projection updates
```

Proof:

```text
legacy stores remain readable
no destructive migration
no automatic transcript import
source genealogy survives migration
all Wave 26 acceptance scenarios have behavior plus harness-evidence verdicts
```

Non-goals:

```text
full production manager UX
physical retention/TTL changes
automatic global memory synthesis
```

## Required Fixtures And Agentic Games

### Core Convergence

1. Send the same project idea to the World Manager and the owning Project
   Manager in isolated equivalent fixtures.
2. Prove both routes inspect the same current ProjectWorld revision.
3. Prove both resolve the same canonical target path/node ids.
4. Prove both produce extensionally equivalent resulting project state while
   retaining distinct ingress/source refs.

### Targeted Descent

```text
World Manager receives project idea
  -> compact project index identifies target
  -> bounded project projection loaded
  -> unrelated project details remain absent
  -> delta admitted/remanded at project scope
```

### Upward Escalation

```text
Project Manager receives user/global or cross-project idea
  -> cannot mutate global state directly
  -> emits upward candidate
  -> World Manager admits/remands
  -> only affected project projections update
```

### Mixed-Scope Input

One user message containing a user-level preference and a Project X design idea
produces two linked scoped candidates rather than a single arbitrary target.

### Project Memory

```text
WorkThread closure
  -> ProjectMemoryCandidate
  -> Project Manager audit
  -> admitted project node
  -> reused by a later intersecting WorkThread
  -> no source transcript replay required
```

### Transcript Drill-Down

Ordinary manager context contains no historical transcript body. A dispute over
one promoted node triggers a bounded transcript inspection by exact source ref.
The excerpt remains historical evidence and cannot override current user input.

### Idea Lifecycle

Rejected, deferred, superseded, refuted, and stale ideas remain queryable in
history but do not appear as active graph truth. An audit-specific projection
may include them with status intact.

### Artifact Drift

A changed source artifact marks an implementation/conformance claim and its
`implements` edge stale without erasing an independently accepted goal or
architectural invariant.

### Revision Conflict

Two managers propose changes from the same base project revision. The first
commits; the second is rebased/remanded or explicitly merged by a new audited
candidate. Last-write-wins is forbidden.

### Projection Difference

World Manager and Project Manager projections share canonical Project X node
refs but contain different surrounding graph cuts, semantic depths, and
omission witnesses.

### Profile Resolution

A WSL project with a Windows-native browser verification need selects an
allowed Windows specialist profile and environment route. The resulting trace
states `authorityGranted=false` and the actual transition still routes through
authorization.

### Migration

An accepted legacy `AgentMemoryRow` becomes a ProjectWorld promotion candidate,
preserves provenance/conflict/supersession, gains a compatibility binding, and
cannot be included through both memory and graph projections.

## Negative Fixtures

These must fail or remand:

```text
raw transcript permanently injected into a manager boot packet
raw private World Manager transcript exposed to Project Manager
source-less idea promotion
broker commits its own target interpretation
worker directly mutates ProjectWorld graph
Project Manager changes constitutional policy
World Manager silently overwrites newer project operational state
stale revision silently wins
rejected/refuted idea appears as active context truth
artifact-backed implementation claim remains fresh after source digest changes
profile/catalog/environment availability grants action authority
current user instruction loses to older memory
Project B memory appears in Project A without an authorized cross-project edge
legacy memory and promoted graph node both enter the same provider context
session/chat id is treated as canonical semantic scope
```

## Acceptance Criteria

- One hierarchical graph represents user-world, project, and WorkThread semantic
  state with scoped revisions and append-only transitions.
- World Manager is the user/global/cross-project custodian in the refined target
  architecture.
- ProjectManagerProfile exists as an explicit durable project custodian between
  World Manager and Thread Manager.
- Project Manager owns project-derived memory, conceptual state, progress, and
  WorkThread portfolio within its declared boundary.
- Either World Manager or Project Manager may receive a project idea, while the
  target semantic path determines the same lawful commit controller.
- The same idea through both ingress paths can converge on extensionally
  equivalent canonical project state without erasing distinct provenance.
- User/global and project-local changes propagate through revisioned,
  materiality-aware update packets.
- Stale/conflicting updates remand/rebase rather than silently winning.
- Transcript remains durable, exact, re-inspectable evidence but is absent from
  ordinary manager context by default.
- A promoted node records source refs, contextual audit, scope, abstraction
  level, ODEU impact, lifecycle, epistemic state, normative force, custody,
  revision, and supersession.
- Rejected/deferred/refuted/superseded ideas remain in history without entering
  active projections.
- Active context is a budgeted, role-specific graph projection with boundary
  refs, omissions, and source revision witness.
- World Manager ordinary context stays meta-level; detailed project descent is
  demand-driven.
- Project Manager context is detailed within its project and contains only
  relevant inherited world constraints.
- WorkThread and worker context remain bounded projections with existing
  authority/boot-packet laws.
- Project work-derived memory requires Project Manager admission.
- Existing AgentMemory, WorkThread, transcript, manager, and
  ActiveInteractionWorldmodel artifacts remain readable through compatibility
  adapters.
- Graph-primary migrated memory cannot be included again through legacy memory
  projection.
- Project profile selection is evidence-backed and remains deontically separate
  from authorization.
- No fixture passes from resident/model prose alone; graph, transition,
  projection, revision, and source-evidence witnesses must agree.

## Completion Gate

Wave 26 is complete only when:

```text
Direct can boot a World Manager from a world-level graph projection and a
Project Manager from a deeper project projection; interpret a project idea
received by either surface against the same canonical project state; preserve
the originating chat as inspectable evidence; admit, defer, reject, split, or
remand one typed semantic delta at the correct path; update materialized state
and both manager projections without transcript replay; propagate relevant
world/project/WorkThread changes through revisioned packets; admit work-derived
project memory; migrate existing memory/manager/WorkThread artifacts without
double inclusion or destructive rewrite; and resolve an effective project
execution profile without granting new action authority.
```

The final resident/user-facing claim must remain bounded:

```text
implemented hierarchical semantic substrate and fixture/headless proof
!= full autonomous World Manager product
!= complete historical-memory ingestion
!= graph truth automatically matching repository/runtime truth
```
