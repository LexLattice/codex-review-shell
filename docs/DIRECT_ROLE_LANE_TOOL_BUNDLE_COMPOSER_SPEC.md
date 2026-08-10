# Direct Role-Lane Tool Bundle Composer Spec

Status: planning spec for the next Direct capability integration wave.

Depends on:

- `ODEU_ROLE_LANE_MULTI_AGENT_ARCHITECTURE_SPEC.md`
- `DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md`
- `DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md`
- `DIRECT_RESIDENT_AGENT_EPISTEMIC_ACCESS_SPEC.md`
- `DIRECT_WAVE15_RESIDENT_SUB_AGENT_MVP_SPEC.md`
- `DIRECT_WAVE16_SUB_AGENT_LIFECYCLE_FOLLOWUP_TRANSCRIPT_SPEC.md`
- `DIRECT_WAVE17_HUMAN_CONTROL_READONLY_TOOLS_SPEC.md`
- `DIRECT_WAVE18_EXTERNAL_DISCOVERY_MCP_READ_SPEC.md`
- `DIRECT_WAVE19_PROVIDER_HOSTED_TOOLS_SPEC.md`

## Purpose

Define the missing integration layer between the Direct capability registry and
the resident model's actual provider-declared tools.

Current state:

```text
Many Direct capability families exist and have proofs.
The default live implementation lane still declares only:
  read_file
  apply_patch
  run_command
```

Target state:

```text
current WorkThread + role lane + objective + authority boundary + runtime facts
  -> lane-scoped tool bundle
  -> provider-declared tools for this request
  -> resident-visible capability catalogue for unavailable tools
```

## Problem

The Direct harness now has multiple capability families:

```text
implementation tools
sub-agent tools
human/control tools
MCP/resource discovery tools
provider-hosted web/image tools
memory/compaction/new-context tools
future code-mode/batch tools
```

But implemented capability does not automatically mean:

```text
provider-declared in the current request
resident-callable in this lane
authorized for this WorkThread
safe under current policy
supported by current provider/runtime
```

The resident model needs truthful epistemic access:

```text
what can I call now?
what exists but is not available here?
why is it not available?
what setup, policy, or lane change would make it available?
```

## Doctrine

The Direct live request must not use a flat global tool set.

It should be composed from:

```text
RoleLane
NormalizedLaneRequest
WorkThread
Active objective
Authority boundary
Runtime/provider capabilities
Tool activation registry
Declaration policy templates
Resident epistemic snapshot
```

The composer is a compiler, not an authority source:

```text
RoleLaneSelection
+ NormalizedLaneRequest
+ ActivationSnapshot
+ RuntimeFacts
+ DeclarationPolicy
+ AuthorityTemplates
= ProviderDeclaredToolBundle
+ ResidentCapabilityCatalogue
+ ToolBundleCompositionWitness
```

It must not decide user intent, create roles, grant authority, rewrite policy,
or promote a tool solely because it exists. It resolves over already-lawful
lane/request artifacts.

The output is two separate artifacts:

```text
ProviderDeclaredToolBundle
  tools the model can actually call in this request

ResidentCapabilityCatalogue
  tools/capabilities the resident may know about, including blocked or deferred
  ones, with reasons
```

## Non-Goals

- No global declaration of every implemented tool.
- No dynamic MCP tool execution in this wave.
- No plugin install or marketplace mutation.
- No image generation as resident-callable default.
- No lifecycle-interference sub-agent tools by default.
- No `new_context` or compaction execution unless a later wave promotes it.
- No model-level permission grant without deterministic policy token.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `DirectRoleLaneRegistry` | support artifact | build | Binds WorkThread/session context to existing AgentClassSpec/route/handoff artifacts |
| `DirectToolBundleComposer` | support artifact | build | Selects provider-declared tools for current request |
| `DirectToolDeclarationPolicy` | support artifact | align | Deterministic rules for what may be declared |
| `ProviderDeclaredToolBundle` | support artifact | build | First-class provider-visible declaration bundle, digest, and request-shape refs |
| `ResidentCapabilityCatalogue` | support artifact | align | Resident-visible callable/blocked/deferred capability status |
| `ToolBundleCompositionWitness` | evidence artifact | build | Records inputs, selected tools, omitted tools, and reasons |
| `ToolDeclarationAuthorityTemplate` | support artifact | build | Declaration-time operation/scope template; concrete calls still need per-call decisions |
| `LaneCapabilityTokenSet` | support artifact | build | Concrete per-call authority tokens minted after tool arguments are known |
| `ToolBundleRegressionMatrix` | verification artifact | build | Tests lane/request combinations and negative boundaries |

