# Upstream Codex 0.147 Agent-Runtime Impact Audit

Audit date: 2026-08-09.

## Baseline

The local upstream-tracking fork was inspected at:

```text
repository: /home/rose/work/codex/fork
stable ref: origin/upstream-latest-release
commit:     be6e8eac029b183056b7e4402879f15d2c85f61b
version:    0.147.0
compare:    rust-v0.146.0...rust-v0.147.0
```

`origin/upstream-latest-published` had already advanced to a moving 0.148
alpha, so release-147 conclusions below are pinned to the stable release ref
rather than inferred from that moving branch.

## Answer To The Two Observed Vanilla Limitations

### Concurrency

Release 0.147 has configurable local multi-agent capacity rather than a
source-level universal three-child law:

```text
Config.agent_max_threads
agents.max_concurrent_threads_per_session
Config.effective_agent_max_threads(...)
AgentControlState::reserve_spawn_slot(...)
```

For multi-agent v2, `effective_agent_max_threads()` subtracts the primary
thread from the configured per-session concurrency. The spawn controller then
reserves a centralized slot before starting a child.

This means the root-plus-three limit observed in the desktop task was a
host/environment contract, not the only capacity supported by Codex source. It
also validates the architecture of the Direct pool: one shared limiter is
preferable to each parent inventing its own worker count.

### Context Handoff Versus Model/Effort

In both v1 and v2 release-147 spawn handlers, the code calls
`apply_requested_spawn_agent_model_overrides(...)` whether or not the spawn is
a full-history fork. That helper independently applies the requested model and
reasoning effort after validating them against the available model catalog.

Therefore the source runtime in 0.147 does **not** inherently require the
model/effort-versus-full-history binary exposed by the observed hosted tool
schema. The remaining 0.147 coupling is narrower: v2 rejects `agent_type` on a
full-history fork and preserves the parent's role/instructions instead.

Commit `82b17bc724aa789c482d29c02a399faf3e2eafcf` (`#37252`, after the
0.147 release and present in the moving published-alpha ref) removes that v2
role restriction and correctly composes an explicit role with full history.

Direct disposition: expose model, effort, role label, and history mode as
orthogonal inputs now, while keeping role-specific instruction compilation a
separate future authority boundary.

## Relevant 0.147 Changes

