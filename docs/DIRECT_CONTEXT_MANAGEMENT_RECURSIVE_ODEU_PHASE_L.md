# Direct Context Management Recursive ODEU - Phase L

Status: product-decision pass after local/fixture E-probe closure. This phase
does not add implementation authority. It records the initial product posture
for Direct context-management controls before any UI or automatic maintenance
work.

Related:

- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_K.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_K.md)
- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)

## Decision Law

The first Direct context-management product surface should be evidence/status
first:

```text
status visibility != maintenance execution
vanilla memory mode != Direct memory editor
app-server contextCompaction != Direct provider compact proof
manual compact affordance != permission to trim or summarize
automatic maintenance != safe default behavior
```

The upstream-discriminator rule applies. If two desired branches conflict, the
next step is to name the parent discriminator and add counterfactual probes, not
to make the most recent failing behavior pass by broad patching.

## Decisions

### D-CM-1 Direct Compact Action

Decision:

```text
No user-facing Direct manual compact action in the next implementation slice.
```

Allowed now:

```text
display pressure, route, omission, memory, baton, and app-server sibling
compaction status
```

Deferred:

```text
any button or IPC endpoint that executes local trim, local compaction,
provider compact, or durable-memory rewrite
```

Required future discriminator:

```text
maintenance_action_kind:
  inspect_status
  plan_only
  execute_local_trim
  execute_local_compaction
  execute_provider_compact
```

Future execution requires a separate spec with confirmation, stale projection
guards, operation-ledger events, recovery states, and no-hidden-retry law.

### D-CM-2 Direct Memory Eligibility

Decision:

```text
Do not add a Direct project/thread memory eligibility setting yet.
```

Vanilla `thread/memoryMode/set` is represented as app-server sibling evidence
only. Direct durable memory remains app-private maintenance evidence controlled
by source refs, contextUse, conflict state, and inclusion policy.

Required future discriminator:

```text
memory_control_owner:
  app_server_sibling
  direct_app_private_policy
  direct_user_visible_setting
```

The current Direct branch stays in `direct_app_private_policy`.

### D-CM-3 Direct Memory Reset

Decision:

```text
No user-facing Direct memory reset action yet.
```

Allowed now:

```text
failed refresh retains current memory
blocked/corrupt/stale memory is visible as status
app-server memory/reset is sibling evidence only
```

Deferred:

```text
renderer input that deletes, rewrites, clears, or tombstones Direct durable
memory entries
```

Required future discriminator:

```text
memory_reset_scope:
  app_server_store
  direct_current_pointer_tombstone
  direct_memory_entry_purge
  diagnostic_status_only
```

The current Direct branch stays in `diagnostic_status_only`.

### D-CM-4 First Automatic Maintenance Behavior

Decision:

```text
First live Direct behavior remains status-only and fail-closed.
```

The harness may compute and display pressure/route/status artifacts, and it may
block when required artifacts are missing or stale. It must not automatically
run trim, local compaction, provider text summary, provider compact, memory
refresh, or baton rebuild as a hidden pre-request side effect.

Allowed now:

```text
route selection
status projection
explicit fixture/headless maintenance artifacts
context pack inclusion of already-valid maintenance refs
```

Deferred:

```text
automatic pre-request maintenance execution
post-terminal automatic memory refresh
automatic compaction scheduler
provider-assisted maintenance
```

Required future discriminator:

```text
maintenance_trigger:
  status_read
  explicit_plan
  explicit_user_confirmed_execute
  automatic_pre_request
  automatic_post_terminal
```

The current Direct branch stays in `status_read` and `explicit_plan` only.

### D-CM-5 App-Server Compaction Status Display

Decision:

```text
App-server contextCompaction appears as display-only vanilla sibling context
management evidence.
```

It may be surfaced in status/operation-history style UI as:

```text
sourceClass = vanilla_app_server_sibling
displayOnly = true
actionable = false
directArtifactPromotionAllowed = false
```

It must not become:

```text
Direct provider compact proof
Direct omission ledger
Direct durable memory entry
Direct context pack source by default
Direct readiness promotion
```

Required discriminator:

```text
runtime_family:
  app_server_sibling
  direct_harness
  provider_compact_primitive
```

Phase K implemented the `app_server_sibling` display branch.

### D-CM-6 Provider Compact Primitive

Decision:

```text
Provider compact primitive remains live-gated and unsupported for normal Direct
operation.
```

No fixture, app-server sibling fact, or successful provider text response can
promote provider compact. Promotion requires exact live evidence for the model,
account/auth mode, endpoint, request shape, request controls, redaction, storage
policy, and source-ref handling described in the context-maintenance spec.

Required discriminator:

```text
provider_compact_evidence_scope:
  none
  diagnostic_profile_only
  provider_text_summary
  exact_provider_compact_primitive
```

The current Direct branch stays in `none` or `diagnostic_profile_only` unless
an explicitly opted-in live provider compact probe is run.

## Next Implementation Slice

The next implementation slice should be:

```text
context/memory status visibility only
```

Recommended surfaces:

```text
context pressure state
route status
required missing/stale artifact blockers
memory pointer/status
baton status
omission ledger status
app-server sibling contextCompaction/memory evidence
provider compact unavailable/live-gated witness
```

Forbidden in that slice:

```text
manual compact execution
automatic maintenance execution
memory mode toggle
memory reset action
provider compact request
provider text summary request
renderer-authored memory entries
```

## Probe Implications

Existing probes remain the local fixture gate:

```text
E-CM-* strict suite passes
```

New probes for the status slice should verify:

```text
status surface displays decisions without actionability
stale status projection cannot execute action
app-server sibling evidence remains runtime_family=app_server_sibling
provider compact unavailable status does not call provider
memory mode/reset controls are absent or disabled with stable reason
```

No live provider compact probe should be part of the default gate.
