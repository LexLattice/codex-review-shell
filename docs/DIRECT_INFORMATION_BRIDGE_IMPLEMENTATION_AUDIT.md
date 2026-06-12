# Direct Information Bridge Implementation Audit

Status: baseline audit for aligning the current direct branch with
[DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
and
[DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md](./DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md).

Companion executable registry:

```text
src/main/direct/bridge/information-registry.js
scripts/direct-information-bridge-audit.mjs
```

Run:

```sh
npm run direct:information-bridge-audit
```

## Standing Rule

The direct path does not delete or reject the vanilla app-server path by default.

```text
if vanilla/app-server behavior fits the bridge law
  -> retain it as inherited/app-server capability

if vanilla/app-server behavior conflicts with work-thread, context, authority,
evidence, or projection law
  -> leave it on the app-server path and build/tweak a direct-native equivalent
```

The direct branch therefore has two legitimate classes of capability:

```text
retained vanilla/app-server capability
direct-native bridge capability
```

The implementation audit must distinguish these from missing or partial direct
capability. "Inherited" is not a defect when it is explicit and law-compatible.

## Current Summary

As of this audit, the direct branch already has substantial bridge substrate:

```text
canonical evidence:
  direct session/turn/tool store
  direct thread operation ledger
  direct meta-session ledger

derived projections:
  renderer transcript projections
  compact transcript projections
  thread lifecycle/graph/preview projections

context construction:
  context pack
  request manifest
  provider input projection
  context maintenance artifacts

authority/action:
  read_file authority
  apply_patch authority
  run_command authority
  workspace mutation truth
  recovery/replay safety

governance/observability:
  shadow governance packets
  semantic broker diagnostics
  sub-agent observability
  usage/quota/model readiness
```

The biggest missing abstraction is still:

```text
WorkThread
```

The current code knows about project, repo/workspace, Codex thread, direct
session, meta-session, and runtime path. It does not yet have one canonical
object for:

```text
active work thread
  = ontology profile
  + branch/workspace identity
  + objective
  + constraints
  + context packet
  + authority boundary
  + open obligations
  + artifacts
```

## Registry Rows

The executable registry currently tracks these bridge rows:

| Row | Role | State | Direct posture |
| --- | --- | --- | --- |
| `ic1.direct-session-rollout` | canonical evidence | implemented | keep |
| `ic1.direct-thread-operation-ledger` | canonical evidence | implemented | keep |
| `ic1.direct-meta-session-ledger` | canonical evidence | partial | keep and align |
| `ic2.renderer-transcript-projection` | derived projection | implemented | keep |
| `ic2.thread-workbench-projections` | derived projection | implemented | keep |
| `ic3.context-pack-and-request-manifest` | context construction | implemented | keep |
| `ic3.context-maintenance-memory-baton` | memory/continuity | partial | keep and align |
| `ic4.read-file-authority` | authority gate | implemented | keep |
| `ic4.patch-authority` | authority gate | implemented | keep |
| `ic4.command-authority` | authority gate | implemented | keep |
| `ic5.recovery-and-replay-safety` | governance/routing | implemented | keep |
| `ic6.semantic-governance-broker` | governance/routing | partial | keep shadow |
| `ic7.sub-agent-observability` | observability surface | partial | keep and align |
| `ic8.usage-quota-readiness` | observability surface | partial | keep and align |
| `ic9.direct-runtime-selection` | governance/routing | partial | keep and simplify UI |
| `ic10.retained-appserver-path` | observability surface | inherited | retain when aligned |
| `ic11.inherited-shell-ux` | observability surface | inherited | retain when aligned |
| `ic12.work-thread-registry` | governance/routing | missing | build next |
| `ic13.bridge-information-registry` | governance/routing | partial | bootstrap now |
| `ic14.skills-hooks-apps` | governance/routing | missing | design before build |
| `ic15.direct-settings-surface` | observability surface | missing | build after registry |

## Keep

Keep these existing direct-native structures mostly as-is:

- `DirectSessionStore`: canonical session, turn, diagnostic, import, and tool-obligation evidence.
- `DirectThreadStore`: operation ledger, rollout manifests, rebuildable projections, context builds, request manifests.
- `DirectMetaSessionStore`: higher-plane contracts, route artifacts, guard decisions, current pointers, and meta-session ledgers.
- `ContextPack` and `RequestManifest`: explicit context construction and provider input boundary.
- Read, patch, and command authority modules: provider intent is separated from local authority and result evidence.
- Recovery scanner: no provider call, app-server spawn, right-pane mutation, file read, patch, command, or continuation replay during recovery.
- Workspace mutation truth: workspace effects are evidence-bearing objects, not assumed from command success.

## Align

Realignment needed:

- Add registry ids to emitted artifacts so context/recovery/governance can cite information classes directly.
- Normalize read, patch, command, and future actions under a shared `AuthorityBearingTransition` envelope.
- Separate Codex thread/session identity from future `WorkThread` identity.
- Promote context maintenance, durable memory, omission ledger, and frontier baton from diagnostics into governed transitions when ready.
- Keep governance/broker in shadow mode until a `WorkThread` router exists.
- Tie sub-agent nodes to future `AgentClassSpec` and `WorkThread` scope.
- Move detailed direct diagnostics out of the Codex transcript lane into a settings/control surface.

## Missing

Not built yet:

- First-class `WorkThread` registry and broker.
- Work-target resolution from messy user utterance to active work-thread ontology.
- Direct-native skills/hooks/apps bridge rows and authority law.
- Direct settings surface for runtime/profile/registry/context/memory/skills.
- Enforced semantic broker routing.
- Full direct-native memory/compaction/frontier workflow.
- Agent class execution contracts for worker/auditor/meta-orchestrator beyond diagnostics.

## Inherited

The following are intentionally inherited from main/app-server as long as they
remain bridge-compatible:

- Vanilla `codex app-server` path.
- Main Codex transcript/composer UX.
- Bottom runtime band and runtime usage display.
- ChatGPT right pane and link/download/file-stash utilities.
- Middle-plane Web/Files/Project tabs.
- Main provider-profile/runtime constitution concepts.

Direct replacements should be created only when inherited behavior encodes the
wrong abstraction, for example treating repo/folder/chat/session as the work
unit instead of `WorkThread`.

## Next Practical Step

Build `WorkThread` next, but as a small canonical registry first:

```text
WorkThread
  workThreadId
  projectId
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

Then add a read-only work-target resolution report:

```text
incoming user request
  -> candidate WorkThreads
  -> selected target or ambiguity block
  -> delegation/context packet
  -> no workspace mutation until resolved
```

That is the correct next layer above the already implemented session/thread/tool
substrate.
