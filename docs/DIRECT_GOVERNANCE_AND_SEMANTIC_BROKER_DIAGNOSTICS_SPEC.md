# Direct Governance And Semantic Broker Diagnostics Spec

Status: draft PR 9 implementation specification for the long-lived
`codex/direct-chatgpt-harness` branch.

Related docs:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](./CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)
- [DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md)
- [DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md](./DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md)
- [DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md](./DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md)
- [DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md](./DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md)
- [DIRECT_THREAD_EVIDENCE_WORKBENCH_AND_DERIVED_VIEWS_SPEC.md](./DIRECT_THREAD_EVIDENCE_WORKBENCH_AND_DERIVED_VIEWS_SPEC.md)
- [DIRECT_FRESH_FORK_STARTS_FROM_PREVIEWS_SPEC.md](./DIRECT_FRESH_FORK_STARTS_FROM_PREVIEWS_SPEC.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)

## Verdict

This is the next PR after context maintenance, durable memory, omission
ledgers, and frontier baton.

PRs 1-8 proved and exposed the Direct lane through:

```text
real-provider read/patch/command proof
  -> recovery/replay safety
  -> bounded iterative repair
  -> workspace mutation truth
  -> implementation-lane UI/status
  -> thread evidence workbench
  -> fresh fork starts from preview evidence
  -> context maintenance, memory, baton, and omission law
```

The next confidence gap is diagnostic authority explanation: before Direct can
consider governance enforcement or semantic rerouting, the shell needs durable,
renderer-safe artifacts that explain which governance packet would apply, which
prompt layers would be compiled, which workflow transitions are legal, and what
semantic broker packet would classify the task.

PR 9 is therefore diagnostics/shadow mode first:

```text
governance input snapshot
  -> governance_packet@1
  -> compiled_prompt_layers@1
  -> workflow_transition_graph@1 diagnostics
  -> governance shadow diagnostics
  -> semantic_broker_packet@1
  -> broker fallback / ask-human state
  -> renderer-safe status and report
```

This is not hard enforce mode, not automatic semantic rerouting, and not a new
provider/tool authority surface. It is the explanation layer that makes future
enforcement auditable.

## Matrix Scope

Rows:

```text
D15-D21
J10
parts of C8-C10, D18, D22-D23, F8, F9, I5, I15
```

This PR should move Direct from implicit prompt/task routing toward explicit
shadow governance and broker evidence. It may create promotion candidates for
schema, diagnostic, and fixture-backed rows. It should not promote enforce mode
or automatic broker routing.

## Core Law

```text
governance packet != provider authority
governance shadow mode != enforcement
compiled prompt layers != canonical dialogue truth
memory/baton/context evidence != current instruction authority
transition graph diagnostic != permission to mutate
semantic broker packet != generic tool broker
broker candidate != route mutation
ask-human fallback != automatic prompt rewrite
runtime status != governance editor
right-pane ChatGPT state != Direct governance evidence
```

Provider output creates possibilities. The Direct harness owns prompt layering,
legal transition diagnostics, broker classification, fallback state, context
inclusion, and whether any future runtime gate may enforce a decision.

## Product Boundary

Good:

```text
Direct branch only
left Codex lane diagnostics/status substrate
governance input snapshot
governance_packet@1
compiled_prompt_layers@1
role mapping digest
workflow_transition_graph@1 diagnostics
governance shadow report
semantic_broker_packet@1
broker candidates and adjudication evidence
broker fallback / ask-human state
request manifest source refs
status-lane and operation-history projection
fixture/headless regression
```

Not included:

```text
hard enforce mode as default
automatic semantic rerouting
automatic tool/schema/context route mutation
new provider tools
new local authority
auto-approval
manual resume/retry/replay
provider stream resume
right-pane ChatGPT import or mutation
handoff queue mutation
app-server fallback
editable governance settings UI
semantic broker editor UI
sub-agent observability or wait/spawn tools
production direct default
```

## Existing Substrate

PR 9 should reuse and harden existing Direct artifacts:

```text
DirectSessionStore
DirectThreadStore
direct operation ledger
renderer_transcript@1
context_recent_dialogue@1
direct_context_pack@1
direct_request_manifest@1
direct_provider_input_projection@1
runtime tier/status and witness chips
implementation-lane operation history
read/patch/command policy snapshots
repair loop transition graph and response-chain evidence
workspace effect summaries
thread workbench previews/fresh fork seeds
context maintenance refs, durable memory, omission ledger, frontier baton
recovery reports
```

It should not introduce a second context store, second policy store, or hidden
prompt assembly path. Governance and broker artifacts are source refs that
context packs/request manifests may cite.

## Source-Of-Truth Ordering

PR 9 uses one governance/broker source chain:

```text
canonical session/turn/runtime artifacts
  -> validated context/maintenance/tool/workspace source refs
  -> governance input snapshot
  -> governance_packet@1
  -> compiled_prompt_layers@1
  -> workflow_transition_graph@1 diagnostics
  -> semantic broker input snapshot
  -> semantic_broker_packet@1
  -> request manifest / provider input projection refs
  -> renderer-safe status and operation history
```

Rules:

```text
renderer transcript rows may feed governance only through validated projections

memory, baton, and omission artifacts may be cited as context evidence but do
not become current system/developer policy

governance artifacts may influence diagnostics in PR 9 but must not silently
change runtime execution

semantic broker packets may classify the task and show candidates in PR 9 but
must not automatically alter tools, schemas, context routes, or runtime tier

blocked/failed compile attempts may be retained as attempt history but must not
replace current valid packet pointers
```


