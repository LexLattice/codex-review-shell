# Composer Attachments And Context Menu QoL Spec

Status: draft implementation spec for the next QoL feature line.

Related docs:

- [CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md](./CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md)
- [CODEX_RUNTIME_HEADER_DRAWER_SPEC.md](./CODEX_RUNTIME_HEADER_DRAWER_SPEC.md)
- [CODEX_TRANSCRIPT_PRESENTATION_AND_COMPOSER_PROJECTION_SPEC.md](./CODEX_TRANSCRIPT_PRESENTATION_AND_COMPOSER_PROJECTION_SPEC.md)
- [CODEX_SURFACE_PROJECT_RENDERING_SPEC.md](./CODEX_SURFACE_PROJECT_RENDERING_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)

## Morphic Stance

```yaml
task_mode: design
execution_mode: standard
grounding_status: repo_grounded
implementation_inspection_status: implementation_inspected
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: not_observed
profile_lineage:
  base_profile: codex_runtime_constitution_header
  derivative_profile: composer_attachment_and_context_menu_qol
  profile_status: proposed_local
```

This spec is grounded in the current shell/Codex composer implementation and
related runtime/provider specs. It does not claim live runtime observation of
attachment support in the active Codex executable.

## Purpose

Add four QoL capabilities without weakening the shell's authority boundaries:

```text
1. Add files/images to composer input.
2. Add files/images by drag and drop.
3. Add pasted clipboard images to composer input.
4. Add a generic right-click context-menu substrate.
```

The goal is not a full file manager, image editor, or mature per-surface command
menu. The goal is a lawful intake and menu substrate that future surfaces can
extend without inventing ad hoc event handlers.

## Product Boundary

This spec targets the mainline vanilla Codex/app-server surface.

It does not depend on the direct ChatGPT/Codex runtime branch, and it must not
introduce direct-runtime provider assumptions. Direct-runtime attachment
semantics can later consume the same shell-level attachment draft model, but
that provider adapter needs its own evidence and promotion rules.

## Scope

V0 target surface:

- Codex composer in `src/renderer/codex-surface.html`.
- Shared shell/preload/main IPC primitives that can later serve sub-agent,
  transcript, middle-web, and shell workbench surfaces.

V0 non-goals:

- No arbitrary directory upload.
- No recursive folder ingestion.
- No drag-drop mutation of project files outside explicit attachment staging.
- No automatic OCR or image understanding unless the active provider exposes
  image input support.
- No context-menu command taxonomy beyond the base infrastructure.
- No custom menu claims for ChatGPT WebContents internals in v0.

## Governing Principle

Attachment intake is an operator-authored turn input transition, not transcript
evidence and not project truth.

```text
Selected/dropped/pasted artifact
  -> staged attachment draft
  -> visible attachment chip/preview
  -> provider capability projection
  -> turn submit packet
```

The UI may display staged attachments, but it must not imply they were consumed
by Codex until the provider adapter confirms the submit path.

Context menus are a command-routing substrate, not authority by themselves.
Right-click may expose actions, but each action still needs its own policy,
target, capability, and commit boundary.

## Source Pack

Doctrine sources:

- Morphic UX frontend skill.
- Runtime provider/header specs listed above.

Host implementation sources:

- `src/renderer/codex-surface.html`
- `src/renderer/codex-surface.js`
- `src/renderer/codex-surface.css`
- `src/preload-codex-surface.js`
- `src/preload.js`
- `src/main.js`
- `src/main/workspace-backend.js`
- `src/backend/wsl-agent.js`

Current available primitives:

- `clipboard:write-text`
- `worktree:read-file`
- `worktree:reveal-file`
- Codex composer form/input/send transition.
- Runtime/provider capability projection for model/access/usage controls.

Current gaps:

