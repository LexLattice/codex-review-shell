# Fork, vanilla app-server, and Direct semantic comparison

Date: 2026-09-06. Scope: the old fork's distinctive semantic requirements,
their coverage in current vanilla source, and their realization in Direct.

The harness is the maintained product. The fork is a historical design donor;
this audit recommends no further fork development. Vanilla app-server and
Direct are two execution paths with different enforcement boundaries.

## Evidence boundary

| Surface | Inspected identity |
| --- | --- |
| Historical fork | `/home/rose/work/codex/fork`, `main` = `origin/main`, `923840b357e15195e66f7e82ac81ee0f39fc7050`, workspace version 0.125.0 |
| Vanilla source | `rust-v0.153.4`, peeled commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, equal to fetched `origin/upstream-latest-release` |
| Direct | `main` = `origin/main`, `e46b3effc95a3fe7e7eb3d3146106b87a5a6c352`; clean before this audit document |

Vanilla ratings describe inspected source, not the currently served app-server
binary. This audit did not launch or upgrade that binary, exercise a live
provider, or establish rollout support across model families. The standing
baseline document's August 0.147 runtime snapshot is historical evidence, not
proof of the current running version.

Ratings follow [baseline maintenance](../UPSTREAM_CODEX_BASELINE_MAINTENANCE.md):
vanilla `none / adjacent / partial / substantive / supersedes`; Direct
`none / modeled / partial / implemented / live-proven`. Ratings below apply to
the stated semantic obligation. Passing fixture tests does not promote a
capability to `live-proven`.

## Comparison

| Historical requirement | Vanilla source coverage and app-server use | Direct coverage | Disposition |
| --- | --- | --- | --- |
| Continuation bridge: retain the active goal, unfinished work, blockers, evidence, and next action across context loss | **Partial.** Experimental context management supplies rollover, history/notes, and configurable guidance. The harness can prescribe checkpoint content through instructions and exposed tools; no equivalent built-in ODEU checkpoint validation/admission contract was found. | **Partial.** Resident checkpoint request, strict payload validation, persistence, and report exist. Frontier baton and context-pack rendering exist separately. No production caller of the resident checkpoint request/persistence path was found. | **Finish Direct implementation; adopt vanilla adapter.** Share the semantic contract while recording which guarantees each adapter can enforce. |
| Durable ODEU thread memory: stable subjects, evidence, uncertainty, decisions, dependencies, and explicit deltas | **Adjacent.** Native notes and context persistence can carry content but do not establish these ODEU identities and transition laws. | **Partial for checkpoint continuity.** Durable memory carries source refs, confidence, staleness, conflicts, and digests. The separate epistemic kernel and context-delivery path already implement subjects, revisions, admission, and request-bound delivery. The resident checkpoint schema does not yet bind those structures into a complete continuity contract. | **Reframe.** Reference existing typed evidence from checkpoints; do not create a second canonical world model by copying the old JSON wholesale. |
| Refresh/prune and retention: separate semantic refresh from reducing context footprint | **Partial.** Current compaction and experimental rollover cover substantial mechanics; `thread/compact/start` exists. The old refresh/prune protocol and its semantic distinctions are not equivalent to that method. | **Partial.** Pressure estimates, omission/loss witnesses, compaction plans, gates, continuity transitions, and local execution-result artifacts exist. Provider compaction remains disabled in these maintenance gates. | **Reframe; finish Direct implementation.** Retire the old engine as a maintenance target while retaining the refresh/footprint distinction and loss accounting. |
| Strict governance and prompt layers: distinguish evidence, authority, policy, and legal transitions | **Partial.** Typed WorldState sections and managed instructions provide relevant substrate, alongside concrete permissions and tool controls. They do not impose the fork's ODEU governance law. | **Partial overall, with implemented institutions.** Legacy governance packets remain shadow diagnostics; concrete tool authorities and newer constitutional meta-roles/active worker policy are wired into runtime. | **Reframe.** Extend the actual authority owners; do not introduce a parallel global strict-v1 prompt governor. |
| E-witness observability: distinguish a running agent from material progress, blockers, and stalling | **Partial.** Agent lifecycle/status, messages, and waits exist. The inspected V2 list returns name/status, not the fork's material-progress sequence, first-progress and stall contract. Other events can supply evidence for an adapter. | **Partial.** Older progress/inspect packets exist; the native pool additionally carries capture progress and typed live-activity cursors with monotonicity checks. Its asynchronous wait resolves on terminal completion, not the old material-progress predicate. | **Finish Direct implementation.** Define material progress over existing event evidence and expose a distinct progress wait. Do not treat an event count alone as semantic advancement. |
| Child containment and parent control of worker realization | **Partial.** Roles, model/effort options, collaboration controls, V1 depth limits, and V2 child user-input restrictions cover portions. They do not establish the whole harness policy; V2 supports recursive delegation. | **Implemented for active worker realization policy; partial for the broader containment portfolio.** Revisioned task/project policy chooses provider, model, effort, context, and workspace dimensions; the native pool revalidates trusted decisions. Tool/authority policies remain separate. | **Keep and extend Direct policy; adopt bounded vanilla mappings.** Context handoff selection is not yet parent control of child checkpoint/rollover policy. |
| Semantic workflow broker: route by typed evidence and jurisdiction | **Adjacent.** Skills, plugins, roles, and tool discovery support selection, but do not establish typed semantic adjudication and promotion law. | **Partial for the legacy broker; implemented bounded successor.** `governance/broker.js` remains shadow/controlled routing. The production `semantic_router` meta-role and world-model semantic ingress are separate, newer institutions. | **Reframe.** Reuse those institutions and explicit effect adapters; preserve broker requirements without resurrecting its old heuristic overlay. |
| Custom fork builds and upstream-tracking helpers | **Substantive for the stock runtime distribution; external tracking still required.** | **Implemented adapter/configuration surfaces; no live binary verification in this audit.** | **Retire fork delta.** Keep exact vanilla release inspection and runtime compatibility evidence as harness maintenance. |

