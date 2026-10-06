# Direct Dual-Environment Agents: Plan and Turn Log

Status: active. This is the working document for the dual-environment
track. Read it at the start of every turn, and update it at the end of every
turn before committing.

Last updated: 2026-10-06, after turn 9.

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

**Turn 10: cross-environment delegation.** (Turn 9 still needs the owner's
manual Electron smoke.)

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

- Status: planned
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

Expected `FAILED` lines from `scripts/direct-regression-sweep.sh` (19 as of turn 9).
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

**Stale expectations outside this track (12; turn 9 fixed
`direct-t3-alternate-gui-regression`):**

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
- Since turn 8, configured MCP servers run in their own environment. Two
  gaps remain:
  - **Linux host-local servers aren't tree-contained.** A server that runs on
    a Linux host itself (`runsIn: "host"`, or a local project) is still a
    plain `spawn`, so anything it starts outlives it. Servers in a WSL
    executor and every Windows server are contained.
  - **One process per request.** Servers are started for each request, so
    stateful servers and server-initiated sessions aren't supported (as
    before).
- Since turn 7, process sessions (`exec_command`) on Windows run under the
  job runner. The workspace backend's request-scoped command paths still
  refuse on Windows (`workspace_windows_job_object_containment_unavailable`
  from `containedWorkspaceProcessSpawn`): `run_command` for threads without a
  task grant, and workspace-worker test profiles. Moving them to the runner
  means giving its process groups and quiescence receipts a Windows
  counterpart.
- Scratch `TEMP` folders are removed when a command closes. If the host or
  executor dies abruptly, leftovers stay under
  `%LOCALAPPDATA%\codex-review-shell\direct-job-runner\scratch`; nothing
  sweeps them yet.
- The patch parser rejects a bare `@@` hunk header (vanilla Codex accepts
  it); hunks need `@@ -a,b +c,d @@`.
- The Workbench Electron smoke is not part of the sweep. It runs headless in
  WSL with
  `env -u DISPLAY -u WAYLAND_DISPLAY node scripts/direct-t3-alternate-gui-electron-smoke.mjs`
  (xvfb, throwaway profile) and writes screenshots under `/tmp`. UI turns
  should run it.
- On a WSL host the environment picker offers the current distro as "this
  machine", so projects created there are `wsl` projects (run locally, same
  distro) rather than `local` ones.
- The Windows credential discovery labels whatever stores exist under
  `%USERPROFILE%\.codex`, `%CODEX_HOME%`, `%USERPROFILE%\.codex-review-shell`,
  and `%APPDATA%\<app>[\<profile>]\direct-auth`. To undo a label:
  `icacls <file> /setintegritylevel M`.
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
