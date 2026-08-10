# Direct Context Maintenance, Memory, And Frontier Baton Spec

Status: draft PR 8 implementation specification for the long-lived
`codex/direct-chatgpt-harness` branch.

Related docs:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](./CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md](./DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md)
- [DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md](./DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md)
- [DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md](./DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md)
- [DIRECT_THREAD_EVIDENCE_WORKBENCH_AND_DERIVED_VIEWS_SPEC.md](./DIRECT_THREAD_EVIDENCE_WORKBENCH_AND_DERIVED_VIEWS_SPEC.md)
- [DIRECT_FRESH_FORK_STARTS_FROM_PREVIEWS_SPEC.md](./DIRECT_FRESH_FORK_STARTS_FROM_PREVIEWS_SPEC.md)

## Verdict

This is the next PR after fresh fork starts from previews.

PRs 1-7 proved and exposed the Direct lane through:

```text
real-provider read/patch/command proof
  -> recovery/replay safety
  -> bounded iterative repair
  -> workspace mutation truth
  -> implementation-lane UI/status
  -> thread evidence workbench
  -> fresh fork starts from preview evidence
```

The next confidence gap is long-context continuity. The harness can now create
and continue useful direct sessions, but context pressure is still handled by
simple recent-dialogue caps and omission counts. PR 8 adds the first explicit
context maintenance family:

```text
context pressure estimate
  -> maintenance route decision
  -> maintenance manifest
  -> optional durable thread memory refresh
  -> optional frontier_baton@1
  -> fail-closed raw-window trim
  -> context omission ledger
  -> context pack / request manifest source refs
```

This is not governance enforcement, semantic broker routing, sub-agent
coordination, or automatic memory editing. It is the substrate that makes those
future features possible without silently dropping required context.

## Matrix Scope

Rows:

```text
D1-D14
D22-D23
A12
J11
parts of C8-C10, C11, F8, F9, I5, I9, I15
```

This PR should move the Direct harness from ad hoc context caps toward explicit
maintenance evidence. Fixture/runtime coverage may move route, manifest,
memory, baton, trim, and omission rows forward. Provider-assisted compaction
rows can become promotion candidates only when live profile evidence proves the
exact provider shape.

## Core Law

```text
context maintenance != provider continuity
compaction summary != canonical rollout truth
durable memory != current instruction authority
frontier baton != permission to replay tools
omission ledger != hidden context
provider compact primitive != local memory law
context trim != permission to drop required artifacts
maintenance status != chat transcript content
```

The harness owns the law for what may be included, summarized, omitted, trimmed,
or refreshed. Provider output can help generate text only when the route permits
it and the resulting artifact is redaction-clean, source-cited, and durable.

## Product Boundary

Good:

```text
Direct branch only
left Codex lane context/status substrate
context pressure model
maintenance route matrix
maintenance manifests
durable thread memory artifact
memory refresh manifest
frontier_baton@1
raw-window trim policy
context omission ledger
context pack integration
request manifest source refs
status-lane UI posture
fixture/headless regression
```

Not included:

```text
production direct default
right-pane ChatGPT memory import
handoff queue mutation
app-server fallback
new implementation-lane tools
automatic tool replay
automatic provider stream resume
provider previous_response_id continuity from compacted turns
automatic memory editor UI
user-facing memory editor
governance enforce mode
semantic broker routing
sub-agent inspect/wait/spawn tools
hard purge/delete
```

## Existing Substrate

PR 8 should reuse and harden existing Direct artifacts:

```text
DirectSessionStore
DirectThreadStore
renderer_transcript@1
context_recent_dialogue@1
direct_context_pack@1
direct_request_manifest@1
direct_provider_input_projection@1
direct operation ledger
implementation-lane operation history
workspace effect summaries
fresh fork seed/context route
recovery scanner reports
runtime witness/status chips
```

It should not introduce a second context store. Maintenance artifacts are
additional source-of-truth records that context pack builders may cite.

## Source-Of-Truth Ordering

PR 8 uses one context maintenance source-of-truth chain:

```text
canonical rollout/session artifacts
  -> renderer/context projections
  -> context maintenance route
  -> maintenance manifest
  -> trim/memory/baton/omission artifacts
  -> context pack source refs
  -> request manifest source refs
```

Rules:

```text
renderer transcript projection may feed maintenance only through a validated
context projection

maintenance artifacts may be cited by context packs

maintenance artifacts are never canonical dialogue truth

durable memory and frontier baton must not become shadow transcripts

blocked/failed maintenance attempts may be retained as attempt history but must
not replace current valid pointers
```

## Terms

