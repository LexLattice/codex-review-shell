# Direct Wave 19: Provider-Hosted Tools

Status: planning spec for Wave 19.

Primary dependencies:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md
docs/DIRECT_WAVE18_EXTERNAL_DISCOVERY_MCP_READ_SPEC.md
src/main/direct/provider/hosted-tools.js
src/main/direct/bridge/tool-capability-registry.js
src/main/direct/external/external-discovery-tools.js
src/main/direct/external/external-wave18-usability-gate.js
```

## Purpose

Wave 19 promotes provider-hosted tools from diagnostic posture into lawful
direct-path capability where exact upstream evidence supports it.

The two first provider-hosted tool families are:

```text
web_search:
  external epistemic evidence produced by the provider/runtime

image_generation:
  generated artifact production produced by the provider/runtime
```

Wave 19 is not "turn on web and image." It is the bridge layer that decides
when a hosted provider tool can be declared, invoked, admitted to context, shown
to the operator, and tracked as usage evidence without laundering it into
project truth.

## Core Doctrine

Provider-hosted tools are not local tools, not MCP tools, and not browser state.

```text
provider-hosted web_search != browser navigation
provider-hosted web_search != project evidence
provider-hosted image_generation != workspace file mutation
provider-hosted image_generation != renderer-owned binary state
provider capability metadata != activation permission
tool declaration != result trust
result envelope != durable memory
artifact generation != source artifact insertion
```

Global invariant:

```text
No provider-hosted tool may be declared to the resident model unless the
activation snapshot cites exact provider/account/model/runtime evidence and a
matching per-call result-admission policy.
```

If evidence is missing:

```text
known diagnostic row > static label guess
unsupported/unknown witness > silent absence
blocked call > undeclared provider transport mutation
```

## ODEU Placement

Wave 19 extends the unified information bridge as follows:

```text
O:
  provider-hosted tool capability and result object

D:
  declaration law, per-call authority, result-admission law, retention law

E:
  provider capability evidence, runtime probe, result envelope, usage rows

U:
  resident utility from bounded external evidence or generated artifacts
```

The resident agent should know:

```text
which provider-hosted tools exist
whether each is available, unsupported, unknown, or blocked
what evidence supports that posture
what can be done to make an unavailable tool available
what result shape and trust posture the tool has
what the tool cannot do
```

The operator should see:

```text
capability status
why a tool is enabled/disabled
what was called
what evidence/result entered context
where generated artifacts were staged
what was not stored, trusted, or inserted
```

## Existing Substrate

Earlier waves already added diagnostic provider-hosted rows:

```text
src/main/direct/provider/hosted-tools.js:
  provider_hosted_tool_capability@1
  provider_web_search_evidence_contract@1
  provider_image_generation_artifact_contract@1
  provider_hosted_tools_status@1

src/main/direct/bridge/tool-capability-registry.js:
  vanilla.hosted.web_search
  vanilla.hosted.image_generation
```

Current posture:

```text
implementationState = projection_only
promotionState = diagnostic_only
providerDeclarationState = not_declared
providerHostedToolCallAllowed = false
providerTransportAllowed = false
contextInjectionAllowed = false
workspaceMutationAllowed = false
```

Wave 19 should promote these rows only by adding exact activation and result
proofs. It must not erase the diagnostic posture for accounts/models that do
not expose support.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| ProviderHostedToolCapabilityProbe | support artifact | build | reads provider/account/model/runtime capability posture without transport mutation |
| ProviderHostedRequestShapeProof | evidence artifact | build | proves the active request builder and provider result shape for a hosted tool |
| ProviderHostedToolActivationSnapshot | evidence artifact | build | frozen declaration eligibility and blocker state |
| ProviderHostedToolDeclarationPolicy | support artifact | align/build | decides which hosted tools may be declared to the resident |
| ProviderHostedToolCallEnvelope | transition artifact | build | per-call authority, source, scope, and replay law |
| ProviderHostedWebSearchQueryPolicy | support artifact | build | governs outbound web-search query disclosure |
| ProviderHostedImagePromptPolicy | support artifact | build | governs outbound image prompt disclosure and operator gating |
| ProviderHostedWebSearchResultEnvelope | evidence artifact | build | provider web result refs, retrieval time, citation/staleness posture |
| ProviderHostedImageGenerationArtifactEnvelope | evidence artifact | build | generated asset refs, prompt evidence posture, storage/retention policy |
| ProviderHostedResultContextAdmission | support artifact | align/build | admits summary/ref/excerpt/image artifact refs into context under trust law |
| ProviderHostedUsageAttribution | support artifact | build | maps hosted tool usage to turn/thread/agent rows |
| ProviderHostedRawExposureScanner | support artifact | build | blocks raw provider payload, secrets, raw prompts/results, and unbounded page/image payloads |
| ProviderHostedUsabilityProof | report artifact | build | proves resident/operator/headless behavior and negative gates |

## Capability Evidence Law

Capability evidence states:

```ts
type ProviderHostedCapabilityEvidenceState =
  | "accepted"
  | "runtime_probed"
  | "profile_declared"
  | "known_available_unprobed"
  | "unknown"
  | "unsupported";