## Role Lane Classes For Direct

### Implementation Worker Lane

Default tools:

```text
read_file
apply_patch
run_command
```

Optional promoted tools:

```text
get_context_remaining
update_plan
request_user_input
list_agents
inspect_agent
web_search
```

Blocked by default:

```text
spawn_agent
send_message
close_agent
interrupt_agent
resume_agent
image_generation
dynamic_mcp_tool_call
request_plugin_install
new_context
```

### Review/Auditor Lane

Likely default tools:

```text
read_file
get_context_remaining
list_agents
inspect_agent
web_search if activation is exact
```

Likely blocked:

```text
apply_patch
run_command
spawn_agent unless auditor role is explicitly allowed to delegate
```

### Orchestrator Lane

Likely default tools:

```text
list_agents
inspect_agent
wait_agent
get_context_remaining
update_plan
request_user_input
```

Guarded tools:

```text
spawn_agent
send_message
```

Blocked by default:

```text
apply_patch
run_command
image_generation
dynamic_mcp_tool_call
```

### Sub-Agent Worker Lane

Default tools depend on the worker contract.

Baseline:

```text
read_file if context/workspace contract allows it
apply_patch only if explicitly a coding worker
run_command only if command policy allows it
```

Blocked by default:

```text
recursive_spawn
cross-lane memory access
parent-thread mutation
unscoped MCP/plugin actions
```

### Discovery/Research Lane

Default tools:

```text
tool_search
list_mcp_resources
list_mcp_resource_templates
read_mcp_resource
web_search if provider activation is exact
```

Blocked:

```text
apply_patch
run_command
dynamic_mcp_tool_call
request_plugin_install
workspace mutation
```

## Tool Status Vocabulary

Every known tool should resolve to one of:

```text
declared_callable
known_unavailable
blocked_by_lane
blocked_by_policy
blocked_by_provider
blocked_by_runtime
operator_gated
requires_setup
diagnostic_only
future_wave
unknown
```

Provider declaration is allowed only for `declared_callable`.

Resident catalogue rows may include every status except raw-secret or raw-path
details.

The single human-facing status is not enough for the witness. The composer must
preserve the underlying capability axes already modeled by the Direct registry:

```ts
type DirectToolCapabilityAxes = {
  implementedState:
    | "not_implemented"
    | "schema_only"
    | "projection_only"
    | "restricted_executor"
    | "full_executor";

  promotionState:
    | "unsupported"
    | "diagnostic_only"
    | "activation_gated"
    | "direct_restricted"
    | "direct_enabled";

  activationState:
    | "inactive"
    | "active"
    | "shadow_only"
    | "suspended"
    | "revoked"
    | "expired";

  declarationState:
    | "declared_callable"
    | "not_declared"
    | "blocked";

  currentRequestStatus:
    | "callable_now"
    | "known_unavailable"
    | "operator_gated"
    | "blocked";
};
```

The resident can receive a compact status, but the composition witness must keep
these axes so "available" does not ambiguously mean implemented, promoted,
activated, provider-supported, lane-valid, or callable.

## Data Model

