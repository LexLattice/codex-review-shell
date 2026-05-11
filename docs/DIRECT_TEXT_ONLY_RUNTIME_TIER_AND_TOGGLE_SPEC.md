# Direct Text-Only Runtime Tier And Toggle Spec

Status: draft implementation specification for the next direct-runtime UX
bundle on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Make the left Codex lane selectable between the existing app-server runtime and
a narrow direct text-only runtime tier.

The practical problem is now clear from testing:

```text
direct text turns can be useful to test today
implementation-lane direct activation is still stricter
```

The current UI has one "Enable direct experimental" affordance. That action is
correctly blocked by implementation-lane gates, including read-only tool
continuation evidence. But that makes it harder to test the direct text path
that is already covered by auth, live-text evidence, context packs, request
manifests, and headless real-turn reports.

This bundle introduces a first-class text-only tier:

```text
App-server
Direct text-only
Direct implementation lane
```

Only `Direct text-only` is implemented by this spec. It gives us real UI and
headless usage with normal text prompts while preserving all existing stricter
requirements for the implementation lane.

## Core Invariant

```text
direct text-only runtime tier != full implementation-lane activation
UI runtime toggle != production direct default
text turn capability != tool/continuation capability
```

Direct text-only may start a real direct live text turn when its own gates pass.
It must not execute tools, continue tool calls, use imported authority, mutate
right-pane ChatGPT, fall back to app-server inside direct, or claim that direct
is production-ready.

## Boundary

This bundle does:

- expose a renderer-safe runtime selector for the left Codex lane;
- add a `direct-text-only` project/runtime tier;
- allow a selected project to switch between app-server and direct text-only;
- reuse the persisted direct auth store and existing auth fallback behavior;
- require accepted/runtime-probed live text evidence for direct text-only;
- require direct thread/context/request store health before direct transport;
- route text-only composer submissions through the direct live text path;
- write context pack and request manifest artifacts before provider transport;
- persist native direct session/turn artifacts for direct text-only turns;
- classify provider tool calls as terminal blocked text-only events;
- preserve rollback to app-server;
- show implementation-lane blockers separately from text-only blockers.

It does not:

- make `direct` production mode available;
- make direct the global default;
- remove, weaken, or hide `legacy-app-server`;
- enable read-only tool continuation through the text-only toggle;
- execute write/shell/network/browser/MCP/patch tools;
- auto-approve or replay approvals;
- import right-pane ChatGPT transcript content;
- navigate, reload, select, or mutate the right ChatGPT pane;
- weaken implementation-lane activation gates;
- silently promote candidate or diagnostic evidence into accepted runtime
  evidence;
- use app-server fallback after a direct text-only turn has started.

## Runtime Tier Model

Keep the existing project runtime concepts, but split direct experimental into
explicit tiers.

```ts
type CodexRuntimeMode =
  | "legacy-app-server"
  | "direct-experimental"
  | "direct";

type DirectExperimentalRuntimeTier =
  | "none"
  | "text-only"
  | "implementation-lane";

type DirectExperimentalTransport =
  | "fixture"
  | "live-text";

type CodexRuntimeSelection = {
  runtimeMode: CodexRuntimeMode;
  directTier?: DirectExperimentalRuntimeTier;
  directTransport?: DirectExperimentalTransport;
  model?: string;
  profileId?: string;
};
```

Persisted project config should use this canonical shape. Headless and CLI
names may be aliases only:

| Alias | Canonical Meaning |
| --- | --- |
| `appserver` | `legacy-app-server` |
| `direct` with text-only tier | `direct-experimental/text-only/live-text` |
| `text-only-real-turn` | `text-only` |
| `implementation-lane` | `implementation-lane` |

Do not persist mixed vocabulary from the headless runner into project runtime
bindings.

Allowed selections for this bundle:

| Selection | Meaning |
| --- | --- |
| `legacy-app-server` | Existing app-server path. Default and rollback target. |
| `direct-experimental/text-only/live-text` | Direct text-only tier. Real text turns, no tools. |

Out of scope for this bundle:

| Selection | Meaning |
| --- | --- |
| `direct-experimental/implementation-lane/live-text` | Existing stricter activation goal. Still blocked until all implementation-lane gates pass. |
| `direct` | Production direct runtime. Still unavailable. |

### Migration

Older branch builds may have persisted:

```text
runtimeMode=direct-experimental
directTransport=live-text
directTier missing
```

Migration is conservative:

```text
old direct-experimental/live-text + implementation-lane activation record:
  directTier = implementation-lane

old direct-experimental/live-text + no implementation-lane activation record:
  directTier = implementation-lane
  state = rollback_required or blocked until repaired
```

Never migrate an old direct-experimental binding to text-only automatically.
Text-only selection must come from the new explicit text-only selection flow,
otherwise an old implementation-lane project could silently lose tool
continuation behavior.

## Readiness Split

The status model must expose text-only readiness separately from
implementation-lane readiness.

```ts
type DirectRuntimeTierReadiness = {
  tier: "text-only" | "implementation-lane";
  status:
    | "unavailable"
    | "blocked"
    | "eligible"
    | "enabled"
    | "degraded";
  blockers: DirectRuntimeTierBlocker[];
  warnings: DirectRuntimeTierWarning[];
};

type DirectRuntimeStatus = {
  selectedRuntime: CodexRuntimeSelection;
  appServer: {
    available: boolean;
    active: boolean;
  };
  directTextOnly: DirectRuntimeTierReadiness & {
    canEnable: boolean;
    canStartTextTurn: boolean;
    activeTurnId?: string;
  };
  directImplementationLane: DirectRuntimeTierReadiness & {
    canEnable: boolean;
    missingImplementationOnlyGates: DirectRuntimeTierBlocker[];
  };
  rollback: {
    available: boolean;
    targetRuntime: "legacy-app-server";
  };
};
```

Renderer copy and tooltips must not collapse these into one generic message.
If live text is ready but read-only tool continuation is missing, the UI should
say:

```text
Direct text-only is available.
Direct implementation lane is blocked: read-only tool continuation evidence is missing.
```

It should not say only:

```text
Required activation gates are missing.
```

## Text-Only Gates

Direct text-only may be enabled only when all text-only hard gates pass.

### Project And Runtime Gates

- selected project id is stable for the request;
- selected project has a left Codex lane binding;
- requested runtime is exactly `direct-experimental/text-only/live-text`;
- `direct` production mode remains unavailable;
- no direct text-only path is configured to fall back to app-server;
- no active direct turn conflicts with current concurrency policy;
- project generation matches the renderer request;
- if a workbench revision is available, the expected revision matches.

### Auth Gates

- direct auth status is `authenticated`;
- accepted auth source may be:
  - persistent direct auth store;
  - memory auth store;
  - accepted codex CLI auth fallback;
- expired/stale auth status triggers refresh before final gate evaluation;
- failed refresh blocks with a stable auth blocker;
- raw tokens and auth headers are never exposed to renderer state or reports.

Codex CLI auth fallback may be used only when all of these are true:

- it has an accepted local auth-source profile;
- it yields the same direct ChatGPT/Codex account evidence scope expected by
  the live-text evidence;
- it does not spawn app-server;
- it never exposes raw tokens to renderer state;
- status distinguishes it from persistent direct auth store.

### Evidence Gates

- selected model has accepted or runtime-probed live-text evidence;
- evidence scope matches:
  - endpoint/account scope;
  - model;
  - request shape exactly `direct_text_turn_empty_context@1`;
  - `store=false`;
  - `tools=false`;
  - `previousResponseId=false`;
  - stream normalizer policy;
- candidate evidence does not enable the toggle;
- diagnostic-no-promotion evidence does not enable the toggle;
- missing evidence should show the live probe action or command.

Evidence for these request shapes must not enable UI direct text-only:

```text
direct_text_turn_recent_dialogue@1
direct_fork_start_live_text@1
direct_derived_preview_fork_start_live_text@1
direct_readonly_tool_continuation@1
```

Changing the selected model invalidates the current gate result. The
controller must re-evaluate text-only gates for the exact resolved model before
committing selection. If model is omitted and resolved from defaults, persist
the resolved model and evidence ref in the runtime selection audit record.