```

Declaration states:

```ts
type ProviderHostedDeclarationState =
  | "not_declared"
  | "activation_ready"
  | "declared_to_resident"
  | "operator_ui_live"
  | "runtime_accepted"
  | "unsupported"
  | "unknown"
  | "blocked";
```

Invocation modes:

```ts
type ProviderHostedInvocationMode =
  | "model_mediated_provider_tool"
  | "harness_requested_provider_operation"
  | "operator_triggered_provider_operation"
  | "headless_route_provider_operation";
```

Wave 19 default callable posture:

```text
web_search:
  resident-callable only when accepted/runtime_probed request-shape proof exists

image_generation:
  resident-visible by default
  operator-callable when accepted/runtime_probed request-shape proof exists
  resident-callable disabled unless a later activation explicitly allows it

profile_declared / known_available_unprobed:
  visible as available-but-unprobed
  not callable by resident/operator/headless
```

Required activation evidence:

```text
provider profile digest
provider kind/account posture
model id and model-family support posture
tool kind and provider-native name/shape
runtime transport route
tool schema digest or provider request-shape digest
request-shape proof id
result envelope schema
context admission policy id
query/prompt policy id
raw-exposure scanner id
usage attribution policy id
generated-at / observed-at timestamps
blockers if unavailable
```

Allowed support postures:

```text
accepted:
  provider/runtime accepted a validation request or declaration handshake

runtime_probed:
  direct harness probe verified request-shape support without side-effecting
  user-visible state

profile_declared:
  trusted provider metadata explicitly declared support, but no runtime probe
  has been performed yet

known_available_unprobed:
  trusted provider metadata or account/model profile says the tool exists, but
  the direct harness has not proven the request builder/result shape

unknown:
  support could not be determined

unsupported:
  profile/runtime evidence says the active provider/account/model does not
  support the tool
```

Hard rules:

```text
- No hosted tool declaration from static labels.
- No hosted tool declaration from model name alone.
- No hosted tool declaration from historical account behavior alone.
- No callable hosted activation from `profile_declared` or
  `known_available_unprobed` alone.