## Shared Source Refs

Governance and broker artifacts must use one source-ref shape. This is the
main guard against raw renderer state or ambiguous evidence becoming policy.

```ts
type DirectGovernanceSourceRefKind =
  | "runtime_tier"
  | "current_user_intent"
  | "context_pack"
  | "request_manifest"
  | "provider_input_projection"
  | "context_recent_dialogue"
  | "renderer_transcript_projection"
  | "durable_thread_memory"
  | "frontier_baton"
  | "omission_ledger"
  | "tool_obligation"
  | "repair_loop"
  | "workspace_effect_summary"
  | "recovery_report"
  | "thread_workbench_preview"
  | "fresh_fork_seed"
  | "policy_snapshot"
  | "model_evidence"
  | "semantic_registry"
  | "unknown";

type DirectGovernanceSourceRef = {
  kind: DirectGovernanceSourceRefKind;
  artifactId: string;
  artifactDigest: string;
  sourceConfidence: "exact" | "accepted" | "derived" | "diagnostic" | "future";
  rendererSafeLabel: string;
  rawTextIncluded: false;
};
```

Rules:

```text
source refs cite durable artifacts/projections by id and digest

source refs never contain raw transcript text, raw user prompts, raw tool args,
raw file contents, raw paths, provider frames, or raw ChatGPT URLs

unknown refs are allowed only for diagnostics and cannot become promotion
evidence

sourceConfidence follows v0.2 confidence posture: exact/accepted evidence can
support current diagnostics; derived/diagnostic/future evidence cannot promote
runtime authority
```

## Governance Packet

Add `governance_packet@1`:

```ts
type DirectGovernancePacket = {
  schema: "governance_packet@1";
  governancePacketId: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  mode: "off" | "shadow" | "enforce_unavailable";
  modeSource: "default" | "project" | "runtime-profile" | "diagnostic";
  inputSnapshotId: string;
  inputSnapshotDigest: string;
  packetPolicyDigest: string;
  roleMappingDigest: string;
  runtimeTierDigest: string;
  contextPolicyDigest?: string;
  maintenanceRefsDigest?: string;
  toolPolicyDigest?: string;
  workspacePolicyDigest?: string;
  transitionGraphDigest?: string;
  semanticBrokerPolicyDigest?: string;
  layers: DirectGovernanceLayerRef[];
  diagnostics: DirectGovernanceDiagnostic[];
  rendererSafeSummary: string;
  editableInThisPr: false;
  enforceableInThisPr: false;
  rawTextIncluded: false;
  rawRequestBodyIncluded: false;
  rawProviderFrameIncluded: false;
  integrity: DirectArtifactIntegrity;
};
```

Governance packet rules:

```text
mode=shadow by default when diagnostics are enabled
mode=off produces a renderer-safe disabled packet if requested
mode=enforce_unavailable may explain why enforce is unavailable but cannot block runtime execution
packet must cite source digests, not raw transcript text or raw request bodies
packet may be cited by context packs/request manifests as evidence
packet is not a transcript message and is not user-editable
```

## Governance Input Snapshot

Add `governance_input_snapshot@1`:

```ts
type DirectGovernanceInputSnapshot = {
  schema: "governance_input_snapshot@1";
  governanceInputSnapshotId: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  trigger:
    | "pre_request"
    | "tool_obligation"
    | "tool_continuation"
    | "repair_loop_step"
    | "fresh_fork_start"
    | "context_maintenance"
    | "diagnostic";
  runtimeTierRef: DirectGovernanceSourceRef;
  currentUserIntentRef?: DirectGovernanceSourceRef;
  contextPackRef?: DirectGovernanceSourceRef;
  requestManifestRef?: DirectGovernanceSourceRef;
  maintenanceRefs?: DirectGovernanceSourceRef[];
  memoryRefs?: DirectGovernanceSourceRef[];
  batonRef?: DirectGovernanceSourceRef;
  omissionLedgerRef?: DirectGovernanceSourceRef;
  toolObligationRefs?: DirectGovernanceSourceRef[];
  repairLoopRef?: DirectGovernanceSourceRef;
  workspaceEffectRefs?: DirectGovernanceSourceRef[];
  recoveryStateRef?: DirectGovernanceSourceRef;
  threadWorkbenchRefs?: DirectGovernanceSourceRef[];
  sourceDigest: string;
  createdAt: string;
  rawTextIncluded: false;
};
```

Snapshot rules:

```text
input snapshots are immutable
snapshots are built from durable artifacts and validated projections only
renderer DOM state is never governance source truth
missing required source refs produce governance diagnostics, not guessed layers
```

## Compiled Prompt Layers

Add `compiled_prompt_layers@1`:

```ts
type DirectPromptLayerAuthority =
  | "harness_policy"
  | "current_user_intent"
  | "runtime_status"
  | "tool_policy"
  | "workspace_policy"
  | "historical_context_evidence"
  | "durable_memory_evidence"
  | "frontier_baton_evidence"
  | "omission_status_evidence"
  | "semantic_broker_diagnostic"
  | "governance_diagnostic"
  | "unsupported";

type DirectCompiledPromptLayers = {
  schema: "compiled_prompt_layers@1";
  providerInputMutationAllowedInThisPr: false;
  compiledPromptLayersId: string;
  governancePacketId: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  roleMappingDigest: string;
  layerOrder: DirectPromptLayerKind[];
  layers: Array<{
    layerId: string;
    kind: DirectPromptLayerKind;
    authority: DirectPromptLayerAuthority;
    sourceRefs: DirectGovernanceSourceRef[];
    rendererSafeSummary: string;
    providerInputEligible: boolean;
    currentInstructionAuthority: boolean;
    mayBecomeProviderInstructionInThisPr: boolean;
    includedInProviderInputByPr9: false;
    quotedEvidence: boolean;
    layerDigest: string;
    rawTextIncluded: false;
  }>;
  providerInputProjectionId?: string;
  providerInputProjectionDigest?: string;
  compiledShapeHash: string;
  compiledTextHash?: string;
  rawCompiledTextStored: false;
  diagnostics: DirectGovernanceDiagnostic[];
  integrity: DirectArtifactIntegrity;
};

type DirectPromptLayerKind =
  | "harness"
  | "runtime"
  | "tool_authority"
  | "workspace_policy"
  | "context_policy"
  | "memory_evidence"
  | "baton_status"
  | "omission_status"
  | "current_user_intent"
  | "semantic_broker_status";
```

Layer rules:

```text
harness/runtime/tool/workspace policy layers may be instruction authority only
when existing Direct policy already gives them that authority

memory, baton, omission, workbench preview, and historical transcript layers are
quoted evidence or status evidence only

compiled layers may explain prompt assembly but do not introduce a separate
provider-input builder

compiled_prompt_layers@1 has providerInputMutationAllowedInThisPr=false

all layers have includedInProviderInputByPr9=false unless an existing request
builder already included that same source independently of PR 9

raw compiled prompt text is not stored in PR 9
```

## Transition Graph Diagnostics

Add `workflow_transition_graph@1` diagnostics:

```ts
type DirectWorkflowTransitionGraph = {
  schema: "workflow_transition_graph@1";
  transitionGraphId: string;
  projectId: string;
  graphVersion: string;
  mode: "diagnostic" | "shadow";
  allowedNodes: DirectWorkflowNodeKind[];
  allowedEdges: DirectWorkflowTransitionEdge[];
  blockedEdges: DirectWorkflowBlockedTransition[];
  parityResult?: DirectTransitionGraphParityResult;
  policyDigests: {
    runtimePolicyDigest: string;
    toolPolicyDigest?: string;
    workspacePolicyDigest?: string;
    contextMaintenancePolicyDigest?: string;
    governancePolicyDigest: string;
  };
  graphDigest: string;
  rawTextIncluded: false;
};

type DirectWorkflowTransitionEdgeKind =
  | "text"
  | "tool_request"
  | "approval"
  | "local_action"
  | "tool_result"
  | "provider_continuation"
  | "repair_loop"
  | "fork_start"
  | "context_maintenance"
  | "terminal"
  | "blocked";

type DirectWorkflowBlockedTransitionReason =
  | "missing_evidence"
  | "runtime_tier_unavailable"
  | "tool_authority_missing"
  | "active_obligation_exists"
  | "side_effect_recovery_required"
  | "workspace_policy_block"
  | "context_maintenance_blocked"
  | "raw_exposure_blocked"
  | "semantic_broker_ambiguous"
  | "governance_packet_missing"
  | "enforce_mode_unavailable"
  | "unsupported_transition";

type DirectTransitionGraphParityResult = {
  graphId: string;
  controllerVersion: string;
  checkedTransitions: Array<{
    from: DirectWorkflowNodeKind;
    to: DirectWorkflowNodeKind;
    edgeKind: DirectWorkflowTransitionEdgeKind;
    graphDecision: "allowed" | "blocked" | "diagnostic";
    controllerDecision?: "allowed" | "blocked" | "unknown";
    parity:
      | "matched"
      | "graph_missing_controller_block"
      | "graph_blocks_controller_allows"
      | "controller_unknown"
      | "not_checked";
  }>;
};

type DirectWorkflowNodeKind =
  | "text_turn"
  | "read_file_obligation"
  | "apply_patch_obligation"
  | "run_command_obligation"
  | "tool_continuation"
  | "repair_loop_step"
  | "workspace_effect_scan"
  | "fresh_fork_start"
  | "context_maintenance"
  | "assistant_final"
  | "blocked_terminal";
```

Transition rules:

```text
PR 9 graph diagnostics must mirror existing runtime gates rather than replace them

illegal transition findings are renderer-safe diagnostics unless a preexisting
runtime controller already blocks that transition

no new runtime gate may be enabled only because the diagnostic graph exists

D18 promotion candidate requires graph artifact, digest citations in reports,
allowed/blocked fixture cases, edge-kind/blocker-code coverage, and parity with existing repair/context/fork gates
```

## Governance Shadow Diagnostics

Add `governance_shadow_report@1`:

```ts
type DirectGovernanceShadowReport = {
  schema: "governance_shadow_report@1";
  shadowReportId: string;
  governancePacketId: string;
  compiledPromptLayersId?: string;
  transitionGraphId?: string;
  semanticBrokerPacketId?: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  status:
    | "passed"
    | "diagnostic_only"
    | "missing_required_source"
    | "compile_failed"
    | "transition_ambiguous"
    | "broker_ambiguous"
    | "fallback_required"
    | "raw_exposure_blocked";
  diagnostics: DirectGovernanceDiagnostic[];
  wouldBlockInFutureEnforceMode: boolean;
  blockedInThisPr: false;
  rendererSafeSummary: string;
  rawTextIncluded: false;
  integrity: DirectArtifactIntegrity;
};
```

