# Direct Read-Only Tool Continuation Spec

Status: implementation specification for the next direct-runtime bundle on the
long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md](./DIRECT_CODEX_APP_SERVER_REPLACEMENT_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)

## Purpose

Add the first direct live tool loop for the left Codex lane:

```text
direct live text turn
  -> provider emits one read-only tool call
  -> shell records a local obligation
  -> user approves the read-only workspace read
  -> workspace backend executes the read
  -> shell records the tool result
  -> shell sends one lawful continuation request
  -> provider streams final assistant text
  -> direct session persists the whole turn
```

This bundle proves that the direct runtime can mediate tool authority without
`codex app-server`, while preserving the core invariant:

```text
provider tool call != local authority
```

The provider may request a tool. The shell decides whether that request is
supported, whether the user approved it, how the workspace is accessed, what
evidence is persisted, and whether a continuation request is lawful.

## Decision

Wire the existing read-only authority helpers into `direct-experimental/live-text`
for one supported tool:

```text
read_file({ path: "<relative workspace path>" })
```

The implementation path should be:

```text
Codex surface renderer
  -> DirectLiveTextSurfaceSession
    -> DirectLiveTextController
      -> DirectSessionStore
      -> read-only authority helper
      -> WorkspaceBackendManager request
      -> Codex Responses transport continuation helper
        -> ChatGPT subscription Codex backend
```

This is not a general tool runtime. It is a constrained proof that local
authority, local evidence, and provider continuation can be owned by the shell.

## Boundary

This bundle changes only the left Codex implementation lane.

It does not:

- make `direct` mode available;
- make direct runtime the default;
- enable write tools, shell commands, network tools, MCP tools, browser tools,
  patch tools, or arbitrary custom tools;
- auto-approve any tool call;
- execute unsupported tool calls;
- execute more than one tool obligation per continuation;
- retry the original model request after a tool call is observed;
- replay imported tool calls;
- modify right-pane ChatGPT thread bindings;
- expose raw auth tokens, auth headers, raw backend request bodies, raw stream
  frames, raw workspace absolute paths, or unredacted account ids to the
  renderer.

`legacy-app-server` remains the default and reliable runtime. This bundle is
only for explicit `direct-experimental/live-text` projects that already pass
the live text evidence gates.

## Entry Gate

Before the live continuation path is exposed in normal app UX, the project must
already satisfy the previous bundle gates:

```text
runtimeMode = direct-experimental
directTransport = live-text
direct auth status = authenticated
live text model evidence = accepted or runtime_probed
live text request shape evidence = accepted or runtime_probed
direct live text status = ready
workspace backend status = ready for the selected project
```

Operationally, this means a manual live text probe should have produced usable
`runtime_probed` evidence for the current app profile, account/workspace scope,
endpoint class/hash, model, request shape, and normalizer/request-builder
versions.

If the live text evidence is missing, expired, mismatched, unstable, or only
candidate, tool continuation controls remain unavailable.

Live text evidence gates only the base runtime. It does not unlock tools by
itself. Read-only tool continuation additionally requires accepted or
`runtime_probed` evidence for:

- the tool-call source;
- the tool-call shape;
- the local read-only result shape;
- the continuation request shape;
- the continuation stream completion shape.

## Tool-Call Source

This bundle uses provider-native implicit tool calls:

```text
toolCallSource = "provider-native-implicit"
```

The initial direct request remains the already-proven live text request shape
with tools omitted. If the provider emits a supported `read_file` call under
that scope, the event is evidence for the provider-native implicit tool-call
shape. The implementation must not declare a new tool schema in the initial
request until a separate request shape exists:

```text
direct-readonly-tool-request-shape@1
```

If a future bundle chooses declared tools instead, text-only live evidence is
insufficient. That future path needs separate evidence for the declared
`read_file` tool request shape.

## Current Substrate

Already available on the direct branch:

- direct auth, refresh, persistence, logout, and redacted auth status;
- direct live text surface and controller;
- direct session store with turn states, normalized event logs, diagnostics,
  local tool obligation records, and restart recovery;
- direct live probe evidence overlay;
- direct Responses transport helpers for text-only requests and persisted
  probes;
- normalizer support for provider tool-call events:
  `tool_call_started`, `tool_call_delta`, and `tool_call_completed`;