```ts
type DirectRoleLaneSelection = {
  schema: "direct_role_lane_selection@1";
  selectionId: string;

  projectId: string;
  workThreadId: string;
  threadId: string;

  laneId: string;
  laneKind:
    | "front_conversation"
    | "implementation_worker"
    | "review_auditor"
    | "meta_orchestrator"
    | "sub_agent_worker"
    | "discovery_research"
    | "provider_hosted_web"
    | "image_artifact"
    | "memory_compaction"
    | "headless_daemon";
  roleId: string;

  agentClassSpecRef: EvidenceRef;
  controlledRouteRef?: EvidenceRef;
  roleHandoffPacketRef?: EvidenceRef;
  normalizedLaneRequestRef?: EvidenceRef;

  objectiveRef?: EvidenceRef;
  authorityBoundaryRef: EvidenceRef;
  laneLawRefs: EvidenceRef[];

  selectedAt: string;
  evidenceRefs: EvidenceRef[];
};

type DirectToolBundleComposerInput = {
  schema: "direct_tool_bundle_composer_input@1";
  compositionId: string;
  laneSelection: DirectRoleLaneSelection;
  providerProfileRef: string;
  runtimeFactsRef: string;
  activationSnapshotRefs: string[];
  residentEpistemicSnapshotRef?: string;

  sourceMessageRef?: EvidenceRef;
  sourceSpanRefs?: EvidenceRef[];
  semanticParseRef?: EvidenceRef;
  normalizedLaneRequestRef?: EvidenceRef;
  controlledRouteRef?: EvidenceRef;
  roleHandoffPacketRef?: EvidenceRef;
  contextPacketRef?: EvidenceRef;
  requestManifestRef?: EvidenceRef;

  requestedToolFamilies?: string[];
  observedAt: string;
};

type ProviderDeclaredToolBundle = {
  schema: "provider_declared_tool_bundle@1";
  bundleId: string;
  compositionId: string;
  laneId: string;
  roleId: string;
  workThreadId: string;

  declaredToolNames: string[];
  toolDeclarations: unknown[];

  declarationDigest: string;
  activationSnapshotRefs: EvidenceRef[];
  providerProfileRef: EvidenceRef;
  requestShapeProofRefs: EvidenceRef[];

  parallelToolCalls: false;
  toolChoice?: "auto" | "none" | "required";

  rawProviderPayloadIncluded: false;
  rawSecretIncluded: false;
  createdAt: string;
};

type DirectToolBundleCompositionWitness = {
  schema: "direct_tool_bundle_composition_witness@1";
  compositionId: string;
  laneId: string;
  roleId: string;
  sourceMessageRef?: EvidenceRef;
  semanticParseRef?: EvidenceRef;
  normalizedLaneRequestRef?: EvidenceRef;
  controlledRouteRef?: EvidenceRef;
  roleHandoffPacketRef?: EvidenceRef;
  providerDeclaredToolBundleRef: string;
  declaredTools: DirectDeclaredToolRow[];
  knownUndeclaredTools: DirectKnownUndeclaredToolRow[];
  blockedTools: DirectBlockedToolRow[];
  operatorGatedTools: DirectOperatorGatedToolRow[];
  omittedReasonRows: DirectToolOmissionReasonRow[];
  residentCatalogueRef: string;
  rawPromptIncluded: false;
  rawProviderPayloadIncluded: false;
  rawSecretIncluded: false;
  createdAt: string;
};

type DirectDeclaredToolRow = {
  toolName: string;
  capabilityId: string;
  toolFamily: string;
  declarationDigest: string;
  perCallAuthorityRequired: boolean;
  declarationAuthorityTemplateRef: string;
  laneScope: string;
  providerSupported: boolean;
  activationRef: string;
  policyDecisionRef: string;
};

type ToolDeclarationAuthorityTemplate = {
  schema: "tool_declaration_authority_template@1";
  templateId: string;
  toolName: string;
  laneId: string;
  allowedOperationClasses: string[];
  targetScopePolicyRef: EvidenceRef;
  requiresConcreteCallDecision: true;
  resultEnvelopePolicyRef: EvidenceRef;
  contextAdmissionPolicyRef: EvidenceRef;
};

type ResidentCapabilityCatalogue = {
  schema: "resident_capability_catalogue@1";
  catalogueId: string;
  laneId: string;
  roleId: string;
  callableNow: ResidentCapabilityRow[];
  knownUnavailable: ResidentCapabilityRow[];
  omittedCount: number;
  omittedByClass: {
    blockedTools: number;
    unavailableTools: number;
    futureWaveTools: number;
    operatorGatedTools: number;
  };
  nonOmittableRows: ResidentCapabilityRow[];
  omissionPolicyRef: EvidenceRef;
  budgetPolicy: "full" | "compact" | "critical_only";
  createdAt: string;
};

type ResidentCapabilityRow = {
  toolName: string;
  toolFamily: string;
  status:
    | "declared_callable"
    | "known_unavailable"
    | "blocked_by_lane"
    | "blocked_by_policy"
    | "blocked_by_provider"
    | "blocked_by_runtime"
    | "operator_gated"
    | "requires_setup"
    | "diagnostic_only"
    | "future_wave"
    | "unknown";
  axes: DirectToolCapabilityAxes;
  callableInCurrentRequest: boolean;
  reason: string;
  nextEnablementClass?:
    | "lane_change"
    | "operator_approval"
    | "runtime_capability"
    | "provider_support"
    | "future_implementation"
    | "policy_change"
    | "not_enableable";
  evidenceRefs: EvidenceRef[];
};
```

## Composition Law

Declaration-time eligibility and concrete per-call authority are distinct.

