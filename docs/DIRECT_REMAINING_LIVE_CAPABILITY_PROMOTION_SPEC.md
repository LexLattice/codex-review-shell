# Direct Remaining Live Capability Promotion Spec

Status: planning tracker for post-PR86 direct-harness live capability promotion.

Primary branch:

```text
codex/direct-chatgpt-harness
```

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md
docs/CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md
```

## Purpose

This document tracks the remaining direct-path tools and feature families that
are not yet promoted to actual live capabilities.

The goal is not broad feature enthusiasm. The goal is to keep every future
promotion tied to the same ODEU law:

```text
visible capability != callable tool
callable tool != provider declaration
provider declaration != local execution authority
local execution != context admission
context admission != project truth
```

Each row below should eventually become one or more PRs in
`docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md`.

## Current Baseline After PR86

Implemented and merged:

```text
direct live text
direct implementation lane read / patch / command loops
stateful exec session substrate
local live sub-agent graph/mailbox/lifecycle surface
provider-backed sub-agent route
headless provider-backed sub-agent command
resident epistemic catalog/status surfaces
tool capability registry
headless bridge daemon and affordance command surface
```

Still intentionally not done:

```text
provider-declared resident-callable sub-agent tools
recursive child tools
provider-hosted web/image tools
MCP dynamic resource/action tools
plugin installation authority
code-mode kernel execution
batch agent orchestration
provider/native context reset or compaction
account quota reset mutation
bridge module execution
```

## Promotion Doctrine

Every promotion must declare:

```text
authority family
exact request shape
provider declaration posture
local executor posture
operator approval posture
side-effect class
replay/idempotency law
recovery law
usage attribution
context admission law
renderer projection law
raw-exposure boundary
fixture proof
live proof, if live provider behavior is claimed
```

Every promotion family must also declare a minimal vertical slice. The tracker
must not only name prerequisites; it must say what becomes actually usable.

Required fields:

```text
First usable slice:
  exact capability that becomes usable
  who can use it: operator, resident, provider-declared model tool, headless
  activation row emitted
  declaration or governed transition used
  authority gate applied
  executor/runtime path
  result envelope
  context/transcript admission
  recovery/replay evidence

Still diagnostic:
  capabilities visible as status only after the first slice

Still blocked/operator-gated:
  capabilities that must not become resident-callable in the first slice
```

Live proof chain:

```text
resident-visible / operator-visible status
  -> activation row
  -> provider declaration or governed harness transition
  -> model/operator call
  -> authority gate
  -> executor / runtime action
  -> result envelope
  -> context admission / transcript projection
  -> recovery / replay / usage evidence
