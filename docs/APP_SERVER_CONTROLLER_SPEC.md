# App-Server Controller Spec

Status: revised implementation design spec for turning `codex-review-shell` from a happy-path app-server client into a full local Codex controller.

## Purpose

Define the next integration layer between `codex-review-shell` and `codex app-server`.

The shell should keep using direct app-server JSON-RPC as its control boundary. It should not depend on TUI internals, removed TUI feature flags, or Codex remote-control transport internals.

The product boundary stays narrow:

- Codex remains the repo-coupled implementation partner.
- ChatGPT remains the deliberation and review partner.
- The middle plane coordinates project, thread, request, and handoff state.
- Deep ADEU-native harness controls belong in `odeu`, not in this standalone shell.

## Source Discipline

This controller must be schema-led.

Hard rule:

```text
Never hand-code final app-server request or response payload shapes without checking the generated schema for the active Codex version.
```

Required metadata:

```ts
type CodexProtocolVersion = {
  codexVersion: string;
  schemaGeneratedAt: string;
  schemaSource: "generated" | "bundled" | "unknown";
};
```

At connection startup, the bridge should log:

- Codex binary path
- Codex version
- app-server transport
- schema compatibility mode
- `experimentalApi` enabled or disabled
- generated schema source, if available

Implementation rule:

- Prefer `codex app-server generate-ts --out DIR` or `codex app-server generate-json-schema --out DIR` for the binary being launched.
- If generated schema is unavailable, fall back to a bundled schema only with an explicit compatibility warning.
- Unknown server-initiated request methods must never be silently dropped.

## Verified Upstream Facts

- `features.tui_app_server` is removed compatibility ballast. It is not a live switch for our UX.
- Codex TUI now always uses the app-server implementation.
- `codex --remote ws://host:port` is the TUI path for connecting to an existing remote app-server.
- `codex app-server` supports JSON-RPC over `stdio://`, `ws://IP:PORT`, and `off`.
- `stdio://` is the default app-server transport.
- WebSocket transport is documented upstream as experimental / unsupported.
- WebSocket auth is supported with `Authorization: Bearer <token>` during handshake.
- App-server schemas are version-specific.
- Server-initiated requests are JSON-RPC requests from app-server to the client, and the client must answer with either `result` or `error`.
- `serverRequest/resolved` is canonical cleanup for pending app-server requests.

Local fork schema check:

- `/home/rose/work/codex/fork/codex-rs/app-server-protocol/schema/typescript/ServerRequest.ts` currently includes the v2 request union.
- The local union includes `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/permissions/requestApproval`, `item/tool/call`, `account/chatgptAuthTokens/refresh`, plus legacy compatibility request names `applyPatchApproval` and `execCommandApproval`.
- The implementation must still regenerate or verify this table against the active binary before wiring response shapes.

## Current Shell State

The shell already uses the right architectural boundary:

- main process starts `codex app-server --listen ws://127.0.0.1:PORT`
- the Codex surface connects with a JSON-RPC WebSocket bridge
- the renderer initializes the app-server connection
- thread actions use `thread/start`, `thread/read`, `thread/resume`, and `turn/start`
- new threads opt into `persistExtendedHistory: true`
- main process owns a pending server-request registry keyed by connection/request identity
- Codex request cards and the middle-plane compact queue can answer supported approval/request flows

The remaining work is capability hardening and transport maturation.

- derive request shapes and supported methods from the active executable schema
- gate Codex UX affordances from a runtime capability profile
- keep unknown request methods visible and answered with explicit unsupported errors
- move local managed runtime toward a stdio transport after WebSocket parity is proven

## Product Doctrine

- Treat app-server JSON-RPC as the stable control plane.
- Keep raw rollout parsing only for analytics and history recovery tasks that the app-server API does not expose.
- Do not add config or UI for removed upstream feature flags.
- Avoid depending on the `remote_control` feature for v0; it is a ChatGPT-authenticated outbound transport with product-specific constraints.
- Prefer explicit user authority for approval and permission requests.
- Never auto-approve destructive actions by default.
- Keep the middle-plane request queue compact; do not turn it into a full policy editor or second Codex chat.

