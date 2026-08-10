# Direct Live Text Turn Surface Spec

Status: implementation specification for the next direct-runtime bundle on the
long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)
- [CODEX_APP_SERVER_ONTOLOGY.md](./CODEX_APP_SERVER_ONTOLOGY.md)

## Purpose

Implement the first app-visible direct runtime path where the left Codex panel
can run one text-only turn through the direct ChatGPT/Codex backend without
starting or attaching to `codex app-server`.

This is the bridge from:

```text
direct transport/probe helpers exist
```

to:

```text
the Codex surface can start, stream, render, and persist a direct text turn
```

The bundle is intentionally narrow. It should prove that the shell can own the
left-lane runtime loop for a harmless text-only turn while preserving the ODEU
boundaries for auth, model authority, stream evidence, persistence, diagnostics,
and tool authority.

## Decision

Add a direct live text controller and surface session:

```text
Codex surface renderer
  -> codex-surface IPC bridge
    -> DirectLiveTextSurfaceSession
      -> DirectLiveTextController
        -> DirectSessionStore
        -> DirectAuthController
        -> Codex Responses transport adapter
          -> ChatGPT subscription Codex backend
```

The existing fixture controller remains as the deterministic non-live path. The
new live controller is available only for explicit `direct-experimental` live
text selection. `legacy-app-server` remains the default runtime.

## Boundary

This bundle changes only the left Codex implementation lane.

It does not:

- modify right-pane ChatGPT thread bindings;
- make direct runtime the default;
- expose raw auth headers, raw access tokens, refresh tokens, raw backend
  request bodies, or raw stream frames to the renderer;
- execute tools;
- continue tool calls;
- import legacy sessions into runnable state;
- clone app-server JSON-RPC as the internal direct runtime contract.

The renderer may continue to speak the existing surface RPC shape for UI
compatibility, but direct runtime state is owned by the direct controller and
session store, not by app-server semantics.

## Current Substrate

The branch already has these usable pieces:

- direct auth store, OAuth login, refresh, logout, and redacted auth IPC;
- direct runtime status facade and model source projection;
- ODEU fixture loader, redaction helpers, normalizer, profile delta builder, and
  report generator;
- direct session store with atomic/session-safe writes, diagnostics, terminal
  turn states, interrupted-turn recovery, and tool obligation records;
- fixture-backed direct controller and surface session;
- direct Responses transport helpers for text-only requests, SSE parsing,
  normalized events, redacted diagnostics, pre-stream refresh, pre-stream retry,
  abort, and persisted text probes;
- read-only tool authority helpers and continuation request builders;
- import materialization and checkpoint quarantine scaffolding.

The missing surface-level capability is:

```text
direct-experimental live text turn
  -> started from the Codex panel
  -> streamed through the direct transport
  -> rendered in the existing transcript UI
  -> persisted in direct-sessions
  -> resumable/readable from direct session store
```

## ODEU Upstream Mapping

The `OAI_CODEX_UPSTREAM_ODEU_PROFILE` distinguishes upstream provider
primitives from Codex CLI and shell choices. This bundle must follow that split.

| ODEU Object | Upstream Primitive | Harness-Owned Projection |
| --- | --- | --- |
| `Account` | Authenticated ChatGPT/Codex identity and plan evidence. | Redacted auth status, pre-stream token refresh, no renderer token access. |
| `Provider` | Endpoint, headers, request/stream policy. | One main-process transport adapter; raw paths and headers isolated there. |
| `Model` | Model catalog/profile evidence. | Select one accepted/profile-backed model; no broad model selector changes. |
| `Turn` | One streamed request/response cycle. | `DirectTurnState`, local turn id, request shape, terminal state. |
| `ResponseItem` | Provider-emitted message/reasoning/tool/error/usage events. | Normalized events with provenance; renderer receives reduced safe items only. |
| `ToolCall` | Provider request for a tool action. | Persisted local obligation; no execution in this bundle. |
| `ToolOutput` | Provider input variant for continuation. | Out of scope until read-only tool continuation bundle. |
| `Conversation` | Provider continuity handle where observed. | Captured as evidence only; local session id remains shell-owned. |
| `LocalThread` | Not upstream law. | Direct session store thread/session object and restart recovery. |
| `Diagnostic` | Not upstream law. | Redacted request shape, response shape, normalized event types, unknown raw types. |

