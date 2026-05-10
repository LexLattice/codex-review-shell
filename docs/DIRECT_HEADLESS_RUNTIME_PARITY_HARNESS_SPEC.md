# Direct Headless Runtime Parity Harness Spec

Status: draft implementation specification for practical direct-runtime testing
on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Add a headless real-runtime test harness that can run comparable Codex turns
through either:

```text
runtime = appserver | direct
```

The immediate goal is practical testing, not final UX.

We need a way to run real interactions with Codex, persist the local artifacts,
emit a redacted report, and compare behavior before the middle-plane toggle is
treated as the primary validation surface.

Ultimately the product should expose a project/runtime toggle:

```text
App-server
Direct experimental
```

When the toggle is on direct, the main behavior should remain familiar:

- if the user is not logged in, the system reports login required;
- login/refresh uses the same persisted credential substrate already used by
  the app-server bridge;
- the user interacts with Codex through the same left-lane workflow;
- right-pane ChatGPT remains separate;
- rollback to app-server remains available.

This spec creates the headless harness needed to prove that behavior first.

## Core Invariant

```text
runtime parity test != production direct default
headless direct turn != implementation-lane activation
persisted auth reuse != raw token exposure
```

The harness may run real direct turns with explicit local opt-in and persisted
credentials. It must not make production `direct` available, must not change the
project default silently, must not import right-pane ChatGPT content, and must
not log raw credentials, raw backend request bodies, raw stream frames, raw
workspace paths, or raw source hashes.

## Boundary

This bundle does:

- add a headless CLI envelope for real Codex runtime turns;
- support `--runtime=appserver` and `--runtime=direct`;
- use the same selected project/workspace/profile where possible;
- reuse the app's persisted direct auth store and refresh path for direct;
- use the existing app-server path as the baseline runtime;
- run at least text-only real turns through direct;
- persist direct canonical/session/context/request artifacts for direct turns;
- write redacted per-run reports;
- record normalized event types, unknown event types, terminal state, and
  assistant text digest/preview;
- make direct live-text testing possible without read-only tool continuation
  evidence;
- leave implementation-lane activation stricter than text-only direct testing.

It does not:

- make direct runtime the default;
- remove or weaken app-server;
- make the middle-plane activation button the only test path;
- bypass explicit live-probe evidence for direct text turns;
- enable write/shell/network/browser/MCP/patch tools;
- auto-approve tools;
- replay imported approvals;
- use right-pane ChatGPT transcript content;
- navigate or mutate the right ChatGPT pane;
- persist raw request bodies or raw auth headers;
- store provider stream frames unredacted;
- claim app-server and direct are internally identical.

## Product Shape

The future UI toggle should express:

```text
Codex runtime:
  App-server
  Direct experimental
```

But the first validation surface is headless:

```text
scripts/codex-real-turn.mjs --runtime=appserver
scripts/codex-real-turn.mjs --runtime=direct
```

The headless harness becomes the practical ground truth for:

- auth availability;
- model selection;
- provider request legality;
- streaming normalization;
- terminal-state handling;
- transcript persistence;
- parity with app-server behavior;
- raw-exposure safety.

## Runtime Modes

```ts
type HeadlessCodexRuntime = "appserver" | "direct";
```

### App-Server Runtime

The app-server runtime is the baseline. It should:

- use the existing Codex app-server integration or a small reusable app-server
  client wrapper;
- use the same Codex login state the current app-server path uses;
- run a text turn through app-server;
- capture app-server thread/turn/item events into a redacted report;
- avoid writing direct canonical rollouts for native app-server turns unless a
  later import/materialization step explicitly does so.

The report should include the app-server session/thread identifiers only when
they are renderer-safe. Private app-server transport details stay app-private.

### Direct Runtime

The direct runtime should:

- read persisted direct auth from the selected app profile;
- refresh credentials through the existing direct auth login coordinator when
  refresh is possible;