- No attachment draft model.
- No file picker bridge.
- No image clipboard read/materialization bridge.
- No drag/drop attachment router.
- No generic context-menu registry.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `ComposerAttachmentDraft` | support artifact | build | Canonical staged attachment identity and state |
| `AttachmentIngressController` | support artifact | build | Normalizes picker/drop/paste into attachment drafts |
| `AttachmentStagingStore` | support artifact | build | Main-process-owned file/image materialization and cleanup |
| `AttachmentPreviewProjection` | surface artifact | build | Chips/thumbnails/errors in composer, no provider-success claim |
| `AttachmentCapabilityProjector` | support artifact | align/build | Maps runtime/provider support to enabled/disabled submit behavior |
| `AttachmentSubmitAdapter` | support artifact | build later/align | Converts draft attachments into provider-specific turn input packet |
| `ClipboardImagePasteAdapter` | support artifact | build | Reads current clipboard image and materializes safe image draft |
| `DragDropAttachmentRouter` | support artifact | build | Handles drop zones, source validation, and visible hover state |
| `ContextMenuRequest` | support artifact | build | Canonical right-click request object |
| `ContextMenuRegistry` | support artifact | build | Maps target descriptors to menu item descriptors |
| `ContextMenuPolicy` | support artifact | build | Filters/enables actions by surface, target, capability, and authority |
| `ContextMenuActionRouter` | support artifact | build | Dispatches chosen menu action to registered safe handlers |

## Mainline Provider Boundary

The mainline app-server path is the safe v0 baseline. For vanilla Codex, do not
assume binary file payload or image payload support unless the active runtime
profile proves it.

Provider capability projection must distinguish:

```text
provider can consume binary file payload
provider can consume image payload
provider can consume workspace file reference
provider can consume text reference only
provider cannot consume attachment
```

```ts
type AttachmentCapabilityEvidenceState =
  | "accepted"
  | "runtime_probed"
  | "profile_declared"
  | "unknown"
  | "unsupported";
```

Rules:

- `unknown` capability renders controls visible but disabled, or allows only an
  explicit reference-only degradation.
- `unsupported` blocks submit with a precise reason.
- File/image payload submit requires `accepted`, `runtime_probed`, or
  `profile_declared` evidence from a main-process provider profile.
- The renderer never promotes provider support from labels, file extensions,
  model names, or project config alone.

## Attachment Model

```ts
type AttachmentSource =
  | "file_picker"
  | "drag_drop"
  | "clipboard_image";

type AttachmentKind =
  | "file"
  | "image";

type AttachmentStatus =
  | "staging"
  | "ready"
  | "unsupported"
  | "failed"
  | "removed";

type AttachmentProviderDisposition =
  | "provider_file_payload"
  | "provider_image_payload"
  | "workspace_file_reference"
  | "staged_file_reference"
  | "text_reference_only"
  | "unsupported";

type AttachmentDispositionReason =
  | "provider_file_payload_supported"
  | "provider_image_payload_supported"
  | "workspace_reference_supported"
  | "staged_reference_supported"
  | "text_reference_only"
  | "capability_unknown"
  | "mime_unsupported"
  | "size_exceeded"
  | "security_policy_blocked"
  | "attachment_became_stale";

type ComposerAttachmentDraft = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  surfaceId: "codex";
  source: AttachmentSource;
  kind: AttachmentKind;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  status: AttachmentStatus;
  error?: string;

  workspaceRelPath?: string;
  stagedRelPath?: string;
  stagedPathEvidenceKey?: string;
  sourcePathEvidenceKey?: string;

  preview: {
    canPreview: boolean;
    thumbnailRef?: string;
    textPreview?: string;
    width?: number;
    height?: number;
  };

  provider: {
    disposition: AttachmentProviderDisposition;
    reason: AttachmentDispositionReason;
    capabilityEvidenceState: AttachmentCapabilityEvidenceState;
    evidenceRefs: EvidenceRef[];
    unsupportedReason?: string;
  };

  workspaceEvidenceKey: string;
  workspaceKind: "local" | "wsl" | "unknown";
  createdUnderRuntimeProfileId?: string;
  uiProjectionGeneration: number;
};
```

Renderer state receives only draft-safe fields. Raw external source paths,
clipboard internals, EXIF, full binary payloads, and absolute staging paths stay
main-process-owned.

## Staging Store

V0 should use a project-scoped staging directory:

```text
<workspace>/.codex/review-shell/attachments/<draft-id>/
```

Attachment staging is a shell-owned workspace-side staging mutation. It is not
project source change and must not be represented as Codex-authored work.

Reasons:

- The Codex executable running in WSL can access the materialized artifact.
- Pasted images become real files that can be referenced or uploaded.
- The operator can inspect what was staged.
- Cleanup can be explicit and project-bounded.

Rules:

- For WSL workspaces, `AttachmentStagingStore` writes through the workspace
  backend. UNC or host-path fallback is diagnostic/fallback only.
- Staging is created only after an explicit picker/drop/paste gesture.
- Staged filenames are sanitized and collision-free.
- Staged files are written under the project workspace only.
- Existing files are never overwritten.
- Clipboard images are re-encoded to PNG by default.
- Pasted clipboard images are re-encoded to PNG without EXIF/metadata by
  default.
- Image payloads use staged/re-encoded metadata-stripped copies.
- File references may preserve original file bytes.
- Draft cleanup removes only files owned by the draft manifest.
- Draft cleanup never removes operator source files.
- Staging root must be ignored by worktree/status views where practical.
- Staging files must not appear as normal project artifacts.
- Staging must be excluded from patch/command workspace-effect truth unless
  explicitly included.

Suggested default caps:

```text
max attachments per draft: 20
max single file size: 25 MB
max total draft size: 100 MB
max pasted image pixels: configurable warning threshold
directory drops: unsupported in v0
```

### Draft Manifest

Every staged draft must have a manifest. Cleanup may delete only files listed in
that manifest and only under the staging root.

```ts
type ComposerAttachmentDraftManifest = {
  schema: "composer_attachment_draft_manifest@1";
  draftId: string;
  projectId: string;
  workspaceEvidenceKey: string;
  workspaceKind: "local" | "wsl" | "unknown";
  createdUnderRuntimeProfileId?: string;
  createdAt: string;
  sourceKind: AttachmentSource;
  stagedRelPath?: string;
  stagedPathEvidenceKey?: string;
  sourcePathEvidenceKey?: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  contentEvidenceKey?: string;
  previewEvidenceKey?: string;
  cleanupState:
    | "active"
    | "removed"
    | "submitted"
    | "cleanup_pending"
    | "cleanup_failed";
  rawExternalPathStored: false;
};
```

Default cleanup policy:

```ts
type AttachmentCleanupPolicy = {
  retainAfterSubmit: true;
  ttlHours: 168;
  cleanupOnRemove: true;
  cleanupOnAppStart: true;
};
```

Rules:

- Removed drafts clean up immediately or mark `cleanup_pending`.
- Failed submit keeps drafts for retry.
- Successful submit retains staged artifacts until explicit cleanup or TTL.
- App startup may clean orphaned drafts older than TTL only if manifest proves
  ownership.
- The staging root ignore/visibility policy must be explicit. The app may warn
  if the staging root can appear in git status, but must not silently edit
  `.gitignore` without a separate policy.

### Type Evidence

Do not trust extension or browser-reported MIME alone.

```ts
type AttachmentTypeEvidence = {
  extensionMime?: string;
  browserMime?: string;
  sniffedMime?: string;
  finalMime: string;
  mismatch: boolean;
  risk:
    | "normal"
    | "extension_mismatch"
    | "active_content"
    | "binary_unknown"
    | "too_large"
    | "unsupported";
};
```

Rules:

- If extension says image but sniffing says HTML/SVG/script-like content, treat
  it as unsupported or reference-only.
- SVG is not rendered inline in v0.
- SVG can be staged as file/reference only if policy allows.
- No SVG thumbnail unless a safe rasterization path exists.
- Clipboard images enforce max decoded pixels, decoded bytes, width, height, and
  animated-frame limits if animated image support exists.
- If decoded image caps are exceeded, set `status = "unsupported"` or
  `disposition = "text_reference_only"` with reason
  `image_too_large_decoded` in the diagnostic text.

## Provider Capability Boundary

Attachment submit behavior must come from provider capability evidence.

```ts
type AttachmentCapabilityProjection = {
  canAttachFiles: boolean;
  canAttachImages: boolean;
  canAttachClipboardImages: boolean;
  canReferenceWorkspaceFiles: boolean;
  canSendBinaryPayloads: boolean;
  canSendImagePayloads: boolean;
  maxFileBytes?: number;
  maxImageBytes?: number;
  supportedMimeTypes: string[];
  evidenceRefs: EvidenceRef[];
};
```

