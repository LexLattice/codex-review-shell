# Direct Tool Authority Families Wave Spec

Status: completed planning/implementation spec for Wave 10; PR55-69 merged.

Primary upstream reference:

```text
/home/rose/work/codex/fork
branch: upstream-latest-release
tag: rust-v0.140.0
```

Related direct-harness docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md
docs/DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md
docs/DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md
docs/DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md
docs/DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md
```

## Purpose

This wave adds remaining vanilla Codex tool families to the direct path without
treating vanilla tool names as the governing abstraction.

The governing abstraction is:

```text
tool call
  = authority-bearing information transition
  + evidence requirements
  + context consequences
  + replay/recovery law
  + UI projection
```

Therefore the direct harness must not implement vanilla tools one by one by
surface name. It must classify them by ODEU authority family and implement each
family with the correct evidence, approval, context, persistence, replay, and
recovery contracts.

## Core Doctrine

Vanilla Codex tools are not a flat list of functions.

They are a taxonomy of institutional transitions:

```text
local workspace mutation
local perception
session/control-state mutation
human decision solicitation
context-budget/context-reset control
agent runtime graph/lifecycle
batch fan-out/fan-in
external capability discovery
external resource/action authority
provider-hosted tools
structured code execution
```

The direct harness should chase parity at this layer:

```text
ODEU authority family parity
```

not at this layer:

```text
ad hoc function-name parity
```

Global invariant:

```text
registry row visible != tool enabled
tool button visible != provider declaration
provider declaration != local executor permission
model tool call != local execution authority
local execution != provider saw result
```

## Existing Direct-Harness Tool Position

The direct path already has three important local-tool primitives:

| Direct primitive | Current posture | ODEU family | Notes |
| --- | --- | --- | --- |
| `read_file` / `readFile` | direct supported restricted | local perception | Relative workspace path, sensitive-path blocks, output caps, redaction scan, continuation envelope. |
| `apply_patch` / `applyPatch` | direct supported restricted | workspace mutation | Patch plan, dry-run/effect summary, approval, result, continuation. |
| `run_command` / `runCommand` | direct supported restricted | bounded process action | Package-manager test/run scripts only; not full vanilla `exec_command`. |

The direct path also has conceptual substrate for agent roles and projections:

| Direct substrate | Current posture | ODEU family | Notes |
| --- | --- | --- | --- |
| `AgentClassSpec` | direct supported as registry/projection | agent role ontology | Role contracts, allowed authority, forbidden conflations. |
| Worker graph alignment | projection/scaffolded | agent runtime graph | Maps workers to WorkThread and provider identity; no direct spawning yet. |
| Sub-agent observability | projection/scaffolded | agent runtime graph | Prevents child transcript flattening; not a child-agent executor. |
| Usage attribution | direct supported partial | observability/evidence | Tracks turns and agents where direct runtime evidence exists. |

These are not enough for vanilla sub-agent parity. A child agent is not a
function call. It requires a runtime graph, mailbox, lifecycle, containment,
attribution, context packet family, and recovery law.

## Tool Authority Taxonomy

Every direct tool row must map into one of these families.

| Family | Vanilla examples | Existing direct posture | Governing invariant |
| --- | --- | --- | --- |
| Workspace mutation / process authority | `apply_patch`, `exec_command`, `write_stdin`, `shell_command` | `apply_patch` restricted, `run_command` restricted | A local side effect needs authority envelope, approval, effect evidence, replay classification, and recovery law. |
| Local perception | `view_image`, file/resource reads | `read_file` restricted | Reading local evidence requires containment, redaction/projection, provider-visibility witness. |
| Session/control state | `update_plan`, `get_context_remaining`, `new_context` | partially modeled in bridge/context surfaces | Control-state mutation is not workspace mutation, but still affects future model cognition. |
| Human authority bridge / authority widening | `request_user_input`, `request_permissions` | headless human-decision packet exists | Bounded choices may carry authority; free text is context only; permission requests widen authority only through explicit gate scope. |
| Agent runtime | `spawn_agent`, `list_agents`, `wait_agent`, `send_message`, `followup_task`, `interrupt_agent` | registry/projection only | Agent graph is canonical runtime evidence; sub-agent panel is projection. |
| Batch agent orchestration | `spawn_agents_on_csv`, `report_agent_job_result` | not implemented | Fan-out/fan-in jobs require job identity, worker item identity, and result aggregation law. |
| External capability discovery | `tool_search`, `list_mcp_resources`, `list_mcp_resource_templates`, plugin list | skills/hooks/apps classified only | Discovery is not execution; schema/source provenance is required. |
| External resource/action authority | `read_mcp_resource`, MCP dynamic tools, plugin install/use | not implemented | External tool/resource calls need server identity, permission class, trust level, and result provenance. |
| Provider-hosted tools | `web_search`, `image_generation` | not implemented | Provider-hosted capabilities need provider declaration evidence and result provenance, not local shell authority. |
| Structured execution lane | code-mode execute/wait | not implemented | Code mode is not shell parity; it is a separate execution lane with kernel/session semantics. |

## Tool Capability Constitution

The first PR in this wave must create a direct tool capability constitution.

Each tool row should include:

```text
tool id
vanilla name(s)
ODEU authority family
capability state
implementation state
promotion state
provider declaration state
side-effect class
authority required
request shape families
local executor
approval mode
replay risk
recovery law
context visibility
UI projection
usage attribution
agent eligibility
```

Capability states:

```text
unknown
vanilla_known
profile_declared
provider_accepted
runtime_probed
```

Implementation states:

```text
none
schema_only
projection_only
fixture_executor
restricted_executor
full_executor
```

Promotion states:

```text
unsupported
diagnostic_only
fixture_only
direct_restricted
direct_enabled
deferred_external_authority
```

Provider declaration states:

```text
not_declared
declared_fixture_only
declared_live_unproved
declared_live_accepted
rejected_by_provider
not_provider_tool
```

Local executor states:

```text
none
scaffolded
fixture_only
implemented_restricted
implemented_full
```

Rules:

- `request_permissions` belongs to authority-gate widening, not shell execution.
- `new_context` belongs to context-world transition, not ordinary status tooling.
- `write_stdin` belongs to process-session authority, not harmless text input.
- `tool_search` belongs to capability discovery, not tool execution.
- Plugin install belongs to capability mutation, not connector use.
- Sub-agent tools belong to agent runtime, not ordinary function calls.
- No tool can be provider-declared unless its request-shape family is supported.
- No tool can execute locally unless its authority gate and recovery classifier exist.
- No tool result enters context except through a declared result envelope and context pack.
- No unsupported tool can be provider-declared.

### Authority Widening Fields

`request_permissions` is cross-family. It can affect local process authority,
external tool authority, agent authority, provider-hosted tool authority, or
context-world transitions.

Rows for authority-widening tools must include:

```text
authorityWideningTarget:
  workspace_process
  external_tool
  agent_runtime
  provider_hosted
  context_world
  unknown