## Findings that change the implementation plan

### A checkpoint artifact is not yet a completed rollover

[Resident checkpoint](../../src/main/direct/context/resident-checkpoint.js)
has a concrete JSON shape: task state, open obligations, known facts,
uncertainties, source/artifact references, decisions, risks, and next actions.
Its validator rejects malformed shapes and authority leakage; its persistence
helper writes checkpoint evidence through the thread store. These are working
components, verified by a regression here.

The same module explicitly denies provider transport, provider compaction, and
automatic context mutation. Searches for its request and persistence helpers
found module-internal and regression callers, but no production orchestration
caller. Thus the unfinished boundary is request -> resident output -> validated
checkpoint -> admitted next request -> verified continuation.

[Context-pack construction](../../src/main/direct/thread/context-pack.js)
already accepts durable memory as quoted historical evidence and an eligible
baton as status evidence. It rejects a stale required baton. This is separate
from automatic resident-checkpoint admission. Also, the maintenance execution
result builder can report `executed` and pointer-update fields while building
an artifact; no production caller was found that makes this a complete live
maintenance operation.

### Rich semantic state already has a home

The old fork's thread-memory and rich-review schemas remain useful requirement
inventories: stable subjects, claim/evidence relationships, rejected paths,
uncertainty resolution, and deltas are stronger than an unstructured summary.
However, Direct's
[epistemic context delivery](../../src/main/direct/epistemic/context-delivery.js)
already has explicit admission, turn claiming, preparation, transport-attempt,
staleness, and supersession states. It is wired through the live-text controller
and main process. The regression verifies actual constructed provider input
using a mocked transport, including exact revision checks and one-shot delivery.

The appropriate extension is a small working-state checkpoint that references
these existing subjects, revisions, and obligations, plus any irreducible
continuation state. The checkpoint must not turn old model assertions into new
authority or duplicate canonical semantic state.

### Governance is distributed across concrete institutions

The executable registry identifies the older
[governance broker](../../src/main/direct/governance/broker.js) as `partial`,
`keep_shadow`. That does not describe all current Direct governance.
[Constitutional meta-roles](../../src/main/direct/worldmanager/constitutional-meta-role.js)
and [active worker policy](../../src/main/direct/agents/active-sub-agent-policy.js)
are marked `implemented`, with production consumers and passing regressions.
Only `semantic_router` is registered in the production default meta-role
registry; `auto_review` is an extensibility fixture. Runtime escalation/retry
must not be inferred from declared failure postures.