- No hosted tool declaration when activation evidence is stale.
- No hosted tool invocation without request-shape proof.
- No hosted tool declaration when result admission policy is missing.
- Unknown support remains visible as unknown/blocked, not absent.
```

## Request-Shape Proof

Capability evidence says a hosted tool exists. Request-shape proof says this
harness can actually invoke the hosted operation through the active provider
route and parse the returned result.

```ts
type ProviderHostedRequestShapeProof = {
  schema: "provider_hosted_request_shape_proof@1";
  proofId: string;
  toolKind: "web_search" | "image_generation";
  invocationMode: ProviderHostedInvocationMode;
  providerProfileDigest: string;
  modelRef: {
    model: string;
    serviceTier?: string;
    reasoningEffort?: string;
  };
  requestShapeDigest: string;
  requestBuilderVersion: string;
  runtimeAccepted: boolean;
  resultShapeObserved: boolean;
  observedAt: string;
  expiresAt?: string;
};
```

Callable activation requires:

```text
capability evidence state = accepted | runtime_probed
requestShapeProof.runtimeAccepted = true
requestShapeProof.resultShapeObserved = true
requestShapeProof not stale
```

Without request-shape proof:

```text
profile says tool exists -> visible diagnostic / activation_ready_only
tool declaration to resident -> blocked
operator live action -> blocked
headless route action -> blocked
```

## Activation Snapshot

```ts
type ProviderHostedToolActivationSnapshot = {
  schema: "provider_hosted_tool_activation_snapshot@1";
  activationId: string;
  workThreadId: string;
  projectId?: string;
  providerRuntimeRef: string;
  providerProfileDigest: string;
  accountEvidenceRef?: EvidenceRef;
  modelRef: {
    model: string;
    reasoningEffort?: string;
    serviceTier?: string;
  };
  invocationModes: ProviderHostedInvocationMode[];
  requestShapeProofRefs: EvidenceRef[];
  capabilities: ProviderHostedToolCapability[];
  declaredTools: ProviderHostedToolKind[];
  blockedTools: Array<{
    toolKind: ProviderHostedToolKind;
    blocker: string;
    recoveryHint?: string;
  }>;
  declarationDigest: string;
  resultAdmissionPolicyId: string;
  webSearchQueryPolicyId?: string;
  imagePromptPolicyId?: string;
  usageAttributionPolicyId: string;
  rawExposureScannerId: string;
  createdAt: string;
  expiresAt?: string;
};
```

Resident-visible declaration must cite the activation snapshot digest:

```text
declared tool call
  -> declaration digest
  -> activation snapshot
  -> capability evidence
  -> result envelope
  -> context admission record
```

If any link is missing, the tool is not callable.

## Tool Call Envelope

```ts
type ProviderHostedToolCallEnvelope = {
  schema: "provider_hosted_tool_call_envelope@1";
  callId: string;
  toolKind: "web_search" | "image_generation";
  invocationMode: ProviderHostedInvocationMode;
  callSurface: "resident_tool" | "operator_ui" | "headless_route" | "system";
  workThreadId: string;
  turnId: string;
  agentId?: string;
  activationId: string;
  declarationDigest: string;
  caller: "resident" | "operator" | "headless" | "system";
  sideEffectClass:
    | "external_epistemic_read"
    | "generated_artifact_production";
  authorityDecision:
    | "allowed"
    | "blocked_unknown_capability"
    | "blocked_unsupported"
    | "blocked_missing_declaration"
    | "blocked_missing_result_policy"
    | "blocked_raw_exposure_risk"
    | "blocked_operator_gate_required";
  replayPolicy: {
    mayAutoRetry: false;
    requiresFreshOperatorIntent: boolean;
    idempotencyKey?: string;
  };
  inputEvidenceRef: EvidenceRef;
  requestShapeProofId: string;
  inputPolicyId: string;
  outboundDisclosureScanRef: EvidenceRef;
  rawPromptIncluded: false;
  rawProviderPayloadIncluded: false;
  createdAt: string;
};
```

Web search is an external read. Image generation is artifact production. They
must never share one generic "hosted call" side-effect class.

## Outbound Input Governance

Provider-hosted calls disclose information to an external provider operation.
The raw-exposure scanner must scan outbound inputs before provider transport,
not only inbound results.

### Web Search Query Policy

```ts
type ProviderHostedWebSearchQueryPolicy = {
  schema: "provider_hosted_web_search_query_policy@1";
  policyId: string;
  maxQueryChars: number;
  maxQueriesPerTurn: number;
  allowedQueryKinds:
    | "single_query"
    | "followup_query"
    | "site_scoped_query";
  disallowedQueryClasses: Array<
    | "credentialed_url"
    | "raw_secret"
    | "private_file_path"
    | "raw_provider_payload"
    | "unbounded_personal_data"
  >;
  operatorConfirmationRequired: boolean;
};