```

Promotion classes:

```text
diagnostic_only
fixture_only
headless_operator_command
resident_visible_but_not_callable
resident_visible_operator_action_required
resident_requestable_operator_gated
resident_callable_restricted
resident_callable_live_provider_declared
operator_ui_live
```

Rules:

- A capability can be operator-live before it is resident-callable.
- A capability can be resident-visible before it is resident-callable.
- A capability can be resident-callable locally without being provider-declared
  only if the resident reaches it through a governed harness transition.
- A provider-declared tool requires exact request-shape evidence and negative
  raw-exposure tests.
- Authority-sensitive actions must remain per-action or narrower until a later
  project/session policy explicitly widens them.
- Every live capability must emit a `CapabilityUsabilityProof`.
- Every provider-declared resident-callable tool must cite a
  `ToolDeclarationSnapshot`, `ToolDeclarationDigest`, and
  `ProviderRequestShapeProof`.
- Every concrete call must emit a `PerCallAuthorityDecision`.
- Every result admitted to context must emit a
  `ToolResultContextAdmissionRecord`.
- Every operator-live or resident-callable capability must cite a frozen
  activation row for the request/action that used it.

## Promotion Families

### 1. Provider-Backed Sub-Agents

Current state:

```text
local live graph/mailbox/lifecycle: implemented
headless provider-backed child execution: implemented
resident-callable provider-backed spawn: not implemented
child transcript projection: partial/inherited, not direct-native final
recursive child tools: disabled
close/resume/interrupt: mostly unsupported or diagnostic
```

Target live capability:

```text
Resident agent can spawn a bounded child agent through a direct tool call,
observe its E-channel progress, wait within no-deadlock limits, and consume a
sanitized child result without flattening the child conversation into the
primary transcript.
```

First usable slice:

```text
resident-callable spawn_agent
resident-callable list_agents / inspect_agent
bounded wait_agent
sanitized child result admission
child usage attribution
activity summary in primary transcript
no child tools
no recursive spawn
no send/followup/interrupt yet
```

Still diagnostic after first slice:

```text
child transcript full-history projection
legacy compatibility names
child tool inheritance posture
interference/no-interference policy visualization
```

Still blocked/operator-gated:

```text
recursive child spawning
child inherited parent tools
send_message / followup_task
close / resume / interrupt
child output flattening into primary transcript
```

Required artifacts:

```text
ResidentSubAgentToolDeclaration
ProviderBackedSubAgentToolAdapter
SubAgentToolIdempotencyLedger
SubAgentResultAdmissionEnvelope
SubAgentTranscriptProjection
SubAgentWaitNoDeadlockPolicy
SubAgentUsageAttributionRow
SubAgentNoInterferencePolicyWitness
```

Promotion PR candidates:

1. Resident-callable sub-agent MVP:
   `spawn_agent`, `list_agents`, `inspect_agent`, bounded `wait_agent`, result
   admission, usage attribution.
2. Child transcript projection maturity and full-history/turn-history views.
3. `send_message` / `followup_task` only after interference policy is explicit.
4. Close/resume/interrupt after lifecycle authority is mapped.

Hard blockers:

```text
No child output promotion into primary transcript by default.
No recursive spawn until child tool inheritance law exists.
No wait without timeout and cancellation semantics.
No interference action when parent self-bound to observe-only/no-interference.
No provider declaration without stable idempotency and duplicate suppression.
```

Acceptance checks:

```text
- Retried spawn with same idempotency key cannot create duplicate child turns.
- Missing child id or unstable target blocks before provider transport.
- Paused/draining daemon blocks before child provider transport.
- Child token usage is attributed to the child agent thread.
- Main transcript shows activity summaries, not child chat flattening.
- E-channel inspection remains read-only.
```

### 2. Sub-Agent Lifecycle And Compatibility Controls

Current state:

```text
new direct sub-agent surface: restricted
legacy multi-agent v1 tools: unsupported compatibility rows
interrupt_agent: diagnostic-only
close/resume: unsupported/deferred
```

Target live capability:

```text
Sub-agent lifecycle controls are coherent across direct-native and legacy
vanilla-compatible names, without making legacy names the governing ontology.
```

First usable slice:

```text
read-only lifecycle status for all known agents
direct-native status rows remain source truth
legacy compatibility names map to direct-native status rows
operator-visible terminal/blocked/stale states
```

Still diagnostic after first slice:

```text
legacy v1 action aliases
resume viability
interruption compatibility with provider-backed children
```

Still blocked/operator-gated:

```text
close_agent
interrupt_agent
resume_agent
compatibility actions that would mutate a child lifecycle
```

Required artifacts:

```text
AgentLifecycleAuthorityMatrix
AgentLifecycleTransitionLedger
AgentCompatibilityNameMapper
AgentCancellationWitness
```

Promotion PR candidates:

1. Compatibility mapping from legacy v1 names to direct-native rows.
2. Read-only lifecycle status for all known agents.
3. Close/interrupt as operator-controlled action after terminal-state witness.
4. Resume only if provider/runtime can actually resume the child thread.

Hard blockers:

```text
No legacy v1 name can bypass direct-native authority gates.
No close/interrupt without terminal-state witness.
No resume without stable thread/session identity.
No resident-callable lifecycle mutation in the first compatibility slice.
```

### 3. Provider-Hosted Tools

Current rows:

```text
vanilla.hosted.web_search: diagnostic_only
vanilla.hosted.image_generation: diagnostic_only
```

Target live capability:

```text
Provider-hosted tools can be declared to the model when account/model/runtime
evidence says they are available, and their results enter the transcript/context
through sanitized result envelopes.
```

Split authority classes:

```text
web_search = external epistemic evidence
image_generation = generated artifact creation
```

First usable slice for web search:

```text
resident-callable web_search
query envelope with source/provenance policy
bounded result summary admitted to context
citations/source refs preserved
staleness and quote/summary limits declared
no raw provider payload
```

First usable slice for image generation:

```text
operator-live or resident-callable restricted image_generation
prompt evidence recorded
generated artifact stored/staged
artifact projection shown to operator
no automatic workspace insertion
no raw provider payload
```

Still diagnostic after first slice:

```text
unsupported account/model/provider-hosted tool posture
image generation content/result policy details
provider-hosted usage attribution differences
```

Still blocked/operator-gated:

```text
image generation with persistent workspace insertion
unbounded web result context admission
provider-hosted declaration from static labels only
```

Required artifacts:

```text
ProviderHostedToolCapabilityProbe
ProviderHostedToolDeclarationPolicy
ProviderHostedWebSearchResultEnvelope
ProviderHostedImageGenerationResultEnvelope
ProviderHostedUsageAttribution
ProviderHostedRawExposureScanner
```

Promotion PR candidates:

1. Live-readonly capability probe for hosted web search/image generation.
2. Fixture request-shape validation.
3. Provider-hosted web search live slice.
4. Provider-hosted image generation live slice.

Hard blockers:

```text
No hosted tool declaration from static labels.
No raw provider payload in renderer state.
No result context admission without source/provenance envelope.
No image binary exposure without staging/retention policy.
```

### 4. External Discovery, MCP, And Plugin Authority

Current rows:

```text
tool_search: diagnostic_only
list_mcp_resources: diagnostic_only
list_mcp_resource_templates: diagnostic_only
read_mcp_resource: deferred_external_authority
mcp_dynamic_tool: deferred_external_authority
list_available_plugins_to_install: diagnostic_only
request_plugin_install: deferred_external_authority
```

Target live capability:

```text
External discovery is available as evidence. External reads/actions are
available only through connector/plugin identity, schema, trust, and authority
gates.
```

Split authority classes:

```text
external discovery = evidence about available tools/resources
MCP resource read = external perception
MCP dynamic tool call = external action
plugin install = future tool-surface mutation
```

First usable slice:

```text
resident-callable or headless-callable discovery:
  tool_search
  list_mcp_resources
  list_mcp_resource_templates