| Commit | Upstream change | Direct relevance |
| --- | --- | --- |
| `9873cba8ce` | Consolidate spawning behind `ThreadSpawnRequest` (#36862) | Use one normalized launch object and centralized validation. |
| `6d4d9442c7` | Support leaf models in multi-agent v2 (#36892) | Child model choice should come from model capability evidence, not parent identity. |
| `92b83e226d` | Track multi-agent usage hints in world state (#37189) | Keep usage attribution per child and never fabricate missing usage. |
| `fe01054a28` | Inherit ready step environments on spawn (#35895) | Adopt when Direct children receive workspace tools/substrate bindings. |
| `49025589b0` | Configurable developer instructions for v2 subagents (#35708) | Supports future role-compiled child constitutions. |
| `2f19a57704` | Preserve multi-agent settings across config representations (#35656) | Pool limits/defaults must survive every config projection before UI exposure. |
| `e597169e9a` | Keep registry identities consistent (#35744) | Stable child/task identity is required across list, inspect, wait, and future resume. |
| `9a6668f674` | Report direct-input capability for listed subagents (#35944) | Follow-up UI must be gated by effective child capability, not lifecycle state alone. |
| `1def0a8925` | Track parent turns for nested requests (#35835) | Direct child lineage should bind parent session and parent turn separately. |
| `1ae2b9880e` | Avoid cloning rollout history when truncating forks (#35982) | Recent-turn context should be selected/projected, not implemented by cloning full histories. |
| `7431f10d0d` | Identify agents by name in token-budget context (#36815) | Stable task names improve budget evidence and operator comprehension. |
| `eeae88d8a6` | Opt-in concurrent exec-server request dispatch (#36987) | Relevant to the backup app/exec-server path; Direct should keep its own scheduler. |

## Fork And Direct Comparison Matrix

The fork comparison target is `origin/main` at
`923840b357e15195e66f7e82ac81ee0f39fc7050`. That lineage contains its own
0.125-era multi-agent alignment plus fork-specific observability, containment,
governance, and semantic-broker work. It is not assumed to inherit 0.147 merely
because the separate release-tracking ref moved.

The coverage and disposition terms below are the exact controlled vocabulary
from [Upstream Codex Baseline Maintenance](../UPSTREAM_CODEX_BASELINE_MAINTENANCE.md).

| Conceptual family | Fork `origin/main` evidence | Vanilla coverage | Direct coverage | Conceptual disposition | Bounded judgment |
| --- | --- | --- | --- | --- | --- |
| Shared collaboration capacity | One `agent_max_threads` limit and centralized spawn-slot reservation exist, but V2 rejects the fork's `agents.max_threads` setting. | `substantive` | `implemented` | `adopt vanilla adapter` | App-server compatibility should adopt 0.147's effective V2 limit; Direct retains its process-shared scheduler rather than delegating semantic policy to Codex. |
| History handoff versus child model/effort | Both fork spawn handlers explicitly reject model and effort overrides for full-history forks. | `supersedes` | `implemented` | `retire fork delta` | The restriction is obsolete for model/effort in 0.147 source. Direct already proves full-history Terra/low under a Sol/Ultra parent. |
| Normalized spawn request | Fork handlers assemble spawn configuration inline around legacy/v2 argument shapes. | `substantive` | `implemented` | `reframe` | Direct keeps its own normalized launch record and provider route; app-server adapters may consume `ThreadSpawnRequest` evidence without importing Codex custody. |
| Ready step-environment inheritance | Fork spawn options carry environment context, but not the exact 0.147 ready-step inheritance contract. | `substantive` | `partial` | `finish Direct implementation` | Direct has environment topology and project-profile foundations; native-pool child binding remains a separately gated maturity step. |
| Role/developer-instruction compilation and config survival | Fork roles and defaults exist, but full-history role/model restrictions and config projections predate the 0.147 behavior. | `substantive` | `partial` | `finish Direct implementation` | Direct exposes a role label but does not yet compile role-specific child constitutions and tool bundles. |
| Stable identity, parent-turn lineage, and direct-input truth | Fork has agent paths and lifecycle observability, but lacks the complete 0.147 identity/direct-input/parent-turn combination. | `substantive` | `partial` | `finish Direct implementation` | Direct has stable child IDs, task names, and parent-agent scope; exact parent-turn binding and follow-up capability remain pending. |
| Per-child usage evidence | Fork has agent observability but not 0.147 multi-agent world-state usage hints. | `substantive` | `implemented` | `reframe` | Direct emits attribution only from provider token evidence and an explicit unavailable row otherwise; provider hints may become adapter evidence, never fabricated truth. |
| Concurrent exec-server dispatch | Fork contains the earlier exec-server substrate without the 0.147 opt-in dispatcher. | `substantive` | `none` | `defer` | Exec-server remains a backup protocol. Direct's native scheduler is authoritative unless a bounded adapter is selected later. |

## Adopted In The Current Direct Slice

The Direct-native pool adopts the relevant structural lessons without
depending on app-server or exec-server collaboration:

```text
one process-shared capacity limiter;
asynchronous launch plus bounded queue;
stable child ID and task-name scope;
full / recent-N / no-history context selection;
independent model and reasoning-effort selection;
list, inspect, and wait over one lifecycle record;
per-child usage attribution only when provider evidence exists;
reduced terminal summaries instead of parent-transcript flattening.
```

## Deferred From Upstream

Not yet adopted into this bounded reasoning-only slice:

```text
ready environment and workspace-tool inheritance;
role-specific developer-instruction compilation;
recursive spawning and depth control;
direct input/follow-up into live children;
durable restart/resume;
provider-visible usage and concurrency hints in the broader world state.
```

Those should be added only with the corresponding Direct authority,
persistence, and evidence contracts. The existence of upstream mechanics is
useful implementation evidence; it does not replace Direct semantic ownership.
