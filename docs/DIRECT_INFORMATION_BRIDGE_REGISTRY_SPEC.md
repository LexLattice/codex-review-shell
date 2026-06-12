# Direct Information Bridge Registry Spec

Status: companion registry and spec-gate layer for
[DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md).

Source inputs:

- [DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
- GPTPro expanded ODEU design in
  `docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION_GPTPRO.md`

## Purpose

The constitution defines the root law:

```text
No storage primitive before information role.
No context inclusion before authority class.
No action transition before evidence and replay law.
No UI projection before source/provenance boundary.
```

This spec defines the operational registry gate every future direct-path feature
should pass before selecting a database table, JSON artifact, UI surface,
context-pack source, tool executor, hook, skill, or agent prompt.

The implementation substrate is downstream:

```text
ODEU information structure
  -> artifact classes
  -> persistence/retrieval law
  -> context/use law
  -> authority/action law
  -> implementation substrate
```

## ODEU Axes For Information Classes

Every durable or semi-durable information class in the direct harness must be
described through four axes.

### O — Ontology

What kind of information is this?

```text
event
state
projection
context
memory
policy
capability
request
response
obligation
decision
action result
world mutation
diagnostic
```

Ontology defines:

- identity;
- source world;
- schema and version;
- object/work-thread scope;
- cited source artifacts;
- artifact family.

### D — Deontics

What may happen with it?

```text
who may create it
who may mutate it
who may read it
whether renderer may see it
whether provider may see it
whether it may enter context
whether it may authorize action
whether it may be compacted
whether it may be deleted
```

Deontics enforces the bridge invariants:

```text
provider response is not local action authority
model intent is not permission
human approval is not proof of outcome
tool result is not proof that the provider saw the result
context inclusion is not endorsement
compaction is authorized loss
```

### E — Epistemics

How do we know it, and how strongly?

```text
exact
provider-reported
runtime-probed
accepted profile
derived
diagnostic
fixture-only
unknown
stale
corrupt
contradictory
```

Epistemics defines:

- provenance;
- confidence;
- contradiction policy;
- expiration/staleness policy;
- missing/corrupt behavior;
- required evidence.

### U — Utility

Why do we keep, compute, retrieve, or expose it?

```text
recovery
context construction
human UI
search
workbench organization
audit
governance
routing
tool authorization
workspace mutation truth
usage/quota status
memory
compaction
sub-agent observability
```

Utility prevents storage hoarding. If durable information has no declared
utility, it should not be durable.

## Bridge Information Class Registry

Every durable information class should have a registry record.

```ts
type BridgeInformationClass = {
  id: string;
  name: string;

  role:
    | "canonical_evidence"
    | "derived_projection"
    | "context_construction"
    | "authority_gate"
    | "action_executor"
    | "memory_continuity"
    | "observability_surface"
    | "governance_routing";

  ontology: {
    objectKind: string;
    identityFields: string[];
    schema: string;
    version: string;
    sourceWorld:
      | "human_interface"
      | "model_provider"
      | "workspace"
      | "harness"
      | "connector"
      | "sub_agent"
      | "derived";
  };

  deontics: {
    creator: string[];
    mutator: string[];
    consumers: string[];
    rendererExposure: "none" | "summary" | "projection" | "private_diagnostic";
    providerExposure: "never" | "context_only" | "tool_result" | "request_manifest";
    mayAuthorizeAction: boolean;
    mayEnterContext: boolean;
    mayBeCompacted: boolean;
    mayBeDeleted: boolean;
  };

  epistemics: {
    sourceOfTruth: "canonical" | "derived" | "diagnostic" | "external";
    confidence:
      | "exact"
      | "provider_reported"
      | "runtime_probed"
      | "accepted_profile"
      | "derived"
      | "diagnostic"
      | "fixture"
      | "unknown";
    requiredEvidence: string[];
    expirationRule?: string;
    contradictionPolicy: "block" | "degrade" | "surface" | "ignore_never";
  };

  utility: {
    purposes: Array<
      | "recovery"
      | "context"
      | "ui"
      | "search"
      | "audit"
      | "routing"
      | "tool_authority"
      | "workspace_truth"
      | "memory"
      | "usage_status"
    >;
    retention: RetentionPolicy;
    retrievalModes: RetrievalMode[];
  };

  implementationHint: {
    canonicalStore?: "jsonl" | "append_json" | "journal" | "ledger";
    projectionStore?: "sqlite" | "materialized_json";
    contextStore?: "context_pack";
    requestStore?: "request_manifest";
    uiStore?: "ephemeral_renderer";
  };
};
```

`implementationHint` is last. It is not the definition.

## Canonical Information Classes

### IC-1: Canonical Event Evidence

Role:

```text
preserve what happened
```

Examples:

- provider stream event;
- normalized model event;
- turn started/completed;
- tool call observed;
- approval decision;
- patch journal event;
- command execution record;
- workspace effect summary;
- operation ledger event;
- request/response envelope evidence when safe.

Default persistence:

```text
append-safe JSON artifact
operation ledger
journal artifact
event JSONL
```

Rules:

- Canonical evidence is append-safe or explicitly versioned.
- Canonical evidence is source for recovery.
- Canonical evidence may be private.
- Renderer projection is separate.
- Canonical evidence does not enter context directly; a context construction
  mechanism selects it.
- Canonical evidence can prove that an action happened, but it does not
  automatically authorize another action.

### IC-2: Derived Projection

Role:

```text
make canonical evidence usable
```

Examples:

- renderer transcript projection;
- thread list/index;
- current workbench status;
- operation history page;
- sub-agent graph projection;
- usage summary;
- compact transcript projection.

Default persistence:

```text
SQLite row
projection artifact
search index
status projection
```

Rules:

- Projections are rebuildable.
- Projections cite source spans, policy versions, and digests.
- Projections never outrank canonical evidence.
- Renderer projections are not model context by themselves.
- A projection may feed a context builder only if the builder declares it as a
  lawful source and records relevant omission/compression decisions.
- A projection may show an approval button, but it may not be the approval
  authority.

### IC-3: Context Construction Artifact

Role:

```text
compile selected bridge information into model-consumable input
```

Examples:

- context pack;
- request manifest;
- recent dialogue context;
- tool continuation context;
- fork/checkpoint context;
- repair-loop context;
- governance-context projection.

Default persistence:

```text
context pack artifact
request manifest artifact
provider input projection digest
```

Rules:

- Context pack records what the model was given.
- Request manifest records why the request was lawful.
- Raw histories are not normal prompt-construction inputs.
- Context inclusion does not create truth or action authority.
- Context construction is the only lawful path into model input.
- A context pack can carry authority statements only when those statements come
  from authority-qualified sources.

### IC-4: Memory / Compaction / Baton / Frontier

Role:

```text
manage continuity under context pressure
```

Distinctions:

```text
memory = information with persistence
compaction = information with authorized compression
baton = information with frontier relevance
obligation context = information with unresolved authority/action status
risk surface = stale or incomplete evidence
omission ledger = explicit record of material loss
```

Default persistence:

```text
durable_thread_memory@1
context_maintenance_manifest@1
context_omission_ledger@1
frontier_baton@1
compaction artifact
trim plan
```

Rules:

- Memory is evidence, not source truth.
- Memory entries cite sources and can become stale or contradicted.
- Memory cannot silently override current evidence.
- Compaction declares source spans, policy, omissions, and residual risk.
- Model-generated summaries cannot replace canonical evidence.
- Baton preserves the active frontier: current objective, open obligations,
  unresolved risks, and next expected action.
- Baton is not replay authority and not tool approval.
- Required artifact omissions block context build.
- Omission count must match context pack omitted counts when those counts are
  represented.

### IC-5: Authority Gate

Role:

```text
decide whether a transition may occur
```

Examples:

- approval card;
- semantic broker;
- governance packet;
- provider capability profile;
- sandbox policy;
- replay safety classifier;
- work-thread resolver;
- runtime evidence resolver.

Default persistence:

```text
authority decision record
policy snapshot
capability evidence record
approval token
replay classifier report
governance packet
semantic broker packet
```

Rules:

- Authority gates are main-process or backend mediated.
- Renderer affordance is not authority.
- Preference is not runtime capability.
- Unknown fails closed for mutation.
- Authority gates may be described in context, but context does not become the
  gate.
- Every action transition needs an authority gate.

### IC-6: Action Executor

Role:

```text
materialize authorized information as world change
```

Examples:

- read-file executor;
- patch apply executor;
- command executor;
- workspace staging writer;
- hook runner;
- bridge macro.

Default persistence:

```text
action result artifact
patch journal
command record
workspace effect summary
tool result envelope
```

Rules:

- Executors require explicit authority input.
- Executors emit outcome evidence.
- Executors are idempotency-aware where replay is possible.
- Failed, interrupted, and unknown outcomes are not success.
- Action outcome may enter context as evidence, not as instruction.
- Executor cannot mint its own authority.

### IC-7: Observability Surface

Role:

```text
make bridge state inspectable by the human
```

Examples:

- Codex transcript;
- runtime status;
- bottom usage/access band;
- analytics tab;
- direct thread workbench;
- sub-agent panel;
- recovery diagnostics;
- approval cards;
- witness chips.

Default persistence:

```text
renderer-safe projection
status projection
operation-history projection
diagnostic report
```

Rules:

- UI state is projection, not truth.
- UI may express authority, not mint it.
- Missing evidence renders unknown, unavailable, degraded, or blocked.
- Action surfaces show state transitions and failure posture.
- Observability surfaces do not enter context by themselves.
- No UI string is action authority.

### IC-8: Governance And Routing

Role:

```text
route information to the right work world, role, context, and authority boundary
```

Examples:

- project broker;
- work-thread resolver;
- semantic broker;
- meta-session controller;
- agent role router;
- hook policy.

Default persistence:

```text
work-thread record
routing decision
semantic broker packet
governance packet
transition graph
meta-session artifact
```

Rules:

- No mutation before target work thread is resolved.
- No routing by chat recency alone when ontology evidence conflicts.
- Broker routes; it does not silently become worker or auditor.
- Object-level validity belongs to assigned validation role.
- Routing can select target and role; it does not prove the object-level action
  is valid.

## Retrieval Modes

Every persisted class needs explicit retrieval modes.

```ts
type RetrievalMode =
  | "recovery_read"
  | "context_build_read"
  | "renderer_projection_read"
  | "governance_read"
  | "audit_read"
  | "search_index_read"
  | "action_authority_read"
  | "private_diagnostic_read";
```

Retrieval principles:

```text
Recovery reads canonical artifacts, not renderer projections.
Context builders read context-safe projections/artifacts, not raw history ad hoc.
Renderer reads renderer-safe projections, not raw provider/auth/workspace records.
Authority gates read canonical evidence and policy, not UI state.
Governance reads work-thread/routing artifacts and source evidence.
Search reads projection indexes, then cites canonical sources.
```

## Persistence Law By Role

| Information role | Persistence default | Why |
| --- | --- | --- |
| Canonical event evidence | append-safe JSON / JSONL / journal | Preserve what happened and support recovery. |
| Human/app control mutation | operation ledger | Preserve decisions, approvals, transitions. |
| Workspace mutation | patch journal / command record / effect summary | Preserve local world change and replay safety. |
| Derived projection | SQLite/materialized projection | Efficient UI/search/status; rebuildable. |
| Context input | context pack | Exact model input evidence. |
| Request authorization | request manifest | Why request was lawful and what provider shape was used. |
| Memory/compaction/baton | versioned artifacts | Managed continuity under context pressure. |
| Governance/routing | packet/graph/decision artifact | Explain what transition was legal/selected. |
| UI state | ephemeral renderer state | Display only; no source truth. |

## Context Pack Registry Shape

Context is not "whatever fits." It is selected bridge information with declared
authority.

```ts
type ContextPack = {
  contextPackId: string;
  workThreadId: string;
  purpose:
    | "text_turn"
    | "tool_continuation"
    | "repair_loop"
    | "fork_start"
    | "checkpoint_continuation"
    | "context_maintenance"
    | "governance_diagnostic";

  messagesOrItems: ContextItem[];

  sourceRefs: EvidenceRef[];
  omissionRefs: OmissionRef[];
  memoryRefs: MemoryRef[];
  batonRefs: BatonRef[];
  governanceRefs: GovernanceRef[];

  authoritySummary: {
    instructionItems: string[];
    historicalEvidenceItems: string[];
    toolEvidenceItems: string[];
    memoryEvidenceItems: string[];
    statusEvidenceItems: string[];
  };

  integrity: ArtifactIntegrity;
};

type ContextItem = {
  itemId: string;
  role: "system" | "developer" | "user" | "assistant" | "tool" | "harness";
  authority:
    | "harness_policy"
    | "current_user_intent"
    | "historical_dialogue_evidence"
    | "tool_result_evidence"
    | "memory_evidence"
    | "baton_evidence"
    | "omission_status"
    | "runtime_status"
    | "governance_diagnostic";
  sourceRefs: EvidenceRef[];
  textDigest: string;
  rawTextStored: boolean;
};
```

Model input should be text with lawful provenance, not just accumulated text.

## Authority-Bearing Transition Shape

Action is information with world-state-changing force.

```ts
type AuthorityBearingTransition = {
  transitionId: string;
  workThreadId: string;

  proposedBy:
    | "human"
    | "model"
    | "harness"
    | "hook"
    | "connector";

  transitionKind:
    | "read_file"
    | "apply_patch"
    | "run_command"
    | "stage_attachment"
    | "connector_action"
    | "hook_action";

  inputEvidence: EvidenceRef[];
  authorityGate: AuthorityDecisionRef;
  executor: ActionExecutorRef;
  outcomeEvidence?: EvidenceRef;

  sideEffectScope:
    | "none"
    | "workspace_read"
    | "workspace_write"
    | "process_execution"
    | "external_service"
    | "provider_request"
    | "ui_only";

  replayPolicy: {
    idempotencyKey: string;
    mayAutoRetry: false;
    mayReplayAfterUnknown: false;
    recoveryRequiredAfterAmbiguity: true;
  };

  providerContinuation: {
    sent: boolean;
    seenByProvider:
      | "no"
      | "maybe_handoff_unknown"
      | "bytes_observed"
      | "terminal_completed"
      | "terminal_failed";
  };
};
```

Action transition axioms:

```text
model intent is not permission
human approval is not proof of outcome
tool execution and tool continuation are separate
local side effect and provider response are separate
unknown outcome is not success
no replay after side effect ambiguity
renderer affordance is not authority
```

## Agent Class Registry Shape

Agents are role-specific bridge participants, not chats.

```ts
type AgentClassSpec = {
  agentClass: AgentClass;

  consumesContextFamilies: string[];
  producesArtifactFamilies: string[];

  mayMutateWorkspace: boolean;
  mayAuthorizeTools: boolean;
  mayRouteWork: boolean;
  mayJudgeArtifacts: boolean;
  maySpawnSubAgents: boolean;

  forbiddenConflations: string[];
};
```

Example classes:

| Agent class | Consumes | Produces | May mutate? | Core law |
| --- | --- | --- | --- | --- |
| Project/work-thread broker | work-thread ontology, user intent | route decision | No | Routes; does not perform object work. |
| Implementation worker | implementation context | patch/read/command proposals | Only via gated tools | Proposes/executes under authority gates. |
| Audit worker | artifact/evidence bundle | audit verdict | No | Judges; does not patch unless re-routed. |
| Fix worker | audit verdict + implementation context | patch proposal | Only via gated tools | Repairs under explicit scope. |
| Memory/compaction worker | context pressure + evidence | memory/compaction/baton artifacts | No workspace mutation | Compresses/maintains, declares loss. |
| Governance/semantic broker | intent + work-thread + policy | governance/broker packet | No | Classifies; no hidden execution. |
| Meta-orchestrator | artifact graph + provenance | loop advancement decision | Not object-level | Validates class/provenance and advances. |

## ODEU Capability Row Template

Every major direct-path capability should use this structure.

```ts
type OdeuCapabilityRow = {
  id: string;
  name: string;

  roleClassification: BridgeInformationClass["role"];

  ontology: {
    informationClass: string;
    artifactClasses: string[];
    sourceWorld: string;
    identity: string[];
    canonicalSource?: string;
    derivedProjections?: string[];
  };

  deontics: {
    allowedCreators: string[];
    allowedMutators: string[];
    allowedConsumers: string[];
    contextEligibility: "never" | "direct" | "through_context_pack" | "diagnostic_only";
    actionAuthority:
      | "none"
      | "can_gate"
      | "can_execute_with_authority"
      | "can_report_outcome";
    rendererExposure: "none" | "summary" | "safe_projection" | "private_only";
    providerExposure: "never" | "summary" | "payload" | "tool_result";
  };

  epistemics: {
    confidence: string;
    evidenceRequired: string[];
    stalePolicy: string;
    contradictionPolicy: string;
    unavailablePolicy: string;
  };

  utility: {
    whyPersist: string[];
    whyRetrieve: string[];
    retention: string;
    deletionPolicy: string;
  };

  implementationConsequence: {
    canonicalStore?: string;
    projectionStore?: string;
    contextStore?: string;
    requestStore?: string;
    uiState?: string;
  };
};
```

## Worked Example: `apply_patch`

```ts
const applyPatch: OdeuCapabilityRow = {
  id: "E_apply_patch",
  name: "Apply patch authority transition",

  roleClassification: "action_executor",

  ontology: {
    informationClass: "workspace_mutation",
    artifactClasses: [
      "model_patch_proposal",
      "patch_plan",
      "dry_run_report",
      "approval_decision",
      "patch_journal",
      "workspace_effect_summary",
      "tool_result_envelope",
    ],
    sourceWorld: "workspace",
    identity: ["workThreadId", "turnId", "patchPlanId"],
    canonicalSource: "patch_journal",
    derivedProjections: ["approval_card_projection", "operation_history_row"],
  },

  deontics: {
    allowedCreators: ["model_proposal", "main_process_patch_parser"],
    allowedMutators: ["workspace_backend_patch_executor"],
    allowedConsumers: ["approval_gate", "recovery_scanner", "context_builder"],
    contextEligibility: "through_context_pack",
    actionAuthority: "can_execute_with_authority",
    rendererExposure: "safe_projection",
    providerExposure: "tool_result",
  },

  epistemics: {
    confidence: "exact_if_journal_verified",
    evidenceRequired: [
      "provider_call_id",
      "patch_plan_digest",
      "dry_run_passed",
      "human_approval",
      "before_digest",
      "after_digest",
      "journal_commit",
      "workspace_effect_summary",
    ],
    stalePolicy: "stale_if_workspace_digest_changed_before_apply",
    contradictionPolicy: "block_and_require_manual_recovery",
    unavailablePolicy: "do_not_apply",
  },

  utility: {
    whyPersist: ["recovery", "audit", "provider_continuation", "workspace_truth"],
    whyRetrieve: ["recovery", "operation_history", "context_tool_result"],
    retention: "retain_with_turn_artifacts",
    deletionPolicy: "no_hard_delete_without_purge_spec",
  },

  implementationConsequence: {
    canonicalStore: "patch_journal_json",
    projectionStore: "sqlite_operation_history",
    contextStore: "tool_continuation_context_pack",
    requestStore: "request_manifest",
    uiState: "approval_card_projection",
  },
};
```

## Future Spec Gate

Every future direct-path feature spec should begin with this table.

| Question | Required answer |
| --- | --- |
| What bridge role does this feature play? | One of the root roles. |
| What information class does it introduce or modify? | Named class and schema. |
| What is canonical evidence? | Source artifact(s), not UI/db projection. |
| What derived projections exist? | UI/search/status/context projections. |
| Can it enter model context? | Only via which context pack family. |
| Can it authorize action? | If yes, which authority gate. |
| Can it mutate world state? | If yes, which executor and replay law. |
| What persists and why? | Retention and utility. |
| What can be omitted/compacted? | Omission and risk law. |
| What can become stale/corrupt/contradictory? | Failure posture. |
| What can renderer see? | Safe projection boundaries. |
| What can provider see? | Request/context/tool-result boundaries. |
| What agent role consumes/produces it? | Agent class and artifact family. |
| What work-thread routing implication exists? | Target-world resolution. |

## Failure-Class Checklist

Each feature spec should answer how it prevents or handles:

```text
projection laundering
authority inflation
context smuggling
action replay
memory overclaim
thread flattening
world-target confusion
silent compression loss
renderer authority leak
```

## Bottom Line

Implementation is an effect of the information bridge registry, not the other
way around.

```text
No storage primitive before information role.
No context inclusion before authority class.
No action transition before evidence and replay law.
No UI projection before source/provenance boundary.
No agent prompt before agent role and artifact contract.
No memory before source, staleness, and contradiction law.
No compaction before loss and omission law.
No tool before authority and outcome evidence law.
```