### Store And Context Gates

- direct thread store is readable and writable;
- direct rollout/session write path is healthy;
- current user prompt artifact root is writable;
- direct context policy registry is available;
- direct context pack artifact root is writable;
- direct request manifest artifact root is writable;
- first-turn empty-context policy is available;
- no corrupt context/request artifact blocks new turns.

The v0 UI shape is `new thread + empty context`, so these are not required for
text-only eligibility:

- valid renderer transcript projection;
- recent-dialogue context projection;
- compact projection;
- healthy obligation/tool projection subsystem.

Do not over-block first-turn direct text testing because an unused projection
subsystem is stale or rebuilding.

### Tool Gates Explicitly Not Required

These gates are not required for direct text-only:

- read-only tool continuation evidence;
- obligation projection health;
- tool context projection health;
- workspace read approval health;
- provider `previous_response_id + tool output` evidence.

They remain required for implementation-lane activation where applicable.

## Blocker Codes

Add stable blocker codes for text-only and implementation-lane status.

```ts
type DirectRuntimeTierBlocker =
  | "project_missing"
  | "project_generation_stale"
  | "workbench_revision_stale"
  | "runtime_selection_unsupported"
  | "direct_production_unavailable"
  | "direct_auth_missing"
  | "direct_auth_expired"
  | "direct_auth_refresh_failed"
  | "live_text_evidence_missing"
  | "live_text_evidence_candidate_only"
  | "live_text_evidence_expired"
  | "live_text_evidence_scope_mismatch"
  | "direct_thread_store_unhealthy"
  | "direct_context_store_unhealthy"
  | "direct_request_manifest_store_unhealthy"
  | "direct_context_policy_missing"
  | "active_direct_turn_exists"
  | "appserver_required_for_selected_runtime"
  | "readonly_tool_continuation_evidence_missing"
  | "readonly_tool_continuation_evidence_expired"
  | "obligation_projection_unhealthy"
  | "implementation_lane_recovery_gate_missing";
```

Text-only status may report implementation-lane-only blockers as informational,
but they must not block `directTextOnly.canEnable`.

## UX Contract

The left Codex lane or direct auth/status panel should expose a runtime selector
with these states:

```text
Runtime
  App-server
  Direct text-only
  Direct implementation lane
```

For this bundle:

- App-server remains the default and safe rollback target.
- Direct text-only is selectable when text-only gates pass.
- Direct implementation lane remains visible as blocked/deferred unless all
  stricter activation gates pass.
- The old "Enable direct experimental" button should be replaced or clarified
  so it does not imply that read-only tool continuation is required for text
  testing.

Recommended labels:

| UI Label | Meaning |
| --- | --- |
| `Use app-server` | Select app-server runtime. |
| `Use Direct text-only` | Select direct text-only tier. |
| `Enable Direct implementation lane` | Stricter future path with tools/continuation gates. |
| `Rollback to app-server` | Return selected project to app-server. |

`Direct implementation lane` should be non-selectable unless all stricter
implementation-lane gates pass. When blocked, show a precise status such as:

```text
Direct implementation lane - blocked
Needs: read-only tool continuation evidence, recovery gates
```

The composer should show the selected runtime in a compact status strip:

```text
Codex: Direct text-only
```

Direct text-only also needs a small user-facing warning:

```text
Text-only direct can answer prompts but cannot read files, run commands, apply
patches, or continue tool calls.
```

When direct text-only is active, tool affordances must remain unavailable.
If the provider emits a tool call, the transcript should show a safe terminal
status explaining that the text-only tier does not execute or continue tools.

## IPC And Controller Contract

Renderer actions go through a main-process controller. The renderer never
writes runtime bindings directly.

```ts
type SelectCodexRuntimeInput = {
  projectId: string;
  projectGeneration: number;
  expectedWorkbenchRevision?: string;
  clientOperationId: string;
  selection: CodexRuntimeSelection;
};

type SelectCodexRuntimeResult = {
  status: "committed" | "already_applied" | "failed";
  selectedRuntime?: CodexRuntimeSelection;
  previousRuntime?: CodexRuntimeSelection;
  blockerCode?: DirectRuntimeTierBlocker;
  refreshRequired: boolean;
  nextProjectGeneration?: number;
  nextWorkbenchRevision?: string;
  rendererSafeSummary: string;
};
```

