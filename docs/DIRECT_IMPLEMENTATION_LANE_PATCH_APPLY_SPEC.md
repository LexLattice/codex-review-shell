# Direct Implementation-Lane Patch Apply Spec

Status: draft implementation specification for the next direct-runtime bundle on
the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md](./DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md)
- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Extend the Direct implementation lane from read-only inspection into the first
bounded write-capable Codex loop:

```text
implementation-lane turn
  -> optional approved read_file steps
  -> provider emits one supported apply_patch call
  -> shell records a patch obligation
  -> shell parses and dry-runs the patch
  -> renderer shows a human approval card with a bounded diff preview
  -> user approves
  -> workspace backend applies the patch through a journaled write path
  -> shell records bounded patch-result evidence
  -> context pack + request manifest
  -> provider continuation
  -> assistant finalizes the same turn
```

The goal is to make Direct implementation-lane useful for small implementation
tasks without enabling shell commands, network access, arbitrary file writes,
auto-approval, or app-server fallback.

## Core Invariant

Patch support is still local authority, not provider authority:

```text
provider patch call != workspace write authority
patch preview != committed filesystem state
user approval != permission for future writes
patch result != instruction authority
one apply_patch loop != general tool runtime
```

The provider may propose a patch. The main process owns parsing, dry-run,
workspace containment, user approval, write journaling, recovery, and
continuation legality.

## Boundary

This bundle does:

- admit exactly one supported `apply_patch` obligation in one Direct
  implementation-lane turn;
- allow that patch only after complete provider arguments are available;
- parse a unified diff into a structured patch plan before renderer approval;
- dry-run the patch against current workspace file digests before approval;
- require a fresh human approval action token for the patch;
- apply through the project workspace backend only after approval;
- record before/after digests, file operation summaries, journal status, and
  patch-result evidence;
- send one provider continuation with `store=false`, no new tool declarations,
  and exactly one patch-output item paired to the original call id;
- append final assistant continuation text to the same turn;
- keep read-only multi-step loops available before the patch.

It does not:

- support more than one patch obligation per turn;
- support auto-approval, approval-for-session, or imported approval replay;
- support direct renderer filesystem writes;
- support raw `write_file`, overwrite-file, mkdir, move, chmod, delete-directory,
  shell, network, browser, MCP, patch command execution, or arbitrary tools;
- allow a patch continuation to request another write or read in v0;
- run tests or shell commands after patch application;
- import or mutate right-pane ChatGPT content;
- mutate handoff queue items;
- fall back to app-server inside a direct turn;
- make production `direct` available.

## Relationship To The Previous Bundle

The previous bundle made this valid:

```text
read_file step 1
  -> continuation
  -> read_file step 2
  -> continuation
  -> final answer
```

This bundle admits one new terminal implementation step:

```text
read_file step 1
  -> continuation
  -> read_file step N
  -> continuation
  -> apply_patch
  -> approval
  -> workspace apply
  -> continuation
  -> final answer
```

Read-only and patch obligations remain separate authority classes. A
`read_file` approval never authorizes a patch. A patch approval never
authorizes another read or another patch.

## Supported Patch Shape

V0 supports exactly one provider patch call:

```ts
type DirectPatchApplyToolArguments = {
  patch: string;       // unified diff text
  summary?: string;    // renderer-safe short provider summary
};
```

Accepted tool name:

```text
apply_patch
```

Accepted namespace policy:

```text
namespace absent only
```

Accepted provider call/output pairs:

```ts
type DirectPatchProviderShape = {
  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
};
```

`function_call_output` evidence does not prove `custom_tool_call_output`, and
custom-tool evidence does not prove function-call evidence.

Unsupported names for this bundle:

```text
write_file
create_file
delete_file
rename_file
apply_patch_command
shell
bash
python
npm
network
browser
mcp
```

Unsupported calls become terminal unsupported evidence. They must not show an
approval button, perform filesystem writes, or send a continuation.

Multiple tool calls fail closed:

```text
If a provider response contains more than one tool call:
  no patch card
  no read card
  no workspace write
  terminal unsupported: multiple_tool_calls_unsupported
```

If a response emits `read_file` and `apply_patch` together, v0 does not choose
an order. It fails closed.

Read-loop to patch handoff:

```text
apply_patch is allowed only when no read_file step is nonterminal.
```

