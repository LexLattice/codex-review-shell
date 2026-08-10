# Direct Experimental Project Activation And Rollback Spec

Status: implementation specification for the next direct-runtime bundle on the
long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md](./DIRECT_LEGACY_IMPORT_CHECKPOINT_SPEC.md)
- [DIRECT_IMPORT_UX_STATUS_SPEC.md](./DIRECT_IMPORT_UX_STATUS_SPEC.md)
- [DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md](./DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)

## Purpose

Add an explicit project-level activation gate for the direct experimental Codex
runtime.

The direct branch now has separate substrate slices for:

```text
direct auth
live text turns
live probe evidence
read-only tool continuation
legacy Codex import
import checkpoint continuation
```

This bundle defines how a selected project may opt into that substrate as its
left-lane runtime:

```text
project direct readiness
  -> explicit user confirmation
  -> project binding update to direct-experimental/live-text
  -> non-destructive rollback to legacy-app-server
```

The core invariant is:

```text
direct experimental eligible != direct production replacement
```

Passing this bundle does not make `direct` mode available and does not remove
the `codex app-server` path.

## Decision

Implement a project activation gate for:

```ts
runtimeMode = "direct-experimental"
directTransport = "live-text"
```

Activation is explicit, project-scoped, reversible, and evidence-gated.

The gate is a local shell decision built from existing accepted/runtime-probed
evidence. It is not a new upstream capability by itself.

## Boundary

This bundle changes only the direct branch and only the left Codex runtime
selection path.

It does:

- evaluate direct experimental readiness for the selected project;
- show precise blockers and warnings;
- enable `direct-experimental/live-text` as the selected project's Codex
  runtime only after explicit user confirmation;
- persist an app-private activation audit record;
- preserve direct sessions, imports, diagnostics, and evidence across rollback;
- expose a one-click rollback to `legacy-app-server` when direct experimental
  is enabled or degraded.

It does not:

- make `direct` mode available;
- make direct runtime the global default;
- remove or hide `legacy-app-server`;
- silently switch runtime modes because a probe succeeded;
- use app-server fallback inside a direct-experimental turn;
- auto-start direct turns during activation;
- import or replay legacy provider state;
- expand tool authority beyond already accepted/read-only direct capabilities;
- modify right-pane ChatGPT thread bindings;
- expose raw auth, request, stream, import, source, or diagnostic payloads to
  the renderer.

The right ChatGPT pane remains a separate real ChatGPT review/world-model
surface. Direct activation affects only the left Codex implementation lane.

## Activation State Model

Activation state and activation tier are separate. A project may have enough
evidence to preview direct text turns without being safe to select as the
implementation lane.

```ts
type DirectExperimentalActivationTier =
  | "text-only-preview"
  | "implementation-lane";
```

Tier meanings:

| Tier | Meaning |
| --- | --- |
| `text-only-preview` | May open clearly labeled direct live text sessions. It does not claim to be a repo-coupled Codex implementation lane and must not be written as the selected project's Codex lane binding by this bundle. |
| `implementation-lane` | Requires live text, read-only workspace tool continuation, recovery, and security gates. Only this tier may become the selected project's Codex lane binding. |

`text_only_eligible` is informational for this activation bundle. It may support
a separately labeled preview action, but it must not enable project binding
activation.

```ts
type DirectExperimentalActivationState =
  | "unavailable"
  | "blocked"
  | "text_only_eligible"
  | "eligible"
  | "enabled"
  | "degraded"
  | "rollback_required";
```

State meanings:

| State | Meaning |
| --- | --- |
| `unavailable` | Direct experimental activation cannot be evaluated for this project or build. |
| `blocked` | Required readiness gates are missing or failed. |
| `text_only_eligible` | The project can run direct text turns, but is not eligible as the implementation lane because tool/recovery gates are incomplete. Informational only for project activation. |
| `eligible` | Required gates pass and the user may explicitly enable direct experimental for this project. |
| `enabled` | The project binding currently selects `direct-experimental/live-text`. |
| `degraded` | Direct experimental is enabled, but a previously passing required gate is now expired, missing, or failing. |
| `rollback_required` | Direct experimental cannot safely start new turns until the user rolls back or revalidates gates. |

