import json
from datetime import datetime, timezone

observed_at = "2026-04-25T22:45:00Z"

def ev(sourceId, grade, summary, locator=""):
    out = {"sourceId": sourceId, "grade": grade, "summary": summary}
    if locator:
        out["locator"] = locator
    return out

def cap(id, name, status, layer, summary, evidence, notes=None):
    o = {"id": id, "name": name, "status": status, "authorityLayer": layer, "summary": summary, "evidence": evidence}
    if notes:
        o["notes"] = notes
    return o

def field(id, name, status, layer, shape, summary, evidence, notes=None):
    o = {"id": id, "field": name, "status": status, "authorityLayer": layer, "shape": shape, "summary": summary, "evidence": evidence}
    if notes:
        o["notes"] = notes
    return o

def metric(id, name, status, unit, summary, evidence):
    return {"id": id, "metric": name, "status": status, "unit": unit, "summary": summary, "evidence": evidence}

def model(id, display, status, availability, reasoning, tools, images, evidence, efforts=None, notes=None):
    return {
        "id": id,
        "displayName": display,
        "status": status,
        "availability": availability,
        "contextWindow": None,
        "supportsReasoning": reasoning,
        "supportedReasoningEfforts": efforts or [],
        "supportsTools": tools,
        "supportsImages": images,
        "notes": notes or [],
        "evidence": evidence,
    }

