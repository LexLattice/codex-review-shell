# OAI Codex Upstream ODEU Profile

Purpose: define the upstream server-side Codex/OAI primitives that our future
direct runtime harness should treat as root capabilities, and separately map the
implementation choices made by the current Codex CLI over those primitives.

This is not an app-server ontology. `CODEX_APP_SERVER_ONTOLOGY.md` remains the
reference for the Codex executable/app-server thread item model. This document
answers a different question:

```text
What does the upstream OAI/Codex backend provide or allow,
and what did Codex CLI choose to build on top of it?
```

Last verified:

- Review shell repo: `/home/rose/work/LexLattice/codex-review-shell` at `66444b8`
- Codex fork evidence repo: `/home/rose/work/codex/fork` at `9a78fcb260`
- Upstream release branch evidence: `upstream-latest-release` at `e4310be51f`
- Verification date: 2026-05-01

## Epistemic Status

This profile is source-grounded in the local Codex fork and its upstream release
branch. It is not a formal public OAI server contract unless a future public
schema or live provider descriptor confirms it.

Implementation rule:

```text
Codex source evidence can seed the direct harness profile.
Runtime provider evidence must decide what the direct harness actually exposes.
```

Evidence tiers:

| Tier | Meaning | Can Enable Mutation |
| --- | --- | --- |
| `provider_served` | Direct backend serves an explicit descriptor/capability profile. | Yes |
| `runtime_probed` | A safe live probe proves the method/value exists. | Yes, if the probe is specific |
| `model_catalog` | Backend model list declares model settings/tools/context. | Yes for declared model-scoped settings |
| `stream_observed` | A real turn emitted the event/field. | Usually read-only; mutation only if paired with descriptor |
| `codex_source_inferred` | Current Codex CLI code knows how to call/parse it. | No by itself |
| `project_configured` | Operator/project says a value should be used. | No by itself |

## Boundary

The direct runtime should distinguish three layers:

```text
OAI/Codex backend primitives
  -> direct ODEUI harness provider profile
  -> codex-review-shell UX projection

Codex CLI executable
  -> app-server JSON-RPC wrapper
  -> codex-review-shell compatibility path
```

The Codex CLI path is still valuable evidence, but its local choices must not be
mistaken for upstream server-side law.

## ODEU Vocabulary

Objects:

- `Account`: authenticated OAI/ChatGPT/API-key identity.
- `Provider`: endpoint/auth/header/base URL policy used to reach the backend.
- `Model`: server-advertised model descriptor with reasoning/tool/context traits.
- `Turn`: one request/stream cycle against a model.
- `ResponseItem`: server-emitted message, reasoning, tool, search, image, or
  compaction item.
- `ToolCall`: server request for a client or server-side tool action.
- `ToolOutput`: client answer returned into the next model input.
- `RateLimitSnapshot`: quota/limit state for the authenticated account.
- `TokenUsage`: per-turn token usage and context-pressure evidence.
- `Conversation`: server-facing continuity handle where available.
- `LocalThread`: harness-owned persisted working context.

Deontic rules:

- The backend may accept model, reasoning, tool, text, service-tier, and stream
  controls, but only the model catalog/provider profile can authorize which
  values should be exposed.
- The backend may emit tool calls, but local shell/file/network authority is a
  harness decision. Server tool-call output is not permission to execute.
- Provider quota and context pressure must come from quota/token/model evidence,
  not local activity counters.
- Local thread IDs, rollout storage, approval policy, sandboxing, and UI grouping
  are harness choices, not upstream server primitives.
- Unknown provider capability is not permission. Direct runtime controls fail
  closed until provider evidence proves them.

Evidence:

- Model catalog: `/codex-rs/codex-api/src/endpoint/models.rs`,
  `/codex-rs/protocol/src/openai_models.rs`
- Response request/event adapter: `/codex-rs/codex-api/src/common.rs`,
  `/codex-rs/codex-api/src/endpoint/responses.rs`,
  `/codex-rs/codex-api/src/endpoint/responses_websocket.rs`
