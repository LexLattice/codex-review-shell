# Agent-driven testing of the real Direct app

`scripts/direct-drive.mjs` lets an agent test real workflows with real model
calls in throwaway threads. It starts the actual app (same `src/main.js`
wiring as the Workbench: controller, executors, grants, model catalog, MCP)
hidden, with an isolated test profile, and drives it through a local test
control port (`src/main/direct/test-control/test-control-server.js`).

Defaults: `gpt-6-luna`, low effort, Full access. Override per run with
`--model`, `--effort`, `--access full_access|workspace|read_only`.

## Hosts

Run the driver with the Node of the host whose app you want:

| Host | Command prefix | App runs from | Test profile |
|---|---|---|---|
| Windows | `& 'C:\Program Files\nodejs\node.exe' \\wsl.localhost\Ubuntu\home\rose\work\LexLattice\codex-review-shell-direct\scripts\direct-drive.mjs` | `C:\LexLattice\direct-test-mirror` (synced from WSL by `start`, own `node_modules`) | `%LOCALAPPDATA%\direct-test\profile` |
| WSL | `node scripts/direct-drive.mjs` (in the repo) | the repo, under `xvfb-run` | `~/.local/share/direct-test/profile` |

The owner's app, its mirror, its profile and its threads are never touched.
The test profile signs in with the Codex CLI login (`~/.codex/auth.json`).
On Windows the app is launched through WMI so it outlives the command that
started it (a tool runner's job object would otherwise kill it).

## Workflow

```sh
direct-drive start                       # sync (Windows) and launch; `--restart` after code changes
direct-drive project-add --name T --env windows --path C:\DirectTests\t   # or --env wsl --path /home/rose/direct-tests/t
direct-drive chat --project last "prompt"                 # new thread
direct-drive chat --thread last "follow-up"               # same thread
direct-drive chat --project last --prompt-file p.txt      # avoids shell quoting
direct-drive report --thread last [--turn last] [--full] [--raw]
direct-drive stop
```

`chat` waits for the turn and prints: each provider request (tools declared,
input items, replayed call outputs, tokens), each tool call with arguments
and a readable output summary (`--raw` for exactly what the model saw),
owner decisions, warnings, the reply, and the end state. `--json` gives the
same as data.

Each request also shows its cached input tokens (prompt cache hits),
`wait` (sent to response headers: backend queue)
and `model` (headers to stream end: the model producing its answer). The
`timeline` line splits the turn's wall time into requests and the
tools/harness gaps between them, and exec calls show how long the process
ran, so a slow turn shows where its time went.

Owner requests: `--approvals approve` (default) answers approvals and
questions automatically (`--answer TEXT` for questions); `--approvals
pending` returns as soon as one is raised, then use `respond --key K
[--decision decline] [--answer TEXT]` and `report`. Stop: `--stop-after-ms N`
or `--stop-after-calls N`, or `stop-turn --thread last --turn last`.

Anything else the runtime accepts: `request --method thread/read --params '{...}'`.

What the owner sees: start with `start --show`, then `screenshot [--name N]`
saves the Workbench surface to `<profile>/screenshots/N.png` (needs a shown
window). Test knobs: `test-settings --auto-compact-limit N` sets the
auto-compaction limit to N tokens so a short thread compacts; `0` restores
the model's own limit.

## Live suite

`node scripts/direct-live-suite.mjs` (or `npm run direct:live-suite`) runs a
fixed set of real workflows through `direct-drive` on the host it runs on,
checks each outcome, and stops the app afterwards (`--keep-running` keeps
it). It starts the app if needed and uses a "Live suite" project whose
folder (`<test data>/direct-test/suite`) it empties first.

| Scenario | Checks |
|---|---|
| `edit_and_run` | edits `hello.py`, runs it, quotes the output, no failed calls |
| `slow_command_one_call` | a 3 s command finishes in one `exec_command` (no `write_stdin` polling) |
| `patch_recovery` | a patch written against the wrong line recovers and the file ends correct |
| `workspace_patch` | in a Workspace thread `apply_patch` writes through the sandboxed writer |
| `stop_ends_commands` | Stop after 15 s aborts the turn and the running command stops writing |
| `question_to_owner` | `request_user_input` reaches the owner and the answer comes back |
| `permission_request` | a Read only thread asks with `request_permissions`, gets Workspace for the turn, writes the file, and is back at Read only |
| `path_in_prompt` | an absolute path in the prompt is accepted |
| `remembers_tool_output` | a follow-up turn answers what an earlier command printed from history, without a tool call |
| `auto_compaction` | with a lowered limit, the next turn compacts its history first and still answers a number found only in a compacted command output |
| `mcp_tool_call` | in the "Live suite MCP" project (a stdio MCP server in Direct's settings), the model calls `mcp__suite__get_secret_word` and quotes the word |
| `mcp_form` | the server's form (`elicitation/create`) reaches the owner and the model reports the picked color |
| `mcp_approval` | in Workspace access an unannotated MCP tool is put to the owner first, and the approved call runs |
| `exec_escalation` | in Read only, `exec_command` with `require_escalated` is put to the owner and the approved command writes outside the sandbox |
| `follow_up_turn` | a second turn on the edit thread works; prints its cached input |

The test app reads the owner's real `~/.codex/config.toml` (in WSL, or on
Windows), so its MCP servers join these projects too, as they would in the
owner's app. `project-add --mcp-servers FILE.json` gives a test project
Direct MCP servers (the settings panel's shape).

`--only a,b` runs some; `--json` adds a machine-readable summary; `--model`
and `--effort` override luna/low. A failure prints the `report` command for
its turn. Run it on both hosts (Windows Node over the UNC path for the
Windows app). A full run costs about 25 provider requests.

## Notes

- The control port listens on 127.0.0.1 only, needs the token in
  `<profile>/direct-test-control.json`, and starts only when the app runs with
  `DIRECT_TEST_CONTROL=1` and an isolated profile
  (`CODEX_REVIEW_SHELL_USER_DATA_DIR`).
- Test runs use the owner's quota. Prefer luna/low and short prompts.
- `npm run direct:test-control` covers the control port with a fake provider.
