# Direct Dual-Environment Agents: Plan and Turn Log

Status: active. This is the working document for the dual-environment
track. Read it at the start of every turn, and update it at the end of every
turn before committing.

Last updated: 2026-10-06, after turn 2.

## How to use this document

1. Read **Next turn** and that turn's entry in **Turns**.
2. Do the turn. Keep its scope; record anything discovered outside it under
   **Findings** instead of fixing it in passing.
3. At the end of the turn, fill in its **Outcome** (what actually shipped, the
   commit, the checks run, and how it differed from the plan).
4. If the outcome changes later turns, edit those turns and add a row to
   **Plan changes** explaining why.
5. Move **Next turn**, update **Last updated**, and commit.

Status values: `planned`, `in progress`, `done`, `done with deviations`,
`blocked`, `dropped`.

## Goal

One UX in which native Windows agents and native WSL agents run side by side.

- A Windows agent sees PowerShell, Windows paths, and the Windows filesystem
  natively.
- A WSL agent sees bash, Linux paths, and the Linux filesystem natively.
- Neither agent reaches the other environment by prefixing commands with a
  wrapper such as `wsl.exe` or `powershell.exe`, and neither works through
  `\\wsl$` or `/mnt/c` as its primary filesystem.
- Work that needs the other environment is delegated to an agent running there.

