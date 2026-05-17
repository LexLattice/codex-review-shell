# Direct Real Usage Test Matrix

Status: live/regression planning matrix for `codex/direct-chatgpt-harness`.

This matrix defines the real usage scenarios we should run when validating the
direct harness with actual app-server/direct provider traffic. Fixture and
preflight cases remain in the matrix because they prove safety boundaries that
must hold before and after live calls.

Current evidence ledger:

- [2026-05-16 round-2 evidence ledger](./audits/DIRECT_REAL_USAGE_EVIDENCE_LEDGER_2026-05-16.md)

## Run Levels

| Level | Provider calls | Purpose |
| --- | --- | --- |
| `preflight` | No | Proves disposable workspace setup, opt-in guards, local authority blockers, report redaction, and script health. |
| `live-text` | Yes | Proves app-server baseline and direct text-only first/follow-up turns against current credentials. |
| `live-implementation` | Yes | Proves real provider tool-call intent plus local read/patch/command authority in a disposable workspace. |
| `fixture-ui` | No | Proves user-facing runtime path switching and persisted defaults without live transport. |
| `electron-ui` | No provider model call | Proves visible Electron controls, restart persistence, and settings preservation. |

## Matrix

| Scenario | Level | Runner | Expected Behavior | Main Evidence |
| --- | --- | --- | --- | --- |
| `RU-PRE-001` | `preflight` | `node scripts/direct-real-usage-regression.mjs --mode=preflight --run-fixture-smoke` | Creates an isolated disposable workspace and records no provider transport. | `preflight_workspace.providerRequestStarted=false` |
| `RU-LIVE-001` | `live-text` | `node scripts/direct-real-usage-regression.mjs --mode=live --allow-live-provider-call --run-live-probe` | Records exact-scope runtime-probed direct text evidence. | `liveProbe.status=runtime_probed` or a precise failure reason |
| `RU-APP-001` | `live-text` | same live text run | App-server baseline returns a completed assistant answer. | `appserver_baseline.status=passed` |
| `RU-DIR-001` | `live-text` | same live text run | Direct empty-context first turn completes with provider bytes observed. | `direct_strict_first_turn.status=passed` |
| `RU-DIR-002` | `live-text` | same live text run | Direct recent-dialogue follow-up completes from local context refs, not provider continuity. | `direct_strict_followup.status=passed` |
| `RU-GUARD-001` | `live-text` | same live text run | Direct turn without opt-in is blocked before provider transport. | `direct_opt_in_guard.providerRequestStarted=false` |
| `RU-IDEM-001` | `live-text` | same live text run | Repeating a completed `client-run-id` returns existing status without rewrite/resend. | `direct_client_run_id_idempotency.status=passed` |
| `RU-IMP-001` | `live-implementation` | `node scripts/direct-implementation-proof-regression.mjs --mode=live --allow-live-provider-call --scenarios=read --include-negative-safety` | Provider emits `read_file`, local authority reads one file, continuation completes. | `real_provider_read.countsAsRealProviderProof=true` |
| `RU-IMP-002` | `live-implementation` | `node scripts/direct-implementation-proof-regression.mjs --mode=live --allow-live-provider-call --scenarios=read_loop --include-negative-safety` | Provider can continue through a bounded sequential read if it requests a second file. | `real_provider_read_loop.countsAsRealProviderProof=true` |
| `RU-IMP-003` | `live-implementation` | `node scripts/direct-implementation-proof-regression.mjs --mode=live --allow-live-provider-call --scenarios=patch --include-negative-safety` | Provider emits `apply_patch`, local authority applies patch in disposable workspace, continuation completes. | `real_provider_patch.countsAsRealProviderProof=true` |
| `RU-IMP-004` | `live-implementation` | `node scripts/direct-implementation-proof-regression.mjs --mode=live --allow-live-provider-call --scenarios=command --include-negative-safety` | Provider emits `run_command`, local authority runs package script, workspace-effect scan runs, continuation completes. | `real_provider_command.countsAsRealProviderProof=true` |
| `RU-NEG-001` | `preflight` | `node scripts/direct-implementation-proof-regression.mjs --mode=preflight --include-negative-safety` | Patch delete is blocked by local authority. | `negative_patch_delete_deferred.status=blocked` |
| `RU-NEG-002` | `preflight` | same preflight implementation run | Network/helper command is blocked by local authority. | `negative_command_network_helper_blocked.status=blocked` |
| `RU-PATH-001` | `fixture-ui` | `npm run direct:runtime-path` | User-facing app-server/direct-text/direct-implementation switch persists and preserves existing model/reasoning settings. | runtime path regression passes |
| `RU-LEDGER-001` | `preflight` | `npm run direct:evidence-ledger -- --matrix-report ... --live-text-report ... --implementation-reports ... --ui-report ... --context-report ...` | Aggregates selected live, fixture, and UI reports into one row-level evidence ledger without starting provider/app-server/tool authority. | `rug001Closed=true`, raw exposure passes, sentinels are zero |
| `RU-PATH-002` | `electron-ui` | `npm run direct:runtime-path:electron` | Visible Electron path selector reads a persisted Direct Text default, switches back to App Server, recognizes copied real live-probe evidence, switches App Server -> Direct Text, survives restart, and preserves model/reasoning/permission settings. | `directTextSelectionExercised=true`; Direct Tools remains blocked unless implementation-lane gate evidence is present |
| `RU-CTX-001` | `preflight` | `npm run direct:long-context-pressure` | Builds a real long Direct thread in the session/thread stores, detects context pressure, records deterministic trim/omission artifacts, and builds the next context pack/request manifest without provider/app-server/tool authority. | `rug005Closed=true`; provider transport and provider compact sentinels are zero; omission parity passes |
| `RU-CTX-002` | `preflight` | `npm run direct:appserver-sibling-context` | Normalizes app-server-shaped context compaction and memory events as sibling-only evidence, projects them into display-only status, then switches to a Direct thread and proves no Direct context/memory/compaction authority bleeds through. | `rug006Closed=true`; app-server spawn/mutation and Direct context-from-sibling sentinels are zero |
| `RU-FORK-001` | `fixture-provider-shaped` / `live-text` | `npm run direct:fresh-fork-start -- --mode fixture`; live promotion: `npm run direct:fresh-fork-start -- --mode live --allow-live-provider-call` | Builds a valid fork preview, prepares a confirmed fresh fork start, creates a fresh direct-native session, persists seed/context/manifest artifacts, sends exactly one first-turn provider-shaped request, and proves no source provider continuity. | Fixture mode: `coverageSource=fixture_provider_shaped`, `matrixPromotionCandidate=false`; live mode: `coverageSource=real_provider`, `rug007Closed=true` |

