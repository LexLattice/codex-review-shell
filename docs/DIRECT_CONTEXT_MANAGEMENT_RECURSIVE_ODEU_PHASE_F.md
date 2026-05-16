# Direct Context Management Recursive ODEU - Phase F

Status: Phase F theory audit and repair decision for `G-CM-E-1`. This
document decides the law for stale/superseded frontier batons before runtime
behavior is changed.

Related:

- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_D.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_E.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_E.md)

## Gap Under Audit

Probe:

```text
E-CM-BATON-004
```

Observed Phase E result:

```text
status=gap
staleBatonId=frontier_baton_stale_phase_e
currentBatonId=frontier_baton_current_phase_e
staleIncludedInProviderPrompt=true
expectedRecoveryState=baton_stale
```

Theory-level gap:

```text
Baton supersession is representable, but context-pack inclusion currently does
not reject or omit stale/superseded baton artifacts before building
provider-visible context.
```

## Current Implementation Path

Relevant code path:

```text
buildFrontierBaton
  -> maintenanceRefsFromArtifacts
  -> validateMaintenanceRefs
  -> buildContextPack
  -> maintenanceContextEvidence
  -> providerInputFromContextPack
```

Current facts:

```text
buildFrontierBaton:
  records batonState, supersedesBatonId, supersededByBatonId, validUntil,
  sourceDigest, and authority=false fields.

maintenanceRefsFromArtifacts:
  records baton id/digest and requiredBaton boolean.

validateMaintenanceRefs:
  validates structural presence of required baton id/digest only.
  It does not receive the baton artifact and cannot judge baton freshness.

maintenanceContextEvidence:
  receives both maintenance refs and the baton artifact.
  It currently includes any artifact with batonId in provider-visible quoted
  status evidence.

providerInputFromContextPack:
  serializes messages already selected by the context pack. It is too late to
  decide baton eligibility there.
```

## Candidate Repair Locations

### Option A - `validateMaintenanceRefs`

Rejected as the primary location.

Reason:

```text
The function validates refs, not artifacts. It can say a required baton ref is
missing, but it cannot reliably inspect batonState or supersession without
changing its responsibility and call shape.
```

It may later grow optional artifact-aware validation, but it should remain the
structural ref gate.

### Option B - `maintenanceRecoveryState`

Rejected as the primary location.

Reason:

```text
Recovery classification can name baton_stale, but it does not assemble
provider-visible context. A recovery enum alone cannot prevent stale baton text
from entering a context pack.
```

### Option C - `providerInputFromContextPack`

Rejected.

Reason:

```text
Provider input projection should serialize an already lawful context pack.
Filtering stale baton content at serialization time would allow invalid context
packs to exist and would blur context-pack law with provider-request shape.
```

### Option D - `maintenanceContextEvidence`

Accepted.

Reason:

```text
This is the boundary that converts maintenance artifacts into context-pack
messages and source artifacts. It sees both maintenanceRefs.requiredBaton and
the baton artifact state. It is the right place to decide whether baton evidence
is provider-visible quoted status evidence, omitted optional status evidence, or
a hard context-build blocker.
```

## Chosen Law

### Baton Context Eligibility

A frontier baton is eligible for provider-visible context only if:

```text
batonId is present
batonState == "present"
supersededByBatonId is empty
rawTextIncluded == false
replayAuthority == false
approvalAuthority == false
continuationAuthority == false
```

If future code can evaluate `validUntil`, an expired `validUntil` must also make
the baton ineligible.

### Required Baton Behavior

If `maintenanceRefs.requiredBaton=true` and the supplied baton is missing,
stale, superseded, authority-bearing, raw-text-bearing, or otherwise ineligible:

```text
context pack build must block before provider input projection
stable blocker class: required_baton_stale
recovery class: baton_stale
provider transport: not started
```

`required_baton_stale` is intentionally broad enough to cover stale,
superseded, and explicitly ineligible baton artifacts. More specific detail may
appear in app-private diagnostics.

### Optional Baton Behavior

If `maintenanceRefs.requiredBaton=false` and the supplied baton is stale,
superseded, or otherwise ineligible:

```text
omit baton from provider-visible context
do not include stale baton sourceArtifact as context evidence
context pack may still build if no other required refs fail
renderer/status/report may show stale baton diagnostically
provider transport may proceed if the request does not require baton
```

This preserves the Phase C law:

```text
Required baton missing or stale blocks only the route/context build that
requires it.
```

It also strengthens the supersession law:

```text
Stale or superseded baton is never provider-visible context.
```

## Updated Interpretation Of `E-CM-BATON-004`

`E-CM-BATON-004` should become a strict gate after implementation repair.

Expected behavior after repair:

```text
required stale/superseded baton -> required_baton_stale
optional stale/superseded baton -> omitted from provider prompt
```

The current Phase E result remains useful:

```text
current behavior: gap
theory result: law clarified
repair target: maintenanceContextEvidence
```

## Non-Goals

This decision does not add:

```text
baton replay authority
baton approval authority
baton continuation authority
provider continuity
automatic baton refresh
memory editor behavior
right-pane ChatGPT mutation
handoff mutation
app-server compaction parity
```

## Next Step

Phase G should implement the narrow behavior repair:

```text
add baton context eligibility check in maintenanceContextEvidence;
hard-block required stale/superseded baton with required_baton_stale;
omit optional stale/superseded baton;
update E-CM-BATON-004 to pass;
run direct:context-eprobes, direct:context-maintenance, and syntax checks.
```
