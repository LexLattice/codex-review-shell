# ChatGPT Codex Direct Path Spec

Status: design spec for replacing the runtime dependency on Codex CLI with an
in-process ChatGPT subscription transport and a self-owned ADEU/ODEU harness.

Related specs:

- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)
- [CODEX_INTERNAL_KNOBS_ODEU_MAP.md](./CODEX_INTERNAL_KNOBS_ODEU_MAP.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)

## Purpose

Define the direct path from `codex-review-shell` to OpenAI's ChatGPT/Codex
subscription backend.

The goal is not to create a general model provider layer. The goal is to stop
depending on Codex CLI as the live harness substrate while preserving access to
the GPT/Codex model lineage available through a personal ChatGPT Plus/Pro
subscription.

The shell should own:

- OAuth login and token refresh.
- Request construction.
- Stream parsing.
- Tool-call orchestration.
- Session persistence.
- ADEU/ODEU governance.
- UX state and evidence rendering.

Codex CLI becomes an upstream reference specimen and drift signal, not a runtime
dependency.

## Repository And Branch Strategy

The direct path is a parallel long-term line of work, not the next incremental
change on the current app-server branch.

Recommended local layout:

```text
/home/rose/work/LexLattice/codex-review-shell
  current mainline app-server UX path

/home/rose/work/LexLattice/codex-review-shell-direct
  long-lived direct ChatGPT/Codex subscription path
```

Recommended branch:

```text
codex/direct-chatgpt-harness
```

Rules:

- Keep `main` focused on improving the current Codex CLI/app-server UX.
- Treat the direct-path worktree as its own working main while the harness is
  immature.
- Periodically merge or rebase from repository `main` into the direct branch to
  keep UX, project binding, workspace backend, and middle-plane improvements.
- Do not merge the direct branch back into `main` until the direct path passes
  its acceptance criteria.
- Keep the first direct-path commits documentation, probes, fixtures, and
  adapter scaffolding only. Avoid live auth/transport until the ODEU profile
  extraction loop is defined.

This separation avoids blocking current shell UX work while letting the direct
harness evolve as a coherent alternate product path.

## Product Boundary

This path is for personal desktop usage.

It is not:

- an OpenAI Platform API integration;
- a multi-provider abstraction;
- a public production API client;
- a compatibility wrapper around Codex CLI;
- a fork of Codex CLI's Rust harness;
- a replacement for the embedded ChatGPT web thread deck on the right plane.

The initial supported model lineage is GPT/Codex through ChatGPT subscription
auth. Other model lineages are not admitted by default. They may be added later
only by benchmarked equivalence against the ADEU/ODEU certification suite.

## Doctrine

```text
ADEU is model-lineage aware.
It generalizes by certification, not assumption.
```

The native case is GPT/Codex because the ADEU/ODEU framework is being developed
against that lineage. The direct path should therefore optimize for the native
lineage first instead of degrading early into provider-neutral plumbing.

The direct adapter is the volatile edge. Everything above it should consume a
stable internal contract owned by this repo.

## Current External Contract

The current implementation precedent observed in Pi uses:

- authorization URL: `https://auth.openai.com/oauth/authorize`
- token URL: `https://auth.openai.com/oauth/token`
- local OAuth callback: `http://localhost:1455/auth/callback`
- backend base URL: `https://chatgpt.com/backend-api`
- response endpoint: `/codex/responses`
- provider id: `openai-codex`
- API shape: OpenAI Responses-style streaming events with Codex-specific
  headers, status normalization, and ChatGPT account identity handling.

This is not a stable public Platform API contract. Treat it as an observed
consumer ChatGPT backend contract that must be isolated, probed, and monitored.

## Reference Specimens

Reference projects may be studied at the abstract harness level:

- Codex CLI, because OpenAI controls both the client and the server-side model
  contract. It is the highest-signal drift oracle.
- Pi, because it already demonstrates a direct ChatGPT subscription transport
  without requiring Codex CLI at runtime.
- OpenCode and similar OSS harnesses, as comparative ODEU instantiations.