- SSE parser: `/codex-rs/codex-api/src/sse/responses.rs`
- Response item ontology: `/codex-rs/protocol/src/models.rs`
- Rate-limit parser: `/codex-rs/codex-api/src/rate_limits.rs`,
  `/codex-rs/protocol/src/protocol.rs`
- Account/rate-limit app-server facade:
  `/codex-rs/app-server/src/codex_message_processor.rs`
- Compaction/memory endpoints:
  `/codex-rs/codex-api/src/endpoint/compact.rs`,
  `/codex-rs/codex-api/src/endpoint/memories.rs`

Utility:

- Direct harness can expose settings from actual provider descriptors rather
  than from CLI flags.
- UX can distinguish provider quota, context pressure, model availability, and
  local execution authority.
- Existing Codex CLI threads can be imported as one source of evidence without
  inheriting CLI storage as the canonical future thread ontology.

## Upstream Primitive Families

### 1. Authentication And Account

Upstream-facing primitives:

- Authenticated request headers or signed requests are added by an auth provider.
- ChatGPT/Codex backend auth carries account identity and plan information.
- API-key Responses API auth is a separate mode from ChatGPT subscription auth.
- Account state can include `apiKey`, `chatgpt { email, planType }`, or
  `amazonBedrock`.

Direct harness implication:

- Provider identity belongs in the provider profile, not the renderer.
- Account email/plan can be read-only witnesses.
- Capability to read quota or model descriptors must be proven per provider.

Codex CLI choice:

- `AuthProvider` and model provider config construct headers/base URLs.
- App-server exposes `account/read` and `account/rateLimits/read`.
- The CLI/backend decides whether auth uses the Codex backend or API-key path.

### 2. Model Catalog And Settings

Upstream-facing primitives observed in `ModelInfo`:

- `slug`, `display_name`, `description`
- default and supported reasoning levels
- visibility, priority, supported-in-API flag
- speed tiers
- base instructions and model messages
- reasoning summary support and default summary mode
- verbosity support and default verbosity
- web search/apply patch tool type hints
- truncation policy
- parallel tool-call support
- image detail support
- context window and max context window
- auto-compact token limit
- effective context-window percent
- experimental supported tools
- input modalities
- search-tool support

Direct harness implication:

- Model menu, reasoning menu, speed tier menu, context chip, and tool affordances
  should be projected from model catalog/provider profile evidence.
- `canListModels` and `canSetModel` are different capabilities. A provider may
  accept configured model IDs without serving a full model list.
- Speed is model-specific; it should not be a global fake enum.

Codex CLI choice:

- CLI fetches `/models?client_version=...`, caches ETags, and turns descriptors
  into model picker behavior.
- CLI may apply fallback or bundled model knowledge when catalog evidence is not
  available.
- CLI maps model descriptors into app/server/client settings, but that mapping is
  not the upstream primitive itself.

### 3. Turn Request

Observed upstream request fields include:

- `model`
- `instructions`
- `input`
- `tools`
- `tool_choice`
- `parallel_tool_calls`
- `reasoning { effort, summary }`
- `store`
- `stream`
- `include`
- `service_tier`
- `prompt_cache_key`
- `text { verbosity, format }`
- `client_metadata`

The request can be sent over HTTP/SSE or WebSocket paths.

Direct harness implication:

- The direct runtime should define a provider-neutral `StartTurn` contract that
  maps to these request fields only after capability validation.
- Per-turn overrides are naturally supported when the provider accepts request
  fields, but session/project defaults are harness storage choices.
- Strict JSON output is a model/text-format control, not a UI-only promise.

Codex CLI choice:

- CLI assembles instructions, history, tool descriptors, provider headers,
  conversation headers, and prompt cache keys.
- CLI translates local tool outputs back into `ResponseInputItem` variants.
- CLI decides when to set `store`, `stream`, service tier, and other knobs.

### 4. Stream Events

Observed upstream event families:

- response created
- output item added
- output item done
- output text delta
- custom tool call input delta
- reasoning summary text delta
- reasoning content/text delta
- reasoning summary part added
- completed with token usage
- server model metadata
- model verification metadata
- reasoning-included metadata
- model list ETag metadata
- rate-limit snapshot events
- failed/incomplete/error events

