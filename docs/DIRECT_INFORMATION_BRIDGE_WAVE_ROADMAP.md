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

Status: merged.

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

Status: merged.

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

Status: merged.

Branch:

```text
codex/direct-attachment-capability-submit
```

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

Implemented in this slice:

- `direct_attachment_capability_projection@1` advertises governed
  workspace/staged/text-reference support while explicitly not claiming direct
  provider file/image payload support.
- `direct_attachment_submit_packet@1` classifies each composer draft as
  `provider_payload`, `workspace_ref`, `staged_ref`, `text_ref`, or
  `unsupported`.
- Direct fixture and live-text controllers validate packet safety, block
  unsupported drafts, and persist safe disposition summaries plus transcript
  witnesses on the direct turn.
- The Codex renderer sends draft-safe attachment metadata with direct
  `turn/start`, including queued follow-up prompts.
- Regression coverage verifies reference disposition, unsupported blocking,
  no raw path/payload exposure, and no fake provider payload support.

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

Status: merged.

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

Implemented in this slice:

- `direct_role_handoff_packet@1` converts a semantic broker
  `route_to_role` preflight into an explicit handoff packet.
- `direct_role_handoff_preview@1` exposes the renderer-safe role, target
  WorkThread, output artifact family, blockers, and accept/reject posture.
- Packets cite WorkThread, operator broker resolution, WorkTargetResolution,
  semantic preflight, selected AgentClassSpec, context/request refs, authority
  transitions, and evidence refs.
- Non-route or stale/missing inputs produce blocked packets rather than
  fallback execution.
- Authority flags remain closed: no provider call, worker spawn, object-level
  audit, workspace mutation, routing enforcement, or accept/reject transition is
  enabled in this PR.
- Regression coverage verifies valid route-to-role handoff projection,
  non-route blocking, raw-exposure flags, and authority-leak rejection.

Non-goals:

- No automatic worker creation.
- No object-level audit execution.
- No route-to-role provider call in this PR.

Dependency:

```text
Operator broker and controlled routing slice exist.
```

### PR 20: Explicit Worker Start V0

Status: merged.

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

Implemented in this slice:

- `direct_worker_start_transition@1` requires an operator-accepted
  `direct_role_handoff_packet@1` before enabling a worker start.
- `direct_worker_context_packet@1` carries the bounded worker prompt digest,
  handoff refs, context/request refs, WorkThread id, AgentClassSpec id, and
  expected output artifact family.
- `worker/start` creates one direct-native worker session and starts one
  direct live-text worker turn through the existing transport.
- Worker sessions/turns persist `agentKind`, `agentThreadId`, `parentThreadId`,
  `primaryThreadId`, `agentLabel`, `agentRole`, handoff ids, worker-start ids,
  context-packet ids, and worker-graph-alignment ids.
- Direct thread deck rows expose worker lane fields so worker activity remains
  separate from the primary transcript.
- `direct_worker_graph_alignment@1` links the started worker session to the
  WorkThread and selected AgentClassSpec.
- Regression coverage verifies accepted worker start, rejected handoff blocking,
  one provider call only, worker deck separation, graph alignment, and raw
  exposure guards.

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

Status: merged.

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

Implemented in this slice:

- `direct_meta_orchestrator_plan_pointer@1` represents the current plan
  position, expected artifact class, expected producer role, auditor role, and
  branch-law version.
- `direct_meta_orchestrator_step_event@1` records typed step events such as
  implementation step start, evidence submission, audit submission, and
  transition selection.
- `direct_implementation_evidence_artifact@1` captures worker status claims,
  intent-contract refs, changed-file refs, test-evidence refs, declared scope,
  unresolved issues, and worker notes preview without certifying validity.
- `direct_audit_artifact@1` captures auditor verdict class, evidence-validity
  posture, defects, required fixes, residual risks, and advancement
  recommendation as the object-level certification artifact.
- `direct_meta_orchestrator_transition_gate@1` performs only shallow checks:
  artifact class, producer role, step id, presence, shape, provenance, and
  typed transition-law mapping.
- Regression coverage verifies worker evidence routes to auditor, audit verdict
  selects transition, mismatched artifacts block, raw exposure stays false, and
  the meta-orchestrator never performs object-level audit or autonomous
  continuation.

Non-goals:

- No autonomous continuation scheduler.
- No hidden super-auditor behavior.
- No automatic goal completion judgment by the worker.

Dependency:

```text
Worker start V0 and role handoff packet exist.
```

## Wave 4: Real-Provider Implementation Lane And Side-Effect Safety

Status: merged.

Goal:

```text
Prove that the direct path can perform bounded implementation work with a real
provider while preserving the bridge laws already built in Waves 1-3:

target resolution before mutation,
authority transition before tool execution,
tool result evidence before continuation,
workspace effect truth before promotion,
and recovery classification before retry/replay.
```

This wave closes the current highest-confidence gap in the matrix:

```text
Real-provider implementation-lane harness for read/patch/command,
without adding new authority.
```

Wave 4 must remain narrower than the ideal direct harness. It should prove
one lawful implementation lane, not every future workflow.

Standing Wave 4 constraints:

- Use disposable or explicitly selected test workspaces for real-provider proof.
- Keep vanilla app-server path unchanged.
- Do not enable recursive worker spawning.
- Do not let provider tool calls bypass `AuthorityBearingTransition`.
- Do not treat renderer-visible controls as action authority.
- Do not retry after side effects unless recovery state explicitly permits it.
- Do not promote a repair loop unless all tool-result continuations cite prior
  tool evidence.

### PR 22: Direct Read Tool Loop V0

Status: merged.

Purpose:

```text
Prove the first real-provider implementation-lane tool loop with read-only
workspace access.
```

Scope:

- Add a direct read-tool provider loop for selected files/globs already allowed
  by the active WorkThread and authority boundary.
- Convert provider read intent into an `AuthorityBearingTransition`.
- Revalidate WorkThread, workspace root, path containment, stale route state,
  and read scope in main process.
- Emit read request/result evidence rows with source refs, truncation posture,
  and raw-path redaction posture.
- Continue the provider turn with read results through the existing direct
  request/manifest/context-pack path.
- Add disposable-workspace real-provider smoke coverage for:
  read one file, read missing file, read outside workspace blocked, read result
  continuation, and no workspace mutation.

Implemented in this slice:

- `direct:read-tool-loop` deterministic regression covering the existing
  direct read-authority, read-result, continuation-request, and continuation
  context-pack path.
- Fixture workspace proof for one read step, second sequential read step,
  missing-file failure before provider continuation, outside-workspace path
  rejection before execution, and no workspace mutation.
- Registry source-file coverage for the read-loop regression under
  `ic4.read-file-authority`.
- Existing opt-in live proof remains available through:

```sh
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call
```

Non-goals:

- No patch application.
- No command execution.
- No broad filesystem search beyond explicitly scoped read policy.
- No automatic context refresh from arbitrary read results.

Dependency:

```text
AuthorityBearingTransition, controlled routing, WorkTargetResolution, context
pack/request manifest, and real-provider direct text path are green.
```

Promotion criteria:

```text
One real-provider direct turn can request a read, receive governed file content,
continue from the tool result, and finish without mutating the workspace.
```

Current posture:

```text
Fixture/local proof is implemented in this PR.
Real-provider live promotion remains opt-in through the implementation-proof
runner and should be used before raising matrix rows from B-F to B-R.
```

### PR 23: Direct Patch Tool Loop V0

Status: merged.

Purpose:

```text
Prove bounded workspace mutation through patch application, with workspace
effect truth and no command execution.
```

Scope:

- Add a direct patch-tool provider loop that accepts only explicit patch
  proposals under the resolved workspace.
- Convert provider patch intent into an `AuthorityBearingTransition`.
- Revalidate WorkThread, route, file containment, patch size, binary-file
  exclusion, generated/vendor/lockfile posture, and stale base content where
  available.
- Apply patches only through the existing main-process patch path.
- Emit workspace effect rows for changed files, created files, deleted files,
  failed hunks, and skipped paths.
- Continue the provider turn with patch-result evidence.
- Add disposable-workspace fixture coverage for:
  simple edit, create file, blocked outside-workspace patch, failed patch,
  and effect summary rendering.

Implemented in this slice:

- `direct_patch_tool_loop_regression_report@1`.
- End-to-end local provider-loop proof for provider `apply_patch` intent:
  obligation detection, dry-run plan, approval, backend apply, workspace effect
  summary, patch journal inspection, provider-safe result envelope, continuation
  context pack, and request manifest.
- Command-free sentinel coverage for simple edit and create-file patches.
- Blocked outside-workspace and failed-context patches before approval/apply.
- Explicit patch continuation `toolLoop` metadata, with the shared continuation
  recorder preserving explicit loop/step fields for non-read continuations.

Non-goals:

- No shell command execution.
- No automatic revert UI beyond effect evidence.
- No lockfile/vendor/generated policy finalization beyond conservative blocking
  or explicit degraded posture.

Dependency:

```text
Direct read loop is green; workspace mutation truth rows are present enough to
describe patch effects.
```

Promotion criteria:

```text
One real-provider direct turn can propose a patch, the harness can lawfully
apply it, report exact workspace effects, continue from the result, and finish
without hiding failed/skipped mutations.
```

Current posture:

```text
Fixture/local proof is implemented in this PR.
Live-provider promotion remains opt-in through the implementation-proof runner
and should be used before raising matrix rows from B-F to B-R.
```

### PR 24: Direct Command Tool Loop V0

Status: merged.

Purpose:

```text
Prove bounded shell command execution after explicit authority gating, with
safe output capture and continuation.
```

Scope:

- Add a direct command-tool provider loop for commands allowed by the active
  access/sandbox policy.
- Convert provider command intent into an `AuthorityBearingTransition`.
- Revalidate WorkThread, workspace root, command policy, cwd containment,
  environment exposure policy, network posture, timeout, and output caps.
- Emit command started/completed/failed evidence rows with exit status,
  duration, stdout/stderr truncation posture, and workspace-effect uncertainty.
- Continue the provider turn with command-result evidence.
- Add disposable-workspace fixture coverage for:
  safe read-only command, failing command, timeout/degraded command, blocked
  command, and continuation from command output.

Implemented in this slice:

- `direct_command_tool_loop_regression_report@1`.
- End-to-end local provider-loop proof for provider `run_command` intent:
  obligation detection, package-script evidence read, command plan, approval,
  shell-false backend execution, stdout/stderr capture, workspace-effect scan,
  provider-safe result envelope, continuation context pack, and request
  manifest.
- Fixture coverage for safe exit-zero command, nonzero command, workspace
  mutation detection, timeout/degraded command, denied executable, denied
  package-script body, unsafe cwd, and command continuation.
- Explicit command continuation `toolLoop` metadata, with continuation shape
  fields carried into context/request manifest construction.

Non-goals:

- No long-running background process manager.
- No network-enabled command policy unless separately evidenced.
- No command-driven auto-approval expansion.
- No treating command output as workspace mutation truth unless separately
  observed.

Dependency:

```text
Direct read loop and patch loop are green; access/sandbox policy projection is
available to the direct controller.
```

Promotion criteria:

```text
One real-provider direct turn can request a bounded command, receive governed
output, continue from the result, and preserve command authority/evidence
without renderer-side execution.
```

Current posture:

```text
Fixture/local proof is implemented in this PR.
Live-provider promotion remains opt-in through the implementation-proof runner
and should be used before raising matrix rows from B-F to B-R.
```

### PR 25: Direct Tool Continuation And Iterative Repair Loop V0

Status: merged.

Purpose:

```text
Prove a small read -> patch -> command -> repair sequence without introducing
autonomous orchestration or hidden retry authority.
```

Scope:

- Add direct continuation ledger links between provider tool call, local tool
  execution, tool result, next provider request, and final assistant message.
- Permit a bounded multi-step implementation turn only when each step cites the
  previous result evidence.
- Add repair-loop state for `needs_more_read`, `patch_failed`,
  `command_failed`, `tests_failed`, `finalized`, and `blocked`.
- Ensure retry policy distinguishes pre-side-effect retry from post-side-effect
  continuation.
- Add disposable-workspace real-provider smoke coverage for:
  read then patch, patch then test command, failing test then repair patch, and
  blocked repair after policy limit.

Implemented in this slice:

- `direct_tool_continuation_repair_loop_regression_report@1`.
- Disposable-workspace fixture proof for a bounded
  `read_file -> apply_patch -> run_command -> apply_patch -> run_command`
  repair sequence.
- Explicit continuation request evidence after every local tool result,
  including context pack and request manifest references.
- Command-result continuations can opt in to bounded repair tool declarations
  when the original user intent is an implementation task; default command
  continuations remain terminal/no-tools.
- Sentinel checks for no hidden retry authority: each patch and command executes
  exactly once, all continuation IDs are unique, and final assistant completion
  occurs only after the passing command evidence exists.

Non-goals:

- No meta-orchestrator autonomous advancement.
- No worker/auditor certification loop.
- No recursive task decomposition.
- No silent retries after side effects.

Dependency:

```text
Read, patch, and command loops are individually green.
```

Promotion criteria:

```text
A bounded real-provider direct implementation turn can complete a small
repair cycle while every continuation cites exact prior tool-result evidence.
```

Current posture:

```text
Fixture/local proof is implemented in this PR.
Live-provider promotion remains opt-in through the implementation-proof runner
and should be used before raising matrix rows from B-F to B-R.
```

### PR 26: Side-Effect Recovery And Replay Safety

Status: merged.

Purpose:

```text
Make crash/restart and connection-loss states explicit for implementation-lane
turns that have tool calls, patches, commands, or partial continuations.
```

Scope:

- Extend recovery scanner for direct tool-call lifecycles:
  `intent_observed`, `authority_pending`, `execution_started`,
  `execution_completed`, `result_sent`, `continuation_started`,
  `terminal_observed`, and `handoff_unknown`.
- Classify interrupted turns as healthy, resumable, needs operator review,
  sent-unknown, side-effect-unknown, or corrupt.
- Prevent replay of patch/command side effects unless a recovery row proves
  replay is safe.
- Add recovery UI/status projection for implementation-lane interrupted turns.
- Add crash/restart regression fixtures for:
  before execution, during execution, after patch before result sent, after
  command result sent before continuation, and corrupt ledger.

Implemented in this slice:

- Recovery classifications now expose `operationLifecycleStage`,
  `interruptedTurnClass`, and a renderer-safe `replaySafety` block.
- Lifecycle stages cover `intent_observed`, `authority_pending`,
  `execution_started`, `execution_completed`, `result_sent`,
  `continuation_started`, `terminal_observed`, `handoff_unknown`, and
  `corrupt`.
- Interrupted turns are classified as `healthy`, `resumable`,
  `needs_operator_review`, `sent_unknown`, `side_effect_unknown`, or
  `corrupt`.
- Recovery status projection is renderer-safe and explicitly non-authoritative.
- Regression fixtures cover before execution, during patch/command execution,
  after patch apply before result handoff, after command result before
  continuation send, provider handoff unknown, stream interruption, and corrupt
  operation ledger.
- Replay safety remains conservative: provider retry, tool re-execution, and
  continuation replay are never automatic in this slice.

Non-goals:

- No automatic revert.
- No automatic replay of side-effecting operations.
- No provider-side continuity assumption without explicit continuation proof.

Dependency:

```text
Read/patch/command result rows and continuation links exist.
```

Promotion criteria:

```text
An interrupted implementation-lane turn is never shown as cleanly idle or
silently retried when side-effect state is unknown.
```

Current posture:

```text
Fixture/local recovery classification proof is implemented in this PR.
Manual resume/replay actions remain disabled and require a later authority
transition before any side-effecting operation can be retried or replayed.
```

### PR 27: Workspace Authority Maturity V0

Status: merged.

Purpose:

```text
Harden workspace mutation policy enough for daily direct-path implementation
testing without pretending it is final production governance.
```

Scope:

- Add explicit policy rows for generated files, vendor paths, lockfiles,
  binary files, large files, symlinks, ignored paths, and external worktrees.
- Add workspace effect summary projection that separates:
  direct patch effects, command-observed effects, untracked changes, and
  pre-existing dirty state.
- Add optional revert-plan preview for direct patch effects where safe.
- Keep revert execution disabled unless a later PR grants it.
- Add fixtures for:
  dirty worktree preservation, symlink escape blocking, generated/vendor
  degraded posture, lockfile explicit policy, and untracked file classification.

Implemented in this slice:

- Workspace mutation policy snapshots now include explicit policy rows for
  generated, vendor, lockfile, binary, large, symlink, ignored, and external
  worktree path classes.
- Workspace effect summaries now include a renderer-safe class projection that
  separates direct patch effects, command-observed effects, untracked changes,
  and pre-existing dirty state.
- Patch effect summaries include a revert-plan preview when before/after
  evidence is complete, but revert execution remains disabled.
- Path classification now handles symlink escapes, symlink files, ignored
  paths, binary files, large files, and external worktree boundaries.
- Regression fixtures cover dirty prestate preservation, symlink escape
  blocking, ignored-path degradation, binary/large-file policy, external
  worktree blocking, generated/vendor/lockfile policy, and untracked change
  classification.

Non-goals:

- No automatic revert execution.
- No destructive cleanup.
- No broad VCS policy replacement.

Dependency:

```text
Patch and command loops emit workspace effect evidence.
```

Promotion criteria:

```text
The direct implementation lane can state what changed, what may have changed,
what was already dirty, and what policy blocked, without conflating those
classes.
```

Current posture:

```text
Fixture/local workspace authority maturity proof is implemented in this PR.
Revert preview is display-only; revert execution and broad VCS policy remain
future authority transitions.
```

Wave 4 expected result:

```text
Implemented:
  direct read tool loop
  direct patch tool loop
  direct command tool loop
  bounded tool-result continuation / repair cycle
  side-effect recovery classifications
  workspace authority maturity V0

Still intentionally not authority:
  autonomous scheduler
  recursive worker spawning
  mature auditor certification loop
  automatic revert execution
  broad generated/vendor/lockfile policy finalization
  provider compaction execution
  skill/hook/connector execution runner
  direct path replacement of the vanilla app-server lane
```

## Wave 5: Live Promotion And Operator Usability Gate

Status: merged.

Branches: PR 28 through PR 32 feature branches.

Review posture after Wave 4:

```text
The direct branch now has fixture/local proof for the implementation lane:
read, patch, command, tool-result continuation, bounded repair, recovery
classification, and workspace mutation truth.

The remaining confidence gap is no longer "can we model the lane?".
It is "can we promote the lane under live provider evidence and make it safe
enough for deliberate operator testing?".
```

Standing Wave 5 constraints:

- Keep app-server as the retained vanilla lane.
- Do not enable automatic approval, automatic replay, automatic revert, or
  recursive worker spawning.
- Treat live provider proof as opt-in and disposable-workspace scoped.
- Renderer/UI status is projection, not authority.
- Any provider/tool action must still pass the existing authority-bearing
  transition envelope.
- Do not make context maintenance, governance, or sub-agent control mutate state
  without an explicit gate and fixture proof.

### PR 28: Live Implementation-Lane Promotion Harness

Status: merged.

Purpose:

```text
Turn the existing live implementation-proof runner into an explicit promotion
artifact for provider-originated read/patch/command/tool-result cycles.
```

Scope:

- Define the live promotion report shape over
  `direct:implementation-proof -- --mode=live --allow-live-provider-call`.
- Grade outcomes separately:
  provider emitted expected tool calls, provider did not emit tool calls,
  local authority blocked, continuation failed, terminal assistant completed.
- Require disposable workspace identity, no app-server fallback, no right-pane
  mutation, no raw exposure, and no non-target workspace mutation.
- Keep live proof opt-in; normal validation must not call the provider.
- Add a compact matrix promotion summary that can move selected rows from
  fixture-only to live-proved when evidence exists.

Implemented slice:

- `direct:implementation-proof` now emits an embedded
  `direct_implementation_lane_live_promotion_report@1` artifact.
- The runner also writes sidecar JSON and Markdown promotion reports:
  `implementation-promotion-report.json` and
  `implementation-promotion-report.md`.
- Promotion rows classify provider tool emission, local authority execution,
  continuation completion, terminal assistant evidence, and typed
  non-promotion reasons per scenario.
- Preflight remains provider-free and produces `not_evaluated` promotion
  state rather than pretending fixture evidence is live evidence.
- The report includes an explicit authority boundary: no app-server fallback,
  no right-pane mutation, no handoff mutation, no auto-approval, no automatic
  replay, and no automatic revert.
- The bridge information registry now includes the promotion report as a
  canonical evidence artifact.

Promotion criterion:

```text
A live provider-originated implementation-lane turn can complete a bounded
read/patch/command flow in a disposable workspace, or produce a typed
non-promotion reason without weakening fixture proof.
```

### PR 29: Direct Implementation-Lane UI Readiness

Status: merged.

Branch: `codex/direct-implementation-ui-readiness-v0`.

Purpose:

```text
Make the direct implementation lane manually testable from the shell without
burying authority state in logs.
```

Scope:

- Surface direct implementation-lane status, current operation history,
  approval cards, continuation state, recovery posture, and workspace effect
  summaries in renderer-safe UI projections.
- Add Electron regression coverage for a direct read approval flow and operation
  history projection.
- Keep the runtime switch explicit and keep the app-server lane available.
- Do not add new tool scope, auto-approval, or automatic recovery action.

Implemented slice:

- The shell overview now includes a read-only Direct implementation-lane
  readiness card.
- The card renders the existing `direct_implementation_lane_ui_status@1`,
  `direct_operation_history_projection@1`, and
  `direct_policy_readonly_view@1` IPC projections instead of deriving authority
  from raw runtime labels.
- It shows lane state, approval/continuation facets, active-turn/composer state,
  recovery posture, latest tool-result/workspace-effect summary, and recent
  operation-history rows.
- The card exposes only a refresh action; it does not approve, replay, recover,
  mutate workspace files, call the provider, mutate the right pane, or perform
  handoff operations.
- The UI projection fixture now asserts approval-card readiness, active-turn
  composer state, latest tool-result status, provider-visibility posture, and
  read-only actionability.
- The bridge information registry now includes implementation-lane UI readiness
  as an observability artifact.

Promotion criterion:

```text
An operator can tell whether the direct lane is idle, awaiting approval,
executing, recovering, blocked, or terminal without reading raw ledgers.
```

### PR 30: Context Maintenance Execution Gate V0

Status: merged.

Purpose:

```text
Convert existing context/memory/baton/compaction proposals into guarded,
operator-visible transitions without automatic provider compaction.
```

Scope:

- Add context maintenance execution packets for manual memory refresh, baton
  update, omission witness acknowledgement, and context-loss remediation.
- Keep provider compaction disabled unless later evidence explicitly grants it.
- Make every context mutation cite work thread, source artifact, retention law,
  omission risk, and rollback/undo posture.
- Add fixtures for accepted maintenance, rejected stale proposal, raw-exposure
  block, and baton reinjection preview.

Implemented slice:

- `direct_context_maintenance_execution_packet@1` and
  `direct_context_maintenance_execution_result@1`.
- Local-only execution results for accepted memory refresh materialization,
  frontier baton update, omission witness acknowledgement, and remediation
  preview.
- Stale source/generation and raw-exposure blockers.
- Regression coverage in `direct:context-maintenance-execution-gate`.
- Provider compaction, provider transport, app-server fallback, automatic
  scheduling, workspace mutation, and raw text exposure remain blocked.

Promotion criterion:

```text
The harness can update its local context-management artifacts through explicit
operator-gated transitions instead of treating maintenance proposals as inert
diagnostics.
```

### PR 31: Governance Enforcement And Clarification V0

Status: merged.

Purpose:

```text
Promote selected broker/governance checks from shadow reports to guarded
preconditions for mutation/provider transitions.
```

Scope:

- Enforce work-target resolution before workspace mutation.
- Block provider/tool transitions when target confidence is too low or authority
  boundary is missing.
- Add a clarification packet for ambiguous requests rather than silently
  collapsing to chat recency.
- Keep enforcement narrow; do not make the broker an object-level auditor.
- Add fixtures for clear target, ambiguous target, wrong-branch target,
  missing authority boundary, and non-target preservation.

Implemented slice:

- `direct_governance_enforcement_preflight@1` as a fail-closed precondition
  artifact for provider calls, tool transitions, and workspace mutations.
- `direct_governance_clarification_packet@1` for unresolved or ambiguous work
  target routing instead of silently collapsing to chat recency.
- Branch mismatch, missing authority boundary, operator-broker mismatch,
  unresolved target, low-confidence target, and stale/ambiguous route blockers.
- Regression coverage in `direct:governance-enforcement`.
- The broker still does not perform object-level audit, worker tasks, broad
  execution authority, autonomous routing, or hidden mutation.

Promotion criterion:

```text
No direct mutation or tool-provider transition proceeds when the active work
thread is unresolved or authority evidence is missing.
```

### PR 32: Sub-Agent Inspect/Wait Containment V0

Status: merged.

Purpose:

```text
Give the direct path a minimal, contained sub-agent inspection model without
recursive autonomous choreography.
```

Scope:

- Add inspect/wait/read-only status packets for direct worker/sub-agent refs.
- Keep recursive spawn, close, resume, and autonomous schedule disabled.
- Ensure child transcript/status projections never render as the operator or as
  primary-agent final answers.
- Add deadlock/stale-worker diagnostics and attention badges.
- Add fixtures for one worker, multiple workers, stale worker, failed worker,
  and unknown child identity.

Implemented slice:

- `direct_sub_agent_inspect_packet@1` for read-only direct worker/sub-agent
  inspection.
- `direct_sub_agent_wait_status_packet@1` for read-only wait status without
  invoking provider wait tools.
- `direct_sub_agent_contained_tab_projection@1` for a contained right-pane style
  sub-agent tab projection with attention badges.
- Stale, failed, deadlock-risk, unknown-identity, model, and reasoning-effort
  witnesses.
- Regression coverage in `direct:sub-agent-inspect-wait`.
- Recursive spawn, send input, resume, close, autonomous scheduling, provider
  transport, workspace mutation, and child-output promotion remain disabled.

Promotion criterion:

```text
The operator can inspect direct worker state and wait/read status without
granting recursive multi-agent control authority.
```

Wave 5 expected result:

```text
Implemented:
  live implementation-lane promotion report
  direct implementation-lane UI readiness
  guarded context maintenance transitions
  narrow broker/governance enforcement
  contained sub-agent inspect/wait projection

Still intentionally not authority:
  automatic approval
  automatic replay/revert
  recursive worker orchestration
  provider compaction execution
  broad browser/network/MCP tool execution
  direct path replacement of the vanilla app-server lane
```

## Wave 6: Operator Control Loop And WorkThread Productization

Status: merged.

Review posture after Wave 5:

```text
The direct branch now has a lawful implementation-lane substrate, visible
readiness state, guarded context-maintenance transitions, narrow governance
preflight enforcement, and contained sub-agent inspect/wait projections.

The remaining confidence gap is no longer artifact shape. It is operator
control: selecting the right WorkThread, seeing the exact context/authority
packet before a turn, resolving ambiguity, and advancing bounded work without
collapsing into autonomous orchestration.
```

Standing Wave 6 constraints:

- Keep app-server as the retained vanilla lane.
- Do not enable recursive worker spawning or autonomous scheduling.
- Do not enable provider compaction, module execution, broad browser/network
  tools, or automatic replay/revert.
- Every operator action must cite WorkThread identity, authority posture, and
  source evidence.
- Clarification resolves routing; it does not perform object-level work.
- Context/memory/module surfaces are projections and gated transitions, not
  hidden policy.

### PR 33: WorkThread Control Deck And Current Pointer UX

Status: implemented in PR 33.

Purpose:

```text
Make WorkThread the visible control-plane unit for direct work, not repo,
folder, provider session, or chat recency.
```

Scope:

- Add a WorkThread control deck projection over active, stale, blocked,
  recoverable, and archived work threads.
- Expose current pointers: active WorkThread, active direct session, selected
  provider lane, last context pack, last authority transition, and last
  controlled route.
- Add an explicit operator selection transition for setting the active
  WorkThread pointer.
- Add stale/mismatch diagnostics when provider thread, project, branch, or
  workspace identity no longer match the selected work thread.
- Keep selection from starting a provider turn or mutating workspace state.

Implemented slice:

- Added `direct_work_thread_current_pointer@1`,
  `direct_work_thread_control_deck@1`, and
  `direct_work_thread_selection_transition@1`.
- Added fail-closed pointer states for selected, missing, stale, mismatch, and
  unknown WorkThread posture.
- Added stale/mismatch blockers for project, branch, workspace, provider lane,
  selected digest, stale lifecycle, archived lifecycle, missing pointer, and
  not-found selected thread.
- Added direct settings surface rows for the active WorkThread pointer, selected
  provider lane, direct session, provider thread, blocker summary, preservation
  constraints, and authority posture.
- Added `direct:workthread-control-deck` regression coverage proving no provider
  call, workspace mutation, worker spawn, or app-server replacement authority is
  granted by selection.

Promotion criterion:

```text
The operator can select and inspect the active work-world identity before any
direct provider/tool transition is allowed to proceed.
```

### PR 34: Clarification And Target Picker UX

Status: implemented in PR 34.

Purpose:

```text
Turn governance clarification packets into an operator-facing resolution loop
instead of a blocked diagnostic artifact.
```

Scope:

- Render `direct_governance_clarification_packet@1` and
  `operator_broker_resolution@1` candidates in a target picker.
- Let the operator choose a candidate, reject all candidates, or keep the turn
  blocked.
- Persist the clarification answer as routing evidence for the next controlled
  route.
- Preserve non-target workspaces and threads in the resulting route packet.
- Keep the picker from executing provider calls, tools, worker starts, or
  object-level audit.

Implemented slice:

- Added `direct_clarification_target_picker@1` and
  `direct_clarification_target_answer@1`.
- Target picker consumes `direct_governance_clarification_packet@1`,
  `operator_broker_resolution@1`, and WorkTarget candidate rows.
- Operator answers support choose candidate, reject all, and keep blocked.
- Stale, archived, missing-id, and cross-project candidates are blocked or
  degraded before they can become accepted route evidence.
- Settings surface exposes picker state, candidate counts, answer availability,
  blockers, preservation posture, and authority posture.
- Added `direct:clarification-target-picker` regression proving answers grant no
  provider call, workspace mutation, tool transition, worker spawn, object audit,
  or app-server replacement authority.

Promotion criterion:

```text
Ambiguous user intent can be resolved by an explicit operator routing artifact,
not chat recency or silent default selection.
```

### PR 35: Context Packet Preview And Omission Workbench

Status: implemented in PR 35.

Purpose:

```text
Make the next direct turn's information bridge visible before it becomes model
context.
```

Scope:

- Add a renderer-safe context packet preview over recent dialogue, durable
  memory, frontier baton, attachments, module context contributions, tool
  result refs, and omitted spans.
- Show source classes, token/size pressure, retention law, stale refs, and
  omission witnesses.
- Add a "blocked from request" posture when required source artifacts are
  missing, stale, or raw-exposure unsafe.
- Keep preview editing disabled except for explicit future transition packets.

Promotion criterion:

```text
The operator can inspect what information will be sent, what is omitted, and
why, before a direct request is assembled.
```

Implemented slice:

- Added `direct_context_packet_preview@1` and renderer-safe source rows for
  recent dialogue, durable memory, frontier baton, attachments, module context,
  tool result refs, omission witnesses, and harness policy rows.
- Added preview totals for source classes, included/omitted rows, token/size
  estimates, stale/missing/raw-exposure counts, and request blockers.
- Added `blocked_from_request` posture for required missing/stale sources,
  raw-exposure unsafe rows, and missing required omission witnesses.
- Surfaced the preview in the direct settings/status projection as display-only
  and registered it as `ic3.context-packet-preview-workbench`.
- Kept request assembly, provider transport, preview editing, memory mutation,
  provider compaction, and workspace mutation authority disabled.

### PR 36: Memory Review Materialization UI V0

Status: implemented in PR 36.

Purpose:

```text
Connect memory review/refresh/reset proposals to visible operator actions
without making memory hidden policy.
```

Scope:

- Render memory review packets, refresh proposals, stale/conflict rows, reset
  policy, and context-loss links in the settings/control plane.
- Let the operator accept or reject local memory refresh materialization through
  the existing guarded execution gate.
- Show post-transition witnesses, rollback posture, and omission impact.
- Keep provider memory claims, provider compaction, and automatic refresh
  disabled.

Promotion criterion:

```text
Durable memory can be reviewed and locally materialized only through explicit
operator-gated evidence transitions.
```

Implemented slice:

- Added `direct_memory_review_workbench@1` and renderer-safe workbench rows for
  memory review packets, refresh proposals, reset policy/confirmation,
  execution-gate transitions, context-loss links, omission impact, and rollback
  posture.
- Surfaced accepted/rejected refresh posture, local materialization witnesses,
  stale/conflict counts, reset visibility, omission impact, and rollback
  posture in the direct settings/status projection.
- Registered the artifact as `ic3.memory-review-workbench`.
- Kept memory mutation, reset execution, provider memory claims, provider
  compaction, automatic refresh, provider transport, and workspace mutation
  disabled.

### PR 37: Module Context Contribution Intake V0

Status: implemented in PR 37.

Purpose:

```text
Let skills/hooks/apps contribute context or imported evidence through the bridge
without granting execution authority.
```

Scope:

- Add a module contribution intake view for context-only skill output and
  connector/imported evidence rows.
- Require module source, scope, raw-exposure scan, and WorkThread binding.
- Let accepted context contributions appear in the context packet preview from
  PR 35.
- Keep hook execution, connector mutations, auto-invocation, and workspace
  writes disabled.

Promotion criterion:

```text
Bridge modules can add bounded information to a WorkThread context packet
without becoming tools or hidden authority.
```

Implemented slice:

- Added `direct_module_context_intake@1` and intake rows for context-only skill
  output, imported connector evidence, and blocked diagnostics.
- Required module source, source scope, WorkThread binding, raw-exposure scan,
  and disabled-authority checks before rows can become context eligible.
- Fed accepted intake rows into the PR 35 context packet preview as
  `module_context` source rows.
- Surfaced intake counts, imported evidence, accepted preview rows, blocked/raw
  posture, and authority state in the direct settings/status projection.
- Registered the artifact as `ic14.module-context-intake`.
- Kept context-packet mutation, connector mutation, hook execution,
  auto-invocation, workspace mutation, provider transport, and module execution
  disabled.

### PR 38: Direct Manual Smoke Gate And Regression Checklist

Status: implemented in PR 38.

Purpose:

```text
Package the merged direct path into a repeatable manual/electron smoke gate for
operator usability before enabling deeper authority.
```

Scope:

- Add a direct manual-smoke checklist artifact covering lane selection,
  WorkThread selection, context preview, direct text turn, read/patch/command
  readiness, recovery posture, sub-agent inspect, and app-server fallback.
- Add an optional electron smoke runner that validates projection availability
  without live provider calls.
- Record blockers as readiness evidence, not test silence.
- Keep the checklist from promoting direct as production or replacing
  app-server.

Promotion criterion:

```text
The direct branch has a stable operator test path that can be run before each
new authority-bearing wave.
```

Implemented slice:

- Added `direct_manual_smoke_gate@1` and `direct_manual_smoke_check_row@1` as
  readiness artifacts over existing direct projections.
- Covered lane selection, app-server fallback, WorkThread selection, target
  clarification, context preview, memory review, module context intake, direct
  text turn, read/patch/command readiness, recovery posture, sub-agent inspect,
  usage readiness, and optional Electron projection availability.
- Recorded blockers as explicit readiness evidence instead of silent test
  failures.
- Surfaced manual smoke gate status in the direct settings/status projection.
- Registered the artifact as `ic21.direct-manual-smoke-gate`.
- Kept live provider calls, app-server spawn/replacement, runtime path mutation,
  WorkThread mutation, workspace mutation, auto-approval, module execution,
  recursive worker execution, and matrix promotion disabled.

Wave 6 expected result:

```text
Implemented:
  WorkThread control deck and current pointers
  operator clarification / target picker
  context packet preview with omission workbench
  memory review materialization UI
  module context/evidence intake
  direct manual smoke gate

Still intentionally not authority:
  autonomous scheduler
  recursive worker orchestration
  broad module/tool execution
  provider compaction execution
  automatic memory mutation
  automatic replay/revert
  direct path replacement of the vanilla app-server lane
```

## Wave 7: Mainline Hardening And Direct Usability Promotion

Status: implemented in PR 42.

Review posture after Wave 6:

```text
The direct branch now has the core operator-control artifacts: WorkThread
selection, target clarification, context preview, memory review, module context
intake, and a manual smoke gate. The next gap is not another authority artifact.
It is proving that these artifacts are reachable, legible, and recoverable in
the actual Electron operator path while app-server remains the safe fallback.
```

Standing Wave 7 constraints:

- Keep app-server as the retained vanilla lane.
- Do not enable autonomous scheduling, recursive worker orchestration, module
  execution, provider compaction, broad browser/network/MCP tools, or automatic
  replay/revert.
- Treat Electron/UI proof as projection proof, not provider capability
  promotion.
- Keep direct controls behind explicit experimental/readiness posture.
- Any live-provider promotion candidate must cite prior fixture/local proof,
  manual smoke readiness, and a bounded operator opt-in.

### PR 39: Manual Smoke Gate Settings/Control Surface V0

Status: implemented in PR 39.

Purpose:

```text
Make the PR 38 manual smoke gate visible in the operator's actual Electron
direct settings/control surface.
```

Scope:

- Render the `manualSmokeGate` row group already emitted by
  `direct_settings_surface_projection@1`.
- Show gate state, passed/warning/blocked/not-checked counts, required blockers,
  source/evidence labels, and promotion/authority posture.
- Add stale/missing projection handling for project switches and refresh races.
- Keep the surface display-only: no provider call, app-server restart, runtime
  mutation, WorkThread mutation, module execution, workspace mutation,
  auto-approval, recursive worker, or matrix promotion.

Promotion criterion:

```text
The operator can see whether the direct branch is smoke-ready from inside the
app, without reading raw ledgers or running headless scripts.
```

Implemented slice:

- Added a dedicated `Manual smoke gate` panel to the Project tab direct bridge
  settings/control surface.
- Rendered the existing `rows.manualSmokeGate` projection from
  `direct_settings_surface_projection@1`.
- Updated the bridge settings badge and evidence text to summarize smoke state,
  required blockers, warnings, not-checked rows, blocker codes, and authority
  posture.
- Added stale/missing projection fallback copy when the smoke gate is not
  exposed.
- Added static renderer/projection regression coverage proving the panel exists,
  the renderer binds it, rows are rendered, and the display-only authority
  boundary remains visible.
- Kept provider calls, app-server mutation, runtime mutation, WorkThread
  mutation, module execution, workspace mutation, auto-approval, recursive
  worker execution, and matrix promotion disabled.

### PR 40: Electron Smoke Runner And Readiness Proof Pack

Status: implemented in PR 40.

Purpose:

```text
Turn the manual smoke gate from a fixture-only artifact into a repeatable
Electron projection proof.
```

Scope:

- Add a bounded Electron smoke script that opens a project, loads the direct
  settings/control surface, refreshes bridge status, verifies visible runtime
  lane/app-server fallback/WorkThread/context/memory/module/manual-smoke rows,
  and exits without provider calls.
- Emit an `electron_projection` smoke result that can be passed into
  `direct_manual_smoke_gate@1`.
- Keep live provider turns, app-server spawn/replacement, module execution,
  workspace mutation, and direct promotion disabled.

Promotion criterion:

```text
Direct readiness has a reproducible app-level projection check, not only unit
fixtures.
```

Implemented slice:

- Added `scripts/direct-electron-settings-smoke-regression.mjs`, a bounded
  Playwright/Electron smoke runner that opens a fixture project, reaches the
  Project tab direct settings/control surface, refreshes bridge status, and
  verifies visible runtime, WorkThread, module, continuity, and manual-smoke
  rows.
- Emits `direct_electron_settings_smoke_report@1` with a sanitized projection
  summary, measured process/projection sentinels, raw-exposure scan, and no raw
  workspace/home path report fields.
- Feeds an `electron_projection` evidence row into
  `direct_manual_smoke_gate@1` and verifies the gate remains display-only.
- Added `direct:electron-settings-smoke` regression coverage.
- Kept provider transport, live turns, app-server spawn/replacement, runtime
  mutation, WorkThread mutation, module execution, workspace mutation,
  auto-approval, recursive worker execution, and matrix promotion disabled.

### PR 41: Direct Runtime And Settings Simplification

Status: implemented in PR 41.

Purpose:

```text
Make direct usable without forcing the operator to parse diagnostic walls during
normal work.
```

Scope:

- Keep a small visible runtime lane switch/status witness in the Codex plane.
- Move broad direct diagnostics into the settings/control surface.
- Preserve app-server fallback visibility and make unavailable/direct-blocked
  states explicit.
- Persist only safe operator preferences; do not mutate production direct mode
  or provider defaults.

Promotion criterion:

```text
Direct can be selected, inspected, and backed out of without losing the vanilla
app-server lane or exposing hidden authority.
```

Implemented slice:

- Added a compact Codex-plane runtime path witness and selector for App Server,
  Direct Text, and Direct Tools.
- Reused the existing guarded `direct-runtime:set-path` transition; the compact
  selector grants no separate runtime mutation authority.
- Moved broad Direct implementation-lane and Direct diagnostics cards out of the
  normal Overview flow into the Project settings/control surface.
- Kept Direct auth and small runtime/context witnesses visible while preserving
  explicit unavailable/degraded labels.
- Extended `direct:electron-settings-smoke` to prove the compact controls and
  Project settings surface are both reachable in Electron.

### PR 42: WorkThread Thread Deck And New-Thread Operator UX

Status: implemented in branch `codex/direct-sub-agent-e-channel-governance`.

Purpose:

```text
Expose work-world thread identity as the operator-facing unit, not just a
diagnostic registry row.
```

Scope:

- Add a direct WorkThread/thread deck view for active, stale, blocked,
  recoverable, archived, and candidate work threads.
- Add a guarded new-thread draft transition that creates local direct thread
  evidence only after WorkThread identity and context posture are explicit.
- Keep Codex provider thread ids as runtime identities, not the control-plane
  source of work truth.

Promotion criterion:

```text
The operator can choose or draft the active direct work thread from a bounded
control surface before any direct turn starts.
```

Implemented:

- Added renderer-safe WorkThread operator deck rows for active, stale, blocked,
  recoverable, archived, and candidate WorkThreads in the direct thread
  workbench.
- Added a guarded local new-thread draft transition that blocks missing
  WorkThread identity/context posture and creates only local direct session
  evidence when accepted.
- Kept runtime/provider thread ids visible as secondary runtime identities and
  preserved the no provider-turn / no app-server-fallback / no worker-spawn
  authority boundary.

### PR 43: Live Promotion Candidate Queue And Evidence Gate

Status: implemented.

Purpose:

```text
Convert selected fixture/local-green capabilities into explicit opt-in live
promotion candidates.
```

Scope:

- List candidate rows for direct text, read, patch, command, repair, recovery,
  usage, and UI readiness with required evidence refs.
- Require manual smoke readiness and bounded operator opt-in before any live
  promotion run.
- Record skipped, blocked, failed, and passed promotion attempts as evidence.
- Keep promotion reports from changing defaults or matrix rows automatically.

Promotion criterion:

```text
Live-provider proof becomes a governed queue, not ad hoc manual testing or
silent status inflation.
```

Implemented notes:

- Added `direct_live_promotion_candidate_queue@1` as a renderer-safe
  display-only queue for direct text, read, patch, command, repair, recovery,
  usage, and UI readiness promotion candidates.
- Each candidate cites fixture/local evidence, required live evidence,
  blockers, latest attempt status, and the next manual smoke class without
  exposing a renderer-runner transition.
- Added report-only attempt rows for skipped, blocked, failed, and passed
  promotion attempts.
- Confirmed promotion queue reports do not mutate defaults, matrix rows,
  runtime selection, app-server fallback, recursive workers, provider
  transport, or workspace mutation authority.

### PR 44: App-Server Fallback Parity Watchdog

Status: implemented.

Purpose:

```text
Ensure direct usability work never erodes the retained vanilla app-server path.
```

Scope:

- Add a renderer-safe fallback parity report over app-server availability,
  selected lane, startup/failure posture, reload/reconnect posture, and direct
  fallback blockers.
- Include app-server fallback status in manual/Electron smoke outputs.
- Add regression cases proving direct-path failures do not silently reroute,
  mutate, or hide app-server fallback state.

Promotion criterion:

```text
Direct failures remain visible as direct failures, while the retained vanilla
app-server lane remains visible and recoverable as a separate fallback posture.
```

Implemented notes:

- Added `direct_appserver_fallback_parity_report@1` as a renderer-safe
  display-only report over app-server fallback availability, selected lane,
  startup/failure posture, reload/reconnect posture, and direct blockers.
- Wired the parity report into runtime status, the Project-tab settings
  surface, manual smoke gate rows, and Electron settings smoke validation.
- Added regression cases proving missing fallback, stale/reroute flags, and
  visible fallback state are explicit evidence states.
- Confirmed fallback reports do not mutate runtime selection, defaults, matrix
  rows, app-server processes, provider transport, recursive workers, or
  workspace state.

### PR 45: Usage/Quota/Model Witness Polish

Status: implemented.

Purpose:

```text
Tighten the runtime witnesses needed before broader direct-path promotion.
```

Scope:

- Align model, reasoning, quota/rate, usage, and drift witnesses with the direct
  settings/control surface and manual smoke gate.
- Preserve unknown/unavailable/stale states instead of inventing defaults.
- Keep cost as a later derived pricing pass, not capture-time runtime truth.

Promotion criterion:

```text
Direct readiness can explain model/quota/usage posture without creating billing
or provider-authority claims.
```

Implemented notes:

- Added a dedicated runtime witness section to the direct settings/control
  projection for model, reasoning, quota/rate, usage, and drift posture.
- Reused `direct_runtime_witness_projection@1` and kept unknown/unavailable
  states explicit instead of deriving provider defaults.
- Wired runtime witnesses into the manual smoke gate as a visibility check.
  Unknown quota/drift produce warning evidence, not authority promotion.
- Added Electron/settings regression coverage proving runtime witness rows are
  visible and display-only.
- Confirmed witness display does not grant provider transport, quota read,
  model mutation, cost computation, workspace mutation, or matrix promotion.

Wave 7 expected result:

```text
Implemented:
  visible manual smoke gate in Electron settings/control
  app-level Electron projection smoke runner
  simplified direct runtime/settings operator path
  WorkThread/thread deck operator UX
  governed live-promotion candidate queue
  app-server fallback parity watchdog
  polished usage/quota/model witnesses

Still intentionally not authority:
  direct as production/default
  automatic approval
  recursive worker orchestration
  provider compaction execution
  automatic memory mutation
  automatic replay/revert
  broad module/tool execution
```

## Wave 8: Direct Provider Metadata Truth, Analytics Facts, And Drift Validation

Status: in progress.

Review posture after Wave 7:

```text
The direct path can now be selected and smoke-tested from the Electron UX, and it
has visible runtime witnesses. The remaining usability gap is that several
runtime-facing chips and menus still depend on partial/static projections:
model catalog, reasoning choices, service tiers, quota windows, account token
profile, and context pressure. These must become read-only provider metadata
truth before direct can feel like a normal daily lane.
```

Standing Wave 8 constraints:

- Read-only provider metadata probes only.
- No provider turns are started by metadata validation.
- No tool execution, workspace mutation, approval mutation, worker spawning,
  recursive orchestration, cost computation, or matrix promotion.
- Startup validation must be cheap, bounded, TTL/ETag aware, and non-blocking
  unless direct cannot safely initialize.
- Unknown/new fields are drift evidence, not crashes.
- Raw tokens, raw account ids, emails, request payloads, provider payloads, and
  full local paths remain main-process/private evidence.

### PR 46: Direct Metadata Adapter And Startup Drift Sentinel

Status: implemented in branch `codex/direct-bridge-system-epistemic-classes`.

Purpose:

```text
Fetch direct provider metadata through a single robust adapter, validate it at
startup, and project model/settings/quota/context witnesses from live evidence
instead of static assumptions.
```

Scope:

- Add a `DirectServerMetadataAdapter` that performs read-only direct metadata
  fetches for account status, model catalog, model descriptors, rate-limit
  windows, account token profile, and turn usage/context witnesses when
  available.
- Add a `DirectMetadataDriftReport` startup sentinel that validates raw adapter
  input and normalized `direct_provider_metadata_profile@1` output.
- Cache last-known-good metadata with source, ETag/client-version evidence, TTL,
  and changed-field/unknown-value diagnostics.
- Project model picker, reasoning menu, service-tier/speed menu, quota chip,
  context chip, and runtime witness rows from the normalized metadata profile.
- Preserve degraded/unknown/unavailable states with source labels when any
  upstream field is absent or stale.
- Add fixture and regression coverage for schema drift, unknown enum values,
  stale cache fallback, raw-exposure blocking, quota/context formatting, and
  renderer-safe projection.

Promotion criterion:

```text
The direct lane can explain model, reasoning, speed, quota, token, and context
posture from validated provider metadata, and startup detects drift without
making the app fragile.
```

Expected implementation notes:

- `defaultReasoningEffort` must be validated against
  `supportedReasoningEfforts`.
- `defaultServiceTier` must be validated against `serviceTiers`.
- The reasoning menu must not show non-provider values such as `none` or
  `minimal` unless the live descriptor exposes them.
- The speed menu must not be a global enum; it is per-model and should label the
  descriptor's actual default tier when known.
- Quota reset labels must be formatted only from provider-served reset
  timestamps.
- Context pressure must require both token usage and model context-window
  evidence, otherwise it remains unknown or explicitly estimated.
- Account token profile rows are analytics evidence, not quota evidence.
- Startup drift reports should surface in settings/runtime diagnostics and only
  affect composer/bottom-band UI when current controls are impacted.

### PR 47: Direct Runtime Analytics Facts Persistence

Status: merged as GitHub PR `#178`.

Branch:

```text
codex/direct-analytics-facts-db
```

Purpose:

```text
Persist neutral direct runtime analytics facts in the direct thread store so
later analytics views can read timing, token, context, tool, and quota evidence
without reconstructing everything from live renderer state.
```

Delivered:

- Added `direct_runtime_analytics_facts@1` normalization for:
  - runtime timing marks;
  - per-turn usage facts;
  - context analytics facts;
  - tool analytics facts;
  - provider quota snapshot facts.
- Added dedicated SQLite tables and indexes:
  - `direct_runtime_timing_marks`;
  - `direct_turn_usage_facts`;
  - `direct_context_analytics_facts`;
  - `direct_tool_analytics_facts`;
  - `direct_quota_snapshot_facts`.
- Added idempotent persistence and scoped summary reads through
  `DirectThreadStore`.
- Added opportunistic main-process recording from direct agent usage summaries
  and provider metadata profiles.
- Preserved audit/evidence rows while deduping terminal-vs-delta usage rows for
  aggregate token totals and context pressure inputs.
- Preserved nullable numeric fields as `NULL`, not false zeroes.
- Kept pending tool-obligation fact IDs stable when earlier obligations resolve.
- Added focused regression coverage through
  `scripts/direct-runtime-analytics-facts-regression.mjs`.

Explicit non-goals:

- No analytics dashboard/display change.
- No cost computation.
- No billing-grade claim.
- No raw prompt, response, provider frame, token-detail, secret, or path
  persistence.
- No provider calls, tool execution, workspace mutation, runtime selection, or
  matrix promotion.

Promotion criterion:

```text
Direct analytics views can now consume persisted neutral fact rows instead of
renderer-only live projections, but bottom-band/runtime UI truth still depends
on PR 46 metadata projection and later analytics-display work.
```

### PR 48: Runtime Analytics Adapter Projection

Status: implemented on branch `codex/direct-floating-analytics-panel`; not yet merged.

Purpose:

```text
Create one UX-facing runtime analytics projection that can be populated from
either the vanilla app-server path or the direct path, while preserving source,
confidence, freshness, and blocker truth per field.
```

Scope:

- Add a provider-neutral `RuntimeAnalyticsProjection@1` contract.
- Add an app-server adapter that consumes native app-server/usage-ledger
  analytics where available and avoids expensive synthetic reconstruction.
- Add a direct adapter that consumes direct runtime analytics fact tables,
  direct usage ledger summaries, and provider metadata profile facts.
- Classify every metric as:
  - `appserver_native`;
  - `direct_native`;
  - `derived_from_appserver`;
  - `derived_from_direct`;
  - `unavailable`.
- Preserve evidence refs, confidence, freshness, and blockers for every
  displayed field.
- Keep the renderer consuming the normalized projection only.

Explicit non-goals:

- No new analytics dashboard UI yet.
- No cost computation.
- No billing-grade claim.
- No synthetic reconstruction from app-server payloads unless cheap, stable,
  and explicitly marked derived.
- No runtime selection, provider calls, tool execution, workspace mutation, or
  matrix promotion.

Promotion criterion:

```text
Middle analytics, bottom-band chips, and future daemon analytics can consume one
projection shape without hiding whether a value is native, derived, estimated,
or unavailable for the active runtime path.
```

Delivered in GitHub PR `#180`:

- `RuntimeAnalyticsProjection@1` adapter contract.
- App-server projection from usage-ledger analytics.
- Direct projection from direct analytics fact snapshots and provider metadata.
- Field-level source/confidence/blocker labels for tokens, context, turns,
  tools, requests, quota, and series.
- Floating active-thread analytics panel as an experimental UX consumer.

### PR 49: Upstream 0.140 Metadata And Vanilla-Baseline Parity

Status: merged in GitHub PR `#180`.

Purpose:

```text
Fold Codex 0.140 app-server/provider metadata changes into the direct matrix
and direct metadata/projection adapters without changing the high-level direct
information-bridge ontology.
```

Scope:

- Treat `model/list` descriptors as the live source for model, reasoning,
  service-tier/speed, default, hidden, availability, modality, upgrade, and
  context-window metadata.
