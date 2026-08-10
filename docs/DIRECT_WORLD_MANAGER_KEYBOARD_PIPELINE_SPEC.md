# Direct WorldManager Keyboard Pipeline Integration Spec

Status: implementation in progress. `WM-K1` through `WM-K4`, `WM-SC1`,
`WM-SC2`, `WM-SC2b` split child orchestration, `WM-SC2b.1`
truth/recovery stabilization, and the `WM-SC3` semantic artifact/decision
kernel, `WM-SC4` operational semantic-context importer, `WM-SC5` governed
decision transitions, `WM-SC6` semantic-surface compiler, and `WM-SC7`
Abstract Reasoning Object registry/reconstruction plus `WM-SC7.1` automatic
repository reconstruction, `WM-SC7.2` governed target definition, and
`WM-SC8.1` provisional mutation-contract compilation are implemented and
locally regression-proven.
The project-genesis `WM-K5G`/`WM-K6G` slice, the general-planning
`WM-K5A`/`WM-K5B` slices, and the general `WM-K6`
planning-to-execution continuation are implemented. `WM-K5A` promotes a
reconciled Project Manager plan into an immutable `PlanProposalRevision`,
exact evidence-review receipt,
scope-CAS graph admission, persisted `ImplementationContract`, and a real
WorkThread in `contract_received`. `WM-K5B` gives an authenticated operator
utterance exact semantic-admission parity with the Greenlight control.
`WM-K6` compiles a local-only implementation constitution, requires an exact
single-use worker-start authorization, starts a real Direct worker, retains
per-call effect gates, evaluates completion semantically against exact runtime
evidence, and admits the resulting project-memory candidate only through the
Project Manager boundary.
K4 is proven through the persisted Direct controller with deterministic
provider transport. A real-account live acceptance turn remains a separate
promotion witness.

Date: 2026-08-11.

Parent doctrine:
[Direct World Manager Agent-World And Unified UX Spec](./DIRECT_WORLD_MANAGER_AGENT_WORLD_AND_UNIFIED_UX_SPEC.md).

Exploratory predecessor:
[Direct WorldManager Semantic Mockup](./DIRECT_WORLD_MANAGER_SEMANTIC_MOCKUP.md).

Accepted substrate:

- [Direct Wave 23](./DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md)
- [Direct Wave 24](./DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md)
- [Direct Wave 26](./DIRECT_WAVE26_HIERARCHICAL_WORLDMODEL_PROJECT_MANAGER_SPEC.md)

## Purpose

Define the first production-oriented, keyboard-first integration of the
WorldManager experience.

The target is not another semantic mock. It is a real composition of the
accepted Direct stores, worldmodel objects, role boundaries, provider
transport, and renderer:

```text
typed user message
  -> durable unified ingress
  -> WorldManager target and task settlement
  -> actual hierarchical-worldmodel projection
  -> bounded Project Manager agent-world compilation
  -> authenticated Direct role turn
  -> final-message-anchored AgentResult
  -> immediate unified response
  -> WorldManager reconciliation
  -> versioned candidate proposal
  -> refinement through the same composer
  -> evidence-visible operator admission
  -> actual canonical graph transition
  -> actual persisted WorkThread and implementation contract
  -> implementation ResolvedTaskConstitution and role handoff
  -> explicit worker-start authorization and Direct implementation turn
  -> semantic closure assessment bound to runtime evidence
  -> Project Manager project-memory admission and upward status
```

Voice is intentionally deferred. A later voice adapter must enter and leave
through the same ingress, event, result, and projection contracts.

Project genesis and default substrate selection are specified in
[Direct WorldManager Project Genesis And Substrate Constitution](./DIRECT_WORLD_MANAGER_PROJECT_GENESIS_AND_SUBSTRATE_SPEC.md).

The implemented fixed semantic-ingress replacement and the target semantic
history, context-import tools, operational meta-context, ARO-centered code
work, and thought-paint operators are specified in
[Direct WorldManager Semantic Context, ARO, And Thought Tools Design](./DIRECT_WORLD_MANAGER_SEMANTIC_CONTEXT_ARO_AND_THOUGHT_TOOLS_DESIGN.md).

## Local Implementation Status

### Manager runtime preference surface

The production workbench now exposes a persisted WorldManager runtime
preference with independently selectable model and reasoning effort:

```text
configured preference
  -> effective next-call binding
  -> provider-observed terminal telemetry
```

These are three different truths. The renderer must not describe a configured
model as already observed. `Automatic` preserves the role-contract effort and
the normal project/provider/model fallback chain.

The preference applies to WorldManager and Project Manager provider calls. It
does not flow into implementation workers or auditors, whose model/effort
selection remains governed by their project and task constitution. An active
WorldManager transition owns its existing runtime binding; preference mutation
is rejected until the transition reaches a terminal boundary.

Selectable models come from the account-scoped provider catalog when it is
fresh. A bundled ODEU profile is rendered as diagnostic fallback evidence, not
counterfeit live availability. For manager roles only, a fresh exact provider
catalog observation is sufficient model-selection evidence when an older
model-specific probe is absent or expired. Worker runtime gates are unchanged.

Implemented identities and surfaces:

```text
direct_world_manager_runtime_settings@1
runtimeDefaults.worldManager.model
runtimeDefaults.worldManager.reasoningEffort
world-manager:runtime-settings
world-manager:update-runtime-settings
manager-runtime-trust-boundary
```

Applying a preference starts no manager inference call, creates no canonical
worldstate change, and grants no worker authority. It becomes effective at the
next manager provider call.

`WM-K1` provides the production control-plane foundation:

```text
SQLite WAL WorldManagerControlPlaneStore
append-only digest-linked semantic event ledger
durable user messages
candidate / inbox / decision / runtime-binding tables reserved for later stages
stable app-project -> ProjectWorld bootstrap refs
restart-reconstructed WorldManagerWorkbenchProjection
production world-manager:* IPC namespace
keyboard-first production renderer path
actual WorkThread registry read projection
```

K1 contract identities:

```text
direct_world_manager_bootstrap_manifest@1
direct_world_manager_semantic_event@2
direct_world_manager_message@1
direct_world_manager_ingress_receipt@1
direct_world_manager_workbench_projection@1
direct_world_manager_control_plane_store@1
```

The production semantic event is `@2` deliberately: the mockup already used
the `@1` name for a different exploratory shape. Production does not reinterpret
or silently migrate those fixture events.

`WM-SC1` now precedes `WM-K2` with the fixed provider-backed semantic-ingress
boundary. `WM-K2` mechanically adapts its semantic discharge into task settlement,
routing, and graph-first manager context:

```text
typed message
  -> durable received user evidence
  -> fixed WorldManager semantic-ingress role
  -> validated and persisted SemanticSettlement
  -> exact typed scope/ID constraint validation
  -> mechanical K2 task-settlement adapter
  -> WorldmodelIngressEnvelope
  -> SemanticTargetResolution
  -> TaskSettlement
  -> WorldManagerRoutingDecision
  -> actual authoritative graph projection
  -> actual World or Project Manager profile
  -> ManagerTurnBootPacket
  -> context_ready
```

K2 persists settlement, routing, clarification/remand, and manager-context
receipts in the WorldManager control plane. The authoritative graph remains
owned only by the existing trust store. On restart, the service reads the
canonical graph head and rebuilds the profile, closed projection policy, graph
projection, and boot packet from typed refs; it compares the rebuilt context
digest with the durable receipt without replaying transcript text.

K2 deliberately does not compile a task constitution or agent instantiation,
admit a contextual authority decision, call a provider, register a candidate,
change canonical worldstate, or start work. `contextAdmissionState =
deferred_to_k3` and `providerRoleTurnState = not_started` are visible in the
production evidence surface.

`WM-K3` now crosses the policy and agent-world compilation boundary:

```text
K2 TaskSettlement + ManagerTurnBootPacket
  -> active PolicyObject adapter set
  -> deterministic selector / precedence / exception closure
  -> ResolvedTaskConstitution
  -> trusted role-template selection
  -> prompt / capability / authority / evaluator projections
  -> AgentInstantiationManifest
  -> fail-closed projection agreement
  -> compiledAgentContext for direct_compiled_agent_turn@1
  -> agent_world_ready
```

The first real constitution is deliberately non-executing. A planning Project
Manager may read the admitted graph projection, reason over supplied evidence,
formulate a project-scoped proposal, expose open decisions, and answer the user
directly in natural language. It receives zero tools and is prohibited from mutating
the workspace or remotes, admitting canonical worldstate, or starting
implementation.

K3 persists the full reconstructible compilation plus a renderer-safe summary
in `wm_agent_world_compilations`. Restart reconstruction recompiles from the
settlement and authoritative graph head and compares the complete compilation
digest. Validation means only `ready_for_k4_runtime_only`: no Direct session,
provider request, role result, candidate, or canonical write is created.

`WM-K4` now crosses the persisted role-runtime and completion-relay boundary:

```text
K3 compiledAgentContext exact ref
  -> DirectRoleRuntime
  -> persisted Direct manager session and turn
  -> terminal final-assistant-message anchor
  -> deterministic telemetry envelope
  -> natural-response contract validation
  -> non-canonical AgentResult
  -> immediate unified response projection
  -> delegated-role AgentResult in the semantic inbox
  -> persisted WorldManager semantic-discharge/reconciliation turn
  -> advisory reconciliation result
```

The manager's answer and the harness's semantic discharge are different
objects. Ordinary WorldManager and Project Manager turns are compiled with
`responseMode = natural_language`; any non-empty terminal assistant message
satisfies the response form without its meaning being compared to a JSON
schema. When a Project Manager formulated the answer, that final message is the
semantic anchor consumed by a separate structured WorldManager reconciliation
operation. A world-scoped WorldManager conversation already belongs to the
constitutional root, so it does not enter its own inbox or recursively await
another WorldManager. Project genesis retains its dedicated structured
discharge because that non-conversational object is the input to candidate
persistence and explicit admission.