If a patch call appears while a read step is waiting, approved,
result-recorded, context-built, request-built, sent, or streaming, fail closed:

```text
patch_during_active_read_step_unsupported
```

## Request-Shape Evidence

Patch apply requires a distinct evidence scope. Read-only continuation evidence
does not unlock patch apply.

```ts
type DirectPatchApplyEvidenceScope = {
  requestShapeClass: "direct_patch_apply_continuation@1";
  model: string;
  endpointHash: string;
  accountEvidenceKey: string;

  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
  toolOutputItemType: "function_call_output" | "custom_tool_call_output";
  toolName: "apply_patch";
  namespacePolicy: "absent-only";

  patchArgumentShapeHash: string;
  patchPlanShapeHash: string;
  patchResultEnvelopeShapeHash: string;
  continuationRequestShapeHash: string;
  continuationNormalizerVersion: string;
  requestBuilderVersion: string;
  patchParserVersion: string;
  dryRunVersion: string;
  redactionVersion: string;

  store: false;
  toolDeclarations: false;
  toolOutputItem: true;
  previousResponseId: true;
  parallelToolCalls: false;
};
```

The patch evidence gate is action-specific:

```ts
directImplementationLane.patchApply = {
  canShowPatchObligations: boolean;
  canPlanPatch: boolean;
  canDryRunPatch: boolean;
  canApprovePatch: boolean;
  canApplyPatch: boolean;
  canSendPatchContinuation: boolean;
  blockerCodes: DirectPatchApplyBlockerCode[];
};
```

Missing patch evidence must not block Direct text-only or read-only inspection.
It blocks only the patch apply action.

## Patch Plan

The provider patch text is not renderer state and not workspace authority. The
main process converts it into a structured plan first:

```ts
type DirectPatchApplyPlan = {
  schema: "direct_patch_apply_plan@1";
  patchPlanId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  obligationId: string;
  callId: string;
  providerResponseId: string;
  providerCallId: string;
  providerCallItemId?: string;
  parentResponseSource:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream";
  parentResponseSourceEventDigest: string;
  parentTurnDigest: string;
  toolName: "apply_patch";
  providerCallType: "function_call" | "custom_tool_call";
  patchTextHash: string;
  patchShapeHash: string;
  parserVersion: string;
  dryRunVersion: string;
  createdAt: string;

  integrity: {
    algorithm: "hmac-sha256" | "sha256";
    keyId?: string;
    artifactDigest: string;
  };

  files: DirectPatchFilePlan[];
  totals: {
    fileCount: number;
    createCount: number;
    updateCount: number;
    deleteCount: number;
    addedLineCount: number;
    removedLineCount: number;
    hunkCount: number;
  };

  caps: {
    maxFiles: number;
    maxHunks: number;
    maxPatchChars: number;
    maxPreviewChars: number;
    truncatedPreview: boolean;
  };

  safety: {
    rawWorkspacePathExposed: false;
    rawProviderPayloadExposed: false;
    sensitivePathBlocked: boolean;
    secretLikeContentBlocked: boolean;
    binaryFileBlocked: boolean;
    symlinkEscapeBlocked: boolean;
    pathCollisionBlocked: boolean;
    generatedPathBlocked: boolean;
  };

  status:
    | "planned"
    | "dry_run_passed"
    | "dry_run_failed"
    | "blocked";

  blockerCode?: DirectPatchApplyBlockerCode;
};
```

Per-file plan:

```ts
type DirectPatchFilePlan = {
  filePlanId: string;
  operation: "create" | "update" | "delete";
  displayPath: string;            // project-relative only
  canonicalPathEvidenceKey: string;
  beforeDigest?: string;
  afterDigest?: string;
  beforeExists: boolean;
  beforeNonExistenceProof?: {
    parentDirectoryEvidenceKey: string;
    checkedAt: string;
  };
  afterExists: boolean;
  hunkCount: number;
  addedLineCount: number;
  removedLineCount: number;
  previewText: string;
  previewTextHash: string;
  previewTruncated: boolean;
};
```

The renderer receives only `displayPath`, bounded preview text, counts, status,
and renderer-safe summaries. It must never receive absolute local paths, WSL
paths, raw patch payloads beyond bounded preview, raw provider frames, source
hashes outside evidence keys, or backend stack traces.

