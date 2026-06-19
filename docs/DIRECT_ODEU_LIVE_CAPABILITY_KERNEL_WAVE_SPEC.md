# Direct ODEU Live-Capability Kernel Wave Spec

Status: planning spec for Wave 14.5, to be implemented before the remaining
live-capability promotion waves.

Primary branch:

```text
codex/direct-chatgpt-harness
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
```

## Purpose

The direct path now has enough family-specific infrastructure that the next
step should be a shared ODEU live-capability kernel before promoting the next
families to live resident/operator capabilities.

The shared lifecycle is:

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

This lifecycle applies to sub-agents, human/control tools, MCP/external tools,
provider-hosted web/image tools, context transitions, code mode, batch agents,
account mutations, and bridge modules.

## Doctrine

Do not build a generic executor.

Build a generic live-capability lifecycle.

Shared kernel owns:

```text
artifact refs
source refs
digests
raw-exposure posture
schema validation
capability activation/declaration lifecycle
per-call authority decisions
execution transactions
result envelopes
context admission records
usability proofs
resident/operator witnesses
```

Family implementations still own:

```text
sub-agent lifecycle semantics
MCP trust and server/resource identity semantics
provider-hosted web/search citation/result contracts
provider-hosted image artifact contracts
context transition and compaction laws
code kernel/session laws
batch fan-out/fan-in laws
account mutation/idempotency laws
hook/module side-effect laws
```

Standing laws:

- Activation does not authorize a concrete call.
- Declaration does not authorize a concrete call.
- Promotion evidence does not create runtime authority by itself.
- Per-call authority is required before every concrete action.
- Every live result must enter a result envelope before projection/admission.
- Context admission is separate from local result recording.
- Usability proof is not the same as resident self-report.
- Unknown or handoff state must not auto-replay.


## Global Kernel Object Requirements

Every durable kernel object should carry the same minimum governance metadata:

```ts
type OdeuScope = {
  projectId?: string;
  workThreadId?: string;
  threadId?: string;
  turnId?: string;
  routeId?: string;
  runtimeTier?: "direct_text" | "direct_implementation" | "headless_direct" | "operator_ui";
  providerProfileId?: string;
  modelId?: string;
  environment?: "fixture" | "headless_live" | "operator_live" | "resident_live";
};

type OdeuObjectStatus =
  | "valid"
  | "blocked"
  | "stale"
  | "corrupt"
  | "partial"
  | "diagnostic_only"
  | "superseded"
  | "unknown";

type OdeuArtifactBase = {
  schema: string;
  kernelVersion: "odeu_live_capability_kernel@1";
  artifactId: string;
  artifactKind: string;
  scope?: OdeuScope;
  createdAt: string;
  createdBy: "harness" | "fixture" | "migration" | "operator" | "provider_event";
  sourceRefs: OdeuSourceRef[];
  artifactDigest?: OdeuDigest;
  rawExposureScan?: OdeuRawExposureScan;
  status: OdeuObjectStatus;
  statusReason?: string;
  blockers?: string[];
  familyExtension?: Record<string, unknown>;
};
```

Rules:

```text
- Scope must be present whenever a row can affect activation, declaration,
  authority, context admission, or usability proof.
- Schema/kernelVersion prevents confusion while legacy family-specific rows and
  canonical kernel rows coexist.
- Status is explicit. Legacy adapters may emit partial/diagnostic rows instead
  of pretending full validity.
- Family extensions may add data, but must not override kernel authority fields.
```

## Why This Wave Exists

The repo already has repeated structures across areas such as:

```text
src/main/direct/bridge/tool-capability-registry.js
src/main/direct/headless/tool-promotion-decision-report.js
src/main/direct/headless/tool-activation-registry.js
src/main/direct/headless/first-tool-slice.js
src/main/direct/bridge/resident-epistemic-snapshot.js
src/main/direct/bridge/resident-epistemic-context-policy.js
src/main/direct/bridge/resident-tool-epistemic-catalog.js
src/main/direct/agents/runtime-substrate.js
src/main/direct/agents/provider-backed-route.js
src/main/direct/agents/live-tool-surface.js
src/main/direct/agents/inspect-wait-containment.js
src/main/direct/external/capability-discovery.js
src/main/direct/external/mcp-boundary.js
src/main/direct/provider/hosted-tools.js
src/main/direct/tools/code-mode-execution-lane.js
src/main/direct/agents/batch-job-surface.js
src/main/direct/bridge/skills-hooks-apps.js
```

