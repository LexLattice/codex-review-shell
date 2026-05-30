# Codex Review Shell ODEU Code Review

Authority layer: static architecture/code review.

Run stance:

```yaml
task_mode: review
execution_mode: standard
grounding_status: repo_grounded
implementation_inspection_status: implementation_inspected_static
runtime_observation_status: not_observed
profile_lineage:
  base_profile: CODEX_REVIEW_SHELL_ODEU_PROFILE.md
  derivative_profile: codex_review_shell_code_review_v0
  profile_status: local_review
```

Scope:

```text
src/main.js
src/preload.js
src/preload-codex-surface.js
src/renderer/app.js
src/renderer/codex-surface.js
src/main/*
src/backend/wsl-agent.js
docs/CODEX_REVIEW_SHELL_ODEU_PROFILE.md
```

This is not a complete security audit and no live Electron runtime was observed.
The goal is to review current code through the local ODEU profile:

```text
state object -> transition claim -> authority evidence -> protected surfaces -> validation row
```

## Findings

### P1: Codex surface preload bridge is exposed across multiple target trust modes

Code anchors:

```text
src/main.js:1715
src/main.js:1807
src/main.js:4766
src/preload-codex-surface.js:17
```

The Codex surface can load managed local UI, configured `url` targets, and
`file:` targets, while the WebContents is created with
`preload-codex-surface.js`. That preload exposes high-authority routes:
app-server connection, generic RPC, attachment staging, file open/reveal,
workspace link routing, transcript reads, and context-menu actions.

This is the umbrella authority issue behind several narrower findings. A full
Codex surface bridge is appropriate only for a trusted managed local surface
with main-owned connection authority. It is not appropriate as the uniform
bridge for arbitrary configured URL or file targets.

Risk:

```text
Configured surface target trust == preload bridge authority.
```

Recommended fix:

```text
Add SurfaceTrustProfile / CodexSurfaceBridgeProfile:
  managed_local_surface -> full bridge with main-authorized RPC
  external_https_url -> no bridge or read-only diagnostic bridge
  loopback_http_url -> restricted local-development bridge
  file_url -> no bridge unless explicitly signed/trusted local artifact

Select the bridge profile in main from target trust evidence.
Do not let renderer payload or project config labels mint bridge authority.
```

### P1: Renderer-exposed workspace command route has no transition authority gate

Code anchors:

```text
src/preload.js:73
src/main.js:5252
src/backend/wsl-agent.js:524
```

`workspaceShell.runWorkspaceCommand(projectId, command)` is exposed to the shell
renderer and forwards directly to `workspace:run-command`. The backend then
spawns `params.command` with arbitrary args/env under the workspace root.

This violates the local `IPC_AND_PRELOAD_AUTHORITY_GATE` shape. The renderer has
a command-capable bridge method, but there is no cataloged transition claim,
allowlist, user gesture proof, command profile, or authority surface explaining
why this route is safe.

Risk:

```text
Renderer capability == workspace command execution.
```

Recommended fix:

```text
Remove the generic bridge from preload unless currently needed.
If needed, replace it with a named WorkspaceCommandRequest:
  commandProfileId
  allowedExecutable
  allowedArgsShape
  cwdScope
  userGestureRef
  transitionId
  resultProjection
```

Until that exists, this should be treated as a high-risk IPC authority route.

### P1: Renderer-originating Codex app-server RPC is generic and main-process policy is thin

Code anchors:

```text
src/preload-codex-surface.js:20
src/preload-codex-surface.js:21
src/preload-codex-surface.js:22
src/main.js:4938
src/main.js:4943
src/main.js:4948
src/main/codex-surface-session.js:550
src/renderer/codex-surface.js:6035
src/renderer/codex-surface.js:6085
src/renderer/codex-surface.js:6248
```

The Codex surface bridge exposes generic `request(method, params)`,
`notify(method, params)`, and `respond(id, result)`. Main binds the sender to a
`CodexSurfaceSession`, but forwards method/params without a main-process
allowlist. Runtime capability checks exist in renderer functions such as
`startCodexTurn`, `steerCurrentTurn`, and `stopCurrentTurn`, but renderer checks
are not authority.

