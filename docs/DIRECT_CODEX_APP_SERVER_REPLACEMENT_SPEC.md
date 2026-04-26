# Direct ChatGPT/Codex Runtime Cutover Spec

Status: draft architecture spec for the parallel direct-runtime track on the
direct ChatGPT/Codex branch.

This spec does not authorize removing legacy `codex app-server` mode from the
standalone shell until the validation gates pass. The file name preserves the
original design-thread reference; operationally this is a cutover track, not an
immediate removal plan.

Related specs:

- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [CODEX_INTERNAL_KNOBS_ODEU_MAP.md](./CODEX_INTERNAL_KNOBS_ODEU_MAP.md)

## Purpose

Define the path from the current hybrid implementation to a fully direct
left-plane Codex surface.

This branch is the long-lived direct-runtime branch. Mainline remains the
standard Codex CLI / `codex app-server` runtime until this branch proves direct
auth, direct model calls, session persistence, tool continuation, import, and
ODEU gates.

The current branch already owns ChatGPT OAuth credentials, token refresh, and
the private credential store. It still uses `codex app-server` as the live
runtime that owns thread operations, request construction, backend transport,
stream parsing, tool orchestration, and session persistence.

This spec defines what must move from `codex app-server` into
`codex-review-shell-direct`.

Goal:

```text
Codex surface UX
  -> repo-owned direct controller
  -> repo-owned direct session engine
  -> repo-owned ChatGPT Codex transport adapter
  -> chatgpt.com/backend-api/codex/responses
```

Non-goal before cutover gates pass:

```text
Codex surface UX
  -> codex app-server
  -> OpenAI backend
```

## Current Hybrid State

Current runtime ownership:

| Capability | Current owner |
| --- | --- |
| ChatGPT OAuth browser login | `codex-review-shell-direct` main process |
| Auth credential persistence | `codex-review-shell-direct` direct auth store |
| Access-token refresh | `codex-review-shell-direct` direct auth store/coordinator |
| App-server external token login | temporary bridge from direct auth store |
| Thread start/read/resume/list | `codex app-server` |
| Model list/account read/rate limits | `codex app-server` |
| Request construction | `codex app-server` |
| Backend transport | `codex app-server` |
| Stream parsing | `codex app-server` |
| Tool-call loop | `codex app-server` plus shell request responses |
| Session files/history | `CODEX_HOME` owned by `codex app-server` |
| Codex panel rendering | local Electron renderer |
| Workspace command/file authority | local shell/workspace backend |

The hybrid bridge is useful only as a transition. It proves that direct auth can
feed the official app-server external token mode, but it does not make the
runtime direct.

## External Baseline