read-only MCP resource fetch only after server identity and result caps
no dynamic MCP actions
no plugin install
```

Still diagnostic after first slice:

```text
dynamic MCP action schemas
plugin install candidates
connector mutation affordances
```

Still blocked/operator-gated:

```text
MCP dynamic mutating actions
plugin installation
connector account/resource mutation
```

Required artifacts:

```text
ExternalCapabilityRegistry
McpServerIdentityWitness
McpResourceReadEnvelope
DynamicToolAuthorityEnvelope
PluginInstallAuthorityPacket
ExternalResultContextAdmissionPolicy
```

Promotion PR candidates:

1. Discovery-only live tools for `tool_search` and MCP list operations.
2. Read-only MCP resource fetch with server identity and result caps.
3. Dynamic MCP tool call envelope with per-tool permission class.
4. Plugin install marketplace/action gate as a later operator-only wave.

Hard blockers:

```text
No plugin install without explicit operator confirmation.
No dynamic external action without server identity and schema witness.
No MCP result enters context without source and truncation policy.
No external secret/cookie/provider auth leakage to renderer state.
No plugin install promoted as resident-callable by default.
```

### 5. Human Decision And Control Tools

Current rows:

```text
request_user_input: diagnostic_only
request_permissions: diagnostic_only
update_plan: diagnostic_only
get_context_remaining: diagnostic_only
view_image: diagnostic_only
```

Target live capability:

```text
Resident agents can ask bounded questions, request scoped authority, update
planning state, inspect context budget, and view local images through explicit
human/control transition envelopes.
```

Split authority classes:

```text
self-knowledge/read-only controls:
  get_context_remaining
  update_plan as plan projection/store, not WorkThread truth
  request_user_input bounded-choice packet