```ts
type DirectContextMaintenanceTrigger =
  | "before_new_turn"
  | "before_tool_continuation"
  | "before_fresh_fork"
  | "after_terminal_turn"
  | "manual_request"
  | "diagnostic_probe";

type DirectContextMaintenanceRouteClass =
  | "no_change"
  | "diagnostic"
  | "trim"
  | "compaction"
  | "memory"
  | "baton"
  | "blocked";

type DirectContextMaintenanceRouteKind =
  | "no_op"
  | "estimate_only"
  | "local_trim"
  | "local_compaction"
  | "remote_compaction"
  | "hybrid_compaction"
  | "memory_refresh"
  | "frontier_baton_build"
  | "blocked";

type DirectContextMaintenanceTiming =
  | "pre_request"
  | "turn_boundary"
  | "post_terminal"
  | "manual"
  | "diagnostic"
  | "unsupported_intra_turn";

type DirectContextMaintenanceEngine =
  | "none"
  | "local_deterministic"
  | "local_model_text"
  | "provider_compact_primitive"
  | "provider_text_summary"
  | "unsupported";

type DirectRequiredContextArtifactClass =
  | "current_user_intent"
  | "harness_policy"
  | "runtime_tier"
  | "open_tool_obligation"
  | "unresolved_patch_journal"
  | "command_result_pending_provider_visibility"
  | "workspace_effect_summary"
  | "recovery_required_state"
  | "frontier_baton_required"
  | "durable_memory_required"
  | "source_omission_marker"
  | "fresh_fork_seed"
  | "provider_parent_response_proof";

type DirectCompactionOutputKind =
  | "none"
  | "trim_only"
  | "deterministic_excerpt"
  | "model_text_summary"
  | "provider_compact_items"
  | "hybrid_summary_plus_required_refs";
```

V0 must support deterministic local maintenance and fixture-backed model
maintenance. Provider-assisted maintenance is a route/status/probe surface
unless exact live evidence exists.

Engine evidence boundaries:

```text
local_deterministic:
  may run in normal fixture/local runtime mode

local_model_text:
  diagnostic/fixture only unless its model request has its own context pack,
  request manifest, raw-exposure scan, and non-promotion report state

provider_compact_primitive:
  requires exact A12 compact item/request evidence

provider_text_summary:
  requires normal direct text request evidence plus local summary policy
```

Provider compact primitive and provider text summary are separate evidence
scopes. A successful text summary does not prove provider compact support, and
provider compact output does not prove durable memory quality.

## Route Matrix

Add a versioned route artifact:

```ts
type DirectContextMaintenanceRouteInput = {
  schema: "context_maintenance_route_input@1";
  projectId: string;
  threadId: string;
  trigger: DirectContextMaintenanceTrigger;
  modelId: string;
  pressureEstimateId?: string;
  pressureEstimateDigest?: string;
  currentContextProjectionId?: string;
  currentContextProjectionDigest?: string;
  activeObligationStateDigest?: string;
  recoveryStateDigest?: string;
  policyDigest: string;
  routeSelectorVersion: string;
};

type DirectContextMaintenanceRoute = {
  schema: "context_maintenance_route@1";
  routeId: string;
  projectId: string;
  threadId: string;
  sessionId?: string;
  turnId?: string;
  trigger: DirectContextMaintenanceTrigger;
  timing: DirectContextMaintenanceTiming;
  routeClass: DirectContextMaintenanceRouteClass;
  routeKind: DirectContextMaintenanceRouteKind;
  engine: DirectContextMaintenanceEngine;
  reasonCode:
    | "within_budget"
    | "approaching_budget"
    | "over_budget"
    | "required_artifact_at_risk"
    | "memory_stale"
    | "baton_required"
    | "route_unsupported"
    | "provider_evidence_missing"
    | "active_obligation_blocks_maintenance"
    | "recovery_state_blocks_maintenance"
    | "raw_exposure_blocked";
  inputDigest: string;
  policyDigest: string;
  routeSelectorVersion: string;
  routeDigest: string;
  rendererSafeSummary: string;
};
```

Route decisions must be idempotent and reproducible:

```text
same canonical route input + same policy digest + same route selector version
  -> same route

different route for the same input
  -> explicit new attempt and reason

renderer DOM state
  -> never part of route input
```

Allowed v0 routes:

```text
within budget:
  no_op

near budget:
  estimate_only or local_trim with omission ledger

over budget with representable omissions:
  local_trim + context_omission_ledger@1

over budget with required artifact at risk:
  blocked

manual memory refresh:
  memory_refresh fixture/local only unless live model route evidence exists

pre-request baton:
  frontier_baton_build when an active task frontier must survive trim

provider compact primitive:
  blocked or diagnostic unless exact A12 evidence is available
```

Blocked routes must be stable:

```text
context_maintenance_route_unsupported
context_budget_required_artifact_at_risk
context_maintenance_active_obligation
context_maintenance_recovery_required
context_maintenance_provider_evidence_missing
context_maintenance_raw_exposure_blocked
context_maintenance_schema_mismatch
```

## Timing Law

Maintenance timing is part of authority.

Allowed in v0:

```text
pre_request:
  estimate, trim, baton build, memory inclusion decision

turn_boundary:
  memory refresh, compact/trim artifact rebuild

post_terminal:
  mark memory stale, build diagnostic maintenance manifest

manual:
  fixture/local memory refresh, diagnostic compaction probe

diagnostic:
  route/pressure scan without provider or workspace side effects
```

Blocked in v0:

```text
while local action is running
while tool approval is pending
after patch/command side effect before recovery classifies it
after provider continuation sent with handoff unknown
while response stream is active
while operation ledger is corrupt
while renderer projection is the only available truth source
```

Maintenance must be read-only with respect to workspace mutation unless a later
spec adds explicit memory-writing authority. Writing app-private maintenance
artifacts is allowed.

