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

## RUG-003 Electron Approval Card Probe

Status: read, patch, and command approval-card paths closed for the visible
Electron app.

Added `direct:electron-read-approval`, a live opt-in Electron probe that uses
the supported user route:

```text
App Server -> Direct Text -> Direct Tools -> prompt -> visible approval card
-> Approve read/patch/command -> completed card/status row -> assistant continuation
```

The probe starts from App Server rather than seeding Direct Tools as the initial
runtime, because Direct activation/rollback law intentionally rejects a direct
implementation-lane start that did not pass through the runtime selector. It
then submits a real prompt in the Codex surface, observes
`direct/tool/readOnly/requestApproval`, `direct/tool/patchApply/requestApproval`,
or `direct/tool/command/requestApproval`, clicks the visible approval button,
and verifies the renderer-safe implementation status/history projection after
completion.

The implementation gap found by this probe was that the selectable Direct Tools
surface still built text-only first-turn requests. Direct implementation-lane
first turns now use scoped implementation tool declarations when the project has
matching read/patch/command proof evidence; text-only remains unchanged.

Latest read live run:

```text
run id: rug003_electron_read_approval_20260517_retry4
status: passed
cases: 14/14
visibleApprovalCardExercised: true
assistantContinuationObserved: true
rawExposure: passed
```

Latest patch and command live runs:

```text
patch run id: rug003_patch_visible_approval_20260518
patch status: passed
patch cases: 16/16
patch visibleApprovalCardExercised: true
patch finalAssistantProofObserved: true
patch workspaceEffect: changedPathCount=1, providerVisibility=summary_only

command run id: rug003_command_visible_approval_20260518
command status: passed
command cases: 16/16
command visibleApprovalCardExercised: true
command finalAssistantProofObserved: true
command workspaceEffect: changedPathCount=0, providerVisibility=none
```

Validation:

```bash
npm run check:syntax
npm run direct:electron-read-approval -- --run-id rug003_electron_read_approval_20260517_retry4 --allow-live-provider-call
npm run direct:electron-read-approval -- --scenario patch --run-id rug003_patch_visible_approval_20260518 --allow-live-provider-call
npm run direct:electron-read-approval -- --scenario command --run-id rug003_command_visible_approval_20260518 --allow-live-provider-call
```

## 2026-05-17 RUG-004 Side-Effect Recovery Fault Probe

Status: live patch/command side-effect recovery path closed for the visible
Electron app.

The Electron approval probe now supports an explicit test-only fault mode that
terminates the app after local side-effect result and operation-history rows are
durably recorded, before the turn reaches a safe assistant terminal state. The
probe restarts the app and verifies the recovered renderer-safe state:

```text
App Server -> Direct Text -> Direct Tools -> visible patch/command approval
-> Approve local side effect -> forced app exit -> restart
-> side-effect status/history/workspace-effect summary still visible
-> no automatic retry
-> composer remains blocked
-> recovery state reports continuation_sent_no_bytes
```

Probe commands:

```bash
npm run direct:electron-read-approval -- --scenario patch --run-id rug004_patch_fault_20260517_final --allow-live-provider-call --fault-after-local-side-effect
npm run direct:electron-read-approval -- --scenario command --run-id rug004_command_fault_20260517_final --allow-live-provider-call --fault-after-local-side-effect
```

## 2026-05-17 RUG-005 Long Context Pressure Probe

Status: local real long-context pressure path closed for deterministic Direct
context maintenance artifacts.

Added `direct:long-context-pressure`, a provider-free probe that constructs a
real long Direct-native thread in the Direct session/thread stores, builds the
renderer and `context_recent_dialogue` projections, detects over-budget
pressure, records local deterministic trim/omission/memory/baton artifacts, and
builds the next context pack plus request manifest with maintenance refs cited.

Probe command:

```bash
npm run direct:long-context-pressure -- --run-id rug005_long_context_pressure_20260517
```

## 2026-05-17 RUG-006 App-Server Sibling Context Observation Probe

Status: captured app-server sibling context observation path closed for
display-only Direct context/status projection.

Added `direct:appserver-sibling-context`, a provider-free probe that normalizes
app-server-shaped thread-item and control observations:

```text
contextCompaction item
agentMessage memoryCitation
thread/compact/start
thread/memoryMode/set
memory/reset
```