authority widening / provider-visible payloads:
  request_permissions
  view_image with provider-visible image payload
```

First usable slice:

```text
resident-callable get_context_remaining
resident-callable update_plan scoped to plan projection/store
resident-callable bounded request_user_input
view_image metadata/projection only if path/type gates are satisfied
```

Still diagnostic after first slice:

```text
provider-visible image payload support
permission widening templates
free-form user-input authority interpretations
```

Still blocked/operator-gated:

```text
request_permissions beyond single-action scope
image payload submission to provider without exact provider support
free-form user reply treated as approval by default
```

Required artifacts:

```text
HumanDecisionPacket
PermissionWideningRequest
PlanProjectionMutationEnvelope
ContextRemainingWitness
ImageViewStagingEnvelope
```

Promotion PR candidates:

1. `get_context_remaining` as read-only resident-visible context witness.
2. `update_plan` as renderer/control-plane state, not project truth.
3. `request_user_input` bounded-choice packet.
4. `request_permissions` scoped authority widening packet.
5. `view_image` local file/image staging and display envelope.

Hard blockers:

```text
No permission widening without explicit scope and duration.
No free-form user input treated as approval by default.
No image view without path containment and type sniffing.
No plan update that mutates WorkThread truth unless routed through a plan store.
No resident-callable broad authority widening in the first live slice.
```

### 6. Code-Mode Structured Execution

Current rows:

```text
code_mode_execute: diagnostic_only
code_mode_wait: diagnostic_only
```

Target live capability:

```text
Structured code execution is available as a separate kernel/session lane, not
as shell-command parity.
```

First usable slice:

```text
operator-live restricted code execution
kernel/session identity and lifecycle witness
fixture or disposable sandbox
resource limits
bounded output envelope
wait with timeout
no hidden workspace mutation
```

Still diagnostic after first slice:

```text
resident-callable code-mode declaration
workspace-mounted code mode
long-running kernel recovery
```

Still blocked/operator-gated:

```text
resident-callable arbitrary code execution
workspace mutation from code mode
unbounded output/context admission
```

Required artifacts:

```text
CodeModeKernelSession
CodeModeExecutionEnvelope
CodeModeWaitPolicy
CodeModeResourceLimitPolicy
CodeModeOutputEnvelope
```

Promotion PR candidates:

1. Kernel/session identity and lifecycle witness.
2. Fixture code execution lane with output caps.
3. Operator-live restricted code execution with resource limits.
4. Wait/cancel/resume semantics.
5. Resident-callable restricted code mode only after operator-live semantics are stable.

Hard blockers:

```text
No arbitrary kernel execution without sandbox/resource policy.
No hidden workspace mutation.
No output admission without truncation/redaction.
No wait without timeout.
```

### 7. Batch Agent Orchestration

Current rows:

```text
spawn_agents_on_csv: diagnostic_only
report_agent_job_result: diagnostic_only
```

Target live capability:

```text
Batch fan-out/fan-in creates many bounded worker jobs with stable row identity,
usage attribution, progress visibility, and result admission.
```

First usable slice:

```text
CSV/schema intake
row identity ledger
fixture batch plan
operator confirmation
bounded provider-backed worker rows
low concurrency limit
partial-failure projection
usage rollup
```

Still diagnostic after first slice:

```text
resident-callable batch orchestration
large fan-out
automatic retry policy
cross-workthread batch routing
```

Still blocked/operator-gated:

```text
unbounded fan-out
resident-initiated high-concurrency batch
result promotion without admission policy
```

Required artifacts:

```text
BatchAgentJobLedger
BatchAgentRowIdentity
BatchAgentResultAdmissionPolicy
BatchAgentProgressProjection
BatchAgentUsageRollup
```

Promotion PR candidates:

1. CSV/schema intake and row identity ledger.
2. Fixture batch spawn without provider transport.
3. Operator-confirmed provider-backed row workers with concurrency limits.
4. Result aggregation and partial-failure projection.

Hard blockers:

```text
No unbounded fan-out.
No row result without row identity.
No result promotion without admission policy.
No batch wait without partial completion and timeout semantics.
```

### 8. Context, New-Context, And Compaction

Current rows:

```text
new_context: unsupported
provider compaction: planned, not live
local compaction: planned, not live
hybrid compaction: planned, not live
```

Target live capability:

```text
Context-world transitions are explicit, auditable operations that preserve
frontier obligations and record omissions.
```

First usable slice:

```text
context pressure witness
context transition preview
frontier baton freshness report
omission risk report
no actual context reset yet
```

Second usable slice:

```text
explicit fresh-context start with provenance
open obligations preserved or blocking
context transition request recorded
```

Later slices:

```text
local-pure compaction artifact with omission ledger
provider compact primitive probe
hybrid compaction reinjection policy
memory admission workflow
```

Still blocked/operator-gated:

```text
silent context reset
provider compaction without exact primitive evidence
summary treated as memory without memory admission
```

Required artifacts:

```text
ContextTransitionRequest
ContextMaintenanceRouteMatrix
FrontierBaton
ContextOmissionLedger
ProviderCompactionProfile
LocalCompactionArtifact
HybridCompactionReinjectionPolicy
```

Promotion PR candidates:

1. `get_context_remaining` and context-pressure witness first.
2. `new_context` as explicit fresh-context start with provenance.
3. Local-pure compaction artifact and omission ledger.
4. Provider compact primitive probe.
5. Hybrid provider/local compaction reinjection law.

Hard blockers:

```text
No silent context reset.
No compaction that drops open obligations without omission witness.
No provider compact call without exact primitive evidence.
No summary treated as memory unless admitted through memory workflow.
```

### 9. Account Mutation: Quota Reset Credits

Current state:

```text
researched from upstream 0.141; not implemented
```

Observed upstream capability:

```text
account/rateLimits/read exposes rateLimitResetCredits.availableCount
account/rateLimitResetCredit/consume consumes with { idempotencyKey }
outcomes: reset | nothingToReset | noCredit | alreadyRedeemed
```

Target live capability:

```text
Operator can explicitly spend a reset credit through a governed account-mutation
action after seeing current quota/reset evidence.
```

First usable slice:

```text
read-only reset-credit witness
resident-visible status: available / unavailable / stale / unknown
operator action required for consume
```

Still diagnostic after first slice:

```text
consume action request shape
outcome classification
before/after snapshot diff
```

Still blocked/operator-gated:

```text
resident-callable consume
automatic reset
consume without explicit operator confirmation
```

Required artifacts:

```text
QuotaResetCreditWitness
QuotaResetCreditConsumeRequest
QuotaResetCreditAuthorityPacket
QuotaResetBeforeAfterSnapshot
```

Promotion PR candidates:

1. Read-only reset-credit witness in runtime/usage surface.
2. Confirmation UX and idempotency packet.
3. Consume action and after-read verification.

Hard blockers:

```text
No automatic reset.
No API-key auth path unless upstream supports it.
No consume without before/after snapshots.
No consume without idempotency key and operator confirmation.
No resident-callable reset consume.
```

### 10. Bridge Module Runner And Skills/Hooks/Apps Execution

Current state:

```text
skills/hooks/apps are modeled as registry/gates/shadow rows
module execution is not live
auto-invocation is disabled
```

Target live capability:

```text
Bridge modules can execute only through explicit transition authority, declared
inputs/outputs, and no-auto-invocation law.
```

First usable slice:

```text
module runner V0
operator command only
explicit input manifest
explicit result envelope
no provider transport
no workspace mutation
no auto-invocation
```

Later slices:

```text
read-only module execution
hook proposal generation without execution
explicit hook execution after authority gate
connector mutation only with external authority packet
```

Still blocked/operator-gated:

```text
side-effecting module execution
hook execution
connector mutation
resident-callable module execution from metadata alone
```

Required artifacts:

```text
BridgeModuleExecutionRequest
BridgeModuleAuthorityEnvelope
BridgeModuleInputManifest
BridgeModuleResultEnvelope
HookExecutionGate
SkillContextAdmissionPolicy
```

Promotion PR candidates:

1. Module runner V0 with no provider transport and no workspace mutation.
2. Read-only module execution.
3. Hook proposal generation without execution.
4. Explicit hook execution after authority gate.

Hard blockers:

```text
No auto-invocation from loaded skill/hook/app metadata.
No module execution without input manifest.
No connector mutation without external authority packet.
No module result context admission without provenance envelope.
```

## Suggested Wave Order

Recommended next waves:

```text
Wave 15: Resident-callable sub-agent MVP
  spawn/list/inspect/wait/result admission; no child tools, no recursive spawn.

