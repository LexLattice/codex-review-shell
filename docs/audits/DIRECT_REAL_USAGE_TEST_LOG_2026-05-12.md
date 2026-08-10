# Direct Real Usage Test Log - 2026-05-12

Branch: `codex/direct-chatgpt-harness`

Workspace under test: `/tmp/codex-direct-real-usage-20260512-023944/workspace`

This pass intentionally logs findings only. No implementation fixes were made.

## Environment

- Local repo: `/home/rose/work/LexLattice/codex-review-shell-direct`
- Headless runner: `scripts/codex-real-turn.mjs`
- Probe runner: `scripts/direct-codex-live-probe.mjs`
- Fixture smoke runner: `scripts/direct-codex-smoke.mjs`
- Direct auth source reported by headless runs: `codex-cli-auth`
- App-server auth source reported by headless runs: `codex-cli-auth`

## Live Probe

Command:

```sh
CODEX_DIRECT_LIVE_PROBE=1 npm run direct:probe:live
```

Result:

- `ok=true`
- evidence id: `live_probe_evidence_95c70e3151fc4ee3a2ac`
- status: `runtime_probed`
- usable: `true`
- model: `gpt-5.5`
- endpoint class: `chatgpt-codex-responses`
- expires: `2026-05-18T23:40:27.666Z`
- normalized event types: `session_started`, `message_delta`, `usage_delta`, `response_completed`
- unknown raw event types: none

The live probe guard also behaved correctly: the same command without `CODEX_DIRECT_LIVE_PROBE=1` refused to call the backend.

## Headless Runs

| Case | Runtime | Report id | Status | Provider started | Bytes observed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| App-server baseline | appserver | `real_usage_appserver_20260512_0240` | `completed` | yes | yes | Assistant replied `APP-SERVER: baseline test acknowledged.` |
| Strict direct first turn | direct | `real_usage_direct_empty_20260512_0241` | `blocked` | no | no | Blocked by `live_evidence_scope_mismatch`. |
| Direct diagnostic first turn | direct | `real_usage_direct_diag_empty_20260512_0242` | `diagnostic` | yes | yes | Assistant replied `DIRECT-DIAG-ONE: Diagnostic received.` |
| Direct diagnostic follow-up | direct | `real_usage_direct_diag_followup_20260512_0243` | `failed` | no | no | Failed pre-transport with `ERR_SQLITE_ERROR` / `FOREIGN KEY constraint failed`. |
| Direct text-only file-access boundary | direct | `real_usage_direct_diag_tool_boundary_20260512_0244` | `diagnostic` | yes | yes | Model answered that no file-reading tool was available; no tool executed or continuation sent. |
| Direct live opt-in guard | direct | `real_usage_direct_no_optin_20260512_0245` | `blocked` | no | no | Blocked by `live_provider_call_opt_in_missing`. |

Reports are under:

```text
/home/rose/.config/codex-review-shell/headless-runs/<report-id>/report.json
```

The selected reports were scanned for obvious raw path/token exposure patterns:

```text
/tmp/codex-direct
/home/rose
accessToken
refreshToken
Bearer
sk-
session_token
C:\
/mnt/c/
```

No matches were found in the report JSON files.

## Fixture Coverage

Command:

```sh
npm run direct:smoke
```

Result:

- Exit code: `0`
- Output: `Direct Codex profile harness smoke passed.`

This is fixture-backed coverage, not real-provider coverage. It still confirms the current direct harness smoke suite passes after the command-execution merge.

## Findings

### REAL-001 - Strict direct first turn is blocked despite fresh runtime-probed evidence

The live probe produced usable `runtime_probed` evidence, but a strict direct real turn immediately failed before transport:

```text
failure.code = live_evidence_scope_mismatch
runtimeEvidence.liveProbeEvidenceId = live_probe_evidence_95c70e3151fc4ee3a2ac
runtimeEvidence.liveProbeEvidenceStatus = scope_mismatch
providerRequestStarted = false
```

A local inspection of the evidence resolver showed every scope match false for the selected evidence. The index entry used for matching appears to contain only a compact `model` field, while the scope requires profile, account, endpoint, request-shape, workspace, and version fields.

Impact:

- Strict direct headless turns cannot currently use the freshly generated evidence.
- Diagnostic direct transport can run, but that does not satisfy activation/readiness gates.
- This likely maps to the earlier UI symptom where direct activation remained blocked after a successful probe.

### REAL-002 - Direct recent-dialogue follow-up fails before transport

The second direct turn was run with `--from-report` against the completed diagnostic first-turn report. It failed before any provider request:

```text
failure.code = ERR_SQLITE_ERROR
failure.rendererSafeMessage = FOREIGN KEY constraint failed
providerRequestStarted = false
```

Impact:

- Headless direct multi-turn recent-dialogue is not currently usable in this real run path.
- The failure happens before transport, so this is local persistence/projection setup, not provider behavior.

### REAL-003 - Real implementation-lane tool loops are not covered by the standard headless runner

The standard `codex-real-turn.mjs --runtime=direct` path exercises direct text-only turns. It records `toolExecuted=false` and `continuationSent=false`, and the file-access boundary prompt produced a normal text answer rather than a provider tool call.

Impact:

- Read-file, apply-patch, and run-command loops are covered by `direct:smoke`, but not by a real-provider headless approval harness in this pass.
- A dedicated real implementation-lane harness or Electron/controller-driven headless path is still needed to validate live provider tool-call behavior end to end.

## Passed Behaviors

- App-server baseline can start and complete a headless real turn.
- Direct live probe can make a backend call and now normalizes the observed event stream without unknown raw event types.
- Direct real live transport can complete a first text-only turn in `diagnostic-no-promotion` mode.
- Direct live transport opt-in guard blocks before provider handoff when `--allow-live-provider-call` / `CODEX_DIRECT_REAL_TURN=1` is absent.
- Direct text-only prompt boundary did not execute a tool, did not send a continuation, and did not expose workspace file access.
- `client-run-id` idempotency returned the existing direct diagnostic report without rewriting it when rerun with the same prompt/runtime/request shape.
- Selected reports did not expose obvious raw local paths or token-like strings.

## Open Test Gaps

- Strict direct text-only first turn after evidence scope resolution is fixed.
- Direct recent-dialogue follow-up after the SQLite foreign-key failure is fixed.
- UI/Electron direct text-only turn against the same project selection path.
- Real-provider implementation-lane `read_file` approval loop.
- Real-provider implementation-lane `apply_patch` approval loop against a disposable workspace.
- Real-provider implementation-lane `run_command` approval loop against a disposable workspace.
- Real command workspace-effect scan with a safe script that mutates a disposable file.
