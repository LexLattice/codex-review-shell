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

## Current Executable Audit Snapshot

Last reviewed after Wave 7 / PR 41 on `2026-06-14`.

```text
registry rows: 38
valid: yes
missing source files: 0
implemented rows: 10
partial rows: 26
inherited rows: 2
```

The executable source of this snapshot is:

```sh
npm run direct:information-bridge-audit
```

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
  sub-agent inspect/wait containment
  usage/quota/model readiness
  bridge module classification
  continuity status projection
  direct implementation-lane UI readiness
  context maintenance execution gate
  live promotion report
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
| `ic3.context-packet-preview-workbench` | context construction | partial | keep guarded |
| `ic3.memory-review-workbench` | memory/continuity | partial | keep guarded |
| `ic4.read-file-authority` | authority gate | implemented | keep |
| `ic4.patch-authority` | authority gate | implemented | keep |
| `ic4.command-authority` | authority gate | implemented | keep |
| `ic4.workspace-mutation-truth` | canonical evidence | implemented | keep |
| `ic5.recovery-and-replay-safety` | governance/routing | implemented | keep |
| `ic6.semantic-governance-broker` | governance/routing | partial | keep shadow |
| `ic6.direct-role-handoff-packet` | governance/routing | partial | keep shadow |
| `ic6.direct-worker-start-v0` | governance/routing | partial | keep guarded |
| `ic6.direct-meta-orchestrator-shadow` | governance/routing | partial | keep shadow |
| `ic7.sub-agent-observability` | observability surface | partial | keep and align |
| `ic7.sub-agent-inspect-wait-containment` | observability surface | partial | keep guarded |
| `ic8.usage-quota-readiness` | observability surface | partial | keep and align |
| `ic9.direct-runtime-selection` | governance/routing | partial | keep and simplify UI |
| `ic10.retained-appserver-path` | observability surface | inherited | retain when aligned |
| `ic11.inherited-shell-ux` | observability surface | inherited | retain when aligned |
| `ic12.work-thread-registry` | governance/routing | partial | keep shadow |
| `ic12.work-thread-control-deck` | governance/routing | partial | keep guarded |
| `ic12.governance-enforcement-clarification` | governance/routing | partial | keep guarded |
| `ic12.clarification-target-picker` | governance/routing | partial | keep guarded |
| `ic13.bridge-information-registry` | governance/routing | partial | bootstrap now |
| `ic14.skills-hooks-apps` | governance/routing | partial | keep shadow |
| `ic14.module-context-intake` | context construction | partial | keep guarded |
| `ic15.direct-settings-surface` | observability surface | partial | keep shadow |
| `ic16.agent-class-spec-registry` | governance/routing | partial | keep shadow |
| `ic17.direct-attachment-capability` | authority gate | partial | keep and align |
| `ic18.direct-live-promotion-report` | canonical evidence | partial | keep gated |
| `ic19.direct-implementation-ui-readiness` | observability surface | partial | keep read-only |
| `ic20.context-maintenance-execution-gate` | memory/continuity | partial | keep guarded |
| `ic21.direct-manual-smoke-gate` | observability surface | partial | keep read-only |

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
- Continue tying sub-agent nodes, inspect packets, and wait-status packets to
  `AgentClassSpec` and `WorkThread` scope before any choreography authority.
- Continue moving detailed direct diagnostics out of the Codex transcript lane into settings/control surfaces.
- Productize WorkThread current pointers so the operator can see and select the
  active work-world identity before provider/tool transitions.
- Productize clarification packets into an operator target picker rather than
  leaving ambiguous routing as blocked diagnostics only.

## Missing

Not built yet:

- Full direct settings workflows for editing/resetting memory, provider compaction, module execution, and enforced routing.
- Enforced semantic broker routing.
- Full direct-native memory/compaction/frontier workflow with live scheduler and UI controls.
- Agent execution contracts for worker/auditor/meta-orchestrator beyond declared role specs.
- Broad manual/electron smoke gate for the direct branch.

## Remaining Work Ledger

The remaining direct-path work should proceed in dependency order:

1. Direct settings/control surface:
   the first display-only status projections are implemented. Remaining work is
   WorkThread current-pointer UX, context preview, and user-authorized
   edit/reset workflows.

2. Agent-class specification:
   the first role-contract registry is implemented. Remaining work is binding
   these contracts to worker graphs, WorkThread routing, and concrete execution
   gates.