Rules:

- Missing capability is not permission.
- File/image attach controls can be visible while disabled with a diagnostic.
- File references under the workspace may be allowed even when binary upload is
  unavailable, if the provider can read workspace files through tools.
- External selected/dropped files must be staged before they become workspace
  references.
- Image submit requires explicit provider image support or an explicit degraded
  mode such as "attach as file reference only".
- The composer must show whether each attachment will be sent as payload,
  workspace reference, staged-file reference, or unsupported.

## Attachment Submit Packet

Provider adapters consume a submit packet, not renderer draft state.

```ts
type AttachmentSubmitPacket = {
  schema: "attachment_submit_packet@1";
  projectId: string;
  surfaceId: "codex";
  turnClientId: string;
  text: string;
  draftSetDigest: string;
  uiProjectionGeneration: number;
  attachments: Array<{
    draftId: string;
    disposition: AttachmentProviderDisposition;
    reason: AttachmentDispositionReason;
    workspaceRelPath?: string;
    stagedRelPath?: string;
    displayName: string;
    mimeType: string;
    sizeBytes: number;
    evidenceRefs: EvidenceRef[];
  }>;
  rawExternalPathsIncluded: false;
  rawClipboardBytesIncluded: false;
  createdAt: string;
};
```

Submit revalidation must check:

- draft exists;
- manifest exists;
- staged file exists if required;
- digest/evidence key matches;
- size/mime still allowed;
- provider capability still valid;
- project id and workspace binding still match;
- runtime/provider profile did not change incompatibly.

If any check fails, block submit with `attachment_became_stale` and preserve
drafts for retry.

## Composer UI Projection

Add an attachment row above the runtime band and below the text input:

```text
Ask Codex...

[ + file ] [ paste image ]  [ report.png · image · ready x ] [ notes.md · ref x ]

[ access ] [ quota ] [ context ] [ model ]                         [ send ]
```

Behavior:

- Drag hover highlights the composer as an attachment drop zone.
- Dropping unsupported content shows an inline diagnostic chip.
- Pasted image appears as a thumbnail chip with filename and size.
- File chips show name, type, size, source posture, and remove button.
- Image chips show thumbnail when safe and cheap.
- Attachment row wraps without pushing the send button under the input.
- Send button disabled state explains unsupported attachments.
- Removing an attachment removes only the draft, not the original file.

Stable hooks:

```html
<div data-morphic-region="composer-attachments">
<button data-attachment-action="choose-file">
<button data-attachment-action="paste-image">
<article data-attachment-draft-id="...">
<button data-attachment-action="remove">
```

## Attachment Transitions

### Add Attachment From File Picker

```text
User.clickChooseFile
  -> renderer requests attachments:choose-files
  -> main opens OS dialog
  -> main validates selected paths
  -> main stages or references each file
  -> main returns ComposerAttachmentDraft[]
  -> renderer renders chips
  -> composer capability projector updates send state
```

Rules:

- Dialog filters include common image types and all files.
- Main process owns raw selected paths.
- Canceled dialog produces no state mutation.
- Selection outside workspace is copied into staging before submit.
- Raw external selected paths are not persisted in project config or renderer
  state.

### Add Attachment From Drag Drop

```text
User.dragFileOverComposer
  -> renderer shows drop target state
User.dropFile
  -> renderer extracts Electron file path when available
  -> renderer sends paths/blobs to attachments:stage-drop
  -> main validates and stages/references
  -> renderer renders chips
```

Rules:

- Drop targets must reject directories in v0 with a visible diagnostic.
- If a drop contains both files and directories, reject the entire mixed drop
  with `mixed_directory_drop` in v0.
- Dropping text/HTML/URLs is not attachment ingest in v0 unless later specified.
- Drop must not trigger browser navigation.
- Drop must not submit the composer.
- Renderer may hold raw dropped paths only transiently in the drop handler.
- Renderer must not store, log, render, cache, or put raw dropped paths in DOM
  attributes.

### Add Attachment From Clipboard Image