wideningScope:
  single_action
  single_turn
  route
  session
  project
```

Default widening scope is `single_action` or blocked.

## Low-Local-Side-Effect Control, Perception, And Human-Decision Tools

This family is lower risk than shell/patch/sub-agent execution, but it is not
homogeneous.

### `get_context_remaining`

ODEU class:

```text
diagnostic context-pressure witness
```

Law:

```text
context remaining estimate != permission to continue
context estimate != compaction authority
context estimate != provider truth unless provider evidence exists
```

Output should declare:

```text
tokens_left
confidence
source
observed_at
estimate_kind
usable_for
```

Estimate kinds:

```text
provider_reported
local_tokenizer_estimate
budget_policy_estimate
unknown
```

Usability classes:

```text
display_only
context_maintenance_diagnostic
request_blocking
```

Default is `display_only`.

### `update_plan`

ODEU class:

```text
session/control-state mutation
```

Law:

```text
plan update != human objective change
plan update != tool approval
plan update != task completion proof
```

It should create or update a plan projection artifact and may enter context as
plan evidence, but it must not override current human instructions.

Plan artifact shape:

```text
PlanArtifact:
  planId
  source:
    model_tool_call
    human_edit
    harness_import
  status:
    active
    superseded
    stale
    blocked
  sourceTurnId
  sourceRefs
  conflictsWithCurrentUserIntent
  mayEnterContextAs: plan_evidence
  mayAuthorizeAction: false