## Transport Abstraction

Introduce a transport-neutral session before request handling grows deeper.

Recommended interface:

```ts
interface CodexTransport {
  readonly kind: "websocket" | "stdio";
  readonly connectionId: string;

  connect(): Promise<void>;
  close(reason?: string): Promise<void>;

  sendRequest(method: string, params: unknown): Promise<unknown>;
  sendNotification(method: string, params: unknown): void;
  sendResponse(id: string | number, result: unknown): void;
  sendError(id: string | number, error: JsonRpcError): void;

  onMessage(callback: (message: JsonRpcMessage) => void): () => void;
  onClose(callback: (event: TransportCloseEvent) => void): () => void;
}
```

Sequencing:

- Add the abstraction first, while preserving current WebSocket behavior.
- Keep WebSocket as the default during request-handling implementation.
- Add stdio as opt-in after Phase 1 is stable.
- Switch local managed runtime default to stdio only after parity testing.

WebSocket-specific behavior:

- Retry client-originated requests that fail with JSON-RPC `-32001` overload using exponential backoff and jitter.
- Do not retry server-initiated request responses unless the transport confirms the response was not sent.

## Initialization And Capabilities

The app-server connection must be initialized before any other request.

Required behavior:

- Send `initialize`.
- Send `initialized`.
- Record server and client capabilities.
- Record whether `experimentalApi` is enabled.
- Only set `experimentalApi: true` when the shell can safely handle experimental request shapes exposed by that mode.
- Reject or delay local UI actions until initialization completes.

Experimental features that affect this spec:

- `additionalPermissions` on command approval.
- dynamic tools and `item/tool/call`.
- externally managed ChatGPT auth tokens.

## Request Registry

Main process owns the request lifecycle because it owns the transport.

JSON-RPC request ids are scoped to a connection, so pending requests must be keyed by:

```ts
type PendingRequestKey = `${connectionId}:${requestId}`;
```

Recommended object:

```ts
type PendingCodexServerRequest = {
  key: PendingRequestKey;
  connectionId: string;
  requestId: string | number;
  method: string;
  params: unknown;

  projectId?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;

  surfaceConnectionId?: string;

  riskCategory:
    | "command"
    | "file-change"
    | "network"
    | "permission"
    | "user-input"
    | "mcp"
    | "dynamic-tool"
    | "auth"
    | "legacy"
    | "unknown";

  status:
    | "pending"
    | "responding"
    | "resolved"
    | "declined"
    | "canceled"
    | "timed-out"
    | "orphaned"
    | "connection-closed";

  receivedAt: string;
  respondedAt?: string;
  resolvedAt?: string;
  timeoutAt?: string;

  responseSummary?: string;
  errorSummary?: string;
};
```

Registry requirements:

- Store requests by `connectionId + requestId`.
- Extract `threadId`, `turnId`, and `itemId` from params when present.
- Forward request summaries to Codex surface and middle plane.
- Keep pending registry in main process across renderer reloads.
- Replay pending request summaries to a renderer after it reconnects.
- If app-server connection closes, mark all connection-scoped pending requests `connection-closed` and make them unanswerable.
- When `serverRequest/resolved` arrives, mark the matching request resolved and clear both surfaces.
- If `serverRequest/resolved` arrives after a local response succeeds, do not send another response.
- If a local response is attempted after cleanup, show stale-request status instead of sending a second response.

## Request Method Policy

The supported request-method table must be generated or verified from the active app-server schema.

Schema-confirmed local methods at the time of writing:

| Method | V0 behavior |
| --- | --- |
| `item/commandExecution/requestApproval` | Full request card with command, network, and permission-aware rendering. |
| `item/fileChange/requestApproval` | Full request card with diff correlation; block approval when diff is unavailable. |
| `item/tool/requestUserInput` | Structured user-input card after schema verification. |
| `mcpServer/elicitation/request` | Structured MCP elicitation card after schema verification. |
| `item/permissions/requestApproval` | Standalone permission card if active schema confirms it. |
| `item/tool/call` | Explicit unsupported response in v0. |
| `account/chatgptAuthTokens/refresh` | Explicit auth-unavailable response unless a verified token source exists. |
| `applyPatchApproval` | Legacy compatibility handler if active schema includes it. |
| `execCommandApproval` | Legacy compatibility handler if active schema includes it. |

Unknown method policy:

- Store the request in the pending registry.
- Show it in diagnostics.
- Send a JSON-RPC unsupported error, normally `-32601`.
- Remove it from pending state after the error is sent.
- Never silently drop it.

## Timeout Policy

Use soft and hard timeout levels.

Soft timeout means the UI marks the request stale and needs attention. Hard timeout means the shell sends the safest available response if the request is still pending.

| Request type | Soft timeout | Hard timeout | Hard-timeout behavior |
| --- | ---: | ---: | --- |
| ChatGPT auth token refresh | 5s | 9s | Unsupported/error unless a verified token source exists. |
| user input | 5m | 30m | Cancel or decline if supported. |
| command approval | 5m | 30m | Decline or cancel; never approve. |
| file change approval | 5m | 30m | Decline or cancel; never approve. |
| permission request | 5m | 30m | Deny omitted permissions or decline. |
| dynamic tool call | immediate | immediate | Explicit unsupported response in v0. |
| unknown request | immediate | immediate | JSON-RPC unsupported error. |

Hard timeouts must be visible in diagnostics and in the relevant request card if the renderer is still attached.

## Item Store And Correlation

Approval requests often do not carry all decision context.

Maintain an item store keyed by:

```ts
type CodexItemKey = `${threadId}:${turnId}:${itemId}`;
```

Use the store to correlate:

- `item/started`
- `item/*/delta`
- `turn/diff/updated`
- `item/completed`
- server-initiated approval requests
- `serverRequest/resolved`

File-change request cards should resolve visible diff context from this order:

1. pending request params
2. matching `item/started` item
3. latest `turn/diff/updated`
4. fallback raw request JSON

If no diff can be resolved:

```text
Diff unavailable. Open details, decline, or cancel.
```

In that state, the card must not offer one-click approval.

If the matching item cannot be found, render the request card at the bottom of the active turn with a `context unresolved` warning.

## Codex Surface UI

The embedded Codex chat surface is the primary location for actionable request cards.

Required behavior:

- Render request cards inline when `threadId`, `turnId`, and `itemId` correlate with the active transcript.
- Render unresolved request cards at the bottom of the active turn.
- Submit user decisions through the existing `codex-surface:respond` IPC path.
- Show final status after response, resolution, timeout, or connection close.
- Render command text, file paths, diffs, URLs, MCP labels, and raw JSON as escaped text only.
- Never render request content with HTML injection.
- Never execute a command directly from the approval card.
- Never copy hidden command text.
- Only open external `http://` or `https://` URLs.

## Middle-Plane Queue

The middle plane should expose a compact queue for outstanding Codex requests so prompts cannot be missed if the user is focused elsewhere.

Good middle-plane behavior:

- pending Codex request badge
- compact queue
- risk category
- age
- thread/turn context
- focus Codex card
- safe decline/cancel where supported

Avoid in standalone shell:

- full policy editor
- persistent auto-approval rule system
- deep harness permission graph
- meta-orchestrator trace UI
- multi-agent approval choreography

The middle plane should not hide decision-critical information behind a single generic approve button.

## Response Semantics

The shell must conform to app-server response shapes from the active generated schema.

### Command Execution Approval

Use the server-provided `availableDecisions` when present.

