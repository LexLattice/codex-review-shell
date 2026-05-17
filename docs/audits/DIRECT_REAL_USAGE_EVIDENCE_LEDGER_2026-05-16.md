# Direct Real Usage Evidence Ledger - 2026-05-16

Branch: `codex/direct-chatgpt-harness`

Commit under test: `e8341baf18ee7de83a1618357a040ae175bf859f`

Purpose: record the second real-usage validation round after the context
maintenance status-evidence merge, then classify the next E-probe expansion
surface by proof level rather than by implementation wish list.

This ledger is intentionally separate from the generated reports. Generated
reports are the evidence artifacts; this document is the human-readable coverage
map.

## Method

The round followed the Program ODEU rule we adopted for this branch:

```text
failed or missing probes are evidence about the program theory first
do not patch a failure list one item at a time
cluster coverage gaps by the missing branch distinction
promote only the behaviors the evidence actually proves
```

The key distinction for this round:

```text
live-provider proof
  proves provider/harness/local-authority behavior for that exact request shape

fixture or projection proof
  proves deterministic local law and renderer-safe projections
  does not promote provider/runtime authority by itself

manual/Electron gap
  means the headless scripts cover the law, but not the actual visible user path
```

## Commands Run

Preflight and safety:

```sh
npm run direct:real-usage -- --mode=preflight --run-fixture-smoke --run-id real_usage_round2_preflight
npm run direct:implementation-proof -- --mode=preflight --include-negative-safety --run-id real_usage_round2_impl_preflight
npm run direct:runtime-path -- --runId real_usage_round2_runtime_path
```

Live text:

```sh
npm run direct:real-usage -- --mode=live --allow-live-provider-call --run-live-probe --run-id real_usage_round2_live_text --timeout-ms 180000
```

Live implementation-lane scenarios:

```sh
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --scenarios=read --include-negative-safety --run-id real_usage_round2_impl_read --timeout-ms 180000
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --scenarios=read_loop --include-negative-safety --run-id real_usage_round2_impl_read_loop --timeout-ms 180000
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --scenarios=patch --include-negative-safety --run-id real_usage_round2_impl_patch --timeout-ms 180000
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --scenarios=command --include-negative-safety --run-id real_usage_round2_impl_command --timeout-ms 180000
```

Context/status and aggregate conformance:

```sh
npm run direct:ui-operation-history -- --runId real_usage_round2_context_status
npm run direct:context-eprobes -- --runId real_usage_round2_context_status
npm run direct:matrix-eprobe -- --runId real_usage_round2_matrix
npm run check:syntax
npm run direct:smoke
```

Evidence-ledger aggregation after the Electron path probe:

```sh
npm run direct:evidence-ledger -- --run-id real_usage_round2_with_electron_v3 \
  --matrix-report /home/rose/.config/codex-review-shell/direct-matrix-eprobe-conformance-runs/matrix_eprobe_1778947549859/direct-matrix-eprobe-conformance-report.json \
  --live-text-report /home/rose/.config/codex-review-shell/direct-real-usage-regressions/real_usage_round2_live_text/regression-summary.json \
  --implementation-reports /home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_read/implementation-proof-report.json,/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_read_loop/implementation-proof-report.json,/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_patch/implementation-proof-report.json,/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_command/implementation-proof-report.json \
  --ui-report '/home/rose/.config/Codex Review Shell/direct-ui-operation-history/ui_1778947549780/direct-ui-operation-history-report.json' \
  --electron-report /home/rose/.config/codex-review-shell/direct-runtime-path-electron-runs/real_usage_round2_runtime_path_electron_v9/direct-runtime-path-electron-report.json \
  --context-report '/home/rose/.config/Codex Review Shell/direct-context-management-eprobes/real_usage_round2_context_status/eprobe-summary.json'
```

Electron runtime-path probe:

```sh
npm run direct:runtime-path:electron -- --run-id real_usage_round2_runtime_path_electron_v9
```

## Evidence Artifacts