System-introspection turns now receive one bounded semantic-history import
when active related turns exist:

```text
current introspection semantic discharge
  -> query active SemanticHistoryRelation records
  -> resolve their current materialized SemanticShelf projections
  -> select a bounded multi-turn semantic horizon
  -> import exact user messages, settlement revisions, K2 settlements,
     visible manager AgentResults, and relation witnesses
  -> compile as quoted semantically_indexed_historical_evidence
```

`direct_trusted_semantic_history_evidence@1` records the shelf and relation
selection rule, exact source refs, bounded imported-turn count, and omission
boundaries. Recency ranks already-indexed candidates but does not define their
semantic membership. The import does not blindly replay chat history, raw
provider payloads, or private reasoning, and it grants no authority. This lets
introspection resolve its actual subject from a bounded semantic horizon rather
than hard-coding every question to the immediately preceding row.

`DirectLiveTextController.startTurn` resolves the compiled context by exact
id/digest through a harness-owned resolver. It rejects renderer-supplied
system, developer, instruction, or compiled-context bodies. The thread context
builder selects `direct_compiled_agent_turn@1`, injects only the trusted
instruction package, keeps the current user prompt in its user layer, and
records the compiled context and instantiation identities in the request
manifest.

K4 persists role runs, runtime bindings, typed AgentResult envelopes,
conditional semantic-inbox delivery, and reconciliation state in the
WorldManager control plane. Direct
session/turn and normalized provider evidence remain owned by the existing
Direct stores. A failed provider turn remains visible. Natural answer content
is not remanded for failing a semantic JSON schema. Invalid semantic-discharge
form can still remand the later persistence operation, and neither boundary
silently creates a proposal. Successful reconciliation is advisory and does
not admit canonical state.

Production no longer recognizes social, project-genesis, planning, policy,
implementation, or review categories through lexical phrase lists. The fixed
WorldManager semantic-ingress constitution now selects one native semantic
discharge action. The action name selects a top-level meta-contract; its
arguments discharge that contract through open semantic type expressions.
Strings such as `hey`, `hello`, greeting emojis, and project-seed examples
remain regression inputs or deterministic test fixtures only. Ambient focus is
contextual evidence and is not sufficient to convert conversation into a
project command. If semantic ingress is unavailable or returns an invalid
action form, the turn is remanded without a lexical fallback or effect.

The boundary is closed in form and open in meaning. The harness validates one
action call, exact configured project references, explicit scope constraints,
authority posture, and the structural modes `existing_ref`, `proposed_type`,
`composite`, `freeform`, and `unresolved`. It does not compare a proposed
semantic type or free-form characterization to a closed content taxonomy.
Finite K2 task types remain operational adapters selected inside the relevant
meta-contract, not a reverse validator over the WorldManager's meaning.

Provider objects that use the exact required result identity under the common
top-level `type` discriminator are mechanically canonicalized to `schema`; no
other schema mismatch is relaxed. A typed `request_clarification` continuation
with a user-facing message renders that message naturally while its semantic
summary and open-decision structure remain available as typed evidence.

`WM-K5G` and `WM-K6G` now implement the bounded project-genesis exception to
the general K4 stopping point:

```text
world-scoped project_initialization
  -> harness-observed WSL/Windows realization snapshot
  -> dedicated WorldManager project-genesis result
  -> reconciled non-canonical constitution candidate
  -> same-context substrate evidence review
  -> explicit operator admission
  -> canonical ProjectConstitution
  -> immutable ProjectRuntimeDefaultBinding
  -> awaiting_workspace_provisioning
```

The candidate, review, admission, and runtime default survive restart and remain
digest-linked in the semantic ledger. The renderer shows the ranked options and
keeps canonical admission visibly distinct from workspace or worker readiness.
A native Windows resident-process regression proves that WSL can attach to a
real `win32` workspace agent without routing each command through an ad hoc
PowerShell wrapper. The admitted project is not yet activated in the
hierarchical worldmodel and no WorkThread inherits the binding until the next
provisioning slice.

`WM-K5A` now implements the first production general-planning boundary:

```text
natural Project Manager plan
  -> WorldManager reconciliation semantic discharge
  -> semanticActions.register_plan_proposal (candidate effect only)
  -> immutable PlanProposalRevision vN
  -> exact evidence-review receipt
  -> explicit production Greenlight request
  -> project-scope trust-store CAS
  -> canonical graph transition
  -> persisted ImplementationContract
  -> real WorkThread(contract_received)
```

Proposal bodies remain immutable; supersession is registry metadata. Candidate
revisions never appear as canonical graph truth. A stale graph CAS persists a
visible `stale_conflict` posture and creates no contract or WorkThread. Once the
graph transition succeeds, a WorkThread-store failure is persisted as
`pending_repair`; restart retries the exact admission idempotently. The contract
explicitly denies worker-start authority, so the renderer may not describe
implementation as started.

Registration is not inferred from the task label or from phrases in the final
message. The reconciler emits an optional open-content `semanticActions` entry
whose harness-known action type is `register_plan_proposal`; its semantic
payload supplies the title, summary, features, and open decisions. A valid
reconciliation without that action creates no proposal revision. Thus JSON
typing governs the discharge form and effect boundary, not the proposal's
semantic content.

The production evidence and Greenlight controls use `world-manager:*` IPC, not
the semantic-mockup coordinator.

`WM-K5B` adds the semantic-router admission disposition without phrase
matching. `wm_discharge_decision_concern` binds four independent fields:

```text
decisionId
exact governed target ref (kind + id + digest + project)
resolutionMode
disposition
```

Most dispositions (`deliberate`, `inspect_evidence`, `request_authority`) are
non-effecting and continue through the WorldManager response path. Only
`authorize_exact_target` enters an effect adapter, and the provider may select
it only when the harness advertised that disposition for the exact pending
decision. Trusted service code then revalidates the current OpenDecision and
immutable target before calling the same `admitPlanProposal` method as the
Greenlight control. The semantic model neither admits the graph nor grants
authority itself.

An unqualified affirmation with multiple unresolved targets must clarify. A
target digest mismatch remands before effect. Missing evidence, graph CAS
staleness, idempotent retry, durable contract creation, and restart recovery
therefore use the same protocol and invariants as control admission. The typed
path terminates at `contract_received`; it does not run a redundant manager
turn and cannot imply that implementation started.

WM-SC1 active contract identities:

```text
direct_world_manager_semantic_action_contract@1
direct_world_manager_semantic_discharge@1
direct_world_manager_semantic_settlement@2
direct_world_manager_semantic_discharge_validation@1
direct_world_manager_semantic_discharge_request_manifest@1
direct_world_manager_semantic_ingress_run@2
```

Persisted `direct_world_manager_semantic_settlement@1` and
`direct_world_manager_semantic_ingress_run@1` records remain readable as
historical evidence; they are no longer emitted.

K2 contract identities:

```text
direct_world_manager_graph_binding@1
direct_world_manager_task_settlement@1
direct_world_manager_routing_decision@1
direct_world_manager_clarification@1
direct_world_manager_context_bundle@1
direct_worldmodel_ingress_envelope@1
direct_semantic_target_resolution@1
direct_worldmodel_graph_projection@1
direct_manager_turn_boot_packet@1
```

K3 contract identities:

```text
direct_policy_object@1
direct_policy_exception@1
direct_resolved_task_constitution@1
direct_policy_prompt_projection@1
direct_policy_enforcement_projection@1
direct_trusted_role_template@1
direct_trusted_role_template_registry@1
direct_agent_instantiation@1
direct_agent_instantiation_manifest@1
direct_agent_world_projection_agreement@1
direct_compiled_agent_context@1
direct_world_manager_agent_world_compilation@1
direct_compiled_agent_turn_context_policy@1
direct_trusted_discourse_evidence@1
direct_semantic_settlement_revision@1
direct_semantic_history_relation@1
direct_semantic_history_relation_state@1
direct_semantic_shelf@1
direct_trusted_semantic_history_evidence@1
```

K4 contract identities:

```text
direct_world_manager_role_run@1
direct_agent_result@1
direct_final_assistant_message@1
direct_agent_user_facing_response@1
direct_agent_telemetry_envelope@1
direct_agent_output_validation@1
direct_world_manager_reconciliation@1
direct_world_manager_reconciliation_result@1
```

Launch and proof:

```bash
npm run dev:worldmanager
npm run direct:world-manager-k1
npm run direct:world-manager-k1-ui
npm run direct:world-manager-k2
npm run direct:world-manager-k2-ui
npm run direct:world-manager-k3
npm run direct:world-manager-k3-ui
npm run direct:world-manager-k4
npm run direct:world-manager-k4-ui
```

The exploratory fixture remains independently available through:

```bash
npm run dev:worldmanager:mock
```

## Decision Summary

The next implementation should be an integration layer, not a replacement
worldmodel.

```text
keep:
  the current minimal WorldManager renderer topology
  Direct auth and Responses transport
  Direct session/turn persistence
  hierarchical worldmodel and trust store
  graph projection and manager turn boot
  semantic ingress candidate/promotion machinery
  manager/project-manager custody
  WorkThread registry and worker-start boundary
  authorization, tool, and runtime evidence surfaces

replace:
  mockup-owned world truth
  hard-coded planning-only routing
  stateless one-shot role probes
  synthetic Project Manager instantiation
  synthetic contract and WorkThread records
  latest-only proposal handling
  one global busy lock

add:
  resident WorldManager control-plane service
  durable semantic-event and candidate-artifact store
  production ingress/settlement adapter
  policy-closure and task-constitution compiler
  trusted role-template and agent-world compiler
  persisted Direct role runtime adapter
  automatic completed-turn semantic relay
  proposal revision and admission protocol
  canonical graph and WorkThread commit adapter
  renderer projection over the actual stores
```

## Meaning Of “Real”