```

If a model-authored plan conflicts with the latest human instruction, the human
instruction wins.

### `view_image`

ODEU class:

```text
local perception with possible provider-visible payload
```

Law:

```text
model asked to view image != model actually saw image pixels
```

Required posture:

```text
path containment
mime sniffing
image decode caps
metadata stripping policy
renderer-safe preview
provider visibility state
```

Provider visibility states:

```text
not_seen
metadata_only
image_payload_sent
unsupported
```

Provider visibility evidence:

```text
not_sent
metadata_envelope_sent
image_payload_sent_request_manifest_proved
image_payload_accepted_provider_event
unsupported
```

Additional laws:

```text
renderer preview != provider-visible image
image file read != image payload sent
image payload sent != model necessarily used it
```

V0 should default to `metadata_only` or `unsupported` unless the direct request
stack has exact image-input evidence.

### `request_user_input`

ODEU class:

```text
human decision bridge
```

Law:

```text
bounded choice may carry authority
free text is context only
free text cannot widen tool authority
```

This should reuse the headless human-decision packet law where possible.

### `new_context`

ODEU class:

```text
context-world transition
```

This is not low risk. It changes the model's informational world.

V0 posture:

```text
blocked
```

V0 requirements:

```text
registry row present
provider declaration disabled
renderer status says blocked
no local executor
no request-shape exposure
```

Do not activate `new_context` until it is wired into:

```text
context maintenance manifest
omission ledger
frontier baton
request manifest
source refs
```

## Agent Runtime Substrate

Sub-agents must be implemented as an institutional runtime, not as a function
wrapper.

Required objects:

```text
AgentRuntimeRegistry
AgentThreadGraph
AgentMailbox
AgentLifecycleState
AgentProgressRegistry
AgentContainmentProfile
AgentUsageAttribution
ParentChildAuthorityBoundary
AgentContextPacketFamily
AgentRecoveryClassifier
```

Core laws:

```text
child agent != function call
child agent != primary assistant
child transcript != primary transcript
child tool authority != parent tool authority
parent spawn intent != child execution success
wait status != wait authority
```

Additional laws:

```text
agent graph is canonical runtime evidence
sub-agent panel is projection
agent mailbox is authority-bearing communication substrate
agent lifecycle is recovery-relevant
parent context does not automatically become child context
child context does not automatically return to parent
child result summary is not primary assistant response
child tool evidence is not parent tool evidence
```

Each child-spawn transition should create, even before `spawn_agent` is exposed:

```text
AgentSpawnPlan
AgentContextPack
AgentRequestManifest
AgentAuthorityBoundary
AgentUsageScope
```

The substrate PR must answer:

```text
What is an agent?
What is a child thread?
What is a mailbox message?
What is a lifecycle terminal?
What is a parent/child authority boundary?
What usage belongs to whom?
What happens on restart?
```

## Sub-Agent Tool Surface

Do not expose all sub-agent tools at the same authority level.

### Tier 1: Observability

```text
list_agents
```

Reads graph/progress. It should be first.

### Tier 2: Creation

```text
spawn_agent
```

Creates:

```text
new agent node
new thread/session
new context packet
new provider request path
new usage attribution surface
```

V0 restrictions:

```text
text-only child
no tools by default
no recursive spawning
no inherited parent tool authority
explicit agent class
bounded initial prompt/context
```

Hard gates:

```text
spawn_agent without valid AgentClassSpec -> blocked
AgentClassSpec missing context packet family -> blocked
AgentClassSpec missing artifact output contract -> blocked
AgentClassSpec permits tools by default -> blocked in V0
```

### Tier 3: Synchronization

```text
wait_agent
```

This can block workflow and create deadlock risk.

Required law:

```text
timeout
max wait depth
no wait cycle
restart classification
parent turn blocked/continued state
```

Concrete wait-plan object:

```text
AgentWaitPlan:
  waitId
  parentAgentId
  targetAgentIds
  waitMode:
    any
    all
    specific
  timeoutMs
  maxWaitDepth
  waitGraphDigest
  cycleCheck:
    passed
    failed
  restartState:
    not_started
    waiting
    target_completed
    timeout
    handoff_unknown
    recovery_required
```

`wait_agent` is synchronization authority. It cannot be treated as a read-only
query.

### Tier 4: Mailbox Mutation

```text
send_message
followup_task
```

These mutate child-agent input state.

Required law:

```text
mailbox sequence numbers
idempotency keys
child lifecycle validation
prompt/context visibility witness
```

### Tier 5: Lifecycle Control

```text
interrupt_agent
close_agent
```

This is cancellation/shutdown authority and should be deferred from the first
sub-agent tool pass unless the exact runtime primitive and recovery law exist.

If V0 includes a placeholder, it should only support:

```text
mark_interrupt_requested
```

Actual provider/process cancellation requires:

```text
target lifecycle proof
provider/app-server cancellation primitive proof
child workspace/action state proof
partial output recovery
parent notification law
```

## Stateful Exec / PTY / Stdin Parity

Vanilla `exec_command` plus `write_stdin` is not a small extension of current
direct `run_command`.

Current direct `run_command` is:

```text
single-shot bounded command
```

Vanilla `exec_command` plus `write_stdin` is:

```text
stateful process session
```

Required objects:

```text
ExecSession
ExecCommandStart
ExecOutputFrame
ExecStdinWrite
ExecCancellation
ExecExitRecord
PTY/plain-pipe mode
OutputBudget
ProcessTreePolicy
SandboxProfile
ApprovalDecision
ReplayClassifier
```

Core laws:

```text
exec_command != run_command alias
write_stdin != harmless text
PTY session != stateless command
stdin write can trigger side effects
output stream is evidence, not transcript
process still running != terminal result
timeout cleanup != clean workspace
```

Recommended posture:

```text
no broad shell by default
no network by default
no hidden PTY unless explicitly selected
output caps
idle timeout
hard timeout
process tree cleanup
workspace-effect scan after mutating commands
stdin write approval if command is sensitive
```

Internal rollout tiers:

```text
Tier 1:
  non-PTY plain-pipe exec session
  allowlisted commands only
  no stdin after start unless command class permits

Tier 2:
  PTY sessions
  interactive stdin
  richer cancellation
```

PTY mode should be deferred until plain-pipe sessions, output frames, status,
and cancellation are stable.

`write_stdin` must declare a stdin policy:

```text
stdinPolicy:
  forbidden
  allowed_literal_text
  allowed_confirmation_only
  allowed_interactive
  requires_approval_each_write
