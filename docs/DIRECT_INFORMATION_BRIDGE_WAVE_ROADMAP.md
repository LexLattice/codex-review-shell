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

Status: merged.

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

Status: merged.

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

Status: merged.

Branch:

```text
codex/direct-compaction-gate
```

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

Implemented in the first slice:

- `direct_context_compaction_plan@1`
- `direct_context_compaction_gate@1`
- Source-span and residual-risk witnesses on local compaction preview.
- Continuity/settings projection fields for local plan state, manual gate
  state, compacted-context eligibility, source-span count, and residual-risk
  count.
- Regression coverage proving manual compaction/provider compaction remain
  disabled without separate authority.

Non-goals:

- No opaque provider compact output as source truth.
- No automatic scheduler in this PR unless the gate is already evidence-complete.
- No hidden omission.

Dependency:

```text
Continuity status projection and memory workflow policy exist.
```

### PR 13: Skills / Hooks / Apps Execution Gates

Status: merged.

Branch:

```text
codex/direct-module-execution-gates
```

Purpose:

```text
Move from bridge-module classification to controlled contribution/action gates.
```

Scope:

- Allow context-only skill contribution through context pack refs.
- Allow connector evidence import through explicit evidence rows.
- Add hook proposal packets.
- Add execution gate schema for future mutating hooks/connectors.

Implemented in the first slice:

- `direct_bridge_context_contribution@1`
- `direct_bridge_evidence_import_row@1`
- `direct_bridge_hook_proposal@1`
- `direct_bridge_execution_gate@1`
- Module status/settings projection fields for context contribution, evidence
  row, hook proposal, and execution gate counts.
- Regression coverage proving module gates do not enable execution, provider
  calls, workspace mutation, connector actions, hook actions, or auto invocation.

Non-goals:

- No default auto-invocation.
- No workspace mutation from hooks/apps.
- No connector action without authority transition.

Dependency:

```text
Semantic broker preflight and AuthorityBearingTransition envelopes exist.
```

### PR 14: First Controlled Routing Slice

Status: merged.

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

Implemented in the first slice:

- `direct_controlled_routing_slice@1` composes WorkTargetResolution,
  semantic broker preflight, primary AgentClassSpec, WorkThread binding, and
  context-pack/request-manifest refs.
- Direct text `turn/start` builds and persists the route artifact when
  WorkThread routing evidence is supplied.
- Context packs and request manifests cite the controlled route digest as
  sanitized governance evidence.
- Regression coverage proves the route can permit only the existing direct text
  turn provider call scope and cannot enable workspace mutation, tool execution,
  autonomous routing, multi-agent orchestration, or app-server replacement.

Non-goals:

- No multi-agent orchestration loop.
- No autonomous tool execution expansion.
- No direct replacement of vanilla app-server path.
- No route-to-role execution; non-primary-agent recommendations remain blocked.

Dependency:

```text
Settings, agent class specs, resolver productization, and semantic preflight
must be implemented and green.
```

Wave 2 result:

```text
Implemented:
  direct settings / bridge status surface
  AgentClassSpec role contracts
  WorkThread-scoped worker graph alignment
  productized WorkTargetResolution report
  semantic broker preflight
  direct-native memory workflow packets
  direct-native compaction workflow gate
  skills/hooks/apps contribution/import/proposal/execution gates
  first controlled routing slice into existing direct text turn

Still intentionally not authority:
  route-to-role execution
  multi-agent orchestration loop
  autonomous tool execution expansion
  skill/hook/connector execution runner
  provider-side memory acceptance
  provider compaction execution
  direct-native thread deck parity
  cross-project operator broker enforcement
  direct provider file/image payload semantics
```

## Wave 3: Direct-Native Product Surface And Brokered Workflows

Status: in progress.

Goal:

```text
Make the direct path practical for normal daily workflow while keeping the
information bridge laws explicit: target resolution before mutation, context
pack before provider request, role contract before delegation, and evidence
before authority.
```

### PR 15: Direct-Native Thread Deck And New Thread UX