These files should not be force-migrated in one PR. The kernel wave should add
canonical shared shapes and small adapters so later waves can reuse them while
older rows remain compatible.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| OdeuArtifactKernel | support artifact | build | canonical refs, digests, validation, raw-exposure result shape |
| OdeuCapabilityLifecycleKernel | support artifact | build | capability row, promotion decision, activation, declaration/callable surface |
| OdeuAuthorityTransactionKernel | support artifact | build | per-call authority decision, side-effect class, transaction/recovery lifecycle |
| OdeuResultAdmissionKernel | support artifact | build | result envelope, context admission record, provider/local visibility split |
| OdeuUsabilityWitnessKernel | support artifact | build | capability usability proof and resident/operator witness projection |
| LegacyKernelAdapters | support artifact | align/build | bridge existing direct rows into canonical kernel shapes without broad rewrite |

## PR 87: ODEU Artifact / SourceRef / Digest / Raw-Exposure Kernel

Purpose:

```text
Create one shared artifact/source/digest/raw-exposure substrate for future live
capability families.
```

Candidate modules:

```text
src/main/direct/odeu/artifact.js
src/main/direct/odeu/source-ref.js
src/main/direct/odeu/raw-exposure.js
src/main/direct/odeu/schema.js
src/main/direct/odeu/status.js
```

Shared objects:

```ts
type OdeuArtifactRef = {
  artifactId: string;
  artifactKind: string;
  schema?: string;
  sourceRefs: OdeuSourceRef[];
  digest?: OdeuDigest;
  observedAt: string;
};

type OdeuSourceRef = {
  sourceKind:
    | "operation_ledger"
    | "request_manifest"
    | "context_pack"
    | "provider_response"
    | "provider_stream_event"
    | "tool_call"
    | "tool_result"
    | "activation_registry"
    | "promotion_decision"
    | "resident_snapshot"
    | "workspace_effect"
    | "sub_agent_graph"
    | "mcp_server"
    | "hosted_provider_tool"
    | "code_session"
    | "quota_snapshot"
    | "legacy_adapter"
    | "family_specific";
  sourceId?: string;
  sourcePathEvidenceKey?: string;
  rowId?: string;
  itemId?: string;
  callId?: string;
  sourceConfidence:
    | "exact"
    | "provider_reported"
    | "runtime_probed"
    | "accepted_profile"
    | "derived"
    | "diagnostic"
    | "fixture"
    | "unknown";
  freshness: "fresh" | "expiring" | "stale" | "unknown";
  sourceDigest?: OdeuDigest;
  observedAt?: string;
};

type OdeuEvidenceRef = {
  evidenceId: string;
  evidenceKind: string;
  artifactRef?: string;
  sourceRefs?: OdeuSourceRef[];
  sourceConfidence?: OdeuSourceRef["sourceConfidence"];
  freshness?: OdeuSourceRef["freshness"];
};

type OdeuDigest = {
  algorithm?: "sha256" | "hmac_sha256";
  value?: string;
  digestOf: "canonical_json" | "content" | "metadata" | "redacted_payload";
  canonicalizationVersion?: string;
  unavailableReason?:
    | "not_computed"
    | "sensitive_withheld"
    | "source_unavailable"
    | "legacy_missing"
    | "not_applicable";
};

type OdeuRawExposureScan = {
  passed: boolean;
  scannerVersion: string;
  scannedAt: string;
  scanScope:
    | "artifact"
    | "renderer_projection"
    | "provider_envelope"
    | "report"
    | "context_item"
    | "operator_ui"
    | "resident_witness";
  rawPromptIncluded: boolean;
  rawAssistantOutputIncluded: boolean;
  rawProviderPayloadIncluded: boolean;
  rawAuthIncluded: boolean;
  rawAccountIdentifierIncluded: boolean;
  rawPathIncluded: boolean;
  rawUrlIncluded: boolean;
  rawToolOutputIncluded: boolean;
  rawWorkspaceContentIncluded: boolean;
  rawExternalResourceIncluded: boolean;
  rawImagePayloadIncluded: boolean;
  rawSecretLikeIncluded: boolean;
  blockers: string[];
  warnings: string[];
};
```