- require valid live-text evidence for the selected model/request shape;
- build a context pack and request manifest before transport;
- generate provider input from the context pack and manifest only;
- send a fresh direct live-text request with:
  - `store=false`;
  - `tools=false`;
  - `previous_response_id` omitted/false for first-turn text tests;
  - no `include` fields;
  - no raw request-body persistence;
- persist direct session/turn artifacts;
- persist rollout/context/request evidence;
- emit a redacted report.

For this harness, direct text testing uses a text-only runtime tier:

```text
direct text-only real turn:
  requires auth + live-text evidence + context/request store health
  does not require read-only tool continuation evidence

direct implementation-lane activation:
  still requires live-text + read-only tool continuation + recovery gates
```

This distinction is critical. Headless direct text testing must not be blocked
by the implementation-lane tool gate.

## CLI Surface

### Unified Runner

Add:

```text
scripts/codex-real-turn.mjs
```

Required options:

```text
--runtime=appserver|direct
--project-id=<project id>
--prompt=<text> | --prompt-file=<path>
```

Common optional options:

```text
--profile=direct
--app-user-data-root=<path>
--model=<model>
--workspace-kind=wsl|local
--workspace-path=<path>
--allow-workspace-override
--thread-id=<existing thread id>
--new-thread
--client-run-id=<idempotency id>
--report-json
--report-file=<path>
--fail-on-unknown-event
--timeout-ms=<ms>
--private-diagnostics
```

Runtime-specific options:

```text
--runtime=direct:
  --allow-live-provider-call
  --evidence-mode=strict|diagnostic-no-promotion
  --require-live-evidence=true|false
  --diagnostic-probe-mode
  --probe-if-missing=true|false  # rejected unless diagnostic probe mode is set
  --context-policy=direct_text_turn_recent_dialogue@1|direct_text_turn_empty_context@1

--runtime=appserver:
  --appserver-transport=stdio|existing-controller
```

Recommended Windows example:

```bat
cd /d C:\LexLattice\codex-review-shell-direct
node scripts\codex-real-turn.mjs ^
  --runtime=direct ^
  --project-id=project_example ^
  --app-user-data-root=C:\LexLattice\codex-review-shell-direct\.profiles\direct ^
  --workspace-kind=wsl ^
  --workspace-path=/home/rose/work/LexLattice/codex-review-shell-direct ^
  --allow-live-provider-call ^
  --prompt="Reply with exactly: direct real turn ok" ^
  --report-json
```

Recommended app-server baseline:

```bat
cd /d C:\LexLattice\codex-review-shell-direct
node scripts\codex-real-turn.mjs ^
  --runtime=appserver ^
  --project-id=project_example ^
  --app-user-data-root=C:\LexLattice\codex-review-shell-direct\.profiles\direct ^
  --prompt="Reply with exactly: appserver real turn ok" ^
  --report-json
```

### Direct-Only Alias

Add a convenience alias:

```text
scripts/direct-codex-real-turn.mjs
```

It should delegate to:

```text
scripts/codex-real-turn.mjs --runtime=direct
```

The existing live probe remains separate:

```text
scripts/direct-codex-live-probe.mjs
```

Probe evidence proves that a request shape can run. Real-turn harness runs
actual user-style turns and records behavior.

## Live Provider Opt-In

Direct real transport must require explicit local opt-in. Invocation alone is
not enough.

```text
Direct provider transport may start only when either:
  CODEX_DIRECT_REAL_TURN=1
  --allow-live-provider-call
```

If `CI=true`, direct live transport must also require:

```text
CODEX_DIRECT_REAL_TURN_ALLOW_CI=1
```

Without opt-in:

```text
status = blocked
failure.code = live_provider_call_opt_in_missing
providerRequestStarted = false
```

The opt-in permits one requested headless run. It does not promote evidence, it
does not enable the UI direct toggle, and it does not satisfy implementation-lane
activation gates.