- Treat `rateLimitsByLimitId` as the preferred multi-bucket quota source when
  present; keep legacy `rateLimits` as a compatibility mirror only.
- Preserve account token activity as analytics evidence, not quota or context
  pressure truth.
- Confirm context pressure derives from token usage plus model context window,
  matching upstream `thread/tokenUsage/updated` and `get_context_remaining`
  semantics.
- Record vanilla 0.140 baseline methods in the matrix:
  `thread/turns/list`, `thread/delete`, `turn/steer`,
  `thread/settings/update`, `thread/goal/*`, skills/hooks/apps, and
  remote-control/headless surfaces.

Explicit non-goals:

- No provider call authority changes.
- No direct deletion/purge implementation.
- No collapse of direct long-horizon ODEU orchestration into vanilla
  single-thread `goal`.
- No new skill/hook/app execution.
- No direct remote-control/headless daemon implementation.

Promotion criterion:

```text
The direct branch can validate and project 0.140 metadata shapes, explain
vanilla baseline parity in the matrix, and keep renderer controls grounded in
live descriptors and evidence-backed usage facts.
```

## Wave 9: Headless Direct Bridge Service

Status: implemented in branch `codex/direct-resident-epistemic-context-policy`.

Review posture after Wave 8:

```text
The direct branch has a usable Electron lane, direct runtime witnesses,
provider metadata projection, runtime analytics facts, and a floating
active-thread analytics consumer. The next capability should make the same
direct information bridge available without opening Electron, so automation,
CLI tests, workspace UX panels, and deterministic pipelines can submit governed
events into direct threads.
```

Conceptual boundary:

```text
headless daemon != frontend bypass
event accepted != action authorized
JSON schema valid != route authorized
Codex output != downstream command
external event != operator message unless declared
route configuration != low-authority preference
```

Spec:

```text
docs/DIRECT_HEADLESS_BRIDGE_DAEMON_SPEC.md
```

Current implemented substrate:

```text
scripts/codex-real-turn.mjs
scripts/direct-codex-real-turn.mjs
```

Those scripts can run explicit headless turns and write redacted reports. They
do not keep a long-lived backend service alive after the frontend exits.

The future service shape should be a direct backend daemon:

```text
direct backend service
  -> owns auth/session/thread store/context builder
  -> accepts local governed message requests
  -> emits events/status over IPC/WebSocket/HTTP local loopback
  -> can be used by Electron, CLI, automation, and future workspace UX panels
```

Required laws before implementation:

- The daemon must not be an authority bypass around Electron controls.
- Every submitted message still needs WorkThread resolution, context manifest,
  runtime path, auth, model/settings, and authority evidence.
- Local API access must be loopback-only and capability-token/signed-request
  gated.
- The service must use the same `DirectThreadStore`, context pack, usage facts,
  and governance artifacts as the GUI path.
- One-shot scripts remain useful smoke/probe tools, but the daemon is the
  production headless substrate.

Standing Wave 9 constraints:

- Bind local APIs only to loopback/local sockets.
- Require client registration, route binding, WorkThread resolution, context
  policy, runtime metadata, and authority boundary evidence before provider
  work.
- Store lifecycle evidence for every accepted or blocked event.
- Preserve route version and dependency bundle on accepted events.
- Treat duplicate idempotency keys as duplicate processing identities, not new
  turns.
- Do not use chat recency as a route fallback.
- Do not expose raw auth tokens, raw provider payloads, raw local paths, raw
  event payloads, or raw prompt/output text in renderer-safe reports.
- Do not enable external trading/order execution, broad web/network/MCP tools,
  recursive worker spawning, automatic approval, automatic replay, or automatic
  revert.

### PR 50: Headless Bridge Substrate

Status: implemented in branch `codex/direct-headless-bridge-substrate`.

Purpose:

```text
Create the local headless bridge as a lawful information-intake institution:
contracts, daemon ingestion, durable lifecycle store, route registry, and
WorkThread resolution. No provider call.
```

Scope:

- Add bridge schemas for event envelopes, lifecycle witnesses, client
  registrations, route bindings, route decisions, turn packet stubs, outbox
  action stubs, delivery receipts, and human decision packet stubs.
- Add durable headless bridge store tables for clients, routes, inbox events,
  lifecycle events, route decisions, turn packets, outbox actions, delivery
  receipts, and human decisions.
- Add `scripts/direct-bridge-daemon.mjs` with local-only loopback HTTP.
- Implement:
  - `GET /v1/bridge/status`;
  - `POST /v1/bridge/events`;
  - `GET /v1/bridge/events/:envelopeId`;
  - route validation and route decision persistence.
- Add route registry/config validation with route version and dependency bundle
  freeze.
- Resolve event -> route -> WorkThread -> target direct thread, blocking
  unknown route, disabled route, missing WorkThread, ambiguous WorkThread, and
  unknown schema.
- Add bounded queue/backpressure status.

Implemented substrate:

- `src/main/direct/headless/bridge-store.js` owns the local SQLite bridge
  store, client/route/WorkThread registries, inbox lifecycle evidence,
  route-decision rows, duplicate processing identities, and safe status
  projection.
- `src/main/direct/headless/bridge-daemon.js` owns the loopback-only HTTP
  daemon for status, event submission, and event inspection.
- `scripts/direct-bridge-daemon.mjs` starts the daemon without Electron.
- `scripts/direct-headless-bridge-substrate-regression.mjs` proves lawful
  accept/block behavior for accepted events, duplicate idempotency, raw-payload
  rejection, unknown schemas, unknown routes, disabled routes, missing
  WorkThreads, ambiguous WorkThreads, and zero provider-call authority.

Explicit non-goals:

- No provider request.
- No context pack build.
- No direct session creation.
- No tool execution.
- No outbox delivery.
- No Electron controls beyond possible fixture diagnostics.

Promotion criterion:

```text
The daemon can lawfully receive, persist, route, and block typed events before
any model-call authority exists.
```

### PR 51: Headless Direct Text Runtime

Status: implemented in branch `codex/direct-headless-text-runtime`.

Purpose:

```text
Convert accepted routed events into direct text turns with context packs,
request manifests, queue/status projection, and restart/replay safety.
```

Scope:

- Build `HeadlessTurnPacket` from route decision evidence.
- Support `direct-text` routes only.
- Reuse `DirectLiveTextController.startThread/startTurn`.
- Reuse direct context packs, request manifests, provider metadata, usage
  facts, and runtime analytics facts.
- Add `queue_after_active_turn` as the default active-turn policy.
- Add polling-safe status or `GET /v1/bridge/stream`.
- Classify restart/replay states:
  `queued`, `context_built`, `provider_started`, `provider_completed`,
  `failed`, `handoff_unknown`, and `replay_unsafe`.
- Add local CLI/client test helper that submits an event and waits for a
  terminal result.

Implemented slice:

- `src/main/direct/headless/text-runtime.js` converts accepted bridge events
  into durable `headless_turn_packet@1` records.
- The runtime supports `direct-text` routes only and rejects/degrades other
  runtime paths without starting provider work.
- The daemon may receive an optional text runtime; without it, it remains the
  PR 50 intake-only bridge.
- `queue_after_active_turn` is the default active-turn policy per target
  thread.
- `GET /v1/bridge/turn-packets/:packetId` provides polling-safe packet status.
- Terminal packet states classify `provider_completed`, `failed`,
  `handoff_unknown`, and `replay_unsafe`.
- `scripts/direct-headless-text-runtime-regression.mjs` proves event submit,
  queued second turn, terminal status polling, duplicate idempotency, and safe
  status projection with a fixture direct-text controller.
- `scripts/direct-bridge-submit-event.mjs` provides a local CLI client helper
  that can submit JSON/text events and optionally wait for terminal packet
  status.

Explicit non-goals:

- No read/patch/command.
- No implementation-lane route.
- No human decision packet.
- No reducer/outbox action beyond terminal result evidence.
- No auto-retry after provider bytes are observed.

Promotion criterion:

```text
A local client can submit a typed event and receive a completed direct text
turn result without Electron being open.
```

### PR 52: Headless Implementation-Lane Runtime

Status: implemented in branch `codex/direct-headless-implementation-runtime`.

Purpose:

```text
Allow selected headless routes to enter existing direct read/patch/command
authority gates without adding new tool authority.
```

Scope:

- Add route mode `direct-implementation`.
- Require explicit `toolAuthorityMode`; default is `disabled`.
- Start with disposable-workspace route fixtures only.
- Reuse existing read/patch/command authority gates, approval/authority
  policies, workspace mutation truth, tool-result continuations, and recovery
  classification.

Implemented slice:

- `direct-implementation` is accepted as a headless turn-packet runtime path.
- The bridge daemon now exposes a generic `turnRuntime` projection while keeping
  `textRuntime` compatibility for earlier Wave 9 clients.
- Implementation routes can declare `headlessImplementationPolicy@1`.
- Auto-approval is fail-closed and requires `disposableWorkspace=true`.
- V0 regression covers a disposable read-only `read_file` route through the
  existing `DirectLiveTextController`, `DirectLiveTextSurfaceSession.respond`,
  read-only approval handler, workspace read backend, quoted tool-result
  continuation, and terminal packet polling.
- Unsafe auto-approval without disposable workspace produces a failed packet
  before provider request.

Explicit non-goals:

- No auto-approval.
- No broad command policy.
- No recursive worker spawning.
- No external actions.
- No production workspace mutation route by default.

Promotion criterion:

```text
The headless bridge can exercise the existing implementation lane only through
the same authority-bearing transitions used by the Electron path.
```

### PR 53: Output, Artifact Outbox, And Human Decision Loop

Status: implemented in branch `codex/direct-headless-output-outbox`.

Purpose:

```text
Govern what happens after model output: reduce outputs into structured
artifacts, queue safe outbox actions, and request bounded human decisions.
```

Scope:

- Add reducer modes:
  `markdown_summary_only`, `json_contract_required`,
  `human_review_required`, and `artifact_only`.
- Persist reduced results with source output digest, context/request refs,
  route version, reducer version, model/settings, and raw-exposure posture.
- Add safe `write_artifact` outbox action under an allowed artifact root.
- Add `human_decision_packet@1` and `human_decision_reply@1`.
- Add reply endpoint with bounded choices and `freeTextNote` as context only.

Implemented slice:

- `src/main/direct/headless/output-reducer.js` reduces terminal assistant
  output for `markdown_summary_only`, `artifact_only`,
  `json_contract_required`, and `human_review_required` route modes.
- `direct_bridge_reduced_results` now stores provenance-cited reduced results
  with source output digest, route/reducer refs, inference witness, and
  explicit raw-exposure posture.
- `write_artifact` outbox actions write local markdown artifacts under the
  configured artifact root, then persist delivered action/receipt evidence with
  renderer-safe relative paths.
- `human_decision_packet@1` and `human_decision_reply@1` are persisted through
  the bridge store; reply free text is context-only and does not widen
  authority.
- The daemon exposes safe read endpoints for reduced results, outbox actions,
  human decision packets, and bounded human decision replies.
- `scripts/direct-headless-output-outbox-regression.mjs` proves markdown
  artifact delivery, reduced-result retrieval, human-review packet creation,
  valid reply persistence, closed-decision rejection, and raw-exposure
  sentinels.

Explicit non-goals:

- No external delivery integrations.
- No trading/order/action execution.
- No free-text authority widening.
- No unbounded human command channel.
- No webhook/email/Slack delivery.

Promotion criterion:

```text
Headless model output can become durable reduced artifacts or bounded human
decision packets without becoming executable authority.
```

### PR 54: Electron Control Surface And Promotion Harness

Status: implemented in branch `codex/direct-headless-control-surface`.

Purpose:

```text
Make the headless daemon inspectable and safely controllable from Electron,
then package a repeatable headless promotion/regression suite.
```

Scope:

- Add daemon discovery/status in the Project settings/control surface.
- Show active routes, queued events, active turns, failed events, pending
  decisions, outbox state, and delivery failures.
- Add safe daemon-local controls such as pause, drain, shutdown, and possibly
  resume intake.
- Add headless regression suite:
  diagnostic event, direct text route, active-turn queue, implementation-lane
  fixture, reducer/write artifact, human decision reply, restart/replay safety.
- Update docs, matrix, and readiness rows.

Implemented in this slice:

- `headless_daemon_control_projection@1` exposes daemon intake, drain, shutdown
  request, safe-control list, and recent control events without exposing raw
  payloads or route authority.
- `/v1/bridge/control` accepts only authenticated known clients and supports
  daemon-local `pause_intake`, `resume_intake`, `drain`, and `shutdown`
  request transitions.
- Paused/draining daemon states block new ingress events before route/provider
  execution while preserving existing durable store truth.
- Bridge status now includes pending/completed human-decision counts for
  renderer-safe control-surface display.
- Direct settings projection adds a `headless_daemon` section showing daemon
  status, routes/clients, inbox, active/queued turns, outbox failures, pending
  decisions, packets/results, and control posture.
- `direct-headless-control-surface-regression.mjs` verifies authenticated
  controls, blocked ingress while paused/draining, settings projection safety,
  and no provider/request/route-authority grant.
- `direct-headless-promotion-suite.mjs` packages the headless substrate, text
  runtime, implementation runtime, output/outbox, and control-surface
  regressions as a repeatable readiness suite.
- Information bridge registry now names the control surface and promotion
  harness as `ic13.headless-control-surface`.

Explicit non-goals:

- Electron is not daemon truth.
- Renderer cannot mutate route authority directly.
- No provider call from renderer.
- No approval bypass.
- No hidden daemon start unless explicitly configured.
- No external delivery controls.

Promotion criterion:

```text
The operator can inspect and safely manage the daemon, and the headless path has
a repeatable readiness suite for future direct-path testing.
```