Do not inherit their runtime architecture by default. Do not copy code without a
license review and required notices. Re-express useful abstract logic inside the
local ADEU/ODEU contract.

Local specimen notes:

- `pi-mono` currently lives at `/home/rose/work/pi-mono`.
- The relevant Pi surfaces are the OpenAI Codex OAuth provider, Codex Responses
  transport, model registry metadata, stream tests, and cache-affinity tests.
- Pi is evidence for the observed ChatGPT subscription backend contract; it is
  not the authority boundary for this shell.
- Extract ontology, request/event shapes, retry/error behavior, auth flow
  requirements, and probe ideas. Do not couple our harness to Pi package
  structure or session semantics.

## Target Architecture

```text
Renderer UX
  -> main-process harness controller
    -> ADEU/ODEU session engine
      -> tool router / workspace authority layer
      -> ChatGPT Codex adapter
        -> OAuth token store
        -> request builder
        -> SSE/WebSocket stream client
        -> event normalizer
          -> chatgpt.com/backend-api/codex/responses
```

No renderer process should receive raw OAuth tokens.

No ADEU/ODEU harness code should depend on raw ChatGPT backend event shapes.

No tool execution should happen directly from the transport adapter. The adapter
emits normalized tool-call requests; the harness decides authority, evidence,
execution, replay, and continuation.

## Module Plan

Recommended main-process modules:

| Module | Responsibility |
| --- | --- |
| `chatgpt-oauth-store` | Persist OAuth credentials, refresh tokens, apply file permissions, and expose redacted auth status. |
| `chatgpt-oauth-flow` | Build authorization URL, run callback server, support manual code paste, exchange code for tokens. |
| `codex-direct-client` | Own endpoint URLs, headers, retries, SSE/WebSocket transport, and backend error mapping. |
| `codex-event-normalizer` | Convert backend stream events into internal harness events. |
| `odeu-profile-prober` | Run controlled probes and extract server-side ODEU profile snapshots. |
| `adeu-session-engine` | Own conversation state, compaction, tool replay, role stability, and constitutional lane discipline. |
| `tool-authority-router` | Mediate tool calls through workspace/project authority and evidence-before-commit rules. |

Names can change during implementation. The boundary should not.

## Internal Adapter Contract

The adapter should expose a narrow interface:

```ts
type CodexDirectModel = {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsReasoning: boolean;
  supportsImages: boolean;
  supportsTools: boolean;
};

type CodexDirectRequest = {
  sessionId: string;
  model: string;
  systemPrompt: string;
  input: AdeuMessage[];
  tools: AdeuToolSchema[];
  reasoning?: {
    effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    summary?: "auto" | "concise" | "detailed" | "off";
  };
  text?: {
    verbosity?: "low" | "medium" | "high";
  };
  abortSignal?: AbortSignal;
};

type CodexDirectEvent =
  | { type: "start"; requestId: string; model: string }
  | { type: "text_delta"; itemId: string; text: string }
  | { type: "reasoning_delta"; itemId: string; text: string; visibility: "summary" | "opaque" }
  | { type: "tool_call"; itemId: string; callId: string; name: string; argumentsJson: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheReadTokens?: number }
  | { type: "done"; stopReason: "stop" | "length" | "tool_use" | "error" | "aborted" }
  | { type: "error"; code?: string; message: string; retryable: boolean; authRelated: boolean };
```

The exact TypeScript shapes should be finalized when implementation starts. The
important rule is that ADEU code consumes this local event contract, not raw
OpenAI/ChatGPT stream events.

## OAuth Flow

The first implementation should support browser callback and manual paste.

Flow:

1. User selects ChatGPT Codex subscription auth in shell settings.
2. Main process generates PKCE verifier/challenge and state.
3. Main process starts a localhost callback server.
4. Shell opens the OpenAI authorization URL externally.
5. Browser redirects to local callback with `code` and `state`.
6. Main process validates state and exchanges the code for access/refresh
   tokens.
7. Main process extracts account identity from the access token claims when
   present.
8. Main process persists credentials in the configured direct auth store.
9. Renderer receives only redacted auth status.