## Patch Parser Rules

The parser must reject unsafe or ambiguous patch text before approval:

```text
absolute paths
drive-letter paths
UNC paths
WSL mirror paths
path traversal with ..
NUL/control characters
empty path
ambiguous rename-only patch
directory delete
binary patch
git binary patch
file mode changes
submodule changes
chmod/chown metadata
symlink creation
symlink target modification
patches outside workspace root
patches targeting generated app-private artifact roots
```

Accepted v0 dialect:

```text
git-style unified diff with a/ and b/ prefixes
hunks with explicit line ranges and context
new file mode only when metadata is ignored and the create is text-only
index lines ignored except as optional digest evidence
```

Rejected dialects and ambiguous forms:

```text
combined diffs
rename/copy headers
deleted file mode in v0
file mode changes
binary hunks
patches with ambiguous /dev/null handling
malformed hunk ranges
```

Line ending policy:

```text
preserve existing file line endings when possible
new files default to LF unless project policy says otherwise
```

V0 accepted file operations:

```text
create text file
update text file
```

V0 explicitly defers deletes:

```text
delete text file -> blocked with patch_delete_deferred
```

Delete support requires a later accepted policy with before-content backup,
visible delete summaries, digest proof, and recovery semantics.

The workspace backend must enforce path collision and normalization checks:

```text
reject two patch targets that normalize to the same canonical workspace target
reject case-only ambiguous paths on case-insensitive filesystems
reject Unicode-normalization collisions
reject slash/backslash ambiguity after normalization
```

For every target path, the backend must prove realpath containment:

```text
resolve normalized project-relative path
realpath parent directory when it exists
prove target remains under the canonical workspace root
reject symlink escape before dry-run and again before apply
```

For newly created files, realpath the nearest existing parent and prove
containment before writing.

Project policy may deny or require extra confirmation for generated or
vendor-like paths. V0 hard-blocks secret-like paths and app-private roots, and
blocks generated/vendor paths unless project config explicitly allows them:

```text
.git/**
node_modules/**
dist/**
build/**
coverage/**
*.lock
.env
.env.*
*.pem
*.key
.ssh/**
```

Patch parsing must use a structured parser or an explicitly bounded local
parser. It must not rely on fragile string slicing after the first accepted
implementation.

## Caps

Default v0 caps:

```ts
const MAX_PATCH_TEXT_CHARS = 256 * 1024;
const MAX_PATCH_FILES = 16;
const MAX_PATCH_HUNKS = 128;
const MAX_PATCH_LINES_CHANGED = 4000;
const MAX_PATCH_FILE_PREVIEW_CHARS = 8000;
const MAX_PATCH_APPROVAL_CARD_CHARS = 24000;
const MAX_PATCH_RESULT_SUMMARY_CHARS = 4000;
```

If caps are exceeded before dry-run:

```text
status = blocked
blockerCode = patch_caps_exceeded
approvalAvailable = false
workspaceWriteExecuted = false
continuationSent = false
```

V0 must not ask the user to approve an unreviewable write. If the approval
preview would be truncated, either provide an explicit safe full-review path or
block approval with:

```text
patch_preview_too_large_for_safe_approval
```

## Dry-Run

Dry-run happens before approval. It is a read-only workspace operation:

```text
1. acquire patch planning lock
2. validate project, thread, turn, obligation, and runtime tier
3. parse patch text
4. canonicalize project-relative paths through workspace backend
5. read before digests and text snapshots through workspace backend
6. apply hunks in memory
7. compute after digests
8. scan raw patch, changed text, after-text, and diff previews
9. write patch plan artifact
10. expose renderer-safe approval card
```

Dry-run failure never writes workspace files and never sends a provider
continuation.

Dry-run must fail if any target file changed between provider evidence and the
dry-run read, when such a source digest is available from prior `read_file`
evidence. If no prior digest is available, dry-run records:

```text
sourceDigestAvailable = false
```

and approval must still revalidate the current file digests immediately before
apply.

Secret scanning and redaction run at every boundary:

```text
raw patch text before plan persistence
bounded preview before renderer exposure
full in-memory after-text before apply
patch result envelope before provider continuation
renderer-safe reports before write
```

If after-text would introduce a secret-like value, block before workspace write:

```text
blockerCode = secret_like_content_blocked
workspaceWriteExecuted = false
continuationSent = false
```

