# Direct Context Management Recursive ODEU - Phase K

Status: fifth E/G loop result. This phase added the vanilla sibling probes,
found the missing normalized sibling-evidence artifact, repaired that gap, and
reran the strict probe slice.

Related:

- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_J.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_J.md)
- [CODEX_APP_SERVER_ONTOLOGY.md](./CODEX_APP_SERVER_ONTOLOGY.md)

## Purpose

Phase K covers the vanilla sibling rows:

```text
E-CM-VAN-001
E-CM-VAN-002
E-CM-VAN-003
E-CM-VAN-004
E-CM-VAN-005
```

The core rule is:

```text
vanilla app-server context/memory evidence is useful sibling evidence;
it is not Direct continuity, Direct provider compact proof, Direct memory
editor authority, or Direct durable-memory mutation.
```

## Baseline Gap

Baseline run:

```text
fifth_loop_context_management_baseline
```

Result:

```text
passed: 14
gap: 5
failed: 0
```

Theory audit:

```text
The repo had app-server ontology docs and renderer handling for
contextCompaction items, but Direct context management had no normalized
sibling-evidence artifact. Without that artifact, app-server context/memory
facts could only be treated informally.
```

## Repair

Repair target:

```text
src/main/direct/context/maintenance.js
```

Added:

```text
direct_vanilla_sibling_context_evidence@1
buildVanillaSiblingContextEvidence
```

The evidence artifact records:

```text
app-server ThreadItems
contextCompaction items
thread/compact/start control observations
thread/memoryMode/set control observations
memory/reset control observations
agent memoryCitation fields
display-only sibling status
```

and explicitly denies:

```text
directContinuityGranted
directContextPackUsable
providerCompactPrimitiveProven
directOmissionLedgerCreated
directMemoryEditorProven
directMemoryArtifactsMutated
```

## Probe Results

### E-CM-VAN-001

Law:

```text
App-server thread continuity and ThreadItems are app-server-owned sibling
evidence only.
```

Observed:

```text
threadContinuity.scope = app_server_only
directContinuityGranted = false
directContextPackUsable = false
```

### E-CM-VAN-002

Law:

```text
contextCompaction is app-server-owned sibling evidence and does not prove Direct
provider compact primitive support or create a Direct omission ledger.
```

Observed:

```text
providerCompactPrimitiveProven = false
directOmissionLedgerCreated = false
```

### E-CM-VAN-003

Law:

```text
thread/memoryMode/set is an app-server memory eligibility fact only.
```

Observed:

```text
appServerOnly = true
directMemoryEditorProven = false
```

### E-CM-VAN-004

Law:

```text
memory/reset does not mutate Direct durable-memory artifacts by inference.
```

Observed:

```text
directMemoryArtifactsMutated = false
```

### E-CM-VAN-005

Law:

```text
App-server contextCompaction can be displayed as sibling status without Direct
artifact promotion.
```

Observed:

```text
displayOnly = true
actionable = false
directArtifactPromotionAllowed = false
```

## Strict Run

Run id:

```text
fifth_loop_context_management_strict
```

Result:

```text
passed: 19
gap: 0
failed: 0
```

Regression run:

```text
fifth_loop_context_maintenance_final
```

Result:

```text
direct context maintenance regression passed
```

## Remaining Work

The local/fixture context-management E-probe matrix now has no high-value
missing rows.

Open product decisions remain separate from the probes:

```text
Direct memory mode/reset posture
Direct manual compact action
first automatic maintenance behavior
live provider compact primitive proof
```
