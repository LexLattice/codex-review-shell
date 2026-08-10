# Direct Wave 17: Human-Control And Local Perception Tools

Status: planning spec for Wave 17.

Primary dependencies:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md
docs/DIRECT_WAVE15_RESIDENT_SUB_AGENT_MVP_SPEC.md
docs/DIRECT_WAVE16_SUB_AGENT_LIFECYCLE_FOLLOWUP_TRANSCRIPT_SPEC.md
src/main/direct/tools/control-perception-decision-substrate.js
src/main/direct/headless/first-tool-slice.js
src/main/direct/bridge/tool-capability-registry.js
```

## Purpose

Wave 17 promotes the lower-side-effect human/control/local-perception tool
family into resident-visible direct capabilities.

The goal is not "add UI buttons" or "copy vanilla tool names." The goal is to
give the resident model lawful self-knowledge and bounded human/control
interfaces:

```text
resident self-knowledge:
  get_context_remaining

control-plane projection:
  update_plan

bounded human decision bridge:
  request_user_input

operator-gated authority widening:
  request_permissions

local perception projection:
  view_image

explicitly blocked context-world mutation:
  new_context
```

These tools are lower-side-effect, not harmless. They are safer than shell,
patch, sub-agent, MCP, plugin, or provider-hosted execution, but they still
govern information and authority. They affect what the resident model knows,
what the operator sees, what future context may include, what plan state means,
and when authority can widen.

## Core Doctrine

Human/control tools are not one authority class.

```text
get_context_remaining = read-only context-budget witness
update_plan = plan projection mutation, not WorkThread truth
request_user_input = bounded human decision packet
request_permissions = authority-widening request
view_image = local image metadata/projection, not resident pixel vision
new_context = context-world transition, blocked until compaction law exists
```

Global invariant:

```text
resident-visible != resident-callable
resident-callable != authority widening
human reply != approval
plan update != objective truth
image preview != model saw pixels
context witness != permission to compact
```

Wave 17 must consume the shared ODEU live-capability kernel:

```text
capability row
  -> promotion decision
  -> activation row
  -> declaration snapshot
  -> per-call authority decision
  -> transaction / result envelope
  -> context admission record
  -> resident/operator witness
  -> usability proof
```

## First Usable Slice

Wave 17 first usable slice:

```text
1. Resident can call get_context_remaining and receive a context witness.
2. Resident can call update_plan and mutate a plan projection/store only.
3. Resident can call bounded request_user_input and receive bounded-choice
   response evidence.
4. Resident can create a permission request, but broad or ambiguous authority
   widening is operator-gated or deterministically blocked.
5. Resident/operator can view image metadata/projection for contained image
   paths; the resident model does not receive image pixels in Wave 17.
6. new_context is visible as blocked/deferred, not declared as live.
```

## Standing Non-Goals

Wave 17 does not implement:

```text
provider-visible image payload submission
providerVisibilityState=image_payload_sent
free-form user text as approval
broad permission widening
session/project-scoped authority widening by default
provider or local compaction/new-context execution
browser/MCP/plugin/provider-hosted external tools
workspace mutation
sub-agent recursive control
UI redesign beyond status/proof projection
```

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| HumanControlCapabilityProfile | support artifact | build | Maps vanilla names to ODEU tool families, lifecycle state, promotion state, declaration eligibility |
| ContextRemainingWitness | evidence artifact | build/align | Context-budget self-knowledge; never permission to compact or continue |
| PlanProjectionMutationEnvelope | authority artifact | build | Scoped plan projection/store mutation; not WorkThread truth or task completion proof |
| HumanDecisionPacket | authority/evidence artifact | build | Bounded non-authoritative operator choice request |
| HumanDecisionResultEnvelope | evidence artifact | build | Answer/expiry/cancel/supersession result; free text remains context-only |
| PermissionWideningRequest | authority artifact | build | Explicit authority-widening request with scope, duration, target, and blocker law |
| PermissionWideningDecision | authority artifact | build | Separate operator/harness/policy decision; request itself grants nothing |
| ImageViewStagingEnvelope | perception artifact | build/align | Contained image path/type metadata, optional operator preview, no resident pixel vision |
| NewContextBlockedProjection | support artifact | build | Resident-visible blocked status for context-world transition |
| HumanControlResidentDeclaration | support artifact | build | Frozen resident-visible declaration snapshot for promoted tools |
| HumanControlResultEnvelope | evidence artifact | build | Tool result envelope and context-admission row for each call |
| HumanControlUsabilityProof | proof artifact | build | Positive/negative headless scenarios and resident/operator witness rows |

Existing substrate alignment:

```text
src/main/direct/tools/control-perception-decision-substrate.js
  already defines:
    direct_context_remaining_witness@1
    direct_plan_artifact@1
    direct_view_image_projection@1
    direct_human_decision_tool_packet@1
    direct_new_context_blocked_projection@1