The word `real` has three separate gates.

### Real semantic planning

Required for the first milestone:

```text
actual app project identity
actual authoritative hierarchical graph
actual manager profiles and role-indexed graph projection
actual trusted role compilation
actual persisted Direct session and turn
actual authenticated provider response in live acceptance
actual AgentResult and semantic inbox relay
actual versioned candidate artifacts
actual contextual admission and graph transition
actual WorkThread registry write
restart-safe reconstruction from canonical stores
```

### Real execution

Required for the second milestone:

```text
actual implementation contract
actual ResolvedTaskConstitution
actual authority/capability agreement
actual worker handoff and Direct worker start
actual tool approval/enforcement paths where applicable
actual completion relay and closure evaluation
actual project-memory candidate and Project Manager admission
```

### Real voice

Deferred:

```text
live voice transport
app-server/provider entitlement adapter
spoken ingress normalization
unified voice egress
on-screen provenance for voice-formulated results
```

A deterministic model runner may prove orchestration and failure behavior in
automated tests. It does not by itself satisfy the live-provider acceptance
gate.

## Current Repo-Grounded Truth

### Already implemented and reusable

| Capability | Current source | Integration posture |
| --- | --- | --- |
| Minimal unified WorldManager workbench | `src/renderer/world-manager-surface.*` | Keep topology; replace mock projection and commands |
| Keyboard composer and evidence/admission controls | `src/renderer/world-manager-surface.js` | Keep interaction grammar; generalize lineage and decisions |
| Authenticated Direct text transport | `src/main/direct/transport/codex-responses-transport.js` | Reuse through a persisted role runtime |
| Durable Direct sessions and turns | `src/main/direct/session/session-store.js` | Reuse as provider-turn evidence |
| Streaming/live text controller | `src/main/direct/controller/live-text-controller.js` | Extend with trusted compiled-agent context |
| Hierarchical worldmodel | `src/main/direct/worldmodel/hierarchical-graph.js` | Canonical admitted semantic state |
| Worldmodel trust/CAS store | `src/main/direct/worldmodel/governance-trust-store.js` | Canonical graph head and write admission |
| Semantic ingress artifacts | `src/main/direct/worldmodel/semantic-ingress.js` | Reuse target, candidate, audit, and promotion objects |
| Role-indexed graph projections | `src/main/direct/worldmodel/graph-projection.js` | Reuse for manager world slices |
| Manager turn boot | `src/main/direct/worldmodel/manager-turn-context.js` | Reuse as graph-first context witness |
| World and Project Manager profiles/custody | `src/main/direct/worldmodel/manager.js` and `project-manager.js` | Reuse |
| Project memory propagation | `src/main/direct/worldmodel/project-memory-propagation.js` | Reuse after worker completion |
| Action policy and authorization substrate | `constitutional-policy.js` and `authorization-router.js` | Adapt; current resolution remains narrower and shadow-oriented |
| WorkThread registry | `src/main/direct/bridge/work-thread-registry.js` | Canonical operational task identity |
| Role handoff and worker start | `role-handoff-packet.js` and `worker-start.js` | Reuse in execution milestone |
| Tool bundle and effect authority | Direct bridge/tool modules | Reuse in execution milestone |
| Async work state | `src/main/direct/worldmodel/async-work-registry.js` | Reuse for background project operations |
| Production WorldManager K1–K4 control plane | `src/main/direct/worldmanager/control-plane*.js`, `settlement.js`, `worldmodel-bootstrap.js`, `policy-compiler.js`, `role-template-registry.js`, `agent-world-compiler.js`, `role-runtime.js`, and `service.js` | Durable ingress, graph-bound settlement, deterministic constitution, trusted role compilation, persisted Direct manager turns, typed completion relay, semantic inbox, and advisory WorldManager reconciliation |
| Production WorldManager IPC and preload bridge | `src/main.js` and `src/preload-codex-surface.js` | Implemented as `world-manager:*`; does not fall through to mock IPC |

### Implemented only in the semantic mockup

These artifacts express useful target semantics but currently live in the
parallel mockup store:

```text
SemanticEvent projection
TaskSettlement projection
exploratory AgentInstantiation projection (not the production K3 contract)
PlanProposal
ImplementationContract
unified message lineage
evidence-reviewed gate
```

They must be promoted into production contracts or replaced by adapters over
accepted production objects. Copying the mockup JSON state into a differently
named production file is not an acceptable implementation.

### Still missing after WM-K4

```text
canonical admission and revision of user-authored PolicyObjects
proposal revision/supersession
natural-language decision targeting
canonical proposal admission into the graph
actual implementation-contract persistence
multi-store projection beyond bootstrap, K2/K3 compilation, K4 runtime
lineage, and WorkThread registry
per-lineage concurrency, interruption, and recovery
real-account live K4 acceptance witness
```

## Source-Of-Truth Boundaries

The real pipeline must not create one giant replacement database.

| Truth class | Canonical owner | WorldManager control-plane posture |
| --- | --- | --- |
| User/project semantic state | hierarchical worldmodel trust store | Read by revision; changed only through admitted graph transition |
| Project and manager identity | manager/agent registries and graph | Referenced, not re-authored |
| Provider turn evidence | Direct session, turn, normalized-event, and transcript stores | Referenced by exact ids/digests |
| Candidate proposals and pending decisions | new WorldManager control-plane store | Canonical while provisional; never represented as admitted graph truth |
| Unified semantic event lineage | new WorldManager control-plane ledger | Canonical interaction lineage |
| WorkThread operational identity | Direct WorkThread registry | Created only after valid admission/contract transition |
| Workspace/tool effects | operation ledger and mutation-truth stores | Evidence only; never inferred from assistant prose |
| Async activity | async work registry | Referenced and projected |
| Renderer state | derived WorldManager projection | Disposable and reconstructable |

The WorldManager ledger stores refs, typed candidate artifacts, delivery state,
and lineage. It must not duplicate graph bodies, raw provider payloads, raw
credentials, or private reasoning.

## Morphic UX Run Stance

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: runtime_exercised
  runtime: live_observed
profile_lineage:
  base_profile: artifact_inspector_alternate
  derivative_profile: worldmanager_keyboard_control_plane
  profile_status: proposed_local
```

Runtime observations:

```text
K1 durable-ingress compatibility regression passes on the K3 production plane
K2 settlement/privacy/idempotency/restart regression passes
K2 keyboard/production-projection Playwright regression passes
K3 policy/constitution/manifest/agreement/restart regression passes
K3 keyboard semantic-transparency Playwright regression passes
K4 persisted Direct role/runtime/result/inbox/reconciliation regression passes
K4 unified-response and semantic-zoom Playwright regression passes
production Electron WorldManager launch passes
production Electron launch payload selects `world-manager:*`, not
`world-manager-semantic:*`
missing or malformed launch mode fails closed without choosing a fallback IPC
namespace
semantic mockup coordinator regression passes
semantic renderer desktop/narrow regression passes
Worldmodel convergence games pass
Worldmodel governance integration games pass
dedicated Electron WorldManager launch observed by the operator
```

This evidence proves `WM-K4`: the prior K3 guarantees plus exact compiled
context resolution, persisted Project Manager and WorldManager Direct
sessions/turns, final-message-anchored AgentResult relay, separate deterministic
telemetry, same-result response/inbox identity for delegated roles, visible
provider failure, natural responses without reverse semantic-schema
validation, non-recursive WorldManager conversation, and advisory
reconciliation without proposal or canonical admission.

The K4 provider transport is deterministic in regression. It is not yet the
real-account live acceptance witness. This evidence also does not prove
proposal creation, graph write, canonical policy admission, or execution
stages.

## UX Bundle

### Invariants

```text
one persistent communications plane
one semantic lineage across every projection depth
candidate is never rendered as canonical
activity is never rendered as completion
role provenance remains truthful but visually restrained
required evidence remains same-context reachable before admission
typed text and action controls enter the same decision protocol
the renderer may request but may not mint authority
raw assistant text may propose but may not directly mutate worldstate
private reasoning is never an inspection artifact
failure leaves durable, inspectable partial truth
```

### Morphable choices

```text
project-card geometry
conversation/project width ratio
exact semantic-zoom disclosure control
whether response deltas stream or appear after typed-result validation
compact versus expanded activity display
desktop density and narrow stacking
visual style of proposal revision comparison
```

### Morph axes

```yaml
density: low_by_default_progressive
navigation_mode: simultaneous_context_with_object_focus
information_posture: outcome_first_with_evidence_drilldown
interaction_tempo: keyboard_fast_path_with_governed_review
salience_posture: conversation_decisions_and_state_prominent
state_exposure: progressive_explicit
command_posture: safe_buffered_dual_lane
```

### Region and lane map

```text
bounded WorldManager workbench
├─ status region
│  ├─ world posture lane
│  └─ connection/runtime evidence lane
├─ communications region
│  ├─ unified conversation lane
│  ├─ per-event activity lane
│  └─ keyboard composer / transition-request lane
├─ project awareness region
│  ├─ focused project lane
│  ├─ semi-active background lane
│  └─ inactive project lane
├─ proposal and decision region
│  ├─ candidate artifact lane
│  ├─ advisory/refinement action lane
│  └─ admission action lane
└─ semantic anatomy region
   ├─ ingress/routing lane
   ├─ policy and task-constitution lane
   ├─ agent-instantiation lane
   ├─ result/reconciliation lane
   ├─ worldstate-delta lane
   └─ substrate evidence lane
```

The semantic anatomy region remains an object-centered focus expansion inside
the same bounded workbench.

## Artifact Inventory Decision

### Import unchanged

```text
HierarchicalWorldmodelGraph
WorldmodelGraphProjection
WorldmodelIngressEnvelope
SemanticTargetResolution
WorldmodelDeltaCandidate
WorldmodelPromotionTransition
ManagerTurnBootPacket
ProjectManagerProfile
WorldmodelManagerProfile
DirectSession / DirectTurn
WorkThread
DirectRoleHandoffPacket
DirectWorkerStartTransition
AsyncWorkRegistration
```

### Wrap or extend

```text
DirectLiveTextController
  add a trusted compiled-agent context input
  keep renderer text unable to supply system instructions