Direct harness implication:

- The direct runtime should store raw upstream events before reducing them into
  UX thread items.
- Live rendering should distinguish streaming state from completed state.
- Final assistant output must not be inferred from local string heuristics when
  server phases/items provide stronger evidence.

Codex CLI choice:

- CLI parses SSE/WebSocket events into internal `ResponseEvent`.
- App-server reduces those into `ThreadItem` lifecycle events such as
  `item/started`, deltas, and `item/completed`.
- The shell currently consumes that app-server-reduced ontology on the executable
  path.

### 5. Response Items And Content

Observed upstream/output item families:

- `message`
- `reasoning`
- `function_call`
- `function_call_output`
- `custom_tool_call`
- `custom_tool_call_output`
- `tool_search_call`
- `tool_search_output`
- `web_search_call`
- `image_generation_call`
- `local_shell_call`
- `compaction`
- `other`

Content primitives include:

- input text
- input image with detail `auto | low | high | original`
- output text
- message phase `commentary | final_answer`

Direct harness implication:

- Treat upstream `ResponseItem` as the first durable semantic layer.
- Preserve unknown items rather than dropping them.
- `GhostSnapshot` in Codex protocol is harness-generated and must not be treated
  as upstream OAI output.

Codex CLI choice:

- CLI maps `ResponseItem` into rollout history and app-server thread history.
- CLI has compatibility logic for missing phases.
- CLI adds local/harness item types and storage forms around server output.

### 6. Tool Protocol

Upstream-facing primitives:

- The client sends tool descriptors in the turn request.
- The server emits tool call items and tool-call input deltas.
- The client returns tool outputs as subsequent input items.
- Dynamic tool search/output can advertise or resolve tools.
- Server-side tools such as web search and image generation can be model/provider
  capabilities.

Direct harness implication:

- The direct harness owns a tool broker.
- Tool authority must be an ODEU object with explicit policy, approval, and
  audit evidence.
- A server-emitted local shell/custom/function call is only a proposed action
  until the harness authorizes and executes it.

Codex CLI choice:

- CLI defines and exposes local shell, patch, MCP, dynamic tools, and other
  tool descriptors.
- CLI runs approvals/sandbox policy before executing local actions.
- App-server surfaces server-request cards and tool state to clients.

### 7. Quota, Rate Limits, And Context

Observed quota primitives:

- Primary used percent, window duration, reset time.
- Secondary used percent, window duration, reset time.
- Limit ID and human limit name.
- Plan type.
- Credits state: has credits, unlimited, balance.
- Rate-limit reached type.

Observed context primitives:

- Per-response token usage: input, cached input, output, reasoning output, total.
- Model context window and max context window.
- Effective context-window percent and auto-compact token limit from model
  descriptors.

Direct harness implication:

- The bottom-band quota chip should use rate-limit snapshots, not local activity.
- The UI should label 5-hour/weekly or similar windows only from provider
  evidence such as `limitName`, window duration, and reset time; do not infer
  which window is which from display position alone.
- The context chip should use token usage plus model context-window evidence.
- Local activity counters can be useful, but they are a separate "activity" class,
  not quota or context.

Codex CLI choice:

- CLI parses rate-limit headers/events into `RateLimitSnapshot`.
- App-server exposes account/rate-limit reads where auth/backend supports them.
- CLI computes context remaining from token usage and model context window.

### 8. Compaction And Memory

Observed upstream-facing primitives:

- `responses/compact` accepts a compaction input and returns response items.
- `memories/trace_summarize` accepts memory trace input and returns summaries.

Direct harness implication:

- Context maintenance can be backed by provider primitives where available.
- The harness should still own when compaction happens, what is persisted, and how
  summaries are attached to local threads.

Codex CLI choice:

- CLI decides when to compact based on local context policy.
- CLI stores compaction results as rollout/history objects.
- CLI memory summarization is a client feature using backend endpoints, not a
  complete upstream thread persistence model.

