# Upstream Codex Release 144 Impact Audit

Date: 2026-07-14

Purpose: update the exact vanilla Codex baseline, record material server/core and
app-server changes, and separately decide which concepts from our diverged fork
still belong in Direct.

## Evidence And Branch Update

| Object | Evidence |
| --- | --- |
| Vanilla repository | `/home/rose/work/codex/fork` |
| Official stable release | [`rust-v0.144.4`](https://github.com/openai/codex/releases/tag/rust-v0.144.4) |
| Exact release commit | `8c68d4c87dc54d38861f5114e920c3de2efa5876` |
| Local inspection branch | `upstream-latest-release` at the exact release commit |
| Prior inspected baseline | `rust-v0.142.3` |
| Fork audit ref | `origin/main` at `0126a822fbab111f559cb05cbb96b9843888c0ce` |
| Fork/vanilla merge base | `21463a5074201a697228947e644d0ee0cba432ae` |
| Direct evidence branch | `codex/direct-chatgpt-harness`, based on `793e5d4eb3bb` |

The local `upstream-latest-release` branch was moved to the exact official tag.
It was not merged into fork `main`, Direct did not acquire capabilities from
this pointer update, and no remote update was attempted. The fork remote treats
the inspection branch as protected/read-only, so the local exact-tag pointer is
the operative inspection baseline.

The standing update method is now documented in
[`UPSTREAM_CODEX_BASELINE_MAINTENANCE.md`](../UPSTREAM_CODEX_BASELINE_MAINTENANCE.md).

Release `0.144.4` itself has no separately described user-facing patch delta on
the official release page. The findings below deliberately separate:

- changes introduced or materially strengthened between the prior `0.142.3`
  inspection baseline and `0.144.4`; and
- capabilities already present by `0.142.3` whose significance must still be
  represented in the current ODEU baseline and fork/Direct comparison.

“Current baseline” therefore does not mean “new in 0.144.4.”

## Executive ODEU Result

Vanilla now has a substantially stronger operational substrate:

```text
persisted/diffed WorldState
+ context-window and compaction continuity
+ authoritative spawned-agent graph
+ canonical worker lifecycle items
+ environment-owned capability roots
+ durable thread-local model/effort settings
+ richer plugins/MCP/auth/history surfaces
```

It still does not provide:

```text
active ODEU lane ledger
+ Worldmodel Manager constitutional continuity
+ scoped delegation/boot packets
+ mechanical child-authority subset proofs
+ semantic closure reports
+ generalist translation between specialist worlds
+ role-indexed authorization escalation
```

Therefore:

> Vanilla should remain the preferred execution substrate where its semantics
> align. Direct should implement the missing constitutional and semantic laws
> over that substrate rather than rebase the old fork wholesale.

## Significant Vanilla Baseline And Delta

### 1. Delta: World State Became A First-Class Core Object

Codex core now builds serializable per-step `WorldState`, emits full or
JSON-merge-patch fragments, persists those fragments as rollout items, restores
them during replay/resume, and starts a new full baseline after compaction.
Core built-ins cover AGENTS/instruction context, environment, app instructions,
and plugin instructions. Extensions contribute further sections; in particular,
the skills extension derives its model-visible section from selected capability
roots.

Primary source areas:

- `codex-rs/core/src/context/world_state/`
- `codex-rs/core/src/session/world_state.rs`
- `codex-rs/core/src/session/rollout_reconstruction.rs`
- `codex-rs/ext/extension-api/src/contributors/world_state.rs`
- `codex-rs/protocol/src/protocol.rs` (`RolloutItem::WorldState`)

ODEU impact:

- **O:** environment and extension objects can persist across turns.
- **E:** model-visible state now has baseline/diff/replay evidence.
- **D:** this does not itself create authority or policy inheritance.
- **U:** it is strong infrastructure for a future compact manager projection.

`WorldState` is a concrete convergence with our active-worldmodel direction,
but it is not an ODEU ledger or Worldmodel Manager. Its current sections are
mostly operational context, and the app-server legacy history projection does
not expose it as a public typed `ThreadItem`.

### 2. Delta: Context And Compaction Continuity Improved

Vanilla now has token-budget-driven context replacement, explicit context-window
identity, replacement history that preserves item IDs and checkpoints, world
state reinjection, configurable context guidance, sequential cutoff summaries,
and compaction-model fallback behavior.

This substantially covers the mechanics that the old fork tried to build around
continuation bridges. It still lacks a required, semantically curated ODEU
checkpoint/closure artifact with admission, supersession, and projection laws.

### 3. Delta: The Existing Delegation Graph Gained Authoritative Integration

`AgentGraphStore` existed by the prior baseline. The release delta injects it
into `ThreadManager` and routes spawn, close, recursive resume, subtree
list/archive/delete, and feedback traversal through the persisted graph.
Descendant traversal fixes include mixed open/closed branches, so closed
grandchildren below an open edge are not silently omitted.

This is important for our desired user-visible worker tree and high-level worker
statistics. It gives vanilla a real O-object for delegation topology. It does
not store the child's scoped constitution, authority boundary, semantic input
contract, or closure report.

### 4. Current Baseline: Thread Controls Are Durable State

Thread settings events and persisted effort already existed by `0.142.3`; they
must not be attributed wholesale to the new delta. At the current baseline,
core emits full `ThreadSettingsAppliedEvent` snapshots covering model/provider,
service tier, approval/reviewer posture, permission profile, cwd, reasoning
effort/summary, personality, and collaboration mode. Resume restores persisted
model/effort unless an explicit current override is present. App-server exposes
`thread/settings/update` and `thread/settings/updated`; the release-144 advanced
picker work strengthens the user-facing restore/override path.

This is substantive vanilla coverage of one part of our control-panel idea:

```text
knob change -> explicit event -> persisted thread-local state -> resume fallback
```

It does not yet model:

- turn/session/thread/project/global scope inheritance;
- one-turn versus standing durability;
- change rationale and authority;
- a revision vector across contributing profiles;
- a compact effective control snapshot admitted into each agent turn.

Direct should therefore adapt vanilla thread settings as one contributing
control profile, not replace the proposed control ledger with them.

### 5. Current Baseline: Multi-Agent Items And Ultra Behavior

Canonical `TurnItem`/app-server items now cover more collaboration operations,
sub-agent activity, wait/sleep, lifecycle, command, hook, review, dynamic tool,
and extension activity. `multiAgentMode` is deprecated/ignored; high reasoning
effort such as Ultra now drives proactive delegation behavior.

Several of these primitives, including `SubAgentActivity` and Ultra-driven
proactive behavior, predate `0.144.4`. Their relevance here is the current
architectural baseline, not a claim that the whole family is new in this delta.

Vanilla has become a much better worker-execution and worker-observability
substrate. It still does not make every delegation a recursive constitutional
relay, and it does not require normalized ODEU closure before child results are
admitted into the parent world.

### 6. Delta Plus Baseline: Environment And Capability Ownership

Thread/turn environment selection and `selectedCapabilityRoots` already
associated skills, plugins, and their MCP runtime with an owning environment by
the prior baseline. The current delta adds app-server `environment/info` for an
explicit shell/cwd probe and further integrates environment-owned execution.
Stdio MCP executes in the selected environment; HTTP MCP uses that
environment's client.

This materially supports our Windows/WSL law:

```text
model declares semantic execution world
-> harness validates topology and authority
-> adapter executes in the selected environment
```

But environment existence and path mapping remain separate from workspace
mutation authority. Current thread-start/runtime roots also retain host-derived
edges, so this is meaningful progress rather than complete environment-world
ownership.

### 7. Current Baseline: Plugins, Apps, MCP, Auth, And Hosted Tools

Vanilla now has stronger remote plugin catalogs, npm marketplace/version and
install-policy provenance, environment-bound plugin runtime, per-step MCP
pinning, HTTP/OAuth MCP, connector identity, hosted session auth/refresh,
external auth bridging, remote-control pairing, standalone image generation,
and an alpha standalone search adapter.

These are useful execution affordances. They do not collapse the distinction:

```text
tool discoverable != tool selected != tool authorized != effect validated
```

### 8. Delta Plus Baseline: Provider And Account Evidence

Notable upstream-facing evidence includes:

- open non-empty reasoning-effort strings, including current `max`/`ultra` and
  future model-defined values;
- richer model catalog metadata such as service tier, tool mode, multi-agent
  version, compaction hash, skills posture, and auto-review fields;
- standalone image/search endpoint adapters;
- safety buffering, moderation metadata, server model, item/turn identifiers,
  and optional `end_turn` stream evidence;
- typed reset-credit detail rows and idempotent redemption outcomes.

Open custom reasoning effort, standalone image generation, reset-credit
consumption, and many model-info fields already existed by `0.142.3`. The
release delta materially adds or strengthens items such as detailed reset-credit
rows and standalone search; this list otherwise records the complete current
baseline needed by Direct.

These remain subject to the provider-evidence law: Codex source can seed a
profile, but Direct only promotes capability from served descriptors or safe
runtime proof.

## App-Server Compatibility And Incompleteness

Important current surface changes:

- `environment/info` was added.
- `thread/items/list` replaced the older `thread/turns/items/list` name and can
  optionally filter one turn.
- `thread/list` supports parent/ancestor spawned-agent filters.
- `thread/fork` can stop at an exact completed `lastTurnId`.
- resume/fork can exclude inline turns and use separate history pages.
- `thread/settings/update` and `thread/settings/updated` expose effective
  next-turn settings transitions.
- `AskForApproval::OnFailure` is no longer a current policy value.
- `SessionBudgetExceeded` is a distinct typed error.
- MCP startup may report `reauthenticationRequired`.
- `AuthMode::Headers` means externally supplied request headers, not a human
  ChatGPT account session.
- `thread/rollback` is deprecated.

Do not overstate schema presence:

- `thread/items/list` returns `-32601` if the active store does not implement
  item pagination.
- paginated history mode exists in protocol/metadata, but current local and
  in-memory writers reject starting/resuming that storage mode.
- core persists `world_state`; the legacy app-server history reducer recognizes
  and ignores it rather than exporting a typed world-state item.
- selected environments and capability roots improve execution truth but do not
  by themselves grant workspace authority.

The full app-server reference is updated in
[`CODEX_APP_SERVER_ONTOLOGY.md`](../CODEX_APP_SERVER_ONTOLOGY.md).

## Fork Divergence Audit

Audit basis:

- 160 fork-only commits versus 2,288 vanilla-only commits from the merge base;
- fork delta: 215 files, 41,587 insertions, 1,003 deletions;
- conceptual/source audit only; no fork build or runtime test was performed.

The table uses the standing comparison vocabulary from the maintenance guide.

| Fork concept | Vanilla 0.144.4 coverage | Direct coverage | Conceptual disposition |
| --- | --- | --- | --- |
| Context-maintenance route matrix: operation × timing × engine, artifact requiredness, retention/history disposition | `partial`: vanilla compaction/WorldState/hooks are now mechanically stronger, but there is no equivalent explicit route matrix | `partial`: `src/main/direct/context/maintenance.js`; registry `ic3.context-maintenance-memory-baton` | **Reframe.** Retain route selection, required-artifact, retention, and append-only manifest laws; realize them over current vanilla primitives rather than transplanting Rust. |
| Continuation bridge (`baton`, rich review, model/effort handoff) | `partial`: WorldState, new context, compaction hooks, IDs, and replay supersede much of the transport mechanics | `partial`: frontier baton and resident checkpoint exist; automatic trigger/admission is absent | **Finish Direct implementation.** Unify as one ODEU checkpoint/closure artifact with projection witness; later adapt to vanilla pre/post-compaction hooks. |
| ODEU thread memory, fail-closed compaction, fixed five-message raw window | `partial`: vanilla memories are operationally stronger but semantically different | `partial`: durable memory, admission, reset policy, and checkpoint pieces exist | **Reframe.** Retain provenance, supersession, admission, and constitutionally required fail-closed behavior. Retire the universal five-message trim in favor of tiered retention. |
| Typed governance packets/compiler and prompt layering | `partial`: strong instruction hierarchy, permission profiles, Guardian, and WorldState; no packet compiler/projection witness | `partial`: Worldmodel Manager, Thread Manager, authorization router, constitutional policy, broker packets | **Finish Direct implementation.** Preserve packet identity, normative force, source refs, and projection witnesses. Prompt prose alone is not enforcement. |
| Generic spawn/compact/resume/swap transition legality | `adjacent`: many individual lifecycle checks, no one constitutional transition law | `partial`: `AuthorityBearingTransition`, enforcement gate, authority/revision models | **Finish Direct implementation — highest priority.** Mechanically prove child boundary subset, worldmodel revision compatibility, continuity, and environment route before execution. |
| Semantic broker v0: registry, candidate scoring, ambiguity witness, context overlay | `adjacent`: tool search/plugins route capabilities, but do not translate specialist world schemas | `partial`: semantic broker diagnostics, operator resolution, controlled routing, role-handoff packet | **Reframe.** Keep the broker role; retire the lexical classifier as endpoint. Implement the generalist translator contract described below. |
| Agent progress E-witness: phase/block/active work/material sequence/stall | `partial`: the lifecycle substrate is substantive—canonical activities/list/wait—but there is no equivalent material-sequence/stall snapshot | `partial`: `agents/observability.js` and `inspect-wait-containment.js` | **Adopt vanilla adapter.** Build one compact reducer over canonical v2 events; do not create a competing lifecycle store. |
| Blanket rule that a spawned child cannot recursively spawn | `none` by design: current vanilla permits recursive delegation under collaboration policy | `partial` with more nuanced role/tool envelopes | **Retire fork delta.** Keep only parent-authority subset plus explicit role/depth/budget delegation rights. Non-chat-facing workers are an interaction rule, not a recursion ban. |
| `thread/refresh/start` and `thread/prune/start` | `none` exactly; compact, history, memory, rollback/delete are adjacent | `modeled`: related context-maintenance artifacts exist, but no live RPC does | **Defer split.** Refresh remains useful. Prune comes later with preview, manifest, rollback posture, and manager/operator authorization. |
| Build/update/Rust-cache helpers | not a product capability | `none` and unnecessary | **Retire fork delta** from product architecture; retain only as maintainer tooling if still useful. |

Representative fork evidence on `origin/main`:

- context maintenance:
  `codex-rs/context-maintenance-policy/src/` and
  `codex-rs/core/src/context_maintenance*.rs`;
- continuation bridge:
  `codex-rs/core/src/continuation_bridge.rs` and
  `codex-rs/context-maintenance-policy/src/continuation_bridge/`;
- governed thread memory:
  `codex-rs/core/src/governance/thread_memory.rs`;
- governance packets/transitions:
  `codex-rs/core/src/governance/{packets,compiler,diagnostics,prompt_layers,transitions}.rs`;
- semantic broker:
  `codex-rs/semantic-broker/src/` and
  `codex-rs/core/src/semantic_broker_runtime.rs`;
- agent observability:
  `codex-rs/agent-observability/src/` and the agent-progress tool handlers;
- recursive-spawn containment:
  `codex-rs/core/src/tools/spec.rs`;
- refresh/prune RPC experiments:
  `codex-rs/app-server-protocol/src/protocol/` and
  `codex-rs/app-server/src/codex_message_processor.rs`.

These paths are historical evidence for the concepts. They are not presumed
cleanly transplantable across the 2,288 vanilla-only commits since the merge
base.

## Refined Orchestrator And Broker Architecture

The previous fork used “semantic broker” for a generic lexical workflow
classifier. The enhanced architecture requires a sharper role split.

### Orchestrator: A High-Level Specialist

The orchestrator is not a generic model that owns every skill. It is a
specialist in:

- maintaining the parent world's high-level invariants;
- detecting which reasoning object is missing next;
- decomposing that object into scoped specialist work;
- defining the evidence and closure contract;
- judging whether returned evidence can lawfully update the parent world;
- preserving the terminal goal and abstraction level.

It should not absorb the full abstraction stack of every reader, coder, auditor,
browser worker, monitor, or environment adapter.

### Semantic Broker: A Generalist Translator

The broker is generalist in semantic coverage but narrow in authority. It
translates between differently scoped specialist worlds:

```text
orchestrator-specialist schema
  -> typed operational need
  -> generalist broker translation
  -> target-specialist boot/delegation packet

target-specialist closure
  -> generalist broker normalization
  -> parent ODEU closure object
  -> orchestrator admission decision
```

Required broker contract:

- typed source and target world/schema identifiers;
- source provenance and revision;
- object/relation/goal mappings, including unmapped distinctions;
- ambiguity, information-loss, and remand witnesses;
- authority-neutral routing: translation never grants execution authority;
- least-context projection into the target specialist world;
- normalized O/E/D/U closure back into the parent schema;
- drill-down refs to the child thread without merging its scratch context.

Mechanical schema/type matching should handle known mappings. A broker-model
subcall is appropriate only for residual semantic ambiguity, after which the
typed result is mechanically validated.

### Deontic Broker: A Separate Specialist

Semantic translation must not be conflated with authorization. The Worldmodel
Manager/authorization router remains the D-focused specialist that applies
standing policy, grants/denies/remands, or opens user/admin confirmation.

```text
semantic broker says what the requested transition means
authorization specialist says whether that transition is lawful
environment adapter says how an authorized transition is executed
```

This prevents a generalist translator from becoming a second sovereign and
preserves the worker's U-focused resourcefulness without allowing fallback
routes to reconstruct forbidden capabilities.

### Current Direct Gap

Direct already models important pieces:

- `src/main/direct/governance/broker.js`
- `src/main/direct/governance/operator-broker-resolution.js`
- `src/main/direct/bridge/controlled-routing.js`
- `src/main/direct/bridge/role-handoff-packet.js`
- `src/main/direct/bridge/agent-class-spec.js`
- `src/main/direct/worldmodel/manager.js`
- `src/main/direct/worldmodel/authorization-router.js`

These provide diagnostic candidates, ambiguity/fallback, authority-neutral
preflight, selected WorkThread evidence, and explicit handoff packets. They do
not yet implement a bidirectional specialist-schema adapter or normalize child
closure into a parent ODEU end-state. Registry posture should remain
`partial/keep-shadow` until that contract and live relay are proven.

## Recommended Carry Order

1. Runtime-enforced transition law: child authority subset, revision
   compatibility, continuity, and environment-route validation.
2. Generalist semantic broker contract between specialist worlds, separate from
   D-focused authorization.
3. ODEU checkpoint/closure artifact integrated with current WorldState and
   compaction hooks.
4. Agent graph/status projection plus progress/stall reducer over vanilla
   canonical lifecycle events.
5. Control-profile resolver that treats vanilla thread settings as one scoped
   input and adds scope, durability, authority, and revisions.
6. Explicit context-maintenance route/retention manifests.
7. Refresh RPC; guarded prune only after preview and rollback laws exist.

## Documents Updated By This Audit

- [`UPSTREAM_CODEX_BASELINE_MAINTENANCE.md`](../UPSTREAM_CODEX_BASELINE_MAINTENANCE.md)
- [`OAI_CODEX_UPSTREAM_ODEU_PROFILE.md`](../OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)
- [`CODEX_APP_SERVER_ONTOLOGY.md`](../CODEX_APP_SERVER_ONTOLOGY.md)
- [`DIRECT_PROJECT_MASTER_STATUS.md`](../DIRECT_PROJECT_MASTER_STATUS.md)

## Bottom Line

The old fork is now more valuable as a library of explicit semantic laws than
as a source-code base. Vanilla `0.144.4` generally owns the stronger execution
substrate. Direct should absorb only the invariants that remain missing:

```text
constitutional transition legality
specialist-world translation
typed closure and admission
authority-preserving delegation
semantic checkpoint continuity
manager-readable progress evidence
```

The refined architecture is not “one generalist orchestrator with many loaded
skills.” It is a specialist high-level reasoner, a narrow generalist broker that
translates between specialist worlds, separate D-focused authorization, and
workers whose detailed abstraction stacks remain local to their own threads.
