# Direct Resident Agent Epistemic Access Spec

Status: draft implementation-wave spec.

Related docs:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md
docs/DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md
docs/DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md
docs/DIRECT_USAGE_QUOTA_MODEL_EVIDENCE_AND_MAINLINE_READINESS_SPEC.md
```

## Purpose

The direct resident agent should be in the know about the harness world.

It should not infer tool availability, sub-agent state, runtime posture, memory
state, context pressure, or authority blockers from indirect transcript clues
when the harness has structured evidence.

This wave creates a general **resident-agent epistemic access** layer:

```text
harness evidence
  -> sanitized epistemic witnesses
  -> compact resident context projection
  -> lawful agent self-knowledge
```

The goal is not to give the agent more authority by default. The goal is to
make the agent's situational awareness truthful.

Implementation placement:

```text
This wave belongs after the tool promotion/activation registry exists.

PR A may land early as generic snapshot infrastructure, but tool and sub-agent
epistemic rows should consume activation, promotion, worker-graph, and authority
artifacts instead of inventing their own semantics.
```

## Core Doctrine

Standing laws:

```text
epistemic access != control authority
control availability != per-call authorization
tool catalog != model-visible declaration
model-visible declaration != execution permission
sub-agent status visibility != interference permission
memory/context witness != permission to mutate memory/context
quota/account witness != account mutation authority
```

The resident agent should know both:

```text
what is callable in this request
what exists in the bridge but is unavailable, disabled, blocked, stale, or shadow-only
```

Absence of a callable tool should not force the agent to guess whether the tool
does not exist, is disabled, is waiting for operator activation, is appserver-only,
is blocked for this WorkThread, or is unavailable because auth/runtime evidence
is stale.

## Channel Split

Epistemic access must separate three channels.

```text
E-channel:
  what the resident agent may know

C-channel:
  what the resident agent may control or mutate

T-channel:
  what transcript/dialogue content exists
```

Sub-agent example:

```text
E-channel:
  Carver is running, using GPT-5.4-mini medium, currently writing an artifact.

C-channel:
  Parent may wait, but may not interrupt or send input because no-interference
  policy is active.

T-channel:
  Child prompt/reply/transcript may be summary-only, hidden until completion, or
  readable depending on the spawn envelope.
```

The harness should expose E-channel witnesses without automatically exposing
T-channel content or C-channel actions.

## Epistemic Meta-Schema

All resident epistemic projections should be rows inside one expandable
snapshot format.

```ts
type ResidentEpistemicSnapshot = {
  schema: "resident_epistemic_snapshot@1";
  snapshotId: string;
  workThreadId: string;
  codexThreadId?: string;
  runtimeFamily: "direct" | "appserver";
  generatedAt: string;
  freshnessMs: number;
  projectionBudget: {
    maxRows: number;
    maxChars: number;
    truncationPolicy: "priority_then_summary" | "summary_only";
  };
  snapshotCompleteness:
    | "complete"
    | "budgeted_with_omissions"
    | "summary_only"
    | "class_filtered"
    | "stale_or_partial";
  omittedClassCounts: Record<string, number>;
  declarationDigest?: string;
  sourceDigests: string[];
  rows: ResidentEpistemicRow[];
  compactResidentText: string;
  compactTextDigest: string;
  compactTextRendererVersion: string;
  compactTextSourceRowIds: string[];
};

