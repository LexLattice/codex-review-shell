# Direct WorkThread Foundation Spec

Status: PR1 implementation slice for the direct information-bridge roadmap.

Related docs:

- [DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
- [DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md](./DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md)
- [DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md](./DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md)

## Purpose

The direct path needs a first-class work unit above repo, folder, branch, chat,
Codex thread, and direct session.

```text
WorkThread
  = project ontology
  + branch/workspace identity
  + current objective
  + live constraints
  + context packet reference
  + authority boundary
  + open obligations
  + linked Codex/ChatGPT surfaces
```

This PR builds the first substrate only:

```text
WorkThread registry/store
WorkThread read-only projection
WorkTargetResolution shadow report
```

It does not enforce routing, start provider calls, mutate workspaces, or replace
the retained app-server path.

## Artifact Inventory

| Artifact | Role | Status | Semantics |
| --- | --- | --- | --- |
| `WorkThread` | canonical evidence | implemented v0 | active work ontology, objective, authority boundary, obligations, linked surfaces |
| `DirectWorkThreadRegistryStore` | canonical store | implemented v0 | app-private JSON registry with digest-bearing rows |
| `WorkThreadProjection` | derived projection | implemented v0 | renderer/control-plane safe list of work threads |
| `WorkTargetResolution` | governance/routing | shadow v0 | candidate scoring and ambiguity blockers, no enforcement |

## Core Law

```text
No workspace mutation until a target WorkThread is resolved.
No provider call is authorized by a shadow WorkTargetResolution.
No chat/thread/repo/folder identity is sufficient by itself.
No unresolved or ambiguous target may be silently collapsed.
```

## V0 Schema Shape

```text
direct_work_thread@1
  workThreadId
  projectId
  title
  lifecycleState
  ontologyProfileRef
  workspaceIdentity
  branchIdentity
  objective
  currentArc
  phaseState
  authorityBoundary
  contextPacketRef
  openObligations
  activeRuntimePath
  linkedCodexThreads
  linkedChatGptThreads
  evidenceRefs
```

V0 rows are renderer-safe:

```text
rawTextIncluded = false
rawPathIncluded = false
```

Thread/chat URLs and raw workspace paths are represented by evidence keys or
bounded labels, not raw authority-bearing data.

## Shadow Resolution

`direct_work_target_resolution@1` accepts request metadata:

```text
projectId
branchName
activeRuntimePath
codexThreadId
chatGptThreadId
bounded user request preview
```

It returns:

```text
selected
ambiguous
unresolved
```

and always includes:

```text
mutationAllowed = false
providerCallAllowed = false
routingEnforced = false
```

The report is a diagnostic routing witness, not a command.

## Acceptance Criteria

- WorkThread rows are digest-bearing and app-private.
- Projection rows expose only bounded labels, ids, counts, and digests.
- Resolution can select a clear candidate with project/branch/runtime/text evidence.
- Low-specificity requests remain ambiguous or unresolved.
- Unknown project requests are unresolved with a `no_candidate_work_thread` blocker.
- The shadow resolver never authorizes mutation, provider calls, or enforced routing.
- The executable information bridge audit marks `ic12.work-thread-registry` as partial, not missing.

## Next Dependency

The next PR should align context and authority:

```text
ContextPack / RequestManifest
  -> cite workThreadId
  -> cite authorityBoundary
  -> cite openObligations
  -> cite bridge information class refs

read / patch / command transitions
  -> wrap existing plans/results/continuations in AuthorityBearingTransition
```