Do not use a single `ready` flag. The renderer needs separate truth for:

```text
auth status
live text readiness
read-only tool readiness
import checkpoint continuation readiness
session store recovery
activation eligibility
active runtime selection
rollback availability
```

## Required Gates

Activation to `eligible` requires all hard gates below.

### Project And Runtime Gates

- selected project id is known and stable for the activation request;
- project has a Codex lane binding that can target the direct branch runtime;
- target runtime is exactly `direct-experimental/live-text`;
- `direct` remains unavailable;
- no direct-experimental path is configured to fall back to app-server after
  activation;
- current workspace binding is valid for the selected project;
- workspace gate is evaluated through the workspace backend status for the
  selected project;
- implementation-lane activation requires workspace backend attach health, or
  an explicitly accepted policy that attach occurs on first turn;
- WSL projects continue routing workspace reads/writes through the workspace
  backend, not Windows mirror paths.

Renderer-safe workspace status:

```ts
type DirectExperimentalWorkspaceGate = {
  kind: "local" | "wsl";
  backendAttached: boolean;
  attachPolicy: "attached_now" | "attach_on_first_turn_accepted";
  canonicalPathEvidenceKey: string;
  rawPathExposed: false;
};
```

Raw local, Linux, WSL, or mirror paths must not appear in renderer status.

### Auth Gates

- direct auth status is authenticated;
- refresh status is accepted or currently valid;
- account evidence key matches the evidence scope;
- renderer exposure flags remain false for access tokens, refresh tokens,
  authorization headers, and raw auth diagnostics.

Expired or failed auth makes activation `blocked` or `degraded`. Auth failure
must not erase existing evidence records, but it prevents them from enabling
the project.

### Live Text Gates

- accepted or unexpired `runtime_probed` evidence exists for the exact model,
  endpoint class/hash, auth/account scope, request shape, request-builder
  version, transport adapter version, normalizer version, and redaction version;
- evidence source is not fake-smoke unless the app is running in explicit test
  resolver mode;
- direct live text status reports `turnRunnable = true`;
- live text session store smokes cover ack, streaming deltas, terminal state,
  thread/read reconstruction, abort, and restart recovery;
- unknown raw events, tool events, reasoning-only output, empty completions, or
  redaction failures do not promote live text readiness.

### Tool Authority Gates

The selected project becomes `text_only_eligible` if live text gates pass but
read-only tool gates do not.

Full `eligible` activation requires read-only tool continuation gates:

- read-only tool-call source is accepted for this exact direct request scope;
- supported provider call type and output item type are accepted;
- namespace policy is accepted;
- `read_file` path safety, sensitive-path policy, and result envelope are
  accepted;
- continuation request shape is accepted or unexpired `runtime_probed`;
- one approved bounded read-only file obligation can be executed through the
  workspace backend and continued once;
- duplicate decision and continuation idempotency tests pass;
- nested continuation tool calls fail closed;
- renderer exposure flags remain false for raw workspace paths and unbounded
  file contents.

Write, shell, network, browser, MCP, patch, or dynamic tools remain unavailable.

Rationale: project-level activation as the Codex implementation lane requires
at least the read-only workspace tool loop because otherwise the left lane is a
generic direct chat surface, not a repo-coupled implementation partner.

If a future product slice wants text-only direct sessions, keep them under the
`text-only-preview` tier and do not call that project activation.

### Import And Checkpoint Gates

Import checkpoint continuation is contextual.

It is required for activation only when the project has imported
`checkpoint-validated` sessions that the UI will offer as direct continuation
actions. Otherwise it is an optional readiness line and must not block ordinary
new direct sessions.

When applicable, gates are:

- import continuation evidence is accepted or unexpired `runtime_probed` for
  the exact checkpoint seed/request shape;
- checkpoint seed redaction, integrity, and lineage checks pass;
- imported sessions remain read-only and composer-disabled;
- imported transcript text is framed as quoted historical evidence;
- no imported provider continuity handle, approval, tool result, command, or
  file change is reused as direct runtime authority;
- at most one active checkpoint continuation is allowed per project unless
  concurrent direct sessions are explicitly supported.

### Recovery And Diagnostics Gates