type ResidentEpistemicRow = {
  schema: "resident_epistemic_row@1";
  rowId: string;
  subjectKind:
    | "tool"
    | "sub_agent"
    | "runtime"
    | "provider"
    | "quota"
    | "context"
    | "memory"
    | "baton"
    | "workspace"
    | "thread"
    | "work_thread"
    | "skill"
    | "hook"
    | "app"
    | "browser"
    | "headless_route"
    | "approval"
    | "account_action"
    | "analytics"
    | "unknown";
  subjectId: string;
  displayLabel: string;
  family?: string;
  status:
    | "callable_now"
    | "known_available"
    | "known_disabled"
    | "shadow_only"
    | "not_implemented"
    | "blocked_by_policy"
    | "blocked_by_missing_evidence"
    | "blocked_by_auth"
    | "blocked_by_runtime"
    | "blocked_by_workthread"
    | "temporarily_unavailable"
    | "stale"
    | "unknown";
  knowledgeClass:
    | "exact_runtime"
    | "harness_observed"
    | "registry_declared"
    | "derived_projection"
    | "fixture_only"
    | "unknown";
  residentVisible: boolean;
  callableInCurrentRequest: boolean;
  declaredAsProviderTool: boolean;
  controlState:
    | "not_applicable"
    | "known_available"
    | "callable_now"
    | "blocked_by_policy"
    | "blocked_by_missing_authority"
    | "blocked_by_runtime"
    | "shadow_only"
    | "unknown";
  perCallAuthorityRequired: boolean;
  channels: {
    epistemic: {
      visibleToResident: boolean;
      visibility:
        | "full_status"
        | "summary_only"
        | "count_only"
        | "blocked"
        | "unknown";
    };
    control: {
      controlAvailable: boolean;
      availableActions: string[];
      blockedActions: string[];
      authorityRequired: boolean;
    };
    transcript: {
      transcriptVisible:
        | "full"
        | "summary_only"
        | "metadata_only"
        | "blocked"
        | "not_applicable";
      transcriptSourceRefs: ResidentEvidenceRef[];
    };
  };
  epistemicUse:
    | "self_status"
    | "planning_context"
    | "avoidance_context"
    | "diagnostic_only"
    | "operator_explanation";
  authorityUse:
    | "none"
    | "may_prepare_call"
    | "may_request_authority"
    | "may_not_act";
  priority: "critical" | "high" | "normal" | "low" | "diagnostic";
  omitWhenBudgeted: boolean;
  conflictState:
    | "none"
    | "source_mismatch"
    | "policy_overrides_activation"
    | "stale_activation"
    | "runtime_contradiction"
    | "unknown";
  conflictResolution:
    | "strictest_blocker_wins"
    | "freshest_exact_evidence_wins"
    | "operator_review_required"
    | "diagnostic_only";
  freshness: "fresh" | "expiring" | "stale" | "unknown";
  staleBehavior:
    | "include_with_warning"
    | "omit_row"
    | "summarize_as_stale"
    | "block_context_injection";
  scope: "global" | "project" | "work_thread" | "thread" | "turn" | "request";
  blockerCodes: string[];
  enablementPath: ResidentEnablementStep[];
  evidenceRefs: ResidentEvidenceRef[];
  lastObservedAt?: string;
  expiresAt?: string;
  compactText: string;
  rawPayloadExposed: false;
  extensions?: Record<string, unknown>;
};

type ResidentEnablementStep = {
  kind:
    | "operator_enablement"
    | "auth_login"
    | "capability_promotion"
    | "runtime_switch"
    | "policy_change"
    | "live_probe"
    | "implementation_required"
    | "not_supported";
  label: string;
  authorityRequired: boolean;
  enablementPathUse:
    | "operator_explanation_only"
    | "agent_may_request_operator"
    | "agent_must_not_request";
};

type ResidentEvidenceRef = {
  refId: string;
  source:
    | "activation_registry"
    | "promotion_decision"
    | "tool_declaration"
    | "agent_graph"
    | "sub_agent_e_channel"
    | "runtime_status"
    | "provider_metadata"
    | "quota_snapshot"
    | "context_pack"
    | "memory_frontier"
    | "workspace_policy"
    | "headless_daemon"
    | "audit_row";
  digest?: string;
};
```

Compact text law:

```text
compactResidentText is derived only from sanitized rows.
compactResidentText cannot introduce facts absent from rows.
compactResidentText must preserve stale, unknown, blocker, and conflict labels.
```

Unknown/omission law:

```text
Budget truncation must not recreate false absence. When a relevant class is
omitted or not represented, emit an unknown or omitted-class summary row so the
resident agent knows not to infer nonexistence.
```

Extensibility rule:

```text
Add new subjectKind values only when a new class has distinct epistemic,
authority, freshness, or privacy law.