3. Work-target broker:
   convert shadow/blocked clarification packets into a user-visible target
   picker, without allowing mutation before target resolution.

4. Semantic broker enforcement:
   promote governance/broker diagnostics into transition law only after the
   WorkThread router has exact evidence and stale-result guards.

5. Direct-native memory workflow:
   connect memory refresh/edit/reset proposals to an operator-visible
   materialization UI. Memory remains evidence, not policy.

6. Direct-native compaction workflow:
   add live scheduler/manual compact controls only after provider/local
   compaction evidence is represented and omission witnesses are mandatory.

7. Skills/hooks/apps execution gates:
   allow context contribution first, evidence import second, and action
   execution only through explicit authority gates.

8. Sub-agent / worker graph alignment:
   keep sub-agent activity, worker roles, inspect packets, and future
   multi-agent orchestration bound to `WorkThread` and `AgentClassSpec`, not
   only to provider thread ids.

9. Wave 6 operator control loop:
   implement WorkThread control deck, clarification picker, context packet
   preview, memory materialization UI, module contribution intake, and direct
   manual smoke gate before adding broader authority.

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

## Wave 2 Ledger

### Direct Settings / Bridge Status Surface Slice

Implemented in the PR 6 slice:

- `src/main/direct/ui/settings-surface.js` builds `direct_settings_surface_projection@1`.
- `direct-settings:bridge-status` exposes a renderer-safe, display-only IPC projection.
- The Project tab renders runtime/profile, registry, WorkThread, governance/broker,
  skills/hooks/apps, continuity, direct usage, and manual smoke gate status rows.
- `scripts/direct-settings-bridge-status-regression.mjs` asserts authority flags remain false.
- `scripts/direct-manual-smoke-gate-surface-regression.mjs` asserts the Electron
  settings/control markup and renderer wiring expose the smoke gate rows as
  display-only evidence.
- `scripts/direct-electron-settings-smoke-regression.mjs` launches the actual
  Electron shell against a fixture project, opens the Project tab, verifies the
  runtime/WorkThread/module/continuity/manual-smoke row groups, and feeds a
  sanitized `electron_projection` result into `direct_manual_smoke_gate@1`.
- PR 41 adds a compact Codex-plane runtime selector/status witness and moves the
  broad Direct implementation-lane and Direct diagnostics cards into the Project
  settings/control surface.

Explicitly still out of scope:

- WorkThread routing enforcement.
- Semantic broker enforcement.
- Module execution or connector calls.
- Memory editing/reset.
- Provider compaction or provider transport.
- Creating a live WorkThread registry store from the settings read path.

### AgentClassSpec Registry Slice

Implemented in the PR 7 slice:

- `src/main/direct/bridge/agent-class-spec.js` builds
  `direct_agent_class_registry@1`, `direct_agent_class_spec@1`, and
  `direct_agent_class_status_projection@1`.
- Default role contracts exist for primary agent, implementation worker, audit
  worker, fix worker, closeout worker, meta-orchestrator, work-thread broker,
  memory/compaction worker, governance broker, and sub-agent worker.
- Each role declares consumed context families, produced artifact families,
  authority contract posture, and forbidden conflations.
- The Direct bridge settings surface displays agent-class status rows.
- `scripts/direct-agent-class-spec-regression.mjs` asserts role-boundary and
  no-authority invariants.

Explicitly still out of scope:

- Worker spawning or routing.
- Sub-agent execution enforcement.
- Object-level audit automation.
- WorkThread router promotion.
- Provider calls, workspace mutation, memory mutation, or provider compaction
  from role specs.

### Sub-Agent / Worker Graph Alignment Slice

Implemented in the PR 8 slice:

- `src/main/direct/agents/observability.js` aligns worker/sub-agent graph
  evidence with WorkThread and AgentClassSpec identity.
- Worker nodes can cite WorkThread id, provider thread id, model/effort,
  lifecycle/activity, parent edge data, and mapped role contract.
- `scripts/direct-sub-agent-observability-regression.mjs` asserts worker graph
  containment and no child-output promotion.

Explicitly still out of scope:

- New sub-agent spawning.
- Autonomous orchestration.
- Worker result promotion into the primary transcript without projection law.
- Enforced WorkThread routing by role.