Acceptance:

```text
- Every new family can build source refs through the same helper.
- Every new report/artifact can generate a canonical digest.
- Source refs carry confidence, freshness, and optional digest.
- Digest absence uses unavailableReason, not algorithm=none.
- Raw-exposure scan records scannerVersion and scanScope.
- Raw-exposure scan includes prompt, assistant output, provider payload, auth,
  account identifier, path, URL, tool output, workspace content, external
  resource, image payload, and secret-like categories.
- Existing tool registry, activation, and resident snapshot rows can gradually
  reference these helpers through adapters.
- Every kernel object can embed or extend OdeuArtifactBase.
- No family-specific executor behavior is introduced.
```

## PR 88: Capability Lifecycle Kernel

Purpose:

```text
Create one shared model for capability row -> promotion -> activation ->
declaration/callable surface.
```

Shared objects:

```ts
type OdeuCapabilityRow = OdeuArtifactBase & {
  schema: "odeu_capability_row@1";
  capabilityId: string;
  family: string;
  capabilityKind: string;
  authorityFamily: string;
  capabilityState:
    | "unknown"
    | "known"
    | "profile_declared"
    | "runtime_probed"
    | "provider_accepted";
  implementationState:
    | "none"
    | "schema_only"
    | "projection_only"
    | "fixture_executor"
    | "restricted_executor"
    | "full_executor";
  promotionState:
    | "unsupported"
    | "diagnostic_only"
    | "fixture_only"
    | "direct_restricted"
    | "direct_enabled";
  providerDeclarationState:
    | "not_provider_tool"
    | "not_declared"
    | "declared_fixture_only"
    | "declared_live_unproved"
    | "declared_live_accepted"
    | "rejected_by_provider";
  requestShapeFamilies: string[];
  resultEnvelopeKinds: string[];
  sideEffectClass: OdeuSideEffectClass;
  evidenceRefs: OdeuEvidenceRef[];
};

type OdeuActivationRestriction = {
  restrictionId: string;
  reason: string;
  appliesTo: "activation" | "declaration" | "per_call" | "result_admission";
};

type OdeuPromotionDecision = OdeuArtifactBase & {
  schema: "odeu_promotion_decision@1";
  promotionDecisionId: string;
  capabilityId: string;
  decision:
    | "promotable"
    | "promotable_restricted"
    | "blocked"
    | "needs_more_evidence"
    | "not_applicable";
  promotionClass: string;
  evidenceClass:
    | "fixture_only"
    | "diagnostic_only"
    | "real_provider_declaration"
    | "real_provider_full_loop"
    | "real_runtime_full_loop";
  restrictions: OdeuActivationRestriction[];
  freshness: OdeuSourceRef["freshness"];
  negativeEvidence: {
    noRawExposure: boolean;
    noRendererAuthorityGrant: boolean;
    noOutOfContractProviderTransport: boolean;
    noOutOfContractSideEffect: boolean;
    noContextSmuggling: boolean;
    noReplayUnsafeState: boolean;
  };
  evidenceRefs: OdeuEvidenceRef[];
  blockers: string[];
  decidedAt: string;
};

type OdeuActivationScope =
  | { kind: "global_default" }
  | { kind: "project_default"; projectId: string }
  | { kind: "work_thread_override"; workThreadId: string }
  | { kind: "single_turn_override"; turnId: string };

type OdeuActivationRow = OdeuArtifactBase & {
  schema: "odeu_activation_row@1";
  activationId: string;
  capabilityId: string;
  promotionDecisionId: string;
  state: "inactive" | "active" | "shadow_only" | "suspended" | "revoked" | "expired";
  scope: OdeuActivationScope;
  effect: "allow" | "deny" | "shadow" | "revoke";
  precedenceLaw: {
    order: ["single_turn_override", "work_thread_override", "project_default", "global_default"];
    denyWins: true;
    emergencyRevokeWins: true;
  };
  activationDecision: {
    activatedBy: "operator" | "project_policy" | "test_fixture" | "migration";
    decisionId: string;
    reason: string;
  };
  expiresAt?: string;
  activatedAt: string;
};

type OdeuDeclarationSnapshot = OdeuArtifactBase & {
  schema: "odeu_declaration_snapshot@1";
  declarationSnapshotId: string;
  activationId: string;
  activationSnapshotId: string;
  activationRegistryDigest: OdeuDigest;
  declarationDigest: OdeuDigest;
  toolSchemaDigest?: OdeuDigest;
  requestShapeFamily?: string;
  providerProfileId?: string;
  modelId?: string;
  surfaceKind:
    | "resident_tool"
    | "operator_ui_action"
    | "headless_command"
    | "provider_hosted_tool"
    | "mcp_resource"
    | "mcp_tool"
    | "sub_agent_control";
  requestShapeDigest?: OdeuDigest;
  residentVisible: boolean;
  operatorVisible: boolean;
  rendererVisible: boolean;
  providerDeclared: boolean;
  modelCallable: boolean;
  declaredAt: string;
};
```