## Auth Law

The harness should use the same persisted credential substrate as the app:

```text
<appUserDataRoot>/direct-auth/auth.json
```

For the Windows mirror direct profile:

```text
C:\LexLattice\codex-review-shell-direct\.profiles\direct\direct-auth\auth.json
```

Rules:

- no raw token values in stdout;
- no raw token values in JSON reports;
- no raw token values in diagnostics;
- token presence may be reported as booleans;
- account identity must be represented by a local evidence key/HMAC;
- expired credentials should attempt refresh before transport if a refresh
  token is present;
- missing credentials return:

```ts
{
  status: "login_required",
  rawTokensExposed: false
}
```

V0 does not need fully headless browser login. It may report login required and
tell the user to launch the app-server/ChatGPT login path. If the existing login
coordinator can open a browser/device flow safely, that can be added as an
explicit `--login-if-missing` option later.

## Live Evidence Law

Define:

```ts
type HeadlessEvidenceMode =
  | "strict"
  | "diagnostic-no-promotion";
```

Direct text real turns require live-text evidence in `strict` mode:

```text
auth + live text evidence + context/request store health
```

If evidence is missing:

```text
status = live_evidence_missing
suggestion = run direct-codex-live-probe
providerRequestStarted = false
```

If evidence exists but is stale or scope-mismatched:

```text
status = live_evidence_stale | live_evidence_scope_mismatch
providerRequestStarted = false
```

The harness must reload probe evidence from disk on every run or detect index
mtime changes. External probe runs must become visible without restarting the
shell process.

`--probe-if-missing` must not silently promote missing evidence. For v0 it is
rejected unless `--diagnostic-probe-mode` is explicitly set. Default behavior is:

```text
missing live evidence -> live_evidence_missing
providerRequestStarted = false
suggestion = run direct-codex-live-probe
```

`--require-live-evidence=false` is diagnostic-only. In
`diagnostic-no-promotion` mode:

- a run may execute only with explicit live provider opt-in;
- the report status is diagnostic;
- no `runtime_probed` evidence is created or promoted;
- no UI direct toggle or implementation-lane gate is satisfied;
- the run must be labeled `runMode = "diagnostic-no-promotion"`.

## Text-Only Runtime Tier

Define:

```ts
type DirectRuntimeTestTier =
  | "text-only-real-turn"
  | "implementation-lane";
```

`text-only-real-turn`:

- may run headless real direct text turns;
- requires live-text evidence;
- requires context pack and request manifest durability;
- requires no tool execution;
- rejects provider tool calls with a safe terminal state;
- does not claim to be a Codex implementation lane.

`implementation-lane`:

- requires live text;
- requires read-only tool continuation evidence;
- requires workspace/backend/recovery gates;
- may become the selected project's left Codex lane binding.

The future UI should not conflate these. It may eventually expose:

```text
Direct text-only preview
Direct implementation lane
```

or keep the user-facing toggle simple while showing gate details in an advanced
panel.

## Run Idempotency

`--client-run-id` is an idempotency key, not just a label.

```text
Same client-run-id + same runtime + same project + same promptDigest +
same requestShapeHash:
  return the existing report or safe resume status.

Same client-run-id with a different promptDigest, runtime, project, or
requestShapeHash:
  reject with client_run_id_conflict.

If a previous run reached providerBytesObserved=true:
  never auto-rerun under the same id.
```

`transport_handoff_unknown` is also not auto-retried. A later repair/resume spec
may define manual recovery, but this harness must not duplicate provider
requests.

## Workspace Override Law

Project configuration is the default workspace truth. If `--project-id` is
provided and `--workspace-kind` or `--workspace-path` differs from project
configuration, the run must require:

```text
--allow-workspace-override
```

The report records:

```ts
workspace: {
  workspaceKind: "wsl" | "local" | "unknown";
  workspaceEvidenceKey?: string;
  workspaceOverrideUsed: boolean;
  rawWorkspacePathExposed: false;
};
```