type ProviderHostedWebSearchQueryEnvelope = {
  schema: "provider_hosted_web_search_query_envelope@1";
  queryEnvelopeId: string;
  callId: string;
  queryDigest: string;
  queryPreview?: string;
  queryPolicyId: string;
  rawQueryStored: false;
  rawSecretsDetected: boolean;
  redactionState: "passed" | "redacted" | "blocked";
};
```

Web search query rules:

```text
- Credentialed URLs, raw secrets, raw provider payload, private local paths,
  and unbounded personal data are blocked or redacted before transport.
- Query preview is bounded and renderer-safe.
- A search query is outbound disclosure; it is not merely local context.
```

### Image Prompt Policy

```ts
type ProviderHostedImagePromptPolicy = {
  schema: "provider_hosted_image_prompt_policy@1";
  policyId: string;
  maxPromptChars: number;
  allowProjectContext: boolean;
  allowFileContentInPrompt: boolean;
  allowPersonalData: boolean;
  operatorGateRequired: boolean;
  rawPromptRetention:
    | "digest_only"
    | "redacted_preview"
    | "private_artifact"
    | "not_stored";
};

type ProviderHostedImagePromptEnvelope = {
  schema: "provider_hosted_image_prompt_envelope@1";
  promptEnvelopeId: string;
  callId: string;
  promptDigest: string;
  promptPreview?: string;
  promptPolicyId: string;
  rawPromptStored: false;
  rawSecretsDetected: boolean;
  redactionState: "passed" | "redacted" | "blocked";
};
```

Wave 19 default:

```text
image_generation:
  operatorGateRequired = true
  residentCallable = false unless an explicit later activation permits it
  rawPromptRetention = digest_only or redacted_preview
```

## Web Search Result Envelope

```ts
type ProviderHostedWebSearchResultEnvelope = {
  schema: "provider_hosted_web_search_result_envelope@1";
  resultId: string;
  callId: string;
  workThreadId: string;
  turnId: string;
  providerResultRef: string;
  queryDigest: string;
  queryPreview?: string;
  retrievedAt: string;
  freshnessPosture:
    | "current_at_retrieval"
    | "stale_possible"
    | "unknown";
  sourceRefs: Array<{
    sourceId: string;
    urlDisplay: string;
    urlEvidenceKey: string;
    title?: string;
    retrievedAt?: string;
    citationLabel?: string;
    sourceType:
      | "web_page"
      | "news"
      | "documentation"
      | "forum"
      | "pdf"
      | "unknown";
    retrievalConfidence:
      | "provider_reported"
      | "provider_cited"
      | "harness_verified"
      | "unknown";
    contentAccess:
      | "snippet_only"
      | "summary_only"
      | "provider_citation_only"
      | "fetched_content"
      | "unknown";
    trustPosture:
      | "provider_reported"
      | "operator_known"
      | "unknown";
  }>;
  resultSummary?: string;
  summaryKind:
    | "provider_reported_summary"
    | "harness_reduced_summary"
    | "resident_generated_after_admission"
    | "none";
  summaryAuthority:
    | "external_evidence_summary"
    | "assistant_answer"
    | "diagnostic";
  webSearchLimits: {
    maxSources: number;
    maxSummaryChars: number;
    maxExcerptChars: number;
    maxFollowupSearchesPerTurn: number;
  };
  citationParity: {
    admittedSourceIds: string[];
    missingSourceIds: string[];
    inventedCitationDetected: boolean;
  };
  quotePolicy: {
    verbatimLimitApplied: boolean;
    rawPageContentIncluded: false;
  };
  redactionState:
    | "not_needed"
    | "redacted"
    | "blocked";
  rawProviderPayloadIncluded: false;
  rawPageContentIncluded: false;
  contextAdmission?: ProviderHostedResultContextAdmissionRef;
};
```

Rules:

```text
- Raw page HTML is not resident context in v0.
- `resultSummary` is an external evidence summary, not the assistant final
  answer.
- URLs with embedded credentials are blocked or redacted.
- `javascript:`, `data:`, `blob:`, and local file schemes are not accepted as
  web-search source URLs.