## Default Execution Order

1. `RU-PRE-001`, `RU-NEG-001`, `RU-NEG-002`, and `RU-PATH-001`.
2. `RU-LIVE-001` through `RU-IDEM-001`.
3. `RU-IMP-001`.
4. `RU-IMP-002`.
5. `RU-IMP-003`.
6. `RU-IMP-004`.
7. `RU-LEDGER-001` after all selected reports exist.
8. `RU-PATH-002` for visible Electron persistence coverage.
9. `RU-CTX-001` after context/status fixture coverage is green.
10. `RU-CTX-002` after `RU-CTX-001`.
11. `RU-FORK-001` fixture mode before any live fresh-fork promotion run.

Stop and cluster failures by theory before continuing to a higher-risk level.
For example, an evidence-scope failure in `RU-LIVE-001` should be fixed before
running implementation-lane tool scenarios.

After the stepped escalation is green, a consolidated implementation run may use
`--scenarios=read,read_loop,patch,command` to produce one final proof report.

## Safety Rules

- Live provider calls require `--allow-live-provider-call` or
  `CODEX_DIRECT_REAL_TURN=1`.
- CI live calls require `CODEX_DIRECT_REAL_TURN_ALLOW_CI=1`.
- Implementation scenarios use disposable workspaces.
- Reports must not include raw credentials, raw provider bodies, absolute
  workspace paths, raw ChatGPT URLs, or raw backend frames.
- App-server and direct results are compared as separate runtime families, not
  merged as one authority source.
