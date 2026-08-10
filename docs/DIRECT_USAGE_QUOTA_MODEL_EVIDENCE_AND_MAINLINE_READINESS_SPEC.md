# Direct Usage, Quota, Model Evidence, And Mainline Readiness Spec

Status: draft for PR 11.

Purpose: define the final Direct-harness confidence bundle after real-provider
implementation-lane proof, recovery, repair loops, workspace mutation truth,
implementation-lane UI, thread workbench, fresh fork starts, context
maintenance, governance diagnostics, and sub-agent observability. This PR makes
model availability, usage, quota/rate status, drift, report validation, and
mainline-readiness gates explicit without adding runtime authority.

Related docs:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](./CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_REAL_USAGE_STABILIZATION_AND_HEADLESS_REGRESSION_SPEC.md](./DIRECT_REAL_USAGE_STABILIZATION_AND_HEADLESS_REGRESSION_SPEC.md)
- [CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md](./CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_UI_AND_OPERATION_HISTORY_SPEC.md)
- [DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md](./DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md)
- [DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md](./DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md)

## Summary

PR 11 should implement **Direct usage, quota, model evidence, and mainline
readiness**.

The target rows are:

```text
A7   Model descriptors/catalog
A8   Reasoning/verbosity controls
A9   Prompt cache/session affinity evidence
A10  Usage/quota/rate evidence
C13  Thread analytics/usage projection
F9   Runtime witness chips
I1   ODEU profile schema
I2   Evidence states
I3   Exact-scope evidence
I4   Diagnostic non-promotion
I5   Raw-exposure scanning
I6   Headless text regression
I7   Headless implementation-lane regression report integration
I8   Fixture suite
I9   Recovery/replay suite status integration
I10  Usage ledger
I11  Cost estimator scaffold only
I12  Drift watch
I13  Capability downgrade
I14  CI live-call guard
I15  Report schema validation
J8   Model/evidence status
J12  Maintenance hygiene
```

This PR should turn the direct branch from "many feature bundles exist" into a
branch with a clear, durable answer to:

```text
Which model/profile/request shapes are usable?
What usage evidence did direct observe?
What quota/rate evidence is known or unknown?
Which evidence expired, mismatched, or drifted?
Which controls were downgraded because evidence is stale?
Is direct ready to live behind a guarded mainline flag?
```

It should not make Direct production, default, billing-grade, or broader than the
capabilities already proven by earlier PRs.

## Core Law

```text
model catalog != tool authority
usage ledger != billing truth
quota snapshot != guaranteed entitlement
quota unknown != zero quota
usage missing != zero usage
pricing estimate != invoice
runtime witness chip != capability promotion
profile baseline != live account proof
diagnostic run != readiness gate
mainline readiness != production default
flagged direct path != app-server replacement
```

The harness may use usage/model/quota evidence to explain status, downgrade
capabilities, and block unsafe Direct controls. It must not infer a model, tier,
tool, quota, or billing state from missing data.

## Product Boundary

This PR includes:

```text
model catalog evidence resolver
model/control descriptor snapshots
quota/rate snapshot artifacts when available
usage ledger rows for direct requests
runtime evidence status projection
runtime witness chip source tightening
drift watch reports
report schema validation registry
fixture and optional live usage-readiness regression
capability downgrade on evidence expiry/mismatch
mainline merge-behind-flag checklist
docs and migration notes
```

This PR does not include:

```text
new provider tools
new local authority
new implementation-lane approvals
Direct as default runtime
automatic provider probing
billing-grade cost or invoice truth
editable pricing settings
editable quota settings
new model selector behavior
provider-side quota mutation
right-pane ChatGPT import or control
handoff mutation
app-server removal
```

## Preconditions

PR 11 may run readiness aggregation only when the earlier bundle reports exist or
are explicitly marked skipped:

```text
PR 1 real-provider implementation-lane proof
PR 2 recovery and replay safety
PR 3 iterative repair loop
PR 4 workspace mutation truth
PR 5 implementation-lane UI/status
PR 6 thread evidence workbench
PR 7 fresh fork starts from previews
PR 8 context maintenance/memory/baton
PR 9 governance and semantic broker diagnostics
PR 10 sub-agent observability
text-only first-turn and recent-dialogue regressions
app-server baseline regression
```

If any prerequisite is missing, PR 11 should still produce a readiness report,
but it must set:

```text
mainlineReadiness = blocked
matrixPromotionCandidate = false
missingPreconditions = [...]
```

Missing prerequisite evidence must not be interpreted as success.

### Prerequisite Waivers

If a prerequisite is skipped, the skip must be typed and auditable. "Skipped"
without a waiver is equivalent to missing.

```ts
type DirectReadinessPrecondition = {
  preconditionId: string;
  required: boolean;
  status:
    | "present_valid"
    | "present_invalid"
    | "missing"
    | "skipped_with_waiver"
    | "not_applicable";
  waiver?: {
    waiverId: string;
    reason:
      | "feature_not_in_current_merge_scope"
      | "diagnostic_only"
      | "temporarily_disabled"
      | "blocked_by_policy";
    approvedBy:
      | "developer"
      | "maintainer"
      | "test_fixture";
    expiresAt?: string;
  };
  evidenceRefs: DirectEvidenceRef[];
};
```

Rules:

```text
missing required precondition -> readiness blocked
present_invalid required precondition -> readiness blocked
skipped_with_waiver -> diagnostic_only unless the gate marks the feature as
  out of current merge scope
not_applicable -> allowed only for optional or explicitly scoped-out features
```

### Readiness Versus Runtime Enablement

Mainline readiness and project runtime enablement are separate facts.

```ts
type DirectMainlineReadiness =
  | "ready_behind_flag"
  | "blocked"
  | "diagnostic_only";

type DirectRuntimeEnablement =
  | "no_projects_enabled"
  | "eligible_projects_only"
  | "diagnostic_only"
  | "blocked";
```

`ready_behind_flag` can be true while `runtimeEnablement` is
`no_projects_enabled` or `eligible_projects_only`. For example, the branch may be
safe to merge behind explicit flags while all current project evidence is
expired or quota is exhausted.

### Default Baseline Invariants

These are hard gates, not descriptive fields:

```text
direct_default_false
app_server_baseline_required
app_server_removal_forbidden
```

If any invariant changes, readiness must be `blocked`.

## Source Of Truth

PR 11 should reuse existing direct-harness stores and projections:

