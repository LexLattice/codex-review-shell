# Direct Dual-Environment Agents: Plan and Turn Log

Status: active. This is the working document for the dual-environment
track. Read it at the start of every turn, and update it at the end of every
turn before committing.

Last updated: 2026-10-07, after turn 11b.

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
         bash -c · /home paths · bubblewrap · PID namespace
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
| `src/main/direct/external/configured-mcp-adapter.js` | Trust, freshness, result envelope, authorization | Run the server process (done in turn 8: `mcp-stdio-transport.js` behind `mcp/request`) |
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

**None planned.** All turns are done. The owner's manual Electron checks
for turns 9, 10, 11a, and 11b are still pending, and **Findings** lists
follow-up candidates (the owner's WSL terminal and `sudo`; native Windows
workspace workers; hooks for SessionEnd, subagents, compaction, and
Interrupt; an AGENTS.md scope choice, set per project for now).

## Gates for every turn

Run through a login shell (`wsl.exe -d Ubuntu -e bash -lc ...`): a non-login
shell picks up a Node without `node:sqlite`, and most regressions then fail.

- `npm run validate` must pass.
- `bash -l scripts/direct-regression-sweep.sh` (about 5 minutes; start it in
  the background). It must report no `FAILED` lines; its `SKIPPED` lines
  must match **Known failing checks**. Any failure is a regression.
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

- Status: done
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
- Outcome:
  - Executor (`src/backend/wsl-agent.js`): `process/start`, `process/write`,
    `process/signal`. Sessions outlive the starting request and push
    `process/output` (base64, 64 KiB chunks, 1 MiB forwarded per session),
    `process/activity` (throttled, after the cap), `process/error`, and
    `process/exited`, all keyed by `processSessionId`. Shell commands run as
    the native `bash -lc`. Workspace/cwd checks and sandbox planning reuse
    `LocalChildProcessBackend` natively; full access runs under the
    PID-namespace launcher, Workspace and Read only under bubblewrap.
  - Shutdown: the agent now handles SIGTERM, SIGHUP, and SIGINT through its
    graceful shutdown, which kills every session. For abrupt death, full-access
    sessions are started through `setpriv --pdeathsig SIGKILL` (new opt-in
    `dieWithParent` on the contained spawn; request-scoped processes are
    unchanged). Before that fix a SIGKILLed executor left full-access
    processes running; bubblewrap sessions were already covered by
    `--die-with-parent`.
  - Host: `WorkspaceSession` relays `process/*` events privately (not through
    the sanitized agent-event path) and emits `transport-closed`. New
    `src/main/direct/tools/executor-process-backend.js` provides
    `EnvironmentExecutorProcessBackend` and its handle, which starts the
    remote process asynchronously, queues stdin and signals until the start
    is acknowledged, and reports executor loss.
  - Router: optional handle hooks `onActivity` (keeps the idle timer honest
    past the forwarding cap) and `onLost` (settles the session as failed with
    `direct_stateful_exec_executor_lost`; nothing is re-run). Launch options
    now carry `project`, `sessionId`, and `requestedEnv`.
  - `src/main.js` wires `createEnvironmentExecBackendResolver`: WSL
    workspaces that aren't local to the host use the executor; everything
    else keeps the local backend.
  - New `direct-wsl-executor-process-regression`: resolver choice per host,
    native bash and cwd, exit codes, interactive stdin (including a write
    queued before start), lexical versus executor-side cwd refusals,
    Workspace and Read-only sandboxing inside WSL (no writes outside, no
    network), cancel, 3 MB output, graceful executor loss with no surviving
    process, and (Linux host) abrupt executor SIGKILL in both containment
    paths.
  - Checks: the new regression passes on both hosts (on Windows through
    `wsl.exe`); `direct-environment-describe` and `direct-exec-backend-router`
    pass on both hosts; `check:syntax`, `validate`, and the agent-sensitive
    regressions pass; full sweep 260 of 280 passing, failures identical to
    **Known failing checks**.

### Turn 4: WSL executor filesystem

- Status: done with deviations
- Scope:
  - `fs/read` and `fs/applyPlannedPatch` in the executor; the host still plans
    patches and the executor rechecks the root.
  - Replace the locality gate in `fullAccessLocalBinding` with routing by
    environment.
  - Decide the credential exposure policy (Full access in WSL can read the
    host auth store through `/mnt/c`).
  - Reuse turn 3's pieces: the executor already instantiates
    `LocalChildProcessBackend` natively for path checks, and the host reaches
    it through `workspaceBackends.ensureForProject(project)` like
    `EnvironmentExecutorProcessBackend` does.
- Done when: `direct-access-profiles` passes against the executor backend too.
- Outcome:
  - `full-access-local-environment.js` now splits into the host executor
    class (grant check, patch parsing, hunk planning, results) and a file
    port that does everything touching files: resolve target, read rules,
    bounded reads, writable check, and a verify-then-write `commit`.
    `LocalFilePort` is the old code; the WSL executor runs the same
    `LocalFilePort` natively behind new `fs/read`, `fs/stat`, and
    `fs/applyPlannedPatch`. The host reaches it through the new
    `executor-file-port.js` (`ExecutorFilePort`). Local behavior is unchanged
    (all existing file regressions pass untouched).
  - Routing: `DirectFullAccessLocalEnvironmentExecutor.portFor` picks the
    local port when the workspace is local to the host and the executor port
    for a WSL workspace opened from elsewhere. `fullAccessLocalBinding` in the
    controller uses `canServe` instead of the locality gate, so WSL threads
    from Windows get access-profile file semantics (absolute paths under full
    access, Workspace write boundary, Read only) instead of falling back to
    the restricted workspace-backend path. `src/main.js` passes the executor
    port, sharing one lazy executor adapter with the exec backend.
  - Credential exposure decision (see **Decisions**): Full access is
    unrestricted. Workspace and Read only can't reach Windows drives
    (`/mnt/*`, except a workspace that lives there), WSL interop (`/run/WSL`),
    or the two credential stores (`.codex/auth.json`,
    `direct-auth/auth.json`), in both `read_file` and sandboxed commands.
  - Deviation: deciding that policy uncovered a sandbox escape that predates
    this track's WSL work. Inside a Workspace or Read-only sandbox in WSL,
    `/mnt/c/Windows/System32/cmd.exe` launched through interop and ran on
    Windows outside bubblewrap. Fixed in `exec-sandbox.js` (tmpfs over `/mnt`
    and `/run/WSL`, credential files masked with `/dev/null`), which covers
    both local Linux sandboxing and the WSL executor.
  - The done-when check runs as the new
    `direct-wsl-executor-files-regression` rather than by modifying
    `direct-access-profiles`. It repeats that regression's file cases
    (workspace-relative, absolute, `../`, and symlink escapes; nested create;
    Read-only write refusal; full-access writes outside) against the executor,
    and adds commit revalidation (stale before-digest refused), the
    sandboxed read policy, the interop escape, and policy unit checks.
  - Checks: the new regression passes on both hosts (Windows through
    `wsl.exe`); turn 3's regression still passes on both hosts;
    `check:syntax`, `validate`, and the file, exec, and lifecycle regressions
    pass; full sweep 261 of 281 passing, failures identical to **Known
    failing checks**.

### Turn 5: model contract per environment

- Status: done with deviations
- Scope: environment context block in every turn; shell-specific
  `exec_command` and `apply_patch` descriptions; the self-constitution
  snapshot reports the environment. Also make the local backend's shell
  match the executor's: same-distro local sessions still run `cmd` through
  `/bin/sh -c`, while executor sessions use `bash -lc`.
- Done when: a request-shape regression shows bash descriptions for WSL
  threads and PowerShell descriptions for Windows threads. Optional: one live
  WSL turn from the Windows launcher.
- Milestone: WSL agents fully native from the Windows host.
- Outcome:
  - New `src/main/direct/runtime/execution-environment-contract.js`.
    `resolveExecutionEnvironmentFacts` derives one facts object per thread
    from the grant and the workspace: environment kind (wsl, windows, linux,
    macos), distro, shell and its invocation, path style, default line
    ending, whether tools run on the host or through the environment's
    executor, and the access profile's writable scope, network, and hidden
    areas. Facts never carry raw paths.
  - The same facts feed three places: an "Execution environment" block
    appended to every implementation turn's instructions; the
    `exec_command`, `apply_patch`, and `read_file` descriptions (bash and
    POSIX examples for WSL and Linux, PowerShell and Windows paths for
    Windows) in the initial request and all four continuation paths; and a
    new `executionEnvironment` field in the self-constitution snapshot, whose
    workspace sentence now names the environment, shell, path style, and
    access profile. The request shape records `executionEnvironmentKind`,
    `Shell`, `AccessProfile`, and `ExecutesVia`.
  - One shell planner, `nativeShellCommand`, used by both the host's local
    backend and the executor: `bash -c` on Linux (`sh -c` without bash);
    on Windows `pwsh -NoLogo -NoProfile -NonInteractive -Command`, falling
    back to Windows PowerShell 5.1. The local backend no longer uses Node's
    `shell: true`, so local Windows commands now run in PowerShell rather than
    `cmd.exe`, and sandboxed Linux commands run in bash rather than `sh`.
  - Deviation: commands run in `bash -c`, not `bash -lc` (see **Plan
    changes**).
  - Deviation: the optional live WSL turn from the Windows launcher was not
    run; the regression drives real controller turns against a fixture
    provider instead.
  - Checks: new `direct-execution-environment-contract-regression` (shell
    planning per platform, facts per environment and profile, instruction
    and tool text, and full controller turns for a WSL thread and a Windows
    thread with no raw path reaching the provider) passes on both hosts.
    Turn 2 to 4 executor regressions re-pass on both hosts; self-constitution,
    access-profiles, full-access-authority, stateful-exec,
    everyday-continuation, everyday-live-acceptance, full-local-harness,
    tool-bundle-composer, and active-sub-agent-policy pass; `check:syntax`
    and `validate` pass; full sweep 262 of 282 passing, failures identical to
    **Known failing checks**.

### Turn 6: Windows containment and sandbox spike (time-boxed)

- Status: done
- Scope: check whether the installed Codex package's Windows sandbox runner
  (`codex-windows-sandbox`, Apache-2.0) covers Job Object kill-on-close, tree
  kill, and a workspace-write restricted token. If not, choose a minimal
  native helper.
- Done when: a written decision plus a proof script. No production code.
- Outcome:
  - Status: done. Decision in `docs/DIRECT_WINDOWS_CONTAINMENT_DECISION.md`.
    Proof script: `scripts/spikes/windows-containment/windows-containment-spike.mjs`
    with the prototype runner `job-runner.cs` next to it (spike code, not
    wired into anything).
  - Codex's sandbox is not reused. Source study (`openai/codex` `ccde2fc`)
    and a live `codex sandbox -P :workspace` run showed:
    - **Jobs allow breakaway**, and descendants are deliberately kept alive
      after the command exits.
    - **Unelevated network blocking** is only proxy environment variables.
    - **Real isolation needs elevated mode**, which provisions accounts,
      firewall and WFP rules, and HKLM entries.
    - **It writes persistent ACEs** onto the user's folders, `%TEMP%`
      included.
    - **There's no stable interface** for a third party.
  - Chosen instead: a Direct-owned job runner, built at first use by the
    in-box `csc.exe`:
    - Job Object with kill-on-close and no breakaway for every profile.
    - Low integrity with a Low-labeled project folder for Workspace.
    - Low integrity plus a write-restricted token for Read only.
    - A Medium no-read-up label to hide credential stores.
    - A private scratch `TEMP`.
    - No network enforcement on Windows, stated plainly.

    No admin rights are needed.
  - The proof script passes on the Windows host and skips on Linux. It shows
    that today's Windows local backend leaks a command's children both when
    the command is killed and when the host dies, because libuv's job allows
    silent breakaway. The runner kills the whole tree in both cases and when
    the command exits, passes stdio and exit codes through, and adds about
    70–90 ms.
  - Spike discoveries that turn 7 must keep:
    - **Scratch `TEMP`.** PowerShell drops to ConstrainedLanguage without a
      writable `TEMP`.
    - **Logon SID.** A write-restricted token needs the logon SID as a
      restricting SID (else `STATUS_DLL_INIT_FAILED`).
    - **Default DACL.** The token's default DACL must grant the logon SID,
      or the command can't use its own pipes.
    - **WSL blocked.** Low-integrity processes can't start WSL
      (`Wsl/E_ACCESSDENIED`).
  - Checks: `check:syntax` and `validate` pass; full sweep 262 of 282
    passing, failures identical to **Known failing checks** (no production
    code changed). The Codex probes' temporary `%TEMP%` ACEs, folders, and
    leftover processes were removed afterwards.

### Turn 7: Windows executor

- Status: done with deviations
- Scope:
  - PowerShell sessions (`pwsh`, fallback Windows PowerShell 5.1,
    `-NoProfile -NonInteractive`, UTF-8 output). The shell planning already
    exists (`nativeShellCommand`, turn 5).
  - Containment per `DIRECT_WINDOWS_CONTAINMENT_DECISION.md`:
    - Productionize the job runner (built from source by `csc.exe` at first
      use and cached by digest; refuse commands clearly if it can't be
      built).
    - Run every Windows command through it, including the host's local
      Windows backend under Full access, which leaks process trees today.
  - Workspace (Low integrity, Low-labeled project folder) and Read only (Low
    integrity plus write-restricted token), each with a private scratch
    `TEMP`. Label credential stores Medium no-read-up.
  - Execution-environment facts and the Access menu say that Windows
    Workspace and Read only don't block the network.
  - Filesystem read and patch with CRLF preserved.
