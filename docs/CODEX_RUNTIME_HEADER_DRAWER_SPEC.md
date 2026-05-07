# Codex Runtime Header And Drawer Spec

Status: implementation spec for the Codex plane runtime constitution header and
Runtime Inspector drawer.

Visual source artifact:

- [codex top banner.png](./codex%20top%20banner.png)

Related specs:

- [CODEX_INTERNAL_KNOBS_ODEU_MAP.md](./CODEX_INTERNAL_KNOBS_ODEU_MAP.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)
- [CODEX_SURFACE_PROJECT_RENDERING_SPEC.md](./CODEX_SURFACE_PROJECT_RENDERING_SPEC.md)

## Purpose

Turn the Codex plane top banner into a first-class runtime control surface.

The transcript/feed lane must remain the evidence and history stream. Runtime
settings, authority state, usage, environment, and capabilities belong in a
separate header plus drawer system. The header should show compact live
constitutional state. The drawer should expose the same state with provenance,
diagnostics, and explicit mutation boundaries.

Chosen visual direction:

```text
Variant 2 as the default header shape
Variant 4's Runtime drawer trigger as the deep inspection entrypoint
Variant 3's segmented taxonomy moved inside the drawer
```

## Skill Run Stance

This spec follows the Morphic UX frontend doctrine.

```text
task_mode: design
execution_mode: standard
grounding_status: repo_grounded
implementation_inspection_status: implementation_inspected
```

Portable grounding matrix:

```yaml
grounding:
  doctrine: borrowed_from_morphic_ux_skill
  reference_family: borrowed_from_adeu_artifact_inspector
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: not_observed_for_this_spec
profile_lineage:
  base_profile: artifact_inspector_reference
  derivative_profile: codex_runtime_constitution_header
  profile_status: proposed_local
```

Grounding:

- Prototype image exists under `docs/codex top banner.png`.
- Current Codex surface header is implemented in `src/renderer/codex-surface.html`.
- Current header state is wired in `src/renderer/codex-surface.js`.
- Runtime capability data originates in `src/main/codex-app-server.js`.
- Server-request authority handling exists in `src/main/codex-surface-session.js`.

## Morphic UX Contract

The surface is allowed to morph. The governing meaning is not.

### Invariants

- Header = current runtime constitution.
- Feed = event, transcript, approval, and evidence history.
- Composer = next transition request and optional per-turn overrides.
- Drawer = same-context runtime inspection and bounded settings.
- Mutable controls must look different from read-only witnesses.
- Unknown state must render as unknown, degraded, or unavailable, never as success.
- Authority-sensitive settings require evidence and explicit commit.
- Banners and chips must reflect runtime evidence, not merely project config.
- Capability absence is not permission.
- Runtime mutation controls must fail closed unless explicit positive capability evidence exists.
- A requested transition is not the same as a rendered or live-attached transition.
- The drawer may expose capability absence and degraded behavior; it must not hide unavailable actions when that absence explains the surface state.

### Morphable Choices

- Exact chip density and wrapping behavior.
- Drawer tab order.
- Whether branch/PR chips collapse at narrow widths.
- Whether usage appears as a chip or only in the drawer when unavailable.
- Exact copy and color treatment for warnings and degraded states.

### Selected Morph Profile

| Axis | Choice | Reason |
| --- | --- | --- |
| `density` | medium | Keep the header scannable while surfacing high-value runtime state. |
| `navigation_mode` | simultaneous context | Header, feed, and composer stay visible; drawer overlays or docks without replacing the plane. |
| `information_posture` | state-first with evidence drilldown | The header shows current truth; drawer shows proof and diagnostics. |
| `interaction_tempo` | expert-fast, gated for authority | Common state is one glance away; risky changes require explicit confirmation. |
| `salience_posture` | identity plus authority | Thread/runtime identity and access mode must dominate over decorative meta. |
| `state_exposure` | explicit | Unknown, stale, requested, rendered, live-attached, failed, and degraded states must be distinguishable. |
| `command_posture` | separated safe/commit lanes | Read-only inspection is cheap; settings commits are bounded and visible. |

## Surface Topology