```text
ODEU baseline profile
  -> live probe evidence store
  -> normalized provider/app-server events
  -> direct runtime status resolver
  -> operation ledger / report artifacts
  -> model catalog snapshot
  -> quota/rate snapshot
  -> usage ledger
  -> drift watch report
  -> readiness report
  -> renderer-safe witness/status projection
```

Rules:

```text
Profile docs can describe possible capabilities.
Live probe evidence can prove exact request/model/account/endpoint scope.
Normalized events can record usage and quota/rate/error observations.
Runtime status can explain readiness and blockers.
Readiness reports can aggregate prior reports and status.
Renderer state is never evidence authority.
```

Do not create a second model catalog, second usage ledger, or second runtime
status system if an existing direct artifact can be extended.

## Existing Substrate

Already present on the direct branch:

```text
DirectLiveProbeEvidenceStore
direct_codex_live_probe_evidence@1
direct_codex_runtime_status@1
direct_text_request_shape@1
normalized usage_delta events
quota_error classification
direct real-usage regression runner
runtime witness/status UI projection concepts
ODEU imported profile docs
report redaction and raw-exposure scanning conventions
CI live-call opt-in guards
```

PR 11 should harden and compose those pieces into one readiness layer.

## Evidence States

Use the existing evidence state vocabulary and add explicit readiness mappings:

```ts
type DirectEvidenceState =
  | "accepted"
  | "runtime_probed"
  | "candidate"
  | "diagnostic"
  | "unstable"
  | "rejected"
  | "expired"
  | "scope_mismatch"
  | "artifact_missing"
  | "artifact_corrupt"
  | "unknown";

type DirectReadinessUse =
  | "can_enable"
  | "can_display"
  | "diagnostic_only"
  | "blocks_capability"
  | "ignored_for_authority";
```

Mapping rules:

```text
accepted/runtime_probed exact-scope evidence may satisfy readiness gates.
candidate/diagnostic evidence may explain UI but may not unlock controls.
unstable evidence degrades readiness and requires fresh proof.
rejected evidence blocks the exact capability family.
expired evidence remains visible but blocks capability until refreshed.
scope_mismatch blocks only the mismatched exact scope.
artifact_missing/artifact_corrupt blocks and creates recovery/readiness work.
unknown is not success and not zero usage/quota.
```

## Model Catalog Snapshot

PR 11 should define a model catalog artifact that merges profile knowledge,
runtime probe evidence, app-server baseline evidence, and project config without
pretending they are the same authority.

```ts
type DirectModelCatalogSnapshot = {
  schema: "direct_model_catalog_snapshot@1";
  snapshotId: string;
  projectId: string;
  generatedAt: string;
  sourceDigest: string;
  profileDigest?: string;
  operationLedgerHeadDigest?: string;
  entries: DirectModelCatalogEntry[];
  defaultModel?: string;
  selectedModel?: string;
  selectorEnabledInThisPr: false;
  rawProviderCatalogIncluded: false;
  rawAccountIdIncluded: false;
  rawEndpointIncluded: false;
};

type DirectModelCatalogEntry = {
  modelId: string;
  canonicalModelId?: string;
  displayName?: string;
  aliasOf?: string;
  aliasResolution:
    | "exact"
    | "profile_alias"
    | "live_catalog_alias"
    | "unknown";
  aliasEvidenceRefs: DirectEvidenceRef[];
  rendererSafeLabel: string;
  source:
    | "odeu_profile"
    | "live_probe_evidence"
    | "app_server_model_list"
    | "project_config"
    | "runtime_provider_profile"
    | "unknown";
  evidenceState: DirectEvidenceState;
  evidenceRefs: DirectEvidenceRef[];
  scope: DirectModelEvidenceScope;
  controls: DirectModelControlSupport;
  freshness: "fresh" | "expiring" | "expired" | "unknown";
  readinessUse: DirectReadinessUse;
};

type DirectModelEvidenceScope = {
  providerProfileId: string;
  authMode:
    | "chatgpt_subscription"
    | "api_key"
    | "unknown";
  accountEvidenceKey?: string;
  endpointClass: string;
  endpointHash?: string;
  modelId: string;
  requestShapeFamily:
    | "text_empty_context"
    | "text_recent_dialogue"
    | "read_file"
    | "multi_step_read"
    | "apply_patch"
    | "run_command"
    | "fresh_fork"
    | "context_maintenance"
    | "diagnostic";
  requestShapeHash?: string;
  normalizerVersion: string;
  requestBuilderVersion: string;
};
```

Model descriptor rules:

```text
One model's runtime_probed evidence does not promote another model.
Profile-listed model ids are displayable but not enough for live authority.
Project-configured default model is a preference, not evidence.
App-server model/list evidence does not prove Direct request shape support.
Direct live probe evidence does not prove app-server capability changes.
Runtime gates use exact canonical model identity where possible.
Renderer display labels are never runtime evidence.
```

## Model Control Evidence

Controls must be represented per model and per request-shape family.

```ts
type DirectModelControlSupport = {
  reasoningEffort: DirectControlEvidence;
  reasoningSummary: DirectControlEvidence;
  verbosity: DirectControlEvidence;
  serviceTier: DirectControlEvidence;
  promptCacheKey: DirectControlEvidence;
  parallelToolCalls: DirectControlEvidence;
  toolDeclarations: DirectControlEvidence;
};

type DirectControlEvidence = {
  supported:
    | "supported"
    | "unsupported"
    | "not_declared"
    | "unknown";
  source:
    | "profile"
    | "request_manifest"
    | "live_probe"
    | "fixture"
    | "unknown";
  evidenceState: DirectEvidenceState;
  canExposeInUi: boolean;
  canUseInProviderRequest: boolean;
  blockerCode?: string;
};

type DirectModelControlDescriptor = {
  control:
    | "reasoning_effort"
    | "verbosity"
    | "service_tier"
    | "prompt_cache_key"
    | "include"
    | "parallel_tool_calls"
    | "store"
    | "previous_response_id";
  supportState:
    | "accepted"
    | "runtime_probed"
    | "diagnostic"
    | "unsupported"
    | "unknown";
  requestShapeFamilies: string[];
  uiEnabledInThisPr: false;
  evidenceRefs: DirectEvidenceRef[];
};
```

PR 11 must not enable new controls. It should only explain why controls are
hidden, disabled, or already fixed by request manifests.

Default for PR 11:

```text
model selector remains disabled unless already supported elsewhere
reasoning controls remain disabled for Direct text/tool flows unless proven
service tier remains omitted unless separately proven
prompt cache/session affinity remains diagnostic only
parallel_tool_calls remains false for implementation-lane continuations
tool declarations remain governed by existing tool specs
```