For large updates, the implementation may scan changed regions plus nearby
context only if it records the scan scope and the policy version.

Before proof requirements:

```text
create:
  beforeExists=false plus beforeNonExistenceProof is required

update:
  beforeDigest is required

delete:
  blocked in v0 with patch_delete_deferred
```

## Approval Token

Patch approval requires an action token. Renderer buttons are not authority.

```ts
type DirectPatchApplyActionToken = {
  tokenId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  obligationId: string;
  patchPlanId: string;
  action: "approve" | "decline" | "cancel";
  obligationDigest: string;
  patchPlanDigest: string;
  patchPlanIntegrityDigest: string;
  beforeFileDigests: Record<string, string>;
  operationLedgerHeadDigest: string;
  workspaceEvidenceKey: string;
  expiresAt: string;
};
```

Decision conflict rules:

```text
same clientPatchDecisionId + same obligation + same action:
  return existing decision/apply/continuation snapshot

same clientPatchDecisionId + different obligation:
  reject client_decision_id_conflict

same clientPatchDecisionId + same obligation + different action:
  reject client_decision_id_conflict

approve after decline/cancel:
  reject terminal_decision_exists

decline/cancel after apply_started:
  reject too_late_for_decision
```

## Workspace Apply

Workspace writes happen only through the workspace backend.

Apply write order:

```text
1. acquire project mutation lock
2. acquire turn tool-loop lock
3. acquire patch obligation lock
4. validate action token and clientPatchDecisionId
5. re-read project generation, runtime tier, operation ledger head, and store health
6. revalidate patch plan digest
7. revalidate canonical paths, containment, collisions, policy, and before digests through workspace backend
8. write patch_apply_planned operation event
9. create app-private patch apply journal
10. apply all file changes through workspace backend
11. verify after digests
12. mark journal applied
13. write patch_apply_committed operation event
14. record patch result artifact
15. build patch continuation context and request manifest
16. only then send provider continuation
```

The workspace backend must provide either:

```text
transactional applyPatch(project, patchPlan)
```

or:

```text
journaled apply with before snapshots and deterministic recovery
```

If neither exists, v0 must block patch apply with:

```text
workspace_patch_backend_unavailable
```

and must not fall back to direct filesystem writes from the renderer or
transport layer.

Apply-level idempotency:

```text
same patchPlanId + same approved decision + journal status=applied:
  do not reapply
  return applied snapshot

same patchPlanId + journal status=applying:
  enter recovery classification
  do not start a second apply

same patchPlanId + journal status=partial_unknown:
  block all further apply/continuation
```

## Apply Journal And Recovery

Patch apply is a write operation. Recovery must distinguish local write truth
from provider continuation state.

```ts
type DirectPatchApplyJournal = {
  schema: "direct_patch_apply_journal@1";
  journalId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  obligationId: string;
  patchPlanId: string;
  operationId: string;
  status:
    | "planned"
    | "applying"
    | "applied"
    | "apply_failed"
    | "partial_unknown"
    | "repaired";
  fileEntries: Array<{
    displayPath: string;
    canonicalPathEvidenceKey: string;
    operation: "create" | "update" | "delete";
    beforeDigest?: string;
    afterDigest?: string;
    backupEvidenceKey?: string;
    applied: boolean;
  }>;
  rawPathsExposed: false;
};
```

Local apply state and provider continuation state are separate:

```ts
type DirectPatchApplyState =
  | "not_started"
  | "planned"
  | "applying"
  | "applied"
  | "apply_failed"
  | "partial_unknown";

type DirectPatchContinuationState =
  | "not_built"
  | "context_built"
  | "request_built"
  | "sent"
  | "streaming"
  | "completed"
  | "transport_handoff_unknown"
  | "failed";
```

A patch can be locally applied even if provider continuation fails or is
unknown. The UI must show that plainly:

```text
Patch was applied locally.
Assistant continuation did not complete.
Do not assume tests passed or the model saw the final patch result.
```

Recovery classifications:

```ts
type DirectPatchApplyRecoveryState =
  | "healthy"
  | "waiting_for_user"
  | "decision_committed_no_apply"
  | "apply_started_unknown"
  | "apply_committed_no_result"
  | "result_recorded_no_context"
  | "context_built_no_manifest"
  | "request_built_not_sent"
  | "sent_no_bytes"
  | "stream_interrupted"
  | "terminal"
  | "corrupt";
```

