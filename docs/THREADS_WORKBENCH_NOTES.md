# Threads Workbench Notes

This note tracks concrete additions and behavior changes in the middle-plane `Threads` workbench.

## 2026-04-23

### 1. Middle-tab visibility bug fix

- `Overview` and `Threads` tab clicks were firing, but inactive panels could still occupy layout space.
- Root cause: panel base CSS forced `display: grid`, which conflicted with `hidden`.
- Fixes:
  - `src/renderer/styles.css`
  - `.middle-tab-panel` now defaults to `display: none`
  - `.middle-tab-panel.active` sets `display: grid`
  - `.middle-tab-panel[hidden]` enforced with `display: none !important`

### 2. ChatGPT thread discovery now includes project-folder threads (best effort)

- Prior behavior:
  - discovery mostly surfaced global recents
  - project-folder threads in ChatGPT sidebar were often missed
- Current behavior:
  - `chatgptRecentThreadsScript` now merges:
    - localStorage cache rows
    - backend API rows (when available)
    - sidebar DOM links after opening sidebar
    - generic DOM fallback links
  - sidebar extraction now:
    - clicks `open-sidebar-button` when present
    - expands visible `Show more` buttons
    - extracts `/c/...` links
    - infers `projectName` from aria labels like `chat in project <name>`
  - each entry now carries:
    - `projectName` (when detected)
    - `sourceKind` (`project` or `recent`)
    - `source`
- UI updates:
  - recent-thread rows show `Project · <name>` badge when project metadata is present
  - hints explain that folder expansion in ChatGPT improves project coverage

### Known limitation

- ChatGPT project-folder enumeration is still best effort.
- Because there is no stable public consumer API for this, discovery depends on what the authenticated sidebar currently exposes in DOM/cache.
- For best results:
  - open ChatGPT sidebar
  - expand the project folder you care about
  - click `Refresh recent` in the workbench

## 2026-04-23 (follow-up)

### 3. Added project-iframe fallback for Windows/WSL parity

- Symptom observed:
  - some sessions only returned global recents (for example 28 recents) even though project threads existed.
  - this happened when the current page/session did not expose expanded project-folder thread links in the active DOM.
- Added fallback in `chatgptRecentThreadsScript`:
  - when baseline discovery does not cover the currently visible project list, it now:
    - collects sidebar project anchors (`/g/g-p-.../project`)
    - computes which sidebar projects are missing from baseline discovery
    - loads project pages in hidden same-origin iframes (off-screen)
    - extracts project-scoped thread links (`/g/g-p-.../c/...`)
    - tags these entries as `source: project-iframe`, `sourceKind: project`
  - per-project cap is applied to keep list size bounded.
- Net effect:
  - discovery no longer depends only on currently expanded sidebar state.
  - sessions that previously showed only recents can now include project-folder threads without manual sidebar expansion.

### 4. Grouped recent-thread browser + persisted thread cache

- Recent-thread browser behavior in the middle-plane `Threads` tab now changed in two ways:
  - the list is grouped by ChatGPT project folder (with a fallback `General recents` group)
  - startup and tab-open load from a persisted local cache instead of forcing a live discovery run
- Persistence details:
  - cache file: Electron `userData` path, file `chatgpt-thread-cache.json`
  - cache keeps deduplicated entries by `externalId`
  - max cache size is capped (`1500`) and sorted by most recent activity
  - manual refresh appends/merges newly discovered entries into that cache
- UI behavior:
  - opening `Recent` shows cached data immediately (if available)
  - `Refresh recent` performs live discovery and updates cache
  - imported threads still render with `Imported into project` status regardless of group

### 5. Thread-list click now drives surface navigation

- `Threads` workbench row clicks now open threads in the active panes:
  - ChatGPT project-thread rows call the existing project-thread activation path
  - ChatGPT recent rows open the selected thread URL directly in the right pane
  - Codex rows dispatch an open-thread request to the managed Codex surface (best effort)
- Codex open is implemented as an RPC probe in the Codex surface (`thread/resume` first, `thread/read` fallback). If resume is unavailable, rows still remain selectable for linking and failure is non-fatal.

## 2026-04-23 (Codex thread discovery + open follow-up)

### 6. Codex thread list quality and source coverage fixes

- Codex discovery no longer reads from only one `.codex` home.
  - It now merges multiple homes (primary local plus Windows mirrored homes like `/mnt/c/Users/*/.codex` when available).
  - This surfaces Codex Desktop sessions in WSL-hosted runs.
- Subagent-spawned sessions are now excluded by default from the Codex thread list.
  - This removes noisy worker/subagent runs (for example many `Draft ... closeout` rows) from the top-level thread browser.
- Duplicate threads from mirrored homes are deduplicated by thread id and recency.
- Codex thread-open path in the left pane now uses `thread/resume` first, with `thread/read` fallback for read-only visibility.

### 7. Home-aware Codex thread open + long-thread rendering guardrails

- Root cause for mixed open failures:
  - the thread browser now merges entries from multiple Codex homes
  - but app-server can only resume threads from its active `CODEX_HOME`
- Fix:
  - thread row selection now forwards `sourceHome`
  - managed app-server startup receives matching `CODEX_HOME` for the selected row
  - Codex surface reconnects to the updated app-server session before opening the thread
- Rendering/perf guardrails in the Codex surface:
  - transcript render caps to the latest 48 turns per open
  - large command outputs are truncated in the UI preview
  - non-message item types (`fileChange`, MCP/tool calls, context compaction) now render concise summaries instead of appearing missing

### 8. Split render vs live attach for Codex threads

- Codex thread open now follows a dual path:
  - immediate render from local stored session logs (`readCodexThreadTranscript`)
  - live `thread/resume` attach attempt in background
- Transcript reads now accept the `sessionFilePath` already discovered in the thread list, so open does not need to re-scan the full sessions tree on every click.
- If live attach succeeds:
  - transcript is replaced with live app-server thread history
  - composer is enabled for active turns
- If live attach fails:
  - stored transcript remains visible in read-only mode
  - user is no longer blocked on a blank/failed open just to inspect thread history