## Prompt Cache And Session Affinity

Prompt cache or session-affinity evidence must be separate from local thread
continuity.

```ts
type DirectPromptCacheAffinityEvidence = {
  schema: "direct_prompt_cache_affinity_evidence@1";
  evidenceId: string;
  requestShapeClass: string;
  modelId: string;
  source:
    | "usage_cached_tokens"
    | "request_manifest"
    | "profile"
    | "diagnostic"
    | "unknown";
  cacheSignal:
    | "cached_tokens_observed"
    | "cache_key_sent"
    | "not_observed"
    | "unknown";
  providerContinuityGranted: false;
  localThreadContinuityGranted: false;
  promptCacheEvidence: {
    observed: boolean;
    source:
      | "request_manifest"
      | "provider_event"
      | "profile"
      | "diagnostic";
    grantsContinuity: false;
  };
  sessionAffinityEvidence: {
    observed: boolean;
    grantsProviderContinuity: false;
    grantsImportedContinuity: false;
  };
  rendererSafeSummary: string;
  rawPromptIncluded: false;
  rawCacheKeyIncluded: false;
};
```

Rules:

```text
cached_tokens observed != provider continuity
prompt_cache_key support != local session resume
local direct thread id != provider cache affinity
cache evidence is diagnostic unless a later spec authorizes controls
```

## Usage Ledger

Usage is runtime evidence, not billing truth.

```ts
type DirectUsageLedger = {
  schema: "direct_usage_ledger@1";
  projectId: string;
  ledgerId: string;
  generatedAt: string;
  sourceDigest: string;
  entryCount: number;
  totals: DirectUsageTotals;
  entries: DirectUsageLedgerEntry[];
  privacy: {
    rawPromptIncluded: false;
    rawResponseIncluded: false;
    rawAccountIdIncluded: false;
    rawEndpointIncluded: false;
    billingGrade: false;
  };
};

type DirectUsageLedgerManifest = {
  schema: "direct_usage_ledger_manifest@1";
  ledgerId: string;
  rowCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  ledgerDigest: string;
  lastEntryDigest?: string;
  generatedAt: string;
};

type DirectUsageLedgerEntry = {
  usageEntryId: string;
  entrySeq: number;
  entryDigest: string;
  previousEntryDigest?: string;
  dedupeKey: string;
  dedupeSource:
    | "request_manifest_id"
    | "provider_response_id"
    | "operation_ledger_seq"
    | "report_id"
    | "event_digest";
  usageRecordKind:
    | "snapshot"
    | "delta"
    | "terminal"
    | "diagnostic"
    | "missing";
  observedAt: string;
  runtimeFamily:
    | "app_server"
    | "direct_text"
    | "direct_implementation_lane"
    | "fresh_fork"
    | "diagnostic"
    | "unknown";
  requestShapeClass: string;
  modelId?: string;
  modelEvidenceState: DirectEvidenceState;
  usageSource:
    | "provider_usage_delta"
    | "response_completed_usage"
    | "app_server_usage_event"
    | "diagnostic_report"
    | "missing";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  tokenFieldConfidence: {
    inputTokens:
      | "exact"
      | "missing"
      | "unknown";
    outputTokens:
      | "exact"
      | "missing"
      | "unknown";
    cachedInputTokens:
      | "exact"
      | "missing"
      | "unsupported"
      | "unknown";
    reasoningTokens:
      | "exact"
      | "missing"
      | "unsupported"
      | "unknown";
  };
  usageMissingReason?: string;
  sourceRefs: DirectEvidenceRef[];
  requestManifestId?: string;
  providerInputProjectionId?: string;
  operationLedgerSeq?: number;
  requestControls: {
    store?: boolean;
    previousResponseIdUsed?: boolean;
    parallelToolCalls?: boolean;
    toolDeclarations?: boolean;
  };
  rawTokenDetailsIncluded: false;
};

type DirectUsageTotals = {
  entryCount: number;
  inputTokensKnown: number;
  outputTokensKnown: number;
  totalTokensKnown: number;
  cachedInputTokensKnown: number;
  reasoningTokensKnown: number;
  missingUsageEntryCount: number;
  unknownModelEntryCount: number;
};
```

Ledger laws:

```text
Missing usage is missing, not zero.
Usage totals sum only known provider-reported fields.
Fixture usage entries never become real usage proof.
Diagnostic usage entries may test schema but not readiness promotion.
Usage rows cite source artifacts by id/digest, not raw prompts or raw responses.
Usage ledger reads must not call provider transport or app-server mutation APIs.
same dedupeKey -> no double-count
different usage source for same response -> reconcile, do not blindly sum
delta rows may be summed within a request only when source continuity is known
snapshot rows replace prior snapshot for the same scope
terminal rows close usage for a response
missing cached/reasoning token fields are missing/unsupported/unknown, not zero
app-server and direct usage rows remain segregated by runtimeFamily
```

## Quota And Rate Snapshot

Quota/rate facts are dynamic. PR 11 may capture and display snapshots, but must
not claim a billing-grade entitlement.

```ts
type DirectQuotaRateSnapshot = {
  schema: "direct_quota_rate_snapshot@1";
  snapshotId: string;
  projectId: string;
  generatedAt: string;
  source:
    | "app_server_account_rate_limits_read"
    | "app_server_rate_limit_update"
    | "direct_provider_error"
    | "live_probe_failure"
    | "profile"
    | "diagnostic_fixture"
    | "unknown";
  sourceConfidence:
    | "exact"
    | "accepted"
    | "derived"
    | "diagnostic"
    | "unknown";
  freshness: "fresh" | "expiring" | "expired" | "unknown";
  buckets: DirectQuotaRateBucket[];
  creditState:
    | "available"
    | "exhausted"
    | "not_reported"
    | "unknown";
  quotaReadAllowedInThisPr: boolean;
  billingGrade: false;
  canBlockDirectByItself: boolean;
  rendererSafeSummary: string;
  rawAccountIdIncluded: false;
  rawPlanNameIncluded: false;
  rawEndpointIncluded: false;
};

type DirectQuotaRateBucket = {
  bucketId: string;
  rendererSafeLabel: string;
  appliesTo:
    | "all_direct_provider_calls"
    | "text_only"
    | "implementation_lane"
    | "fresh_fork"
    | "context_maintenance"
    | "live_probe"
    | "unknown";
  status:
    | "available"
    | "exhausted"
    | "rate_limited"
    | "unknown";
  freshness: "fresh" | "expiring" | "expired" | "unknown";
  sourceConfidence:
    | "exact"
    | "derived"
    | "diagnostic"
    | "unknown";
  quotaInferenceScope:
    | "single_request"
    | "request_shape_family"
    | "model"
    | "account"
    | "unknown";
  usedPercent?: number;
  resetsAt?: string;
  windowDurationMins?: number;
  rateLimitReachedType?: string;
  sourceRef: DirectEvidenceRef;
};
```