Important scope correction: server-originating requests are not completely
unbounded. `src/main/codex-surface-session.js` defines
`SUPPORTED_SERVER_REQUEST_METHODS` and `AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS`
for the app-server -> app request path. The weaker path is the renderer ->
main -> app-server client RPC path, plus renderer-originating notifications and
responses.

Risk:

```text
Renderer-side capability checks can be bypassed by any code with access to the
Codex surface bridge.
```

Recommended fix:

```text
Add CodexSurfaceRequestState / IpcChannelContract rows for app-server methods.
Main should allowlist mutation methods by active provider capability evidence:
  turn/start
  turn/steer
  turn/interrupt
  serverRequest/respond
  account/rateLimits/read
  model/list
```

Keep a generic low-level RPC only if it is explicitly scoped to trusted local
surface diagnostics and blocked from mutation methods.

### P1: Codex app-server connection and auth source are partly renderer-shaped

Code anchors:

```text
src/preload-codex-surface.js:18
src/main.js:4920
src/main/codex-surface-session.js:97
```

`codexSurfaceBridge.connect(connection)` lets renderer code send connection
details to main. Main substitutes `activeCodexSurfaceConnection.remoteAuth`
only when the requested URL matches the active connection URL; otherwise it
passes the renderer-supplied connection through to `session.connect()`.
`CodexSurfaceSession` can resolve bearer auth from file/env for remote or
loopback websocket connections.

Risk:

```text
Renderer payload can shape runtime connection/auth authority.
```

Recommended fix:

```text
Add CodexAppServerConnectionAuthority:
  connectionRef: main_owned
  wsUrl: main_owned
  authMode: main_owned
  tokenSource: main_owned
  rendererPayloadMayContain: connectionRef | nonce only
  rendererPayloadMustNotContain: tokenFilePath | tokenEnvVar | arbitrary wsUrl

Renderer asks to connect by opaque ref.
Main resolves URL/auth from the active provider/runtime connection snapshot.
Absent or stale connection evidence fails closed.
```

### P2: Context-menu action result claims completion before action execution

Code anchors:

```text
src/main.js:4349
src/main.js:4373
src/main.js:4420
src/main.js:4460
src/main.js:4487
src/main.js:4488
```

`openContextMenu()` builds a menu with async click handlers that can paste an
image, add files to Project stash, reveal files, or send files to ChatGPT. The
IPC response returns immediately after `Menu.popup()` with:

```text
status: "completed"
mutatedDraftState: false
mutatedProjectFiles: false
handoffMutationCalls: 0
attachmentStagingWrites: 0
```

Those fields describe the menu-open operation, not the clicked action. In ODEU
terms, the returned `ContextMenuActionResult` is not evidence of action outcome.

Risk:

```text
Tests or future callers can treat menu-open as proof that no mutation/handoff
occurred, while deferred click handlers can mutate state later.
```

Recommended fix:

```text
Split ContextMenuOpenResult from ContextMenuActionResult.
Each click handler should emit a separate action result event:
  actionId
  actionType
  status
  mutatedDraftState
  mutatedProjectFiles
  handoffMutationCalls
  attachmentStagingWrites
  error
```

### P2: Shared Markdown / typed-token projection is duplicated and already diverging

Code anchors:

```text
src/renderer/codex-surface.js:2430
src/renderer/codex-surface.js:2452
src/renderer/codex-surface.js:2544
src/renderer/codex-surface.js:2674
src/renderer/app.js:1450
src/renderer/app.js:1563
src/renderer/app.js:1680
src/renderer/app.js:1914
src/renderer/app.js:2051
```

The Codex surface and shell renderer both implement tokenizer, file-link,
Markdown, table, code fence, URL, and inline-code logic. This was useful for
fast iteration, but it has become a BRL owner risk.

Observed divergence:

```text
codex-surface.js supports file fallback resolution via fileEvidenceRefs.
app.js renders sub-agent and middle-file Markdown with a parallel tokenizer but
does not carry the same fallback/context-menu dataset behavior.
```

Risk:

```text
A file-link or Markdown fix can land in one pane and regress another pane.
This matches recent bugs around green false file tokens, short path fallback,
middle file code blocks, and sub-agent message rendering.
```

Recommended fix:

```text
Create a shared projection artifact:
  src/shared/typed-content-projection.js
  src/shared/assistant-markdown-projection.js

If sharing code is too invasive, create BRL fixtures first:
  codex final message
  sub-agent child message
  middle file markdown
  selected file context menu
```