Diagnostic code examples:

```text
missing_governance_input_snapshot
missing_runtime_tier_ref
missing_context_policy_ref
missing_transition_graph_ref
compiled_layer_order_changed
memory_layer_not_instruction_authority
baton_layer_not_replay_authority
unsupported_governance_mode
transition_illegal_shadow_only
semantic_broker_ambiguous
semantic_broker_fallback_required
raw_exposure_blocked
```

## Semantic Broker Registry And Input Snapshot

The broker must not be a magic classifier. It needs an auditable registry and
input snapshot before it can produce a packet.

```ts
type DirectSemanticBrokerRegistrySnapshot = {
  schema: "semantic_broker_registry_snapshot@1";
  registrySnapshotId: string;
  projectId: string;
  version: string;
  routes: Array<{
    routeKind: DirectSemanticBrokerCandidate["routeKind"];
    toolSurface: "none" | "read_file" | "apply_patch" | "run_command" | "mixed_sequential";
    requiredEvidenceKinds: DirectGovernanceSourceRefKind[];
    contextPolicyKinds: string[];
    runtimeTierKinds: string[];
    enabledForAutoApplyInThisPr: false;
  }>;
  registryDigest: string;
  rawPromptTextIncluded: false;
};

type DirectSemanticBrokerInputSnapshot = {
  schema: "semantic_broker_input_snapshot@1";
  semanticBrokerInputSnapshotId: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  currentUserIntentRef?: DirectGovernanceSourceRef;
  runtimeTierRef: DirectGovernanceSourceRef;
  governancePacketRef?: DirectGovernanceSourceRef;
  contextPolicyRef?: DirectGovernanceSourceRef;
  toolPolicyRefs?: DirectGovernanceSourceRef[];
  workspacePolicyRef?: DirectGovernanceSourceRef;
  evidenceStatusRefs: DirectGovernanceSourceRef[];
  sourceDigest: string;
  rawUserPromptIncluded: false;
};
```

Registry/input rules:

```text
registry entries describe possible diagnostic routes and required evidence kinds

registry entries have enabledForAutoApplyInThisPr=false

broker input snapshots cite current intent and evidence by source ref only

broker packets cannot be built from raw renderer DOM state or raw prompt text
```

## Semantic Broker Packet

Add `semantic_broker_packet@1`:

```ts
type DirectSemanticBrokerPacket = {
  schema: "semantic_broker_packet@1";
  semanticBrokerPacketId: string;
  projectId: string;
  threadId: string;
  turnId?: string;
  mode: "diagnostic" | "shadow";
  inputSnapshotId: string;
  inputSnapshotDigest: string;
  brokerPolicyDigest: string;
  registrySnapshotDigest: string;
  governancePacketDigest?: string;
  candidates: DirectSemanticBrokerCandidate[];
  adjudication: {
    status:
      | "selected_single_candidate"
      | "ambiguous"
      | "unsupported"
      | "fallback_ask_human"
      | "degraded_to_text_only"
      | "diagnostic_only";
    selectedCandidateId?: string;
    confidence: "exact" | "high" | "medium" | "low" | "unknown";
    reasonCode: string;
    autoRouteApplied: false;
  };
  fallbackState?: DirectSemanticBrokerFallbackState;
  rendererSafeSummary: string;
  rawUserPromptIncluded: false;
  rawToolArgsIncluded: false;
  rawContextTextIncluded: false;
  integrity: DirectArtifactIntegrity;
};
```

Candidate shape:

```ts
type DirectSemanticBrokerCandidate = {
  candidateId: string;
  routeKind:
    | "text_only"
    | "implementation_lane_read"
    | "implementation_lane_patch"
    | "implementation_lane_command"
    | "repair_loop"
    | "fresh_fork_start"
    | "context_maintenance"
    | "unsupported";
  schemaKind?: string;
  toolSurface?: "none" | "read_file" | "apply_patch" | "run_command" | "mixed_sequential";
  contextPolicyHint?: string;
  requiredEvidenceRefs: DirectGovernanceSourceRef[];
  missingEvidenceCodes: string[];
  confidence: "exact" | "high" | "medium" | "low" | "unknown";
  reasonCodes: string[];
  rendererSafeSummary: string;
  wouldRequireUserDecisionInFuture: boolean;
  wouldMutateRuntimeIfAppliedInFuture: boolean;
  mayAutoApplyInThisPr: false;
  enabledInThisPr: false;
};
```

Broker rules:

```text
semantic broker is a prompt/schema routing diagnostic layer, not a generic tool broker

broker output cannot create tool declarations, approvals, context routes, or
runtime transitions in PR 9

candidate selection may be displayed only as diagnostic status

ambiguous or unsupported classification records fallback state and asks for human
choice only as future/disabled guidance
```

## Broker Fallback / Ask-Human State

Add `semantic_broker_fallback@1`:

```ts
type DirectSemanticBrokerFallbackState = {
  schema: "semantic_broker_fallback@1";
  fallbackId: string;
  semanticBrokerPacketId: string;
  fallbackKind:
    | "ask_human"
    | "degrade_to_text_only"
    | "block_until_source_available"
    | "diagnostic_only";
  reasonCode:
    | "ambiguous_task_route"
    | "unsupported_tool_surface"
    | "missing_evidence"
    | "unsafe_context_policy"
    | "runtime_tier_unavailable"
    | "governance_packet_missing"
    | "raw_exposure_blocked";
  enabledInThisPr: false;
  fallbackUiState:
    | "none"
    | "disabled_ask_human"
    | "disabled_degrade_to_text_only"
    | "disabled_block_until_source_available"
    | "diagnostic_only";
  rendererSafePrompt?: string;
  rawUserPromptIncluded: false;
};
```

