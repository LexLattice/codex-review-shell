# Direct Context Management Recursive ODEU - Phase B

Status: Phase B theory artifact. This is recursive operator descent over the
Phase A ontology. It is not yet terminalization, probe selection, or
implementation planning.

Related:

- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

## Purpose

Phase A established the base ontology and the vanilla sibling profile. Phase B
applies the recursive ODEU operators to each behavior-bearing context-management
node:

```text
OP-B boundary
OP-D decomposition
OP-R role / consumer
OP-L value-state lattice
OP-T lifecycle
OP-S subject / selection / denominator
OP-P projection / external surface
OP-F failure / invalidity
OP-C composition / interaction
OP-E evidence / authority
```

This phase creates branch structure. It does not yet decide exact probe rows.

## Root Branch Tree

```text
N-CM-0 Context Management
  N-CM-1  Canonical conversation truth
  N-CM-2  Context-safe projection
  N-CM-3  Model-visible context bundle
  N-CM-4  Request authorization manifest
  N-CM-5  Provider continuity
  N-CM-6  Context pressure
  N-CM-7  Compaction / trim route
  N-CM-8  Omission truth
  N-CM-9  Durable memory
  N-CM-10 Memory refresh
  N-CM-11 Frontier baton
  N-CM-12 Maintenance status / UI posture
  N-CM-13 Recovery and integrity
```

The branch tree is intentionally concept-first. Vanilla Codex/app-server and
Direct are implementation profiles attached to these nodes, not separate
ontologies.

## Descent Scope And Guardrails

Phase B descends every Phase A node far enough to expose competing branches,
consumer roles, state lattices, failure surfaces, and sibling-implementation
pressure. It does not collapse those branches into terminal probe rows yet.

High-risk boundaries kept active throughout descent:

```text
memory != policy
compaction != continuity
omission ledger != hidden context
context projection != canonical truth
request manifest != provider input body
status visibility != authority
vanilla behavior != Direct oracle
fixture coverage != live provider proof
```

The vanilla Codex/app-server path is used as a sibling instantiation:

```text
general concept -> vanilla/app-server choice -> Direct current choice ->
Direct desired choice -> delta class
```

It may reveal missing Direct concepts or useful parity surfaces, but it does
not override Direct matrix law.

## Operator Application Summary

```text
OP-B boundary:
  separates canonical truth, projections, context packs, manifests,
  continuity, pressure, route, memory, baton, status, and recovery.

OP-D decomposition:
  splits each artifact into ids, digests, source refs, lifecycle state,
  policy digests, raw-exposure flags, and consumer-specific summaries.

OP-R role / consumer:
  distinguishes provider input, recovery, renderer, operation history,
  readiness/reporting, and app-server sibling consumers.

OP-L value-state lattice:
  enumerates valid, stale, blocked, unsupported, unknown, corrupt,
  omitted, over-budget, and handoff-unknown variants.

OP-T lifecycle:
  tracks pre-request, active turn, compaction/maintenance, post-terminal,
  rollback, fork, resume, refresh, restart, and recovery transitions.

OP-S subject / denominator:
  identifies what a count or selection ranges over: turns, items, stable keys,
  hidden required refs, maintenance refs, omitted spans, memory entries, or
  baton obligations.

OP-P projection / external surface:
  separates JSON artifacts, renderer status, operation history, app-server
  thread items, report summaries, and provider input projections.

OP-F failure / invalidity:
  records stale sources, raw exposure, missing refs, digest mismatches,
  over-budget risk, required artifact loss, corrupt pointers, and unsupported
  provider/profile evidence.

OP-C composition / interaction:
  captures cross-node risks where two valid local concepts compose into an
  invalid global claim.

OP-E evidence / authority:
  labels whether a branch is Direct law, current Direct code, Direct fixture
  proof, vanilla sibling evidence, live provider proof, or diagnostic only.
```

## Operator Application Ledger

### N-CM-1 - Canonical Conversation Truth

