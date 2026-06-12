# Direct Information Bridge Wave Roadmap

Status: quick-refresh roadmap for the direct information-bridge implementation.

Authoritative implemented-state ledger:

```text
docs/DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md
src/main/direct/bridge/information-registry.js
scripts/direct-information-bridge-audit.mjs
```

Use this file to answer:

```text
What wave are we in?
What PR comes next?
What is deliberately out of scope?
What dependency must be true before a later PR starts?
```

Do not treat this file as runtime authority. It is a planning projection over
the audit ledger.

## Implementation Doctrine

The direct path is a unified information bridge:

```text
human intent
  -> interface/control event
  -> evidence artifact
  -> context packet
  -> provider request
  -> model output
  -> harness interpretation
  -> UI projection
  -> authorized action
  -> world mutation
  -> new evidence
```

Every PR should state which bridge organ it changes:

```text
identity
context
authority
governance/routing
memory/continuity
agent role
module capability
observability surface
execution gate
```

Standing laws:

- Renderer affordance is not authority.
- Memory is evidence, not policy.
- Baton/frontier state is not replay or continuation authority.
- WorkThread is the work-world identity; Codex thread id is provider/runtime identity.
- Skills/hooks/apps are bridge modules; classification does not imply execution.
- Missing evidence renders unknown, degraded, unavailable, or blocked.
- No workspace mutation before target WorkThread resolution when routing is enforced.

## Wave 1: Bridge Substrate And Productization

Status: merged.

Goal:

```text
Make the direct bridge ontology concrete, testable, and inspectable as
non-authoritative evidence before enabling routing or execution behavior.
```

| PR | Status | Branch | Purpose | Delivered | Explicit non-goals |
| --- | --- | --- | --- | --- | --- |
| `#128` | merged | `codex/direct-bridge-registry-audit` | Bridge inventory | Direct information-class registry and implementation audit | No behavior changes |
| `#129` | merged | `codex/direct-workthread-foundation` | WorkThread identity | `WorkThread`, store/projection, shadow `WorkTargetResolution` | No routing, no mutation gate |
| `#130` | merged | `codex/direct-workthread-context-authority` | Context/authority alignment | `WorkThreadContextBinding`, `AuthorityBearingTransition`, context/request refs | No enforcement, no provider authority |
| `#131` | merged | `codex/direct-governance-workthread-witness` | Governance consumption | Governance/broker diagnostics consume WorkThread and transition refs | No semantic broker enforcement |
| `#132` | merged | `codex/direct-skills-hooks-apps-bridge` | Bridge module classification | Skills/hooks/apps registry, capability classification, authority report/status projection | No module execution, no connector calls |
| `#133` | merged | `codex/direct-memory-baton-compaction-productization` | Continuity visibility | Context loss witness, continuity transition, continuity status projection | No provider compaction, memory edit/reset, replay authority |

Wave 1 result:

```text
Implemented:
  WorkThread identity
  context/request WorkThread evidence
  authority transition envelopes
  governance shadow consumption
  bridge module classification
  continuity/memory/baton/omission visibility

Still intentionally not authority:
  WorkThread routing
  semantic broker enforcement
  skill/hook/connector execution
  provider compaction
  memory editing/reset
  baton replay/continuation
  full direct settings/control workflows
  agent-class execution contracts
```

## Wave 2: Inspectability, Roles, And Controlled Routing

Status: planned.

Goal:

```text
Expose the bridge substrate to the operator, define role contracts, then move
toward controlled routing without collapsing broker, worker, and auditor roles.
```

### PR 6: Direct Settings / Bridge Status Surface

Status: merged.

Branch:

```text
codex/direct-settings-bridge-status-surface
```

Purpose:

```text
Build the direct settings/control surface so bridge state is inspectable outside
the Codex transcript lane.
```

Scope:

- Add `ic15.direct-settings-surface`.
- Expose runtime/profile/registry rows.
- Expose WorkThread state and resolution diagnostics.
- Expose governance/broker shadow status.
- Expose skills/hooks/apps module status.
- Expose memory/baton/omission/compaction continuity status.
- Keep inherited runtime switch visible but not noisy.

Implemented in the first slice:

- `direct_settings_surface_projection@1` support artifact.
- Read-only `direct-settings:bridge-status` IPC/preload projection.
- Project-tab Direct bridge status card.
- Regression coverage for non-authority flags and renderer-safe rows.

Still deferred:

- Full settings workflows.
- Live WorkThread registry store wiring from main-process state.
- Any authority-bearing action from the settings surface.

Non-goals:

- No WorkThread routing enforcement.
- No semantic broker enforcement.
- No skill/hook/connector execution.
- No memory editing/reset.
- No provider compaction.

Dependency:

```text
Wave 1 registry/projection artifacts must remain renderer-safe and display-only.
```

### PR 7: AgentClassSpec Registry

Status: merged.

Branch:

```text
codex/direct-agent-class-spec-registry
```

Purpose:

```text
Define role contracts before assigning work to agents.
```

Scope:

- Add `AgentClassSpec` registry.
- Define main agent, implementation worker, audit worker, fix worker,
  closeout worker, meta-orchestrator, work-thread broker, memory/compaction
  worker, governance broker, and sub-agent worker.
- For each class, define consumed context families, produced artifact families,
  allowed authority, and forbidden conflations.
- Add fixture/regression coverage for role boundaries.

Implemented in the first slice:

- `direct_agent_class_registry@1`, `direct_agent_class_spec@1`, and
  `direct_agent_class_status_projection@1`.
- Default role contracts for the ten planned agent classes.
- Direct settings status rows for agent-class registry posture.
- Regression coverage for forbidden conflations and non-authority flags.

Still deferred:

- Binding role specs to sub-agent/worker graph execution.
- Enforced WorkThread routing by role.
- Any object-level audit automation.

Non-goals:

- No spawning/routing behavior.
- No sub-agent execution contract enforcement.
- No object-level audit automation.

Dependency:

```text
Direct settings can display these specs after PR 6, but execution must remain
disabled until later authority gates exist.
```

### PR 8: Sub-Agent / Worker Graph Alignment

Status: merged.

Branch:

```text
codex/direct-worker-graph-alignment
```

Purpose:

```text
Bind existing sub-agent observability to WorkThread and AgentClassSpec instead
of provider thread ids alone.
```

Scope:

- Add WorkThread-scoped worker graph projection.
- Map provider sub-agent metadata to `AgentClassSpec`.
- Preserve model/effort, lifecycle, activity, parent/child edges.
- Keep primary transcript free of child dialogue flattening.
- Keep right-pane worker display aligned with role/WorkThread identity.

Implemented in the first slice:

- `direct_worker_graph_alignment@1` support artifact.
- Worker nodes cite `workThreadId`, provider thread id, runtime model/effort,
  lifecycle/activity, parent edge data, and mapped `AgentClassSpec`.
- Regression coverage for WorkThread scoping, role/spec mapping, runtime
  metadata preservation, and no child-output promotion.

Still deferred:

- Live right-pane rendering changes that consume the worker alignment artifact.
- Binding worker alignment to executable sub-agent controls.
- Enforced WorkThread routing by role.

Non-goals:

- No new sub-agent spawning.
- No autonomous orchestration.
- No worker output promotion into primary transcript without projection law.

Dependency:

```text
AgentClassSpec registry exists.
```

### PR 9: Work-Target Resolver Productization

Status: merged.

Branch:

```text
codex/direct-work-target-resolver-productization
```

Purpose:

```text
Turn shadow WorkTargetResolution into an operator-visible routing gate for
ambiguous or cross-thread requests.
```

Scope:

- Add productized resolver report/projection.
- Show selected target, candidates, blockers, and evidence.
- Block direct-path mutation when resolution is ambiguous.
- Preserve non-target workspaces/threads.
- Add stale-result guards.

Implemented in the first slice:

- `direct_work_target_resolution_report@1` productized resolver report.
- Stale guards for age, project, request digest, and resolution digest.
- Target-gate state for selected, clarification-required, stale-blocked, and
  unresolved-blocked outcomes.
- Settings-surface rows for target gate, blockers, and mutation posture.
- Regression coverage for selected, ambiguous/unresolved, stale, and
  renderer-safe report behavior.

Still deferred:

- Enforced mutation blocking in every direct action controller.
- User clarification workflow / target picker.
- Automatic semantic broker routing.

Non-goals:

- No automatic semantic broker routing.
- No object-level task execution by the resolver.
- No mutation before target resolution.

Dependency:

```text
WorkThread registry exists; settings/control surface can display resolver state.
```

### PR 10: Semantic Broker Preflight

Status: merged.

Branch:

```text
codex/direct-semantic-broker-preflight
```

Purpose:

```text
Promote governance/broker diagnostics into preflight transition law without
turning the broker into a worker or auditor.
```

Scope:

- Broker consumes WorkTargetResolution, AgentClassSpec, context/request refs,
  and AuthorityBearingTransition envelopes.