Use `extensions` only for class-specific display/detail fields. Do not hide
status, blockers, authority, freshness, or evidence in extensions.
```

## Main Epistemic Classes

### Tool Catalog Epistemics

Purpose:

```text
Tell the resident agent what tools exist, what is callable now, and why other
known tools are unavailable.
```

Row families:

```text
read
write
command
context
sub_agent
browser
memory
account
diagnostic
external_resource
provider_hosted
```

Resident example:

```text
Tools:
- read_file: callable now; path/size/redaction policy applies.
- get_context_remaining: callable now; estimate only.
- apply_patch: known disabled; requires direct tool activation for this WorkThread.
- spawn_agent: known disabled; lifecycle tool class not activated.
- rate_limit_reset_credit.consume: known disabled; account mutation requires operator confirmation.
```

### Sub-Agent Epistemics

Purpose:

```text
Tell the parent/orchestrator what sub-agents exist, what they are doing, what the
parent may observe, and what the parent may control.
```

Sub-agent row extension:

```ts
type ResidentSubAgentEpistemicExtension = {
  agentId: string;
  alias?: string;
  role?: string;
  model?: string;
  reasoningEffort?: string;
  parentAgentId?: string;
  lifecycle:
    | "not_started"
    | "running"
    | "waiting"
    | "blocked"
    | "completed"
    | "failed"
    | "closed"
    | "unknown";
  currentActivity?: {
    kind:
      | "thinking"
      | "tool_call"
      | "waiting_for_provider"
      | "waiting_for_parent"
      | "writing_artifact"
      | "idle"
      | "unknown";
    label: string;
    startedAt?: string;
    evidenceRef?: ResidentEvidenceRef;
  };
  observationPolicy: {
    status: "allowed" | "blocked";
    transcript: "allowed" | "summary_only" | "blocked";
    artifacts: "allowed" | "refs_only" | "blocked";
    usage: "allowed" | "blocked";
  };
  controlPolicy: {
    sendInput: "allowed" | "blocked";
    interrupt: "allowed" | "blocked";
    close: "allowed" | "blocked";
    resume: "allowed" | "blocked";
    modifyContext: "allowed" | "blocked";
    overrideInstructions: "allowed" | "blocked";
  };
  transcriptWitness: {
    visibility: "allowed" | "summary_only" | "blocked";
    transcriptDigest?: string;
    summaryDigest?: string;
    hiddenTurnCount?: number;
    hiddenCharEstimate?: number;
  };
};
```

### Governance Envelope And No-Interference Self-Binding

Sub-agent spawning should support a governance envelope:

```ts
type SubAgentGovernanceEnvelope = {
  schema: "sub_agent_governance_envelope@1";
  envelopeId: string;
  workThreadId: string;
  parentAgentId: string;
  childAgentId: string;
  childRole?: string;
  observationPolicy: ResidentSubAgentEpistemicExtension["observationPolicy"];
  parentControlPolicy: ResidentSubAgentEpistemicExtension["controlPolicy"];
  selfBinding: {
    mode:
      | "free_control"
      | "observe_only"
      | "sealed_audit"
      | "blind_run"
      | "operator_locked"
      | "time_boxed"
      | "handoff_only"
      | "custom";
    mutableByParent: false;
    releaseRequires:
      | "operator_confirmation"
      | "audit_artifact"
      | "timeout"
      | "child_completion"
      | "never";
    releaseState:
      | "not_releasable"
      | "waiting_for_operator"
      | "waiting_for_audit_artifact"
      | "waiting_for_timeout"
      | "waiting_for_child_completion"
      | "released"
      | "expired"
      | "unknown";
    reason: string;
  };
  releaseEvidenceRefs: ResidentEvidenceRef[];
  evidenceRefs: ResidentEvidenceRef[];
};
```

No-interference law:

```text
A self-binding must remove interfering actions from future callable/control
surfaces. It must not be implemented only as a prompt instruction.

No-interference policy must also remove or block provider-declared sub-agent
control tools for the parent request. Hiding UI controls is insufficient if the
provider request still declares `sendInput`, `interrupt`, `close`, `resume`, or
other interfering tools.
```

For `observe_only`, the parent can receive E-channel status but cannot send
input, interrupt, close, resume, modify context, or override instructions unless
the envelope's release condition is satisfied.

### Runtime, Provider, Model, Quota, And Account Epistemics

Purpose:

```text
Tell the resident agent the current runtime/account/model posture without
exposing secrets or granting account mutation authority.
```

Included facts:

```text
runtime family and selected route
model catalog and current model/effort/service-tier evidence
context window and context pressure evidence
quota/rate-limit windows
reset-credit availability
account action availability and blocker codes
auth state class, never raw account ids/tokens/emails
```

Account mutation law:

```text
Read-only account witnesses may be visible to the resident agent.
Account mutations, including rate-limit reset credit consumption, require an
explicit authority transition and operator confirmation.