Status: merged.

Branch:

```text
codex/direct-thread-deck-new-thread
```

Purpose:

```text
Expose direct-native thread list/start/resume/focus flows with WorkThread-aware
identity instead of relying on app-server thread UX assumptions.
```

Scope:

- Add direct thread deck projection for sessions, active turns, and recoverable
  interrupted turns.
- Add new direct thread action with explicit project/runtime/default model
  posture.
- Add resume/focus actions for existing direct sessions.
- Keep grouping control-plane invariant: WorkThread/project ontology first,
  provider/runtime thread id second.
- Keep app-server path unchanged.

Implemented in this slice:

- `direct_thread_deck_projection@1` support artifact.
- Direct `thread/list` now returns a renderer-safe deck projection alongside
  the legacy thread list.
- Direct session index rows retain model, reasoning effort, and WorkThread
  binding evidence needed by the deck.
- Direct `thread/start` persists operator-selected model/reasoning posture and
  optional WorkThread id.
- The Codex left-plane direct strip consumes deck rows/action descriptors while
  retaining legacy list fallback.
- Regression coverage for running, recoverable interrupted, WorkThread-scoped,
  focus, resume, and new-thread default posture cases.

Non-goals:

- No import/migration of vanilla app-server sessions.
- No multi-panel concurrent direct execution unless already supported by the
  existing direct controller.
- No WorkThread creation wizard beyond minimal safe thread start.

Dependency:

```text
Controlled routing and settings bridge status are merged.
```

### PR 16: Operator / Project Broker Resolution Surface

Status: merged.

Branch:

```text
codex/direct-operator-broker-resolution
```

Purpose:

```text
Turn wrong-thread / compressed user utterance handling into an explicit broker
resolution artifact before any direct-path mutation or delegation.
```

Scope:

- Add `operator_broker_resolution@1` over active WorkThreads, branches,
  workspaces, linked Codex/ChatGPT threads, open obligations, and recent
  context packet refs.
- Add candidate/confidence/ambiguity projection in settings or project surface.
- Add clarification-required state when candidates conflict.
- Add non-target preservation constraints to downstream route packets.

Implemented in this slice:

- `operator_broker_resolution@1` support artifact and renderer-safe
  `operator_broker_resolution_projection@1`.
- Broker resolution wraps existing `WorkTargetResolution` and target report
  evidence with work-world inputs, candidate confidence, ambiguity blockers,
  clarification state, and non-target preservation constraints.
- Direct settings/project surface now has a distinct Operator broker panel.
- Controlled routing packets can cite an operator broker resolution and carry
  its non-target preservation constraints; clarification-required broker output
  blocks the direct text route.
- Regression coverage for selected, ambiguous, settings projection, and
  controlled-routing packet cases.

Non-goals:

- No broker execution of object-level work.
- No silent target switch when confidence is low.
- No reliance on chat recency as sole authority.

Dependency:

```text
WorkTargetResolution report, semantic broker preflight, and controlled routing
slice exist.
```

### PR 17: Direct Usage Ledger By Agent And Worker

Status: implemented in branch.

Branch:

```text
codex/direct-usage-ledger-agent-worker
```

Purpose:

```text
Capture direct-path model/turn usage as neutral evidence, with main-agent and
sub-worker separation where the direct harness owns the calls.
```

Scope:

- Add direct usage ledger rows for direct provider requests, responses,
  streamed usage, turn duration, model, effort, service tier, and context
  pressure.
- Attribute rows to primary agent, worker/sub-agent, WorkThread, and route.
- Expose summary in analytics/settings without treating cost as runtime truth.
- Keep cost derivation separate and price-snapshot-bound.

Implemented in this slice:

- `direct_agent_usage_ledger@1` and
  `direct_agent_usage_summary_projection@1` over existing direct
  per-turn usage attribution.
- Usage rows retain model, reasoning effort, service-tier exposure posture,
  context/request manifest ids, turn duration, agent scope, WorkThread id, and
  controlled-route scope.