### P2: Surface open-external bypasses the stricter URL policy

Code anchors:

```text
src/main.js:5054
src/main.js:5103
src/main/middle-web-host.js:68
src/main/middle-web-host.js:572
```

`external:open-url` and `MiddleWebHost.openExternal()` apply explicit URL
policy: http/https only, no embedded credentials. `surface:open-external`
instead reads the current Codex/ChatGPT URL and calls `shell.openExternal(url)`
as long as it is not `file://`.

Risk:

```text
One external-open route has weaker policy than the others.
```

Recommended fix:

```text
Route surface external opens through the same ExternalNavigationPolicy used by
middle-web and external:open-url. Block embedded credentials and unsupported
schemes uniformly.
```

### P2: Middle-web history stores full URLs as durable utility state

Code anchors:

```text
src/main/middle-web-host.js:120
src/main/middle-web-host.js:124
src/main/middle-web-host.js:211
src/main/middle-web-host.js:481
```

The middle Web tab correctly blocks unsafe schemes and embedded credentials.
However, history persistence stores `displayUrl` directly. HTTPS URLs can still
contain one-time tokens, PR auth parameters, signed object URLs, or query strings
that should not become durable shell-level state by default.

Risk:

```text
Utility browsing state can retain sensitive imported-web URLs longer than the
operator expects.
```

Recommended fix:

```text
Add WebHistoryUrlPolicy:
  persist origin + title + redacted path by default
  persist full URL only if policy allows
  support per-entry "copy/open current raw URL" from main-owned current state
  expose Clear Web Session / Clear Web History as separate actions
```

### P2: Usage ledger metadata-only mode can still store command text previews

Code anchors:

```text
src/main/usage-ledger-collector.js:142
src/main/usage-ledger-collector.js:459
src/main/usage-ledger-collector.js:478
src/main/usage-ledger-store.js:55
src/main/usage-ledger-store.js:71
```

The ledger has good append-only structure, redaction blocking, seq/digest rows,
and manifest handling. The weak point is command/tool metadata. `commandPreview`
stores a bounded raw command string, while the redaction scanner blocks common
raw prompt/output/auth fields and absolute paths, but not arbitrary secrets or
sensitive arguments inside command text.

Risk:

```text
metadata_only can still preserve sensitive command arguments.
```

Recommended fix:

```text
Default to commandPreviewHash only.
Allow commandPreview text only behind explicit config:
  include_command_preview = true
  command_preview_max_chars = N
  rawPathPolicy != excluded or path-redaction applied
```

### P2: Runtime provider profile projects raw path-like fields

Code anchors:

```text
src/main/runtime-provider-profile.js:245
src/main/runtime-provider-profile.js:260
src/main/runtime-provider-profile.js:262
src/main/runtime-provider-profile.js:263
```

`buildRuntimeProviderProfile()` includes `profileId` with binary path material
and returns `codexHome`, `workspaceRoot`, and `readyUrl` in the executable
profile. The header/provider specs prefer evidence keys or sanitized labels for
renderer-visible state.

Risk:

```text
Runtime constitution surfaces can inherit raw local path truth even when a
sanitized evidence-key posture was intended.
```

Recommended fix:

```text
Split main-owned raw profile from renderer-safe profile:
  codexHomeEvidenceKey
  workspaceRootEvidenceKey
  readyUrlEvidenceKey
  commandLabel
```

Keep raw paths main-process-owned for diagnostics/export only.

### P3: Attachment staging relies on renderer-provided raw host paths

Code anchors:

```text
src/preload.js:45
src/preload.js:48
src/preload-codex-surface.js:33
src/preload-codex-surface.js:36
src/main.js:5185
src/main/attachment-staging-store.js:273
src/main/attachment-staging-store.js:285
```

Drag/drop support necessarily touches raw host paths. The current preload keeps
path extraction small, and main stages files with size/type checks. The missing
piece is a stronger ingress contract: there is no per-drop token, user-gesture
reference, or projection generation tying a raw path list to the current active
composer draft.

Risk:

```text
Any renderer code with bridge access can ask main to stage an arbitrary host path
that it knows.
```

Recommended fix:

```text
Add AttachmentIngressSession:
  createdBy: file_picker | drag_drop | clipboard_image
  projectId
  composerThreadId
  userGestureAt
  draftSetDigest
  expiresAt
```

