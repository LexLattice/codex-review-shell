# Codex Usage Ledger Spec

Status: design spec for a generic Codex runtime usage ledger in
`codex-review-shell`.

This is not a ProgramBench-specific spec. ProgramBench/ADEU run accounting should
consume this ledger as downstream evidence.

Related specs:

- [CODEX_RUNTIME_HEADER_DRAWER_SPEC.md](./CODEX_RUNTIME_HEADER_DRAWER_SPEC.md)
- [CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md](./CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md)
- [THREAD_ANALYTICS_SPEC.md](./THREAD_ANALYTICS_SPEC.md)
- [SUB_AGENT_TRANSCRIPT_PROJECTION_SPEC.md](./SUB_AGENT_TRANSCRIPT_PROJECTION_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)

## Purpose

Create a reusable, provider-aware usage ledger for Codex sessions, threads, turns,
sub-agents, token usage, tool calls, rate-limit snapshots, and optional trace
evidence.

The ledger should answer:

```text
What runtime was used?
Which agent/thread/turn performed work?
Which model/reasoning/access settings were active?
How many tokens were reported by Codex/provider surfaces?
Which tool calls and commands ran?
Which rate-limit or quota snapshots were observed?
Which evidence is exact, derived, trace-imported, estimated, or unavailable?
```

The ledger should not decide ADEU stage semantics, ProgramBench score meaning, or
benchmark cost interpretation.

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
  derivative_profile: codex_usage_ledger
  profile_status: proposed_local
```

Grounding:

- Current shell app-server bridge exists in `src/main/codex-surface-session.js`.
- Runtime capability/profile derivation exists in `src/main/codex-app-server.js`
  and `src/main/runtime-provider-profile.js`.
- Runtime quota/context display exists in `src/renderer/codex-surface.js`.
- Derived thread analytics exist in `src/main/thread-analytics-store.js`,
  `src/backend/wsl-agent.js`, and [THREAD_ANALYTICS_SPEC.md](./THREAD_ANALYTICS_SPEC.md).
- Vanilla Codex `rust-v0.130.0` exposes token usage, turn timing,
  rate-limit snapshots, tool-call counts, and rollout trace rows in the upstream
  checkout at `/home/rose/work/codex/fork`.

## Product Boundary

Split the system into three layers:

```text
Codex runtime / provider
  Produces app-server notifications, thread events, token usage, rate snapshots,
  tool events, and optional rollout traces.

codex-review-shell
  Captures and persists a neutral `codex_usage_ledger@1`.
  Renders sanitized summaries and exposes export/import affordances.

ADEU / ProgramBench harness
  Interprets neutral ledger rows as stages, attempts, task costs, method
  comparisons, benchmark scores, or postmortems.
