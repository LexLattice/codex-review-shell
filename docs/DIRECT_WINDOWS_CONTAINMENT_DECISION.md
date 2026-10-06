# Windows Containment and Sandbox: Decision

Status: decided (turn 6 of `DIRECT_DUAL_ENVIRONMENT_AGENTS_MASTER.md`);
implemented in turn 7 (`src/main/direct/tools/windows-job-runner.*`).
Date: 2026-10-06. Machine: Windows 11 IoT Enterprise LTSC 2024 (26100),
Node 24.19.0, PowerShell 7.6, Codex CLI 0.160.1.

## Question

Can Direct reuse the Codex package's Windows sandbox for the Windows executor
(turn 7)? Turn 7 needs three things:

- **Containment:** a command's whole process tree dies on kill, on timeout,
  and when the host dies.
- **Workspace:** writes only inside the project folder.
- **Read only:** no writes anywhere.

If Codex's sandbox doesn't cover these, which minimal native helper should
Direct use instead?

## Answer

Direct won't reuse Codex's sandbox. Turn 7 ships a small Direct-owned job
runner (`scripts/spikes/windows-containment/job-runner.cs` is the prototype)
that does three things:

1. Runs every Windows command, in every access profile including Full access,
   inside its own Job Object with kill-on-close and no breakaway.
2. For Workspace, runs the command at Low integrity, with the project folder
   labeled Low.
3. For Read only, runs the command at Low integrity with a write-restricted
   token.

Credential stores get a no-read-up label. Network access is **not** enforced
on Windows, and Direct says so instead of pretending. No step needs
administrator rights, and nothing creates accounts, firewall rules, or
services.

## Evidence

### Proof script

Run it under Windows Node. It skips on other hosts.

```powershell
& 'C:\Program Files\nodejs\node.exe' \\wsl.localhost\Ubuntu\home\rose\work\LexLattice\codex-review-shell-direct\scripts\spikes\windows-containment\windows-containment-spike.mjs
```

The script compiles the runner with the in-box .NET Framework compiler
(`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`) and asserts
every claim below. Results on this machine:

| Probe | Today (Node spawn, no runner) | With the job runner |
|---|---|---|
| Kill the command | Shell dies; **its child keeps running** | Shell, child, and a `detached` grandchild all die |
| Host process crashes | Shell dies (libuv's job); **its child keeps running** | Whole tree dies |
| Command exits, child still running | Child keeps running | Child dies; exit code passes through |
| Piped stdin, stdout, stderr | n/a | Pass through unchanged |
| Added latency (median of 5, `exit 0` in pwsh) | 293 ms baseline | +73 ms (Medium), +88 ms (Low) |

The leaks in the "Today" column come from libuv's job, which allows silent
breakaway: only Node's direct children are in it. That affects Direct's local
Windows backend today, Full access included.

| Probe (Low integrity) | Workspace (`low`) | Read only (`low-read-only`) |
|---|---|---|
| Write in the project folder (labeled Low) | ok | denied |
| Write in another folder, the user's `%TEMP%`, or the profile | denied | denied |
| Write in `%LOCALAPPDATA%\Temp\Low` | ok | denied |
| Write in the command's private scratch `TEMP` | ok | ok |
| Read any other file | ok | ok |
| Read or list a folder labeled Medium no-read-up (credential stand-in) | denied | denied |
| Host (Medium) reads that folder | ok | ok |
| Run `node`, `git`, pwsh in FullLanguage mode | ok | ok |
| Run `wsl.exe` | denied (`Wsl/E_ACCESSDENIED`) | denied |
| Connect to a loopback TCP port | ok (network not restricted) | ok |

Three details the prototype had to get right; turn 7 must keep them:

- **Scratch `TEMP`.** PowerShell falls back to ConstrainedLanguage when it
  can't write its AppLocker test file to `%TEMP%`. Every contained command
  therefore gets a private scratch `TEMP`/`TMP` with a Low label and an
  Everyone ACE.
- **Logon SID for Read only.** A write-restricted token must list the logon
  SID as a restricting SID. Without it, processes fail with
  `STATUS_DLL_INIT_FAILED`.
- **Default DACL for Read only.** The write-restricted token's default DACL
  must grant the logon SID. Otherwise the command can't write to its own pipes
  and child processes, and any piped native command fails with "Access is
  denied".

### Codex's Windows sandbox (source study)

Source: `openai/codex` at `ccde2fc`, crate `codex-rs/windows-sandbox-rs`
(Apache-2.0). The job semantics live in `codex-rs/utils/pty/src/win/job.rs`.

- **Jobs allow breakaway.** Production spawns use
  `KILL_ON_JOB_CLOSE | BREAKAWAY_OK` (`job.rs:43-60`). A no-breakaway variant
  exists, but only tests use it.
- **Descendants survive by design.** After the root process exits normally,
  `preserve_descendants()` turns off kill-on-close and makes `terminate()` a
  no-op (`job.rs:215-246`; called from `lib.rs:875-898`, `legacy.rs:452-463`,
  `command_runner/win.rs:657-680`).
- **Two modes.**
  - Unelevated: a restricted token derived from the user, plus per-root
    capability SIDs whose ACEs are written onto the writable roots.
  - Elevated: two local accounts (`CodexSandboxOffline`/`Online`), a
    `CodexSandboxUsers` group, firewall and WFP rules, HKLM registry entries,
    and DPAPI-stored passwords. Provisioning needs a service or a UAC prompt.
- **Network.** Unelevated mode sets proxy environment variables to
  `127.0.0.1:9`, which programs can ignore. Real blocking only exists in
  elevated mode.
- **Reads.** Reads stay broad in both modes. Deny-read exists only in
  elevated mode.
- **No stable interface for third parties.** `codex-command-runner.exe`
  speaks an internal framed protocol (version 6) over named pipes and expects
  provisioned accounts and a private desktop. `codex sandbox` is a CLI front
  end with no compatibility promise.

### Codex's Windows sandbox (live probe)

`codex sandbox -P :workspace -c windows.sandbox="unelevated"` was run with a
throwaway `CODEX_HOME`.

- **Writes were confined.** Writes landed in the workspace and in its
  writable temp root. They were refused elsewhere, including the user
  profile.
- **Reads and loopback were open.** `HTTP_PROXY` was `http://127.0.0.1:9`.
- **A child outlived the command.** A process started by the command was
  still running after the command exited. `codex.exe` itself didn't exit for
  more than 60 s, because that child held the output pipe.
- **Persistent ACEs on real folders.** On the first run, Codex added an
  inheritable Modify ACE for a new capability SID to the **user's real
  `%TEMP%`**, because it treats `TEMP` as a writable root. The probe removed
  the two ACEs it caused. Later runs pointed `TEMP` at a scratch folder.

This machine also still carries state from an elevated Codex setup on
2026-07-13: the two sandbox accounts, firewall rules and WFP filters, and
`CodexSandboxUsers` ACEs on `%TEMP%`. That setup ended with
`setup_error.json` ("read ACL run had errors"). None of it is Direct's.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| Shell out to `codex sandbox` per command | Rejected | Descendants survive root exit, and output can hang behind them. There's no network boundary unelevated. It writes persistent ACEs to the user's folders (including `%TEMP%`). There's no stable CLI contract, and it ties Direct to Codex releases. |
| Launch `codex-command-runner.exe` directly | Rejected | It's an internal protocol, and it needs Codex's provisioned accounts, pipe authentication, and desktop. Run as the plain user, it gives nothing. |
| Vendor and build the crate | Rejected for now | It's the strongest isolation, but it pulls in a large part of the Codex workspace and a Rust toolchain. The elevated mode Direct would want needs accounts, firewall rules, and UAC, which is far beyond this track. Revisit only if network enforcement on Windows becomes a requirement. |
| Direct-owned job runner with integrity levels | **Chosen** | It covers containment fully and covers Workspace and Read only writes. Credential stores are hidden and WSL interop is blocked. It needs no admin rights and no new accounts. About 300 lines of C#, built by an in-box compiler. |

## Decisions for turn 7

1. **Containment for every profile.** Every Windows command runs under the
   job runner:
   - The job handle isn't inheritable, kill-on-close is set, and breakaway
     isn't allowed.
   - The process is created suspended and assigned to the job before it runs.
   - The job is terminated when the root process exits.
   - Exit codes and stdio pass through unchanged.

   This also fixes the Full access leaks measured above. Killing the runner
   (timeout, cancel, or host crash through libuv's own job) kills the whole
   tree.
2. **How the runner is built and shipped.** It's built at first use from its
   C# source with the in-box `csc.exe` (.NET Framework 4.8 ships with Windows
   10 1903 and later and with Windows 11). It's cached in the host's
   `userData`, keyed by the source digest. If `csc.exe` is missing or the
   build fails, Windows commands are refused with a clear message, the same
   way a missing bubblewrap refuses sandboxed commands on Linux. A prebuilt,
   signed binary replaces this only if antivirus friction shows up.
3. **Workspace.**
   - The command runs at Low integrity.
   - The project folder gets an inheritable Low label once, when Workspace is
     first selected for it. The label persists and is harmless to
     Medium-integrity processes.
   - Each thread gets a private scratch `TEMP`/`TMP`, the Windows counterpart
     of the writable `/tmp`.
4. **Read only.**
   - Low integrity plus a write-restricted token (restricting SIDs: Everyone
     and the logon SID), with the default DACL granting the logon SID and
     SYSTEM.
   - The command gets the same scratch `TEMP`.
   - This holds even on a folder a Workspace thread already labeled Low.
5. **Credential stores.**
   - Direct's auth directory gets an inheritable Medium no-read-up label.
   - `%USERPROFILE%\.codex\auth.json` gets the same label on the file itself.
     It's checked and reapplied before each contained command, because a
     rewrite through a temp file and rename drops the label.
   - The host, at Medium integrity, keeps full access.
6. **Network.**
   - Workspace and Read only don't block the network on Windows. No
     mechanism exists without admin rights, and Codex's proxy variables are
     advisory only.
   - The execution-environment facts report network as not enforced. The
     model instructions and the Access menu say "Network isn't blocked on
     Windows."
   - Firewall-based blocking for a dedicated account stays out of scope.
7. **WSL interop.** Nothing to add: Low-integrity processes can't start WSL.
   This is the Windows-side counterpart of turn 4's `/mnt` and `/run/WSL`
   masking.

## Known costs

- **Tool caches can't be written.** Tools that write caches under the user
  profile fail in Workspace and Read only unless pointed elsewhere: npm cache,
  pip cache, the PowerShell module analysis cache. This matches Linux, where
  the home directory is read-only in those profiles.
- **Latency.** About 70–90 ms is added per command, on top of pwsh's own
  ~300 ms startup.
- **The workspace label persists.** Any Low-integrity process can write to a
  Low-labeled project folder. Removing the label is a single `icacls` call,
  which the Workbench can offer.
- **No access to higher-integrity windows.** Low-integrity processes can't
  send messages to higher-integrity windows (UIPI), so GUI automation from a
  contained command won't work.
- **Labeled stores only.** Reads stay as broad as on Linux. Only the labeled
  credential stores are hidden.