```

Wave 17 should either reuse those schema names or introduce versioned successor
schemas only when the existing substrate is semantically insufficient.

## Tool Semantics

### get_context_remaining

Classification:

```text
ODEU family: session/control state, read-only self-knowledge
side effect: none
authority: read-only witness
resident-callable in first slice: yes
context admission: summary witness only
```

Rules:

```text
- The witness may report provider-reported, local-tokenizer estimate,
  budget-policy estimate, or unknown.
- Unknown is valid evidence; it must not be coerced to zero.
- The witness does not authorize compaction, new_context, longer run,
  permission widening, or goal completion.
- If confidence is derived, the resident must see that it is derived.
- Renderer and resident context receive sanitized numbers/status only.
- Wave 17 get_context_remaining cannot block or authorize any request by itself.
- `request_blocking` belongs to the context-maintenance/request-budget
  controller, not this resident-callable witness tool.
- Freshness must be visible; stale budget evidence must not look current.
```

Required fields:

```ts
type ContextRemainingWitness = {
  schema: "direct_context_remaining_witness@1";
  witnessId: string;
  projectId: string;
  workThreadId?: string;
  threadId: string;
  turnId?: string;
  model?: string;
  contextWindow?: number;
  usedTokens?: number;
  remainingTokens?: number;
  pressurePercent?: number;
  estimateKind:
    | "provider_reported"
    | "local_tokenizer_estimate"
    | "budget_policy_estimate"
    | "unknown";
  confidence: "exact" | "derived" | "estimated" | "unknown";
  usableFor:
    | "display_only"
    | "context_maintenance_diagnostic";
  observedAt: string;
  estimateSourceDigest?: string;
  staleAfterMs?: number;
  freshness: "fresh" | "stale" | "unknown";
  providerTruth: boolean;
  permissionToContinue: false;
  compactionAuthority: false;
  providerCompactionAuthority: false;
  evidenceRefs: EvidenceRef[];
};
```

### update_plan

Classification:

```text
ODEU family: control-state projection
side effect: local plan projection/store mutation
authority: plan-store scoped, not workspace/project truth
resident-callable in first slice: yes, if scoped
context admission: plan evidence only
```

Rules:

```text
- update_plan mutates only the plan projection/store for the active direct
  thread/work-thread scope.
- Wave 17 resident-callable update_plan mutates only the resident model's
  assistant working plan projection.
- Plan ownership and authority class must be explicit.
- It must not mutate WorkThread objective, task completion state, project
  truth, workflow pointer, user goal status, or tool approval state.
- A plan row cannot prove implementation correctness or goal completion.
- Human instruction wins over plan state.
- Stale plan updates are blocked by projection generation or plan digest.
- Plan updates must be idempotent by planId/updateId.
- The resident cannot silently overwrite or remove operator-created plan items.
- The resident cannot close obligations or mark a user objective / WorkThread
  complete.
- Step completion must be visibly plan-level, for example
  `completed_in_plan`, not world-truth completion.