| Artifact | Path | Result |
| --- | --- | --- |
| Preflight real usage | `/home/rose/.config/codex-review-shell/direct-real-usage-regressions/real_usage_round2_preflight/regression-summary.json` | `preflight_workspace` passed; fixture smoke passed; provider transport did not start. |
| Preflight implementation proof | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_preflight/implementation-proof-report.json` | Live scenarios correctly blocked without live provider request; negative safety cases blocked locally. |
| Live text usage | `/home/rose/.config/codex-review-shell/direct-real-usage-regressions/real_usage_round2_live_text/regression-summary.json` | App-server baseline, Direct first turn, Direct follow-up, opt-in guard, and idempotency passed. |
| Live read proof | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_read/implementation-proof-report.json` | `real_provider_read` proved full loop. |
| Live read-loop proof | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_read_loop/implementation-proof-report.json` | `real_provider_read_loop` proved full loop. |
| Live patch proof | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_patch/implementation-proof-report.json` | `real_provider_patch` proved full loop with workspace effect scan. |
| Live command proof | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_round2_impl_command/implementation-proof-report.json` | `real_provider_command` proved full loop with workspace effect scan. |
| Context-management E-probes | `/home/rose/.config/Codex Review Shell/direct-context-management-eprobes/real_usage_round2_context_status/eprobe-summary.json` | `19/19` passed; zero provider/app-server/tool mutation sentinels. |
| UI operation/history projection | `/home/rose/.config/Codex Review Shell/direct-ui-operation-history/ui_1778947549780/direct-ui-operation-history-report.json` | Passed; fixture UI projection only; zero mutation sentinels. |
| Matrix conformance | `/home/rose/.config/codex-review-shell/direct-matrix-eprobe-conformance-runs/matrix_eprobe_1778947549859/direct-matrix-eprobe-conformance-report.json` | Strict passed; `13/13` probe suites; `116/135` rows passed; no missing required rows. |
| Real usage evidence ledger | `/home/rose/.config/codex-review-shell/direct-real-usage-evidence-ledgers/real_usage_round2_with_electron_v3/direct-real-usage-evidence-ledger.json` | Passed; `116/135` rows represented; `33` live-provider rows; `10` local-safety rows; `4` Electron UI rows; `7` UI-projection rows; `72` fixture-only rows; `19` not represented rows. |
| Electron runtime-path probe | `/home/rose/.config/codex-review-shell/direct-runtime-path-electron-runs/real_usage_round2_runtime_path_electron_v9/direct-runtime-path-electron-report.json` | Passed `11/11`; persisted Direct Text readback, UI rollback to App Server, evidence-backed App Server -> Direct Text switch, restart persistence, and model/reasoning/approval policy preservation. Direct Tools remained blocked by the runtime gate instead of being faked. |

Important report interpretation:

```text
The matrix conformance report is a strict aggregate fixture/preflight
conformance report. Its `realProviderRows` list is empty by design.