```

### Invariants

- The ledger captures runtime evidence; it does not mint benchmark meaning.
- Exact provider fields must be preserved exactly when available.
- Derived rows must declare source and confidence.
- Post-factum transcript reduction is lower confidence than live capture.
- Cost must be computed later from a dated pricing snapshot.
- Sub-agent usage must be attributed to child threads/agents, not folded only
  into parent totals.
- Raw prompt, assistant output, auth tokens, cookies, and full tool output are
  excluded by default.
- Renderer state receives sanitized summaries only.
- Missing events are recorded as unavailable, not inferred as zero.

## Non-Goals

- No ProgramBench stage classification in the Codex ledger.
- No billing-grade cost without a bound pricing snapshot.
- No prompt or tool-output archiving by default.
- No raw provider payload exposure to renderer.
- No attempt to reconstruct exact inference calls from chat text alone.
- No dependence on our future direct OpenAI harness path; this must work with
  vanilla Codex executable first.

## Upstream Capability Profile

Vanilla Codex `rust-v0.130.0` provides these relevant surfaces:

| Capability | Upstream surface | Ledger posture |
| --- | --- | --- |
| Token usage fields | `TokenUsage` with input, cached input, output, reasoning output, total | exact when event observed |
| Thread token/context usage | `thread/tokenUsage/updated` app-server notification | exact for exposed thread snapshot |
| Rate limits and credits | `account/rateLimits/read`, `account/rateLimits/updated` | exact for exposed provider snapshot |
| Turn start | `turn/started` notification; `TurnStartedEvent` contains turn id, start time, context window, collaboration mode | exact when observed |
| Turn completion | `turn/completed`; `TurnCompleteEvent` contains completion, duration, time to first token in protocol/core | exact for exposed fields |
| Tool call count | core turn state increments tool calls and emits metric internally | exact if surfaced by item lifecycle; otherwise derived |
| Tool lifecycle | `item/started`, `item/completed`, command/file/MCP/tool notifications | exact for app-server item lifecycle |
| Per-response usage | `ResponseEvent::Completed` records response id, upstream request id, token usage | trace/import or fork extension unless app-server exposes it |
| Rollout trace | `InferenceStarted`, `InferenceCompleted`, tool started/ended, turn started/ended | exact trace-imported if trace payloads are captured |

Important distinction:

```text
App-server events are the v0 live capture substrate.
Rollout trace rows are an optional higher-fidelity import substrate.
Chat transcript text is only a low-confidence fallback.
```

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `CodexUsageLedgerSchema` | support artifact | build | versioned neutral row contract |
| `UsageLedgerValidator` | support artifact | build | schema validation, seq/digest checks, fixture validation |
| `UsageLedgerCollector` | support artifact | build | subscribes to app-server bridge events and request lifecycle |
| `UsageLedgerStore` | support artifact | build | append-only JSONL writer, manifest, bounded queue, optional index |
| `UsageLedgerRedactor` | support artifact | build | metadata-only enforcement before JSONL append |
| `UsageEventNormalizer` | support artifact | build | maps app-server/trace/transcript evidence into rows |
| `TokenUsageProjector` | support artifact | build | preserves provider token fields and confidence |
| `RateLimitSnapshotProjector` | support artifact | align/build | normalizes quota windows and reset timestamps |
| `ToolCallUsageProjector` | support artifact | align/build | command/tool/MCP/file/subagent call lifecycle rows |
| `SubAgentUsageAttributor` | support artifact | align/build | parent/child agent/thread usage links |
| `LedgerInspectorSurface` | surface artifact | build later | sanitized session/run usage view |
| `AdeuLedgerImporterContract` | support artifact | design/build later | maps neutral ledger rows to ADEU stage ledgers |

## Feature Flag

Project/runtime config should support:

```toml
[usage_ledger]
enabled = true
mode = "metadata_only"
output_dir = ".codex/usage-ledgers"
strict = false
include_payload_refs = false
include_prompt_text = false
include_tool_output_text = false
include_request_payload_hashes = false
include_response_payload_hashes = false
payload_hash_mode = "none" # none | sha256 | hmac_sha256
raw_path_policy = "excluded" # excluded | private_diagnostic_only | included_explicit
```

Default posture:

```text
enabled: false until implemented and exposed
mode: metadata_only
prompt/output content: excluded
payload refs: excluded unless trace import is configured
payload hashes: disabled unless explicitly enabled
cost: not computed during capture
strict: false
raw local paths: excluded
```

Renderer-visible settings must be derived from the runtime provider profile and
project config. The renderer must not decide ledger write paths or privacy mode.

## Storage Posture

Primary v0 storage:

```text
<project root>/.codex/usage-ledgers/<ledger_id>.jsonl
```

Optional index:

```text
Electron userData/codex-usage-ledger.sqlite
```

Rules:

- JSONL is append-only.
- Each row is independently parseable.
- The first row must be a `ledger_header` row.
- Each row carries `schemaVersion`, `ledgerId`, `seq`, `rowId`, `rowKind`,
  `observedAt`, and `rowDigest`.
- Rows are monotonic by `seq` within a ledger.
- `previousRowDigest` forms a best-effort integrity chain.
- Ledger files are portable with the repo/task workspace.
- A sidecar manifest records file-level summary and is rebuildable from JSONL.
- The manifest is updated atomically after row append.
- The optional index is for fast UX listing and should be reconstructable from
  JSONL.
- The optional index never outranks JSONL.
- Writes must be durable enough for crash recovery but should not block the
  Codex turn stream.

## Ledger Identity

```ts
type LedgerHeaderRow = CodexUsageLedgerRowBase & {
  rowKind: "ledger_header";
  header: CodexUsageLedgerHeader;
};