```

Required envelope:

```ts
type PlanProjectionMutationEnvelope = {
  schema: "plan_projection_mutation_envelope@1";
  envelopeId: string;
  planId: string;
  updateId: string;
  workThreadId: string;
  threadId: string;
  actorKind: "resident_model" | "operator" | "harness_controller";
  planOwner:
    | "resident_model"
    | "operator"
    | "harness"
    | "imported";
  planAuthority:
    | "assistant_working_plan"
    | "operator_plan"
    | "project_plan"
    | "diagnostic_projection";
  sourceTurnId?: string;
  beforePlanDigest?: string;
  afterPlanDigest: string;
  stepStatus?:
    | "pending"
    | "in_progress"
    | "completed_in_plan"
    | "blocked"
    | "deferred";
  mutationKind:
    | "replace_plan"
    | "append_steps"
    | "update_step_status"
    | "clear_plan"
    | "blocked";
  authorityDecisionRef: EvidenceRef;
  mutatesWorkThreadTruth: false;
  mutatesProjectTruth: false;
  mutatesOperatorPlan: false;
  closesObligations: false;
  marksWorkThreadComplete: false;
  approvesTools: false;
  provesCompletion: false;
  evidenceRefs: EvidenceRef[];
};
```

### request_user_input

Classification:

```text
ODEU family: human decision bridge
side effect: pending human decision packet; later response evidence
authority: bounded by declared choices
resident-callable in first slice: yes, bounded-choice only
context admission: question/answer summary only
```

Rules:

```text
- The resident may ask one to three short questions per packet.
- Choices must be bounded and mutually exclusive where possible.
- By default, only one pending resident-created HumanDecisionPacket may be
  active per parent turn/work-thread unless a route explicitly allows more.
- Wave 17 request_user_input choices are non-authoritative:
  `carriesAuthority=false` and `authorityScope=none`.
- Free-form text is context only in Wave 17.
- Free-form text cannot approve tools, widen permissions, or mutate objective
  state by default.
- Expiration/cancellation must produce explicit result evidence.
- A stale human response must be rejected or attached as ordinary context,
  not applied to a superseded decision packet.
```

Required packet:

```ts
type HumanDecisionPacket = {
  schema: "direct_human_decision_tool_packet@1";
  decisionPacketId: string;
  workThreadId: string;
  threadId: string;
  turnId?: string;
  toolKind: "request_user_input";
  status:
    | "pending"
    | "answered"
    | "expired"
    | "cancelled"
    | "superseded"
    | "stale_reply_rejected";
  pendingPolicy:
    | "single_pending_per_turn"
    | "single_pending_per_work_thread"
    | "multiple_allowed";
  supersedesPacketId?: string;
  promptPreview: string;
  choices: Array<{
    choiceId: string;
    label: string;
    carriesAuthority: false;
    authorityScope: "none";
  }>;
  boundedChoiceCount: number;
  freeTextAllowed: boolean;
  freeTextPolicy: "context_only";
  freeTextCanWidenAuthority: false;
  mayApproveToolAction: false;
  mayMutateWorkspace: false;
  mayStartProviderTurn: false;
  expiresAt?: string;
  rawTextIncluded: false;
};

type HumanDecisionResultEnvelope = {
  schema: "human_decision_result_envelope@1";
  decisionPacketId: string;
  selectedChoiceIds: string[];
  freeTextPresent: boolean;
  freeTextAdmittedAs: "context_only" | "not_admitted";
  authorityGranted: false;
  mayStartProviderTurn: false;
  resultState:
    | "answered"
    | "expired"
    | "cancelled"
    | "superseded"
    | "stale_reply_rejected";
  evidenceRefs: EvidenceRef[];
};
```

### request_permissions

Classification:

```text
ODEU family: authority widening
side effect: authority request packet, not permission grant
authority: operator-gated
resident-callable in first slice: request creation only; decision is operator-gated
context admission: status witness only
```

Rules:

```text
- The request itself never widens authority.
- The request and decision are separate artifacts.
- A single-action request must name both target capability and proposed call id.
- Any approval must cite target, scope, duration, and affected capability.
- Default scope is single_action or blocked.
- Session/project/global widening is blocked in first slice.
- Broad phrases like "full access", "all files", "network", or "continue
  freely" are not accepted as direct authority.
