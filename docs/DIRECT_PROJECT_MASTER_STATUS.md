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

Last updated: 2026-07-15 after local Wave 26 acceptance reconciliation; one
combined GitHub PR is pending.

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

active WSL 0.145.0-alpha.11 project profile
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

Important distinction:

```text
fixture proof != live provider proof != manual UX proof
```

Relevant documents:

- [Headless bridge daemon spec](./DIRECT_HEADLESS_BRIDGE_DAEMON_SPEC.md)
- [Headless runtime parity harness](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [Headless resident test checklist](./DIRECT_HEADLESS_RESIDENT_FEATURE_TEST_CHECKLIST.md)
- [Agentic testing game matrix](./DIRECT_AGENTIC_TESTING_GAME_MATRIX_SPEC.md)

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