type CodexUsageLedgerHeader = {
  schemaVersion: 1;
  ledgerKind: "codex_usage_ledger";
  ledgerId: string;
  createdAt: string;
  completedAt?: string;
  projectId?: string;
  workspaceRootEvidenceKey?: string;
  sourceHome?: string;
  codexReleaseTag?: string;
  codexReleaseCommit?: string;
  codexRuntimeRef?: string;
  providerKind: "codex_executable" | "direct_oai" | "unknown";
  providerProfileId?: string;
  appServerSchemaRef: CodexAppServerSchemaRef;
  capturePosture: UsageCapturePosture;
  privacyMode: "metadata_only" | "payload_refs" | "bounded_excerpts";
  rawPathPolicy: "excluded" | "private_diagnostic_only" | "included_explicit";
};
```

```ts
type CodexAppServerSchemaRef = {
  codexVersion?: string;
  schemaGeneratedAt?: string;
  schemaSource:
    | "codex-app-server-generate-json-schema"
    | "codex-app-server-generate-ts"
    | "manual-static"
    | "unknown";
  experimentalApiEnabled: boolean;
};
```

The ledger header must record which app-server schema/version produced the
captured rows. Implementation must validate fixture rows against the generated
schema for the active Codex version whenever possible.

```ts
type CodexUsageLedgerManifest = {
  ledgerId: string;
  schemaVersion: 1;
  fileSha256?: string;
  rowCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  completedAt?: string;
  interrupted: boolean;
  writerVersion: string;
  lastRowDigest?: string;
};
```

```ts
type UsageCapturePosture =
  | "exact_provider_reported"
  | "codex_app_server_event"
  | "codex_turn_delta"
  | "rollout_trace_imported"
  | "thread_analytics_reduced"
  | "transcript_estimate_only"
  | "unavailable";
```

## Common Row Envelope

```ts
type CodexUsageLedgerRowBase = {
  schemaVersion: 1;
  ledgerId: string;
  seq: number;
  rowId: string;
  rowKind: string;
  sourceEventKey?: string;
  dedupeKey?: string;
  previousRowDigest?: string;
  rowDigest: string;
  observedAt: string;
  projectId?: string;
  connectionId?: string;
  appServerProcessId?: string;
  appServerTransport?: "stdio" | "websocket" | "unix" | "off" | "unknown";
  connectionOpenedAt?: string;
  connectionClosedAt?: string;
  sourceHome?: string;
  workspaceRootEvidenceKey?: string;
  codexHomeEvidenceKey?: string;
  sessionFileEvidenceKey?: string;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  parentAgentId?: string;
  sourceKind: UsageCapturePosture;
  confidence:
    | "provider_exact"
    | "runtime_exact"
    | "trace_exact"
    | "derived"
    | "estimated"
    | "unknown";
  evidenceRefs: EvidenceRef[];
};
```

Default metadata-only rows must not include raw `workspaceRoot`, `codexHome`,
`sessionFilePath`, or `cwd`. Those may appear only in private diagnostics when
`raw_path_policy` explicitly allows it.

Recommended dedupe keys:

```text
app-server notification:
  connectionId + method + threadId + turnId + itemId + lifecycle

server request:
  connectionId + requestId + method

rate-limit read response:
  connectionId + requestId
```

```ts
type EvidenceRef = {
  id: string;
  kind:
    | "app_server_notification"
    | "app_server_request"
    | "app_server_response"
    | "runtime_provider_profile"
    | "rollout_trace_row"
    | "stored_transcript_row"
    | "thread_analytics_snapshot"
    | "operator_action"
    | "inference";
  label: string;
  observedAt: string;
  status: "fresh" | "stale" | "failed" | "unavailable";
  confidence: "proven" | "declared" | "configured" | "observed" | "inferred" | "unknown";
};
```

## Row Families

### Session Rows

```ts
type SessionStartedRow = CodexUsageLedgerRowBase & {
  rowKind: "session_started";
  providerKind: "codex_executable" | "direct_oai" | "unknown";
  providerProfileId?: string;
  runtimeCommand?: string;
  resolvedRuntime?: "host" | "wsl" | "direct" | "unknown";
  workspaceRootEvidenceKey?: string;
  codexHomeEvidenceKey?: string;
  appServerTransport?: "websocket" | "stdio" | "off" | "unknown";
};

