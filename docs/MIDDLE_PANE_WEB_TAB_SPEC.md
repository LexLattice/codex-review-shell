# Middle Pane Web Tab Spec

Status: v0 implementation spec for opening Codex/ChatGPT web links inside the
workspace shell.

## Purpose

The middle pane is spatially the best place to show web links emitted from the
Codex and ChatGPT panes. In v0 this is not conceptually part of the workflow
control plane. It is a utility browser viewport that shares the same center
pane slot.

Long-term doctrine:

```text
workspace = bounded operating world
external web = imported evidence/action surface
control plane = policy boundary and provenance layer
```

v0 goal:

```text
Open http/https links from Codex and ChatGPT in a middle-pane Web tab by default,
with an external-browser escape hatch.
```

Non-goal for v0:

```text
Do not build the full governed evidence browser yet.
Do not capture web pages into project evidence/state.
Do not make browser history part of project/lane authority.
```

## Morphic UX Stance

```yaml
task_mode: design
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: not_observed
profile_lineage:
  base_profile: artifact_inspector_reference
  derivative_profile: codex_review_shell_middle_web_tab
  profile_status: proposed_local
```

Source pack:

- Doctrine: Morphic UX Frontend skill.
- Host route: `src/renderer/index.html`.
- Host shell state/layout: `src/renderer/app.js`.
- Host main process: `src/main.js`.
- Host preload bridges: `src/preload.js`, `src/preload-codex-surface.js`.
- Electron dependency: `^41.2.0`.
- Electron implementation reference: `WebContentsView` is the preferred current
  primitive; `BrowserView` is deprecated in Electron docs.
- Electron `WebContentsView` docs: `https://www.electronjs.org/docs/latest/api/web-contents-view`
- Electron `BrowserView` docs: `https://www.electronjs.org/docs/latest/api/browser-view`
- Existing link action path: `external:open-url`, `surface:open-external`,
  `configureGuestSurface(...).setWindowOpenHandler`.
- Related specs: `CODEX_SURFACE_PROJECT_RENDERING_SPEC.md`,
  `WORKFLOW_TRANSITION_GRAPH_SPEC.md`.

## Ontology

Objects:

- `WorkspaceWebLink`: an http/https URL emitted by a workspace surface.
- `LinkIntent`: request to open a URL, including source surface and disposition.
- `MiddleWebViewport`: the center-pane browser surface.
- `MiddleWebNavigationState`: current URL, title, loading state, canGoBack,
  canGoForward, origin, and error state.
- `OriginWitness`: compact visible origin/URL evidence in the Web tab toolbar.
- `ExternalOpenEscape`: explicit action to open the current URL in the OS browser.

Evidence:

- Source surface: `codex`, `chatgpt`, or `shell`.
- Source project ID when available.
- Source thread ID/title when available.
- URL, normalized URL, timestamp.
- Navigation result: loading, loaded, blocked, failed.

Deontic rules:

- A link click is navigation evidence, not project state mutation.
- The Web tab may display web content, but it may not update project bindings,
  lane bindings, thread links, analytics records, or runtime authority by itself.
- The Web tab consumes normalized `LinkIntent` and
  `MiddleWebNavigationState`. It must not derive project authority, thread
  bindings, or evidence capture from URL labels, domains, or page titles.
- Only `http:` and `https:` URLs are candidates for v0 web navigation.
- Auth/app-internal ChatGPT navigation must not be stolen from the ChatGPT pane.
- Opening externally must remain explicit and visible.
- Browser state is local UI/session state, not project authority.

Utility:

- GitHub PR pages, bot reviews, docs, and issue links stay inside the work loop.
- Codex and ChatGPT panes remain focused on conversation/work.
- The center pane becomes an evidence viewport without overloading the control
  tabs.

## Surface Topology

Current middle tabs:

```text
Overview | Threads | Analytics
```

v0 tabs:

```text
Overview | Threads | Analytics | Web
```

The Web tab owns:

- toolbar
- origin/current URL witness
- navigation controls
- browser viewport slot
- empty/loading/error state

Recommended layout:

```text
┌───────────────────────────────────────────────┐
│ Web                                           │
│ [Back] [Forward] [Reload] [URL/origin...]     │
│                         [Copy] [Open external]│
├───────────────────────────────────────────────┤
│                                               │
│       Electron WebContentsView viewport       │
│                                               │
└───────────────────────────────────────────────┘
```

Responsive behavior:

- Keep toolbar controls compact.
- Collapse full URL to origin + title if the middle pane is narrow.
- Preserve `Open external` and current-origin visibility at all widths.
- Browser viewport must resize with the middle pane and hide when another middle
  tab is selected.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `MiddleWebViewport` | surface artifact | build around `WebContentsView` | imported web surface, no project authority |