- Search result summaries must carry trust/freshness warnings when admitted.
- Source refs are citations, not project evidence.
- Every admitted citation/source ref must exist in the result envelope.
- No citation label may be invented by context admission.
- Web-search results are never durable memory by default.
```

## Image Generation Artifact Envelope

```ts
type ProviderHostedImageGenerationArtifactEnvelope = {
  schema: "provider_hosted_image_generation_artifact_envelope@1";
  artifactId: string;
  callId: string;
  workThreadId: string;
  turnId: string;
  providerResultRef: string;
  promptEvidenceRef: EvidenceRef;
  promptPreview?: string;
  modelRef: {
    model: string;
    imageModel?: string;
  };
  artifactRefs: Array<{
    artifactRef: string;
    displayName: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "unknown";
    byteSize?: number;
    dimensions?: { width: number; height: number };
    artifactProvenance:
      | "provider_generated"
      | "operator_exported_copy"
      | "derived_thumbnail"
      | "unknown";
    storagePosture:
      | "ephemeral_provider_ref"
      | "shell_staged_artifact"
      | "operator_exported"
      | "blocked";
    rendererProjection:
      | "thumbnail_ref"
      | "download_ref"
      | "metadata_only"
      | "blocked";
    stagingManifestRef?: EvidenceRef;
    stagingManifestDigest?: string;
    cleanupPolicyId?: string;
  }>;
  generationLimits: {
    maxImages: number;
    maxTotalBytes?: number;
    allowedMimeTypes: Array<"image/png" | "image/jpeg" | "image/webp">;
    maxWidth?: number;
    maxHeight?: number;
  };
  generationState:
    | "completed"
    | "blocked_by_provider"
    | "blocked_by_policy"
    | "failed"
    | "partial"
    | "unknown";
  retentionPolicy: {
    retainAfterTurn: boolean;
    ttlHours?: number;
    workspaceInsertionAllowed: false;
  };
  safetyMetadataRef?: EvidenceRef;
  safetyPosture:
    | "provider_allowed"
    | "provider_filtered"
    | "provider_blocked"
    | "unknown"
    | "not_applicable";
  rawPromptIncluded: false;
  rawImageBytesInRendererState: false;
  rawProviderPayloadIncluded: false;
  contextAdmission?: ProviderHostedResultContextAdmissionRef;
};
```

Rules:

```text
- Generated images are artifacts, not source files.
- Provider-generated images are distinct from workspace source files and user
  attachments.
- No automatic workspace insertion.
- No raw image bytes in renderer state.
- If a file is staged locally, staging root, cleanup, manifest, and retention
  rules must be explicit.
- If `storagePosture=shell_staged_artifact`, staging manifest and cleanup
  policy are required.
- Provider-blocked generations produce blocked envelopes; they do not disappear
  as silent failures.
- Prompt text is evidence-managed; raw prompt storage is disabled by default.
- Image generation may be operator-gated even when web_search is resident
  callable.
```

## Context Admission

Provider-hosted result context admission reuses the Wave 18 imported-result
principles, but hosted tools have provider-specific source posture.

```ts
type ProviderHostedResultContextAdmission = {
  schema: "provider_hosted_result_context_admission@1";
  admissionId: string;
  resultId: string;
  toolKind: "web_search" | "image_generation";
  workThreadId: string;
  turnId: string;
  admissionKind:
    | "summary"
    | "source_refs"
    | "bounded_excerpt"
    | "artifact_ref"
    | "blocked";
  admissionDecision:
    | "admit"
    | "admit_degraded"
    | "block_source_unknown"
    | "block_raw_exposure"
    | "block_policy"
    | "not_requested";
  visibility: {
    residentContext:
      | "none"
      | "summary"
      | "source_refs"
      | "bounded_excerpt"
      | "artifact_ref";
    operatorProjection:
      | "none"
      | "summary"
      | "source_refs"
      | "artifact_preview"
      | "artifact_ref";
    providerContinuation:
      | "not_sent"
      | "summary_only"
      | "source_refs"
      | "artifact_ref";
    usageLedger: boolean;
  };
  trustWarning: string;
  freshnessWarning?: string;
  rawPayloadIncluded: false;
  memoryCandidateCreated: false;
  durableMemoryAdmission: false;
  projectTruthGranted: false;
  createdAt: string;
};
```

Admission laws:

```text
- Result envelope exists before context admission.
- Context admission records do not authorize workspace mutation.
- Usage rows may cite result refs, but usage rows do not carry raw result text
  or image bytes.