Fallback rules:

```text
fallback state may explain what user decision would be needed later

PR 9 must not show an enabled ask-human action that mutates the active turn

text-only degradation is diagnostic unless existing runtime selection already
chooses text-only
```

## Request Manifest And Context Pack Integration

Every Direct request built after PR 9 should be able to cite governance/broker
source refs when present:

```ts
type DirectGovernanceCitationPolicy = {
  schema: "governance_citation_policy@1";
  citationMode:
    | "optional_diagnostic"
    | "required_for_shadow_report"
    | "required_for_future_enforce";
  missingRefBehavior:
    | "diagnostic_only"
    | "block_future_enforce_only"
    | "unsupported";
};

type DirectGovernanceRequestRefs = {
  schema: "direct_governance_request_refs@1";
  governanceInputSnapshotId?: string;
  governanceInputSnapshotDigest?: string;
  governancePacketId?: string;
  governancePacketDigest?: string;
  compiledPromptLayersId?: string;
  compiledPromptLayersDigest?: string;
  transitionGraphId?: string;
  transitionGraphDigest?: string;
  semanticBrokerPacketId?: string;
  semanticBrokerPacketDigest?: string;
  brokerFallbackId?: string;
  brokerFallbackDigest?: string;
  citationPolicyDigest: string;
  refsDigest: string;
};

type DirectProviderInputProjectionGovernanceRefs = {
  compiledPromptLayersDigest?: string;
  governancePacketDigest?: string;
  semanticBrokerPacketDigest?: string;
  rawCompiledTextIncluded: false;
  rawBrokerPromptIncluded: false;
};
```

Rules:

```text
request manifests cite governance/broker refs by id and digest only

provider input projections may cite compiled layer digests but must not store raw
compiled text

context packs may include governance/broker diagnostics only as status evidence,
not as new system/developer policy

missing required governance refs in shadow mode creates diagnostics, not runtime
failure

normal runtime requests use citationMode=optional_diagnostic

provider input projections may cite governance/broker digests, but adding PR 9
governance refs must not change provider input text
```

## Status And Operation History

Add renderer-safe projections:

```text
direct_governance_status_projection@1
direct_semantic_broker_status_projection@1
direct_governance_operation_history_row@1
```

Status fields:

```ts
type DirectGovernanceStatusProjection = {
  schema: "direct_governance_status_projection@1";
  projectId: string;
  threadId?: string;
  turnId?: string;
  uiProjectionGeneration: number;
  sourceDigest: string;
  operationLedgerHeadDigest: string;
  mode: "off" | "shadow" | "enforce_unavailable";
  packetState: "not_built" | "valid" | "diagnostic" | "blocked_raw_exposure" | "compile_failed";
  brokerState: "not_built" | "valid" | "ambiguous" | "fallback_required" | "unsupported";
  transitionGraphState: "not_built" | "valid" | "diagnostic_mismatch";
  rendererSafeSummary: string;
  actionable: false;
  rawTextIncluded: false;
};
```

UI law:

```text
status rows are display-only
operation history is read-only and actionability=false
no editable governance packet or broker editor appears in PR 9
expired/stale packet refs remain visible as diagnostic expired state
right-pane ChatGPT and handoff chips cannot contribute governance evidence
```

## Policy And Settings Posture

J10 is status-first in PR 9:

```ts
type DirectGovernanceModeSnapshot = {
  schema: "governance_mode_snapshot@1";
  effectiveMode: "off" | "shadow" | "enforce_unavailable";
  effectiveSource: "default" | "project" | "runtime-profile" | "diagnostic";
  sourceDigest: string;
  editableInThisPr: false;
  enforceModeAvailable: false;
  enforceUnavailableReason?:
    | "not_implemented"
    | "workflow_value_unproved"
    | "missing_transition_parity"
    | "missing_raw_exposure_tests"
    | "missing_recovery_law"
    | "unsupported_runtime_tier"
    | "policy_not_configured";
  privateConfigIncluded: false;
};

type DirectGovernanceModeStatus = {
  schema: "direct_governance_mode_status@1";
  effectiveMode: "off" | "shadow" | "enforce_unavailable";
  effectiveSource: "default" | "project" | "runtime-profile" | "diagnostic";
  editableInThisPr: false;
  enforceModeAvailable: false;
  rendererSafeSummary: string;
  privateConfigIncluded: false;
};
```

Rules:

```text
no settings editor in PR 9

shadow diagnostics may be enabled by default for fixture/headless reports

enforce mode may be shown only as unavailable/future status

fork-derived governance config may be referenced as exemplar/status only, never
silently imported into Direct behavior
```

## Storage And Pointers

Add app-private artifact storage for:

```text
governance_input_snapshot@1
governance_packet@1
compiled_prompt_layers@1
workflow_transition_graph@1
governance_shadow_report@1
semantic_broker_packet@1
semantic_broker_fallback@1
```

Current pointers:

```text
current_governance_input_snapshot_id
current_governance_packet_id
current_compiled_prompt_layers_id
current_workflow_transition_graph_id
current_semantic_broker_packet_id
current_semantic_broker_fallback_id
current_governance_shadow_report_id
```

