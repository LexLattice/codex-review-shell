# Direct Context Management Recursive ODEU - Phase E

Status: Phase E first probe-slice baseline. This document records the first
implemented E-probes and their observed behavior. It is not a repair plan.

Related:

- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_B.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_B.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md)

## Purpose

Phase E starts executable validation of the Phase D probe matrix. The first
slice deliberately targets high-risk context-management boundaries:

```text
pack/manifest recovery
stale context projection
omission parity negative case
memory conflict omission
baton supersession
```

The probe runner is:

```text
scripts/direct-context-management-eprobes.mjs
```

Package command:

```text
npm run direct:context-eprobes
```

Default behavior is non-strict: the runner records `gap` rows rather than
failing the process. Use `-- --strict` only after a gap has been audited and
promoted to a gate.

## Baseline Run

Run id:

```text
phase_e_context_management_baseline
```

Report:

```text
~/.config/Codex Review Shell/direct-context-management-eprobes/phase_e_context_management_baseline/eprobe-summary.json
~/.config/Codex Review Shell/direct-context-management-eprobes/phase_e_context_management_baseline/eprobe-summary.md
```

Result:

```text
passed: 4
gap: 1
failed: 0
```

Sentinels:

```text
providerTransportCalls=0
appServerMutationCalls=0
workspaceReadCalls=0
patchApplyCalls=0
commandRunCalls=0
rightPaneMutationCalls=0
handoffMutationCalls=0
```

Existing context-maintenance fixture regression was also rerun:

```text
npm run direct:context-maintenance -- --runId phase_e_context_maintenance_baseline
```

It passed.

## Probe Results

| Probe | Status | Meaning |
| --- | --- | --- |
| `E-CM-PACK-004` | passed | A context pack can exist without a request manifest and remains a pre-transport state. |
| `E-CM-PROJ-003` | passed | A stale context projection is rejected with `context_projection_failed` before request construction. |
| `E-CM-OMIT-005` | passed | Omission ledger/context-pack count mismatch fails closed with `omission_parity_mismatch`. |
| `E-CM-MEM-002` | passed | Conflicting memory with `contextUse=blocked` is represented but omitted from provider prompt text. |
| `E-CM-BATON-004` | gap | Stale/superseded baton state is representable, but context-pack inclusion does not currently reject that stale baton artifact. |

## Gap Record

### G-CM-E-1 - Stale Baton Inclusion

Probe:

```text
E-CM-BATON-004
```

Observed:

```text
staleBatonId=frontier_baton_stale_phase_e
currentBatonId=frontier_baton_current_phase_e
staleIncludedInProviderPrompt=true
expectedRecoveryState=baton_stale
```

Theory-level interpretation:

```text
Baton supersession is represented by the artifact schema, but the context-pack
maintenance inclusion path currently treats any supplied baton artifact as
eligible context evidence. It does not enforce batonState/supersededByBatonId
when a current baton is required.
```

Do not patch this as an isolated string-filter issue. The next step is a small
Phase F audit:

```text
1. Decide whether stale/superseded baton rejection belongs in
   validateMaintenanceRefs, maintenanceContextEvidence, context pack build, or
   route/recovery classification.
2. Decide whether stale baton should hard-block only when required, or always
   be omitted from provider-visible context.
3. Add the chosen law to Phase C/D before changing runtime behavior.
4. Then promote E-CM-BATON-004 from gap-reporting to strict gate.
```

Phase F decision:

```text
repair target: maintenanceContextEvidence
required stale/superseded baton: block with required_baton_stale
optional stale/superseded baton: omit from provider-visible context
stale/superseded baton remains renderer/report diagnostic evidence only
```

Phase G outcome:

```text
E-CM-BATON-004: passed
required stale/superseded baton blocks with required_baton_stale
optional stale/superseded baton is omitted from provider prompt and source
artifact context evidence
```

## Current Coverage Update

Newly covered by Phase E:

```text
E-CM-PACK-004
E-CM-PROJ-003
E-CM-OMIT-005
E-CM-MEM-002
```

Partially covered, pending theory repair:

```text
E-CM-BATON-004
```

Still high-priority missing from Phase D:

```text
E-CM-MEM-003
E-CM-REFRESH-002
E-CM-REFRESH-003
E-CM-BATON-003
E-CM-STATUS-002
E-CM-STATUS-005
E-CM-REC-002
E-CM-REC-003
E-CM-REC-006
E-CM-VAN-*
```

## Phase E Stop Point

The first probe slice produced one clean theory/implementation gap. Next phase:

```text
Phase F - theory audit and repair decision for G-CM-E-1
```

Only after Phase F should behavior be changed or the baton probe become strict.