- A human free-text response cannot be interpreted as permission unless it is
  routed through an explicit operator confirmation flow.
- Broad phrases and categories are blocked deterministically, including:
  all files, full access, network, unrestricted, continue freely, all tools,
  always allow, project-wide, and session-wide.
```

Required packet:

```ts
type PermissionWideningRequest = {
  schema: "permission_widening_request@1";
  requestId: string;
  workThreadId: string;
  threadId: string;
  targetCapabilityId: string;
  proposedCallId: string;
  requestedAuthorityFamily:
    | "workspace_process"
    | "workspace_mutation"
    | "external_tool"
    | "agent_runtime"
    | "provider_hosted"
    | "context_world";
  requestedScope:
    | "single_action"
    | "single_turn"
    | "route"
    | "session"
    | "project";
  requestedDuration?: string;
  status:
    | "requested"
    | "operator_confirm_required"
    | "blocked"
    | "declined"
    | "expired";
  broadWideningBlocked: boolean;
  grantsAuthorityByItself: false;
  evidenceRefs: EvidenceRef[];
};

type PermissionWideningDecision = {
  schema: "permission_widening_decision@1";
  decisionId: string;
  requestId: string;
  decidedBy: "operator" | "policy" | "harness";
  decision:
    | "approved_single_action"
    | "declined"
    | "blocked"
    | "expired";
  grantedCapabilityId?: string;
  grantedScope?: "single_action";
  expiresAt?: string;
  evidenceRefs: EvidenceRef[];
};
```

### view_image

Classification:

```text
ODEU family: local perception
side effect: local staged/projection artifact
authority: path-contained metadata/projection first
resident-callable in first slice: metadata/projection only when path/type gates pass
context admission: image metadata/ref only
```

Rules:

```text
- Path must be contained in the active workspace or approved staging root.
- MIME/type must be sniffed; extension is not authority.
- SVG is active-risk and must not be rendered inline.
- Decoded pixel caps and byte caps must apply.
- Renderer preview is not proof that model saw pixels.
- Model image payload submission remains disabled in Wave 17.
- The resident result must explicitly say that the model did not receive image
  pixels.
- The resident must not answer visual-content questions from this tool unless
  image payload proof exists in a later wave.
- `providerVisibilityState=image_payload_sent` is impossible in Wave 17.
- EXIF/raw bytes/absolute host paths must not enter resident context.
```

Required envelope:

```ts
type ImageViewStagingEnvelope = {
  schema: "image_view_staging_envelope@1";
  envelopeId: string;
  workThreadId: string;
  threadId: string;
  pathEvidenceKey: string;
  displayName: string;
  displayPath: string;
  mimeType: string;
  sniffedMime: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  pathContained: boolean;
  decodeCapsApplied: boolean;
  rendererPreviewAvailable: boolean;
  residentPerceptionLevel:
    | "metadata_only"
    | "operator_preview_only"
    | "unsupported";
  residentResultText: string;
  providerVisibilityState:
    | "not_seen"
    | "metadata_only"
    | "unsupported";
  providerUseProven: false;
  modelSawPixels: false;
  rawPathIncluded: false;
  rawImageBytesIncluded: false;
  evidenceRefs: EvidenceRef[];
};
```

### new_context

Classification:

```text
ODEU family: context-world transition
side effect: potentially large cognitive-state reset
authority: blocked/deferred in Wave 17
resident-callable in first slice: no
context admission: blocked projection only
```

Rules:

```text
- new_context is not equivalent to clear chat or compact.
- It requires Wave 20 context transition law.
- Wave 17 may expose a blocked/deferred projection so the resident knows why it
  is unavailable.
- No provider compaction/new-context call is made in Wave 17.
- new_context may appear in the resident epistemic catalog as `known_disabled`.
- new_context must not appear in provider tool declarations in Wave 17.
- Any provider-emitted new_context call is `blocked_undeclared_tool_call`.
- Blocked reason must cite Wave 20 dependencies: context transition law,
  omission ledger, frontier baton preservation, and open-obligation
  preservation.
