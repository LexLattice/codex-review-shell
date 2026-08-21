# Codex Goal Command ODEU Map

Status: static inspection reference for how upstream Codex currently implements
the `/goal` command, thread goal app-server methods, and model-visible goal
tools.

This document is an ODEU map, not an implementation proposal. It describes the
current vanilla Codex behavior so `codex-review-shell` can project goal state
truthfully when the active runtime exposes it.

## Source Baseline

Upstream Codex checkout inspected:

- Path: `/home/rose/work/codex/fork`
- Branch: `upstream-latest-release`
- Tag: `rust-v0.134.0`
- Commit: `a75c443fdb64db48c3cf4bdb247c7ee52c0144c9`
- Inspection mode: static source inspection
- Runtime observation: not observed for this document

Host shell checkout:

- Path: `/home/rose/work/LexLattice/codex-review-shell-direct`
- Branch: `main`

Primary upstream files:

- `codex-rs/core/src/goals.rs`
- `codex-rs/core/src/tools/handlers/goal_spec.rs`
- `codex-rs/core/src/tools/handlers/goal/*.rs`
- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/templates/goals/continuation.md`
- `codex-rs/core/templates/goals/budget_limit.md`
- `codex-rs/core/templates/goals/objective_updated.md`
- `codex-rs/state/src/model/thread_goal.rs`
- `codex-rs/state/src/runtime/goals.rs`
- `codex-rs/protocol/src/protocol.rs`
- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `codex-rs/app-server/src/request_processors/thread_goal_processor.rs`
- `codex-rs/tui/src/chatwidget/slash_dispatch.rs`
- `codex-rs/tui/src/app/thread_goal_actions.rs`
- `codex-rs/tui/src/chatwidget/goal_status.rs`

There is also `codex-rs/ext/goal`, but its `lib.rs` describes that crate as an
extension sketch that is intentionally not wired into the host yet. The active
0.134 implementation inspected here is the core-native implementation.

## ODEU Legend

`O` means the object whose state exists independently of any one UI projection.

`D` means the decision or transition that can mutate or advance that object.

`E` means the evidence source that proves the object or transition happened.

`U` means the lawful UX or orchestration posture for this shell.

## Core Object Model

### O: `ThreadGoal`

The canonical user-facing goal object is `ThreadGoal`:

```ts
type ThreadGoal = {
  threadId: string;
  objective: string;
  status:
    | "active"
    | "paused"
    | "blocked"
    | "usage_limited"
    | "budget_limited"
    | "complete";
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};
```

The state database version also stores an internal `goal_id`. The storage rule
is one current goal row per thread id. `replace_thread_goal` resets the
objective, usage counters, and internal goal id for that thread; `insert` fails
if the thread already has a goal.

### Object Boundaries

```text
Thread
  owns at most one persisted ThreadGoal row

Turn
  may be started by operator input, queued input, or goal continuation
  contributes token/time accounting to the active ThreadGoal

GoalRuntime
  tracks active-goal accounting snapshots, budget steering, and continuation
  launch guards inside the running core session
```

The goal is per thread, not global to a repo, project, branch, worktree, or
human objective. It is a long-horizon thread continuation mechanism, not a full
work-thread broker.

## Evidence Model

### E: Persisted State

Goal truth is stored in SQLite through `GoalStore` over `thread_goals`.

Persisted fields:

- `thread_id`
- `goal_id`
- `objective`
- `status`
- `token_budget`
- `tokens_used`
- `time_used_seconds`
- `created_at_ms`
- `updated_at_ms`

The persisted row is the durable object. TUI labels, app-server notifications,
and model tool outputs are projections of that row plus runtime accounting.

### E: Protocol Events

Core emits `EventMsg::ThreadGoalUpdated(ThreadGoalUpdatedEvent)` when a goal
changes from model tools or core runtime paths.

App-server exposes the same state as:

- request methods:
  - `thread/goal/set`
  - `thread/goal/get`
  - `thread/goal/clear`
- notifications:
  - `thread/goal/updated`
  - `thread/goal/cleared`

On thread resume, app-server sends a goal snapshot notification before allowing
core to start an idle continuation. This ordering prevents the client from
seeing continuation activity before the resumed goal state.

### E: Model Tool Outputs

When enabled, the model can call:

- `get_goal`
- `create_goal`
- `update_goal`

These tools return the current goal state and usage fields. `update_goal` only
accepts `complete` or `blocked`.

### E: Runtime Accounting

Goal accounting comes from core runtime state:

- turn start captures active goal and token baseline;
- tool completions account progress and may trigger budget steering;
- `update_goal` completion suppresses duplicate terminal metric accounting;
- wall-clock accounting is updated before external mutations;
- usage-limit events can move an active goal to `usage_limited`;
- budget-limit checks can move an active goal to `budget_limited`.

`thread/tokenUsage/updated` and usage ledger rows are separate evidence
surfaces. They can help explain a turn, but they are not the authoritative
source of the goal row.

## Decision Surface

### D: TUI `/goal`

`/goal` is a TUI operator command gated by `Feature::Goals`.

Observed command posture:

```text
/goal
  opens or displays goal controls for the current materialized thread