type SessionCompletedRow = CodexUsageLedgerRowBase & {
  rowKind: "session_completed";
  status: "completed" | "interrupted" | "failed" | "unknown";
  durationMs?: number;
  summaryRef?: string;
};
```

### Connection Rows

```ts
type ConnectionRow = CodexUsageLedgerRowBase & {
  rowKind: "app_server_connection_opened" | "app_server_connection_closed";
  connectionId: string;
  transport: "stdio" | "websocket" | "unix" | "off" | "unknown";
  readyUrlEvidenceKey?: string;
  openedAt?: string;
  closedAt?: string;
  closeReason?: string;
};
```

JSON-RPC ids are scoped to a connection. Any row that references request ids must
carry `connectionId`.

### Agent / Thread Rows

```ts
type AgentThreadRow = CodexUsageLedgerRowBase & {
  rowKind: "agent_thread_discovered" | "agent_thread_updated";
  agentId: string;
  parentAgentId?: string;
  threadId: string;
  agentRole?: string;
  nickname?: string;
  agentSource:
    | "app_server_thread_metadata"
    | "collabToolCall_item"
    | "thread_analytics_backfill"
    | "unknown";
  model?: string;
  reasoningEffort?: string;
  contextWindow?: number;
  lifecycleStatus:
    | "discovered"
    | "running"
    | "idle"
    | "completed"
    | "errored"
    | "shutdown"
    | "unknown";
};
```

```ts
type ThreadLifecycleRow = CodexUsageLedgerRowBase & {
  rowKind:
    | "thread_started"
    | "thread_resumed"
    | "thread_forked"
    | "thread_loaded"
    | "thread_closed"
    | "thread_archived"
    | "thread_unarchived";
  threadId: string;
  sessionId?: string;
  forkedFromThreadId?: string;
  ephemeral?: boolean;
  sourceOperation?: "start" | "resume" | "fork" | "load" | "close" | "archive" | "unarchive" | "unknown";
};
```

```ts
type AgentEdgeRow = CodexUsageLedgerRowBase & {
  rowKind: "agent_edge";
  parentAgentId: string;
  childAgentId: string;
  parentThreadId?: string;
  childThreadId?: string;
  edgeKind: "spawned" | "sent_input" | "waited" | "closed" | "unknown";
};
```

Sub-agent attribution rule:

```text
Every child agent/thread gets its own rows.
Parent rows may reference child agent ids, but parent totals must not silently
absorb child usage without a declared rollup row.
Sub-agent nickname/role should come from app-server thread metadata when
available; collab tool-call items are supporting evidence, not identity authority
by themselves.
```

### Turn Rows

```ts
type TurnStartedRow = CodexUsageLedgerRowBase & {
  rowKind: "turn_started";
  turnId: string;
  agentId?: string;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  modelContextWindow?: number;
  collaborationModeKind?: string;
  startedAt?: string;
};

type TurnCompletedRow = CodexUsageLedgerRowBase & {
  rowKind: "turn_completed";
  turnId: string;
  status: "completed" | "interrupted" | "failed" | "unknown";
  completedAt?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  toolCallCount?: number;
  lastAgentMessageHash?: string;
  tokenUsageRef?: string;
  rateLimitSnapshotRefs?: string[];
};
```

### Token Usage Rows

```ts
type TokenUsageRow = CodexUsageLedgerRowBase & {
  rowKind: "token_usage";
  usageRef: string;
  usageScope: "thread_total" | "turn_delta" | "inference_call" | "context_snapshot" | "estimate";
  snapshotSeq?: number;
  previousSnapshotRef?: string;
  derivedDeltaFromSnapshotRefs?: string[];
  inputTokens: number;
  cachedInputTokens: number;
  nonCachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  blendedDisplayTokens?: number;
  modelContextWindow?: number;
  sourcePayloadShape?: "TokenUsage" | "TokenUsageInfo" | "ResponseCompleted" | "rollout_trace" | "estimate";
};
```

Rules:

```text
nonCachedInputTokens = max(inputTokens - cachedInputTokens, 0)
Preserve upstream token fields exactly.
Do not treat context recomputation as billing truth.
Do not treat missing usage as zero usage.
thread/tokenUsage/updated is a snapshot, not necessarily a turn delta.
Do not compute turn delta unless prior snapshot continuity is trusted.
If deriving a delta from snapshots, confidence = derived, not provider_exact.
```

### Rate Limit Rows

```ts
type RateLimitSnapshotRow = CodexUsageLedgerRowBase & {
  rowKind: "rate_limit_snapshot";
  snapshotRef: string;
  limitId?: string;
  limitName?: string;
  accountEvidenceKey?: string;
  authMode?: "apiKey" | "chatgpt" | "none" | "unknown";
  planType?: string;
  primary?: RateLimitWindowProjection;
  secondary?: RateLimitWindowProjection;
  credits?: {
    remaining?: number;
    total?: number;
    used?: number;
  };
  rateLimitReachedType?: string;
};

