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

- Review shell repo: `/home/rose/work/LexLattice/codex-review-shell-direct`
  on the reviewed `origin/main` lineage
- Codex fork implementation evidence: `/home/rose/work/codex/fork`
  `origin/main` at `923840b357e15195e66f7e82ac81ee0f39fc7050`
- Upstream stable-release evidence: `origin/upstream-latest-release` at
  `be6e8eac029b183056b7e4402879f15d2c85f61b` (`rust-v0.147.0`)
- Prior bounded release baseline: `rust-v0.145.0`
- Verification date: 2026-08-09
- Verification scope: release-147 agent-runtime/exec-server delta; unchanged
  primitive-family inventories retain their earlier source grounding

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
- Standalone provider adapters:
  `/codex-rs/codex-api/src/endpoint/images.rs`,
  `/codex-rs/codex-api/src/endpoint/search.rs`
- Codex-core world-state implementation (not backend law):
  `/codex-rs/core/src/context/world_state/`,
  `/codex-rs/core/src/session/world_state.rs`,
  `/codex-rs/protocol/src/protocol.rs` (`WorldStateItem`)

Utility:

- Direct harness can expose settings from actual provider descriptors rather
  than from CLI flags.
- UX can distinguish provider quota, context pressure, model availability, and
  local execution authority.
- Existing Codex CLI threads can be imported as one source of evidence without
  inheriting CLI storage as the canonical future thread ontology.

## Release 0.144.4 ODEU Baseline Refresh

This historical refresh replaced the stale release-132 document baseline with
release-144 evidence. It does not claim that every listed primitive was
introduced after the separately inspected `0.142.3` tag. The evidence spans
three different authority layers and is extended by the 145-147 section below.

### Provider/backend evidence

- The model catalog now treats reasoning effort as an open, non-empty
  model-advertised string. Known values include `max` and `ultra`, but future
  values must be preserved rather than rejected by a closed client enum.
- Model descriptors can now carry `default_service_tier`, `tool_mode`,
  `multi_agent_version`, `comp_hash`, `use_responses_lite`, skills-instruction
  posture, approval/auto-review messages, and an auto-review model override.
  These are served metadata inputs to client policy; they are not themselves
  proof that the corresponding local tool or agent action is authorized.
- The provider adapter has typed standalone image generation/edit endpoints and
  an alpha standalone search endpoint in addition to Responses-hosted image and
  web-search items. Direct must distinguish hosted tool calls from separate
  endpoint calls because their authority, request, result, and retry envelopes
  differ.
- Response streams now preserve safety-buffering state, turn moderation
  metadata, `reasoning_summary_text.done`, the server-selected model, and an
  optional affirmative `end_turn` signal in the completed response.
- Response items can carry stable item IDs and internal turn IDs across more
  variants. Dynamic/custom tool namespaces and inter-agent message content are
  now preserved more explicitly.
- Rate-limit evidence has grown beyond window percentages: app-server can read
  typed reset-credit rows with IDs, reset type, status, grant/expiry timestamps,
  display text, and idempotent redemption outcomes.

### Codex-core implementation evidence

- Codex now constructs a per-step `WorldState`, renders full or diff fragments
  into model context, persists full/patch snapshots, restores the baseline on
  resume, and starts a full baseline after compaction. Core built-ins cover
  AGENTS/instruction context, environment, app instructions, and plugin
  instructions. Extensions contribute further sections; the skills extension
  derives its section from selected capability roots.
- Environment selection is now part of step context. Environment-owned
  capability roots determine where skills/plugins are read and where their MCP
  runtimes execute.
- Context management has explicit history modes, context-window identities,
  replacement histories, token-budget guidance, and a model-visible request for
  a new context window. This materially overlaps our context-maintenance problem
  but remains a Codex client policy, not an OAI server contract.
- Canonical core `TurnItem`s now own more command, dynamic-tool, collaboration,
  sub-agent, hook, review, and extension activity; legacy events are a derived
  compatibility fan-out.

### App/client environment evidence