/goal <objective>
  sets or replaces the thread goal objective
  confirms before replacing an existing non-complete goal

/goal clear
  clears the current thread goal

/goal edit
  opens the goal edit flow

/goal pause
  pauses the active goal

/goal resume
  resumes a paused, blocked, usage-limited, or budget-limited goal
```

The TUI command is not the integration boundary for this shell. It is useful as
behavioral reference, but `codex-review-shell` should use app-server methods and
notifications.

### D: App-Server Methods

`thread/goal/set` accepts:

- `thread_id`
- optional `objective`
- optional `status`
- optional nullable `token_budget`

Important behavior:

- rejects when `Feature::Goals` is disabled;
- rejects ephemeral threads that do not have a materialized rollout;
- validates objective length and non-emptiness;
- validates budget if provided;
- reconciles rollout state before mutating goal state;
- accounts progress before mutating a running thread's goal;
- emits response and ordered update notification;
- applies runtime effects to a running thread after persistence.

`thread/goal/get` reads the persisted goal for a materialized thread.

`thread/goal/clear` clears the persisted goal and clears stopped-goal runtime
state.

### D: Model Tools

Tool registration is gated by:

```text
turn_context.goal_tools_supported
and Feature::Goals enabled
```

Model tool law:

- `create_goal` may create a goal only when explicitly requested by the user or
  system/developer instructions.
- `create_goal` fails if the thread already has a goal.
- `get_goal` is read-only.
- `update_goal` can only mark the existing goal `complete` or `blocked`.
- The model cannot use `update_goal` to pause, resume, budget-limit, or
  usage-limit a goal.

The active `update_goal` description includes a strict blocked rule: use
`blocked` only after the same blocking condition recurs for at least three
consecutive goal turns, counting the original/user-triggered turn and automatic
continuations. After resume, the blocked audit starts fresh.

### D: Runtime Continuation

The runtime owns the transition from "turn finished" to "continue goal".

The core dispatcher handles:

- `TurnStarted`
- `ToolCompleted`
- `ToolCompletedGoal`
- `TurnFinished`
- `MaybeContinueIfIdle`
- `TaskAborted`
- `UsageLimitReached`
- `ExternalMutationStarting`
- `ExternalSet`
- `ExternalClear`
- `ThreadResumed`

Idle continuation is attempted only when all of these are true:

- goals feature is enabled;
- active goal exists;
- plan mode is not active;
- no active turn exists;
- no queued input exists;
- no trigger-turn mailbox input is pending;
- thread is materialized, not ephemeral;
- state DB can be opened;
- the goal did not change between candidate selection and launch.

The continuation turn is started with a model-visible goal-context input item
rendered from `core/templates/goals/continuation.md`.

## Turn Sequence

### Operator Starts A Goal

```text
operator enters /goal <objective>
  -> TUI validates command and current thread
  -> TUI confirms replacement if an existing non-complete goal exists
  -> app-server thread/goal/set
  -> state DB inserts or updates thread_goals row
  -> app-server emits thread/goal/updated
  -> TUI/footer or shell projection updates goal witness
  -> core marks active-goal accounting if the thread is running
  -> if idle and active, core may start a continuation turn
```

### Agent Creates A Goal

```text
model calls create_goal
  -> core validates feature and explicit-create tool contract
  -> GoalStore insert_thread_goal
  -> active accounting baseline is captured
  -> EventMsg::ThreadGoalUpdated is emitted
  -> tool output returns the goal snapshot
```

This path is model-initiated, but the tool spec tells the model not to infer a
goal from ordinary tasks.

### Active Goal Continues

```text
turn starts
  -> core records token baseline and active goal id

turn performs work
  -> tool completions update token/time progress
  -> budget-limit steering may be injected if budget is reached

turn finishes
  -> core finalizes progress accounting
  -> if goal is still active and no user input is queued
  -> MaybeContinueIfIdle may launch a new continuation turn
```

The second turn is a separate turn. The same worker model receives a
continuation prompt and is asked to keep working, audit completion, or mark the
goal blocked only under the strict repeated-blocker rule.

### Agent Completes Or Blocks A Goal

```text
model calls update_goal({ status: "complete" | "blocked" })
  -> core accounts progress with goal-tool terminal handling
  -> state DB updates status
  -> EventMsg::ThreadGoalUpdated is emitted
  -> tool output returns final goal snapshot
  -> active accounting is cleared for stopped statuses
  -> automatic continuation stops