- read-only authority helpers in
  `src/main/direct/tools/read-only-authority.js`;
- continuation request construction for provider tool output items;
- workspace backend read APIs for project-scoped file access;
- smoke coverage for tool detection without execution.

Missing:

```text
tool_waiting turn
  -> user-visible approval
  -> read-only workspace execution
  -> recorded tool result
  -> live continuation send
  -> final assistant transcript and terminal state
```

## ODEU Mapping

The upstream ODEU profile distinguishes provider primitives from harness
authority. This bundle must preserve that split.

| ODEU Object | Provider Evidence | Harness-Owned Projection |
| --- | --- | --- |
| `ToolCall` | Provider emits function/custom tool call item and argument deltas. | Stable local obligation id, status, parsed arguments, support classification. |
| `ToolAuthority` | Not provider authority. | User approval, decline, cancel, and local execution eligibility. |
| `Workspace` | Not provider authority. | Project-bound workspace backend route, no Windows mirror assumptions for WSL. |
| `ToolOutput` | Provider accepts a tool-result continuation shape. | Recorded read-only result, continuation id, function-call output payload. |
| `Turn` | Provider stream before and after tool output. | One local direct turn with `tool_waiting`, `authority_waiting`, `continuation_ready`, `streaming`, and terminal state. |
| `Diagnostic` | Raw backend events and transport status. | Redacted event types, request shapes, result summary, and failure taxonomy. |

Capability rule:

```text
No tool execution or continuation path becomes normal runtime behavior unless
the observed tool-call shape, local tool-result shape, and continuation request
shape have accepted or runtime_probed evidence for this bundle.
```

For this first bundle, the accepted local capability is only:

```text
provider-native implicit read_file
  -> relative path
  -> workspace backend readFile
  -> recorded bounded result
  -> accepted provider output item type
  -> continuation with accepted context handle
```

## Runtime Status

Extend direct runtime status with a separate direct tool-loop truth section.

Recommended projection:

```ts
type DirectReadOnlyToolRuntimeStatus = {
  available: boolean;
  status:
    | "unavailable"
    | "live_text_required"
    | "workspace_required"
    | "ready"
    | "waiting_for_approval"
    | "authority_waiting"
    | "continuation_ready"
    | "continuing"
    | "failed";
  executionEnabled: boolean;
  continuationEnabled: boolean;
  supportedTools: ["read_file"];
  autoApproval: false;
  appServerRequired: false;
  reason?: string;
};
```

Do not reuse `turnRunnable` to mean tool-loop readiness. Keep these separate:

```text
direct live text runnable
tool call detected
tool execution locally allowed
tool result recorded
continuation request lawful
continuation stream in progress
```

## Supported Tool Shape

Supported provider tool names:

```text
read_file
readFile
```

Supported namespace for v0:

```text
absent only
```

If the provider includes a namespace, persist it as evidence and classify the
obligation unsupported unless that namespace is later accepted. Unknown
namespaces must not be approved or continued.

Accepted arguments:

```ts
type ReadFileToolArguments = {
  path?: string;
  relPath?: string;
  relativePath?: string;
};
```

Rules:

- exactly one path value must normalize to a relative workspace path;
- absolute paths are rejected;
- drive-letter paths are rejected;
- paths containing `..` are rejected;
- empty paths are rejected;
- WSL paths must route through the workspace backend for the project, not
  through a Windows mirror;
- renderer-facing records may show the relative path, size, truncated flag, and
  summary, but never the raw absolute workspace path;
- approval controls remain disabled until `tool_call_completed` has produced a
  complete, parseable argument object.

Unsupported tool names or malformed arguments remain persisted evidence, but
they do not enable approval or continuation.

Incomplete argument deltas use:

```text
status = "collecting_arguments"
approvalAvailable = false
```

Malformed final arguments use:

```text
status = "unsupported"
failureKind = "invalid_tool_arguments"
```

## Provider Call And Output Mapping

Continuation output item type is derived from the original provider call type.

```ts
type SupportedReadOnlyContinuationKind =
  | {
      providerCallType: "function_call";
      outputType: "function_call_output";
      requiredField: "call_id";
    }
  | {
      providerCallType: "custom_tool_call";
      outputType: "custom_tool_call_output";
      requiredField: "call_id";
    };
```