- direct session store reports healthy recovery for the selected project;
- startup recovery can classify completed, failed, aborted, tool-waiting,
  authority-waiting, continuation-ready, and interrupted checkpoint
  continuation states without auto-sending;
- stale active turn records older than the recovery policy are surfaced as
  blockers or manual-resume diagnostics;
- diagnostics redaction has no unresolved failures;
- no known corruption in direct session, import, evidence, or activation indexes
  is hidden from status.

### Model And Catalog Gates

Selected model availability for the exact account/model/endpoint/request shape
is a hard gate.

General model catalog or quota freshness is only a warning unless it contradicts
the selected model evidence. The evaluator must not infer activation readiness
from a stale broad model catalog when the exact live-text evidence is missing,
expired, or scope-mismatched.

## Optional Warnings

Warnings do not block activation, but they must be visible:

- live probe evidence is close to expiry;
- model evidence comes from a manual probe rather than accepted profile;
- import checkpoint continuation is not configured because the project has no
  eligible imports;
- quota/model catalog evidence is stale;
- long-running drift diagnostics have not recently compared against Codex
  CLI/app-server;
- the project is currently in `legacy-app-server` and activation will change
  only the selected project's Codex lane.

## Data Model

### Blocker Codes

Renderer-safe blocker codes are stable test targets:

```ts
type DirectExperimentalBlockerCode =
  | "project_missing"
  | "project_generation_stale"
  | "binding_unsupported"
  | "workspace_invalid"
  | "workspace_backend_unattached"
  | "auth_missing"
  | "auth_refresh_failed"
  | "account_scope_mismatch"
  | "live_text_evidence_missing"
  | "live_text_evidence_expired"
  | "live_text_scope_mismatch"
  | "tool_evidence_missing"
  | "tool_evidence_expired"
  | "import_checkpoint_evidence_missing"
  | "session_store_corrupt"
  | "evidence_index_corrupt"
  | "activation_record_corrupt"
  | "redaction_failed"
  | "fake_evidence_not_allowed"
  | "active_direct_turn_exists"
  | "production_direct_unavailable";
```

User-facing messages should stay short, but diagnostics and smokes should assert
on these codes.

### Gate Evaluation

```ts
type DirectExperimentalGateFreshness = {
  evaluatedAt: string;
  expiresAt: string;
  maxAgeMs: number;
};

type DirectExperimentalGateRequirement = {
  id: string;
  label: string;
  requirementClass:
    | "hard"
    | "tier_text_only"
    | "tier_implementation_lane"
    | "contextual_import"
    | "warning_only";
  status: "passed" | "blocked" | "expired" | "not_applicable";
  affects:
    | "activation"
    | "new_turns"
    | "tool_continuation"
    | "import_continuation"
    | "rollback"
    | "diagnostics";
  blockerCode?: DirectExperimentalBlockerCode;
  reason?: string;
  evidenceRef?: string;
};

type DirectExperimentalProjectGate = {
  schema: "direct_experimental_project_gate@1";
  gateId: string;
  projectId: string;
  evaluatedAt: string;
  freshness: DirectExperimentalGateFreshness;
  evaluatorVersion: string;

  target: {
    runtimeMode: "direct-experimental";
    directTransport: "live-text";
    bindingProvider: "direct-chatgpt-codex";
    activationTier: DirectExperimentalActivationTier;
  };

  state: DirectExperimentalActivationState;

  requirements: DirectExperimentalGateRequirement[];

  optionalWarnings: Array<{
    id: string;
    label: string;
    severity: "info" | "warning";
    reason: string;
  }>;

  scope: {
    profileId: string;
    profileHash: string;
    authMode: "chatgpt-subscription";
    accountEvidenceKey: string;
    endpointClass: string;
    endpointHash: string;
    model: string;
    liveTextRequestShapeHash: string;
    readOnlyToolShapeHash?: string;
    importCheckpointSeedShapeHash?: string;
    normalizerVersion: string;
    requestBuilderVersion: string;
    transportAdapterVersion: string;
    redactionVersion: string;
  };

  workspace: DirectExperimentalWorkspaceGate;

  exposure: {
    rawAuthExposed: false;
    rawRequestExposed: false;
    rawStreamExposed: false;
    rawImportPathExposed: false;
    rawWorkspacePathExposed: false;
  };

  gateDigest: string;
};
```