```text
User.pasteInComposer
  -> if clipboard contains image, renderer asks attachments:paste-image
  -> main reads clipboard image
  -> main re-encodes/materializes PNG in staging store
  -> main returns image attachment draft
  -> renderer renders thumbnail chip
```

Rules:

- Text paste remains normal text paste.
- Normal `Ctrl+V` in the text area prioritizes text.
- A separate paste-image button invokes `attachments:paste-image` and never
  consumes text clipboard content.
- If clipboard has both text and image, prefer normal text paste unless the
  event includes image data or the user clicks "paste image".
- No raw clipboard binary is exposed to renderer state.
- Empty clipboard image produces a visible no-image diagnostic, not a failed
  turn submit.

### Submit Turn With Attachments

```text
User.submitComposer
  -> validate all attachment drafts are ready or intentionally degraded
  -> build AttachmentSubmitPacket
  -> provider adapter maps attachment dispositions
  -> turn/start request includes text and supported attachment references
  -> transcript shows operator message with attachment witnesses
```

Rules:

- Unsupported attachment blocks submit unless the user removes it or explicitly
  converts it to a text reference.
- Transcript must distinguish attached payload from reference-only.
- Turn completion does not delete staged artifacts automatically unless a cleanup
  policy says so.
- Failed submit preserves drafts for retry.

### Transcript Witness

The transcript witness must not imply payload success unless the provider adapter
actually submitted or the runtime accepted the attachment path.

```ts
type AttachmentTranscriptWitness = {
  schema: "attachment_transcript_witness@1";
  draftId: string;
  displayName: string;
  disposition: AttachmentProviderDisposition;
  submitState:
    | "submitted_to_provider"
    | "submitted_as_reference"
    | "blocked_before_submit"
    | "submit_failed";
  providerAccepted?: boolean;
  providerAcceptanceEvidenceRef?: EvidenceRef;
  rawPayloadIncludedInTranscript: false;
};
```

## Context Menu Model

```ts
type ContextMenuSurface =
  | "shell"
  | "codex_surface"
  | "sub_agent_panel"
  | "middle_web"
  | "threads_workbench"
  | "analytics"
  | "runtime_drawer";

type ContextMenuTargetKind =
  | "composer"
  | "message"
  | "attachment"
  | "typed_token"
  | "file_ref"
  | "url"
  | "thread"
  | "agent"
  | "web_view"
  | "empty_space"
  | "unknown";

type ContextMenuRequest = {
  schemaVersion: 1;
  requestId: string;
  surface: ContextMenuSurface;
  targetKind: ContextMenuTargetKind;
  projectId?: string;
  threadId?: string;
  itemId?: string;
  attachmentId?: string;
  selectedTextPreview?: string;
  selectedTextLength?: number;
  targetLabel?: string;
  targetHrefEvidenceKey?: string;
  targetHrefDisplay?: string;
  targetFileRef?: {
    pathEvidenceKey: string;
    displayPath: string;
    line?: number;
    column?: number;
  };
  pointer: {
    x: number;
    y: number;
  };
  expiresAt: string;
  uiProjectionGeneration: number;
  targetDigest: string;
  evidenceRefs: EvidenceRef[];
};

type ContextMenuActionType =
  | "copy_selected_text"
  | "copy_link_url"
  | "copy_file_ref"
  | "reveal_project_file"
  | "paste_text_into_composer"
  | "paste_image_into_composer"
  | "remove_attachment_draft";

type ContextMenuItemDescriptor = {
  id: string;
  label: string;
  role?: "copy" | "paste" | "selectAll";
  enabled: boolean;
  visible: boolean;
  danger?: boolean;
  reason?: string;
  action?: {
    type: ContextMenuActionType;
    payload: Record<string, unknown>;
  };
};

type ContextMenuActionResult = {
  actionId: string;
  status: "completed" | "blocked" | "failed" | "stale";
  reason?: string;
  mutatedDraftState: boolean;
  mutatedProjectFiles: false;
  approvedCodexRequest: false;
  providerTransportCalls: 0;
  appServerMutationCalls: 0;
  codexApprovalCalls: 0;
  patchApplyCalls: 0;
  commandRunCalls: 0;
  rightPaneMutated: false;
  handoffMutationCalls: 0;
  attachmentStagingWrites: number;
};
```