- Done when: the regression passes under Windows Node.
- Milestone: Windows-native agents.
- Outcome:
  - **Runner.** `src/main/direct/tools/windows-job-runner.cs` is the
    production version of the spike runner. It also prepares what a command
    needs before starting it:
    - `--label-low` labels the project folder, checking first so only the
      first Workspace command pays for the tree walk.
    - `--hide` gives credential files a Medium no-read-up label.
    - `--scratch` creates the private `TEMP`, with a Low label and a DACL for
      the user and logon SID only.
  - **Build and plan.** `windows-job-runner.js` builds the runner at first
    use with the in-box `csc.exe` and caches it under
    `%LOCALAPPDATA%\codex-review-shell\direct-job-runner\<source digest>`,
    keeping parallel builds race-safe. It reports a spawn-free `status()` for
    `environment/describe`, quotes Windows command lines by
    CommandLineToArgvW rules, and plans launches through `WindowsJobSandbox`,
    which wraps every profile, Full access included.
  - **Refusal.** If the runner can't be built, commands are refused with
    `direct_stateful_exec_windows_containment_unavailable` and a plain
    message.
  - **Wiring.**
    - `LocalChildProcessBackend` defaults to that sandbox on Windows, so the
      host's own Windows commands (previously uncontained) and the Windows
      executor's `process/start` share one path. `launch` merges the scratch
      `TEMP` and removes it when the command closes.
    - Routing sends a Windows workspace to the in-process backend and file
      port on a Windows host, and to the Windows executor from anywhere else
      (`workspaceExecutesLocally`, the exec resolver, `portFor`).
    - Commands get the Windows variables they need (`USERPROFILE`,
      `APPDATA`, `PATHEXT`, and others; one list,
      `BASE_COMMAND_ENVIRONMENT_KEYS`, shared by host and executor).
    - PowerShell output is UTF-8.
  - **Files.** Patches keep each file's dominant line ending; new files in a
    Windows environment get CRLF, as the model is told. Before this, patching
    a CRLF file rewrote it as LF on every host.
  - **Model and UI.**
    - Facts report the network as open (`networkEnforced: false`) for Windows
      Workspace and Read only. The model is told that and that WSL and
      credential stores are unreachable.
    - The Access menu says "Network isn't blocked on Windows" for Windows
      projects.
    - `environment/describe` reports `windows_job_object` containment, and
      bash's invocation as `-c`.
  - **Session results.** They now report `networkAccess` from the executor's
    start reply instead of the host's guess.
  - **Checks.**
    - New `direct-windows-executor-regression` passes on the Windows host (16
      checks: in-process backend and executor) and from the Linux host (9
      checks: executor launched with Windows `node.exe`). It covers:
      - quoting and routing;
      - describe and building the runner from source;
      - PowerShell cwd, exit code, UTF-8, and stdin;
      - tree kill on cancel and on exit;
      - Workspace and Read only writes, scratch `TEMP`, FullLanguage
        PowerShell, WSL blocked, and credential fixture hidden;
      - CRLF, LF, and new-file CRLF patches, and the Workspace boundary,
        through both file ports.
    - Turns 1–5 executor regressions re-pass on both hosts. The turn 4 one
      now names the platform in its credential-discovery unit check.
    - `check:syntax` and `validate` pass; full sweep 263 of 283 passing,
      failures identical to **Known failing checks**.
  - **Effect on this machine (intended behavior).** The executor runs used
    real credential discovery, so `%USERPROFILE%\.codex\auth.json` and
    `%APPDATA%\codex-review-shell-direct\direct-auth\auth.json` now carry a
    Medium no-read-up label. `codex login status` still works.
  - **Deviations.**
    - No live Electron turn was run.
    - The workspace backend's request-scoped command paths (`run_command`
      without a task grant, workspace-worker test profiles) still refuse on
      Windows with `workspace_windows_job_object_containment_unavailable`;
      only process sessions moved to the runner (see **Findings**).

### Turn 8: MCP servers and hooks per environment

- Status: done with deviations (hooks and skill scripts had nothing to route)
- Scope: MCP server configs name their environment; executors run stdio
  servers (`mcp/*`); the host keeps trust, freshness, and the result envelope.
  Hooks and skill scripts use the same routing.
- Outcome:
  - **Where a server runs.** Configured MCP servers take a `runsIn` field:
    - `"project"`, the default: the project's own environment, as Codex runs
      MCP servers where the agent runs.
    - `"host"`.
    - `{ kind: "wsl", distro }` or `{ kind: "windows" }`.

    Flat `environmentKind` and `distro` are also accepted.
  - **Placement** (`mcpPlacementFor` in `configured-mcp-adapter.js`):
    - A server local to the host runs there.
    - A server in the project's environment uses the project's executor.
    - A server in another named environment uses an executor anchored at
      its `cwd` there. Without a `cwd` it is refused with
      `direct_mcp_environment_root_required`.
  - **Shared transport.** The stdio exchange (initialize, one request, reap)
    moved unchanged into `external/mcp-stdio-transport.js`, which host and
    executor share, the same pattern as the file port. The executor serves
    it as new `mcp/request` and `mcp/cancel`.
  - **Containment.** In a WSL executor the server runs in the PID-namespace
    launcher; the new `exactEnv` option keeps the server's own allowlist. On
    Windows (executor or host) it runs under the job runner.
  - **What stays on the host.** Trust, freshness, scope, owner-interaction
    refusal, and the result envelope (URI-laundering checks, payload
    bounds).
  - **What crosses to the executor.** Only command, args, cwd, and the
    names of allowlisted variables cross. Their values come from the
    server's own environment.
  - **Environment variables.** Servers now also get the base command
    variables (PATH, HOME, SystemRoot, and others), on the host as well, so
    `npx`-style commands resolve. Nothing else beyond the allowlist crosses.
  - **Cancel.** It reaches the executor (`mcp/cancel`) and returns at once.
  - **Hooks and skill scripts: nothing to route.** Direct classifies hooks,
    skills, and apps but never executes them (`skills-hooks-apps.js`:
    `executionAllowedInThisPr: false`), and no other Direct code spawns
    processes besides configured MCP and the WSL-pinned semantic service. A
    skill's scripts can only run through `exec_command`, which already runs
    in the thread's own environment. See **Plan changes**.
  - **Checks.**
    - New `direct-mcp-per-environment-regression` passes on both hosts:
      - placement rules;
      - a host server with the env allowlist;
      - a server in the project's other environment (WSL from Windows,
        Windows from Linux) with the allowlist enforced across `WSLENV`;
      - an explicitly named other environment, and the missing-`cwd`
        refusal;
      - host-side laundering and owner-interaction refusals and discovery
        through the executor;
      - a server's detached child reaped in WSL and Windows;
      - prompt remote cancel.
    - No fixture processes were left in either environment.
    - `direct-provider-external-production-wiring` passes on both hosts. Its
      reap-timing lower bound is now POSIX-only: a SIGTERM-ignoring fixture
      only delays cleanup on POSIX, and it had never been run on Windows.
    - Turns 1–7 executor regressions re-pass on both hosts.
    - `check:syntax` and `validate` pass; full sweep 264 of 284 passing,
      failures identical to **Known failing checks**.

### Turn 9: Workbench UX

- Status: done with deviations (owner Electron smoke pending)
- Scope: environment picker at project creation; native folder browsing
  through the executor; environment and Access badges on projects, threads,
  and the composer; both environments side by side; remove Direct · text as a
  top-level choice; fix `direct-t3-alternate-gui-regression` (missing
  `morphicObservationsButton` id in the Workbench HTML).
- Done when: a renderer regression passes and a manual Electron smoke by the
  owner succeeds.