```

Examples:

```text
test runner waiting for q -> allowed_confirmation_only
shell prompt -> forbidden in V0
package installer confirmation -> requires_approval_each_write
python REPL -> deferred
```

Exec output must split:

```text
raw output frame
redacted renderer output frame
provider result summary
truncated output marker
output omitted marker
```

The provider should not automatically receive raw full stdout/stderr. It should
receive a bounded result envelope through the tool continuation/context path.

## External, Hosted, Dynamic, And Code Tool Families

These must not stay in one implementation bucket.

### MCP / Resources / Tool Search

ODEU class:

```text
external capability discovery + external resource access
```

Required objects:

```text
capability discovery registry
server identity
resource identity
tool schema digest
permission class
external side-effect class
source provenance
result trust level
```

External capability descriptor:

```text
ExternalCapabilityDescriptor:
  serverIdentity
  serverTrustState
  toolSchemaDigest
  resourceTemplateDigest
  permissionClass
  externalSideEffectClass
  authScope
  networkScope
  resultTrustLevel
  enabledState
```

Law:

```text
tool_search != tool execution
read_mcp_resource = external perception
MCP dynamic tool call = external action
discovered tool != declared tool
declared external tool != approved execution
resource read != trusted project truth
MCP result != workspace evidence until staged/cited
```

### Plugin List / Install

ODEU class:

```text
capability discovery / capability mutation
```

Law:

```text
plugin list = discovery
plugin install = future tool-surface mutation
```

Required law:

```text
installation authority
source trust
version pinning
capability diff
rollback/uninstall law
```

First plugin-governance pass should cover plugin list plus plugin install
posture only. Actual install remains blocked unless:

```text
install source is pinned
capability diff is computed
new tool surface is not auto-enabled
rollback/uninstall path exists
registry changes are recoverable
```

### Hosted Provider Tools

Examples:

```text
web_search
image_generation
```

ODEU class:

```text
provider-hosted external epistemic/artifact tools
```

Required law:

```text
provider tool declaration evidence
result provenance
citation/source policy
generated artifact store
user-visible disclosure
request manifest support
```

Hosted tool result classes must split:

```text
web_search result = external epistemic evidence
image_generation result = generated artifact
```

Web search requires:

```text
source refs
retrieval time
provider citation object
quote/summary limits
staleness
```

Image generation requires:

```text
generation prompt evidence
asset id
content policy/result state
artifact storage
metadata/redaction
```

### Code Mode

ODEU class:

```text
structured code execution lane
```

Required objects:

```text
kernel/session object
file mount policy
artifact output policy
resource limits
wait/cancel semantics
stdout/stderr/result separation
dependency/network policy
```

Code-mode laws:

```text
code mode approval profile != shell approval profile
kernel session != exec session
code output artifact != shell stdout
mounted file policy != workspace shell cwd
```

### Batch Agent Jobs

Examples:

```text
spawn_agents_on_csv
report_agent_job_result
```

ODEU class:

```text
structured agent fan-out/fan-in
```

These should come after the sub-agent runtime is stable.

Required objects:

```text
AgentJob
AgentJobItem
WorkerResultContract
ResultAggregationLedger
MissingResultClassifier
OutputExportPolicy
```

## Proposed PR Sequence

This section records the original Wave 10 implementation sequence. PR55-65
built the direct tool authority families. PR66-69 then added the headless
evidence ladder needed to test those families without promoting them directly
into runtime availability.

### PR 55: Direct Tool Capability Constitution

Purpose:

```text
Create the tool constitution and registry/matrix for every vanilla tool by
ODEU authority class.
```

Scope:

- Add direct tool capability registry.
- Include every vanilla tool family from upstream Codex `rust-v0.140.0`.
- Classify by ODEU authority family, capability state, implementation state,
  promotion state, provider declaration state, side-effect class, approval
  mode, replay risk, recovery law, context visibility, UI projection, usage
  attribution, and agent eligibility.
- No execution behavior changes.

Acceptance:

- Every vanilla tool family has an explicit direct posture.
- Existing direct tools map to registry rows.
- `request_permissions`, `new_context`, `write_stdin`, `tool_search`,
  plugin install, and sub-agent tools are not misclassified.
- Each row has separate capability state, implementation state, promotion
  state, provider declaration state, and local executor state.
- Each row declares whether it may be provider-declared.
- Each row declares whether it may be locally executed.
- Each row declares request shape family.
- Each row declares provider-visible result envelope type.
- Each row declares recovery classifier.

### PR 56: Control, Perception, And Human-Decision Tool Substrate

Purpose:

```text
Implement or scaffold low-world-effect tool families without introducing
workspace mutation, agent spawning, or external tool execution.
```

Scope:

- `get_context_remaining`.
- `update_plan`.
- `view_image` metadata/projection path.
- `request_user_input` bounded/scaffolded through human decision packet law.
- `new_context` blocked through context-maintenance law.

Acceptance:

- `new_context` is not activated as a simple low-risk tool.
- `view_image` reports provider visibility state and exact provider visibility
  evidence.
- `request_user_input` cannot widen authority through free text.
- `update_plan` cannot override human objective or mark task completion proof.

### PR 57: Direct Agent Runtime Substrate

Purpose:

```text
Build the runtime substrate needed before exposing any sub-agent tool.
```

Scope:

- Agent runtime registry.
- Agent thread graph.
- Agent mailbox.
- Lifecycle/progress registry.
- Containment profile.
- Parent/child authority boundary.
- Agent usage attribution.
- Recovery classifier.

Acceptance:

- Agent graph is canonical runtime evidence.
- Sub-agent panel remains projection.
- Child transcript cannot become primary transcript.
- Parent spawn intent cannot be represented as child success.
- `AgentSpawnPlan` exists but cannot execute provider spawn yet.
- `AgentContextPacketFamily` exists.
- `AgentAuthorityBoundary` is explicit.
- `AgentMailbox` has sequence/idempotency law.
- Restart recovery can classify child created, request started, result pending,
  handoff unknown, and recovery required.

### PR 58: Text-Only Sub-Agent Tool Surface

Purpose:

```text
Expose sub-agent tools in tiers after substrate exists.
```

Scope:

- Tier 1: `list_agents`.
- Tier 2: text-only `spawn_agent`.
- Tier 3: `wait_agent` with timeout/no-deadlock law.
- Tier 4: `send_message` and `followup_task` after mailbox proof.
- Tier 5: `interrupt_agent` scaffold/blocked, mark-requested only, or deferred.

V0 restrictions:

- No child tools by default.
- No recursive spawning by default.
- No inherited parent tool authority.
- Explicit agent class required.
- Bounded initial prompt/context.

Acceptance:

- Agent model/reasoning/usage attribution is preserved separately from parent.
- Wait cannot deadlock parent workflow.
- Mailbox writes are sequenced and idempotent.
- Interrupt/cancel authority is gated or deferred.
- `spawn_agent` requires a valid `AgentClassSpec`.
- Child agents are text-only, no-tools, non-recursive, and no inherited
  authority in V0.
- `wait_agent` emits `AgentWaitPlan` evidence.

### PR 59: Stateful Exec / PTY / Stdin Parity

Purpose:

```text
Add vanilla-style process-session authority without collapsing it into current
bounded run_command.
```

Scope:

- `exec_command`.
- `write_stdin`.
- Session ids.
- Plain-pipe mode first; PTY mode deferred until evidence is stable.
- Output frames and output budgets.
- Idle/hard timeouts.
- Cancellation and process tree cleanup.
- Sandbox/approval profile.
- Workspace-effect scan where relevant.

Acceptance:

- `exec_command` is not an alias for `run_command`.
- `write_stdin` is authority-bearing.
- Process still running is not terminal success.
- Output stream is evidence, not transcript.
- `write_stdin` declares stdin policy per command class.
- Provider-visible output is a bounded result envelope, not raw full stdout or
  stderr by default.

### PR 60: External Capability Discovery Registry

Purpose:

```text
Add discovery substrate for external/dynamic capabilities before execution.
```

Scope:

- `tool_search` posture.
- MCP server/resource/tool discovery registry.
- Plugin list posture.
- Schema/source digest tracking.
- Deferred tool exposure status.
- `ExternalCapabilityDescriptor`.

Non-goal:

- No external tool execution.
- No plugin install.

### PR 61: MCP Resource Read And Tool Call Boundary

Purpose:

```text
Add external resource/action boundary for MCP in direct path.
```

Scope:

- `list_mcp_resources`.
- `list_mcp_resource_templates`.
- `read_mcp_resource` first.
- Dynamic MCP tool call boundary scaffold before restricted execution.
- External side-effect class and source provenance.

### PR 62: Hosted Provider Tools

Purpose:

```text
Add provider-hosted web/image tool posture where provider metadata proves
support.
```

Scope:

- `web_search`.
- `image_generation`.
- Provider declaration evidence.
- Result provenance.
- Artifact/source policy.
- Separate web-search evidence contract and image-generation artifact contract.

### PR 63: Plugin Governance

Purpose:

```text
Handle plugin list/install as capability discovery/mutation, not ordinary tool
execution.
```

Scope:

- Plugin list.
- Plugin install request posture.
- Version/source/capability diff.
- Rollback/uninstall law.
- Actual install remains blocked until source pinning, capability diff,
  non-auto-enabled new tool surface, rollback/uninstall, and recoverable
  registry changes are proven.

### PR 64: Code Mode Execution Lane

Purpose:

```text
Model code mode as a structured execution lane, not shell parity.
```

Scope:

- Code-mode execute/wait posture.
- Kernel/session identity.
- Artifact output policy.
- Resource/wait/cancel semantics.

### PR 65: Batch Agent Jobs

Purpose:

```text
Add structured fan-out/fan-in after agent runtime is stable.
```

Scope:

- `spawn_agents_on_csv`.
- `report_agent_job_result`.
- Worker result contracts.
- Aggregation/export ledger.

### PR 66: Headless Tool-Class Example Pack And Runner

Purpose:

```text
Create one canonical example per ODEU tool authority class and verify registry
coverage before any live or activation decision.
```

Scope:

- `direct_headless_tool_class_example_pack@1`.
- One example per authority class, not per raw vanilla tool name.
- Test modes:
  - `real_provider`;
  - `headless_fixture`;
  - `projection_blocked`;
  - `unsupported_blocked`.
- Validate-only default runner.
- Optional fixture execution mode.
- No provider transport, renderer authority, workspace mutation, or promotion.

### PR 67: Headless Tool-Class Realism Report

Purpose:

```text
Turn the example pack into an operational realism report.
```

Scope:

- `direct_headless_tool_class_realism_report@1`.
- Per-class realism rows.
- Classify rows as fixture-proven, fixture-available-not-executed,
  projection-blocked, unsupported, failed, or future-provider candidate.
- Preserve promotion readiness as evidence only.
- No live provider calls and no runtime enablement.

### PR 68: Headless Tool-Class Live Candidate Gate

Purpose:

```text
Select only fixture-proven tool classes as eligible live-smoke candidates.
```

Scope:

- `direct_headless_tool_class_live_candidate_gate@1`.
- Per-class candidate rows.
- Require explicit live-smoke mode, operator/CI authority, provider opt-in,
  bounded timeout, raw-exposure scan, route-authority review, and
  class-specific conditions.
- Preserve all blocked rows with explicit blockers.
- No live smoke execution and no promotion.

### PR 69: Headless Tool-Class Live Smoke Runner

Purpose:

```text
Consume candidate rows and produce explicit live-smoke evidence without
promoting any class automatically.
```

Scope:

- `direct_headless_tool_class_live_smoke_report@1`.
- Per-class live-smoke rows.
- Plan-only default.
- Explicit `execute_live_smoke` evidence mode.
- Live pass requires satisfied conditions and smoke evidence refs.
- Caller-requested `plan_only` remains plan-only even when supplied smoke
  evidence exists.
- No default provider transport, renderer authority, raw payload persistence,
  or runtime activation.

## Wave 11: Tool Promotion And Activation

Wave 10 ends at evidence. It does not make any tool class usable by the model in
the direct runtime.

The next wave should consume Wave 10 artifacts through three separate
transitions:

```text
live-smoke report
  -> promotion decision
  -> activation registry
  -> first model-visible direct tool slice
