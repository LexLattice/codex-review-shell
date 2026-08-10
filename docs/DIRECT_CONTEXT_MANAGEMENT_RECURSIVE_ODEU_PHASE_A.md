# Direct Context Management Recursive ODEU - Phase A

Status: Phase A theory artifact. This is not an implementation spec and not a
probe matrix yet.

Related:

- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_APP_SERVER_ONTOLOGY.md](./CODEX_APP_SERVER_ONTOLOGY.md)

## Purpose

Apply Phase A of the recursive ODEU build meta-program to context management.
This phase answers:

```text
What kind of machine is context management?
What is the general concept?
How does vanilla Codex/app-server instantiate it?
How does Direct currently instantiate it?
Where are the initial risks and open questions?
```

This document intentionally stops before Phase B recursive operator descent.

## Source Basis

Direct docs/code:

```text
docs/CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md
docs/DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md
docs/DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md
src/main/direct/thread/context-pack.js
src/main/direct/context/maintenance.js
src/main/direct/thread/thread-store.js
scripts/direct-context-maintenance-regression.mjs
```

Vanilla sibling sources:

```text
/home/rose/work/codex/fork/codex-rs/app-server/README.md
/home/rose/work/codex/fork/codex-rs/protocol/src/items.rs
/home/rose/work/codex/fork/codex-rs/protocol/src/models.rs
/home/rose/work/codex/fork/codex-rs/app-server/tests/suite/v2/compaction.rs
/home/rose/work/codex/fork/codex-rs/app-server/tests/suite/v2/thread_memory_mode_set.rs
/home/rose/work/codex/fork/codex-rs/app-server/tests/suite/v2/memory_reset.rs
```

Evidence authority:

```text
Direct matrix/spec law: authority for Direct design.
Direct implementation code: current Direct instantiation evidence.
Vanilla app-server docs/tests/code: sibling instantiation evidence.
Vanilla behavior is compatibility/design pressure, not a reference oracle.
```

## Base Semantic Sentence

Context management is the harness subsystem that decides, records, and exposes
what prior or derived evidence becomes model-visible input for a turn, what is
omitted or summarized under pressure, what continuity or memory is being used,
and what recovery/status facts explain those choices.

For Direct, context management must be explicit because the harness owns local
authority, request construction, provider-continuity policy, workspace evidence,
and recovery truth.

## General Conceptual Representation

The general context-management concept decomposes into these first-order
entities:

```text
canonical conversation / rollout truth
renderer transcript projection
context-safe source projection
current user intent
harness policy / role mapping
model-visible context bundle
provider request-shape manifest
provider input projection
context pressure estimate
compaction / trim / summarization route
omission ledger
durable memory
memory refresh operation
frontier baton / task-state bridge
provider continuity handle
status / operation-history projection
recovery classification
readiness / promotion evidence
```

The core conceptual law:

```text
canonical dialogue truth != context projection
context projection != provider request
provider request != provider continuity
compaction != memory
memory != current policy
omission ledger != hidden context
frontier baton != replay authority
status visibility != local authority
```

## Vanilla Sibling Instantiation

Vanilla Codex/app-server has a concrete context-management instantiation.
Initial Phase A profile:

```yaml
implementation: vanilla_codex_app_server
status: sibling_instantiation
representation_style: mostly app-server/core-owned, partially exposed as thread
  items, notifications, thread methods, memory controls, and rollout history
authority_owner: codex_core_and_app_server
renderer_role: observes and requests through app-server API
direct_relevance: compatibility pressure and design evidence
```

Observed concepts:

```text
thread/start, thread/resume:
  create or reopen model-visible thread state through app-server.

thread/fork:
  copies stored history into a new thread id; if source is mid-turn, it records
  interruption rather than inheriting an unmarked partial suffix.

thread/read and thread/turns/list:
  expose stored thread/turn history without necessarily resuming it.

thread/compact/start:
  triggers conversation-history compaction; returns immediately; progress is
  represented through standard turn/item notifications.

contextCompaction item:
  app-server thread item with an id; emitted on started/completed; automatic
  compaction can also produce this item.

ResponseItem ContextCompaction:
  upstream model/protocol item may carry optional encrypted content, while the
  app-server ThreadItem projection exposes only contextCompaction id.

thread/memoryMode/set:
  experimental setting for whether a thread remains eligible for future memory
  generation.

memory/reset:
  clears local memory artifacts and sqlite-backed memory stage data while
  preserving existing thread memory modes.

thread/rollback:
  drops last N turns from in-memory context and persists a rollback marker.

thread/inject_items:
  can append raw Responses API items to loaded model-visible history.
```