Direct context pack
  add direct_compiled_agent_turn policy
  carry AgentInstantiationManifest and admitted context refs

constitutional-policy substrate
  preserve action registry and authorization traces
  adapt settled rules into the richer PolicyObject closure

semantic-ingress substrate
  require one live native semantic discharge action
  keep commit authority outside semantic discharge

WorldManager renderer
  consume production projections
  keep the current calm topology and evidence/admission separation
```

### Build once as production artifacts

```text
WorldManagerControlPlaneStore
WorldManagerService
SemanticEventLedger
WorldManagerRoutingDecision
TaskSettlement
PolicyObject / PolicyException
ResolvedTaskConstitution
RoleTemplateRegistry
AgentInstantiation / AgentInstantiationManifest
AgentResult / CompletionRelayEnvelope
WorldManagerSemanticInboxEntry
PlanProposalRevision
AdmissionRequest / AdmissionDecision
ImplementationContract
WorldManagerWorkbenchProjection
```

## Production Component Topology

Proposed module boundaries:

```text
src/main/direct/worldmanager/
├─ service.js
├─ control-plane-store.js
├─ projection.js
├─ routing.js
├─ completion-relay.js
├─ proposal-lifecycle.js
├─ admission.js
├─ task-constitution.js
├─ agent-world-compiler.js
├─ role-template-registry.js
├─ direct-role-runtime.js
└─ project-bootstrap.js
```

The existing `semantic-mockup.js` remains a dev/test artifact until the real
pipeline reaches parity. It must not be imported into the production service
for authority-bearing transitions.

## WorldManager Control-Plane Store

Use one process-owned SQLite store with WAL and explicit transactions, following
the established Direct SQLite store pattern.

Minimum tables:

```text
wm_events
  semantic_event_id primary key
  lineage_root_id
  event_kind
  presentation_state
  actor_role
  project_id
  parent_event_ids_json
  artifact_refs_json
  previous_ledger_digest
  event_digest
  occurred_at

wm_messages
  message_id primary key
  semantic_event_id
  author_role
  project_id
  text_or_text_ref
  presentation_state
  created_at

wm_candidate_artifacts
  artifact_id
  artifact_kind
  lineage_root_id
  project_id
  revision
  lifecycle
  artifact_json
  artifact_digest
  created_at
  superseded_by_id

wm_inbox
  inbox_entry_id
  semantic_event_id
  agent_result_ref
  delivery_state
  attempts
  lease_owner
  lease_expires_at
  last_error

wm_decisions
  decision_request_id
  semantic_event_id
  target_artifact_ref
  decision_kind
  state
  authority_requirements_json
  decision_ref_json

wm_runtime_bindings
  binding_id
  role_kind
  manager_agent_id
  project_id
  proposal_lineage_id
  direct_session_id
  current_instantiation_ref
  state
```

Required store behavior:

```text
append-only semantic ledger
idempotent ingress by client request id
transactional event + artifact + inbox updates
lease-based inbox consumption
restart-safe projection reconstruction
no last-write-wins semantic admission
no raw provider response body
no credential or private-reasoning storage
```

The worldmodel trust store and WorkThread registry remain separate canonical
owners. Their successful writes are recorded back into the WorldManager ledger
as exact refs.

## Keyboard Ingress Contract

Renderer request:

```ts
type WorldManagerSubmitRequest = {
  schema: "direct_world_manager_submit_request@1";
  clientRequestId: string;
  text: string;
  scopeHint?: {
    projectId?: string;
    proposalId?: string;
    workThreadId?: string;
  };
  expectedProjectionRevision?: number;
  attachmentDraftRefs?: SourceRef[];
};
```

The scope hint constrains routing. It does not bypass semantic settlement or
grant authority.

Submission behavior:

```text
1. validate and durably record the user-authored message
2. return an ingress receipt immediately
3. emit per-event lifecycle updates
4. settle and route asynchronously
5. preserve idempotency across retry/reload
```

The renderer must not wait for the entire multi-role pipeline before the user
message appears.

Keyboard grammar:

```text
Enter:
  submit current text

Shift+Enter:
  insert newline

Escape:
  close the current semantic-anatomy focus or cancel an unsubmitted draft

Tab / Shift+Tab:
  traverse visible evidence, advisory, and admission controls

Enter or Space on a focused action:
  submit the same typed DecisionResponse used by pointer activation
```

No essential transition may require a pointer.

## Settlement And Routing

The router is a bounded semantic-contract selector, not a general solver.

Resolution order:

```text
1. exact deterministic binding
   explicit project/proposal/WorkThread refs
   exact pending-decision target
   explicit renderer scope constraint

2. semantic meta-contract discharge
   world conversation, world introspection, existing-project concern,
   project genesis, clarification, or split
   open type/subtype expressions and free-form semantic dimensions
   finite operational adapter only where the current executor requires one

3. reflective WorldManager settlement
   only when scope, meaning, policy, authority, or cross-project impact is
   materially ambiguous

4. targeted clarification
   when ambiguity remains material
```

Output:

```ts
type WorldManagerRoutingDecision = {
  schema: "direct_world_manager_routing_decision@1";
  routingDecisionId: string;
  semanticEventId: string;
  targetResolutionRef: SourceRef;
  taskSettlementRef: SourceRef;
  selectedRole: string;
  selectedManagerAgentRef: SourceRef;
  deterministicBindings: string[];
  semanticClassifierRef?: SourceRef;
  ambiguityRefs: SourceRef[];
  splitChildEventRefs: SourceRef[];
  decision: "route" | "clarify" | "split" | "remand";
  grantsAuthority: false;
  digest: string;
};
```

The WorldManager discharges one semantic action. The harness validates its
form and references, derives the current K2 `TaskSettlement` adapter, and
admits that adapter as the operative routing object. Semantic discharge cannot
commit graph changes or start workers.

Target correction:

```text
bounded semantic settlement:
  a trusted WorldManager semantic role selecting one native discharge action
  with structurally typed and semantically open arguments

not:
  keyword, greeting, emoji, planning-verb, or implementation-verb tables
```

Exact typed controls and validated refs may still bind mechanically. Natural
language cannot fall back to lexical category membership when semantic ingress
is unavailable.

## Policy Closure And Task Constitution

The existing constitutional-policy and authorization modules provide useful
action-class and decision posture substrate, but they do not yet implement the
full parent-spec `PolicyObject` semantics.

Add:

```text
PolicyObject
PolicyException
PolicySelectorMatch
PolicyPrecedenceDecision
PolicyConflictWitness
ResolvedTaskConstitution
PolicyPromptProjection
PolicyEnforcementProjection
```

Compiler input:

```text
TaskSettlement
authoritative graph revision refs
active PolicyObjects
active bounded exceptions
role identity and authority ceiling
project/work-thread state
requested and inferred effect classes
runtime/tool enforcement capabilities
```

Compiler output:

```text
required actions/evidence
permitted action classes
prohibited action classes
approval-gated action classes
active exceptions
conflicts and remands
completion conditions
escalation conditions
enforcement-strength labels
policy closure digest
```

Planning v0 has no tool or workspace effect capability. It still compiles a
real constitution:

```text
required:
  formulate a project-scoped proposal
  expose open decisions
  return the typed planning result

permitted:
  read the admitted project graph projection
  reason over supplied evidence

forbidden:
  mutate workspace
  mutate remote systems
  admit canonical worldstate
  start implementation
```

This lets the first integration test the compiler without prematurely enabling
execution effects.

## Trusted Role Templates And Agent-World Compilation

The fixed WorldManager constitutional prompt remains code-owned and versioned.

Other roles use trusted templates:

```text
project_manager.planning@1
project_manager.reconciliation_support@1
thread_manager.implementation@1
worker.implementation@1
reviewer.closure@1
```

Renderer text and model output may never supply or modify a trusted role
template.

Compiler:

```text
role template
+ durable actor binding
+ project/task binding
+ ManagerTurnBootPacket
+ ResolvedTaskConstitution
+ authority envelope
+ capability envelope
+ budget
+ evidence-access contract
+ completion evaluator
+ output contract
-> AgentInstantiation
-> AgentInstantiationManifest
-> trusted provider instruction package
```

The planning Project Manager capability envelope is empty. The WorldManager
reconciler is also non-mutating; canonical admission remains a separate
harness-controlled transition.

Projection agreement must fail closed:

```text
prompt prohibition disagrees with tool/capability grant
authority envelope exceeds parent delegation
output contract omits required semantic result
graph projection is stale or belongs to another project
role template or compiler revision is unavailable
completion evaluator cannot observe required evidence
```

## Direct Role Runtime

The production role runtime should wrap the persisted
`DirectLiveTextController`, not call `runTextOnlyDirectProbe` directly.

Required extension:

```text
DirectLiveTextController.startTurn
  accepts a harness-created compiledAgentContextRef
  resolves the referenced admitted AgentInstantiation
  injects the trusted instruction package through context-pack authority
  records manifest and constitution refs in the request manifest
  rejects raw renderer-supplied system/developer instructions
```

Add a context policy:

```text
direct_compiled_agent_turn@1
```

It must preserve:

```text
harness policy
role template projection
project/task constitution projection
current user directive
graph/evidence context
role response contract
```

Each role run receives a real Direct session/turn identity. Runtime binding is
keyed by:

```text
manager agent identity
+ project
+ active proposal or task lineage
+ role-template revision
```

Provider continuity remains an optimization, not the source of semantic
continuity. A restart must rebuild the role context from graph, candidate,
policy, and dialogue artifacts.

## Completion Semantic Relay

The relay is triggered by terminal Direct turn state, not by renderer
observation.

```text
Direct turn terminal
  -> read exact final assistant item
  -> read deterministic telemetry and tool/effect witnesses
  -> validate role output contract
  -> build AgentResult
  -> append agent_result_completed SemanticEvent
  -> render user-facing result when allowed
  -> enqueue the same AgentResult in WorldManager semantic inbox