```

## Resident Declaration Law

Resident-visible declarations must distinguish:

```text
available:
  get_context_remaining
  update_plan
  request_user_input

visible but guarded/blocked:
  request_permissions
  view_image
  new_context

known_disabled:
  new_context

not declared:
  provider image payload
  compaction/new_context execution
  broad permission widening
```

Declaration snapshot rules:

```text
- Freeze declaration digest per request.
- Provider tool declaration must match activation rows exactly.
- Unsupported tools must not be provider-declared.
- new_context must not be provider-declared in Wave 17.
- Blocked tools may be represented in resident epistemic catalog as unavailable
  with reasons, but not as callable provider tools.
- Any resident-callable tool must have a result envelope and context admission
  policy before declaration.
```

## Context Admission Law

Context admission is conservative:

```text
get_context_remaining -> compact status witness only
update_plan -> plan evidence only
request_user_input -> question/answer summary only
request_permissions -> request/decision status only
view_image -> metadata/ref only
new_context -> blocked projection only
```

Forbidden admissions:

```text
raw user free text as authority
raw image bytes
absolute host paths
provider auth/account secrets
full pending decision UI state
permission approval without authority decision
plan state as completion proof
```

## Headless Scenario Requirements

Wave 17 must be testable without opening the frontend.

Positive scenarios:

```text
resident asks get_context_remaining -> receives witness
resident update_plan -> plan projection mutation envelope recorded
resident request_user_input bounded choices -> pending packet + answer ledger
resident request_permissions single-action -> operator-confirm-required packet
resident view_image contained PNG -> metadata projection only
resident asks about unavailable new_context -> blocked projection returned
```

Negative scenarios:

```text
missing context estimate -> unknown witness, not zero
stale plan digest -> update blocked
update_plan completion claim -> no WorkThread completion
free-form human text -> context_only, no authority
broad permission request -> blocked
session/project permission request -> blocked in first slice
unsafe image path traversal -> blocked
SVG inline render -> blocked/degraded
provider image payload without support -> blocked
provider emits image payload request path -> blocked unsupported
new_context execution -> blocked
provider emits new_context -> undeclared/blocked
declaration mismatch -> provider request blocked
get_context_remaining unknown -> not zero
```

Failure classes that must be represented in the scenario suite:

```text
context-budget inflation:
  context estimate treated as permission to continue/compact

plan-truth inflation:
  resident plan update treated as user objective, obligation closure, or
  completion proof

human-reply authority inflation:
  free-text answer treated as approval

permission-request collapse:
  request_permissions call treated as grant

image-perception laundering:
  renderer preview or metadata treated as model pixel vision

new-context smuggling:
  blocked new_context represented as callable tool

renderer authority leak:
  UI decision packet state treated as completed operator approval
