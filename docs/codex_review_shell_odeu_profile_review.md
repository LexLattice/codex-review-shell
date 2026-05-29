# Codex Review Shell ODEU Profile Review v53

Reviewed artifact:

```text
CODEX_REVIEW_SHELL_ODEU_PROFILE.md
```

Repo inspected:

```text
codex-review-shell-main(7).zip
```

Validation run from the extracted repo:

```text
npm run validate
```

Result:

```text
check:syntax:        passed
migration:smoke:     passed
usage-ledger:smoke:  passed
attachments:smoke:   passed
agent:smoke:         passed
```

No source files were modified.

---

## 1. Verdict

The profile is directionally right and useful. Its core thesis is the right local instantiation of the MP/GPO:

```text
codex-review-shell is not two chat panes plus a renderer;
it is a stateful multi-surface workbench with evidence-backed state objects,
authority boundaries, handoff routes, and preservation obligations.
```

The profile correctly emphasizes:

```text
state objects before surfaces;
evidence before authority;
main/backend validation before renderer-side mutation;
stored/live transcript parity;
project-local binding discipline;
resource route topology;
sub-agent identity preservation;
preservation sentinels for shared owners.
```

This matches the repo. The current tree already has many ODEU-shaped docs and code surfaces:

```text
docs/WORKFLOW_TRANSITION_GRAPH_SPEC.md
docs/CODEX_RUNTIME_PROVIDER_PROFILE_SPEC.md
docs/CODEX_RUNTIME_HEADER_DRAWER_SPEC.md
docs/CODEX_APP_SERVER_ONTOLOGY.md
docs/CODEX_TRANSCRIPT_PRESENTATION_AND_COMPOSER_PROJECTION_SPEC.md
docs/COMPOSER_ATTACHMENTS_AND_CONTEXT_MENU_SPEC.md
docs/CODEX_USAGE_LEDGER_SPEC.md
docs/MIDDLE_PANE_WEB_TAB_SPEC.md
```

and implementation owners such as:

```text
src/main.js
src/renderer/app.js
src/renderer/codex-surface.js
src/main/codex-app-server.js
src/main/workspace-backend.js
src/main/middle-web-host.js
src/main/attachment-staging-store.js
src/main/usage-ledger-*.js
src/backend/wsl-agent.js
```

The main weakness is that the profile is still mostly a **review doctrine**. It should become a **deterministic local ODEU contract** that the repo can validate.

In compact form:

```text
current profile:
  good ontology and gates in prose

needed profile v0.2:
  numbered state/transition/evidence catalog
  plus OTB transition claims
  plus BRL preservation manifests
  plus executable validation scripts
```

---

## 2. What the profile gets right

### 2.1 Correct parent class

The imported GPO classes are appropriate:

```text
long-running / interactive / networked tool
config/stateful tool
renderer-heavy tool
producer-stream reducer / event summarizer
capability / protocol / visualizer program
reactive scheduler / watcher / supervisor tool
```

The app is all of those. It has Electron surfaces, WebContents, IPC/preload bridges, app-server/WSL backend protocols, live thread events, transcript reconstruction, ChatGPT surface routing, usage ledgers, attachment staging, file viewers, and project/workspace bindings.

### 2.2 Correct state-object discipline

The state object ledger is the strongest part. Objects like these are real product owners:

```text
RuntimeProviderProfile
RuntimeConstitution
RuntimeSettingsProjection
ThreadRestoreTarget
TranscriptPresentationModel
ThoughtProcessProjection
AgentConversationGraph
ComposerDraftState
AttachmentDraftSet
ProjectStash
MiddleFileState
MiddleWebState
SurfaceBinding
UsageLedger
ThreadAnalyticsSnapshot
WorkspaceBackendStatus
```

This fits the repo’s current direction. The workflow transition spec already says UI labels must follow successful runtime transitions and must not substitute for runtime state. The runtime provider profile spec already says project config and provider labels may explain labels but may not enable mutation by themselves.

### 2.3 Correct authority boundary

The profile’s repeated rule is correct:

```text
renderer-visible paths are references, not authority;
provider labels are not capability authority;
project config is not mutation authority;
ChatGPT/Codex surface state must be confirmed by runtime evidence.
```