```text
CodexPlane
  HeaderRegion
    IdentityRow
    RuntimeStateRow
  FeedRegion
    Transcript
    ThoughtProcess
    ToolCalls
    ApprovalCards
    EvidenceEvents
  ComposerRegion
    PromptInput
    NextTurnOverrideSummary
    SendAction
  RuntimeInspectorDrawer
    RuntimeTab
    ModelTab
    AccessTab
    UsageTab
    CapabilitiesTab
    EnvironmentTab
    AdvancedTab
```

Semantic zones:

```text
Header = current runtime constitution
Feed = evidence/history stream
Composer = next transition request
Drawer = inspection and bounded configuration
```

## Header Projection

Use a two-row header.

### Row 1: Identity And Session

Target shape:

```text
CODEX PLANE
Map next ARC series                         [WSL] [prolite · email] [gpt-5.5 ▾]
```

Required content:

- Plane label: `CODEX PLANE`.
- Active Codex thread title from successful render/live attach evidence.
- Runtime chip: `WSL`, `host`, `local`, `remote`, or `offline`.
- Account chip: plan and email when `account/read` proves it; otherwise `login required`, `account unknown`, or `account unavailable`.
- Model chip: active model and dropdown marker only when model selection is supported.

Row 1 must optimize for quick recognition: which thread, which runtime, which
account, which model.

### Row 2: Runtime State And Controls

Target shape:

```text
/home/rose/work/LexLattice/odeu             [reasoning: high ▾] [access: approval ▾] [Runtime]
```

Expanded when enough width/evidence exists:

```text
odeu / v73-b / PR #432                      [reasoning: high ▾] [access: approval ▾] [usage: 41% ▾] [Runtime]
```

Required content:

- CWD/workspace path.
- Repo chip when Git evidence is available.
- Branch chip when Git evidence is available.
- PR chip only when evidence exists from GitHub/branch metadata.
- Reasoning chip when runtime supports effort selection.
- Access chip from approval/sandbox/permission profile evidence.
- Usage chip only when usage/context evidence exists; otherwise hide or show `usage: unknown` in diagnostic posture.
- `Runtime` drawer trigger, always visible when the Codex surface is active.

Row 2 must separate mutable settings from witnesses.

Mutable controls:

```text
[gpt-5.5 ▾]
[reasoning: high ▾]
[access: approval ▾]
```

Read-only witnesses:

```text
[WSL]
[prolite · email]
[repo: odeu]
[branch: v73-b]
[PR #432]
[usage: 41%]
[cwd: /home/rose/...]
```

Read-only chips may open the drawer to the relevant tab, but should not look like
direct mutation controls.

Usage label rule:

- `usage: 41%` is allowed only when it comes from provider/runtime evidence, such
  as OpenAI account quota telemetry for five-hour or weekly usage windows.
- Local activity counts, context pressure, and provider quota are different
  evidence classes and must not be collapsed into one percentage.
- If provider quota is not exposed, show `usage: unknown`, `quota: not exposed`,
  or omit the header chip and explain the absence in the drawer.

## Runtime Inspector Drawer

Open the drawer from:

- `Runtime` button.
- Any header chip click.
- Middle-plane future pending runtime diagnostics links.

Drawer behavior:

- Right-side drawer, not a modal.
- Does not block transcript reading.
- Can be dismissed without changing state.
- Opens on the tab most relevant to the triggering chip.
- Shows last updated timestamp and evidence source for each section.
- Uses disabled-but-visible controls for unsupported or degraded actions.

Tabs:

### Runtime

Purpose: identify the attached Codex runtime and transport.

Fields:

- Runtime kind: WSL, host, local, remote, fallback, offline.
- Binary path and resolved path.
- Codex version and fork identity when proven.
- App-server URL/transport kind.
- Readiness state and startup attempts.
- Active Codex home/source home.
- Thread open state: requested, dispatched, rendered stored, attached live, failed.
- Schema/capability profile source.

Mutable actions:

- None in v0.

### Model

Purpose: configure default model and reasoning posture.

Fields:

- Active model.
- Available models from `model/list` when supported.
- Reasoning effort.
- Reasoning summary/verbosity if supported.
- Provider/account evidence.
- Per-thread/project default source.
- Capability split:
  `canList`, `canSetNextTurn`, `canSetSessionDefault`,
  `canSetProjectDefault`, and `canLiveUpdate`.

Mutable actions:

- Change session/project default model only when the relevant scope has explicit
  capability evidence.
- Change session/project default reasoning effort only when the relevant scope
  has explicit capability evidence.

Commit boundary:

- Show before/after summary.
- Apply to new turns only unless the protocol explicitly supports live update.
- If only per-turn override is supported, label it as next-turn only.

### Access

Purpose: expose authority-sensitive controls and current enforcement state.

Fields:

- Approval policy.
- Sandbox mode or permission profile.
- Network mode.
- Write roots and protected carveouts when available.
- Git authority posture.
- Pending approval count.
- Last approval decision summary.

Header label rule:

- Show `access: requests gated` when the shell proves it can handle
  command/file/permission approval requests but does not yet know the full
  sandbox/network/write policy.
- Show `access: policy unknown` when neither approval-request handling nor
  policy evidence is available.
- Show `access: restricted`, `access: approval`, or `access: danger-full-access`
  only when the attached runtime exposes enough policy evidence.

Mutable actions:

- Change approval policy only with explicit confirmation.
- Change sandbox/permission profile only with explicit confirmation.
- Never silently promote to `danger-full-access`.

Commit boundary:

- Authority changes must display risk copy and affected scope:
  `next turn`, `session`, `project default`, or `unsupported`.

### Usage

Purpose: show consumption and pressure, without inventing false precision.

Fields:

- Provider quota usage when exposed by the runtime/provider, including OpenAI
  account five-hour and weekly quota percentages when available.
- Context/token pressure if provided by app-server events.
- Local activity: session duration, turn count, command count, approval count,
  and tool-call count.
- Cost/limit info only when runtime/provider exposes it.

Unsupported behavior:

- If exact model quota is unavailable, show `not exposed by runtime`.
- Do not estimate provider quota or context pressure as if authoritative.
- Local activity may be shown as activity, not as quota.

### Capabilities

Purpose: project the `ShellVisibleCodexCapabilities` profile.

Fields:

- Supported thread operations.
- Supported turn operations.
- Supported server-request methods.
- Supported content item types.
- Supported model/config knobs.
- Unsupported or degraded actions.
- Schema provenance.
- Experimental API state.

Behavior:

- Capability absence must explain disabled controls.
- Fork-specific capabilities must require explicit evidence.
- No path-name guessing.

### Environment

Purpose: show workspace and repo facts.

Fields:

- Workspace kind and root.
- CWD used for `thread/start` / `thread/resume`.
- Git top-level.
- Branch.
- PR.
- Dirty-state summary.
- Local hygiene state, including ignored Codex sandbox placeholder.
- Platform details.

Mutable actions:

- Reveal/open workspace paths.
- Copy diagnostics.
- No Git mutation in v0.

### Advanced

Purpose: hold diagnostics and non-primary details.

Fields:

- Raw capability profile projection.
- Connection logs.
- Last app-server errors.
- Request registry diagnostics.
- Transport auth mode, without raw token values.
- Schema compatibility mode.

Mutable actions:

- Copy diagnostic bundle.
- Refresh capability probe if safe.

## Composer Controls

The composer must not become the full settings surface.

Composer may show only next-turn override summary:

```text
Ask Codex...
[next turn: gpt-5.5 / high / approval ▾] [Send]
```

Allowed next-turn overrides:

- Model.
- Reasoning effort.
- Access mode only if protocol supports per-turn approval/sandbox/permission override and the user confirms scope.

Rules:

- Defaults live in the header/drawer.
- Per-turn overrides must be visibly scoped to the next turn.
- Sending a turn must include an explicit summary when overrides differ from defaults.

## Evidence Model

Header and drawer state must derive from evidence objects.