Rules:

- `call_id` is required for all supported continuation kinds;
- if the original provider call type is unknown, persist evidence but do not
  approve or continue;
- if `call_id` is missing, mark the obligation uncontinuable with
  `failureKind = "continuation_missing_call_id"`;
- a `function_call` maps only to `function_call_output`;
- a `custom_tool_call` maps only to `custom_tool_call_output`.

Do not hard-code every provider call as `function_call_output`.

## Turn State Machine

The existing direct turn state enum remains the source of truth:

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

State transitions for this bundle:

```text
streaming
  -> tool_waiting
    -> authority_waiting
      -> continuation_ready
        -> streaming
          -> completed
```

Because `streaming` can mean either the initial model stream or the
continuation stream, add an explicit stream phase:

```ts
type DirectTurnStreamPhase =
  | "initial"
  | "continuation";
```

Persist it on the turn:

```ts
{
  state: "streaming";
  streamPhase: "initial" | "continuation";
}
```

Restart/readback must be able to distinguish which stream was interrupted.

Decline/cancel paths:

```text
tool_waiting -> failed   (declined)
tool_waiting -> aborted  (canceled)
authority_waiting -> failed  (execution failure or declined before execution)
authority_waiting -> aborted (canceled)
continuation_ready -> failed (continuation request construction/safety failure)
```

The original provider request is never retried after a tool call has been
observed. Only a continuation request built from recorded local tool evidence
may proceed.

Restart rules:

```text
continuation_ready before any continuation byte/event
  -> reconstruct as continuation_ready_manual_resume_required
  -> do not automatically send the continuation

continuation stream interrupted after any continuation byte/event
  -> mark failed with restart_interrupted_continuation unless already terminal
```

Automatic continuation resume after app restart is not part of this bundle.

## Obligation Model

Each provider tool call becomes a local obligation:

```ts
type DirectToolObligation = {
  obligationId: string;
  sessionId: string;
  turnId: string;
  sourceItemId: string;
  callId: string;
  name: string;
  argumentsText: string;
  status:
    | "waiting"
    | "collecting_arguments"
    | "unsupported"
    | "approved"
    | "declined"
    | "canceled"
    | "result_recorded"
    | "continuation_built"
    | "continuation_sent";
  authorityState: string;
  executionAllowed: boolean;
  continuationAllowed: boolean;
  approvalAvailable: boolean;
  providerCallType: "function_call" | "custom_tool_call" | "unknown";
  namespace: string;
  sideEffectExecuted: false;
  result?: DirectReadOnlyToolResult;
  continuationRequest?: DirectReadOnlyToolContinuationRequest;
};
```

Rules:

- obligation id must be stable and local;
- duplicate tool-call events for the same call update the same obligation;
- every result pairs to exactly one obligation;
- every continuation pairs to exactly one recorded result;
- duplicate approval/execution/continuation requests return the existing stored
  state instead of doing the work twice;
- declined and canceled obligations are terminal local evidence;
- no imported obligation may be executed by this bundle.

Approval can become available only when:

```text
status = waiting
tool_call_completed observed
arguments parse successfully
tool name is supported
namespace is accepted
provider call type is accepted
call_id exists
continuity handle exists or stateless continuation is accepted
```

## Decision Locking

`clientToolDecisionId` is necessary but not sufficient. The controller also
needs an obligation-level lock:

```text
Only one decision pipeline may run for a given obligation at a time.
```

Decision rules:

```text
same clientToolDecisionId + same obligation + same decision
  -> return existing snapshot

same clientToolDecisionId + different obligation
  -> reject as idempotency-key conflict

different clientToolDecisionId + obligation already result_recorded/continuation_sent
  -> return existing terminal or in-progress snapshot
  -> do not reread or resend

approve after decline/cancel terminal
  -> reject as terminal_decision_exists

decline/cancel after result_recorded
  -> reject or mark too_late
  -> do not delete result evidence
```

## Surface RPC Contract

Add direct-live surface methods for explicit user authority:

```text
tool/read-only/approve
tool/read-only/decline
tool/read-only/cancel
```

Recommended request payload:

```ts
type DirectReadOnlyToolDecisionParams = {
  sessionId: string;
  turnId: string;
  obligationId: string;
  clientToolDecisionId: string;
};
```