- Emit recommendation classes: allow, block, clarify, route-to-role, stale.
- Add evidence/provenance requirements and stale-input guards.

Implemented in the first slice:

- `semantic_broker_preflight@1` support artifact.
- Preflight consumes semantic broker packet, WorkTargetResolution report,
  AgentClassSpec, context/request refs, and AuthorityBearingTransition refs.
- Recommendation classes: `allow`, `block`, `clarify`, `route_to_role`,
  `stale`.
- Regression coverage for all recommendation classes and non-authority flags.

Still deferred:

- Controller-level enforcement of preflight outcomes.
- User clarification workflow / target picker.
- Actual role handoff or worker routing.

Non-goals:

- No fully autonomous routing loop.
- No object-level code review/audit by broker.
- No provider/tool execution directly from broker output.

Dependency:

```text
Work-target resolver and agent class specs exist.
```

### PR 11: Direct-Native Memory Workflow

Status: in progress.

Branch:

```text
codex/direct-memory-workflow
```

Purpose:

```text
Make memory refresh/review/reset a governed workflow instead of a diagnostic
artifact only.
```

Scope:

- Add memory review packet.
- Add explicit refresh proposal and acceptance/rejection states.
- Add memory staleness/conflict display.
- Add reset policy and confirmation artifact if reset is enabled.
- Keep memory source refs and omission refs visible.

Implemented in the first slice:

- `thread_memory_review_packet@1`
- `thread_memory_refresh_proposal@1`
- `thread_memory_reset_policy@1`
- `thread_memory_reset_confirmation@1`
- Continuity/settings projection fields for memory review, refresh proposal,
  reset policy, stale count, and conflict count.

Still deferred:

- Actual memory rewrite/materialization.
- Executable memory reset.
- Provider-side memory claim acceptance.

Non-goals:

- No silent automatic memory rewrite.
- No memory as instruction/policy authority.
- No provider-side memory claims without evidence.

Dependency:

```text
Continuity transition witnesses exist; settings/control surface can display
memory state.
```

### PR 12: Direct-Native Compaction Workflow Gate

Status: planned.

Purpose:

```text
Add compaction planning and gate state while preserving omission visibility and
fail-closed provider compaction.
```

Scope:

- Add local compaction plan preview.
- Require ContextLossWitness before any compacted context is eligible.
- Expose manual compact gate state.
- Keep provider compaction blocked unless runtime evidence proves support.
- Add residual-risk and source-span witnesses.

Non-goals:

- No opaque provider compact output as source truth.
- No automatic scheduler in this PR unless the gate is already evidence-complete.
- No hidden omission.

Dependency:

```text
Continuity status projection and memory workflow policy exist.
```

### PR 13: Skills / Hooks / Apps Execution Gates

Status: planned.

Purpose:

```text
Move from bridge-module classification to controlled contribution/action gates.
```

Scope:

- Allow context-only skill contribution through context pack refs.
- Allow connector evidence import through explicit evidence rows.
- Add hook proposal packets.
- Add execution gate schema for future mutating hooks/connectors.

Non-goals:

- No default auto-invocation.
- No workspace mutation from hooks/apps.
- No connector action without authority transition.

Dependency:

```text
Semantic broker preflight and AuthorityBearingTransition envelopes exist.
```

### PR 14: First Controlled Routing Slice

Status: planned after PRs 6-13.

Purpose:

```text
Enable one narrow direct routing path end-to-end.
```

Candidate slice:

```text
operator request
  -> WorkTargetResolution
  -> semantic broker preflight
  -> agent role selection
  -> context pack
  -> existing direct text turn
```

Non-goals:

- No multi-agent orchestration loop.
- No autonomous tool execution expansion.
- No direct replacement of vanilla app-server path.

Dependency:

```text
Settings, agent class specs, resolver productization, and semantic preflight
must be implemented and green.
```

## Update Rules

After each PR:

1. Mark the PR row status as `merged`.
2. Add the branch name if it changed.
3. Move any explicitly deferred scope into a later PR or backlog row.
4. Update `DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md` only when the
   implemented-state truth changed.
5. Run:

```sh
npm run direct:information-bridge-audit
```

## Backlog Parking Lot

Items that are real but not yet assigned to a wave:

- Cost/usage attribution by main agent and sub-worker for the direct path.
- Full multi-agent long-horizon orchestrator/auditor loop.
- Operator/project broker across multiple repos, branches, work folders, and
  active ontologies.
- Direct-native replacement for app-server thread listing/start/resume UX.
- Provider-side direct image/file attachment semantics.
- Mature skill/hook marketplace or installation UI.