| `LinkIntentRouter` | support artifact | build | validates links, assigns disposition, records source |
| `MiddleWebHost` | support artifact | build | owns native view lifecycle, bounds, visibility, nav controls |
| `MiddleWebNavigationProjector` | support artifact | build | emits sanitized URL/title/loading/error state |
| `WebOriginWitness` | surface artifact | build | shows current origin/URL without trust inflation |
| `WebSessionPolicy` | support artifact | build | partition, cookies, permissions, downloads, popups |
| `WebBoundsReporter` | support artifact | align/build | keeps native view aligned to middle Web slot |

## Implementation Architecture

### Implementation Primitive

Prefer `WebContentsView`. The local implementation should wrap it behind a
`MiddleWebHost` adapter so older Electron compatibility can fall back to
`BrowserView` only if necessary. Renderer and link-routing code must not depend
on which primitive is used.

### Main Process

Add a dedicated `middleWebHost` owned by main process.

Rules:

- Use a separate Electron partition, e.g. `persist:middle-web`.
- Disable Node integration.
- Enable normal web security.
- Do not add preload unless a future governed browser requires it.
- Hide/detach or set zero bounds when the Web tab is not active.
- Emit navigation state back to shell renderer.
- Keep the raw current URL main-process owned. Renderer receives sanitized
  `displayUrl` and `origin` state only.

Suggested main-owned operations:

```ts
link:open({ url, disposition?, source?, userGesture? })
middle-web:set-layout({ bounds, visible })
middle-web:go-back()
middle-web:go-forward()
middle-web:reload()
middle-web:stop()
middle-web:open-external()
middle-web:copy-url()
```

Suggested shell events:

```ts
middle-web:event {
  type: "loading" | "loaded" | "load-failed" | "navigation-blocked" | "state";
  displayUrl?: string;
  title?: string;
  origin?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  loading?: boolean;
  lastError?: string;
  source?: LinkIntentSource;
  at: string;
}
```

### Renderer Shell

Add:

- `Web` middle tab button.
- `webTabPanel`.
- toolbar controls.
- `middleWebSlot` bounds target.
- state renderer for current URL/title/loading/error.

Extend layout reporting:

- Current `sendSurfaceLayout()` sends Codex and ChatGPT slot bounds.
- v0 should also send Web slot bounds and visibility, either by extending
  `surface:set-layout` or by adding `middle-web:set-layout`.
- The native Web view must be above the shell renderer only inside the Web slot.

### Codex Surface Link Path

Current path:

```text
typed URL click
  -> codexSurfaceBridge.openExternalUrl(url)
  -> ipc external:open-url
  -> shell.openExternal(url)
```

v0 path:

```text
typed URL click
  -> codexSurfaceBridge.openWorkspaceLink(url, { source: "codex" })
  -> ipc link:open
  -> validate URL
  -> switch middle tab to Web
  -> load URL in middleWebHost
```

Naming rule:

```ts
openWorkspaceLink(url, {
  source: "codex",
  disposition: "middle-web" | "external"
})
```

Keep `openExternalUrl(url)` reserved for explicit OS-browser escape hatches only.
Do not silently repurpose `openExternalUrl` to mean middle-pane navigation.

### ChatGPT Surface Link Path

Current behavior:

- `setWindowOpenHandler` opens arbitrary http/https URLs in the OS browser.
- Auth/app URLs are special-cased to keep ChatGPT login/app flow in the ChatGPT
  pane.

v0 behavior:

- Keep ChatGPT auth/app URLs in the ChatGPT pane.
- Route external http/https window-open URLs to the middle Web tab.
- Consider intercepting same-frame navigation from ChatGPT to non-ChatGPT origins:
  prevent navigation, open in middle Web tab, and leave the ChatGPT thread intact.

Safe first implementation:

```text
window.open / target=_blank from ChatGPT -> middle Web tab
same-frame ChatGPT navigation -> keep existing behavior until tested
```

Known v0 limitation:

```text
Same-frame external navigations from ChatGPT may still navigate the ChatGPT pane
unless the URL is opened through target=_blank or window.open. v0.1 may intercept
same-frame external origins after auth/app route testing.
```

Classification helper:

```ts
function classifyChatGptNavigation(url):
  | "chatgpt_internal"
  | "openai_auth_or_app"
  | "external_http"
  | "blocked";
```

Keep this classification in main-process-owned navigation code. Do not scatter
substring checks across renderer handlers.

Better v0.1:

```text
same-frame navigation to external origin -> middle Web tab
same-frame navigation to chatgpt.com auth/app/thread routes -> ChatGPT pane
```

## Link Intent Contract