## Wave 10: Direct Tool Authority Families

Status: merged through PR 69; wave complete at the evidence/readiness layer.

Dedicated spec:

```text
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
```

Goal:

```text
Add remaining vanilla Codex tool families to the direct path by ODEU authority
class, not by copying tool names one by one.
```

Governing principle:

```text
tool call
  = authority-bearing information transition
  + evidence requirements
  + context consequences
  + replay/recovery law
  + UI projection
```

### PR 55: Direct Tool Capability Constitution

Status: merged.

Purpose:

```text
Create the tool constitution and registry/matrix for every vanilla tool by
ODEU authority class.
```

Scope summary:

- Classify every vanilla tool family from upstream Codex `rust-v0.140.0`.
- Split capability state, implementation state, promotion state, provider
  declaration state, and local executor state.
- Include side-effect class, authority required, request-shape family,
  approval mode, replay risk, recovery law, context visibility, UI projection,
  usage attribution, and agent eligibility.
- No execution behavior changes.

### PR 56: Control, Perception, And Human-Decision Tool Substrate

Status: merged.

Purpose:

```text
Implement or scaffold low-world-effect tool families without introducing
workspace mutation, agent spawning, or external tool execution.
```

Scope summary:

- `get_context_remaining`.
- `update_plan`.
- `view_image` metadata/projection path.
- `request_user_input` bounded/scaffolded through human-decision packet law.
- `new_context` blocked through existing context-maintenance law.

Important constraint:

```text
new_context is not low-risk; it changes the model's informational world and
must not be fully activated until context maintenance, omission ledger,
frontier baton, request manifest, and source-ref law are wired.
```

### PR 57: Direct Agent Runtime Substrate

Status: merged.

Purpose:

```text
Build the runtime substrate needed before exposing any sub-agent tool.
```

Scope summary:

- Agent runtime registry.
- Agent thread graph.
- Agent mailbox.
- Lifecycle/progress registry.
- Containment profile.
- Parent/child authority boundary.
- Agent usage attribution.
- Recovery classifier.

Non-goal:

```text
No spawn_agent exposure yet.
```

### PR 58: Text-Only Sub-Agent Tool Surface

Status: merged.

Purpose:

```text
Expose sub-agent tools in tiers after substrate exists.
```

Scope summary:

- Tier 1: `list_agents`.
- Tier 2: text-only `spawn_agent`.
- Tier 3: `wait_agent` with timeout and no-deadlock law.
- Tier 4: `send_message` and `followup_task` after mailbox proof.
- Tier 5: `interrupt_agent` scaffold/blocked, mark-requested only, or
  deferred.

V0 restrictions:

- No child tools by default.
- No recursive spawning by default.
- No inherited parent tool authority.
- Explicit agent class required.
- Bounded initial prompt/context.

### PR 59: Stateful Exec / PTY / Stdin Parity

Status: merged.

Purpose:

```text
Add vanilla-style process-session authority without collapsing it into current
bounded run_command.
```

Scope summary:

- `exec_command`.
- `write_stdin`.
- Session ids.
- Plain-pipe mode first; PTY mode deferred until evidence is stable.
- Output frames and output budgets.
- Idle/hard timeouts.
- Cancellation and process tree cleanup.
- Sandbox/approval profile.
- Workspace-effect scan where relevant.

Constraint:

```text
exec_command != run_command alias
write_stdin != harmless text
```

### PR 60: External Capability Discovery Registry

Status: merged.

Purpose:

```text
Add discovery substrate for external/dynamic capabilities before execution.
```

Scope summary:

- `tool_search` posture.
- MCP server/resource/tool discovery registry.
- Plugin list posture.
- Schema/source digest tracking.
- Deferred tool exposure status.
- `ExternalCapabilityDescriptor`.

### PR 61: MCP Resource Read And Tool Call Boundary

Status: merged.

Purpose:

```text
Add external resource/action boundary for MCP in direct path.
```

Scope summary:

- `list_mcp_resources`.
- `list_mcp_resource_templates`.
- `read_mcp_resource` first.
- Dynamic MCP tool call boundary scaffold before restricted execution.
- External side-effect class and source provenance.

### PR 62: Hosted Provider Tools

Status: merged.

Purpose:

```text
Add provider-hosted web/image tool posture where provider metadata proves
support.
```

Scope summary:

- `web_search`.
- `image_generation`.
- Provider declaration evidence.
- Result provenance.
- Artifact/source policy.
- Separate web-search evidence contract and image-generation artifact contract.

### PR 63: Plugin Governance

Status: merged.

Purpose:

```text
Handle plugin list/install as capability discovery/mutation, not ordinary tool
execution.
```

Scope summary:

- Plugin list.
- Plugin install request posture.
- Version/source/capability diff.
- Rollback/uninstall law.
- Actual install remains blocked until source pinning, capability diff,
  non-auto-enabled new tool surface, rollback/uninstall, and recoverable
  registry changes are proven.

### PR 64: Code Mode Execution Lane

Status: merged.

Purpose:

```text
Model code mode as a structured execution lane, not shell parity.
```

Scope summary:

- Code-mode execute/wait posture.
- Kernel/session identity.
- Artifact output policy.
- Resource/wait/cancel semantics.

### PR 65: Batch Agent Jobs

Status: merged.

Purpose:

```text
Add structured fan-out/fan-in after agent runtime is stable.
```

Scope summary:

- `spawn_agents_on_csv`.
- `report_agent_job_result`.
- Worker result contracts.
- Aggregation/export ledger.

### PR 66: Headless Tool-Class Example Pack And Runner

Status: merged.

Purpose:

```text
Create a canonical example pack for testing every direct tool authority class
at the correct realism tier before broad live/headless tool validation.
```

Scope summary:

- Add `direct_headless_tool_class_example_pack@1`.
- Add one canonical example per ODEU tool authority class, not per raw tool
  name.
- Cover every row in `direct_tool_capability_registry@1`.
- Separate test modes:
  - `real_provider`;
  - `headless_fixture`;
  - `projection_blocked`;
  - `unsupported_blocked`.
- Link each example to expected evidence schemas, runner scripts, success
  assertions, and forbidden side effects.
- Add validate-only runner by default.
- Add optional `--execute-fixtures` mode for executing linked fixture scripts.

Non-goals:

```text
No provider transport by default.
No workspace mutation by default.
No renderer authority.
No promotion of projection-only or unsupported tools to executable status.
```

### PR 67: Headless Tool-Class Realism Report

Status: merged.

Purpose:

```text
Turn the PR 66 example pack into an operational realism report that tells which
tool classes are fixture-proven, projection-blocked, unsupported, or future
real-provider candidates.
```

Scope summary:

- Add `direct_headless_tool_class_realism_report@1`.
- Add per-class `direct_headless_tool_class_realism_row@1`.
- Consume `direct_headless_tool_class_example_pack@1`.
- Produce validate-only report by default.
- Support optional `--execute-fixtures` to run linked fixture scripts.
- Record promotion readiness per class.
- Preserve no-provider/no-workspace-mutation/no-renderer-authority defaults.

Non-goals:

```text
No live provider calls.
No promotion of any class to direct-enabled.
No new tool execution authority.
No UI dashboard yet.
```

### PR 68: Headless Tool-Class Live Candidate Gate

Status: merged.

Purpose:

```text
Convert the PR 67 realism report into a non-executing promotion gate that
selects only fixture-proven tool classes as eligible live-smoke candidates.
```

Scope summary:

- Add `direct_headless_tool_class_live_candidate_gate@1`.
- Add per-class `direct_headless_tool_class_live_candidate_row@1`.
- Consume `direct_headless_tool_class_realism_report@1`.
- Treat only `headless_fixture_passed` rows as live-smoke candidates.
- Preserve blockers for fixture-not-executed, fixture-failed,
  projection-only, unsupported, real-provider-unassigned, and invalid rows.
- Emit required conditions for every eligible row:
  explicit live-smoke mode, operator/CI authority, provider opt-in, bounded
  timeout, raw-exposure scan, route-authority review, and class-specific
  workspace/process/agent conditions where relevant.
- Add validate-only runner by default.
- Add optional `--execute-fixtures` mode to prove which rows become candidates
  after fixture execution.

Non-goals:

```text
No live provider calls.
No live smoke execution.
No promotion of any class to direct-enabled.
No new tool execution authority.
No renderer authority.
No workspace mutation.
```

### PR 69: Headless Tool-Class Live Smoke Runner

Status: merged.

Purpose:

```text
Consume the PR 68 live-candidate gate and produce an explicit live-smoke report
for eligible tool classes without promoting any class automatically.
```

Scope summary:

- Add `direct_headless_tool_class_live_smoke_report@1`.
- Add per-class `direct_headless_tool_class_live_smoke_row@1`.
- Consume `direct_headless_tool_class_live_candidate_gate@1`.
- Default to `plan_only`, with no live smoke and no provider transport.
- Support explicit `execute_live_smoke` evidence mode.
- Run only candidate rows marked `eligible_live_candidate`.
- Preserve blocked rows as `blocked_by_candidate_gate`.
- Require explicit opt-in evidence before accepting executed smoke results.
- Record required/satisfied/missing live-smoke conditions per row.
- Preserve no-promotion, no-renderer-authority, and no-raw-payload defaults.

Non-goals:

```text
No automatic live provider call from default regression.
No promotion of any class to direct-enabled.
No new tool execution authority.
No UI dashboard.
No raw prompt/result/path/secret persistence.
```

## Wave 11: Tool Promotion And Activation

Status: in progress.

Detailed handoff:

```text
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
```

Goal:

```text
Move from tool-class evidence/readiness reports to explicit direct-tool
promotion decisions and guarded runtime activation.
```

Governing principle:

```text
live smoke evidence != promotion decision
promotion decision != activation
activation != per-call authority
per-call authority != provider-visible result
```

Wave 10 produced the classification, examples, realism report, candidate gate,
and live-smoke evidence report. Wave 11 should consume those artifacts and
decide which tool classes may become usable in the direct runtime without
collapsing evidence, policy, and activation into one switch.

### PR 70: Tool Promotion Decision Gate

Status: merged.

Purpose:

```text
Consume PR 69 live-smoke reports and produce explicit per-tool-class promotion
decisions.
```

Scope summary:

- Add `direct_tool_promotion_decision_report@1`.
- Add per-class `direct_tool_promotion_decision_row@1`.
- Consume `direct_headless_tool_class_live_smoke_report@1`.
- Add `direct:tool-promotion-decision-report` regression coverage.
- Scope each decision by tool class, schema version, request-shape family,
  provider profile/model where relevant, runtime tier, executor version,
  authority envelope, and result envelope.
- Preserve decision states:
  - `promotable`;
  - `promotable_restricted`;
  - `blocked`;
  - `needs_more_evidence`;
  - `not_applicable`.
- Preserve evidence class:
  - `fixture_only`;
  - `diagnostic_only`;
  - `real_provider_declaration`;
  - `real_provider_full_loop`;
  - `real_runtime_full_loop`.
- Require passing live-smoke evidence, no raw-payload leaks, no renderer
  authority grant, no unexpected provider transport, and no workspace mutation
  outside the class contract.
- Include restriction and freshness fields so stale or scope-specific evidence
  cannot become global activation.
- Include operator/CI evidence posture but do not mutate runtime defaults.
- Emit explicit blockers for missing evidence, stale report, failed smoke row,
  policy mismatch, class unsupported, or authority envelope gap.
- Preserve no-activation/no-default-mutation/no-provider-call/no-workspace-
  mutation/no-raw-payload guarantees.

Non-goals:

```text
No tool activation.
No runtime default mutation.
No renderer affordance change.
No provider call.
No workspace mutation.
```

### PR 71: Direct Tool Activation Registry

Status: merged.

Purpose:

```text
Create the guarded activation registry that can turn promoted tool classes into
runtime-available direct tools.
```

Scope summary:

- Add `direct_tool_activation_registry@1`.
- Add `direct_tool_activation_row@1`.
- Add `direct_tool_activation_snapshot@1`.
- Add `direct:tool-activation-registry` regression coverage.
- Preserve activation states:
  - `inactive`;
  - `active`;
  - `shadow_only`;
  - `suspended`;
  - `revoked`;
  - `expired`.
- Activation row must cite:
  - promotion decision digest;
  - operator/project config;
  - authority envelope;
  - provider request-shape support;
  - executor implementation state;
  - recovery/replay classifier.
- Split activation scopes:
  - global default;
  - project default;
  - work-thread override;
  - single-turn override.
- Apply scope precedence:
  - single-turn override;
  - work-thread override;
  - project default;
  - global default.
- Deny/revoke wins over allow, and emergency revoke blocks per-call execution
  immediately even if a prior request declared the tool.
- Freeze activation snapshot and tool declaration digest per provider request.
- Keep all activation disabled by default unless explicitly configured.
- Expose renderer-safe activation status and blockers.
- Preserve PR71 as registry-only: active rows are declaration eligibility,
  while `providerDeclarationEnabled`, `modelVisibleToolEnabled`, and
  `perCallAuthorityBypassed` stay false.
- Downgrade restricted promotion evidence to `shadow_only` when an active
  request is attempted.
- Suspend unsafe global positive activation for non-harmless tool classes in V0.
- Preserve immediate `revoked` rows for emergency revoke scope.

Non-goals:

```text
No broad activation of all promoted classes.
No implicit activation from passing smoke.
No positive global activation in V0 except harmless diagnostic/status tools.
No bypass of per-call authority gates.
No UI dashboard beyond status projection.
```

### PR 72: First Usable Direct Tool Slice

Status: implemented in branch `codex/direct-first-tool-slice`.

Purpose:

```text
Wire the safest high-value promoted tool slice into actual direct runtime
model-visible tools.
```

