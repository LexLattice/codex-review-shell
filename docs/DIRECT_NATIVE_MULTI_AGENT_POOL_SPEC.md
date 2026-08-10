# Direct Native Multi-Agent Pool

Status: implemented bounded first slice, 2026-08-09.

## Purpose

This capability is the ordinary Direct implementation-lane answer to two
constraints observed in the hosted vanilla collaboration surface:

1. the hosted task currently exposes one root plus three simultaneously active
   child slots;
2. its exposed `spawn_agent` contract couples full-history handoff to the
   parent runtime profile, while explicit child model/effort selection is
   offered only for partial or empty history.

It is deliberately separate from the WorldManager, epistemic ledger, and
semantic-CI architecture. It gives the ordinary Direct agent a larger,
explicitly bounded reasoning pool without importing WorldManager governance.

The governing invariant is:

```text
child runtime profile = model + reasoning effort
child context handoff = none | full | recent N parent turns

runtime profile and context handoff are orthogonal inputs
```

## Runtime shape

```text
Direct parent turn
  -> spawn_agent
  -> process-shared capacity lease
       -> start immediately when a lease is available
       -> otherwise enter a bounded FIFO queue
  -> independent provider-backed child turn
  -> immutable reduced child result
  -> wait_agent
  -> bounded result summary admitted to the parent tool loop
```

`spawn_agent` is asynchronous. It returns `running` or `queued` without waiting
for the provider turn. `wait_agent` can wait for one or more child IDs/task
names and returns the first terminal update. `list_agents` and `inspect_agent`
read the same native pool projection.

Capacity is shared across the Direct Electron process, including every parent
tree using it. The primary agent does not consume a child lease.

## Defaults and configuration

```text
active child leases: 8
queued children:     64
default child model: gpt-5.6-sol
default effort:      medium
```

Environment overrides:

```text
CODEX_DIRECT_SUB_AGENT_MAX_ACTIVE
CODEX_DIRECT_SUB_AGENT_MAX_QUEUED
CODEX_DIRECT_SUB_AGENT_DEFAULT_MODEL
CODEX_DIRECT_SUB_AGENT_DEFAULT_REASONING_EFFORT
```

The active-child value is bounded to `1..32`; the queue is bounded to
`0..512`. These are local safety limits, not provider promises. Increasing
them does not change account or provider-side rate limits.

## Spawn contract

The promoted Direct declaration accepts:

```text
message             required delegated task
task_name           required stable name within the parent scope
agent_type          optional descriptive role label
model               optional child model
reasoning_effort    none | low | medium | high | xhigh | max | ultra
fork_turns          none | all | positive integer string
```

Examples:

```text
fork_turns=all,  model=gpt-5.6-terra, reasoning_effort=low
fork_turns=none, model=gpt-5.6-sol,   reasoning_effort=ultra
fork_turns=4,    model=gpt-5.6-sol,   reasoning_effort=high
```

All three are lawful combinations. `fork_turns=4` selects the most recent four
parent turns, not four individual message rows.

The admitted context is serialized into a bounded child-only prompt and is
tracked by digest and message count. Raw task/context text is held only for the
live in-memory provider call, cleared on termination, and omitted from public
pool projections.

## Authority and current boundary

The first slice is a reasoning delegation pool. Each child call currently has:

```text
provider reasoning: allowed
child workspace tools: not declared
workspace mutation: not allowed
recursive child spawn: not allowed
follow-up into an existing child: not implemented
restart persistence/resume: not implemented
raw child transcript flattening: forbidden
```

Therefore this slice solves the requested concurrency and context/profile
selection constraints, but it does not yet claim autonomous coding workers.
Children return reduced summaries to the parent. A provider usage row is
created only when the provider actually emitted usage; otherwise the result
truthfully records usage as unavailable.

## Implementation map

```text
src/main/direct/agents/native-agent-pool.js
  capacity leases, queue, identity, lifecycle, wait, status projection

src/main/direct/agents/provider-backed-route.js
  context serialization, child request, result reduction, usage attribution

src/main/direct/bridge/role-lane-tool-bundle-composer.js
  promoted spawn_agent/wait_agent provider contracts

src/main/direct/controller/live-text-controller.js
  parent-history selection, native dispatch, resident continuation loop

src/main.js
  process-scoped pool, provider transport, environment configuration
```

The parent resident tool loop permits up to 32 native-agent transitions in one
turn. That is a loop-safety bound, not the pool concurrency limit.

## Acceptance evidence

Run:

```sh
npm run direct:native-agent-pool
npm run direct:native-agent-tool-routing
npm run direct:role-lane-tool-bundle-composer
npm run direct:sub-agent-status-tool-routing
npm run direct:safe-resident-utility-routing
npm run direct:provider-backed-sub-agent-route
npm run direct:live-sub-agent-tool-surface
```

The pool regression proves more than three active children, bounded queue
promotion, ten terminal child results, scoped exact-ID lookup, and nonblocking
zero-timeout polling. The controller regression proves a full-history Terra/low
child spawned by a Sol/Ultra parent and a same-turn spawn → spawn → wait chain
whose resident agent tools remain declared without renderer approval.

## Upstream Grounding

Stable Codex 0.147 independently confirms that local collaboration capacity is
configurable and centrally leased, rather than governed by a universal
three-child rule. Its v1 and v2 spawn handlers also apply model and reasoning
effort overrides independently of full-history handoff. The stricter binary
observed in one hosted tool schema is therefore a surface contract, not a
source-runtime necessity.

Direct adopts those structural lessons while preserving its own scheduler,
authority boundaries, lifecycle records, and context-selection semantics. See
the [release-147 agent-runtime impact audit](./audits/UPSTREAM_CODEX_RELEASE_147_DIRECT_AGENT_IMPACT_2026-08-09.md)
for source evidence and deferred capabilities.

## Next maturity steps

The next useful expansions are independent and should remain separately gated:

1. restart-safe job metadata and terminal-result recovery;
2. role-compiled child tool bundles and workspace/substrate inheritance;
3. follow-up, interrupt, and close controls;
4. recursive spawning with one global capacity lease and depth bounds;
5. child transcript/evidence inspection without flattening it into the parent.