Generic law:

```text
promotion says evidence is sufficient
activation says scope is enabled
declaration says provider/model/operator can see a callable surface
none of these authorize a concrete call
```

Acceptance:

```text
- Capability lifecycle separates capabilityState, implementationState,
  promotionState, providerDeclarationState, activation state, and declaration
  state.
- No family invents its own enabled boolean.
- No smoke report can become activation without a promotion decision.
- Activation scope is structured and precedence law is explicit.
- Activation records who/what activated it and why.
- No activation can become provider declaration without a declaration snapshot.
- Declaration snapshots include declarationDigest, activationRegistryDigest,
  requestShapeFamily, providerProfileId/modelId where applicable.
- Sub-agent, MCP, hosted tools, code mode, batch, quota reset, and modules can
  cite the same activation/declaration objects.
```

## PR 89: Per-Call Authority And Transaction Kernel

Purpose:

```text
Create one shared per-call gate and replay/recovery lifecycle.
```

Shared objects:

```ts
type OdeuSideEffectClass =
  | "none"
  | "workspace_read"
  | "workspace_write"
  | "process_execution"
  | "agent_runtime"
  | "external_read"
  | "external_action"
  | "provider_hosted"
  | "account_mutation"
  | "context_world"
  | "module_execution"
  | "control_state"
  | "human_decision"
  | "browser_state"
  | "artifact_write";

type OdeuPerCallAuthorityDecision = OdeuArtifactBase & {
  schema: "odeu_per_call_authority_decision@1";
  authorityDecisionId: string;
  callId: string;
  capabilityId: string;
  scope: OdeuScope;
  activationSnapshotId?: string;
  declarationSnapshotId?: string;
  activationRowId?: string;
  caller: "resident_model" | "operator_ui" | "headless_route" | "sub_agent" | "system_recovery" | "fixture";
  callSurface: "provider_tool_call" | "operator_action" | "headless_command" | "internal_transition";
  argumentValidation: {
    state: "valid" | "invalid" | "stale" | "unknown";
    schemaDigest?: OdeuDigest;
    argumentsDigest?: OdeuDigest;
    blockers: string[];
  };
  activationDecision: "active" | "shadow_only" | "inactive" | "revoked" | "expired" | "not_found";
  policyDecision: "allow" | "block" | "needs_human" | "shadow_only" | "stale" | "unsupported";
  approvalRequirement?: "none" | "operator_confirm" | "single_action" | "turn_scope";
  executorState: "not_started" | "ready" | "unavailable" | "degraded";
  recoveryState: "not_needed" | "retryable" | "not_retryable" | "handoff_unknown";
  replayPolicy: "never" | "idempotent_same_key" | "manual_only";
  finalDecision: "allow_execute" | "allow_read_only" | "block" | "needs_human" | "shadow_only" | "unsupported";
  decidedAt: string;
};

type OdeuLiveCapabilityTransaction = OdeuArtifactBase & {
  schema: "odeu_live_capability_transaction@1";
  transactionId: string;
  capabilityId: string;
  callId: string;
  sideEffectClass: OdeuSideEffectClass;
  lifecycle:
    | "planned"
    | "authority_blocked"
    | "waiting_for_human"
    | "approved"
    | "executor_started"
    | "executing"
    | "local_effect_observed"
    | "result_recorded"
    | "result_enveloped"
    | "context_admission_recorded"
    | "provider_result_sent"
    | "provider_terminal_completed"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout"
    | "handoff_unknown"
    | "recovery_required";
  idempotencyKey?: string;
  replayAllowed: boolean;
  recoveryClassifierId?: string;
  startedAt?: string;
  completedAt?: string;
};
```