Capability rules:

- `codex_source_inferred` evidence can seed code and fixtures, but cannot enable
  normal runtime controls by itself.
- `runtime_probed` or accepted ODEU profile evidence may enable the live text
  path for a specific model/request shape.
- `stream_observed` evidence can update diagnostics/profile deltas, but unknown
  stream events must not become product behavior until accepted.
- Local approval, sandboxing, thread ids, compaction, and persistence are shell
  authority, not upstream provider authority.

## Runtime Selection

Keep the existing runtime mode enum:

```ts
type CodexRuntimeMode =
  | "legacy-app-server"
  | "direct-experimental"
  | "direct";
```

Add a direct-experimental transport selector:

```ts
type DirectExperimentalTransport =
  | "fixture"
  | "live-text";

type CodexDirectRuntimeBinding = {
  runtimeMode: CodexRuntimeMode;
  directTransport?: DirectExperimentalTransport;
  profileId?: string;
  model?: string;
};
```

Rules:

| Mode | Transport | Behavior |
| --- | --- | --- |
| `legacy-app-server` | ignored | Current app-server path. |
| `direct-experimental` | `fixture` or empty | Existing normalized fixture controller. |
| `direct-experimental` | `live-text` | New live text controller, if auth/profile gates pass. |
| `direct` | any | Still unavailable until full validation gates pass. |

`direct-experimental/live-text` must fail closed to a clear direct status, not
silently start app-server.

## Direct Live Status

Extend direct runtime status with separate truth fields:

```ts
type DirectLiveTextStatus = {
  status:
    | "unavailable"
    | "auth_required"
    | "profile_required"
    | "ready"
    | "running"
    | "degraded"
    | "failed";
  turnRunnable: boolean;
  modelSource: "odeu-profile" | "static-baseline" | "live-probe";
  modelEvidenceState:
    | "candidate"
    | "accepted"
    | "runtime_probed"
    | "rejected"
    | "unknown";
  transport: "direct-live-text";
  appServerRequired: false;
  toolsEnabled: false;
  reason?: string;
};
```

Do not collapse these states:

```text
auth authenticated
model/profile accepted
live text transport ready
turn currently runnable
tool loop runnable
direct default eligible
```

`static-baseline` may display candidate models in diagnostics, but it may not
make `turnRunnable` true unless the baseline entry is marked accepted for this
exact text-only request shape. A successful manual live probe promotes only the
specific model, request shape, endpoint class, and auth/account class that were
probed. It does not promote the whole direct runtime.

## Surface RPC Contract

The direct live surface should support only the RPCs needed by the existing
Codex panel for a text turn:

```text
initialize
account/read
thread/start
thread/read
turn/start
turn/interrupt or turn/abort, if already emitted by the surface
```

Allowed responses:

- `initialize` returns sanitized capabilities and `transport:
  "direct-live-text"`.
- `account/read` returns redacted account/auth summary, not tokens.
- `thread/start` creates a new direct local session unless an explicit
  `sessionId` is provided and valid, then returns a thread snapshot.
- `thread/read` reads a persisted direct session and returns a transcript
  snapshot.
- `turn/start` validates idempotency and active-turn gates, creates or reuses a
  local turn, starts the provider request asynchronously, and returns an ack.
- unsupported methods return visible direct-runtime errors.

The controller must not pretend to support app-server features that are not
implemented. Unsupported methods must not be forwarded to app-server, must not
start app-server, and must be logged as direct diagnostics.

## Turn Start Idempotency

`turn/start` requires a stable client idempotency key:

```ts
type DirectTurnStartParams = {
  sessionId?: string;
  clientTurnRequestId: string;
  promptText: string;
  model?: string;
};
```

Rules:

- if `clientTurnRequestId` already maps to a local turn, return the existing
  turn snapshot/status and do not start a second provider request;
- if the previous turn is streaming, return the running status;
- if the previous turn is terminal, return the terminal snapshot;
- if the previous turn is `request_built` but never streamed, recover according
  to restart policy and do not blindly retry;
- renderer reload, IPC reconnect, surface reload, and user double-submit must
  not create duplicate provider requests.

For this bundle, a direct local session may have at most one non-terminal active
turn:

```text
created
request_built
streaming
tool_waiting
authority_waiting
continuation_ready
```

If another `turn/start` arrives while one of those states is active, return a
visible direct error:

```ts
{
  error: "active_turn_exists",
  activeTurnId: "...",
  status: "streaming" | "tool_waiting" | "..."
}
```

## Streaming RPC Contract

Use an ack-plus-notifications contract:

```text
turn/start
  -> returns quickly after creating/reusing the local turn
  -> stream updates arrive through existing Codex surface notifications
  -> terminal state arrives through exactly one terminal notification
```

Required behavior:

- `turn/start` returns before stream completion;
- assistant deltas render via notifications;
- terminal state notification arrives exactly once;
- `thread/read` after completion reconstructs the same transcript;
- main owns the active provider stream, so renderer reload does not cancel or
  duplicate a live turn unless the user explicitly aborts.

## Request Construction

Use the existing direct transport request builder as the first implementation
base:

```text
model: accepted profile model or explicit project model if accepted
stream: true
store: false
instructions: narrow text-only Codex probe/runtime instruction
input: one user text message
tools: omitted
tool_choice: omitted
parallel_tool_calls: omitted
```

Request fields are allowed only when an accepted ODEU capability authorizes
them. For this bundle, do not add normal UI controls for:

- reasoning effort;
- reasoning summary;
- verbosity;
- service tier;
- prompt cache key;
- include;
- structured output;
- tools.

If the transport helper includes a field for probe purposes, the live surface
must record the request shape in diagnostics and keep the renderer away from the
raw body.

## Stream Reduction

The upstream profile requires two stages:

```text
raw provider event
  -> normalized ODEU stream event with provenance
  -> renderer-safe Codex transcript event
```

Mapping for this bundle:

| Normalized Event | Direct Turn Effect | Renderer Event |
| --- | --- | --- |
| `response_created` | Record provider response id if present. | none or status update |
| `message_delta` | Append assistant text. | `item/started`, `item/agentMessage/delta`, `item/completed` |
| `reasoning_delta` | Persist as evidence/diagnostic only. | none in v0 |
| `usage` | Persist diagnostic/profile evidence. | no required UI in this bundle |
| `response_completed` | Mark turn `completed`. | `turn/completed` |
| `response_incomplete` | Mark turn `failed`. | visible error |
| `response_failed` | Mark turn `failed`. | visible error |
| `auth_error` | Mark turn `failed`; require explicit user action. | visible error |
| `quota_error` | Mark turn `failed`; do not retry. | visible error |
| `transport_error` before stream | retry only under pre-stream retry policy. | retry status then error if exhausted |
| `transport_error` after stream | mark `failed`; no blind retry. | visible error |
| `aborted` | Mark turn `aborted`. | `turn/completed` or visible aborted status |
| `tool_call_*` | Persist obligation and mark `tool_waiting`. | read-only tool-call card/status |
| unknown raw event | Capture redacted diagnostic/profile evidence. | no direct behavior unless semantically safe |

Tool calls are detection-only in this bundle.

Reasoning deltas are not rendered in this bundle. Do not expose raw reasoning
content to the renderer. Rendering reasoning summaries requires a later accepted
summary-shaped ODEU capability and a renderer-safe item type.

## Renderer Item Identity

Use stable local transcript item ids:

```ts
type DirectRendererItemIds = {
  sessionId: string;
  turnId: string;
  assistantMessageItemId: string;
};
```

Rules:

- emit `item/started` once per assistant message item;
- all deltas for that assistant message use the same item id;
- emit `item/completed` once;
- do not emit `item/completed` per delta;
- if the backend emits multiple message items, either support multiple stable
  local assistant item ids or, for this first bundle, merge assistant text into
  one local assistant item and record raw multiplicity in diagnostics.

## Persistence

Direct sessions remain under the direct session root:

```text
direct-sessions/
  index.json
  sessions/<session-id>/session.json
  sessions/<session-id>/turns/<turn-id>.json
  sessions/<session-id>/events/<turn-id>.normalized.jsonl
  diagnostics/<session-id>/<diagnostic-id>.redacted.jsonl
```

Turn state machine:

```ts
type DirectTurnState =
  | "created"
  | "request_built"
  | "streaming"
  | "tool_waiting"
  | "authority_waiting"
  | "continuation_ready"
  | "completed"
  | "failed"
  | "aborted"
  | "checkpoint_required";
```

Every direct live session must persist local project/runtime metadata:

```ts
type DirectLiveSessionMetadata = {
  projectId: string;
  workspaceKind: "local" | "wsl" | "unknown";
  workspaceDisplayPath: string;
  runtimeMode: "direct-experimental";
  directTransport: "live-text";
  model: string;
  modelSource: "odeu-profile" | "static-baseline" | "live-probe";
  modelEvidenceState: "accepted" | "runtime_probed";
};
```

Recovery must not rely on process-global current project state.

Required write sequence:

1. Create session if no direct session is active.
2. Create turn in `created`.
3. Build request and update to `request_built`.
4. Start fetch and update to `streaming` only after stream begins.
5. Append normalized events as they are reduced or at terminal flush.
6. Persist diagnostics on failure, malformed stream, unknown event, auth error,
   quota error, and tool detection.
7. Persist terminal state exactly once.
8. Update session transcript summary.

Crash/restart behavior:

- `request_built`, `streaming`, `tool_waiting`, `authority_waiting`, and
  `continuation_ready` survive restart as explicit non-completed states.
- Interrupted active turns recover into `failed` with
  `restart_interrupted_turn`, unless already terminal.
- `thread/read` can reconstruct a read-only transcript from the direct session
  store without `CODEX_HOME`.

## Abort And Retry Semantics

Abort race rules:

- if abort is requested before stream starts, abort fetch if possible and mark
  the turn `aborted`;
- if abort is requested after stream starts, abort fetch, persist normalized
  events received so far, and mark the turn `aborted`;
- if completion wins the race, terminal `completed` remains final and abort
  returns `completed_already`;
- if failure wins the race, terminal `failed` remains final and abort returns
  `failed_already`;
- abort never deletes partial normalized events or diagnostics.

Pre-stream retry policy:

```ts
type DirectPreStreamRetryPolicy = {
  maxAttempts: 2;
  retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504];
  retryableNetworkErrors: string[];
  baseDelayMs: 250;
  maxDelayMs: 1000;
};
```

`maxAttempts: 2` means the initial attempt plus one retry. Once any provider
response body byte or normalized event is observed, the original request is
never retried.

## Auth And Security

All auth handling stays in the main process.

Rules:

- Renderer never receives access tokens, refresh tokens, auth headers, raw
  backend request bodies, or raw backend stream frames.
- Access tokens may be refreshed before a stream starts.
- If auth fails before stream start, the turn fails with an auth terminal state
  and may be retried only by explicit user action after auth recovery.
- If auth fails after stream start, do not retry the original request blindly.
- Redacted diagnostics may include auth status class, refresh attempted flag,
  and failure code, but not tokens or credential paths.

## Tool Authority Boundary

If the backend emits a tool call during live text mode:

1. Normalize the tool call.
2. Persist a stable local obligation id.
3. Mark the turn `tool_waiting`.
4. Render a read-only tool-call card or system status.
5. Do not execute the tool.
6. Do not send a continuation.
7. Emit profile evidence for the observed tool-call shape.

In this bundle, `tool_waiting` is terminal for live text UX purposes. The
composer remains disabled for that direct session until the user starts a new
direct session, switches runtime, or a future tool-continuation bundle handles
the obligation. A later manual resolution may mark the turn
`failed/tool_unhandled`, but this bundle must not execute or continue it.

This preserves the rule:

```text
provider tool call != local authority
```

Read-only workspace execution and continuation belong to the next bundle.

## Diagnostics And ODEU Evidence

Every live text turn should produce a redacted diagnostic envelope with:

- schema id and timestamp;
- runtime mode and transport;
- model id and model source;
- request shape, not raw request body;
- endpoint class or redacted endpoint, not auth headers;
- response status and content type;
- normalized event types;
- unknown raw event types;
- terminal state;
- retry summary;
- refresh summary;
- tool detection summary;
- idempotency key and duplicate/reused-turn status;
- confirmation that raw tokens, raw request bodies, and raw frames were not
  exposed to the renderer.

Unknown or malformed stream events become ODEU evidence first. They may not
enable UI controls or runtime behavior until accepted in the profile.

Content-size guards:

- cap user prompt characters before building the request;
- cap assistant text buffered in memory before transcript flush;
- cap diagnostic event count;
- cap unknown event payload size after redaction;
- record truncation flags in diagnostics.

## UI Requirements

The Codex surface must label the runtime truthfully:

```text
Direct runtime: live text experimental
Tools: detection only
Current lane: direct ChatGPT/Codex backend
```

The middle/control pane should continue to distinguish:

- direct auth status;
- direct profile/model source;
- direct runtime status;
- direct panel attach status;
- direct turn runnable status.

Composer behavior:

- enabled only when `direct-experimental/live-text` is ready;
- disabled with a specific reason when auth/profile/live status is not ready;
- disabled after a detected tool call until a future tool authority bundle can
  continue lawfully.

Right-pane ChatGPT bindings are not modified by direct left-lane session state.

## Implementation Plan

### Step 1: Controller And Surface Session

Add:

```text
src/main/direct/controller/live-text-controller.js
```

Responsibilities:

- expose `DirectLiveTextController`;
- expose `DirectLiveTextSurfaceSession`;
- advertise `DIRECT_LIVE_TEXT_SURFACE_TRANSPORT = "direct-live-text"`;
- implement `initialize`, `account/read`, `thread/start`, `thread/read`, and
  `turn/start`;
- implement `clientTurnRequestId` idempotency;
- enforce one active non-terminal turn per direct session;
- own the active stream in main across renderer reloads;
- delegate request/stream work to the direct transport helper;
- delegate session writes to `DirectSessionStore`;
- emit existing Codex surface notifications.

### Step 2: Safety Gates Before Live Fetch

Before live fetch is reachable:

- reject missing `clientTurnRequestId`;
- reuse duplicate `clientTurnRequestId` without starting a second provider
  request;
- reject a second active turn with `active_turn_exists`;
- require accepted/runtime-probed model evidence for the exact text-only request
  shape;
- configure the fixed pre-stream retry policy;
- install app-server spawn sentinel coverage in tests.

### Step 3: Main Process Wiring

Update main process runtime selection:

- `legacy-app-server` keeps existing behavior;
- `direct-experimental` plus `directTransport: "fixture"` uses the fixture
  controller;
- `direct-experimental` plus `directTransport: "live-text"` uses the live text
  controller;
- direct live text readiness appears in `direct-runtime:status`;
- `codex-surface:connect/request/notify/respond` route to the correct direct
  surface session.

### Step 4: Renderer Compatibility

Keep renderer changes small:

- accept `direct-live-text` as a direct connection transport;
- render direct live status in the same runtime constitution area;
- keep existing transcript item rendering;
- show tool detection as read-only, not executable;
- make unsupported direct methods visible as runtime errors.

