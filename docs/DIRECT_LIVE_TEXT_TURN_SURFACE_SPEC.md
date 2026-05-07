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
- `thread/start` creates a direct local session and returns a thread snapshot.
- `thread/read` reads a persisted direct session and returns a transcript
  snapshot.
- `turn/start` builds one text-only request, streams, persists, and returns a
  terminal or waiting status.
- unsupported methods return visible direct-runtime errors.

The controller must not pretend to support app-server features that are not
implemented.

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
| `reasoning_delta` | Persist as observed event, optional commentary projection. | commentary item only if already supported safely |
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
- confirmation that raw tokens, raw request bodies, and raw frames were not
  exposed to the renderer.

Unknown or malformed stream events become ODEU evidence first. They may not
enable UI controls or runtime behavior until accepted in the profile.

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
- delegate request/stream work to the direct transport helper;
- delegate session writes to `DirectSessionStore`;
- emit existing Codex surface notifications.

### Step 2: Main Process Wiring

Update main process runtime selection:

- `legacy-app-server` keeps existing behavior;
- `direct-experimental` plus `directTransport: "fixture"` uses the fixture
  controller;
- `direct-experimental` plus `directTransport: "live-text"` uses the live text
  controller;
- direct live text readiness appears in `direct-runtime:status`;
- `codex-surface:connect/request/notify/respond` route to the correct direct
  surface session.

### Step 3: Renderer Compatibility

Keep renderer changes small:

- accept `direct-live-text` as a direct connection transport;
- render direct live status in the same runtime constitution area;
- keep existing transcript item rendering;
- show tool detection as read-only, not executable;
- make unsupported direct methods visible as runtime errors.

### Step 4: Tests

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

Do not require a real backend in CI. The existing manual live probe remains
explicitly gated by environment variables.

### Step 5: Manual Live Probe Path

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
- failed, aborted, malformed, quota, and auth-related turns persist terminal
  state and redacted diagnostics;
- a model tool call is detected and persisted as a local obligation without
  execution;
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