Rules:

```text
planned journal + no file changes:
  abandon or retry dry-run only, no provider continuation

applying journal + all after digests match:
  repair as applied, record patch result if absent

applying journal + mixed before/after digests:
  partial_unknown, block composer and continuation

applied journal + no provider bytes:
  do not auto-retry after transport handoff uncertainty

corrupt journal:
  implementation lane enters degraded read-only mode for that thread
```

Partial or unknown apply state must be visible to the user. It must not be
reported as successful provider completion.

This bundle journals enough evidence for recovery and inspection. It does not
implement user-facing revert. A future journal-backed revert flow needs a
separate spec and approval model.

## Patch Result Envelope

The provider receives a bounded structured envelope, not raw filesystem paths
and not the full raw patch by default.

```ts
type DirectPatchApplyResultEnvelope = {
  kind: "apply_patch_result";
  status:
    | "applied"
    | "declined"
    | "canceled"
    | "dry_run_failed"
    | "apply_failed";
  patchPlanId: string;
  operationId: string;
  files: Array<{
    path: string; // project-relative display path
    operation: "create" | "update" | "delete";
    beforeEvidenceKey?: string;
    afterEvidenceKey?: string;
    addedLineCount: number;
    removedLineCount: number;
  }>;
  summary: string;
  truncated: boolean;
  rawPathsExposed: false;
  rawPatchIncluded: false;
};
```

Raw digest strings are not included in provider output unless a future evidence
scope explicitly admits them. Provider-facing file identity uses
project-relative display paths plus local evidence keys.

The result envelope is tool-result evidence:

```text
patch result evidence != current user instruction
patch result evidence != permission for another write
patch result evidence != proof tests passed
```

Safe-to-send failures:

```text
patch_context_mismatch
patch_dry_run_failed
file_changed_before_apply
patch_declined
patch_canceled
```

Decline/cancel policy:

```text
decline/cancel records the human decision and sends one safe tool-output
continuation saying declined/canceled only when patch continuation evidence is
available.

if patch continuation evidence is missing:
  decline/cancel ends locally with no provider continuation.
```

Local-terminal failures, not sent to provider:

```text
sensitive_path_denied
secret_like_content_blocked
workspace_escape_blocked
workspace_patch_backend_unavailable
partial_apply_unknown
raw_path_exposure_risk
journal_corrupt
```

## Continuation Context And Manifest

Patch continuation uses a dedicated context projection:

```text
patch_apply_context@1
  -> direct_context_pack@1
  -> provider_input_projection
  -> direct_request_manifest@1
  -> provider continuation
```

Continuation manifest requirements:

```ts
enabledFeatures: {
  store: false;
  toolDeclarations: false;
  toolOutputItem: true;
  toolOutputItemType:
    | "function_call_output"
    | "custom_tool_call_output";
  providerCallType:
    | "function_call"
    | "custom_tool_call";
  previousResponseId: true;
  parallelToolCalls: false;
};

continuity: {
  previousResponseIdUsed: true;
  providerContinuityHandleUsed: true;
  importedContinuityHandleUsed: false;
};

previousResponse: {
  id: string;
  source:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream";
  sourceEventDigest: string;
  sourceTurnDigest: string;
  sourceRequestManifestId: string;
};
```

If the request builder sets `max_output_tokens` or a local output reservation,
the manifest records the value and source policy. Exhausting that budget is a
terminal `patch_continuation_incomplete` state, not a successful finalization.

`toolDeclarations=false` means no new tool declarations or new tool permission.
The input may contain exactly one accepted patch-output item paired to the
original `call_id`.

Evidence for one provider call/output pair never unlocks the other pair.

The provider input must re-send current harness policy and patch-continuation
policy because provider continuity does not automatically carry prior
instructions.

Patch continuation policy:

```text
Use the apply_patch result as local evidence.
Do not request another tool in this turn.
If the patch was applied, summarize the change and any user-visible next step.
If the patch was declined, canceled, or failed safely, explain that no workspace
change was committed.
```

Patch continuation terminal handling:

```text
response_completed + non-empty assistant text:
  completed_final_assistant

response_incomplete:
  patch_continuation_incomplete

response_completed + empty assistant output:
  empty_patch_continuation_output

tool call after patch:
  nested_tool_after_patch_unsupported

apply_patch after patch:
  nested_patch_after_patch_unsupported

unknown event blocker:
  patch_continuation_unknown_event
```

Any provider tool call after patch continuation is terminal unsupported in v0.

## Turn And Composer Behavior

While patch state is nonterminal, same-thread composer is disabled:

```text
collecting_patch_arguments
patch_planning
patch_waiting_for_approval
patch_approved
patch_applying
patch_result_recorded
patch_context_built
patch_request_built
patch_continuation_sent
patch_streaming_continuation
```

Rollback to app-server is blocked while any of those states is active.

After a safe terminal state:

```text
completed_final_assistant:
  composer may allow a fresh follow-up turn

patch_declined or patch_canceled:
  composer may allow a fresh follow-up turn

patch_apply_failed_safe:
  composer disabled until recovery policy allows retry or fresh turn

partial_apply_unknown:
  composer disabled; user must inspect recovery status

transport_handoff_unknown:
  no auto-retry; composer disabled until a later recovery spec
```

## UI

Approval card content:

```text
Apply patch
N files changed
+A / -D lines
file list with create/update/delete labels
bounded diff preview
warnings and blockers
Approve / Decline / Cancel
```

Because deletes are deferred in v0, a delete target appears only as a blocked
plan with `patch_delete_deferred`; it must not show an approve action.

Required labels:

```text
This will modify workspace files.
Direct implementation lane - experimental.
Patch preview is not applied yet.
```

Do not rely on tooltips as the only warning for destructive operations.

The card must never show:

```text
raw absolute paths
raw WSL paths
raw provider frames
raw request bodies
raw auth material
backend stack traces
unbounded patch text
```

The approval button appears only after complete valid patch arguments, a valid
plan, a passed dry-run, and an untruncated or explicitly full-reviewable preview.
If the diff preview is truncated without a safe full-review path, approval is
blocked with `patch_preview_too_large_for_safe_approval`.

## Operation Ledger Events

Append-only events:

```text
patch_obligation_recorded
patch_plan_built
patch_dry_run_passed
patch_dry_run_failed
patch_decision_committed
patch_apply_planned
patch_apply_started
patch_apply_committed
patch_apply_failed
patch_result_recorded
patch_continuation_context_built
patch_continuation_request_built
patch_continuation_sent
patch_continuation_stream_started
patch_continuation_terminal
```

Required event order:

```text
patch_obligation_recorded
patch_plan_built
patch_dry_run_passed | patch_dry_run_failed
patch_decision_committed
patch_apply_planned
patch_apply_started
patch_apply_committed | patch_apply_failed
patch_result_recorded
patch_continuation_context_built
patch_continuation_request_built
patch_continuation_sent
patch_continuation_stream_started
patch_continuation_terminal
```

If dry-run fails, no apply or continuation events are written. If the user
declines or cancels, write `patch_decision_committed`; then either build the
safe declined/canceled continuation when evidence is available, or terminate
locally without provider continuation.

Each event cites ids and hashes:

```text
threadId
turnId
obligationId
patchPlanId
patchPlanDigest
journalId
resultId
contextBuildId
requestManifestId
providerInputHash
previousResponse source proof
operationId
```

No event may store raw patch text, raw file content, raw paths, or raw provider
frames in renderer-safe fields.

## Blocker Codes

```text
patch_tool_evidence_missing
patch_tool_evidence_expired
patch_tool_shape_unsupported
unsupported_patch_tool_name
unsupported_patch_namespace
missing_patch_call_id
malformed_patch_arguments
patch_caps_exceeded
patch_parser_failed
patch_binary_file_unsupported
patch_delete_deferred
patch_mode_change_unsupported
patch_symlink_unsupported
patch_path_traversal_blocked
patch_path_collision_blocked
patch_generated_path_blocked
workspace_escape_blocked
sensitive_path_denied
secret_like_content_blocked
patch_context_mismatch
file_changed_before_apply
workspace_patch_backend_unavailable
patch_dry_run_failed
patch_approval_required
patch_action_token_stale
patch_preview_too_large_for_safe_approval
client_decision_id_conflict
terminal_decision_exists
too_late_for_decision
patch_apply_failed
partial_apply_unknown
patch_result_redaction_blocked
patch_continuation_context_failed
patch_continuation_request_failed
patch_continuation_incomplete
empty_patch_continuation_output
patch_continuation_unknown_event
missing_native_parent_continuity
transport_handoff_unknown
nested_tool_after_patch_unsupported
nested_patch_after_patch_unsupported
patch_during_active_read_step_unsupported
```