The official [Codex app-server documentation](https://developers.openai.com/codex/app-server)
defines app-server as the rich-client interface for Codex integrations, including
authentication, conversation history, approvals, and streamed agent events. It
uses JSON-RPC, defaults to stdio transport, marks WebSocket transport as
experimental, and can emit version-specific TypeScript or JSON Schema artifacts.
Replacing it means this repo owns protocol drift rather than delegating it.

The official [Codex authentication documentation](https://developers.openai.com/codex/auth)
distinguishes ChatGPT subscription sign-in from API-key usage and documents
cached login behavior. Direct OAuth in this branch is therefore its own
acceptance surface, not proof that direct turns are runnable.

The public [Codex agent-loop article](https://openai.com/index/unrolling-the-codex-agent-loop/)
identifies `https://chatgpt.com/backend-api/codex/responses` as the ChatGPT
login path used by Codex CLI, while API-key auth uses the public Responses API.
Treat this as high-signal evidence for the direct path, not as a stable public
Platform API guarantee.

The official [Codex model documentation](https://developers.openai.com/codex/models)
shows that model availability depends on sign-in path and rollout state. Direct
mode must use ODEU profiles and live probes rather than hard-coded model
assumptions.

## Dependency Boundary

The direct branch must remove these hard runtime dependencies before it can be
called fully direct:

- `codex` executable installed on PATH;
- `codex app-server --listen ...`;
- app-server JSON-RPC request/notification lifecycle;
- `CODEX_HOME` as the canonical live session store;
- Codex app-server schema generation as runtime authority;
- app-server-owned token refresh requests;
- app-server-owned thread ids and session files for new direct work.

Codex CLI/app-server remains useful as:

- an upstream drift oracle;
- a comparative harness for probes;
- an import source for existing threads;
- a legacy compatibility mode if the user explicitly chooses it.

It must not remain required for new direct sessions.

## Runtime Modes

Runtime family and execution location are separate concepts. Existing choices
such as `auto`, `host`, and `wsl` describe where a runtime executes; they must
not be overloaded to mean direct runtime.

Direct branch runtime mode:

```ts
type CodexRuntimeMode =
  | "legacy-app-server"
  | "direct-experimental"
  | "direct";

type CodexBinding = {
  provider: "codex-compatible" | "custom-codex-fork" | "direct-chatgpt-codex";
  runtimeMode: CodexRuntimeMode;
  target?: string;
  profileId?: string;
};
```

Mode rules:

| Mode | Rule |
| --- | --- |
| `legacy-app-server` | Current default while the direct runtime matures. Direct auth attachment is optional bridge behavior. |
| `direct-experimental` | Explicit opt-in only. UI must show that direct turns are experimental and gated by profile/session status. |
| `direct` | Unavailable until validation gates pass. Once enabled, it means new left-lane sessions no longer require app-server. |

## Product Boundary

This replacement is not a generic model-provider layer and not an OpenAI
Platform API integration.

The direct runtime changes only the left Codex implementation lane. It does not
replace the right ChatGPT review/world-model thread deck, does not collapse the
app into a unified chat runtime, and must not modify right-pane thread bindings
unless the user explicitly stages a handoff.

Initial target:

```text
ChatGPT subscription-authenticated Codex backend through the observed
chatgpt.com/backend-api/codex/responses contract.
```

The direct adapter is volatile and isolated. Everything above it must consume a
stable local contract owned by this repo.

Good standalone exposure:

```text
Runtime: legacy app-server / direct experimental
Auth status
Runtime status
Model list source
Direct session status
Tool approval required
Diagnostics available
```

Bad standalone exposure:

```text
Raw backend event stream browser
Every internal ODEU profile delta as main navigation
Deep harness control graph
Meta-orchestrator dashboard
Provider internals as product identity
```

## Architecture

Replace the app-server lane with four main-process layers:

```text
Codex surface renderer
  -> direct-surface bridge
    -> direct session controller
      -> ADEU session engine
        -> tool authority router
        -> ChatGPT Codex transport adapter
          -> direct auth store
          -> request builder
          -> SSE stream client
          -> raw event normalizer
          -> chatgpt.com/backend-api/codex/responses
```

Layer responsibilities:

| Layer | Responsibility |
| --- | --- |
| `direct-surface bridge` | Renderer IPC surface for direct thread/turn/account operations. No raw tokens. |
| `direct session controller` | Project binding, active session selection, lifecycle, aborts, renderer events. |
| `ADEU session engine` | Local thread state, turns, compaction checkpoints, ODEU profile snapshots, persistence. |
| `tool authority router` | Convert normalized tool calls into workspace authority requests and validated tool results. |
| `ChatGPT Codex transport adapter` | Backend endpoint, headers, request body, SSE parsing, retry/error/auth mapping. |

The renderer should not know whether the backing runtime is app-server or direct
except through a sanitized capability profile.

Volatility contract:

- Only `ChatGPT Codex transport adapter` may reference raw backend paths,
  headers, request field names, or raw stream event names.
- Raw backend events are profile evidence before they are runtime behavior.
- Unknown events must not crash the session engine unless continuing the turn
  would be semantically unsafe.

## Surface Strategy

There are two possible migration shapes.

Preferred shape:

```text
Keep the existing Codex panel visual shell.
Replace the bridge behind it.
```

The existing `src/renderer/codex-surface.js` already renders transcripts,
status badges, request cards, and the composer. Reusing it reduces UX churn.
The main process can provide a direct runtime mode with a bridge that has the
operations the renderer actually needs.

Do not clone app-server JSON-RPC as the internal direct contract. Instead, build
a small direct bridge and keep any app-server method names as compatibility
facade only while the renderer migrates.

Initial bridge operations:

```ts
type DirectSurfaceBridge = {
  connect(connection: DirectConnectionDescriptor): Promise<DirectConnectionStatus>;
  disconnect(): Promise<void>;
  accountRead(): Promise<DirectAccountStatus>;
  modelList(): Promise<DirectModelList>;
  threadStart(params: DirectThreadStartParams): Promise<DirectThread>;
  threadRead(params: DirectThreadReadParams): Promise<DirectThreadSnapshot>;
  threadResume(params: DirectThreadResumeParams): Promise<DirectThread>;
  turnStart(params: DirectTurnStartParams): Promise<DirectTurn>;
  turnInterrupt(params: DirectTurnInterruptParams): Promise<DirectTurnStatus>;
  respondRequest(params: DirectAuthorityResponse): Promise<DirectAuthorityResult>;
};
```

Compatibility rule:

```text
App-server method names may exist at the renderer boundary only as an adapter.
ADEU/session/transport code must not be organized around app-server JSON-RPC.
```

## Direct Runtime Capability Profile

The app-server manager currently emits a runtime capability profile. The direct
runtime must emit its own profile.

Minimum shape:

```ts
type DirectRuntimeCapabilityProfile = {
  version: 1;
  runtime: "direct-chatgpt-codex";
  status: "starting" | "ready" | "degraded" | "failed";
  generatedAt: string;

  auth: {
    source: "direct-auth-store";
    status: "authenticated" | "expired" | "refresh_failed" | "unauthenticated";
    rawTokensExposed: false;
  };

  transport: {
    kind: "sse";
    endpoint: "chatgpt-codex-responses";
    liveProbed: boolean;
  };

  threads: {
    canStart: boolean;
    canRead: boolean;
    canResume: boolean;
    canPersist: boolean;
    canImportCodexAppServer: boolean;
  };

  turns: {
    canStart: boolean;
    canInterrupt: boolean;
    canUseTools: boolean;
    canContinueAfterTools: boolean;
    canCompact: boolean;
  };

  models: {
    source: "odeu-profile" | "static-baseline" | "live-probe";
    ids: string[];
  };

  authority: {
    workspaceTools: boolean;
    commandApproval: boolean;
    fileChangeApproval: boolean;
    networkApproval: boolean;
  };

  diagnostics: {
    profileId: string;
    profileStatus: "observed" | "probed" | "accepted" | "unstable";
    legacyAppServerAvailable: boolean;
  };
};
```

Renderer affordances must be gated from this profile, not from hard-coded
assumptions about the backend.

Capability rules:

- Renderer controls are enabled only by accepted direct-runtime capabilities.
- Observed and probed capabilities may appear in diagnostics, not normal
  controls.
- Accepted app-server capability does not imply accepted direct-runtime
  capability.
- No request field, stream event, model id, tool shape, continuation shape, or
  retry behavior may become a normal runtime feature without an accepted ODEU
  capability record.

Profile layers must remain distinct:

```text
oai-server capability
codex-app-server capability
local-harness capability
direct-runtime capability
```

## Direct Auth Capability Profile

Direct auth is separate from runtime readiness.

```ts
type DirectAuthCapability = {
  status: "observed" | "probed" | "accepted" | "unstable" | "rejected";
  acquisition: "browser-callback" | "manual-code-paste" | "imported-codex-auth" | "unknown";
  refresh: "accepted" | "unstable" | "unavailable";
  accountIdSource: "token-claim" | "profile-endpoint" | "unknown";
  storage: "os-keychain" | "encrypted-file" | "plain-file-dev-only";
};
```

These states must not be collapsed:

```text
OAuth login works
access token refresh works
account identity is known
backend request auth works
Codex turn is runnable
```

## Direct Session Model

The direct runtime owns native session ids. New direct sessions must not use
Codex app-server session files as authority.

Recommended local store:

```text
<app userData>/direct-sessions/
  index.json
  sessions/<session-id>/session.json
  turns/<session-id>/<turn-id>.json
  events/<session-id>/<turn-id>.normalized.jsonl
  diagnostics/<session-id>/<fixture-id>.redacted.jsonl
```

Session writes must be atomic or append-safe. A crash during turn persistence
must leave either the previous good session state or a recoverable partial turn
record.

Turn state:

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

Minimum persisted state:

```ts
type DirectSession = {
  schema: "direct_codex_session@1";
  sessionId: string;
  projectId: string;
  workspace: DirectWorkspaceRef;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  promptCacheKey: string;
  profileSnapshotId: string;
  messages: DirectMessage[];
  turns: DirectTurnSummary[];
  unresolvedObligations: DirectObligation[];
  compactionCheckpoints: DirectCompactionCheckpoint[];
};
```

State rules:

- Store normalized session state, not raw backend event streams.
- Store raw streams only in redacted diagnostic fixtures when explicitly
  captured.
- Preserve tool-call and tool-result pairing.
- Preserve rejected/blocked tool calls as state, not as invisible failures.
- Preserve ODEU profile snapshot id per turn.
- Never replay tool calls automatically after import, crash, or resume.

## Request Builder

The request builder maps local ADEU session state to the observed ChatGPT Codex
backend request.

Initial required inputs:

```ts
type DirectCodexRequestBuildInput = {
  session: DirectSession;
  turn: DirectTurn;
  auth: DirectAuthCredentialProjection;
  model: string;
  instructions: string;
  input: DirectInputItem[];
  tools: DirectToolSchema[];
  toolResults: DirectToolResult[];
  reasoning: DirectReasoningPolicy;
  text: DirectTextPolicy;
  profile: DirectCodexOdeuProfileSnapshot;
};
```

Builder outputs:

```ts
type DirectCodexHttpRequest = {
  method: "POST";
  url: "https://chatgpt.com/backend-api/codex/responses";
  headers: Record<string, string>;
  body: unknown;
  redactionPlan: DirectRedactionPlan;
};
```

Builder rules:

- Header construction lives in one module.
- Backend field names live in one module.
- Prompt cache/session affinity fields must be explicit and explainable.
- Every optional field must cite the ODEU profile capability that allows it.
- The following fields are forbidden in normal runtime requests until accepted
  by profile evidence: `store`, `prompt_cache_key`, `include`, `reasoning`,
  `text.verbosity`, `parallel_tool_calls`, `tool_choice`, tool-result
  continuation fields, and cache/session-affinity fields.
- No renderer code constructs backend requests.
- No workspace backend code constructs backend requests.

## Transport

Initial direct transport is SSE over `fetch`.

Transport requirements:

- Use direct auth access token from main process only.
- Refresh once on auth-expiry/401 class errors, then retry if lawful.
- Stream response frames incrementally.
- Preserve partial JSON buffers.
- Normalize all raw event names before they reach the session engine.
- Support abort from the renderer through main process.
- Apply retry only to transient transport/server/rate failures.
- Never retry after a tool side effect unless the session engine has recorded
  the tool result and can construct a lawful continuation.
- Once a local side effect is executed, the original model request is never
  retried. Only a continuation request built from recorded tool evidence may
  proceed.
- A failed direct auth refresh after a stream starts marks the turn failed with
  an auth-related state and requires explicit user resume.

Retry classes:

| Class | Retry behavior |
| --- | --- |
| network before stream starts | retry with bounded backoff |
| 401/expired token before stream starts | refresh token once, then retry |
| 401 after stream starts | stop turn, mark auth error, require explicit resume |
| 429/rate/quota | no blind retry; surface quota/rate state |
| 5xx before stream starts | bounded retry |
| malformed stream event | fail turn and capture redacted fixture |
| abort | no retry |

## Event Normalization

Raw backend events are not a harness contract.

Minimum normalized events:

```ts
type DirectNormalizedEvent =
  | { type: "turn_started"; turnId: string; backendRequestId?: string }
  | { type: "message_started"; itemId: string; role: "assistant" }
  | { type: "message_delta"; itemId: string; text: string }
  | { type: "message_completed"; itemId: string }
  | { type: "reasoning_started"; itemId: string; visibility: "summary" | "opaque" }
  | { type: "reasoning_delta"; itemId: string; text: string; visibility: "summary" | "opaque" }
  | { type: "reasoning_completed"; itemId: string }
  | { type: "tool_call_started"; itemId: string; callId: string; name: string }
  | { type: "tool_call_delta"; itemId: string; callId: string; argumentsDelta: string }
  | { type: "tool_call_completed"; itemId: string; callId: string; argumentsJson: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
  | { type: "turn_completed"; stopReason: "stop" | "tool_use" | "length" }
  | { type: "turn_failed"; code: string; message: string; authRelated: boolean; retryable: boolean }
  | { type: "turn_aborted" };
```

Normalizer requirements:

- Keep enough source metadata for diagnostics.
- Redact token-bearing data before any fixture write.
- Treat unknown raw events as `unstable` profile evidence, not as success.
- Capture malformed or unknown raw stream frames as redacted evidence and
  classify them before adding any runtime behavior.
- Do not expose a new event class to UI until it has an accepted rendering rule.

## Tool Authority Loop

Direct tool calls must preserve the existing evidence-before-commit posture.

Flow:

1. Backend emits a normalized tool call.
2. Session engine records the tool call and pauses model continuation.
3. Authority router maps the tool name to a local capability.
4. If approval is required, main process emits a Codex request card to the
   Codex panel and middle-plane queue.
5. User approves, declines, cancels, or edits allowed inputs where the tool
   contract permits it.
6. Workspace backend executes only approved tool calls.
7. Session engine records result evidence.
8. Request builder sends a continuation request with tool results.

Authority rules:

- A model tool call is never authority by itself.
- Every tool call has a stable local obligation id.
- Every tool result pairs to exactly one tool call.
- Declined, rejected, canceled, or expired tool calls are persisted as
  obligations with terminal states.
- File writes require project/workspace binding evidence.
- Commands require explicit approval policy.
- Network requests require explicit network authority.
- Tool result text must be treated as model input in the next continuation and
  stored as evidence.
- Failed tool executions must be sent back as tool results only when the profile
  accepts that error-result shape.

## Direct Account And Model State

`account/read` and `model/list` currently come from app-server. Direct mode must
replace them.

Direct account state:

```ts
type DirectAccountStatus = {
  type: "chatgpt";
  authenticated: boolean;
  email?: string;
  planType?: string;
  accountIdRedacted: string;
  source: "direct-auth-store";
  rawTokensExposed: false;
};
```

Direct model list:

```ts
type DirectModelList = {
  source: "odeu-profile" | "live-probe";
  models: DirectModelCapability[];
  stale: boolean;
  generatedAt: string;
};
```

Do not infer full model availability from docs alone. Use docs/specimens for
hypotheses and live probes/profile deltas for acceptance.

The renderer must show the model-list source before exposing a model selector:
`odeu-profile`, `static-baseline`, or `live-probe`.

## Import And Legacy Mode

Legacy Codex app-server sessions remain import sources.

Supported modes:

| Mode | Meaning |
| --- | --- |
| `direct` | New native direct session backed by direct transport. |
| `legacy-app-server` | Explicit compatibility mode using `codex app-server`. |
| `imported-readonly` | Imported legacy session, not yet runnable. |
| `imported-checkpointed` | Imported session compacted into a direct checkpoint and eligible for continuation. |

Import quarantine state:

```ts
type ImportedSessionState =
  | "imported-unvalidated"
  | "imported-readonly"
  | "imported-validation-failed"
  | "checkpoint-candidate"
  | "checkpointed-runnable";
```

Import rules:

- Imported app-server JSONL is source evidence, not native direct truth.
- Preserve source `CODEX_HOME`, session file path, thread id, and timestamps.
- Do not continue an imported session directly until a direct checkpoint is
  generated.
- Do not replay imported tool calls.
- No imported approval can imply future authority.

## Analytics Source Model

Direct sessions are shell-owned source truth. They must not be projected as if
they were legacy app-server rollout logs.

Analytics must distinguish at least two source classes:

```text
legacy-app-server rollout logs
direct shell sessions
```

Each source class needs its own ontology label and analyzer version.

## UX Requirements

The user must be able to tell which runtime is active.

Minimum visible states:

- `direct ready`
- `direct auth required`
- `direct degraded`
- `legacy app-server`
- `imported read-only`
- `direct turn failed`
- `direct tool approval required`

The app must not show `authenticated` as if it guarantees the Codex panel can
run. It must distinguish:

| State | Meaning |
| --- | --- |
| Direct auth authenticated | Tokens are present and not expired. |
| Direct runtime ready | Transport/profile/session engine can run turns. |
| Direct panel attached | Renderer is connected to the direct controller. |
| Direct turn runnable | Auth, model, transport, and project authority gates pass. |

This avoids repeating the current hybrid gap where auth was valid but the Codex
panel still had no usable runtime auth.

Rollback requirement:

```text
If direct runtime enters failed or degraded state repeatedly, the project can
switch back to legacy-app-server without deleting direct sessions, imported
evidence, or diagnostics.
```

## Security And Redaction

Security rules:

- Raw access tokens stay in main process.
- Raw refresh tokens stay in the direct auth store.
- Credential storage preference is OS credential store/keychain/Windows
  Credential Manager or DPAPI-backed storage, then encrypted local file with an
  OS-bound key, then private plaintext file only as a clearly labeled dev
  fallback.
- Renderer receives no raw tokens, auth headers, backend request body, or raw
  stream frames.
- Raw backend fixtures are opt-in diagnostics and must run through redaction
  before commit.
- Logs may include redacted account status and error class, never token text.
- Manual OAuth fallback must validate state when state is present.
- Tool-call arguments are untrusted model output until validated by the tool
  authority router.

## Cutover Plan

### Phase 0: Runtime Boundary And Status Truth

- Add a config/runtime enum for `legacy-app-server`, `direct-experimental`,
  and `direct`.
- Keep current default as `legacy-app-server` until direct model-call probes
  pass.
- Expose runtime status distinctly from direct auth status.
- Add direct capability profile and direct auth status facade.
- Add direct model list from accepted baseline.
- Add direct session store skeleton.
- No live model request yet.

Acceptance:

```text
The app can show direct auth status, direct runtime status, and model-list
source without requiring codex app-server, while clearly saying turns are not
runnable yet.
```

### Phase 1: Fixture-Only ODEU Extraction

- Keep redaction helpers deterministic.
- Load raw fixtures.
- Normalize raw-to-local event shapes.
- Build profile deltas.
- Generate baseline report.
- Do not hit the live backend.

### Phase 2: Direct Text Turn Probe

- Implement request builder for one accepted model.
- Implement SSE transport and normalized text events.
- Persist a direct session and one direct turn.
- Render text deltas in the existing Codex panel.
- No tools yet.
- No continuation, import, or automatic retry after the stream starts.
- Capture redacted diagnostics on failure.

### Phase 3: Abort, Refresh, Retry, Resume

- Add `threadRead`, `threadResume`, and session index.
- Add abort handling.
- Add auth refresh before a stream starts.
- Add transient retry before a stream starts.
- Add terminal turn states.
- Add redacted fixture capture for failed/malformed streams.

### Phase 4: Tool Call Detection

- Normalize tool-call events.
- Pause continuation and render a read-only tool-call card.
- Do not execute tools yet.
- Add profile deltas for observed tool-call shapes.

### Phase 5: Minimal Read-Only Tool Authority

- Map a minimal read-only workspace tool.
- Route approval through existing middle-plane/Codex request cards.
- Execute through workspace backend.
- Send tool result continuation.
- Persist tool evidence and continuation state.

### Phase 6: Legacy Import

- Convert app-server JSONL sessions into direct read-only candidates.
- Generate direct checkpoints for selected imports.
- Allow continuation only from checkpointed imports.

### Phase 7: Direct Experimental Default For Selected Projects

- Allow `direct-experimental` as the default only for explicitly selected
  projects after text turn, abort, refresh, resume, tool detection, one
  read-only continuation, diagnostic redaction, and restart recovery pass.

### Phase 8: Full Default Replacement

- New direct projects no longer require app-server.
- App-server mode becomes explicit legacy compatibility/import mode.
- Remove startup requirement for a `codex` executable in direct mode.

## Validation Gates

Direct mode cannot become default until these gates pass:

- clean app install can authenticate without `codex` CLI credentials;
- app can start in direct mode with no `codex` executable on PATH;
- account status and runtime status are distinct and truthful;
- model selector source is visible before any model can be selected;
- one text turn streams and persists without app-server;
- one interrupted turn records an aborted terminal state;
- expired access token refreshes before a turn without renderer exposure;
- failed auth refresh after stream start does not retry the original request
  blindly and requires explicit resume;
- malformed stream fails closed and captures a redacted diagnostic;
- malformed unknown stream events are captured as redacted unstable profile
  evidence;
- one harmless tool call is detected, approved, executed, and continued;
- tool denial/cancel produces a lawful continuation or terminal state;
- session resumes after app restart without `CODEX_HOME`;
- completed, failed, aborted, and unresolved-tool turns survive app restart;
- app-server JSONL import remains read-only until checkpointed;
- switching a project from `direct-experimental` back to `legacy-app-server`
  does not delete direct sessions, imports, or diagnostics;
- no direct runtime code path assumes a WSL workspace can be accessed through a
  Windows mirror; workspace reads/writes route through the workspace backend;
- no right-pane ChatGPT thread binding is modified by direct left-lane session
  state unless the user explicitly stages a handoff;
- no raw token, auth header, backend request body, or raw backend stream frame
  appears in renderer state, logs, committed fixtures, or IPC payloads.

## Open Questions

- Which model id is the first accepted direct-mode default for this account?
- Which exact request fields are required for stable prompt-cache/session
  continuity?
- Which backend error fields reliably distinguish quota, auth expiry, rate
  limit, malformed tool result, and transient server failure?
- Should direct sessions live under app userData only, or be project-scoped with
  a global index?
- Should the renderer keep app-server method names as a compatibility facade or
  migrate immediately to direct method names?
- What is the minimum direct checkpoint shape needed to continue imported
  app-server sessions safely?

## Implementation Notes

Do not delete app-server code while building the first direct runtime. Keep both
lanes side by side until direct mode passes validation.

Preferred first code slice:

```text
runtime selector
direct status truth model
direct account/model facade
direct capability profile
direct session store skeleton
renderer status states
```

The first slice should not make a live model request. Live direct model calls
start only after the account/model facade and profile gates make runtime status
truthful.
