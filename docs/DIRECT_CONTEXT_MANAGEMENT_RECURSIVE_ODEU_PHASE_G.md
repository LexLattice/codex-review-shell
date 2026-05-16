# Direct Context Management Recursive ODEU - Phase G

Status: Phase G narrow behavior repair for `G-CM-E-1`.

Related:

- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_E.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_E.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_F.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_F.md)

## Purpose

Phase F selected the repair law:

```text
repair target: maintenanceContextEvidence
required stale/superseded baton: block with required_baton_stale
optional stale/superseded baton: omit from provider-visible context
```

Phase G implements only that law and reruns the probe slice.

## Code Change

Changed:

```text
src/main/direct/thread/context-pack.js
```

Behavior added at the maintenance-artifact-to-context boundary:

```text
frontier baton is provider-visible context only when:
  batonState == present
  supersededByBatonId is empty
  rawTextIncluded == false
  replayAuthority == false
  approvalAuthority == false
  continuationAuthority == false
```

If the baton is ineligible:

```text
requiredBaton=true:
  throw required_baton_stale before provider input projection

requiredBaton=false:
  omit the stale/superseded baton from provider-visible context and source
  artifact context evidence
```

This keeps the structural ref gate separate:

```text
validateMaintenanceRefs:
  validates required id/digest presence

maintenanceContextEvidence:
  validates whether the artifact may become provider-visible context evidence
```

## Probe Update

Updated:

```text
scripts/direct-context-management-eprobes.mjs
```

`E-CM-BATON-004` now checks both sides of the law:

```text
required stale/superseded baton -> required_baton_stale
optional stale/superseded baton -> no stale goal text in provider prompt
optional stale/superseded baton -> no frontier_baton source artifact in context pack
```

## Baseline Run

Run id:

```text
phase_g_context_management_repair
```

Report:

```text
~/.config/Codex Review Shell/direct-context-management-eprobes/phase_g_context_management_repair/eprobe-summary.json
```

Result:

```text
passed: 5
gap: 0
failed: 0
```

The existing context maintenance regression was also rerun:

```text
npm run direct:context-maintenance -- --runId phase_g_context_maintenance_regression
```

It passed.

## Remaining Work

Phase G closes the first observed gap only. The broader Phase D matrix still
has missing rows:

```text
E-CM-MEM-003
E-CM-REFRESH-002
E-CM-REFRESH-003
E-CM-STATUS-002
E-CM-STATUS-005
E-CM-VAN-*
```

Next phase should select the next probe slice rather than expanding behavior
opportunistically.