`gateDigest` is computed from canonical JSON over:

```text
projectId
target runtime/transport/provider/tier
model
profileHash
accountEvidenceKey
endpointHash
request-shape hashes
evidence ids
evidence expiry values
workspace binding digest
direct session store recovery digest
activation evaluator version
redaction version
exposure flags
```

It must not include raw auth, raw paths, raw request bodies, raw stream frames,
or raw import records.

### Activation Record

```ts
type DirectExperimentalActivationTransactionState =
  | "pending"
  | "committed"
  | "abandoned"
  | "corrupted";

type DirectExperimentalActivationRecord = {
  schema: "direct_experimental_activation_record@1";
  activationId: string;
  clientActivationId: string;
  projectId: string;
  createdAt: string;
  transactionState: DirectExperimentalActivationTransactionState;
  activatedBy: "user";
  previousBindingPrivate: AppPrivateCodexBindingSnapshot;
  previousBindingRendererSummary: RendererSafeCodexBindingSnapshot;
  activatedBindingPrivate: AppPrivateCodexBindingSnapshot;
  activatedBindingRendererSummary: {
    runtimeMode: "direct-experimental";
    directTransport: "live-text";
    bindingProvider: "direct-chatgpt-codex";
    model: string;
    activationTier: "implementation-lane";
  };
  gateId: string;
  gateDigest: string;
  rollbackAvailable: true;
  supersededByActivationId?: string;
  rolledBackByRollbackId?: string;
};
```

Rollback must use the private binding snapshot or a private restorable binding
reference, not the renderer-safe summary. If a previous binding contains fields
that must not be copied into activation records, store a private binding
reference plus a versioned config digest and fall back to `legacy-app-server` if
the reference is unrecoverable.

### Rollback Record

```ts
type DirectExperimentalRollbackTransactionState =
  | "pending"
  | "committed"
  | "abandoned"
  | "corrupted";

type DirectExperimentalRollbackRecord = {
  schema: "direct_experimental_rollback_record@1";
  rollbackId: string;
  clientRollbackId: string;
  activationId: string;
  projectId: string;
  createdAt: string;
  transactionState: DirectExperimentalRollbackTransactionState;
  reason:
    | "user_requested"
    | "gate_degraded"
    | "auth_degraded"
    | "runtime_failed"
    | "manual"
    | "schema_incompatible";
  restoredBindingPrivate?: AppPrivateCodexBindingSnapshot;
  restoredBindingRendererSummary: RendererSafeCodexBindingSnapshot;
  fallbackToLegacyAppServer: boolean;
  preserved: {
    directSessions: true;
    directImports: true;
    directEvidence: true;
    directDiagnostics: true;
  };
};
```

Activation and rollback records are app-private audit artifacts. Renderer
projections may show summaries and ids, not raw evidence payloads.

## Runtime Status Projection

Extend `DirectRuntimeStatus` with a renderer-safe activation projection:

```ts
type RendererSafeDirectExperimentalActivationStatus = {
  state: DirectExperimentalActivationState;
  eligible: boolean;
  enabled: boolean;
  degraded: boolean;
  rollbackAvailable: boolean;

  target: {
    runtimeMode: "direct-experimental";
    directTransport: "live-text";
  };

  gateSummary: {
    requiredCount: number;
    passedRequiredCount: number;
    blockedReasons: Record<string, number>;
    warningsCount: number;
  };

  currentBinding: {
    runtimeMode: CodexRuntimeMode;
    directTransport?: "fixture" | "live-text";
  };

  labels: {
    headline: string;
    detail: string;
  };

  degradedCapabilities?: DirectExperimentalDegradedCapabilities;

  rawAuthExposed: false;
  rawRequestExposed: false;
  rawStreamExposed: false;
  rawImportPathExposed: false;
  rawWorkspacePathExposed: false;
};
```

This projection must not be used to make `direct` mode available. It controls
only the direct experimental project activation affordance.

## Activation Workflow

Activation has three explicit steps.

### 1. Evaluate

Main process evaluates the selected project:

```text
project id
  -> current project binding
  -> direct auth status
  -> live text evidence resolver
  -> read-only tool evidence resolver
  -> import continuation evidence resolver
  -> session/import/evidence recovery state
  -> renderer-safe gate projection
```