```

The separation is mandatory:

```text
live smoke evidence != promotion decision
promotion decision != activation
activation != per-call authority
per-call authority != provider-visible result
```

Wave 11 must not be compressed. If promotion and activation are combined,
evidence can silently become authority. If activation and first use are
combined, enabled status can silently become provider declaration and per-call
permission.

### PR 70: Tool Promotion Decision Gate

Status: implemented in branch `codex/direct-tool-promotion-decision-gate`.

Purpose:

```text
Produce per-tool-class promotion decisions from PR69 evidence.
```

Expected artifact:

```text
direct_tool_promotion_decision_report@1
```

Decision states:

```text
promotable
promotable_restricted
blocked
needs_more_evidence
not_applicable
```

Evidence classes:

```text
fixture_only
diagnostic_only
real_provider_declaration
real_provider_full_loop
real_runtime_full_loop
```

Promotion decisions are scoped. They must not say:

```text
read_file is promotable
```

They must say:

```text
this tool class/schema/request-shape/provider/runtime/executor/envelope bundle
is promotable under this exact evidence scope
```

Required scope fields:

```ts
type DirectToolPromotionScope = {
  toolClassId: string;
  toolName: string;
  toolSchemaVersion: string;
  authorityFamily:
    | "local_perception"
    | "workspace_mutation"
    | "process_session"
    | "session_control"
    | "human_decision"
    | "agent_runtime"
    | "external_resource"
    | "provider_hosted"
    | "code_mode";
  requestShapeFamily: string;
  providerProfileId: string;
  modelId?: string;
  runtimeTier: "direct_text" | "direct_implementation" | "headless_direct";
  localExecutorVersion?: string;
  authorityEnvelopeVersion: string;
  resultEnvelopeVersion: string;
};
```

Required checks:

- Source live-smoke report validates.
- Smoke row passed with evidence refs.
- Required conditions were satisfied.
- No raw prompt/result/path/secret leak.
- No renderer authority grant.
- No provider transport outside the declared route.
- No workspace/process/agent effect outside the class contract.
- Tool constitution row still matches the source class and implementation
  state.
- Fixture-only evidence normally yields `needs_more_evidence`, not activation
  readiness.
- Freshness is explicit and stale if the tool constitution digest, executor
  digest, provider profile digest, or result envelope policy changes.
- Negative evidence is explicit:
  - no raw exposure;
  - no renderer authority grant;
  - no out-of-contract provider transport;
  - no out-of-contract workspace effect;
  - no context smuggling;
  - no replay-unsafe state.

Expected report shape:

```ts
type DirectToolPromotionDecisionReport = {
  schema: "direct_tool_promotion_decision_report@1";
  reportId: string;
  generatedAt: string;
  sourceEvidence: {
    liveSmokeReportId: string;
    liveSmokeReportDigest: string;
    toolConstitutionDigest: string;
    implementationDigest?: string;
    providerProfileDigest?: string;
  };
  decisions: DirectToolPromotionDecision[];
  rawExposureScan: {
    passed: boolean;
    blockedReasons: string[];
  };
  matrixPromotionCandidate: boolean;
};
```

Expected row shape:

```ts
type DirectToolPromotionDecision = {
  decisionId: string;
  scope: DirectToolPromotionScope;
  state:
    | "promotable"
    | "promotable_restricted"
    | "blocked"
    | "needs_more_evidence"
    | "not_applicable";
  evidenceClass:
    | "fixture_only"
    | "diagnostic_only"
    | "real_provider_declaration"
    | "real_provider_full_loop"
    | "real_runtime_full_loop";
  restrictions: DirectToolActivationRestriction[];
  requiredConditionsSatisfied: boolean;
  missingEvidence: string[];
  blockerCodes: string[];
  negativeEvidence: {
    noRawExposure: boolean;
    noRendererAuthorityGrant: boolean;
    noOutOfContractProviderTransport: boolean;
    noOutOfContractWorkspaceEffect: boolean;
    noContextSmuggling: boolean;
    noReplayUnsafeState: boolean;
  };
  freshness: {
    generatedAt: string;
    expiresAt?: string;
  };
};
```

Non-goal:

```text
No runtime activation.
```

### PR 71: Direct Tool Activation Registry

Purpose:

```text
Record which promoted tool classes are actually enabled for direct runtime use.
```

Expected artifact:

```text
direct_tool_activation_registry@1
```

Activation states:

```text
inactive
active
shadow_only
suspended
revoked
expired
```

Activation row must cite:

- promotion decision digest;
- operator/project/work-thread scope;
- provider request-shape support;
- local executor state;
- authority envelope;
- recovery/replay classifier;
- context/result envelope policy.

Activation scopes:

```text
global default
project default
work-thread override
single-turn override
```

Scope precedence:

```text
single-turn override
  > work-thread override
  > project default
  > global default