Runtime selection and turn-start authorization are separate:

```text
runtime selection:
  chooses which route the composer will attempt

turn-start authorization:
  decides whether provider transport may actually start now
```

Even if a project selected direct text-only earlier, every composer submission
must re-check auth, evidence expiry, model scope, store health, context policy,
active-turn concurrency, and raw-exposure flags immediately before transport.
Selection is not provider-request authority.

Controller rules:

- validate project id and generation;
- validate workbench revision when provided;
- evaluate gates in main immediately before commit;
- persist selection through the existing project binding/config path;
- record a renderer-safe audit event;
- do not start a turn during runtime selection;
- do not call provider transport during runtime selection;
- do not spawn app-server during direct text-only selection;
- do not navigate or mutate the right ChatGPT pane.

Idempotency:

```text
same clientOperationId + same project + same requested selection:
  return existing result or already_applied

same clientOperationId + different requested selection:
  reject client_operation_id_conflict
```

Selection and rollback are mutually locked per project:

```text
select direct text-only while rollback pending:
  conflict

rollback while selection pending:
  conflict

second selection with different clientOperationId while first pending:
  conflict
```

Persist runtime selection atomically:

```text
1. write pending runtime-selection audit record
2. atomically write project config/runtime binding
3. mark audit record committed
```

Recovery rules:

```text
pending audit + unchanged config:
  abandon selection

pending audit + changed config:
  verify digest and commit or mark repair_required

config says direct-text-only but no committed audit:
  degraded / repair_required
```

Audit records keep private rollback snapshots:

```ts
type RuntimeSelectionAuditRecord = {
  operationId: string;
  projectId: string;
  clientOperationId: string;
  previousBindingPrivate: AppPrivateCodexBindingSnapshot;
  previousBindingRendererSummary: RendererSafeCodexBindingSnapshot;
  selectedBindingPrivate: AppPrivateCodexBindingSnapshot;
  selectedBindingRendererSummary: RendererSafeCodexBindingSnapshot;
  resolvedModel?: string;
  modelEvidenceRef?: string;
  requestShapeClass: "direct_text_turn_empty_context@1";
  status: "pending" | "committed" | "failed" | "repaired";
};
```

Renderer-safe snapshots are for display. Rollback uses the private snapshot.

## Direct Text Turn Contract

When the selected runtime is `direct-experimental/text-only/live-text`, composer
submissions route to the direct live text controller.

For v0, supported direct UI turn shape is:

```text
new direct-native thread/session
empty-context policy
one live text turn
fresh provider request
```

Existing-thread recent-dialogue direct UI turns are out of scope until the
multi-turn direct UI bundle. Headless support may exercise additional shapes,
but the UI text-only tier should start with the narrow shape above unless the
recent-dialogue path has separate accepted tests.

Turn start input needs its own idempotency key:

```ts
type DirectTextOnlyTurnStartInput = {
  projectId: string;
  projectGeneration: number;
  selectedRuntimeDigest: string;
  clientTurnRequestId: string;
  promptText: string;
};
```

Rules:

```text
same clientTurnRequestId + same prompt digest + same runtime digest:
  return existing turn status

same clientTurnRequestId + different prompt/runtime:
  reject conflict

previous run observed provider bytes/events:
  never auto-rerun under the same id
```

Every direct text-only turn must:

- create or load a direct-native session only through direct runtime code;
- create a current user prompt artifact;
- build a direct context pack before transport;
- build a direct request manifest before transport;
- build provider input from the context pack and manifest only;
- append `request_built` rollout evidence before transport;
- send a fresh request with:
  - `store=false`;
  - `tools=false`;
  - `previousResponseIdUsed=false`;
  - `providerContinuityHandleUsed=false`;
  - `importedContinuityHandleUsed=false`;
  - no `include` fields;