Evaluation is side-effect free. It does not mutate project config and does not
start a direct or app-server turn.

### 2. Confirm

If `state = eligible`, the UI may show:

```text
Enable direct experimental for this project
```

The confirmation must show:

- current runtime;
- target runtime;
- selected/proven model;
- auth/account evidence state;
- live text gate state;
- read-only tool gate state;
- import continuation gate state when relevant;
- rollback statement;
- statement that `direct` production mode remains unavailable.

If current runtime is `legacy-app-server`, confirmation must say the change is
project-local and reversible.

### 3. Activate

The activation IPC requires:

```ts
type EnableDirectExperimentalProjectRequest = {
  projectId: string;
  clientActivationId: string;
  expectedGateId: string;
  expectedRuntimeMode: "direct-experimental";
  expectedDirectTransport: "live-text";
};
```

Rules:

- `clientActivationId` is idempotent;
- project id and active project generation must match;
- the gate is re-evaluated immediately before mutation;
- `expectedGateId` and `gateDigest` must match the latest passing,
  unexpired gate or the request fails with `gate_stale`;
- gate scope must exactly match the current project binding, auth scope,
  evidence scope, model, workspace status, exposure flags, and evaluator
  version;
- activation writes a pending audit record before changing project binding;
- project binding changes only after the pending audit write succeeds;
- activation record is marked committed only after project config writes the
  activation id and activated binding digest;
- activation does not start a turn;
- activation does not import or mutate direct sessions;
- activation does not touch right-pane ChatGPT bindings.

Duplicate activation with the same `clientActivationId` returns the existing
activation snapshot. Same id with a different project or target is rejected as
an idempotency conflict.

Activation and rollback mutations require a project-level lock:

```text
activation while rollback is in progress -> conflict
rollback while activation is in progress -> conflict
second activation with different clientActivationId while first is pending -> conflict
evaluation may run concurrently but cannot mutate
```

### Project Config Transaction

Activation is a two-phase local transaction:

```text
1. write pending activation record
2. atomically write project config with activationId and current binding digest
3. mark activation record committed
```

Recovery rules:

| Recovered state | Action |
| --- | --- |
| pending activation + project config not changed | Mark activation abandoned. Do not enable direct experimental. |
| pending activation + project config changed | Verify binding digest, then mark activation committed. |
| committed activation + missing or mismatched project binding | Mark activation corrupted and project status `rollback_required`. |
| direct-experimental binding + no committed activation record | Mark `activation_record_corrupt`; do not start new direct turns until rollback or repair. |

Project config writes must run after current schema normalization. Activation
must never write an older binding schema version.

### Multiple Activations

Rules:

- if the project is already enabled with the same target and same gate scope,
  duplicate activation returns the current enabled snapshot;
- if the project is enabled but target model, request scope, workspace digest,
  or evidence scope changes, require a new confirmation and write a new
  activation record;
- if a project was rolled back, reactivation creates a new activation record;
- old activation records are not mutated in place except for linkage fields
  such as `rolledBackByRollbackId` and `supersededByActivationId`.

## Rollback Workflow

Rollback is always available when the project is `enabled`, `degraded`, or
`rollback_required`.

The rollback IPC requires:

```ts
type RollbackDirectExperimentalProjectRequest = {
  projectId: string;
  clientRollbackId: string;
  activationId?: string;
  reason: DirectExperimentalRollbackRecord["reason"];
};
```

Rules:

- rollback is idempotent by `clientRollbackId`;
- rollback restores the previous private Codex binding snapshot when available
  and valid under the current schema;
- if the previous binding is unavailable, rollback selects
  `legacy-app-server`;
- if the private snapshot references missing provider, plugin, runtime, or
  schema data, rollback falls back to `legacy-app-server` and records
  `reason = "schema_incompatible"`;
- rollback must not restore a binding whose private snapshot fails schema
  validation;
- rollback never deletes direct sessions, imports, evidence, or diagnostics;
- rollback does not close or alter right-pane ChatGPT threads;
- rollback writes a pending app-private rollback record and then updates project
  binding;
- rollback marks the rollback record committed only after project config writes
  the restored binding digest;