```ts
type RuntimeTruth =
  | "runtime_proven"
  | "runtime_declared"
  | "project_configured"
  | "renderer_observed"
  | "operator_requested"
  | "inferred"
  | "unknown"
  | "unsupported";

type RuntimeStateStatus =
  | "ready"
  | "loading"
  | "stale"
  | "degraded"
  | "failed"
  | "unavailable";

type RuntimeMutationScope =
  | "next_turn"
  | "session_default"
  | "project_default"
  | "live_thread";

type EvidenceRef = {
  id: string;
  kind:
    | "runtime_snapshot"
    | "app_server_probe"
    | "account_read"
    | "workspace_backend"
    | "git_probe"
    | "github_probe"
    | "project_config"
    | "renderer_observation"
    | "operator_action"
    | "provider_quota"
    | "inference";
  label: string;
  observedAt: string;
  status: "fresh" | "stale" | "failed" | "unavailable";
  confidence: "proven" | "declared" | "configured" | "observed" | "inferred" | "unknown";
};

const RUNTIME_TRUTH_FROM_EVIDENCE_CONFIDENCE = {
  proven: "runtime_proven",
  declared: "runtime_declared",
  configured: "project_configured",
  observed: "renderer_observed",
  inferred: "inferred",
  unknown: "unknown",
} as const;

type RuntimeMutationSupport = {
  enabledScopes: RuntimeMutationScope[];
  unsupportedReason?: string;
  evidenceRefs: EvidenceRef[];
};

type RuntimeHeaderChip = {
  id: string;
  label: string;
  tab: "runtime" | "model" | "access" | "usage" | "capabilities" | "environment" | "advanced";
  role: "mutable_control" | "read_only_witness" | "diagnostic";
  truth: RuntimeTruth;
  status: RuntimeStateStatus;
  evidenceRefs: EvidenceRef[];
};

type CodexRuntimeHeaderState = {
  schemaVersion: 1;
  sourceRevision: string;
  projectId: string;
  planeId?: string;
  thread: {
    threadId: string;
    title: string;
    source: "rendered_stored" | "attached_live" | "project_binding" | "unknown";
    status: "requested" | "dispatched" | "rendered_stored" | "attached_live" | "failed" | "unknown";
    evidenceRefs: EvidenceRef[];
    updatedAt?: string;
  };
  runtime: {
    kind: "wsl" | "host" | "local" | "remote" | "fallback" | "offline" | "unknown";
    label: string;
    truth: RuntimeTruth;
    status: RuntimeStateStatus;
    evidenceRefs: EvidenceRef[];
  };
  account: {
    label: string;
    status: "ready" | "login_required" | "unknown" | "unavailable";
    truth: RuntimeTruth;
    evidenceRefs: EvidenceRef[];
  };
  model: {
    label: string;
    source: "project_config" | "runtime_reported" | "turn_override" | "unknown";
    selection: {
      canList: boolean;
      canSetNextTurn: boolean;
      canSetSessionDefault: boolean;
      canSetProjectDefault: boolean;
      canLiveUpdate: boolean;
    } & RuntimeMutationSupport;
    truth: RuntimeTruth;
    evidenceRefs: EvidenceRef[];
  };
  reasoning: {
    label: string;
    selection: {
      canSetNextTurn: boolean;
      canSetSessionDefault: boolean;
      canSetProjectDefault: boolean;
      canLiveUpdate: boolean;
    } & RuntimeMutationSupport;
    truth: RuntimeTruth;
    evidenceRefs: EvidenceRef[];
  };
  access: {
    label: string;
    posture:
      | "requests_gated"
      | "policy_unknown"
      | "restricted"
      | "approval"
      | "danger_full_access"
      | "offline"
      | "unknown";
    policyKnown: boolean;
    requestHandlingKnown: boolean;
    mutableScopes: RuntimeMutationScope[];
    unsupportedReason?: string;
    truth: RuntimeTruth;
    evidenceRefs: EvidenceRef[];
  };
  usage: {
    label: string;
    status: "available" | "unknown" | "unavailable";
    providerQuota: {
      canRead: boolean;
      readMethod?: "account/rateLimits/read";
      eventName?: "account/rateLimits/updated";
      label: string;
      status: "available" | "not_exposed" | "unknown";
      percent?: number;
      window?: "five_hour" | "weekly" | "other";
      evidenceRefs: EvidenceRef[];
    };
    contextPressure: {
      label: string;
      status: "available" | "not_exposed" | "unknown";
      percent?: number;
      evidenceRefs: EvidenceRef[];
    };
    activity: {
      turnCount: number;
      commandCount: number;
      approvalCount: number;
      toolCallCount: number;
      sessionDurationMs: number;
      evidenceRefs: EvidenceRef[];
    };
  };
  environment: {
    cwd: string;
    repo?: string;
    branch?: string;
    pr?: {
      label: string;
      evidenceLevel: "github_confirmed" | "persisted_binding" | "inferred" | "unknown";
      evidenceRefs: EvidenceRef[];
    };
    hygiene?: {
      codexSandboxPlaceholderIgnored?: boolean;
    };
    evidenceRefs: EvidenceRef[];
  };
  capabilities: {
    profile: ShellVisibleCodexCapabilities;
    status: RuntimeStateStatus;
    schemaSource:
      | "app_server_probe"
      | "runtime_snapshot"
      | "project_config"
      | "compatibility_default"
      | "unknown";
    evidenceRefs: EvidenceRef[];
    unsupported: Array<{
      id: string;
      label: string;
      reason: string;
      evidenceRefs: EvidenceRef[];
    }>;
  };
  diagnostics?: {
    redactionVersion: string;
    redactedFields: string[];
    mayCopy: boolean;
  };
  chips: RuntimeHeaderChip[];
  updatedAt: string;
};
```