The probe projects those observations as `vanilla_app_server_sibling` evidence,
feeds them through the Direct context-maintenance status summary, then switches
to a Direct thread and proves the sibling evidence does not become Direct
context, durable memory, provider compact proof, omission ledger, or continuity.

Probe command:

```bash
npm run direct:appserver-sibling-context -- --run-id rug006_appserver_sibling_context_20260517
```

Report:

```text
/home/rose/.config/codex-review-shell/direct-appserver-sibling-context-runs/rug006_appserver_sibling_context_20260517/direct-appserver-sibling-context-report.json
```

Observed result:

```text
status: passed
cases: 6/6
rug006Closed: true
appServerSpawnCalls: 0
appServerMutationCalls: 0
contextPackBuildsFromSibling: 0
requestManifestBuildsFromSibling: 0
```

The probe validates the app-server sibling discriminator:

```text
vanilla app-server context/memory/compact evidence may be displayed as sibling
status, but it cannot promote Direct compaction, Direct memory editing, Direct
context-pack input, or Direct provider continuity.
```

Validation:

```bash
npm run direct:appserver-sibling-context -- --run-id rug006_appserver_sibling_context_20260517
```

## 2026-05-17 RUG-007 Fresh-Fork Start Probe

Status: fresh-fork start runner added and fixture-provider-shaped route passed;
real-provider promotion remains opt-in and not yet run.

Added `direct:fresh-fork-start`, a focused probe over the existing workbench and
live-text fork-start route:

```text
source direct thread
  -> renderer transcript projection
  -> fork_preview@1
  -> prepareForkStart confirmation
  -> startForkFromPreview
  -> fork seed
  -> new direct-native session
  -> context pack
  -> request manifest
  -> first-turn provider-shaped request
  -> terminal assistant text
```

The runner defaults to fixture-provider-shaped transport so it can be part of
normal local validation without an accidental live backend call. Live promotion
requires `--mode live --allow-live-provider-call` or `CODEX_DIRECT_RUG007_LIVE=1`
and still obeys the CI live-call guard.

Probe command:

```bash
npm run direct:fresh-fork-start -- --run-id rug007_fresh_fork_start_fixture_20260517
```

Report:

```text
/home/rose/.config/codex-review-shell/direct-fresh-fork-start-runs/rug007_fresh_fork_start_fixture_20260517/direct-fresh-fork-start-report.json
```

Observed result:

```text
status: passed
coverageSource: fixture_provider_shaped
cases: 10/10
matrixPromotionCandidate: false
rug007Closed: false
directProviderRequestCalls: 1
fixtureProviderShapeCalls: 1
liveProviderTransportCalls: 0
previousResponseIdUsed: false
providerContinuityHandleUsed: false
sourcePreviousResponseIdUsed: false
firstTurnTerminalKind: completed_with_assistant_text
composerState: enabled
```

Live promotion run:

```bash
npm run direct:fresh-fork-start -- --mode live --run-id rug007_fresh_fork_start_live_20260518 --allow-live-provider-call
```

Live report:

```text
/home/rose/.config/codex-review-shell/direct-fresh-fork-start-runs/rug007_fresh_fork_start_live_20260518/direct-fresh-fork-start-report.json
```

Live observed result:

```text
status: passed
coverageSource: real_provider
cases: 10/10
matrixPromotionCandidate: true
rug007Closed: true
directProviderRequestCalls: 1
liveProviderTransportCalls: 1
fixtureProviderShapeCalls: 0
previousResponseIdUsed: false
store: false
toolsDeclared: false
firstTurnTerminalKind: completed_with_assistant_text
composerState: enabled
```

The probe also exposed and fixed a fresh-fork idempotency bug: retrying an
already committed `start_fork_turn` with the same `clientOperationId` compared
the stored deterministic `forkStartId` with the raw client id, incorrectly
returning `client_operation_id_conflict`. The controller now compares against
the deterministic fork-start id and the probe asserts retry does not resend
provider transport.

## 2026-05-17 RUG-008 Import Checkpoint Continuation Probe

Status: import-checkpoint continuation runner added, fixture-provider-shaped
route passed, and real-provider promotion passed.

Added `direct:import-checkpoint-continuation`, a focused probe over the import
checkpoint and live-text continuation route:

```text
legacy JSONL source
  -> validated checkpoint import
  -> read-only imported parent session
  -> checkpoint continuation preview
  -> direct_import_checkpoint_seed@1
  -> fresh direct-native continuation session
  -> context/request-shape artifacts
  -> first-turn provider-shaped request
  -> terminal assistant text
```

The runner defaults to fixture-provider-shaped transport, so it can be run in
normal local validation without a live backend call. Live promotion requires
`--mode live --allow-live-provider-call` or `CODEX_DIRECT_RUG008_LIVE=1` and
still obeys the CI live-call guard.

Probe command:

```bash
npm run direct:import-checkpoint-continuation -- --run-id rug008_import_checkpoint_continuation_fixture_20260517
```

Report:

```text
/home/rose/.config/codex-review-shell/direct-import-checkpoint-continuation-runs/rug008_import_checkpoint_continuation_fixture_20260517/direct-import-checkpoint-continuation-report.json
```

Observed result:

```text
status: passed
coverageSource: fixture_provider_shaped
cases: 13/13
matrixPromotionCandidate: false
rug008Closed: false
directProviderRequestCalls: 1
fixtureProviderShapeCalls: 1
liveProviderTransportCalls: 0
previousResponseIdFromImportUsed: false
importedToolReplayAttempted: false
readOnlyImported: true
nativeDirectSession: false
idempotent retry: reused without resend
```

Live promotion run:

```bash
npm run direct:import-checkpoint-continuation -- --mode live --run-id rug008_import_checkpoint_continuation_live_20260518 --allow-live-provider-call
```

Live report:

```text
/home/rose/.config/codex-review-shell/direct-import-checkpoint-continuation-runs/rug008_import_checkpoint_continuation_live_20260518/direct-import-checkpoint-continuation-report.json
```

Live observed result:

```text
status: passed
coverageSource: real_provider
cases: 13/13
matrixPromotionCandidate: true
rug008Closed: true
directProviderRequestCalls: 1
liveProviderTransportCalls: 1
fixtureProviderShapeCalls: 0
previousResponseIdUsed: false
store: false
toolsDeclared: false
readOnlyImported: true
nativeDirectSession: true
imported parent nativeDirectSession: false
idempotent retry: reused without resend
```

The probe validates the discriminator that matters for this gap:

```text
imported checkpoint evidence can seed a fresh Direct continuation, but the
imported parent remains read-only and no imported provider continuity, tool
replay, app-server fallback, workspace action, patch, command, right-pane
mutation, or handoff mutation is allowed.
```

Report:

```text
/home/rose/.config/codex-review-shell/direct-long-context-pressure-runs/rug005_long_context_pressure_20260517/direct-long-context-pressure-report.json
```

Observed result:

```text
status: passed
cases: 7/7
rug005Closed: true
providerTransportCalls: 0
providerCompactPrimitiveCalls: 0
```

The probe validates the branch distinction that matters for this gap:

```text
long context pressure can produce local maintenance evidence and omission refs
without silently invoking provider compaction, app-server fallback, workspace
actions, or request transport.
```

Validation:

```bash
npm run direct:long-context-pressure -- --run-id rug005_long_context_pressure_20260517
```

Reports:

```text
/home/rose/.config/codex-review-shell/direct-electron-read-approval-runs/rug004_patch_fault_20260517_final/direct-electron-read-approval-report.json
/home/rose/.config/codex-review-shell/direct-electron-read-approval-runs/rug004_command_fault_20260517_final/direct-electron-read-approval-report.json
```

Observed results:

```text
patch:   passed 19/19
command: passed 18/18
```

The probe caught and fixed a real status-projection gap: after restart, the
session store status could report an empty `lastTurnState` because it used the
first project session rather than the active/latest session. The status resolver
now uses the active/latest session and the implementation-lane UI projects a
conservative `continuation_sent_no_bytes` recovery state when a side-effect
result exists but the turn remains nonterminal.

Validation:

```bash
npm run check:syntax
npm run direct:electron-read-approval -- --scenario patch --run-id rug004_patch_fault_20260517_final --allow-live-provider-call --fault-after-local-side-effect
npm run direct:electron-read-approval -- --scenario command --run-id rug004_command_fault_20260517_final --allow-live-provider-call --fault-after-local-side-effect
```

## 2026-05-18 RUG-009 Model/Quota/Usage Status Probe