```

The final assistant message is the semantic anchor. It is not a canonical
worldstate write.

Required distinctions:

```text
semantic payload:
  user-facing response
  proposal/delta candidates
  questions
  claimed outcome

deterministic telemetry:
  session/turn/run identity
  runtime/model/effort evidence
  timestamps and duration
  token evidence
  tool calls
  approvals
  operation/mutation witnesses
  interruption/failure state
```

An empty or failed natural response produces a visible failed AgentResult.
Where a role is explicitly performing a structured semantic discharge, an
invalid discharge form produces a visible remanded AgentResult. Neither may
disappear or create a candidate proposal.

## Planning And Reconciliation Lifecycle

### Initial proposal

```text
user planning request
  -> project/task settlement
  -> Project Manager instantiation
  -> Project Manager AgentResult
  -> response visible in unified conversation
  -> PlanProposalRevision v1 stored as candidate
  -> same AgentResult enters WorldManager inbox
  -> WorldManager reconciliation instantiation
  -> reconciliation result linked to v1
  -> v1 becomes candidate_reconciled or candidate_remanded
```

The WorldManager reconciler evaluates:

```text
alignment with higher user/project goals
cross-project dependencies
standing policy and budget
semantic blind spots
open decisions
globally attractive continuations
```

It does not micro-audit implementation details.

### Refinement

Typed input such as:

```text
"Move the browser adapter later and make policy inheritance feature two."
```

resolves to the active candidate and owning Project Manager:

```text
v1 remains immutable
  -> Project Manager receives v1 plus refinement directive
  -> returns v2
  -> v2 supersedes v1 as current candidate
  -> WorldManager reconciles v2
  -> lineage preserves both revisions
```

No reset or second chat is required.

### Typed admission

Typed input such as:

```text
"Greenlight proposal v2."
```

enters the same settlement path.

If there is one exact target and the user's authority is sufficient:

```text
user message
  -> admission intent settlement
  -> evidence and staleness gate
  -> AdmissionDecision
  -> graph promotion
  -> implementation contract
  -> WorkThread
```

If the user says only `yes`, or multiple decisions are pending:

```text
clarify target
do not infer standing policy
do not admit any candidate
```

The visible Greenlight control is a convenience that emits the same typed
decision request. It has no privileged renderer-only authority path.

## Admission And Canonical Commit

Admission preconditions:

```text
current candidate revision identified exactly
WorldManager reconciliation completed
required evidence is available and same-context reachable
source graph revisions are current or proven compatible
policy closure is not conflicted
admitting role and operator authority are valid
expected worldstate delta is inspectable
affected projects/contracts are identified
idempotency key has not committed a different transition
```

Commit sequence:

```text
1. freeze candidate and expected revisions
2. construct WorldmodelDeltaCandidate
3. contextual audit and authority decision
4. acquire trust-store admission
5. append canonical graph transition
6. persist AdmissionDecision with graph transition ref
7. build ImplementationContract from admitted graph refs
8. upsert actual WorkThread
9. append semantic events for each successful boundary
10. project canonical state to the renderer
```

If graph CAS fails:

```text
candidate remains candidate
no WorkThread is created
stale/conflict posture becomes visible
WorldManager reprojects and reconciles before another commit attempt
```

If WorkThread creation fails after graph admission:

```text
the admitted graph transition remains canonical
contract activation is recorded as failed/pending_repair
the renderer must not pretend admission rolled back
recovery is idempotent from the admission ref
```

## Real Planning Milestone Boundary

The first production milestone ends here:

```text
admitted semantic plan
+ canonical graph transition
+ persisted implementation contract
+ persisted WorkThread in contract_received state
```

It may report:

```text
"Plan admitted. Implementation contract created."
```

It may not report:

```text
"Implementation started."
```

until a real worker-start transition has succeeded.

This is a deliberate correction to the semantic mockup, which currently
creates a synthetic active WorkThread immediately.

## Real Execution Milestone

After the planning milestone is accepted:

```text
ImplementationContract
  -> implementation TaskSettlement
  -> full policy closure
  -> implementation AgentInstantiation
  -> role handoff packet
  -> operator/manager start authority
  -> Direct worker start transition
  -> actual worker session/turn
  -> tool/effect evidence
  -> closure AgentResult
  -> completion evaluator
  -> ProjectMemoryCandidate
  -> Project Manager admission
  -> upward WorldManager status projection
```

Only the successful worker-start result may move the WorkThread from
`contract_received` to `active`.

Only a valid completion evaluator and closure witness may move it to
`completed`.

## Renderer Projection

Replace the mockup snapshot with:

```ts
type WorldManagerWorkbenchProjection = {
  schema: "direct_world_manager_workbench_projection@1";
  projectionRevision: number;
  ledgerHeadDigest: string;
  worldPosture: object;
  projects: object[];
  messages: object[];
  activeLineages: object[];
  candidateArtifacts: object[];
  pendingDecisions: object[];
  workThreads: object[];
  selectedSemanticObject?: object;
  connectionPosture: object;
  omissionWitness: object;
  truthPosture: {
    candidateRenderedAsCanonical: false;
    activityRenderedAsCompletion: false;
    uiMintsAuthority: false;
    rawChainOfThoughtExposed: false;
  };
  projectionDigest: string;
};
```

Projection sources:

```text
WorldManager ledger
candidate store
authoritative graph head
WorkThread registry
async work registry
Direct turn/session projections
operation/mutation evidence
```

The projection must include omissions and degraded-state witnesses. Missing
stores or stale reads cannot render as an empty healthy world.

### Concurrency correction

Remove the global `busy` interaction lock.

Use:

```text
per-lineage active operation
per-role/session active turn lock
serialized canonical graph commit
queued semantic inbox consumption
composer remains available
```

The user may send a message to Project B while Project A reconciliation runs.
The surface shows each event's actual state.

The first implementation may cap live role concurrency to a small fixed
number. It must represent queuing truthfully rather than disabling the entire
world.

## IPC Contract

Production IPC namespace:

```text
world-manager:snapshot
world-manager:submit
world-manager:decision
world-manager:inspect
world-manager:focus-project
world-manager:interrupt
world-manager:retry
world-manager:event
```

Dev/mock namespace remains:

```text
world-manager-semantic:*
```

Do not silently route production IPC to the semantic mockup.

Every mutating request carries:

```text
client request id
target ref when applicable
expected projection/ledger revision
actor identity
renderer-safe summary
```

Every response returns:

```text
accepted/reused/remanded state
semantic event ref
current projection revision
typed blocker when not accepted
```

## Visible State Machine

Primary event states:

```text
received
settling
clarification_required
queued
compiling
role_active
response_available
reconciling
candidate_registered
candidate_reconciled
decision_required
admitting
admitted
contract_created
worker_starting
executing
completion_evaluating
completed
remanded
interrupted
failed
```

State styling:

```text
received/queued/active:
  neutral activity

candidate/reconciling/decision_required:
  provisional

validated:
  evidence-backed but not canonical

admitted/contract_created:
  canonical with admission witness

executing:
  activity only

completed:
  closure-witnessed

ambiguous/stale/conflicted/remanded/failed:
  explicit non-success posture with recovery path