Recommended first slice:

```text
read_file + get_context_remaining
```

Scope summary:

- Wire only classes that pass PR70 and are enabled by PR71.
- Start with `read_file` and `get_context_remaining` before mutation or agent
  lifecycle tools.
- Add `direct_first_tool_slice@1`, declaration rows, tool-call gate rows, and
  result envelopes.
- Add `direct:first-tool-slice` regression coverage and include it in the
  headless promotion suite.
- Treat read-only as sensitive: enforce path containment, sensitive-path deny
  list, size/line caps, redaction scan, result truncation markers, operation
  ledger entry, and recovery classifier.
- Produce provider request tool declarations from activation registry rows.
- Require provider tool calls to match the frozen declaration snapshot.
- Route model tool calls through existing authority envelopes.
- Emit tool result envelopes and context-pack witnesses only after raw-exposure
  scanning; local result existence does not imply provider-visible result.
- Treat `get_context_remaining` as estimate/status only; it cannot authorize
  `new_context`, compaction, or large input continuation.
- Keep `get_context_remaining` provider output display-only with
  `permissionToContinue=false` and `compactionAuthority=false`.
- Preserve usage attribution and recovery/replay classification.
- Add headless direct smoke coverage for declaration, provider tool call,
  local authority route, result envelope, provider continuation, and terminal
  state.

Non-goals:

```text
No patch/command activation in this first slice.
No sub-agent spawning activation.
No MCP/plugin/provider-hosted activation.
No recursive tool execution.
No `view_image` payload visibility unless separate provider image-input proof
exists.
```

## Wave 12: Resident Agent Epistemic Access

Status: complete. PR 73-77 are merged.

Detailed handoff:

```text
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
```

Goal:

```text
Make the resident agent lawfully in the know about the bridge world: callable
tools, known disabled capabilities, sub-agent E-channel state, runtime/account
posture, context/memory/baton state, workspace/artifact surfaces, external
modules, browser/headless routes, and orchestration state.
```

Governing principle:

```text
epistemic access != control authority
control availability != per-call authorization
tool catalog != model-visible declaration
sub-agent status visibility != interference permission
```

Planned PR sequence:

- PR 73: Resident Epistemic Snapshot Foundation. Merged.
- PR 74: Resident Tool Epistemic Catalog. Merged.
- PR 75: Sub-Agent E-Channel And Governance Envelope. Merged.
- PR 76: Bridge-System Epistemic Classes. Merged.
- PR 77: Resident Epistemic Context Policy And UX. Merged.

### PR 73: Resident Epistemic Snapshot Foundation

Status: merged in branch `codex/direct-resident-epistemic-snapshot`.

Purpose:

```text
Create the generic resident epistemic snapshot schema, row taxonomy, serializer,
privacy scanner, compact renderer, context item witness, and regression tests.
```

Result:

- Added `resident_epistemic_snapshot@1`.
- Added `resident_epistemic_row@1`.
- Added `resident_epistemic_context_item@1`.
- Added deterministic compact resident text rendering with source-row witnesses,
  omitted class counts, stale/conflict labels, digest validation, and
  non-omittable row preservation.
- Added E/C/T channel fields separating epistemic visibility, control
  availability, and transcript visibility.
- Added validation for renderer-safe compact text, raw-payload exclusion,
  callable/status consistency, source-row references, and digest mismatch
  detection.
- Added `direct:resident-epistemic-snapshot` regression coverage and included
  the new module in direct syntax checks and the information-bridge audit.

Non-goals preserved:

```text
No context policy UI yet.
No new tool declarations.
No sub-agent control changes.
No runtime/account mutation.
```

### PR 74: Resident Tool Epistemic Catalog

Status: merged in branch `codex/direct-resident-tool-epistemic-catalog`.

Purpose:

```text
Project activation registry, promotion decision, declaration snapshot, and
per-call gate state into resident-visible tool epistemic rows.
```

Scope summary:

- Added `resident_tool_epistemic_catalog@1`.
- Added `resident_tool_epistemic_preview@1`.
- Projected tool capability rows, activation rows, promotion decisions,
  first-slice declarations, and per-call gate state into resident epistemic
  tool rows.
- Distinguished callable, shadow-only, known disabled/available, missing
  evidence, policy-blocked, runtime/auth-blocked, and not-implemented states.
- Added enablement paths as operator-explanation evidence, not as authority
  grants.
- Kept context injection disabled until PR 77.
- Preserved no new activation, no automatic promotion, no per-call bypass, no
  provider declaration materialization by the catalog, and no local execution.

### PR 75: Sub-Agent E-Channel And Governance Envelope

Status: merged in branch `codex/direct-sub-agent-e-channel-governance`.

Purpose:

```text
Give orchestrators resident-visible sub-agent state while separating observation
from interference permission.
```

Implemented scope:

- Added `sub_agent_governance_envelope@1` and
  `sub_agent_governance_agent_row@1`.
- Added `sub_agent_e_channel_snapshot@1` over the resident epistemic snapshot
  substrate.
- Projected graph, progress, inspect, transcript-witness, policy, release, and
  blocker evidence into resident-visible sub-agent rows.
- Added no-interference policy handling for `observe_only`, `sealed_audit`,
  `blind_run`, `operator_locked`, `time_boxed`, and `handoff_only`.
- Preserved provider declaration, provider transport, workspace mutation,
  child transcript promotion, raw transcript/prompt/provider frame, and context
  injection blocking.
- Added `direct:sub-agent-governance-envelope` regression coverage and wired the
  new module/script into syntax checks.

### PR 76: Bridge-System Epistemic Classes

Status: merged in branch `codex/direct-bridge-system-epistemic-classes`.

Purpose:

```text
Extend resident epistemic access beyond tools/sub-agents to runtime, context,
memory, workspace, module, browser/headless, and orchestration surfaces.
```

Implemented scope:

- Added `bridge_system_epistemic_snapshot@1` and
  `bridge_system_epistemic_preview@1`.
- Added bridge-system resident rows for runtime, provider, model, quota,
  account actions, context, memory, baton, compaction, workspace, artifacts,
  stash, skills, hooks, apps, MCP, external capabilities, browser routes,
  headless routes, thread, WorkThread, goal, and orchestration state.
- Extended resident row subject/source vocabularies for the new PR76 classes.
- Preserved read-only posture: no account mutation, memory mutation, browser
  automation, MCP execution, route execution, provider declaration, local
  executor authority, or context injection.
- Added `direct:bridge-system-epistemic-classes` regression coverage and wired
  the new module/script into syntax checks.

### PR 77: Resident Epistemic Context Policy And UX

Status: merged in branch `codex/direct-resident-epistemic-context-policy`.

Purpose:

```text
Make epistemic access operator-visible and reliably included in resident context
under explicit policy.
```

Implemented scope:

- Added `resident_epistemic_context_policy@1`.
- Added `resident_epistemic_context_bundle@1` over the existing
  `resident_epistemic_context_item@1` witness.
- Added `resident_epistemic_settings_projection@1` for operator/status display.
- Added `resident_epistemic_self_report_diagnostic@1` for comparing model
  self-reports against the current sanitized snapshot.
- Added per-class include/exclude policy, quota-pressure-gated account-action
  inclusion, stale behavior handling, context-budget-aware row projection, and
  omitted-class counts.
- Preserved no manual raw-row editing, no arbitrary prompt injection, no
  disabled capability promotion, no authority grant, and no hidden merge into
  system/developer text.
- Added `direct:resident-epistemic-context-policy` regression coverage and wired
  the new module/script into syntax checks.

Wave 12 result:

```text
The direct bridge can now produce resident-safe epistemic snapshots for tools,
sub-agents, bridge-system state, and context-policy-selected resident context.
The resident agent can be told what is available, disabled, stale, omitted,
blocked, or observable without that knowledge itself becoming authority.
```

Remaining scope moves to later waves:

```text
- Inject policy-selected resident context into live direct model requests by
  default once the runtime path is ready for broad end-to-end testing.
- Add live self-report smoke checks that compare model-visible claims against
  the current resident epistemic bundle.
- Use the same snapshot grammar for headless affordance tests so backend
  behavior can be validated without requiring UI interaction.
```

## Wave 13: Headless Affordance Verification Harness

Status: in progress.

Detailed handoff:

```text
docs/DIRECT_HEADLESS_DAEMON_SERVICE_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
```

Goal:

```text
Use the headless direct bridge as a backend-only test harness that can simulate
operator-facing affordance transitions, exercise direct runtime behavior, and
verify ODEU witnesses without requiring the desktop UI.
```

Core stance:

```text
headless test != UI automation
headless command != unrestricted backend mutation
affordance simulation != human authority bypass
backend witness != semantic success by itself
```

Why this wave exists:

```text
The desktop UX is the human-facing projection, but most direct-path affordances
have a deeper backend contract: target resolution, context construction,
authority envelopes, tool catalog availability, sub-agent E-channel state,
runtime metadata, analytics facts, and resident epistemic bundles.

Those contracts should be testable directly through headless commands so the
agent in this development thread can verify backend behavior without manually
clicking through the UI for every iteration.
```

Planned PR sequence:

- PR 78: Headless Affordance Command Surface.
- PR 79: ODEU Affordance Scenario Fixtures.
- PR 80: Headless Resident-Agent Smoke Runner.
- PR 81: Live Resident Self-Report Harness.
- PR 82: Live Implementation Thread Harness.
- PR 83: Public Headless Implementation Route.
- PR 84: Live Sub-Agent Tool Surface.
- PR 85: Provider-Backed Sub-Agent Execution Route.
- PR 86: Headless Provider-Backed Sub-Agent Command.

### PR 78: Headless Affordance Command Surface

Status: implemented in branch `codex/direct-headless-affordance-command-surface`.

Purpose:

```text
Expose a narrow set of headless commands that mirror high-level operator
affordances while preserving the same backend authority checks used by the UI.
```

Candidate command families:

- Start or resume a direct session for a WorkThread.
- Send text, steer, queue, and stop through the same transition envelopes as
  the desktop composer.
- Read runtime facts, context facts, quota facts, analytics facts, and resident
  epistemic snapshots.
- Request tool catalog previews and sub-agent E-channel snapshots.
- Produce a structured affordance result report with evidence refs and
  authority decisions.

Non-goals:

```text
No raw provider payload dumps.
No bypass of UI-equivalent authority gates.
No hidden mutation of WorkThread/default/runtime settings.
No synthetic success when the backend transition failed.
```

Implemented scope:

- Added `headless_affordance_command@1`.
- Added `headless_affordance_command_result@1`.
- Added an authenticated `/v1/bridge/affordance-commands` endpoint.
- Added high-level command handling for status reads, text submit, queue submit,
  daemon controls, and safe reads of events/turn packets/reduced results/outbox
  actions/human decisions.
- Kept true steer and active-turn stop as explicit blocked affordances until the
  headless runtime exposes those semantics.
- Sanitized returned turn packets so prompt text and provider payloads are not
  returned through the affordance result.
- Added `direct:headless-affordance-command-surface` regression coverage.

### PR 79: ODEU Affordance Scenario Fixtures

Status: implemented in branch `codex/direct-headless-affordance-scenarios`.

Purpose:

```text
Define reusable scenario fixtures that exercise direct-path affordance classes
against deterministic expectations and fixture-safe provider/runtime posture.
```

Scenario classes:

- Direct session creation and resume.
- Active-turn steer/queue/stop semantics.
- Runtime metadata and context-pressure projection.
- Tool availability self-report parity.
- Sub-agent observable-state governance.
- Context/memory/baton/compaction witness inclusion and omission.
- Analytics fact persistence and turn attribution.

Acceptance posture:

```text
Each scenario produces an explicit expected/observed report. A scenario may
pass, fail, skip for missing provider evidence, or degrade for unsupported
runtime capability. Skips and degraded outcomes are first-class evidence, not
silent success.
```

Implemented scope:

- Added `headless_affordance_scenario@1`.
- Added `headless_affordance_scenario_report@1`.
- Added `headless_affordance_scenario_suite@1`.
- Added `headless_affordance_scenario_suite_report@1`.
- Added a default fixture-safe scenario suite over the headless affordance
  command surface covering direct session submit/read, active-turn queue with
  steer/stop blockers, bridge status projection, resident tool self-report
  placeholder, sub-agent E-channel placeholder, context/memory/baton/compaction
  witness placeholder, and analytics attribution placeholder.
- Preserved skip and degraded scenario outcomes as first-class evidence instead
  of treating missing capability as success.
- Added `direct:headless-affordance-scenarios` regression coverage.

### PR 80: Headless Resident-Agent Smoke Runner

Status: implemented in branch `codex/direct-headless-resident-smoke-runner`.

Purpose:

```text
Run small live/direct smoke checks through the headless bridge to verify what
the resident model actually sees and can do, then compare model self-report
against the expected resident epistemic bundle.
```

Checks:

- Model-visible tool declarations match the selected direct mode.
- Resident self-report does not claim unavailable tools as callable.
- Disabled capabilities include enablement paths when known.
- Runtime/model/reasoning/quota/context facts are visible when policy includes
  them.
- Sub-agent observation/interference status is rendered as knowledge, not as
  authority.

Safety:

```text
Live smoke is opt-in and should use short bounded prompts. It must not require
workspace mutation unless a scenario explicitly declares and authorizes that
transition.
```

Implemented scope:

- Added `headless_resident_smoke_case@1`.
- Added `headless_resident_smoke_case_report@1`.
- Added `headless_resident_smoke_suite@1`.
- Added `headless_resident_smoke_suite_report@1`.
- Added a default resident smoke bundle containing tool, runtime, model, quota,
  context, and sub-agent E-channel knowledge rows.
- Added bounded resident smoke prompts that include the compact resident
  epistemic witness but do not expose raw prompt/provider payloads in reports.