## Pressure Model

Every context build should be able to cite a pressure estimate:

```ts
type DirectContextPressureEstimate = {
  schema: "direct_context_pressure_estimate@1";
  pressureId: string;
  projectId: string;
  threadId: string;
  sourceContextBuildId?: string;
  modelId: string;
  modelContextWindowEstimate?: number;
  estimatedInputTokens?: number;
  estimatedRequiredTokens?: number;
  estimatedOptionalTokens?: number;
  reservedOutputTokens: number;
  reservedReasoningTokens?: number;
  pressureState:
    | "unknown"
    | "within_budget"
    | "approaching_budget"
    | "over_budget"
    | "required_artifact_at_risk";
  estimateMethod:
    | "char_estimate"
    | "tokenizer"
    | "provider_usage_hint"
    | "unknown";
  estimateConfidence: "exact" | "derived" | "approximate" | "unknown";
  sourceDigest: string;
  policyDigest: string;
  includesRequiredRefs: {
    harnessPolicy: boolean;
    currentUserIntent: boolean;
    requestControls: boolean;
    toolResultEnvelopes: boolean;
    workspaceEffectSummaries: boolean;
    frontierBaton: boolean;
    durableMemory: boolean;
    omissionLedgerSummary: boolean;
  };
};
```

V0 may use conservative character/token estimates. Unknown context window or
unknown estimate does not allow silent trimming. It either proceeds with the
existing hard caps and explicit omissions, or blocks with an explainable route.

Unknown pressure is not maintenance authority:

```text
pressureState=unknown:
  no trim/compaction/memory refresh route may run automatically

context build may proceed only if existing hard caps are not exceeded
  otherwise block with pressure_unknown_over_budget_risk
```

Budget estimates must account for hidden required refs, not just visible
transcript text:

```text
harness policy
current user intent
request-control instructions
tool result envelopes
workspace effect summaries
frontier baton
durable memory
omission ledger summaries
```

## Maintenance Manifest

Every maintenance attempt writes a manifest:

```ts
type DirectContextMaintenanceManifest = {
  schema: "context_maintenance_manifest@1";
  manifestId: string;
  routeId: string;
  projectId: string;
  threadId: string;
  sessionId?: string;
  turnId?: string;
  status:
    | "planned"
    | "running"
    | "completed"
    | "blocked"
    | "failed"
    | "unsupported"
    | "diagnostic";
  coverageSource:
    | "fixture"
    | "local_runtime"
    | "real_provider"
    | "diagnostic";
  sourceRefs: DirectMaintenanceSourceRef[];
  sourceDigest: string;
  route: DirectContextMaintenanceRoute;
  pressureEstimate?: DirectContextPressureEstimate;
  outputKind: DirectCompactionOutputKind;
  producedArtifacts: {
    durableMemoryId?: string;
    memoryRefreshId?: string;
    frontierBatonId?: string;
    compactionSummaryId?: string;
    omissionLedgerId?: string;
    trimReportId?: string;
  };
  requestControls?: {
    store: false;
    previousResponseId: false;
    parallelToolCalls: false;
    tools: false;
  };
  integrity: {
    algorithm: "hmac-sha256" | "sha256";
    keyId?: string;
    artifactDigest: string;
    sourceDigest: string;
    previousArtifactDigest?: string;
    sourceDigestVerified: boolean;
    schemaVersion: string;
  };
  rawPathExposed: false;
  rawUrlExposed: false;
  rawCredentialsExposed: false;
  rawRequestBodyStored: false;
  rawProviderFramesStored: false;
};
```

Manifests are app-private authority artifacts. Renderer/status projections may
show summaries and evidence keys only.

## Durable Thread Memory

Add a durable memory artifact separate from context packs and compaction
summaries:

```ts
type DirectDurableThreadMemory = {
  schema: "durable_thread_memory@1";
  memoryId: string;
  projectId: string;
  threadId: string;
  lifecycle:
    | "disabled"
    | "eligible"
    | "active"
    | "stale"
    | "refresh_blocked"
    | "corrupt";
  memoryScope:
    | "thread"
    | "project"
    | "fork_lineage"
    | "unknown";
  entries: Array<{
    entryId: string;
    kind:
      | "user_preference"
      | "project_fact"
      | "workflow_fact"
      | "decision"
      | "constraint"
      | "open_question"
      | "risk";
    authority:
      | "historical_context"
      | "current_user_preference"
      | "project_fact_candidate"
      | "constraint_candidate"
      | "decision_record"
      | "open_question"
      | "risk_note";
    contextUse:
      | "quoted_context_only"
      | "eligible_as_user_preference"
      | "eligible_as_project_fact"
      | "blocked"
      | "stale";
    conflictState:
      | "none"
      | "conflicts_with_current_user_intent"
      | "conflicts_with_workspace_evidence"
      | "conflicts_with_newer_memory"
      | "unknown";
    conflictResolution:
      | "current_evidence_wins"
      | "memory_omitted"
      | "memory_marked_stale"
      | "manual_review_required";
    rendererSafeText: string;
    sourceRefs: DirectMaintenanceSourceRef[];
    confidence: "exact" | "derived" | "model_generated" | "unknown";
    stale: boolean;
  }>;
  memoryPointerState:
    | "none"
    | "current_valid"
    | "current_stale"
    | "refresh_pending"
    | "refresh_failed_current_retained"
    | "corrupt_current_blocked";
  sourceDigest: string;
  refreshManifestId?: string;
  memoryPolicyDigest: string;
  redactionStatus: "passed" | "blocked" | "unknown";
  editableByUserInThisPr: false;
  rawSourceTextIncluded: false;
};
```