- System proxy discovery, remote-control pairing, remote plugin catalogs,
  plugin-install policy, hosted MCP authentication, and externally supplied
  Codex auth are real Codex application capabilities. They must not be promoted
  into the backend primitive layer merely because the current client supports
  them.
- The Codex client now persists an authoritative spawned-agent graph used by
  subtree lifecycle operations. This materially improves worker topology and
  status evidence, but does not add constitutional inheritance, authority
  subset proofs, scoped boot packets, or semantic closure reports.
- Thread model and reasoning-effort changes are now explicit settings events,
  retained as thread metadata, and restored on resume unless explicitly
  overridden. This substantially covers thread-local control continuity, while
  leaving nested scope/durability, authority rationale, revision vectors, and
  per-turn ODEU control snapshots to the harness architecture.

Direct rule:

```text
served model/stream/endpoint evidence
  -> candidate provider capability

Codex WorldState/app-server/plugin/environment implementation
  -> implementation witness or adapter candidate

neither
  -> automatic Direct promotion
```

## Release 0.145-0.147 ODEU Baseline Refresh

This is a layered update over the retained release-144 section above. Release
145 supplied the broader app-server/history/environment evidence recorded in
the [release-145 impact audit](./audits/UPSTREAM_CODEX_RELEASE_145_IMPACT_2026-07-22.md).
The bounded release-147 refresh focuses on agent-runtime and exec-server
changes and is not a claim that every provider or application capability was
re-audited.

### Provider/backend evidence

- Child model and reasoning-effort requests remain subject to the served model
  catalog. Codex source validates them against that catalog; source acceptance
  alone is not provider proof that a requested runtime profile was effective.
- Multi-agent usage hints in Codex world state are client/runtime evidence.
  Direct may admit exact provider token usage or an explicit unavailable row,
  but must not manufacture usage from lifecycle activity.
- The host-specific collaboration tool schema may expose stricter choices than
  the Codex source runtime. A hosted root-plus-three cap or a schema coupling
  full-history handoff to inherited model/effort is therefore an environment
  contract, not OAI backend law.

### Codex-core implementation evidence

- V2 collaboration capacity now uses a configured per-session concurrency
  value and subtracts the primary thread before reserving child slots through
  one controller.
- Both release-147 spawn handlers apply requested child model and reasoning
  effort independently of full-history selection. V2 still preserves the
  parent role on a full-history fork in stable 0.147; a post-release commit
  removes that remaining role restriction.
- Spawn configuration is normalized through `ThreadSpawnRequest`; recent-turn
  histories are projected rather than implemented by cloning the full rollout.
- Ready step environments, developer instructions, registry identity,
  parent-turn lineage, direct-input capability, and task names gained explicit
  inheritance or evidence paths.
- Exec-server can dispatch requests concurrently behind an opt-in control. It
  remains an alternative Codex execution protocol, not the authority for
  Direct's native scheduler.

### Current Direct disposition

```text
adopt:
  stable evidence identities, model-catalog validation lessons,
  exact environment inheritance when that Direct slice is promoted

retain independently:
  Direct scheduler, context selection, lifecycle records,
  authority and result-admission boundaries

defer:
  exec-server delegation, follow-up/direct input, recursive spawn,
  durable child restart, role-compiled child constitutions
```

The exact fork comparison and coverage/disposition matrix are in the
[release-147 agent-runtime impact audit](./audits/UPSTREAM_CODEX_RELEASE_147_DIRECT_AGENT_IMPACT_2026-08-09.md).

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
- default service tier
- provider-selected tool mode (`direct | code_mode | code_mode_only`)
- provider-selected multi-agent protocol version
- compaction-compatibility hash
- Responses-lite posture
- skills-usage-instruction posture
- approval/auto-review prompt metadata and optional review-model override

`ReasoningEffort` is no longer a safe closed enum. Known values include:

```text
none, minimal, low, medium, high, xhigh, max, ultra
```

but the wire/model-catalog type also preserves future non-empty custom values.

Direct harness implication:

- Model menu, reasoning menu, speed tier menu, context chip, and tool affordances
  should be projected from model catalog/provider profile evidence.