V0 implementation target:

```text
renderer contextmenu event
  -> build ContextMenuRequest
  -> main/context-menu registry resolves descriptors
  -> main opens native Electron Menu
  -> selected descriptor routes to safe handler
```

Rules:

- Renderer must not execute arbitrary action strings.
- Main process owns the registry and action router.
- Menu item availability must be computed from target, capability, and policy.
- Unknown targets get either no custom menu or a minimal safe menu.
- Native edit roles are allowed where appropriate.
- Native edit roles are used only on local governed editable/selection surfaces
  in v0.
- Destructive actions require later explicit specs before being registered.
- Web tab context menus must not leak cookies, auth headers, or raw page state.
- Requests expire and must be rejected when stale, target digest mismatches,
  project changed, thread changed, or surface changed.

## Context Menu V0 Menu Policy

Build the substrate first. Register only low-risk baseline actions:

- Copy selected text.
- Copy link URL when target is a sanitized URL.
- Copy file path/ref when target is a validated file ref.
- Reveal file when target is a validated project file ref.
- Paste text/image in composer when target is composer and input policy allows it.

Copy URL policy:

- Generic URL copy allows only `http` and `https`.
- URLs with embedded credentials are blocked or redacted.
- `javascript:`, `data:`, and `blob:` are not copied as link URLs in v0.
- File refs use `copy_file_ref`, not generic URL copy.

Reveal file policy:

- Reveal file may open the OS file manager or editor location.
- Reveal file must not read file contents or mutate project files.
- Only project/workspace-contained validated file refs are revealable.
- External source paths are not revealable unless they are staged files under the
  project staging root.

All other menus are future work:

- message-specific actions
- thread card actions
- sub-agent actions
- runtime/debug actions
- middle-web page actions
- approval/request-card actions

## Security And Privacy

Attachment intake:

- Raw selected external paths must not be persisted in project config.
- Renderer state gets path evidence keys, display names, and staged/workspace
  refs, not raw external absolute paths.
- Renderer may see dropped raw paths only transiently in the drop handler.
- Raw content SHA/content hashes are not exposed to renderer by default. Use
  local evidence keys or HMAC-backed keys such as `contentEvidenceKey`,
  `previewEvidenceKey`, `sourcePathEvidenceKey`, and `stagedPathEvidenceKey`.
- Pasted images are re-encoded before staging when possible.
- File previews use size limits and text/binary sniffing.
- HTML files are never rendered as HTML in previews.
- SVG is treated as potentially active content; preview only through safe image
  path or render as file chip.
- Unsupported file types remain attachable only as file references when policy
  allows.
- Attachment staging must reject traversal, symlink escape, and overwrite.

Context menus:

- Menu descriptors are data, not executable code.
- Action handlers must be allowlisted.
- Menu requests must be scoped to a surface and target.
- Native web page context menus are not a source of project authority.
- No context menu action may approve Codex requests in v0.
- No context menu action may start turns, mutate ChatGPT, run provider
  transport, apply patches, or run commands in v0.

## Failure States

Attachment failures:

- file too large
- total draft size exceeded
- unsupported directory drop
- path outside allowed staging policy
- staging write failed
- clipboard has no image
- image decode failed
- provider does not support image/file input
- attachment became stale/missing before submit

Context-menu failures:

- target stale
- action unsupported
- policy denied
- handler failed
- native menu unavailable

Failures must render as local UI diagnostics and must not create transcript
evidence unless they affect a submitted turn.

## Implementation Order

1. Add `AttachmentIngressController` and `ComposerAttachmentDraft` schema.
2. Add main-process `AttachmentStagingStore`.
3. Add IPC:
   - `attachments:choose-files`
   - `attachments:stage-drop`
   - `attachments:paste-image`
   - `attachments:remove-draft`
4. Add composer attachment row/chips/previews.
5. Add drag/drop hover and drop handling.
6. Add clipboard image paste handling.
7. Add provider capability projection and disabled-visible submit behavior.
8. Add provider submit adapter for the first supported path.
9. Add `ContextMenuRequest`, registry, policy, and action router.
10. Add baseline safe context menu actions.
11. Add focused smoke fixtures for picker/drop/paste/menu failure states.

