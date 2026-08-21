# Direct 0xAlpha Worker and Continuation Slice

Status: implemented experimental Direct Workbench slice (2026-08-21)

## Objective

Direct Workbench may launch 0xAlpha as a bounded reasoning-only child through
either of the currently available realization paths:

| Direct provider id | Upstream route | Model id |
|---|---|---|
| `openrouter-oxalpha` | OpenRouter Chat Completions SSE | `stealth/ox-alpha` |
| `opencode-oxalpha` | local OpenCode JSON CLI | `opencode/x-preview-f-free` |

The two routes are independent provider profiles. They may have different
capacity, latency, and interruption behavior even while they expose the same
underlying stealth model.

The existing `chatgpt-direct` subscription-backed child remains the default.
Choosing a 0xAlpha route is explicit in `spawn_agent.provider`; it is never
inferred from a model-shaped string.

## Child constitution

This first slice is deliberately reasoning-only:

- no workspace mutation;
- no child tools;
- no recursive spawn;
- no remote effects;
- no parent authority inheritance;
- full child output remains in the child epistemic capture;
- the parent receives the established bounded result summary and typed capture
  references.

OpenCode is launched in a per-child Direct-owned runtime directory with
project configuration, default plugins, and LSP downloads disabled. Direct
rebases `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`,
`XDG_CONFIG_HOME`, and `OPENCODE_CONFIG_DIR` into that directory. The worker
therefore never shares the interactive OpenCode database or configuration
directories. Its provider session database is a disposable continuity cache;
the Direct capture is canonical. Its inline constitution denies all
permissions and all tools. If a `tool_use` event nevertheless appears, the
child fails closed with `direct_opencode_tool_boundary_violated`.

An external provider cannot currently be combined with
`workspace_mode: isolated_worktree`. That future path requires a separate
OpenCode workspace-worker authority and lifecycle adapter; it must not be
smuggled through the reasoning-only profile.

## Typed interruption contract

Automatic continuation is a harness transition, not a model suggestion.

OpenRouter continuation is eligible after:

- a transient HTTP response (`408`, `409`, `425`, `429`, `5xx` in the admitted
  set);
- an SSE transport break before exact terminal evidence;
- `finish_reason: length`;
- `[DONE]` without a compatible terminal finish reason.

OpenCode continuation is eligible after:

- a completed JSON step with `reason: unknown`;
- `reason: length`;
- a process/provider failure without terminal `stop` evidence.

When an attempt produced no assistant text, the harness retries the same
request. It does not manufacture a semantic `continue` turn. When partial text
exists, the harness sends this continuation contract in the same semantic
session:

> Continue from exactly where the prior response stopped. Do not restart or
> repeat completed material. Finish the delegated task and return its terminal
> answer.

The parent receives a completed child result only after exact `stop` evidence
and a non-empty assembled answer. Ordinary prose such as “I am done” is not
terminal evidence. An empty nominal terminal response is retried as a
zero-output transport attempt; for a first OpenCode attempt, the original task
is replayed without manufacturing a synthetic continuation turn.

If an established OpenCode session fails before producing new output, Direct
does not keep retrying the possibly damaged provider session. It removes the
provider session identity and compiles a fresh bounded continuation containing:

- the original child constitution and delegation;
- the already-captured Direct output, bounded to 128 KiB with its full digest;
- the unchanged completion contract.

This transition emits `provider_continuity_rebased` and is visible in the
attempt trace as `opencode_session_continuity_lost`. Provider amnesia therefore
does not become Direct Workbench amnesia.

## Bounds and observability

Defaults:

- 12 total provider attempts;
- 30 minutes total wall time;
- 2,000,000 assembled output characters;
- exponential retry delay capped at 8 seconds.

Environment overrides:

```text
CODEX_DIRECT_0XALPHA_MAX_ATTEMPTS
CODEX_DIRECT_0XALPHA_MAX_TOTAL_MS
CODEX_DIRECT_0XALPHA_MAX_OUTPUT_CHARS
CODEX_DIRECT_0XALPHA_RETRY_BASE_MS
CODEX_OPENROUTER_ENDPOINT
CODEX_DIRECT_OPENCODE_BIN
```

Every run produces a
`direct_external_provider_continuation_trace@1` containing attempt outcomes,
typed interruption triggers, semantic-continuation and transport-retry counts,
terminal finish evidence, usage posture, output size, and digests. It contains
no prompts, output text, raw provider frames, or credentials.

Each normalized attempt is committed through the normal native-child
epistemic capture before the next continuation attempt starts. Final
reconciliation is idempotent against that durable prefix. In parallel, every
complete OpenCode NDJSON line is parsed, appended, and `fsync`ed into a private
`direct_opencode_provider_event_journal@1` inside the isolated child run. That
journal is raw O evidence for recovery from a power loss inside the current
attempt; it is not promoted over the normalized Direct capture. The complete
text stream is not flattened into the parent transcript. This keeps the
higher-level agent's context bounded while preserving an addressable source for
later semantic import or audit.

## Credentials

OpenRouter first uses `OPENROUTER_API_KEY` from the process environment. If it
is absent, Direct reads:

```text
~/.config/codex/secrets/openrouter.env
```

The file accepts quoted or unquoted values and must not be group/world
accessible on POSIX hosts. The key is used only to construct the Authorization
header and is excluded from descriptors, traces, errors, and captures.

OpenCode credentials remain owned by OpenCode. Direct does not copy or expose
them.

## Provider tool shape

Example reasoning-only delegation:

```json
{
  "task_name": "audit_selector_hypothesis",
  "message": "Audit the supplied bounded hypothesis and return the strongest counterexample.",
  "agent_type": "auditor",
  "provider": "opencode-oxalpha",
  "reasoning_effort": "max",
  "fork_turns": "3"
}
```

Use `openrouter-oxalpha` to select the direct OpenRouter pool instead.

## Verification

```bash
npm run direct:external-provider-continuation
```

The regression covers partial-stream continuation, zero-output and empty-
terminal retry, maximum-output continuation, non-retriable authentication
failure, total-time and attempt exhaustion, OpenCode process/malformed-stream/
missing-session recovery, lost-session fresh-context rebasing, isolated XDG
runtime state, attempt-prefix durability, private fsynced provider-event
journaling, OpenCode `unknown` continuation, tool-boundary failure, provider
selection, model binding, workspace exclusion, trace-digest admission, and
secret-safe projections.
