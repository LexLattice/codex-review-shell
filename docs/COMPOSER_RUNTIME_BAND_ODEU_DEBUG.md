# Composer Runtime Band ODEU Debug Note

This note documents the two unresolved bottom-composer menu issues before another implementation pass. It is intentionally diagnostic: the goal is to make the transition map explicit before patching symptoms.

## Scope

Surface:

- `src/renderer/codex-surface.html`
- `src/renderer/codex-surface.css`
- `src/renderer/codex-surface.js`

Feature area:

- Composer runtime band below the prompt textarea.
- Quick access menu.
- Quick model/reasoning/speed menu.
- Send/stop action.

Expected UX:

- Clicking `Access` or `Model` opens a compact local popover.
- Selecting an option visibly updates the selected checkmark while the popover is open.
- Clicking anywhere outside the popover folds it back.
- Windowed and full-screen modes preserve the same geometry: input area, runtime band, send/stop action.
- Popovers scale to the actual Codex lane viewport, not to a stale desktop/full-screen mental model.

## Issue 1: Popovers Do Not Fold Back On Outside Click

Observed behavior:

- The `Access` and `Model` popovers remain open after clicking elsewhere.
- The intended outside-click behavior does not reliably trigger from the user's Windows app runtime.

Current implementation:

- The open menu is represented by `state.composerMenu`.
- `toggleComposerMenu(menu)` sets `state.composerMenu` and calls `renderComposerRuntimeBand()`.
- `closeComposerMenus()` clears `state.composerMenu`, hides both popover nodes, and resets trigger `aria-expanded`.
- A document-level `pointerdown` listener tries to close when the event path is outside:
  - `#composerAccessMenu`
  - `#composerModelMenu`
  - `#composerAccessButton`
  - `#composerModelButton`
- A `window.blur` listener also closes menus.

Why the previous reasoning was not robust enough:

- It assumed all outside interactions that matter occur inside the same renderer document and produce a normal composed DOM event path.
- It did not distinguish between "outside the popover inside the Codex BrowserView" and "outside the Codex BrowserView but inside the Electron shell".
- It treated the popover as a purely local DOM concern, but the real object boundary is the Codex lane embedded in a multi-pane shell.
- It did not define a canonical `DismissComposerOverlay` transition that can be invoked by renderer-local clicks, shell-level focus changes, project changes, thread changes, drawer opens, or pane activation changes.

ODEU mapping:

Objects:

- `ComposerPopover`
- `ComposerTrigger`
- `ComposerOverlayState`
- `CodexLaneBrowserView`
- `ShellPaneFocus`
- `RuntimeDrawer`
- `Transcript`
- `ComposerInput`

Evidence:

- DOM events inside `codex-surface.js`.
- Electron shell focus/blur or pane activation events, if available.
- Runtime state: `state.composerMenu`.
- Visual state: `hidden` attributes and trigger `aria-expanded`.

Deontic rules:

- A composer popover may stay open only while the active pointer/focus target is inside the popover or its trigger.
- Any interaction outside the active popover surface must invoke `DismissComposerOverlay`.
- Opening a different overlay or drawer must dismiss composer overlays first.
- Dismissal must be idempotent.
- Dismissal must not mutate runtime overrides.

Utility:

- Prevent stale menus from covering transcript/content.
- Preserve quick-switch behavior without requiring manual re-clicks.
- Make the popover lifecycle predictable across WSL and Windows app launches.

Robust patch path:

1. Define a canonical function:
   - `dismissComposerOverlay(reason)`
   - updates `state.composerMenu`
   - hides popovers
   - resets `aria-expanded`
   - no-op if already closed
2. Use it from every lawful dismissal edge:
   - renderer capture-phase `pointerdown` outside popover/trigger
   - `focusin` outside popover/trigger
   - `keydown Escape`
   - runtime drawer open
   - composer form submit
   - thread/project surface switch
   - main-shell pane focus/activation event if the main process exposes one
3. If renderer-local events still do not cover Windows app behavior, add a shell-to-surface event:
   - `codex-surface:event { type: "dismiss-composer-overlay", reason }`
   - fire it when the outer shell detects a click/focus event outside the Codex BrowserView.
4. Add temporary diagnostics while validating:
   - reason
   - previous `state.composerMenu`
   - event source (`pointerdown`, `focusin`, `escape`, `shell`)

Validation:

- Open `Access`; click transcript; menu closes.
- Open `Access`; click textarea; menu closes.
- Open `Access`; click `Model`; access closes and model opens.
- Open `Model`; click outside the Codex pane into another shell pane; menu closes.
- Open either menu; press `Escape`; menu closes.
- Open either menu; open runtime drawer; composer menu closes.
- Selecting a menu option updates the checkmark but does not trigger dismissal unless the product decision changes.

## Issue 2: Popovers Do Not Scale To Windowed Codex Lane

Observed behavior:

- In full-screen mode the composer band and popovers are acceptable.
- In windowed mode the popovers occupy too much of the Codex plane.
- Previous CSS reduced desktop max widths but still does not match the actual available lane geometry.

Current implementation:

- The composer form uses grid areas:
  - `input`
  - `band`
  - `send`
- The popovers are absolutely positioned under `.composer-menu-anchor`.
- Widths currently use viewport units:
  - normal popover: `clamp(190px, 34vw, 280px)`
  - model popover: `clamp(280px, 58vw, 460px)`
- Narrow media query collapses the model menu to one column.

Why the previous reasoning was not robust enough:

- It assumed CSS `vw` equals the meaningful Codex lane width.
- In Electron, the renderer viewport may not correspond to the visual pane width the user is judging, especially after BrowserView layout, scaling, or shell-side window changes.
- It did not define the popover as a child of a measured `ComposerGeometry` object.
- It allowed the model menu to preserve a desktop-like max width instead of deriving from available inline space.

ODEU mapping:

Objects:

- `ComposerShell`
- `ComposerInputRegion`
- `ComposerRuntimeBandRegion`
- `ComposerSendRegion`
- `ComposerPopover`
- `ComposerGeometry`
- `CodexPaneViewport`

Evidence:

- `composerForm.getBoundingClientRect()`
- `composer-runtime-band.getBoundingClientRect()`
- trigger button `getBoundingClientRect()`
- `ResizeObserver` for composer/shell width changes
- CSS container query support if available

Deontic rules:

- Popovers must fit inside the current Codex pane viewport.
- Popovers must not depend on full-screen viewport assumptions.
- The send/stop action must remain a distinct region from the runtime band.
- The runtime band may wrap or compact, but it must not overlay the textarea.
- Menu content should degrade by layout:
  - three-column cascade when width permits
  - two-column or one-column when constrained
  - scroll inside the popover if content exceeds safe height

Utility:

- Preserve fast local switching in narrow/windowed mode.
- Avoid visual dominance over the transcript and composer.
- Make the bottom composer feel like Codex Desktop while respecting our multi-pane shell.

Robust patch path:

1. Introduce measured geometry:
   - `updateComposerGeometry()`
   - writes CSS variables on `.composer-shell`
   - examples:
     - `--composer-width`
     - `--composer-popover-max-width`
     - `--composer-popover-max-height`
2. Observe actual layout:
   - `ResizeObserver` on `.codex-shell` or `.composer-shell`
   - fallback to `window.resize`
3. Use CSS variables instead of raw `vw` for popover sizing:
   - normal menu width should be `min(280px, var(--composer-popover-max-width))`
   - wide menu width should be `min(460px, var(--composer-popover-max-width))`
4. Use container or class-based layout thresholds:
   - wide model menu: three columns
   - medium: two columns
   - narrow: one column
5. Bound vertical footprint:
   - `max-height: var(--composer-popover-max-height)`
   - `overflow: auto`
6. Keep the composer grid invariant:
   - input is always its own row
   - band is always its own region
   - send/stop is always its own region or fixed adjacent cell, depending on available width

Validation:

- Full-screen: band stays on one visual line when there is room.
- Half-width window: menus shrink and do not dominate the pane.
- Narrow pane: model menu becomes one column and scrolls internally if needed.
- Input textarea never gets covered by the band.
- Send/stop never migrates into the left side of the band unless the narrowest fallback intentionally makes it full-width.
- Popover stays inside the Codex pane on left and right edges.

## Implementation Guardrail

Do not patch these issues by adding another isolated event listener or another hard-coded width. The canonical fix needs two explicit artifacts:

- `DismissComposerOverlay` transition.
- `ComposerGeometry` measurement/projection.

That keeps the implementation aligned with the workflow transition graph: UI affordances bind to canonical transitions and geometry evidence, rather than re-solving behavior locally per button.

## Windows App Freshness Assumption

If the Windows launcher is linked to the current WSL worktree, restarting the Windows app should load these file changes. If behavior does not match the current worktree after restart, verify the launcher path and build source before debugging renderer code.