- Durable memory admission is a later explicit transition.
- Wave 19 context admission always sets `memoryCandidateCreated=false`.
- If source/provenance is missing, admission degrades to blocked/source_unknown.
```

## Resident Declaration

Resident declaration for Wave 19 must be exact and negative-capability-aware.

Example resident-visible posture:

```text
Provider-hosted tools:
  web_search: available, external epistemic evidence, citation required
  image_generation: blocked, operator gate required / unsupported on this model
```

The resident should not need to guess why a hosted tool is missing. The
declaration should name:

```text
tool kind
availability state
callable by resident/operator/headless/system
input limits
result envelope
context admission policy
known blockers
recovery hints
```

If image generation is not resident-callable, it should still be visible as:

```text
known tool, blocked/deferred, reason, required activation evidence
```

## Privacy And Security

Hard laws:

```text
- No raw provider payload reaches renderer or resident context.
- No raw browser cookies, account identifiers, bearer tokens, or API keys enter
  hosted-tool rows.
- No raw page HTML enters resident context by default.
- No raw image bytes enter renderer state.
- No raw local staging path enters renderer state; use evidence refs.
- No hosted result enters durable memory automatically.
- No hosted result becomes project truth.
- No provider-hosted call is automatically replayed after restart, handoff, or
  unknown terminal state.
```

Raw exposure scanner blockers:

```text
auth token
cookie
credentialed URL
raw provider payload
raw page HTML
raw prompt text where policy forbids it
raw image bytes in renderer state
absolute staging path in renderer state
workspace mutation claim
durable memory claim
project truth claim
```

## Usage Attribution

Provider-hosted calls must be separately attributable from model inference,
local tools, MCP reads, and generated workspace actions.

```ts
type ProviderHostedUsageAttribution = {
  schema: "provider_hosted_usage_attribution@1";
  attributionId: string;
  callId: string;
  toolKind: "web_search" | "image_generation";
  workThreadId: string;
  turnId: string;
  agentId?: string;
  providerRequestRef?: string;
  tokenUsageRef?: string;
  costEvidenceRef?: string;
  usageKind:
    | "hosted_web_search"
    | "hosted_image_generation";
  usageState:
    | "exact"
    | "provider_reported_partial"
    | "derived"
    | "unavailable"
    | "unknown";
  unavailableReason?:
    | "provider_did_not_report"
    | "schema_unsupported"
    | "stream_interrupted"
    | "redacted"
    | "handoff_unknown";
  confidence:
    | "provider_reported"
    | "runtime_reported"
    | "derived"
    | "unknown";
  rawProviderPayloadIncluded: false;
};
```

Rules:

```text
- Missing hosted-tool usage is unknown/unavailable, not zero.
- Cost is a derived pass unless provider reports it directly.
- A per-call hosted usage row is mandatory even when token/cost usage is
  unavailable.
- Parent turn totals may include hosted usage only with a separate breakdown.
- Web search and image generation usage must not be folded invisibly into
  parent turn totals without a per-call row.