`clientToolDecisionId` is an idempotency key. Duplicate calls with the same key
return the existing decision/result/continuation snapshot and must not re-read
the workspace or resend a continuation.

`approve` performs the bundle pipeline:

```text
approve obligation
  -> execute workspace read
  -> record result
  -> build continuation
  -> send continuation
  -> stream assistant text
```

`decline` records a terminal declined decision and marks the turn failed with a
tool-declined error. `cancel` records a terminal canceled decision and marks the
turn aborted.

Unsupported surface methods must fail visibly and must not be forwarded to
app-server.

## Renderer UX

When a direct live turn enters `tool_waiting`, the Codex panel should render a
read-only tool card with:

- tool name;
- relative path summary;
- status;
- Approve, Decline, and Cancel controls when approval is available;
- disabled controls after terminal local decision;
- final read result summary when recorded;
- continuation/final answer status when sent.

The card must not expose:

- raw absolute workspace path;
- raw backend stream frames;
- raw backend request body;
- raw auth headers;
- access or refresh tokens;
- unbounded file contents in the approval card.

The composer remains disabled for that direct session while a turn is in
`tool_waiting`, `authority_waiting`, `continuation_ready`, or continuation
`streaming`.

## Workspace Execution

Execution is local and project-bound:

```text
WorkspaceBackendManager.requestForProject(project, "readFile", { relPath })
```

Rules:

- only `readFile` is allowed;
- the rel path is validated before the workspace request;
- reject NUL bytes and control characters;
- normalize slash/backslash forms before validation;
- reject Unicode or path separator ambiguity where normalization changes
  meaning;
- reject URL-encoded traversal if decoding is performed anywhere;
- workspace backend decides how local vs WSL access works;
- workspace backend must resolve the requested relative path to a realpath under
  the canonical workspace root before reading;
- symlink escapes outside the workspace root are rejected;
- paths resolving outside the project workspace after realpath are rejected;
- direct runtime code must not access WSL files through Windows mirror paths;
- binary/truncated results are allowed as read evidence but must be summarized
  safely;
- result text sent to the provider should use the bounded `textPreview`;
- no shell command or direct filesystem read is introduced in the controller.

Read-only file access can exfiltrate data to the provider. Treat it as
authority-bearing, not harmless.