Declaration-time eligibility asks:

```text
Can this tool family be exposed to this resident in this lane/request?
```

Concrete per-call authority asks:

```text
Is this specific tool call, with these arguments and target object, allowed?
```

The composer may attach a `ToolDeclarationAuthorityTemplate` to a declared
tool. It must not pretend to have fully authorized a concrete call before the
model supplies tool arguments.

Tool declaration requires all of:

```text
1. Tool exists in Direct capability registry.
2. Tool promotion state allows resident-callable use.
3. Provider/request shape supports declaration.
4. Active role lane allows the tool family.
5. Current WorkThread authority boundary allows the operation class.
6. Runtime/provider facts are fresh enough.
7. Declaration authority template exists and requires concrete per-call decision.
8. Tool has result envelope and context admission policy.
9. Tool is not explicitly disabled by operator/project settings.
10. Declaration digest can be recorded in ToolBundleCompositionWitness.
```

Concrete tool execution still requires:

```text
tool call arguments
target normalization
per-call policy decision
capability token or denial witness
result envelope
context admission decision
```

If any condition fails:

```text
do not provider-declare the tool
include a resident catalogue row if useful and safe
record omission reason in composition witness
```

## First Default Promotion Target

The first integration wave should not declare every wave 15-19 tool.

Recommended first default set for implementation worker:

```text
read_file
apply_patch
run_command
get_context_remaining
update_plan
request_user_input
list_agents
inspect_agent
```

Conditional:

```text
web_search only if exact provider activation supports it
wait_agent only if an active child-agent graph exists and wait is read-like
```

Blocked/visible:

```text
spawn_agent: known_unavailable or operator_gated
send_message: blocked_by_policy unless orchestrator lane and target policy allow
image_generation: operator_gated
read_mcp_resource: blocked until source identity is explicit for this call
dynamic_mcp_tool_call: future_wave
request_plugin_install: operator_gated/future_wave
new_context: future_wave or blocked_by_policy
```

## Resident Prompt/Context Contract

The resident should receive:

```text
1. Provider-declared tools it can call now.
2. A compact capability catalogue for relevant known unavailable tools.
3. A rule that unavailable tools must not be claimed callable.
4. A rule that user can request enabling or route change, but model cannot self-enable.
```

Example resident-facing capability summary:

```text
Callable tools now:
- read_file
- apply_patch
- run_command
- get_context_remaining
- list_agents
- inspect_agent

Known unavailable tools:
- spawn_agent: operator-gated in this lane; request orchestration lane or approval.
- web_search: blocked because provider activation evidence is stale.
- image_generation: operator-gated artifact action, not resident-callable here.
- dynamic_mcp_tool_call: future wave; discovery/read-only MCP only.
```

## Request Flow

```text
turn/start requested
  -> select RoleLane for WorkThread/thread
  -> read provider/runtime facts
  -> read activation snapshots
  -> compose declaration candidates
  -> apply lane policy
  -> attach declaration authority templates
  -> build ProviderDeclaredToolBundle
  -> build ResidentCapabilityCatalogue
  -> append ToolBundleCompositionWitness
  -> send provider request with declared tools
  -> for each concrete tool call, run per-call authority and mint/deny token
```

## Failure Modes

### Stale Activation

```text
state: blocked_by_runtime
resident reason: activation evidence is stale
declaration: omitted
```

### Lane Mismatch

```text
state: blocked_by_lane
resident reason: current role lane does not own this tool family
declaration: omitted
```

### Operator Gated

```text
state: operator_gated
resident reason: operator action required
declaration: omitted unless policy explicitly allows request-only tool
```

### Provider Unsupported

```text
state: blocked_by_provider
resident reason: provider/runtime does not expose required request shape
declaration: omitted
```

### Missing Result Envelope

```text
state: diagnostic_only
resident reason: tool lacks lawful result/context admission path
declaration: omitted
```

## Integration Points

Likely files/modules:

```text
src/main/direct/bridge/tool-capability-registry.js
src/main/direct/headless/tool-activation-registry.js
src/main/direct/headless/first-tool-slice.js
src/main/direct/bridge/resident-tool-epistemic-catalog.js
src/main/direct/transport/codex-responses-transport.js
src/main/direct/controller/live-text-controller.js
src/main/direct/agents/sub-agent-resident-declaration.js
src/main/direct/external/external-discovery-tools.js
src/main/direct/provider/hosted-tools.js
```

New likely modules:

```text
src/main/direct/bridge/role-lane-registry.js
src/main/direct/bridge/tool-bundle-composer.js
src/main/direct/bridge/tool-bundle-composition-witness.js
scripts/direct-role-lane-tool-bundle-composer-regression.mjs
scripts/direct-role-lane-live-declaration-smoke.mjs
```

## PR Sequence

### PR 120: Role Lane Registry And Static Composition Witness

Build:

```text
DirectRoleLaneRegistry
DirectRoleLaneSelection
DirectToolBundleComposerInput
ProviderDeclaredToolBundle schema
ToolBundleCompositionWitness schema
fixture composition for implementation worker lane
```

Required checks:

```text
RoleLaneSelection binds to AgentClassSpec / controlled route / normalized request refs.
Missing normalized request grounding blocks declaration in negative fixtures.
ProviderDeclaredToolBundle exists as an artifact even before live behavior changes.
```

No provider declaration changes yet.

### PR 121: Composer Over Existing Implementation Tools

Replace ad hoc implementation-lane tool selection with the composer for:

```text
read_file
apply_patch
run_command
```

The live behavior should remain identical, but every request gets a composition
witness and resident catalogue.

Required checks:

```text
old ad hoc selection = new composer selection
same declared tool names
same parallel_tool_calls=false
same live prompt class
same behavior after provider tool call
new composition witness attached
```

### PR 122: Promote Safe Resident Utility Tools

Declare safe read/control tools where policy allows:

```text
get_context_remaining
update_plan
request_user_input
```

No permission widening, no `new_context`, no raw image payloads.

Required semantic split:

```text
get_context_remaining = display/status witness only
update_plan = plan projection mutation only
request_user_input = bounded human-decision packet only
```

### PR 123: Promote Read-Only Sub-Agent Status Tools

Declare only:

```text
list_agents
inspect_agent
```

Conditional:

```text
wait_agent only if bounded wait remains read-like and non-interfering
```

Do not declare:

```text
spawn_agent
send_message
close_agent
interrupt_agent
resume_agent
recursive_spawn
```

This restriction applies to the default implementation-worker bundle. It does
not revoke the Wave 15/16 sub-agent or orchestrator-lane spawn path where the
active lane, objective, activation snapshot, and per-call authority law
explicitly allow `spawn_agent`.

### PR 124: Promote External Discovery Read-Only Tools

Declare only safe discovery/read tools when source identity is available:

```text
tool_search
list_mcp_resources
list_mcp_resource_templates
read_mcp_resource
```

Hard blockers:

```text
no server identity witness -> no read_mcp_resource declaration
ambiguous URI/server -> blocked catalogue row, not declaration
```

No dynamic MCP tool calls or plugin install.

### PR 125: Conditional Provider-Hosted Web Search

Declare:

```text
web_search
```

only when exact provider activation/request-shape evidence says callable.

Keep image generation operator-gated and catalogue-visible, not declared by
default.

Required negative fixture:

```text
provider profile says web_search exists
but request-shape proof is stale/missing
=> resident catalogue says blocked_by_runtime/provider
=> no provider declaration
```

## Acceptance Criteria

- Default implementation-lane behavior still supports read/patch/command.
- Every live direct request has a tool-bundle composition witness.
- Every live direct request has a first-class ProviderDeclaredToolBundle or an
  explicit no-tools bundle.
- Composition witnesses cite normalized lane request/source message/route
  evidence when available, and block declaration in fixtures where grounding is
  required but missing.
- Resident self-report can distinguish callable tools from known unavailable
  tools.
- Resident catalogue rows preserve granular implemented/promotion/activation/
  declaration/current-request axes, not only one flattened status.
- Non-omittable blocked rows prevent dangerous overclaim for stale web_search,
  operator-gated image_generation, future-wave dynamic MCP calls, and blocked
  new_context.
- No tool is provider-declared solely because it exists in the registry.
- Declaration-time eligibility remains separate from concrete per-call
  authority.
- Sub-agent interference tools are not declared by default.
- Default implementation-worker sub-agent restrictions do not revoke separately
  authorized orchestrator/sub-agent lane spawn capabilities.
- MCP dynamic tools and plugin install remain blocked/deferred.
- `read_mcp_resource` is declared only with explicit server/resource identity.
- Hosted web search is declared only with exact activation evidence.
- Image generation remains operator-gated by default.
- Stale/unknown provider facts produce blocked catalogue rows, not optimistic
  declarations.
- Headless live tests verify that resident answers match actual declared tools.