```

Precedence law:

```text
explicit deny/revoke at narrower scope wins over allow at broader scope
emergency revoke wins over frozen turn activation
normal activation changes apply next turn
```

Global positive activation is disabled in V0 except harmless diagnostic/status
tools. Real workspace-reading activation should start at project, work-thread,
or single-turn scope.

Activation rows are eligibility, not permission:

```text
activation row means:
  this tool may be declared to the provider for this request scope

activation row does not mean:
  any specific tool call may execute
```

Every provider request that declares tools must freeze:

```text
activationSnapshotId
activationRegistryDigest
toolDeclarationDigest
```

Per-call execution still requires:

```text
tool call matches declaration digest
arguments validate
authority envelope validates
local executor validates
recovery/replay state is safe
policy/capability is still fresh
```

Expected registry shape:

```ts
type DirectToolActivationRegistry = {
  schema: "direct_tool_activation_registry@1";
  registryId: string;
  generatedAt: string;
  registryVersion: number;
  registryDigest: string;
  rows: DirectToolActivationRow[];
  precedenceLaw: {
    order: [
      "single_turn_override",
      "work_thread_override",
      "project_default",
      "global_default"
    ];
    denyWins: true;
    emergencyRevokeWins: true;
  };
  rawExposureScan: {
    passed: boolean;
    blockedReasons: string[];
  };
};
```

Expected row shape:

```ts
type DirectToolActivationRow = {
  activationRowId: string;
  toolClassId: string;
  toolName: string;
  toolSchemaVersion: string;
  state:
    | "inactive"
    | "active"
    | "shadow_only"
    | "suspended"
    | "revoked"
    | "expired";
  scope:
    | { kind: "global_default" }
    | { kind: "project_default"; projectId: string }
    | { kind: "work_thread_override"; workThreadId: string }
    | { kind: "single_turn_override"; turnId: string };
  promotionDecisionRef: {
    decisionId: string;
    decisionDigest: string;
  };
  activationDecision: {
    activatedBy: "operator" | "project_policy" | "test_fixture" | "migration";
    decisionId: string;
    reason: string;
  };
  providerRequestShapeSupport: {
    requestShapeFamily: string;
    providerDeclarationState:
      | "declared_live_accepted"
      | "declared_live_unproved"
      | "not_declared";
  };
  localExecutorState: string;
  authorityEnvelopePolicyId: string;
  recoveryReplayClassifierId: string;
  contextResultEnvelopePolicyId: string;
  revocationMode?: "next_turn" | "immediate_block_calls";
};
```

Non-goal:

```text
No implicit activation from passing smoke.
```

### PR 72: First Usable Direct Tool Slice

Purpose:

```text
Expose the first model-visible direct tool slice through the activation
registry.
```

Recommended slice:

```text
read_file + get_context_remaining
```

Required behavior:

- Tool declarations are generated from activation rows.
- Declaration generation is deterministic and cites activation snapshot,
  request-shape family, provider profile, model, declaration digest, activation
  row id, and result envelope policy id.
- Provider calls must match the frozen declaration snapshot:
  - declared tool name;
  - schema version;
  - argument schema;
  - non-revoked activation row;
  - authority envelope.
- Tool calls route through existing authority envelopes.
- Tool results are emitted through declared result/context envelopes.
- Usage attribution and replay/recovery law are preserved.
- Headless smoke covers the resulting model-visible path.
- `read_file` is read-only but still sensitive. It requires path containment,
  path allow/block policy, sensitive path deny list, max bytes/lines, binary
  handling, redaction scan, truncation/omission markers, operation ledger entry,
  and recovery classifier.
- `get_context_remaining` is estimate/status only and cannot authorize
  `new_context`, compaction, or large input continuation.
- `view_image` stays metadata/projection only unless separate provider
  image-input evidence exists.

Required result path:

```text
local executor result
  -> result envelope
  -> raw-exposure scan
  -> context/tool continuation packet
  -> provider continuation
  -> transcript/status projection