Pointer law:

```text
each current pointer points only to a valid artifact for its source digest
blocked/failed/raw-exposure attempts are recorded as attempt history only
blocked/failed/raw-exposure attempts never replace current valid pointers
new valid pointers replace old pointers only after schema validation, digest
validation, and raw-exposure scan pass
no single generic current governance id may hide per-artifact failure states
```

Attempt history uses `governance_attempt_record@1`:

```ts
type DirectGovernanceAttemptRecord = {
  schema: "governance_attempt_record@1";
  attemptId: string;
  attemptKind:
    | "input_snapshot"
    | "governance_packet"
    | "compiled_layers"
    | "transition_graph"
    | "semantic_broker"
    | "fallback"
    | "shadow_report";
  status:
    | "valid"
    | "diagnostic"
    | "blocked_raw_exposure"
    | "compile_failed"
    | "source_missing"
    | "stale_source"
    | "schema_invalid";
  replacesCurrentPointer: boolean;
  rendererSafeSummary: string;
  rawTextIncluded: false;
};
```

## Raw Exposure Policy

Raw-exposure scan covers:

```text
governance input snapshots
governance packets
compiled prompt layer summaries
transition graph diagnostics
semantic broker packets
fallback states
status projections
operation-history rows
JSON reports
Markdown reports
console summaries
renderer state snapshots
DOM attributes / serialized renderer state if used
```

Forbidden:

```text
raw provider frames
raw request bodies
raw compiled prompt text
raw user prompt beyond approved preview
raw tool args beyond approved preview
raw patch bodies
raw stdout/stderr
raw file contents
absolute host/WSL paths
auth tokens / cookies / API keys
raw ChatGPT URLs
unscoped raw digests presented as user-readable strings
internal SQLite exception text
```

If scan fails:

```text
write minimal safe failure report
return minimal safe status projection
record raw_exposure_blocked diagnostic
never cite failed packet as current
```

## Recovery And Idempotency

Recovery must classify governance/broker artifacts without provider transport,
app-server fallback, workspace reads, patch apply, command run, right-pane
mutation, or handoff mutation.

Recovery states:

```ts
type DirectGovernanceRecoveryState =
  | "healthy"
  | "current_pointer_missing"
  | "current_pointer_digest_mismatch"
  | "current_pointer_schema_invalid"
  | "current_pointer_raw_exposure_blocked"
  | "attempt_history_only"
  | "packet_valid_layers_missing"
  | "broker_valid_fallback_missing"
  | "transition_graph_mismatch"
  | "corrupt"
  | "unknown";

type DirectGovernanceBrokerRecoveryState =
  | DirectGovernanceRecoveryState
  | "input_snapshot_missing"
  | "packet_missing"
  | "compiled_layers_missing"
  | "transition_graph_missing"
  | "semantic_broker_packet_missing"
  | "fallback_state_missing";
```

Idempotency rules:

```text
same source digest + same policy digest + same compiler version returns same packet id

same broker input digest + same broker policy digest + same registry digest returns same broker packet id

blocked attempts do not replace current pointers

startup recovery writes only a separate diagnostic report, not operation-ledger
mutation, unless a later user action acknowledges repair

read_governance_status may report stale/missing/corrupt but must not rebuild
governance packet, broker packet, transition graph, or compiled layers

refresh_governance_diagnostics is the explicit action that may rebuild
diagnostics
```

## Operation Ledger Events

Add operation families/events:

```text
governance_input_snapshot_recorded
governance_packet_compiled
compiled_prompt_layers_recorded
workflow_transition_graph_recorded
governance_shadow_report_recorded
semantic_broker_input_snapshot_recorded
semantic_broker_packet_recorded
semantic_broker_fallback_recorded
governance_status_projection_recorded
governance_diagnostics_blocked_raw_exposure
```

Events cite artifact ids and digests only. They must not include raw packet text,
compiled prompt text, user prompt, tool arguments, file content, or provider
frames.

## Report Schema

Add `direct_governance_broker_regression_report@1`:

```ts
type DirectGovernanceBrokerRegressionReport = {
  schema: "direct_governance_broker_regression_report@1";
  generatedAt: string;
  coverageSource:
    | "fixture_governance_broker"
    | "local_runtime"
    | "diagnostic"
    | "real_provider";
  matrixRowsExercised: Array<"D15" | "D16" | "D17" | "D18" | "D19" | "D20" | "D21" | "J10">;
  matrixPromotionCandidate: boolean;
  promotionCandidates: {
    D15_governancePromptLayering_schema: boolean;
    D16_shadowMode_diagnostics: boolean;
    D17_enforceMode: false;
    D18_transitionLegality_diagnostic: boolean;
    D19_governanceDiagnostics: boolean;
    D20_semanticBrokerPacket_schema: boolean;
    D21_brokerFallback_diagnostic: boolean;
    J10_governanceModeStatus: boolean;
  };
  cases: DirectGovernanceBrokerRegressionCase[];
  sentinelCounters: DirectGovernanceBrokerSentinelCounters;
  rawExposureScan: "passed" | "blocked";
  schemaValidation: "passed" | "failed";
};
```

Fixture reports set:

```text
coverageSource=fixture_governance_broker
matrixPromotionCandidate=false
D17_enforceMode=false
authorityPromotionCandidate=false
runtimeAuthorityExercised=false
providerAuthorityExercised=false
```

## Sentinel Counters