Preflight phase:

```text
define AttachmentSubmitPacket
define ComposerAttachmentDraftManifest
define AttachmentCapabilityEvidenceState
define staging root and cleanup policy
define WSL backend staging route
define raw-path exposure rules
```

## Acceptance Criteria

- File picker can stage file and image drafts without submitting the turn.
- The spec explicitly targets mainline vanilla Codex/app-server QoL and does not
  depend on direct runtime.
- Attachment capability evidence distinguishes
  `accepted`/`runtime_probed`/`profile_declared`/`unknown`/`unsupported`.
- No file/image payload submit is enabled without provider capability evidence.
- `AttachmentSubmitPacket` schema is defined and validated before provider
  adapter use.
- `ComposerAttachmentDraftManifest` is written for every staged draft and
  cleanup uses only manifest-owned files.
- WSL workspace staging goes through the workspace backend, not UNC as the core
  path.
- Workspace staging is labeled as shell-owned staging, not project source
  mutation.
- Staging root ignore/visibility policy is explicit.
- Dragging files over the composer shows a visible drop state.
- Dropping files creates attachment chips or precise diagnostics.
- Renderer may see dropped raw path only transiently in handler and must not
  persist/log/render/cache it.
- Pasting a clipboard image creates an image draft chip.
- Text paste remains normal text paste.
- Normal Ctrl+V prioritizes text; explicit paste-image action handles image
  clipboard.
- Unsupported attachments block submit with a visible reason.
- Provider capability absence does not enable image/file payload submit.
- External raw source paths are not stored in project config.
- Renderer state does not receive raw clipboard image bytes.
- File type is sniffed; MIME/extension mismatches are classified.
- SVG is not rendered inline in v0.
- Clipboard images enforce decoded pixel/byte caps and are metadata-stripped by
  default when re-encoded.
- Cross-project draft submit is rejected.
- Draft set digest/generation is revalidated on submit.
- Attachment transcript witness distinguishes submitted payload, submitted
  reference, blocked, and failed submit.
- Attachment staging rejects traversal and symlink escape.
- Removing a draft does not delete the original selected/dropped file.
- Failed turn submit preserves attachment drafts for retry.
- Context-menu substrate can open a native menu from a normalized request.
- Context-menu actions are allowlisted and main-process mediated.
- `ContextMenuRequest` uses evidence keys/bounded previews instead of raw long
  selected text, raw file paths, or unsafe URLs.
- Context-menu requests expire and include target digest / UI generation.
- Context-menu action types are an allowlisted enum.
- Context-menu action result reports whether draft/project/provider/right-pane/
  handoff state changed.
- Reveal file works only for validated project/staged file refs and does not
  read or mutate file contents.
- Copy URL permits only safe schemes and blocks/redacts credentialed or active
  schemes.
- Native menu roles are used only on local governed editable/selection surfaces
  in v0.
- Unknown targets do not receive authority-bearing menu actions.
- All attachment and context-menu authority-bearing elements expose stable test
  hooks.
- Fixture tests include sentinel counters proving no provider transport,
  app-server mutation, Codex approval, patch apply, command run, right-pane
  mutation, or handoff mutation occurs through context menus.
- Attachment draft schemas validate before renderer projection.
- Submit packets validate before provider adapter use.
- Context-menu request and descriptor schemas validate before menu open.
- Action result schema validates after handler.
- Raw-exposure scanner runs on fixture output where feasible.

## Test Fixtures

- Select one workspace text file.
- Select one external image file.
- Drag one workspace file.
- Drag one external image.
- Drop a directory and confirm unsupported diagnostic.
- Paste text only.
- Paste image only.
- Paste clipboard with no image.
- Stage attachment then remove it.
- Stage unsupported image while provider image input is unavailable.
- Right-click composer empty area.
- Right-click selected text.
- Right-click typed file token.
- Right-click typed URL token.

## Future Work

- Project-scoped attachment library/history.
- Directory attach with explicit recursive manifest.
- OCR or image captioning.
- Per-message context menus.
- Per-thread/sub-agent context menus.
- Middle-web context menu with governed browser policies.
- Attachment previews in final transcript.
- Attachment lifecycle retention/cleanup controls.