## Runtime Status

Expose patch readiness separately from read-only readiness:

```ts
directImplementationLane.patchApply = {
  canShowPatchObligations: boolean;
  canPlanPatch: boolean;
  canDryRunPatch: boolean;
  canApprovePatch: boolean;
  canApplyPatch: boolean;
  canSendPatchContinuation: boolean;
  canRecoverPatch: boolean;
  degradedToReadOnly: boolean;
  activePatchCount: number;
  activePatchState?: string;
  activePatchRecoveryState?: DirectPatchApplyRecoveryState;
  maxPatchFiles: number;
  maxPatchTextChars: number;
  evidenceState:
    | "accepted"
    | "runtime_probed"
    | "candidate"
    | "expired"
    | "missing";
  blockerCodes: DirectPatchApplyBlockerCode[];
};
```

Patch readiness must not be collapsed into a generic direct-ready flag.

## Headless Harness

Add a fixture-first scenario:

```bash
npm run direct:smoke
```

The smoke should prove:

```text
read_file loop still works
provider apply_patch call creates patch obligation
dry-run runs before approval
approval card has bounded renderer-safe diff
decline sends no workspace write
approve applies exactly once
duplicate approve does not reapply
file changed before apply blocks
secret-like patch blocks locally
patch result continuation writes context pack and manifest
post-patch nested tool call is terminal unsupported
Direct text-only apply_patch call blocks with no plan, no card, no write, no continuation
read-only loop without patch evidence still permits reads but blocks patch application
patch delete is blocked with patch_delete_deferred
case/Unicode/path collision blocks
symlink/path escape blocks
partial/unknown journal recovery degrades to read-only
post-patch incomplete, empty, unknown, and nested-tool continuations are distinct terminal states
right-pane and handoff sentinels are not invoked
app-server is not spawned
```

Live headless patch scenarios are optional for this bundle and must require:

```text
CODEX_DIRECT_REAL_TURN=1 or --allow-live-provider-call
CODEX_DIRECT_REAL_TURN_ALLOW_CI=1 when CI=true
accepted direct_patch_apply_continuation@1 evidence
```

The runner must not auto-probe missing patch evidence and then continue.

## Raw-Exposure Tests

Scan:

```text
patch approval card state
serialized renderer state
DOM attributes
browser local/session storage
operation history
patch plan renderer projection
patch result projection
headless reports
handoff queue text
```

Assert absence of:

```text
raw auth
raw request bodies
raw backend frames
raw absolute paths
raw WSL paths
raw source hashes outside evidence keys
raw ChatGPT URLs
secret-like patch content
unredacted stack traces
```

If a renderer-safe report cannot be produced without raw exposure, write only a
minimal safe failure diagnostic.

## Implementation Phases

### Phase -1 - Law And Evidence

- Add `direct_patch_apply_continuation@1` evidence scope.
- Add patch blocker-code enum.
- Add patch readiness under `directImplementationLane.patchApply`.
- Define `apply_patch` tool argument shape.
- Define patch caps and parser policy.
- Decide and encode v0 delete deferral.
- Define multiple-tool-call and active-read-to-patch fail-closed behavior.
- Define decline/cancel continuation policy.
- Add no-patch support to Direct text-only.

### Phase 0 - Patch Obligation And Plan

- Detect exactly one complete supported `apply_patch` call.
- Reject unsupported names/namespaces/malformed args/missing call id.
- Parse patch into `direct_patch_apply_plan@1`.
- Enforce exact unified-diff dialect, path normalization, collision, generated
  path, secret, and containment checks.
- Dry-run against workspace backend.
- Attach provider-call provenance and plan integrity metadata.
- Write patch plan artifact.
- Show renderer-safe approval card.

### Phase 1 - Decision And Apply

- Add patch action tokens.
- Enforce decision idempotency and conflict rules.
- Acquire project mutation, turn, and patch locks.
- Create apply journal.
- Revalidate file digests, non-existence proofs, path containment, and policy
  immediately before apply.