Vanilla profile implications:

```text
compaction is a first-class running turn-like activity;
compaction has UI/status visibility through item lifecycle;
compaction details are intentionally compact at the app-server item surface;
memory eligibility is a thread-level persisted setting;
memory reset is global/current-CODEX_HOME maintenance;
context continuity and model-visible history are mostly core-owned;
clients do not assemble provider-neutral context packs themselves;
app-server remains the baseline path for behavior not yet direct-owned.
```

Initial vanilla gaps or unknowns:

```text
exact internal prompt/context assembly shape is not exposed at app-server API;
full omission truth is not visible as a structured app-server artifact;
memory generation content/lifecycle is only partly exposed through controls and
  citations;
provider compact item content may be opaque/encrypted;
whether app-server has durable baton-like frontier artifacts is not established
  by Phase A sources.
```

## Direct Current Instantiation

Direct currently instantiates context management as explicit app-private
artifacts plus fixture/local maintenance evidence.

Implemented concepts:

```text
renderer_transcript@1:
  display/read projection from direct session artifacts.

context_recent_dialogue@1:
  prompt-safe recent transcript evidence derived from valid renderer projection.

direct_context_pack@1:
  provider-neutral logical model-input artifact with harness policy, current
  intent, quoted evidence, source refs, caps, omitted counts, and integrity.

direct_request_manifest@1:
  request-shape/authorization artifact with model/endpoint/evidence refs,
  feature flags, continuity policy, provider input projection, and raw-storage
  audit.

direct_provider_input_projection@1:
  reproducible mapping from context pack to provider instructions/prompt by
  shape/text hashes. Raw request body remains ephemeral.

context_maintenance_route@1:
  deterministic route decision for no-op, estimate-only, local trim, memory
  refresh, baton build, provider compact diagnostic/block, or blocked.

raw_window_trim_plan@1 and context_omission_ledger@1:
  required-artifact-aware trim plan and structured omission totals.

durable_thread_memory@1:
  summary entries with authority/contextUse/conflict/staleness fields, not
  editable and not current policy.

thread_memory_refresh@1:
  refresh manifest that can preserve current memory on failed refresh.

frontier_baton@1:
  task-frontier/status evidence with replayAuthority=false,
  approvalAuthority=false, continuationAuthority=false.

direct_context_maintenance_status_projection@1:
  display-only status over route/manifest/memory/baton/omission state.
```

Direct current limitations:

```text
ordinary live Direct turns mostly use recent-dialogue context packs;
maintenance artifacts are supported hooks but not automatic live behavior;
context maintenance regression is fixture/local, not real provider compaction;
no user-facing memory editor exists;
no provider compact primitive is promoted;
no automatic durable memory refresh from real conversations exists;
no automatic trim/compaction scheduler is active in normal Direct usage.
```

## Comparative Instantiation Summary

```text
General concept:
  context selection, model-visible evidence, pressure handling, compaction,
  memory, frontier, omissions, continuity, status, recovery.

Vanilla Codex/app-server:
  core-owned context and compaction; compact status item; automatic/manual
  compaction; memory mode controls; memory reset; rollback and fork affect
  model-visible history; details are mostly hidden behind app-server.

Direct:
  harness-owned explicit context artifacts; provider-neutral context pack;
  manifest/source-ref discipline; local maintenance schemas; omission ledger;
  memory and baton as quoted/status evidence; stronger raw-exposure and
  authority separation; less automatic behavior today.
```

Delta classification:

```text
context pack / request manifest:
  direct_only_new_explicit_artifact

recent dialogue context:
  same_concept_more_explicit

compaction status:
  same_concept_stricter_authority

compaction execution:
  vanilla_only_preserved_by_app_server_path for now

durable memory:
  same_concept_more_explicit, direct fixture/local only today

memory mode / reset:
  vanilla sibling concept; Direct equivalent not yet designed as user-facing
  settings/maintenance

omission ledger:
  direct_only_new_concept relative to visible app-server surface

frontier baton:
  direct_only_new_explicit_artifact, possibly related to vanilla hidden/core
  turn state but not proven equivalent

provider continuity:
  same_concept_stricter_authority in Direct
```

## Phase A Base Ontology Nodes

### N-CM-0 - Context Management Root

```yaml
semantic_name: Context management
program_role: decides and records model-visible evidence, omitted evidence,
  continuity state, memory, compaction, and status.
matrix_rows: [B3, C6, C8, C9, C10, D1-D14, D22, D23, A12, J11]
evidence_authority: matrix_law + direct_specs + vanilla_sibling_sources
known_consumers:
  - request_builder
  - provider_transport
  - recovery
  - renderer_status
  - operation_history
  - readiness
initial_risk: authority_blur_between_memory_context_compaction_and_provider_continuity
```

### N-CM-1 - Canonical Conversation Truth

```yaml
semantic_name: canonical conversation / rollout truth
vanilla_instantiation_summary: app-server/core rollouts, ThreadItem turns,
  resume/fork/read/list methods, rollback markers.
direct_instantiation_target: direct session/thread store artifacts are canonical;
  projections and maintenance artifacts are derived evidence.
initial_risk: derived memory or compaction could be mistaken for canonical dialogue.
```

### N-CM-2 - Context-Safe Projection

```yaml
semantic_name: selected context-safe evidence view
vanilla_instantiation_summary: mostly hidden inside app-server/core context
  builder; client sees thread items and compaction status, not provider-neutral
  context pack.
direct_instantiation_target: context_recent_dialogue@1 with caps, source
  digests, raw-exposure scan, and omitted counts.
initial_risk: renderer transcript or compact projection becomes prompt input
  without validation.
```

### N-CM-3 - Model-Visible Context Bundle

```yaml
semantic_name: provider-neutral logical input bundle
vanilla_instantiation_summary: app-server/core assembles model-visible history;
  app-server API does not expose a full provider-neutral context pack.
direct_instantiation_target: direct_context_pack@1 with harness policy, current
  user intent, quoted evidence, source refs, budget estimate, and integrity.
initial_risk: raw rollout/session files or renderer rows bypass context pack.
```

### N-CM-4 - Request Authorization Manifest

```yaml
semantic_name: authorized request-shape decision
vanilla_instantiation_summary: app-server owns request construction and
  transport; clients observe thread/turn/item lifecycle.
direct_instantiation_target: direct_request_manifest@1 records model,
  endpoint, feature flags, continuity policy, provider-input hash, and raw-body
  non-storage audit.
initial_risk: context pack exists but request shape is implicit or unrecoverable.
```

### N-CM-5 - Provider Continuity

```yaml
semantic_name: provider-side continuity or parent response state
vanilla_instantiation_summary: app-server/core owns session history and
  provider continuity details.
direct_instantiation_target: continuity must be explicit in request manifest;
  fresh quoted context is distinct from previous_response_id/provider handle.
initial_risk: local session continuity or imported/forked history is mistaken
  for provider continuity.
```

### N-CM-6 - Context Pressure

```yaml
semantic_name: budget/pressure before request
vanilla_instantiation_summary: model auto compact token limit and automatic
  compaction exist in app-server/core.
direct_instantiation_target: direct_context_pressure_estimate@1 with visible,
  hidden-required, reserved-output, total, confidence, and policy digest.
initial_risk: unknown pressure authorizes trim or compaction.
```

### N-CM-7 - Compaction / Trim Route

```yaml
semantic_name: context reduction route
vanilla_instantiation_summary: thread/compact/start, automatic compaction,
  contextCompaction item lifecycle, local/remote compact tests.
direct_instantiation_target: context_maintenance_route@1 and manifest choose
  no-op, estimate-only, local trim, memory refresh, baton build, provider
  compact diagnostic/block, or blocked.
initial_risk: compaction runs mid-obligation or provider compact is promoted
  without exact evidence.
```