Quota/rate rules:

```text
quota unknown:
  display unknown/warning
  do not block by itself unless the selected runtime gate explicitly requires
  fresh quota evidence

quota exhausted or rate-limit reached:
  block affected live provider actions
  keep app-server baseline and local UI readable
  do not retry automatically after provider bytes or local side effects

quota snapshot expired:
  degrade witness freshness
  do not infer current quota state

quota fixture:
  validates UI/schema only
  cannot promote A10

single_request quota/rate error:
  may block retry or next action for that request
  must not become account-wide truth unless source scope is exact
```

If this PR calls any quota read method, it must be a fixed read-only method with
explicit opt-in. It must not spawn app-server from Direct UI refresh, mutate
account state, or run as an implicit side effect of reading runtime status.

Quota read authority boundary:

```text
quota read = read-only provider/account status action
requires separate explicit opt-in
never mutates account/provider state
never starts a model generation
never creates a Direct turn, session, context pack, or request manifest
```

## Runtime Evidence Status Resolver

Add one resolver that can summarize all relevant evidence for status and reports.

```ts
type DirectRuntimeEvidenceStatus = {
  schema: "direct_runtime_evidence_status@1";
  statusId: string;
  projectId: string;
  generatedAt: string;
  sourceDigest: string;
  modelCatalogSnapshotId?: string;
  quotaRateSnapshotId?: string;
  usageLedgerId?: string;
  liveProbeEvidenceView?: DirectLiveProbeEvidenceView;
  facets: {
    textEmptyContext: DirectEvidenceFacet;
    textRecentDialogue: DirectEvidenceFacet;
    readFile: DirectEvidenceFacet;
    multiStepReadFile: DirectEvidenceFacet;
    applyPatch: DirectEvidenceFacet;
    runCommand: DirectEvidenceFacet;
    freshFork: DirectEvidenceFacet;
    contextMaintenance: DirectEvidenceFacet;
    governanceDiagnostics: DirectEvidenceFacet;
    subAgentObservability: DirectEvidenceFacet;
  };
  readinessFacets: DirectEvidenceReadinessFacet[];
  downgradeEvents: DirectCapabilityDowngradeEvent[];
  witnessChips: DirectRuntimeWitnessChip[];
  rawExposureFlags: {
    rawTokensExposed: false;
    rawBackendFramesExposed: false;
    rawPromptIncluded: false;
    rawResponseIncluded: false;
    rawAccountIdIncluded: false;
    rawWorkspacePathIncluded: false;
  };
};

type DirectEvidenceFacet = {
  state:
    | "ready"
    | "degraded"
    | "blocked"
    | "diagnostic_only"
    | "unknown";
  freshness:
    | "fresh"
    | "expiring"
    | "expired"
    | "unknown";
  exactScope: DirectModelEvidenceScope;
  blockerCodes: string[];
  evidenceRefs: DirectEvidenceRef[];
};

type DirectEvidenceReadinessFacet = {
  facet:
    | "app_server_baseline"
    | "direct_text_first_turn"
    | "direct_text_recent_dialogue"
    | "implementation_read"
    | "implementation_patch"
    | "implementation_command"
    | "fresh_fork"
    | "context_maintenance"
    | "governance_diagnostics"
    | "sub_agent_observability"
    | "quota_rate_status"
    | "usage_ledger"
    | "report_validation";
  status:
    | "ready"
    | "degraded"
    | "blocked"
    | "diagnostic_only"
    | "skipped"
    | "unknown";
  blockerCodes: string[];
  evidenceRefs: DirectEvidenceRef[];
};
```

Resolver rules:

```text
No evidence facet may read renderer DOM state.
No status read may auto-probe a provider.
No status read may spawn app-server.
No status read may rebuild reports unless explicitly asked.
Downgrades must cite exact evidence expiry/mismatch/corruption.
```

## Capability Downgrade

PR 11 should unify downgrade reasons across status, witness chips, and reports.

```ts
type DirectCapabilityDowngradeEvent = {
  schema: "direct_capability_downgrade_event@1";
  downgradeId: string;
  eventId: string;
  occurredAt: string;
  generatedAt: string;
  affectedCapabilityRows: string[];
  affectedRuntimeFacets: string[];
  capability:
    | "direct_text"
    | "recent_dialogue"
    | "read_file"
    | "apply_patch"
    | "run_command"
    | "fresh_fork"
    | "context_maintenance"
    | "governance_diagnostics"
    | "sub_agent_observability"
    | "mainline_readiness";
  reason:
    | "evidence_expired"
    | "evidence_scope_mismatch"
    | "model_unavailable"
    | "quota_exhausted"
    | "rate_limited"
    | "report_missing"
    | "report_schema_invalid"
    | "raw_exposure_blocked"
    | "drift_detected"
    | "precondition_missing"
    | "unknown";
  previousStatus: string;
  newStatus: string;
  downgradeReason:
    | "evidence_expired"
    | "scope_mismatch"
    | "evidence_corrupt"
    | "quota_exhausted"
    | "rate_limited"
    | "drift_blocked"
    | "report_invalid"
    | "precondition_missing";
  previousState?: string;
  newState:
    | "diagnostic"
    | "degraded"
    | "blocked";
  evidenceRefs: DirectEvidenceRef[];
  rawDetailsIncluded: false;
};
```

Downgrade is local status truth. It must not mutate project runtime selection,
turn authority, right-pane ChatGPT, or handoff state.

## Drift Watch

Drift is expected. It must be recorded as evidence, not silently folded into
success.