Account mutation rows are excluded from normal resident context by default.
They may appear in settings-only context or in normal resident context only when
quota pressure exists or an explicit policy enables account-action witnesses.
```

### Context, Memory, Baton, And Compaction Epistemics

Purpose:

```text
Tell the resident agent what context exists, what was omitted, what memory/frontier
state is active, and which compaction/refresh actions are possible or blocked.
```

Included facts:

```text
context pack id/digest/freshness
omission and context-loss witnesses
memory review/refresh/reset proposal state
baton/frontier freshness
compaction readiness and blockers
current-context budget posture
```

Law:

```text
Knowing a memory or context action exists does not authorize the resident agent
to mutate memory, compact, reset, or continue with hidden omitted context.
```

### Workspace And Artifact Epistemics

Purpose:

```text
Tell the resident agent what workspace/action surface is available and which
artifact/workspace operations are blocked or available.
```

Included facts:

```text
workspace root evidence key
worktree mutation policy
read/write/command boundaries
staged attachment/project stash state
file viewer/stash/send-to-GPT capability posture
mutation truth and replay/recovery classification
```

No raw absolute paths should be exposed unless the existing context/file policy
already allows the specific path projection.

### Skills, Hooks, Apps, MCP, And External Capability Epistemics

Purpose:

```text
Tell the resident agent what bridge modules and external capability classes are
known, classified, available, disabled, or blocked.
```

Law:

```text
Discovery/classification is not execution.
```

Rows should distinguish:

```text
installed/declared
classified
disabled by policy
available as read-only schema
available as callable tool
blocked by auth
blocked by missing server
blocked by missing promotion
```

### Browser, Web, ChatGPT, And Headless Route Epistemics

Purpose:

```text
Tell the resident agent what browser/web/headless routes exist and what they can
or cannot do.
```

Included facts:

```text
middle web tab link-opening status
file viewer status
ChatGPT linked-thread bridge status
project stash status
headless daemon route availability
event ingress/egress route availability
```

Law:

```text
The resident agent may know that a route exists, but route execution still
requires the route's authority gate.
```

### Thread, WorkThread, Goal, And Orchestration Epistemics

Purpose:

```text
Tell the resident agent which work-world it is operating in and what orchestration
state is known.
```

Included facts:

```text
WorkThread identity
Codex/direct thread identity
goal/arc/phase state if available
open obligations
active constraints
meta-orchestrator transition status
audit/fix/worker role states
stale or ambiguous routing blockers
```

## Resident Context Injection

The resident agent should not receive the entire raw snapshot every turn.

Instead:

```text
full snapshot:
  persisted locally, renderer-safe and audit-readable

compact resident text:
  included in model context when useful and within budget

on-demand detail:
  exposed through a safe status/read tool after activation
```

When injected, epistemic access must be a distinct context item:

```ts
type ResidentEpistemicContextItem = {
  schema: "resident_epistemic_context_item@1";
  snapshotId: string;
  snapshotDigest: string;
  compactTextDigest: string;
  includedRowIds: string[];
  omittedClassCounts: Record<string, number>;
  authority: "harness_epistemic_witness";
  grantsAuthority: false;
};
```

It must not be merged invisibly into system/developer text. Context auditors
should be able to identify it as a harness witness, not policy or user
instruction.

Compact format example:

```text
Harness status:
- Runtime: direct; model GPT-5.5 medium; context 31% used.
- Tools callable now: read_file, get_context_remaining.
- Known disabled tools: apply_patch requires activation; spawn_agent not activated;
  rate-limit reset requires operator confirmation.
- Sub-agents: Carver running observe-only; status/artifacts visible, interference blocked.
- Memory: baton fresh; 2 omitted context witnesses; no compaction authority.
```

Injection rules:

```text
Do not include raw secrets, tokens, account ids, emails, full hidden transcript,
raw tool payloads, or unredacted file contents.

Prefer blockers and enablement paths over verbose implementation details.

If the snapshot is stale, tell the resident agent it is stale.