```

## PR Sequence

### PR 103: Human/control capability profile

Branch:

```text
codex/direct-human-control-capability-profile
```

Deliverables:

```text
HumanControlCapabilityProfile
promotion rows for get_context_remaining/update_plan/request_user_input
blocked/guarded rows for request_permissions/view_image/new_context
new_context status = known_disabled and not provider-declared
view_image status = guarded_metadata_only
request_permissions status = guarded_request_only
activation rows using ODEU capability lifecycle kernel
resident epistemic rows with unavailable reasons
regression coverage for declaration eligibility
```

Non-goals:

```text
no resident-callable provider declarations
no local image payload handling
no permission grant execution
```

### PR 104: Context remaining and plan projection tools

Branch:

```text
codex/direct-context-plan-control-tools
```

Deliverables:

```text
resident-callable get_context_remaining declaration
ContextRemainingWitness result envelope and context admission
ContextRemainingWitness freshness/staleness
usableFor excludes request_blocking
resident-callable update_plan declaration
PlanProjectionMutationEnvelope and local plan projection/store
planOwner/planAuthority fields
operator-plan overwrite blockers
stale generation/digest blocking
headless scenarios for context witness and plan mutation
```

Non-goals:

```text
no WorkThread truth mutation
no goal completion proof
no compaction/new_context authority
```

### PR 105: Bounded human decision bridge

Branch:

```text
codex/direct-bounded-human-decision-tool
```

Deliverables:

```text
resident-callable request_user_input declaration
HumanDecisionPacket
pending/answered/expired/cancelled decision ledger
single pending packet per turn/work-thread default
bounded choice result envelope
authorityGranted=false result envelope
freeTextPolicy=context_only witness
headless human-response fixture runner
```

Non-goals:

```text
no free-form approval semantics
no permission widening through free text
no provider turn auto-start from user reply
```

### PR 106: Permission widening request gate

Branch:

```text
codex/direct-permission-widening-request-gate
```

Deliverables:

```text
request_permissions capability row and blocked/guarded declaration posture
PermissionWideningRequest
PermissionWideningDecision
single-action request packet
single-action requests name target capability and proposed call id
broad/session/project scope blockers
operator-confirm-required witness
deterministic blocked-result envelope for resident
```

Non-goals:

```text
no broad authority widening
no default full-access grant
no network/external/tool authority expansion
```

### PR 107: Image view metadata/projection tool

Branch:

```text
codex/direct-image-view-projection-tool
```

Deliverables:

```text
view_image guarded capability row
ImageViewStagingEnvelope
path containment and type-sniff policy
decoded byte/pixel caps
renderer-safe metadata projection
providerVisibilityState metadata_only/unsupported
residentPerceptionLevel metadata_only/operator_preview_only/unsupported
modelSawPixels=false
negative tests for SVG, traversal, oversize, unsupported payload
```

Non-goals:

```text
no provider image payload submission
no model pixel-vision claim
no raw image bytes or absolute paths in resident context
```

### PR 108: Wave 17 usability proof and declaration gate

Branch:

```text
codex/direct-human-control-wave17-usability-gate
```

Deliverables:

```text
HumanControlUsabilityProof
resident/operator witness rows
manual usability gate rows
headless scenario suite
negative scenario matrix
information registry row
deterministic negative tests for unknown context, plan completion claims,
free-text authority, broad permission, unsupported image payload, and
undeclared new_context
roadmap/audit update marking Wave 17 complete when gates pass
```

Non-goals:

```text
no Wave 18 external discovery/MCP tools
no Wave 19 provider-hosted tools
no Wave 20 new_context/compaction execution
```

## Acceptance Criteria

General:

```text
- Every promoted tool cites ODEU capability lifecycle rows.
- Every provider-declared resident tool has a frozen declaration digest.
- Every call emits per-call authority decision and result envelope.
- Every context admission record states exactly what enters model context.
- Missing evidence is represented as unavailable/unknown, never inferred.
- Unsupported tools are visible as unavailable with reasons, not silently absent.
- Resident-visible, resident-callable, and provider-declared are separate
  states.
```

Specific:

```text
- get_context_remaining returns unknown safely when no usage estimate exists.
- get_context_remaining cannot use `request_blocking` in Wave 17.
- update_plan has planOwner and planAuthority and cannot mutate
  operator/project/WorkThread truth.
- request_user_input choices are non-authoritative in Wave 17;
  authorityGranted=false in result envelope.
- Only one resident-created human decision packet may be pending per turn by
  default.
- request_permissions creates a request only; a separate
  PermissionWideningDecision is required for any grant.
- single_action permission requests must name target capability and proposed
  call id.
- request_permissions broad/session/project scope is blocked in first slice.
- view_image result says modelSawPixels=false unless provider image payload
  evidence exists in a later wave.
- providerVisibilityState=image_payload_sent is impossible in Wave 17.
- new_context is resident-visible as known_disabled but never provider-declared.
- Raw paths, image bytes, secrets, and full free-form human text are excluded
  from resident context by default.
- Headless tests cover all positive and negative scenarios listed above.
```

## Completion Gate

Wave 17 is complete when:

```text
The resident can lawfully inspect context pressure, update a scoped plan
projection, ask bounded human questions, request authority through a guarded
permission packet, and inspect image metadata/projections, while all broad
authority widening, image payload submission, and context-world transition
execution remain blocked until later waves.
```
