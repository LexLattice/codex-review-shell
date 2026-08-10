# Direct Harness Project Master Status

## Wave 26 Local Status (2026-07-15)

Internal slices PR151–PR157 are implemented locally as one fixture/headless
hierarchical-worldmodel substrate, including compatibility migration games.
The [final Sol Max acceptance verification](./audits/DIRECT_WAVE26_TERRA_HIGH_VS_INTENT_SOL_MAX_AUDIT_2026-07-15.md#final-acceptance-verification)
is GREEN for that bounded gate. The executable bridge audit deliberately keeps
`ic62` as `partial / keep_guarded`; one combined GitHub PR is pending and no
per-slice GitHub PR is implied. This is not a claim of production manager UI,
external-provider integration, automatic transcript migration, production
custody, or new action authority.

Status: canonical human-readable carryover entrypoint for the direct harness.

Last updated: 2026-08-09 after implementation of the ordinary Direct native
multi-agent reasoning pool, in addition to the first restricted
`WM-SC11` role-governed epistemic-ledger and semantic-CI foundation, following implementation
of the governed semantic sequence through the `WM-SC7.2` current-to-target
bridge, provisional `WM-SC8.1` ARO
mutation-contract compiler, read-only `WM-SC8.2` realization-mapping bridge,
bounded `WM-SC8.3` native Direct worker handoff, and `WM-SC8.4` exact
realization-evidence acquisition, and `WM-SC8.5` semantic verification and
closure candidacy, plus `WM-SC9` thought brushes and the reversible
ContextCanvas, and `WM-SC10` unified operational-context and semantic-anatomy
projection; one combined Wave 26 GitHub PR is pending.

Authoritative branch and repository:

```text
codex/direct-chatgpt-harness
/home/rose/work/LexLattice/codex-review-shell-direct
```

This document answers:

```text
What are we building?
Which architecture laws are settled?
What is implemented versus merely modeled?
Which documents govern each area?
What remains open?
How should a fresh task safely resume the work?
```

It is a curated status map, not runtime authority. For executable implemented
state, run:

```sh
npm run direct:information-bridge-audit
```

The PR numbers used in the wave roadmap are implementation-sequence numbers,
not GitHub pull-request numbers. Internal PR 150 was merged through GitHub PR
288.

## Start Here In A Fresh Task

1. Check out and synchronize `codex/direct-chatgpt-harness`.
2. Read this document.
3. Read the root constitution and current wave roadmap.
4. Run the executable information-bridge audit.
5. Inspect the dedicated spec for the capability being changed.
6. Verify whether the capability is modeled, fixture-proven, headless-proven,
   resident-declared, live-callable, and operator-usable. These are distinct.

Minimum orientation commands:

```sh
git status --short --branch
git log -5 --oneline --decorate
npm run direct:information-bridge-audit
npm run check:direct-syntax
npm run check:script-syntax
```

Primary reading order:

1. [Direct Information Bridge Constitution](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
2. [Direct Information Bridge Wave Roadmap](./DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md)
3. [Direct Information Bridge Implementation Audit](./DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md)
4. The dedicated wave/capability spec linked from the roadmap.

## Product Identity

The project is not fundamentally a Codex clone, database, thread viewer, or
tool runner. It is a unified information bridge between the human and the
OAI-side model intelligence:

```text
human intention
  -> interface/control event
  -> evidence artifact
  -> selected context
  -> provider request
  -> model cognition/output
  -> harness interpretation
  -> UI projection
  -> authorized action
  -> world mutation
  -> new evidence
```

Database rows, rollouts, context packs, memory, compaction, batons, tools,
skills, hooks, agents, approvals, UI panes, and analytics are organs of this one
bridge. Every component must state what information it preserves, selects,
compresses, exposes, authorizes, mutates, or audits.

Root doctrine:
[DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md).

## Post-Wave-26 World Manager And Unified UX Target (2026-07-26)

The current product-design target is now captured in the
[World Manager Agent-World And Unified UX spec](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md).
It refines the earlier expectation of separate top-level World Manager and
Project Manager chats into one persistent World Manager-governed
communications plane:

```text
one conversation and voice relationship at the surface
  -> semantic World Manager routing
  -> Project Manager or other bounded role may formulate the response
  -> typed AgentResult renders to the user
  -> delegated-role results enter parallel World Manager reconciliation
  -> WorldManager-owned conversation completes without recursive reconciliation
  -> candidate/admission/contract/execution lineage remains inspectable
```

The World Manager remains the fixed constitutional root. Other roles are
future trusted templates compiled from settled worldstate into bounded
`AgentInstantiation` objects. The compiled unit includes prompt, authority,
capabilities, budget, evidence access, completion evaluator, and return
contract.

Project/user preferences are future canonical `PolicyObject` state. The World
Manager performs semantic scope/task settlement; the harness mechanically
computes inherited obligations and projects only the operative discriminators.
Prompt instruction, capability gating, approval, evaluation, and audit must
agree and must report their actual enforcement strength.

The UX law is:

```text
At the surface, show coherent agency.
At depth, reveal truthful differentiation.
Preserve one semantic lineage through every layer.
```

The
[Direct WorldManager Semantic Mockup](./DIRECT_WORLD_MANAGER_SEMANTIC_MOCKUP.md)
now implements one exploratory planning vertical slice with typed lineage,
completion relay, bounded Project Manager instantiation, reconciliation,
evidence-gated admission, a dedicated renderer, and fixture/live-Direct role
paths. It does not claim a production resident World Manager, general policy or
agent-instantiation compilers, production renderer migration, worker execution,
or voice integration.

The
[Direct WorldManager Keyboard Pipeline Integration Spec](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md)
now has its `WM-K1` foundation, `WM-SC1` fixed semantic-ingress slice,
`WM-SC2` semantic-history catalog, `WM-SC2b` split orchestration, and bounded
`WM-SC2b.1` truth/recovery stabilization, the `WM-SC3` semantic
artifact/decision kernel, the `WM-SC4` operational semantic-context importer,
`WM-SC5` governed decision transitions, `WM-SC6` semantic-surface compilation,
`WM-SC7` ARO registry/reconstruction, `WM-SC7.1` automatic repository
reconstruction, and `WM-SC7.2` governed target definition,
`WM-K2` settlement slice, `WM-K3`
agent-world compilation slice, `WM-K4` persisted role-runtime slice,
`WM-K5A/K5B` plan proposal and exact semantic/control admission parity, and the
bounded `WM-K5G`/`WM-K6G` project-genesis admission slice: a
resident SQLite
WAL control plane, authoritative trust-store graph binding, append-only
semantic-event and message ledger, provider-backed native semantic discharge,
open type/subtype expressions, mechanically adapted typed settlement,
exact typed-binding validation and mechanical K2 settlement,
typed routing and clarification, actual World/Project Manager profiles,
role-indexed graph projection, ManagerTurnBootPacket, restart reconstruction,
typed PolicyObject adaptation, deterministic obligation closure,
ResolvedTaskConstitution, trusted role templates, AgentInstantiation manifest,
fail-closed projection agreement, persisted Direct Project Manager and
WorldManager sessions/turns, final-message-anchored AgentResult relay, separate
telemetry, semantic inbox delivery, advisory reconciliation, production
`world-manager:*` IPC, the keyboard evidence surface, grounded WSL/Windows
realization ranking, project-constitution candidates, explicit evidence review,
operator admission, canonical project constitutions, immutable runtime
defaults, backend-private native workspace locators, canonical project
workspace bindings, harmless WSL/Windows resident readiness receipts,
immutable WorkThread environment bindings, exact step snapshots, and exact
child-thread inheritance. Each settled turn now receives versioned event-to-lane/project/task/
object relations and mechanically materialized shelves. System-introspection
turns compile a bounded multi-turn semantic-history horizon with exact message,
settlement revision, task settlement, relation, shelf, and visible AgentResult
witnesses instead of hard-coding the immediately preceding row. Manager open
decisions and legacy clarification/admission rows now receive canonical,
append-only `OpenDecision` identities with typed resolution modes,
dependencies, consequences, resolution contracts, and direct
`project_open_decisions` shelf membership. Each settled role instantiation now
receives a typed, budgeted `IMPORT_CONTEXT` result assembled from exact
world/project/task shelves. Peer-project shelves are explicitly excluded,
dependency changes stale immutable cached bundles, and the actual Direct
request manifest is linked back to the operational meta-context. The keyboard
surface exposes the active scope, shelf selection, omissions, token estimate,
freshness, and request lineage without granting authority. General plan
proposals still stop truthfully at K4. Project genesis can now provision and
address its native Direct substrate; authoritative hierarchical project-world
activation remains a separate unclaimed transition.

The next semantic architecture is captured in
[Direct WorldManager Semantic Context, ARO, And Thought Tools Design](./DIRECT_WORLD_MANAGER_SEMANTIC_CONTEXT_ARO_AND_THOUGHT_TOOLS_DESIGN.md).
Its `WM-SC1` replacement of K2/K4 lexical natural-language classification with
a fixed WorldManager semantic-ingress constitution, its `WM-SC2`
versioned semantic-history catalog, `WM-SC2b` split child orchestration, and
`WM-SC2b.1` truth/recovery stabilization, plus the `WM-SC3` semantic
artifact/decision kernel, `WM-SC4` context importer, `WM-SC5` governed
decision transitions, and `WM-SC6` semantic-surface compiler are implemented.
The
constitution selects a native top-level discharge action and persists open
semantic type expressions; strict validation governs form, references, and
authority boundaries rather than reverse-validating semantic content against
a closed schema. A structurally complete typed discharge may receive its
already compiled schema discriminator deterministically; missing required
semantic fields still remand. Partial split closure now outranks older
headline state, preserves incomplete child outcomes, and emits a distinct
post-answer harness diagnostic. The Project Ecology and Decision/Outcome
inspectors expose project constitutions, preserved project seeds, current
typed decisions, their resolution contracts and shelf binding, split outcomes,
and historical remands without treating
inspection as runtime activation or counting historical failures as current
decisions. Reconciled candidate-only projects now enter Project Ecology
immediately with provisional styling and separate counts; evidence review and
admission advance the same project identity without a duplicate card or
premature runtime focus. Semantic corrections supersede relation state and rebuild
affected shelves without rewriting raw interaction evidence; legacy K2-only
rows reconstruct with explicitly provisional posture. Existing `wm_decisions`
remain operational compatibility gates. SC5 now governs exact mechanical
resolution and scoped semantic, evidence, and authority relays with append-only
receipts, revision/idempotency gates, shelf rebuild, and context-cache
invalidation. These paths grant no execution authority and do not perform
downstream project effects. Relays now distinguish semantic project identity
from provisioned role-runtime addressability: an exact decision attached to an
unprovisioned project is imported as an explicit semantic object into a
world-scoped WorldManager deliberation rather than being rejected as an
unknown runtime project or falsely activating that project. The SC6 compiler
now projects the same exact semantic objects through O/E/D/U landscapes,
versioned morph resolution, inline conversation artifacts, a global Decision
Dock, project indicators, and responsive inspectors. Exact semantic-region
bindings travel with scoped decision input and project-genesis
review/admission requests; a view can change foreground but cannot change
identity, authority, or canonical standing. Transition receipts are compiled
read-only status objects, and the UI executes no downstream effect. The
delivered SC7-SC10 sequence extends the control plane with Abstract Reasoning
Objects
carrying intensional and counterfactual branches, realization coverage, and
reversible thought-paint operators. Their canonical closure/admission boundary
remains intentionally unavailable.

The active semantic substrate is the
[Direct WorldManager Epistemic Ledger And Semantic CI spec](./DIRECT_WORLD_MANAGER_EPISTEMIC_LEDGER_AND_SEMANTIC_CI_SPEC.md).
`WM-SC11` turns inter-agent coordination into typed epistemic deltas,
constitutional subscriptions, bounded event delivery, context invalidation,
and artifact-type lifecycles with mechanical witnesses, independent semantic
audits, remand/escalation law, and explicit scope-relative admission gates.
It reuses the role-lane tool compiler, async wake/continuation artifacts,
semantic context importer, SC8 evidence chain, meta-orchestrator shadow, and
hierarchical-worldmodel trust store. `SC11.1` is implemented; the restricted
native worker path in `SC11.2` is live; and the subscription/context,
artifact-lifecycle, assurance, and unified-UX foundations are locally
regression-proven. The live worker path also operates headlessly; replay is
independent of later subscription changes; and production admission games prove
synchronous post-gate revocation, pinned gate-time CAS vectors, and exact
scope matching. The production Direct path now imports exact bounded ledger
context, restores resident roles after restart, wakes idle Project Managers,
defers active generation to a safe boundary, and persists provider-acceptance
receipts before delivery consumption. Exact artifact-constitution plus
assignment authorizations now start one producer WorkThread and exact-revision
independent auditor WorkThreads without fabricating operator approval. Trusted
provider-native producer closures are now joined to their exact persisted
authorization/assignment/agent-run binding and registered as immutable artifact
revisions. Registered auditors are routed automatically; typed verdicts advance
assurance, create revision-scoped remand obligations, re-dispatch the producer,
and raise a manager escalation after the third remand. Late verdicts after
remand/replacement fail closed, while sibling audits remain valid across
evidence-only lifecycle revisions. Durable lifecycle-ingestion receipts are
projected and restart/idempotency proven. Headless producer patch and focused-
test requests are durably planned and separately authorized rather than granted
by the lifecycle. The harness binds their observed results and a later exact
repository state to the producer session/turn and artifact revision, then joins
trusted `source_digest_current` and `focused_test_exit` mechanical witnesses.
An explicit Project Manager admission request now crosses the real
hierarchical-worldmodel governance registry and trust store through an exact
scope-relative CAS. Pending, admitted, failed, and stale-CAS receipts survive
restart; work-thread admission does not widen project/world standing; and a
commit completed before the local receipt is reconciled idempotently. Generic
authority-bearing model ledger tools stay disabled. `SC11.8` now joins that
complete path to a same-context lifecycle/evidence/authority workbench. Its
two-step typed request crosses the real Electron preload/IPC/service boundary
without letting the renderer choose an authority actor, and receipt-backed
admission survives restart. The identical game passes in the isolated
Docker/Xvfb stack.

## One UX, Two Runtime Paths

The intended product has one UX with two backend realizations:

```text
App Server
  vanilla Codex/app-server behavior retained when its semantics fit our laws

Direct
  our full information-bridge implementation over direct provider primitives
```

The user-level choice is `App Server` versus `Direct`. Earlier internal labels
such as direct-text and direct-tool are implementation details, not separate
products or top-level UX modes.

Standing compatibility rule:

```text
if vanilla behavior aligns with evidence/context/authority/work-world law
  -> retain and adapt it

if vanilla behavior conflicts with those laws
  -> keep it on the app-server path and build a direct-native realization
```

Do not remove the app-server path while building Direct. Do not fork the UX by
backend when the same normalized projection can serve both paths.

Relevant documents:

- [App-server ontology](./CODEX_APP_SERVER_ONTOLOGY.md)
- [App-server orchestration controls](./CODEX_APP_SERVER_ORCHESTRATION_CONTROLS_SPEC.md)
- [Direct app-server replacement boundary](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [Direct harness ODEU matrix v0.2](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

Current app-server compatibility slice:

```text
managed app-server launch
  -> always preserves hide_spawn_agent_metadata=true
  -> explicitly selects narrow exposure true or false

root effort = ultra
  -> vanilla proactive orchestration posture

stock 0.144.4 fallback
  -> task_name, message, fork_turns
  -> child model/effort provider-managed

active WSL stable 0.145.0 project profile
  -> adds canonical model/reasoning_effort fields
  -> keeps agent_type/service_tier hidden
  -> none/bounded fork only; active-backend model set
  -> projects a fresh Low-effort/model-inheriting worker intent into new tasks

worker interaction
  -> observable through canonical activity/output, not directly user-chatable
```

This is an app-server-path activation, not a claim that the Direct-native
worker runtime has reached the same live orchestration behavior. The shared
shell preserves `max` and `ultra` for the root and observes child runtime
metadata when reported. It no longer claims per-spawn controls merely because
the local Rust handler can parse fields that the hosted reserved schema does
not authorize. The active WSL npm runtime now contains upstream commits
`ea15456284` and `92938d880e`; a project-scoped control selects that canonical
split profile without changing the stable source-audit fork or the separate
Windows/bundled-desktop Codex installations. The enabled profile pins the
configured WSL command even when a resumed task keeps its desktop source home,
preventing silent bundled-binary substitution. Both launchers now default WSL
tasks to the authenticated `/home/rose/.codex` runtime home rather than the
unauthenticated repo-local home. Configured exposure remains
distinct from provider-accepted child runtime evidence. A live
`gpt-5.6-sol`/Ultra app-server smoke accepted the reserved split schema, emitted
fresh-child activity, and completed its collaboration wait; a canonical child
runtime profile remains the required witness for effective worker effort.

The stable source baseline is now `rust-v0.145.0`, tracked through the fetched
remote ref `origin/upstream-latest-release`, and the managed WSL runtime now
runs npm-global `@openai/codex@0.145.0`. A root real-turn probe and read-only
app inventory/metadata probe pass on stable. Release 145 adds usable paginated
history, explicit direct-input readiness, app and environment discovery,
notification evidence clocks, contextual forks, stable multi-agent V2, and
additional usage/compaction/import evidence. See the
[release 145 impact audit](./audits/UPSTREAM_CODEX_RELEASE_145_IMPACT_2026-07-22.md)
for the source evidence, caveats, and recommended adoption sequence.

The first compatibility slices are implemented: notification emission and local
receipt clocks remain distinct through the bridge and usage ledger;
`canAcceptDirectInput` gates composer and mutation calls; environment
connection events plus `environment/status` project into the environment
witness UI; and `app/installed` plus `app/read` project bounded,
non-authoritative application evidence into the capability drawer. Explicit
rejected/unknown eligibility fails closed, while a missing field remains a
labeled legacy-runtime fallback. Paginated history, contextual forks/imports,
and a stable effective child model/effort witness remain pending.

## Core ODEU World Model

Every active interaction should be explicitly typed across four ODEU lanes:

```text
O: objects, identities, relations, state, environment
E: evidence, provenance, confidence, freshness, uncertainty
D: duties, permissions, prohibitions, gates, authority
U: objective, ranking, cost, risk, success conditions
```

The model itself is an object inside that world. Before action, it should know:

```text
what role it has
what task/work world is active
what evidence it actually received
what capabilities are available/disabled/blocked
what environment owns each capability
what actions require routing or authorization
what counts as success and closure
```

Relevance is not keyword similarity. Information is relevant when it can change
the active O, E, D, or U state.

Implemented Wave 23 substrate:

```text
ODEU Worldmodel Manager
  -> active interaction worldmodel
  -> constitutional policy and self-binding records
  -> role-indexed authorization routing
  -> WorkThread delegation
  -> Thread Manager
  -> scoped worker boot packet
  -> worker / specialist / auditor
```

The Worldmodel Manager is the control-plane role. Workers should not renegotiate
standing user policy directly. A blocked worker action is routed to the manager,
which can grant, deny, remand, or escalate according to typed policy.

The intended practical recursion is:

```text
Worldmodel Manager
  -> Thread Manager
    -> carries a bounded task itself
    -> or delegates to scoped workers/sub-agents
```

This is recursive constitutional relay over progressively narrower worlds. The
substrate exists; broad autonomous orchestration and every live UI path do not
follow merely from the existence of these schemas.

Relevant documents:

- [Worldmodel Manager and authorization spec](./DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md)
- [Role-lane multi-agent architecture](./ODEU_ROLE_LANE_MULTI_AGENT_ARCHITECTURE_SPEC.md)
- [Meta-orchestrator loop](./META_ORCHESTRATOR_LOOP_ODEU_SPEC.md)
- [Recursive ODEU build meta-program](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)

## Identity Hierarchy

The settled identity law is:

```text
Agent is the durable institutional actor.
AgentRun is a bounded execution/role episode.
WorkThread is the active work-world identity.
Thread/session is an interaction witness.
Turn is one interaction transition.
Message/item/tool row is event evidence.
```

Therefore:

```text
Agent != Thread
Thread != Memory
Memory != Context
Context != Provider Truth
Provider Output != Local Authority
```

Memory belongs to an agent/project/role scope and can derive from multiple
threads and other evidence. It does not become true or authoritative merely by
being remembered. Threads remain canonical witnesses; Agent identity does not
replace them.

Relevant documents:

- [Agent continuity and governed memory](./DIRECT_WAVE21_AGENT_CONTINUITY_MEMORY_SPEC.md)
- [WorkThread foundation](./DIRECT_WORK_THREAD_FOUNDATION_SPEC.md)
- [WorkThread context/authority alignment](./DIRECT_WORK_THREAD_CONTEXT_AUTHORITY_ALIGNMENT_SPEC.md)

## Current Implementation Map

At this update, the executable registry reports:

```text
rows: 105
valid: yes
missing source files: 0
implemented: 39
partial: 64
inherited: 2
```

Regenerate this snapshot instead of trusting the counts indefinitely.

### Evidence And Persistence

Implemented or established:

- append-safe direct session/turn/tool evidence;
- direct thread operation ledger and rebuildable projections;
- direct meta-session ledger and current pointers;
- context packs and request manifests;
- workspace mutation truth and recovery/replay safety;
- provider/runtime analytics fact persistence;
- agent identity, agent runs, thread links, memory candidates, and memory
  admission records;
- context-maintenance artifacts including resident checkpoints.

Primary implementation areas:

```text
src/main/direct/session/
src/main/direct/thread/
src/main/direct/meta-session/
src/main/direct/analytics/
src/main/direct/bridge/
src/main/direct/context/
```

### Authority And Tool Execution

Implemented substrate includes:

- shared ODEU capability lifecycle;
- per-call authority transactions;
- result envelopes and context-admission records;
- read, patch, command, recovery, and workspace-effect evidence;
- role-lane tool bundle composition;
- resident capability catalogues and declaration snapshots;
- human-control tools, external read/discovery, hosted-tool boundaries, and
  sub-agent lifecycle/follow-up contracts.

Critical law:

```text
capability modeled
  != promoted
  != active
  != declared to the model
  != authorized for this call
  != executed
  != admitted into model context
  != proven usable
```

Never answer “is tool X available?” from source existence alone. Inspect the
role-lane bundle, activation state, provider declaration snapshot, environment,
per-call authority, and live evidence.

### Agents And Multi-Agent Work

Implemented substrate includes:

- agent class specs and role lanes;
- provider-backed bounded child execution;
- resident-visible sub-agent declarations and operator projections;
- list/inspect/wait/status evidence;
- lifecycle compatibility, follow-up, and close/interrupt/resume authority rows;
- no-interference self-binding and E-channel observation;
- child transcript projection without primary-transcript flattening;
- separate child usage attribution when provider evidence exists;
- worldmodel manager, thread manager, boot packets, and authorization routing.

Not every role receives every control. The default implementation-worker lane
is intentionally narrower than an orchestrator lane.

The ordinary Direct implementation lane now also has a separate native
reasoning pool; it is not a WorldManager feature. The process-shared default is
eight active children plus a bounded queue, configurable through
`CODEX_DIRECT_SUB_AGENT_MAX_ACTIVE` and
`CODEX_DIRECT_SUB_AGENT_MAX_QUEUED`. Its promoted `spawn_agent` accepts
`fork_turns=none|all|N` independently from child model and reasoning effort,
and `wait_agent` returns reduced terminal evidence to the resident parent tool
loop. Focused regressions prove six and eight simultaneous children, including
a full-history Terra/low child under a Sol/Ultra parent.

This is currently reasoning-only: child workspace tools, recursive spawn,
follow-up, and restart resume are not claimed. See the
[Direct Native Multi-Agent Pool spec](./DIRECT_NATIVE_MULTI_AGENT_POOL_SPEC.md)
and the [upstream 0.147 agent-runtime audit](./audits/UPSTREAM_CODEX_RELEASE_147_DIRECT_AGENT_IMPACT_2026-08-09.md).

### Environment And Async Work

Wave 24 is merged:

- explicit WSL/Windows environment topology;
- per-turn resident/tool/specialist environment witnesses;
- environment-aware capability routing;
- cross-environment transition witnesses;
- browser/plugin specialist worker contracts;
- async work registry, status, outcome, and wake policies;
- exactly-once/requeue-aware wakeup continuations.

The intended behavior is active environment awareness, not trial-and-error from
tool failure. A WSL worker may delegate browser verification to a bounded
Windows specialist. A long-running command or sub-agent should register work
once and receive a harness-managed wakeup instead of repeatedly polling raw
processes.

Relevant document:
[DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md](./DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md).

### Headless Runtime And Tests

The headless path exists so backend semantics can be tested without Electron.
It supports governed event intake, direct text and implementation routes,
output/outbox records, human-decision loops, resident self-report tests,
implementation-thread tests, provider-backed sub-agent commands, agentic game
fixtures, live opt-in games, and typed activation remands.

The containerized semantic UI acceptance path now adds a distinct proof tier
above backend headless tests. It launches the production WorldManager Electron
surface inside independent Docker/Xvfb stacks, performs semantic-region actions,
captures screenshots, and verifies isolated control-plane effects. The
fixture-safe v1 forbids provider calls, network access, live-profile mounts,
writable host workspaces, canonical project/ARO effects, and workspace
mutation. A two-stack concurrent regression proves distinct container and
WorldManager authority identities.

Important distinction:

```text
fixture proof != live provider proof != manual UX proof
```

Relevant documents:

- [Headless bridge daemon spec](./DIRECT_HEADLESS_BRIDGE_DAEMON_SPEC.md)
- [Headless runtime parity harness](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [Headless resident test checklist](./DIRECT_HEADLESS_RESIDENT_FEATURE_TEST_CHECKLIST.md)
- [Agentic testing game matrix](./DIRECT_AGENTIC_TESTING_GAME_MATRIX_SPEC.md)
- [Containerized semantic UI acceptance stack](./DIRECT_CONTAINERIZED_SEMANTIC_UI_ACCEPTANCE_STACK_SPEC.md)

## Current Context And Compaction Posture

Context is compiled explicitly through context packs and request manifests. Raw
rollout/session files are not normal prompt-construction inputs.

Merged Wave 25 adds:

```text
pressure/server-warning/manual trigger decision
  -> resident checkpoint request
  -> strict resident JSON payload
  -> raw-payload validation before normalization
  -> checkpoint/report evidence
  -> thread context-maintenance persistence
```

It deliberately does not yet add:

```text
automatic resident provider call from the live turn stream
automatic checkpoint admission into a future context pack
provider compaction execution
new_context authority
checkpoint review/edit/accept UI
checkpoint conflict resolution
```

The checkpoint is resident-authored continuity evidence, not canonical truth and
not proof that the task is complete.

Relevant documents:

- [Context policy and pack](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [Context maintenance, memory, frontier, baton](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)
- [Resident checkpoint compaction](./DIRECT_WAVE25_RESIDENT_CHECKPOINT_COMPACTION_SPEC.md)

## Persistence Architecture And Open Retention Decision

Current storage law:

```text
canonical event evidence
  -> append-safe/versioned artifacts

derived projection/index
  -> rebuildable, query-oriented, never outranks canonical evidence

memory/checkpoint/baton
  -> governed derivation with source refs, confidence, and authority limits
```

The direct path already separates canonical rollouts from projections more
cleanly than vanilla Codex. However, this recent design decision is not yet a
complete physical retention system:

```text
T0-T2 high-value information should remain durable:
  operator and assistant messages
  accepted artifacts and decisions
  obligations, authority transitions, provenance
  useful reasoning/continuity witnesses where policy permits

lower-value operational evidence should live in separate retention tiers:
  large terminal/tool output bodies
  repeated transport frames
  verbose diagnostics
  obsolete compaction intermediates
  old trace payloads
```

Desired future properties:

- physically separate high-value evidence from bulky low-value traces;
- load normal chats from compact projections, not by scanning all raw history;
- retain digests, summaries, status, and source refs after large bodies expire;
- define TTL/size/compaction policies by information class;
- never lose T0-T2 information merely to shrink a vanilla-style monolithic
  rollout or SQLite database;
- make retention deletion auditable and scoped to manifest-owned artifacts.

This needs a dedicated future wave/spec.

Relevant document:
[DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md).

## UX Direction That Must Survive

The frontend should express functional information needs, not preserve a fixed
three-panel application metaphor.

Settled ergonomic direction:

```text
Codex plane
  primary current conversation and immediate action surface

Middle plane
  morphic supplementary work surface: settings, analytics, thread directory,
  files, web, project control, review, evidence, or other active need

Right plane
  second active work surface when needed: ChatGPT, sub-agent, comparison,
  inspector, or another bounded companion
```

The three macro surfaces are geometry, not fixed functional ownership. If a
workflow does not need ChatGPT, the right plane should not remain noise. The
middle and right area may host two supplementary panels, merge into a larger
workspace, or split into a task-specific grid.

Codex-plane ergonomic direction:

- compact thread title/runtime/status bar;
- one-row active-thread tab rail;
- transcript dominates vertical space;
- composer retains stable geometry under plane-aware zoom;
- only send-affecting controls remain in the bottom band;
- settings, full analytics, environment evidence, account details, thread
  directory, and bridge diagnostics open in the middle plane;
- thread list defaults favor pinned + active/running + recent (the discussed
  baseline was 14 days), with full history available on demand;
- pinned threads explicitly override recency filtering.

Current UX is usable and should remain a stable baseline while this rework is
developed. The complete morphic layout and legacy-frontend preservation policy
have not yet been consolidated into one authoritative implementation spec.

Relevant documents:

- [Runtime header/drawer](./CODEX_RUNTIME_HEADER_DRAWER_SPEC.md)
- [Transcript/composer projection](./CODEX_TRANSCRIPT_PRESENTATION_AND_COMPOSER_PROJECTION_SPEC.md)
- [Thread linking/workbench](./THREAD_LINKING_SPEC.md)
- [Thread analytics](./THREAD_ANALYTICS_SPEC.md)
- [Sub-agent tabbed panel](./SUB_AGENT_META_TAGS_AND_TABBED_PANEL_SPEC.md)
- [Middle-pane web tab](./MIDDLE_PANE_WEB_TAB_SPEC.md)

## Resident Epistemic Access

The resident should begin each turn from explicit capability/world evidence,
not infer its state from failed calls.

It should distinguish:

```text
available and callable now
available but authority-gated
disabled by policy or self-binding
unsupported by provider/runtime
owned by another environment/specialist
temporarily stale or degraded
planned/future-owned
```

For every unavailable capability, the catalogue should explain what would need
to change: environment transition, specialist delegation, manager
authorization, operator confirmation, provider support, activation evidence, or
future implementation.

Sub-agent E-channel observation is separate from interference. An orchestrator
can self-bind a spawned worker with a no-interference policy: observation stays
available while designated send/stop/mutation actions are blocked.

Relevant documents:

- [Resident epistemic access](./DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md)
- [Tool authority families](./DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md)
- [Remaining live capability promotions](./DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md)

## Major Open Work

These are real obligations, not claims of implemented behavior.

### 1. Complete Resident Checkpoint Productization

- Wire bounded live trigger handling from pressure/server warning.
- Decide whether generation pauses, runs at turn boundary, or uses a dedicated
  resident continuation.
- Add review/conflict/admission policy.
- Admit accepted checkpoints into later context packs with source and omission
  witnesses.
- Keep provider compaction and `new_context` authority separate.

### 2. Design Tiered Retention And Fast Thread Loading

- Define T0-Tn information classes and physical stores.
- Add body-retention/TTL policies for low-value traces and tool outputs.
- Preserve high-value dialogue, decisions, obligations, provenance, and agent
  continuity.
- Make compact projections the normal load path.

### 3. Promote Worldmodel Manager Workflows To Daily Live Use

- Provide a practical direct manager chat/control surface.
- Start/select WorkThreads and delegate to Thread Managers from that surface.
- Exercise authorization remand/escalation without making ordinary safe work
  gate-heavy.
- Prefer witnesses/remands before strict blocking except for destructive,
  account, broad-authority, workspace-escape, or external-mutation cases.

### 4. Finish Capability Promotion Gaps

- Mature skill/hook/app execution and the module runner.
- Promote dynamic MCP actions only with exact authority/result contracts.
- Promote browser/plugin specialist contracts to tested live use.
- Decide provider-visible image payload separately from local image projection.
- Keep plugin install and rate-limit reset credit consumption explicit
  operator-confirmed mutations.

### 5. Morphic UX Rework

- Consolidate the dynamic-plane architecture into a dedicated spec.
- Preserve a stable legacy/baseline frontend while iterating.
- Move settings, analytics, thread management, and diagnostics out of the Codex
  transcript lane.
- Implement active/recent/pinned thread ergonomics and on-demand full history.

### 6. Continue Headless And Manual Games

- Run actual resident tasks, not only schema regressions.
- Test role-specific capability bundles and authorization models.
- Compare resident claims with harness-side declaration, execution, result, and
  context-admission evidence.
- Convert failures into typed remands and focused PRs.

## Known Deferred Account Capability

Upstream Codex 0.144 exposes rate-limit reset-bank evidence and consumption:

```text
read: account/rateLimits/read
  -> rateLimitResetCredits.availableCount
  -> optional credits[] with id, resetType, status, grantedAt, expiresAt,
     title, and description

write: account/rateLimitResetCredit/consume
  -> { idempotencyKey, creditId? }
  -> reset | nothingToReset | noCredit | alreadyRedeemed
```

Direct support is deferred. Consumption is an account mutation and requires
fresh account evidence, explicit operator confirmation, idempotency, a
post-consumption refetch, and an authority/evidence row. Per-credit expiry is
now explicitly modeled when the backend serves detail rows; `null` detail still
means only the aggregate count is known.

## Documentation Map

### Root Doctrine And Current State

- [Information Bridge Constitution](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
- [Wave Roadmap](./DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md)
- [Implementation Audit](./DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md)
- [Information Registry Spec](./DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md)
- Executable registry: `src/main/direct/bridge/information-registry.js`

### Context, Storage, Memory, And Continuity

- [Thread Log And Projection Store](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [Context Policy And Pack](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [Context Maintenance, Memory, Frontier, Baton](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)
- [Agent Continuity And Governed Memory](./DIRECT_WAVE21_AGENT_CONTINUITY_MEMORY_SPEC.md)
- [Resident Checkpoint Compaction](./DIRECT_WAVE25_RESIDENT_CHECKPOINT_COMPACTION_SPEC.md)

### Governance, Agents, And Role Lanes

- [WorkThread Foundation](./DIRECT_WORK_THREAD_FOUNDATION_SPEC.md)
- [Role-Lane Multi-Agent Architecture](./ODEU_ROLE_LANE_MULTI_AGENT_ARCHITECTURE_SPEC.md)
- [Worldmodel Manager And Authorization](./DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md)
- [World Manager Agent-World And Unified UX](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md)
- [Resident Epistemic Access](./DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md)
- [Sub-Agent MVP](./DIRECT_WAVE15_RESIDENT_SUB_AGENT_MVP_SPEC.md)
- [Sub-Agent Lifecycle And Transcript](./DIRECT_WAVE16_SUB_AGENT_LIFECYCLE_FOLLOWUP_TRANSCRIPT_SPEC.md)

### Capabilities And Tools

- [Shared ODEU Capability Kernel](./DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md)
- [Tool Authority Families](./DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md)
- [Human-Control Tools](./DIRECT_WAVE17_HUMAN_CONTROL_READONLY_TOOLS_SPEC.md)
- [External Discovery/MCP Read](./DIRECT_WAVE18_EXTERNAL_DISCOVERY_MCP_READ_SPEC.md)
- [Provider-Hosted Tools](./DIRECT_WAVE19_PROVIDER_HOSTED_TOOLS_SPEC.md)
- [Role-Lane Tool Bundle Composer](./DIRECT_ROLE_LANE_TOOL_BUNDLE_COMPOSER_SPEC.md)
- [Remaining Capability Promotions](./DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md)

### Environment, Headless, And Testing

- [Environment And Async Work](./DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md)
- [Headless Bridge Daemon](./DIRECT_HEADLESS_BRIDGE_DAEMON_SPEC.md)
- [Headless Runtime Parity Harness](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [Headless Resident Checklist](./DIRECT_HEADLESS_RESIDENT_FEATURE_TEST_CHECKLIST.md)
- [Agentic Testing Game Matrix](./DIRECT_AGENTIC_TESTING_GAME_MATRIX_SPEC.md)
- [Direct Test Observations](./DIRECT_TEST_ROUND_OBSERVATIONS.md)

### Vanilla And Provider Grounding

- [Upstream Baseline Maintenance](./UPSTREAM_CODEX_BASELINE_MAINTENANCE.md)
- [Upstream Codex Release 145 Impact Audit](./audits/UPSTREAM_CODEX_RELEASE_145_IMPACT_2026-07-22.md)
- [Upstream Codex Release 144 Impact Audit](./audits/UPSTREAM_CODEX_RELEASE_144_IMPACT_2026-07-14.md)
- [Codex App-Server Ontology](./CODEX_APP_SERVER_ONTOLOGY.md)
- [OAI/Codex Upstream ODEU Profile](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)
- [Codex Internal Knobs Map](./CODEX_INTERNAL_KNOBS_ODEU_MAP.md)
- [Direct Provider Profile](./direct-codex/profile-v0/CHATGPT_CODEX_SUBSCRIPTION_ODEU_PROFILE_v0.md)

## Fresh-Task Handoff Packet

```text
Work in /home/rose/work/LexLattice/codex-review-shell-direct on
codex/direct-chatgpt-harness.

Read docs/DIRECT_PROJECT_MASTER_STATUS.md first, then the Information Bridge
Constitution and Wave Roadmap. Run direct:information-bridge-audit before
planning changes.

Preserve the one-UX/two-backend law: app-server remains when aligned; Direct is
the full direct-native implementation. Do not expose internal direct text/tool
tiers as product modes.

Do not infer live capability from schema/source existence. Distinguish modeled,
promoted, active, provider-declared, per-call-authorized, executed,
context-admitted, and usability-proven states.

Preserve Agent > AgentRun > WorkThread > Thread/session > Turn identity law,
ODEU worldmodel/manager boundaries, role-lane tool composition, explicit
environment topology, and witness-first gating for ordinary safe flows.

Current local frontier after Wave 26 acceptance reconciliation:

- the hierarchical-worldmodel substrate is accepted for its bounded
  fixture/headless gate and remains `partial / keep_guarded` in the broader
  resident-product registry;
- the accepted manager consumer is the harness-owned headless current-graph
  path, with explicit reinstall after an authority-head change;
- keyboard-first WorldManager `WM-K1` through `WM-K4`, fixed semantic ingress
  `WM-SC1`, semantic history `WM-SC2`, split orchestration `WM-SC2b`,
  truth/recovery stabilization `WM-SC2b.1`, semantic artifact/decision kernel
  `WM-SC3`, operational semantic-context importer `WM-SC4`, governed decision
  transitions `WM-SC5`, semantic-surface compiler `WM-SC6`, Abstract Reasoning
  Object registry/reconstruction `WM-SC7`, automatic repository reconstruction
  producer `WM-SC7.1`, governed current-to-target bridge `WM-SC7.2`,
  provisional ARO mutation-contract compiler `WM-SC8.1`, bounded read-only
  realization-context importer and ARO-to-code mapper `WM-SC8.2`,
  reviewed worker-constitution compiler and single-use native Direct worker
  handoff `WM-SC8.3`, and exact realization-evidence acquisition `WM-SC8.4`,
  semantic verification and non-canonical closure candidacy `WM-SC8.5`,
  thought brushes and reversible ContextCanvas `WM-SC9`, and the unified
  operational ribbon, six-depth object-centered semantic anatomy, and
  modality-neutral typed interaction projection `WM-SC10`,
  plus the bounded `WM-K5G`/`WM-K6G` project-genesis
  slice, are implemented and locally
  proven for durable ingress, idempotency, canonical graph binding,
  provider-backed semantic lane/scope/role settlement, no lexical fallback,
  atomically persisted semantic witnesses, versioned history relations,
  materialized shelves, provisional legacy reconstruction, durable semantic
  child contracts, independent child constitutions and Direct role turns, one
  parent WorldManager join, restart continuation, no-silent-terminal notices,
  truthful partial closure, recoverable project-seed projection,
  inspection-only unprovisioned constitutions, canonical typed decision
  identity, append-only decision revision state, project-open-decision shelf
  binding, non-authoritative resolution contracts, exact/idempotent decision
  transition requests, append-only receipts, semantic-region binding,
  versioned O/E/D/U lens projections and witnesses, compiled binary/choice/
  comparison/scoped-composer/status morphs, inline semantic artifacts, global
  Decision Dock and project indicators, append-only ARO reconstruction
  candidates and reviews, canonical current/target ARO revisions,
  required/possible/counterfactual branches, typed semantic edges,
  many-to-many realization bindings, branch-level coverage and source-drift
  staleness witnesses, exact-bound semantic-registry-only ARO admission,
  live ARO comparison/tree/graph morphs, same-context reconstruction evidence
  and contradiction inspection, substrate-native bounded repository
  observation, secret-filtered semantic snapshots, snapshot-digest idempotent
  bootstrap scheduling, required native Direct reconstruction discharge,
  append-only reconstruction-run revisions, restart recovery, completed-run
  reuse, visible failure/remand states, exact-run retry, same-object responsive identity,
  exact current-ARO and free-form target-intent binding, required native target
  definition, provisional target candidates, append-only target-definition
  runs, restart recovery, explicit review/admission reuse, visible comparison
  prerequisites, truthful candidate/canonical coverage grouping, and a
  mechanically reachable current/target comparison,
  exact current/comparison/target mutation binding, deterministic semantic
  delta derivation, open-vocabulary implementation obligations and verification
  requirements, append-only mutation-contract/run revisions, complete
  branch-coverage validation, restart recovery, exact-run retry, and an
  evidence-first focused contract workbench with a separate realization-review
  boundary,
  exact contract/snapshot/ARO lineage validation, substrate-native bounded
  source import, immutable source-identity imports, required Direct
  obligation-to-source mapping discharge, deterministic exact obligation and
  line-range revalidation, candidate mapping witnesses, ambiguity/omission/
  freshness posture, backend-only source excerpts, append-only mapping runs,
  restart recovery, exact-run retry, and a responsive same-context mapping
  workbench with an evidence-first SC8.3 review boundary,
  refreshed exact-source and Direct-capability evidence, immutable reviewed
  worker constitutions, explicit single-use start receipts, exact ARO
  WorkThreads, native Direct implementation-worker start, non-replay of
  uncertain interrupted starts, worker/session/turn lineage, and independent
  per-call read/patch/command authority,
  exact durable worker-turn observation, immutable tool-result and
  workspace-effect witnesses, bounded repository before/after comparison,
  mechanical required-evidence-kind presence/absence/ambiguity, append-only
  active/terminal acquisition runs, truthful observed workspace-mutation
  projection, and compact turn/tools/repository/coverage evidence lenses
  followed by exact evidence-to-contract semantic assessment, explicit
  obligation/verification/preservation/branch coverage, drift and continuation
  artifacts, deterministic fail-closed closure candidacy, and generated scoped
  OpenDecisions without canonical admission or closure-certification authority,
  followed by a trusted 11-brush semantic transformation registry, exact
  source-key and preservation validation, immutable semantic strokes,
  append-only reversible ContextCanvas revisions, mechanical project-context
  replacement, composition and undo, temporary counterfactuals, and explicit
  ARO-shaped insight extraction into the existing review/admission path without
  granting any brush canonical or workspace authority,
  task-compiled context
  requirements, authority/subject-scope separation for project-ecology
  queries, bounded configured/candidate/admitted `ProjectStatus` projections,
  exact-scope semantic imports, selection and omission witnesses,
  attention-budget enforcement, immutable dependency-keyed cache,
  operational meta-context manifests, Direct request-manifest linkage, typed
  K2 settlement/routing/clarification, private project projection, graph-first
  manager boot, deterministic policy closure, task constitution, trusted
  role-template compilation, exact manifest, fail-closed projection agreement,
  restart reconstruction without transcript replay, production IPC, and
  truthful keyboard projection, persisted Direct manager turns, typed
  AgentResult relay, semantic inbox identity, advisory WorldManager
  reconciliation, harness-observed WSL/Windows realization options,
  evidence-gated project-constitution admission, immutable runtime defaults,
  restart persistence, native WSL/Windows resident-process witnesses,
  backend-private workspace locators, canonical workspace bindings, immutable
  WorkThread environment bindings, exact step snapshots, and exact child
  environment inheritance;
- the semantic mockup remains an explicitly separate exploratory store and IPC
  namespace; production does not import its routing, proposal, or admission
  semantics;
- general `WM-K5A/K5B` plan-proposal revision, exact evidence review,
  Greenlight and typed semantic admission through one graph-CAS protocol,
  durable implementation contract, and `contract_received` WorkThread
  creation are implemented. Worker-start authority and execution remain
  `WM-K6`. For project
  genesis specifically, native workspace provisioning and real WorkThread
  environment inheritance are delivered by `WM-ENV1`; the active frontier is
  authoritative hierarchical worldmodel activation and the explicit project
  port/custody-migration operation. Automatic repository-initialization scheduling of the bounded
  ARO semantic producer, the `WM-SC7.2` target-definition bridge, and the
  provisional `WM-SC8.1` contract compiler, read-only `WM-SC8.2`
  realization mapper, bounded `WM-SC8.3` worker handoff, read-only
  `WM-SC8.4` realization-evidence acquisition, and non-authoritative
  `WM-SC8.5` semantic verification and closure candidacy, `WM-SC9`
  thought brushes with reversible ContextCanvas, and `WM-SC10` unified
  operational-context/anatomy projection with keyboard/pointer and
  voice-contract parity are delivered;
  hierarchical-worldmodel promotion of admitted AROs, continuous
  repository watching, canonical closure review/admission, and downstream
  realization transitions remain open. `WM-SC11` now implements the
  same-database ledger/recovery kernel, restricted native worker ledger acts,
  durable subscription/context/invalidation foundations, pinned artifact
  lifecycles, exact-revision assurance gates, and the unified inspector.
  Native bounded import, resident-role wake/safe-boundary continuation, and
  constitution-authenticated producer/auditor WorkThread dispatch are now
  live and headless-regression-proven. Exact provider-native producer closure
  and auditor-verdict consumption, automatic audit routing, producer remand
  re-dispatch, repeated-remand manager escalation, separately authorized
  headless workspace production, and trusted exact-revision mechanical witness
  consumption are also live. `WM-SC11.7` real scope-relative canonical
  admission is implemented through the hierarchical-worldmodel trust store,
  with exact gate-time CAS, durable authority receipts, and crash-safe retry;
  `WM-SC11.8` completes the bounded multi-agent/UX acceptance game through the
  real Electron bridge, restart recovery, and isolated Docker/Xvfb execution;
  the live voice transport remains
  deferred even though it now shares the typed interaction contracts;
  the separate real-account
  live witness also remains pending;
- full World Manager/Project Manager renderer UX, default production bootstrap,
  external-provider context replacement, and production/multi-process custody
  remain open;
- checkpoint generation is not yet automatically invoked/admitted, and tiered
  physical retention/fast-load architecture remains to be specified;
- continue using headless games to prove backend semantics before UX promotion.
```

## Maintenance Rule

After each implementation PR:

1. Update the wave roadmap status and deferred scope.
2. Update this master only when project-level truth or the active frontier
   changes.
3. Update the executable information registry when implementation truth changes.
4. Run `direct:information-bridge-audit` and focused regressions.
5. Do not copy detailed PR inventories here; link the dedicated spec and keep
   only the durable architectural consequence.

For vanilla release refreshes, follow
[Upstream Baseline Maintenance](./UPSTREAM_CODEX_BASELINE_MAINTENANCE.md): move
the local exact-tag inspection pointer, update both upstream ODEU references,
then separately audit fork `origin/main` and Direct by conceptual module. A
release-pointer update is never evidence that either implementation acquired a
capability.