If a capability is missing from the snapshot, the agent should treat it as
unknown, not unavailable.
```

## Wave 12 PR Plan

This sequence is tracked in the main roadmap as Wave 12 / PR 73-77.

### PR 73: Resident Epistemic Snapshot Foundation

Status: merged in branch `codex/direct-resident-epistemic-snapshot`.

Purpose:

```text
Create the generic resident epistemic snapshot schema, row taxonomy, serializer,
privacy scanner, compact renderer, and fixture tests.
```

Scope:

- Add `resident_epistemic_snapshot@1`.
- Add `resident_epistemic_row@1`.
- Add `ResidentEpistemicSnapshotBuilder`.
- Add compact text renderer with truncation policy.
- Add E/C/T channel fields.
- Add row priority, row-level freshness, conflict state, conflict resolution,
  snapshot completeness, omitted class counts, compact text digest, renderer
  version, and source row ids.
- Add source digest/freshness/staleness handling.
- Add redaction/raw-exposure scanner.
- Add tests for schema validation, row ordering, status taxonomy, stale data,
  missing data, compact text provenance, omitted classes, and no raw secrets.

Non-goals:

```text
No context injection yet.
No new tool declarations.
No sub-agent control changes.
No runtime/account mutation.
```

### PR 74: Resident Tool Epistemic Catalog

Status: planned.

Purpose:

```text
Give the resident agent truthful knowledge of callable and non-callable tools.
```

Scope:

- Project activation registry, promotion decision, declaration snapshot, and
  per-call gate state into tool epistemic rows.
- Distinguish `callable_now`, `shadow_only`, `known_disabled`,
  `blocked_by_policy`, `blocked_by_missing_evidence`, `blocked_by_auth`,
  `blocked_by_runtime`, and `not_implemented`.
- Generate enablement paths for each blocked tool family.
- Build compact tool-status preview, but do not inject it into normal resident
  context by default until PR E.
- Allow optional headless debug injection behind an explicit test flag.
- Add deterministic context-build tests for compact preview row inclusion,
  omitted-class witnesses, stale/declaration mismatch handling, and raw-exposure
  exclusion.
- Add model self-report smoke tests as supplemental evidence, not the sole gate.

`callable_now` requires:

```text
activation row active for scope
provider declaration included in this request, or the tool is not provider-declared
per-call authority envelope exists
no emergency revoke
recovery state safe
row freshness not stale
```

Non-goals:

```text
No activation of new tools.
No automatic promotion.
No per-call authority bypass.
No default context injection except explicit debug/test mode.
```

### PR 75: Sub-Agent E-Channel And Governance Envelope

Status: planned.

Purpose:

```text
Give orchestrators resident-visible sub-agent state, while separating observation
from control.
```

Scope:

- Add `sub_agent_governance_envelope@1`.
- Add sub-agent epistemic rows from the worker graph and runtime state.
- Expose lifecycle, model/effort, role, current activity, observable witnesses,
  and control blockers.
- Add no-interference policies: `observe_only`, `sealed_audit`, `blind_run`,
  `operator_locked`, `time_boxed`, and `handoff_only`.
- Enforce parent self-binding by removing blocked actions from future control
  surfaces and provider declarations, not merely adding prompt text.
- Add release-state and release-evidence projection.
- Add transcript witness digests/counts for hidden or summary-only child
  transcripts.
- Add tests for observe-only spawn, stale child status, child completion, release
  conditions, provider-declaration blocking, and no child transcript flattening.

Non-goals:

```text
No broad sub-agent spawning unless the lifecycle tool is already activated.
No hidden transcript exposure.
No parent override without release authority.
```

### PR 76: Bridge-System Epistemic Classes

Status: planned.

Purpose:

```text
Extend epistemic access beyond tools/sub-agents to the main bridge organs.
```

Scope:

- Add runtime/provider/model/quota/account rows.
- Add context/memory/baton/compaction rows.
- Add workspace/artifact/stash rows.
- Add skills/hooks/apps/MCP/external capability rows.
- Add browser/web/ChatGPT/headless route rows.
- Add thread/WorkThread/goal/orchestration rows.
- Keep all rows read-only witnesses.
- Add class-specific compact summaries and fixture coverage for blocked,
  stale, unknown, unsupported, and exact-runtime states.

Non-goals:

```text
No account mutation.
No memory mutation.
No browser automation.
No MCP execution.
No route execution.
```

### PR 77: Resident Epistemic Context Policy And UX

Status: planned.

Purpose:

```text
Make epistemic access operator-visible and reliably included in resident context
under policy.
```

Scope:

- Add per-project/work-thread policy for which epistemic classes are included in
  resident context.
- Add settings/status UI showing the full snapshot and compact injected form.
- Add snapshot freshness warnings.
- Add per-class stale behavior policy:
  `include_with_warning`, `omit_row`, `summarize_as_stale`, or
  `block_context_injection`.
- Add context-budget-aware row prioritization.
- Add `resident_epistemic_context_item@1`.
- Add diagnostics when the agent gives a wrong self-report relative to the
  current snapshot.
- Add deterministic context-pack tests for snapshot digest, included row ids,
  omitted class counts, compact text digest, stale warnings, and no authority
  grants.
- Add model self-report smoke tests as supplemental coverage.

Non-goals:

```text
No manual editing of raw epistemic rows.
No user-defined arbitrary prompt injection through this surface.
No promotion of disabled capabilities.
```

## Acceptance Criteria

- Every row explicitly separates E-channel, C-channel, and T-channel visibility.
- `residentVisible`, `callableInCurrentRequest`, and `declaredAsProviderTool`
  are separate fields.
- The resident agent can state what tools are callable now and what known tool
  classes are disabled or blocked.
- The resident agent can state why a known tool is unavailable and what class of
  action would enable it.
- Missing tool visibility is explicit: unknown is not treated as nonexistent.
- Snapshot completeness and omitted class counts are represented.
- Compact resident text is generated only from sanitized rows and cites source
  row ids/digests.
- Resident epistemic context is injected as a distinct
  `resident_epistemic_context_item@1` harness witness, not merged invisibly into
  system/developer text.
- Stale callable rows degrade from `callable_now` to `stale` or blocked status.
- Sub-agent state is visible through E-channel witnesses without transcript
  flattening or control leakage.
- A no-interference spawn policy removes interfering parent actions from future
  control surfaces and provider tool declarations.
- Account mutation rows are excluded from normal resident context unless
  policy/pressure enables them.
- Enablement paths declare whether the model may ask the operator or only
  explain status.
- Epistemic rows never expose raw secrets, auth tokens, account ids, raw hidden
  transcripts, raw tool payloads, or unredacted file content.
- Epistemic access is freshness-aware and stale snapshots are labeled stale.
- Compact resident context is budgeted, deterministic, and cites a snapshot
  digest.
- UI projections and model context consume the same sanitized snapshot.
- Deterministic context-pack tests are required; model self-report tests are
  supplemental smoke tests.
- Epistemic access does not activate tools, mutate memory, mutate account state,
  approve requests, or perform workspace mutations.

## Failure Classes To Test

```text
epistemic-control collapse:
  agent knows a control exists and treats that knowledge as permission

