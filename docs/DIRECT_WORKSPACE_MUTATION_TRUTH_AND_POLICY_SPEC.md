# Direct Workspace Mutation Truth And Policy Substrate Spec

Status: draft for PR 4 from [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md).

Matrix rows: `E6-E8`, `E11`, `J4-J7`, parts of `F8`.

Related existing specs:

- [DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md](DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md)
- [DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md](DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md)
- [DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md](DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md](DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md](DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

## 1. Purpose

This bundle turns workspace mutation handling from scattered patch/command fields into one shared truth and policy substrate.

The Direct implementation lane can now read, patch, run bounded commands, recover after interrupted side effects, and run bounded iterative repair loops. The next risk is not a new tool. The risk is that local workspace mutation truth remains too implicit:

```text
patch applied locally
command may have changed files
provider saw only a result summary
renderer shows only a small preview
recovery knows some side effect happened
policy gates live in several modules
```

This PR defines one canonical way to answer:

```text
what changed locally?
which change was expected?
which change was unexpected?
which files are policy-sensitive?
which changes did the provider see as content, summary, or not at all?
what is recoverable, inspectable, or blocked?
```

Passing this bundle should mean:

```text
After any Direct implementation-lane patch or command step, the shell records a
durable workspace effect summary, evaluates path/policy classes consistently,
links patch journal and command side-effect truth, and reports whether the
provider saw changed file contents or only a bounded summary.
```

It should not mean:

```text
direct is production
new tools are enabled
patch delete is enabled
user-facing revert execution exists
commands are proven side-effect-free
network is sandboxed unless backend proves it
auto-approval exists
right-pane ChatGPT is controlled
app-server can be removed
```

## 2. Core Invariants

```text
workspace effect summary != permission to mutate
patch journal != user-facing revert
command exit zero != workspace clean
workspace changed != provider saw changed contents
provider saw summary != provider saw file contents
path policy warning != local authority
generated/vendor/lockfile policy != formatter/test proof
network helper block != network sandbox
renderer preview != authority artifact
```

Additional rules:

- Local mutation truth is derived from workspace-backend evidence, patch journals, command result artifacts, and operation ledger state.
- Renderer transcript rows and UI cards are never the source of mutation truth.
- The provider must not receive raw absolute paths, raw workspace digests, raw patch bodies, raw command output, or raw changed-file contents through effect reports.
- Policy evaluation is project-scoped and snapshot-bound to each turn/step.
- Missing or failed workspace-effect scans are first-class degraded states, not clean success.
- A command that changes files can still return exit code `0`; that is `completed_with_workspace_changes`, not clean verification.
- Patch changes and command changes are tracked separately, then summarized at turn level.
- Unexpected extra changes after a patch are a distinct local warning/blocker.
- User-facing revert remains out of scope except for a schema scaffold and inspection data.

## 3. Scope

### In Scope

- Canonical `direct_workspace_effect_summary@1`.
- Patch journal inspection and patch effect reconciliation.
- Command workspace-effect scan normalization.
- Path class and mutation policy substrate for read, patch, command, and reports.
- Sensitive path, app-private path, generated/vendor/build output, lockfile, and network-risk policy defaults.
- Policy snapshots for direct implementation-lane steps and loops.
- Workspace mutation visibility model:

```text
provider saw changed contents
provider saw only a summary
provider did not see changed contents
visibility unknown
```

- Renderer-safe operation-history/status projection for mutation states.
- Headless fixture coverage for expected patch changes, unexpected patch changes, command workspace mutation, blocked path classes, raw-exposure scanning, and degraded scans.
- Recovery integration with `direct_recovery_report@1`.

### Out Of Scope

- New provider tools.
- Patch delete support.
- User-facing revert execution.
- Automatic patch rollback.
- Broad filesystem write tools.
- General shell/network/browser/MCP runtime.
- Sandboxed network enforcement unless a backend capability already exists.
- Settings UI for editing policies.
- Right-pane ChatGPT mutation.
- App-server fallback inside direct.

## 4. Preconditions

PR 4 assumes these prior stages are merged and green:

- PR 1 real-provider implementation-lane proof for read, patch, command, and basic workspace-effect reporting.
- PR 2 recovery/replay safety for read, patch, command, and continuation boundaries.
- PR 3 iterative repair loop and transition graph.
- Direct text-only first-turn, recent-dialogue, and tool-call-blocked regressions.

If a precondition fails:

```text
workspace mutation truth fixtures may still run
live mutation proof is blocked
matrixPromotionCandidate = false
```

PR 4 should not debug provider tool-call elicitation, continuation recovery, or mixed repair sequencing. It owns the workspace mutation and policy substrate used by those flows.

## 5. Workspace Effect Summary

### 5.1 Canonical Shape

Add one canonical artifact for patch and command effects:

```ts
type DirectWorkspaceEffectSummary = {
  schema: "direct_workspace_effect_summary@1";
  effectSummaryId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  loopId?: string;
  stepId?: string;
  stepOrdinal?: number;
  source:
    | "patch_apply"
    | "run_command"
    | "manual_fixture"
    | "recovery_scan";
  sourceArtifactId: string;
  sourceOperationId?: string;

  scan: {
    supported: boolean;
    ran: boolean;
    scanScope:
      | "workspace-index"
      | "git-status"
      | "patch-journal"
      | "backend-native"
      | "none";
    scanVersion: string;
    scanFailed: boolean;
    scanFailureCode?: string;
    startedAt?: string;
    completedAt?: string;
    scanInputDigest: string;
    scanPolicyDigest: string;
    workspaceBindingEvidenceKey: string;
    sourceArtifactDigest: string;
    capabilities: DirectWorkspaceScanCapabilities;
    consistency: DirectWorkspaceScanConsistency;
  };

  preState?: DirectWorkspaceStateEvidence;
  postState?: DirectWorkspaceStateEvidence;
  preStateConfidence:
    | "exact"
    | "derived"
    | "missing"
    | "unsupported";
  expectationConfidence:
    | "exact"
    | "derived_from_patch_plan"
    | "unknown_due_to_missing_prestate";
  baselineDirtyState: DirectWorkspaceBaselineDirtyState;

  changes: DirectWorkspacePathChange[];
  changedPathCount: number;
  changedPathsPreview: DirectWorkspacePathChangePreview[];
  changedPathsTruncated: boolean;

  expectedChangeCount: number;
  unexpectedChangeCount: number;
  blockedChangeCount: number;
  sensitiveChangeCount: number;
  generatedOrVendorChangeCount: number;
  lockfileChangeCount: number;

  providerVisibility: DirectWorkspaceMutationVisibility;
  policyEvaluation: DirectWorkspacePolicyEvaluation;
  rendererSafeSummary: DirectWorkspaceEffectRendererSummary;

  rawWorkspacePathExposed: false;
  rawContentIncluded: false;
  rawDigestExposedToRenderer: false;
  rawDigestExposedToProvider: false;
  retention: DirectWorkspaceEffectRetentionPolicy;
};
```

`effectSummaryId` is a stable local evidence key. It may be an HMAC or an app-private artifact id. It must not expose raw filesystem paths or raw content hashes to renderer/provider surfaces.

Expected-vs-unexpected claims require a trustworthy pre-state:

```text
If preState is missing or scan unsupported, the summary must not claim
unexpected_extra_change with exact confidence unless the source artifact itself
proves the change happened after the action.
```

If the same source artifact and scan policy are scanned twice, the scanner must either return the same summary/evidence key or create a new explicit scan attempt linked to the prior summary. It must not silently overwrite effect summaries.

### 5.2 Scan Truth

Different scan scopes have different truth power. The summary must record this, not just a scope label.

```ts
type DirectWorkspaceScanCapabilities = {
  seesTrackedFiles: boolean;
  seesUntrackedFiles: boolean;
  seesIgnoredFiles: boolean;
  seesDeletedFiles: boolean;
  seesModeChanges: boolean;
  seesSymlinks: boolean;
  seesCaseOnlyRenames: boolean;
  seesContentDigests: boolean;
};

type DirectWorkspaceScanConsistency =
  | "stable"
  | "changed_during_scan"
  | "unknown";
```

Rules:

```text
git-status scan:
  may not see ignored files unless explicitly configured

patch-journal scan:
  knows patch intent and journal state, not full workspace cleanliness

backend-index scan:
  may claim broader truth only if index freshness is proven

changed_during_scan:
  degrade expectationConfidence and do not claim exact expected/unexpected counts
```

The scanner may use a fixed backend-owned scan method. If it invokes `git`, it must be a fixed allowlisted argv path owned by the backend, not a provider-proposed `run_command`, not shell-expanded, and not counted as a user-approved command step.

### 5.3 Workspace State Evidence

```ts
type DirectWorkspaceStateEvidence = {
  evidenceKey: string;
  algorithm:
    | "hmac-sha256"
    | "backend-index"
    | "git-status-tree"
    | "patch-journal";
  capturedAt: string;
  fileCount?: number;
  digestVisibleToRenderer: false;
  digestVisibleToProvider: false;
};
```

The state evidence is local and app-private. Reports may cite `evidenceKey`, not raw digest material.

### 5.4 Dirty Workspace Baseline

Before a side-effecting patch or command, capture whether the workspace is already dirty:

```ts
type DirectWorkspaceBaselineDirtyState = {
  captured: boolean;
  dirtyPathCount: number;
  dirtyPathsPreview: DirectWorkspacePathChangePreview[];
  dirtyPathsTruncated: boolean;
};
```

Classification rules:

```text
preexisting dirty path changed again:
  modified_preexisting_dirty

preexisting dirty path unchanged:
  preexisting_dirty

new dirty path after action:
  expected_patch_change, expected_command_change, or unexpected_extra_change
```

Without a baseline, a changed path may be preexisting dirty state. The summary must reflect lower confidence instead of treating the action as the exact source of the change.

### 5.5 Path Change Shape

```ts
type DirectWorkspacePathChange = {
  relPath: string;
  canonicalEvidenceKey: string;
  changeKind:
    | "created"
    | "modified"
    | "deleted"
    | "renamed"
    | "mode_changed"
    | "unknown";
  sourceExpectation:
    | "expected_patch_change"
    | "expected_command_change"
    | "unexpected_extra_change"
    | "modified_preexisting_dirty"
    | "preexisting_dirty"
    | "unknown";
  beforeEvidenceKey?: string;
  afterEvidenceKey?: string;
  policyClass: DirectWorkspacePathClass;
  policyDecision: DirectWorkspacePolicyDecision;
  providerVisibility: DirectPathProviderVisibility;
  rendererPreviewAllowed: boolean;
  providerSummaryAllowed: boolean;
};
```

Renderer/provider surfaces may display `relPath` only after path policy says the project-relative display path is safe. They must not display canonical host/WSL paths.

### 5.6 Preview Shape

```ts
type DirectWorkspacePathChangePreview = {
  relPath: string;
  changeKind: "created" | "modified" | "deleted" | "renamed" | "mode_changed" | "unknown";
  policyClass: DirectWorkspacePathClass;
  expected: boolean;
  providerVisibility: DirectPathProviderVisibility;
};
```

Preview lists are bounded. Omitted counts are mandatory when truncated.

### 5.7 Retention

Effect summaries are app-private operational evidence:

```ts
type DirectWorkspaceEffectRetentionPolicy = {
  class: "workspace-mutation-evidence";
  defaultExport: false;
  redactionRequiredForExport: true;
};
```

Renderer-safe summaries can be exported. Full effect summaries with path evidence keys are excluded from default diagnostics unless redacted.

## 6. Provider Visibility

Workspace changes must record what the model has actually seen.

```ts
type DirectPathProviderVisibility =
  | "not_seen"
  | "summary_only"
  | "content_seen_before_change"
  | "content_seen_after_change"
  | "content_partially_seen_after_change"
  | "unknown";

type DirectWorkspaceMutationVisibility = {
  changedPathsDetected: number;
  providerWasToldSummary: boolean;
  providerSawChangedFileContents: boolean;
  providerSawAllChangedFileContents: boolean;
  providerVisibilityCompleteness:
    | "none"
    | "summary_only"
    | "partial_content"
    | "all_policy_relevant_content"
    | "unknown";
  summaryOnlyPathCount: number;
  notSeenPathCount: number;
  contentSeenAfterChangePathCount: number;
  unknownChangedContentsCount: number;
  visibilityEvents: DirectWorkspaceVisibilityEvent[];
  visibilitySource:
    | "effect-summary"
    | "tool-result-envelope"
    | "subsequent-read-result"
    | "recovery"
    | "unknown";
};

type DirectWorkspaceVisibilityEvent = {
  relPath: string;
  visibility: DirectPathProviderVisibility;
  source:
    | "tool-result-envelope"
    | "subsequent-read-result"
    | "recovery";
  sourceArtifactId: string;
  observedAt: string;
};
```

Rules:

```text
patch result continuation:
  provider sees patch result summary, not changed file contents

command result continuation:
  provider sees command output summary and workspace-effect summary,
  not changed file contents

subsequent read_file of a changed path:
  providerVisibility may become content_seen_after_change for that path

renderer preview:
  never upgrades provider visibility

internal scanner content:
  never upgrades provider visibility

patch journal before/after evidence:
  never upgrades provider visibility
```

Turn-level `providerSawChangedFileContents=true` only if every policy-relevant changed path is `content_seen_after_change` or `content_partially_seen_after_change`. If one of ten changed files was read after change, the aggregate is `partial_content`, not all-content.

`content_seen_before_change` is stale visibility:

```text
Provider saw this path before it changed. Provider has not seen the changed contents.
```

Patch result continuations may include counts and safe project-relative paths. They must not include raw patch hunks or full changed content.

If the provider receives a summary only:

```text
workspace changed but provider saw only a summary
```

must appear in reports/status where relevant.

## 7. Policy Substrate

### 7.1 Path Classes

```ts
type DirectWorkspacePathClass =
  | "source"
  | "test"
  | "docs"
  | "config"
  | "lockfile"
  | "generated"
  | "vendor"
  | "dependency_dir"
  | "build_output"
  | "coverage_output"
  | "secret_like"
  | "app_private"
  | "vcs_internal"
  | "outside_workspace"
  | "unknown";
```

Classification must be done in main/backend using normalized project-relative paths and canonical backend evidence keys. Renderer strings are not policy authority.

### 7.2 Policy Decisions

```ts
type DirectWorkspacePolicyDecision =
  | "allow"
  | "allow_with_warning"
  | "extra_confirmation_required"
  | "block"
  | "degrade_to_read_only"
  | "manual_recovery_required";

type DirectWorkspacePolicyEvaluation = {
  schema: "direct_workspace_policy_evaluation@1";
  policyDigest: string;
  evaluatedAt: string;
  decisions: Array<{
    relPath: string;
    canonicalEvidenceKey: string;
    pathClass: DirectWorkspacePathClass;
    action:
      | "read"
      | "patch_plan"
      | "patch_apply"
      | "command_execute"
      | "command_effect"
      | "provider_summary"
      | "renderer_preview"
      | "revert_plan";
    decision: DirectWorkspacePolicyDecision;
    reasonCode: string;
  }>;
  hardBlockCount: number;
  warningCount: number;
};
```

Decision precedence:

```text
block >
manual_recovery_required >
degrade_to_read_only >
extra_confirmation_required >
allow_with_warning >
allow
```

If a path is both generated and secret-like, `block` wins. If a command changes both generated and source files, the turn-level policy reflects the strictest relevant decision.

Path classification must be versioned and tested across Windows, WSL, and Linux path forms. The fixture matrix must cover:

```text
source
test
docs
config
lockfile
generated
vendor
dependency_dir
build_output
coverage_output
secret_like
app_private
vcs_internal
outside_workspace
unknown
```

Collision and ambiguity reason codes:

```text
path_case_collision
path_unicode_collision
path_normalization_ambiguous
symlink_target_changed
```

These normally produce `manual_recovery_required` or `block`.

### 7.3 Default V0 Policy

Hard blocked by default:

```text
.git/**
.hg/**
.svn/**
app-private artifact roots
absolute paths
drive-letter paths
UNC paths
WSL mirror paths
.. traversal
NUL/control characters
symlink escape outside workspace
.env
.env.*
*.pem
*.key
.ssh/**
```

Patch targets blocked by default unless a later policy spec enables them:

```text
node_modules/**
vendor/**
dist/**
build/**
coverage/**
generated/**
*.lock
package-lock.json
pnpm-lock.yaml
yarn.lock
bun.lockb
```

Command side effects in these paths are not retroactively blocked because the command already ran. Instead they become:

```text
completed_with_policy_blocked_workspace_changes
```

or, if the command was declared `must_not_write`:

```text
completed_with_unexpected_workspace_changes
```

Provider continuation may proceed only if the provider envelope safely states the degraded state and no raw exposure is present. Otherwise the loop stops locally.

Sensitive/app-private/VCS mutation after a command is local-terminal by default:

```text
no provider continuation unless a later explicit recovery/diagnostic policy
permits a minimal non-path-specific summary
```

Do not tell the provider a sensitive path label such as `.env`, `.ssh`, `.git`, or an app-private root changed unless a specific policy says that label is safe.

Post-side-effect policy violations are first-class:

```ts
type DirectPostSideEffectPolicyViolation =
  | "none"
  | "policy_blocked_path_changed"
  | "must_not_write_changed_files"
  | "sensitive_path_changed"
  | "app_private_path_changed"
  | "vcs_internal_changed"
  | "unknown";
```

### 7.4 Policy Snapshot

Every patch/command/repair-loop step stores:

```ts
type DirectWorkspaceMutationPolicySnapshot = {
  schema: "direct_workspace_mutation_policy_snapshot@1";
  policyDigest: string;
  sensitivePathPolicyDigest: string;
  generatedVendorLockfilePolicyDigest: string;
  commandWorkspaceWritePolicyDigest: string;
  capPolicyDigest: string;
  networkRiskPolicyDigest: string;
  backendCapabilityDigest: string;
  pathClassifierVersion: string;
  effectScannerVersion: string;
};
```

The snapshot is cited by:

- patch plans;
- patch results;
- command plans;
- command results;
- workspace effect summaries;
- repair-loop context packs;
- headless reports.

## 8. Patch Journal Inspection

Patch apply already records a plan/result through backend authority. PR 4 adds a canonical inspection projection:

```ts
type DirectPatchJournalInspection = {
  schema: "direct_patch_journal_inspection@1";
  inspectionId: string;
  patchPlanId: string;
  patchResultId?: string;
  journalId?: string;
  journalState:
    | "planned_only"
    | "dry_run_passed"
    | "apply_started"
    | "applied_verified"
    | "apply_failed_verified"
    | "partial_unknown"
    | "journal_corrupt";
  plannedFiles: DirectPatchPlannedFile[];
  appliedFiles: DirectPatchAppliedFile[];
  expectedWorkspaceEffectSummaryId?: string;
  actualWorkspaceEffectSummaryId?: string;
  unexpectedChangesDetected: boolean;
  missingExpectedChangesDetected: boolean;
  beforeAfterEvidenceComplete: boolean;
  userFacingRevertAvailable: false;
};
```

Rules:

- `applied_verified` requires before/after evidence for every updated/created file.
- `partial_unknown` blocks further side-effecting actions until recovery/status policy says otherwise.
- Patch delete remains blocked with `patch_delete_deferred`.
- A patch that touches only planned files produces expected changes.
- Any extra changed path after apply is `unexpected_extra_change`.
- Patch journal inspection is read-only; it must not rewrite journals.

### 8.1 Patch Effect Reconciliation

Patch effect reconciliation compares:

```text
patch plan target files
patch apply result files
backend effect scan changed files
preexisting dirty state when available
```

Outcomes:

```ts
type DirectPatchEffectReconciliationState =
  | "matched_expected_changes"
  | "expected_changes_missing"
  | "unexpected_extra_changes"
  | "scan_missing"
  | "scan_failed"
  | "journal_partial_unknown"
  | "journal_corrupt";
```

If unexpected extra changes are found:

```text
Patch was applied locally, but extra workspace changes were detected.
Assistant saw only the patch-result summary unless later reads included changed contents.
```

No automatic revert or retry is allowed.

## 9. Command Workspace Effects

Command results already include `workspaceEffects`. PR 4 normalizes that into `direct_workspace_effect_summary@1`.

```ts
type DirectCommandWorkspaceEffectState =
  | "scan_passed_no_changes"
  | "changes_detected"
  | "scan_unsupported"
  | "scan_failed"
  | "changes_exceeded_cap"
  | "policy_blocked_changes_detected"
  | "unexpected_changes_detected";
```

Command class write-risk policy:

```ts
type DirectCommandWorkspaceWritePolicy =
  | "must_not_write"
  | "writes_possible_with_warning"
  | "writes_expected_but_bounded"
  | "blocked";
```

Default examples:

```text
npm test / pnpm test / yarn test / bun test:
  writes_possible_with_warning

npm run <script>:
  writes_possible_with_warning unless package metadata classifies it tighter

format-check:
  must_not_write

build-check:
  writes_possible_with_warning or blocked if output paths are policy-blocked
```

If a `must_not_write` command changes files:

```text
completed_with_unexpected_workspace_changes
```

If changed path count exceeds cap after the command ran:

```text
command_workspace_change_cap_exceeded
```

The command result remains local evidence, but provider continuation is blocked unless policy explicitly allows a bounded degraded envelope.

## 10. Backend Capabilities

Effect scanning and policy truth depend on backend capability truth:

```ts
type DirectWorkspaceMutationBackendCapabilities = {
  canonicalRootSupported: boolean;
  realpathContainmentSupported: boolean;
  pathEvidenceKeySupported: boolean;
  workspaceIndexScanSupported: boolean;
  gitStatusScanSupported: boolean;
  patchJournalInspectionSupported: boolean;
  commandWorkspaceEffectScanSupported: boolean;
  processTreeKillSupported: boolean;
  networkIsolationSupported: boolean;
  envSanitizationSupported: boolean;
};
```

If scan support is missing:

```text
effect scan unsupported
workspace mutation truth degraded
matrixPromotionCandidate = false for E7/E11
```

If network isolation is missing, UI/report copy must say:

```text
Known network helper commands are blocked, but project code is not network-sandboxed.
```

Do not claim "network disabled" unless the backend provides actual isolation evidence.

Command post-state scan order:

```text
process exits or timeout cleanup completes
process-tree cleanup status is recorded
workspace effect scan runs
```

If process-tree cleanup is unsupported or failed, the scan may still run, but the effect summary must be degraded:

```text
scan_after_uncertain_process_tree
```

The summary must not claim clean workspace state while orphaned processes may still be writing.

## 11. Caps

Add one shared caps object:

```ts
type DirectWorkspaceMutationCaps = {
  maxEffectChangedPaths: number;
  maxEffectPreviewPaths: number;
  maxPatchChangedFiles: number;
  maxPatchAddedLines: number;
  maxPatchRemovedLines: number;
  maxCommandChangedPaths: number;
  maxPolicyWarningPaths: number;
  maxProviderEffectSummaryChars: number;
  maxRendererEffectSummaryChars: number;
};
```

Default v0:

```ts
const DEFAULT_DIRECT_WORKSPACE_MUTATION_CAPS = {
  maxEffectChangedPaths: 200,
  maxEffectPreviewPaths: 50,
  maxPatchChangedFiles: 20,
  maxPatchAddedLines: 1200,
  maxPatchRemovedLines: 1200,
  maxCommandChangedPaths: 50,
  maxPolicyWarningPaths: 25,
  maxProviderEffectSummaryChars: 16 * 1024,
  maxRendererEffectSummaryChars: 24 * 1024,
};
```

If a cap is exceeded after a side effect:

```text
record local result
record effect summary with truncated preview and exceeded cap
do not pretend clean success
provider continuation only if bounded degraded envelope is policy-allowed
no automatic retry or revert
```

## 12. Operation Ledger Events

Effect and policy changes use concrete operation-ledger events:

```text
workspace_effect_scan_planned
workspace_effect_scan_started
workspace_effect_summary_recorded
workspace_effect_scan_failed
workspace_policy_evaluated
workspace_visibility_updated
patch_journal_inspection_recorded
```

Each event cites:

```text
effectSummaryId
policySnapshotId or policyDigest
sourceArtifactId
sourceArtifactDigest
scanInputDigest
previousOperationLedgerHeadDigest
```

Events must not contain raw paths, file contents, patch bodies, stdout/stderr, or raw digests exposed to renderer/provider surfaces.

## 13. Provider Envelopes

Provider envelopes may include only bounded summaries:

```ts
type DirectWorkspaceEffectProviderEnvelope = {
  schema: "direct_workspace_effect_provider_envelope@1";
  effectSummaryId: string;
  source: "patch_apply" | "run_command";
  changedPathCount: number;
  changedPathsPreview: DirectWorkspacePathChangePreview[];
  changedPathsTruncated: boolean;
  expectedChangeCount: number;
  unexpectedChangeCount: number;
  policyBlockedChangeCount: number;
  providerVisibility:
    | "summary_only"
    | "partial_content"
    | "all_policy_relevant_content"
    | "unknown";
  note: string;
  rawPathsIncluded: false;
  rawFileContentsIncluded: false;
  rawDigestsIncluded: false;
};
```

Provider envelopes must not include:

```text
absolute paths
raw local/WSL paths
raw file contents
raw patch body
raw stdout/stderr beyond existing command preview policy
raw digests
raw journal payloads
raw policy config with private roots
```

Build order:

```text
build effect summary
scan effect summary
build provider envelope from scanned/approved renderer-safe summary
scan provider envelope
only then allow continuation
```

If the effect summary itself contains a raw-exposure violation, do not derive provider-facing text from it.

Any continuation after a patch/command side effect must cite the relevant `workspaceEffectSummaryId` in the context pack and request manifest source refs.

## 14. Renderer And Operation History

Renderer-safe statuses:

```ts
type DirectWorkspaceMutationStatus =
  | "no_workspace_changes"
  | "workspace_changed_expected"
  | "workspace_changed_unexpected"
  | "workspace_changed_policy_blocked"
  | "workspace_effect_scan_unsupported"
  | "workspace_effect_scan_failed"
  | "patch_journal_partial_unknown"
  | "patch_journal_corrupt"
  | "workspace_changed_provider_summary_only";
```

Operation history rows should show:

```text
patch applied: 2 files changed
command completed: workspace changed
effect scan: backend-index, 3 changed paths
provider visibility: summary only
policy: generated path warning
```

They should not show raw host paths, raw digests, raw content, or raw command output beyond existing preview redaction.

## 15. Recovery Integration

Recovery scanner uses effect summaries as authority artifacts, not renderer rows.

Add recovery detail:

```ts
type DirectWorkspaceMutationRecoveryState =
  | "not_applicable"
  | "effect_summary_present"
  | "effect_summary_missing"
  | "effect_summary_digest_mismatch"
  | "effect_scan_failed"
  | "patch_journal_partial_unknown"
  | "patch_journal_corrupt"
  | "command_effect_unknown"
  | "corrupt";

type DirectWorkspaceEffectRecoveryState =
  | "effect_summary_present_valid"
  | "effect_summary_missing"
  | "effect_summary_corrupt"
  | "effect_summary_scan_failed"
  | "effect_summary_not_required"
  | "unknown";
```

Rules:

- If a command result exists but effect summary is missing, classify as `command_effect_unknown`.
- If a patch was applied but effect summary is missing, classify as `patch_applied_effect_summary_missing`.
- If a command ran but effect summary is missing, classify as `command_ran_effect_summary_missing`.
- If patch journal says `partial_unknown`, that wins over clean-looking effect summaries.
- If effect summary digest mismatches source artifacts, classify as corrupt.
- Recovery startup scan must not create or repair effect summaries.
- A later explicit user/manual recovery spec may add repair actions. PR 4 does not.

## 16. Headless Regression

Add a dedicated script:

```text
npm run direct:workspace-mutation
```

Suggested implementation:

```text
scripts/direct-workspace-mutation-regression.mjs
```

Fixture cases:

```text
patch_expected_changes:
  apply fixture patch, inspect journal, effect summary matched_expected_changes

patch_unexpected_extra_change:
  fixture backend reports extra changed path, status unexpected_extra_changes

patch_policy_blocked_path:
  patch target under app-private/.git/secret path blocks before apply

patch_generated_vendor_lockfile:
  generated/vendor/lockfile target follows default policy

command_no_changes:
  command effect scan passes with zero changed paths

command_workspace_changed:
  command writes a safe fixture file, effect summary records summary_only visibility

dirty_prestate:
  preexisting dirty path is not misclassified as a new side effect

command_must_not_write_changed:
  must_not_write class changes file, status completed_with_unexpected_workspace_changes

command_effect_scan_unsupported:
  scan unsupported is degraded and cannot promote E7/E11

command_effect_scan_failed:
  scan failed is degraded and cannot promote E7/E11

command_scan_race:
  changed_during_scan lowers expectation confidence

command_policy_blocked_changed_path:
  command changes generated/vendor/secret-like path, provider continuation blocked or degraded per policy

command_sensitive_side_effect_terminal:
  command changes sensitive/app-private/VCS path and stops locally

provider_visibility_after_subsequent_read:
  changed path starts summary_only, then subsequent read marks content_seen_after_change

path_classification_matrix:
  source/test/docs/config/lockfile/generated/vendor/dependency_dir/build_output/coverage_output/secret_like/app_private/vcs_internal/outside_workspace/unknown

path_collision_policy:
  case, Unicode, separator, and symlink ambiguity produce block/manual recovery

raw_exposure_scan:
  JSON report, Markdown summary, renderer projection, provider envelope
```

Sentinels:

```text
providerTransportCalls = 0 for fixture-only mutation cases
appServerSpawnCalls = 0
rightPaneMutationCalls = 0
handoffMutationCalls = 0
unauthorizedPatchApplyCalls = 0
unauthorizedCommandRunCalls = 0
rawPathExposureCount = 0
```

Live mode, if added, is optional and must be explicitly opt-in. Fixture coverage must not promote real-provider rows by itself.

## 17. Report Schema

Add:

```ts
type DirectWorkspaceMutationRegressionReport = {
  schema: "direct_workspace_mutation_regression_report@1";
  runId: string;
  createdAt: string;
  mode: "fixture" | "preflight" | "live";
  coverageSource:
    | "fixture"
    | "diagnostic"
    | "real_runtime"
    | "real_provider";
  matrixRowsExercised: Array<"E6" | "E7" | "E8" | "E11" | "J4" | "J5" | "J6" | "J7" | "F8">;
  matrixPromotionCandidate: boolean;
  preconditions: {
    realProviderImplementationLaneProof: "passed" | "failed" | "skipped";
    recoveryReplaySafety: "passed" | "failed" | "skipped";
    iterativeRepairLoop: "passed" | "failed" | "skipped";
    textRegressions: "passed" | "failed" | "skipped";
  };
  backendCapabilities: DirectWorkspaceMutationBackendCapabilities;
  policySnapshot: DirectWorkspaceMutationPolicySnapshot;
  cases: DirectWorkspaceMutationCaseReport[];
  rawExposureScan: {
    scanned: boolean;
    status: "passed" | "failed" | "not_run";
    findingCount: number;
  };
};
```

Per-case:

```ts
type DirectWorkspaceMutationCaseReport = {
  caseId: string;
  status:
    | "passed"
    | "blocked"
    | "degraded"
    | "failed"
    | "raw_exposure_blocked";
  proofOutcome:
    | "effect_summary_recorded"
    | "policy_blocked_before_side_effect"
    | "side_effect_recorded_degraded"
    | "patch_journal_inspected"
    | "provider_visibility_updated"
    | "raw_exposure_blocked";
  effectSummaryId?: string;
  patchJournalInspectionId?: string;
  policyDigest?: string;
  providerVisibility: DirectWorkspaceMutationVisibility;
  countsAsWorkspaceTruthProof: boolean;
  matrixPromotionCandidate: boolean;
  failureCode?: string;
};
```

Only `real_provider` or `real_runtime` cases with backend scan support can set `countsAsWorkspaceTruthProof=true` and promote `E7` or `E11`. Fixture and diagnostic cases remain evidence for implementation correctness but not real-provider coverage. If any precondition fails, `matrixPromotionCandidate=false`.

## 18. Raw Exposure Scan

Scan:

```text
effect summary JSON
patch journal inspection
provider envelopes
renderer-safe operation history
runtime status payloads
headless JSON reports
Markdown summaries
console summaries where captured
```

Block:

```text
raw auth
raw request bodies
raw provider frames
raw file contents
raw patch body
raw stdout/stderr outside approved previews
raw absolute paths
raw WSL paths
raw ChatGPT URLs
raw SQLite/internal exceptions
raw SHA digests exposed to renderer/provider
secret-like values
```

Report validation order:

```text
build report object
validate schema
serialize
raw-exposure scan
write full report if safe
re-read report
validate schema again
```

If scanning fails, write a minimal safe failure report.

## 19. Implementation Order

### Phase -2 - Scan Truth Law

- Define scan capability matrix.
- Define pre-state/post-state confidence.
- Define dirty workspace baseline.
- Define scan consistency and race handling.
- Define provider envelope schema.
- Define effect recovery states.

### Phase -1 - Policy Law

- Define `direct_workspace_effect_summary@1`.
- Define path classes and policy decisions.
- Define policy decision precedence.
- Define path classification fixture matrix.
- Define case/Unicode/separator/symlink collision policy.
- Define post-side-effect policy violation taxonomy.
- Define sensitive/app-private command side-effect terminal behavior.
- Define mutation visibility state.
- Define patch journal inspection projection.
- Define command workspace-effect state.
- Define policy snapshot and caps.

### Phase 0 - Backend Effect Scanner

- Add a backend-owned workspace effect scan abstraction.
- Support backend index or git-status scans where available.
- Produce canonical evidence keys.
- Use fixed backend-owned scan methods only; if `git` is used, invoke fixed argv and never provider-proposed command text.
- Run command post-scans after process-tree cleanup or record cleanup uncertainty.
- Record scan input digest and idempotency links.
- Record scan capability detail and consistency state.
- Record unsupported/failed scans truthfully.

### Phase 1 - Policy Evaluator

- Implement default sensitive/app-private/VCS path blocks.
- Implement generated/vendor/build/coverage/lockfile policy.
- Implement command write-risk policy.
- Implement network-risk capability truth.
- Implement deterministic path-class fixtures.
- Record retention/export policy.
- Persist policy snapshots on patch/command/repair-loop artifacts.

### Phase 2 - Patch Integration

- Inspect patch journal/result.
- Reconcile planned/applied/effect changes.
- Detect unexpected extra changes.
- Block clean success on unexpected extra changes.
- Build patch result provider envelope with counts/visibility only.
- Link effect summary id from patch result and loop step.
- Keep delete/revert out of scope.

### Phase 3 - Command Integration

- Normalize command `workspaceEffects` into canonical summaries.
- Classify `must_not_write` violations.
- Classify policy-blocked side effects.
- Enforce changed-path caps after execution.
- Record scan consistency state.
- Add provider envelope warning for summary-only visibility.
- Link effect summary id from command result and loop step.

### Phase 4 - Visibility And Recovery

- Track provider visibility for changed paths.
- Update visibility after provider-bound subsequent read of changed path.
- Store visibility events with `sourceArtifactId` and `observedAt`.
- Extend recovery scanner to require/validate effect summaries.
- Surface renderer-safe operation history/status.

### Phase 5 - Headless Regression

- Add `direct:workspace-mutation`.
- Add fixture cases for dirty pre-state, expected/unexpected/degraded/blocked effects, scan unsupported, scan failed, scan race, policy-blocked command side effects, and subsequent-read visibility upgrade.
- Add raw-exposure scans.
- Add no-provider/no-app-server/no-right-pane/no-handoff sentinels.

## 20. Acceptance Criteria

- `direct_workspace_effect_summary@1` is the canonical patch/command effect artifact.
- Patch result artifacts link to a workspace effect summary.
- Command result artifacts link to a workspace effect summary.
- Effect summaries use backend canonical evidence keys, not renderer path strings.
- Expected vs unexpected change claims require valid `preState` or documented lower confidence.
- Dirty workspace baseline is captured and preexisting dirty paths are not misclassified as new side effects.
- Effect summaries include `scanCapabilities` and `scanConsistency`.
- Backend scans are fixed backend-owned scans, never provider-proposed commands; if `git` is used, it is fixed argv and not a `run_command` step.
- Effect summaries include `scanInputDigest`, `scanPolicyDigest`, `workspaceBindingEvidenceKey`, and `sourceArtifactDigest`.
- Operation ledger records `workspace_effect_scan_*`, `workspace_policy_evaluated`, `workspace_visibility_updated`, and `patch_journal_inspection_recorded` events.
- Raw absolute host/WSL paths never appear in renderer/provider/report surfaces.
- Patch journal inspection distinguishes planned-only, applied-verified, failed-verified, partial-unknown, and corrupt.
- Patch effect reconciliation detects expected changes, missing expected changes, and unexpected extra changes.
- Command effect state distinguishes no changes, changes detected, scan unsupported, scan failed, policy-blocked changes, and unexpected changes.
- `must_not_write` command classes that change files are not reported as clean success.
- Generated/vendor/build/coverage/lockfile policy is enforced for patch targets and reported for command side effects.
- Sensitive/app-private/VCS paths hard-block before patch apply and provider summary exposure.
- Sensitive/app-private/VCS command side effects are local-terminal by default.
- Policy decision precedence is explicit.
- Path classification fixture coverage includes all path classes and Windows/WSL/Linux path forms.
- Case, Unicode, separator, and symlink ambiguity become block/manual-recovery reason codes.
- Post-side-effect policy violations are first-class states.
- Workspace mutation visibility records summary-only vs content-seen-after-change.
- Turn-level provider visibility distinguishes none, summary-only, partial-content, all-policy-relevant-content, and unknown.
- Visibility updates include `sourceArtifactId` and `observedAt`.
- `content_seen_before_change` is reported as stale content, not current visibility.
- Provider envelopes state when workspace changed but the provider saw only a summary.
- Provider envelopes have a fixed schema and include no raw paths, raw digests, raw patch bodies, raw command output, or changed file contents.
- Subsequent read of a changed path can update provider visibility to `content_seen_after_change`.
- Only provider-bound read results can upgrade changed paths to `content_seen_after_change`.
- Patch-result continuation cannot claim provider saw changed contents unless a subsequent read actually sent them.
- Effect summary caps and truncation counts are recorded.
- Cap exceeded after side effect records local truth and does not auto-retry or auto-revert.
- Backend capability truth records whether workspace effect scan and network isolation are supported.
- Network-risk copy does not claim sandboxing when backend isolation is absent.
- Recovery scanner treats missing/corrupt effect summaries as degraded/corrupt states.
- Recovery states distinguish missing, corrupt, and failed effect summaries for patch and command.
- Startup recovery does not create, repair, or mutate effect summaries.
- Effect summaries have retention/export policy and are excluded from default diagnostics unless redacted.
- Command post-scan runs after process-tree cleanup or records degraded cleanup uncertainty.
- Continuations after patch/command cite `workspaceEffectSummaryId` in context pack and request manifest source refs.
- `direct:workspace-mutation` report records PR 1/2/3/text-regression preconditions and blocks promotion if any fail.
- Revert plan schema may exist, but user-facing revert execution remains disabled.
- Headless `direct:workspace-mutation` covers expected patch, unexpected patch, command mutation, policy blocks, scan unsupported, visibility update, and raw-exposure cases.
- Fixture-only reports set `matrixPromotionCandidate=false`.
- `E7`/`E11` promotion requires real-runtime or real-provider proof with supported and executed workspace-effect scanning.
- Direct text-only behavior is unchanged.
- No app-server fallback, right-pane mutation, or handoff mutation occurs.

## 21. Product Boundary

Good:

```text
left Codex lane only
direct branch only
implementation-lane mutation truth
workspace backend authority
effect summaries
patch journal inspection
command side-effect truth
path and cap policy substrate
provider visibility truth
no app-server fallback
no right-pane/handoff mutation
```

Not included:

```text
production direct
new tools
patch delete
automatic revert
user-facing revert
general shell/network/browser/MCP
auto-approval
provider access to raw changed contents without read_file
settings UI for policy editing
app-server removal
```

This PR should make workspace mutation truth boring and explicit. After it lands, later UI, recovery, and context-maintenance PRs can rely on a single answer for what changed, what policy allowed, and what the provider actually saw.