Renderer rules:

- The renderer may format this state.
- The renderer must not synthesize authoritative state from labels.
- Missing evidence should render as `unknown`, `not exposed`, `unsupported`, or `degraded`.
- `unsupported` is a capability result, not an evidence confidence level.
- `enabledScopes` and `mutableScopes` must not contain an unsupported sentinel.
  Empty scope arrays plus `unsupportedReason` represent unsupported mutation.
- Provider quota methods must be called only when the active provider/capability
  profile explicitly declares `providerQuota.canRead` or an equivalent usage
  capability.
- Runtime settings mutation controls require explicit positive capability
  evidence. Missing capability fields, legacy assumptions, and project config
  alone are insufficient.
- Legacy permissive capability handling may remain for transcript rendering or
  compatibility, but not for settings or authority mutation.

Main-process rules:

- The main process owns capability derivation.
- The main process may own Git/environment evidence through the workspace backend.
- The main process must not send raw bearer tokens or sensitive auth material to the renderer.
- Main process exposes a sanitized runtime constitution snapshot.
- Renderer subscribes to runtime constitution updates.
- Renderer may request safe refresh.
- Renderer never merges arbitrary labels into authoritative state.

Suggested IPC/preload contract:

```ts
window.codexSurfaceBridge.getRuntimeConstitution(projectId);
window.codexSurfaceBridge.refreshRuntimeConstitution(projectId);
window.codexSurfaceBridge.onRuntimeConstitutionUpdated(listener);
```

Runtime constitution builder inputs:

- Sanitized project config.
- Runtime provider profile: `codex_executable` / `direct_oai`, plus
  executable flavor when applicable.
- App-server launch snapshot.
- App-server capability profile.
- Connection and readiness state.
- `account/read` and `account/updated` evidence.
- Thread-state events: requested, dispatched, rendered stored, attached live, failed.
- Workspace backend environment evidence.
- Git/PR probes.
- Local activity counters.
- Provider quota evidence, if exposed by the account/runtime surface.
- Managed requirements from `configRequirements/read`, including approval and
  sandbox allow-lists when present.

## State And Visual Semantics

Use materially distinct styles:

| State | Visual posture |
| --- | --- |
| ready/live | calm positive, not celebratory |
| mutable | button-like chip with chevron |
| read-only witness | subdued chip without chevron |
| unknown | muted diagnostic chip |
| degraded | warning outline |
| danger authority | high-contrast warning, explicit scope |
| failed | warning/error chip with drawer link |

Avoid:

- Making every chip look clickable.
- Rendering project config as if it were runtime truth.
- Hiding unavailable authority controls when absence is diagnostically important.
- Placing settings controls inside the transcript/feed lane.

## Transition Contracts

### OpenRuntimeDrawer