Status: model/quota/usage status runner added; fixture mode passed and
live-readonly mode passed using existing runtime-probed live evidence without
starting a provider request.

Added `direct:model-quota-usage-status`, a focused status projection probe:

```text
existing live probe evidence or fixture evidence
  -> model catalog snapshot
  -> usage ledger
  -> quota/rate snapshot
  -> runtime evidence facets
  -> drift/status witness chips
  -> renderer-safe status report
```

The default fixture mode proves the projection laws without live/account reads.
The live-readonly mode requires `--mode live-readonly --allow-live-status-read`
or `CODEX_DIRECT_RUG009_LIVE_READONLY=1`; it reads only existing
`direct-probe-evidence` artifacts and does not start model generation, create
sessions, build context packs, mutate runtime selection, or claim billing-grade
cost/quota truth.

Fixture command:

```bash
npm run direct:model-quota-usage-status -- --run-id rug009_model_quota_usage_status_fixture_20260518
```

Live-readonly command:

```bash
npm run direct:model-quota-usage-status -- --mode live-readonly --allow-live-status-read --run-id rug009_model_quota_usage_status_live_readonly_20260518
```

Reports:

```text
/home/rose/.config/codex-review-shell/direct-model-quota-usage-status-runs/rug009_model_quota_usage_status_fixture_20260518/direct-model-quota-usage-status-report.json
/home/rose/.config/codex-review-shell/direct-model-quota-usage-status-runs/rug009_model_quota_usage_status_live_readonly_20260518/direct-model-quota-usage-status-report.json
```

Observed live-readonly result:

```text
status: passed
coverageSource: live_readonly_status
cases: 12/12
matrixPromotionCandidate: true
rug009Closed: true
liveEvidenceReadAttempted: true
providerTransportCalls: 0
model evidenceState: runtime_probed
usage billingGrade: false
quota status: unknown
quota canBlockDirectByItself: false
selectorEnabledInThisPr: false
controlsUiEnabledInThisPr: false
```

The probe validates the branch distinction that matters for this gap:

```text
existing live evidence can drive renderer-safe model/usage/quota readiness
status, but status reads cannot create provider traffic, cannot enable model
controls, cannot claim billing-grade usage/cost, and unknown quota does not
block direct by itself.
```

## E-Probe Gap Matrix

The next probe work should target gaps in branch distinctions, not individual
code paths.

