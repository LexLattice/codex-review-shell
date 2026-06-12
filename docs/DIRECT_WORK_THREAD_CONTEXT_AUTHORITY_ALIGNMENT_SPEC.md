# Direct WorkThread Context And Authority Alignment Spec

Status: PR2 implementation slice for the direct information-bridge roadmap.

Related docs:

- [DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
- [DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md](./DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md)
- [DIRECT_WORK_THREAD_FOUNDATION_SPEC.md](./DIRECT_WORK_THREAD_FOUNDATION_SPEC.md)

## Purpose

PR1 created `WorkThread` as the canonical active-work substrate. PR2 aligns
existing context and authority artifacts with that substrate without enforcing
routing yet.

```text
WorkThread
  -> WorkThreadContextBinding
  -> ContextPack / RequestManifest citation
  -> AuthorityBearingTransition envelopes
```

This PR remains diagnostic and non-authorizing:

```text
binding citation != provider-call authority
transition envelope != mutation permission
shadow WorkThread routing != enforced routing
```

## Artifact Inventory

| Artifact | Role | Status | Semantics |
| --- | --- | --- | --- |
| `WorkThreadContextBinding` | context construction / governance witness | implemented v0 | renderer-safe citation of work-thread id, authority boundary digest, open obligation refs |
| `AuthorityBearingTransition` | authority gate witness | implemented v0 | shared read/patch/command transition envelope for plan/decision/result/continuation artifacts |
| `ContextPack` alignment | context construction | implemented v0 | optional WorkThread binding citation without adding WorkThread ids to provider prompt text |
| `RequestManifest` alignment | provider request witness | implemented v0 | cites WorkThread binding digest as capability/evidence metadata |

## Core Law

```text
ContextPack may cite a WorkThread, but context inclusion is not endorsement.
RequestManifest may cite a WorkThread binding, but it does not prove routing.
AuthorityBearingTransition records an action boundary, but does not authorize it.
No PR2 artifact grants mutation, provider call, or routing enforcement.
```

## V0 Shapes

```text
direct_work_thread_context_binding@1
  workThreadId
  projectId
  authorityBoundaryDigest
  openObligationRefs
  bridgeInformationRefs
  mutationAllowed = false
  providerCallAllowed = false
  routingEnforced = false
```

```text
direct_authority_bearing_transition@1
  transitionKind: read_file | apply_patch | run_command | unknown
  transitionPhase: plan | decision | result | continuation | unknown
  projectId
  threadId
  turnId
  obligationId
  workThreadBinding
  sourceArtifact
  sideEffectExecuted
  providerContinuationSent
  mutationAllowedByTransition = false
  providerCallAllowedByTransition = false
  routingEnforced = false
```

## Integration Points

Context construction:

```text
buildContextPack(...)
  accepts optional workThread / workThreadBinding
  records work_thread sourceArtifact when present
  records binding digest in context pack shape/integrity

buildRequestManifest(...)
  carries workThreadBinding and workThreadId
  cites workThreadBindingDigest in capability evidence
```

Authority transitions:

```text
read_file decision/result/continuation
apply_patch plan/decision/result/continuation
run_command plan/decision/result/continuation
  -> include AuthorityBearingTransition
```

## Acceptance Criteria

- `WorkThreadContextBinding` is digest-bearing and renderer-safe.
- Context packs can cite WorkThread binding without adding WorkThread ids to provider prompt text.
- Request manifests cite the WorkThread binding digest when available.
- Read, patch, and command authority artifacts carry the shared transition schema.
- Transition envelopes never set mutation/provider/routing authority to true.
- Existing direct context and authority flows remain backward-compatible when no WorkThread binding is passed.
- Regression covers context/request alignment and read/patch/command transition envelopes.

## Next Dependency

The next slice can begin consuming these citations:

```text
semantic broker / governance packet
  -> read WorkThread binding
  -> classify target and authority scope
  -> still shadow-only until promotion criteria are met
```