Real-provider proof for text/read/read-loop/patch/command comes from the
live real-usage and implementation-proof reports above.
```

## Live-Proved Behaviors

| Behavior | Evidence | Rows / scenarios exercised |
| --- | --- | --- |
| App-server baseline remains usable | `appserver_baseline.status=passed`, provider bytes observed | `RU-APP-001`, `F1`, `A4` family |
| Direct text live probe records exact-scope runtime evidence | `liveProbe.status=runtime_probed`, no unknown raw event types | `RU-LIVE-001`, `A3`, `A5`, `I2`, `I3` family |
| Direct text first turn completes | `direct_strict_first_turn.status=passed` | `RU-DIR-001`, `B2`, `F2` |
| Direct recent-dialogue follow-up completes from local context | `direct_strict_followup.status=passed` | `RU-DIR-002`, `B3`, `C6`, `F3` |
| Live opt-in guard blocks before provider transport | `direct_opt_in_guard.providerRequestStarted=false` | `RU-GUARD-001`, `I4`, `I14` |
| Client run id is idempotent | `direct_client_run_id_idempotency.status=passed` with no resend | `RU-IDEM-001` |
| Provider can request `read_file`; harness reads and continues | `real_provider_read.status=proved`; `countsAsRealProviderProof=true` | `RU-IMP-001`; report rows `E3`, `E9`, `E10`, `I7`, `F4`, `F6` |
| Provider can request bounded sequential reads | `real_provider_read_loop.status=proved`; `countsAsRealProviderProof=true` | `RU-IMP-002`; report rows `E3`, `E4`, `E9`, `E10`, `E14`, `I7`, `F4`, `F6` |
| Provider can request `apply_patch`; harness applies and continues | `real_provider_patch.status=proved`; workspace effect scan ran | `RU-IMP-003`; report rows `E5`, `E6`, `E9`, `E11`, `E12`, `E13`, `I7`, `F4`, `F6` |
| Provider can request `run_command`; harness runs bounded command and continues | `real_provider_command.status=proved`; workspace effect scan ran | `RU-IMP-004`; report rows `E7`, `E9`, `E11`, `E13`, `I7`, `F4`, `F6`, `F7` |

## Safety Behaviors Proved In This Round

| Safety law | Evidence |
| --- | --- |
| No live provider call without explicit opt-in | `direct_opt_in_guard` passed; implementation preflight live cases blocked with `live_provider_not_requested`. |
| Text-only Direct cannot execute provider tool calls | `negative_direct_text_only_tool_regression` blocked with `provider_tool_call_in_text_only_tier`. |
| Sensitive read paths remain blocked | `negative_read_sensitive_path` blocked with `sensitive_path_denied`. |
| Patch delete remains deferred/blocked | `negative_patch_delete_deferred` blocked with `patch_delete_deferred`. |
| Network/helper command class remains blocked | `negative_command_network_helper_blocked` blocked with `command_class_blocked`. |
| UI/context projection reads are not authority paths | UI/context reports show zero provider transport, app-server spawn/mutation, workspace read, patch apply, command run, right-pane mutation, and handoff mutation sentinels. |

## Fixture-Proved / Projection-Proved Behaviors

These are green, but should not be described as live-provider proof:

| Cluster | Current proof level | Evidence |
| --- | --- | --- |
| Recovery and replay safety | fixture/preflight | `direct:matrix-eprobe` suite `recovery_replay_safety` passed. |
| Iterative repair loop | fixture/preflight | `direct:matrix-eprobe` suite `iterative_repair_loop` passed. |
| Workspace mutation truth and policy substrate | fixture/preflight plus live patch/command effect scans | `workspace_mutation_truth` suite passed; live patch/command reports observed scans. |
| Implementation-lane UI and operation history | fixture UI projection | `direct:ui-operation-history` passed. |
| Thread evidence workbench and derived previews | fixture/preflight | `thread_evidence_workbench` suite passed. |
| Context maintenance, memory, and frontier baton law | fixture/status projection | `direct:context-eprobes` passed `19/19`; `context_maintenance` matrix suite passed. |
| Governance and semantic broker diagnostics | fixture/diagnostic | `governance_broker_diagnostics` suite passed. |
| Sub-agent observability | fixture/diagnostic | `sub_agent_observability` suite passed. |
| Usage/readiness aggregation | fixture/preflight | `usage_readiness` suite passed. |
| Runtime path switch persistence | fixture UI plus Electron UI | `direct:runtime-path` passed; `direct:runtime-path:electron` passed the visible App Server -> Direct Text selector path with copied live-probe evidence. |

## 2026-05-17 Scoped Implementation-Lane Proof Refresh

After wiring Direct Tools selection to scoped implementation-lane proof
evidence, the prior 2026-05-16 live reports were no longer sufficient by
themselves because they predated `scopedImplementationLaneProof`. The live
implementation proof runner was re-run against the pinned WSL app profile:

```bash
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --app-user-data-root /home/rose/.config/codex-review-shell --scenarios=read --include-negative-safety --run-id real_usage_scoped_20260517_read --timeout-ms 180000
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --app-user-data-root /home/rose/.config/codex-review-shell --scenarios=read_loop --include-negative-safety --run-id real_usage_scoped_20260517_read_loop --timeout-ms 180000
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --app-user-data-root /home/rose/.config/codex-review-shell --scenarios=patch --include-negative-safety --run-id real_usage_scoped_20260517_patch --timeout-ms 180000
npm run direct:implementation-proof -- --mode=live --allow-live-provider-call --app-user-data-root /home/rose/.config/codex-review-shell --scenarios=command --include-negative-safety --run-id real_usage_scoped_20260517_command --timeout-ms 180000
```

All four reports passed raw-exposure scanning and produced usable scoped
proof rows under the current account/model/endpoint scope:

| Scoped capability | Report path | Evidence id |
| --- | --- | --- |
| `read_file` | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_scoped_20260517_read/implementation-proof-report.json` | `impl_tool_proof_d67e33223df5c59506ee` |
| `read_file_loop` | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_scoped_20260517_read_loop/implementation-proof-report.json` | `impl_tool_proof_9a0002faa51b304cca1d` |
| `apply_patch` | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_scoped_20260517_patch/implementation-proof-report.json` | `impl_tool_proof_673a7f70760eb20940a1` |
| `run_command` | `/home/rose/.config/codex-review-shell/direct-implementation-proof-runs/real_usage_scoped_20260517_command/implementation-proof-report.json` | `impl_tool_proof_87d20004051f2bb09d0f` |