```ts
type DirectDriftWatchReport = {
  schema: "direct_drift_watch_report@1";
  reportId: string;
  generatedAt: string;
  sourceDigest: string;
  profileDigest?: string;
  normalizerVersion: string;
  checks: DirectDriftCheck[];
  unknownEventTypes: string[];
  schemaVersionMismatches: string[];
  requestShapeMismatches: string[];
  modelCatalogDeltas: DirectModelCatalogDelta[];
  impacts: DirectDriftImpact[];
  readinessImpact:
    | "none"
    | "diagnostic"
    | "degrade"
    | "block";
  rawProviderPayloadIncluded: false;
};

type DirectDriftImpact = {
  affectedScope:
    | "text_empty_context"
    | "text_recent_dialogue"
    | "read_file"
    | "apply_patch"
    | "run_command"
    | "fresh_fork"
    | "context_maintenance"
    | "all"
    | "unknown";
  severity:
    | "none"
    | "diagnostic"
    | "degrade"
    | "block";
  reason: string;
};

type DirectDriftCheck = {
  checkId: string;
  source:
    | "normalized_events"
    | "profile_doc"
    | "live_probe_evidence"
    | "report_schema"
    | "runtime_status"
    | "fixture";
  status: "matched" | "changed" | "missing" | "blocked" | "unknown";
  rendererSafeSummary: string;
  evidenceRefs: DirectEvidenceRef[];
};
```

Drift rules:

```text
Unknown stream event type blocks promotion for the affected request shape.
Unknown model/control field is diagnostic unless a request builder uses it.
Schema mismatch in a required report blocks mainline readiness.
Profile deltas do not mutate live evidence by themselves.
Profile docs cannot downgrade exact live evidence by themselves; they can create
  drift diagnostics and require reprobe, but live evidence remains valid until
  expiry, mismatch, corruption, quota, or drift policy blocks it.
```

## Report Schema Validation Registry

PR 11 should make report validation visible across all direct bundles.

```ts
type DirectReportValidationRegistry = {
  schema: "direct_report_validation_registry@1";
  registryId: string;
  generatedAt: string;
  reports: DirectReportValidationRow[];
  requiredReportSchemas: string[];
  missingRequiredReports: string[];
  invalidRequiredReports: string[];
  rawExposureFailures: string[];
};

type DirectReportValidationRow = {
  reportKind: string;
  schema: string;
  reportId?: string;
  sourcePathEvidenceKey?: string;
  validationState:
    | "valid"
    | "missing"
    | "schema_invalid"
    | "digest_mismatch"
    | "raw_exposure_blocked"
    | "stale"
    | "unknown";
  matrixRowsExercised: string[];
  matrixPromotionCandidate: boolean;
  authorityPromotionCandidate: boolean;
  evidenceRefs: DirectEvidenceRef[];
};
```

Validation order:

```text
build report object
validate schema
serialize
raw-exposure scan
write
re-read
validate schema again
verify digest/source refs where applicable
```

If validation fails, write a minimal safe failure report and block mainline
readiness promotion.

## Mainline Readiness Report

The main output of PR 11 is a readiness report, not a new runtime.

```ts
type DirectMainlineReadinessReport = {
  schema: "direct_mainline_readiness_report@1";
  reportId: string;
  generatedAt: string;
  branch: string;
  commit: string;
  coverageSource:
    | "fixture_readiness"
    | "preflight"
    | "real_provider"
    | "diagnostic";
  mainlineReadiness:
    | "ready_behind_flag"
    | "blocked"
    | "diagnostic_only";
  runtimeEnablement:
    | "no_projects_enabled"
    | "eligible_projects_only"
    | "diagnostic_only"
    | "blocked";
  directDefaultAllowed: false;
  appServerBaselineRequired: true;
  appServerRemovalAllowed: false;
  modelCatalogSnapshotId?: string;
  quotaRateSnapshotId?: string;
  usageLedgerId?: string;
  driftWatchReportId?: string;
  reportValidationRegistryId?: string;
  runtimeEvidenceStatusId?: string;
  docsChecklistId?: string;
  ciLiveCallGuardProofId?: string;
  costEstimatorStatusId?: string;
  missingPreconditions: string[];
  appServerBaseline: {
    reportId: string;
    status:
      | "green"
      | "failed"
      | "missing"
      | "stale";
    generatedAt: string;
    maxAgeHours: number;
  };
  repoState: {
    branch: string;
    commit: string;
    workingTreeClean?: boolean;
    directBranchNameExpected?: string;
    mainlineTargetBranch?: string;
  };
  preconditions: DirectReadinessPrecondition[];
  gates: DirectMainlineReadinessGate[];
  sentinels: DirectMainlineReadinessSentinelCounters;
  rawExposureScan: DirectRawExposureScanSummary;
  promotionCandidates: {
    A7_modelCatalog: boolean;
    A8_controlEvidence: boolean;
    A9_cacheAffinityDiagnostic: boolean;
    A10_quotaRateEvidence: boolean;
    C13_usageProjection: boolean;
    F9_runtimeWitnessChips: boolean;
    I10_usageLedger: boolean;
    I12_driftWatch: boolean;
    I13_capabilityDowngrade: boolean;
    I14_ciLiveCallGuard: boolean;
    I15_reportValidation: boolean;
    J12_mainlineHygiene: boolean;
  };
};
```

Readiness gates:

```ts
type DirectMainlineReadinessGate = {
  gateId: string;
  status: "passed" | "failed" | "blocked" | "skipped";
  requiredForReadyBehindFlag: boolean;
  readinessEffect:
    | "required_for_ready_behind_flag"
    | "blocks_runtime_facet_only"
    | "diagnostic_only"
    | "informational";
  blockerCodes: string[];
  evidenceRefs: DirectEvidenceRef[];
};

type DirectMainlineDocsChecklist = {
  schema: "direct_mainline_docs_checklist@1";
  checklistId: string;
  appServerDefaultDocumented: boolean;
  directFlagDocumented: boolean;
  rollbackDocumented: boolean;
  liveCallOptInDocumented: boolean;
  credentialPrivacyDocumented: boolean;
  rightPaneBoundaryDocumented: boolean;
  unsupportedCapabilitiesDocumented: boolean;
  migrationNotesPathEvidenceKey?: string;
  rawPathsIncluded: false;
};

type DirectCiLiveCallGuardProof = {
  schema: "direct_ci_live_call_guard_proof@1";
  guardId: string;
  providerCallWithoutOptInStarted: false;
  ciLiveCallWithoutOverrideStarted: false;
  optInFlagNames: string[];
  ciOverrideFlagNames: string[];
  testedAt: string;
};
```

Required gates for `ready_behind_flag`:

```text
app_server_baseline_green
direct_text_first_turn_green
direct_text_recent_dialogue_green
implementation_lane_reports_present
recovery_replay_reports_present
workspace_mutation_reports_present
context_maintenance_reports_present
governance_diagnostic_reports_present
sub_agent_observability_reports_present
model_catalog_snapshot_valid
usage_ledger_valid
quota_status_known_or_nonblocking_unknown
drift_watch_no_blocking_unknowns
report_registry_valid
raw_exposure_scan_passed
ci_live_call_guards_present
direct_default_false
app_server_baseline_preserved
rollback_path_documented
docs_migration_notes_present
```