```

## Failure And Recovery

### Router or settlement failure

```text
user message remains visible
event becomes clarification_required, remanded, or failed
no role instantiation starts
```

### Project Manager output-contract failure

```text
turn and telemetry remain inspectable
AgentResult records typed failure
no PlanProposalRevision is created
retry creates a child event, not a hidden replacement
```

### Reconciliation failure

```text
Project Manager response remains visible
proposal remains candidate_reconciliation_failed
admission remains disabled
retry targets the same proposal revision
```

### Restart during active work

On startup:

```text
verify WorldManager event ledger
reopen inbox leases
read authoritative graph heads
read Direct session/turn terminal states
reconcile events marked active against runtime evidence
resume safe inbox work
mark unknown/interrupted work explicitly
rebuild disposable renderer projection
```

No active state may be inferred solely from the last renderer snapshot.

### Duplicate renderer submission

Same `clientRequestId` and same content:

```text
return existing semantic event
do not rerun the model
```

Same `clientRequestId` and different content:

```text
reject as idempotency conflict
```

## Implementation Sequence

### WM-K1: Canonical control plane and bootstrap

Deliver:

```text
WorldManagerControlPlaneStore
semantic event ledger
candidate and inbox tables
project/world bootstrap adapter
production workbench projection skeleton
production IPC snapshot/submit receipt
```

Proof:

```text
typed messages persist across restart
duplicate submit is idempotent
projection is reconstructed, not stored as truth
app projects map to stable ProjectWorld refs
```

### WM-SC1: Fixed semantic ingress

Status: implemented and locally regression-proven on 2026-07-28.

Deliver:

```text
fixed provider-backed WorldManager ingress constitution
validated direct_world_manager_semantic_discharge@1
native required Responses function-action selection
open SemanticTypeExpression persistence
mechanical K2 adapter derivation
atomic semantic-discharge and settlement persistence
ambient versus explicit scope-binding posture
no lexical natural-language fallback
```

Proof:

```text
identical opaque text follows its selected semantic action
live request shape requires exactly one native discharge action
novel proposed semantic subtype persists without remand
project seed does not require creation vocabulary
ambient focus does not capture world conversation
system-introspection questions remain WorldManager/world-scoped
conflicting explicit scope is remanded
mixed meaning validates semantically and materializes durable child contracts
unavailable semantic role creates no inferred category or agent world
canonical discharge arguments persist; raw provider payload and private
reasoning do not
```

Mixed/split child execution is discharged by `WM-SC2b` below.

### WM-SC2: Versioned semantic history and shelves

Status: core catalog implemented and locally regression-proven on 2026-07-29.

Deliver:

```text
SemanticSettlementRevision
SemanticHistoryRelation
append-only relation-state supersession
SemanticShelf materialization and revision
event-to-lane/project/task/object indexing
provisional reconstruction of legacy K2-only history
bounded semantic-history evidence for introspection
renderer-safe catalog posture
```

Proof:

```text
one event can occupy several semantic histories
world conversation does not inherit ambient project membership
project history remains absent from unrelated project shelves
correction supersedes relations without mutating raw events
affected shelves rebuild while prior shelf revisions remain exact evidence
restart preserves the current catalog
legacy reconstruction remains visibly provisional and grants no authority
introspection no longer relies on a privileged previous-row rule
```

### WM-SC2b: Split child-event execution and parent join

Status: implemented and locally regression-proven on 2026-07-29.

Deliver:

```text
persisted semantic child contracts and child events
has_semantic_child history relations
append-only split coordination revisions
independent K2/K3/K4 child execution
recursive split exclusion inside child contracts
typed child-outcome collection
one parent WorldManager closure turn
restart continuation and visible terminal diagnostics
```

Proof:

```text
two meanings settle into different task types and role constitutions
child role results remain lineage evidence rather than extra chat replies
one child may register a non-canonical candidate without admitting it
the parent join receives exact child settlements, results, and candidate refs
only one unified WorldManager answer is rendered
terminal clarification/remand/failure without an AgentResult is never silent
harness diagnostics are visually distinct and grant no authority
```

### WM-SC2b.1: Truthful partial closure and semantic inspection

Status: implemented and locally regression-proven on 2026-07-29.

Deliver:

```text
deterministic compiled-schema discriminator normalization
truthful partially_remanded lifecycle precedence
post-answer incomplete-child diagnostic
renderer-safe project-seed recovery projection
safe-buffered retry preparation
Project Ecology Inspector
candidate-only project identity projection
separate established-project and candidate counts
single-card lifecycle continuity through admission
Decision/Outcome Inspector
inspection-versus-runtime-focus boundary
historical-remand versus current-decision accounting
```

Proof:

```text
all required semantic fields permit injection of the compiled schema label
missing semantic fields still remand
an incomplete child cannot be masked by a completed parent AgentResult
an admitted but unprovisioned project can be inspected but not focused
a reconciled candidate is visible before evidence review or admission
the same project identity advances from candidate to reviewed to admitted
candidate and established-project counts remain distinct
project seeds remain visible without being counted as canonical projects
current project open decisions are individually inspectable
historical remands do not inflate the action-required count
retry remains a reviewable composer draft until the operator submits it
```

This began as a bounded read-model stabilization. Generic decision objects are
implemented by `WM-SC3`, governed transitions by `WM-SC5`, and their general
surface/lens/morph selection is now implemented by `WM-SC6`.

### WM-SC3: Semantic artifact and decision kernel

Status: implemented and locally regression-proven on 2026-07-29.

Delivered:

```text
generic direct_semantic_artifact_header@1
typed OpenDecision, DecisionOption, DecisionDependency, and
DecisionConsequence objects
typed DecisionResolutionContract with mechanical, semantic-relay,
evidence-request, and authority-request modes
append-only revision lineage with active, resolved, superseded, stale, and
conflicted lifecycle state
idempotent migration from manager openDecisions and operational wm_decisions
current OpenDecision refs in project_open_decisions shelves
typed same-context decision inspection
```

The semantic registry is additive. Existing `wm_decisions` rows remain the
operational compatibility bridge for clarification and project admission.
Their SC3 counterparts canonically state that a decision exists. Every
artifact and resolution contract grants no authority; SC5 executes only the
governed semantic transition selected by that contract.

### WM-SC4: Context import and operational meta-context

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
task-compiled ContextRequirementSet
typed read-only IMPORT_CONTEXT operation
SemanticContextBundle and selection witness
OperationalMetaContextManifest per agent instantiation
attention-budget, raw-evidence, and exact-scope enforcement
immutable dependency-keyed cache with stale/current posture
Direct context-pack and request-manifest lineage
read-only operational-meta-context ribbon and semantic-zoom evidence
world-governed project-ecology status/comparison/planning settlement
bounded user_world_project_ecology status shelf
```

SC4 runs after semantic settlement and K3 constitution compilation, before the
responsible role turn. It retrieves mechanically from the shelves admitted for
the exact settled world/project/task anchors. Other project shelves are
recorded as exclusions, not silently available context. The bounded bundle is
projected into provider input as quoted semantic evidence and never changes
the compiled role, policy closure, capabilities, authority, worldstate, or
current user directive.

World scope is an authority boundary, not a declaration that project evidence
is irrelevant. A request about several projects or the portfolio as a whole is
settled through `wm_discharge_project_ecology_concern` as
`project_ecology_status`, `cross_project_comparison`, or
`portfolio_planning`. SC4 then imports `user_world_project_ecology`, whose
typed `ProjectStatus` objects cover configured projects, semantic candidates,
admitted constitutions, lifecycle posture, substrate binding, and bounded
open-decision counts. It never imports the projects' private durable-history
shelves. Ordinary `world_conversation` still receives no ambient portfolio
state.

The same import path is used for the first manager role and the WorldManager
reconciliation role. After the persisted Direct turn builds its request
manifest, a separate exact link records which operational meta-context was
actually present. The renderer shows only refs, counts, omissions, freshness,
budget, and linkage state.

Proof:

```text
npm run direct:world-manager-semantic-context
npm run direct:world-manager-k3
npm run direct:world-manager-k4
```

### WM-SC5: Governed decision transitions

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
typed DecisionTransitionRequest and append-only DecisionTransitionReceipt
exact mechanical option resolution with a two-gesture UI gate
scoped semantic-relay, evidence-request, and authority-request envelopes
expected decision/projection revision and idempotency enforcement
durable decision-resolution history relations
open-decision shelf rebuild after resolution
semantic and operational context-cache invalidation after resolution
recent transition receipts in the Decision / Outcome inspector
```

A mechanical transition revises only the canonical semantic decision. It does
not execute any consequence described by the selected option. Non-mechanical
transitions preserve the user's exact text, bind the exact decision as an
explicit scope constraint, and re-enter ordinary WorldManager semantic
ingress under a deterministic retry identity. Evidence and authority requests
remain requests; neither path grants what it asks for.

Semantic project identity and role-runtime addressability are separate
properties. A decision may belong to a canonical or candidate project that
has not yet been provisioned as a runnable project. Such a relay therefore
does not place the unprovisioned project into ordinary project-runtime scope.
It selects the dedicated semantic-decision meta-contract at user-world scope,
imports the exact `OpenDecision` revision as an explicit artifact binding, and
lets the WorldManager deliberate about that object. Project Manager launch and
project effects remain unavailable until provisioning.

Proof:

```text
npm run direct:world-manager-decision-transition
npm run direct:world-manager-decision-transition-ui
```

### WM-SC6: Semantic surface compiler

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
versioned SemanticSurfaceProjection and MorphResolver registry
four O/E/D/U SemanticLensProjection objects per compiled semantic object
exact SemanticProjectionWitness and SemanticRegionBinding objects
binary, choice-card, comparison, scoped-composer, and status-card live morphs
OpenDecision, ProjectConstitutionCandidate, ProjectConstitution, and
DecisionTransitionReceipt compiler inputs
inline conversation artifacts anchored to exact semantic events
global Decision Dock and project-level decision indicators
same exact object identity across compact, expanded, and responsive views
exact region binding on decision transitions and project-genesis review/admit
```

SC6 is a projection compiler over canonical semantic state, not a second state
store and not a raw graph renderer. The selected O/E/D/U lens changes promoted
relations, semantic sections, boundary signals, and the exact spatial binding;
it never changes the subject identity, semantic lifecycle, or authority.
Surface state such as selected lens and expansion remains local. Semantic
transitions continue through SC5, and project-genesis review/admission
continue through their existing service gates.

The renderer now consumes compiled surfaces for the Decision / Outcome
inspector, transition receipts, project-genesis card, inline artifacts,
Decision Dock, and project attention indicators. A free-form contribution
submitted inside a semantic region carries both its exact region binding and
its open semantic text. This permits indexical input such as `reassess this`
without temporal guessing while still failing closed on a stale or forged
object revision.

Tree and graph remained lawful registry families without a fabricated live
mapping in SC6. The subsequent SC7 slice now activates both only for typed ARO
branch hierarchy and realization-coverage objects.

Proof:

```text
npm run check:world-manager-semantic-surface-syntax
npm run direct:world-manager-semantic-surface
npm run direct:world-manager-semantic-surface-ui
npm run direct:world-manager-decision-transition
npm run direct:world-manager-project-genesis
```