- Added fixture-safe self-report comparison through the existing
  `resident_epistemic_self_report_diagnostic@1` primitive.
- Added an explicit overclaim guard where a model claim that a disabled tool is
  callable is recorded as a diagnostic mismatch, not promoted into authority.
- Added `direct:headless-resident-smoke-runner` regression coverage.

### PR 81: Live Resident Self-Report Harness

Status: implemented in branch `codex/direct-live-resident-self-report`.

Purpose:

```text
Run an opt-in real-provider resident self-report through the headless bridge,
then parse the model's JSON claims and compare them to the selected resident
epistemic bundle.
```

Checks:

- Live provider transport starts and completes through the same headless real
  smoke route used for text turns.
- The prompt includes the resident epistemic witness and requires claims for
  selected subject keys.
- The model's returned JSON is parsed into a self-report artifact.
- Required resident subjects are present in the bundle and in the model claim
  set.
- Mismatches and unknown subjects are reported through
  `resident_epistemic_self_report_diagnostic@1`.
- Raw prompt, raw response, provider payload, auth material, and authority
  grants remain excluded from the summary report.

Safety:

```text
Live resident self-report is opt-in. The default case is small and read-only:
it verifies resident awareness of declared tool epistemic rows but does not
grant tool execution authority or mutate the workspace.
```

Implemented scope:

- Added `headless_live_resident_self_report_case@1`.
- Added `headless_live_resident_self_report_suite@1`.
- Added a pure report builder over the existing resident epistemic bundle and
  self-report diagnostic primitive.
- Added a live CLI wrapper over `direct-headless-real-smoke.mjs` so the same
  headless bridge/runtime route is exercised before claims are inspected.
- Added deterministic parser/diagnostic regression coverage through
  `direct:headless-live-resident-self-report:regression`.
- Added opt-in live command `direct:headless-live-resident-self-report`.

### PR 82: Live Implementation Thread Harness

Status: implemented in branch `codex/direct-live-implementation-thread-harness`.

Purpose:

```text
Productize the temporary live implementation-thread runner into a maintained
opt-in headless harness that can verify real read/patch/command behavior
against a disposable fixture workspace.
```

Checks:

- Provider receives an implementation request with read, patch, and command
  tools declared through the direct implementation tool route.
- The resident model reads fixture files before mutation.
- The resident model applies a scoped patch to fix deliberately broken fixture
  code.
- The resident model runs the allowed test command and observes success.
- The final report distinguishes available implementation tools from
  unavailable sub-agent tools.
- Raw prompt text, raw provider payloads, and auth material remain excluded
  from the summary report.

Safety:

```text
Live implementation-thread testing is opt-in. The harness creates and mutates
only a disposable fixture workspace and requires either the explicit live flag
or CODEX_DIRECT_HEADLESS_LIVE_IMPLEMENTATION_THREAD=true before it starts a
provider call.
```

Implemented scope:

- Added `direct_live_implementation_thread_test@1`.
- Added opt-in live command `direct:headless-live-implementation-thread`.
- Added deterministic fixture mode and opt-in blocker reports so CI/regression
  checks can run without provider calls.
- Added report assertions for declared read/patch/command tools, multi-read
  activity, patch application, command success, final fixture test success,
  truthful unavailable-sub-agent posture, and raw-exposure flags.
- Added `direct:headless-live-implementation-thread:regression` coverage.

### PR 83: Public Headless Implementation Route

Status: implemented in branch `codex/direct-headless-implementation-route`.

Purpose:

```text
Expose the implementation-capable route through the normal headless command
surface so a user or automation can start a direct implementation turn without
using a one-off live harness script.
```

Planned scope:

- Add a governed `implementation_turn` command to the headless affordance
  command surface.
- Reuse the same authority envelopes as the desktop direct implementation lane.
- Return reduced turn/result reports rather than raw provider payloads.
- Keep workspace mutation opt-in and scoped to the resolved WorkThread and
  authorized workspace boundary.
- Preserve separate text-only and implementation-capable backend routes as an
  internal routing decision, not as a user-facing runtime mode split.

Implemented scope:

- Added explicit `submit_implementation_turn` and `queue_implementation_turn`
  headless affordance commands.
- Kept implementation turns on the same bridge ingress path as text turns so
  route resolution, WorkThread checks, queueing, packet storage, and output
  reduction stay shared.
- Added command-surface validation that implementation commands must target a
  route whose runtime path is `direct-implementation`.
- Preserved text-vs-tool as a backend route/policy distinction, not a
  user-facing runtime selector split.
- Added regression coverage for accepted implementation turns, non-implementation
  route rejection, unsafe auto-approval blocking, and raw prompt sanitization.

### PR 84: Live Sub-Agent Tool Surface

Status: merged.

Purpose:

```text
Start exposing live direct sub-agent control as tool affordances with explicit
governance, E-channel observation, and no-interference policy semantics.
```

Planned scope:

- Add first live sub-agent tool declarations for spawn/list/send/wait/inspect.
- Keep inspect/E-channel observation separate from interfering control actions.
- Support no-interference self-binding where selected follow-up actions become
  unavailable after agent spawn.
- Report sub-agent capability availability to the resident epistemic catalog.
- Keep unavailable or shadow-only sub-agent tools truthful in model-visible
  self-report prompts until they are actually executable.

Implemented scope:

- Added a deterministic direct live sub-agent tool surface for local
  `spawn_agent`, `list_agents`, `inspect_agent`, `wait_agent`, and
  `send_message` affordances.
- Preserved provider/tool declaration boundaries: the surface mutates only the
  local agent graph/mailbox/lifecycle witness and never starts provider
  transport directly.
- Added target-scoped no-interference self-binding: agents spawned with a
  no-interference policy remain observable through inspect/E-channel, while
  interfering `send_message` is blocked and reported in the resident-visible
  tool catalog.
- Added `inspect_agent` to the direct tool capability registry as a read-only,
  display-only, restricted local executor.
- Added regression coverage in `direct:live-sub-agent-tool-surface`.

## Wave 14: Provider-Backed Sub-Agent Execution

Purpose:

```text
Turn local direct sub-agent affordances into executable provider-backed child
turns while preserving E-channel observation, usage attribution, and
no-interference policy semantics.
```

### PR 85: Provider-Backed Sub-Agent Execution Route

Status: merged.

Planned scope:

- Add an opt-in provider-backed sub-agent route over the local live sub-agent
  tool surface.
- Call child provider turns through an injected runtime/transport runner.
- Record provider completion/failure back into the child graph, mailbox, and
  lifecycle witness.
- Preserve separate child-agent usage attribution.
- Keep child tools, recursive spawn, workspace mutation, provider declaration,
  and child transcript promotion disabled.

Implemented scope:

- Added `direct_provider_backed_sub_agent_route@1` with explicit route
  descriptor and safety flags.
- Added `direct_provider_backed_sub_agent_result@1` for sanitized child turn
  request shape, provider completion, token usage, and E-channel evidence.
- Added fixture-backed provider runner regression coverage for success,
  duplicate child blocking, provider-runner absence, provider failure, raw
  prompt exclusion, no-interference blocking, and child-agent usage
  attribution.

### PR 86: Headless Provider-Backed Sub-Agent Command

Status: merged.

Planned scope:

- Expose provider-backed sub-agent execution as a governed headless affordance
  command.
- Validate client, route, and WorkThread eligibility through the existing
  bridge route validation path before starting a child provider turn.
- Reuse the PR85 provider-backed route and return sanitized command-result
  evidence.
- Keep child tools, recursive spawn, workspace mutation, provider declaration,
  and child transcript promotion disabled.

Implemented scope:

- Added `spawn_provider_backed_sub_agent` to the headless affordance command
  surface.
- Made command execution awaitable so provider-backed child turns can complete
  through the same command endpoint without changing existing synchronous
  command semantics.
- Added daemon-level provider-backed route caching keyed by route/work-thread
  identity so duplicate child ids are blocked consistently.
- Added HTTP regression coverage for successful child spawn/run, no-interference
  send blocking, duplicate child blocking, token usage projection, and raw
  prompt exclusion.

## Wave 14.5: Shared ODEU Live-Capability Kernel

Status: complete through PR 91.

Dedicated spec:

```text
docs/DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md
```

Purpose:

```text
Extract the shared ODEU live-capability lifecycle before promoting the next
families to resident/operator live capabilities.
```

Kernel lifecycle:

```text
capability constitution row
  -> promotion decision
  -> activation row
  -> declaration / callable surface
  -> per-call authority decision
  -> execution transaction
  -> result envelope
  -> context admission
  -> projection / resident epistemic witness
  -> usability proof
```

Doctrine:

```text
shared kernel = activation, authority, transaction, envelope, admission, proof
family-specific = executor semantics, side-effect semantics, result semantics,
                  UI/resident wording
```

| PR | Status | Branch | Purpose | Planned deliverable | Explicit non-goals |
| --- | --- | --- | --- | --- | --- |
| `#87` | merged | `codex/direct-odeu-artifact-kernel` | ODEU artifact kernel | Shared artifact refs, source refs, digests, validation, raw-exposure scan shape | No executor behavior |
| `#88` | merged | `codex/direct-odeu-capability-lifecycle` | Capability lifecycle kernel | Shared capability row, promotion decision, activation row, declaration/callable surface | No per-call authorization |
| `#89` | merged | `codex/direct-odeu-per-call-authority-transaction` | Per-call authority and transaction kernel | Shared authority decision, side-effect class, transaction/recovery lifecycle | No family-specific live promotion |
| `#90` | merged | `codex/direct-odeu-result-admission-kernel` | Result envelope and context admission kernel | Shared result envelope, context admission record, provider/local visibility split | No result smuggling into memory/project truth |
| `#91` | merged | `codex/direct-odeu-usability-proof-witness` | Usability proof and resident witness kernel | Shared capability usability proof and resident/operator witness projection | No resident self-report as proof source |

Dependency:

```text
Wave 14 provider-backed sub-agent execution remains the implemented baseline.
Wave 15 and later live capability waves should consume this kernel rather than
invent family-local activation, authority, result, or proof grammars.
```

## Wave 15: Resident-Callable Sub-Agent MVP

Status: active; complete through PR 93, PR 94 in review.

Dedicated spec:

```text
docs/DIRECT_WAVE15_RESIDENT_SUB_AGENT_MVP_SPEC.md
```

Purpose:

```text
Promote the existing direct sub-agent substrate into the first resident-callable
live capability family.
```

First usable slice:

```text
single-shot text-only child worker
spawn_agent
list_agents
inspect_agent
bounded wait_agent
sanitized child result admission
child usage attribution when provider evidence exists
```

Standing non-goals:

```text
no send/followup
no close/interrupt/resume
no recursive spawn
no child inherited tools
no continuing child conversation
no child output flattening into primary transcript
no batch fan-out
```

| PR | Status | Branch | Purpose | Planned deliverable | Explicit non-goals |
| --- | --- | --- | --- | --- | --- |
| `#92` | complete | `codex/direct-subagent-capability-profile` | Sub-agent capability profile and ODEU lifecycle adapter | Capability rows, promotion decisions, shadow/test activation rows, declaration snapshots, blocked rows with reason/future owner | No provider transport or resident-callable declaration |
| `#93` | complete | `codex/direct-subagent-authority-idempotency-wait` | Sub-agent per-call authority, idempotency, and wait policy | Authority decisions, transaction rows, spawn/wait plans, canonical idempotency, target validation, wait timeout/deadlock policy | No provider-backed child execution |
| `#94` | complete | `codex/direct-subagent-provider-backed-spawn` | Provider-backed spawn/run, result envelope, and context admission | Provider-backed child run adapter, result reducer, child result envelope, admission envelope, context admission, usage attribution | No child transcript full-history view or child tools |
| `#95` | in review | `codex/direct-subagent-resident-declaration` | Resident tool declaration, witness, and headless smoke | Resident sub-agent tool declarations, frozen declaration digest, epistemic rows, usability proofs, positive/negative headless smoke | No UI-first implementation or interference controls |
| `#96` | planned | TBD | Operator projection and manual usability gate | Primary transcript activity summary, operator proof/status rows, manual smoke gate, analytics hook, proof-only operator projection | No right-pane/sub-agent UX overhaul or operator authority expansion |

Wave 15 completion gate:

```text
Resident can spawn one bounded child agent, list/inspect/wait for it, and
consume a sanitized child result through ODEU result/context admission without
flattening child work into the primary transcript.
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

- Remaining live capability promotion tracker:
  `docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md`.
- Mature skill/hook marketplace or installation UI.
- Bridge module runner V0 after execution gates, with explicit authority
  transition and no auto-invocation.
- Cost/pricing pass over direct usage ledger rows using dated pricing snapshots.
- Project-scoped persistent web/session policy for future governed browser
  surfaces.
- Direct-native import/migration strategy for selected app-server transcripts.
- ChatGPT account rate-limit reset credits. Upstream Codex `rust-v0.141.0`
  exposes reset-bank evidence through `account/rateLimits/read`
  (`rateLimitResetCredits.availableCount`) and the mutation
  `account/rateLimitResetCredit/consume` with `{ idempotencyKey }`.
  Backend paths observed in 0.141 are `/api/codex/rate-limit-reset-credits/consume`
  for Codex API style and `/wham/rate-limit-reset-credits/consume` for ChatGPT
  API style. Outcomes are `reset`, `nothingToReset`, `noCredit`, and
  `alreadyRedeemed`. This requires ChatGPT account auth, not API-key auth. Direct
  implementation should treat it as an explicit account mutation: read current
  limits/available reset count, require operator confirmation, consume with a UUID
  idempotency key, refetch limits afterward, and record an authority/evidence row.