- Missing usage rows are explicit and never treated as zero-token truth.
- Direct settings/project surface now includes a Direct usage status panel.
- Current-project settings status builds a usage summary from local direct
  session/turn evidence.
- Regression coverage for primary-agent, sub-worker, WorkThread, route,
  dedupe, missing usage, duration, privacy, and no-cost posture.

Non-goals:

- No attempt to reconstruct exact vanilla app-server sub-agent usage when
  upstream app-server does not expose it.
- No billing-grade cost claim without dated pricing evidence.
- No raw prompt/output payload storage by default.

Dependency:

```text
AgentClassSpec and worker graph alignment exist; direct transport request path
is already main-process-owned.
```

### PR 18: Direct Attachment Capability And Submit Semantics

Status: planned.

Purpose:

```text
Define how files/images enter direct provider requests, as payloads or governed
references, without inheriting app-server attachment assumptions.
```

Scope:

- Add direct provider attachment capability projection.
- Extend attachment submit packet with direct disposition:
  provider payload, workspace ref, staged ref, text ref, or unsupported.
- Add image/file capability gates and blocked-state witnesses.
- Keep staging manifests, raw-path redaction, and cross-project draft guards.

Non-goals:

- No fake image/file payload support without provider evidence.
- No directory ingestion.
- No OCR/image understanding layer.
- No attachment transcript truth before provider submit/acceptance witness.

Dependency:

```text
Mainline attachment staging substrate exists; direct runtime capability
projection is available.
```

### PR 19: Route-To-Role Handoff Packet

Status: planned.

Purpose:

```text
Convert semantic broker `route_to_role` recommendations into explicit handoff
packets without spawning workers or running an orchestration loop.
```

Scope:

- Add `direct_role_handoff_packet@1`.
- Cite WorkThread, operator broker/target resolution, semantic preflight,
  selected AgentClassSpec, authority boundary, context packet refs, and
  expected output artifact family.
- Add renderer-safe preview and accept/reject posture.
- Keep provider call and worker spawn disabled unless a later PR grants it.

Non-goals:

- No automatic worker creation.
- No object-level audit execution.
- No route-to-role provider call in this PR.

Dependency:

```text
Operator broker and controlled routing slice exist.
```

### PR 20: Explicit Worker Start V0

Status: planned.

Purpose:

```text
Allow an operator-approved role handoff packet to start one bounded direct
worker turn, while preserving primary/worker transcript separation.
```

Scope:

- Add one explicit start-worker transition from an accepted handoff packet.
- Build worker context packet from cited WorkThread and handoff evidence.
- Persist worker session/thread identity and link it to worker graph alignment.
- Render worker activity separately from primary transcript.

Non-goals:

- No autonomous multi-agent loop.
- No recursive worker spawning.
- No auditor certification or workflow closure automation.

Dependency:

```text
Route-to-role handoff packet exists and direct-native thread deck can display
the worker session.
```

### PR 21: Meta-Orchestrator / Auditor Loop Spec-To-Shadow

Status: planned.

Purpose:

```text
Introduce the long-horizon loop as typed institutional events and artifacts
before enabling autonomous advancement.
```

Scope:

- Add meta-orchestrator plan pointer, StepStarted/StepFinished events, and
  typed artifact gates.
- Add ImplementationEvidenceArtifact and AuditArtifact schema stubs.
- Add shallow transition-law validation: artifact class, role provenance,
  refs, declared scope.
- Keep object-level validity assigned to auditor role, not orchestrator.

Non-goals:

- No autonomous continuation scheduler.
- No hidden super-auditor behavior.
- No automatic goal completion judgment by the worker.

Dependency:

```text
Worker start V0 and role handoff packet exist.
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

- Mature skill/hook marketplace or installation UI.
- Bridge module runner V0 after execution gates, with explicit authority
  transition and no auto-invocation.
- Cost/pricing pass over direct usage ledger rows using dated pricing snapshots.
- Project-scoped persistent web/session policy for future governed browser
  surfaces.
- Direct-native import/migration strategy for selected app-server transcripts.