Storage requirements:

- Default to persistent local storage outside project config.
- Support an in-memory-only store for development or high-caution runs.
- Use user-only file and directory permissions where the host supports them.
- Never store credentials in project export/import bundles.
- Never expose access or refresh tokens to renderer IPC.
- Refresh expired access tokens under a process-level lock.
- Preserve the refresh token across transient request failures.
- Keep the first persistent store as an app-owned private file, not
  `~/.codex/auth.json`; a later diagnostic may import/reuse Codex CLI auth only
  when explicitly selected.
- Prefer an OS keychain backend later when the app has a stable packaging and
  entitlement story.

Renderer IPC contract:

- `direct-auth:settings` returns the active storage mode, available modes, and
  redacted auth status.
- `direct-auth:status` returns only the redacted auth status projection.
- `direct-auth:set-storage-mode` switches between persistent file storage and
  memory-only storage without exposing store paths.
- `direct-auth:logout` clears app-owned direct auth stores and returns redacted
  post-logout status.
- `direct-auth:login` is reserved for the live OAuth login path; until that path
  is implemented it returns a redacted `live_oauth_not_implemented` result.

## Request Construction

The request builder maps ADEU session state to the ChatGPT Codex backend.

Required fields:

- `model`
- `stream: true`
- `store: false`
- `instructions`
- `input`
- `tools`, when present
- `tool_choice: "auto"` when tools are present
- `parallel_tool_calls: true` unless the harness explicitly serializes tools
- `reasoning`, when selected by user/profile policy
- `text.verbosity`, defaulting to low for implementation turns
- `prompt_cache_key` from the local session id
- `include` entries required to preserve reasoning/caching continuity

The adapter owns backend-specific naming. The harness owns why each field is
lawful for a given ODEU lane.

## Headers

Header construction belongs in one place.

The adapter should centralize:

- bearer token
- ChatGPT account id, when required by the backend
- session/request id
- user agent or client hints, if required
- beta headers for Responses or WebSocket transports
- content type
- accept headers

Do not scatter backend headers across the harness or renderer.

## Stream Transport

Phase 1 should use SSE over `fetch`.

Phase 2 may add WebSocket if it materially improves latency, continuity, or
server compatibility.

SSE requirements:

- parse `data:` frames incrementally;
- ignore `[DONE]`;
- preserve partial JSON buffers;
- normalize terminal statuses;
- map backend failures to internal retry/auth/quota categories;
- support aborts;
- retry only transient network/rate/server failures.

WebSocket requirements, if added:

- use the same normalized event contract;
- keep connection reuse scoped by session id;
- close idle sockets deterministically;
- fall back to SSE only if no stream has started.

## Tool Calls

The backend may request tool calls. The direct adapter must not execute them.

Tool-call flow:

1. Adapter emits normalized `tool_call`.
2. ADEU session engine records the call and its ODEU lane.
3. Authority router decides whether the call is allowed, blocked, or needs user
   approval.
4. Workspace backend executes allowed tool calls.
5. Harness records evidence and tool result.
6. Harness sends the next model request with tool-call results included.

This shell should preserve evidence-before-commit behavior. A model request is
not authority to mutate the workspace.

## Session And Compaction

The self-owned harness must replace Codex CLI session semantics.

Local session state must include:

- session id / prompt cache key;
- model id and reasoning settings;
- user messages;
- assistant messages;
- reasoning summaries or opaque reasoning references;
- tool calls and tool results;
- workspace evidence references;
- ODEU profile snapshot used for the turn;
- compaction checkpoints;
- validation results.

Compaction is not just token trimming. It is an ADEU state transition. It must
preserve:

- role boundaries;
- deontic commitments;
- unresolved tool obligations;
- witness/evidence links;
- active project/workspace identity;
- known uncertainty and rejected assumptions.

## ODEU Profile Mapping

Every backend probe should update or validate an ODEU profile.

This is the logical root of the direct harness. The harness should not expose a
UX control, tool behavior, reasoning mode, import guarantee, or compaction rule
unless it can be grounded in the accepted ODEU profile for the active
ChatGPT/Codex subscription path.