type RateLimitWindowProjection = {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
  resetsAtIso?: string;
};
```

Rules:

```text
Reset labels are formatted from provider-exposed timestamps only.
Do not infer reset timestamps from window length.
Quota rows are provider/account evidence, not local activity evidence.
Do not store raw email/account identifier by default.
```

### Inference Call Rows

```ts
type InferenceCallRow = CodexUsageLedgerRowBase & {
  rowKind:
    | "inference_call_started"
    | "inference_call_completed"
    | "inference_call_failed"
    | "inference_call_cancelled";
  inferenceCallId: string;
  turnId?: string;
  responseId?: string;
  upstreamRequestId?: string;
  providerName?: string;
  model?: string;
  requestPayloadRef?: string;
  responsePayloadRef?: string;
  requestPayloadHash?: string;
  responsePayloadHash?: string;
  tokenUsageRef?: string;
  status: "started" | "completed" | "failed" | "cancelled" | "unknown";
};
```

V0 rule:

```text
Inference rows are written only when a trace source or future app-server method
provides them. The shell must not invent inference calls from assistant message
boundaries.
```

### Tool Call Rows

```ts
type ToolCallRow = CodexUsageLedgerRowBase & {
  rowKind: "tool_call_started" | "tool_call_completed" | "tool_call_failed";
  toolCallId: string;
  itemId?: string;
  itemKind?: string;
  threadItemType?: string;
  turnItemOrdinal?: number;
  toolName: string;
  toolKind:
    | "command_exec"
    | "file_change"
    | "mcp_tool"
    | "dynamic_tool"
    | "subagent"
    | "hook"
    | "unknown";
  status: "started" | "completed" | "failed" | "cancelled" | "unknown";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputPayloadRef?: string;
  outputPayloadRef?: string;
  inputPayloadHash?: string;
  outputPayloadHash?: string;
  commandPreview?: string;
  commandPreviewHash?: string;
  commandPreviewTruncated?: boolean;
  cwdEvidenceKey?: string;
  exitCode?: number;
  targetAgentId?: string;
};
```

Rules:

```text
Command/probe execution is a tool call, not a model inference call.
Sub-agent spawn/send/wait/close activity is a tool call plus an agent graph update.
Tool output text is excluded unless explicitly enabled.
App-server item lifecycle is the authority for tool execution state.
Raw cwd is excluded by default; use cwdEvidenceKey.
```

### Server Request Rows

```ts
type ServerRequestRow = CodexUsageLedgerRowBase & {
  rowKind:
    | "server_request_started"
    | "server_request_responded"
    | "server_request_resolved"
    | "server_request_closed";
  requestKey: string;
  requestId: string | number;
  method: string;
  serverRequestKind:
    | "approval"
    | "user_input"
    | "auth_refresh"
    | "mcp_elicitation"
    | "dynamic_tool"
    | "unknown";
  riskCategory: string;
  status: "pending" | "responding" | "resolved" | "declined" | "canceled" | "connection_closed" | "unknown";
  receivedAt?: string;
  respondedAt?: string;
  resolvedAt?: string;
  resolvedByNotificationRef?: string;
  clientResponseRef?: string;
  responseSummary?: string;
  errorSummary?: string;
};
```

Server request rows are authority evidence. They should be captured even when
they do not affect token usage.

Rule:

```text
requestKey = `${connectionId}:${requestId}`
```

### Rollup Rows

```ts
type UsageRollupRow = CodexUsageLedgerRowBase & {
  rowKind: "usage_rollup";
  rollupScope: "turn" | "agent" | "thread" | "session";
  targetId: string;
  childRefs: string[];
  tokenUsageRefs: string[];
  toolCallRefs: string[];
  rateLimitSnapshotRefs: string[];
  rollupAlgorithm: string;
  rollupAlgorithmVersion: string;
  inputRowDigests: string[];
  confidence: "runtime_exact" | "trace_exact" | "derived" | "estimated" | "unknown";
};
```

Rollups must be reproducible from prior rows. They are convenience rows, not the
primary evidence. Rollups can be omitted without losing primary evidence.

### Unavailable / Error Rows

```ts
type UsageUnavailableRow = CodexUsageLedgerRowBase & {
  rowKind: "usage_unavailable";
  unavailableKind:
    | "token_usage_missing"
    | "rate_limits_unsupported"
    | "trace_unavailable"
    | "tool_metadata_unavailable"
    | "subagent_metadata_unavailable"
    | "ledger_write_degraded";
  targetKind: "session" | "thread" | "turn" | "agent" | "tool" | "account";
  targetId?: string;
  reason: string;
};
```

```ts
type AppServerErrorRow = CodexUsageLedgerRowBase & {
  rowKind: "app_server_error";
  errorCode?: number;
  errorMessageClass?: string;
  retryable?: boolean;
  method?: string;
  requestKey?: string;
};
```

Use `usage_unavailable` rows when evidence is missing or unsupported. Do not use
absence of rows to imply zero usage.

## Source Mapping

### Live app-server capture

The collector should subscribe in main process at the app-server session layer:

```text
src/main/codex-surface-session.js
  WebSocket message received
    -> handleServerNotification(method, params)
    -> handleServerRequest(message)
    -> request/response timing for client requests