- Apply through workspace backend.
- Verify after digests.
- Classify apply state separately from continuation state.
- Record patch result artifact.

### Phase 2 - Continuation

- Build `patch_apply_context@1`.
- Build context pack with patch-result evidence.
- Build provider-input projection and request manifest.
- Assert `store=false`, no declarations, one output item, previous response
  proof, output item type, provider call type, and `parallelToolCalls=false`.
- Send one provider continuation.
- Require final assistant text; incomplete/empty/unknown/nested tool outcomes are
  distinct terminal states.

### Phase 3 - UI And Recovery

- Add patch approval card and status rows.
- Disable composer during nonterminal patch states.
- Block rollback during active patch states.
- Surface partial/unknown apply recovery states.
- Surface locally-applied-but-continuation-failed state.
- Degrade affected thread to read-only when patch journal is corrupt or partial
  unknown.
- Keep read-only cards and patch cards visually distinct.

### Phase 4 - Smokes

- Fixture patch approve/decline/cancel.
- Duplicate approval no reapply.
- Dry-run conflict.
- File changed before apply.
- Sensitive path and secret-like content block.
- Missing backend blocks.
- Delete deferred.
- Collision and symlink/path escape block.
- Direct text-only apply_patch blocks with no card/write/continuation.
- Read-only loop without patch evidence still reads but blocks patch apply.
- Post-patch nested tool terminal unsupported.
- Post-patch incomplete/empty/unknown terminal handling.
- Raw-exposure scan.
- No app-server/right-pane/handoff sentinels.

## Acceptance Criteria

- `apply_patch` is the only write-capable tool admitted in this bundle.
- Patch evidence is distinct from text-only and read-only continuation evidence.
- Provider patch calls do not create authority; approval tokens and main-process
  revalidation are required.
- Patch parsing and dry-run happen before approval.
- V0 blocks deletes with `patch_delete_deferred`.
- The accepted unified-diff dialect is explicit; ambiguous formats are rejected.
- Path canonicalization handles case, Unicode, path-separator collisions, and
  symlink containment through the workspace backend.
- Patch plans include provider response/call provenance and integrity metadata.
- Create/update before-proof requirements are explicit; update always requires
  a before digest.
- Renderer sees only bounded renderer-safe diff previews and summaries.
- Workspace writes happen only through the workspace backend.
- Apply writes are journaled and recovery classifies partial/unknown states.
- Patch apply idempotency is enforced at the journal/apply level.
- Local apply state and provider continuation state are separate.
- Locally applied but continuation failed/unknown is visible.
- User-facing revert is explicitly out of scope.
- Before file digests are revalidated immediately before apply.
- Duplicate approve does not reapply.
- Decline/cancel performs no workspace write.
- Decline/cancel continuation behavior is explicit and evidence-gated.
- Patch result continuation writes context pack and request manifest before
  transport.
- Continuation manifest records `store=false`, `toolDeclarations=false`,
  `toolOutputItem=true`, `previousResponseId=true`, and
  `parallelToolCalls=false`, plus provider call/output item types.
- Provider input re-sends harness and patch-continuation policy.
- Continuation terminal handling distinguishes completed, incomplete, empty
  output, unknown event, and nested tool.
- Multiple tool calls in one response fail closed with no approval card.
- `apply_patch` during a nonterminal read step fails closed.
- Post-patch tool calls and post-patch `apply_patch` are terminal unsupported in
  v0.
- Direct text-only still blocks all tool calls.
- Missing patch evidence does not block read-only loops, but it blocks patch
  planning, approval, apply, and patch continuation.
- Read-only multi-step loops remain read-only until a separate patch obligation
  appears.
- No app-server fallback, right-pane mutation, or handoff mutation occurs.
- Raw-exposure scans cover renderer state, reports, operation history, and
  approval cards.

## Final Meaning

Passing this bundle means:

```text
The Direct implementation lane can inspect files, receive one provider-proposed
patch, show a safe human approval preview, apply the patch through the workspace
backend, and send one lawful continuation without app-server fallback.
```

It does not mean:

```text
direct is production
direct is default
shell commands are supported
tests can be run
general write_file is supported
multiple patches per turn are supported
auto-approval exists
right-pane ChatGPT is controlled
app-server can be removed
```