Every fixture/status/read path must assert:

```ts
type DirectGovernanceBrokerSentinelCounters = {
  providerTransportCalls: number;
  appServerSpawnCalls: number;
  workspaceReadCalls: number;
  patchApplyCalls: number;
  commandRunCalls: number;
  contextMaintenanceRuns: number;
  memoryEdits: number;
  autoRouteApplications: number;
  runtimeTierMutations: number;
  runtimeTierMutationCalls: number;
  toolDeclarationMutations: number;
  requestManifestBuildsFromBroker: number;
  rightPaneMutationCalls: number;
  handoffMutationCalls: number;
};
```

Expected values for PR 9 fixture diagnostics:

```text
providerTransportCalls = 0
appServerSpawnCalls = 0
workspaceReadCalls = 0
patchApplyCalls = 0
commandRunCalls = 0
memoryEdits = 0
autoRouteApplications = 0
runtimeTierMutations = 0
toolDeclarationMutations = 0
requestManifestBuildsFromBroker = 0
rightPaneMutationCalls = 0
handoffMutationCalls = 0
```

Context maintenance runs may be `0` unless a fixture explicitly invokes the
already-built PR 8 maintenance artifact builders as source input.

## Regression Matrix

Required fixture cases:

```text
governance_packet_shadow_happy_path
compiled_prompt_layers_happy_path
memory_layer_not_instruction_authority
baton_layer_not_replay_authority
omission_ledger_not_hidden_context
transition_graph_allowed_text_turn
transition_graph_text_turn_to_assistant_final_allowed
transition_graph_text_turn_to_read_file_allowed_only_in_implementation_lane
transition_graph_read_obligation_to_approval_allowed
transition_graph_approval_to_local_read_allowed
transition_graph_local_read_to_tool_continuation_allowed
transition_graph_tool_continuation_to_patch_allowed_in_repair_loop_with_evidence
transition_graph_patch_to_command_before_apply_blocked
transition_graph_command_to_nested_tool_blocked
transition_graph_context_maintenance_during_active_obligation_blocked
transition_graph_fresh_fork_valid_preview_allowed_diagnostic
transition_graph_fresh_fork_stale_preview_blocked
transition_graph_blocked_parallel_tool_call
transition_graph_blocked_auto_retry_after_side_effect
transition_graph_fresh_fork_no_source_continuity
governance_missing_context_ref_diagnostic
governance_raw_exposure_blocked
semantic_broker_registry_snapshot_valid
semantic_broker_input_snapshot_valid
semantic_broker_simple_text_prompt_text_only_candidate
semantic_broker_read_file_prompt_read_candidate_missing_evidence
semantic_broker_text_only_candidate
semantic_broker_read_candidate_diagnostic_only
semantic_broker_patch_candidate_diagnostic_only
semantic_broker_command_candidate_diagnostic_only
semantic_broker_mixed_repair_candidate_diagnostic_only
semantic_broker_fresh_fork_candidate_diagnostic_only
semantic_broker_ambiguous_ask_human_disabled
semantic_broker_unsupported_browser_network_task
semantic_broker_unsupported_degrade_status
enforce_mode_unavailable_status
shadow_report_would_block_future_enforce_does_not_block_runtime
provider_input_text_unchanged_by_governance_refs
request_manifest_refs_include_governance_packet_when_present
current_pointer_failed_attempt_not_promoted
fixture_report_no_authority_promotion
sentinel_counters_zero_for_forbidden_paths
```

Optional local-runtime cases:

```text
context pack cites governance packet id/digest
request manifest cites compiled layer id/digest
operation history shows read-only governance/broker rows
status projection schema validates before IPC
```

No live provider cases are required for PR 9. If a future diagnostic uses a real
provider to evaluate prompt text quality, it must be opt-in, non-promotional for
governance authority, and use separate evidence rows.

## Implementation Order

### Phase -3 - Non-Authority Law

```text
define exact non-authority guarantees
shadow report cannot block
broker cannot route
compiled layers cannot mutate provider input
status read cannot rebuild
right-pane/handoff cannot be evidence
```

### Phase -2 - Source-Ref And Layer Taxonomy

```text
DirectGovernanceSourceRefKind
DirectPromptLayerAuthority
DirectGovernanceModeSnapshot
DirectSemanticBrokerRegistrySnapshot
DirectSemanticBrokerInputSnapshot
```

### Phase -1 - Law And Inventory

```text
inventory existing prompt/context/request builders
inventory existing repair/context/fork transition gates
inventory existing UI/status operation-history projection law
define governance packet vs broker packet source-of-truth boundary
confirm no existing path treats governance diagnostics as runtime authority
```

### Phase 0 - Schemas And Pointer Law

```text
governance_input_snapshot@1
governance_packet@1
compiled_prompt_layers@1
workflow_transition_graph@1
semantic_broker_packet@1
semantic_broker_fallback@1
attempt history
current pointer rules
recovery state enum
operation ledger event names
citation policy
artifact integrity chain
raw-exposure policy
```

### Phase 1 - Governance Shadow Compiler

```text
build governance input snapshot from durable refs
compile governance packet in shadow mode
compile prompt layer summaries and digests
record diagnostics for missing/unsupported sources
write app-private artifacts
validate schema and raw-exposure before current pointer update
```

### Phase 2 - Transition Graph Diagnostics

```text
build workflow transition graph from existing runtime laws
cover allowed and blocked fixture transitions
compare graph diagnostics with existing controller behavior where possible
record graph digest in governance packet/report
```