```

V0 capture methods:

```text
initialize / initialized schema and capability references
app-server connection open/close
thread started/resumed/forked/loaded/closed when exposed
turn/started
turn/completed
thread/tokenUsage/updated
account/rateLimits/updated
account/rateLimits/read response
item/started
item/completed
command/exec output/final notifications where useful metadata is available
serverRequest/resolved
server-initiated request lifecycle
JSON-RPC retry/overload errors
```

Do not make the renderer the source of truth for ledger capture.

### Rollout trace import

If rollout traces are available, add an importer:

```text
rollout trace raw events
  -> InferenceStarted / InferenceCompleted / InferenceFailed
  -> tool started/ended
  -> turn started/ended
  -> payload refs and token usage
```

Trace import rows should use:

```text
sourceKind: rollout_trace_imported
confidence: trace_exact
```

### Stored transcript / analytics backfill

For existing completed runs:

```text
stored JSONL transcript
  -> reduced turn/tool/message facts
  -> codex_usage_ledger rows with lower confidence
```

Backfilled rows should use:

```text
sourceKind: thread_analytics_reduced | transcript_estimate_only
confidence: derived | estimated
```

Backfill must not claim exact inference calls unless trace rows are present.

## UX Projection

V0 should not overload the bottom composer band.

Recommended projection:

```text
Codex Runtime drawer / Usage tab
  - current live context and quota witnesses
  - ledger capture status
  - latest turn usage summary
  - ledger file path
  - export/open actions

Middle Analytics tab
  - later: ledger-backed usage dashboard
  - separate from existing derived thread analytics

ADEU importer
  - later: maps ledger rows onto ProgramBench/ADEU stage ledgers
