# Codex Direct Harness PR Affinity Bundles v0

Scope: implementation planning layer for the direct ChatGPT/Codex harness roadmap.

This document derives multi-arc PR bundles from the canonical ODEU matrix:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

The matrix owns capability rows. This document owns implementation affinity: which rows should usually ship together because they share state, tests, code paths, and safety gates.

## Bundle Rules

- A bundle should become one detailed spec and one PR unless implementation size forces a split.
- Splits should preserve the affinity boundary: do not separate rows that share the same authority state machine.
- Real-provider proof should precede UI trust.
- Recovery/replay safety should follow real side-effect proof.
- Context maintenance, governance, and sub-agent observability should not be mixed into implementation-lane tool authority PRs.
- Fork-derived exemplars are design inputs, not direct-shell support.

## Recommended Order

```text
1. Real-provider implementation-lane proof
2. Recovery and replay safety
3. Iterative implementation repair loop
4. Workspace mutation truth and policy substrate
5. Implementation-lane UI and operation history
6. Thread evidence workbench and derived views
7. Fresh fork starts from previews
8. Context maintenance, memory, frontier baton
9. Governance and semantic broker diagnostics
10. Sub-agent observability and containment
11. Usage/quota/model evidence and mainline readiness
```

One possible swap: bundle 5 can move before bundle 3 if the app UI needs to catch up to already-proven headless flows. Do not move context maintenance, governance, or sub-agent work ahead of real implementation-lane proof and recovery.

## PR 1 - Real-Provider Implementation-Lane Proof

Rows: `I7`, `E3-E7`, `E9-E15`, `B4-B6`, `B11-B12`, `F4-F7`, minimum `J3-J7`.

Why these belong together: they prove the same confidence gap. The direct branch has designed read/patch/command authority modules; this PR proves the real provider can drive those modules through lawful local authority and continuation.

Include:

```text
real read_file approval loop
real multi-step read_file loop
real apply_patch in disposable workspace
real run_command in disposable workspace
workspace-effect scan
tool-output envelopes
tool-result redaction
manifest proofs
minimum policy substrate and safe defaults
no app-server fallback
no right-pane/handoff mutation
```

Do not include:

```text
iterative repair beyond bounded test loops
general shell/network/browser/MCP
auto-approval
delete/revert
parallel tool calls
UI polish beyond report/status needs
```

Success condition: `E3-E7`, `E9-E15`, and `I7` move toward `B-R` for scoped headless real-provider runs.

## PR 2 - Recovery And Replay Safety After Side Effects

Rows: `A11`, `C1-C3`, `C11-C12`, `E15`, `I9`.

Why these belong together: they share the same durable state problem. After real loops work, duplicate side effects after crash/retry become the main risk.

Include:

```text
restart with pending approval
tool result recorded but continuation not sent
patch applied but continuation failed
command ran but continuation failed
transport handoff unknown
journal/operation ledger replay
corrupt/partial classification
no duplicate read/write/command
```

Do not include:

```text
new tools
iterative repair
revert UI
sub-agent waits
```

Success condition: every read/patch/command state has a deterministic restart classification, and no ambiguous state auto-retries after provider bytes or local side effects.

## PR 3 - Iterative Implementation Repair Loop

Rows: `E4`, `E14-E15`, `B7`, `B12`, `F4`, `D18`.

Why these belong together: they define bounded sequencing.

```text
read -> patch -> command -> next read/patch -> command again
```

Include:

```text
bounded read/patch/command sequence
one active obligation at a time
multi-step caps
transition graph
terminal states
incomplete/empty output handling
multiple-call fail-closed or bounded sequential handling
```

Do not include:

```text
new tool classes
parallel tools
auto-approval
full governance compiler
```

Success condition: the direct implementation lane can run a bounded iterative repair scenario without broadening authority.

## PR 4 - Workspace Mutation Truth And Policy Substrate

Rows: `E6-E8`, `E11`, `J4-J7`, parts of `F8`.

Why these belong together: workspace mutation truth is one policy/backend surface. Patch journals, command side-effect scans, generated/vendor/lockfile policy, sensitive path policy, caps, and optional revert all share this substrate.

Include:

```text
workspace effect summary
git/status or backend index scan
patch journal inspection
command changed-workspace status
generated/vendor/lockfile policy
sensitive path policy
path class policy
workspace changed but model did not see contents
```

Maybe include as scaffold only:

```text
revert plan schema
```

Do not include unless deliberately scoped:

```text
actual user-facing revert execution
delete support
broad file write tool
```

Success condition: after patch or command, the shell can say exactly what changed locally and whether the model saw the changed content.

## PR 5 - Implementation-Lane UI And Operation History

Rows: `F1-F10`, `C7`, `F8`, `I13`, `J1-J8`.

Why these belong together: once headless real loops and recovery are proven, the app UI should expose the same lawful flows coherently.

Include:

```text
direct tier selector status matching headless gates
implementation-lane readiness
approval cards for read/patch/command
operation history panel
runtime witness chips
degraded states and next actions
project policy read-only view
```

Do not include:

```text
new authority
deep governance settings
sub-agent UI
compaction UI
```

Success condition: a user can run the same implementation-lane flows from the app that passed headless, without guessing which tier is active.

## PR 6 - Thread Evidence Workbench And Derived Views

Rows: `G1-G11`, `C5`, `F8`, `F10`.

Why these belong together: imports, graph, merge preview, prune preview, fork preview, external refs, and tombstones operate over the same direct thread store/projection/workbench substrate.

Include:

```text
legacy import safe workbench
thread graph and lifecycle controls
merge/prune/fork previews
ChatGPT external refs by binding id only
operation history for thread controls
non-runnable derived views
```

Maybe include as disabled/scaffold:

```text
purge/delete tombstone model
```

Do not include:

```text
fresh fork provider execution
right-pane ChatGPT transcript import
provider continuity from imported or derived views
```

Success condition: the workbench can organize and preview direct/imported thread evidence without making derived views runnable.

## PR 7 - Fresh Fork Starts From Previews

Rows: `G8-G9`, `B1-B3`, `C8-C10`, `D18`.

Why separate from PR 6: PR 6 is non-runnable evidence/workbench. PR 7 creates a new runtime session, so it crosses an authority boundary.

Include:

```text
start fresh fork from direct preview
start fresh fork from merge/prune preview if scoped
seed/context/manifest creation
lineage edges
no provider continuity
no source tool/approval replay
```

Do not include:

```text
provider previous_response_id from source
merge materialization
prune deletion
right-pane ChatGPT import
```

Success condition: preview evidence can seed one fresh direct session without pretending it is provider continuity.

## PR 8 - Context Maintenance, Memory, And Frontier Baton

Rows: `D1-D14`, `D22-D23`, `A12`, `J11`.

Why these belong together: context route matrix, maintenance manifests, durable memory, bridge/baton, refresh/prune, and fail-closed trimming are one context-maintenance family.

Include:

```text
context route matrix
context pressure model
local/remote/hybrid compaction modes as status/probe
context maintenance manifest
durable thread memory artifact
memory refresh manifest
frontier_baton@1
fail-closed raw-window trim
omission ledger
maintenance status UI
```

Do not include:

```text
governance enforcement
semantic broker routing
sub-agent wait tools
automatic memory editing UI
```

Success condition: the harness can maintain long-context state without silently dropping required artifacts.

## PR 9 - Governance And Semantic Broker Diagnostics

Rows: `D15-D21`, `J10`.

Why these belong together: governance prompt layering and semantic broker routing are adjacent but distinct. Together they decide how user/task/runtime semantics become structured provider input and legal transitions.

Include first:

```text
governance packet artifact
compiled prompt layers
role mapping digest
shadow diagnostics
transition legality graph
semantic_broker_packet@1
broker fallback/ask-human state
```

Do not include initially:

```text
hard enforce mode as default
automatic semantic rerouting
deep provider/fork controls in main UI
```

Success condition: the shell can explain what governance/broker packet would apply and fail closed when routing is ambiguous, without dominating the product.

## PR 10 - Sub-Agent Observability And Containment

Rows: `H1-H10`, `J9`.

Why these belong together: agent graph, progress registry, E-witness, inspect/wait tools, thread-spawn containment, collab surface, child transcript projection, attention model, and wait-deadlock prevention are one family.

Include first:

```text
agent graph
progress registry
E-witness rows
sub-agent transcript projection
attention badges
read-only inspect progress
containment policy visibility
```

Defer within the same family:

```text
wait tool
thread spawn
collab tools
recursive delegation
```

Success condition: the shell can show sub-agent activity and containment evidence before it allows model-visible wait/spawn tools.

## PR 11 - Usage, Quota, Model Evidence, And Mainline Readiness

Rows: `A7-A10`, `I1-I15`, `J12`, parts of `F9`.

Why these belong together: model catalog, quota/rate evidence, usage ledger, drift watch, report schema validation, CI live-call guards, and mainline readiness are confidence infrastructure.

Include:

```text
model/evidence status resolver
quota/rate snapshots where available
usage ledger integration for direct path
report schema validation
drift deltas
capability downgrade on expiry/mismatch
mainline merge-behind-flag checklist
docs and migration notes
```

Do not include:

```text
new runtime authority
billing-grade cost truth
UI feature proliferation
```

Success condition: direct has enough evidence/status hygiene to live behind a flag without eroding the app-server baseline.

## Split Guidance

Do not split these separately at first:

```text
read_file
multi-step read
apply_patch
run_command
workspace-effect scan
```

They are all part of PR 1: proving the real provider can drive the direct implementation lane.

Do not split these separately at first:

```text
context route matrix
memory refresh
frontier baton
raw-window trimming
maintenance manifest
```

They are one context-maintenance family.

Do not split these separately at first:

```text
governance packet
transition legality
semantic broker packet
fallback/ask-human
```

They are one routing/governance diagnostics family.

Do not mix these into one mega-PR:

```text
implementation-lane tool authority
context maintenance/memory
sub-agent observability
```

They touch different authority surfaces.