Default sensitive path denylist for v0:

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
**/secrets/**
**/.ssh/**
.git/config
```

Sensitive paths are rejected by default in this bundle. A future bundle may add
an extra explicit confirmation flow.

First-bundle caps:

```ts
MAX_READ_FILE_BYTES = 384 * 1024;
MAX_PROVIDER_OUTPUT_CHARS = 64 * 1024;
MAX_APPROVAL_PREVIEW_CHARS = 4 * 1024;
```

The provider output must be a bounded envelope, not raw unlabelled content:

```json
{
  "path": "src/example.ts",
  "textPreview": "...",
  "truncated": true,
  "bytesRead": 393216,
  "note": "File content was truncated by the local shell before provider continuation."
}
```

Do not send a truncated file as if it were complete.

## Continuation Request

The continuation request is built only after a recorded result exists.

Provider request shape:

```ts
{
  model: string;
  stream: true;
  store: false;
  instructions: string;
  input: [
    {
      type: "function_call_output" | "custom_tool_call_output";
      call_id: string;
      output: string;
    }
  ];
  previous_response_id?: string;
}
```

Rules:

- `call_id` must come from the original provider tool call;
- output must come from recorded local result evidence;
- a continuation request is lawful only if `previous_response_id` was captured
  from the original stream and accepted for this continuation shape, an
  equivalent provider continuity handle was captured and accepted, or a
  stateless continuation shape was separately runtime-probed and accepted;
- no tools are added to the continuation request in this bundle;
- no reasoning, structured output, service tier, prompt cache, or include fields
  are added unless accepted ODEU evidence later authorizes them;
- raw continuation request body is never sent to renderer;
- redacted diagnostics may include request-shape summary and output size.

If no accepted continuity handle exists, record:

```text
failureKind = "continuation_missing_context_handle"
```

and do not send the continuation.

If a continuation stream emits any `tool_call_*` event:

```text
persist nested_tool_call_observed evidence
do not execute it
do not send another continuation
mark the turn failed with failureKind="nested_tool_call_unsupported"
```

## Retry And Idempotency

Hard invariants:

```text
Once a provider tool call is observed, the original request is not retried.
Once a workspace read result is recorded, the workspace read is not repeated
for duplicate approval or continuation requests.
Once any continuation response body byte or normalized continuation event is
observed, the continuation request is not retried automatically.
```

Allowed retry:

- a continuation request may use the existing pre-stream retry policy only
  before any response body byte is observed;
- retry count remains bounded to the direct transport policy;
- retry must reuse the same recorded result and continuation id.

If the continuation fails after stream start, mark the turn failed with
continuation failure details and preserve all normalized events received so far.

## Diagnostics And Evidence

Persist redacted diagnostics for:

- tool-call normalized event types;
- unsupported tool name or malformed arguments;
- approval/decline/cancel decision summary;
- workspace read result summary;
- continuation request shape;
- continuation response status/content type;
- continuation normalized event types;
- unknown raw event types;
- final turn state.

No diagnostic may include raw tokens, raw auth headers, raw backend frames, raw
backend request bodies, raw account ids, private absolute workspace paths, or
unbounded file contents.

ODEU/profile evidence should distinguish:

```text
tool_call_shape_observed
read_file_authority_accepted
tool_result_shape_recorded
tool_result_continuation_runtime_probed
continuation_stream_completed
```

Continuation evidence scope is:

```text
profileId
profileHash
authMode
accountEvidenceKey
endpointClass
endpointHash
model
initialToolRequestShapeHash
toolCallSource
toolCallShapeHash
toolResultShapeHash
continuationRequestShapeHash
normalizerVersion
requestBuilderVersion
transportAdapterVersion
workspaceKind
resultClass
```

`resultClass` examples:

```text
text_preview_untruncated
text_preview_truncated
binary_summary
read_failed
```

A successful continuation with a small text file does not prove binary-file
continuation, huge-file continuation, or arbitrary tool output continuation.

A failed or declined tool request remains useful evidence, but it must not
promote continuation capability.

## Failure Taxonomy

Recommended failure kinds:

```ts
type DirectReadOnlyToolFailureKind =
  | "unsupported_tool"
  | "invalid_tool_arguments"
  | "multiple_tool_calls"
  | "approval_declined"
  | "approval_canceled"
  | "workspace_unavailable"
  | "workspace_read_failed"
  | "tool_result_missing"
  | "continuation_missing_call_id"
  | "continuation_missing_context_handle"
  | "continuation_shape_invalid"
  | "continuation_transport_pre_stream"
  | "continuation_transport_after_stream"
  | "continuation_auth"
  | "continuation_quota"
  | "continuation_unknown_event"
  | "nested_tool_call_unsupported"
  | "redaction_failed"
  | "renderer_exposure"
  | "other";
```

Auth/quota/transport failures do not make the tool shape globally rejected.
Malformed continuation request shape can reject the local request builder for
that exact shape until corrected.

## Import Boundary

Imported app-server sessions remain quarantined for this bundle.

Rules:

- no imported tool call can be approved;
- no imported approval can imply future authority;
- no imported tool result can be sent as a direct continuation;
- imported sessions may display read-only evidence only.

Direct-native checkpointing for imported tool obligations belongs to a later
bundle.

## Implementation Order

### Phase 0: Operational Live Text Gate

- Run manual live text probe in the active app profile.
- Confirm `direct-experimental/live-text` is runnable from the app.
- Confirm no app-server process is spawned for the direct live project.

### Phase 1: Controller Authority RPCs

- Add approve/decline/cancel methods to `DirectLiveTextController`.
- Add idempotency with `clientToolDecisionId`.
- Add per-obligation decision locks.
- Reject unsupported tools and malformed arguments clearly.
- Keep approval disabled until completed parseable arguments exist.
- Keep all app-server forwarding disabled for direct live methods.

### Phase 2: Workspace Read Execution

- Add path-safety and sensitive-path policy at the workspace backend boundary.
- Route approved `read_file` obligations through the workspace backend.
- Persist `DirectReadOnlyToolResult`.
- Reuse recorded result on duplicate calls.
- Add redacted diagnostics.

### Phase 3: Continuation Send

- Build and persist `DirectReadOnlyToolContinuationRequest`.
- Map provider call type to output item type.
- Require `call_id`.
- Require accepted `previous_response_id` or equivalent continuity handle.
- Send one live continuation request through the direct transport.
- Stream final assistant deltas with stable item ids.
- Fail closed on nested tool calls.
- Persist normalized events and terminal state.

### Phase 4: Renderer Tool Card

- Render `tool_waiting` cards with Approve/Decline/Cancel.
- Show recorded result summary and continuation state.
- Keep composer disabled until terminal state.

### Phase 5: Smoke And Evidence

- Add fake transport smoke for approve -> read -> continue -> completed.
- Add decline/cancel smoke.
- Add malformed/unsupported/multiple tool call smoke.
- Add missing `call_id`, unknown namespace, and missing continuity handle smoke.
- Add sensitive path and symlink escape smoke.
- Add duplicate approval race smoke.
- Add nested continuation tool-call smoke.
- Add restart/readback smoke for unresolved, declined, canceled, result
  recorded, continuation ready, and completed states.
- Add redaction assertions.

## Acceptance Criteria

- `direct-experimental/live-text` still requires accepted or `runtime_probed`
  live text evidence before tool controls appear.
- Tool-call source is explicit: provider-native implicit or a future declared
  `read_file` tool request shape.
- Text-only runtime evidence alone does not unlock read-only tool continuation.
- A provider `read_file` tool call creates exactly one stable local obligation.
- Approval controls remain disabled until `tool_call_completed` yields parseable
  arguments.
- Unsupported or malformed tool calls do not execute and do not continue.
- A second tool call in the same turn fails closed or remains unsupported in v0.
- Missing `call_id` makes the obligation uncontinuable.
- Original provider call type maps to the correct output type; unknown call
  types do not continue.
- `previous_response_id` or accepted equivalent continuity handle is required
  unless stateless continuation is separately probed.
- Namespace is absent or explicitly accepted.
- Approve requires explicit user action.
- Decline marks the turn failed and records terminal local decision.
- Cancel marks the turn aborted and records terminal local decision.
- Approval executes only `workspaceBackend.readFile` for the selected project.
- WSL workspaces are read through the workspace backend, not Windows mirror
  paths.
- Workspace backend realpath must remain under the canonical workspace root.
- Symlink escape attempts fail.
- Sensitive path attempts fail in v0.
- Provider output is bounded and marks truncation truthfully.
- Same `clientToolDecisionId` with a different obligation is rejected.
- Concurrent approve clicks cannot execute duplicate reads.
- Duplicate approval with the same `clientToolDecisionId` does not reread the
  workspace.
- Duplicate continuation does not resend a provider request after any
  continuation stream event has been observed.
- Original model request is never retried after the tool call is observed.
- Continuation uses only recorded tool evidence.
- Final assistant text after continuation renders and persists in the direct
  transcript.
- Restart/readback reconstructs tool obligation, result, continuation request,
  and final transcript.
- Restart at `continuation_ready` never auto-sends unless resumability is later
  implemented.
- Continuation stream has `streamPhase = "continuation"` or equivalent.
- Continuation-emitted tool calls fail closed and do not execute.
- Continuation evidence is scoped to tool-call shape, result shape,
  continuation shape, model, endpoint, account, workspace kind, and version
  tuple.
- Renderer never sees raw auth headers, access tokens, refresh tokens, raw
  backend request bodies, raw stream frames, raw absolute workspace paths, or
  unbounded file contents.
- `npm run direct:smoke` covers fake continuation success and failure paths.
- No live backend call is required in CI.

## Explicit Non-Default Rule

Passing this bundle does not make `direct` mode available and does not make
direct runtime the default.

It only proves:

```text
For an explicitly selected direct-experimental/live-text project with live text
evidence, one approved read-only file tool can be executed locally and continued
through the direct ChatGPT/Codex backend without codex app-server.
```

Full direct replacement still requires later gates:

- broader tool taxonomy;
- denial/cancel continuation behavior beyond terminal local decisions;
- resumable continuation after app restart;
- import checkpoint continuation;
- compaction/resume;
- quota/context/profile updates from live evidence;
- long-running drift diagnostics against Codex CLI/app-server as oracle.
