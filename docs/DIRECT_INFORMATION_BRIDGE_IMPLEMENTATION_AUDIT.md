# Direct Information Bridge Implementation Audit

Status: implementation ledger for aligning the current direct branch with
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

## Wave 1 Ledger

This implementation wave turned the abstract bridge constitution into concrete,
testable direct-path artifacts. It covers PRs `#129` through `#133`.

| PR | Slice | Added | Authority posture |
| --- | --- | --- | --- |
| `#129` | WorkThread Foundation | `WorkThread`, work-thread store/projection, shadow `WorkTargetResolution` | read-only / shadow |
| `#130` | Context + Authority Alignment | `WorkThreadContextBinding`, shared `AuthorityBearingTransition`, context/request manifest refs | evidence-only, non-enforcing |
| `#131` | Governance Consumption | governance and semantic broker diagnostics consume WorkThread/transition refs | shadow diagnostics, no routing |
| `#132` | Skills / Hooks / Apps Bridge | bridge module registry, module capability classification, authority report/status projection | classification-only, no execution |
| `#133` | Memory / Baton / Compaction Productization | context-loss witness, continuity transition, continuity status projection | visible continuity evidence, no compact/memory authority |

The original planning bundle named a direct settings/control surface as PR 3 and
agent role contracts with the skills/apps work as PR 4. The implemented order
deferred settings and agent execution contracts because the governance
consumption layer and bridge-module classification were safer prerequisites.

The wave is therefore complete as a **substrate/productization wave**, not as a
fully routed direct runtime:

```text
Implemented:
  WorkThread identity
  WorkThread-bound context/request evidence
  authority-bearing transition envelopes
  governance/broker shadow consumption
  skills/hooks/apps module classification
  memory/baton/omission/compaction visibility witnesses

Still shadow / not authority:
  WorkThread routing
  semantic broker enforcement
  skill/hook/connector execution
  provider compaction
  memory editing/reset
  baton replay/continuation
  direct settings/control UI
  agent-class execution contracts
```

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
  context loss witnesses
  continuity transitions

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
  bridge module classification
  continuity status projection
```

The first version of the key abstraction now exists as a shadow substrate:

```text
WorkThread
```

Earlier code knew about project, repo/workspace, Codex thread, direct session,
meta-session, and runtime path. The new v0 object records:

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
| `ic12.work-thread-registry` | governance/routing | partial | keep shadow |
| `ic13.bridge-information-registry` | governance/routing | partial | bootstrap now |
| `ic14.skills-hooks-apps` | governance/routing | partial | keep shadow |
| `ic15.direct-settings-surface` | observability surface | partial | keep shadow |

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
- Continue normalizing future actions under the shared `AuthorityBearingTransition` envelope.
- Preserve the distinction between Codex thread/session identity and `WorkThread` identity as routing becomes real.
- Keep governance/broker in shadow mode until a `WorkThread` router exists.
- Tie sub-agent nodes to future `AgentClassSpec` and `WorkThread` scope.
- Continue moving detailed direct diagnostics out of the Codex transcript lane into settings/control surfaces.

## Missing

Not built yet:

- Enforced `WorkThread` broker and mutation routing.
- Work-target resolution from messy user utterance to active work-thread ontology.
- Full direct settings workflows for editing/resetting memory, provider compaction, module execution, and enforced routing.
- Enforced semantic broker routing.
- Full direct-native memory/compaction/frontier workflow with live scheduler and UI controls.
- Agent class execution contracts for worker/auditor/meta-orchestrator beyond diagnostics.

## Remaining Work Ledger

The remaining direct-path work should proceed in dependency order:

1. Direct settings/control surface:
   the first display-only status projection is implemented. Remaining work is
   full settings workflow design, live WorkThread store wiring, and any future
   user-authorized edit/reset actions.

2. Agent-class specification:
   define main agent, worker, auditor, meta-orchestrator, and sub-agent role
   contracts as bridge artifacts before adding execution behavior.

3. Work-target broker:
   convert shadow `WorkTargetResolution` into a user-visible routing gate for
   ambiguous utterances, without allowing mutation before target resolution.

4. Semantic broker enforcement:
   promote governance/broker diagnostics into transition law only after the
   WorkThread router has exact evidence and stale-result guards.

5. Direct-native memory workflow:
   add explicit memory refresh/edit/reset policies, persistence, review, and UI
   controls. Memory remains evidence, not policy.

6. Direct-native compaction workflow:
   add live scheduler/manual compact controls only after provider/local
   compaction evidence is represented and omission witnesses are mandatory.

7. Skills/hooks/apps execution gates:
   allow context contribution first, evidence import second, and action
   execution only through explicit authority gates.

8. Sub-agent / worker graph alignment:
   bind sub-agent activity, worker roles, and future multi-agent orchestration to
   `WorkThread` and `AgentClassSpec`, not only to provider thread ids.

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

## WorkThread Foundation

The WorkThread v0 substrate is implemented by:

```text
src/main/direct/bridge/work-thread-registry.js
scripts/direct-workthread-foundation-regression.mjs
docs/DIRECT_WORK_THREAD_FOUNDATION_SPEC.md
```

It provides:

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

and a read-only work-target resolution report:

```text
incoming user request
  -> candidate WorkThreads
  -> selected target or ambiguity block
  -> delegation/context packet
  -> no workspace mutation until resolved