```

## PR Plan

### PR 114: Provider-Hosted Activation Snapshot

Branch:

```text
codex/direct-provider-hosted-activation
```

Deliverables:

```text
ProviderHostedToolCapabilityProbe
ProviderHostedRequestShapeProof
ProviderHostedToolActivationSnapshot
ProviderHostedToolDeclarationPolicy
profile/runtime evidence normalization
invocationMode and request-shape scope
profile_declared / known_available_unprobed is not callable
staleness and blocker vocabulary
resident/operator status projection
registry update from diagnostic_only to activation_gated
headless fixture for supported/unsupported/unknown rows
```

Non-goals:

```text
no provider-hosted tool call execution
no web result context admission
no image artifact staging
no request-shape mutation from static labels
```

### PR 115: Provider-Hosted Call Envelope And Raw Scanner

Branch:

```text
codex/direct-provider-hosted-call-envelope
```

Deliverables:

```text
ProviderHostedToolCallEnvelope
per-call authority gate
declaration digest matching
ProviderHostedWebSearchQueryPolicy and query envelope
ProviderHostedImagePromptPolicy and prompt envelope
outbound disclosure scan for query, prompt, config, and request metadata
sideEffectClass split for web_search and image_generation
idempotency/replay law
ProviderHostedRawExposureScanner
blocked-call rows for missing declaration, unknown capability, stale evidence,
raw exposure risk, and operator gate required
headless negative tests for undeclared hosted calls
```

Non-goals:

```text
no real web_search execution
no real image_generation execution
no generated artifact storage
no durable memory admission
```

### PR 116: Hosted Web Search Result And Context Admission

Branch:

```text
codex/direct-provider-hosted-web-search
```

Deliverables:

```text
ProviderHostedWebSearchResultEnvelope
web search request/result shape validation
source URL display/evidence-key policy
sourceType, retrievalConfidence, and contentAccess
retrieved-at/freshness/citation posture
summaryKind and summaryAuthority
webSearchLimits and citation/admission parity
quote and raw-page-content policy
ProviderHostedResultContextAdmission for summary/source refs/bounded excerpts
resident-callable web_search only when activation says callable
headless happy/degraded/blocked scenarios
```

Non-goals:

```text
no browser navigation
no local web cache ingestion
no raw page HTML context admission
no web result durable memory
no project-truth mutation
```

### PR 117: Hosted Image Generation Artifact Governance

Branch:

```text
codex/direct-provider-hosted-image-artifacts
```

Deliverables:

```text
ProviderHostedImageGenerationArtifactEnvelope
image generation request/result shape validation
operator-gated default, with resident-callable disabled unless explicit later
activation permits it
artifact refs and renderer projection policy
generationLimits, artifactProvenance, generationState, and safetyPosture
storage/retention/staging manifest contract
stagingManifestRef and cleanupPolicyId required for staged artifacts
prompt evidence and raw-prompt policy
safety metadata evidence refs
blocked/deferred behavior when provider route is unavailable
headless scenarios for unsupported, operator-gated, and artifact-staged paths
```

Non-goals:

```text
no automatic workspace insertion
no raw image bytes in renderer state
no image editor workflow
no durable memory admission
no bypass of provider/account safety policy
```

### PR 118: Hosted Usage Attribution And Analytics Wiring

Branch:

```text
codex/direct-provider-hosted-usage-attribution
```

Deliverables:

```text
ProviderHostedUsageAttribution
hosted tool per-call analytics rows
usageKind, usageState, and unavailableReason
thread/turn/agent attribution
unknown/unavailable evidence rows
analytics dock/runtime witness integration
parent turn breakdown separate from hosted usage
cost remains derived unless provider reports it
fixtures proving hosted usage is distinct from model inference/local tools/MCP
```

Non-goals:

```text
no billing-grade cost unless provider reports it
no synthesized missing usage as zero
no retroactive exact usage for old transcripts
```

### PR 119: Wave 19 Usability Proof Gate

Branch:

```text
codex/direct-provider-hosted-wave19-usability-gate
```

Deliverables:

```text
ProviderHostedUsabilityProof
resident epistemic declaration scenarios
operator projection scenarios
headless tests for web_search available/blocked and image_generation
available/operator-gated/blocked
negative matrix for profile-declared-but-unprobed calls, static-label
declaration, raw payload leaks, credentialed URLs/secrets/private paths in
queries, invented citations, raw prompt retention, staged artifact without
manifest, provider-blocked generation disappearing, raw image bytes, workspace
insertion, durable memory smuggling, replay, stale activation, and undeclared
hosted calls
registry/roadmap/audit update marking Wave 19 complete when gates pass
```

Non-goals:

```text
no Wave 20 new_context/compaction execution
no Wave 21 code-mode execution
no Wave 22 batch orchestration
no plugin installation or dynamic MCP action execution
```

## Acceptance Criteria

General:

```text
- Every hosted tool has capability evidence state and declaration state.
- ProviderHostedInvocationMode is recorded for activation, call, and proof.
- ProviderHostedRequestShapeProof is required before callable activation.
- Every hosted declaration cites an activation snapshot digest.
- No hosted tool is declared from static labels, model name alone, or stale
  historical behavior.