### Phase 3 - Semantic Broker Diagnostics

```text
build semantic broker input snapshot
produce candidate routes and adjudication evidence
record fallback/ask-human disabled state for ambiguity
prove no auto-route, tool declaration, runtime tier, context route, or request
manifest mutation occurs from broker output
```

### Phase 4 - Context / Request / Status Integration

```text
allow context packs and request manifests to cite governance/broker refs by id/digest
add display-only governance and broker status projections
add operation-history rows with actionability=false
preserve raw compiled text and raw prompt body non-storage law
```

### Phase 5 - Recovery And Regression

```text
startup recovery classification for packet/layer/broker pointer state
fixture regression matrix
raw-exposure and schema validation
sentinel counters
Markdown/JSON report
npm script integration
```

## Acceptance Criteria

```text
- DirectGovernanceSourceRef has explicit kind/confidence/renderer-safe fields and never stores raw text.
- Prompt layers carry authority taxonomy: harness-policy, current-user-intent, historical evidence, durable-memory evidence, baton evidence, omission status, broker diagnostic, governance diagnostic.
- governance_packet@1 is built from durable artifacts/projections, not renderer DOM state.
- compiled_prompt_layers@1 records ordered layer digests without storing raw compiled prompt text.
- compiled_prompt_layers@1 has providerInputMutationAllowedInThisPr=false.
- Memory, baton, omission, preview, and historical transcript layers are quoted/status evidence, not current instruction authority.
- Governance mode is off/shadow/enforce_unavailable only; enforce mode cannot block runtime in PR 9.
- workflow_transition_graph@1 diagnostics mirror existing runtime laws and do not introduce new hidden gates.
- D18 promotion requires graph artifact, digest citations, allowed/blocked fixture cases, and parity with existing controller behavior where checked.
- workflow_transition_graph@1 has edge kinds and blocked reason codes.
- Transition graph parity report compares diagnostic graph decisions with existing controller behavior where available.
- semantic_broker_registry_snapshot@1 and semantic_broker_input_snapshot@1 exist.
- semantic_broker_packet@1 classifies candidate routes but cannot auto-apply route, tool, schema, context, or runtime changes.
- Broker candidates include future-decision fields but mayAutoApplyInThisPr=false and autoRouteApplied=false.
- Broker ambiguity records disabled fallback/ask-human state; no enabled active-turn mutation is exposed.
- Fallback UI state is disabled; no active-turn mutation is exposed.
- Governance mode snapshot records enforceUnavailableReason when mode is enforce_unavailable.
- Request manifests and context packs cite governance/broker refs by id/digest only.
- Context packs/request manifests cite governance/broker refs under a citation policy; missing refs in shadow mode are diagnostics only.
- Provider-input projections may cite governance/broker digests but must not change provider input text in PR 9.
- Raw prompt/input non-storage tests cover user prompts, compiled prompt text, context text, tool args, workspace paths, and ChatGPT URLs.
- Governance/broker status projections are display-only and actionability=false.
- Operation history rows are read-only and cannot retry, resume, reroute, enforce, or edit policy.
- Current pointers are explicit for input snapshot, governance packet, compiled layers, transition graph, semantic broker packet, fallback, and shadow report.
- Attempt history records failed/blocked/raw-exposure attempts without replacing current pointers.
- Current pointer law prevents failed/blocked/raw-exposure attempts from replacing valid packets.
- Recovery state enum covers missing pointer, digest mismatch, schema invalid, raw exposure, missing layers, missing fallback, transition mismatch, corrupt.
- read_governance_status does not rebuild artifacts; refresh is explicit.
- Recovery classifies governance/broker artifacts without provider transport, app-server spawn, workspace reads, patch apply, command run, right-pane mutation, or handoff mutation.
- Raw-exposure scans cover packets, layers, broker packets, fallback states, status projections, reports, operation history, and renderer state snapshots.
- Fixture report sets coverageSource=fixture_governance_broker, matrixPromotionCandidate=false, authorityPromotionCandidate=false, runtimeAuthorityExercised=false, and providerAuthorityExercised=false.
- Operation ledger event names exist for governance/broker diagnostics.
- Transition fixture matrix covers allowed and blocked text/tool/patch/command/repair/fork/context-maintenance transitions.
- Broker fixture matrix covers text/read/patch/command/repair/fork/context-maintenance/unsupported/ambiguous prompts.
- Sentinel counters prove no provider/app-server/workspace/tool/runtime/right-pane/handoff authority path was exercised.
- Reports split promotion candidates: schema/diagnostic rows may move, enforce mode and auto-routing remain false.
- wouldBlockInFutureEnforceMode=true never blocks or degrades runtime in PR 9.
- No editable governance settings UI or semantic broker editor exists in PR 9.
```

## Success Condition

Passing this PR should mean:

```text
The Direct harness can explain, with durable renderer-safe artifacts, which
prompt-governance packet, layer ordering, transition graph, and semantic broker
classification would apply to a turn, and it can fail closed into diagnostic or
disabled fallback states when routing is ambiguous.
```

It should not mean:

```text
governance enforce mode exists
governance diagnostics can block runtime by themselves
semantic broker output can auto-route
compiled layers mutate provider input
new tools are enabled
auto-approval exists
context maintenance is rerun automatically
memory is current system/developer policy
right-pane ChatGPT is imported or controlled
handoffs are mutated
app-server can be removed
direct is production/default
```