```

The resolver is shadow-only. It does not route provider calls, mutate workspaces,
or enforce delegation.

## WorkThread Context And Authority Alignment

The first alignment layer is implemented by:

```text
src/main/direct/bridge/work-thread-alignment.js
scripts/direct-workthread-context-authority-regression.mjs
docs/DIRECT_WORK_THREAD_CONTEXT_AUTHORITY_ALIGNMENT_SPEC.md
```

It provides:

```text
WorkThreadContextBinding
  workThreadId
  authorityBoundaryDigest
  openObligationRefs
  bridgeInformationRefs
  mutationAllowed = false
  providerCallAllowed = false
  routingEnforced = false

AuthorityBearingTransition
  transitionKind
  transitionPhase
  workThreadBinding
  sourceArtifact
  sideEffectExecuted
  providerContinuationSent
  mutationAllowedByTransition = false
  providerCallAllowedByTransition = false
  routingEnforced = false
```

`ContextPack` and `RequestManifest` can now cite a WorkThread binding without
adding WorkThread ids to provider prompt text. Read, patch, and command
authority artifacts now carry the shared transition envelope.

This remains non-enforcing. The binding and transition envelopes are evidence
and alignment witnesses, not mutation or provider-call authority.

## Governance Consumption Slice

Governance/broker diagnostics now consume WorkThread-aligned artifacts without
promotion to enforcement:

```text
governance input snapshot
  -> cite WorkThreadContextBinding
  -> cite AuthorityBearingTransition refs
  -> governance packet shadow diagnostics
  -> semantic broker input snapshot
  -> request manifest refs remain id/digest-only
```

Implemented by:

```text
src/main/direct/governance/broker.js
scripts/direct-governance-broker-regression.mjs
```

This slice does not route, mutate, call providers, approve tools, or enforce
WorkThread scope. It only makes the governance artifacts aware of the aligned
evidence classes.

## Skills, Hooks, Apps Bridge Module Slice

Skills, hooks, apps, and connector capabilities are now represented as bridge
modules before any direct-native runner exists:

```text
bridge module registry
  -> skill/context-only module
  -> hook/action-proposal module
  -> connector/evidence-import module
  -> authority report
  -> display-only status projection
```

Implemented by:

```text
src/main/direct/bridge/skills-hooks-apps.js
scripts/direct-skills-hooks-apps-bridge-regression.mjs
```

This slice does not execute modules, auto-invoke hooks, call connectors, mutate
workspace state, call providers, or route WorkThreads. It only classifies module
authority posture and strips caller-supplied execution flags.

## Memory, Baton, Compaction Productization Slice

Context maintenance now has a user-visible bridge layer over the existing
diagnostic artifacts:

```text
pressure / route / trim / memory / baton primitives
  -> ContextLossWitness
  -> ContextContinuityTransition
  -> ContextContinuityStatusProjection
```

Implemented by:

```text
src/main/direct/context/maintenance.js
scripts/direct-memory-baton-compaction-productization-regression.mjs
```

This slice makes omissions, durable memory presence, frontier baton presence,
and provider-compaction gate state inspectable without changing runtime
authority. It explicitly preserves:

```text
memory editing disabled
memory reset disabled
provider compaction disabled
provider transport disabled
baton replay authority disabled
hidden context loss disabled
```

The productized transition is therefore suitable for a future settings/control
surface, but it is not a scheduler, provider compact runner, memory editor, or
continuation authority.

## Next Practical Step

## Direct Settings / Bridge Status Surface Slice

Implemented in the PR 6 slice:

- `src/main/direct/ui/settings-surface.js` builds `direct_settings_surface_projection@1`.
- `direct-settings:bridge-status` exposes a renderer-safe, display-only IPC projection.
- The Project tab renders runtime/profile, registry, WorkThread, governance/broker,
  skills/hooks/apps, and continuity status rows.
- `scripts/direct-settings-bridge-status-regression.mjs` asserts authority flags remain false.

Explicitly still out of scope:

- WorkThread routing enforcement.
- Semantic broker enforcement.
- Module execution or connector calls.
- Memory editing/reset.
- Provider compaction or provider transport.
- Creating a live WorkThread registry store from the settings read path.