### WM-SC7: Abstract Reasoning Object registry and reconstruction

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
typed AbstractReasoningObject, AroBranch, AroEdge, AroRealizationBinding,
AroCoverageWitness, AroReconstructionCandidate, review/admission receipt, and
current/target comparison contracts
append-only SQLite candidate and canonical ARO revisions
separate evidence and contradiction review states
exact candidate digest, expected revision, and SemanticRegionBinding gates
semantic-registry-only operator admission with no code or downstream effects
source-revision drift detection and stale realization-binding revision
safe workbench ARO registry projection and project-level ARO indicators
live candidate comparison, intensional tree, realization graph, and
current/target comparison morphs
compact ARO navigator with one bounded focused-object evidence lane
inline semantic-object controls focus the exact inspected identity
same-context evidence and contradiction inspection
responsive identity preservation and renderer-free semantic authoring boundary
```

The ARO registry is a semantic state store, not a code index. Required,
possible, and counterfactual branches remain distinct from their source, test,
documentation, and runtime realizations. Current and target AROs remain
separate canonical identities joined by project and concept. A source digest
change stales the affected realization binding; it does not silently rewrite
or erase the abstract object.

The UI may inspect, record review, and explicitly admit an already authored
reconstruction. It cannot submit arbitrary ARO JSON. Candidate registration is
a harness-internal acceptance port for a bounded semantic producer. SC7.1 now
connects that port to a substrate-native repository observation and Direct
semantic action; the renderer still cannot author reconstruction meaning.

Proof:

```text
npm run check:world-manager-aro-syntax
npm run direct:world-manager-aro
npm run direct:world-manager-aro-ui
npm run direct:world-manager-semantic-surface
npm run direct:world-manager-semantic-surface-ui
```

### WM-SC7.1: automatic repository reconstruction runtime

Status: implemented and locally regression-proven on 2026-07-30.

Delivered:

```text
native WSL/Windows/local resident-agent repository observation
bounded secret-filtered RepositorySemanticSnapshot
project + snapshot-digest idempotent bootstrap scheduling
required native wm_discharge_aro_reconstruction semantic action
open-vocabulary branch content with exact evidence-key validation
append-only scheduled/running/completed/remanded/failed run revisions
restart recovery and completed-run reuse
source-ref digest drift -> affected realization staleness
surface-lifetime transition subscription for background projection freshness
truthful producer status, failure, and exact-run retry in the ARO inspector
no renderer-authored fallback, code mutation, admission, or authority grant
```

The background producer does not block keyboard interaction. It runs once per
configured project during process bootstrap. A failed/remanded run is visible
and remains still until the operator asks to re-observe and retry. Retry does
not review or admit the resulting ARO.

Proof:

```text
npm run check:world-manager-aro-reconstruction-runtime-syntax
npm run direct:world-manager-aro-reconstruction-runtime
npm run direct:world-manager-aro-reconstruction-runtime-ui
```

### WM-SC7.2: governed current-to-target definition

Status: implemented and locally regression-proven on 2026-07-30.

The keyboard surface makes the current/target comparison reachable from the
focused canonical current ARO:

```text
focus exact current ARO
  -> write free-form target intent
  -> Draft target posture
  -> inspect provisional target candidate
  -> record evidence/contradiction review
  -> explicitly admit target ARO
  -> open derived current/target comparison
```

The Direct role uses one required native
`wm_discharge_aro_target_definition` action. Its output form is typed while its
semantic vocabulary remains open. The harness fixes the project and concept,
resolves any cited current branch key to an exact branch ref, forces target
posture, creates no realization bindings, and binds the candidate back to the
exact current ARO. Invalid or invented current-branch lineage remands the
result.

The durable run is idempotent by exact current digest, optional canonical
target-baseline digest, and target-intent digest, has bounded retry, and turns
interrupted scheduled/running state into visible retryable failure after
restart. A later target revision therefore opens a new definition epoch even
when earlier wording is reused. The role can only register a provisional
candidate. Existing review and explicit operator admission remain the only
path into the canonical semantic registry.

The comparison navigator is now present even when empty and states its exact
missing prerequisite. Candidate coverage remains inside the candidate surface;
the canonical registry navigator contains only canonical AROs and their
coverage.

Proof:

```text
npm run check:world-manager-aro-target-definition-syntax
npm run direct:world-manager-aro-target-definition
npm run direct:world-manager-aro-target-definition-ui
```

No target-definition request inspects source, creates realization bindings,
admits semantic state, compiles a mutation contract, launches a worker, mutates
the workspace, validates semantic truth, or grants execution authority.

### WM-SC8.1: exact ARO mutation-contract compilation

Status: implemented and locally regression-proven on 2026-07-30.

The keyboard surface adds one bounded action inside the focused
current/target-comparison region:

```text
Compile provisional mutation contract
```

The renderer sends only the exact project id, comparison id/digest, and current
`SemanticRegionBinding` ref. It cannot supply role instructions, semantic
obligations, source paths, tools, or authority. The service rebuilds the
comparison from the current canonical ARO registry and rejects stale or
cross-object bindings before scheduling the Direct semantic turn.

The harness mechanically derives the mutation delta. A fixed Direct compiler
then calls exactly `wm_discharge_aro_mutation_contract` to author
open-vocabulary implementation obligations, preservation constraints, and
verification requirements. Structural validation requires complete operative
target-branch coverage and an explicit disposition for every current-only
branch. It does not reverse-enforce a closed semantic taxonomy.

Both `AroMutationCompilationRun` and `AroMutationContract` are append-only
SQLite revisions. Runs are exact-comparison-idempotent, restart recoverable,
bounded to three attempts, and explicitly retryable only after visible failure
or remand. The contract remains `candidate / pending review`.

The focused workbench shows:

```text
exact current -> comparison -> target digest lineage
optional repository-snapshot provenance
mechanically derived semantic delta
contract strategy
implementation obligations and exact branch counts
verification requirements and evidence kinds
preservation constraints, assumptions, and unresolved questions
SC8.2 realization-import entrypoint
```

Authority boundary:

```text
no source inspection
no worker launch
no workspace mutation
no canonical admission
no semantic-truth claim
no renderer-authored contract content
```

Proof:

```text
npm run check:world-manager-aro-mutation-contract-syntax
npm run direct:world-manager-aro-mutation-contract
npm run direct:world-manager-aro-mutation-contract-ui
```

### WM-SC8.2: realization-context import and ARO-to-code mapping

Status: implemented and locally regression-proven on 2026-07-31.

The service imports only source paths selected by the exact current/target ARO
and contract lineage, retains source excerpts in the backend, and requires one
native Direct semantic mapping discharge. It persists immutable source
identity plus append-only file/symbol/range mapping witnesses, then projects
only safe source identity, coverage, ambiguity, omission, and freshness
evidence into the focused workbench.

SC8.2 is read-only. It neither launches a worker nor grants execution,
workspace, remote, semantic-admission, or closure authority.

Proof:

```text
npm run check:world-manager-aro-realization-mapping-syntax
npm run direct:world-manager-aro-realization-mapping
npm run direct:world-manager-aro-realization-mapping-ui
```

### WM-SC8.3: reviewed constitution and bounded native worker handoff

Status: implemented and locally regression-proven on 2026-07-31.

The evidence lane refreshes exact mapped-source identity and project Direct
capabilities before compiling an immutable worker constitution. A separate
operator action authorizes one start only. The service creates one exact ARO
WorkThread and hands the compiled context to the existing native Direct
implementation lane. Read, patch, and command calls retain their independent
per-call approval gates.

The renderer may display constitution, authority, budget, completion, worker
lineage, and pending effect requests. It cannot author the constitution,
select different sources, mint start authority, or approve an effect without
an exact operator action. A handed-off run claims only worker/provider start;
workspace mutation, remote mutation, canonical admission, semantic-truth
validation, and closure remain false.

Proof:

```text
npm run check:world-manager-aro-worker-handoff-syntax
npm run direct:world-manager-aro-worker-handoff
npm run direct:world-manager-aro-worker-handoff-ui
```

### WM-SC8.4: exact realization-evidence acquisition

Status: implemented and locally regression-proven on 2026-07-31.

The focused ARO workbench can request a read-only observation bound to the
exact handed-off worker run and semantic region. The service reads the durable
Direct session/turn and its approved read/patch/command results, imports the
existing workspace-effect summaries, observes the mapped repository after
state, and persists an immutable `AroExecutionEvidenceBundle` plus an
append-only acquisition run.

Active turns terminate the acquisition as `observing`; terminal turns produce
`acquired`. Both states expose mechanical required-evidence-kind
presence/absence/ambiguity and truthful workspace-mutation observation. They
do not evaluate the verification claim, preservation constraints, semantic
truth, closure, or canonical admission.

The renderer uses one compact summary and four switchable semantic lenses:
Turn, Tools & effects, Repository, and Coverage. Refreshing the witness grants
no new tool or effect authority; the existing per-call decisions remain the
only action-bearing lane.

Proof:

```text
npm run check:world-manager-aro-execution-evidence-syntax
npm run direct:world-manager-aro-execution-evidence
npm run direct:world-manager-aro-execution-evidence-ui
```

### WM-K2: Typed settlement adaptation and graph-first manager context

Deliver:

```text
semantic settlement -> K2 task adapter
routing decision
TaskSettlement
exact typed scope and identifier validation
WorldmodelIngressEnvelope integration
actual World/Project Manager profiles
actual graph projection and ManagerTurnBootPacket
clarification/remand path
```

Proof:

```text
project A request never receives project B private nodes
explicit project constraint wins over ambient focus
ambiguous "yes" does not admit
restart rebuilds manager context without transcript replay
```

### WM-K3: Policy and agent-world compilation

Status: implemented and locally regression-proven on 2026-07-26.

Deliver:

```text
PolicyObject and exception adapter
ResolvedTaskConstitution
trusted role templates
AgentInstantiation and manifest
projection-agreement validator
direct_compiled_agent_turn context policy
```

Proof:

```text
planning Project Manager has no mutation tools
prompt/capability/authority disagreement blocks launch
manifest identifies exact graph and policy revisions
renderer cannot inject role/system instructions
```

Production evidence:

```text
npm run check:world-manager-k3-syntax
npm run direct:world-manager-k3
npm run direct:world-manager-k3-ui
```

The agreement witness may report `launchEligible: true`, but its launch
boundary is `ready_for_k4_runtime_only`; K3 itself never starts a role runtime.

### WM-K4: Persisted Direct role runtime and completion relay

Status: implemented and locally regression-proven on 2026-07-26. The real
account live acceptance witness remains pending.

Deliver:

```text
DirectRoleRuntime adapter
persisted Project Manager session/turn
terminal-turn AgentResult builder
semantic inbox
immediate unified response projection
WorldManager reconciliation run
```

Proof:

```text
final message and telemetry remain separate
same delegated-role AgentResult renders and enters inbox
provider failure remains visible
natural answer is not reverse-validated as semantic JSON
delegated role output enters WorldManager semantic reconciliation
WorldManager-owned conversation does not recursively reconcile itself
invalid semantic-action form creates no proposal
production and semantic-mockup launch envelopes remain explicit and disjoint
renderer cannot infer semantic-mockup mode from an absent production marker
real-account live authenticated planning turn remains the promotion gate
```

Production evidence:

```text
npm run check:world-manager-k4-syntax
npm run direct:world-manager-k4
npm run direct:world-manager-k4-ui
npm run direct:world-manager-launch-routing
```

The deterministic gate exercises the authenticated Direct controller,
persisted session/turn/context-manifest path, streaming normalizer, terminal
relay, and failure cases with a controlled provider transport. The production
app uses the same `DirectRoleRuntime` with the configured account and endpoint.

### WM-K5: Proposal refinement and real admission

Current bounded status: `WM-K5A` and `WM-K5B` are implemented for proposal registration,
revision/supersession, evidence review, production control admission, canonical
graph CAS, durable contract creation, `contract_received` WorkThread creation,
restart recovery, renderer truth, and exact typed natural-language admission
through the same service protocol.

Deliver:

```text
PlanProposalRevision lifecycle
typed refinement targeting
natural-language and control decision parity
evidence/staleness gate
WorldmodelDeltaCandidate promotion
actual graph transition
ImplementationContract
actual WorkThread in contract_received
```

Proof:

```text
v1 remains immutable after v2
candidate never appears in admitted graph truth
typed "greenlight v2" and focused control use one decision protocol
CAS failure creates no WorkThread
restart preserves admitted plan and contract lineage
```

Local gates:

```text
npm run check:world-manager-k5-syntax
npm run direct:world-manager-k5
npm run direct:world-manager-k5b
npm run direct:world-manager-k5-ui
```

### WM-K6: Real execution continuation

Status: implemented and locally regression-proven on 2026-08-11.

Deliver:

```text
implementation task constitution
role handoff packet
worker-start transition
actual implementation session
tool/effect enforcement
completion evaluator
project-memory admission and upward status
```

Proof:

```text
WorkThread becomes active only after worker start
local-only policy is reflected in prompt, tools, approval, and evaluator
completion requires closure witnesses
worker result cannot write project/world state directly
```

The implemented state machine is:

```text
prepared
  -> starting
  -> active
  -> completed
  -> admitted