- rollback marks the activation with `rolledBackByRollbackId`;
- rollback does not start app-server by itself; app-server starts only through
  the normal legacy runtime selection path.

If a direct turn is currently streaming, rollback should not silently kill it.
For the first implementation, block rollback with `active_direct_turn_exists`
and require the user to abort or wait for terminal state.

Rollback is also a two-phase local transaction:

```text
1. write pending rollback record
2. atomically write project config with restored binding digest
3. mark rollback record committed and link activation.rolledBackByRollbackId
```

Recovery rules:

| Recovered state | Action |
| --- | --- |
| pending rollback + project config still direct experimental | Mark rollback abandoned and keep project enabled/degraded according to gates. |
| pending rollback + project config restored | Verify restored binding digest, then mark rollback committed. |
| committed rollback + project config still direct experimental | Mark rollback corrupted and project status `rollback_required`. |

Rollback snapshots from older binding schemas must be normalized and validated
before write:

```text
normalize -> validate -> write
```

If validation fails, fall back to `legacy-app-server` and record
`schema_incompatible`.

## Degraded State

An enabled project becomes `degraded` when a previously required gate no longer
passes but existing direct artifacts are still readable.

Degraded state must be action-specific:

```ts
type DirectExperimentalDegradedCapabilities = {
  canReadCompletedDirectSessions: boolean;
  canStartNewTextTurn: boolean;
  canApproveReadOnlyTool: boolean;
  canStartImportCheckpointContinuation: boolean;
  canRunManualProbe: boolean;
  canRollback: boolean;
  reasons: Record<string, string>;
};
```

Examples:

- direct auth expired and refresh failed;
- live text model evidence expired;
- selected model no longer matches the accepted scope;
- session store recovery found a partial active turn;
- redaction diagnostics failed;
- read-only tool evidence expired;
- import checkpoint evidence expired while eligible imports still expose
  continuation actions.

Degraded projects:

- show precise blockers;
- may keep completed direct sessions readable;
- must disable each affected action independently;
- must offer rollback;
- must not silently fall back to app-server for a failed direct turn.

Example capability maps:

| Degraded cause | Read completed sessions | Start text turn | Approve read-only tool | Start import checkpoint | Rollback |
| --- | --- | --- | --- | --- | --- |
| Auth expired | Yes | No | No | No | Yes |
| Read-only tool evidence expired | Yes | Maybe, if live text gates still pass | No | Maybe, if unrelated gates pass | Yes |
| Import checkpoint evidence expired | Yes | Yes, if live text/tool gates still pass | Yes, if tool gates pass | No | Yes |
| Session store partial active turn | Yes | No until resolved | No until resolved | No until resolved | Yes, unless active turn blocks rollback |

`rollback_required` is reserved for cases where the direct runtime cannot safely
open new sessions until the project changes runtime or the user revalidates
gates.

## Runtime Routing Invariant

When the project binding is `direct-experimental/live-text`, every Codex
`turn/start` path must resolve to `DirectLiveTextController` or fail closed with
a direct blocker. It must not dispatch to `CodexAppServerSurfaceSession`, even
if direct auth, evidence, or recovery gates are degraded.

Tests must cover:

```text
activation path
actual turn/start after activation
degraded turn/start after activation
rollback then legacy turn/start
```

Only after rollback should the normal legacy app-server path be reachable again.

## Persistence And Recovery

Activation artifacts live under app-private direct state, for example:

```text
direct-sessions/
  activation/
    <project-id>/
      activations/<activation-id>.json
      rollbacks/<rollback-id>.json
      index.json
```

The exact location may follow existing `DirectSessionStore` conventions, but
requirements are:

- writes are atomic;
- index is a derived cache;
- startup can rebuild activation state from durable records;
- project config remains the source of current runtime binding;
- activation audit records never contain raw tokens, raw request bodies, raw
  stream frames, raw import records, or raw absolute workspace/source paths;
- corruption in activation records is visible in runtime status and cannot
  enable direct experimental.

## Security And Renderer Exposure

Renderer must never receive:

- access token;
- refresh token;
- authorization header;
- raw backend request body;
- raw backend stream frame;
- raw source absolute path;
- raw source sha256;
- raw JSONL record;
- raw workspace absolute path;
- unredacted diagnostic payload.