### Step 5: Tests

Extend fixture smoke coverage with fake transport/auth:

- live text initialize/account/thread/start/turn path without app-server;
- fake SSE text delta -> transcript item -> completed persisted turn;
- fake auth-required status blocks turn;
- pre-stream refresh is called when credentials are expiring;
- pre-stream retry happens only before stream start;
- abort persists `aborted`;
- tool event persists `tool_waiting` and does not execute;
- unknown raw event is captured in redacted diagnostic;
- thread read after new store instance reconstructs transcript;
- raw token/header/body/frame exposure flags stay false.
- duplicate `turn/start` with the same `clientTurnRequestId` reuses the turn and
  does not create a second provider request;
- a second `turn/start` during an active turn returns `active_turn_exists`;
- renderer reload during streaming does not start a second provider request;
- app-server launcher/spawn sentinel is not invoked in
  `direct-experimental/live-text`;
- reasoning deltas are persisted only and not rendered;
- abort/completion races resolve to exactly one terminal state;
- unsupported methods are visible direct errors and never forwarded to
  app-server.

Do not require a real backend in CI. The existing manual live probe remains
explicitly gated by environment variables.

### Step 6: Manual Live Probe Path

After fake-fetch smoke passes, run the manual live path only with an already
authenticated direct store:

```text
CODEX_DIRECT_LIVE_PROBE=1 npm run direct:probe:live
```

Manual live probe success is evidence for `runtime_probed`, not permission to
make direct mode default.

## Acceptance Criteria

This bundle is complete when:

- a project can select `direct-experimental/live-text`;
- the app starts that project without starting `codex app-server`;
- the Codex panel can start a new direct local thread;
- one text-only prompt streams assistant text into the existing transcript UI;
- the turn persists to `direct-sessions`;
- a new app/session store instance can read the persisted direct transcript;
- duplicate `turn/start` with the same `clientTurnRequestId` does not create a
  second provider request;
- a second `turn/start` during an active turn is rejected with
  `active_turn_exists`;
- renderer reload during streaming does not start a second provider request;
- app-server launcher/spawn is not invoked in `direct-experimental/live-text`;
- failed, aborted, malformed, quota, and auth-related turns persist terminal
  state and redacted diagnostics;
- abort/completion/failure races resolve to exactly one terminal state;
- pre-stream retry has a fixed max-attempt policy;
- post-stream transport/auth failure never retries the original request;
- reasoning deltas are persisted as evidence only and not rendered in v0;
- a model tool call is detected and persisted as a local obligation without
  execution;
- `tool_waiting` disables forward UX for that session until a new session,
  runtime switch, or future continuation bundle;
- unsupported surface methods are visible errors and never forwarded to
  app-server;
- direct session metadata includes project id, workspace identity, runtime mode,
  transport, model, and model source;
- renderer exposure checks remain false for raw tokens, headers, request bodies,
  and stream frames;
- switching the project back to `legacy-app-server` does not delete direct
  sessions or diagnostics;
- `npm run direct:smoke` covers the non-live path with fake fetch/auth.

## Rollback

Rollback must be local and non-destructive:

- project can switch from `direct-experimental/live-text` to
  `direct-experimental/fixture` or `legacy-app-server`;
- direct sessions and diagnostics remain on disk;
- app-server sessions remain untouched;
- no right-pane ChatGPT threads are modified.

## Explicit Non-Default Rule

Passing this bundle does not make `direct` mode available by default.

It only proves:

```text
direct-experimental live text turns are runnable for explicitly selected
projects under the accepted text-only request shape.
```

Default replacement still requires later gates:

- tool call authority and continuation;
- denial/cancel continuation behavior;
- import checkpoint continuation;
- quota/context/profile updates from live evidence;
- restart recovery across completed, failed, aborted, and unresolved-tool turns;
- long-running drift diagnostics against Codex CLI/app-server as oracle.