profile = {
    "schema": "direct_codex_odeu_profile@1",
    "profileId": "chatgpt_codex_subscription_oai_server_baseline_2026_04_25",
    "profileVersion": 1,
    "backendContractVersion": "imported-baseline.openai-docs-and-local-specs.2026-04-25",
    "observedAt": observed_at,
    "source": "imported-baseline",
    "subject": {
        "name": "ChatGPT subscription Codex backend path",
        "provider": "OpenAI / ChatGPT Codex",
        "compatibilityTier": "native",
        "description": "Profile of the currently documented and specimen-observed OpenAI server-side allowances for Codex usage through ChatGPT subscription authentication. This is not an OpenAI Platform API profile and not a live-probed credentialed extraction."
    },
    "scope": {
        "inScope": [
            "ChatGPT sign-in path for Codex subscription access.",
            "Observed/direct Codex Responses-style backend path at chatgpt.com/backend-api/codex/responses.",
            "Official Codex app-server capabilities relevant to client harnesses, distinguished from raw OAI backend authority.",
            "Model, input, response-event, reasoning, tool-call, continuation, quota, retry, and security allowances that can gate a future direct harness."
        ],
        "outOfScope": [
            "Consumer ChatGPT web-thread API automation.",
            "OpenAI Platform API entitlement or billing profile.",
            "Public production API promise for chatgpt.com/backend-api/codex/responses.",
            "Any live OAuth exchange or live model call.",
            "Deep ADEU-native fork internals as default standalone-shell UX."
        ],
        "authorityLayerNotes": [
            "OAI server-side allowances include model inference, Responses-style stream events, auth/quota classification, and hosted backend limits.",
            "Codex app-server allowances are official client-harness protocol surfaces but are partly local harness/server functions rather than direct cloud endpoint powers.",
            "Workspace reads, shell commands, patch application, and local tool execution remain local harness or workspace-backend authority, not an OAI server permission."
        ]
    },
    "ontology": {
        "transports": [
            cap("transport.sse.responses", "SSE over HTTP POST Responses-style stream", "observed", "chatgpt-subscription-backend", "The direct subscription path is specified as SSE over fetch for phase 1 and the public Codex article says ChatGPT login uses the Codex Responses endpoint.", [ev("direct-path-spec", "local-spec", "Direct spec requires phase-1 SSE and isolates raw stream events below a normalizer."), ev("openai-unrolling-codex", "official-engineering-note", "OpenAI says ChatGPT login uses chatgpt.com/backend-api/codex/responses for Codex CLI inference.")], ["Accept for probes and fixture normalizers; require live probe before default direct-harness exposure."]),
            cap("transport.websocket.responses", "Responses WebSocket parity", "unstable", "chatgpt-subscription-backend", "WebSocket may exist or be used by Codex, but direct profile treats it as a later parity target after SSE baseline.", [ev("direct-path-spec", "local-spec", "WebSocket is phase 2 only if it materially improves latency or continuity."), ev("codex-app-server-docs", "official-doc", "App-server WebSocket transport is experimental and unsupported for the local JSON-RPC protocol.")], ["Do not make this the first direct-harness default."]),
            cap("transport.app_server_stdio", "Codex app-server stdio JSONL", "accepted", "codex-app-server", "Official app-server supports stdio JSONL as the default JSON-RPC transport for rich clients.", [ev("codex-app-server-docs", "official-doc", "Supported transports include stdio as default JSONL.")]),
            cap("transport.app_server_websocket", "Codex app-server WebSocket JSON-RPC", "unstable", "codex-app-server", "Official app-server supports WebSocket frames but marks the transport experimental and unsupported.", [ev("codex-app-server-docs", "official-doc", "WebSocket transport is experimental/unsupported and should use auth if non-loopback.")])
        ],
        "authSurfaces": [
            cap("auth.chatgpt_managed", "ChatGPT managed sign-in", "accepted", "oai-server", "Codex supports signing in with ChatGPT for subscription access; CLI and IDE extension cache and refresh credentials.", [ev("codex-auth-docs", "official-doc", "Codex supports ChatGPT sign-in for subscription access and refreshes tokens automatically during use.")]),
            cap("auth.chatgpt_device_code", "ChatGPT device-code sign-in", "accepted", "oai-server", "Headless/remote ChatGPT sign-in can use a device-code flow when enabled.", [ev("codex-auth-docs", "official-doc", "Device-code login is documented for headless situations.")]),
            cap("auth.chatgpt_external_tokens", "Externally managed ChatGPT tokens", "unstable", "codex-app-server", "App-server has an experimental external token mode where host apps supply ChatGPT tokens and answer refresh requests.", [ev("codex-app-server-docs", "official-doc", "chatgptAuthTokens mode is experimental and refresh requests time out after about 10 seconds.")], ["A direct harness must not fabricate tokens; renderer must never receive raw tokens."]),
            cap("auth.api_key", "OpenAI Platform API key", "rejected", "oai-server", "API-key mode is documented for CLI/SDK/IDE, but this ODEU profile is specifically for ChatGPT subscription access, not Platform API access.", [ev("codex-auth-docs", "official-doc", "Codex supports API keys separately; API key usage follows Platform settings."), ev("direct-path-spec", "local-spec", "Direct path is not an OpenAI Platform API integration.")])
        ],
        "models": [
            model("gpt-5.5", "GPT-5.5", "observed", "Listed in current Codex pricing/docs for Plus/Pro/Business local messages; actual user availability must be discovered with model/list or live direct probe.", True, True, None, [ev("codex-pricing-docs", "official-doc", "Plus includes latest models including GPT-5.5; limits table lists GPT-5.5 local messages."), ev("codex-changelog", "official-doc", "GPT-5.5 is recommended for most Codex tasks when present in the picker.")], ["low", "medium", "high", "xhigh"], ["Per-model modalities and reasoning efforts must be treated as account/catalog-discovered, not hardcoded."]),
            model("gpt-5.4", "GPT-5.4", "observed", "Listed for Plus/Pro/Business local messages and documented as available in Codex app/CLI/IDE/cloud.", True, True, True, [ev("codex-pricing-docs", "official-doc", "Codex Plus includes GPT-5.4."), ev("codex-changelog", "official-doc", "GPT-5.4 is available everywhere Codex can be used; docs also mention 1M context experimental support.")], ["low", "medium", "high", "xhigh"], ["Context window remains profile-unknown until model/list or live request exposes it for the account."]),
            model("gpt-5.4-mini", "GPT-5.4-mini", "observed", "Listed as higher-usage model for routine local messages.", True, True, None, [ev("codex-pricing-docs", "official-doc", "Plus includes GPT-5.4-mini for higher usage limits on routine local messages.")], ["low", "medium", "high"], ["Exact direct endpoint id and modalities must be probed."]),
            model("gpt-5.3-codex", "GPT-5.3-Codex", "observed", "Listed for local messages, cloud tasks, and code reviews; cloud tasks and code review run on GPT-5.3-Codex.", True, True, None, [ev("codex-pricing-docs", "official-doc", "Pricing table lists GPT-5.3-Codex for local/cloud/code-review buckets and says cloud tasks/code review run on it.")], ["low", "medium", "high", "xhigh"], ["Direct harness should verify exact backend model id string before normal UX exposure."]),
            model("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark", "unstable", "Research preview for ChatGPT Pro users only; not available in API at launch.", True, True, False, [ev("codex-pricing-docs", "official-doc", "Spark is Pro-only research preview and not available in the API at launch.")], ["low", "medium"], ["Treat as plan-gated and preview-only; expose only when model/list/live probe reports it."])
        ],
        "requestFields": [
            field("request.endpoint", "POST /backend-api/codex/responses", "observed", "chatgpt-subscription-backend", "HTTPS endpoint under https://chatgpt.com/backend-api", "Observed/direct path for ChatGPT subscription Codex inference; not a stable public Platform API contract.", [ev("openai-unrolling-codex", "official-engineering-note", "OpenAI states Codex CLI uses chatgpt.com/backend-api/codex/responses with ChatGPT login."), ev("direct-path-spec", "local-spec", "Direct path records backend base URL and response endpoint and warns it is not stable public Platform API.")]),
            field("request.model", "model", "observed", "chatgpt-subscription-backend", "string", "Request selects a model id; available ids are account/catalog dependent.", [ev("responses-api-docs", "official-doc", "Responses create requires/selects a model."), ev("codex-app-server-docs", "official-doc", "model/list exposes available models and capabilities.")]),
            field("request.stream", "stream", "observed", "chatgpt-subscription-backend", "boolean true", "Direct harness phase 1 uses streaming responses.", [ev("direct-path-spec", "local-spec", "Request construction requires stream: true."), ev("responses-api-docs", "official-doc", "Responses API supports streaming SSE event frames.")]),
            field("request.store", "store", "observed", "chatgpt-subscription-backend", "boolean false", "Codex direct profile should use stateless storage posture unless a later ODEU policy admits a different state model.", [ev("direct-path-spec", "local-spec", "Request construction requires store: false."), ev("openai-unrolling-codex", "official-engineering-note", "Codex avoids previous_response_id to support stateless/ZDR-compatible behavior.")]),
            field("request.instructions", "instructions", "observed", "chatgpt-subscription-backend", "string", "System/developer instruction field used by Responses-style endpoint.", [ev("responses-api-docs", "official-doc", "Responses API includes instructions."), ev("direct-path-spec", "local-spec", "Request construction requires instructions.")]),
            field("request.input", "input", "observed", "chatgpt-subscription-backend", "array of Responses input items", "Inputs carry user/developer/assistant/system role items and content parts.", [ev("responses-api-docs", "official-doc", "Responses API input accepts role-bearing messages with text/image/file content."), ev("openai-unrolling-codex", "official-engineering-note", "Codex builds a role-ordered list of prompt items.")]),
            field("request.tools", "tools", "observed", "chatgpt-subscription-backend", "array of tool definitions", "Server may select tools from those offered by the harness; harness remains execution authority for custom/local tools.", [ev("responses-api-docs", "official-doc", "Responses supports built-in tools, MCP tools, and function/custom tools."), ev("direct-path-spec", "local-spec", "Adapter emits normalized tool_call and must not execute tools directly.")]),
            field("request.tool_choice", "tool_choice", "observed", "chatgpt-subscription-backend", "auto | none | required | allowed_tools | forced tool", "Default direct Codex posture uses auto when tools are present.", [ev("responses-api-docs", "official-doc", "tool_choice controls whether/how tools are selected."), ev("direct-path-spec", "local-spec", "Request construction sets tool_choice: auto when tools are present.")]),
            field("request.parallel_tool_calls", "parallel_tool_calls", "observed", "chatgpt-subscription-backend", "boolean", "Parallel tool calls can be requested unless harness explicitly serializes.", [ev("direct-path-spec", "local-spec", "Request construction requires parallel_tool_calls: true unless serializing."), ev("responses-api-docs", "official-doc", "Response examples include parallel_tool_calls true.")]),
            field("request.reasoning", "reasoning", "observed", "chatgpt-subscription-backend", "{effort?, summary?/generate_summary?}", "Reasoning effort/summary controls are model-specific and must be gated by profile/model discovery.", [ev("responses-api-docs", "official-doc", "Reasoning configuration supports effort values including none/minimal/low/medium/high/xhigh with model caveats."), ev("direct-path-spec", "local-spec", "Reasoning is included when selected by user/profile policy.")]),
            field("request.text.verbosity", "text.verbosity", "observed", "chatgpt-subscription-backend", "low | medium | high", "Text verbosity can constrain response length; direct implementation turns should default low per spec.", [ev("responses-api-docs", "official-doc", "Verbosity values are low, medium, high."), ev("direct-path-spec", "local-spec", "text.verbosity defaults to low for implementation turns.")]),
            field("request.prompt_cache_key", "prompt_cache_key", "observed", "chatgpt-subscription-backend", "stable string", "Session-affinity/cache key for prefix reuse and abuse detection bucketing.", [ev("responses-api-docs", "official-doc", "prompt_cache_key replaces user for caching optimizations."), ev("direct-path-spec", "local-spec", "prompt_cache_key comes from local session id.")]),
            field("request.include.reasoning_encrypted_content", "include[] = reasoning.encrypted_content", "observed", "chatgpt-subscription-backend", "include array entry", "Allows encrypted reasoning continuity in stateless/ZDR-compatible multi-turn loops.", [ev("responses-api-docs", "official-doc", "reasoning.encrypted_content includes encrypted reasoning for stateless/ZDR multi-turn use."), ev("direct-path-spec", "local-spec", "include entries required to preserve reasoning/caching continuity.")])
        ],
        "inputItems": [
            field("input.message.roles", "message.role", "accepted", "oai-server", "system | developer | user | assistant", "Responses-style input messages carry role hierarchy; Codex uses developer/user environment and instruction items before the user prompt.", [ev("responses-api-docs", "official-doc", "Input message roles include user, assistant, system, developer."), ev("openai-unrolling-codex", "official-engineering-note", "Codex constructs role-ordered prompt items and environment context.")]),
            field("input.text", "input_text", "accepted", "oai-server", "{type:'input_text', text:string}", "Text input is a normal supported input content type.", [ev("responses-api-docs", "official-doc", "Responses API supports text input.")]),
            field("input.image", "input_image", "observed", "oai-server", "{type:'input_image', detail, file_id|image_url}", "Image input is supported by Responses API and model/list can report input modalities; exact Codex model support is catalog-dependent.", [ev("responses-api-docs", "official-doc", "Responses API supports image input with detail low/high/auto."), ev("codex-app-server-docs", "official-doc", "model/list exposes inputModalities such as text and image.")]),
            field("input.file", "input_file", "observed", "oai-server", "{type:'input_file', file_id|file_data|file_url, filename?}", "File inputs exist in Responses API, but direct Codex subscription file-input behavior requires probe before normal UX.", [ev("responses-api-docs", "official-doc", "Responses API supports file inputs."), ev("direct-extraction-spec", "local-spec", "Fixture/probe suite must include import and input shape evidence before exposure.")])
        ],
        "responseEventTypes": [
            field("event.response.created", "response.created", "accepted", "oai-server", "SSE event with response status in_progress", "Streaming responses begin with creation/in-progress events.", [ev("responses-api-docs", "official-doc", "Streaming example includes response.created and response.in_progress.")]),
            field("event.output_text_delta", "response.output_text.delta", "accepted", "oai-server", "delta text event", "Text deltas stream incrementally.", [ev("responses-api-docs", "official-doc", "Streaming example includes response.output_text.delta and done.")]),
            field("event.output_item", "response.output_item.added/done", "accepted", "oai-server", "output item lifecycle events", "Output items are added and finalized through SSE events.", [ev("responses-api-docs", "official-doc", "Streaming example includes response.output_item.added/done.")]),
            field("event.response.completed", "response.completed", "accepted", "oai-server", "terminal success event", "Completion event carries final response and usage.", [ev("responses-api-docs", "official-doc", "Streaming example includes response.completed with usage.")]),
            field("event.function_call", "function_call output item", "accepted", "oai-server", "{type:'function_call', call_id, name, arguments, status}", "Tool/function calls can be emitted as response output items.", [ev("responses-api-docs", "official-doc", "Function-call example returns function_call item with call_id/name/arguments.")]),
            field("event.normalized", "normalized direct harness events", "accepted", "local-harness", "session_started | message_delta | reasoning_delta | tool_call_* | usage_delta | response_completed | response_failed | quota_error | aborted", "ADEU code must consume normalized events, not raw backend event names.", [ev("direct-extraction-spec", "local-spec", "Minimum normalized event classes are specified."), ev("direct-path-spec", "local-spec", "No ADEU/ODEU harness code should depend on raw backend event shapes.")])
        ],
        "reasoningShapes": [
            field("reasoning.effort", "reasoning.effort", "observed", "oai-server", "none | minimal | low | medium | high | xhigh", "Reasoning effort can be constrained, but supported values are model-specific and must be discovered.", [ev("responses-api-docs", "official-doc", "Reasoning effort values and model caveats are documented.")]),
            field("reasoning.summary", "reasoning.summary / generate_summary", "observed", "oai-server", "auto | concise | detailed | off? depending on endpoint/schema", "Visible reasoning summaries are possible but exact direct endpoint knobs need probe and schema pinning.", [ev("direct-path-spec", "local-spec", "Internal contract allows summary auto/concise/detailed/off."), ev("responses-api-docs", "official-doc", "Response schema includes reasoning summary/generate_summary fields.")]),
            field("reasoning.encrypted_content", "reasoning.encrypted_content", "accepted", "oai-server", "opaque encrypted content included on request/response items", "Server can use encrypted reasoning content for stateless/ZDR-compatible continuation; harness must treat it opaque.", [ev("responses-api-docs", "official-doc", "encrypted_content enables reasoning items in stateless/ZDR multi-turn conversations."), ev("openai-unrolling-codex", "official-engineering-note", "Codex uses encrypted content and stateless requests for ZDR-compatible continuity.")]),
            field("reasoning.raw_text", "raw reasoning text", "unstable", "codex-app-server", "item/reasoning/textDelta when supported by model", "App-server can stream raw reasoning text when supported, but a direct harness should not assume raw chain-of-thought visibility.", [ev("codex-app-server-docs", "official-doc", "App-server item deltas include raw reasoning text when supported by the model.")])
        ],
        "toolCallShapes": [
            field("tool.function", "function/custom tool call", "accepted", "oai-server", "JSON-schema defined function with call_id/name/arguments", "Model can request custom function calls; harness must validate and decide authority before executing.", [ev("responses-api-docs", "official-doc", "Responses supports function tools and function_call output items."), ev("direct-path-spec", "local-spec", "Adapter emits tool_call and authority router decides execution.")]),
            field("tool.mcp", "MCP tool", "observed", "oai-server", "MCP server tool definitions and tool choice", "Responses supports MCP tools, and app-server surfaces MCP status/calls; direct harness needs project authority and approval policy.", [ev("responses-api-docs", "official-doc", "Responses supports MCP tools."), ev("codex-app-server-docs", "official-doc", "App-server lists/calls MCP server tools and handles OAuth/startup status.")]),
            field("tool.builtin", "hosted built-in tools", "unstable", "oai-server", "file_search | web_search_preview | computer_use_preview | code_interpreter | image_generation", "Responses API has hosted built-ins, but the direct ChatGPT/Codex subscription path should expose them only after probe and policy admission.", [ev("responses-api-docs", "official-doc", "Responses API supports hosted built-in tool categories."), ev("direct-path-spec", "local-spec", "Direct path is Codex lineage first, not broad provider/platform API feature absorption.")]),
            field("tool.shell_apply_patch", "Codex shell/apply_patch tools", "accepted", "local-harness", "client-supplied tools backed by local workspace/sandbox", "Shell and patch execution are client/harness powers; OAI server only requests tool calls through the model output.", [ev("openai-unrolling-codex", "official-engineering-note", "Codex tool definitions include the default shell tool and built-in plan tool in the request."), ev("direct-path-spec", "local-spec", "Tool calls must flow through the authority router; model request is not authority to mutate the workspace.")]),
            field("tool.dynamic", "dynamic tools", "unstable", "codex-app-server", "dynamicTools on thread/start and item/tool/call request", "App-server dynamic tools are experimental; default direct harness should decline or gate until tested.", [ev("codex-app-server-docs", "official-doc", "dynamicTools and item/tool/call are experimental APIs.")])
        ],
        "continuationShapes": [
            field("continuation.stateless_full_input", "full input replay", "accepted", "local-harness", "Full conversation/evidence state resent per turn", "Codex avoids previous_response_id and instead manages context locally for stateless/ZDR-compatible turns.", [ev("openai-unrolling-codex", "official-engineering-note", "Codex does not use previous_response_id today and keeps requests stateless."), ev("direct-path-spec", "local-spec", "Self-owned harness must replace Codex CLI session semantics.")]),
            field("continuation.tool_result", "tool-call result continuation", "observed", "chatgpt-subscription-backend", "subsequent model request includes tool results paired to call ids", "Tool-result continuation is required for the direct tool loop; fixture/live probe still required before acceptance.", [ev("direct-path-spec", "local-spec", "Probe suite includes tool-call request shape and tool-result continuation."), ev("responses-api-docs", "official-doc", "Responses supports function calling with call ids and subsequent tool outputs.")]),
            field("continuation.compaction", "compaction checkpoint", "observed", "oai-server", "compaction endpoint/items with encrypted content", "Codex uses compaction to manage context; ADEU direct compaction must preserve ODEU commitments, not just trim tokens.", [ev("openai-unrolling-codex", "official-engineering-note", "Codex uses /responses/compact and compaction items with opaque encrypted_content."), ev("direct-path-spec", "local-spec", "Compaction is an ADEU state transition preserving commitments and evidence.")]),
            field("continuation.prompt_cache", "prompt cache/session affinity", "accepted", "oai-server", "prompt_cache_key and prompt_cache_retention", "Cache keys improve prefix reuse and must remain stable for static prefix sections.", [ev("responses-api-docs", "official-doc", "prompt_cache_key and prompt_cache_retention are documented fields."), ev("openai-unrolling-codex", "official-engineering-note", "Codex performance relies on prompt caching and stable prefixes.")])
        ],
        "serverManagedSurfaces": [
            cap("server.auth_quota", "Auth and quota classification", "accepted", "oai-server", "ChatGPT auth mode determines workspace permissions/policies and Codex rate limits/credits; app-server can expose account/rateLimit views.", [ev("codex-auth-docs", "official-doc", "ChatGPT sign-in usage follows ChatGPT workspace permissions, RBAC, retention, and residency."), ev("codex-app-server-docs", "official-doc", "App-server account/rateLimits/read returns usage bucket state and updated notifications.")]),
            cap("server.model_inference", "Model inference", "observed", "chatgpt-subscription-backend", "Backend performs GPT/Codex Responses-style inference with streaming outputs.", [ev("openai-unrolling-codex", "official-engineering-note", "Codex CLI sends HTTP requests to Responses API-compatible endpoint for inference."), ev("responses-api-docs", "official-doc", "Responses endpoint creates model responses with streaming and tools.")]),
            cap("server.hosted_tools", "Hosted tool execution", "unstable", "oai-server", "Responses API supports hosted tools, but the direct ChatGPT/Codex subscription endpoint must be probed before exposing hosted tools as normal controls.", [ev("responses-api-docs", "official-doc", "Built-in tools include web search, file search, computer use, code interpreter, and image generation."), ev("direct-extraction-spec", "local-spec", "Only accepted capabilities become normal user-facing controls.")])
        ],
        "appServerClientSurfaces": [
            cap("appserver.schema_generation", "Version-pinned app-server schemas", "accepted", "codex-app-server", "Codex app-server can generate TypeScript and JSON Schema specific to the running Codex version.", [ev("codex-app-server-docs", "official-doc", "codex app-server generate-ts/generate-json-schema outputs version-specific schemas.")]),
            cap("appserver.thread_lifecycle", "Thread lifecycle and history", "accepted", "codex-app-server", "App-server supports thread start/resume/fork/read/list/archive/unarchive/status/turn listing.", [ev("codex-app-server-docs", "official-doc", "Thread API overview documents start/resume/fork/read/list/archive/etc.")]),
            cap("appserver.turn_stream", "Turn and item event stream", "accepted", "codex-app-server", "App-server streams turn lifecycle, item lifecycle, text/reasoning/plan/diff/tool/command events.", [ev("codex-app-server-docs", "official-doc", "Events include turn/*, item/*, serverRequest/resolved and tagged ThreadItem variants.")]),
            cap("appserver.approvals", "Server-initiated approval requests", "accepted", "codex-app-server", "App-server issues requests for command execution, file changes, network access, tool user input, MCP approvals, dynamic tools, and token refresh depending on mode.", [ev("codex-app-server-docs", "official-doc", "Approval and serverRequest flows are documented with method names and serverRequest/resolved cleanup."), ev("app-server-controller-spec", "local-spec", "Controller spec requires every server-initiated request to receive a valid response or explicit decline/cancel.")]),
            cap("appserver.fs", "Filesystem v2 API", "accepted", "codex-app-server", "App-server v2 filesystem methods operate on absolute paths and support watch/unwatch/change notifications.", [ev("codex-app-server-docs", "official-doc", "fs/readFile, writeFile, metadata, directory, remove, copy, watch/unwatch/changed are documented.")]),
            cap("appserver.config_plugins_skills", "Config, skills, plugins, apps, MCP management", "accepted", "codex-app-server", "App-server exposes skills, plugin, marketplace, app, MCP server, config, requirements, feedback, external-agent import surfaces.", [ev("codex-app-server-docs", "official-doc", "API overview lists skills, plugins, apps, MCP, config, requirements, externalAgentConfig methods.")])
        ],
        "importSourceShapes": [
            field("import.codex_jsonl", "Codex CLI/app-server JSONL", "accepted", "local-harness", "source identity, thread id, session file path, timestamps, roles, reasoning, tool calls/results, approvals, file changes, errors, compaction", "Initial import target for ODEU translation into ADEU session candidates.", [ev("direct-extraction-spec", "local-spec", "Import target is Codex CLI/app-server JSONL to normalized evidence graph."), ev("direct-path-spec", "local-spec", "Import requirements preserve roles, final messages, reasoning summaries, tool calls/results, approvals, failures, timestamps, source path.")]),
            field("import.chatgpt_web_export", "ChatGPT web thread export/copy", "unstable", "renderer", "copied transcript/export with weak event boundaries", "Later only; evidence boundaries are too weak for direct runnable session import.", [ev("direct-path-spec", "local-spec", "ChatGPT web thread exports or copied transcript bundles are later and only if evidence boundaries are clear.")])
        ]
    },
    "deontics": {
        "authRequirements": [
            field("auth.req.chatgpt_subscription", "ChatGPT sign-in for subscription access", "accepted", "oai-server", "browser login, device code, or managed token mode", "Subscription path requires ChatGPT auth, not a Platform API key.", [ev("codex-auth-docs", "official-doc", "Sign in with ChatGPT gives subscription access; API keys are separate usage-based path.")]),
            field("auth.req.workspace_policy", "ChatGPT workspace policy binding", "accepted", "oai-server", "workspace permissions/RBAC/retention/residency apply", "Server-side access follows ChatGPT workspace and plan governance.", [ev("codex-auth-docs", "official-doc", "With ChatGPT login, Codex usage follows workspace permissions, RBAC, Enterprise retention and residency.")]),
            field("auth.req.direct_oauth", "Direct OAuth lifecycle", "observed", "local-harness", "PKCE/browser/manual callback + token refresh", "Direct harness must own OAuth and token refresh if bypassing Codex CLI; first profile slice should not do live auth yet.", [ev("direct-path-spec", "local-spec", "Direct harness should own OAuth login and token refresh."), ev("direct-extraction-spec", "local-spec", "First slice should not perform live OAuth or live model calls.")])
        ],
        "tokenStorageRules": [
            "Store OAuth credentials outside project config.",
            "Never expose access or refresh tokens to renderer IPC/DOM/logs.",
            "Use user-only file permissions or OS keyring where available.",
            "Refresh access tokens under a process-level lock and preserve refresh token across transient failures.",
            "Redact bearer tokens, refresh tokens, authorization codes, cookies, and account ids from fixtures unless replaced by placeholders."
        ],
        "workspaceAuthorityRules": [
            "A model tool call is only a request, not authority to mutate the workspace.",
            "Local shell, file write, patch, and command execution must route through the workspace authority layer.",
            "Destructive or network-affecting actions require explicit user approval unless a proven local policy gate admits them.",
            "Imported tool calls are evidence only and must never be auto-replayed.",
            "WSL/local workspace truth remains outside the OAI backend and must be mediated by the host/backend workspace bridge."
        ],
        "approvalRequiredFor": [
            field("approval.command", "command execution", "accepted", "codex-app-server", "item/commandExecution/requestApproval with availableDecisions", "Command/network/sandbox permission approval must roundtrip through user authority.", [ev("codex-app-server-docs", "official-doc", "Command approval request flow includes itemId/threadId/turnId, optional reason/command/cwd/network/additionalPermissions/availableDecisions.")]),
            field("approval.file_change", "file change", "accepted", "codex-app-server", "item/fileChange/requestApproval", "Proposed edits must be visible and user-approved/declined/canceled before applying.", [ev("codex-app-server-docs", "official-doc", "File change request flow includes proposed fileChange item and approval request.")]),
            field("approval.network", "managed network access", "accepted", "codex-app-server", "networkApprovalContext host/protocol/port", "Network approvals are destination-specific and must not be rendered as generic shell approvals.", [ev("codex-app-server-docs", "official-doc", "networkApprovalContext indicates managed network access and prompts can group by destination.")]),
            field("approval.mcp_side_effect", "MCP side-effect tool approval", "accepted", "codex-app-server", "tool/requestUserInput with Accept/Decline/Cancel options", "Side-effect/destructive app connector calls can require approval and complete with error if declined/canceled.", [ev("codex-app-server-docs", "official-doc", "MCP tool-call approvals use tool/requestUserInput and destructive annotations trigger approval.")]),
            field("approval.dynamic_tool", "dynamic tool execution", "unstable", "codex-app-server", "item/tool/call server request", "Dynamic tools are experimental and should be declined/gated until implemented with a trust model.", [ev("codex-app-server-docs", "official-doc", "Dynamic tool calls are experimental.")])
        ],
        "blockedBehaviors": [
            "Do not treat chatgpt.com/backend-api/codex/responses as a stable public Platform API.",
            "Do not expose direct path as a public production multi-user API client.",
            "Do not copy Pi/Codex CLI implementation code into the harness without license review; re-express observations as probes/profile deltas.",
            "Do not let raw backend event names leak into ADEU session logic.",
            "Do not execute local tools directly from the transport adapter.",
            "Do not auto-approve destructive actions by default.",
            "Do not use consumer ChatGPT web thread endpoints as a fake programmable review-thread API."
        ],
        "dataHandlingRules": [
            field("data.chatgpt_policy", "ChatGPT workspace data policy", "accepted", "oai-server", "workspace RBAC/retention/residency", "ChatGPT-authenticated Codex usage follows ChatGPT workspace/admin policies, not API organization settings.", [ev("codex-auth-docs", "official-doc", "ChatGPT login follows ChatGPT workspace permissions, RBAC, Enterprise retention and residency.")]),
            field("data.zdr_stateless", "stateless/ZDR-compatible request posture", "observed", "oai-server", "store:false, encrypted reasoning content, no previous_response_id", "Codex favors stateless request state and encrypted reasoning content for ZDR compatibility.", [ev("openai-unrolling-codex", "official-engineering-note", "Codex avoids previous_response_id and uses encrypted_content in ZDR-compatible flows."), ev("direct-path-spec", "local-spec", "Request construction uses store:false and profile-owned local sessions.")])
        ],
        "clientHarnessDuties": [
            field("client.normalize_events", "normalize events before ADEU", "accepted", "local-harness", "raw -> normalized event contract", "ADEU code must consume local normalized event classes, not backend event strings.", [ev("direct-extraction-spec", "local-spec", "All backend events must normalize before ADEU code sees them.")]),
            field("client.schema_gate", "schema/profile gate UX controls", "accepted", "local-harness", "observed -> probed -> accepted", "UX controls, tools, imports, compaction and analytics require accepted capability evidence.", [ev("direct-extraction-spec", "local-spec", "Only accepted capabilities become normal user-facing controls."), ev("direct-path-spec", "local-spec", "Never start from desired UX controls and assume server support.")]),
            field("client.errors", "classify transport/auth/quota errors", "observed", "local-harness", "retryable/auth/quota/error taxonomy", "Direct adapter must map backend failures to internal retry/auth/quota categories and retry only transient failures.", [ev("direct-path-spec", "local-spec", "SSE requirements include mapping backend failures and retrying only transient network/rate/server failures.")])
        ]
    },
    "epistemics": {
        "evidenceSources": [
            {"id": "direct-extraction-spec", "kind": "repo-spec", "title": "CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md", "summary": "Root local spec defining versioned evidence-backed ODEU profile with ontology/deontics/epistemics/utility axes and acceptance states.", "urlOrPath": "CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md", "reliability": "high"},
            {"id": "direct-path-spec", "kind": "repo-spec", "title": "CHATGPT_CODEX_DIRECT_PATH_SPEC.md", "summary": "Local direct path spec defining ChatGPT subscription backend, direct adapter contract, OAuth, request construction, stream transport, tool loop and ODEU mapping.", "urlOrPath": "CHATGPT_CODEX_DIRECT_PATH_SPEC.md", "reliability": "high"},
            {"id": "app-server-controller-spec", "kind": "repo-spec", "title": "APP_SERVER_CONTROLLER_SPEC.md", "summary": "Local spec for turning app-server integration into a full local Codex controller with request roundtripping.", "urlOrPath": "APP_SERVER_CONTROLLER_SPEC.md", "reliability": "medium"},
            {"id": "codex-auth-docs", "kind": "official-doc", "title": "OpenAI Codex Authentication", "summary": "Official Codex auth docs for ChatGPT subscription access, API key split, credential storage, workspace policy and device-code login.", "urlOrPath": "https://developers.openai.com/codex/auth", "reliability": "high"},
            {"id": "codex-app-server-docs", "kind": "official-doc", "title": "OpenAI Codex App Server", "summary": "Official app-server JSON-RPC protocol, transports, model/list, thread APIs, events, approvals, fs, auth, rate limits, schemas.", "urlOrPath": "https://developers.openai.com/codex/app-server", "reliability": "high"},
            {"id": "codex-pricing-docs", "kind": "official-doc", "title": "OpenAI Codex Pricing", "summary": "Official Codex plan/model/limit/credit documentation for ChatGPT Plus, Pro, Business, Edu, Enterprise and API key modes.", "urlOrPath": "https://developers.openai.com/codex/pricing", "reliability": "high"},
            {"id": "codex-changelog", "kind": "official-doc", "title": "OpenAI Codex Changelog", "summary": "Official Codex current feature/model availability notes including GPT-5.5 and browser use.", "urlOrPath": "https://developers.openai.com/codex/changelog", "reliability": "high"},
            {"id": "responses-api-docs", "kind": "official-doc", "title": "OpenAI Responses API Reference", "summary": "Official Responses API request/stream/tool/reasoning/usage field reference used as shape evidence for the Codex-compatible endpoint.", "urlOrPath": "https://developers.openai.com/api/reference/resources/responses/methods/create/", "reliability": "high"},
            {"id": "openai-unrolling-codex", "kind": "official-blog", "title": "Unrolling the Codex agent loop", "summary": "OpenAI engineering article stating ChatGPT login path uses chatgpt.com/backend-api/codex/responses and explaining Codex request/context/tool/caching/compaction architecture.", "urlOrPath": "https://openai.com/index/unrolling-the-codex-agent-loop/", "reliability": "high"}
        ],
        "confidenceByCapability": {
            "chatgpt_subscription_auth": "accepted",
            "direct_backend_endpoint": "observed",
            "direct_sse_transport": "observed",
            "responses_stream_event_shape": "accepted",
            "model_catalog_actual_for_user": "unknown",
            "model_list_via_app_server": "accepted",
            "text_input": "accepted",
            "image_input_for_codex_models": "observed",
            "file_input_for_direct_codex": "observed",
            "reasoning_effort_controls": "observed",
            "reasoning_encrypted_content": "accepted",
            "tool_call_request_shape": "observed",
            "local_tool_execution_authority": "accepted",
            "hosted_builtin_tools_for_direct_endpoint": "unstable",
            "tool_result_continuation": "observed",
            "compaction_resume": "observed",
            "prompt_cache_key": "accepted",
            "rate_limit_read_via_app_server": "accepted",
            "direct_rate_limit_error_taxonomy": "unknown",
            "app_server_approval_roundtrip": "accepted",
            "consumer_chatgpt_thread_programmatic_control": "rejected"
        },
        "acceptanceRules": [
            "Official docs can move a capability to accepted only for the documented surface; direct chatgpt.com endpoint behavior still requires a local fixture or live probe where the docs do not promise public stability.",
            "Specimen observations from Pi/OpenCode/Codex CLI create probe hypotheses, not normal UX controls.",
            "Any UX control that affects auth, tool execution, compaction, import, or reasoning mode requires an accepted profile record for the active transport/model/account.",
            "Capabilities marked unstable may be visible only in diagnostics or lab toggles.",
            "Rejected capabilities must not be exposed as user controls."
        ],
        "unknowns": [
            "Exact OAuth authorization parameters and headers required by the current direct ChatGPT/Codex backend for this account.",
            "Whether chatgpt.com/backend-api/codex/responses currently accepts all Platform Responses fields named in the direct spec.",
            "Exact current model IDs and hidden/visible picker state for a given Plus/Pro/Business/Edu/Enterprise account.",
            "Exact ChatGPT account-id header requirements on direct requests.",
            "Exact error taxonomy for direct endpoint rate limits, quota exhaustion, credits, auth expiry, model unavailability, and malformed tool results.",
            "Direct endpoint behavior for file input, image input, hosted tools, WebSocket, and compaction for this account.",
            "Whether GPT-5.3-Codex-Spark is visible to a given Pro account and what modalities/tool settings it exposes."
        ],
        "driftWatch": [
            "OAuth parameter or endpoint changes.",
            "chatgpt.com/backend-api/codex/responses path/header changes.",
            "New/removed model ids and model-list capability fields.",
            "Reasoning summary/encrypted-content shape changes.",
            "Tool-call serialization and tool-result continuation shape changes.",
            "Prompt-cache/session-affinity behavior changes.",
            "Rate-limit bucket and credit semantics.",
            "Responses SSE/WebSocket event additions/removals.",
            "App-server generated schema changes.",
            "Official Codex UX states that imply new server-side capabilities."
        ]
    },
    "utility": {
        "latency": [
            metric("latency.sse", "SSE streaming latency", "observed", "qualitative", "SSE lets the UI stream deltas as soon as they arrive; no numeric baseline without live probe.", [ev("responses-api-docs", "official-doc", "Streaming example shows delta events."), ev("direct-path-spec", "local-spec", "Phase 1 direct transport should use SSE over fetch.")]),
            metric("latency.websocket", "WebSocket latency", "unstable", "qualitative", "WebSocket may improve latency/continuity but is not admitted before SSE baseline; app-server WebSocket is experimental.", [ev("direct-path-spec", "local-spec", "WebSocket phase 2 only if useful."), ev("codex-app-server-docs", "official-doc", "App-server WebSocket is experimental/unsupported.")]),
            metric("latency.prompt_cache", "Prompt cache reuse", "accepted", "qualitative", "Stable static prefixes and prompt_cache_key can reduce recomputation; cache hits depend on exact prefix stability.", [ev("openai-unrolling-codex", "official-engineering-note", "Prompt caching makes sampling closer to linear on cache hits and is sensitive to model/tools/sandbox/cwd changes."), ev("responses-api-docs", "official-doc", "prompt_cache_key/prompt_cache_retention are documented.")])
        ],
        "usageFields": [
            field("usage.tokens", "usage.input/output/total_tokens", "accepted", "oai-server", "input_tokens, output_tokens, total_tokens", "Final Responses usage reports token counts.", [ev("responses-api-docs", "official-doc", "response.completed includes usage token fields.")]),
            field("usage.cached_tokens", "input_tokens_details.cached_tokens", "accepted", "oai-server", "integer", "Responses usage can report cached input tokens.", [ev("responses-api-docs", "official-doc", "usage includes cached token detail in examples.")]),
            field("usage.reasoning_tokens", "output_tokens_details.reasoning_tokens", "accepted", "oai-server", "integer", "Responses usage can report reasoning token counts.", [ev("responses-api-docs", "official-doc", "usage output details include reasoning_tokens.")]),
            field("usage.rate_limits", "account/rateLimits/read", "accepted", "codex-app-server", "usedPercent, windowDurationMins, resetsAt, rateLimitReachedType, credits", "App-server can surface ChatGPT Codex rate-limit buckets and updates.", [ev("codex-app-server-docs", "official-doc", "account/rateLimits/read and updated include limitId, usedPercent, window duration, resetsAt, credits/rateLimitReachedType when present.")]),
            field("usage.plan_limits", "plan/model usage ranges", "accepted", "oai-server", "Plus/Pro/Business/Edu/Enterprise local/cloud/review buckets", "Plan limits are model and task-type dependent and can be extended with credits; exact current user availability is dynamic.", [ev("codex-pricing-docs", "official-doc", "Pricing docs list current model/message/task limit ranges and credit behavior.")])
        ],
        "retryBehavior": [
            field("retry.transient", "transient network/rate/server failures", "observed", "local-harness", "retry with backoff only when classified retryable", "Direct adapter should retry only transient failures and map quota/auth separately.", [ev("direct-path-spec", "local-spec", "SSE requirements include retry only transient network/rate/server failures.")]),
            field("retry.server_overloaded", "JSON-RPC -32001 overloaded", "accepted", "codex-app-server", "exponential delay + jitter", "App-server WebSocket ingress can reject with overloaded error and client should retry with exponential backoff and jitter.", [ev("codex-app-server-docs", "official-doc", "Bounded queues reject with -32001 Server overloaded; retry later and clients should use backoff/jitter.")]),
            field("retry.auth_refresh", "ChatGPT external token refresh", "unstable", "codex-app-server", "server request times out after about 10 seconds", "External-token hosts must respond quickly with fresh tokens or fail explicitly.", [ev("codex-app-server-docs", "official-doc", "External-token refresh request after 401 times out after about 10 seconds.")])
        ],
        "degradationModes": [
            "Auth expired or workspace disallowed.",
            "Plan/credit quota exhausted or rate-limit bucket reached.",
            "Model not available to account or hidden by rollout.",
            "Reasoning effort or modality unsupported by selected model.",
            "Malformed/unsupported tool result continuation.",
            "Context window overflow when truncation/compaction is not admitted.",
            "Prompt-cache miss due to changed model, tools, sandbox, approval mode, current working directory, or MCP tool set.",
            "Direct backend private contract drift.",
            "App-server schema drift across Codex versions.",
            "Hosted tool or connector not authenticated/authorized."
        ],
        "recommendedUxAffordances": [
            "Auth status panel showing ChatGPT workspace/account plan in redacted form.",
            "Model selector populated from live model/list or direct probe, not a hardcoded list.",
            "Reasoning selector gated by selected model capability.",
            "Text verbosity selector with low default for implementation turns.",
            "Tool-call approval queue that makes local authority explicit.",
            "Usage/rate-limit meter with usedPercent, reset time, and credit state when available.",
            "Diagnostics panel for unstable direct backend/event fields.",
            "Profile snapshot attached to every direct harness session/turn."
        ],
        "blockedUxAffordances": [
            "A normal user-facing direct mode before OAuth, plain-text turn, reasoning-summary turn, tool-call, tool-result continuation, abort, quota/error, and cache-affinity probes pass.",
            "Auto-executing shell/patch/MCP tools because the model called them.",
            "Exposing Spark or hosted tools as normal controls unless live model/profile reports them.",
            "Presenting ChatGPT consumer thread control as an official programmable API.",
            "Treating raw backend event names as stable ADEU ontology."
        ]
    },
    "uxExposurePolicy": {
        "normalControls": [
            "ChatGPT subscription auth status, after local OAuth implementation.",
            "Model picker from live capability discovery.",
            "Reasoning and verbosity controls only when the active model/profile admits them.",
            "Manual tool/handoff authority controls through local workspace gate.",
            "Usage/rate-limit readouts when available."
        ],
        "diagnosticControls": [
            "Raw endpoint/header/profile diff diagnostics with redaction.",
            "Unknown event/method capture.",
            "Rate/quota error classifier traces.",
            "Cache hit/miss evidence where exposed through usage fields."
        ],
        "labControls": [
            "Direct WebSocket transport parity.",
            "Hosted built-in tools under ChatGPT subscription endpoint.",
            "Externally managed ChatGPT token mode.",
            "Compaction-resume experiments.",
            "Spark research-preview model routing."
        ],
        "rejectedControls": [
            "Platform API key mode as part of this ChatGPT-subscription ODEU profile.",
            "Consumer ChatGPT web-thread send/upload/scrape automation as an assumed official API.",
            "Persistent auto-approval policy for destructive actions before request lifecycle is proven.",
            "Provider-neutral UX that erases GPT/Codex lineage before certification."
        ]
    }
}

with open('/mnt/data/chatgpt_codex_odeu_profile/chatgpt_codex_subscription_oai_server_odeu_profile.2026-04-25.json', 'w', encoding='utf-8') as f:
    json.dump(profile, f, indent=2)
    f.write('\n')