Core split:

```text
canonical truth
  != renderer projection
  != context projection
  != compaction summary
  != durable memory
  != frontier baton
```

Operator descent:

```yaml
OP-B:
  children:
    - rollout/session event truth
    - loaded-thread in-memory truth
    - renderer transcript projection
    - context projection
    - compacted/summary item
    - rollback/fork-derived truth
OP-D:
  children:
    - thread id
    - turn id
    - item id
    - phase/status
    - source class
    - lifecycle marker
    - integrity/digest refs
OP-R:
  children:
    - display truth
    - prompt-source truth
    - recovery truth
    - provider-history truth
    - operation-history truth
OP-L:
  children:
    - loaded
    - not_loaded
    - archived
    - interrupted
    - compacted
    - rolled_back
    - forked
    - corrupt
    - missing
OP-T:
  children:
    - before turn
    - during active turn
    - during compaction turn
    - post-terminal
    - after rollback
    - after fork
OP-P:
  children:
    - app-server ThreadItem/Turn projection
    - Direct renderer_transcript@1
    - Direct operation history
    - Direct context source refs
OP-F:
  children:
    - projection stale
    - source artifact missing
    - digest mismatch
    - compaction or rollback changed source
OP-C:
  children:
    - rollback x context projection
    - fork x provider continuity
    - compaction x active turn
    - memory refresh x canonical source staleness
OP-E:
  status: direct code + app-server sibling docs/tests
```

Vanilla instantiation:

```text
App-server/core owns canonical thread state, thread read/resume/fork/rollback,
and contextCompaction items. Clients observe through thread/turn/item APIs.
```

Direct desired shape:

```text
DirectSessionStore and DirectThreadStore preserve canonical/direct truth.
Everything context-related cites those artifacts by stable ids/digests and does
not become canonical dialogue truth.
```

Phase B branch pressure:

```text
Any Direct memory, baton, summary, or context projection must carry source refs
and must never be treated as the source conversation itself.
```

### N-CM-2 - Context-Safe Projection

Core split:

```text
renderer-safe transcript projection
  -> context-safe recent dialogue projection
  -> context pack source
```

Operator descent:

```yaml
OP-B:
  children:
    - renderer transcript source
    - context_recent_dialogue projection
    - compact transcript projection
    - tool continuation projection
    - fork/checkpoint seed projection
OP-D:
  children:
    - selected item stable keys
    - selected item text digests
    - source projection digest
    - caps
    - omitted counts
    - raw-exposure flags
OP-R:
  children:
    - renderer display consumer
    - context builder consumer
    - recovery consumer
    - report consumer
OP-L:
  children:
    - valid
    - stale
    - blocked
    - unsafe_for_renderer
    - unsafe_for_context_build
    - empty_selection
    - truncated
OP-T:
  children:
    - source projection selected
    - context projection built
    - source changes before pack build
    - projection marked stale
OP-P:
  children:
    - context evidence text
    - renderer-safe summary
    - omitted count summary
OP-F:
  children:
    - raw exposure blocks
    - caps exceeded
    - source projection changed
    - required recent dialogue missing
OP-C:
  children:
    - renderer projection x context projection staleness
    - compact projection x context eligibility
    - tool result projection x continuation policy
OP-E:
  status: Direct implemented, vanilla mostly hidden
```

Vanilla instantiation:

```text
App-server exposes ThreadItems and compaction status, but not an explicit
provider-neutral context-safe projection in the client API.
```

Direct desired shape:

```text
Direct context_recent_dialogue@1 is explicit, capped, digest-bound, and separate
from renderer_transcript@1.
```

### N-CM-3 - Model-Visible Context Bundle

Core split:

```text
context pack
  != provider request body
  != request authorization
  != canonical dialogue
```

Operator descent:

```yaml
OP-B:
  children:
    - direct_context_pack@1
    - context messages
    - source artifacts
    - source projections
    - maintenance refs
    - governance refs
OP-D:
  children:
    - harness policy
    - role mapping
    - current user intent
    - historical evidence
    - tool-result evidence
    - fork/checkpoint evidence
    - memory evidence
    - baton status evidence
    - omission status evidence
    - caps/budget
    - integrity
OP-R:
  children:
    - provider-neutral input evidence
    - recovery artifact
    - request-manifest source
    - operation-history summary
    - report summary
OP-L:
  children:
    - empty_context
    - recent_dialogue
    - tool_continuation
    - checkpoint_continuation
    - fork_seed
    - derived_preview_seed
    - maintenance_refs_present
    - maintenance_refs_required_missing
OP-T:
  children:
    - built before request manifest
    - persisted before provider transport
    - orphan pack after crash
    - stale source before send
OP-S:
  children:
    - current user intent denominator
    - selected historical items denominator
    - maintenance evidence denominator
    - omitted count denominator
OP-P:
  children:
    - provider input projection
    - renderer-safe context summary
    - app-private JSON artifact
OP-F:
  children:
    - current prompt redaction failed
    - context pack cap exceeded
    - missing required maintenance ref
    - raw tool evidence blocked
OP-C:
  children:
    - memory evidence x current user intent conflict
    - omission ledger x context pack omitted counts
    - baton x open obligation state
    - governance refs x provider input mutation
OP-E:
  status: Direct implemented for pack build; maintenance inclusion fixture/local
```

Vanilla instantiation:

```text
App-server/core assembles model-visible history internally. The client sees
thread and item surfaces, not a durable provider-neutral context-pack artifact.
```

Direct desired shape:

```text
Direct keeps the pack explicit and app-private, because provider-specific
serialization must be reproducible from pack + manifest without storing raw
request bodies.
```

### N-CM-4 - Request Authorization Manifest

Core split:

```text
context material
  -> request-shape authorization
  -> provider input projection
  -> ephemeral provider request body
```

Operator descent:

```yaml
OP-B:
  children:
    - direct_request_manifest@1
    - direct_provider_input_projection@1
    - request shape family
    - enabled feature flags
    - continuity record
OP-D:
  children:
    - model
    - endpoint class/hash
    - request shape hash
    - role mapping digest
    - provider input shape/text hash
    - raw body storage audit
    - capability evidence
OP-R:
  children:
    - authorization truth
    - transport truth
    - recovery truth
    - readiness evidence
OP-L:
  children:
    - text_empty_context
    - text_recent_dialogue
    - tool_continuation
    - patch_continuation
    - command_continuation
    - fresh_fork
    - provider_compact_diagnostic
OP-T:
  children:
    - manifest built after context pack
    - manifest persisted before transport
    - request sent after durable artifacts
    - crash between manifest and send
OP-P:
  children:
    - JSON artifact
    - DB row
    - provider input hashes
    - renderer summary
OP-F:
  children:
    - manifest write fails
    - raw request body stored unexpectedly
    - feature flag mismatch
    - request-shape evidence missing
OP-C:
  children:
    - request manifest x runtime tier
    - provider input projection x governance refs
    - previous_response_id x fresh-context mode
OP-E:
  status: Direct implemented for existing request shapes
```

Vanilla instantiation:

```text
App-server/core owns request authorization and transport. Clients issue
thread/turn methods and observe lifecycle events.
```

Direct desired shape:

```text
Direct must preserve request authorization as durable evidence because the
harness, not app-server, owns direct transport and local authority boundaries.
```

### N-CM-5 - Provider Continuity

Core split:

```text
local thread continuity
  != imported continuity
  != provider previous_response_id continuity
  != fresh quoted context
```

Operator descent:

```yaml
OP-B:
  children:
    - no provider continuity
    - previous_response_id continuity
    - fresh request with quoted recent dialogue
    - fresh request with quoted tool result
    - imported checkpoint evidence
    - fork seed evidence
    - provider compact item
OP-D:
  children:
    - continuity policy
    - response id digest
    - source turn digest
    - source request manifest id
    - imported continuity false flags
OP-R:
  children:
    - provider request builder
    - recovery classifier
    - renderer status
    - matrix promotion
OP-L:
  children:
    - not_used
    - exact_current_parent
    - stale_parent
    - imported_forbidden
    - unknown_handoff
    - unsupported_shape
OP-T:
  children:
    - initial turn
    - follow-up text turn
    - tool result continuation
    - post-compaction
    - post-fork
    - recovery startup
OP-F:
  children:
    - missing parent response proof
    - stale source turn
    - provider handoff unknown
    - continuity handle rejected
OP-C:
  children:
    - fresh_context x tool output item
    - provider compact x local memory
    - fork seed x source provider state
OP-E:
  status: Direct has strict fresh-context law for current ChatGPT path; exact
    native continuity remains request-shape-specific evidence
```

Vanilla instantiation:

```text
App-server/core owns loaded session state and provider history. The visible API
does not require clients to reason about previous_response_id for normal turns.
```

Direct desired shape:

```text
Direct must represent every continuity claim explicitly. Quoted context is a
fresh request, not provider memory.
```

### N-CM-6 - Context Pressure

Core split:

```text
token/context pressure estimate
  != permission to trim
  != provider quota
  != memory quality
```

Operator descent:

```yaml
OP-B:
  children:
    - visible context estimate
    - hidden required refs estimate
    - reserved output/reasoning estimate
    - model context window estimate
OP-D:
  children:
    - estimated visible tokens
    - hidden required tokens
    - reserved output tokens
    - total estimate
    - confidence
    - policy digest
OP-L:
  children:
    - unknown
    - within_budget
    - approaching_budget
    - over_budget
    - required_artifact_at_risk
OP-R:
  children:
    - route selector input
    - status display
    - request manifest budget evidence
    - readiness evidence
OP-T:
  children:
    - pre-request
    - turn-boundary
    - post-terminal
    - diagnostic
OP-F:
  children:
    - unknown pressure cannot authorize trim
    - hidden required refs exceed budget
    - model context unknown
OP-C:
  children:
    - pressure x active obligation
    - pressure x provider compact request
    - pressure x required artifact classes
OP-E:
  status: Direct fixture/local; vanilla auto compact limit sibling evidence
```

Vanilla instantiation:

```text
App-server/core has model auto compact token limit and automatic compaction.
Details are not exposed as a client-side pressure-estimate artifact.
```

Direct desired shape:

```text
Direct should keep pressure diagnostic unless it can preserve required
artifacts and produce route/manifest evidence.
```

### N-CM-7 - Compaction / Trim Route

Core split:

```text
manual or automatic compaction
  != local trim
  != memory refresh
  != baton build
  != provider compact primitive
```

Operator descent:

```yaml
OP-B:
  children:
    - no_op
    - estimate_only
    - local_trim
    - local_compaction
    - remote_compaction
    - hybrid_compaction
    - memory_refresh
    - frontier_baton_build
    - blocked
OP-D:
  children:
    - trigger
    - timing
    - engine
    - reason code
    - input digest
    - policy digest
    - route digest
OP-R:
  children:
    - scheduler decision
    - context-pack source
    - status projection
    - report evidence
OP-L:
  children:
    - supported
    - diagnostic
    - provider evidence missing
    - active obligation blocked
    - handoff unknown blocked
    - corrupt ledger blocked
OP-T:
  children:
    - before new turn
    - before tool continuation
    - before fresh fork
    - after terminal turn
    - manual request
    - diagnostic probe
OP-P:
  children:
    - maintenance manifest
    - app-server contextCompaction item
    - Direct status projection
OP-F:
  children:
    - provider compact evidence missing
    - unknown pressure over-budget risk
    - required artifact at risk
OP-C:
  children:
    - active local action x route
    - provider compact x local memory
    - vanilla app-server compact x Direct runtime path
OP-E:
  status: vanilla compaction real sibling; Direct route fixture/local
```