- `profile_declared` or `known_available_unprobed` alone cannot produce
  resident-callable, operator-live, or headless-live state.
- Unknown/unsupported hosted tools are visible with blockers and recovery hints.
- Every hosted call carries ProviderHostedToolCallEnvelope.
- Web search and image generation have distinct side-effect classes.
- Input raw-exposure scanning covers outbound query, image prompt, tool config,
  and request metadata, not only inbound results.
- Every hosted result has a result envelope before context admission.
- Context admission has multi-channel visibility, explicit admissionDecision,
  and never grants project truth or durable memory.
- Wave 19 hosted result admission creates no memory candidates.
- Raw provider payloads, raw page HTML, raw image bytes, secrets, and raw local
  staging paths are blocked before renderer/resident exposure.
- Hosted usage attribution is distinct from model inference, local tools, MCP
  reads, and workspace actions.
```

Web search:

```text
- web_search is resident-callable only when activation evidence says callable.
- Web search query policy scans outbound query for secrets, credentialed URLs,
  private paths, oversized input, and disallowed personal data.
- Source refs include safe display URL/evidence key, retrieval posture, and
  citation label where available.
- Source refs include sourceType, retrievalConfidence, and contentAccess.
- Every admitted citation/source ref exists in the result envelope.
- No citation label may be invented by context admission.
- Result summary authority distinguishes external evidence summary from
  assistant final answer.
- Credentialed or active-scheme URLs are blocked/redacted.
- Raw page content is not admitted in v0.
- Admitted summaries/source refs carry trust/freshness warnings.
```

Image generation:

```text
- image_generation is generated artifact production, not a source mutation.
- image_generation is operator-gated by default; resident-callable is disabled
  unless a separate activation explicitly permits it.
- If provider route is unavailable, image_generation remains blocked/deferred
  with evidence.
- Image prompt policy controls raw prompt retention, project context use, file
  content use, personal data, and operator gating.
- Generated artifacts have storage/retention policy before operator projection.
- Generated artifacts have generationLimits, artifactProvenance,
  generationState, and safetyPosture.
- Staged generated artifacts require stagingManifestRef and cleanup policy.
- Provider-blocked image generation produces a blocked envelope, not silent
  failure.
- No automatic workspace insertion occurs.
- Prompt evidence is policy-bound; raw prompt text is excluded by default.
```

Negative gates:

```text
- Static-label hosted declaration fails.
- Profile-declared but not runtime-probed/request-shape-proven callable
  activation fails.
- Missing activation snapshot fails.
- Stale activation snapshot fails.
- Web search query containing credentialed URL/secret/private path fails or is
  redacted before transport.
- Web search result with invented citation fails context admission.
- Web search result source with active scheme is blocked/redacted.
- Result without envelope fails.
- Context admission without provenance fails.
- Raw provider payload leakage fails.
- Raw page HTML leakage fails.
- Image generation prompt raw text retained despite policy fails.
- Image generation staged artifact without manifest fails.
- Provider-blocked image generation without blocked envelope fails.
- Raw image bytes in renderer state fails.
- Durable memory admission smuggling fails.
- Workspace insertion smuggling fails.
- Usage missing is unknown/unavailable, not zero.
- Automatic replay after unknown/restart/handoff fails.
```

## Completion Gate

Wave 19 is complete when:

```text
The resident can accurately know provider-hosted web-search and
image-generation posture, use provider-hosted web_search where exact activation
evidence supports it, and route image_generation through operator-gated artifact
governance by default, with per-call authority envelopes, sanitized
result/artifact envelopes, explicit context admission, and usage attribution.
Unsupported or unsafe hosted paths remain visible as blocked/deferred with
reasons.
```

Wave 19 is not complete if:

```text
hosted tools are hidden when unknown
hosted tools are declared from static labels
web results enter context without provenance
generated images mutate workspace state automatically
raw provider/page/image payloads reach renderer or resident state
hosted usage is folded invisibly into unrelated usage rows
```