Acceptance:

```text
- Every live family emits an OdeuPerCallAuthorityDecision.
- Per-call authority decision records caller and callSurface.
- Activation/declaration eligibility is checked separately from policy and
  executor readiness.
- Per-call authority has an explicit finalDecision.
- Every side-effecting family emits an OdeuLiveCapabilityTransaction.
- Transaction lifecycle distinguishes result_recorded, result_enveloped,
  context_admission_recorded, provider_result_sent, and terminal provider state.
- Side-effect class includes control_state, human_decision, browser_state, and
  artifact_write.
- Every transaction has idempotency and recovery classification.
- Unknown/handoff state never auto-replays.
- No executor starts before authority decision allows it.
```

## PR 90: Result Envelope And Context Admission Kernel

Purpose:

```text
Create one shared way to turn action/result evidence into renderer projection
and model context.
```

Shared objects:

```ts
type OdeuResultKind =
  | "status"
  | "local_perception"
  | "agent_result"
  | "external_evidence"
  | "generated_artifact"
  | "context_transition"
  | "code_result"
  | "account_mutation_result"
  | "module_result"
  | "human_decision_result"
  | "mcp_resource"
  | "web_search_result"
  | "image_generation_result"
  | "batch_job_result"
  | "quota_reset_result"
  | "hook_result"
  | "browser_result"
  | "plan_update_result";

type OdeuResultEnvelope = OdeuArtifactBase & {
  schema: "odeu_result_envelope@1";
  resultEnvelopeId: string;
  capabilityId: string;
  callId: string;
  transactionId?: string;
  resultKind: OdeuResultKind;
  familyResultKind?: string;
  familyExtension?: Record<string, unknown>;
  sourceRefs: OdeuSourceRef[];
  resultDigest?: OdeuDigest;
  rendererSafeSummary: string;
  providerVisibleSummary?: string;
  visibility: {
    localRecorded: boolean;
    rendererVisible: "none" | "summary" | "detail" | "artifact_ref";
    residentVisible: "none" | "summary" | "detail" | "status_only";
    providerVisible: "not_seen" | "summary_only" | "payload_sent" | "unknown" | "not_applicable";
    transcriptVisible: "none" | "summary" | "transcript_safe";
  };
  payloadPolicy: {
    rawPayloadStored: boolean;
    rawPayloadProviderSent: boolean;
    rawPayloadRendererVisible: boolean;
    redactionState: "none_needed" | "redacted" | "blocked" | "unknown";
    truncationState: "none" | "truncated" | "omitted" | "unknown";
  };
  rawTextIncluded: false;
  rawPathIncluded: false;
  rawProviderPayloadIncluded: false;
  confidence: "exact" | "derived" | "partial" | "unknown";
};

type OdeuContextAdmissionRecord = OdeuArtifactBase & {
  schema: "odeu_context_admission_record@1";
  admissionId: string;
  resultEnvelopeId: string;
  contextPackId?: string;
  requestManifestId?: string;
  admissionDecision:
    | "admit"
    | "do_not_admit"
    | "blocked_raw_exposure"
    | "blocked_policy"
    | "blocked_stale"
    | "pending";
  admittedAs:
    | "tool_result_evidence"
    | "external_source_evidence"
    | "generated_artifact_ref"
    | "agent_result_summary"
    | "context_status"
    | "memory_candidate"
    | "operator_decision"
    | "plan_evidence"
    | "not_admitted";
  providerSawResult:
    | "not_seen"
    | "summary_only"
    | "payload_sent"
    | "unknown"
    | "not_applicable";
  omissionLedgerRefs: string[];
  admissionPolicyDigest?: OdeuDigest;
  admittedAt: string;
};
```

Acceptance:

```text
- No result enters context without OdeuContextAdmissionRecord.
- No result is rendered as transcript unless transcript-safe projection exists.
- Result envelope includes local, renderer, resident, provider, and transcript
  visibility channels.
- Provider-visible result is separate from local result.
- Payload policy captures storage, provider-send, renderer visibility,
  redaction, and truncation states.
- Context admission has admissionDecision separate from admittedAs.
- Truncation, redaction, and omission are represented in one shared form.
- Context admission does not imply project truth or memory truth.
```

## PR 91: Capability Usability Proof And Resident Witness Kernel

Purpose:

```text
Create one shared proof shape for actually usable capabilities and one shared
resident/operator witness shape.
```

Shared object:

```ts
type OdeuProofRequirementMatrix = {
  promotionDecisionRequired: boolean;
  activationRequired: boolean;
  declarationRequired: boolean;
  authorityDecisionRequired: boolean;
  transactionRequired: boolean;
  resultEnvelopeRequired: boolean;
  contextAdmissionRequired: boolean;
  residentWitnessRequired: boolean;
  operatorSurfaceRequired: boolean;
  recoveryTestRequired: boolean;
};

type OdeuCapabilityUsabilityProof = OdeuArtifactBase & {
  schema: "odeu_capability_usability_proof@1";
  proofId: string;
  capabilityId: string;
  family: string;
  firstUsableSlice: {
    sliceId: string;
    description: string;
    capabilitiesIncluded: string[];
    stillDiagnostic: string[];
    stillBlocked: string[];
  };
  promotionDecisionId: string;
  activationSnapshotId: string;
  declarationSnapshotId?: string;
  authorityDecisionId?: string;
  transactionId?: string;
  resultEnvelopeId?: string;
  contextAdmissionId?: string;
  residentSnapshotId?: string;
  operatorSurfaceId?: string;
  usableFor:
    | "operator_ui_live"
    | "resident_visible"
    | "resident_requestable"
    | "resident_callable"
    | "provider_declared";
  proofClass: "fixture" | "headless_live" | "operator_ui_live" | "resident_live";
  proofRequirements: OdeuProofRequirementMatrix;
  proofEvidence: {
    deterministicChecksPassed: boolean;
    modelSelfReportSmokePassed?: boolean;
    selfReportIsSupplemental: true;
  };
  recoveryTested: boolean;
  rawExposurePassed: boolean;
  provedAt: string;
};

type OdeuCapabilityWitnessRow = OdeuArtifactBase & {
  schema: "odeu_capability_witness_row@1";
  witnessRowId: string;
  capabilityId: string;
  usabilityProofId?: string;
  residentVisible: boolean;
  residentCallable: boolean;
  operatorVisible: boolean;
  operatorCallable: boolean;
  status:
    | "callable_now"
    | "known_available"
    | "known_disabled"
    | "operator_only"
    | "shadow_only"
    | "blocked"
    | "stale"
    | "unknown";
  compactText: string;
  sourceRefs: OdeuSourceRef[];
};
```

Resident witness rule:

```text
Resident-visible rows should cite usability/proof refs when possible. Resident
self-report smoke is supplemental evidence, not the proof source.
```

Acceptance:

```text
- Every first usable slice emits OdeuCapabilityUsabilityProof.
- Usability proof includes proofRequirements and firstUsableSlice details.
- Proof requirement matrix validates required refs by usableFor/proofClass.
- Resident-visible rows cite usability/proof refs.
- Operator-visible rows cite the same proof refs.
- Capability witness rows are defined for resident/operator surfaces.
- Deterministic proof is separate from model self-report smoke.
- Self-report smoke cannot by itself mark a capability live.
- Fixture proof, headless live proof, operator UI proof, and resident live proof
  remain distinct.
```

## Mapping To Later Waves

After this kernel wave, later families should only define:

```text
family-specific executor
family-specific argument schema
family-specific side-effect class
family-specific result contract
family-specific UI/resident wording
```

Mapping:

```text
Wave 15 sub-agent MVP:
  uses activation/declaration, per-call authority, transaction, result
  admission, usability proof.

Wave 16 sub-agent lifecycle/follow-up/transcript:
  adds lifecycle/follow-up semantics over the same kernels.

Wave 17 human/control/read-only:
  uses per-call authority, result envelope, resident witness.

Wave 18 external discovery/MCP read:
  specializes source refs, external identity, result admission.

Wave 19 provider-hosted tools:
  specializes provider declaration, web citation, image artifact contracts.

Wave 20 context transition/compaction:
  specializes context-world transaction, omission ledger, baton, memory policy.

Wave 21 code mode:
  specializes kernel/session lifecycle, output envelope, resource limits.

Wave 22 batch agents:
  specializes row identity, fan-out, fan-in, aggregation, usage rollup.

Wave 23 quota reset:
  specializes account mutation, operator confirmation, before/after snapshot.

Wave 24 bridge modules/hooks:
  specializes input manifest, hook proposal/execution gate, module result.
```

## Migration Posture

The first kernel wave should avoid a broad rewrite. It should:

```text
add shared primitives
add adapters from existing row/report shapes
migrate only the minimum callers needed for proof
preserve existing regression behavior
mark old local helper shapes as compatibility where needed
```

Do not block later implementation on perfect migration. The kernel is a
canonical target for new live capabilities first, then a migration path for old
ones.

## Immediate Migration Targets

The kernel wave should be adapter-first. Do not broad-rewrite family files.

Migrate or adapt immediately:

```text
src/main/direct/bridge/tool-capability-registry.js
src/main/direct/headless/tool-promotion-decision-report.js
src/main/direct/headless/tool-activation-registry.js
src/main/direct/headless/first-tool-slice.js
src/main/direct/bridge/resident-epistemic-snapshot.js
src/main/direct/bridge/resident-tool-epistemic-catalog.js
```

These are direct ancestors of the capability lifecycle and usability witness
kernels.

Leave behind adapters initially:

```text
src/main/direct/agents/runtime-substrate.js
src/main/direct/agents/provider-backed-route.js
src/main/direct/agents/live-tool-surface.js
src/main/direct/agents/inspect-wait-containment.js
src/main/direct/external/capability-discovery.js
src/main/direct/external/mcp-boundary.js
src/main/direct/provider/hosted-tools.js
src/main/direct/tools/code-mode-execution-lane.js
src/main/direct/agents/batch-job-surface.js
src/main/direct/bridge/skills-hooks-apps.js
```

Use existing shared helpers where suitable:

```text
src/main/direct/meta-session/digest.js
src/main/direct/meta-session/source-ref.js
src/main/direct/meta-session/raw-exposure.js
```

If those helpers are already compatible, `src/main/direct/odeu/*` should wrap or
re-export rather than duplicate them.

## Non-Goals

```text
No generic execute-any-tool gateway.
No family-specific live capability promotion in this wave.
No provider declaration changes unless needed for fixture proof.
No new resident-callable tools.
No workspace mutation behavior change.
No connector/plugin/module execution.
No account mutation.
No context reset or compaction call.
```

## Global Acceptance Criteria

```text
- Every kernel object carries schema, kernelVersion, scope, status, and createdAt.
- Source refs carry confidence, freshness, and optional digest.
- Digest absence uses unavailableReason, not algorithm=none.
- Raw-exposure scan records scannerVersion and scanScope.
- Capability lifecycle separates capabilityState, implementationState,
  promotionState, providerDeclarationState, activation state, and declaration
  state.
- Activation scope is structured and precedence law is explicit.
- Declaration snapshots include declarationDigest, activationRegistryDigest,
  requestShapeFamily, providerProfileId/modelId where applicable.
- Per-call authority decision records caller and callSurface.
- Transaction lifecycle distinguishes result_recorded, result_enveloped,
  context_admission_recorded, provider_result_sent, and terminal provider state.
- Result envelope includes local/renderer/resident/provider/transcript visibility.
- Context admission has admissionDecision separate from admittedAs.
- Usability proof includes proofRequirements and firstUsableSlice details.
- Capability witness rows are defined for resident/operator surfaces.
- Existing family-specific rows can be adapted without broad rewrite.
```

## GPT Review Questions

Ask review specifically for:

```text
1. Are the five kernel PRs split at the right abstraction boundaries?
2. Are scope/schema/status/freshness/confidence sufficient on every durable row?
3. Are any kernel objects over-generalized in a way that would erase family law?
4. Are any required proof artifacts missing before Wave 15 sub-agent MVP?
5. Which existing direct files should be migrated immediately versus left behind
   an adapter?
```
