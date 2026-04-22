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