```

Invariant:

```text
tool result exists locally != provider saw tool result
```

Headless smoke must prove the full model-visible loop:

```text
activation row exists
tool declaration built from activation row
provider request sent with declaration digest
provider emits supported tool call
tool call routed through authority envelope
local result envelope produced
result envelope sent to provider
provider completes or reaches lawful terminal
usage/recovery evidence recorded
```

Non-goal:

```text
No mutation, process, sub-agent, MCP, plugin, provider-hosted, or batch-agent
activation in the first slice.
```

## Global Acceptance Criteria

- No vanilla tool is introduced without a registry row.
- No tool row claims direct support without executor evidence.
- No renderer affordance becomes authority.
- Every tool row declares provider declaration state, local executor state, and
  promotion state separately.
- No tool can be provider-declared unless its request-shape family is supported.
- No tool can execute locally unless its authority gate and recovery classifier
  exist.
- No tool result enters context except through a declared result envelope and
  context pack.
- No tool output is rendered as transcript unless explicitly projected as
  transcript-safe.
- Every tool family declares context visibility and replay/recovery law.
- Every tool family has raw-exposure scan policy.
- Every tool family has stale/missing/corrupt behavior.
- Every mutating family declares approval and side-effect posture.
- Every mutating family has idempotency and replay ambiguity behavior.
- Every external family declares source provenance and trust boundary.
- Every external/provider-hosted family declares whether result is evidence,
  artifact, action result, or capability mutation.
- Every agent family declares parent/child attribution and usage law.
- Every provider-hosted family declares provider capability evidence.
- Unsupported and deferred tools render explicit status rather than disappearing.
- Unsupported tools have visible reasons and no provider declaration.
- Promotion decisions are scoped by tool class, schema version, request-shape
  family, provider profile/model, runtime tier, executor version, authority
  envelope, and result envelope.
- Fixture-only evidence cannot produce active runtime activation.
- Activation registry supports inactive, active, shadow-only, suspended,
  revoked, and expired states.
- Activation scope precedence is explicit and deny/revoke wins over allow.
- Provider requests freeze an activation snapshot and tool declaration digest.
- Tool calls must match the frozen declaration digest and current per-call
  authority gate.
- Emergency revocation blocks per-call execution even if a tool was declared
  earlier.
- Activation rows can permit declaration eligibility but never bypass per-call
  authority.
- First slice includes only `read_file` and `get_context_remaining` unless
  separate provider visibility proof exists for `view_image`.
- `read_file` result envelopes enforce sensitive-path, size, truncation,
  redaction, and provider-visibility policy.
- `get_context_remaining` result is estimate/status only and cannot authorize
  `new_context` or compaction.
- Headless smoke proves declaration, provider tool call, local authority route,
  result envelope, provider continuation, and terminal state.

## Failure-Class Checklist

Each PR in this wave should test relevant bridge failure classes:

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

Wave-specific examples:

```text
projection laundering:
  registry/projection row treated as actual capability

authority inflation:
  vanilla tool name treated as permission

context smuggling:
  tool output enters model context outside result envelope

action replay:
  exec/MCP/agent action reruns after restart ambiguity

thread flattening:
  child agent transcript becomes primary conversation

renderer authority leak:
  UI button/provider status enables undeclared tool

promotion laundering:
  smoke report interpreted as activation

scope widening:
  promotion for one request/model/project used globally

declaration drift:
  provider request declares a schema not matching activation row

activation race:
  registry changed mid-turn without frozen snapshot

emergency revoke bypass:
  tool call executes after immediate revocation

result-envelope bypass:
  tool output enters context/transcript outside declared envelope

read-only exfiltration:
  read_file sends sensitive workspace content because "not mutating" was
  treated as safe
```

## Non-Goals For This Wave

- No attempt to make direct path exactly mirror app-server internals.
- No broad shell authority by default.
- No default recursive sub-agent spawning.
- No plugin installation before plugin governance exists.
- No MCP dynamic execution before external tool boundary exists.
- No provider-hosted tool enablement without provider declaration evidence.
- No code-mode execution lane hidden inside shell/command parity.