If aggregation fails, write a minimal safe report:

```ts
{
  schema: "direct_mainline_readiness_report@1",
  mainlineReadiness: "blocked",
  runtimeEnablement: "blocked",
  directDefaultAllowed: false,
  appServerBaselineRequired: true,
  appServerRemovalAllowed: false,
  failureKind: "readiness_aggregation_failed"
}
```

`ready_behind_flag` means:

```text
Direct can remain merged behind explicit project/runtime gates.
App-server remains the default baseline.
Missing or stale evidence will downgrade Direct facets.
No direct authority is available without exact evidence.
```

It does not mean:

```text
Direct is production/default.
Direct replaces app-server.
All accounts/models have quota.
Usage is billing truth.
Model selector is enabled.
New controls/tools are enabled.
```

## Mainline Flag And Migration Notes

PR 11 should include a concrete checklist for any future mainline merge:

```text
default project runtime remains legacy-app-server
direct runtime remains opt-in per project
direct implementation lane remains opt-in and evidence-gated
live provider calls remain env/CLI opt-in in tests
CI cannot call provider without explicit allow flag
settings migration does not flip existing projects to direct
rollback keeps app-server binding available
docs explain direct is experimental
diagnostic reports cannot promote runtime authority
```

If code adds a flag, it should be a read-only or project-scoped gate. It must not
silently change existing project bindings.

## Optional Cost Estimator Scaffold

I11 remains scaffold-only in PR 11.

```ts
type DirectCostEstimatorStatus = {
  schema: "direct_cost_estimator_status@1";
  costEstimatorAvailable: false;
  billingGrade: false;
  pricingSnapshotId?: undefined;
  rendererSafeMessage: "Cost estimation is not implemented in PR 11.";
};
```

Allowed:

```text
costEstimatorAvailable=false
costEstimatorReason="not_billing_truth"
usage tokens visible as provider-reported counts
```

Forbidden:

```text
current pricing tables
invoice estimates
per-account spend claims
auto-blocking by derived cost
```

Any future cost estimator must be a separate derived artifact with current
pricing source refs, explicit timestamp, and "not billing truth" copy.

Do not include placeholder prices, even obviously fake ones.

## Runtime Witness Projection

F9 witness chips should be a renderer-safe projection over evidence status, not
authority.

```ts
type DirectRuntimeWitnessProjection = {
  schema: "direct_runtime_witness_projection@1";
  projectionId: string;
  projectId: string;
  generatedAt: string;
  sourceDigest: string;
  chips: DirectRuntimeWitnessChip[];
  rawExposureScan: DirectRawExposureScanSummary;
};

type DirectRuntimeWitnessChip = {
  chipId: string;
  kind:
    | "model"
    | "quota"
    | "usage"
    | "drift"
    | "evidence"
    | "report_validation"
    | "app_server_baseline"
    | "readiness";
  label: string;
  state:
    | "fresh"
    | "expiring"
    | "expired"
    | "unknown"
    | "blocked"
    | "diagnostic";
  actionability: {
    actionable: false;
    allowedActions: [];
  };
  evidenceRefs: DirectEvidenceRef[];
};
```

Witness projection rules:

```text
witness chips are display-only
actionability.actionable=false
allowedActions=[]
chips do not enable runtime facets
chips do not promote capability rows
```

## Privacy And Raw Exposure

All PR 11 artifacts must preserve the existing privacy posture.

Forbidden in renderer-visible artifacts, reports, Markdown summaries, logs, and
storage snapshots:

```text
raw access tokens
raw refresh tokens
Bearer headers
raw account ids
raw email addresses
raw endpoint URLs
raw provider request bodies
raw provider stream frames
raw prompts
raw assistant output
raw assistant responses
raw tool args
raw file contents
absolute host paths
absolute WSL paths
raw SQLite errors
ChatGPT thread URLs
unscoped raw digests
raw cost/pricing placeholders
```

Allowed:

```text
renderer-safe model labels
HMAC account evidence keys
endpoint class
request-shape class
artifact ids
artifact digests scoped to local artifacts
bounded token counts reported by provider
freshness states
blocker codes
```

Raw-exposure scan coverage must include:

```text
JSON reports
Markdown summaries
runtime status projection
witness chip projection
usage ledger rows
quota snapshots
model catalog snapshots
drift reports
renderer state snapshots
localStorage/sessionStorage/IndexedDB if used
DOM attributes if UI fixtures exist
console summaries
```

## Recovery

Startup recovery should classify model/usage/quota/readiness artifacts without
rerunning probes or rebuilding reports implicitly.

```ts
type DirectUsageReadinessRecoveryState =
  | "healthy"
  | "model_catalog_missing"
  | "model_catalog_corrupt"
  | "usage_ledger_missing"
  | "usage_ledger_corrupt"
  | "quota_snapshot_missing"
  | "quota_snapshot_expired"
  | "live_probe_evidence_missing"
  | "live_probe_evidence_corrupt"
  | "readiness_report_missing"
  | "readiness_report_corrupt"
  | "drift_report_blocking"
  | "report_registry_invalid"
  | "raw_exposure_blocked"
  | "unknown";
```

Recovery rules:

```text
read_status may report stale/missing/corrupt.
read_status must not call provider transport.
read_status must not spawn app-server.
read_status must not repair usage ledgers automatically.
refresh/rebuild actions must be explicit diagnostic actions.
corrupt evidence blocks affected facets.
expired quota snapshot degrades quota facet only.
```

## Operation Ledger Events

Add usage/readiness event families, citing artifact ids/digests only:

```text
model_catalog_snapshot_recorded
quota_rate_snapshot_recorded
usage_ledger_entry_recorded
usage_ledger_rollup_recorded
runtime_evidence_status_recorded
capability_downgrade_recorded
drift_watch_report_recorded
report_validation_registry_recorded
mainline_readiness_report_recorded
usage_readiness_recovery_classified
```

These events explain status. They do not authorize provider calls, tool actions,
runtime selection changes, ChatGPT pane mutation, or handoff mutation.

## Sentinel Counters

Fixture/preflight PR 11 reads must assert:

```ts
type DirectUsageReadinessSentinelCounters = {
  providerTransportCalls: number;
  appServerSpawnCalls: number;
  appServerMutationCalls: number;
  appServerQuotaReadCalls: number;
  workspaceReadCalls: number;
  patchApplyCalls: number;
  commandRunCalls: number;
  contextPackBuilds: number;
  requestManifestBuilds: number;
  directSessionCreates: number;
  runtimeTierMutationCalls: number;
  rightPaneMutationCalls: number;
  handoffMutationCalls: number;
};
```

`DirectMainlineReadinessSentinelCounters` has the same shape and is embedded in
`direct_mainline_readiness_report@1`.

Expected values:

```text
fixture/preflight:
  all zero except explicitly simulated fixture counters

optional live usage run:
  providerTransportCalls may be > 0 only with live opt-in
  appServerQuotaReadCalls may be > 0 only with explicit read-only quota opt-in
  mutation counters remain zero
```

## Optional Live Runs

PR 11 should be fixture-first. Optional live runs are allowed only with explicit
opt-in:

```text
CODEX_DIRECT_USAGE_READINESS_LIVE=1
CODEX_DIRECT_USAGE_READINESS_ALLOW_CI=1  # required when CI=true
CODEX_DIRECT_USAGE_READINESS_QUOTA_READ=1 # required for quota read probes
```

Live run rules:

```text
No live call runs during normal validation.
Live usage proof may promote usage-observation rows only for exact scope.
Live quota read may promote quota snapshot only for exact source/freshness.
Live text evidence does not promote implementation-lane tool authority.
Live implementation-lane reports from earlier PRs are cited, not rerun.
```

## Regression Cases

Fixture/preflight cases:

```text
model_catalog_from_profile_is_display_only
runtime_probed_model_exact_scope_ready
model_scope_mismatch_downgrades_only_that_model
expired_live_probe_downgrades_direct_text
candidate_evidence_does_not_unlock_controls
quota_unknown_nonblocking_by_default
quota_exhausted_blocks_live_provider_actions
usage_delta_records_known_tokens
missing_usage_is_not_zero
cached_tokens_recorded_as_cache_signal_not_continuity
prompt_cache_affinity_diagnostic_only
drift_unknown_event_blocks_promotion
report_schema_invalid_blocks_mainline_readiness
raw_exposure_blocks_report_write
ci_live_call_guard_blocks_without_env
direct_default_remains_false
app_server_baseline_required
witness_chip_uses_evidence_freshness
capability_downgrade_on_evidence_expiry
fixture_reports_do_not_promote_authority
sentinel_no_runtime_authority
```

Optional live cases:

```text
direct_text_usage_observed_from_response_completed
direct_recent_dialogue_usage_observed
direct_provider_quota_error_classified
read_only_quota_snapshot_recorded_if_opted_in
app_server_baseline_still_green
```

## Report Shape

```ts
type DirectUsageReadinessRegressionReport = {
  schema: "direct_usage_readiness_regression_report@1";
  reportId: string;
  generatedAt: string;
  coverageSource:
    | "fixture_usage_readiness"
    | "preflight"
    | "real_provider"
    | "diagnostic";
  matrixRowsExercised: string[];
  matrixPromotionCandidate: boolean;
  authorityPromotionCandidate: false;
  runtimeAuthorityExercised: false;
  providerAuthorityExercised: boolean;
  cases: DirectUsageReadinessCase[];
  modelCatalogSnapshot?: DirectEvidenceRef;
  quotaRateSnapshot?: DirectEvidenceRef;
  usageLedger?: DirectEvidenceRef;
  driftWatchReport?: DirectEvidenceRef;
  reportValidationRegistry?: DirectEvidenceRef;
  mainlineReadinessReport?: DirectEvidenceRef;
  sentinels: DirectUsageReadinessSentinelCounters;
  rawExposureScan: DirectRawExposureScanSummary;
};
```

Promotion split:

```ts
promotionCandidates: {
  A7_modelCatalog_fixture: boolean;
  A7_modelCatalog_live: boolean;
  A8_controlEvidenceDiagnostic: boolean;
  A9_cacheAffinityDiagnostic: boolean;
  A10_quotaRateFixture: false;
  A10_quotaRateLive: boolean;
  C13_usageProjectionFixture: boolean;
  C13_usageProjectionLive: boolean;
  F9_witnessChips: boolean;
  I10_usageLedger: boolean;
  I11_costEstimator: false;
  I12_driftWatch: boolean;
  I13_capabilityDowngrade: boolean;
  I14_ciLiveCallGuard: boolean;
  I15_reportValidation: boolean;
  J12_mainlineReadiness: boolean;
};
```

Fixture-only reports must keep:

```text
matrixPromotionCandidate=false for live-only quota proof
authorityPromotionCandidate=false
runtimeAuthorityExercised=false
providerAuthorityExercised=false
```

## Implementation Order

### Phase -3 - Readiness Authority Law

```text
merge-behind-flag != production
runtime enabled != report ready
model catalog != control support
usage != billing
quota != entitlement
profile != live proof
witness chip != authority
```

### Phase -2 - Source Inventory

```text
inventory existing usage_delta normalization
inventory DirectLiveProbeEvidenceStore scope/status fields
inventory direct runtime status witness fields
inventory real-usage regression report shapes
inventory profile model/control fields
inventory usage dedupe keys
inventory report commit ids
inventory app-server baseline report freshness
inventory raw-exposure categories
inventory live-call guard tests
```

### Phase -1 - Schemas And Laws

```text
model_catalog_snapshot@1
quota_rate_snapshot@1
direct_usage_ledger@1
direct_usage_ledger_manifest@1
runtime_evidence_status@1
direct_capability_downgrade_event@1
drift_watch_report@1
report_validation_registry@1
mainline_readiness_report@1
direct_runtime_witness_projection@1
direct_mainline_docs_checklist@1
direct_ci_live_call_guard_proof@1
direct_cost_estimator_status@1
recovery state enum
sentinel counter schema
```

### Phase 0 - Usage Ledger

```text
record usage ledger rows from normalized usage events
record missing usage explicitly
roll up known token counts only
keep privacy flags false
add fixture cases for usage and cache signals
entrySeq/digest chain
snapshot/delta/terminal/missing kinds
dedupe keys and reconciliation
app-server/direct runtime segregation
token field confidence
```

### Phase 1 - Model And Evidence Resolver

```text
merge profile/model evidence into model catalog snapshot
map exact-scope live probe evidence to readiness facets
record control support as diagnostic unless already proven
emit downgrade events on expiry/mismatch/corrupt evidence
model alias/canonicalization
exact model evidence scope
control descriptors with uiEnabledInThisPr=false
profile-vs-live evidence separation
facet-level runtime status
```

