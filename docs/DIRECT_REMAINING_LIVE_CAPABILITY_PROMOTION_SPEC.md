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

Promotion classes:

```text
diagnostic_only
fixture_only
headless_operator_command
resident_visible_but_not_callable
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

Required artifacts:

```text
ResidentSubAgentToolDeclaration
ProviderBackedSubAgentToolAdapter
SubAgentToolIdempotencyLedger
SubAgentTranscriptProjection
SubAgentWaitNoDeadlockPolicy
SubAgentUsageAttributionRow
SubAgentNoInterferencePolicyWitness
```

Promotion PR candidates:

1. Resident-callable `spawn_agent` provider-backed adapter.
2. Model-visible `list_agents` / `inspect_agent` E-channel tools.
3. Bounded `wait_agent` with timeout, stale-result, and no-deadlock law.
4. `send_message` / `followup_task` only after interference policy is explicit.
5. Close/resume/interrupt after lifecycle authority is mapped.

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
3. Close/interrupt as operator-controlled action.
4. Resume only if provider/runtime can actually resume the child thread.

Hard blockers:

```text
No legacy v1 name can bypass direct-native authority gates.
No close/interrupt without terminal-state witness.
No resume without stable thread/session identity.
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

Required artifacts:

```text
ProviderHostedToolCapabilityProbe
ProviderHostedToolDeclarationPolicy
ProviderHostedResultEnvelope
ProviderHostedUsageAttribution
ProviderHostedRawExposureScanner
```

Promotion PR candidates:

1. Live-readonly capability probe for hosted web search/image generation.
2. Fixture request-shape validation.
3. Web-search result projection and context admission.
4. Image-generation output/staging policy.

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
4. Plugin install marketplace/action gate.

Hard blockers:

```text
No plugin install without explicit operator confirmation.
No dynamic external action without server identity and schema witness.
No MCP result enters context without source and truncation policy.
No external secret/cookie/provider auth leakage to renderer state.
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
3. Live restricted code execution with resource limits.
4. Wait/cancel/resume semantics.

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
3. Provider-backed row workers with concurrency limits.
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
Wave 15: Resident-callable provider-backed sub-agent tools
Wave 16: Sub-agent lifecycle + transcript projection maturity
Wave 17: Human/control/context read-only tools
Wave 18: External discovery + MCP read-only tools
Wave 19: Provider-hosted tools
Wave 20: Context transition and compaction
Wave 21: Code-mode structured execution
Wave 22: Batch agent orchestration
Wave 23: Account quota reset credits
Wave 24: Bridge module runner / hooks execution
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

## GPT Review Questions

Ask review specifically for:

```text
1. Are any promotion families conflated and should be split?
2. Are any proposed waves too broad for safe PR sequencing?
3. Are there missing authority/evidence artifacts before provider declaration?
4. Is the suggested order correct, given PR85/86 already built sub-agent
   provider-backed execution substrate?
5. Which families should remain permanently operator-only rather than
   resident-callable?
```