- Outcome:
  - **Environment picker.** The project editor lists this machine's
    environments from the registry: Windows, each WSL distro, with this
    machine first. System distros like `docker-desktop` are left out, and
    distros this host can't launch are shown disabled. The picker replaces
    the raw kind select and the free-text distro field. If listing fails,
    the typed fields come back with a note. An existing project's
    environment is always offered, even if it isn't found.
  - **Folder browsing.** Each path field has Browse, which opens an in-editor
    folder browser:
    - It lists folders through that environment's own executor (new
      `fs/list` in the agent, `DirectEnvironmentRegistry.listDirectory`,
      reusing the probe executor). A WSL folder is picked as a Linux path and
      a Windows folder as a Windows path, from either host.
    - It has Up, Home, and a Windows drive list.
    - A typed folder that's missing falls back to home.
    - "Use this folder" fills the path and names an unnamed project after it.
  - **IPC.** `direct-workbench:environments` and
    `direct-workbench:browse-environment-folder` use the same authority
    checks as the other Workbench handlers. They are exposed only in the
    Workbench preload.
  - **Badges.**
    - Project rows show an environment badge. The directory projection now
      carries the WSL distro name, an identity rather than a path.
    - Thread rail rows show the project's environment, and the focused
      thread also shows its Access level.
    - The composer has an environment chip with the shell, such as
      "WSL · Ubuntu · bash" or "Windows · PowerShell".
  - **Side by side.** WSL and Windows projects appear together in the one
    project directory, each badged, and switching between them rebinds the
    runtime as before.
  - **Direct · text.** It is no longer offered in the editor; a hidden option
    keeps the value for existing projects, as the legacy shell already did.
  - **Regression fix.** The Observations button was added, which fixes
    `direct-t3-alternate-gui-regression`.
  - **Editor loading.** The editor shows its draft at once and fills the
    picker in when the environment list arrives; the list asks WSL, which
    can take a moment. The title reflects the requested mode while loading.
  - **Checks.**
    - New `direct-workbench-environment-ux-regression` passes on both hosts:
      - the model;
      - project rows without paths;
      - markup, script-order, and IPC-authority contracts;
      - the real `direct-project-directory-surface.js` driven in a fake DOM:
        picker options, environment switch, browse with fallback, folder
        choice, the submitted workspace, and the no-listing fallback;
      - live folder listing in WSL and Windows, plus error codes.
    - The Workbench Electron smoke (`direct-t3-alternate-gui-electron-smoke`,
      headless under xvfb) passes after updating it to pick the environment
      and browse to the fixture folder. Its screenshots were used to fix
      three layout problems: a badge squeezing project names, the path row,
      and the folder browser overflowing.
    - All related Workbench regressions pass, and `check:syntax` and
      `validate` pass; full sweep 266 of 285 passing, failures identical to the updated **Known failing checks** (19).
  - **Deviation.** The owner's manual Electron smoke is still pending.
  - **Follow-up after the owner's first launch attempt.** I had verified the
    Workbench only in Linux Electron, headless, never through
    `start-direct-workbench.cmd`. Three problems showed up there:
    - **Launcher run from the WSL checkout.** Started over its UNC path,
      `cmd.exe` fell back to `C:\Windows`, so Electron couldn't find
      `scripts\run-electron.mjs`. Worse, the sync mirrored the repo onto
      itself and ran Windows `npm install` in the WSL `node_modules`. That
      replaced 6 packages with Windows shims and removed Linux Electron (npm
      12 blocked Electron's postinstall). I restored it with `npm ci` in WSL.
      `start-codex-review-shell.cmd` now hands over to the Windows mirror
      (`C:\LexLattice\codex-review-shell-direct`, or
      `CODEX_REVIEW_SHELL_WINDOWS_MIRROR`) when started from `\\...`, and
      `sync-from-wsl.cmd` refuses to sync into a UNC folder.
    - **npm 12 blocks Electron's install script.** Windows npm 12.2 refuses
      unapproved install scripts, so a fresh mirror install would have no
      `electron.exe`. `package.json` now approves `electron@41.2.1`
      (`allowScripts`); re-approve when Electron is upgraded.
    - **Access selection refused while Direct isn't ready.** Opening a
      thread without a grant, or creating one, called
      `thread/selectAccessProfile`, which main declares only while Direct is
      ready. When it isn't, opening the thread failed. That was a regression
      from `1c65a49`. The renderer now checks the declared capability first
      (`canSelectDirectAccessProfile`). A manual Access change while Direct
      isn't ready says it will apply once Direct is ready.
    - **Readiness is per model.** Direct wasn't ready on the owner's machine
      because the model readiness evidence had expired (August). After
      **Refresh Direct readiness**, which verified the project's
      `gpt-5.6-sol`, new threads still failed with
      `live_probe_evidence_scope_mismatch`. They used other models
      (`gpt-6-luna`, `gpt-5.5`), and selecting Access checks the thread's own
      model. The renderer now routes Access for new and opened threads
      through `selectPreferredAccessForThread`. A readiness refusal shows the
      readiness prompt with its Refresh button, which verifies that thread's
      model, instead of failing the thread. A successful refresh then applies
      the preferred Access.
  - **Follow-up: models work like Codex.** Per-model readiness was the wrong
    design (the owner's call: "the picker should only offer models the API
    says are available"). Codex (`upstream-0.160.0`) never probes a model
    before a turn. It fetches
    `GET chatgpt.com/backend-api/codex/models?client_version=<version>`,
    offers the `visibility: "list"` models by `priority`, caches the list for
    5 minutes per account, refreshes it every 4.5 minutes, on sign-in
    changes, and when a response's `X-Models-Etag` differs, and lets the
    server reject a model. Direct now does the same:
    - **Readiness is sign-in.** `statusForProject` is ready when signed in.
      List membership is reported (`providerListed`, `modelEvidenceState`
      `provider_listed`, `provider_unlisted`, or
      `provider_catalog_unavailable`) but never blocks. The experimental
      activation path follows the same rule (`liveTextReady` no longer needs
      probe evidence).
    - **The list.** `metadata-adapter.js` keeps `visibility` and `priority`,
      orders by priority, and takes the first listed model as the default.
      `client_version` is the installed Codex CLI's version (npm package,
      prerelease dropped; 0.160.0 in WSL and 0.160.1 on Windows here), with
      `CODEX_DIRECT_CLIENT_VERSION` as an override and 0.160.0 pinned as the
      fallback. The cache lives 5 minutes and is never served to another
      account. Main refreshes it every 270 s for the current Direct project,
      when the account changes, and when the controller reports a refused
      model or a changed `X-Models-Etag`. Concurrent refreshes share one
      request.
    - **A refused model.** The transport reads the provider's reason from the
      JSON body (`detail` or `error.message`). A 400, 403, or 404 that names
      the model fails the turn with `model_unavailable`: "The provider
      refused model X: <reason> The model list is being refreshed; pick
      another model to continue." The renderer then reloads the picker.
    - **Renderer.** The picker shows only listed models, by priority, with
      no fallback to hidden models or an older list. A current model that
      isn't listed stays visible as "· unavailable" and can't be picked.
      Opening the picker refetches the list only when the cache is stale.
      **Refresh Direct readiness** became **Refresh models** (sign-in plus
      the list, no prompt sent). The old probe survives only as the optional
      **Test model** in the runtime drawer (`direct-runtime:test-model`);
      nothing waits on it. Prompts about readiness now appear only when
      signed out.
    - Updated pinned checks in `direct-codex-smoke`,
      `direct-runtime-path-switch-regression`,
      `direct-full-access-authority-regression`, and
      `direct-provider-external-parity-regression` (a stale list keeps
      `model/list` while it refreshes; a missing one doesn't).
      `direct-runtime-path-electron-regression` now reaches its Direct switch
      branch, which per-model readiness had always skipped here. Two of its
      expectations were stale: the backend picker selects ordinary Direct
      (`runtimeMode: "direct"`), and it persists the choice across restarts.
      New
      `direct-model-catalog-regression` (9 checks) passes in WSL and under
      Windows Node. `check:syntax` and `validate` pass, the headless
      Workbench Electron smoke passes, and the full sweep is 267 of 286
      passing, failures identical to **Known failing checks**.
    - **Owner check of the picker found two more bugs.**
      - Picking a model didn't change the button. On Direct, the button
        showed main's saved thread binding, which a new-thread composer
        never writes. It now shows the picked model at once and falls back
        to the saved binding only when there is no pick.
      - `gpt-5.5` was still offered as "· default" although the account's
        list hides it. The project's configured model was used as the
        default without checking the list. A project model is now only a
        default: when a fetched list doesn't offer it, the list's default
        replaces it (`defaultModelForProject` in the controller, the
        runtime witness, clearing a thread's model in main, and
        `directDefaultModelId` in the renderer). A thread's own explicit
        model is never replaced; it shows as unavailable instead. Without a
        list, the configured model is kept. On the owner's account this
        makes `gpt-6.1-sol` the default.
      - `direct-model-catalog-regression` grew to 11 checks.
  - **Follow-up: the picker redone after Codex's.** The owner asked for
    Fast and Daybreak as on/off modifiers, Daybreak driven by live data,
    and the default set somewhere other than the picker. Sources: the Codex
    source (`upstream-0.160.0`; the desktop UI itself isn't in it), the
    owner's screenshots of the Codex app, and this account's live
    `/codex/models` and `/accounts/verified_access` responses.
    - **Live data.** Each model in `/codex/models` carries
      `available_access_programs.cyber`, the treatments this account may
      request. Here GPT-6.1 Sol and GPT-6 Astra list only `standard`. GPT-6
      Sol, GPT-6 Luna, and the GPT-5.6 models add `daybreak_blue`. The
      dedicated `gpt-daybreak-blue-latest` (`model_specialty: "cyber"`) lists
      only `daybreak_blue`. Fast is the `priority` tier on every listed model
      except Daybreak Blue. `verified_access` shows the cyber program
      active (`tac1`); it says nothing per model, so it isn't used.
    - **Requests.** Codex sends Daybreak as `access_programs: {cyber:
      "daybreak_blue"}` in the Responses body, with the model unchanged, and
      Fast as `service_tier: "priority"` (`fast` is a legacy alias). Direct
      now does both. Each is sent only when the turn's model offers it.
      Otherwise the field is omitted, and omission keeps the backend's
      automatic behavior. The turn records its tier and program, and tool
      continuations take effort, tier, and program from the turn. Before
      this change, read, patch, and command continuations dropped the
      thread's effort and tier.
    - **Bug fixed on the way.** Direct accepted only `fast` and `flex`, so
      choosing the catalog's "priority" tier was refused. `priority` is now
      the canonical Fast; `fast` is stored as `priority`.
    - **Per thread.** Fast and Daybreak are saved on the Direct session
      (`serviceTier`, `daybreakEnabled`) through the thread runtime
      preferences, like model and effort. New threads start with both off
      (owner's choice). A choice the current model can't use stays saved
      and applies again on a model that can. Before, Fast was renderer-wide
      and leaked between threads.
    - **Picker.** The composer button reads like Codex's: "⚡ GPT-6 Luna High
      · Daybreak". Opening it shows the effort view:
      - the Fast toggle, disabled with a reason when the model has no Fast
        tier;
      - the effort name;
      - the model name, which opens the model view;
      - a slider over the model's own effort levels;
      - reset to the model's default effort.
      The model view has the Daybreak switch. It is disabled with "Daybreak
      isn't available for GPT-6.1 Sol." when the model doesn't offer it, and
      with a different note when the list doesn't say. Below it is the
      model list with a check on the current model. Dedicated Daybreak
      models are hidden (owner's choice). The thread picker no longer has a
      Default row.
    - **Default model.** The default moved to the Workbench project editor
      as "Model for new threads": "Recommended (now GPT-6.1 Sol)" or a
      pinned model. Recommended is stored as an empty project model and
      follows the account's list. A pinned model the list stops offering is
      shown as such and falls back to Recommended. New threads now start
      from this setting instead of inheriting the open thread's model.
    - **Not changed.** Direct sends `ultra` effort literally. Codex instead
      maps it to the model's `multi_agent_reasoning_effort` (or `max`) and
      turns on proactive delegation. Recorded under **Findings**.
    - Updated pins: `direct-thread-turn-parity-regression` (advertised
      tiers are `priority`, `flex`) and `direct-provider-metadata-regression`
      (the `fast` alias becomes `priority`). `direct-model-catalog-regression`
      is now 16 checks, including real turns that check the request body for
      each model. The picker was also rendered from the real code and CSS in
      headless Electron, with stub data shaped like this account's list, and
      checked by screenshot. The Workbench smoke still runs Direct in fixture
      mode, so it shows the old menu.
    - Checks: the catalog regression passes in WSL and under Windows Node;
      `check:syntax`, `validate`, and the Workbench Electron smoke pass; the
      full sweep is 267 of 286, failures identical to **Known failing
      checks**. No live turn with Fast or Daybreak was run.
  - **Follow-up: picker clicks didn't show until the menu was reopened.**
    Only the effort slider, which paints itself while dragging, responded.
    The cause was older than the redesign: the Workbench page
    (`t3-direct-surface.html`) never loaded
    `runtime-preference-write-coordinator.js`, which `codex-surface.html`
    does. Every choice set the in-memory value and then threw "Runtime
    preference write coordinator is unavailable." while saving, before the
    redraw. In the Workbench, model, effort, Fast, and Daybreak were
    therefore never saved to the thread. Turns still used them because the
    composer sends them with each turn, but reopening a thread lost them.
    This was also behind the earlier "the button doesn't change" report.
    - The page now loads the coordinator. `setRuntimeOverride` redraws
      before saving, and a failed save is reported without blocking the
      redraw.
    - The Workbench Electron smoke now clicks an effort in the real picker.
      It checks that the button changes at once with the menu still open,
      and that the choice reaches the thread's saved settings. Without the
      fix it fails on exactly this. The catalog regression (17 checks)
      checks that both pages load every script `codex-surface.js` needs.
      It passes on both hosts. `check:syntax` and `validate` pass, and the
      sweep is 267 of 286, failures identical to **Known failing checks**.

### Turn 10: cross-environment delegation

- Status: done with deviations (owner Electron check pending)
- Scope: `spawn_agent` can target another environment; the child thread is
  bound there with a grant derived from the parent under an explicit owner
  policy for crossing environments.
- Outcome:
  - **Owner decisions** (asked before building):
    - A child works in an existing Workbench project in the other
      environment, or in a subfolder of one.
    - A subfolder gets an auto-created project, marked "created by
      delegation".
    - Authorization is per target project: "Accept delegated work: Off / up
      to Read only / up to Workspace / up to Full access", default Off.
    - The parent gets the child's final message, as in Codex.
    - The child appears in the target project's thread list, marked
      "Delegated", with a chip in the parent's transcript.
  - **Why existing machinery wasn't reused.** Today's `spawn_agent` children
    are reasoning-only (no tools) or isolated-worktree workers. Worktree
    workers have a fixed tool set with no shell, use a git worktree of the
    parent project in the parent's environment, can't run on Windows (no
    containment there), and are enabled by a deployment environment variable.
    The grant inheritance helper forbids changing environment
    (`child_environment_must_equal_parent_environment`). A delegated child is
    therefore a real Direct thread in the target project, the same agent as
    a thread opened there. The executor, file and command routing, the
    model's environment block, grants, and MCP are all keyed on the project,
    so binding the child to a project reuses all of them. No second
    placement has to be threaded through every path, and neither side works
    through `\\wsl$` or `/mnt/c`.
  - **Policy** (`src/main/direct/agents/cross-environment-delegation.js`):
    - A project's `delegation` holds `acceptAccess`, `includeSubfolders`, and
      `createdBy`. It is normalized in `normalizeProject` only when set, and
      edited in the Workbench project editor's new "Delegated work" section.
    - Targets are projects that accept work, run Direct with tools, aren't
      the source, and aren't archived.
    - A request is resolved with the target environment's own path rules:
      POSIX in WSL; on Windows, drive paths compared case-insensitively.
      Paths are normalized first, and a shared name prefix doesn't count as
      containment.
    - A folder with a project of its own follows that project's setting.
    - A subfolder is checked to exist through its environment's executor
      (registry `listDirectory`). Its project is then created once,
      serialized, inheriting the enclosing project's environment, runtime,
      and limit, with no subfolders of its own.
  - **`spawn_agent`** gains `target_project` and `target_folder`. Each turn,
    its description lists the allowed targets (only when there are any).
    - Refusals come back immediately with a reason, e.g. the list of valid
      targets.
    - A delegated child can't delegate again and isn't offered targets.
    - Delegated spawns skip the active sub-agent policy, which shapes
      in-place children; the owner's per-project setting is the policy here.
    - Child Access is the lower of the parent thread's Access and the
      target's limit.
  - **Child runner** (`delegated-thread-runner.js`). The pool gets a third
    runner kind, `delegated_thread`; list, inspect, wait, capacity, and
    cancellation work unchanged. The runner:
    - starts the child through a renderer-less surface session (so every
      tool path behaves as on screen), with `delegatedFrom` recorded on the
      session;
    - runs one turn with the task, framed as delegated, and waits until the
      turn is terminal;
    - stops the child on cancellation, after 30 minutes, or as soon as it
      asks for a person (delegated agents can't ask the user);
    - returns the child's last assistant message. The pool bounds it to
      12,000 characters and marks truncation, and `wait_agent` passes it on
      (`childOutputIncluded: true`).
  - **UI.** The child stays an ordinary thread (no `agentKind`, which would
    file it as a hidden worker). Its index entry, thread-list entry, and
    deck row carry `delegatedFrom`, and the rail shows a "Delegated" badge
    whose tooltip names the source. Spawn and wait notifications carry the
    delegation, and the parent's "Sub-agents in this turn" row shows "task →
    project · environment" with Access and folder in the tooltip. The chip
    isn't clickable; the child is followed from its project.
  - **Checks:**
    - New `direct-cross-environment-delegation-regression` (10 checks)
      passes in WSL and under Windows Node. It covers policy, targets, path
      rules, project creation, pool settlement and truncation, and runner
      stops (needs a person, timeout, cancel).
    - An end-to-end run through the real controller, pool, and runner checks
      refusal details and Access as the lower of the two. It also checks that
      the child thread lives in the target project with a Windows grant, is
      told it runs in PowerShell, is marked in the list and deck, and can't
      re-delegate.
    - Two runs where the delegated child really executes its command in the
      other environment: PowerShell in a Windows folder, and bash in a WSL
      folder. Each goes through the Windows or WSL executor, or in-process
      for the host's own environment, depending on the host.
    - `smoke-config-migration` provides the new import to its sandbox.
    - `check:syntax`, `validate`, and the Workbench Electron smoke pass. The
      first sweep caught one break in turn 9's
      `direct-workbench-environment-ux-regression` (its fake DOM has no
      `closest()`), which is fixed; it passes on both hosts. The full sweep
      is 268 of 287, failures identical to **Known failing checks**.
  - **Deviations:**
    - No live provider run.
    - The main-side subfolder project creation runs only inside Electron; its
      pure parts and wiring are covered.
    - The parent chip doesn't open the child's project.
    - The owner's Electron check is pending.

### Turn 11a: terminals and the Terminal panel

- Status: done with deviations (owner Electron check pending)
- Scope: real terminals in both environments, for agents (`exec_command`
  with `tty`) and for the owner (a Terminal panel in the Workbench). Split
  from turn 11; see **Plan changes**.
- Outcome:
  - **Owner decisions** (asked before building):
    - Split turn 11: terminals and the panel first (11a), one executor per
      environment next (11b).
    - The panel shows both the owner's own shells and agents' terminal
      sessions (read-only).
    - The owner's shell has Full access semantics (no sandbox) in the
      project's environment, with the owner's environment variables, but is
      still contained (it ends with the app or executor).
    - Rendering uses `@xterm/xterm` (new dependency, with `@xterm/addon-fit`).
  - **Terminal helpers.** Both read one framed stdin protocol (type byte,
    4-byte big-endian length, payload: `d` typed bytes, `r` resize rows/cols,
    `k` signal) and write the terminal's output to stdout.
    - Windows: the job runner gains `--conpty <rows> <cols>`
      (`CreatePseudoConsole`, `STARTUPINFOEX`, relay threads). SIGINT types
      Ctrl+C; other signals, or stdin closing, terminate the job.
    - Linux/WSL: `src/backend/pty-helper.py` (`pty.fork`, `TIOCSWINSZ`,
      signals to the process group; stdin closing sends SIGHUP). It runs
      inside the sandbox, so Workspace and Read only terminals keep their
      sandbox.
    - `pty-frames.js` holds the encoder and `PtyChannel`. End of input is
      the platform's EOF key (`Ctrl+D`; `Ctrl+Z Enter` on Windows), since
      closing stdin means the host is gone.
  - **Executor and backends.** `process/start` accepts `tty`, `rows`,
    `cols`, `interactiveShell`, and `fullEnvironment`; new `process/resize`;
    `environment/describe` reports `pty` (`conpty` or `python_pty`). Local
    and executor process handles both support resize and terminal input.
    `nativeInteractiveShell` picks `pwsh -NoLogo` (else Windows PowerShell)
    or `$SHELL -l`.
  - **Agents.** `exec_command` gains `tty` (24x80, stdout and stderr merged,
    `write_stdin` typed into it, `TERM=xterm-256color`), recorded as
    transport `pty`. The session manager keeps a 256 KiB terminal replay,
    emits `terminal-data`, and supports `resize`.
  - **Owner's terminals** (`src/main/direct/terminal/terminal-service.js`):
    up to 8 per project, a 512 KiB replay each, routed like agents'
    commands (in-process for the host's own environment, the executor
    otherwise). An executor reports the shell's name once started. IPC
    `direct-terminal:list/create/write/resize/close/replay` is scoped to the
    active project, and terminals end in both shutdown paths.
  - **Panel.** The rail's Terminal button is enabled and docks a panel over
    the bottom of the transcript: tabs for the owner's shells (closable) and
    agents' sessions (italic, read-only), a new-terminal button, replay on
    open, fit-to-size with resize forwarded, and a shell started
    automatically when the panel opens empty. xterm is served from an
    allowlist of three files in `node_modules`.
  - **Bug found and fixed.** A ConPTY child created without
    `STARTF_USESTDHANDLES` inherits the runner's own redirected stdin and
    stdout, so PowerShell read raw frames in parallel with the relay: frame
    headers appeared as typed text, bytes went missing, typing ahead was
    lost, and Enter (CR) only acted when more input arrived. The runner now
    passes null std handles so the child uses the pseudoconsole. The earlier
    observation that PowerShell needed LF for Enter was this bug.
  - **Checks:**
    - New `direct-terminal-pty-regression` (9 checks) passes in WSL and under
      Windows Node, each driving the other environment through its executor.
      It covers frames, both executors' `pty` description, the owner's shell
      in WSL (size, resize, Ctrl+C, writes outside the folder, close, exit
      code), the owner's PowerShell (size, resize, CR as Enter, `Read-Host`,
      exit code), agents' `tty` sessions in both environments under
      Workspace (input, resize, replay, panel listing, plain sessions refuse
      resize), the xterm allowlist over HTTP, and wiring.
    - The Workbench Electron smoke opens the panel, types a command into
      xterm, and sees its result in a real shell (its WSL fixture project now
      points at a temp folder). `direct-t3-alternate-gui-regression` pins the
      enabled button and panel.
    - Existing exec and executor regressions (router, stateful sessions, WSL
      and Windows executors, files, delegation) pass on both hosts.
      `check:syntax` and `validate` pass. The full sweep is 269 of 288,
      failures identical to **Known failing checks**.
  - **Deviations:**
    - Through the WSL executor (a Windows app opening a WSL terminal), the
      owner's shell runs in the executor's user and PID namespace, like
      Full-access agent sessions, so `sudo` doesn't work there. In-process
      on a Linux host it is an ordinary shell. See **Findings**.
    - The panel shows only the active project's terminals (others keep
      running and come back with their replay when the project is active
      again), and the owner can't type into an agent's session.
    - No live provider run of an agent using `tty`.
    - The owner's Electron check is pending.

### Turn 11b: one executor per environment

- Status: done with deviations (owner Electron check pending)
- Scope: one executor per environment serving every project root in it,
  instead of one per project folder. Also contain host-local MCP servers on
  Linux and consider long-lived MCP sessions (turn 8's plan change).
- Outcome:
  - **Owner decisions** (asked before building): all projects share their
    environment's executor (one per WSL distro, one for Windows, one for a
    local host); workspace workers keep a dedicated executor. Contain Linux
    host-local MCP servers now; record long-lived MCP sessions as a finding.
  - **Executor** (`wsl-agent.js`):
    - `--environment` launches it without a project: from the home folder,
      with only the environment's kind. A dedicated executor still launches
      with `--root`.
    - Each request may carry `projectContext` (`root`, `workspaceKind`,
      `projectId`). The executor checks it: an absolute path in this
      environment's style (drive or UNC on Windows), the executor's own
      kind, and an existing folder. A dedicated executor only accepts its own
      folder. The request then runs in it through `AsyncLocalStorage`.
    - All 82 uses of the launch-time `root`, `workspaceKind`, and `projectId`
      now read the request's project. TypeScript's checker found them, so
      none are missed. A project-scoped request without a project is
      refused (`executor_project_context_required`); nothing falls back to
      another folder. Environment-wide methods (`fs/list`, process controls,
      `mcp/cancel`, `environment/describe`, Codex thread discovery) need no
      project.
    - `hello` with a project checks and echoes that folder; without one it
      names no folder. The staging `.gitignore` setup is per folder.
      Containment probes run in the environment's home. Worker bindings are
      refused on an environment executor.
  - **Host** (`workspace-backend.js`):
    - Sessions are keyed per environment (`wsl:<distro>`, `windows`,
      `local`). Projects marked `executorPlacement: "dedicated"` (workers,
      via `projectForWorkspaceWorker`) keep the per-folder key.
    - `ensureForProject` attaches the project to the shared executor (a
      project `hello` and, unless skipped, hygiene per folder, redone after
      an executor restart). It returns a `ProjectExecutorView` whose requests
      carry the project; events, transport, and process are the executor's.
      `requestForProject`, the file port, and repository observation go
      through it, and `process/start` adds the context explicitly.
    - Status and snapshots are per project. A shared executor's status
      events go to every attached project.
    - New `releaseProject` lets go of one folder and stops the executor only
      when nothing else uses it. The environment registry's probes use it,
      so describing an environment no longer kills the executor its projects
      share. `disposeForProject` still stops the executor (on a shared one,
      every project's processes there).
  - **MCP.** The trusted `unshare` launcher moved to
    `src/shared/linux-pid-namespace.js`. The executor and host-local MCP
    servers on a Linux host both use it, so everything a server starts ends
    with it.
  - **Checks:**
    - New `direct-environment-executor-regression` (8 checks) passes in WSL
      and under Windows Node. Two projects in each environment share one
      executor process, and each request (legacy `listTree`, `fs/read`,
      commands) runs in its own folder. The WSL Workspace sandbox of one
      project can't write the other. The executor refuses missing, relative,
      foreign-environment, and missing-folder projects. Worker bindings are
      refused on a shared executor while a dedicated one is a separate
      process. Releasing a project keeps the executor for the others, and
      stopping the executor ends every project's processes there.
    - `direct-mcp-per-environment-regression` now also checks that a Linux
      host-local server's children die with it.
    - Existing executor, terminal, delegation, and exec suites pass on both
      hosts. Worker suites pass after their fixtures gained
      `executorPlacement: "dedicated"`, matching real worker projects. The
      native-Windows key pin and the drain-admission check now reflect
      shared executors.
    - `check:syntax`, `validate`, and the Workbench Electron smoke pass.
      The sweep caught one more test assumption:
      `direct-provider-external-production-wiring-regression` checked
      reaping by the server's own PID, which is now a namespace PID on Linux.
      It checks by command line there instead (Windows unchanged). With that,
      the full sweep is 270 of 289, failures identical to **Known failing
      checks**.
  - **Deviations:**
    - Long-lived MCP sessions aren't built (owner's call; see **Findings**).
    - The Windows Low-label cross-project write risk is recorded, not fixed.
    - The owner's Electron check is pending.

## Baseline and prerequisites

| Item | State |
|---|---|
| Thread access profiles (Read only / Workspace / Full access), sandboxed exec on Linux, preflight fail-open, Workbench routing not required | Done in `1c65a49`. Gate: `npm run direct:access-profiles`. |
| Windows test tooling | Present: Node 24, PowerShell 7, Codex CLI (npm), mirror at `C:\LexLattice\codex-review-shell-direct`. |
| WSL distros | `Ubuntu`, `docker-desktop`. `wsl.exe -l -q` output is UTF-16. |
| bubblewrap in WSL | 0.9.0, works with unprivileged namespaces. |

## Known failing checks

None fail as of 2026-10-08: the sweep expects no `FAILED` lines. The 19
checks that had failed since before this track (`8ecf16e`) were cleaned up:
seven now skip when what they need is missing, and twelve had stale
expectations, now fixed (below). Never add a row for a failure a turn
introduced.

**Skipped: need something this machine doesn't provide (7).** Each exits
with code 77 and a `SKIPPED:` reason when it's missing; the sweep lists them
as `SKIPPED`:

| Regression | Needs |
|---|---|
| `direct-arcagi3-workspace-workers-regression` | ArcAGI3 repo at `/home/rose/work/arcagi3-odeu-local` |
| `direct-container-ui-test-stack-regression` | Working Docker, including its configured credential helper (here `docker-credential-desktop.exe`, not on the WSL login PATH) |
| `direct-electron-read-approval-regression` | Live provider opt-in (`--allow-live-provider-call`) |
| `direct-governance-live-non-authority-regression` | Live provider opt-in |
| `direct-semantic-service-commissioning-regression` | `DIRECT_SEMANTIC_COMPILER_ROOT` |
| `direct-semantic-service-commissioning-recovery-regression` | `DIRECT_SEMANTIC_COMPILER_ROOT` |
| `direct-semantic-service-dss04-regression` | `DSS04_COMPILER_ROOT` at the pinned commit |

**Fixed stale expectations (12; turn 9 had already fixed
`direct-t3-alternate-gui-regression`):**

| Regression | Was | Fix |
|---|---|---|
| `direct-headless-tool-class-examples-regression` and five that validate the same example pack (`-live-candidate-gate`, `-live-smoke-report`, `-realism-report`, `direct-tool-activation-registry`, `direct-tool-promotion-decision-report`) | Example pack didn't cover `direct.inspect_self_constitution` | New example class `session_control.self_constitution_read` (harness-resident, read-only; runner `direct-self-constitution-regression`); downstream counts re-derived (covered tools 37 → 38, classes 18 → 19, fixture candidates 5 → 6, linked runners 15 → 17, the last also stale before) |
| `direct-manual-smoke-gate-regression`, `direct-module-context-intake-regression` | Pinned 38 / 37 registry rows; there are 111 | Counts derived from the registry (`DIRECT_INFORMATION_BRIDGE_ROWS`), plus a full-coverage check |
| `direct-manual-smoke-gate-surface-regression` | Gate `blocked` | Fixture lacked the now-required runtime witness; added, plus a case proving a missing witness blocks |
| `direct-external-wave18-usability-gate-regression` | `mcp_resource_read_binary_not_ref_only` | The gate's binary fixture declared 2,048 bytes with no payload; it now carries one |
| `direct-world-manager-semantic-ingress-regression` | Request-shape mismatch | Expected shape lacked `serviceTier` |
| `direct-world-manager-semantic-ui-regression` | Contract text changed | Asserts the current execution summary and that activity isn't completion |

## Findings to carry forward

Discovered during planning; not in any turn's scope unless a turn adopts them.

- Fixed 2026-10-08: `ultra` is no longer sent literally. As in Codex, the
  turn requests the model's `multi_agent_reasoning_effort` from the account's
  list, else `max` if offered, else the model's highest level (`xhigh`
  without a list); the thread keeps "ultra" and the turn records what was
  sent. Codex also turns on proactive multi-agent delegation for Ultra;
  Direct doesn't. Gate: `direct-model-catalog` (19 checks).
- Fixed 2026-10-08: fork, derived-fork, and import-checkpoint starts carry
  effort, speed tier, and Daybreak (explicit options, else the source
  thread's, else the project's default effort) on the new thread, its turn,
  and its request.
- Added 2026-10-08: a provider stream silent for 10 s shows a warning ("the
  model's response has paused … still waiting") and another when it
  resumes; the request's longest silence and stall count are recorded and
  shown by `direct-drive`. Gate: `npm run direct:stream-stall`.
- Fixed 2026-10-09, from the Codex reviews of PR #313 (all three verified
  against the code first):
  - **Delegated subfolders followed symlinks** (P1). The subfolder check
    compared path text only, so `<accepting project>/link` pointing
    elsewhere counted as inside. The target environment's executor now
    reports each folder's resolved path (`fs/list` `realPath`); the
    accepting project's folder and the requested subfolder must be
    contained on those resolved paths (`canonicalFolderWithinRoot`), and
    the delegated project is created on the resolved folder.
  - **Parent-bound launches without setpriv** (P1). A `dieWithParent`
    launch silently lost its parent-death signal (still marked guaranteed)
    when the trusted `/usr/bin/setpriv` was missing. It is now refused
    (`workspace_linux_pid_namespace_parent_death_unavailable`).
  - **Symlink races in Workspace and Read only file operations**
    (security, P1). Host-side checks and the later open, write, or rename
    were separate steps, so a sandboxed command swapping a folder for a
    symlink in between could redirect them outside the project. Reads now
    re-resolve the path after opening and require it to name the very file
    opened (same device and inode) and to be allowed (credential stores
    and outside-the-environment reads refused; patch targets must be
    inside the project). Workspace patch writes run inside the sandbox,
    like Codex's apply_patch: `sandboxed-file-writer.js` under bubblewrap
    on Linux and the Low-integrity job runner on Windows, started with the
    app's own runtime (node, or Electron as node), so a swapped path can't
    reach outside whatever it resolves to. Full access still writes from
    the host. A write that fails partway is reported as ambiguous. Windows
    doesn't let a folder move while a file in it is open, so the read race
    exists only on Linux.
  - Gate: `npm run direct:review-findings` (Linux and Windows Node); live
    suite `workspace_patch` passes on both hosts.
- Changed 2026-10-08: earlier turns reach the model as Codex sends them.
  An implementation turn after the first replays each earlier turn as
  input items: the user's message, every call the model made
  (`function_call` / `custom_tool_call`) with its output (each output
  capped at 2,000 characters; self-constitution snapshots replaced by a
  short note; anything the exposure scan blocks is withheld), and the
  model's reply. Oldest turns drop first beyond a 60,000-character budget
  (`historyOmittedTurnCount`). Per-turn context evidence (epistemic,
  semantic, manager graph) follows the history, and the current message is
  the user's own words, so each turn's input begins with the previous
  turn's history. Before, the history was one quoted transcript where
  every tool call was a placeholder line ("ready_for_provider_continuation"),
  so the model re-ran commands to recall what they printed. The context
  pack still renders the quoted form, but the request manifest records
  what was sent (`continuityPolicy: fresh_request_with_history_items`,
  `providerHistory` with turn and item counts and any checkpoint,
  `quotedTranscriptSentToProvider: false`; since 2026-10-09); the turn's
  `requestShape` marks `historyItemsUsed` with the counts. Live: asked what
  an earlier command printed, the model answers from history without a
  tool call (live suite `remembers_tool_output`). Gate:
  `npm run direct:history-items`.
- Changed 2026-10-09: the model keeps its reasoning across a turn's
  requests, as in Codex. Every request asks for
  `include: ["reasoning.encrypted_content"]`; the transport keeps each
  response's finished `reasoning` items (id, summary, encrypted content,
  up to 512K characters each) and the store attaches them to the first new
  call of that response (`precedingReasoningItems`, on the turn record
  only, never in the session file or transcript). Each continuation sends
  them back right before that call, so the input reads like Codex's
  history: reasoning, call, output. Before, requests were stateless
  (`store: false`) and the model started every step with no memory of why
  it made its last call. Reasoning from earlier turns isn't replayed (the
  backend drops it between user turns anyway). The commissioning page
  request opts out (`includeReasoningContent: false`). Live, luna/high:
  the backend returned 1.4–1.7K-character encrypted items before calls,
  accepted them replayed without the calls' `fc_` ids, and the turn
  completed; at low effort luna rarely emits reasoning before a call.
  Gate: `npm run direct:reasoning-replay` (Linux and Windows Node); live
  suite 10/10 on both hosts.
- Changed 2026-10-09: parallel tool calls, as in Codex. Implementation
  turns and their continuations send `parallel_tool_calls: true` (other
  request paths keep `false`). When one response makes several calls,
  consecutive parallel-safe calls (`exec_command`, `write_stdin`,
  `read_file` under the thread's grant, `list_agents`, `inspect_agent`)
  run at the same time; anything else (patches, `run_command`, approvals,
  `spawn_agent`, ledger and permission calls) runs alone, after the calls
  before it. The continuation waits for the last result and lists every
  call and output in the order the model made them, not the order they
  finished. Request manifests record the flag. Live, luna/low: two
  3-second commands in one response finished in 3.2 s. Gate:
  `npm run direct:parallel-tool-calls` (Linux and Windows Node).
- Changed 2026-10-09 (owner's call): no per-turn sub-agent policy
  preflight. Every Workbench turn used to start with a separate model call
  (`gpt-5.3-codex-spark` by preference) that classified the message for
  standing sub-agent policy changes. Now the thread's model gets
  `update_sub_agent_policy` (offered with `spawn_agent`; same fields as the
  router's update action: role bindings, child cap, one-time authority,
  thread or project scope) and calls it when the user sets such a rule. The
  owner confirms each change through the user-input prompt (Apply / Don't
  apply), with the change described in plain words; only then does
  `admitConfirmedUpdate` admit it (provenance
  `operator_confirmed_proposal`), so text in a file or tool output can't
  change the policy on its own. A project-scoped change may proceed while
  its own turn runs. The policy editor still uses the semantic router.
  Also fixed: a continuation refused tools added after composition
  (`request_permissions`, `update_sub_agent_policy`) as
  `undeclared_tool_call`. Live, luna/low: the model called the tool, the
  owner applied it; a new project's first turn spent 4.6 s before its first
  request (6.8 and 9.2 s in two earlier runs with the preflight). Gate:
  `npm run direct:sub-agent-policy-tool`.
- Changed 2026-10-09: Ultra turns delegate proactively, as in Codex. When
  the chosen effort is Ultra (sent as the model's multi-agent effort) and
  the turn can spawn agents, its input ends with Codex's multi-agent mode
  message ("Proactive multi-agent delegation is active…", naming
  `spawn_agent` and `wait_agent`); continuations keep it, and
  `requestShape.proactiveDelegation` records it. Other efforts don't get
  it. Live, luna Ultra (sent as max): the turn completed and, for a
  trivial two-part question, answered without spawning. Gate:
  `npm run direct:proactive-delegation`.
- Changed 2026-10-09: context compaction, as in Codex. Before, a long
  thread silently dropped its oldest turns past 60,000 characters, and a
  long turn grew until its request failed.
  - Limit: 90% of the model's context window (`context_window` from the
    account's model list), or the model's `auto_compact_token_limit` if
    lower; tokens estimated as bytes/4 like Codex. With a known limit the
    history keeps every turn since the last checkpoint (outputs still
    capped at 2,000 characters) instead of the fixed 60,000-character
    budget, which remains the fallback.
  - Before a turn whose request would reach the limit, the earlier history
    is compacted the way Codex does it for ChatGPT accounts: the same
    instructions and tools with the history ending in a
    `compaction_trigger` item; the response's one `compaction` item
    (encrypted) plus the newest user messages (up to 64,000 tokens) becomes
    the thread's checkpoint (`sessions/<id>/compaction.json`, not the
    session file). Later turns start from the checkpoint, then the turns
    after it (a checkpoint whose last turn was rolled back is ignored).
  - If the remote form fails, the model writes a handoff summary with
    Codex's compaction prompt (no tools); the summary, behind Codex's
    summary prefix, replaces the history with the newest user messages up
    to 20,000 tokens, and Codex's "Long threads and multiple compactions"
    warning is shown. If both fail, older turns are dropped as before, with
    a warning.
  - Mid-turn: a continuation that would reach the limit first compacts the
    turn's input and results so far (`turn.turnCompaction`); later
    continuations carry that checkpoint, the turn's developer notes, and
    the results after it.
  - Manual: the Workbench header's Compact button
    (`thread/compact/start`, Codex's `/compact`), available between turns.
  - The transcript shows "Context compacted for this thread." (Codex's
    `contextCompaction` item), kept under the turn it happened in (a manual
    compaction: the last turn it covers), so it shows again after a reload.
    Compaction requests count in that turn's usage rows
    (`context_compaction_remote` / `_local`).
  - `get_context_remaining` now answers from the model's context window
    (account model list) and the turn's last request usage (input plus
    output); Direct's runtime status had no context fields, so it always
    said unknown. Gate: `npm run direct:context-remaining`.
  - Live suite `auto_compaction` lowers the limit through the test control
    port (`direct-drive test-settings --auto-compact-limit N`) and checks
    that the next turn compacts and still knows a number found only in a
    compacted command output. The Compact button was checked on screen in
    the WSL and Windows Workbench (`direct-drive screenshot`).
  - Live, luna/low, manual compaction: remote form accepted (1,352 → 605
    estimated tokens); asked afterwards, the model gave a number that
    appeared only in a compacted command output. (When the user had said
    nothing about the number, the checkpoint left it out; that's the
    backend's summary, as in Codex.) Gate: `npm run direct:context-compaction`.
- Added 2026-10-09: `view_image`, as in Codex. Offered wherever `read_file`
  is, under the same read rules (the access profile's, through the same
  file port, so it works in WSL and Windows executors too). The image (PNG,
  JPEG, GIF, or WebP by content, up to 1.4 MB so its base64 fits the
  executor's 2 MiB message frame) goes back the way Codex sends it: a
  `function_call_output` whose output is one `input_image` data URL
  (`detail: high`). Kept in `sessions/<id>/images/`, not in the turn record;
  later turns replay a text note instead of the image. A non-image is an
  answer to the model, not a failed turn. Parallel-safe like `read_file`.
  Gate: `npm run direct:view-image` (both hosts).
- Added 2026-10-09: the plan shows in the turn. When the model calls
  `update_plan`, the Workbench shows a checklist (`[x]` done, `[~]` in
  progress, `[ ]` pending, `[!]` blocked, `[-]` deferred) as the turn's
  plan item, replaced by each update and kept in the transcript. Gate:
  `npm run direct:plan-ui`.
- Added 2026-10-08: Windows commands start in an already-running
  PowerShell. The local process backend (also used natively by the
  Windows executor) keeps one idle shell per launch shape (sandbox
  profile, folder, cwd, environment; at most 4, idle 5 min) inside the job
  runner. It waits for one base64 line on stdin and dot-sources it with
  `if(-not $?){exit 1}` appended, which reproduces `pwsh -Command`
  exactly (output, UTF-8, exit codes for `exit N`, native failures,
  `Write-Error`, `throw`); later stdin belongs to the command. Measured:
  pwsh startup is 370–500 ms here; a command in a warm shell finishes in
  100–200 ms. Live: `exec` 0.2–0.3 s instead of 0.5–1.2 s, and the
  tools/harness gap per command step dropped from about 0.9 s to 0.5 s.
  Terminals still start cold. Since 2026-10-09 opening or resuming a thread
  warms its default shape (project root, no extra environment), so the
  thread's first command starts warm too (measured 215 ms). Gate:
  `direct-windows-prewarm-regression` (Windows Node; skips elsewhere);
  live suite 8/8 on Windows.
- Fixed 2026-10-09: a question to the owner (`request_user_input`,
  `request_permissions`, `update_sub_agent_policy`) no longer also shows
  the "Local approval is required" warning; only approvals do.
- `direct-native-windows-workspace-executor-regression` covers a WSL/Linux
  host reaching Windows; under Windows Node it now skips (a Windows
  workspace runs in-process there, by design). See "Windows regression
  sweep" under Findings for the rest of the Windows Node results.
- Fixed 2026-10-08: the workspace agent's own patch path (no task grant)
  accepts Codex's patch format (translated to git-style diffs; bare hunks
  located by context); deletes stay deferred there. Gate:
  `npm run direct:agent-codex-patch` (passes on both hosts).

- The owner's WSL terminal opened from a Windows app runs inside the WSL
  executor's user and PID namespace (as Full-access agent sessions do), so
  `sudo` and setuid programs fail there; in-process on a Linux host it is an
  ordinary shell. Running it outside the namespace trades containment (what
  it starts in the background could outlive the app) for a normal shell.
  Owner's call.
- Only the owner's terminal gets the executor's full environment (the
  owner's login environment there, `fullEnvironment`); agents' executor
  sessions still get the minimal one.

- Since 2026-10-09 Workbench turns no longer run a separate sub-agent
  policy model call first (see `update_sub_agent_policy` under Findings).
  The sub-agent policy editor still uses the semantic router.
- Continuations work as in Codex since the post-track continuation fix:
  every continuation (after a file read, patch, command, process session,
  self-constitution check, agent tool, or human decision) declares the
  thread's full tool set, there is no step cap (only context limits the
  turn), several calls in one response run one after another in order, and
  only per-call limits remain. Every continuation resends the turn's
  original input followed by each call the model made and its output, as
  `function_call`/`function_call_output` items (checked live against the
  ChatGPT backend with `store: false`). Results used to be quoted as one
  user message, so the model couldn't tell it had already made a call: one
  turn called `inspect_self_constitution` 58 times (about 5.1M input
  tokens). Gate: `npm run direct:tool-continuation-full-toolset`.
- The one loop guard: when a response repeats the previous three
  responses' exact calls (same tools, same arguments) and those all got the
  same result (ignoring IDs, timestamps, digests, and durations), the turn
  ends as `repeated_tool_call`. Polling tools (`write_stdin`, `wait_agent`,
  `list_agents`, `inspect_agent`) are exempt. Stop now ends the whole tool
  loop: one cancel signal per turn reaches every continuation request and
  is checked before each next call (before, it cancelled only the turn's
  first request). Gate: `npm run direct:tool-loop-guard`.
- Patches (fixed after a live Windows run, luna/low, where a bare `@@` hunk
  failed the turn as `direct_full_access_patch_invalid`): the grant-bound
  patch path (`full-access-local-environment.js`, also run by the WSL
  executor) takes Codex's format: bare `@@`, `@@ <anchor line>`, a first
  hunk without `@@`, `*** End of File`, and context matched exactly, then
  ignoring trailing, then surrounding whitespace (the file's own context
  lines are kept). A patch that doesn't parse or match goes back to the
  model as the call's output (`status: failed`, what didn't match, "read the
  file and retry", `workspaceChanged: false`) and the turn continues;
  confirmed live (miss → read → retry → done). The misleading "tool
  continuation evidence is not enabled" warning now appears only for a
  turn that is actually stuck. Gate: `npm run direct:patch-codex-format`.
  A patch that passes its dry run but fails to apply also goes back to the
  model and the turn continues. The apply re-reads and re-matches every
  file before writing, so a failure there (for example, the file changed
  after the dry run) is reported with `workspaceChanged: false`; a failure
  while writing is reported as `patch_execution_ambiguous` with
  `workspaceMayHaveChanged: true` and "read them before retrying". Gate:
  `npm run direct:patch-apply-failure`. The no-grant path in `wsl-agent.js`
  takes Codex's format too (see **Findings**).
- Agent-driven testing: `scripts/direct-drive.mjs` drives the real app
  (hidden, isolated test profile, test control port) on Windows or WSL; see
  `docs/DIRECT_AGENT_DRIVEN_TESTING.md`. Fixed from its first live runs:
  - The sub-agent policy preflight failed with `http_400` on a new
    project's first turn: with no cached model list it fell back to its
    policy candidate `gpt-5.3-codex-spark`, which ChatGPT accounts can't
    use. It now fetches the account's model list first.
  - `inspect_self_constitution` built its snapshot without the thread's
    grant, so under Full access every tool read as `not_granted` and edits
    and commands as needing per-action approval. It now carries the grant
    (rows read `granted` / `durable_task_grant`); live, the model answers
    that nothing needs approval.
  - Stop now also ends the commands the turn started (earlier turns'
    processes and the owner's terminals are untouched); live, a running
    counter froze when Stop was pressed.
  - Test profiles point the default "Example Project" at a scratch folder
    instead of the app's own checkout.
  - Absolute paths (`C:\…`, `/home/…`, `/tmp/…`, `/mnt/…`, `/Users/…`) were
    a blocking finding of the shared exposure scan: prompts naming a file
    were refused (`current_user_prompt_redaction_failed`), any reply with a
    path made the transcript projection "blocked" so the model's own
    earlier answers silently dropped out of later turns' context (live: it
    re-ran `pwd` to recall a path it had just printed), and `run_command`
    output with a path was withheld. Paths are now a warning, not a block;
    secrets and raw backend frames still block. Gate:
    `npm run direct:paths-in-dialogue`.
  - Slow and failed edit-and-run turns (5 to 28 s, one in three failing
    live): `exec_command` waited only 100 ms before returning a running
    session, so the model spent a whole provider round trip (once 19 s)
    composing `write_stdin {eof: true}` for a process that had already
    exited, and that write failed the turn as
    `direct_stateful_exec_session_not_live`. Now, as in Codex,
    `exec_command` waits up to 10 s for the command to finish
    (`yield_time_ms`, max 30 s, and at most half the idle timeout so a
    silent interactive process isn't killed first); `write_stdin` waits 250
    ms after writing (5 s for an empty poll); input sent to a process that
    already exited returns its final result (`alreadyTerminal: true`) and
    the turn continues. Live, luna/low, 3 runs each: WSL 10.1 / 4.8 / 5.0
    s, Windows 10.6 / 5.4 / 5.1 s, all completed, no polling. Driver
    reports now include a timeline (backend wait and model time per
    request, harness/tool gaps, exec durations). Gate:
    `npm run direct:exec-yield`.
  - Prompt caching: requests reported almost no cached input (0 or 1,792
    of 3k to 11k tokens per continuation). Two causes: Direct sent no cache
    key, and each continuation appended its guidance to the turn's
    instructions, which shifted the tools and the whole input so no prefix
    matched. Now every request carries the thread ID as `prompt_cache_key`
    and as the `session-id` / `thread-id` headers (the ChatGPT backend takes
    cache affinity from the headers, as the Codex CLI sends them), and
    continuations keep the instructions and tools byte-identical, adding
    their guidance as a trailing developer message. Live, luna/low, 3 runs
    each: 20 to 59% of input tokens cached on WSL and 41 to 52% on Windows
    (before: 0 to 10%). The backend usually serves the cache from two
    requests back, not the one just before. Across turns, the only
    per-turn text in the instructions was the self-constitution digest
    near the top; it now follows the dialogue as a developer message
    ("Self constitution snapshot for this turn: sha256:…"), so a thread's
    instructions and tools are identical from turn to turn and each turn's
    quoted dialogue extends the previous one (captured live). Live, a third
    turn read 2,816 of 3,800 input tokens from the cache. Long threads
    still lose the prefix when the recent-dialogue cap drops the oldest
    messages. Gate: `npm run direct:prompt-cache`.
  - Live suite: `scripts/direct-live-suite.mjs` runs seven real workflows
    (edit and run, slow command, patch recovery, Stop, question to the
    owner, path in a prompt, follow-up turn) through `direct-drive` and
    checks each outcome; see `docs/DIRECT_AGENT_DRIVEN_TESTING.md`. Its
    first run caught a Stop regression from the 10 s command wait: Stop
    found commands only through their obligations, which record the
    session after the wait, so a command Stop caught inside its wait kept
    running until the wait ended. The controller now tracks each turn's
    command sessions from the moment they start. 7/7 on WSL and Windows.
    Gate for the fix: `npm run direct:exec-yield`.
  - Seen in the same timelines, not caused by Direct: an occasional
    request streams quickly and then pauses 14 to 119 s before a short
    answer (no reasoning tokens), inside the backend's stream.
- Patch and command approvals no longer require a scoped implementation
  proof when the thread's grant names the tool. The real app has no proof
  store, so before this any `apply_patch` would have failed the turn as
  `unsupported_patch_tool_shape`.
- `request_permissions` (2026-10-08, owner's call: raise the Access
  profile rather than Codex's per-path permissions). In a Read only or
  Workspace thread the model gets a `request_permissions` tool (`access`:
  only the higher levels, `scope`: turn or thread as a suggestion,
  `reason`). The owner is asked through the user-input prompt: Allow for
  this turn, Allow for this thread, or Deny. A grant issues the higher
  Access at once and rebinds the running turn to it, so the next request
  already declares the new tools; a turn-scoped grant returns the thread to
  its previous Access when the turn ends (or, if the turn ended elsewhere,
  before the next turn starts). Full access threads aren't offered the
  tool. A command session started before the raise keeps taking
  `write_stdin` afterwards (checked 2026-10-09 on Linux and Windows Node:
  `npm run direct:stdin-after-raise`; the earlier "may refuse" note was a
  guess). Gate:
  `npm run direct:request-permissions`; live suite scenario
  `permission_request` passes on both hosts.
- Added 2026-10-09: per-command escalation and command rules, as in Codex
  (owner's call: Codex's model, allowed prefixes run outside the sandbox;
  rules global and per project; Codex's own `~/.codex/rules` files are not
  read). In Read only and Workspace threads `exec_command` takes Codex's
  `sandbox_permissions` (`require_escalated`), `justification`, and
  `prefix_rule`. A command that asks goes to the owner as Codex's
  `item/commandExecution/requestApproval` card: Approve once, Approve for
  this thread (that exact invocation: the shell string, or the program and
  its exact argument list), Always allow "<prefix>" in this project,
  Always allow "<prefix>" everywhere, Decline (the model is told it was
  declined; nothing runs), Cancel. Approved commands run in the same folder
  with the sandbox off (`danger-full-access`), still contained.
  - Rules: `prefix_rule(pattern, decision="allow")` semantics, kept in
    `<userData>/direct-sessions/authority/approval-rules.json` (global, or
    per project and environment: `wsl`, `windows`, `linux`). A command whose
    every part matches an allow rule runs outside the sandbox without asking,
    whether or not it asked to. Commands are split into parts across `&&`,
    `||`, `;`, and pipes only when every word is a plain literal (Bash; for
    a Windows project, conservative PowerShell parsing); anything with
    expansions, redirects, substitutions, subshells, globs, or `VAR=` stays
    one opaque command that matches no rule (Codex's lowering). A rule
    naming a program also matches it by path (`/usr/bin/git` for `git`).
  - The prefix offered is the model's `prefix_rule` when it covers every
    unallowed part and isn't a bare shell, interpreter, `git`, `rm`,
    `sudo`, or `npm run` (Codex's banned list, extended for PowerShell;
    a program named by path or with a Windows suffix counts as itself, so
    `/bin/bash` or `cmd.exe` is banned too),
    otherwise the whole command when it is the only unallowed part; none
    when no single rule would cover the line. The answer must name exactly
    the offered prefix.
  - Full access threads don't get the parameters (no sandbox to leave).
  - Gate: `npm run direct:exec-escalation` (both hosts; skips on Linux
    without a working bubblewrap).
- Since turn 8, configured MCP servers run in their own environment, and
  since turn 11b every server is tree-contained, including ones a Linux host
  runs itself. Since 2026-10-09 servers are long-lived, as in Codex
  (`McpSessionPool` in `mcp-stdio-transport.js`): one initialized server per
  (placement, command, args, cwd, environment), owned by the environment it
  runs in (the host's pool for its own servers, each executor's pool for
  servers there, so a lost executor takes its servers with it). Later and
  concurrent requests reuse it (`tool_search`'s three lists now share one
  server instead of starting three); the handshake runs once; a cancelled
  request sends `notifications/cancelled` and keeps the server; server
  requests are answered without failing what is in flight (forms go to the
  owner, see MCP tool calls below; `ping` is answered; sampling and roots
  get method-not-found, as Codex doesn't offer them); a crash
  or a timed-out request replaces the server on the next request; a config
  change for the same server stops the old process; servers stop after 10
  minutes idle, at app quit, and when their executor stops (at most 16 per
  pool). The host's scope, trust, and freshness checks still run on every
  operation before a request reaches a server. Children a server starts
  live as long as its session and are reaped with it (containment
  unchanged). Gates: `npm run direct:mcp-session-pool` (both
  hosts), `direct-mcp-per-environment` and
  `direct-provider-external-production-wiring` (updated; both hosts).
- Added 2026-10-09: what Codex reads from its home and the project, read the
  same way in the project's environment (owner's calls: import Codex's
  config plus a settings panel; Codex's skill and hook locations plus
  Direct's own; AGENTS.md with its scope as a per-project setting). One
  reader (`codex-home/codex-environment-context.js`, with a small TOML reader,
  `external/toml-lite.js`) runs in-process for the host's own environment and
  behind the executor's `codex/context` for the other one;
  `codex-context-service.js` keeps the result a few seconds per project and
  the turn takes it at its start.
  - **MCP servers from `config.toml`.** `[mcp_servers.<name>]` from
    `$CODEX_HOME/config.toml`, plus `.codex/config.toml` from the project
    root down to cwd when the project is trusted (`[projects."<path>"]
    trust_level = "trusted"`), deeper layers winning. Stdio (`command`,
    `args`, literal `env`, `env_vars`, `cwd`) and streamable HTTP (`url`,
    `http_headers`, `env_http_headers`, `bearer_token_env_var`, read in that
    environment), `enabled`, `startup_timeout_sec`/`_ms`, `tool_timeout_sec`,
    `enabled_tools`/`disabled_tools`, `default_tools_approval_mode` and
    per-tool `approval_mode` (auto/prompt/writes/approve),
    `supports_parallel_tool_calls`. Codex's rules apply (name pattern;
    `command` xor `url`; no literal `bearer_token`). They join the project as
    `codex_<name>`, run where the project runs, and are read live, never
    copied into Direct's config; values (env, headers) stay in memory and the
    renderer sees only names. Every project gets its environment's servers,
    as in Codex; the panel's per-project switch turns one off.
  - **Streamable HTTP** (`mcp-stdio-transport.js`, `McpHttpChannel`): POST per
    message with `Accept: application/json, text/event-stream`;
    `Mcp-Session-Id` from initialize and `MCP-Protocol-Version` on later
    requests; JSON or SSE replies, where the server's own requests (forms,
    ping) arrive and their answers are POSTed back; DELETE at the end; a 404
    for a known session closes it so the next request starts over; 401/403
    reported as unauthorized. HTTP servers are reached from the host.
    `notifications/initialized` is delivered before the handshake counts as
    done. OAuth login isn't supported (bearer tokens and headers are).
    Checked live: the owner's `openaiDeveloperDocs` HTTP server answered and
    its five tools were declared.
  - **URL forms**: `mode: "url"` with an https link (no embedded
    credentials) shows Open link and I finished (accept; opening alone
    doesn't), Decline, Cancel, as Codex's TUI; anything else is declined.
  - Tool lists for a turn are fetched from all servers together and kept two
    minutes (a failure one minute), so a slow or broken server doesn't hold
    up every turn.
  - **Settings panel** (Project settings, "MCP servers, skills, and hooks"):
    Codex's servers read-only with a per-project switch; Direct's own servers
    add, edit, remove, and switch (stdio or HTTP, env and headers, runs-in,
    tool filters, approval, timeout); AGENTS.md files and scope; skills and a
    switch; hooks with Trust. IPC: `direct-codex:context` (names, never
    values) and `direct-hooks:set-trust`.
  - **AGENTS.md**: `$CODEX_HOME/AGENTS.override.md` or `AGENTS.md`, then one
    file per directory from the git root down to cwd (override first, then
    `AGENTS.md`, then `project_doc_fallback_filenames`), within
    `project_doc_max_bytes` (32 KiB), skipped for an explicitly untrusted
    project. Sent first in the input as Codex's user message
    (`# AGENTS.md instructions for <dir>` / `<INSTRUCTIONS>`, the global text,
    `--- project-doc ---`, the project files). `agentsMdScope` per project:
    `workbench_and_children` (default), `workbench`, `all` (workspace workers
    too), `off`.
  - **Skills**: `SKILL.md` (front matter `name`, `description`,
    `metadata.short-description`) under `$CODEX_HOME/skills`,
    `~/.agents/skills`, a trusted project's `.codex/skills`, and
    `.agents/skills` from the git root down, plus Direct's `~/.direct/skills`
    and `<project>/.direct/skills` (depth 6, hidden folders skipped, deduped
    by path, `[[skills.config]]` enable rules, `[skills]
    include_instructions`). The catalog goes after AGENTS.md as Codex's
    `<skills_instructions>` developer message (8,000-character budget,
    descriptions shortened first). A `$name` in the prompt that names one
    skill adds its SKILL.md (up to 32 KiB, read only from inside a skill
    root, `codex/skill` in another environment) after the prompt as
    `<skill><name>…</name><path>…</path>…</skill>`.
  - **Hooks**: Codex's `[hooks]` in `config.toml` and `hooks.json` (user, and
    a trusted project's `.codex/`), plus `~/.direct/hooks.json` and
    `<project>/.direct/hooks.json`. Each hook runs only after the owner
    trusts it in the panel; its id covers event, matcher, command, and source
    file, so an edit needs a new approval (Codex's `trusted_hash`, kept by
    Direct). Hooks run as Codex runs them, outside the tool sandbox, but in
    the project's environment (its shell, the project folder, one JSON object
    on stdin; `hook/run` in another environment), with Codex's exit-2 and
    JSON decisions. Events: SessionStart (a thread's first turn) and
    UserPromptSubmit (block the turn, or add context as developer messages),
    PreToolUse (block a call, or rewrite its input), PostToolUse (feedback or
    context appended to the result), PermissionRequest (answer Direct's MCP
    approval or command escalation before it's shown), Stop (a block starts
    the next turn with the hook's reason, at most three in a row). Codex's
    legacy `notify` program runs after each finished turn with its
    `agent-turn-complete` JSON, once trusted like a hook. Not yet:
    SessionEnd, SubagentStart/Stop, Pre/PostCompact, Interrupt, MCP-tool
    hooks. On Windows the runner passes the program's own exit code through
    PowerShell (2 would otherwise arrive as 1).
  - Gates: `direct-codex-environment-context`, `direct-codex-context-turns`
    (a turn with all of it, real hook processes), `direct-mcp-http`;
    `direct-mcp-per-environment` covers `codex/context` and `hook/run` in the
    other executor; live suite `mcp_tool_call`, `mcp_form`, `mcp_approval`,
    `exec_escalation`.
- Added 2026-10-09: MCP tool calls, as in Codex (owner's call; before,
  Direct only listed tools and read resources, and any tool call was
  blocked). When a turn starts, the project's current, trusted servers are
  asked for `tools/list`, and each tool becomes a function
  `mcp__<server>__<tool>` (sanitized to `[A-Za-z0-9_]`, at most 64
  characters; a collision or a long name gets a 12-character hash of the
  raw identity; the schema cut down to Codex's keywords, `strict: false`).
  The catalog is kept on the turn, so every continuation declares the same
  functions. A call runs `tools/call` where the server runs (host or
  executor), with Codex's 300 s default timeout. The output is Codex's:
  `Wall time: … seconds\nOutput:\n` then `structuredContent` as JSON if
  present, else the text blocks; images go back as `input_image` content
  items (kept under `sessions/<id>/images/`), audio is left out. The turn
  shows an `mcpToolCall` item (server, tool, status, result or error,
  duration). Read-only tools (`readOnlyHint`) run in parallel with other
  parallel-safe calls.
  - Approval follows Codex's "auto" rule: a tool marked destructive asks, one
    marked read-only doesn't, an unmarked tool counts as destructive and
    open-world and asks. Full access doesn't ask (Codex skips the prompt
    when approvals are off and the sandbox is off). The prompt is Codex's
    shape (`mcpServer/elicitation/request` with
    `_meta.codex_approval_kind: "mcp_tool_call"`): Allow, Allow for this
    thread (in memory, Codex's "session"), Always allow this tool (saved
    per project in `<userData>/direct-sessions/authority/approval-rules.json`,
    Codex's `approval_mode = "approve"`), Decline (the model gets "user
    rejected MCP tool call").
  - Forms (`elicitation/create`): Direct advertises `elicitation` and sends a
    server's form to the owner as a form built from its `requestedSchema`
    (text, numbers, checkboxes, single and multiple choice); the answer is
    checked against the schema in the main process (an answer that doesn't
    fit is refused and the form stays open). The request's clock stops while
    the owner answers, on the host and in executors. A form from a server in
    the other environment reaches the host through an executor event
    (`mcp/elicitation`) and goes back with `mcp/elicitationRespond`. Stopping
    the turn cancels an open form. In Full access an empty confirmation form
    is accepted without asking (Codex does this); a form with fields still
    asks. A form during a resource read, or with no owner to ask, is
    declined, as Codex declines a form it can't deliver. A server's form
    names no call, so calls that can answer forms take turns on a server
    (others, such as resource reads and listings, don't wait); time spent
    waiting for a turn doesn't count against a call's timeout.
  - Gate: `npm run direct:mcp-tool-calls` (both hosts);
    `direct-mcp-session-pool`, `direct-mcp-per-environment` (a form from a
    server in the other executor, with the clock stopped), and
    `direct-provider-external-production-wiring` updated.
- Fixed 2026-10-09: Windows Workspace commands are isolated per project.
  The Low integrity label a Workspace command puts on its project folder is
  persistent and the same for every project, so a Workspace command in one
  project could write any other project folder that had run one. Now each
  project has its own SID (`S-1-5-21-…` from a hash of the folder), the
  runner grants it inheritable Modify on the folder (`--project-sid`, once
  per folder), and Workspace tokens are write-restricted to that SID, the
  logon SID (private TEMP, pipes), and Everyone (which PowerShell needs at
  startup, as in Codex's own restricted tokens; project folders don't grant
  Everyone). Low integrity stays, so credential stores keep their
  no-read-up labels. Not AppContainer: that would hide user-installed tools
  (Git, Python under the profile) from commands. The labels already on
  folders are left as they are; other Low-integrity programs on the machine
  (not Direct's) can still write labeled folders. Gate:
  `direct-windows-project-isolation-regression` (Windows Node).
- The WSL Workspace sandbox keeps `/tmp` writable (by design, as in turn 3),
  so project folders under `/tmp` can be written by Workspace commands from
  other projects. Projects normally live elsewhere.
- Linux host-local MCP servers fall back to an uncontained spawn when the
  trusted `unshare` launcher is missing (marked `guaranteed: false`), so
  existing setups keep working.
- Since turn 7, process sessions (`exec_command`) on Windows run under the
  job runner. Since 2026-10-09 the workspace backend's request-scoped command
  paths do too (`run_command` for threads without a task grant, Git probes,
  workspace-worker test profiles), with a Windows counterpart of the Linux
  quiescence proof: the runner's `--control` channel stops the job when asked
  and, when the job ends, writes a receipt once `ActiveProcesses` is 0
  (`windowsJobReceipt`). Request finalization keeps a Windows child in custody
  until that receipt proves it and everything it started are gone; a child
  without one (or a receipt that never comes) is still unverified. The
  containment probe now reports `windows_job_object`, so
  `direct-workspace-worker-lifecycle` and
  `direct-workspace-worker-policy-repository` run their live parts on Windows
  instead of skipping. `direct-headless-provider-workspace-worker` still
  skips on Windows (it needs native Windows workers and worktrees). Gate:
  `direct-windows-job-receipt-regression` (Windows Node).
- The job runner creates its command inside the job
  (`PROC_THREAD_ATTRIBUTE_JOB_LIST`) instead of assigning it after
  `CreateProcess` (since 2026-10-10). A runner killed between the two, which a
  Stop right after a prewarmed shell took its command could do, left the
  shell outside any job, suspended forever and holding the host's pipes
  open: `direct-test-control-regression` printed its result and then hung on
  Windows (on main too) until the shell's pipes closed, and every such run
  left a suspended `pwsh.exe` behind. Now that test exits in about 3 seconds
  and leaves nothing. A synthetic race (runners killed at 0-600 ms) didn't
  reproduce the leak with the old runner, so the gate is that test.
- Scratch `TEMP` folders are removed when a command closes. Leftovers from
  a host or executor that died abruptly (under
  `%LOCALAPPDATA%\codex-review-shell\direct-job-runner\scratch`) are swept
  when the Windows sandbox first starts in a process, if older than a day
  (since 2026-10-09; `npm run direct:scratch-sweep`).
- Bare `@@` hunk headers (Codex's patch format) are accepted: the patch
  parser locates them by context, and the workspace agent's own path
  translates Codex patches to numbered hunks first (checked 2026-10-09; the
  earlier note that they were rejected was out of date).
- The Workbench Electron smoke is not part of the sweep. It runs headless in
  WSL with
  `env -u DISPLAY -u WAYLAND_DISPLAY node scripts/direct-t3-alternate-gui-electron-smoke.mjs`
  (xvfb, throwaway profile) and writes screenshots under `/tmp`. UI turns
  should run it.
- On a WSL host the environment picker offers the current distro as "this
  machine", so projects created there are `wsl` projects (run locally, same
  distro) rather than `local` ones.
- The Windows launcher syncs the mirror from WSL, launchers included, while
  `cmd.exe` is executing them, and `cmd` reads batch files as it goes, so
  the first launch after a launcher change used to run garbled lines. Since
  2026-10-09 `start-codex-review-shell.cmd` and `sync-from-wsl.cmd` run from
  a copy in `%TEMP%`, and the per-experience wrappers call the launcher and
  exit on one line. Checked with a batch file that rewrites itself mid-run
  (the unprotected form stopped after the rewrite and returned 0; the copied
  form ran to the end and kept its exit code) and by running the new sync in
  the Windows test mirror while it rewrote itself. Not checked end to end
  with the full launcher, which stops the owner's running app.
- Windows regression sweep (2026-10-09). `npm run direct:regression-sweep`
  (`scripts/direct-regression-sweep.mjs`) runs every `direct-*` regression
  under the current host's Node, on Windows or Linux, and treats exit 77 as
  a skip. Run from the Windows test mirror (`--jobs 2`) it found two real
  bugs, both scripts a sandbox in WSL couldn't see when the app runs on
  Windows (the WSL executor's copy of the app sits under `/mnt/c`, which
  bubblewrap doesn't mount): the sandboxed file writer (now `node -e
  <source>` on Linux) and the terminal helper `pty-helper.py` (now
  `python3 -c <source>`). Other fixes were in the tests (stores closed
  before folders are removed, PowerShell quoting, `npm` run through `node`,
  host-aware expectations), plus OpenCode WSL paths built with
  `path.posix` on a Windows host. Tests that need Linux-only machinery
  (semantic-service host and commissioning process, headless provider
  workspace worker, ARO reconstruction runtime) or that target Windows from
  a Linux host (native Windows workspace executor) skip under Windows
  Node. (The workspace worker's positive containment cases skipped on
  Windows until the job runner's receipts, 2026-10-09; see above.) Result:
  Linux all pass; Windows all pass or skip. Rerun 2026-10-10 (`--jobs 4`):
  Linux 311 pass, 10 skip; Windows 309 pass, 12 skip. On the way, the native
  Windows workspace executor regression (run from Linux) now expects
  process-backed capabilities and runs a contained command in a throwaway
  folder, and the sandboxed writer goes in as `node -e <source>` on Windows
  too (the write-restricted token can't load it from `\\wsl.localhost`).
- UI turns must be checked through `start-direct-workbench.cmd` on Windows
  too, not only in WSL's Electron: the Windows launch path (mirror sync,
  Windows npm, Windows Electron) differs.
- The Windows credential discovery labels whatever stores exist under
  `%USERPROFILE%\.codex`, `%CODEX_HOME%`, `%USERPROFILE%\.codex-review-shell`,
  and `%APPDATA%\<app>[\<profile>]\direct-auth`. To undo a label:
  `icacls <file> /setintegritylevel M`.
- Since 2026-10-09 a provider body the transport can't read incrementally
  fails with its own code, `provider_body_not_streamable`, instead of
  `max_output` (which showed as `max_output_terminal`, as if the model had
  run out of output). Real output-budget overruns stay `max_output`.
- Fixed 2026-10-09: input sent to a Windows command right after it starts
  could be lost when the shell started cold. The prewarmed PowerShell read
  its command line with `[Console]::In.ReadLine()`, which buffers and
  swallowed the input meant for a program the command started; it now reads
  the line a byte at a time from the raw stream. Gate:
  `direct-windows-prewarm-regression` (input sent at once, cold and warm, to
  a native program).
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
- Executor sessions build their environment with the agent's
  `minimalCommandEnv`, which admits fewer caller variables
  (`SAFE_COMMAND_ENV_OVERRIDES`: CI, NO_COLOR, TERM, LANG, LC_ALL, TZ) than the
  host router's `safeExecEnvironment` (most uppercase names). A model setting
  other variables through `env` gets them locally but not in WSL from Windows.
  Align the two policies before relying on `env`.
- With the executor backend, cwd problems the host can't see lexically
  (missing directory, symlink escape) arrive as a failed session carrying the
  executor's message, not as a thrown error. The controller's
  actionable-error path therefore doesn't fire for them; the model still sees
  the message in the failed result.
- Full-access executor sessions run inside a user namespace (as all contained
  backend processes already did), so `sudo` and other setuid programs don't
  work there.
- The credential policy names two stores (`.codex/auth.json`,
  `direct-auth/auth.json`). Other user secrets (SSH keys, cloud CLI tokens)
  stay readable in Workspace and Read only, as in vanilla Codex's workspace
  mode. Widening the list is a product decision, not a bug.
- The restricted (no-grant) read path in `read-only-authority.js` and the
  workspace backend's own `readFile`/`applyPatch` still exist for threads
  without a task grant; they were not changed this turn.
- On a Windows host, Node children are in libuv's job, which allows silent
  breakaway, so anything a command starts survives both killing the command
  and a host crash. That applies to today's local Windows backend under Full
  access (measured in turn 6); turn 7's job runner fixes it.
- Codex's unelevated Windows sandbox treats `%TEMP%` as a writable root and
  adds a persistent, inheritable Modify ACE for a new capability SID to the
  user's real `%TEMP%` on each fresh `CODEX_HOME`. This machine also carries
  Codex's elevated setup from 2026-07-13 (`CodexSandboxOffline`/`Online`
  accounts, firewall and WFP rules, `CodexSandboxUsers` ACEs on `%TEMP%`),
  which ended in `setup_error.json`. Not Direct's state; noted so it isn't
  mistaken for ours.
- Under Low integrity, tools that write caches in the user profile (npm, pip,
  the PowerShell module cache) fail unless redirected, as they do under the
  Linux Workspace sandbox. Turn 7 may want to point well-known cache
  variables at the scratch directory.

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-10-06 | One host, one native executor per environment | Single UI, DB, auth, and grants; each agent stays native. Matches Codex's `exec-server` direction. |
| 2026-10-06 | Extend our own Node executor; model its protocol on Codex `exec-server` | Already runs in both environments over stdio and carries existing custody work; `exec-server` is experimental and websocket-based. Matching shapes keeps a swap possible. |
| 2026-10-06 | Keep per-project executors until turn 11 | Equivalent for agent nativeness; avoids an early refactor with no user-visible value. |
| 2026-10-07 | One executor per environment, each request naming its project; workspace workers keep a dedicated executor (supersedes the row above) | Owner's call. Requests carry `projectContext`, which the executor validates (absolute, this environment, an existing folder) and runs the request in through `AsyncLocalStorage`, so every root-relative rule (paths, cwd, sandbox binds, containment checks) applies to that project and nothing falls back to another one. A worker's binding is immutable per executor, so it keeps its own. |
| 2026-10-06 | `environment/describe` never spawns a process | The Windows executor may not create processes before Job Object containment exists, and describe must work everywhere. Versions that need a process (bash) stay `unprobed`. |
| 2026-10-06 | Executor regressions run on both hosts from one file | Windows Node can run the WSL repo's scripts over the UNC path, so each executor turn verifies both launch directions without syncing the Windows mirror. |
| 2026-10-06 | Remote process sessions start asynchronously behind a synchronous `launch` | The router's `start()` and its callers are synchronous; a handle that starts the remote process on the next tick keeps every caller unchanged, and refusals still reach the model as failed sessions. |
| 2026-10-06 | Executor sessions use the native login shell (`bash -lc`) | That is what a WSL user's terminal runs, so PATH and tools (nvm, pyenv) match what the agent would see natively. |
| 2026-10-06 | Commands run in a non-login `bash -c` (supersedes the `bash -lc` row above) | Sourcing the login profile cost about 0.4 s per command (nvm), which broke the 100 ms first-yield expectation in `direct-everyday-continuation`. The executor itself starts through a login shell, so commands still inherit the login PATH. |
| 2026-10-06 | One environment facts object drives instructions, tool descriptions, and the self-constitution snapshot | The model can't be told one shell in the instructions and another in a tool description if both render from the same facts, and the snapshot shows exactly what the model was told. |
| 2026-10-06 | Process sessions die with their executor, however it stops | A lost executor can never report on or clean up its processes later, so leaving them running would leak unsupervised work. |
| 2026-10-06 | Credential exposure: Full access unrestricted; Workspace and Read only can't reach Windows drives, WSL interop, or credential stores | Full access matches a native full-access agent on either OS (and vanilla Codex). The sandboxed profiles keep a WSL agent on its own Linux filesystem, which is the track's goal, and keep tokens out of model context. Hiding interop is also what makes the sandbox a sandbox: otherwise a sandboxed command can start an unsandboxed Windows process. |
| 2026-10-06 | Windows containment uses a Direct-owned job runner, not Codex's sandbox | Codex's jobs allow breakaway and keep descendants alive by design; its unelevated network blocking is advisory and its real isolation needs accounts, firewall rules, and UAC; it has no stable third-party interface. A ~300-line runner built by the in-box `csc.exe` covers containment fully without admin rights. Details in `DIRECT_WINDOWS_CONTAINMENT_DECISION.md`. |
| 2026-10-06 | Windows Workspace and Read only use integrity levels; network stays unenforced | Low integrity with a Low-labeled project folder confines writes; adding a write-restricted token gives Read only; a Medium no-read-up label hides credential stores; WSL interop is blocked for free. Nothing short of admin-provisioned firewall rules can block the network, so Direct states that instead of claiming it. |
| 2026-10-06 | A Windows workspace runs in-process on a Windows host | The host is then that environment, so the in-process backend with the job runner is the native executor; going through a second Node process would add nothing. From WSL or Linux, the Windows executor runs it. |
| 2026-10-06 | Patches keep each file's line ending; new files follow the environment | Normalizing to LF silently rewrote every line of CRLF files. New files use CRLF on Windows because that is what the model is told. |
| 2026-10-06 | MCP servers run in the project's environment by default | That is where the agent's tools run, and it matches Codex. A server explicitly named for another environment needs a `cwd` there to anchor its executor, since executors are per project folder until turn 11. |
| 2026-10-06 | Only the MCP transport crosses to an executor | The executor runs the same one-request exchange as the host and returns the raw result; trust, freshness, scope, and every envelope check stay on the host, so a remote server can't widen what a local one could do. Variable values come from the server's own environment, never from the host. |
| 2026-10-06 | One file implementation, two placements | The executor runs the host's `LocalFilePort` natively, so local and WSL file rules can't drift apart; the host only plans. |
| 2026-10-07 | A delegated child is a full Direct thread in a target project, not a worktree worker or a retargeted grant | Everything that places a thread in an environment is keyed on its project, so a project-bound child is native there by construction; worktree workers have no shell, stay in the parent's environment, and can't run on Windows. The owner's per-project "Accept delegated work" limit is the authorization, and the child's Access is the lower of it and the parent's. |
| 2026-10-07 | Fast and Daybreak are per-thread modifiers sent only when the model's catalog entry offers them; the default model lives in project settings | Matches Codex's request shape (`service_tier: "priority"`, `access_programs.cyber`) and its live per-model data. Choosing a default is a different act from switching a thread's model, so the picker only switches (owner's call). |
| 2026-10-07 | Terminals use the job runner's ConPTY mode on Windows and a small Python pty helper on Linux, with one framed stdin protocol | No native Node module (node-pty would need a build per Electron and per Windows/Linux Node); the runner already contains Windows processes, and `python3` is on every supported distro. Framing carries resize and signals next to typed bytes over the existing stdio. |
| 2026-10-07 | The owner's terminal is unsandboxed but contained, in the project's environment | The owner's choice: it is their own shell, so Full access semantics and their own environment variables, but it still ends with the app. |
| 2026-10-07 | Model availability follows Codex: the account's `/models` list, signed in is ready, the server rejects | A per-model probe gated every new model behind a manual refresh and expired after 7 days; Codex trusts the list and handles rejection. The probe stays as an optional "Test model". `client_version` is the installed Codex CLI's, so the list matches what Codex itself would offer. |
| 2026-10-08 | Continuations keep the full tool set, have no step cap, and run several calls per response in order; only per-call limits stay | Owner's call, matching Codex. A self-constitution check had left the model with no tools ("this continuation exposes no executable tool interface"), and per-family rules and step caps stopped real work midway. |
| 2026-10-08 | "No step cap" covers distinct work only; the same call with the same result repeating is stopped | Owner's call, after a 58-call `inspect_self_constitution` loop. |
| 2026-10-08 | Agent testing drives the real app through an opt-in local test control port, with an isolated profile, `gpt-6-luna`/low by default, on both hosts | Owner's call. The older headless scripts built their own reduced controller or tool loop, so they didn't test what the owner runs. |
| 2026-10-09 | Workspace patch writes run inside the sandbox; Workspace and Read only reads are identity-checked after opening | Owner's call after the security review. Node has no directory-relative file calls, so the host can't close a symlink race on its own; the sandbox can't reach outside however a path resolves. This is how Codex runs apply_patch. |
| 2026-10-09 | MCP server tools are callable as in Codex; approval follows Codex's annotation rule (none in Full access), with "for this thread" and "always" per project; server forms go to the owner; Full access accepts an empty confirmation | Owner's call. Server forms almost always come from tool calls, so forms without tool calls would have been nearly unused. |
| 2026-10-09 | Sandboxed threads get Codex's per-command escalation; saved allow rules (global or per project and environment) run matching commands outside the sandbox without asking; Codex's own rules files are not read | Owner's call. Prompt-only rules would have added nothing: sandboxed profiles never prompt per command. |
| 2026-10-08 | `request_permissions` raises the thread's Access profile for the turn or the thread; it doesn't grant per-path or network-only permissions | Owner's call. It reuses Direct's grants and sandboxes as they are; Codex's path-scoped form would mean widening bubblewrap binds and Windows labels per request. |
| 2026-10-08 | Every request carries the thread ID as `prompt_cache_key` and `session-id`/`thread-id` headers; continuation guidance is a trailing developer message, not an instructions suffix | Matches the Codex CLI's cache identity. The backend's cache matches exact prefixes, so a turn's instructions and tools must not change between its requests. |
| 2026-10-08 | `exec_command` waits up to 10 s (`yield_time_ms`, max 30 s, at most half the idle timeout) for the command to finish; `write_stdin` waits 250 ms, or 5 s for an empty poll (supersedes the 100 ms first yield in the 2026-10-06 rows) | Codex's defaults. A 100 ms wait turned every command longer than that into an extra provider round trip, measured live at up to 19 s, and a write to the exited process then failed the turn. |

## Plan changes

| Date | After turn | Change | Reason |
|---|---|---|---|
| 2026-10-06 | 0 | Added a full regression sweep to every turn's gates, with an expected-failures list. | The four originally known failures were a sample; the sweep found 20 more, so "validate passes" alone can't detect regressions. |
| 2026-10-06 | 0 | Turn 9 also fixes `direct-t3-alternate-gui-regression`. | It pins Workbench DOM ids, which turn 9 changes anyway. |
| 2026-10-06 | 5 | Commands run in `bash -c` instead of turn 3's `bash -lc`. | See **Decisions**: the login profile's startup cost broke a latency expectation, and PATH is inherited from the executor's login shell anyway. |
| 2026-10-06 | 6 | Turn 7 builds Workspace and Read only on Windows instead of refusing them, and also wraps the host's local Windows backend in the job runner. | The spike proved both profiles without admin rights, and measured that the local Windows backend leaks process trees today. |
| 2026-10-06 | 6 | Network is reported as not enforced for Windows Workspace and Read only. | No non-admin mechanism blocks it; see **Decisions**. |
| 2026-10-06 | 5 | Turn 7 reuses `nativeShellCommand` for its PowerShell sessions. | The planner already picks `pwsh` or Windows PowerShell 5.1 with `-NoLogo -NoProfile -NonInteractive`; turn 7 adds UTF-8 output and Job Object containment around it. |
| 2026-10-06 | 8 | Hook and skill-script routing is dropped from turn 8; whoever enables hook execution must route it through the environment's process sessions. | Direct never executes hooks or skills; skill scripts run only through `exec_command`, which is already per-environment. |
| 2026-10-06 | 8 | Turn 11 should also contain host-local MCP servers on Linux and consider long-lived MCP sessions per environment. | Both surfaced here; neither blocks per-environment placement. |
| 2026-10-07 | 10 | Turn 11 split into 11a (terminals and the Terminal panel) and 11b (one executor per environment, plus turn 8's MCP items). | Owner's call. Executors are keyed per project folder throughout, so 11b is a refactor of its own; terminals are independent and visible to the owner. |