```

Preparation persists the compiled constitution and role handoff but starts no
provider call. One exact operator action may authorize the start transition.
The WorkThread becomes `active` only after the Direct controller returns a
valid worker-start result. Reads, patches, and commands remain independent
per-call requests; remote mutation, recursive worker spawning, worker
self-certification, and worker canonical writes remain unavailable.

Closure is not inferred from terminal activity. The fixed Project Manager
closure assessor in `plan-execution-closure-runtime.js` receives the admitted
criteria, final worker message, and an exact runtime-evidence catalog. It
authors open semantic assessments through a typed action, while the harness
mechanically requires a valid evidence witness for every criterion. Unknown
evidence identifiers fail closed, and renderer-supplied witness claims are
ignored rather than treated as closure authority. Failed or incomplete
coverage remands the active WorkThread. Complete coverage closes the
WorkThread, constructs a typed project-memory candidate, admits it through
project-scoped trust-store CAS, and returns a project-to-world status
projection.

Durable execution revisions live in the WorldManager SQLite control plane and
recover without replaying an uncertain worker start. The production renderer
exposes separate Compile, Authorize worker start, and Evaluate closure actions
and renders the distinct `wm_k6_execution` posture.

Proof commands:

```bash
npm run check:world-manager-k6-execution-syntax
npm run direct:world-manager-k6-execution
npm run direct:world-manager-k6-execution-ui
```

### WM-K7: Renderer hardening and multi-project concurrency

Deliver:

```text
production projection in the minimal renderer
per-event activity
multi-project queued/background posture
object-centered semantic zoom over production refs
interrupt/retry/recovery controls
narrow responsive preservation
```

Proof:

```text
composer remains usable while background reconciliation runs
Project A and Project B events remain distinct
required evidence is keyboard reachable before admission
no route transition is required for semantic anatomy
```

## First End-To-End Keyboard Acceptance Game

Seed:

```text
one authoritative UserWorld
Project A and Project B
durable World and Project Manager identities
one admitted Project A standing preference
no active proposal
no implementation worker
```

Scenario:

1. Launch the production WorldManager surface.
2. Type `Plan the next five features for Project A` and press Enter.
3. The user message appears immediately with one semantic lineage id.
4. The request settles to Project A / project planning / Project Manager.
5. The evidence view exposes the actual graph projection, task constitution,
   role template, and AgentInstantiationManifest.
6. A persisted Direct Project Manager turn completes.
7. Its final response appears in the unified conversation.
8. The same AgentResult enters the WorldManager semantic inbox.
9. Reconciliation completes and proposal v1 remains candidate.
10. Type a refinement targeting one feature.
11. Proposal v2 supersedes v1; both remain inspectable.
12. Inspect v2 evidence without leaving the workbench.
13. Type `Greenlight proposal v2`.
14. Admission creates an actual graph transition, implementation contract, and
    WorkThread in `contract_received`.
15. Restart Electron.
16. The admitted plan, proposal history, message lineage, and WorkThread
    reconstruct from canonical stores.
17. Project B private state never appears in Project A's compiled context.

Pass condition:

```text
one keyboard-driven relationship
+ truthful multi-role formulation
+ actual Direct cognition
+ actual semantic relay
+ actual governed admission
+ actual persistent world/work identity
```

Workspace mutation is not required for this first game.

## Negative Acceptance Games

```text
ambiguous project target
ambiguous "yes" with multiple decisions
semantic router emits invalid action form
Project Manager prose is accepted as the natural response anchor
WorldManager reconciliation emits invalid semantic-discharge form
reconciliation transport fails after response is visible
graph revision changes before admission
policy closure conflicts
renderer retries identical request
renderer reuses idempotency key with different text
app restarts during Project Manager turn
app restarts with leased inbox entry
WorkThread write fails after graph admission
Project B private node is requested by Project A role
renderer attempts system-instruction injection
candidate styling is forged as canonical
active worker is forged as completed
```

Each game must produce a typed remand/failure/recovery witness, not merely an
exception string.

## Verification Layers

### Unit

```text
schema and digest validation
ledger chaining and idempotency
policy matching/precedence/exception
agent-world projection agreement
proposal revision/supersession
decision targeting
completion relay reduction
```

### Deterministic integration

Use deterministic role runners with:

```text
real control-plane store
real worldmodel trust store
real graph projection
real manager turn boot
real policy and agent compilers
real Direct session/turn persistence adapter
real graph admission
real WorkThread registry
```

The model may be deterministic; the orchestration and stores must not be mock
reimplementations.

### Electron/Playwright

Prove:

```text
keyboard submit and refinement
keyboard-only evidence traversal
typed admission
candidate/canonical distinction
failure and retry
restart reconstruction
narrow same-context evidence reachability
multi-project background state
```

### Live Direct

An opt-in authenticated acceptance must prove:

```text
actual configured model and effort
actual Direct session/turn ids
actual request manifest with AgentInstantiation refs
actual final assistant anchor
actual usage/telemetry evidence
actual WorldManager inbox relay
no silent fallback to deterministic fixture
```

## Evidence-Before-Commit Plan

Before admission, the selected proposal view must expose or make
same-context reachable:

```text
exact proposal revision
source user intent
TaskSettlement
routing decision
applicable graph revision
ResolvedTaskConstitution
Project Manager AgentInstantiationManifest
Project Manager AgentResult
WorldManager reconciliation
policy conflict/exception summary
expected graph delta
affected project and future WorkThread
admitting authority
```

Inspection remains non-mutating. Merely opening the anatomy does not admit the
proposal.

## Authority Boundary Plan

```text
renderer:
  requests transitions
  mints no authority

semantic router:
  proposes settlement
  mints no authority

Project Manager:
  formulates and revises project proposals
  cannot admit global/canonical state

WorldManager reconciler:
  evaluates higher posture
  cannot treat its prose as a graph write

operator decision:
  supplies user authority for the exact admitted scope

WorldManager admission service:
  validates authority, evidence, policy, and revision
  performs the canonical transition through the trust store

worker:
  acts only inside the compiled implementation constitution
  returns evidence and candidates
  writes neither project nor user-world truth directly
```

## Responsive Preservation

Desktop remains primary.

At narrow widths:

```text
conversation
  -> selected candidate/decision
  -> focused project
  -> project periphery
  -> semantic anatomy
```

The composer, current scope, pending-decision posture, exact candidate, and
required evidence remain reachable without route replacement.

Semantic anatomy may temporarily cover lower-priority project periphery. It
must not cover an equal-priority candidate or admission control without
providing an immediate keyboard return.

## Non-Goals

This spec does not include:

```text
live voice
app-server voice entitlement integration
browser/computer control
production multi-process graph locking
automatic import of historical chats into worldstate
ambient full-graph model context
private chain-of-thought display
general autonomous project execution without explicit contracts
automatic standing-policy creation from casual text
automatic worker start merely because a plan was admitted
replacement of all existing Codex/App Server surfaces
```

## Completion Gate

The keyboard pipeline is accepted only when:

```text
the first end-to-end keyboard game passes deterministically
the same planning path passes with live Direct auth
all authority-bearing writes use production stores
restart reconstruction passes
candidate/admitted/activity/completed truth remains distinct
project privacy and scoped graph projection pass
typed admission and control admission share one protocol
the real WorkThread remains contract_received until real worker start
the semantic mockup is no longer required for production WorldManager IPC
voice can later attach without changing the canonical semantic pipeline
```

Compactly:

> First make typed conversation a real constitutional control plane. Then let
> voice become another transport into the same world.