### 9. Error And Retry Semantics

Observed server/error families:

- context window exceeded
- quota exceeded
- usage not included
- cyber policy block
- invalid prompt/request
- server overloaded
- retryable errors with backoff delay
- incomplete response

Direct harness implication:

- Error types should be preserved as typed events.
- UX should distinguish policy denial, quota exhaustion, context exhaustion,
  invalid request, overload, and transient retry.
- Retry policy should be provider-owned and visible in diagnostics.

Codex CLI choice:

- CLI maps backend/SSE errors into internal error enums and retry behavior.
- App-server and UI convert those into user-visible messages.

## Codex CLI Implementation Map

| Upstream Primitive | Codex CLI Choice | Direct Harness Rule |
| --- | --- | --- |
| Auth headers and account state | Model provider/auth manager owns headers and account reads. | Direct backend owns auth; renderer never sees raw tokens. |
| Model descriptors | CLI fetches/caches `/models`, applies fallback and picker logic. | Direct backend serves normalized model/settings projection. |
| Response request fields | CLI assembles instructions, history, tools, cache keys, and provider metadata. | Direct runtime maps ODEU `StartTurn` to request fields after validation. |
| SSE/WebSocket events | CLI parses into `ResponseEvent`. | Direct runtime should store raw event envelope then reduce to local UX events. |
| Response items | CLI stores as rollout/session history and reduces to app-server `ThreadItem`. | Direct runtime should persist upstream item plus local reduction provenance. |
| Tool calls | CLI exposes local shell/patch/MCP/dynamic tools and executes under policy. | Direct runtime owns tool broker and authority graph directly. |
| Quota snapshots | CLI parses headers/events and app-server exposes reads. | Direct runtime should expose provider quota as first-class profile evidence. |
| Context usage | CLI derives context pressure from token usage/model window. | Direct runtime should compute the same class separately from quota. |
| Compaction | CLI chooses when/how to call compaction and store outputs. | Direct runtime should make compaction an explicit maintenance transition. |
| Thread identity | CLI creates local sessions/rollout IDs and app-server thread IDs. | Direct runtime must define its own local thread graph and import mappings. |
| Approval/sandbox | CLI owns approval policy, sandbox mode, network/write authority. | Direct runtime must implement authority as its own ODEU policy layer. |
| UI/app-server | CLI wraps core through app-server JSON-RPC and TUI/clients. | Direct runtime should not inherit app-server as root; it may offer its own bridge. |

## `pi-mono` Direct OAI Path Evidence

`pi-mono` is a useful second witness because it implements an OAI/Codex path
without going through the Codex CLI app-server. It has two relevant adapters:

- `openai-responses`: API-key/OpenAI-compatible Responses API path.
- `openai-codex-responses`: ChatGPT subscription/Codex backend path.

Source evidence:

- `/home/rose/work/pi-mono/packages/ai/src/providers/openai-codex-responses.ts`
- `/home/rose/work/pi-mono/packages/ai/src/providers/openai-responses.ts`
- `/home/rose/work/pi-mono/packages/ai/src/providers/openai-responses-shared.ts`
- `/home/rose/work/pi-mono/packages/ai/src/utils/oauth/openai-codex.ts`
- `/home/rose/work/pi-mono/packages/ai/src/types.ts`
- `/home/rose/work/pi-mono/packages/ai/src/models.generated.ts`
- `/home/rose/work/pi-mono/packages/coding-agent/src/core/sdk.ts`
- `/home/rose/work/pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `/home/rose/work/pi-mono/packages/coding-agent/src/core/compaction/compaction.ts`

Verification snapshot:

- Repo: `/home/rose/work/pi-mono`
- Branch: `main`
- Commit: `5a07d946`
- Verification date: 2026-05-01

### pi-mono ODEU Summary

Objects:

- `Model`: static/generated provider model entry with `id`, `api`, `provider`,
  `baseUrl`, `reasoning`, modalities, cost, `contextWindow`, and `maxTokens`.
- `Context`: system prompt, local message list, and tool descriptors.
- `AssistantMessage`: local reduced result with text/thinking/tool-call blocks,
  response ID, usage, stop reason, error, timestamp.
- `AssistantMessageEvent`: local event stream with text/thinking/tool-call
  start/delta/end plus terminal done/error events.
- `OAuthCredentials`: ChatGPT OAuth access/refresh token, expiry, account ID.
- `Session`: local coding-agent state, branch/session file, model, thinking
  level, tools, compaction state.

Deontic choices:

- Direct provider adapters own request construction and stream reduction.
- OAuth token and account ID are handled outside the renderer/provider consumer.
- Tool execution remains harness-owned; the provider only emits tool-call blocks.
- Context compaction and branch/session semantics are local harness policy.
- Model/reasoning support is mostly generated/static model metadata, not a live
  provider-served catalog.

Evidence:

- The ChatGPT/Codex adapter posts to `https://chatgpt.com/backend-api/codex/responses`.
- It uses `Authorization: Bearer <token>` plus `chatgpt-account-id`.
- It derives account ID from the JWT claim `https://api.openai.com/auth` and
  its `chatgpt_account_id` field.