| Gap id | Classification | Why it matters | Existing evidence | Next E-probe shape |
| --- | --- | --- | --- | --- |
| `RUG-001` | closed in current code bundle | The aggregate matrix report cannot mark external live proof rows as live-proved because that runner is fixture/preflight conformance only. | `direct:evidence-ledger` ingests selected live/fixture/UI reports and emits per-row proof levels. | Keep this aggregator in the default post-round evidence pass. |
| `RUG-002` | closed in current code bundle | Runtime switch persistence and visible Direct Tools eligibility must match the real scoped evidence gate. | `direct:runtime-path` passed; `direct:runtime-path:electron` passed App Server readback, copied live probe evidence, copied scoped implementation proof evidence, App Server -> Direct Text, Direct Text -> Direct Tools, restart persistence, and independent settings preservation. Scoped implementation proof resolver returns `canSelectImplementationLane=true`. | Keep the Electron selector probe in the default runtime-path suite. |
| `RUG-003` | closed in current code bundle | Live read/patch/command loops are script-proved, but approval cards and status rows needed visible UI coverage. | Electron approval path passed for read, patch, and command. Patch/command start from App Server, move through Direct Text to Direct Tools, show visible approval cards, accept approval, record renderer-safe status/history rows, run workspace-effect scans, and complete assistant continuation. | Keep read/patch/command Electron approval probes in the visible-app validation set. |
| `RUG-004` | closed in current code bundle | The visible Electron app must recover safely when patch/command side effects happen locally but the provider continuation does not reach a safe assistant terminal state. | Fault-injection Electron probes passed for patch and command; restart projection preserves tool result, operation history, workspace-effect summary, blocked composer, and `continuation_sent_no_bytes` recovery state. | Keep patch/command side-effect recovery probes in the visible Electron approval suite. |
| `RUG-005` | closed in current code bundle | Context maintenance is status/projection proved, but needed a real long Direct thread pressure path through session/thread stores and context-pack/request-manifest artifacts. | `direct:long-context-pressure` passed; over-budget pressure selected `local_trim`, omission parity passed, context pack/request manifest cited maintenance refs, provider/app-server/tool sentinels stayed zero. | Keep this probe in the post-context validation set. |
| `RUG-006` | closed in current code bundle | We normalize vanilla sibling context evidence, but needed a captured app-server-shaped observation probe to prove compact/memory/status evidence remains sibling-only across Direct thread switch. | `direct:appserver-sibling-context` passed; context compaction, memory citation, compact control, memory mode, and memory reset observations projected display-only; Direct context pack excluded sibling refs; app-server and Direct authority sentinels stayed zero. | Keep this probe in the context validation set; a later live app-server capture can replace the fixture source when available. |
| `RUG-007` | closed in current code bundle | Fresh fork from preview needed a focused route probe plus explicit live-provider first-turn promotion. | `direct:fresh-fork-start` fixture-provider-shaped mode passed, then live mode passed with `coverageSource=real_provider`, `matrixPromotionCandidate=true`, `rug007Closed=true`, one live provider request, no `previous_response_id`, no `store`, no tools, terminal assistant text, enabled composer, and idempotent retry no-resend. | Keep fixture mode in normal validation and rerun live mode only when refreshing real-provider promotion evidence. |
| `RUG-008` | closed in current code bundle | Import checkpoint continuation needed a focused route probe plus explicit live-provider first-turn promotion. | `direct:import-checkpoint-continuation` fixture-provider-shaped mode passed, then live mode passed with `coverageSource=real_provider`, `matrixPromotionCandidate=true`, `rug008Closed=true`, one live provider request, no `previous_response_id`, no `store`, no tools, validated imported parent remains read-only, fresh native Direct continuation session completes, and idempotent retry no-resend. | Keep fixture mode in normal validation and rerun live mode only when refreshing real-provider promotion evidence. |
| `RUG-009` | closed in current code bundle | Usage/readiness was fixture/preflight, and quota/model catalog needed a current live-evidence status projection without generation. | `direct:model-quota-usage-status` fixture mode passed; live-readonly mode passed against existing runtime-probed live evidence with `providerTransportCalls=0`, exact text model scope, non-billing usage, unknown quota as nonblocking, and model controls disabled. | Keep live-readonly status projection in the default readiness validation set when live probe evidence exists. |
| `RUG-010` | provider compaction primitive gap | Provider compact remains gated and unproved for this profile. | Context E-probes explicitly avoid provider compact authority. | Separate diagnostic-only compact primitive probe if exact profile evidence says endpoint is available; otherwise keep blocked. |
| `RUG-011` | governance non-authority leak gap | Governance/broker diagnostics are fixture-proved; no live runtime action proves `wouldBlockInFutureEnforceMode` cannot block a real turn. | Governance matrix suite passed. | Run real text or implementation turn with shadow diagnostics present and assert provider input/control path unchanged. |
| `RUG-012` | sub-agent observability real source gap | Sub-agent observability is fixture/display-only; no live app-server collab event source was projected. | Sub-agent observability suite passed. | Read-only app-server event ingestion probe, if collab/sub-agent evidence exists, proving no spawn/send/wait/close authority. |

## Recommended Next Probe Bundle

The next bundle should remain probe expansion, not feature work. Since
`RUG-001` is covered by `direct:evidence-ledger`, `RUG-005` is covered by
`direct:long-context-pressure`, `RUG-006` is covered by
`direct:appserver-sibling-context`, `RUG-007` now has focused fixture and live
runners, `RUG-008` now has focused fixture and live runners, `RUG-009` now has
a focused live-readonly status runner, and `RUG-003`/`RUG-004` are covered by
the visible Electron approval suite, the next high-leverage work is:

1. Keep the Electron approval-card/status-row and side-effect recovery probes
   in the default visible-app validation set.
2. Move to `RUG-010` only if exact provider compact primitive evidence is
   available; otherwise prefer `RUG-011` governance non-authority leakage.
3. Keep `RUG-012` behind read-only app-server source availability; do not infer
   sub-agent source evidence from fixture-only projections.

The visible Direct Tools gap is closed; remaining work should either promote
fresh-fork/import-checkpoint evidence live or probe for authority leakage in
later diagnostic layers.

Do not start with provider compaction or sub-agent source ingestion. Those are
valid later probes, but they are not the main confidence gap exposed by round 2.

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
