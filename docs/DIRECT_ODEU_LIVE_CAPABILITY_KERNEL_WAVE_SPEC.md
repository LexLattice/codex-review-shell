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
  sourceKind: string;
  sourceId?: string;
  sourcePathEvidenceKey?: string;
  rowId?: string;
  itemId?: string;
  callId?: string;
  observedAt?: string;
};

type OdeuEvidenceRef = {
  evidenceId: string;
  evidenceKind: string;
  artifactRef?: string;
  sourceRefs?: OdeuSourceRef[];
};

type OdeuDigest = {
  algorithm: "sha256" | "hmac_sha256" | "none";
  value?: string;
  digestOf: "canonical_json" | "content" | "metadata" | "redacted_payload";
};

type OdeuRawExposureScan = {
  passed: boolean;
  rawPromptIncluded: boolean;
  rawProviderPayloadIncluded: boolean;
  rawAuthIncluded: boolean;
  rawPathIncluded: boolean;
  rawToolOutputIncluded: boolean;
  blockers: string[];
};
```

Acceptance:

```text
- Every new family can build source refs through the same helper.
- Every new report/artifact can generate a canonical digest.
- Raw-exposure scan has one shared result shape.
- Existing tool registry, activation, and resident snapshot rows can gradually
  reference these helpers through adapters.
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
type OdeuCapabilityRow = {
  capabilityId: string;
  family: string;
  capabilityKind: string;
  authorityFamily: string;
  defaultPromotionClass: string;
  sideEffectClass: string;
  evidenceRefs: OdeuEvidenceRef[];
};

type OdeuPromotionDecision = {
  promotionDecisionId: string;
  capabilityId: string;
  decision: "promote" | "keep_shadow" | "block" | "defer";
  promotionClass: string;
  evidenceRefs: OdeuEvidenceRef[];
  blockers: string[];
  decidedAt: string;
};

type OdeuActivationRow = {
  activationId: string;
  capabilityId: string;
  promotionDecisionId: string;
  state: "inactive" | "active" | "shadow_only" | "suspended" | "revoked" | "expired";
  scope: "global_default" | "project_default" | "work_thread_override" | "single_turn_override";
  effect: "allow" | "deny" | "shadow" | "revoke";
  expiresAt?: string;
  activatedAt: string;
};

type OdeuDeclarationSnapshot = {
  declarationSnapshotId: string;
  activationId: string;
  surfaceKind:
    | "resident_tool"
    | "operator_ui_action"
    | "headless_command"
    | "provider_hosted_tool"
    | "mcp_resource"
    | "mcp_tool"
    | "sub_agent_control";
  requestShapeDigest?: OdeuDigest;
  rendererVisible: boolean;
  providerVisible: boolean;
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
- No family invents its own enabled boolean.
- No smoke report can become activation without a promotion decision.
- No activation can become provider declaration without a declaration snapshot.
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
type OdeuPerCallAuthorityDecision = {
  authorityDecisionId: string;
  callId: string;
  capabilityId: string;
  activationSnapshotId?: string;
  declarationSnapshotId?: string;
  argumentsDigest?: OdeuDigest;
  argumentValidation: "valid" | "invalid" | "stale" | "unknown";
  policyDecision: "allow" | "block" | "needs_human" | "shadow_only" | "stale" | "unsupported";
  approvalRequirement?: "none" | "operator_confirm" | "single_action" | "turn_scope";
  executorState: "not_started" | "ready" | "unavailable" | "degraded";
  recoveryState: "not_needed" | "retryable" | "not_retryable" | "handoff_unknown";
  replayPolicy: "never" | "idempotent_same_key" | "manual_only";
  decidedAt: string;
};

type OdeuLiveCapabilityTransaction = {
  transactionId: string;
  capabilityId: string;
  callId: string;
  sideEffectClass:
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
    | "module_execution";
  lifecycle:
    | "planned"
    | "authority_blocked"
    | "waiting_for_human"
    | "executing"
    | "local_effect_observed"
    | "result_recorded"
    | "provider_result_sent"
    | "completed"
    | "failed"
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
- Every side-effecting family emits an OdeuLiveCapabilityTransaction.
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
type OdeuResultEnvelope = {
  resultEnvelopeId: string;
  capabilityId: string;
  callId: string;
  transactionId?: string;
  resultKind:
    | "status"
    | "local_perception"
    | "agent_result"
    | "external_evidence"
    | "generated_artifact"
    | "context_transition"
    | "code_result"
    | "account_mutation_result"
    | "module_result";
  sourceRefs: OdeuSourceRef[];
  resultDigest?: OdeuDigest;
  rendererSafeSummary: string;
  providerVisibleSummary?: string;
  rawTextIncluded: false;
  rawPathIncluded: false;
  rawProviderPayloadIncluded: false;
  truncation?: string;
  redaction?: string;
  confidence: "exact" | "derived" | "partial" | "unknown";
};

type OdeuContextAdmissionRecord = {
  admissionId: string;
  resultEnvelopeId: string;
  contextPackId?: string;
  requestManifestId?: string;
  admittedAs:
    | "tool_result_evidence"
    | "external_source_evidence"
    | "generated_artifact_ref"
    | "agent_result_summary"
    | "context_status"
    | "memory_candidate"
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
- Provider-visible result is separate from local result.
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
type OdeuCapabilityUsabilityProof = {
  proofId: string;
  capabilityId: string;
  family: string;
  firstUsableSliceId: string;
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
  recoveryTested: boolean;
  rawExposurePassed: boolean;
  provedAt: string;
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
- Resident-visible rows cite usability/proof refs.
- Operator-visible rows cite the same proof refs.
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

## GPT Review Questions

Ask review specifically for:

```text
1. Are the five kernel PRs split at the right abstraction boundaries?
2. Are any kernel objects over-generalized in a way that would erase family law?
3. Are any required proof artifacts missing before Wave 15 sub-agent MVP?
4. Should PR 87-91 be implemented as one wave, or should any part be merged into
   a later family-specific wave?
5. Which existing direct files should be migrated immediately versus left behind
   an adapter?
```