```ts
type LinkOpenDisposition =
  | "middle-web"
  | "external";

type LinkIntentSource = {
  surface: "codex" | "chatgpt" | "shell";
  projectId?: string;
  threadId?: string;
  threadTitle?: string;
  itemId?: string;
};

type OpenWorkspaceLinkRequest = {
  url: string;
  disposition?: LinkOpenDisposition; // default: middle-web
  source?: LinkIntentSource;
  userGesture?: boolean;
  openedAt?: string;
};

type OpenWorkspaceLinkResponse = {
  ok: boolean;
  target?: LinkOpenDisposition;
  displayUrl?: string;
  origin?: string;
  error?:
    | "unsupported_protocol"
    | "insecure_http"
    | "embedded_credentials"
    | "invalid_url"
    | "blocked_by_policy"
    | "load_failed";
};
```

## Navigation Policy

URL validation must apply to every navigation, not only the first clicked URL.

Scope:

- initial loads
- redirects
- same-frame navigation
- `target=_blank`
- `window.open`
- popups opened from the middle Web tab

Decision shape:

```ts
type MiddleWebNavigationDecision =
  | { action: "allow"; normalizedUrl: string; displayUrl: string; origin: string }
  | {
      action: "block";
      reason:
        | "unsupported_protocol"
        | "insecure_http"
        | "embedded_credentials"
        | "opaque_origin"
        | "policy_denied"
        | "invalid_url";
    };
```

Validation rules:

- Normalize with `new URL(...)`.
- Allow `https:` by default.
- Allow `http:` for loopback/local development.
- Block non-loopback `http:` in v0.
- Block URLs with embedded username/password credentials.
- Block `file:`, `javascript:`, `data:`, `blob:`, custom protocols, and `about:`
  except internal empty-state pages owned by Electron.
- Emit a specific blocked reason for the renderer; do not collapse policy blocks
  into generic load failures.

Blocked-state copy:

- `Blocked: unsupported protocol`
- `Blocked: non-loopback HTTP is disabled`
- `Blocked: URL contains embedded credentials`
- `Blocked: navigation attempted to open a popup`
- `Blocked: downloads are disabled in v0`

Empty-state copy:

```text
No page open yet.
Links clicked from Codex or ChatGPT will open here.
```

## State Model

Renderer state:

```ts
middleWeb: {
  active: boolean;
  displayUrl: string;
  title: string;
  origin: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastError?: string;
  lastSource?: LinkIntentSource & { openedAt: string };
  securityPosture: "https" | "loopback_http" | "insecure_blocked" | "unknown";
}
```

Raw URL rule:

- Raw current URL is main-process-owned.
- Renderer receives sanitized `displayUrl`/`origin`.
- `copy-url` and `open-external` operate through main-process methods after
  validation instead of trusting renderer snapshots.

Persistence:

- v0 may keep state in memory only.
- Do not persist browser URL/history into project config.
- If session restore is later desired, store it under shell UI state, not project
  semantic state.

Source witness:

- The toolbar should show current origin and, when available, where the page was
  opened from, e.g. `Opened from: Codex`, `Opened from: ChatGPT · current thread`,
  or `Opened from: Shell`.
- This source witness is local UI provenance and must not be written to project
  state.

## Security Policy

v0 security rules:

- Browser view has no Node access.
- Browser view is isolated from Codex/ChatGPT renderers.
- Only http/https navigation is allowed.
- Downloads are blocked in v0. A future version may add an explicit download
  prompt and project-safe destination policy.
- Popups from the middle Web tab are denied by default and routed back into the
  same Web tab only for http/https.
- `Open external` uses `shell.openExternal` only after URL validation.
- Clipboard actions copy only visible URL text, not hidden page content.
- No credentials or cookies are exposed to renderer state.

Permissions:

- Deny camera, microphone, geolocation, MIDI, notifications, pointer lock, and
  fullscreen by default.
- If a future workflow needs a permission, add an explicit prompt and provenance
  event.
- Permission grants are not project authority and must not be persisted into
  project config.

Session partition:

```text
persist:middle-web
```

Reason:

- GitHub login can persist.
- The browser is still separate from ChatGPT/Codex guest partitions.
- Future policy-owned browser can migrate or clear this partition explicitly.

Session posture:

- `persist:middle-web` is a shell-level web session, not a project-scoped session.
- It may preserve GitHub/docs cookies across projects.
- A future toolbar or advanced action should expose `Clear Web Session`.
- Project-scoped web sessions are future work.

## Bounds Contract

Native Electron views can visually overlay renderer UI if stale bounds remain
attached. Bounds are therefore an explicit support artifact.

```ts
type MiddleWebLayout = {
  visible: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  devicePixelRatio?: number;
  tab: "web" | "overview" | "threads" | "analytics";
  layoutRevision: number;
};
```

