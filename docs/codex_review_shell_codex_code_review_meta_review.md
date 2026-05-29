# Codex Review Shell ODEU Code Review — Meta-Review v54

Authority layer: static meta-review over `CODEX_REVIEW_SHELL_ODEU_CODE_REVIEW.md`, grounded against `codex-review-shell-main(7).zip` and `CODEX_REVIEW_SHELL_ODEU_PROFILE.md`.

Runtime observation: repository validation only, not live Electron security testing.

Validation run:

```text
npm run validate

check:syntax        passed
migration:smoke     passed
usage-ledger:smoke  passed
attachments:smoke   passed
agent:smoke         passed
```

## 1. Verdict

Codex’s review is mostly grounded and useful. It correctly reads the repo through the ODEU profile’s intended law:

```text
state object -> transition claim -> authority evidence -> protected surfaces -> validation row
```

The strongest findings are real:

```text
renderer-exposed workspace command execution lacks a transition authority gate
Codex surface RPC is too generic at the renderer -> app-server boundary
context-menu IPC reports menu-open completion, not action completion
Markdown / typed-token projection is duplicated across panes
surface external-open route uses weaker policy than middle-web/external:open-url
middle-web history persists full URLs
usage ledger metadata-only mode still stores command previews
runtime/provider profile projects raw local path-like fields
attachment staging lacks a strong ingress-session contract
renderer-visible diagnostics expose local paths
```

The main hardening patch to Codex’s review is that the **Codex surface trust boundary** should be promoted above several individual findings. The code allows the Codex surface to run with the Codex preload bridge while loading managed local UI, `url` targets, and even `file:` targets. A generic high-authority bridge is acceptable only for a trusted local surface with main-owned connection authority. It is not acceptable as a uniform bridge for arbitrary configured targets without a surface-trust profile and strict channel/method contracts.

## 2. Important correction: scope the generic app-server RPC finding

Codex says the app-server RPC bridge is generic and main-process policy is thin. That is substantially right, but it needs one clarification.

The **server -> app** request path does have a method allowlist in `src/main/codex-surface-session.js` through `SUPPORTED_SERVER_REQUEST_METHODS` and `AUTO_UNSUPPORTED_SERVER_REQUEST_METHODS`. Unsupported server requests are rejected.

The weaker path is the **renderer -> app-server client RPC path**:

```text
src/preload-codex-surface.js:20-22
  request(method, params)
  notify(method, params)
  respond(id, result)

src/main.js:4938-4950
  forwards method/params/id to CodexSurfaceSession

src/main/codex-surface-session.js:550-571
  request/notify send arbitrary JSON-RPC method names to the socket
```

So the corrected finding is:

```text
Server-originating approval/tool requests are partially allowlisted.
Renderer-originating client RPC and notification methods are not main-allowlisted.
Renderer-side capability checks are useful UI affordance checks, but not authority.
```

That correction strengthens the ODEU framing: the missing object is not merely a generic `CodexSurfaceRequestState`; it is a **directional IPC/RPC contract**:

```text
renderer -> main -> app-server client RPC
app-server -> main -> renderer approval request
renderer -> main -> app-server response
```

Each direction has different authority, allowed methods, evidence, and mutation risk.

## 3. Higher-priority issue Codex implies but does not name explicitly

### P0/P1: Codex surface preload is exposed across multiple trust modes

Relevant anchors:

```text
src/main.js:1715-1730
  safeLoadableUrl allows Codex surface https:, loopback http:, and file: targets.

src/main.js:1807-1814
  codex.mode === "url" loads codex.target into codexView.

src/main.js:4766-4774
  codexView always uses preload-codex-surface.js.

src/preload-codex-surface.js:17-47
  exposes codexSurfaceBridge methods including connect, request, notify,
  respond, attachment staging, file open/reveal, transcript reads, etc.
```

This creates a cross-layer problem:

```text
configured Codex target trust
  -> WebContents preload bridge exposure
  -> main authority routes
  -> workspace/runtime/file/attachment/RPC side effects
```

The current code treats these too uniformly. In ODEU terms, the app needs a `SurfaceTrustProfile` and `CodexSurfaceBridgeProfile`:

```yaml
SurfaceTrustProfile:
  managed_local_surface:
    allowed_bridge: full_codex_surface_bridge_with_main_authorized_rpc
  external_https_codex_url:
    allowed_bridge: none | read_only_diagnostic_bridge
  loopback_http_url:
    allowed_bridge: restricted_local_development_bridge
  file_url:
    allowed_bridge: none unless explicit signed local artifact policy
```

Recommended change:

```text
Do not load arbitrary url/file Codex targets with the same preload bridge.
Either:
  1. Use a separate WebContentsView without preload for url/file mode, or
  2. Expose a restricted bridge selected by main-owned trust profile, not by renderer payload.
```

