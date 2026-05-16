# Direct Context Management Recursive ODEU - Phase I

Status: third E/G loop result. This phase added the next executable probe
slice, found one memory-refresh source freshness gap, repaired it narrowly, and
re-ran the strict probes.

Related:

- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_H.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_H.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)

## Purpose

After Phase H, the next slice targeted durable memory conflict behavior and
memory refresh source freshness:

```text
E-CM-MEM-003
E-CM-REFRESH-002
E-CM-REFRESH-003
```

The loop used the same rule as prior phases:

```text
failed or gapped probes are evidence about the program theory first;
only after clustering the theory miss do we patch the implementation.
```

## Probe Additions

### E-CM-MEM-003

Law:

```text
Memory conflicting with workspace evidence must not become current provider
context. It may remain represented as memory evidence with an explicit
conflict state.
```

Observed:

```text
conflictState = conflicts_with_workspace_evidence
conflictResolution = current_evidence_wins
provider prompt contains blocked summary = false
```

### E-CM-REFRESH-002

Law:

```text
Memory refresh source refs must be current, digest-backed, and not
renderer-DOM-only. Unsafe source refs block the refresh manifest.
```

Baseline observation:

```text
unsafe renderer_dom source ref was accepted
status = gap
```

Theory audit:

```text
The missing law was not a serialization bug. The refresh manifest builder was
acting like a passive record constructor, but memory refresh is a source-truth
boundary. It must reject stale, blocked, corrupt, DOM-only, digest-missing, or
raw-text source refs before recording a completed refresh attempt.
```

Repair:

```text
src/main/direct/context/maintenance.js
```

The builder now rejects invalid source refs with:

```text
memory_refresh_source_ref_invalid
```

and records a `reasonCode` such as:

```text
source_ref_renderer_dom_only
source_ref_digest_missing
source_ref_stale
source_ref_blocked
source_ref_corrupt
source_ref_blocked_projection
source_ref_raw_text_included
```

### E-CM-REFRESH-003

Law:

```text
Local deterministic memory refresh is route-mediated. It records a route,
refresh manifest, current/next memory ids, and maintenance manifest without
provider transport or renderer memory authoring.
```

Observed:

```text
routeKind = memory_refresh
routeEngine = local_deterministic
memoryRefresh.status = completed
currentRetained = false
providerTransportUsed = false
```

## Runs

Baseline run:

```text
third_loop_context_management_baseline
```

Result:

```text
passed: 11
gap: 1
failed: 0
```

Strict post-repair run:

```text
third_loop_context_management_strict
```

Result:

```text
passed: 12
gap: 0
failed: 0
```

Regression run:

```text
third_loop_context_maintenance_final
```

Result:

```text
direct context maintenance regression passed
```

## Remaining Work

Still open from the Phase D matrix:

```text
E-CM-STATUS-002
E-CM-STATUS-005
E-CM-VAN-*
```

Recommended next slice:

```text
status projection staleness
composer authority separation
vanilla sibling context-compaction/memory evidence
```
