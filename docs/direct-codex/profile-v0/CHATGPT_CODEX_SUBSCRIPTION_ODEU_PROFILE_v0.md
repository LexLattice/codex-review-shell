# ChatGPT/Codex Subscription Path ODEU Profile v0

Status: imported baseline profile, not a live credentialed probe.
Observed at: 2026-04-25.
Schema: `direct_codex_odeu_profile@1`.
Profile instance: `chatgpt_codex_subscription_oai_server_odeu_profile.2026-04-25.json`.

## Scope

This profile describes the abstract ODEU capability/allowance envelope currently evidenced for a client harness that wants to connect through the ChatGPT subscription Codex path. It is not an OpenAI Platform API profile and not a claim that `chatgpt.com/backend-api/codex/responses` is a stable public API. It is a harness-contract baseline derived from local specs plus official OpenAI Codex/Responses documentation and OpenAI's Codex agent-loop article.

The profile separates three authority layers:

1. **ChatGPT subscription backend**: OpenAI-hosted Responses-style model inference, auth, account/plan limits, streaming event shapes, model/catalog availability.
2. **Codex app-server**: official local JSON-RPC client-harness protocol for rich Codex clients, conversation history, streamed events, approvals, model list, filesystem/config/skills/MCP surfaces.
3. **Local harness/workspace authority**: workspace reads/writes, shell commands, patch application, tool execution, approvals, evidence capture, compaction policy, session persistence.

Only layer 1 is OAI server-side in the strict cloud sense. Layer 2 is official OpenAI harness protocol surface. Layer 3 is not OAI authority; it is local ADEU/harness authority.

## ADEU/ODEU schema style used

The emitted schema follows the existing ADEU-style artifact posture used elsewhere in the repo:

- closed JSON root with `additionalProperties: false`;
- explicit `schema` discriminator;
- versioned profile identifier;
- source/evidence refs on capabilities rather than unsupported naked claims;
- fail-closed capability states: `observed`, `probed`, `accepted`, `unstable`, `rejected`, `unknown`;
- ODEU axes separated as `ontology`, `deontics`, `epistemics`, and `utility`.

## Deliverables

- `direct_codex_odeu_profile.v1.schema.json` — JSON Schema for this profile family.
- `chatgpt_codex_subscription_oai_server_odeu_profile.2026-04-25.json` — instantiated baseline profile.
- `generate_profile.py` — deterministic local generator for the profile instance.

## Executive capability summary

### Accepted or usable now as harness contract

- ChatGPT sign-in path for Codex subscription access.
- Codex app-server stdio JSON-RPC as official rich-client harness protocol.
- App-server model/list discovery for account-visible model metadata.
- Responses-style input item model: system/developer/user/assistant roles and text/image/file-capable input shape.
- Responses-style streaming event grammar as normalized-event input to ADEU.
- Function/custom tool-call shape as model output; execution remains local authority.
- Reasoning effort controls and reasoning summaries, subject to model support.
- Encrypted reasoning content for stateless continuation where supported.
- Prompt cache/session-affinity fields.
- App-server approval roundtrip for commands, file changes, user input, MCP/dynamic tool surfaces.
- App-server rate-limit and account status inspection.

### Observed but not default-exposed without probes

- Direct `chatgpt.com/backend-api/codex/responses` harness path.
- Direct SSE transport details for subscription backend.
- Exact request headers/account-id behavior.
- Exact model availability for a particular ChatGPT account.
- Tool-result continuation shape against the direct endpoint.
- Direct quota/rate/error taxonomy.
- Image/file support on every Codex subscription model.

### Unstable or experimental

- Direct WebSocket parity for the subscription endpoint.
- App-server WebSocket transport for local JSON-RPC; official docs mark it experimental/unsupported.
- GPT-5.3-Codex-Spark: plan-gated Pro research preview.
- Dynamic tool calls and external ChatGPT auth-token refresh in app-server mode.
- Hosted built-in Responses tools as direct Codex endpoint affordances until probed.

### Rejected for normal harness exposure

- Treating the ChatGPT subscription endpoint as a public Platform API.
- Exposing raw OAuth/access/refresh tokens to renderer IPC.
- Executing tool calls directly inside the transport adapter.
- Treating model tool calls as authority to mutate the workspace.
- Auto-approving destructive shell/file/network actions by default.
- Consumer ChatGPT existing web-thread automation as an official API capability.
- Admitting OpenAI Platform API or other providers into this profile without separate certification.

## O — Ontology

### Model ontology

The baseline model list is account-catalog-derived, not hardcoded as guaranteed. Official Codex documentation currently lists GPT-5.5, GPT-5.4, GPT-5.4-mini, GPT-5.3-Codex, and GPT-5.3-Codex-Spark for relevant ChatGPT Codex use. The instantiated profile marks Spark as unstable/preview and all models as needing account-level discovery before first-class UX exposure.

Model capability dimensions in the schema:

- `available` / plan-gated availability;
- `supportsReasoning`;
- `supportedReasoningEfforts`;
- `supportsTools`;
- `supportsImages`;
- `contextWindow`, intentionally unknown until model/list or live probe supplies it.

### Request ontology

The direct path request envelope is Responses-style:

- endpoint: `POST https://chatgpt.com/backend-api/codex/responses` for ChatGPT login Codex use;
- `model`;
- `stream: true`;
- `store: false`;
- `instructions`;
- `input`;
- `tools`;
- `tool_choice`;
- `parallel_tool_calls`;
- `reasoning`;
- `text.verbosity`;
- `prompt_cache_key`;
- `include`, especially `reasoning.encrypted_content` for stateless reasoning continuity.

The adapter owns backend-specific names and headers. ADEU/harness layers consume normalized local events only.

### Response-event ontology

Raw backend events should normalize into:

- `session_started`;
- `message_delta`;
- `reasoning_delta`;
- `tool_call_started`;
- `tool_call_delta`;
- `tool_call_completed`;
- `usage_delta`;
- `response_completed`;
- `response_incomplete`;
- `response_failed`;
- `transport_error`;
- `auth_error`;
- `quota_error`;
- `aborted`.

Raw Responses events are allowed to exist only below the adapter boundary.

### Tool ontology

The model may request tools, but the backend is not granted execution authority. The harness route is:

```text
backend tool call -> normalized event -> ADEU session record -> authority router -> workspace backend -> evidence/result -> continuation request
```

The profile accepts function/custom tool-call shapes as server-side model affordances, but shell commands, patching, filesystem mutation, MCP side effects, browser actions, and workspace reads are local harness/workspace authorities.

### Continuation ontology

Continuation may use:

- full explicit input replay;
- previous output/reasoning items carried forward;
- encrypted reasoning content when stateless;
- prompt cache/session-affinity keys;
- tool-call result continuation;
- compaction checkpoints.

Compaction is represented as an ADEU state transition, not just token trimming.

## D — Deontics

### Auth and credential rules

- ChatGPT subscription auth is in scope.
- API-key authentication is explicitly out of scope for this specific profile.
- Credentials live outside project config.
- Renderer receives only redacted auth status.
- Raw bearer, refresh, authorization code, cookie, account id, private prompt, workspace path, and tool-output secrets must be redacted from fixtures.

### Workspace authority rules

- OAI may emit tool-call intent; OAI does not grant local workspace mutation authority.
- Workspace tools run through the workspace/backend authority layer.
- Destructive commands, file changes, network access, and MCP side effects require explicit policy and/or approval.
- Imported tool calls are evidence only and must never be auto-replayed.

### Blocked behaviors

- Do not build a public production client around private ChatGPT backend behavior.
- Do not expose capabilities from desired UX first; expose only observed/probed/accepted capabilities.
- Do not let ADEU code branch on raw backend event names.
- Do not collapse the standalone dual-partner shell into a generic chat or ADEU control lab.

## E — Epistemics

### Evidence states

Capability states use:

- `observed`: seen in official docs/specimen/raw event but not accepted for default UX;
- `probed`: exercised by fixture or local controlled probe;
- `accepted`: stable enough for normal harness feature gating;
- `unstable`: exists but should remain diagnostics/lab-only;
- `rejected`: observed but unlawful or inappropriate for this harness;
- `unknown`: important but not yet evidenced.

### Unknowns requiring probes

- Exact OAuth parameters and current direct-token exchange requirements for this harness.
- Exact direct endpoint headers and ChatGPT account-id behavior.
- Exact user/account-visible model catalog and modalities.
- Whether every Responses field in the local direct spec is accepted by the subscription Codex endpoint.
- Exact tool-result continuation and malformed tool-result repair behavior.
- Exact quota/rate/error taxonomy.
- Whether image/file inputs are available for each model in the direct endpoint.
- Whether direct WebSocket offers measurable value over SSE.

### Drift watch

The profile must be refreshed when any of the following move:

- OAuth parameters/endpoints;
- backend endpoint path or required headers;
- model ids and model capabilities;
- reasoning summary/encrypted-content shape;
- tool call and tool-result serialization;
- prompt cache/session behavior;
- quota/rate semantics;
- Codex CLI official harness behavior;
- app-server generated schemas.

## U — Utility

### Latency and transport

- SSE is the first direct transport target.
- App-server stdio is the stable official local rich-client protocol.
- App-server WebSocket is useful for loopback/port-forwarded scenarios but remains experimental/unsupported upstream.
- Prompt caching and stable tool/model/sandbox/cwd state are utility-critical because churn can cause cache misses.

### Usage and limits

- ChatGPT subscription use is plan/credit/window governed.
- Account-visible limits can be read through official Codex/app-server account surfaces.
- Responses usage includes input, output, cached input, and reasoning token details where available.
- Direct endpoint quota errors must be normalized into auth/quota/retry/degradation states before UX exposure.

### Degradation modes

- expired/invalid ChatGPT auth;
- missing account id/header requirement;
- quota/credits exhausted;
- unsupported model;
- unsupported reasoning setting;
- malformed tool result;
- server overloaded;
- stream interruption;
- prompt-cache miss;
- compaction failure;
- workspace authority denial.

## Recommended UX affordances

Expose normally only after accepted/probed evidence:

- ChatGPT subscription auth status, redacted.
- Model selector from discovered model list.
- Reasoning effort selector if model reports support.
- Text verbosity selector as an advanced implementation preference.
- Manual/assisted tool approval cards.
- Read-only ODEU profile inspector with accepted/unstable/rejected filters.
- Probe report viewer and drift warnings.

Keep behind diagnostics/lab toggles:

- raw direct endpoint fixtures;
- raw event stream display;
- WebSocket parity;
- hosted built-in tool probes;
- direct OAuth debug metadata;
- malformed tool-repair probes.

Block from normal UX:

- arbitrary private endpoint editor;
- raw token display;
- auto-approve destructive actions;
- direct ChatGPT web-thread API controls;
- provider-neutral model toggles before certification.

## Immediate implementation implication

Do not implement live OAuth or live model calls first. The correct first slice is:

1. commit this schema family;
2. commit redaction helpers;
3. add fixture loader;
4. add raw-to-normalized event normalizer for redacted fixtures;
5. add profile-delta builder;
6. generate a baseline report;
7. only then add live auth and live transport probes.

## Validation performed for this extraction

- JSON Schema parsed successfully.
- Profile instance parsed successfully.
- Profile instance validates against `direct_codex_odeu_profile.v1.schema.json` using `jsonschema`.