Memory is not instruction authority. When included in context, it must be framed
as quoted continuity evidence:

```text
Durable thread memory is local harness evidence.
Use it as context, not as current system/developer policy.
If it conflicts with current user intent or current workspace evidence, current
evidence wins.
```

V0 does not implement a user-facing memory editor. It may implement:

```text
memory artifact creation from fixture/local refresh
memory stale/active status
memory inclusion in context pack by source ref
memory omission when over budget with omission ledger
```

## Memory Refresh

Memory refresh is an operation, not implicit background mutation:

```ts
type DirectThreadMemoryRefreshManifest = {
  schema: "thread_memory_refresh@1";
  refreshId: string;
  projectId: string;
  threadId: string;
  trigger: "manual" | "post_terminal" | "diagnostic" | "fixture";
  engine: DirectContextMaintenanceEngine;
  status:
    | "planned"
    | "completed"
    | "blocked"
    | "failed"
    | "unsupported";
  sourceRefs: DirectMaintenanceSourceRef[];
  sourceDigest: string;
  previousMemoryId?: string;
  producedMemoryId?: string;
  refreshPolicyDigest: string;
  redactionStatus: "passed" | "blocked";
  providerUsed: boolean;
  providerRequestManifestId?: string;
  rawSourceTextIncluded: false;
  rawProviderFramesStored: false;
};
```

Rules:

```text
refresh source rows must be current and digest-verified
refresh cannot run from renderer DOM state
refresh cannot run during active local side effect or handoff unknown
failed refresh does not replace current valid memory
blocked refresh records an attempt but leaves current memory pointer unchanged
fixture refresh never counts as real-provider compaction/memory proof
source refs must not be stale renderer rows
source refs must not be blocked projections
source refs must not be raw imported JSONL
source refs derived from workbench/operation history must include operation
ledger head digest
```

Memory pointer law:

```text
current_memory_id points only to active or stale-but-safe memory

blocked/failed/corrupt refresh attempts are recorded as attempts but never
become current

new completed memory replaces previous current memory only after
redaction/integrity/source checks pass
```

No renderer IPC endpoint may directly create, update, or delete memory entries
in PR 8. Manual memory refresh may trigger a controlled refresh operation, but
the renderer cannot author durable memory text.

## Frontier Baton

Add a turn/frontier survival artifact:

```ts
type DirectFrontierBaton = {
  schema: "frontier_baton@1";
  batonId: string;
  projectId: string;
  threadId: string;
  sessionId?: string;
  turnId?: string;
  batonKind:
    | "pre_request"
    | "repair_loop"
    | "fresh_fork"
    | "maintenance"
    | "diagnostic";
  frontier: {
    currentUserGoalDigest?: string;
    rendererSafeGoalSummary?: string;
    lastKnownAssistantState?: string;
    nextExpectedAction?:
      | "assistant_final"
      | "read_file"
      | "apply_patch"
      | "run_command"
      | "fresh_fork"
      | "user_decision"
      | "unknown";
    openObligationRefs: DirectMaintenanceSourceRef[];
    unresolvedRiskRefs: DirectMaintenanceSourceRef[];
    workspaceEffectRefs: DirectMaintenanceSourceRef[];
    recoveryStateRef?: DirectMaintenanceSourceRef;
  };
  batonRequirement:
    | "not_required"
    | "optional"
    | "required_for_trim"
    | "required_for_repair_loop"
    | "required_for_fresh_fork"
    | "required_due_to_open_obligation";
  batonState:
    | "present"
    | "missing"
    | "stale"
    | "blocked";
  openState: {
    activeObligationIds: string[];
    unresolvedRecoveryState?: string;
    workspaceEffectSummaryIds: string[];
    pendingApprovalIds: string[];
    sourcePreviewIds: string[];
  };
  sourceRefs: DirectMaintenanceSourceRef[];
  sourceDigest: string;
  supersedesBatonId?: string;
  supersededByBatonId?: string;
  validUntil:
    | "next_user_turn"
    | "next_tool_obligation"
    | "next_terminal"
    | "manual_refresh"
    | "unknown";
  batonPolicyDigest: string;
  providerContinuityHandleIncluded: false;
  toolReplayAuthorityIncluded: false;
  replayAuthority: false;
  approvalAuthority: false;
  continuationAuthority: false;
  rawContextTextIncluded: false;
};
```

Baton inclusion in a context pack is status evidence. It never grants approval
to replay a read, patch, command, continuation, fork start, or memory refresh.
If baton is required and missing/stale, context build blocks with
`disabled_baton_missing` or `baton_stale`.

## Raw-Window Trim Policy

Add a fail-closed trim policy:

```ts
type DirectRawWindowTrimPolicy = {
  schema: "raw_window_trim_policy@1";
  policyId: string;
  requiredArtifactClasses: DirectRequiredContextArtifactClass[];
  optionalArtifactClasses: Array<
    | "older_dialogue"
    | "compaction_summary"
    | "historical_memory"
    | "operation_history_summary"
  >;
  blockedIfRequiredClassWouldDrop: true;
  omissionLedgerRequired: true;
  policyDigest: string;
};
```

Rules:

```text
current user intent is never trimmed
harness policy/request controls are never trimmed
open obligation/tool result evidence is never trimmed silently
workspace mutation truth is never replaced by vague assistant memory
frontier baton is required when active task state would otherwise be lost
durable memory may be omitted only with explicit omission entry
older dialogue may be trimmed only with source/count/reason recorded
```

Before trim is applied, write a trim plan:

```ts
type DirectContextOmissionCandidate = {
  candidateId: string;
  sourceArtifactKind: string;
  sourceArtifactId: string;
  sourceDigest: string;
  sourceStableKeys?: string[];
  estimatedCharCount?: number;
  estimatedTokenCount?: number;
  requiredArtifactClass?: DirectRequiredContextArtifactClass;
  omissionReason: string;
};

type DirectRawWindowTrimPlan = {
  schema: "raw_window_trim_plan@1";
  trimPlanId: string;
  routeId: string;
  projectId: string;
  threadId: string;
  sourceContextProjectionId: string;
  sourceContextProjectionDigest: string;
  requiredArtifactClasses: DirectRequiredContextArtifactClass[];
  candidateOmissions: DirectContextOmissionCandidate[];
  blockedRequiredArtifacts: DirectRequiredContextArtifactClass[];
  trimPolicyDigest: string;
  planDigest: string;
  status: "planned" | "blocked" | "applied";
};
```

Only a valid trim plan may produce an omission ledger. If a required artifact
class would be omitted, the route blocks with
`context_budget_required_artifact_at_risk`.

## Context Omission Ledger

Every omission must be represented:

```ts
type DirectContextOmissionLedgerEntry = {
  omissionId: string;
  sourceArtifactKind:
    | "renderer_transcript"
    | "context_recent_dialogue"
    | "fresh_fork_seed"
    | "durable_thread_memory"
    | "frontier_baton"
    | "workspace_effect_summary"
    | "operation_history";
  sourceArtifactId: string;
  sourceDigest: string;
  sourceStableKeys?: string[];
  omittedItemCount: number;
  omittedTurnCount?: number;
  omittedCharCount?: number;
  omittedTokenEstimate?: number;
  reason:
    | "over_budget"
    | "optional_history"
    | "duplicate_memory"
    | "superseded_by_baton"
    | "redaction_blocked"
    | "policy_excluded"
    | "unsupported_source";
  requiredArtifact: boolean;
  rendererSafeSummary: string;
  rawTextIncluded: false;
};

type DirectContextOmissionLedger = {
  schema: "context_omission_ledger@1";
  omissionLedgerId: string;
  projectId: string;
  threadId: string;
  contextBuildId?: string;
  trimPlanId?: string;
  entries: DirectContextOmissionLedgerEntry[];
  totals: {
    entryCount: number;
    itemCount: number;
    turnCount?: number;
    textCharCount?: number;
    tokenEstimate?: number;
  };
  ledgerDigest: string;
  rawSourceTextIncluded: false;
};
```

An omission ledger is not hidden context. Provider-facing context may include a
short summary of omissions, but not the omitted raw text.

Omission parity tests are required:

```text
every removed context item has an omission ledger entry
every omission ledger source ref exists and digest-matches
context pack omittedCounts equals omission ledger totals
no required artifact class is omitted unless route=blocked
```

## Context Pack Integration

Extend context packs to cite maintenance artifacts:

```ts
type DirectContextPackMaintenanceRefs = {
  pressureEstimateId?: string;
  maintenanceManifestIds: string[];
  durableMemoryId?: string;
  frontierBatonId?: string;
  omissionLedgerId?: string;
  rawWindowTrimPolicyDigest?: string;
};
```

Context pack order should remain deterministic:

```text
harness policy
request controls / route facts
current user intent
frontier baton status evidence if required
durable memory evidence if selected
current tool/workspace/fork status evidence if present
recent dialogue or compaction summary
omission ledger summary
```

Do not use durable memory, baton, or compaction summaries as current
system/developer policy. They are quoted local evidence with source refs.

## Request Manifest Integration

Every request after PR 8 should be able to report:

```ts
type DirectRequestManifestMaintenanceRefs = {
  pressureEstimateId?: string;
  routeId?: string;
  maintenanceManifestIds: string[];
  durableMemoryId?: string;
  frontierBatonId?: string;
  omissionLedgerId?: string;
  requiredArtifactsPreserved: boolean;
  omittedArtifactCount: number;
};
```

If the context route blocks, no provider request is built. If the request
manifest exists, it must cite the exact maintenance/omission evidence used to
build provider input.

Missing or mismatched required refs are stable request blockers:

```text
required_pressure_estimate_missing
required_omission_ledger_missing
required_memory_ref_missing
required_baton_ref_missing
maintenance_ref_digest_mismatch
maintenance_ref_raw_exposure_blocked
```