```text
User.click(RuntimeChip | HeaderChip)
  -> OpenRuntimeDrawer(tab)
  -> render drawer from CodexRuntimeHeaderState + capability profile
```

Preconditions:

- Codex surface loaded.
- Runtime state object exists, even if degraded/offline.

Visible consequence:

- Drawer opens on relevant tab.
- No runtime mutation occurs.

### ChangeModelDefault

```text
User.selectModel(modelId)
  -> verify model.selection supports requested scope
  -> show commit summary
  -> set drawer control to pending
  -> commit project/session default
  -> refresh runtime constitution
  -> update header only after refreshed evidence confirms the change
  -> on failure, keep previous header truth and show diagnostic
```

Commit scope must be explicit:

- next turn only
- current session default
- project default
- unsupported is represented by no enabled scope plus `unsupportedReason`

### ChangeReasoningDefault

```text
User.selectReasoningEffort(effort)
  -> verify reasoning.selection supports requested scope
  -> show commit summary
  -> set drawer control to pending
  -> commit default
  -> refresh runtime constitution
  -> update header only after refreshed evidence confirms the change
  -> on failure, keep previous header truth and show diagnostic
```

### ChangeAccessPolicy

```text
User.selectAccessPolicy(policy)
  -> verify authority capability
  -> show risk and scope
  -> require explicit confirmation
  -> set drawer control to pending
  -> commit only to supported scope
  -> refresh runtime constitution
  -> update header only after refreshed evidence confirms the change
  -> on failure, keep previous header truth and show diagnostic
```

Rules:

- Never auto-upgrade to unrestricted access.
- Never hide the affected scope.
- Failed commit keeps previous header truth and shows drawer diagnostic.

### RefreshRuntimeEvidence

```text
User.click(refresh)
  -> safe probes only
  -> update capability/header state
  -> render updatedAt and diagnostics
```

Safe probes include:

- `account/read`.
- capability/profile snapshot.
- model list when supported.
- workspace backend Git/environment reads.
- provider quota reads if the runtime/account surface exposes a read-only source.

Unsafe probes excluded:

- destructive thread maintenance.
- sandbox policy mutation.
- write permission elevation.

## Implementation Notes

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| Runtime constitution builder | support artifact | build | truth normalization, evidence refs, mutation gating |
| Runtime provider profile | support artifact | build/align | provider-rooted capability and settings projection |
| Runtime header | surface artifact | build | compact constitutional projection |
| Runtime inspector drawer | surface artifact | build | same-context evidence and bounded settings |
| Capability projector | support artifact | build/align | fail-closed capability interpretation |
| Usage projector | support artifact | build | quota/context/activity separation |
| Responsive header overflow policy | support artifact | build | collapse order without losing authority state |
| Diagnostic redactor | support artifact | build | safe copy/export of runtime diagnostics |

## Stable Bindings

Authority-bearing controls, evidence-bearing sections, and state-distinction chips
must expose stable test hooks:

```html
<header data-morphic-region="runtime-header">
<button data-runtime-chip="model" data-chip-role="mutable-control">
<button data-runtime-chip="account" data-chip-role="read-only-witness">
<aside data-morphic-region="runtime-inspector-drawer">
<section data-runtime-drawer-section="access">
```

Diagnostic copy/export must be generated through a redaction path owned by the
main process. Copied bundles must not include raw bearer tokens, auth headers,
environment secrets, or unredacted local credential paths.

Current DOM starts with:

```html
<header class="topbar">
  <div class="title-block">...</div>
  <div class="meta">...</div>
</header>
```

Expected refactor:

```html
<header class="runtime-header">
  <div class="runtime-identity-row">...</div>
  <div class="runtime-state-row">...</div>
</header>
<aside class="runtime-drawer" hidden>...</aside>
```

Likely files:

- `src/renderer/codex-surface.html`
- `src/renderer/codex-surface.css`
- `src/renderer/codex-surface.js`
- `src/main/codex-app-server.js`
- `src/main/workspace-backend.js`
- `src/main/codex-surface-session.js`

Implementation should first build read-only projection, then mutation.

## Phasing

### Phase 0: Runtime Constitution Builder