- It uses SSE by default and has optional WebSocket transport.
- It maps Responses stream events into its own `AssistantMessageEventStream`.

Utility:

- Proves our direct runtime can be provider-adapter shaped rather than
  app-server shaped.
- Shows a practical request/header shape for the ChatGPT subscription path.
- Shows what we should avoid: static model authority and missing quota profile.

### pi-mono Versus Codex CLI

Relation values:

- `Same`: same upstream primitive family or wire concept.
- `Partial`: same root primitive, but pi-mono or Codex exposes less evidence.
- `Different`: local implementation choice differs.
- `NA`: not implemented or not an upstream/provider concern in that path.

| Primitive / Concern | Relation | Codex CLI | pi-mono | Direct Harness Takeaway |
| --- | --- | --- | --- | --- |
| Root boundary | Different | `codex app-server` wraps Codex core and exposes JSON-RPC. | Provider adapter directly calls Responses/Codex backend. | Our direct path should look more like a provider/backend adapter than an app-server client. |
| ChatGPT backend URL | Same | Uses model provider/base URL and Codex backend routes internally. | Defaults to `https://chatgpt.com/backend-api/codex/responses`. | Same backend family; verify actual route/live headers in our backend, do not hardcode as sole authority. |
| Auth | Same | Codex auth manager/provider signs or adds headers; app-server exposes account reads. | OAuth flow gets ChatGPT token, refresh token, expiry, account ID; request uses bearer + `chatgpt-account-id`. | Same essential auth primitive; our direct backend should own refresh, account extraction, and redaction. |
| OAuth flow | Partial | Codex has its own ChatGPT auth stack. | Uses OpenAI OAuth with PKCE, local callback on `localhost:1455`, scope `openid profile email offline_access`, originator `pi`. | Same general class; implementation-specific client ID/originator/callback are not reusable law. |
| Account profile | Partial | App-server exposes account type/email/plan and rate-limit read. | OAuth credential stores account ID, but no equivalent account profile read surfaced in the provider adapter. | Direct harness should implement provider-served account profile. |
| Model list | Different | Codex fetches backend `/models` with rich descriptors and ETag. | Uses generated/static `models.generated.ts` entries for `openai-codex`; no live Codex model catalog in this path. | Direct harness should prefer Codex-style live descriptors over pi-mono static model authority. |
| Reasoning levels | Partial | Codex model descriptors expose supported/default reasoning levels. | Model has boolean `reasoning`; xhigh support is inferred by model ID helper; Codex path clamps some model/effort combinations manually. | pi-mono is useful compatibility evidence, but direct harness should use provider-declared supported levels. |
| Speed / service tier | Partial | Codex request supports `service_tier`; model catalog may describe speed tiers. | Supports `serviceTier`; applies local cost multiplier for `flex`/`priority`. | Same request primitive; direct UI should expose speed only from model/provider descriptors. |
| Request body | Same | Codex sends Responses request fields through its provider layer. | Codex path sends `model`, `store:false`, `stream:true`, `instructions`, `input`, `text.verbosity`, `include`, `prompt_cache_key`, `tool_choice:auto`, `parallel_tool_calls:true`, optional reasoning/service tier/tools. | Strong evidence for core request shape. |
| System prompt placement | Different | Codex assembles instructions/history internally. | `openai-codex-responses` passes system prompt as `instructions` and excludes it from `input`; generic `openai-responses` may use `developer`/`system` converted message. | Direct harness should make prompt placement explicit per provider path. |
| Tool descriptors | Same | Codex exposes local shell/patch/MCP/etc through tool descriptors and approvals. | Converts local tools to Responses `function` tools; `strict:null` on Codex path, default strict false in shared converter. | Same upstream function-tool primitive; authority and tool catalog remain harness-owned. |
| Tool-call IDs | Different | Codex preserves server call/item IDs through protocol types. | Uses compound local ID `${call_id}|${item.id}` and normalizes IDs for replay/cross-provider handoff. | Direct harness should preserve upstream IDs plus local normalized IDs separately. |
| Reasoning replay | Same | Codex preserves reasoning/encrypted content as response items. | Stores reasoning item JSON as `thinkingSignature` and sends it back on replay; includes `reasoning.encrypted_content`. | Direct harness should persist opaque reasoning evidence explicitly. |
| Message phase | Same | Codex has `commentary` / `final_answer` phase in protocol. | Encodes response message `id` and optional phase into `TextSignatureV1`; replays phase into Responses message. | Direct reducer should preserve phase when present. |
| Stream events | Different | Codex parses SSE/WebSocket to `ResponseEvent`, then app-server `ThreadItem`. | Parses Responses events directly to local `AssistantMessageEventStream`: thinking/text/toolcall start/delta/end. | Direct harness can use pi-mono-style local stream first, then ODEU event reducer. |
| WebSocket | Partial | Codex has Responses websocket client and app-server websocket transport separately. | Optional direct WebSocket to `/codex/responses`, sends `{ type: "response.create", ...body }`, uses `OpenAI-Beta: responses_websockets=2026-02-06`, caches per session for 5 minutes. | Useful implementation evidence; direct backend should hide websocket details behind provider transport. |
| SSE | Same | Codex accepts `text/event-stream` and parses server events. | Manual SSE parser reads `data:` chunks, maps `response.done`/`incomplete`/`completed` to `response.completed`. | pi-mono mapping shows compatibility shims we may need. |
| Prompt cache/session affinity | Same | Codex uses prompt cache key and conversation headers. | Uses `prompt_cache_key`, `session_id`, and `x-client-request-id`; generic Responses path also has `prompt_cache_retention`. | Direct harness should model cache/session affinity explicitly, not conflate it with local thread ID. |
| Quota/rate limits | NA | Codex parses quota/rate-limit headers/events and app-server exposes `account/rateLimits/read`. | Only recognizes usage-limit/rate-limit errors for friendly messages; no quota snapshot/profile surfaced. | Use Codex evidence/live provider reads for 5-hour/weekly quota; pi-mono is not enough. |
| Context usage | Partial | Codex uses token usage and model context window. | Computes context usage from last assistant usage plus estimated trailing tokens; invalidates after compaction until a post-compaction response exists. | Same high-level approach; pi-mono has a useful stale-after-compaction guard. |
| Compaction | Different | Codex can call backend compaction endpoint and stores compaction in rollout history. | Coding-agent performs local compaction summaries through its own session manager and provider calls; not the same backend compaction primitive. | Direct harness should decide whether to use backend compaction endpoint, local summarization, or both with provenance. |
| Thread/session storage | Different | Codex stores rollout/session history in `CODEX_HOME`. | Stores local coding-agent sessions and branch graph; exposes branch/fork summaries. | Neither is upstream law. Direct harness needs its own thread graph/import mapping. |
| Approval/sandbox | NA | Codex has first-class approval/sandbox semantics. | No equivalent Codex approval policy primitive in the OAI adapter; local tools exist in coding-agent. | Direct harness must own authority layer. |
| Model switching | Partial | Codex model picker uses runtime/project config and backend model descriptors. | Session changes model in local state and persists model/thinking changes; available levels from boolean + xhigh heuristic. | Direct harness should keep the state pattern but improve evidence source. |
| Extension hooks | Different | Codex has app-server/MCP/tool extension routes. | Has `before_provider_request`, `after_provider_response`, context transform, custom providers, and dynamic provider registration. | Useful for ODEU harness extensibility; provider request/response hooks should be explicit and redacted. |