epistemic-transcript collapse:
  agent sees child/subsystem status and treats hidden transcript as known

snapshot laundering:
  stale snapshot row treated as current runtime truth

enablement nagging:
  model interprets enablement path as instruction to repeatedly ask the user

context smuggling:
  hidden transcript/tool payload leaks through compact status

authority inflation:
  known_disabled becomes callable or requestable without activation

declaration mismatch:
  snapshot says callable_now but provider declaration is absent

interference leak:
  observe-only hides UI controls but provider-declared send/interrupt tool remains callable

unknown erasure:
  omitted class disappears and model infers it does not exist
```

## Open Design Decisions

- Whether the resident agent should receive all `known_disabled` tool rows by
  default, or only high-value disabled classes plus a count of hidden classes.
- Whether sub-agent activity detail should be pushed every turn or exposed
  through an on-demand status tool after PR B.
- Whether no-interference policies should be selectable only by the operator, or
  also by an orchestrator when its current role contract allows self-binding.
- Exact per-project default for account mutation rows. Baseline recommendation:
  quota witnesses may be normal context; mutation actions such as reset-credit
  consumption are settings-only or pressure-triggered.
- Whether compact resident text should be injected every direct turn or only
  when the current task or tool state makes it useful. It should be injected as a
  distinct harness witness item, not merged into system/developer text.