- persist normalized stream events and terminal state;
- expose only renderer-safe transcript/progress rows.

The request manifest must record the context policy, harness policy
id/version/digest, role mapping digest, provider input shape/text hashes, and
`rawRequestBodyStored=false`. Provider input is generated from context pack,
request manifest, and role mapping only.

It must not:

- execute a provider tool call;
- send a tool continuation;
- read workspace files because the provider asked;
- use imported session provider continuity;
- use app-server fallback;
- write raw request bodies, raw headers, or raw stream frames to renderer state.

Real provider calls can enter an ambiguous handoff state:

```text
transport handoff started
no provider bytes observed
process/network interrupted
```

Represent this as:

```text
turnState = transport_handoff_unknown
```

It is visible, never auto-retried, and any new prompt requires a new turn
request id.

## Provider Tool Call In Text-Only

If the provider emits a tool call while direct text-only is active:

```text
turn terminal = tool_call_blocked_text_only
failureKind = provider_tool_call_in_text_only_tier
toolExecuted = false
continuationSent = false
providerRequestStarted = true
providerBytesObserved = true
```

The local obligation may be recorded as evidence if the existing direct store
requires it, but it must be marked non-executable for this tier. The UI may
show a safe status item:

```text
The model requested a tool call, but Direct text-only does not execute tools.
```

No approval UI should be shown from the text-only runtime selection.
Composer is disabled for that direct session until the user starts a new fresh
text-only session or switches runtime. Continuing the same session after a
blocked tool call is out of scope until a later tool-authority bundle owns that
state.

## Headless Harness Integration

The headless real-turn harness remains the proving surface for text-only direct
behavior.

The UI text-only tier should use the same readiness concepts as:

```text
scripts/codex-real-turn.mjs --runtime=direct
```

But the UI must not silently run probes or promote evidence. When evidence is
missing, the UI should show a command or action to run the live probe. When
auth is stale, the UI may refresh through the existing auth controller.

Headless reports should be linkable from diagnostics by report id/evidence key,
not by raw artifact paths unless private diagnostics are explicitly enabled.

## App-Server Rollback

Rollback to app-server is always a local project binding change, not a direct
session deletion.

Rollback must:

- stop routing new composer submissions to direct text-only;
- preserve direct sessions and artifacts for later inspection;
- keep direct auth state unless the user explicitly logs out;
- keep app-server login state untouched;
- avoid app-server fallback inside any already-started direct turn;
- avoid deleting workbench projections or direct artifacts.

For v0, rollback is blocked while a direct turn is active:

```text
active_direct_turn_exists
```

Future-turn rollback while an active direct session continues is a later
dual-state policy, not part of this bundle.

## Renderer Safety

The runtime selector, status strip, transcript rows, reports, and diagnostics
must not expose:

- raw access tokens or refresh tokens;
- raw auth headers;
- raw backend request bodies;
- raw provider stream frames;
- raw context pack text;
- raw request manifest body text;
- raw workspace paths or WSL paths;
- raw source hashes;
- raw imported JSONL;
- raw ChatGPT URLs;
- stack traces or unredacted errors.

Allowed renderer fields:

- runtime selection enum;
- gate status and stable blocker codes;
- redacted auth state;
- model id when already renderer-safe;
- evidence id/ref and expiry state;
- artifact ids and integrity status;
- bounded assistant text preview;
- normalized event type names;
- safe failure summaries.

Before writing renderer diagnostics or UI state snapshots for this tier, run
the existing raw-exposure scanner where feasible.

Concrete smoke coverage should scan:

- serialized runtime status;
- DOM attributes for the runtime selector;
- transcript rows;
- browser `localStorage` and `sessionStorage`;
- renderer diagnostics;
- exported debug reports.

Assert absence of raw auth, raw request bodies, raw context text, raw request
manifest body text, raw workspace/WSL paths, raw source hashes, raw ChatGPT
URLs, and raw provider frames.

## Recovery And Degraded States

### Auth Stale

If persistent auth looks expired or stale, the status controller may refresh
before evaluating text-only gates.

Outcomes:

```text
refresh succeeds:
  text-only gates continue

refresh fails:
  directTextOnly.status = blocked
  blocker = direct_auth_refresh_failed
```

### Evidence Missing Or Candidate

Candidate live-probe evidence is not enough for UI text-only selection.

Outcomes:

```text
missing:
  blocker = live_text_evidence_missing

candidate:
  blocker = live_text_evidence_candidate_only

expired:
  blocker = live_text_evidence_expired
```

### Store Unhealthy

If direct thread/context/request stores are unhealthy:

```text
directTextOnly.canEnable = false
directTextOnly.canStartTextTurn = false
```

App-server remains selectable unless the app-server path has its own blocker.

### Implementation-Lane Blocked

If read-only tool continuation evidence is missing but text-only gates pass:

```text
directTextOnly.status = eligible
directImplementationLane.status = blocked
directImplementationLane.blockers includes readonly_tool_continuation_evidence_missing
```

This is the primary behavior this spec needs to fix.

## Tests And Smokes

Add or update tests for:

- status reports text-only eligible when live text evidence passes and read-only
  tool continuation evidence is missing;
- implementation-lane remains blocked when read-only tool continuation evidence
  is missing;
- `Use Direct text-only` does not require the read-only tool continuation gate;
- `Enable Direct implementation lane` still requires the read-only tool
  continuation gate;
- stale auth refresh can turn an expired UI badge into authenticated status;
- failed auth refresh blocks direct text-only with a stable blocker;
- candidate live evidence blocks UI selection;
- accepted/runtime-probed live evidence enables UI text-only selection;
- selecting direct text-only does not start provider transport;
- selecting direct text-only does not spawn app-server;
- selecting direct text-only does not mutate right-pane ChatGPT;
- composer submission in direct text-only writes context pack and request
  manifest before transport;
- direct text-only request manifest records `store=false`, `tools=false`, and
  `previousResponseIdUsed=false`;
- direct text-only turn start re-evaluates gates even when the project already
  selected direct text-only;
- direct text-only turn start idempotency prevents duplicate provider sends;
- provider tool call in text-only tier is terminal blocked, with no tool
  execution and no continuation;
- `transport_handoff_unknown` is represented and never auto-retried;
- rollback to app-server preserves direct artifacts and direct auth;
- rollback is blocked while a direct turn is active in v0;
- renderer status and diagnostics contain no raw paths, raw auth, raw request
  bodies, raw context text, or raw ChatGPT URLs.

Install throw-on-call sentinels in UI/runtime tests for:

- runtime selection;
- composer submit;
- stream start;
- terminal event handling;
- rollback;
- tool-call blocked terminal handling;
- app-server spawn during direct text-only turns;
- provider transport during runtime selection;
- right-pane ChatGPT navigation/mutation;
- handoff queue mutation;
- read-only tool execution/continuation in text-only tier.

## Implementation Order

### Phase -1 - Naming, Migration, And Status Law

- Canonicalize runtime tier names across project config, UI, and headless CLI
  aliases.
- Add conservative migration for old `direct-experimental/live-text` bindings
  with no tier.
- Add runtime tier enum and text-only readiness model.
- Add blocker codes.
- Split text-only readiness from implementation-lane activation readiness.
- Require exact `direct_text_turn_empty_context@1` request-shape evidence.
- Scope v0 store gates to empty-context text turns without requiring unused
  recent-dialogue projections.
- Update copy/tooltips to stop presenting tool continuation as a text-only
  blocker.

### Phase 0 - Controller Selection

- Add controller method for selecting app-server or direct text-only.
- Validate project generation and expected revision.
- Add per-project runtime selection lock.
- Persist selected runtime binding atomically.
- Record audit event with private rollback snapshot.
- Keep selection side-effect free: no provider transport, no app-server spawn.

### Phase 1 - UI Toggle

- Replace or clarify the existing direct experimental button.
- Add runtime selector with app-server, direct text-only, and implementation
  lane states.
- Show direct text-only and implementation-lane blockers separately.
- Make implementation-lane non-selectable unless stricter gates pass.
- Add text-only warning that file reads, commands, patches, and tool
  continuation are unavailable.