```

The bottom band should remain compact:

```text
quota percentage / reset
context usage
model/reasoning/access quick settings
```

It should not become a ledger inspector.

## Privacy And Redaction

Default mode is metadata-only.

Before every JSONL append:

```text
serialize candidate row
run main-process redaction/raw-exposure scanner
if blocker found, write minimal redaction_blocked / usage_unavailable row instead
```

Never write by default:

```text
raw prompts
assistant final text
reasoning text
full command output
full MCP payloads
auth tokens
cookies
bearer headers
environment secrets
raw provider response payloads
absolute workspace/Codex home/session paths
ChatGPT email or raw account identifier
```

Allowed by default:

```text
ids
timestamps
durations
model labels
reasoning effort labels
approval/sandbox labels
token counts
rate-limit percentages/reset timestamps
tool names/kinds/statuses
exit codes
payload hashes only when explicitly enabled
bounded command previews
file refs when already visible in transcript
```

Diagnostic export must pass through a main-process redactor.

Payload hash rule:

```text
Payload hashes are disabled by default.
If enabled for local correlation, prefer hmac_sha256 with a local non-exported
key over plain sha256.
```

### Writer Queue

```ts
type UsageLedgerWriterStatus = {
  state: "idle" | "writing" | "backpressured" | "degraded" | "failed";
  queuedRows: number;
  droppedRows: number;
  lastError?: string;
};
```

Rules:

```text
main process owns the writer queue
renderer never writes ledger rows
queue is bounded
on overflow, write usage_unavailable / ledger_write_degraded if possible
strict=false never blocks a Codex turn
strict=true may block turn/start only if session/turn-start evidence cannot be written
```

## Cost Boundary

Cost is not captured as runtime truth.

Cost rows may be produced later by an explicit pricing pass. Live capture never
writes cost rows by default.

```ts
type CostRow = CodexUsageLedgerRowBase & {
  rowKind: "cost_estimate";
  costRef: string;
  derivedFromLedgerId: string;
  tokenUsageRef: string;
  model: string;
  pricingSnapshotRef: string;
  pricingSnapshotDigest: string;
  pricingSnapshotSource: "manual" | "official_api" | "imported" | "unknown";
  pricingRetrievedAt: string;
  inputRate?: number;
  cachedInputRate?: number;
  outputRate?: number;
  reasoningBillingPolicy:
    | "included_in_output_tokens"
    | "separate_reasoning_rate"
    | "provider_specific_unknown";
  estimatedCostUsd?: number;
  costConfidence: "exact_if_price_snapshot_bound" | "estimated_from_tokens" | "unavailable";
};
```

Rules:

```text
Cost requires a dated pricing snapshot.
Pricing changes must not rewrite original token rows.
Reasoning-token billing semantics must be explicit.
Cost passes should write a separate derived file or append only when explicitly requested.
```

## ADEU / ProgramBench Import Contract

The downstream ADEU ledger should map:

```text
codex_usage_ledger@1
  -> adeu_programbench_run_ledger@1
