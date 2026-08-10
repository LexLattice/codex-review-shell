# Direct Context Management Recursive ODEU - Phase J

Status: fourth E/G loop result. This phase added status-projection authority
probes, found two missing preflight guards, repaired them narrowly, and reran
the strict probe slice.

Related:

- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_I.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_I.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)

## Purpose

After Phase I, the remaining Direct-local high-value rows were status/UI
posture probes:

```text
E-CM-STATUS-002
E-CM-STATUS-005
```

These rows test that context maintenance status projections are display
evidence, not action authority.

## Probe Additions

### E-CM-STATUS-002

Law:

```text
Renderer actions submitted against stale context-maintenance status projection
generation/source/ledger state must reject with a stable blocker. They must not
retry execution automatically.
```

Baseline observation:

```text
status projection had generation/digest fields
no status action preflight existed
status = gap
```

Repair:

```text
src/main/direct/context/maintenance.js
```

The new `validateStatusProjectionAction` helper rejects:

```text
context_status_projection_missing
context_status_projection_unsafe
context_status_projection_stale
context_status_source_digest_changed
operation_ledger_changed
```

Safe display reads return:

```text
displayOnly = true
runtimeAuthorityGranted = false
providerTransportAllowed = false
retryAutomatically = false
```

### E-CM-STATUS-005

Law:

```text
composerAllowed in a context-maintenance status projection is display posture
only. It cannot authorize provider send, context pack build, request manifest
build, or context maintenance execution.
```

Baseline observation:

```text
composerAllowed was present as status
no explicit runtime-authority guard existed
status = gap
```

Repair:

```text
validateStatusProjectionAction(actionKind = send_provider_request)
  -> context_status_not_runtime_authority
```

The guard also rejects related runtime action kinds:

```text
start_turn
composer_send
build_context_pack
build_request_manifest
run_context_maintenance
```

## Runs

Baseline run:

```text
fourth_loop_context_management_baseline
```

Result:

```text
passed: 12
gap: 2
failed: 0
```

Strict post-repair run:

```text
fourth_loop_context_management_strict
```

Result:

```text
passed: 14
gap: 0
failed: 0
```

Regression run:

```text
fourth_loop_context_maintenance_final
```

Result:

```text
direct context maintenance regression passed
```

## Remaining Work

The remaining Phase D rows are vanilla sibling probes:

```text
E-CM-VAN-*
```

Those should compare the app-server sibling's context-compaction and memory
controls against the Direct conceptual representation. They are not
reference-oracle tests for Direct unless a specific parity law is added.