```

`complete` is a claim that the full objective is achieved. `blocked` is a claim
that the strict repeated-blocker audit was satisfied. Codex does not run a
separate auditor agent before accepting these tool calls.

### Budget Limit

```text
token budget reached
  -> core marks goal budget_limited
  -> budget-limit prompt is injected
  -> agent is instructed to wrap up
  -> agent must not call update_goal unless the goal is actually complete
```

Budget limit is system-controlled status, not a model-selected status.

## Utility Posture

### U: What `/goal` Actually Provides

The goal feature provides:

- persisted thread objective;
- usage and elapsed-time accounting;
- app-server-visible goal snapshots;
- TUI-visible status;
- automatic follow-up turns while the goal remains active;
- model-visible tools for reading, creating, and terminally updating the goal.

This is a long-horizon persistence and continuation mechanism. It is not a
full institutional workflow runner.

### U: What It Does Not Provide

The current implementation does not provide:

- a distinct auditor agent;
- a meta-orchestrator that routes artifacts by role;
- separate worker/auditor contracts;
- external proof that the objective is complete;
- global project/work-thread routing;
- goal state across multiple threads or repos;
- ADEU stage semantics;
- branch/workspace/objective ontology resolution.

The same worker agent that advances the task is also asked to perform the
completion and blocked audits. From an ODEU lens, that means object-level
validity is not certified by a separate role. The goal row records a status
claim, not an independently adjudicated institutional artifact.

## Shell Integration Posture

### Lawful Projection

`codex-review-shell` should treat goal state as runtime evidence:

```text
app-server thread/goal/get
  + thread/goal/updated
  + thread/goal/cleared
  -> ShellGoalProjection
  -> header/drawer/bottom-band/analytics witness
```

The renderer should not infer an active goal from:

- stop/send button state;
- active turn state alone;
- transcript text;
- a continuation-looking assistant message;
- a local cached title or project binding.

### Suggested Shell Objects

```ts
type ShellGoalProjection = {
  schemaVersion: 1;
  threadId: string;
  status:
    | "active"
    | "paused"
    | "blocked"
    | "usage_limited"
    | "budget_limited"
    | "complete"
    | "none"
    | "unknown";
  objectivePreview?: string;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  updatedAt?: number;
  evidence:
    | "thread_goal_get"
    | "thread_goal_updated"
    | "thread_goal_cleared"
    | "resume_snapshot"
    | "unavailable";
};
```

This projection is a witness. It should not become the source of truth for goal
mutation.

### Runtime UI Guidance

- Show goal status separately from active-turn status.
- If a goal is active while no visible turn is running, show "goal active,
  waiting/idle" rather than implying the goal is complete.
- If a turn is running without an active goal, show ordinary runtime activity.
- If app-server reports goal unavailable, render unavailable/unknown, not
  success.
- If the user wants goal controls, use app-server `thread/goal/*`; do not parse
  `/goal` text locally as the control plane.

### Authority Boundary

Goal mutation is thread-state mutation. It should be main-process owned and
evidence-backed.

Renderer controls may request:

- set goal objective;
- clear goal;
- pause/resume goal;
- read goal state.

Renderer controls must not:

- mark a goal complete on behalf of the model;
- claim blocked/completed without an app-server result;
- silently create a goal for ordinary user messages;
- merge goal state across unrelated Codex threads;
- treat goal completion as ADEU artifact validity.

## ODEU Summary

```text
O:
  Persisted per-thread ThreadGoal row plus running GoalRuntime accounting.

D:
  /goal command, app-server thread/goal methods, model goal tools, and runtime
  continuation events mutate or advance the goal state.

E:
  SQLite thread_goals row, ThreadGoalUpdated/Cleared events, app-server
  responses, model tool outputs, and runtime token/time accounting.

U:
  Long-horizon per-thread continuation and status witness. Useful for keeping a
  task alive across turns, but not a substitute for a role-separated ADEU
  worker/auditor/meta-orchestrator loop.
```

## Implications For Future Work

If we add goal UX in this shell, implement it as a projection over app-server
goal evidence first:

1. Read `thread/goal/get` on live attach/resume.
2. Subscribe to `thread/goal/updated` and `thread/goal/cleared`.
3. Render a compact goal witness separate from send/stop/steer state.
4. Add explicit goal controls only after mutation flows are main-process
   mediated and thread-scoped.
5. Keep ADEU work-thread broker/orchestrator semantics separate from vanilla
   Codex `/goal`.

For direct-runtime work, the useful lesson is not "reuse `/goal` as the whole
orchestrator." The useful primitive is: persist an objective-bearing state
object, route turn-finished events through a controller, and expose only typed
status mutations backed by explicit role contracts.