```ts
type ChatGptCodexOdeuProfile = {
  observedAt: string;
  transport: "sse" | "websocket";
  models: {
    id: string;
    available: boolean;
    contextWindow?: number;
    supportsReasoning: boolean;
    supportsTools: boolean;
    supportsImages: boolean;
  }[];
  ontology: {
    inputItems: string[];
    outputEvents: string[];
    toolCallShape: string;
    reasoningShape: string;
    sessionConcepts: string[];
  };
  deontics: {
    authRequirements: string[];
    refusalClasses: string[];
    quotaClasses: string[];
    toolConstraints: string[];
  };
  epistemics: {
    visibleReasoningModes: string[];
    uncertaintySignals: string[];
    evidenceSignals: string[];
  };
  utility: {
    latencyMs?: number;
    retryBehavior: string[];
    usageFields: string[];
    degradationModes: string[];
  };
};
```

This profile is the harness contract. Raw backend behavior is evidence used to
derive it.

The complete extraction design lives in
[CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md).

Minimum implementation rule:

```text
Observed backend event -> normalized event -> ODEU profile delta -> accepted harness capability
```

Never invert that rule. Do not start from desired UX controls and assume the
server supports them.

## Thread Import And Harness Migration

The direct harness must support importing existing work created under other
harnesses, especially Codex CLI/app-server sessions.

Import is not a dumb transcript copy. It is an ODEU translation:

```text
Source harness thread
  -> source ontology parser
  -> normalized evidence graph
  -> ADEU session candidate
  -> validation report
  -> direct harness session
```

Initial source classes:

- Codex CLI/app-server JSONL sessions.
- Existing `codex-review-shell` stored transcript snapshots.
- Pi/coding-agent JSONL sessions, if useful as a comparative import target.
- ChatGPT web thread exports or copied transcript bundles, later and only if
  their evidence boundaries are clear.

Import requirements:

- Preserve source harness identity, source file path, source thread id, and
  source timestamp range.
- Preserve role boundaries, assistant final messages, visible reasoning
  summaries, tool calls, tool results, file-change evidence, approvals, and
  failures when present.
- Mark anything unproven as imported evidence, not native direct-harness truth.
- Produce an import validation report before making the imported session
  runnable.
- Never replay imported tool calls automatically.
- Allow imported sessions to become runnable only after compaction produces a
  direct-harness checkpoint that preserves unresolved obligations and project
  identity.

## Drift Watch

Codex CLI remains important as a drift oracle because OpenAI controls both the
official harness and the server-side backend.

Track these upstream signals:

- OAuth parameter changes.
- Endpoint or path changes.
- Header changes.
- New model ids or removed model ids.
- Reasoning summary shape changes.
- Tool-call serialization changes.
- Prompt cache/session behavior changes.
- Error taxonomy changes.
- Rate-limit/quota semantics.
- Transport changes.
- New official UX states that imply server-side capabilities.

When Codex CLI changes:

1. Classify the change into ODEU buckets.
2. Update the probe suite if needed.
3. Run probes against the ChatGPT Codex backend.
4. Compare against the accepted ODEU baseline.
5. Patch only the local adapter/profile/harness parts that actually moved.

Do not re-align by merging Codex CLI implementation churn.

## Probe Suite

The direct path needs a small probe suite before it becomes default.

Minimum probes:

- login and token refresh;
- one plain text request;
- one reasoning-summary request;
- one tool-call request with a harmless read-only tool;
- one tool-result continuation;
- one abort;
- one forced invalid tool-result repair;
- one compaction-resume turn;
- one quota/rate/error capture, if safely reproducible;
- one image input probe if image support is exposed.

Each probe stores:

- raw request metadata with tokens redacted;
- raw stream fixture with tokens redacted;
- normalized event sequence;
- extracted ODEU profile deltas;
- pass/fail classification.

Fixtures should be safe to commit only after credential and private-content
redaction.

## Compatibility Tiers

Model support is not a provider checkbox.