### pi-mono Request Shape For ChatGPT/Codex Path

`openai-codex-responses` builds this effective request body:

```ts
{
  model: model.id,
  store: false,
  stream: true,
  instructions: context.systemPrompt,
  input: convertResponsesMessages(..., { includeSystemPrompt: false }),
  text: { verbosity: options.textVerbosity ?? "low" },
  include: ["reasoning.encrypted_content"],
  prompt_cache_key: options.sessionId,
  tool_choice: "auto",
  parallel_tool_calls: true,
  tools: convertResponsesTools(context.tools, { strict: null }),
  reasoning: options.reasoningEffort
    ? { effort: clampedEffort, summary: options.reasoningSummary ?? "auto" }
    : undefined,
  service_tier: options.serviceTier
}
```

Headers:

```text
Authorization: Bearer <access token>
chatgpt-account-id: <account id from JWT>
originator: pi
User-Agent: pi (...)
OpenAI-Beta: responses=experimental
accept: text/event-stream
content-type: application/json
session_id: <session id, if provided>
x-client-request-id: <session/request id>
```

WebSocket variant:

```text
OpenAI-Beta: responses_websockets=2026-02-06
message: { type: "response.create", ...requestBody }
```

Direct harness rule:

```text
Treat this as a working implementation witness, not as a final contract.
The direct backend should make route, headers, beta flags, transport, and
available request fields provider-profile evidence.
```