Rules:

- Renderer reports bounds only for the dedicated `middleWebSlot`.
- The native web view must never cover the Web tab toolbar.
- When Web tab is inactive, hide/detach the view before or at the same time as
  tab content changes.
- Bounds updates are revisioned so stale resize messages cannot re-show an
  inactive view.
- On app blur/minimize or middle-pane collapse, set `visible=false` or zero
  bounds.

## Transitions

### Open Link In Middle Web

```text
User clicks URL in Codex or ChatGPT
  -> build LinkIntent
  -> validate URL
  -> if blocked, show blocked state/event
  -> switch middle tab to Web
  -> reveal Web toolbar and viewport
  -> load URL in middleWebHost
  -> emit loading state
  -> emit loaded/failed state
```

Visible consequences:

- Middle tab changes to `Web`.
- Toolbar shows current origin/URL.
- Browser viewport shows loaded page or error state.
- Source pane remains on its current thread.

### Open Current Page Externally

```text
User clicks Open external
  -> validate current URL
  -> shell.openExternal(url)
  -> keep Web tab unchanged
```

### Switch Away From Web Tab

```text
User selects Overview/Threads/Analytics
  -> hide middleWebHost
  -> preserve current middleWeb navigation state in memory
  -> show selected control tab
```

### Resize Middle Pane

```text
Window or splitter changes
  -> renderer computes middleWebSlot bounds
  -> renderer increments layoutRevision
  -> main updates middleWebHost bounds if Web tab visible and revision is current
```

## Future Promotion Path

v0 is a utility browser. Later we can promote it to a governed evidence browser.

Future additions:

- project-scoped browser profiles
- origin allow/deny policies
- navigation provenance timeline
- PR/review-specific GitHub affordances
- capture snapshot / cite in thread / attach evidence to project
- download policy
- clipboard policy
- page-to-thread citation links
- browser automation hooks
- explicit "commit evidence to project" transition

Promotion rule:

```text
The browser becomes control-plane-owned only when it has policy, provenance,
and commit boundaries. Until then it is a middle-pane utility viewport.
```

## Acceptance Criteria

- Implementation uses `WebContentsView` as the preferred primitive, with
  `BrowserView` only as an Electron-version compatibility fallback.
- `Web` tab appears in the middle pane and does not replace Overview/Threads/Analytics.
- Clicking an http/https typed URL in Codex opens it in the Web tab by default.
- ChatGPT target-blank/external links open in the Web tab by default while
  ChatGPT auth/app links continue to work in the ChatGPT pane.
- Web tab shows current origin, sanitized display URL, loading state, and error
  state.
- Web toolbar shows the source surface/thread when available; this is local UI
  provenance and is not written to project state.
- Back, forward, reload, copy URL, and open external are available.
- Switching away from Web hides the browser view and restores normal control tab
  interaction.
- Resizing the app or middle pane keeps the browser viewport aligned to the Web
  tab slot.
- Bounds updates are revisioned or otherwise guarded so stale layout messages
  cannot overlay the Web view over non-Web tabs.
- Non-http/https protocols are blocked with a visible diagnostic.
- URL policy is applied to initial loads, redirects, same-frame navigation,
  target-blank/window-open requests, and middle-Web popups.
- Renderer receives sanitized display URL/origin state; raw current URL is
  main-process-owned for copy/open-external actions.
- URLs with embedded username/password credentials are blocked.
- Non-loopback HTTP is blocked in v0.
- Downloads are blocked in v0.
- Browser permissions are denied by default.
- `openExternalUrl` remains explicit external-browser behavior; default workspace
  link routing uses `openWorkspaceLink` / `link:open`.
- The Web tab does not mutate project config, lane bindings, thread links, or
  analytics state.
- Browser partition is separate from Codex and ChatGPT guest surfaces.
- `persist:middle-web` is documented as shell-level shared browser session state,
  not project-scoped state.
- Existing `surface:open-external` still opens Codex/ChatGPT current pages
  externally when explicitly requested.

## Implementation Order

1. Add URL/navigation policy helper and tests.
2. Add Web tab shell, empty state, and blocked/error state.
3. Add `MiddleWebHost` adapter, preferably `WebContentsView` backed.
4. Add Web slot bounds reporting and visibility handling.
5. Add main IPC for `link:open`, navigation controls, and state events.
6. Route Codex typed URL clicks through `openWorkspaceLink`.
7. Route ChatGPT window-open external URLs while preserving auth/app
   URLs.
8. Add toolbar actions: back, forward, reload/stop, copy URL, open external.
9. Add blocked download, popup, and permission handling.
10. Smoke-test GitHub PR links, docs links, ChatGPT auth, app resize, and tab
   switching.
