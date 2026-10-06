# Direct Dual-Environment Agents: Plan and Turn Log

Status: active. This is the working document for the dual-environment
track. Read it at the start of every turn, and update it at the end of every
turn before committing.

Last updated: 2026-10-06, after the plan was agreed (no turn started yet).

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

**Turn 0: green baseline and spec.**

## Turns

### Turn 0: green baseline and spec

- Status: planned
- Scope:
  - Fix the `normalizeConfiguredMcpServer is not defined` ReferenceError in the
    config-migration smoke so `npm run validate` runs end to end.
  - Triage the other known failures (see **Known failing checks**). Fix them if
    small; otherwise record them as accepted with a reason.
  - This document already serves as the spec; extend it only if triage
    changes the plan.
- Done when: `npm run validate` passes.
- Outcome: _(fill in)_

### Turn 1: executor protocol, `environment/describe`, environment registry

- Status: planned
- Scope:
  - Shared protocol module (proposed `src/shared/executor-protocol.js`) with
    method names and schemas.
  - `environment/describe` in `src/backend/wsl-agent.js`.
  - Host environment registry: the Windows host plus WSL distros from
    `wsl.exe -l -q` (decode UTF-16).
  - Keep one executor per project for now (consolidation is turn 11).
- Done when: describe reports bash/Linux inside WSL and PowerShell/Windows
  under Windows Node.
- Outcome: _(fill in)_

### Turn 2: host exec router

- Status: planned
- Scope: split `stateful-exec-session.js` into a host router (registry, grant
  check, budgets, timeouts, events) and an executor backend interface. The
  existing in-process local spawner becomes backend #1.
- Done when: no behavior change; all existing exec, harness, continuation, and
  access-profile regressions pass unchanged.
- Outcome: _(fill in)_

### Turn 3: WSL executor process sessions

- Status: planned
- Scope:
  - `process/*` in the agent: bash, PID-namespace containment, and bubblewrap
    (sandbox wrapping moves into the executor).
  - Output streamed over NDJSON with bounded buffers.
  - Router backend #2 forwards to the thread environment's executor.
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
  top-level choice.
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

These failed on the unmodified commit before this track started (`8ecf16e`).

| Check | Failure |
|---|---|
| `npm run validate` | Stops at `migration:smoke`: `ReferenceError: normalizeConfiguredMcpServer is not defined` (`main-config-slice.js:2251`). |
| `scripts/direct-self-constitution-regression.mjs` | Line 344 expects `completed`, gets `max_output_terminal`. |
| `scripts/direct-fresh-fork-start-regression.mjs` | 8 of 10 cases pass. |
| `scripts/direct-native-agent-tool-routing-regression.mjs` | `direct_utility_continuation_context_missing`. |

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

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-10-06 | One host, one native executor per environment | Single UI, DB, auth, and grants; each agent stays native. Matches Codex's `exec-server` direction. |
| 2026-10-06 | Extend our own Node executor; model its protocol on Codex `exec-server` | Already runs in both environments over stdio and carries existing custody work; `exec-server` is experimental and websocket-based. Matching shapes keeps a swap possible. |
| 2026-10-06 | Keep per-project executors until turn 11 | Equivalent for agent nativeness; avoids an early refactor with no user-visible value. |

## Plan changes

| Date | After turn | Change | Reason |
|---|---|---|---|
| | | _(none yet)_ | |
