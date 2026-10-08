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

Owner requests: `--approvals approve` (default) answers approvals and
questions automatically (`--answer TEXT` for questions); `--approvals
pending` returns as soon as one is raised, then use `respond --key K
[--decision decline] [--answer TEXT]` and `report`. Stop: `--stop-after-ms N`
or `--stop-after-calls N`, or `stop-turn --thread last --turn last`.

Anything else the runtime accepts: `request --method thread/read --params '{...}'`.

## Notes

- The control port listens on 127.0.0.1 only, needs the token in
  `<profile>/direct-test-control.json`, and starts only when the app runs with
  `DIRECT_TEST_CONTROL=1` and an isolated profile
  (`CODEX_REVIEW_SHELL_USER_DATA_DIR`).
- Test runs use the owner's quota. Prefer luna/low and short prompts.
- `npm run direct:test-control` covers the control port with a fake provider.