Normal reports must not include raw absolute workspace paths. Private diagnostic
mode may include local paths only when `--private-diagnostics` is set.

## Prompt Envelope

Both app-server and direct runs should cite the same prompt envelope when they
are compared:

```ts
type HeadlessPromptEnvelope = {
  promptEnvelopeId: string;
  promptDigest: string;
  promptClass: "manual" | "fixture";
  instructionClass?: string;
  currentUserPromptHash: string;
  runtimeNeutralIntentHash?: string;
};
```

Normal reports must not include raw prompt text or prompt file paths.

## Report Schema

Each headless run writes:

```ts
type HeadlessCodexRunReport = {
  schema: "headless_codex_run_report@1";
  runId: string;
  clientRunId?: string;
  runtime: "appserver" | "direct";
  runMode: "strict" | "diagnostic-no-promotion";
  projectId: string;
  startedAt: string;
  completedAt?: string;
  liveProviderCallOptIn: boolean;
  providerRequestStarted: boolean;
  providerBytesObserved: boolean;

  status:
    | "completed"
    | "failed"
    | "blocked"
    | "login_required"
    | "diagnostic"
    | "interrupted";

  requestLifecycle:
    | "preflight_blocked"
    | "auth_refreshing"
    | "context_building"
    | "manifest_building"
    | "request_built"
    | "transport_handoff_started"
    | "transport_handoff_unknown"
    | "streaming"
    | "completed"
    | "failed"
    | "aborted"
    | "interrupted";

  auth: {
    authKind:
      | "appserver-codex-login"
      | "direct-chatgpt-codex"
      | "unknown";
    authSource:
      | "direct-auth-store"
      | "codex-cli-auth"
      | "unknown";
    status: "authenticated" | "expired" | "refresh_failed" | "unauthenticated";
    refreshAttempted: boolean;
    refreshOk: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    accountEvidenceKey?: string;
    rawTokensExposed: false;
  };

  runtimeEvidence: {
    liveProbeEvidenceId?: string;
    liveProbeEvidenceStatus?: string;
    appServerAvailable?: boolean;
    model: string;
    modelSource:
      | "cli-override"
      | "project-config"
      | "live-probe-evidence"
      | "appserver-default"
      | "runtime-default";
    requestShapeClass?:
      | "direct_text_turn_empty_context@1"
      | "direct_text_turn_recent_dialogue@1";
    requestShapeHash?: string;
  };

  prompt: {
    source: "inline" | "file";
    promptEnvelopeId?: string;
    promptDigest: string;
    promptCharCount: number;
    promptPreview?: string;
    promptPreviewRedacted: boolean;
    rawPromptExposed: false;
  };

  workspace: {
    workspaceKind: "wsl" | "local" | "unknown";
    workspaceEvidenceKey?: string;
    workspaceOverrideUsed: boolean;
    rawWorkspacePathExposed: false;
  };

  artifacts: {
    reportId: string;
    reportPathPrintedToStdout: boolean;
    artifactIds: string[];
    sessionId?: string;
    threadId?: string;
    turnId?: string;
    contextBuildId?: string;
    requestManifestId?: string;
    rolloutId?: string;
    rawPathsExposed: false;
  };

  request: {
    store: false | null;
    tools: false | null;
    previousResponseIdUsed: boolean;
    rawRequestBodyStored: false;
  };

  continuity: {
    previousResponseIdUsed: false;
    providerContinuityHandleUsed: false;
    importedContinuityHandleUsed: false;
  };

  appserver?: {
    available: boolean;
    transport: "stdio" | "existing-controller";
    codexVersion?: string;
    schemaVersion?: string;
    initialized: boolean;
    rawProtocolFramesStored: false;
  };

  stream: {
    normalizedEventTypes: string[];
    unknownEvents: Array<{
      rawTypeEvidenceKey: string;
      normalizedAs?: string;
      policy: "ignored-known-benign" | "blocked" | "diagnostic-only";
    }>;
    terminalState: string;
    providerBytesObserved: boolean;
    toolExecuted: boolean;
    continuationSent: boolean;
  };

  assistant: {
    textPreview: string;
    textDigest: string;
    charCount: number;
    rawReasoningExposed: false;
  };

  safety: {
    rawAuthHeadersExposed: false;
    rawBackendRequestsExposed: false;
    rawBackendFramesExposed: false;
    rawWorkspacePathsExposed: false;
    rawSourceHashesExposed: false;
  };

  failure?: {
    code: string;
    rendererSafeMessage: string;
    providerRequestStarted: boolean;
  };
  };
```

