# Direct Codex App-Server Replacement Spec

Status: draft architecture spec for removing the runtime dependency on
`codex app-server` from the direct ChatGPT/Codex branch.

Related specs:

- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [CODEX_INTERNAL_KNOBS_ODEU_MAP.md](./CODEX_INTERNAL_KNOBS_ODEU_MAP.md)

## Purpose

Define the path from the current hybrid implementation to a fully direct
left-plane Codex surface.

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

Non-goal:

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

## Product Boundary

This replacement is not a generic model-provider layer and not an OpenAI
Platform API integration.

Initial target:

```text
ChatGPT subscription-authenticated Codex backend through the observed
chatgpt.com/backend-api/codex/responses contract.
```

The direct adapter is volatile and isolated. Everything above it must consume a
stable local contract owned by this repo.

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

## Direct Session Model

The direct runtime owns native session ids. New direct sessions must not use
Codex app-server session files as authority.

Recommended local store:

```text
<app userData>/direct-sessions/
  index.json
  sessions/
    <session-id>.json
  turns/
    <session-id>/
      <turn-id>.json
  raw-fixtures/
    optional-redacted-diagnostics-only
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

## Import And Legacy Mode

Legacy Codex app-server sessions remain import sources.

Supported modes:

| Mode | Meaning |
| --- | --- |
| `direct` | New native direct session backed by direct transport. |
| `legacy-app-server` | Explicit compatibility mode using `codex app-server`. |
| `imported-readonly` | Imported legacy session, not yet runnable. |
| `imported-checkpointed` | Imported session compacted into a direct checkpoint and eligible for continuation. |

Import rules:

- Imported app-server JSONL is source evidence, not native direct truth.
- Preserve source `CODEX_HOME`, session file path, thread id, and timestamps.
- Do not continue an imported session directly until a direct checkpoint is
  generated.
- Do not replay imported tool calls.

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

## Security And Redaction

Security rules:

- Raw access tokens stay in main process.
- Raw refresh tokens stay in the direct auth store.
- Renderer receives no raw tokens, auth headers, backend request body, or raw
  stream frames.
- Raw backend fixtures are opt-in diagnostics and must run through redaction
  before commit.
- Logs may include redacted account status and error class, never token text.
- Manual OAuth fallback must validate state when state is present.
- Tool-call arguments are untrusted model output until validated by the tool
  authority router.

## Cutover Plan

### Phase 0: Name The Runtime Boundary

- Add this spec.
- Add a config/runtime enum for `legacy-app-server` versus `direct`.
- Keep current default as `legacy-app-server` until direct model-call probes
  pass.
- Expose runtime status distinctly from direct auth status.

### Phase 1: Direct Account/Model Facade

- Implement direct `accountRead` from direct auth status.
- Implement model list from the accepted ODEU profile baseline.
- Keep app-server unavailable in direct mode.
- Renderer can connect to a direct runtime and show correct non-runnable states.

### Phase 2: Direct Text Turn Probe

- Implement request builder for one accepted model.
- Implement SSE transport and normalized text events.
- Persist a direct session and one direct turn.
- Render text deltas in the existing Codex panel.
- No tools yet.

### Phase 3: Tool-Free Session Resume

- Add `threadRead`, `threadResume`, and session index.
- Add abort handling.
- Add auth refresh and retry behavior.
- Add redacted fixture capture for failed/malformed streams.

### Phase 4: Tool Call Detection

- Normalize tool-call events.
- Pause continuation and render a read-only tool-call card.
- Do not execute tools yet.
- Add profile deltas for observed tool-call shapes.

### Phase 5: Tool Authority Loop

- Map a minimal read-only workspace tool.
- Route approval through existing middle-plane/Codex request cards.
- Execute through workspace backend.
- Send tool result continuation.
- Persist tool evidence and continuation state.

### Phase 6: Direct Default

- New projects default to direct runtime after text + tool + continuation gates
  pass.
- App-server mode becomes explicit legacy compatibility.
- Remove startup requirement for a `codex` executable in direct mode.

### Phase 7: Legacy Import

- Convert app-server JSONL sessions into direct read-only candidates.
- Generate direct checkpoints for selected imports.
- Allow continuation only from checkpointed imports.

## Validation Gates

Direct mode cannot become default until these gates pass:

- clean app install can authenticate without `codex` CLI credentials;
- app can start in direct mode with no `codex` executable on PATH;
- account status and runtime status are distinct and truthful;
- one text turn streams and persists without app-server;
- one interrupted turn records an aborted terminal state;
- expired access token refreshes before a turn without renderer exposure;
- malformed stream fails closed and captures a redacted diagnostic;
- one harmless tool call is detected, approved, executed, and continued;
- tool denial/cancel produces a lawful continuation or terminal state;
- session resumes after app restart without `CODEX_HOME`;
- app-server JSONL import remains read-only until checkpointed;
- no raw token appears in renderer state, logs, committed fixtures, or IPC
  payloads.

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
direct account/model facade
direct capability profile
direct session store skeleton
renderer status states
```

The first slice should not make a live model request. Live direct model calls
start only after the account/model facade and profile gates make runtime status
truthful.