Vanilla instantiation:

```text
thread/compact/start and automatic compaction are first-class app-server/core
activities with contextCompaction item lifecycle.
```

Direct desired shape:

```text
Direct route decisions must be explicit and fail closed before any automatic
compaction/trim becomes live.
```

### N-CM-8 - Omission Truth

Core split:

```text
omitted evidence
  != hidden evidence
  != deleted canonical history
  != provider memory
```

Operator descent:

```yaml
OP-B:
  children:
    - omission candidate
    - trim plan
    - omission ledger entry
    - context pack omitted counts
OP-D:
  children:
    - source artifact kind/id
    - source digest
    - stable keys
    - item/turn/char/token counts
    - reason
    - requiredArtifact flag
OP-R:
  children:
    - route validation truth
    - context-pack summary truth
    - renderer status truth
    - recovery truth
OP-L:
  children:
    - no omissions
    - optional omissions represented
    - required artifact omission blocked
    - ledger missing
    - parity mismatch
OP-T:
  children:
    - trim plan before ledger
    - ledger before context pack
    - recovery with missing ledger
OP-P:
  children:
    - ledger JSON
    - context omission status evidence
    - report totals
OP-F:
  children:
    - required artifact candidate blocks ledger
    - ledger missing blocks required refs
    - parity mismatch blocks report
OP-C:
  children:
    - omission ledger x context pack caps
    - omission ledger x fresh fork prune markers
    - omission ledger x memory/baton required refs
OP-E:
  status: Direct explicit; vanilla visible surface only has coarse compaction item
```

Vanilla instantiation:

```text
Visible app-server surface exposes compaction as an item/status event. Phase A
did not find structured omission ledger at the client API surface.
```

Direct desired shape:

```text
Every Direct omission that affects context must have count/source/reason
evidence, and omitted material must not be described as hidden context.
```

### N-CM-9 - Durable Memory

Core split:

```text
durable memory
  != current instruction authority
  != compaction summary
  != canonical history
  != user-editable policy
```

Operator descent:

```yaml
OP-B:
  children:
    - memory artifact
    - memory entry
    - memory pointer
    - memory mode/eligibility
    - memory citation
OP-D:
  children:
    - kind
    - authority
    - contextUse
    - source refs
    - confidence
    - staleness
    - conflict state
    - conflict resolution
OP-R:
  children:
    - context evidence
    - renderer status
    - memory refresh source
    - governance diagnostic source
OP-L:
  children:
    - current_valid
    - current_stale
    - blocked
    - corrupt
    - conflicts_with_current_user_intent
    - conflicts_with_workspace_evidence
    - disabled
    - enabled
OP-T:
  children:
    - generated/refreshed
    - cited in context pack
    - superseded
    - reset
    - stale after new evidence
OP-P:
  children:
    - durable_thread_memory@1
    - renderer-safe summary
    - memoryCitation in vanilla agent message
    - memory mode status
OP-F:
  children:
    - raw exposure in memory blocks
    - corrupt memory blocks
    - failed refresh retains current
    - memory editor forbidden
OP-C:
  children:
    - memory x current user intent
    - memory x workspace evidence
    - memory reset x thread memory mode
    - vanilla memory mode x Direct memory artifact
OP-E:
  status: vanilla has memory mode/reset/citation surfaces; Direct has explicit
    artifact schema and fixture/local coverage
```

Vanilla instantiation:

```text
thread/memoryMode/set controls memory eligibility; memory/reset clears memory
artifacts/stage data while preserving modes; agent messages can carry memory
citation.
```

Direct desired shape:

```text
Memory entries are quoted context evidence only unless a future governance layer
explicitly elevates a class. No user-facing memory editor exists in current
Direct law.
```

### N-CM-10 - Memory Refresh

Core split:

```text
memory refresh operation
  != memory entry authoring by renderer
  != compaction
  != provider continuity
```

Operator descent:

```yaml
OP-B:
  children:
    - refresh manifest
    - current memory pointer
    - next memory artifact
    - failed attempt
OP-D:
  children:
    - source refs
    - current memory id
    - next memory id
    - status
    - current retained flag
    - providerTransportUsed flag
OP-R:
  children:
    - maintenance route output
    - memory pointer updater
    - recovery classifier
    - report evidence
OP-L:
  children:
    - planned
    - completed
    - failed_current_retained
    - blocked_raw_exposure
    - source_stale
    - source_digest_mismatch
OP-T:
  children:
    - source snapshot
    - refresh run
    - validation
    - pointer update
    - recovery after interruption
OP-F:
  children:
    - failed refresh retains old current
    - corrupt new memory not current
    - stale source rejected
OP-C:
  children:
    - refresh x concurrent turn changes
    - refresh x memory reset
    - refresh x context pack inclusion
OP-E:
  status: Direct fixture/local; vanilla generation path only partially profiled
```

Vanilla instantiation:

```text
Memory generation appears as an app-server/core-managed pipeline behind
experimental memory controls; exact refresh artifact shape is not Phase A truth.
```

Direct desired shape:

```text
Every memory refresh needs a manifest and pointer law: failed or blocked
attempts do not replace current memory.
```

### N-CM-11 - Frontier Baton

Core split:

```text
frontier baton
  != provider continuation
  != replay authority
  != approval authority
  != canonical transcript
```

Operator descent:

```yaml
OP-B:
  children:
    - baton artifact
    - baton requirement
    - baton state
    - supersession link
    - recovery ref
OP-D:
  children:
    - goal digest/summary
    - last known assistant state
    - next expected action
    - open obligation refs
    - unresolved risk refs
    - workspace effect refs
    - recovery state ref
OP-R:
  children:
    - context status evidence
    - recovery evidence
    - repair-loop frontier
    - renderer status
OP-L:
  children:
    - not_required
    - optional
    - required_for_trim
    - required_for_repair_loop
    - required_due_to_open_obligation
    - present
    - missing
    - stale
    - blocked
OP-T:
  children:
    - built before trim
    - included in context pack
    - superseded by later baton
    - invalid after next user turn/tool obligation
OP-F:
  children:
    - required baton missing blocks
    - stale baton blocks when required
    - raw exposure in baton blocks
OP-C:
  children:
    - baton x active obligation
    - baton x repair loop
    - baton x workspace effect summary
    - baton x provider continuation unknown
OP-E:
  status: Direct explicit artifact; vanilla sibling has active turn/goal/status
    concepts but no proven equivalent explicit baton
```

Vanilla instantiation:

```text
App-server exposes active turn status, goals, steering rules, and compaction as
turn-like activity. An explicit frontier baton artifact is not established.
```

Direct desired shape:

```text
Direct baton may help survive context trimming but must keep all authority flags
false.
```

### N-CM-12 - Maintenance Status / UI Posture

Core split:

```text
status visibility
  != chat transcript content
  != action authority
  != provider-visible context
```

Operator descent:

```yaml
OP-B:
  children:
    - app-server contextCompaction item
    - Direct maintenance status projection
    - operation history row
    - witness/status chip
OP-D:
  children:
    - route id
    - manifest id
    - memory id
    - baton id
    - omission ledger id
    - composer allowed flag
    - display-only flag
OP-R:
  children:
    - user explanation
    - recovery explanation
    - readiness evidence
    - no-authority signal
OP-L:
  children:
    - requested
    - running
    - completed
    - failed
    - unsupported
    - stale
    - blocked
OP-T:
  children:
    - during compaction/maintenance
    - after terminal
    - after restart
    - after source stale
OP-P:
  children:
    - renderer lane status
    - operation history
    - JSON report
    - Markdown report
OP-F:
  children:
    - stale UI projection
    - status raw exposure
    - status inserted into chat transcript
OP-C:
  children:
    - app-server runtime path x contextCompaction item
    - direct runtime path x maintenance status projection
    - status x composer allowed
OP-E:
  status: vanilla real status item; Direct fixture/local status projection
```

