# Codex Review Shell

Electron desktop shell for a single-window dual-partner coding/review loop with an explicit Windows-host / WSL-workspace backend split.

- **Left plane:** Codex work companion chat surface.
- **Middle plane:** workflow control plane, not a chat.
- **Right plane:** ChatGPT review/world-model thread surface.

The shell remains the source of truth for project bindings. Each project stores:

- project name
- typed workspace binding
- Codex target/binding
- project-bound ChatGPT thread deck
- FlowProfile metadata: prompt templates, watched file patterns, return header

Current implementation baseline:

- Explicit `workspace.kind` in project config: `local` or `wsl`.
- WSL-native workspace config fields: distro + canonical Linux path.
- Resident backend session manager in the Electron host.
- WSL backend agent at `src/backend/wsl-agent.js`.
- Newline-delimited JSON protocol over stdio.
- Work tree and file preview now route through the workspace backend.
- Command execution scaffold, watched artifact scanning, and watcher scaffolding are present in the backend protocol.
- Existing three-plane geometry and maximize/restore reflow fix are preserved.
- Existing ChatGPT embedding/chrome reduction behavior is preserved.


Current workflow surfaces:

- Project-bound ChatGPT thread deck instead of one hard-coded review URL.
- Thread roles: review, brainstorming, architecture, research, debugging, planning, custom.
- Add/edit/remove/archive thread bindings per project.
- Primary review thread and last-active thread tracking.
- Role-aware prompt templates with placeholder interpolation.
- Manual/copy-assisted handoff queue.
- Watched artifact scan through the workspace backend with preview/stage/ignore actions.

## Architecture summary

For WSL projects on Windows:

```text
Native Windows Electron host
  ⇄ stdio JSON protocol
wsl.exe-launched resident backend agent
  ⇄ Linux filesystem
Canonical WSL workspace path
```

The app does **not** use `\\wsl$` browsing as the primary architecture. UNC paths may be recognized during migration or used as fallback display values, but WSL workspace truth lives on the Linux side.

## Config shape

Example WSL project:

```json
{
  "name": "Example Project",
  "repoPath": "wsl:Ubuntu:/home/me/example-project",
  "workspace": {
    "kind": "wsl",
    "distro": "Ubuntu",
    "linuxPath": "/home/me/example-project",
    "label": "Example Project in WSL"
  },
  "surfaceBinding": {
    "codex": {
      "mode": "local",
      "target": "codex://local-workspace",
      "label": "Local Codex lane"
    },
    "chatgpt": {
      "reviewThreadUrl": "https://chatgpt.com/",
      "reduceChrome": true
    }
  },
  "chatThreads": [
    {
      "id": "thread_review_primary",
      "role": "review",
      "title": "Primary review",
      "url": "https://chatgpt.com/c/...",
      "isPrimary": true,
      "pinned": true,
      "archived": false
    }
  ],
  "activeChatThreadId": "thread_review_primary"
}
```

Example local/dev project:

```json
{
  "workspace": {
    "kind": "local",
    "localPath": "C:\\path\\to\\repo",
    "label": "Local workspace"
  }
}
```

## Native Windows dev run

From PowerShell or Windows Terminal:

```powershell
cd codex-review-shell
npm install
npm run start
```

## Windows + WSL mirror launcher

While building, use the tracked Windows launcher scripts in this repo so the Windows checkout mirrors the WSL worktree before each run:

```powershell
cd C:\LexLattice\codex-review-shell
.\start-codex-review-shell.cmd
```

What it does:

- mirrors `\\wsl.localhost\<distro>\<path>` to the Windows repo root via `sync-from-wsl.cmd`
- runs `npm install` on Windows after mirror
- writes `.wsl-sync-head.txt` in the Windows repo with the mirrored WSL commit hash
- starts Electron via `scripts/run-electron.mjs`

Default source path is `/home/rose/work/LexLattice/codex-review-shell` in `Ubuntu`.
Override source by setting:

- `CODEX_REVIEW_SHELL_DEFAULT_WSL_DISTRO`
- `CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH`

If your Windows checkout predates these scripts, copy these tracked files from WSL once into `C:\LexLattice\codex-review-shell`:

- `start-codex-review-shell.cmd`
- `sync-from-wsl.cmd`

To attach to a WSL workspace, edit the project binding:

- Workspace kind: `WSL workspace`
- WSL distro: `Ubuntu` or your distro name; blank means WSL default
- Canonical Linux path: `/home/<you>/<repo>`

Node.js must be available as `node` inside that WSL distro.

## Validation

Syntax check:

```bash
npm run check:syntax
```

Full bounded validation path:

```bash
npm run validate
```

Headless Electron smoke remains available on Linux environments that have `xvfb-run`:

```bash
npm run smoke
```

## Notes

ChatGPT is embedded as the real web thread surface. There is no assumed official consumer ChatGPT API for sending messages to an existing thread or uploading files. Chrome reduction, dark-mode forcing, and settings access are best-effort browser-surface behavior.

For the WSL architecture note, see [`WSL_HOST_ARCHITECTURE.md`](./WSL_HOST_ARCHITECTURE.md). For the v1.2 product-boundary/workflow pass, see [`DUAL_PARTNER_WORKFLOW_SHELL_v1.2.md`](./DUAL_PARTNER_WORKFLOW_SHELL_v1.2.md).