- `canListModels` and `canSetModel` are different capabilities. A provider may
  accept configured model IDs without serving a full model list.
- Speed is model-specific; it should not be a global fake enum.
- Reasoning effort is model-advertised; Direct should preserve unknown values in
  diagnostics and expose only descriptor-supported choices.
- `ultra` is both a provider request value and, in current Codex, a local trigger
  for proactive multi-agent behavior. Direct must model those as separate
  relations rather than treating the string as self-executing agent authority.

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
- reasoning summary text done
- reasoning content/text delta
- reasoning summary part added
- completed with token usage
- server model metadata
- model verification metadata
- reasoning-included metadata
- model list ETag metadata
- rate-limit snapshot events
- safety-buffering metadata, including an optional retry/faster model
- turn moderation metadata
- failed/incomplete/error events
- completed response `end_turn` evidence when supplied

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

Current item envelopes also preserve optional provider item IDs and internal
turn-ID passthrough metadata across most response/tool variants. `AgentMessage`
content and tool namespaces are explicit where present.

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
- Separate typed provider adapters also exist for image generation/edit and an
  alpha search endpoint. These are not the same execution route as a
  Responses-hosted tool item.

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
- Optional individual/monthly limit evidence.
- Earned reset-credit count and, when served, per-credit ID, type, status,
  grant/expiry time, title, and description.
- Idempotent reset-credit consumption with optional explicit credit selection
  and typed outcomes (`reset`, `nothingToReset`, `noCredit`,
  `alreadyRedeemed`).

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

- `responses/compact` accepts compaction input and returns response items.
- Release 132 remote compaction v2 sends a `compaction_trigger` input item and
  expects exactly one encrypted `compaction` output item. The older
  `context_compaction` response item remains compatibility input/history shape
  and app-server still reduces compaction activity to a `contextCompaction`
  thread item for UI display.
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
- Release 132 runs pre-compact and post-compact hooks around remote compaction
  v2, so app-server/CLI compaction can now be interrupted by hook policy before
  the provider request or after successful compaction. Direct context
  maintenance should keep its own route/manifest/omission authority rather than
  inheriting this as an automatic compact permission.
- By release 144, Codex also persists context-window identity, optional
  replacement history, and full/patch `WorldState` snapshots. Inline and remote
  compaction can carry a new full WorldState baseline into the next window.
  Those mechanisms are stronger Codex-core continuity evidence, but Direct must
  still preserve its own source spans, omission witnesses, authority decision,
  and checkpoint provenance.

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
- Persisted/diffed Codex-core `WorldState` and its built-in sections.
- Thread history mode, context-window IDs, replacement histories, and automatic
  new-window policy.