Main should reject stale/cross-project staging and submit operations.

### P3: Analytics and ledger status expose raw local paths to renderer

Code anchors:

```text
src/main.js:4137
src/main/usage-ledger-store.js:128
src/main/usage-ledger-store.js:129
```

Thread analytics returns `dbPath`, and usage ledger status includes `ledgerPath`
and `manifestPath`. These are useful diagnostics, but they are raw local paths.

Risk:

```text
Renderer-visible diagnostics can accumulate raw local filesystem identity.
```

Recommended fix:

```text
Use evidence keys and basename/relative labels in renderer state.
Expose raw paths only through explicit diagnostic copy/export actions.
```

## State Object Gaps

These owners exist implicitly in code and should be promoted into the ODEU
catalog:

```text
IpcChannelContract
  src/preload.js
  src/preload-codex-surface.js
  ipcMain.handle(...) in src/main.js

IpcSenderSurfaceRole
  maps webContents.id / registered view identity to shell_renderer,
  trusted_codex_surface, external_codex_url, middle_web, chatgpt_web, unknown

WorkspaceCommandRequest
  workspace:run-command route
  backend runCommand

SurfaceTrustProfile
  managed local surface vs configured url/file targets

CodexSurfaceBridgeProfile
  preload/API exposure selected by main-owned target trust evidence

CodexSurfaceRequestState / DirectionalRpcContract
  renderer -> main -> app-server client RPC
  app-server -> main -> renderer request
  renderer -> main -> app-server response
  codex-surface:request/notify/respond method allowlists
  server request lifecycle

CodexAppServerConnectionAuthority
  main-owned app-server URL/auth/token source

RendererVisibleDiagnosticPathPolicy
  evidence-key/default-safe projection for local paths

ContextMenuCommandRegistry
  openContextMenu
  ChatGPT context menu
  action result events

AssistantMarkdownTypedProjection
  codex-surface final messages
  shell sub-agent messages
  middle file viewer

WebHistoryState
  MiddleWebHost history persistence and prune operations

AttachmentIngressSession
  file picker / drag-drop / clipboard image staging
```

## BRL Candidate Sentinels

Start with replay locks for surfaces that have already regressed:

```text
markdown_codeblocks_after_colon
markdown_tables_basic
typed_token_false_file_avoidance
short_file_ref_same_turn_fallback
selected_multi_file_stash
codex_final_vs_subagent_markdown_parity
middle_file_markdown_parity
turn_active_status_during_subagent_phase
context_menu_action_result_not_menu_open_result
middle_web_url_policy_uniformity
codex_surface_url_mode_no_full_bridge
codex_surface_file_mode_no_full_bridge
codex_surface_connection_renderer_cannot_choose_auth
codex_surface_renderer_rpc_mutation_allowlist
```

## Recommended First Implementation Sequence

Do not start with a broad refactor. Start by reducing authority ambiguity:

```text
1. Add ODEU IPC/WebContents authority catalog:
   IpcChannelContract, IpcSenderSurfaceRole, SurfaceTrustProfile,
   CodexSurfaceBridgeProfile, CodexAppServerConnectionAuthority.
2. Harden Codex surface target trust:
   no full bridge for configured url/file targets;
   connection/auth resolved only by main;
   renderer -> app-server RPC mutation allowlist in main.
3. Remove or gate workspace:run-command.
4. Split ContextMenuOpenResult from ContextMenuActionResult.
5. Add URL policy helper shared by surface:open-external and middle-web.
6. Add BRL fixtures for Markdown/typed-token surfaces before extraction.
7. Extract or fixture-lock shared typed-token/Markdown projection.
8. Sanitize renderer-visible runtime/ledger/analytics paths.
```

## Bottom Line

The codebase is directionally aligned with the ODEU profile: most new features
already route through main/backend, use evidence terms, and keep remote surfaces
separate from project truth.

The main remaining weakness is not missing UI capability. It is that surface
trust, preload bridge exposure, app-server RPC, workspace command execution,
file staging, external URL routing, and diagnostic projection are not yet
compiled into one deterministic authority catalog.

The recurring unresolved route shape is:

```text
renderer bridge -> main handler -> backend/runtime mutation
```

Those routes need catalog rows, transition claims, and replay locks before the
next layer of multi-agent/direct-runtime work.