Activation status can include:

- renderer-safe model id;
- renderer-safe source labels;
- capability ids;
- evidence state labels;
- counts;
- blocker codes;
- local activation ids.

Evidence digests should use local HMAC/evidence keys when they need to cross
into renderer-safe projections. Raw sha256 values for private files remain
main-process private.

## UX Requirements

Add a direct experimental activation row to the direct runtime status/settings
surface.

Labels must be truthful:

Good:

```text
Direct experimental eligible
Direct experimental enabled for this project
Direct experimental degraded
Rollback to legacy app-server
Production direct mode unavailable
```

Bad:

```text
Direct ready
Direct default
Replace app-server
```

The UI should show the activation state, gate counts, top blockers, top
warnings, target model, and rollback status. It should not expose a raw ODEU
profile browser as the primary product surface.

The direct activation action is project-local. It must not change global
defaults or other projects.

If project selection changes while evaluation or activation is pending, the
renderer discards stale responses using the existing project-generation guard.
Main process also validates project id for every activation and rollback IPC.

## Unsupported Cases

Fail closed for:

- missing project id;
- stale project generation;
- project binding cannot target direct runtime;
- direct auth missing or failed;
- evidence expired or scope-mismatched;
- fake-smoke evidence outside test resolver mode;
- session store recovery corrupt;
- import/evidence index corrupt when relevant;
- read-only tool continuation evidence missing for full activation;
- active direct turn during rollback;
- concurrent activation or rollback mutation for the same project;
- stale or expired gate freshness;
- binding schema normalization failure;
- attempt to enable production `direct`;
- attempt to activate without confirmation;
- attempt to use activation as a right-pane ChatGPT action.

Unsupported cases must produce renderer-safe blockers and private diagnostics.
They must not spawn app-server as a fallback.

## Implementation Phases

### Phase -1 - Tier And Transaction Model

Before UI work, define:

- `DirectExperimentalActivationTier`;
- `text_only_eligible` as informational for project activation;
- private rollback snapshot or restorable binding reference;
- activation and rollback transaction states;
- project-level activation/rollback lock;
- binding schema normalization rules.

### Phase 0 - Gate Model And Evaluator

Add:

- `DirectExperimentalProjectGate`;
- `DirectExperimentalActivationState`;
- `DirectExperimentalGateFreshness`;
- canonical `gateDigest`;
- stable `DirectExperimentalBlockerCode` values;
- tier-specific `DirectExperimentalGateRequirement` classes;
- action-specific degraded capability map;
- gate evaluator using existing auth, live text, tool, import, and recovery
  resolvers;
- workspace backend health gate;
- exact blocker codes and warning taxonomy;
- renderer-safe activation projection.

### Phase 1 - Runtime Status Integration

Extend direct runtime status with activation truth:

- `blocked`;
- `text_only_eligible`;
- `eligible`;
- `enabled`;
- `degraded`;
- `rollback_required`;
- gate counts and top blockers;
- rollback availability.

### Phase 2 - Activation Persistence

Add:

- app-private activation records;
- app-private rollback records;
- pending/committed/abandoned/corrupted transaction states;
- private previous binding snapshot or restorable binding reference;
- atomic writes;
- startup index rebuild;
- corruption status.

### Phase 3 - Project Binding Mutation

Implement activation IPC:

- idempotent `clientActivationId`;
- gate re-evaluation, freshness, and digest check before mutation;
- project-generation guard;
- project-level mutation lock;
- pending audit write before project config update;
- committed audit after binding digest verification;
- no turn start;
- no app-server fallback.

### Phase 4 - Rollback

Implement rollback IPC:

- idempotent `clientRollbackId`;
- restore previous private binding snapshot or choose `legacy-app-server`;
- validate restored binding under the current schema;
- preserve direct artifacts;
- block rollback while a direct turn is active;
- update runtime status after rollback.

### Phase 5 - Runtime Routing Enforcement

Enforce:

- direct-experimental/live-text `turn/start` never hits app-server;
- degraded direct turn start fails closed with direct blockers;
- rollback restores normal legacy routing.

### Phase 6 - UI

Add settings/status affordances:

- direct experimental activation row;
- confirmation panel;
- gate summary;
- text-only preview versus implementation-lane labels;
- degraded banner;
- rollback button;
- labels that keep `direct` production mode unavailable.

### Phase 7 - Smokes

Add smoke coverage for:

- blocked with missing auth;
- blocked with missing live text evidence;
- `text_only_eligible` when tool evidence is missing;
- eligible with all required fixture evidence;
- activation updates only selected project binding;
- activation is idempotent;
- stale gate id blocks activation;
- production `direct` cannot be enabled;
- enabled project status survives restart/index rebuild;
- expired evidence moves enabled project to `degraded`;
- rollback restores legacy binding and preserves direct artifacts;
- active direct turn blocks rollback;
- crash between pending activation and project config update recovers safely;
- private rollback snapshot restores exact binding or falls back safely;
- stale gate expiry blocks activation;
- project-level mutation lock rejects concurrent activation/rollback;
- rollback snapshot schema incompatibility falls back to legacy app-server;
- direct turn start after activation cannot invoke app-server;
- degraded direct turn start cannot invoke app-server;
- no app-server launcher is invoked by direct activation paths;
- right-pane ChatGPT bindings remain unchanged;
- renderer-safe projection contains no raw tokens, source paths, raw records,
  request bodies, stream frames, or raw workspace paths.

## Acceptance Criteria

This bundle is complete when:

- selected projects have a renderer-safe direct experimental activation status;
- the status distinguishes `blocked`, `text_only_eligible`, `eligible`,
  `enabled`, `degraded`, and `rollback_required`;
- `text_only_eligible` is explicitly informational for project activation or a
  separately labeled `text-only-preview` action, never implementation-lane
  activation;
- activation requires accepted or unexpired runtime-probed live text evidence;
- full activation requires read-only tool continuation evidence;
- implementation-lane activation requires workspace backend health;
- import checkpoint continuation gates are contextual and do not block projects
  without eligible imports;
- activation cannot use fake-smoke evidence outside explicit test mode;
- activation re-evaluates unexpired gates immediately before changing project
  binding;
- `gateDigest` canonically includes scope, evidence ids, evidence expiry,
  workspace digest, evaluator version, and exposure flags;
- gate requirements encode tier/context/affected action, not only pass/block;
- activation is explicit and idempotent;
- only one activation or rollback mutation can run per project at a time;
- activation stores a private rollback snapshot or private restorable binding
  reference;
- renderer-safe binding summaries are not the only rollback source;
- activation and rollback are two-phase local transactions with recovery
  behavior for crashes between audit writes and project config mutation;
- activation writes a pending audit record before mutating project binding and
  marks it committed after binding digest verification;
- activation changes only the selected project's Codex lane;
- activation does not start a turn, spawn app-server, or mutate right-pane
  ChatGPT bindings;
- `direct` production mode remains unavailable;
- enabled projects show degraded status when required evidence expires or auth
  fails;
- degraded status exposes action-specific affordances for reading completed
  sessions, starting text turns, approving read-only tools, starting import
  checkpoint continuations, running probes, and rollback;
- new direct turns are disabled only when degraded gates affect turn safety;
- rollback restores `legacy-app-server` or the previous binding without deleting
  direct sessions, imports, diagnostics, or evidence;
- rollback validates restored bindings under the current schema and falls back
  to `legacy-app-server` if invalid;
- reactivation after rollback or model/scope change creates a new activation
  record and supersedes the old one;
- direct-experimental turn routing after activation cannot invoke app-server,
  even when direct runtime is degraded;
- activation and rollback survive restart through app-private records and index
  rebuild;
- stable renderer-safe blocker codes are covered by tests;
- smoke tests prove raw auth, raw request, raw stream, raw import, raw source,
  and raw workspace data do not reach renderer projections.

Passing this bundle should mean only:

```text
One selected project can explicitly use direct-experimental/live-text as its
left Codex lane when all local direct-runtime evidence gates pass, and can
rollback non-destructively to legacy app-server.
```

It should not mean:

```text
direct runtime is production default
legacy app-server can be removed
write/shell/network tools can run
imported provider state can be resumed
right-pane ChatGPT is automated
all projects use direct runtime
```