Vanilla instantiation:

```text
contextCompaction appears as thread item lifecycle; while compacting, the thread
is effectively in a turn.
```

Direct desired shape:

```text
Direct maintenance status should be display-only and never rendered as user or
assistant chat content.
```

### N-CM-13 - Recovery And Integrity

Core split:

```text
recovery classification
  != rerun maintenance
  != resend provider request
  != rebuild hidden state on read
```

Operator descent:

```yaml
OP-B:
  children:
    - context pack recovery
    - request manifest recovery
    - route/manifest recovery
    - trim/ledger recovery
    - memory recovery
    - baton recovery
    - provider handoff recovery
OP-D:
  children:
    - artifact id
    - artifact digest
    - source digest
    - current pointer
    - operation ledger head
    - recovery state
OP-R:
  children:
    - startup classifier
    - status projection
    - request blocker
    - report validation
OP-L:
  children:
    - healthy
    - route_planned_no_manifest
    - manifest_running_interrupted
    - trim_plan_no_ledger
    - omission_ledger_missing
    - memory_refresh_failed_current_retained
    - memory_corrupt
    - baton_required_missing
    - baton_stale
    - provider_compaction_handoff_unknown
    - raw_exposure_blocked
    - corrupt
OP-T:
  children:
    - startup
    - before new request
    - after crash
    - after renderer reload
OP-F:
  children:
    - missing required ref blocks
    - corrupt artifact blocks
    - handoff unknown blocks clean success
    - raw exposure writes minimal safe report
OP-C:
  children:
    - recovery x active turn
    - recovery x runtime path rollback
    - recovery x report promotion
OP-E:
  status: Direct explicit recovery states; vanilla recovery behavior remains
    app-server-owned
```

Vanilla instantiation:

```text
App-server owns loaded/notLoaded thread state, resume/fork/rollback semantics,
and compaction lifecycle. Direct should not infer its internal recovery law from
visible status alone.
```

Direct desired shape:

```text
Direct recovery classifies durable artifacts without rerunning maintenance,
provider transport, workspace reads, app-server mutation, or renderer rebuilds.
```

## Cross-Node OP-C Interaction Candidates

These interactions should be carried into Phase C terminalization.

```text
I-CM-1 Canonical truth x context projection:
  source projection changes after context projection built -> stale/block.

I-CM-2 Context pack x request manifest:
  pack persisted but manifest missing -> recoverable pre-transport, no send.

I-CM-3 Request manifest x provider continuity:
  fresh quoted context must not imply previous_response_id continuity.

I-CM-4 Pressure x required artifact classes:
  over budget may trim optional material; required artifact risk blocks.

I-CM-5 Omission ledger x context pack:
  context pack omitted counts must match omission ledger totals.

I-CM-6 Durable memory x current user intent:
  conflicting memory is omitted or marked stale; current evidence wins.

I-CM-7 Durable memory x workspace evidence:
  memory conflicting with workspace effect/source evidence must not become
  current fact.

I-CM-8 Baton x open tool obligation:
  baton can cite obligation state but cannot approve, replay, or continue it.

I-CM-9 Maintenance route x active local action:
  route blocks during active obligation/local action/handoff uncertainty.

I-CM-10 Provider compact x local memory:
  provider compact output is not durable memory unless a separate refresh policy
  consumes it.

I-CM-11 Vanilla app-server compaction x Direct runtime path:
  app-server contextCompaction is real for app-server path but does not prove
  Direct provider compact support.

I-CM-12 Status projection x composer:
  status may explain composer block/allow, but display state is not authority.

I-CM-13 Memory reset/mode x Direct memory artifacts:
  vanilla memory reset/mode does not automatically mutate Direct memory unless
  an explicit Direct bridge is designed.
```

## Evidence Authority And Overpromotion Blockers