```

ADEU owns:

```text
stage_id
stage_kind
programbench_task_id
attempt_id
score rows
method comparison rows
stage cost rollups
go/no-go interpretation
postmortem classification
```

Codex owns:

```text
runtime/session/thread/agent/turn identity
token usage
tool calls
rate limit snapshots
timings
provider/capability evidence
```

Stage assignment should be a downstream annotation or import mapping, not a
required field in the neutral Codex ledger.

## Failure Modes

| Failure | Required behavior |
| --- | --- |
| Ledger write fails | Show degraded ledger status; do not block Codex turn unless configured as strict |
| App-server disconnects | Write session/connection closed row and close pending request rows |
| Token event missing | Mark token usage unavailable; do not infer zero |
| Rate-limit method unsupported | Mark provider quota not exposed |
| Trace import unavailable | Omit inference rows or mark unavailable |
| Sub-agent metadata unavailable | Preserve agent id/thread id with unknown role |
| Project output dir unwritable | Fall back only if configured; otherwise report unavailable |
| Renderer reloads | Main collector continues or closes ledger based on runtime session lifecycle |
| App-server overloads | Write safe `app_server_error` row with retryable status; do not store raw payload |
| Writer queue overflows | Mark writer degraded and write `usage_unavailable` if possible |
| Redaction scanner blocks row | Write minimal redaction-blocked/unavailable row instead of unsafe row |

## Implementation Order

1. Add `CodexUsageLedgerSchema` JSON Schema or runtime validator.
2. Add header row, manifest, row envelope, digest/seq, and redaction scan.
3. Add `UsageLedgerStore` as append-only JSONL writer with bounded queue.
4. Add `UsageLedgerCollector` in main process and wire it to
   `CodexSurfaceSession` events.
5. Capture connection, session, turn, token usage, rate-limit, tool-call, and server-request
   rows from live app-server events.
6. Add runtime/provider config for `usage_ledger`.
7. Add sanitized ledger status to the Runtime drawer Usage tab.
8. Add export/open ledger file actions.
9. Add transcript/analytics backfill importer with lower confidence labels.
10. Add rollout trace importer when trace files or app-server trace export are
   available.
11. Add ADEU/ProgramBench importer separately.

## Acceptance Criteria

### Capture

- Ledger starts with a `ledger_header` row and maintains a rebuildable manifest.
- Every row has monotonic `seq`, `rowDigest`, and optional `previousRowDigest`.
- App-server schema/version reference is captured from generated schema or
  runtime profile.
- Live `turn/started` creates a `turn_started` row.
- Live `turn/completed` creates a `turn_completed` row.
- `thread/tokenUsage/updated` creates a `token_usage` row preserving upstream
  token fields exactly.
- `thread/tokenUsage/updated` is treated as a snapshot unless a derived delta is
  explicitly computed and labeled `derived`.
- `account/rateLimits/read` and `account/rateLimits/updated` create
  `rate_limit_snapshot` rows when supported.
- Tool and command lifecycle events create tool-call rows without storing full
  tool output text.
- Tool rows include item id/type correlation where available.
- Server-request approval lifecycle creates server-request rows.
- JSON-RPC request ids are scoped by `connectionId` in `requestKey`.
- Sub-agent rows are attributed by child agent/thread id.
- Sub-agent attribution emits child agent/thread rows and optional `agent_edge`
  rows.
- App-server overload/errors can produce safe `app_server_error` rows.

### Evidence

- Every row has `sourceKind`, `confidence`, and `evidenceRefs`.
- Missing usage is represented as unavailable, not zero.
- Missing token/rate/tool/sub-agent evidence writes `usage_unavailable` rows
  where useful.
- Derived/backfilled rows are not labeled exact.
- Inference rows are emitted only from trace/import or explicit runtime evidence.
- Backfilled rows cannot use `provider_exact` or `runtime_exact` confidence.
- Rollup rows include algorithm/version and input row digests.

### Privacy

- Metadata-only mode does not write raw prompt text, assistant output text,
  reasoning text, auth tokens, cookies, raw provider payloads, raw local paths,
  ChatGPT email, or full tool output.
- Payload hashes/refs are opt-in and redacted; hashes are disabled by default or
  HMAC-only when configured for local correlation.
- Redaction scanner runs before JSONL append.
- Renderer receives sanitized summaries only.

### UX

- Runtime drawer shows ledger capture status and current ledger file path.
- Bottom composer band remains compact and does not become a ledger dashboard.
- Analytics can consume ledger summaries later without mutating Codex thread
  state.
- Ledger writer queue exposes degraded/backpressured status.

### Downstream

- ADEU/ProgramBench stage attribution is not required for Codex ledger rows.
- Cost rows are absent unless a dated pricing snapshot is supplied.
- Cost rows are produced only by an explicit pricing pass and cite a dated
  pricing snapshot.
- Existing transcripts can be backfilled only with lower-confidence source kinds.

### Validation

- Every fixture ledger validates against `codex_usage_ledger@1`.
- Every metadata-only fixture passes the raw-exposure scan.
- Every row sequence is monotonic.
- Every row has a digest.

## Test Fixtures

Create fixtures for:

- single-turn coding task with token usage and one command
- multi-turn thread with context usage updates
- rate-limit update with primary and secondary windows
- approval request accepted/declined
- sub-agent spawn/send/wait/close with child thread usage
- app-server disconnect mid-turn
- stored transcript backfill with no trace
- rollout trace import with inference calls and response ids

Expected assertions:

- Exact live rows preserve token fields.
- Backfilled rows are never marked provider exact.
- Child agent usage remains separate from parent usage.
- Cost is not computed without pricing input.
- Metadata-only ledger contains no raw message/tool-output bodies.