- Introduce a single sanitized runtime constitution builder.
- Merge project config, runtime provider profile, app-server snapshot,
  connection status, capability profile, account evidence, thread-state
  evidence, workspace/Git evidence, provider quota evidence when available, and
  local activity counters.
- Replace scattered header truth with the runtime constitution snapshot.
- Keep transcript compatibility paths working, but make runtime mutation
  affordances fail closed.

### Phase 1: Read-Only Constitutional Header

- Refactor header to two rows.
- Render runtime, account, model, reasoning, access, cwd.
- Use unknown/degraded states where evidence is missing.
- Add `Runtime` drawer trigger.
- Drawer opens with read-only Runtime, Access, Usage, Capabilities, Environment tabs.

### Phase 2: Evidence Enrichment

- Add Git repo/branch evidence through workspace backend.
- Add PR evidence if available.
- Add local activity usage from renderer/app-server events.
- Add context pressure only when app-server events expose it.
- Add provider quota percentage only when OpenAI/runtime account evidence
  exposes it.
- Read provider quota from `account/rateLimits/read` and
  `account/rateLimits/updated` when the active app-server supports them.
- Add local hygiene state such as `.codex` sandbox-placeholder ignore status.

### Phase 3: Mutable Model And Reasoning

- Model dropdown backed by capability evidence.
- Reasoning effort dropdown backed by capability evidence.
- Scope labels: next turn, session, project.
- Commit summary before applying persistent defaults.
- v0 implementation may expose session-local next-turn/subsequent-turn overrides
  through `turn/start.model` and `turn/start.effort` before project-default
  persistence exists.

### Phase 4: Authority Controls

- Access drawer controls for approval/sandbox/permission profile.
- Explicit risk and scope confirmation.
- Disabled-visible unsupported states.
- Runtime evidence refresh after commit.
- v0 implementation may expose session-local approval/sandbox overrides through
  `turn/start.approvalPolicy` and `turn/start.sandboxPolicy`; persistent
  project-default access changes remain out of scope until committed separately.

### Phase 5: Composer Next-Turn Overrides

- Compact next-turn override summary.
- Per-turn scoped model/reasoning/access if supported.
- Submit summary when overrides differ from defaults.

## Acceptance Criteria

- Header uses two semantic rows: identity/session and runtime state/controls.
- Transcript/feed lane contains no settings controls.
- Runtime drawer opens from `Runtime` and chip clicks.
- Mutable chips have chevrons or equivalent affordance; read-only witnesses do not.
- Unknown state renders as unknown/degraded, not as success.
- Thread title comes from rendered/live thread evidence, not only project binding.
- Model and reasoning controls are disabled or hidden only according to capability evidence.
- Access controls require explicit confirmation and show scope before commit.
- No mutable chip is enabled from project config alone.
- No mutable chip is enabled from missing capability fields.
- `CodexRuntimeHeaderState` includes `schemaVersion`, `projectId`, and
  capability provenance.
- `enabledScopes` and `mutableScopes` never contain an unsupported sentinel.
- Access posture does not use `safe`; use `requests_gated`,
  `policy_unknown`, `restricted`, `approval`, or `danger_full_access`.
- Every chip can explain its source in the drawer.
- Usage does not display precise quota/context values unless runtime or provider evidence exists.
- OpenAI five-hour/weekly quota percentages may be shown as provider quota only
  when backed by account/runtime evidence.
- Provider quota methods are called only when explicitly capability-declared.
- Approval/sandbox dropdown values are narrowed by `configRequirements/read`
  allow-lists when managed requirements are present.
- Local activity usage is labeled as activity, not quota.
- Drawer shows unsupported/degraded capabilities rather than silently omitting important unavailable actions.
- Mutation controls show pending state and require refreshed evidence before the
  header reflects a persistent change.
- Authority-bearing controls and evidence-bearing sections expose stable test hooks.
- Diagnostic copy/export is generated through a main-process redaction path.
- Header model chip renders as a read-only witness when active model is known but
  selection is unsupported.
- No raw bearer tokens or sensitive auth values reach renderer state.
- Mobile/narrow layout preserves header readability by collapsing repo/branch/PR before runtime/account/model/access.