| Tier | Meaning |
| --- | --- |
| `native` | GPT/Codex subscription lineage used as the ADEU reference organism. |
| `certified` | Passed the same ADEU/ODEU certification suite with documented deviations. |
| `experimental` | Adapter exists, but behavioral equivalence is not proven. |
| `unsupported` | Not admitted to the harness. |

Initial state:

```text
GPT/Codex via ChatGPT subscription: native
OpenAI Platform API: unsupported
Other providers: unsupported
Codex CLI app-server: compatibility/legacy shell surface only
```

## Migration From Codex CLI Dependency

The migration should be staged.

### Phase 0: Spec And Baseline

- Keep existing Codex app-server integration working.
- Add this spec.
- Create the parallel worktree and long-lived direct branch.
- Identify all runtime call sites that assume Codex app-server as the left-plane
  implementation partner.
- Define the internal ADEU session event contract.
- Define the ODEU profile extraction schema, fixture format, redaction rules,
  and acceptance gates.
- Define the source-thread import ontology for Codex CLI/app-server sessions.

### Phase 0A: Reference Specimen Extraction

- Inspect Pi, Codex CLI, and OpenCode at the abstract protocol/harness level.
- Produce a source-attributed capability map, not copied implementation.
- Convert useful observations into probe hypotheses.
- Mark each hypothesis as observed, probed, accepted, rejected, or unstable.

### Phase 0B: ODEU Profile Root

- Implement fixture-only profile extraction.
- Add redacted raw event fixture format.
- Add normalized event sequence format.
- Add profile-delta generation.
- Add a baseline report that shows what the harness is allowed to expose.

### Phase 1: Direct Auth

- Implement OAuth login in main process.
- Store credentials privately.
- Show redacted auth status in settings.
- Add token refresh and logout.

### Phase 2: Direct Model Call

- Implement SSE request path for one model.
- Normalize text/reasoning/usage/done/error events.
- Add a smoke probe command.

### Phase 3: Tool Loop

- Define tool schemas from local workspace capabilities.
- Emit tool approval requests through the existing middle-plane request queue.
- Continue model turns with tool results.

### Phase 4: ADEU Harness Ownership

- Persist local direct sessions.
- Add compaction checkpoints.
- Add ODEU profile snapshots per turn.
- Make direct path the default left-plane implementation for new projects.

### Phase 5: Legacy Codex App-Server Mode

- Keep Codex app-server as a legacy/compatibility surface only if it remains
  useful for transcript import or comparative observation.
- Remove hard runtime requirement on a `codex` executable.

## Security Rules

- Main process owns tokens.
- Renderer receives no bearer tokens.
- Workspace tools run through the existing backend authority layer.
- Tool calls require project/workspace binding evidence.
- Destructive file or command actions require explicit authority policy.
- Redact auth headers and token-bearing payloads from logs.
- Redact private workspace paths from shareable probe fixtures unless the user
  explicitly exports a local diagnostic bundle.
- OAuth callback server binds to localhost by default.
- Manual paste fallback must validate state when state is supplied.

## Open Questions

- Which exact auth file location should this shell use on Windows and WSL?
- Should the direct session store live per project or globally with project
  references?
- Which GPT/Codex model should be the initial default?
- Should WebSocket be implemented before or after the first tool loop?
- How much of the existing Codex thread analytics should be retained once local
  direct sessions become canonical?
- Should the right-plane ChatGPT web deck remain strictly separate from direct
  left-plane Codex sessions, or should it receive read-only summaries?

## Acceptance Criteria

The direct path is ready to replace Codex CLI as the default when:

- a clean install can log into ChatGPT subscription auth without Codex CLI;
- a user can run a full text + tool + continuation loop without Codex CLI;
- token refresh works after access-token expiry;
- raw backend events are isolated below the adapter;
- ADEU session state persists and resumes without Codex CLI session files;
- ODEU profile probes produce a baseline and diff report;
- the renderer never receives raw credentials;
- existing project/workspace authority rules still gate tool execution;
- failure modes are visible and recoverable in the UX.