## Provider-Assisted Compaction

A12 remains strict.

Provider-assisted compaction may be represented as:

```text
unsupported
diagnostic_probe
fixture
real_provider
```

Only `real_provider` can promote provider compaction rows, and only when all
are true:

```text
exact model/account/endpoint/request-shape evidence
store=false
previousResponseId=false unless a future spec explicitly changes this
parallelToolCalls=false
tools=false
redaction-clean request/response
compaction result stored as artifact, not raw provider frame
source refs and omission ledger preserved
request manifest cites current harness policy
```

V0 should not depend on provider compact support for normal Direct operation.
If provider compact evidence is missing, use local deterministic trim or block.

Provider maintenance diagnostics require explicit opt-in:

```text
CODEX_DIRECT_CONTEXT_MAINTENANCE_PROVIDER=1

if CI=true:
  CODEX_DIRECT_CONTEXT_MAINTENANCE_ALLOW_CI=1
```

Provider compact output policy:

```text
provider_compact_primitive output may be stored/cited as compact items only

opaque/encrypted compact items must not be inspected or reinterpreted as
durable memory text

provider compact items cannot become durable_thread_memory@1 unless a separate
memory refresh policy consumes them and produces redaction-clean memory entries
```

## Recovery

Recovery must classify maintenance states without rerunning maintenance:

```ts
type DirectContextMaintenanceRecoveryState =
  | "healthy"
  | "route_planned_no_manifest"
  | "manifest_running_interrupted"
  | "trim_plan_no_ledger"
  | "omission_ledger_missing"
  | "memory_refresh_completed_no_pointer"
  | "memory_refresh_failed_current_retained"
  | "memory_corrupt"
  | "baton_required_missing"
  | "baton_stale"
  | "provider_compaction_handoff_unknown"
  | "raw_exposure_blocked"
  | "corrupt";
```

Rules:

```text
startup recovery does not append operation ledger events
startup recovery does not rebuild memory, baton, or omission ledgers
failed maintenance does not replace current valid memory/context pointers
provider handoff unknown is never retried automatically
manifest corruption blocks clean context build
renderer projections are display hydration only, never recovery truth
```

## UI Posture

Maintenance UI belongs in status and operation history, not in chat transcript.

Renderer-safe status:

```ts
type DirectContextMaintenanceStatusProjection = {
  schema: "direct_context_maintenance_status_projection@1";
  projectId: string;
  threadId: string;
  uiProjectionGeneration: number;
  sourceDigest: string;
  operationLedgerHeadDigest: string;
  currentRouteId?: string;
  currentManifestId?: string;
  currentMemoryId?: string;
  currentBatonId?: string;
  currentOmissionLedgerId?: string;
  pressureState: DirectContextPressureEstimate["pressureState"];
  routeKind: DirectContextMaintenanceRouteKind;
  memoryState: DirectDurableThreadMemory["lifecycle"];
  batonState:
    | "not_required"
    | "present"
    | "missing_required"
    | "stale"
    | "blocked";
  omissionState:
    | "none"
    | "represented"
    | "missing_required"
    | "blocked";
  composerAllowed: boolean;
  composerAllowedReason:
    | "within_budget"
    | "maintenance_completed"
    | "disabled_context_pressure"
    | "disabled_memory_refresh_required"
    | "disabled_baton_missing"
    | "disabled_omission_ledger_missing"
    | "disabled_recovery_required"
    | "disabled_corrupt";
  rendererSafeMessageCode: string;
};
```

Status projections are display-only. Renderer actions must not use maintenance
chips as authority.

The UI may show:

```text
context pressure chip
maintenance route status
memory active/stale/blocked chip
frontier baton present/missing chip
omission count/status
operation history rows
```

It must not show raw memory source text, raw compaction prompts, raw provider
frames, or raw omitted spans.

Maintenance artifacts do not update the chat transcript:

```text
maintenance rows may appear in operation history/status lane

they must not be inserted into user/assistant chat transcript as if spoken

if shown in a transcript-like region, they use a distinct non-chat status item
type
```

## Raw Exposure

Scan all generated surfaces:

```text
maintenance manifests
pressure estimates
durable memory artifacts
memory refresh manifests
frontier baton artifacts
omission ledgers
context packs
request manifests
provider input projections
operation history rows
renderer status projections
JSON reports
Markdown summaries
console summaries
renderer storage/DOM snapshots if UI touched
```

Forbidden:

```text
raw auth tokens
raw provider frames
raw request bodies
absolute host/WSL paths
raw ChatGPT URLs
raw omitted text
raw memory source text in renderer surfaces
internal SQLite exception text
unscoped raw hashes instead of evidence keys
```

## Report Shape

Add a headless report:

```ts
type DirectContextMaintenanceRegressionReport = {
  schema: "direct_context_maintenance_regression_report@1";
  generatedAt: string;
  coverageSource: "fixture_context_maintenance" | "local_runtime" | "real_provider" | "diagnostic";
  matrixRowsExercised: string[];
  matrixPromotionCandidate: boolean;
  cases: Array<{
    caseId: string;
    status: "passed" | "blocked" | "failed" | "unsupported" | "diagnostic";
    routeKind: DirectContextMaintenanceRouteKind;
    pressureState: DirectContextPressureEstimate["pressureState"];
    manifestWritten: boolean;
    memoryArtifactWritten: boolean;
    batonWritten: boolean;
    omissionLedgerWritten: boolean;
    requestManifestBuilt: boolean;
    providerRequestStarted: boolean;
    rawExposureBlocked: boolean;
  }>;
  sentinelCounters: {
    providerTransportCalls: number;
    appServerSpawnCalls: number;
    workspaceReadCalls: number;
    patchApplyCalls: number;
    commandRunCalls: number;
    rightPaneMutationCalls: number;
    handoffMutationCalls: number;
    memoryEditorWrites: number;
  };
  rawExposureScan: {
    status: "passed" | "blocked" | "failed";
    scannedArtifactCount: number;
  };
  matrixPromotion: {
    providerCompactionPromoted: false;
    fixtureMemoryPromoted: false;
  };
  promotionCandidates: {
    D1_routeMatrix: boolean;
    D2_pressureModel: boolean;
    D7_frontierBaton: boolean;
    D10_durableMemory: boolean;
    D11_memoryRefresh: boolean;
    D13_trimPolicy: boolean;
    D14_omissionLedger: boolean;
    D22_manifest: boolean;
    A12_providerCompaction: boolean;
  };
};
```

Fixture coverage must not promote provider compaction or production memory
claims.

`A12_providerCompaction` remains false unless exact live provider compact
evidence exists for the selected model/account/endpoint/request-shape scope.

## Regression Matrix

Minimum fixture/headless cases:

```text
pressure_within_budget_no_op
pressure_approaching_budget_estimate_only
over_budget_local_trim_with_omission_ledger
over_budget_required_artifact_at_risk_blocks
durable_memory_fixture_refresh_creates_artifact
failed_memory_refresh_preserves_current_memory
frontier_baton_build_and_context_pack_ref
missing_required_baton_blocks_context_build
omission_ledger_missing_blocks_clean_context
provider_compaction_evidence_missing_blocks_live_route
provider_compaction_fixture_not_promotion
context_pack_cites_maintenance_refs
request_manifest_cites_maintenance_refs
recovery_does_not_rerun_maintenance
raw_exposure_blocks_memory_source_leak
operation_history_status_only_not_chat_transcript
sentinel_no_app_server_no_right_pane_no_handoff_no_tools
active_obligation_blocks_maintenance
handoff_unknown_blocks_maintenance
corrupt_ledger_blocks_maintenance
raw_exposure_in_memory_blocks
unknown_pressure_no_trim
omission_parity_mismatch_blocks_report
```

Optional live/provider cases:

```text
provider_compaction_probe_diagnostic
provider_text_summary_memory_refresh_diagnostic
```

Optional live cases must require explicit opt-in and must remain
non-promoting unless the exact request-shape evidence is accepted.

## Operation Ledger

Add operation families:

```text
context_pressure_estimate_recorded
context_maintenance_route_selected
context_maintenance_manifest_recorded
raw_window_trim_planned
raw_window_trim_applied
context_omission_ledger_recorded
thread_memory_refresh_planned
thread_memory_refresh_completed
thread_memory_refresh_failed
durable_thread_memory_recorded
frontier_baton_recorded
context_maintenance_blocked
```

Events cite artifact ids and digests only. They do not contain raw memory text,
raw omitted text, raw prompts, raw provider responses, or raw paths.

Ordering rules:

```text
pressure estimate must precede route selection
route selection must precede maintenance manifest
trim plan must precede raw-window trim and omission ledger
blocked route writes a blocked manifest only
failed/blocked memory refresh does not write durable memory as current
baton writes occur only after source digest is verified
```

## Implementation Order

### Phase -2 - Law and Schema

Define:

```text
required artifact classes
trim plan artifact
route matrix
timing law
pressure estimate
maintenance manifest
durable memory
memory refresh manifest
frontier_baton@1
raw_window_trim_policy@1
context_omission_ledger@1
renderer-safe status schema
maintenance recovery states
request-manifest blocker codes
```

### Phase -1 - Source-of-Truth Wiring

Add app-private storage and pointers:

```text
current durable memory pointer
current maintenance status pointer
manifest history
baton refs
omission ledger refs
request manifest source refs
context pack source refs
maintenance artifact integrity chain
blocked/failed attempt history
```

Blocked/failed attempts do not replace current valid pointers.

### Phase 0 - Pressure and Route Controller

Implement:

```text
budget estimate
budget estimate includes hidden required refs
route selection
canonical route input hash
routeClass
unknown pressure behavior
timing blockers
stable blocker codes
provider diagnostic opt-in guard
no provider/app-server/workspace mutation sentinels
```

### Phase 1 - Omission and Trim

Implement:

```text
raw_window_trim_plan@1
raw-window trim policy
required artifact preservation
context omission ledger
omission ledger row schema
context pack omission summaries
fail-closed behavior
omission parity tests
```

### Phase 2 - Durable Memory

Implement:

```text
durable_thread_memory@1 artifact
fixture/local memory refresh manifest
current memory pointer law
memory entry authority/contextUse taxonomy
memory conflict handling
source freshness checks
memory status projection
memory context inclusion by source ref
no memory editor IPC
```

### Phase 3 - Frontier Baton

Implement:

```text
frontier_baton@1 artifact
batonRequirement
baton stale/supersession law
repair-loop/fork/status source refs
open obligation/source refs
context pack integration
missing/stale baton blockers
status chip/operation history rows
no replay/approval/continuation authority fields
```

### Phase 4 - Recovery and Reports

Implement:

```text
maintenance recovery classifier
no-rerun recovery sentinels
route-specific promotion candidates
provider compact opaque-item policy
headless regression runner
schema validation before/after raw scan
minimal safe redaction-failed report
```

## Acceptance Criteria

- Route decisions are idempotent by canonical route input, policy digest, and route selector version.
- Route model separates `routeClass` from `routeKind`.
- Required context artifact classes are enumerated and used by raw-window trim policy.
- `raw_window_trim_plan@1` exists before `local_trim` is applied.
- Context maintenance route matrix is versioned as `context_maintenance_route@1`.
- Every context build can cite a pressure estimate or explicitly record why it cannot.
- Maintenance attempts write `context_maintenance_manifest@1`.
- Route timing blocks unsafe maintenance during active local action, pending approval, active stream, handoff unknown, or corrupt ledger.
- Raw-window trim policy preserves required artifact classes or blocks.
- Every context omission is represented in `context_omission_ledger@1`.
- Omission ledgers include source artifact id, digest, count, reason, and renderer-safe summary.
- Omission parity tests compare ledger totals to context pack omitted counts and source refs.
- `local_model_text` maintenance is diagnostic/fixture unless it has its own context pack, request manifest, raw-exposure scan, and non-promotion report state.
- Provider compact primitive and provider text summary are separate evidence scopes.
- Provider compact output is treated as opaque compact items, not durable memory text.
- Durable memory is stored as `durable_thread_memory@1`, separate from context pack and compaction summary.
- Durable memory entries include authority, contextUse, conflictState, and conflictResolution fields.
- Memory refresh is explicit through `thread_memory_refresh@1`; failed refresh does not replace current memory.
- Memory pointer law ensures failed/blocked/corrupt refresh attempts do not replace current memory.
- Memory refresh source refs must be current, digest-verified, and not renderer-DOM-only.
- Memory is context evidence, not current system/developer policy.
- No renderer IPC endpoint can directly create/update/delete memory entries in PR 8.
- `frontier_baton@1` records task frontier/open state without replay authority.
- `frontier_baton@1` includes open obligations, unresolved risks, workspace-effect refs, recovery-state refs, and explicit `replayAuthority=false`, `approvalAuthority=false`, and `continuationAuthority=false`.
- Baton requirement and stale/supersession rules are explicit.
- Baton inclusion in context pack never grants approval to replay read/patch/command/continuation/fork actions.
- Context packs cite maintenance refs, memory refs, baton refs, trim policy digest, and omission ledger id when used.
- Request manifests cite the same maintenance refs and block if required refs are missing.
- Request manifests block on missing or digest-mismatched required pressure/memory/baton/omission refs.
- Provider-assisted compaction is blocked or diagnostic unless exact live evidence exists.
- Provider maintenance diagnostics require explicit live opt-in and CI override.
- Fixture compaction/memory coverage cannot promote provider compaction rows.
- Recovery classifies maintenance artifacts without rerunning maintenance or provider transport.
- Maintenance recovery states distinguish missing omission ledger, memory corrupt, baton stale/missing, provider handoff unknown, and raw exposure blocked.
- Operation ledger ordering for maintenance events is specified.
- All maintenance artifacts carry integrity metadata and source digest.
- Maintenance UI/status is separate from chat transcript content.
- Maintenance status projections include generation/source digests and remain display-only.
- Maintenance artifacts do not insert user/assistant chat transcript messages.
- Unknown pressure does not authorize trim/compaction automatically.
- Context pressure estimates account for hidden required refs such as harness policy, tool results, workspace effects, baton, memory, and omission ledger summaries.
- Reports expose route-specific promotion candidates; A12 provider compaction stays false unless exact live evidence exists.
- Operation history rows are read-only and cite artifact ids/digests only.
- Raw-exposure scan covers manifests, memory, baton, omission ledgers, context packs, request manifests, reports, and renderer status.
- Sentinel counters prove no app-server spawn, right-pane mutation, handoff mutation, workspace mutation, patch apply, command run, or provider transport in fixture/local maintenance cases unless explicitly opted into provider diagnostics.
- Report schema validates before serialization and after write; redaction failure writes only a minimal safe report.

## Final Meaning

Passing this PR should mean:

```text
The Direct harness can decide and record how context is maintained under
pressure, preserve required artifacts, represent omissions, carry durable memory
and frontier state as evidence, and block instead of silently dropping context.
```

It should not mean:

```text
automatic compaction is production-ready
provider compact is available by default
durable memory is editable by users
memory is system/developer policy
frontier baton can replay tools
governance enforce mode exists
semantic broker routing exists
sub-agent orchestration exists
right-pane ChatGPT memory is imported
app-server can be removed
```