Vanilla Codex does not offer this: its desktop app's agent environment is a
single global setting ([openai/codex#47115](https://github.com/openai/codex/issues/47115)).

## Architecture

One host, one native executor per environment.

```text
Electron host (Windows): UI · model transport · auth · grants · stores · model loop per thread
   │  NDJSON over stdio
   ├── Windows executor: native node on Windows
   │     PowerShell · C:\ paths · Windows sandbox · Job Objects
   └── WSL executor (one per distro): node inside WSL, launched once via wsl.exe
         bash -lc · /home paths · bubblewrap · PID namespace
```

The only place `wsl.exe` appears is the host launching the WSL executor. It
never appears in an agent command.

### Placement rule

A component needs one instance per environment only if it touches processes,
the filesystem, or OS semantics. Identity, state, policy, the model, and
presentation run once, in the host.

| Stage | Component | Instances |
|---|---|---|
| Launch | Electron UI, main process, IPC | 1 |
| | Environment registry and discovery | 1 |
| | Executor process | 1 per environment |
| Identity | Auth, credentials, usage and quota ledgers | 1 (tokens never reach an executor) |
| Project and thread | Project registry, thread/session/turn stores (SQLite), grant store | 1 (stores stay in host `userData`, single writer, never on `\\wsl$`) |
| | Folder browsing at project creation | per environment |
| Turn assembly | Context builder, packs, memory, compaction, tool composition | 1 (inputs fetched from the executor) |
| | Environment context block for the model | 1 (rendered from executor-reported facts) |
| Model call | Responses transport, event normalizer, transcript projection | 1 |
| Tool call | Parse, authorize, record obligation, admit result, continuation | 1 |
| | Shell sessions, filesystem, sandbox, process containment | per environment |
| Persistence | Durable state, recovery scanner | 1 (host DB is the source of truth) |
| | Live process handles and output buffers | per environment (lost handles become interrupted sessions) |
| Auxiliary | Git, worktrees, file watching, MCP stdio servers, hooks, skill scripts, PTY | per environment |
| | Sub-agent pool and scheduling | 1 (a child's tools go to its own environment's executor) |
| | Semantic service daemon | 1, pinned to WSL (needs Linux and bubblewrap) |

### Components to split

| Today | Host half | Executor half |
|---|---|---|
| `src/main/direct/tools/stateful-exec-session.js` | Session registry, grant check, budgets, timeouts, events | Spawn, stdin, kill, sandbox wrapping, containment |
| `src/main/direct/tools/full-access-local-environment.js` | Grant check, patch parsing and planning, result projection | Read bytes, apply planned writes, root check again |
| Context building | Selection, budgeting, rendering | Fetch `AGENTS.md`, file contents, git status |
| `src/main/direct/external/configured-mcp-adapter.js` | Trust, freshness, result envelope, authorization | Run the server process |
| `src/main/direct/tools/exec-sandbox.js` | Choose policy from the access profile | Run the OS-specific sandbox |

### Executor contract

Method names follow Codex's `exec-server` (`process/*`, `fs/*`) so the
executor could later be swapped for it.

- `environment/describe`: OS, shell and version, path style, home and temp,
  sandbox, containment, and PTY capabilities.
- `process/start`, `process/write`, `process/read`, `process/signal`,
  `process/wait`.
- `fs/read`, `fs/applyPlannedPatch`, `fs/list`, `fs/search`, `fs/stat`.
- `git/*`, `watch/*`, `mcp/start`, `mcp/request`, `mcp/stop`.

## Next turn

**Turn 3: WSL executor process sessions.**

## Gates for every turn

Run through a login shell (`wsl.exe -d Ubuntu -e bash -lc ...`): a non-login
shell picks up a Node without `node:sqlite`, and most regressions then fail.

- `npm run validate` must pass.
- `bash -l scripts/direct-regression-sweep.sh` (about 5 minutes; start it in
  the background). Its `FAILED` lines must match **Known failing checks**
  exactly. Any new failure is a regression introduced by the turn.
- The turn's own regressions.
- Executor regressions also run on the Windows host, straight from the WSL
  repo: `& 'C:\Program Files\nodejs\node.exe' \\wsl.localhost\Ubuntu\home\rose\work\LexLattice\codex-review-shell-direct\scripts\<name>.mjs`.
  Every executor turn's regression must pass on both hosts.

## Turns

### Turn 0: green baseline and spec

- Status: done with deviations
- Scope:
  - Fix the `normalizeConfiguredMcpServer is not defined` ReferenceError in the
    config-migration smoke so `npm run validate` runs end to end.
  - Triage the other known failures (see **Known failing checks**). Fix them if
    small; otherwise record them as accepted with a reason.
  - This document already serves as the spec; extend it only if triage
    changes the plan.
- Done when: `npm run validate` passes.
- Outcome:
  - `npm run validate` passes end to end. The migration smoke's VM sandbox was
    missing `normalizeConfiguredMcpServer`, which `main.js` now imports.
  - Fixed 10 regressions that failed before this track:
    - Stale provider fixtures returning objects with only `text()`. The
      transport deliberately requires a streaming body (PR #312 bounding) and
      rejects others as `max_output`. Switched to real `Response` objects:
      `direct-self-constitution`, `direct-fresh-fork-start`,
      `direct-import-checkpoint-continuation`, `direct-world-manager-k4`,
      `direct-world-manager-semantic-split`, `direct-world-manager-project-genesis`.
    - Fixtures missing the admitted provider context that utility continuations
      have required since the September 7 repair: `direct-native-agent-tool-routing`,
      `direct-sub-agent-status-tool-routing`, `direct-external-promoted-tool-routing`.
      They now record it with the controller's own `captureAdmittedProviderContext`.
    - `direct-self-constitution` also read only `input[0]`; continuations now
      replay the original input first.
  - One product fix: `src/main/direct/worldmanager/role-runtime.js` now passes
    `ownerControlled: true` when it starts manager turns. Without it, its
    per-turn effort choice was rejected as a stale runtime binding
    (`direct_turn_runtime_binding_stale`), failing every WorldManager role turn.
  - Added `scripts/direct-regression-sweep.sh` and the **Gates for every turn**
    section.
  - Deviation: the first full sweep found 20 more failures beyond the four
    originally listed (all also failing on `8ecf16e`). None are in this track's
    code; they are recorded under **Known failing checks** instead of fixed.
    Covering `direct.inspect_self_constitution` in the tool-class example pack
    was tried and reverted, because five downstream regressions pin example
    counts; fixing that cluster needs a classification decision.
  - Checks: `npm run validate` passes; full sweep 257 of 277 passing, with
    every failure listed below; `direct-access-profiles` passes.

### Turn 1: executor protocol, `environment/describe`, environment registry

- Status: done
- Scope:
  - Shared protocol module (proposed `src/shared/executor-protocol.js`) with
    method names and schemas.
  - `environment/describe` in `src/backend/wsl-agent.js`.
  - Host environment registry: the Windows host plus WSL distros from
    `wsl.exe -l -q` (decode UTF-16).
  - Keep one executor per project for now (consolidation is turn 11).
- Done when: describe reports bash/Linux inside WSL and PowerShell/Windows
  under Windows Node.
- Outcome:
  - `src/shared/executor-protocol.js`: protocol name and version, the full
    method-name table (`environment/describe`, `process/*`, `fs/*`), the list
    of methods actually implemented (only describe so far),
    `describeExecutionEnvironment`, a validator, and a public projection that
    strips raw paths. It has no dependencies, so both the host and executors
    load it.
  - `describeExecutionEnvironment` spawns nothing: shell facts come from the
    filesystem and environment. Windows prefers `pwsh` (major version from its
    install path) and falls back to Windows PowerShell 5.1. Linux reports bash
    at `/bin/bash`. Bash's exact version is left `unprobed`.
  - The agent answers `environment/describe`, and its `hello` now carries
    `executorProtocol` and an `environmentDescribe` capability.
  - `src/main/environment-registry.js`: discovers environments for whichever
    host it runs on, records how each executor would be launched
    (`local-child`, `wsl.exe`, or `windows-native-resident`), and describes an
    environment by attaching a throwaway probe executor with hygiene off,
    asking it, validating the answer, and disposing it. It is not wired into
    the app yet; turn 9 consumes it.
  - Verified on both hosts with real executors
    (`direct-environment-describe-regression`):
    - Linux host: Windows executor through interop reports `pwsh 7`, Windows
      paths, no containment; WSL executor reports bash, PID-namespace
      containment, and bubblewrap.
    - Windows host (Windows Node running the script over its UNC path): WSL
      executor through `wsl.exe` reports bash; local Windows executor reports
      `pwsh 7`.
  - Checks: `check:syntax` and `validate` pass; the new regression passes on
    both hosts; full sweep 258 of 278 passing, failures identical to
    **Known failing checks**.

### Turn 2: host exec router

- Status: done
- Scope: split `stateful-exec-session.js` into a host router (registry, grant
  check, budgets, timeouts, events) and an executor backend interface. The
  existing in-process local spawner becomes backend #1.
- Done when: no behavior change; all existing exec, harness, continuation, and
  access-profile regressions pass unchanged.
- Outcome:
  - New `src/main/direct/tools/exec-process-backends.js` defines the backend
    contract and `LocalChildProcessBackend`, a verbatim move of the old
    workspace/cwd resolution, sandbox planning, spawn, and process-tree kill.
  - The backend contract has three steps, matching where errors must land:
    - `resolveWorkspace(input, grant)` and `planLaunch(spec)` may throw
      before any session exists (bad cwd, no sandbox). The controller's
      actionable-error path depends on these being thrown.
    - `launch(plan, { cwd, env })` returns a process handle; a throw here
      becomes a `failed` session, as before.
  - The process handle contract: `onStdout`, `onStderr`, `onStdoutError`,
    `onStderrError`, `onStdinError`, `onError`, `onClose`, `stdinWritable`,
    `writeStdin`, `endStdin`, `kill(signal)` (whole tree). UTF-8 decoding,
    budgets, timers, and settlement stay in the router.
  - `DirectStatefulExecSessionManager` keeps its public API and constructor
    options (`spawnImpl`, `sandbox`, `workspaceRootResolver`,
    `workspaceLocalityResolver` now configure the local backend) and gains
    `backendResolver(input, grant)`. Turn 3 plugs the WSL executor backend in
    through it. Records gain `backendId` and `process` (the handle);
    `record.child` remains the raw ChildProcess for local sessions and is
    `null` otherwise.
  - New `direct-exec-backend-router-regression`: a scripted child-less backend
    (UTF-8 split chunks, stdin and EOF, cancel and failure kill paths,
    plan-time refusals versus launch failures, missing backend) and a relay
    backend that hides a real process behind a forwarding handle, whose public
    result matches the local backend's exactly.
  - Checks: the 10 exec-related regressions pass unchanged; the router
    regression and `direct-stateful-exec-session` pass on both hosts;
    `check:syntax` and `validate` pass; full sweep 259 of 279 passing,
    failures identical to **Known failing checks**.

### Turn 3: WSL executor process sessions

- Status: planned
- Scope:
  - `process/*` in the agent: bash, PID-namespace containment, and bubblewrap
    (sandbox wrapping moves into the executor).
  - Output streamed over NDJSON with bounded buffers.
  - Router backend #2 forwards to the thread environment's executor. It
    implements the turn 2 backend contract: `resolveWorkspace` and
    `planLaunch` become executor requests (or host-side checks), and `launch`
    returns a handle fed by executor output and exit events. Wire it in
    through `backendResolver`, keyed on the grant's environment kind and host.
  - Executor death marks its sessions interrupted, never silently re-run.
- Done when: the regression passes on a Linux host, and a cross-host smoke
  run under Windows Node drives the WSL executor over `wsl.exe`.
- Outcome: _(fill in)_

### Turn 4: WSL executor filesystem

- Status: planned
- Scope:
  - `fs/read` and `fs/applyPlannedPatch` in the executor; the host still plans
    patches and the executor rechecks the root.
  - Replace the locality gate in `fullAccessLocalBinding` with routing by
    environment.
  - Decide the credential exposure policy (Full access in WSL can read the
    host auth store through `/mnt/c`).
- Done when: `direct-access-profiles` passes against the executor backend too.
- Outcome: _(fill in)_

### Turn 5: model contract per environment

- Status: planned
- Scope: environment context block in every turn; shell-specific
  `exec_command` and `apply_patch` descriptions; the self-constitution
  snapshot reports the environment.
- Done when: a request-shape regression shows bash descriptions for WSL
  threads and PowerShell descriptions for Windows threads. Optional: one live
  WSL turn from the Windows launcher.
- Milestone: WSL agents fully native from the Windows host.
- Outcome: _(fill in)_

### Turn 6: Windows containment and sandbox spike (time-boxed)

- Status: planned
- Scope: check whether the installed Codex package's Windows sandbox runner
  (`codex-windows-sandbox`, Apache-2.0) covers Job Object kill-on-close, tree
  kill, and a workspace-write restricted token. If not, choose a minimal
  native helper.
- Done when: a written decision plus a proof script. No production code.
- Outcome: _(fill in)_

### Turn 7: Windows executor

- Status: planned
- Scope:
  - PowerShell sessions (`pwsh`, fallback Windows PowerShell 5.1,
    `-NoProfile -NonInteractive`, UTF-8 output) with Job Object containment.
  - Full access first; Workspace and Read only through the sandbox if turn 6
    was positive, otherwise refused with a clear message.
  - Filesystem read and patch with CRLF preserved.
- Done when: the regression passes under Windows Node.
- Milestone: Windows-native agents.
- Outcome: _(fill in)_

### Turn 8: MCP servers and hooks per environment

- Status: planned
- Scope: MCP server configs name their environment; executors run stdio
  servers (`mcp/*`); the host keeps trust, freshness, and the result envelope.
  Hooks and skill scripts use the same routing.
- Outcome: _(fill in)_

### Turn 9: Workbench UX

- Status: planned
- Scope: environment picker at project creation; native folder browsing
  through the executor; environment and Access badges on projects, threads,
  and the composer; both environments side by side; remove Direct · text as a
  top-level choice; fix `direct-t3-alternate-gui-regression` (missing
  `morphicObservationsButton` id in the Workbench HTML).
- Done when: a renderer regression passes and a manual Electron smoke by the
  owner succeeds.
- Outcome: _(fill in)_

### Turn 10: cross-environment delegation

- Status: planned
- Scope: `spawn_agent` can target another environment; the child thread is
  bound there with a grant derived from the parent under an explicit owner
  policy for crossing environments.
- Outcome: _(fill in)_

### Turn 11: one executor per environment, PTY, Terminal panel

- Status: planned
- Scope: executors serve multiple project roots; PTY sessions (ConPTY on
  Windows, a pty mechanism in WSL); a Terminal panel. May split into two turns.
- Outcome: _(fill in)_

## Baseline and prerequisites

| Item | State |
|---|---|
| Thread access profiles (Read only / Workspace / Full access), sandboxed exec on Linux, preflight fail-open, Workbench routing not required | Done in `1c65a49`. Gate: `npm run direct:access-profiles`. |
| Windows test tooling | Present: Node 24, PowerShell 7, Codex CLI (npm), mirror at `C:\LexLattice\codex-review-shell-direct`. |
| WSL distros | `Ubuntu`, `docker-desktop`. `wsl.exe -l -q` output is UTF-16. |
| bubblewrap in WSL | 0.9.0, works with unprivileged namespaces. |

## Known failing checks

Expected `FAILED` lines from `scripts/direct-regression-sweep.sh` as of turn 0.
All of these also fail on `8ecf16e`, before this track started. Remove a row
when a turn fixes it; never add a row for a failure a turn introduced.

**Need something this machine doesn't provide (7):**

| Regression | Needs |
|---|---|
| `direct-arcagi3-workspace-workers-regression` | ArcAGI3 repo at `/home/rose/work/arcagi3-odeu-local` |
| `direct-container-ui-test-stack-regression` | Docker image build |
| `direct-electron-read-approval-regression` | Live provider opt-in (`--allow-live-provider-call`) |
| `direct-governance-live-non-authority-regression` | Live provider opt-in |
| `direct-semantic-service-commissioning-regression` | `DIRECT_SEMANTIC_COMPILER_ROOT` |
| `direct-semantic-service-commissioning-recovery-regression` | `DIRECT_SEMANTIC_COMPILER_ROOT` |
| `direct-semantic-service-dss04-regression` | `DSS04_COMPILER_ROOT` at the pinned commit |

**Stale expectations outside this track (13):**

| Regression | Failure |
|---|---|
| `direct-headless-tool-class-examples-regression` | Example pack doesn't cover `direct.inspect_self_constitution`. |
| `direct-headless-tool-live-candidate-gate-regression` | Same example-pack validation failure. |
| `direct-headless-tool-live-smoke-report-regression` | Same. |
| `direct-headless-tool-realism-report-regression` | Same. |
| `direct-tool-activation-registry-regression` | Same. |
| `direct-tool-promotion-decision-report-regression` | Same. |
| `direct-manual-smoke-gate-regression` | Pins 38 registry rows; there are 111. |
| `direct-module-context-intake-regression` | Pins 37 registry rows; there are 111. |
| `direct-manual-smoke-gate-surface-regression` | Gate state `blocked`, expected `passed`. |
| `direct-external-wave18-usability-gate-regression` | `mcp_resource_read_binary_not_ref_only`. |
| `direct-t3-alternate-gui-regression` | Workbench HTML lacks the `morphicObservationsButton` id (see turn 9). |
| `direct-world-manager-semantic-ingress-regression` | Tool-output count mismatch. |
| `direct-world-manager-semantic-ui-regression` | Contract text no longer says "completion has not been claimed". |

## Findings to carry forward

Discovered during planning; not in any turn's scope unless a turn adopts them.

- Every Workbench implementation turn first runs a separate model call for the
  sub-agent policy preflight (latency and quota).
- Autonomy limits within one turn: exec continuations stop after 8 steps;
  after a command the model may only run more commands, not read or patch;
  a patch conflict fails the whole turn; after a human-decision tool the
  continuation declares no tools.
- A blocking `request_permissions` prompt is deferred until the continuation
  loop can keep tools available after human decisions.
- Configured MCP stdio servers are spawned by the host
  (`configured-mcp-adapter.js:572`), so a WSL-configured server cannot run from
  a Windows host until turn 8.
- The Windows workspace backend refuses commands
  (`workspace_windows_job_object_containment_unavailable`) until Job Object
  containment exists (turn 7).
- The transport reports a provider body it can't read incrementally as
  `max_output`, which surfaces to users as `max_output_terminal`. A distinct
  code (for example `provider_body_not_streamable`) would be clearer.
- In WSL, a non-login shell resolves a Node without `node:sqlite`. Executor
  launch (turn 1 onward) must use a login shell, as `launchDescriptor` already
  does with `bash -lc`.
- This distro has no `wsl.exe` on PATH (Windows path not appended). The
  registry falls back to `/mnt/c/Windows/System32/wsl.exe`; any other code
  calling `wsl.exe` from inside WSL needs the same fallback.
- From a WSL host, executors for other WSL distros are listed but marked
  unavailable (`cross_distro_launch_unsupported`); `launchDescriptor` would
  start them locally in the wrong distro. Windows hosts are unaffected.
- The executor is already symmetric: from a WSL host it launches a Windows
  executor with Windows `node.exe` over a UNC path (`windows-native-resident`),
  which makes Windows behavior testable without leaving Linux.

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-10-06 | One host, one native executor per environment | Single UI, DB, auth, and grants; each agent stays native. Matches Codex's `exec-server` direction. |
| 2026-10-06 | Extend our own Node executor; model its protocol on Codex `exec-server` | Already runs in both environments over stdio and carries existing custody work; `exec-server` is experimental and websocket-based. Matching shapes keeps a swap possible. |
| 2026-10-06 | Keep per-project executors until turn 11 | Equivalent for agent nativeness; avoids an early refactor with no user-visible value. |
| 2026-10-06 | `environment/describe` never spawns a process | The Windows executor may not create processes before Job Object containment exists, and describe must work everywhere. Versions that need a process (bash) stay `unprobed`. |
| 2026-10-06 | Executor regressions run on both hosts from one file | Windows Node can run the WSL repo's scripts over the UNC path, so each executor turn verifies both launch directions without syncing the Windows mirror. |

## Plan changes

| Date | After turn | Change | Reason |
|---|---|---|---|
| 2026-10-06 | 0 | Added a full regression sweep to every turn's gates, with an expected-failures list. | The four originally known failures were a sample; the sweep found 20 more, so "validate passes" alone can't detect regressions. |
| 2026-10-06 | 0 | Turn 9 also fixes `direct-t3-alternate-gui-regression`. | It pins Workbench DOM ids, which turn 9 changes anyway. |