This matches the direct-harness doctrine:

```text
provider tool call != local authority
provider continuity handle != imported/session continuity
context projection != canonical rollout truth
diagnostic evidence != readiness promotion
fork exemplar != direct-shell support
right ChatGPT pane != direct Codex memory
```

### 2.4 Correct first implementation artifact

The profile is right that the first useful artifact is not another broad essay. It is a machine-readable state object ledger.

But the proposed descriptor is too small. It should be extended before becoming the repo’s ODEU nucleus.

---

## 3. Main missing layer: HOB / OTB / BRL separation

The profile partially imports the lessons from HOB, OTB, and BRL, but it does not separate them explicitly enough.

### 3.1 HOB local meaning

HOB asks:

```text
When this state-object class applies, which child obligations are inherited?
```

For the shell, each state object should import child obligations by default. Example:

```text
AttachmentDraftSet applies
  -> source identity
  -> type evidence
  -> staging route
  -> provider disposition
  -> preview projection
  -> submit boundary
  -> cleanup lifecycle
  -> privacy/redaction
  -> preservation sentinels
```

The current profile names `AttachmentDraftSet`, but it does not yet require all child obligations to be marked:

```text
covered
proved irrelevant
pass-through
deferred with risk
blocked pending evidence
```

### 3.2 OTB local meaning

OTB asks:

```text
Is this phase/action/feature transition legal?
```

The repo already has `WORKFLOW_TRANSITION_GRAPH_SPEC.md`, but the profile should directly import it as the canonical OTB object.

Every nontrivial feature should emit a row like:

```yaml
transition_claim:
  transition_id: SelectCodexThread
  from_state: selected_project_with_codex_binding
  to_state: codex_surface_thread_open_requested
  object_refs:
    - SurfaceBinding
    - ThreadRestoreTarget
    - CodexRuntimeProviderProfile
  evidence_required:
    - workspace-config binding
    - app-server available or degraded transcript path
    - codex-surface:thread-state after dispatch
  evidence_forbidden:
    - renderer label as active-thread truth
    - stale discovery record as binding authority
  allowed_next_states:
    - rendered_stored
    - attached_live
    - failed_with_diagnostic
  blocked_promotions:
    - requested_as_rendered
    - dispatched_as_attached
```

### 3.3 BRL local meaning

BRL asks:

```text
Did this patch preserve previously locked behavior on protected surfaces?
```

The profile has a preservation sentinel gate, but it should become manifest-shaped. A checklist is not enough once the app has many shared renderer/tokenizer/router owners.

Recommended local artifact:

```text
src/shared/odeu/replay-lock-manifest.js
```

or, if you prefer docs-first:

```text
docs/odeu/BRL_REPLAY_LOCK_MANIFEST.json
```

Each lock row should specify:

```yaml
lock_id: middle_file_markdown_paths_preserved
owner_surface: AssistantMarkdownTypedProjection
protected_surfaces:
  - middle_file_markdown
  - codex_final_message_markdown
  - sub_agent_message_markdown
probe_command: npm run odeu:brl -- middle_file_markdown_paths_preserved
raw_surfaces:
  - rendered_dom_text
  - action_router_invocation
  - file_ref_open_result
canonicalization_profile: dom_text_without_timestamps
expected_hash_provenance: previous_green_candidate
failure_meaning: protected_projection_changed_not_product_truth
```

BRL should not decide whether the patch is semantically wrong. It should say the protected observation changed.

---

## 4. Profile gaps against the repo

### 4.1 The state object ledger needs code anchors

The proposed `ShellStateObjectDescriptor` has:

```ts
id
producers
consumers
invariants
authorityBoundary
unsupportedStates
preservationSentinels
```

That is a good start, but it will not be enforceable. It should include code anchors and evidence authority.

Recommended v0.2 shape:

```ts
type ShellStateObjectDescriptor = {
  id: string;
  gpoNodes: string[];
  ownerKind:
    | "runtime_state"
    | "projection_state"
    | "resource_state"
    | "transition_state"
    | "ledger_state"
    | "surface_state";
  producers: string[];
  consumers: string[];
  codeAnchors: {
    producers: string[];
    consumers: string[];
    ipcChannels: string[];
    shellEvents: string[];
    storagePaths: string[];
  };
  evidenceAuthority: Array<{
    source: string;
    authority:
      | "project_config"
      | "runtime_probe"
      | "app_server_schema"
      | "surface_event"
      | "stored_transcript"
      | "filesystem_stat"
      | "workspace_backend"
      | "user_gesture"
      | "derived_projection";
    freshness: "fresh" | "stale" | "unknown" | "failed" | "unavailable";
    enablesMutation: boolean;
  }>;
  statusLattice: string[];
  invariants: string[];
  projections: string[];
  mutationRoutes: string[];
  staleEventRisks: string[];
  unsupportedStates: string[];
  preservationSentinels: string[];
  validationRefs: string[];
};
```

Without `codeAnchors`, the ledger will remain a prose artifact. With anchors, a review tool can ask:

```text
this patch touched src/renderer/codex-surface.js:renderRuntimeConstitution;
which state objects and BRL sentinels are imported?
```

### 4.2 Add missing state objects

The current ledger is good, but several repo-relevant owners are missing or under-named.

Add:

```text
AppServerRequestRegistry
  Owns command/file-change/tool/MCP/permission/provider request cards and responses.

CodexTurnLifecycleState
  Owns active turn, queued messages, stop/send/steer disposition,
  terminal/incomplete/failure statuses.

ProviderCapabilityEvidenceStore
  Owns runtime probes, app-server schema refs, account/quota evidence,
  stale/unsupported mutation decisions.

ContextMenuCommandRegistry
  Owns target descriptor -> menu policy -> action route; right-click is not authority.

ChatgptDownloadImportState
  Owns download macro queue, host download route, project import route,
  same-turn fallback, unique suffix fallback.

ExternalNavigationPolicy
  Owns link intent, ChatGPT trusted URL policy, middle-web routing,
  external-open security.

IpcChannelContract
  Owns preload-exposed operations, IPC handler authority, parameter validation,
  renderer/main separation.

WebContentsSecurityProfile
  Owns ChatGPT WebContents, Codex surface WebContents, middle-web WebContents,
  chrome reduction, injected scripts, remote content boundaries.

GeometryLayoutState
  Owns BrowserView/WebContentsView bounds, activation epoch, resize/layout storms,
  native middle-web view attachment.

CodexSurfaceRequestState
  Owns codex-surface request/notify/respond lifecycle and correlation.

OdeuTransitionCatalog
  Owns canonical transitions such as ActivateProject, SelectCodexThread,
  SelectChatGPTThread, AttachWorkspace, OpenMiddleFile, OpenMiddleWeb,
  SendProjectStashToChatGPT, StageAttachment, SubmitTurnWithAttachments.

BehavioralReplayLockSet
  Owns preservation rows and canonicalization profiles.
```

The app already has most of these mechanisms in code. The profile should name them so future patches bind to the right owner.

### 4.3 Import the direct-harness capability matrix explicitly

The profile mentions provider capability and runtime authority, but it should explicitly include the direct-harness matrix as a sibling authority source, not an implicit background.

Recommended section:

```text
Direct Harness Capability Boundary
```

Rules:

```text
Canonical capability rows live in the direct harness matrix.
Fork examples are crosswalk evidence, not shell support.
Direct provider support, app-server support, and standalone shell support are separate.
A renderer affordance can be visible as diagnostic, but mutation is enabled only
when the relevant canonical row is B-R/B-F with exact or accepted evidence for
that scope.
```

This prevents local UI work from enabling controls because a fork exemplar or provider label exists.

### 4.4 Duplicate renderer/projection logic should become a BRL owner risk

The repo currently has large renderer files with overlapping responsibilities:

```text
src/renderer/app.js              ~5.6k lines
src/renderer/codex-surface.js    ~6.9k lines
```

Both contain file-token, Markdown, typed-content, file-ref, URL, and projection logic. That does not mean immediate refactor is required, but it should be recorded as a shared-owner risk:

```text
AssistantMarkdownTypedProjection
TypedTokenActionRouter
FileReferenceResolverProjection
SubAgentMessageProjection
MiddleFileMarkdownProjection
CodexFinalMessageProjection
```

The profile’s Projection Renderer Separation Gate should be strengthened:

```text
If a patch touches tokenization, Markdown, file-link routing, or typed content,
it imports sentinels for all surfaces using equivalent projection semantics,
even if the implementation is currently duplicated.
```

Longer-term, consider a shared renderer module loaded by both renderer contexts, or at minimum a shared fixture/sentinel file that both renderers must satisfy.

### 4.5 IPC and preload channels need their own catalog

The repo exposes many IPC channels through `src/preload.js`, `src/preload-codex-surface.js`, and `ipcMain.handle(...)` in `src/main.js`.

This is a first-class authority surface.

Add gate:

```text
IPC_AND_PRELOAD_AUTHORITY_GATE
```

Trigger:

```text
feature adds or changes any bridge method, IPC handler, shell event, surface event,
file path argument, URL argument, command argument, or provider mutation request.
```

Required split:

```text
renderer-visible method
preload bridge parameter shape
ipcMain handler validation
main/backend authority route
result projection
failure diagnostic
preservation sentinel
```

Blocking rule:

```text
Renderer access to an IPC method is not authority to perform the action.
The main process must revalidate identity, project binding, path route,
provider capability, and user gesture where applicable.
```

### 4.6 WebContents surfaces need a security/evidence profile

The profile has `MiddleWebState` and `MiddleFileState`, but it should explicitly classify WebContents trust.

Add:

```text
WEB_CONTENTS_AND_REMOTE_SURFACE_GATE
```

Surfaces:

```text
ChatGPT WebContents
Codex local surface WebContents
middle Web tab WebContents
middle File tab renderer projection
```

Rules:

```text
remote page DOM is not project evidence;
remote page URL is not thread identity unless bound and validated;
injected scripts are best-effort UI aids, not protocol authority;
ChatGPT download links are untrusted until main-process import validates route;
middle-web history is utility state, not project evidence;
external-open requires URL policy.
```

### 4.7 Feature batons should be transition claims, not only design notes

The profile’s baton template is good but too implementation-light.

Replace or extend it with:

```yaml
feature_baton:
  feature_id: string
  objective: string
  posture: prototype | scoped | gold_candidate

  hob:
    activated_state_objects: []
    inherited_child_obligations: []
    irrelevant_or_deferred_children: []

  otb:
    transition_claims: []
    allowed_inputs: []
    forbidden_inputs: []
    legal_next_states: []
    blocked_promotions: []

  brl:
    protected_surfaces: []
    preservation_sentinels: []
    replay_manifest_refs: []
    acceptable_uncovered_risk: []

  implementation:
    files_expected_to_touch: []
    forbidden_files_or_owners: []
    main_process_routes: []
    backend_routes: []
    renderer_surfaces: []

  validation:
    smoke_commands: []
    fixture_refs: []
    manual_runtime_checks: []
    evidence_to_capture: []
```

---

## 5. Proposed local GPO extension

The profile implies a reusable GPO class that is not yet named cleanly enough.

Candidate:

```text
MULTI_SURFACE_AGENTIC_WORKBENCH
```

Trigger:

```text
An app coordinates multiple AI/runtime/browser/workspace surfaces, where state,
resource authority, handoff routes, transcripts, provider capabilities, and
workspace mutation are split across processes or panes.
```

Inherited obligations:

```text
Surface identity and role preservation
Project/workspace binding topology
Provider/runtime capability evidence
Thread/session/turn lifecycle
Transcript normalization and projection
Sub-agent graph and primary/child identity
Handoff macro route law
Resource path/download/attachment topology
IPC/preload/main/backend authority split
Remote WebContents trust boundary
Usage/analytics derivation and freshness
Runtime/settings mutation scope
Observation ecology and stale-event law
Preservation replay locks for shared renderers/routes
```

Do not generalize:

```text
exact pane names
CSS classes
specific button labels
specific ChatGPT DOM selectors
one-off wording
```

Generalize:

```text
state ownership
evidence source
transition law
projection shape
authority boundary
replay-preservation contract
```

---

## 6. Suggested profile v0.2 outline

A stronger v0.2 profile would be:

```text
1. Scope and authority posture
2. Imported GPO classes
3. Local GPO extension: MULTI_SURFACE_AGENTIC_WORKBENCH
4. HOB: state-object obligation tree
5. OTB: transition catalog and legal frontier
6. BRL: replay lock / preservation manifest
7. Authority matrices
   7.1 provider/runtime capability
   7.2 direct harness matrix
   7.3 IPC/preload authority
   7.4 WebContents and remote-surface authority
8. State object ledger
9. Transition catalog
10. Shared-owner map
11. Validation catalog
12. Feature baton template
13. PR review checklist
14. First implementation artifacts
```

---

## 7. Concrete first implementation artifacts

The profile currently suggests:

```text
src/shared/odeu-state-ledger.js
```

I would split this into a small catalog family:

```text
src/shared/odeu/state-ledger.js
src/shared/odeu/transition-catalog.js
src/shared/odeu/capability-authority.js
src/shared/odeu/replay-locks.js
src/shared/odeu/owner-surface-map.js
```

Validation scripts:

```text
scripts/odeu-validate-state-ledger.mjs
scripts/odeu-validate-transition-catalog.mjs
scripts/odeu-validate-ipc-catalog.mjs
scripts/odeu-replay-lock-smoke.mjs
```

Package scripts:

```json
{
  "odeu:validate": "node ./scripts/odeu-validate-state-ledger.mjs && node ./scripts/odeu-validate-transition-catalog.mjs && node ./scripts/odeu-validate-ipc-catalog.mjs",
  "odeu:brl": "node ./scripts/odeu-replay-lock-smoke.mjs"
}
```

Then update:

```text
npm run validate
```

to include `odeu:validate` once the catalogs stabilize.

---

## 8. Recommended v0.2 descriptor examples

### 8.1 `ThreadRestoreTarget`

```js
{
  id: "ThreadRestoreTarget",
  ownerKind: "transition_state",
  gpoNodes: ["7.lifecycle", "9.diagnostics", "10.observation_ecology"],
  producers: [
    "codex-surface:thread-state",
    "workspace-config lane binding",
    "stored transcript discovery"
  ],
  consumers: [
    "reload runtime",
    "project activation",
    "startup restore",
    "header active-thread projection"
  ],
  codeAnchors: {
    producers: [
      "src/main.js:rememberCodexThreadRestoreTarget",
      "src/main.js:chooseCodexThreadRestoreTarget",
      "src/renderer/codex-surface.js:reportThreadState"
    ],
    consumers: [
      "src/main.js:reloadCodexRuntime",
      "src/main.js:loadCodexSurface"
    ],
    ipcChannels: ["codex-surface:thread-state", "codex:reload-runtime"],
    shellEvents: ["surface:event"],
    storagePaths: ["workspace-config.json"]
  },
  evidenceAuthority: [
    {
      source: "codex-surface:thread-state",
      authority: "surface_event",
      freshness: "fresh",
      enablesMutation: false
    },
    {
      source: "workspace-config lane binding",
      authority: "project_config",
      freshness: "unknown",
      enablesMutation: false
    }
  ],
  statusLattice: ["none", "requested", "dispatched", "rendered_stored", "attached_live", "failed", "stale"],
  invariants: [
    "requested is not rendered",
    "rendered_stored or attached_live may update active-thread truth",
    "failed/latest event does not erase last usable restore target"
  ],
  projections: ["header thread label", "runtime drawer", "reload target"],
  mutationRoutes: ["reload runtime", "project activation"],
  staleEventRisks: ["late BrowserView load", "older activation epoch", "failed reload overwriting last usable target"],
  preservationSentinels: ["project activation restores linked thread", "failed reload does not clear prior target"],
  validationRefs: ["transition:SelectCodexThread", "transition:ActivateProject"]
}
```

### 8.2 `AttachmentDraftSet`