Consequently, the earlier suggestion to deprioritize the semantic broker as a
concept was too broad. Its old prompt overlay is a weak implementation donor;
typed routing, jurisdiction, provenance, and promotion remain central harness
requirements and already have newer Direct realizations.

### Activity and progress need an explicit relation

[Live-activity projection](../../src/main/direct/epistemic/live-activity-projection.js)
derives cursors and typed counts from persisted evidence.
[The native pool](../../src/main/direct/agents/native-agent-pool.js) checks
capture identity, legal status transitions, and nondecreasing evidence counts.
This is more than the older display-only observability modules alone suggest.

It still does not establish that every event is material progress. A successor
to the fork's E-witness should specify qualifying events, first progress,
blocker/stall evidence, and a wait predicate over that progress. Completion
waits and read-only activity inspection should retain their current meanings.

## Recommended next scope

1. Define one versioned continuity contract joining existing subject/revision
   refs, active goal and obligations, decisions/rejections, uncertainty, current
   worker state, and next action. Separate durable evidence from the short-lived
   execution baton, with explicit supersession and omissions.
2. Implement a bounded Direct checkpoint lifecycle through the existing
   admission and context-pack owners. Verify malformed/stale/cross-thread
   checkpoint rejection, interrupted generation, restart, and continuation
   after actual context loss before claiming rollover completion.
3. Add a vanilla capability adapter for the installed runtime's supported
   context-management guidance and tools. Record instruction-level guarantees
   separately from harness-validated artifacts. The managed app-server config
   helper inspected here adds multi-agent overrides; it does not itself wire
   the new context-management settings. Inherited user configuration was not
   assessed.
4. Extend worker policy with explicit checkpoint/retention choices where
   required, and connect material-progress witnesses to existing activity
   evidence. Preserve the distinction between observing a worker and acquiring
   authority to interfere with it.

These are recommendations, not implementation changes made by this audit.

## Verification

The information-bridge audit passed: 111 rows, 42 `implemented`, 67 `partial`,
2 `inherited`; zero invalid rows or missing source files. This validates the
registry structure and source existence, not the truth of every capability.

Ten existing Node regression scripts passed:

- `direct-resident-checkpoint-compaction-regression.mjs`
- `direct-memory-baton-compaction-productization-regression.mjs`
- `direct-context-maintenance-execution-gate-regression.mjs`
- `direct-governance-broker-regression.mjs`
- `direct-sub-agent-observability-regression.mjs`
- `direct-sub-agent-inspect-wait-containment-regression.mjs`
- `direct-constitutional-meta-role-regression.mjs`
- `direct-active-sub-agent-policy-regression.mjs`
- `direct-epistemic-context-delivery-regression.mjs`
- `direct-native-agent-pool-regression.mjs`

All used local fixtures or mocked provider transport. Scratch outputs and the
combined receipt are at `/tmp/three-way-semantic-audit-iLYur4/audit-tests.json`;
this temporary path is not durable evidence custody. The native-pool report's
provider-call count refers to its injected mock runner.

No live provider/app-server run, ARC SDK run, full Python suite, full harness
suite, or web gate was run. No runtime code, configuration, registry status, or
fork source was changed. The only maintained addition is this audit document.

## Vanilla and historical source locators

Read vanilla files with `git show rust-v0.153.4:<path>` in the fork checkout;
the checked-out files themselves are historical fork source.

- `codex-rs/features/src/feature_configs.rs`: `ContextManagementConfigToml`,
  `TokenBudgetConfigToml` (guidance, reminder, fallback prompt/buffer).
- `codex-rs/core/src/tools/handlers/new_context_window.rs`: rollover request.
- `codex-rs/core/src/context/world_state/mod.rs`: typed context sections.
- `codex-rs/app-server-protocol/src/protocol/common.rs`: compact RPC.
- `codex-rs/core/src/agent/control.rs` and
  `codex-rs/core/src/tools/handlers/multi_agents_v2/`: list/status and waits.
- Historical `codex-rs/context-maintenance-policy/templates/thread_memory/`
  and `templates/continuation_bridge/variants/`: donor schemas and prompts.
- Historical `codex-rs/agent-observability/src/progress.rs` and `wait.rs`:
  progress witness and wait semantics.
- Historical `codex-rs/core/src/governance/` and
  `codex-rs/core/src/semantic_broker_runtime.rs`: governance and broker donors.