### N-CM-8 - Omission Truth

```yaml
semantic_name: representation of what was omitted
vanilla_instantiation_summary: visible app-server surface exposes compaction
  item but not structured omission ledger in Phase A sources.
direct_instantiation_target: context_omission_ledger@1 with source/count/reason
  and context-pack omission parity.
initial_risk: omitted evidence becomes hidden context or disappears from counts.
```

### N-CM-9 - Durable Memory

```yaml
semantic_name: long-lived thread/project memory separate from context pack
vanilla_instantiation_summary: memory mode setting, memory reset, memory
  artifacts under CODEX_HOME/memories, agent message memoryCitation field.
direct_instantiation_target: durable_thread_memory@1 entries with authority,
  contextUse, conflict, staleness, source refs; no user editor initially.
initial_risk: memory becomes current policy or editable authority.
```

### N-CM-10 - Memory Refresh

```yaml
semantic_name: operation that updates durable memory from source refs
vanilla_instantiation_summary: memory generation pipeline exists behind
  experimental controls; exact generation route not fully profiled in Phase A.
direct_instantiation_target: thread_memory_refresh@1 explicit manifest; failed
  refresh retains current memory.
initial_risk: failed/corrupt refresh replaces current memory or launders stale
  renderer/source rows.
```

### N-CM-11 - Frontier Baton

```yaml
semantic_name: task frontier/status bridge across maintenance boundaries
vanilla_instantiation_summary: app-server/core has active turn state, goals,
  steering rules, and compaction turn status; explicit baton artifact not
  established in Phase A.
direct_instantiation_target: frontier_baton@1 with goal summary, next expected
  action, open obligations, workspace/recovery refs, and no replay/approval/
  continuation authority.
initial_risk: baton becomes permission to replay tools or continue provider.
```

### N-CM-12 - Maintenance Status / UI Posture

```yaml
semantic_name: user-visible maintenance state
vanilla_instantiation_summary: contextCompaction item started/completed and
  turn/status notifications; thread effectively in a turn while compacting.
direct_instantiation_target: display-only status projection and operation
  history rows, not chat transcript messages and not authority controls.
initial_risk: maintenance status is displayed as assistant/user transcript or
  becomes a clickable authority action.
```

### N-CM-13 - Recovery And Integrity

```yaml
semantic_name: classify incomplete/corrupt context artifacts without rerunning
vanilla_instantiation_summary: app-server owns loaded/notLoaded status,
  resume/fork/rollback semantics, compaction item lifecycle.
direct_instantiation_target: recover orphan context packs/manifests, missing
  maintenance refs, corrupt memory, stale baton, missing omission ledger, and
  provider handoff unknown without automatic replay.
initial_risk: recovery reruns provider transport or treats stale maintenance
  artifacts as current.
```

## Initial Open Questions For Phase B

These are not implementation tasks yet. They are descent targets.

```text
1. Which vanilla concepts should Direct preserve as parity surfaces, and which
   should remain app-server-only fallback?

2. Should Direct eventually expose user-facing memory mode/reset equivalents,
   or only consume app-server sibling behavior while keeping Direct memory
   fixture/local?

3. Does Direct need a first-class manual compact action, or only automatic
   pre-request maintenance under explicit policy?

4. How should Direct model app-server contextCompaction when using app-server
   path: as vanilla item, Direct status chip, both, or neither?

5. What is the exact authority line between provider compact opaque items,
   local durable memory, and quoted context evidence?

6. Which context management leaves require real app-server parity probes versus
   Direct fixture/headless probes?

7. What should be the first Direct automatic behavior, if any: pressure status,
   trim planning, omission ledger, baton build, or memory refresh?
```

## Phase A Stop Point

We should not proceed to implementation from this artifact. The next phase is
Phase B recursive operator descent over these nodes, starting with the highest
risk boundaries:

```text
memory != policy
compaction != continuity
omission ledger != hidden context
context projection != canonical truth
status visibility != authority
vanilla behavior != Direct oracle
```