- Environment-owned capability roots and environment-routed plugin/MCP runtime.
- Ultra-to-proactive-multi-agent policy and collaboration tool exposure.
- Standalone code-mode hosting and extension-owned turn-item rendering.
- System proxy discovery and remote-control relay/pairing.
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
    standaloneEndpoints: CapabilityDescriptor[];
    evidenceRefs: EvidenceRef[];
  };
  quota: {
    canRead: boolean;
    latest?: RateLimitSnapshot;
    resetCredits?: {
      availableCount: number;
      detailsStatus: "available" | "count_only" | "unavailable" | "unknown";
      items?: RateLimitResetCredit[];
      canConsume: boolean;
    };
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

## Field-Level Server Metadata Map

This section decomposes the fields the vanilla Codex/app-server path can serve
today, and the fields the direct harness must eventually adapt into a normalized
provider metadata profile. The point is not to mirror app-server method names as
direct-harness law. The point is to preserve the evidence classes that make the
UX truthful.

Core law:

```text
Provider metadata is runtime evidence.
It is not UI label text, not project config, and not static model folklore.
Missing metadata is unknown/unavailable, not zero, not default, and not support.
```

### Served Metadata Inventory

| Metadata class | Vanilla/app-server source | Upstream/provider source | Key fields | Direct harness use |
| --- | --- | --- | --- | --- |
| Auth/account status | `account/read`, `account/updated` | ChatGPT account/session profile | `authMode`, `planType`, `requiresOpenaiAuth`, account presence | Decide whether direct path can run; show account posture without raw identity leakage. |
| Auth refresh | `account/chatgptAuthTokens/refresh` | ChatGPT auth refresh endpoint | `accessToken`, `chatgptAccountId`, `chatgptPlanType` | Main-process token refresh only; raw token and raw account id never enter renderer state. |
| Model catalog | `model/list` | Codex models endpoint, versioned by client version and cached with ETag | `id`, `model`, `displayName`, `description`, `hidden`, `upgrade`, `availabilityNux`, `isDefault` | Populate model picker from live account-scoped descriptors, not static enums. |
| Reasoning choices | `model/list` model item | Model descriptor / preset | `supportedReasoningEfforts[]`, `defaultReasoningEffort` | Populate intelligence menu per model; no invented `none`/`minimal` unless exposed by the descriptor. |
| Speed/service tiers | `model/list` model item | Model descriptor / preset | `serviceTiers[]`, `defaultServiceTier`, deprecated `additionalSpeedTiers` | Populate speed menu per model; label the actual default tier when exposed. |
| Modalities | `model/list`, provider capability read | Model descriptor / provider capability descriptor | `inputModalities`, `supportsPersonality`, `imageGeneration`, `webSearch`, `namespaceTools` | Gate attachment/image/web/tool affordances; unknown remains disabled/degraded. |
| Model implementation metadata | Codex model profile cache, not all projected through app-server | Model info/preset source | context windows, max context, auto-compact limit, tool mode, truncation policy, verbosity, summary support, parallel tool support | Direct adapter may use these as internal evidence; renderer receives only normalized safe projection. |
| Model reroute/verification | `model/rerouted`, `model/verification`, turn moderation metadata notifications | Runtime turn metadata | `fromModel`, `toModel`, `reason`, verification entries, moderation metadata | Record runtime drift; do not silently rewrite selected model as if it was operator-selected. |
| Active turn settings | turn start / thread settings snapshot | Runtime request/session state | `model`, `modelProviderId`, `serviceTier`, `approvalPolicy`, `approvalsReviewer`, `permissionProfile`, `activePermissionProfile`, `cwd`, `reasoningEffort`, `reasoningSummary`, `personality`, `collaborationMode`; deprecated `multiAgentMode` is no longer proactive-agent authority | Project bottom-band/runtime drawer from actual active turn settings; treat Ultra and collaboration-tool authority separately. |
| Request controls | provider request manifest | Responses/Codex request shape | `model`, `input`, `instructions`, `tools`, `toolChoice`, `parallelToolCalls`, `reasoning`, `serviceTier`, `store`, `stream`, `include`, `promptCacheKey`, text verbosity/format | Direct harness must produce a request manifest and cite which controls were accepted, omitted, or blocked. |
| Stream lifecycle | app-server item lifecycle and provider stream events | SSE/WebSocket response events | response created/completed/failed/incomplete, output item added/done, text deltas, tool-call args deltas, reasoning summary/content | Normalize into local event ontology; unknown event drift becomes evidence and fails closed when semantic. |
| Token usage | `thread/tokenUsage/updated`, turn completed usage | Provider response usage / Codex turn delta | `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, `totalTokens`, `lastTokenUsage` | Separate provider usage from local context estimate; do not infer missing token fields as zero. |
| Context window/pressure | turn started, token usage info, model descriptor | runtime event plus model catalog | `modelContextWindow`, descriptor context window, total tokens in active context | Bottom context chip should display only when model window plus usage evidence exist; estimates must be labeled. |
| Turn timing | `turn/started`, `turn/completed` | Runtime turn lifecycle | `turnId`, `traceId`, `startedAt`, `completedAt`, `durationMs`, `timeToFirstTokenMs`, collaboration mode | Turn status/timer and persisted turn duration witnesses. |
| Rate limits/quota | `account/rateLimits/read`, `account/rateLimits/updated`, `account/rateLimitResetCredit/consume` | account quota/rate-limit/reset-credit endpoints | limit id/name, primary/secondary windows, `usedPercent`, reset time, credits, individual limit, plan/reached type; reset-credit count and optional typed detail rows | Compact quota chip and drawer usage section; reset labels and selectable credit expiry come only from provider evidence; consumption is a separate idempotent account mutation. |
| Account token profile | `account/tokenUsage/read` | account usage profile endpoint | lifetime tokens, peak daily tokens, longest running turn, streaks, daily usage buckets | Analytics/account view only; not a substitute for live quota or per-turn context pressure. |
| Server requests | app-server request lifecycle | runtime/tool harness | approval/user-input/auth-refresh/MCP/dynamic-tool requests, request id, method, lifecycle | Authority evidence. Direct path must keep request id scoped by connection/session and never approve via renderer labels. |
| Tool/item metadata | item lifecycle notifications | provider tool calls plus local tool controller | command execution, file change, MCP tool call, collab tool call, web search, image view, compaction/review items | Render process evidence and usage ledger rows; direct action authority remains local harness-owned. |
| Collaboration/sub-agents | collab tool items and thread metadata | local Codex collaboration controller | agent nickname/role when available, sender/receiver thread ids, prompt preview, wait/close/send status | Build agent graph and right-plane worker tabs; child messages must not flatten into `You`/primary assistant. |
| Environment/capability placement | `environment/info`, thread/turn `environments`, `selectedCapabilityRoots` | Codex execution topology, not an OAI primitive | environment id, shell, native cwd URI, sticky/turn override, environment-owned plugin/skill roots | Preserve environment as active-world evidence; tool location never grants action authority. |
| World state/context windows | rollout `world_state`, session history mode/context-window metadata | Codex-core context implementation, not an OAI primitive | full/patch state, section ids, window identity/lineage, replacement history, persisted baseline | Useful vanilla adapter and fork-comparison evidence; Direct keeps its own explicit ODEU lanes, context manifests, and omission law. |
| Paginated canonical history | `thread/turns/list`, `thread/items/list`, persisted canonical `TurnItem`s | local rollout/thread store | turn/item cursor, item/turn ids, canonical command/tool/collab/sub-agent/hook/review/extension items | Prefer canonical items over legacy event reconstruction when available; preserve compatibility provenance. |
| Cache/session continuity | request manifest, provider response metadata | provider/cache/session fields | prompt cache key, response id, trace id, upstream request id, ETag/client version for model catalog | Continuity evidence and dedupe keys; never equate local thread id with provider response id. |
| Maintenance/compaction | compaction items/endpoints where exposed | provider or local harness maintenance | compaction request/result, summary policy, context-loss witness | Direct path must distinguish provider compaction from local baton/summary artifacts. |

### Normalized Direct Provider Metadata Profile

The direct harness should expose a renderer-safe profile shaped around the
evidence classes above:

```ts
type DirectProviderMetadataProfile = {
  schema: "direct_provider_metadata_profile@1";
  providerKind: "direct_oai";
  profileId: string;
  account: {
    status: "authenticated" | "login_required" | "unavailable" | "failed" | "unknown";
    authMode?: "chatgpt" | "api_key" | "none" | "unknown";
    planType?: string;
    accountEvidenceKey?: string;
    evidenceRefs: EvidenceRef[];
  };
  modelCatalog: {
    status: RuntimeStateStatus;
    source: "server_model_list" | "cache" | "static_fallback" | "unknown";
    etag?: string;
    clientVersion?: string;
    items: Array<{
      id: string;
      model: string;
      displayName?: string;
      description?: string;
      hidden?: boolean;
      isDefault?: boolean;
      supportedReasoningEfforts: ReasoningEffortOption[];
      defaultReasoningEffort?: string;
      serviceTiers: ModelServiceTier[];
      defaultServiceTier?: string;
      inputModalities?: string[];
      contextWindow?: number;
      maxContextWindow?: number;
      evidenceRefs: EvidenceRef[];
    }>;
    evidenceRefs: EvidenceRef[];
  };
  runtimeSettings: {
    active?: {
      model?: string;
      reasoningEffort?: string;
      serviceTier?: string;
      approvalPolicy?: string;
      permissionProfile?: string;
    };
    requestControls: Array<{
      name: string;
      status: "accepted" | "omitted" | "blocked" | "unknown";
      evidenceRefs: EvidenceRef[];
    }>;
  };
  usage: {
    tokenUsage?: TokenUsage;
    context?: {
      status: "available" | "estimated" | "unavailable" | "unknown";
      usedTokens?: number;
      modelContextWindow?: number;
      usedPercent?: number;
      evidenceRefs: EvidenceRef[];
    };
    quota?: {
      status: "available" | "stale" | "unavailable" | "unknown";
      windows: RateLimitSnapshot[];
      evidenceRefs: EvidenceRef[];
    };
    accountTokenProfile?: {
      status: "available" | "unavailable" | "unknown";
      lifetimeTokens?: number;
      dailyBuckets?: Array<{ startDate: string; tokens: number }>;
      evidenceRefs: EvidenceRef[];
    };
  };
  capabilities: {
    provider: {
      namespaceTools?: boolean;
      imageGeneration?: boolean;
      webSearch?: boolean;
    };
    tools: ToolCapabilityDescriptor[];
    maintenance: CapabilityDescriptor[];
  };
  transport: {
    streamKind: "sse" | "websocket" | "unknown";
    connectionEvidenceKey?: string;
    servedMethods: string[];
    evidenceRefs: EvidenceRef[];
  };
  updatedAt: string;
};
```

### Field Use Rules

- Model picker entries come only from `modelCatalog.items`. Static labels may
  appear only as degraded diagnostics.
- Reasoning and speed menus are per-model projections. They must not use one
  global enum across all models.
- `Runtime default` in the composer means "clear this next-turn override"; it
  should point to the actual default model/effort/tier only when the descriptor
  exposes it.
- Account token profile is analytics evidence, not quota evidence.
- Quota reset labels are formatted only from provider-served reset timestamps.
- Context pressure requires both token usage and a model context window. If one
  side is missing, render unknown or estimated with source labels.
- Raw access tokens, raw account ids, emails, request payloads, tool payloads,
  and provider responses remain main-process/private evidence unless a later
  contract explicitly permits a sanitized projection.
- Direct-path UI parity with vanilla app-server means exposing the same evidence
  classes, not cloning app-server method names.

### Current Direct Gap

The direct branch already has partial concept coverage in the matrix and bridge
registry, but the field-level adapter is incomplete:

- Model persistence can remember the chosen model/reasoning effort, but the
  model picker is still not backed by a live server catalog.
- Speed/service tier projection is incomplete; only a default placeholder is
  visible when direct metadata is missing.
- Bottom-band quota is unknown because direct quota/rate-limit snapshots are not
  yet read from the account endpoint.
- Bottom-band context is estimated/unknown because direct token usage and model
  context-window evidence are not yet fused into a context-pressure witness.
- Account token usage is known in some cases, but it must remain separate from
  quota and context pressure.

Next implementation artifact:

```text
DirectServerMetadataAdapter
  -> auth/account read
  -> model catalog read/cache
  -> rate-limit read/update
  -> account token profile read
  -> turn token/context/timing witness
  -> DirectProviderMetadataProfile
  -> RuntimeSettingsProjection + bottom-band witnesses
```

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
- Confirm reasoning effort remains open-string/model-advertised rather than
  freezing the current known values.
- Re-check response request fields.
- Re-check SSE/WebSocket event names and payloads.
- Re-check standalone image/search endpoint shapes separately from hosted tool
  items.
- Re-check rate-limit snapshot fields and header/event names.
- Re-check reset-credit detail and idempotent consumption shapes.
- Re-check account plan/account types.
- Re-check tool-call item types and tool-output input variants.
- Re-check compaction and memory endpoint shapes.
- Re-check Codex-core WorldState, history-window, environment, and canonical
  TurnItem implementation without promoting them to server law.
- Confirm direct provider profile still separates quota from context.
- Confirm UI controls still fail closed when evidence is absent.
- Confirm CLI compatibility adapters are not leaking into direct-provider
  authority decisions.