Wave 16: Sub-agent lifecycle, follow-up, compatibility, transcript maturity
  send/followup, close/interrupt/resume, legacy mapping, transcript projection.

Wave 17: Human/control/read-only resident tools
  get_context_remaining, update_plan, bounded request_user_input,
  maybe view_image metadata/projection.

Wave 18: External discovery + MCP resource read
  tool_search, list_mcp_resources, list_mcp_resource_templates,
  read_mcp_resource with server identity and caps.
  No dynamic actions/plugin install.

Wave 19: Provider-hosted tools
  19a web_search as external epistemic evidence.
  19b image_generation as generated artifact production.

Wave 20: Context transition and compaction
  pressure witness -> transition preview -> explicit new_context
  -> local compaction -> provider/hybrid compaction.

Wave 21: Code-mode structured execution
  operator-live first, resident-callable later.

Wave 22: Batch agent orchestration
  operator-confirmed bounded fan-out after sub-agent MVP stability.

Wave 23: Account quota reset credits
  read witness + operator-only consume.

Wave 24: Bridge module runner / hooks execution
  module runner no-side-effect first, hook execution much later.
```

Why this order:

```text
sub-agents are already closest to live after PR85/86
human/control/context read-only tools improve resident self-knowledge
external tools need authority hardening before action
provider-hosted tools need exact upstream capability evidence
compaction/context reset should wait until context witnesses are stable
code-mode and batch are higher blast-radius execution lanes
account reset is explicit account mutation and should stay separate
module execution should come after the authority substrate is mature
```

Operator-only or operator-gated by default:

```text
plugin installation
account quota reset consume
permission widening beyond single-action scope
MCP dynamic mutating external actions
bridge module execution with side effects
hook execution
recursive sub-agent spawning
sub-agent interrupt/close/resume
code-mode with workspace mutation
batch fan-out above low concurrency
provider-hosted image generation when it creates persistent artifacts or cost
```

Global live-promotion acceptance additions:

```text
- Every family declares a First Usable Slice.
- Every family declares what remains diagnostic after the first usable slice.
- Every live capability has a CapabilityUsabilityProof.
- Every resident-callable provider-declared tool cites a ToolDeclarationSnapshot
  and ProviderRequestShapeProof.
- Every concrete tool call emits a PerCallAuthorityDecision.
- Every result admitted to model context emits a ToolResultContextAdmissionRecord.
- Every live capability declares whether it is operator-live, resident-visible,
  resident-requestable, resident-callable, or provider-declared.
- Every capability has a frozen activation row for the request or operator
  action that used it.
- Every family declares whether it is allowed to become resident-callable,
  operator-only, or permanently operator-gated.
- Every first usable slice has a headless and/or UI smoke proving actual
  usability, not only registry visibility.
```

## GPT Review Questions

Ask review specifically for:

```text
1. Are the first usable slices narrow enough to implement and trust?
2. Are any operator-gated families still too permissive?
3. Are the activation/declaration/per-call/result-admission proof artifacts
   sufficient before provider declaration?
4. Is Wave 15 correctly scoped as spawn/list/inspect/wait/result admission?
5. Should any family be permanently operator-only rather than merely deferred?
```