This is the single biggest addition I would make to Codex’s review.

## 4. Additional authority gap: renderer-supplied connection/auth should not be trusted

`codexSurfaceBridge.connect(connection)` passes renderer-supplied connection data to main. In `codex-surface:connect`, main replaces `remoteAuth` only when the requested URL matches `activeCodexSurfaceConnection.wsUrl`; otherwise it calls `session.connect(connection)` with the supplied object.

Relevant anchors:

```text
src/preload-codex-surface.js:18
  connect(connection)

src/main.js:4920-4929
  uses active remoteAuth only if requested wsUrl matches active connection;
  otherwise forwards requestedConnection.

src/main/codex-surface-session.js:97-129
  resolveBearerAuth can read bearer token from file/env for wss:// or loopback ws://.
```

That means connection authority is partly renderer-shaped. Main should own connection identity and auth source.

Recommended ODEU row:

```yaml
CodexAppServerConnectionAuthority:
  connectionRef: main_owned
  wsUrl: main_owned
  authMode: main_owned
  tokenSource: main_owned
  rendererPayloadMayContain: connectionRef | nonce only
  rendererPayloadMustNotContain: tokenFilePath | tokenEnvVar | arbitrary wsUrl
```

Recommended implementation posture:

```text
Renderer sends only a connectionRef/nonce.
Main resolves wsUrl/auth from activeCodexSurfaceConnection.
If the active connection is absent/stale, connect fails closed.
```

## 5. Assessment of Codex’s individual findings

| Codex finding | Accuracy | Severity adjustment / comment |
|---|---:|---|
| Workspace command route lacks authority gate | Accurate | Keep P1. The backend uses `shell:false`, cwd scoping, timeout, and output limits, which reduce shell-injection blast radius, but it is still renderer-exposed arbitrary executable execution under workspace root. |
| Generic Codex app-server RPC bridge | Accurate with correction | Scope to renderer-originating client RPC/notify/respond and connection authority. Server-originating requests are partially allowlisted. Elevate when combined with `codex.mode=url/file` preload exposure. |
| Context-menu result claims completion before action execution | Accurate | P2. It currently describes menu-open, not action outcome. Rename/split the result contract even if no current caller misuses it. |
| Duplicated Markdown / typed-token projection | Accurate | P2 BRL risk. Do not necessarily refactor first; create replay locks before extraction. |
| Surface open-external bypasses URL policy | Accurate | P2. Use one `ExternalNavigationPolicy` for `surface:open-external`, `external:open-url`, and middle-web. |
| Middle-web history stores full URLs | Accurate | P2 privacy/retention risk, not navigation-authority risk. Current navigation blocking is good; persistence policy is the issue. |
| Usage ledger command preview in metadata-only mode | Accurate | P2. Redaction catches obvious raw prompt/output/auth/path patterns, but not arbitrary secrets inside command arguments. Default to hash-only. |
| Runtime provider profile projects raw paths | Accurate | P2/P3 depending on surface. Split main-owned raw profile from renderer-safe profile. |
| Attachment staging relies on renderer-provided raw paths | Accurate | P3 in shell-only context, P2/P1 if reachable from an untrusted Codex surface. Needs ingress session/user-gesture/project/draft binding. |
| Analytics/ledger status expose raw local paths | Accurate | P3 diagnostics posture. Use evidence keys/labels by default. |

## 6. Findings I would add to Codex’s review

### A. `CodexSurfaceTargetTrustProfile` is missing

This is the umbrella finding for `codex.mode=url`, preload exposure, generic bridge methods, and renderer-supplied connection/auth.

Add state object:

```text
CodexSurfaceTargetTrustProfile
```

Primary law:

```text
A surface target’s URL scheme/origin/trust posture determines which preload bridge,
IPC channels, RPC methods, file routes, and attachment routes are exposed.
```

### B. `IpcSenderSurfaceRole` validation should be explicit

Many handlers rely on the fact that only certain preload scripts expose certain channels. That is a helpful UI boundary but not a cataloged authority boundary.

Recommended pattern:

```yaml
IpcChannelContract:
  channel: attachments:stage-drop
  allowedSenderRoles: [shell_renderer, trusted_codex_surface]
  forbiddenSenderRoles: [chatgpt_web, middle_web, external_codex_url]
  authorityEvidence: AttachmentIngressSession
```

Main can derive sender role from `webContents.id` / registered view identity. Authority channels should reject unknown sender roles.

### C. `RendererVisibleDiagnosticPathPolicy` should be a profile, not ad hoc cleanup

Codex correctly points to raw path exposure in runtime provider, analytics, and usage ledger status. The general fix should be a reusable policy:

```text
raw local path is main-owned diagnostic truth;
renderer default projection is evidence key, basename, project-relative label,
or explicit diagnostic-export action.
```

### D. BRL manifests should precede projection refactors

The duplicated Markdown finding is right, but direct extraction may be risky. The safer order is:

```text
1. Add replay fixtures for already-green projection cases.
2. Add shared tokenizer/projection module or adapter layer.
3. Replay both panes before and after extraction.
```

## 7. Recommended implementation order

I would slightly revise Codex’s sequence.

### Batch 0 — no code or very small code: authority catalog

Create a local ODEU catalog for:

```text
IpcChannelContract
SurfaceTrustProfile
CodexSurfaceBridgeProfile
CodexAppServerConnectionAuthority
WorkspaceCommandRequest
AttachmentIngressSession
ContextMenuActionLifecycle
ExternalNavigationPolicy
RendererVisibleDiagnosticPathPolicy
ProjectionOwner / BRL sentinels
```

This can start as data plus validation script, not a full refactor.

### Batch 1 — harden Codex surface trust boundary

```text
1. Split managed-local surface from url/file target mode.
2. Do not expose full codexSurfaceBridge to url/file targets.
3. Make connection/auth main-owned; renderer sends connectionRef/nonce only.
4. Add main allowlist for renderer -> app-server RPC mutation methods.
5. Add sender-role checks for codex-surface authority channels.
```

This should be first because it changes the risk posture of many other findings.

### Batch 2 — workspace command route

```text
Remove runWorkspaceCommand if unused.
Otherwise require WorkspaceCommandRequest:
  commandProfileId
  executable allowlist
  args shape
  cwd scope
  userGestureRef
  transitionId
  timeout/output policy
```

### Batch 3 — URL, path, and ledger projection policies

```text
unified external URL policy
middle-web history redaction / clear actions
renderer-safe runtime provider profile
renderer-safe analytics and usage-ledger status
commandPreviewHash-only default
```

### Batch 4 — context menu transition split

```text
ContextMenuOpenResult
ContextMenuActionResult event
per-click mutation/handoff evidence
```

### Batch 5 — BRL locks and projection extraction

```text
codex final message
sub-agent child message
middle file Markdown
selected file context menu
false file token avoidance
short file fallback
then extract shared projection modules
```

## 8. Acceptance tests / replay sentinels to add

I would add these to the profile’s next implementation pass:

```text
IPC catalog validation:
  every contextBridge method has IpcChannelContract row
  every ipcMain.handle channel has allowedSenderRoles
  every authority channel has transition/evidence requirement

Codex surface trust:
  managed surface gets full bridge
  external url surface gets no bridge or restricted bridge
  file target cannot access full bridge
  renderer cannot choose arbitrary wsUrl/auth token source

RPC policy:
  renderer mutation method not in allowlist is rejected in main
  server-originating supported approval request still works
  unsupported server-originating request still auto-rejects

Workspace command:
  generic arbitrary command route absent or blocked
  allowlisted command profile succeeds
  disallowed executable/args/cwd fails closed

Context menu:
  open returns menu-open state only
  click emits action-result event with mutation counters

External URL:
  http non-loopback blocked uniformly
  embedded credentials blocked uniformly
  file/javascript/data blocked uniformly

Privacy projection:
  renderer runtime profile omits raw codexHome/workspaceRoot/binary path by default
  ledger status omits raw ledgerPath/manifestPath by default
  thread analytics list omits raw dbPath by default
  commandPreview is hash-only unless explicit opt-in

Projection BRL:
  codex final, sub-agent, middle file, and selected file Markdown fixtures remain green
```

## 9. Profile patch to add

Add this local profile section:

```text
### IPC / WebContents Authority Contract Gate

Trigger:
  any contextBridge method, ipcMain handler, WebContentsView preload, remote URL,
  file URL, app-server RPC, workspace command, attachment staging, or external-open route changes.

Required split:
  surface role
  target trust profile
  preload bridge profile
  main handler contract
  allowed sender roles
  authority evidence
  mutation scope
  result projection
  BRL sentinels

Blocking rule:
  Renderer bridge access is not authority.
  A configured URL target is not a trusted local surface.
  Main must own connection/auth/workspace-command authority.
```

## 10. Bottom line

Codex’s review is worth accepting as a strong first ODEU code review. Its findings are mostly accurate, and the proposed state-object gaps are the right direction.

The main improvement is to raise the abstraction one level:

```text
The problem is not only individual IPC methods.
The problem is that surface trust, preload bridge exposure, app-server RPC,
workspace command execution, file staging, and diagnostic projections are not
compiled into one deterministic authority catalog.
```

The next app-specific ODEU step should therefore be:

```text
Build the IPC / WebContents authority catalog first,
then harden the Codex surface bridge,
then add BRL locks for shared projections.
```