The aggregate scoped proof resolver returned:

```text
status: ready
evidenceState: runtime_probed
canSelectImplementationLane: true
missingCapabilityIds: []
```

Follow-up local checks:

```bash
npm run check:syntax
npm run direct:smoke
npm run direct:runtime-path
```

This closes the headless evidence side of Direct Tools selector eligibility.
The remaining `RUG-002` work is visible Electron UI coverage for the
Direct Text -> Direct Tools transition with these real scoped proofs present.

## 2026-05-17 RUG-002 Electron Selector Closure

The visible Electron runtime-path probe was extended to copy both live text
probe evidence and scoped implementation proof reports into its isolated app
profile. It now exercises the user-facing selector route:

```text
App Server -> Direct Text -> Direct Tools -> app restart
```

Probe command:

```bash
npm run direct:runtime-path:electron -- --run-id rug002_direct_tools_visible_20260517_fixed2
```

Report:

```text
/home/rose/.config/codex-review-shell/direct-runtime-path-electron-runs/rug002_direct_tools_visible_20260517_fixed2/direct-runtime-path-electron-report.json
```

Observed result:

```text
status: passed
passedCases: 12/12
rug002Partial: false
directTextSelectionExercised: true
directImplementationSelectionExercised: true
implementationProof.capabilityIds:
  - apply_patch
  - read_file
  - read_file_loop
  - run_command
```

The probe also caught and fixed a real gate mismatch: the runtime status
already exposed `implementationProof.status=ready`, but activation was still
blocking on older continuation placeholders. The Direct live text controller
now treats scoped real-provider proof rows as the authoritative readiness
source for Direct Tools capability selection, and the runtime status marks
Direct Tools selectable when it is either eligible or already selected.

Validation:

```bash
npm run check:syntax
npm run direct:runtime-path
npm run direct:runtime-path:electron -- --run-id rug002_direct_tools_visible_20260517_fixed2
npm run direct:smoke
```

## E-Probe Gap Matrix

The next probe work should target gaps in branch distinctions, not individual
code paths.