Auth resolution is ordered and renderer-safe:

```text
1. direct app auth store
2. existing Codex CLI ChatGPT auth
3. unauthenticated
```

The fallback lets headless direct/app-server parity tests reuse the same
persisted ChatGPT login that Codex app-server already uses, without copying raw
tokens into reports or renderer state. Reports expose only `authSource`, token
presence booleans, and account evidence keys.

Report caps:

```ts
const MAX_HEADLESS_ASSISTANT_PREVIEW_CHARS = 2000;
const MAX_HEADLESS_ERROR_PREVIEW_CHARS = 2000;
const MAX_HEADLESS_EVENT_TYPES = 256;
const MAX_HEADLESS_UNKNOWN_EVENT_TYPES = 128;
```

Reports should be written under:

```text
<appUserDataRoot>/headless-runs/<runId>/report.json
```

The report path may be printed. Raw artifact paths should not be exposed unless
the command is run with a private diagnostic flag.

Before a normal report is written:

```text
1. build report object
2. validate against headless_codex_run_report@1
3. serialize report
4. run raw-exposure scanner
5. write report only if validation and scanning pass
```

If scanning detects a blocking raw exposure, write only a minimal safe report:

```ts
{
  schema: "headless_codex_run_report@1",
  runId,
  runtime,
  runMode,
  status: "failed",
  requestLifecycle: "failed",
  providerRequestStarted: false,
  providerBytesObserved: false,
  failure: {
    code: "raw_exposure_blocked",
    rendererSafeMessage: "Report redaction failed before write.",
    providerRequestStarted: false
  },
  safety: {
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
    rawWorkspacePathsExposed: false,
    rawSourceHashesExposed: false
  }
}
```

## Direct Artifacts

For `--runtime=direct`, the runner must persist before transport:

```text
context pack
request manifest
request_built rollout event
```

The request manifest must record:

- `store=false`;
- `tools=false`;
- `previousResponseIdUsed=false` for first-turn tests;
- model evidence ref;
- live probe evidence id;
- request shape hash;
- role mapping digest;
- provider input projection hash;
- raw request body not stored.

Provider input must be generated from context pack + request manifest, not raw
session files or renderer rows.

V0 direct real-turn support is intentionally narrow:

```text
--new-thread + --context-policy=direct_text_turn_empty_context@1:
  allowed

--new-thread + --context-policy=direct_text_turn_recent_dialogue@1:
  rejected unless a later seed/recent-dialogue path is implemented

--thread-id + --context-policy=direct_text_turn_recent_dialogue@1:
  V1

--thread-id + --context-policy=direct_text_turn_empty_context@1:
  rejected for v0
```

For V0 direct text tests, the report and manifest must prove:

```text
store=false
tools=false
previousResponseIdUsed=false
providerContinuityHandleUsed=false
importedContinuityHandleUsed=false
```

## App-Server Baseline Artifacts

For `--runtime=appserver`, v0 may store only a redacted report and optional
appserver event digest summary.

It should not attempt to transform app-server events into direct canonical
rollouts unless a later import/materialization step explicitly does that.

The baseline report should capture:

- app-server availability;
- selected model if renderer-safe;
- terminal turn state;
- assistant text preview/digest;
- app-server event types if available;
- errors/blockers.

The app-server runner must enforce `--timeout-ms` across startup, initialize,
session setup, and turn completion. On timeout:

```text
1. request graceful shutdown if possible
2. kill the child process if needed
3. report appserver_timeout
4. do not persist raw protocol frames
```

The baseline report should include renderer-safe protocol metadata when
available:

```ts
appserver: {
  available: boolean;
  transport: "stdio" | "existing-controller";
  codexVersion?: string;
  schemaVersion?: string;
  initialized: boolean;
  rawProtocolFramesStored: false;
};
```

## Test Matrix

V0:

```text
direct text first turn:
  prompt -> assistant response -> completed

appserver text first turn:
  prompt -> assistant response -> completed

direct missing auth:
  no provider request
  login_required

direct expired auth:
  refresh before transport
  no raw token logging

direct live evidence missing:
  no provider request
  live_evidence_missing

direct unknown benign lifecycle event:
  classified as known ignored or normalized
  no evidence demotion

direct provider tool call in text-only tier:
  terminal tool_call_blocked_text_only
  no tool execution
  no continuation send
  providerRequestStarted = true

direct abort:
  terminal interrupted/aborted
  no auto retry after bytes observed

direct transport handoff unknown:
  request handed to transport
  no bytes/events observed
  transport_handoff_unknown
  no auto retry
```

V1:

```text
multi-turn direct thread:
  turn 1 completed
  turn 2 uses context pack from projection, not provider previous_response_id

appserver/direct comparison:
  same prompt envelope
  compare terminal state, assistant digest class, event classes

read-only tool request:
  model requests read_file
  local approval required
  read result redacted/bounded
  continuation request manifested before transport
```

V2:

```text
headless parity batch:
  run prompt suite through appserver and direct
  serial by default
  deterministic prompt order
  bounded parallelism only by explicit option
  per-runtime failures do not stop the batch unless --fail-fast
  write aggregate report
  flag behavioral differences
```

## Parity Report

Add:

```ts
type HeadlessRuntimeParityReport = {
  schema: "headless_runtime_parity_report@1";
  runId: string;
  projectId: string;
  promptEnvelopeId: string;
  promptDigest: string;
  appserverReportId?: string;
  directReportId?: string;
  comparison: {
    bothCompleted: boolean;
    bothProducedAssistantText: boolean;
    directUnknownEvents: string[];
    appserverUnknownEvents: string[];
    materialDifferences: Array<{
      kind:
        | "terminal_state_mismatch"
        | "assistant_missing"
        | "runtime_blocked"
        | "unknown_event"
        | "auth_difference"
        | "artifact_missing";
      severity: "info" | "warning" | "blocking";
      summary: string;
    }>;
  };
  rawTextExposed: false;
};
```

The parity report should not expect byte-for-byte assistant equality. It should
compare operational behavior first:

- did a request start lawfully;
- did it complete;
- did it produce assistant text;
- did it preserve safety boundaries;
- did it write expected artifacts;
- did unknown event handling remain controlled.

## Runtime Toggle Implications

The eventual UI toggle should be backed by the same runtime selection contract
as the headless harness:

```ts
type CodexRuntimeSelection = {
  runtime: "appserver" | "direct";
  directTier?: "text-only-real-turn" | "implementation-lane";
};
```

Toggling to direct in the UI should not require implementation-lane evidence if
the selected direct tier is text-only preview. It should require
implementation-lane evidence only when the app claims direct can act as the
Codex implementation lane.

Rollback/toggle back to app-server should:

- not delete direct artifacts;
- not mutate right-pane ChatGPT;
- not terminate running turns silently;
- restore app-server lane selection.

## Failure Codes

Stable headless blocker codes:

```ts
type HeadlessCodexRunBlocker =
  | "project_missing"
  | "workspace_missing"
  | "login_required"
  | "auth_refresh_failed"
  | "live_evidence_missing"
  | "live_evidence_candidate"
  | "live_evidence_expired"
  | "live_evidence_scope_mismatch"
  | "context_store_unhealthy"
  | "context_pack_write_failed"
  | "request_manifest_write_failed"
  | "provider_transport_failed"
  | "transport_handoff_unknown"
  | "provider_unknown_event"
  | "provider_tool_call_in_text_only_tier"
  | "appserver_unavailable"
  | "appserver_timeout"
  | "live_provider_call_opt_in_missing"
  | "client_run_id_conflict"
  | "workspace_override_required"
  | "unsupported_direct_context_policy_for_v0"
  | "raw_exposure_blocked"
  | "timeout"
  | "aborted";
```

Renderer-safe/user-facing messages should be concise, but reports and tests
should assert stable codes.

## Security

The harness must never print or persist in reports:

- raw access tokens;
- refresh tokens;
- auth headers;
- cookies;
- raw request bodies;
- raw backend response frames;
- raw app-server protocol frames;
- absolute private workspace paths;
- raw source file hashes;
- unbounded assistant text;
- raw reasoning text.

Allowed in normal reports:

- booleans for token presence;
- local evidence keys/HMACs;
- request shape hashes;
- event type names;
- assistant bounded preview;
- assistant digest;
- renderer-safe blocker codes;
- artifact ids.

The headless harness must install test sentinels proving it does not call:

- right-pane ChatGPT load, navigate, or open-thread APIs;
- ChatGPT handoff create, modify, dismiss, or submit APIs;
- app-server transport from direct runs;
- direct transport from app-server baseline runs.

## Implementation Order

### Phase -1 - Runtime Contract

- Define `HeadlessCodexRuntime`.
- Define `DirectRuntimeTestTier`.
- Define `HeadlessEvidenceMode`.
- Define request lifecycle states.
- Define client-run-id idempotency rules.
- Define report schemas and validators.
- Define report raw-exposure scanner.
- Define blocker codes.
- Define live provider opt-in guard.
- Decide direct text-only tier gate:
  - auth;
  - live evidence;
  - context/request store health.

### Phase 0 - Direct Real-Turn Runner

- Add `scripts/direct-codex-real-turn.mjs`.
- Parse CLI and enforce live provider opt-in before transport.
- Validate workspace override policy.
- Reuse persisted direct auth root.
- Refresh auth when needed.
- Resolve live probe evidence with disk reload.
- Validate request-shape scope and model evidence scope.
- Support only `--new-thread` + `direct_text_turn_empty_context@1` for v0.
- Build context pack and request manifest.
- Send one real direct text turn.
- Classify `transport_handoff_unknown`, tool-call-in-text-only, and unknown
  events.
- Persist redacted report.

### Phase 1 - Unified Runtime Runner

- Add `scripts/codex-real-turn.mjs`.
- Dispatch `--runtime=direct` to the direct runner.
- Dispatch `--runtime=appserver` to app-server baseline runner.
- Normalize report envelope across runtimes.

### Phase 2 - App-Server Baseline Runner

- Reuse existing app-server controller/protocol where possible.
- Run one text turn.
- Enforce startup/initialize/turn timeout and cleanup policy.
- Capture renderer-safe Codex/app-server version and schema metadata when
  available.
- Capture terminal state and assistant preview/digest.
- Keep raw app-server protocol frames private.

### Phase 3 - Parity Batch

- Add optional `--compare` mode.
- Run prompt through both runtimes.
- Use a shared prompt envelope id.
- Run serially by default with deterministic prompt order.
- Write `headless_runtime_parity_report@1`.
- Do not require assistant text equality.

### Phase 4 - UX Integration

- Use the same runtime selection contract for the UI toggle.
- Add text-only direct preview activation/status.
- Keep implementation-lane activation stricter.
- Surface headless report links from diagnostics if useful.