Known decision choices include:

- `accept`
- `acceptForSession`
- `acceptWithExecpolicyAmendment`
- `applyNetworkPolicyAmendment`
- `decline`
- `cancel`

Card modes:

- shell command approval
- network access approval
- command plus additional sandbox permission approval

Render:

- `cwd`
- command, when meaningful
- reason
- network host, protocol, and port when `networkApprovalContext` is present
- available decisions
- proposed exec/network policy amendments behind advanced details in v0
- `additionalPermissions` when present

Do not label a `networkApprovalContext` request as `Approve command`; label it as network access approval.

Default v0 actions:

- `Approve once`
- `Approve for session` when allowed
- `Decline`
- `Cancel` when allowed

Persistent policy amendments should stay hidden until the shell has explicit UX for reviewing what is being persisted.

### File Change Approval

Render proposed changes before any approving action.

Known decision choices:

- `accept`
- `acceptForSession`
- `decline`
- `cancel`

Default v0 actions:

- `Approve once`
- `Approve for session` when allowed
- `Decline`
- `Cancel turn` when allowed

If structured changes are available, prefer structured rendering. If only raw patch text is available, render it in pre-wrapped, horizontally safe text.

If no diff is available, block approval and offer details, decline, or cancel.

### Tool User Input

`item/tool/requestUserInput` is the server-initiated request name in the local generated schema. The public API list also refers to a client method named `tool/requestUserInput`; do not conflate them.

Required behavior:

- Render the question and options when present.
- Support free-form `Other` input when schema allows it.
- Require explicit user answer.
- Allow cancel/decline when supported by the protocol.
- Preserve submitted text in the request card after response.

### MCP Elicitation

`mcpServer/elicitation/request` must be implemented only after the active generated schema confirms the payload and response shape.

Support URL and form modes.

URL mode:

- show message and URL
- offer open-external and continue/cancel choices
- only open `http://` and `https://`

Form mode:

- render fields from schema when feasible
- validate required fields before submitting
- show server name and elicitation id

MCP tool approval elicitations may include metadata such as `codex_approval_kind: "mcp_tool_call"` and persistence hints. Treat these like approval prompts, not generic forms.

### Permissions Approval

Permissions can arrive in two ways:

- `additionalPermissions` on command approval when experimental API is enabled
- standalone `item/permissions/requestApproval` if the active schema confirms it

Render requested permissions as a profile:

- `cwd`
- filesystem read/write roots or additional paths
- network access
- scope requested

Default behavior:

- grant only the subset the user explicitly accepts
- omit denied permissions from the result
- default scope to turn unless the user explicitly chooses session scope

### Dynamic Tool Calls

Dynamic tool calls ask the client to execute work. They need a separate trust model from normal approvals.

V0 behavior:

- decline unsupported dynamic tool calls explicitly
- log the method and params shape for later implementation
- avoid silently dropping the request

### ChatGPT Auth Token Refresh

The shell should not fabricate ChatGPT auth tokens.

V0 behavior:

- do not enter external `chatgptAuthTokens` mode unless the shell has a verified token source
- return explicit unsupported/auth-unavailable response unless such a source exists
- surface the request in diagnostics, not as a user approval prompt
- hard-timeout before the upstream refresh request window expires

## WebSocket Auth

Goal: support authenticated remote or port-forwarded app-server connections without leaking secrets to the renderer.

Client-side config:

```json
{
  "surfaceBinding": {
    "codex": {
      "remoteAuth": {
        "mode": "none | bearer-token-file | bearer-token-env",
        "tokenFilePath": "",
        "tokenEnvVar": "",
        "serverAuthScheme": "unknown | capability-token | signed-bearer-token"
      }
    }
  }
}
```

Security rules:

- never store raw bearer token text in `workspace-config.json`
- prefer token file or environment variable
- never expose bearer token text to renderer state, DOM, or logs
- allow bearer tokens only for `wss://` or loopback `ws://`
- define loopback as `127.0.0.0/8`, `::1`, and `localhost`
- show a clear error if auth is configured for an unsafe URL

Implementation:

- read token material in main process only
- pass sanitized auth connection metadata to the session
- construct WebSocket auth headers only in main process
- log auth scheme and source type, not token content

## Stdio Transport

Goal: make local Electron-managed Codex runtime less dependent on experimental WebSocket transport.

Add managed transport options:

- `websocket`
- `stdio`

Stdio implementation requirements:

- spawn `codex app-server --listen stdio://`
- communicate newline-delimited JSON-RPC over child stdin/stdout
- preserve the same `CodexTransport` request/notify/respond abstraction
- route app-server stderr to diagnostics
- handle child process exit by rejecting pending client requests and marking pending server requests `connection-closed`

Recommended sequencing:

1. Keep WebSocket as default while request handling is implemented.
2. Add stdio as an opt-in for local managed runtime.
3. Switch default only after parity testing across thread start, resume, turn start, approvals, request replay, and long-running output.

## Non-Goals

- Re-implement the TUI.
- Depend on `features.tui_app_server`.
- Adopt upstream `remote_control` unchanged.
- Build a generic remote-control relay in v0.
- Add persistent auto-approval policy editing before request handling is correct.
- Store raw app-server transcripts in this app as authoritative state.
- Add ADEU harness-level policy graph controls to the standalone shell.

## Validation Plan

Schema and initialization:

- generate or load active app-server schema
- log Codex version and schema source
- complete `initialize` and `initialized` before any thread action
- verify `experimentalApi` is disabled unless needed and supported

Command approval:

- request appears inline in Codex surface
- request appears in middle-plane pending badge
- network request renders as network approval, not command approval
- approve once works
- approve for session appears only when allowed
- decline works
- cancel works when available
- `serverRequest/resolved` clears both surfaces

File change approval:

- card shows proposed file changes or blocks approval if diff is unavailable
- approve once works
- approve for session appears when allowed
- decline works
- cancel works
- card final state matches `item/completed`

Renderer reload:

- reload Codex surface while a request is pending
- request remains in main registry
- card is replayed after renderer reconnects
- if app-server connection closes, request becomes `connection-closed`

Unknown request:

- unknown method is surfaced in diagnostics
- JSON-RPC unsupported error is sent
- pending registry does not leak

Security:

- no bearer token appears in renderer state/logs
- non-loopback `ws://` with bearer auth is rejected unless `wss://`
- command/diff/request content is rendered as escaped text
- approval card cannot execute commands directly

Transport:

- WebSocket request handling remains unchanged after abstraction
- overload `-32001` is retried for client-originated requests with backoff and jitter
- stdio transport passes parity checks for `thread/start`, `thread/read`, `thread/resume`, `turn/start`, approval roundtrip, renderer reload, and child-process exit

## Recommended Implementation Order

1. Add `CodexTransport` abstraction and connection ids while preserving WebSocket behavior.
2. Add active schema discovery/generation metadata and compatibility logging.
3. Add main-process request registry keyed by `connectionId:requestId`.
4. Handle `serverRequest/resolved` cleanup and renderer replay.
5. Add safe unsupported handling for unknown methods, dynamic tool calls, and external ChatGPT token refresh.
6. Add minimal Codex request cards for command and file-change approvals.
7. Add item store correlation and diff-unavailable approval blocking.
8. Add middle-plane pending request badge and compact queue.
9. Add user-input and MCP forms after schema-confirming exact shapes.
10. Add permission rendering, first through `additionalPermissions`, then standalone permission cards if schema-confirmed.
11. Add optional WebSocket bearer auth.
12. Add stdio transport as opt-in.

This keeps the app aligned with the verified app-server control model while filling the current controller gap: the shell becomes a real Codex controller with request lifecycle, schema discipline, and safe user authority.