Evidence classes used by Phase B:

```text
matrix_law:
  Direct design authority. Can define desired Direct behavior.

direct_spec_law:
  Direct artifact and boundary authority, subject to matrix alignment.

direct_code_current:
  Current implementation evidence. Can reveal actual behavior or gaps.

direct_fixture_probe:
  Useful for schema/law coverage. Does not prove live provider behavior.

direct_live_probe:
  Live Direct runtime/provider proof for the exact request shape exercised.

vanilla_docs:
  Sibling instantiation evidence. Useful for parity/design pressure.

vanilla_tests:
  Sibling behavior evidence for app-server/Codex CLI path.

vanilla_code:
  Sibling implementation evidence. Stronger than docs, still not Direct law.

diagnostic_only:
  May explain, classify, or block promotion; cannot grant authority.
```

Overpromotion blockers:

```text
vanilla app-server behavior does not prove Direct behavior;
app-server contextCompaction does not prove Direct provider compact primitive;
fixture maintenance does not prove live maintenance;
memoryMode does not create a Direct memory editor;
provider compact opaque items are not durable memory entries;
renderer transcript projection is not canonical dialogue truth;
context pack omitted counts are not valid without omission parity;
status chips and operation history rows are never action authority.
```

## Phase C Terminalization Inputs

The following branches remain open and must be terminalized before probes or
implementation changes are selected:

```text
T-CM-1 Provider continuity modes:
  fresh quoted context, native previous_response_id, imported checkpoint,
  app-server-owned continuity, and provider compact continuation.

T-CM-2 Compaction timing and route:
  manual app-server compact, Direct local deterministic trim, provider compact
  diagnostic, pre-request maintenance, and post-terminal maintenance.

T-CM-3 Omission required-vs-optional law:
  every omitted item denominator, required artifact classes, parity totals,
  and report blockers.

T-CM-4 Durable memory authority:
  historical context, current user preference candidate, project fact
  candidate, conflict states, and current-evidence-wins behavior.

T-CM-5 Frontier baton authority:
  required/stale/optional states, open obligation refs, recovery refs, and
  replay/approval/continuation authority false fields.

T-CM-6 App-server path status parity:
  how Direct UI/status should represent vanilla contextCompaction and memory
  mode/reset facts without treating them as Direct artifacts.

T-CM-7 Recovery no-rerun law:
  which missing/corrupt artifacts block new requests and which only produce
  degraded status, without rerunning maintenance or provider transport.

T-CM-8 First live behavior choice:
  whether Direct starts with status-only context maintenance, manual local trim,
  automatic pre-request local trim, or app-server fallback only.
```

## Phase B Bookkeeper Questions

These questions must be answered before terminal leaves are declared closed.

```text
1. Which nodes are app-server parity obligations and which are Direct-only law?

2. Do we need Direct parity for thread/compact/start as a user action, or only
   preserve app-server fallback?

3. Should Direct model vanilla memoryMode as an external sibling fact, or add a
   Direct project/thread memory eligibility setting?

4. Which maintenance artifacts may be included in provider input by default,
   and which require explicit route/manifest refs?

5. Is Direct allowed to run local deterministic trim automatically, or must the
   first live behavior be status-only?

6. What is the first terminal proof for provider compact primitive: exact live
   provider probe, app-server sibling proof, or diagnostic-only block?

7. Do context pack omitted counts need to track every source family separately:
   recent dialogue, tool evidence, memory, baton, fork seed, and operation
   history?

8. What is the user-visible product posture for memory: absent, status-only,
   eligibility toggle, reset, or editor? Current law says no editor.
```

## Phase B Stop Point

Phase B produces branch structure and interaction candidates. The next phase is
Phase C:

```text
terminalization
coverage adequacy audit
terminal leaf ledger
E-probe witness map
implementation coverage map
```

Do not implement from Phase B directly. Implementation should start only after
terminal leaves and probes make clear which sibling distinctions matter.