### Phase 2 - Quota/Rate Snapshot

```text
fixture quota snapshots
provider error quota/rate classification
optional read-only quota probe with explicit opt-in
unknown quota nonblocking rule
exhausted quota blocking rule
quota bucket appliesTo
quota inference scope
read-only quota probe authority boundary
action-specific blocking
```

### Phase 3 - Drift And Report Validation

```text
drift watch over normalized events/profile/report schemas
report validation registry
schema validation before and after writes
raw-exposure scans over all readiness artifacts
drift impact by request-shape family
profile docs cannot mutate or downgrade live evidence by themselves
minimal safe report on aggregation/scanning failure
```

### Phase 4 - Mainline Readiness

```text
aggregate prerequisite reports
compute readiness gates
emit ready_behind_flag/blocked/diagnostic_only
verify direct default remains false
verify app-server baseline remains required
write migration/docs checklist
typed prerequisite waiver handling
app-server baseline freshness
docs checklist artifact
repo state and report commit matching
ready_behind_flag vs runtimeEnablement split
```

### Phase 5 - Regression

```text
fixture/preflight readiness regression
optional live usage-readiness regression
CI live-call guard tests
sentinel counters
raw-exposure tests
validation registry tests
live-call guard proof object
witness projection raw-exposure scan
usage dedupe cases
quota unknown/exhausted cases
report schema invalid cases
stale prerequisite cases
```

## Acceptance Criteria

- Missing prerequisites can only be skipped through typed waivers; skipped
  evidence does not silently permit `ready_behind_flag`.
- Readiness distinguishes `ready_behind_flag` from `runtimeEnablement`.
- `directDefaultAllowed=false`, `appServerBaselineRequired=true`, and
  `appServerRemovalAllowed=false` are computed gates, not just fields.
- PR 11 defines a single Direct runtime evidence status layer over model catalog,
  usage ledger, quota/rate snapshot, drift watch, and report validation.
- Model catalog entries distinguish profile display evidence from exact-scope
  runtime proof.
- Model evidence scope includes provider profile, auth mode, account evidence,
  endpoint, model id, request-shape family/hash, normalizer version, and request
  builder version.
- Model alias/canonicalization is explicit; renderer display names are not
  runtime evidence.
- Model/control support is per model and request-shape family; PR 11 enables no
  new controls by itself.
- Model/control descriptors set `uiEnabledInThisPr=false`.
- Prompt-cache/session-affinity evidence explicitly grants no provider/imported
  continuity.
- Prompt cache/session-affinity evidence is diagnostic and never grants provider
  continuity.
- Quota buckets include `appliesTo`, status, freshness, and confidence; a
  single-request quota error does not become global account truth automatically.
- Usage ledger records provider-reported token fields and explicitly records
  missing usage as missing, not zero.
- Usage ledger has a manifest, entry sequence, entry digest, and duplicate
  prevention.
- Usage rows distinguish snapshot, delta, terminal, diagnostic, and missing.
- Usage rows include token field confidence; missing cached/reasoning tokens are
  not zero.
- App-server usage and Direct usage are segregated by runtime family and never
  merged as one truth source.
- Usage rows cite request-control flags where available.
- Usage ledger reports `billingGrade=false` and excludes raw prompts, raw
  responses, raw account ids, raw endpoints, and workspace paths.
- Quota/rate snapshots are dynamic evidence with freshness; unknown quota does
  not block by itself unless an explicit gate requires it.
- Quota exhausted/rate-limited evidence blocks affected live provider actions
  without retrying after bytes or side effects.
- Runtime witness chips use model/evidence/quota freshness but do not promote
  capability by themselves.
- Runtime witness projection is schema-validated, display-only, and
  `actionability=false`.
- Capability downgrade events cite exact expiry, mismatch, corruption, quota, or
  drift evidence.
- Capability downgrade events are durable rows with reason, affected rows/facets,
  previous state, new state, and evidence refs.
- Drift watch records unknown event types, schema mismatches, request-shape
  mismatches, and model catalog deltas.
- Drift impact is scoped by request-shape family/capability, not only global.
- Profile deltas do not mutate or downgrade live evidence by themselves.
- Report schema validation registry validates required direct bundle reports
  before mainline readiness can be `ready_behind_flag`.
- Mainline readiness report preserves `directDefaultAllowed=false`,
  `appServerBaselineRequired=true`, and `appServerRemovalAllowed=false`.
- Readiness gates have readiness-effect severity.
- Docs/migration checklist is a real artifact.
- App-server baseline report freshness is checked.
- Branch/commit cleanliness and report commit matching are recorded.
- CI live-call guard proof records no provider call without opt-in and no CI
  call without override.
- Fixture/preflight reads do not call provider transport, spawn app-server, read
  workspace files, apply patches, run commands, create sessions, mutate runtime
  tier, mutate right-pane ChatGPT, or mutate handoffs.
- Optional live runs require explicit env/CLI opt-in and CI override.
- Optional quota reads require a separate explicit opt-in and remain read-only.
- Optional quota reads never start a model generation or mutate account state.
- Raw-exposure scans cover JSON reports, Markdown summaries, runtime status,
  witness chips, usage ledgers, quota snapshots, model snapshots, drift reports,
  renderer storage, and console summaries.
- Raw-exposure categories include raw account id/email, endpoint URLs, provider
  bodies, prompts, assistant output, workspace paths, ChatGPT URLs,
  tokens/cookies/auth headers, and fake cost/pricing placeholders.
- Fixture-only reports set authority promotion false and do not promote
  live-only quota proof.
- Cost estimator remains scaffold-only with `costEstimatorAvailable=false`.
- Cost estimator status includes no placeholder prices.
- If aggregation or scan fails, a minimal safe readiness report is written with
  `mainlineReadiness=blocked` and app-server-preserving flags intact.

## Passing Means

```text
The Direct harness can explain model, usage, quota/rate, evidence freshness,
drift, report validity, and mainline readiness in durable renderer-safe
artifacts, and can degrade or block Direct facets when evidence expires,
mismatches, corrupts, or drifts.
```

## Passing Does Not Mean

```text
Direct is production/default
Direct replaces app-server
usage is billing truth
quota is guaranteed entitlement
pricing/cost estimation is implemented
new model controls are enabled
model selector is enabled
new tools are enabled
provider probes run automatically
right-pane ChatGPT is controlled
handoffs are mutated
```