## Acceptance Criteria

- A Windows user can run a real direct text turn headlessly from
  `C:\LexLattice\codex-review-shell-direct`.
- Direct live transport requires explicit opt-in via
  `CODEX_DIRECT_REAL_TURN=1` or `--allow-live-provider-call`.
- CI direct live transport requires `CODEX_DIRECT_REAL_TURN_ALLOW_CI=1` in
  addition to the normal live-call opt-in.
- The direct runner uses
  `C:\LexLattice\codex-review-shell-direct\.profiles\direct\direct-auth\auth.json`
  by default when `--app-user-data-root` points at the direct profile.
- Missing auth returns `login_required` without provider transport.
- Expired auth attempts refresh before provider transport.
- Missing live evidence returns `live_evidence_missing` without provider
  transport.
- Candidate/stale/scope-mismatched live evidence is reported distinctly.
- Valid `runtime_probed` live evidence allows a direct text-only real turn.
- Direct text-only real turn does not require read-only tool continuation
  evidence.
- Direct implementation-lane activation continues to require read-only tool
  continuation evidence.
- `--probe-if-missing` is disabled by default or restricted to
  diagnostic-no-promotion mode.
- `--require-live-evidence=false` produces diagnostic-no-promotion reports and
  cannot enable UI/runtime gates.
- Reports include `runMode`, `providerRequestStarted`,
  `providerBytesObserved`, `requestLifecycle`, and `liveProviderCallOptIn`.
- `--client-run-id` idempotency prevents duplicate provider requests and
  rejects conflicting runtime/project/prompt/request-shape reuse.
- Workspace CLI overrides require `--allow-workspace-override` and are reported
  without raw path exposure.
- Prompt text is not included in normal reports; prompt digest, source, and char
  count are included.
- Assistant preview and event arrays have explicit caps.
- Direct turn writes context pack and request manifest before transport.
- Direct request manifest records `store=false`, `tools=false`, and no
  `previous_response_id` for first-turn text tests.
- V0 direct runner supports only new-thread + empty-context unless
  recent-dialogue projection support is explicitly implemented.
- Direct reports include continuity fields proving no provider or imported
  continuity handle was used for V0 first-turn tests.
- Headless reports expose no raw tokens, raw headers, raw request bodies, raw
  stream frames, raw paths, raw source hashes, or raw reasoning.
- Unknown provider event names appear in reports and either block or are
  admitted by explicit normalizer policy.
- Unknown events include policy classification without raw payloads.
- Provider tool calls in the text-only tier produce
  `tool_call_blocked_text_only`; no tool executes and no continuation is sent.
- Report JSON is schema-validated and raw-exposure scanned before a successful
  write; redaction failure writes only a minimal safe failure report.
- App-server runner has startup/turn timeout and child cleanup behavior.
- App-server reports include renderer-safe Codex/app-server version,
  schema, transport, and initialization metadata when available.
- Auth reports distinguish appserver Codex login from direct ChatGPT/Codex auth.
- Direct CLI model override must match live evidence scope.
- App-server runner can run a baseline prompt and produce the same report
  envelope shape.
- Compare mode uses a shared prompt envelope id and compares operational
  behavior, not text equality.
- Parity report can compare one app-server run and one direct run without
  assuming identical natural-language output.
- Headless tests install sentinels proving no right-pane ChatGPT navigation or
  handoff queue mutation.
- Tests cover direct success, missing auth, missing evidence, provider tool call
  in text-only tier, and report redaction.

## Final Target

Passing this bundle should mean:

```text
We can run real Codex turns headlessly through app-server or direct, using the
same project/auth substrate, and inspect redacted evidence about what happened.
```

It should not mean:

```text
direct is production
direct is default
direct implementation-lane gates are weakened
tools are generally enabled
right-pane ChatGPT is imported or controlled
app-server can be removed
```