- Preserve rollback to app-server.

### Phase 2 - Text-Only Composer Routing

- Re-evaluate gates immediately before turn start.
- Route composer submissions to direct live text when direct text-only is
  selected.
- Start with new direct-native thread plus empty-context policy.
- Persist current user prompt, context pack, request manifest, and rollout
  request evidence before transport.
- Add `clientTurnRequestId` idempotency.
- Render streaming and terminal state through existing transcript UI.

### Phase 3 - Safety And Recovery

- Add provider tool-call terminal blocked handling for text-only tier.
- Add `transport_handoff_unknown`.
- Add auth stale refresh behavior.
- Block rollback during active direct turn for v0.
- Add raw-exposure scan coverage for status/report UI state.
- Add rollback/degraded behavior for active turn and store unhealthy states.

### Phase 4 - Real Usage Smokes

- Run headless direct real turn.
- Run UI direct text-only real turn on the Windows mirror app.
- Run app-server rollback and app-server baseline turn.
- Confirm no right-pane or handoff mutation.

## Acceptance Criteria

- Runtime status exposes `directTextOnly` and `directImplementationLane` as
  separate readiness objects.
- Runtime tier names are canonicalized across project config, UI, and headless
  CLI aliases.
- Old `direct-experimental/live-text` config without a tier migrates
  conservatively and does not imply implementation-lane readiness.
- Direct text-only eligibility does not require read-only tool continuation
  evidence.
- Implementation-lane activation still requires read-only tool continuation and
  recovery gates.
- Runtime selection is persisted atomically with an audit record and private
  rollback snapshot.
- Runtime selection and rollback are mutually locked per project.
- Composer turn start re-evaluates auth/evidence/store gates; selection alone
  is not turn authority.
- Direct text-only UI requires evidence for `direct_text_turn_empty_context@1`
  specifically.
- Empty-context text-only gates do not require recent-dialogue renderer/context
  projections.
- Changing selected model invalidates the gate and requires re-evaluation.
- The UI offers a clear app-server/direct text-only selection and a distinct
  implementation-lane state.
- The UI explicitly says Direct text-only cannot read files, run commands,
  apply patches, or continue tools.
- The implementation-lane control is non-selectable unless stricter gates pass.
- Clicking `Use Direct text-only` persists a project-scoped runtime selection
  but does not start provider transport.
- Direct text-only composer submissions route through direct live text, not
  app-server.
- Direct text-only turn start uses `clientTurnRequestId` idempotency.
- Direct text-only turns write context pack and request manifest artifacts
  before transport.
- Direct text-only manifests record `store=false`, `tools=false`,
  `previousResponseIdUsed=false`, no provider/imported continuity, harness
  policy digest, role mapping digest, and no raw request body.
- Provider tool calls in text-only tier are blocked terminally without local
  execution or continuation.
- Provider tool call in text-only creates `tool_call_blocked_text_only` and
  disables that session composer until a new fresh session or future tool
  authority flow.
- `transport_handoff_unknown` is represented and never auto-retried.
- Rollback to app-server is available and preserves direct artifacts.
- Rollback during active direct turn is blocked in v0.
- Candidate/diagnostic live evidence cannot enable the UI direct text-only
  toggle.
- Auth refresh is attempted before declaring persisted auth expired when
  possible.
- Renderer diagnostics distinguish "text-only ready" from "implementation lane
  blocked".
- Raw-exposure tests scan runtime selector state, DOM attributes, transcript
  rows, browser storage, diagnostics, and reports.
- Tests prove runtime selection does not spawn app-server, call provider
  transport, mutate right-pane ChatGPT, mutate handoff queues, or execute tools.

## Final Meaning

Passing this bundle should mean:

```text
The selected project can be switched between app-server and a real direct
text-only Codex runtime, and ordinary text prompts can be tested through the
direct path from the UI without requiring the unfinished implementation-lane
tool gates.
```

It should not mean:

```text
direct is production
direct is the default
tools are enabled
read-only tool continuation is bypassed
multi-turn direct history is fully supported
right-pane ChatGPT content is imported or controlled
app-server can be removed
```