| Gap id | Classification | Why it matters | Existing evidence | Next E-probe shape |
| --- | --- | --- | --- | --- |
| `RUG-001` | closed in current code bundle | The aggregate matrix report cannot mark external live proof rows as live-proved because that runner is fixture/preflight conformance only. | `direct:evidence-ledger` ingests selected live/fixture/UI reports and emits per-row proof levels. | Keep this aggregator in the default post-round evidence pass. |
| `RUG-002` | closed in current code bundle | Runtime switch persistence and visible Direct Tools eligibility must match the real scoped evidence gate. | `direct:runtime-path` passed; `direct:runtime-path:electron` passed App Server readback, copied live probe evidence, copied scoped implementation proof evidence, App Server -> Direct Text, Direct Text -> Direct Tools, restart persistence, and independent settings preservation. Scoped implementation proof resolver returns `canSelectImplementationLane=true`. | Keep the Electron selector probe in the default runtime-path suite. |
| `RUG-003` | manual/Electron provider loop gap | Live read/patch/command loops are script-proved, but approval cards and status rows are not clicked/observed in the visible UI. | `direct:implementation-proof` live reports passed; UI projection fixture passed. | Electron probe with disposable workspace: trigger provider read/patch/command, approve via card, observe operation history/status row and final assistant continuation. |
| `RUG-004` | crash/recovery live-side-effect gap | No round-2 live probe interrupts after patch/command side effect and then restarts. | Recovery fixture suite passed; live patch/command normal path passed. | Fault-injection probe: after local patch/command result write but before/after continuation handoff, restart and assert no auto-retry, degraded state visible, workspace effect summary retained. |
| `RUG-005` | long-context live pressure gap | Context maintenance is status/projection proved, not exercised under a real long-context pressure turn. | `direct:context-eprobes` passed; no provider compaction authority claimed. | Construct bounded long thread; assert pressure/status projection, no hidden compaction, no provider compact call, and context pack omission refs if cap forces omission. |
| `RUG-006` | app-server sibling UI observation gap | We normalize vanilla sibling context evidence, but round 2 did not observe a real UI compact/memory control transition from app-server. | Context E-probes cover normalized evidence and discriminator behavior. | Electron/app-server observation probe: capture sibling context/memory controls/status, switch thread, prove discriminator prevents bleed. |
| `RUG-007` | fresh-fork live gap | Fresh fork from preview has fixture/spec coverage, but not a live provider first turn from a valid preview. | Matrix fixture suites cover workbench/fork laws. | Build a valid fork/merge/prune preview fixture, start one fresh direct session with live provider opt-in, assert no source continuity and composer state. |
| `RUG-008` | import/checkpoint live gap | Import checkpoint continuation remains fixture/spec-level. | Import/workbench specs and fixture coverage. | Live checkpoint follow-up probe with validated imported source, asserting fresh context seed and no provider continuity import. |
| `RUG-009` | model/quota/usage real-status gap | Usage/readiness is fixture/preflight; quota/model catalog are not current account live status proof. | Live text reports include usage-like provider events; `usage_readiness` suite passed. | Read-only usage/quota/model status probe with explicit opt-in, no model generation unless separately requested, and no billing-grade claims. |
| `RUG-010` | provider compaction primitive gap | Provider compact remains gated and unproved for this profile. | Context E-probes explicitly avoid provider compact authority. | Separate diagnostic-only compact primitive probe if exact profile evidence says endpoint is available; otherwise keep blocked. |
| `RUG-011` | governance non-authority leak gap | Governance/broker diagnostics are fixture-proved; no live runtime action proves `wouldBlockInFutureEnforceMode` cannot block a real turn. | Governance matrix suite passed. | Run real text or implementation turn with shadow diagnostics present and assert provider input/control path unchanged. |
| `RUG-012` | sub-agent observability real source gap | Sub-agent observability is fixture/display-only; no live app-server collab event source was projected. | Sub-agent observability suite passed. | Read-only app-server event ingestion probe, if collab/sub-agent evidence exists, proving no spawn/send/wait/close authority. |

## Recommended Next Probe Bundle

The next bundle should remain probe expansion, not feature work. Since
`RUG-001` is now covered by `direct:evidence-ledger`, the next high-leverage
work is:

1. Add Electron approval-card/status-row probes for `RUG-003`.
2. Add crash/recovery side-effect probes for `RUG-004` once the visible approval/status path is covered.

These connect the already-green headless/live proof to the actual user-visible
app path.

Do not start with provider compaction, fresh forks, or sub-agent source
ingestion. Those are valid later probes, but they are not the main confidence
gap exposed by round 2.

## Current Bottom Line

Round 2 makes the previous 2026-05-12 gaps materially better:

```text
strict direct text first turn: live green
strict direct recent-dialogue follow-up: live green
implementation-lane read/read-loop/patch/command: live green
context/status projection: fixture green
aggregate matrix conformance: strict green
```

The remaining risk is no longer "does the direct harness work at all." The
remaining risk is:

```text
Does the visible Electron app expose and persist the same lawful runtime choices
and approval/status states that the headless reports prove?
```