```js
{
  id: "AttachmentDraftSet",
  ownerKind: "resource_state",
  gpoNodes: ["3.resource_route_topology", "7.lifecycle", "10.security_substrate"],
  producers: ["file picker", "drag/drop", "clipboard image", "attachment staging store"],
  consumers: ["composer chips", "submit packet", "workspace reference block"],
  codeAnchors: {
    producers: [
      "src/main/attachment-staging-store.js:stagePaths",
      "src/main.js:chooseAttachmentFiles",
      "src/main.js:stageDroppedAttachments",
      "src/main.js:pasteClipboardImageAttachment"
    ],
    consumers: [
      "src/renderer/codex-surface.js:renderComposerAttachments",
      "src/main/attachment-staging-store.js:buildAttachmentReferenceBlock"
    ],
    ipcChannels: ["attachments:choose-files", "attachments:stage-drop", "attachments:paste-image", "attachments:remove-draft"],
    shellEvents: [],
    storagePaths: ["workspace staging directory", "draft manifest"]
  },
  evidenceAuthority: [
    {
      source: "main-process file stat / staged manifest",
      authority: "workspace_backend",
      freshness: "fresh",
      enablesMutation: true
    }
  ],
  statusLattice: ["staging", "ready", "unsupported", "failed", "removed"],
  invariants: [
    "selected artifact is not transcript evidence",
    "renderer must not expose raw external source path",
    "provider consumption is not claimed until submit evidence exists"
  ],
  projections: ["composer chip", "reference block", "error chip"],
  mutationRoutes: ["stage", "remove", "submit"],
  staleEventRisks: ["draft removed while chip remains", "provider capability changes before submit"],
  preservationSentinels: ["workspace file remains reference", "external image stages without raw path", "directory drops rejected"],
  validationRefs: ["npm run attachments:smoke"]
}
```

---

## 9. Suggested PR review additions

The current checklist is good. Add these:

```text
11. Which OTB transition claim does this action instantiate?
12. Which BRL locks are imported by the touched owner surfaces?
13. Did the patch expose a new IPC/preload authority route?
14. Did a WebContents-derived fact get promoted to project/runtime evidence?
15. Did a provider/fork capability row enable a mutation without exact/accepted evidence?
16. Does a late/stale event from an older activation epoch still have a mutation route?
17. Does the patch change duplicated projection logic in only one renderer context?
18. Are manual smoke checks enough, or is this now a replay-lock candidate?
```

---

## 10. Priority patch list for the profile

### Patch 1: Add local phase/object split

Explicitly separate:

```text
Product behavior ontology:
  state objects, projections, transitions, resources, surfaces

Application-governance overlay:
  HOB inheritance, OTB transition legality, BRL replay locks, PR batons
```

### Patch 2: Add `MULTI_SURFACE_AGENTIC_WORKBENCH`

Make it the local parent profile for this app.

### Patch 3: Replace one small state descriptor with full descriptor

Add code anchors, evidence authority, status lattice, projections, mutation routes, stale risks, and validation refs.

### Patch 4: Add transition catalog

Import `WORKFLOW_TRANSITION_GRAPH_SPEC.md` into a machine-readable local catalog.

Start with:

```text
ActivateProject
SelectChatGPTThread
SelectCodexThread
CreateOrUpdateProjectBinding
CreateOrUpdateLaneBinding
DiscoverCodexThreads
DiscoverChatGPTThreads
OpenMiddleFile
OpenMiddleWeb
StageAttachment
SendProjectStashToChatGPT
AttachWorkspace
UpdateRuntimePreferences
RespondToCodexServerRequest
UpdateThreadAnalytics
```

### Patch 5: Add BRL preservation manifest

Turn preservation sentinels into replayable or at least script-checkable rows.

### Patch 6: Add IPC/WebContents authority gates

This is essential for Electron. The current profile implies it, but it should be explicit.

### Patch 7: Add direct-harness capability boundary

Bind this profile to the existing direct harness matrix and prevent fork/provider evidence from being over-promoted.

---

## 11. Bottom line

The profile is good as a v0.1 local adaptation. The right next step is not to add more prose gates. It is to make the profile executable.

Recommended one-line upgrade:

```text
For codex-review-shell, every feature change should name:
state object -> transition claim -> authority evidence -> protected surfaces -> validation row.
```

Recommended first concrete artifact:

```text
src/shared/odeu/state-ledger.js
```

but only if it includes code anchors and evidence authority. Otherwise it will become another passive catalog.

Recommended first catalog family:

```text
state-ledger.js
transition-catalog.js
capability-authority.js
replay-locks.js
owner-surface-map.js
```

This would turn the profile from a strong architecture note into a repo-enforced ODEU layer.