### pi-mono Stream Reduction

`pi-mono` reduces upstream Responses events into:

- `start`
- `text_start`, `text_delta`, `text_end`
- `thinking_start`, `thinking_delta`, `thinking_end`
- `toolcall_start`, `toolcall_delta`, `toolcall_end`
- `done`
- `error`

It maps upstream objects as follows:

- `response.output_item.added` with `reasoning` -> local thinking block.
- `response.reasoning_summary_text.delta` -> thinking delta.
- `response.output_item.added` with `message` -> local text block.
- `response.output_text.delta` -> text delta.
- `response.output_item.added` with `function_call` -> local tool call block.
- `response.function_call_arguments.delta` -> streaming tool arguments.
- `response.completed.usage` -> local usage/cost.
- `response.status` -> local stop reason.

Direct harness rule:

```text
Use a two-stage reducer:
1. Preserve raw provider event.
2. Reduce into ODEU stream event with provenance.
```

This avoids losing upstream event identity while still giving the UX simple
streaming primitives.

### pi-mono Gaps For Our Direct Runtime

`pi-mono` is not enough as an authority substrate for our direct runtime:

- No provider-served runtime capability profile.
- No live Codex model catalog equivalent to Codex `/models`.
- No quota/rate-limit snapshot support for the ChatGPT subscription path.
- Reasoning support is mostly boolean plus heuristics.
- Speed/service tier is accepted as an option, but available choices are not
  proven from provider descriptors.
- Approval/sandbox/network/write authority is outside the OAI adapter.
- Local session and compaction semantics are harness-specific.
- Request hooks can inspect/mutate payloads, so our version needs explicit
  redaction, audit, and authority boundaries.

Implementation takeaway:

```text
Adopt pi-mono's provider-adapter shape and direct ChatGPT/Codex route evidence.
Do not adopt pi-mono's static model/setting authority as our final capability
model. Our backend must serve a normalized OAI capability profile and update it
from live provider evidence where possible.
```

## What Is Not Upstream Law

These are Codex CLI or shell implementation choices:

- `codex app-server` JSON-RPC method names.
- App-server `ThreadItem` lifecycle naming.
- Local rollout JSONL storage.
- Local thread discovery under `CODEX_HOME`.
- TUI/app/VS Code source labels.
- Approval policy names and sandbox mode names as currently surfaced by CLI.
- MCP wiring and local dynamic tool registry.
- Shell rendering choices such as collapsed thought process groups.
- Project/lane binding and middle-plane workflow topology.
- Local file click/open actions.

These may remain compatibility adapters for the executable provider, but the
direct runtime should model them as local harness artifacts.

## Direct Harness Root Profile

The direct implementation should expose a root provider profile similar to:

```ts
type OaiServerCapabilityProfile = {
  schemaVersion: 1;
  providerKind: "direct_oai";
  profileId: string;
  account: {
    status: "available" | "unavailable" | "failed" | "unknown";
    email?: string;
    planType?: string;
    evidenceRefs: EvidenceRef[];
  };
  models: {
    status: "available" | "unavailable" | "failed" | "unknown";
    etag?: string;
    items: OaiModelDescriptor[];
    evidenceRefs: EvidenceRef[];
  };
  turn: {
    transports: Array<"sse" | "websocket">;
    requestFields: string[];
    supportsStreaming: boolean;
    evidenceRefs: EvidenceRef[];
  };
  tools: {
    serverSide: ToolCapabilityDescriptor[];
    clientSideProtocol: ToolProtocolDescriptor[];
    evidenceRefs: EvidenceRef[];
  };
  quota: {
    canRead: boolean;
    latest?: RateLimitSnapshot;
    evidenceRefs: EvidenceRef[];
  };
  context: {
    tokenUsageAvailable: boolean;
    modelWindowAvailable: boolean;
    evidenceRefs: EvidenceRef[];
  };
  maintenance: {
    compaction: CapabilityDescriptor;
    memorySummarization: CapabilityDescriptor;
  };
  updatedAt: string;
};
```

Rules:

- The direct backend serves this profile to the shell.
- The shell renders settings from this profile, not from Codex CLI source.
- `codex_source_inferred` can populate diagnostics and initial implementation
  backlog, but cannot enable controls.
- Provider quota and context controls are read-only until live evidence exists.

## Direct Harness Thread Import

Existing threads can come from Codex CLI, ChatGPT, or the future direct harness.
Import should preserve provenance:

```ts
type ImportedThreadSource = {
  sourceKind: "codex_cli" | "chatgpt" | "direct_oai" | "manual";
  sourceThreadId?: string;
  sourcePath?: string;
  sourceConversationId?: string;
  importedAt: string;
  sourceFingerprint: string;
};
```

Import rules:

- Do not treat Codex CLI local thread IDs as upstream server IDs.
- Preserve raw source transcript where possible.
- Store normalized ODEU events separately from raw imported evidence.
- Recompute analytics from normalized events, but keep source fingerprints so
  changed imported threads can be updated idempotently.

## Required Direct-Harness Probes

Initial safe probes:

1. Auth/account profile.
2. Model catalog and ETag.
3. Quota/rate-limit read if provider declares or proves support.
4. Non-mutating capability descriptor read, if our backend exposes one.
5. Optional stream smoke using a harmless request only in explicit diagnostic
   mode, not at app startup.

Unsafe probes:

- Any shell/file/network execution.
- Sandbox/approval mutation.
- Destructive maintenance.
- Thread deletion/pruning.
- Secret or connector enumeration beyond provider-declared availability.

## Revalidation Checklist

When upstream changes or we update the direct backend:

- Re-check model descriptor fields and reasoning effort values.
- Re-check response request fields.
- Re-check SSE/WebSocket event names and payloads.
- Re-check rate-limit snapshot fields and header/event names.
- Re-check account plan/account types.
- Re-check tool-call item types and tool-output input variants.
- Re-check compaction and memory endpoint shapes.
- Confirm direct provider profile still separates quota from context.
- Confirm UI controls still fail closed when evidence is absent.
- Confirm CLI compatibility adapters are not leaking into direct-provider
  authority decisions.