### Work-Target Resolver Productization Slice

Implemented in the PR 9 slice:

- `direct_work_target_resolution_report@1` turns shadow resolution into a
  renderer-safe target-gate report.
- Reports include selected target, candidate summaries, stale blockers,
  ambiguity blockers, and mutation/provider-call posture.
- Settings bridge status can display resolver state.
- `scripts/direct-workthread-foundation-regression.mjs` and
  `scripts/direct-settings-bridge-status-regression.mjs` cover selected,
  ambiguous, stale, unresolved, and renderer-safe cases.

Explicitly still out of scope:

- User clarification target picker.
- Full enforcement in every direct action controller.
- Object-level task execution by the resolver.

### Semantic Broker Preflight Slice

Implemented in the PR 10 slice:

- `semantic_broker_preflight@1` consumes semantic broker packet,
  WorkTargetResolution report, AgentClassSpec, context/request refs, and
  AuthorityBearingTransition refs.
- Recommendation classes are `allow`, `block`, `clarify`, `route_to_role`,
  and `stale`.
- `scripts/direct-governance-broker-regression.mjs` covers recommendation
  classes, stale guards, and non-authority flags.

Explicitly still out of scope:

- Controller-level preflight enforcement except where later controlled-routing
  slices explicitly opt in.
- Role handoff execution.
- Broker object-level audit or worker behavior.

### Direct-Native Memory Workflow Slice

Implemented in the PR 11 slice:

- Memory review, refresh proposal, reset policy, and reset confirmation
  artifacts are represented as direct-native workflow packets.
- Continuity/settings projection exposes memory review state, refresh proposal
  state, stale count, and conflict count.
- Memory remains evidence and continuity substrate, not policy authority.

Explicitly still out of scope:

- Actual memory rewrite/materialization.
- Executable memory reset.
- Provider-side memory claim acceptance.

### Direct-Native Compaction Workflow Gate Slice

Implemented in the PR 12 slice:

- `direct_context_compaction_plan@1` and `direct_context_compaction_gate@1`
  model local compaction preview and manual gate state.
- Source-span and residual-risk witnesses keep omission visibility explicit.
- Provider compaction remains blocked unless runtime/provider evidence later
  proves support.

Explicitly still out of scope:

- Opaque provider compact output as source truth.
- Automatic compaction scheduler.
- Hidden omission.

### Skills / Hooks / Apps Execution Gate Slice

Implemented in the PR 13 slice:

- `direct_bridge_context_contribution@1`
- `direct_bridge_evidence_import_row@1`
- `direct_bridge_hook_proposal@1`
- `direct_bridge_execution_gate@1`
- Module status/settings projection includes context contribution, evidence
  import, hook proposal, and execution gate counts.
- `scripts/direct-module-execution-gates-regression.mjs` proves execution gates
  do not enable provider calls, workspace mutation, connector action, hook
  action, or auto invocation.

Explicitly still out of scope:

- Default auto-invocation.
- Workspace mutation from hooks/apps.
- Connector calls without an AuthorityBearingTransition.

### First Controlled Routing Slice

Implemented in the PR 14 slice:

- `src/main/direct/bridge/controlled-routing.js` builds
  `direct_controlled_routing_slice@1`.
- Direct text `turn/start` can build and persist the route artifact when
  WorkThread routing evidence is supplied.
- The route cites WorkTargetResolution, semantic broker preflight, primary
  AgentClassSpec, WorkThread binding, context pack, and request-manifest
  evidence before the existing direct text provider call is sent.
- `scripts/direct-controlled-routing-slice-regression.mjs` proves the route is
  accepted only for the primary-agent `text_only` path and is attached to the
  persisted context/request artifacts.

Explicitly still out of scope:

- Route-to-role execution.
- Multi-agent orchestration.
- Autonomous tool execution.
- Workspace mutation.
- Direct app-server replacement.
- Object-level audit automation.

## Planned Wave 3

The next roadmap wave is now tracked in:

```text
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
```

Planned sequence:

```text
PR 15 direct-native thread deck and new thread UX
PR 16 operator/project broker resolution surface
PR 17 direct usage ledger by agent and worker
PR 18 direct attachment capability and submit semantics
PR 19 route-to-role handoff packet
PR 20 explicit worker start V0
PR 21 meta-orchestrator / auditor loop spec-to-shadow
```
