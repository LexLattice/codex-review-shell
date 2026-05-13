# Direct Implementation-Lane UI And Operation History Spec

Status: draft for PR 5 from [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md).

Matrix rows: `F1-F10`, `C7`, `F8`, `I13`, `J1-J8`.

Related existing specs:

- [DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md](DIRECT_IMPLEMENTATION_LANE_REAL_PROVIDER_PROOF_SPEC.md)
- [DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md](DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md)
- [DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md](DIRECT_ITERATIVE_IMPLEMENTATION_REPAIR_LOOP_SPEC.md)
- [DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md](DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md](DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md)
- [DIRECT_THREAD_WORKBENCH_UI_AND_IPC_SPEC.md](DIRECT_THREAD_WORKBENCH_UI_AND_IPC_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

## 1. Purpose

PRs 1 through 4 proved and hardened the Direct implementation lane in headless form:

```text
real provider can request read/patch/command
local authority modules decide what is lawful
recovery classifies interrupted side effects without replay
bounded repair loops sequence one obligation at a time
workspace mutation truth says what changed and what provider saw
```

This bundle makes those same flows usable and inspectable in the left Codex lane UI.

The product goal is not to add authority. The product goal is to remove guessing:

```text
which runtime tier is active?
why is implementation-lane enabled or blocked?
which approval card is current?
what local action already happened?
did the provider see the result?
did the workspace change?
what policy/cap/evidence gate decided this?
what can the user safely do next?
```

Passing this bundle should mean:

```text
A user can run the same scoped Direct implementation-lane read/patch/command
flows from the app that already passed headless, while the UI truthfully shows
runtime tier, blockers, approval cards, operation history, witness evidence,
degraded states, and read-only policy snapshots.
```

It should not mean:

```text
direct is production
new local authority is added
auto-approval exists
approval cards are authority
general shell/network/browser/MCP tools are enabled
settings UI can edit policy
manual resume or revert is implemented
right-pane ChatGPT is controlled
app-server can be removed
```

## 2. Core Invariants

```text
UI visibility != local authority
approval card != permission to execute
enabled-looking control != bypass of main-process revalidation
runtime selection != turn authority
operation history != raw payload archive
witness chip != capability promotion
policy view != policy editor
degraded next-action copy != manual resume authority
right-pane ChatGPT handoff != direct memory
```

Additional rules:

- The renderer is presentation only. Main-process controllers remain the authority for runtime selection, approval/decline/cancel, local tool execution, continuation, recovery, and rollback.
- Every user action submitted from the renderer carries stable IDs/tokens and is revalidated against durable artifacts immediately before execution.
- Renderer state must be rebuildable from durable direct artifacts, recovery reports, operation ledger projections, and runtime status. Browser DOM state is never recovery authority.
- Direct text-only behavior remains unchanged: provider tool calls are terminally blocked, no approval cards appear, and implementation-lane status does not weaken text-only gates.
- App-server remains the baseline runtime tier and rollback target outside active Direct turns.
- Right-pane ChatGPT surfaces and handoff queues remain separate; this PR may show boundary status but must not mutate those surfaces.

## 3. Scope

In scope:

- Direct runtime tier selector/status matching headless gates.
- Implementation-lane readiness summary.
- Unified approval cards for `read_file`, `apply_patch`, and `run_command`.
- Stable renderer status rows for read/patch/command results, continuations, recovery, and workspace mutation truth.
- Paged operation history panel backed by operation ledger projections.
- Runtime witness chips for model/account/auth/evidence/tier/recovery/workspace/policy status.
- Project policy read-only view for command/path/cap/network-risk policy snapshots.
- Degraded-state and next-action copy for local side effects, continuation ambiguity, scan gaps, and recovery states.
- Raw-exposure scanning for all new renderer/report/history payloads.
- UI/headless parity fixtures that prove renderer controls do not call app-server, right-pane ChatGPT, handoff mutation, or provider transport outside the lawful controller path.

Out of scope:

- New provider tools or local tool authority.
- Parallel tools or auto-approval.
- Patch delete or user-facing revert execution.
- Manual resume after interruption.
- Editable policy/settings UI.
- Deep governance settings, context maintenance, memory/baton UI, sub-agent UI, or semantic broker UI.
- Production `direct` defaulting.

## 4. Preconditions

PR 5 assumes these prior stages are merged and green:

```text
PR 1 real-provider implementation-lane proof
PR 2 recovery and replay safety
PR 3 iterative implementation repair loop
PR 4 workspace mutation truth and policy substrate
Direct text-only first turn and recent-dialogue regressions
```

Implementation-lane UI controls are visible only when runtime status can explain their state. If a precondition is missing, stale, expired, diagnostic-only, or scope-mismatched, the UI shows a blocker instead of a control that appears usable.

## 4.1 UI Projection Safety Law

Every renderer-safe UI projection has generation and source truth:

```ts
type DirectUiProjectionMeta = {
  projectId: string;
  generatedAt: string;
  uiProjectionGeneration: number;
  sourceDigest: string;
  operationLedgerHeadDigest: string;
  runtimeStatusDigest: string;
  recoveryReportDigest?: string;
  workspaceEffectDigest?: string;
  schemaVersion: string;
};
```

Use this metadata on:

```text
runtime status
witness chip set
approval cards
tool status rows
operation history pages
policy read-only view
degraded-state panel
```

Renderer actions submit the generation and digest they saw. Main rejects stale UI actions with stable blocker codes:

```ts
type DirectUiStaleBlocker =
  | "ui_projection_stale"
  | "operation_ledger_changed"
  | "runtime_status_changed"
  | "recovery_state_changed"
  | "workspace_effect_state_changed"
  | "obligation_digest_changed"
  | "policy_snapshot_changed"
  | "evidence_expired"
  | "active_turn_state_changed";
```

Stale action rejection behavior:

```text
mark card stale
refresh runtime status
refresh active operation-history page
show stable blocker code
do not retry automatically
do not execute local action
```

Projection build order:

```text
main builds projection
validates renderer-safe schema
raw-exposure scans projection
sends IPC response
```

If validation or scan fails, main returns a minimal safe projection failure object. The renderer must not receive the invalid projection for partial display.

## 5. UX Surface Topology

PR 5 adds or completes these left-lane surfaces:

```text
runtime tier selector
runtime witness chips
implementation-lane readiness panel
approval card lane item
tool result/status lane item
workspace mutation/status lane item
operation history drawer/panel
project policy read-only panel
degraded next-action status
```

The app should keep the operational-tool feel of the existing shell:

- dense, scan-friendly rows;
- compact chips for state;
- icon buttons for actions where possible;
- no explanatory marketing text;
- no nested cards;
- stable dimensions for cards and status rows so streaming/reload updates do not shift layout unexpectedly.

## 6. Runtime Status Model

Add a renderer-safe status projection:

```ts
type DirectImplementationLaneUiStatus = {
  schema: "direct_implementation_lane_ui_status@1";
  meta: DirectUiProjectionMeta;
  projectId: string;
  generatedAt: string;
  source: "runtime-status-resolver";

  activeRuntimeTier:
    | "app-server"
    | "direct-text-only"
    | "direct-implementation-lane"
    | "unknown";

  appServer: DirectUiTierStatus;
  textOnly: DirectUiTierStatus;
  implementationLane: DirectImplementationLaneReadiness;

  currentSession?: DirectUiSessionStatus;
  activeTurn?: DirectUiTurnStatus;
  activeObligation?: DirectUiObligationStatus;
  recovery?: DirectUiRecoveryStatus;
  policy?: DirectUiPolicyStatus;
  witnesses: DirectRuntimeWitnessChip[];

  blockers: DirectUiBlocker[];
  warnings: DirectUiWarning[];

  rendererSafe: true;
  rawProviderPayloadIncluded: false;
  rawLocalPathIncluded: false;
  rawToolOutputIncluded: false;
};
```

Tier status:

```ts
type DirectUiTierStatus = {
  tier: "app-server" | "direct-text-only" | "direct-implementation-lane";
  available: boolean;
  selected: boolean;
  selectable: boolean;
  canStartTurn: boolean;
  canRollbackToAppServer: boolean;
  readiness:
    | "ready"
    | "degraded"
    | "blocked"
    | "diagnostic-only"
    | "unknown";
  blockerCodes: string[];
  warningCodes: string[];
  evidenceSummary: DirectUiEvidenceSummary;
};
```

Implementation-lane readiness:

```ts
type DirectReadinessFacet = {
  state: "ready" | "degraded" | "blocked" | "unknown" | "diagnostic-only";
  canUse: boolean;
  blockerCodes: string[];
  warningCodes: string[];
  evidenceKeys: string[];
};

type DirectImplementationLaneReadiness = DirectUiTierStatus & {
  canStartFirstTurn: boolean;
  canStartFollowupTurn: boolean;
  canApproveReadFile: boolean;
  canApprovePatchApply: boolean;
  canApproveRunCommand: boolean;
  canSendContinuation: boolean;
  canRunRepairLoop: boolean;
  canShowApprovalCards: boolean;
  canShowOperationHistory: boolean;
  canShowPolicySnapshot: boolean;
  degradedToReadOnly: boolean;
  activeRecoveryState?: string;
  activeRepairLoopState?: string;
  activeWorkspaceEffectState?: string;
  facets: {
    canStartTurn: DirectReadinessFacet;
    canShowApprovalCards: DirectReadinessFacet;
    canApproveRead: DirectReadinessFacet;
    canApprovePatch: DirectReadinessFacet;
    canApproveCommand: DirectReadinessFacet;
    canContinueAfterResult: DirectReadinessFacet;
    canRecoverSafely: DirectReadinessFacet;
    workspaceMutationTruth: DirectReadinessFacet;
    policyUsable: DirectReadinessFacet;
  };
};
```

Rules:

- `selectable=true` never means the next turn can start without turn-time gate revalidation.
- `canShowApprovalCards=true` means the renderer may display cards if durable obligations exist; approval still goes through action-token revalidation.
- `degradedToReadOnly=true` means read-only implementation actions may remain visible only if the exact read gates pass and no active side-effect recovery blocks them.
- Grouped readiness facets are the source for UI rows. A single ready/blocked flag is not enough because read, patch, command, continuation, recovery, workspace-effect truth, and policy can degrade independently.
- If `degradedToReadOnly=true`, read approval cards may display only if exact read gates are fresh; patch and command cards display as blocked, repair-loop patch/command transitions are blocked, operation history remains readable, and text-only tier remains independent.
- Status rows use stable renderer-safe blocker codes, not raw exceptions.

## 7. Runtime Tier Selector

The tier selector shows:

```text
App Server
Direct Text
Direct Implementation
```

Selector law:

- Selection is a project binding, not turn authority.
- Selection commits use the existing private rollback snapshot law.
- Rollback is disabled while any Direct turn or repair loop has a nonterminal local action, waiting approval, continuation, stream, recovery, or side-effect state.
- Old direct-experimental records without explicit tier do not become implementation-lane by UI inference.
- Diagnostic evidence cannot make a tier appear ready.

Renderer labels:

```text
App Server
Direct Text
Direct Implementation
```

Detail labels:

```text
Transport: app-server baseline
Transport: direct text-only
Transport: direct implementation-lane
Provider continuity: off for text follow-up / native previous_response_id only for approved tool continuations
Tool authority: local approval required
```

The selector must not imply that Direct implementation is production or default.

## 8. Witness Chips

Witness chips are compact, renderer-safe facts:

```ts
type DirectRuntimeWitnessChip = {
  chipId: string;
  kind:
    | "runtime-tier"
    | "model"
    | "account"
    | "auth-source"
    | "endpoint"
    | "evidence"
    | "request-shape"
    | "recovery"
    | "workspace"
    | "policy"
    | "network"
    | "quota"
    | "handoff-boundary";
  label: string;
  state: "ok" | "warning" | "blocked" | "unknown" | "diagnostic";
  summary: string;
  evidenceKey?: string;
  detailRef?: string;
  expiresAt?: string;
  freshness: "fresh" | "expiring" | "expired" | "unknown";
  handoff?: {
    rawChatGptUrlIncluded: false;
    handoffStateUsedForReadiness: false;
  };
  rawValueIncluded: false;
};
```

Chip examples:

```text
Direct implementation · ready
Model evidence · scoped
Auth · codex-cli-auth
Workspace · backend-contained
Network · helpers blocked, sandbox unproved
Recovery · clean
Policy · default caps
Handoff · separate
```

Rules:

- Chips are read-only evidence summaries.
- Chips do not promote capability.
- Expired/mismatched evidence chips must degrade controls through runtime status.
- Expired chips remain visible as expired or diagnostic so users can see why controls changed, but runtime status removes authority derived from them.
- Network chips must distinguish helper-command blocking from actual network sandboxing.
- Quota chips may say `unknown`; they must not imply billing-grade truth and do not block implementation-lane controls unless a provider/runtime gate explicitly requires quota evidence.
- Model/evidence/request-shape chip mismatches block only the exact capabilities they scope. For example, expired tool-continuation evidence degrades implementation-lane approve/continue facets while text-only can remain ready.
- Handoff boundary chips must not include raw ChatGPT URLs and must not contribute to Direct readiness.

## 9. Approval Cards

Approval cards are renderer-safe views over durable obligations:

```ts
type DirectApprovalCardView = {
  schema: "direct_approval_card_view@1";
  meta: DirectUiProjectionMeta;
  cardId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  repairLoopId?: string;
  stepId?: string;
  stepOrdinal?: number;
  obligationId: string;

  tool: "read_file" | "apply_patch" | "run_command";
  status:
    | "collecting_arguments"
    | "waiting_for_approval"
    | "approved"
    | "declined"
    | "canceled"
    | "local_action_running"
    | "result_recorded"
    | "continuation_ready"
    | "continuation_sent"
    | "terminal";

  title: string;
  summaryRows: DirectApprovalSummaryRow[];
  riskRows: DirectApprovalRiskRow[];
  preview: DirectApprovalPreview;
  previewCompleteness: DirectCardPreviewCompleteness;
  actions: DirectApprovalActionView[];
  actionState: DirectApprovalCardActionState;
  actionToken: DirectApprovalCardTokenState;
  provenance: DirectApprovalCardProvenance;

  actionTokenIds: {
    approve?: string;
    decline?: string;
    cancel?: string;
  };

  obligationDigest: string;
  operationLedgerHeadDigest: string;
  expiresAt: string;

  rendererSafe: true;
  rawArgumentsIncluded: false;
  rawPatchIncluded: false;
  rawCommandOutputIncluded: false;
  rawLocalPathIncluded: false;
};
```

Action state:

```ts
type DirectApprovalCardActionState = {
  displayState:
    | "displayable"
    | "displayable_disabled"
    | "hidden";
  actionState:
    | "no_action"
    | "action_token_available"
    | "action_token_expired"
    | "requires_refresh"
    | "blocked_by_recovery"
    | "blocked_by_policy"
    | "blocked_by_runtime_tier";
  authoritative: false;
};

type DirectApprovalCardTokenState = {
  tokenId?: string;
  expiresAt?: string;
  actionKinds: Array<"approve" | "decline" | "cancel">;
  tokenState:
    | "valid"
    | "expired"
    | "missing"
    | "revoked"
    | "requires_refresh";
};

type DirectApprovalCardProvenance = {
  providerCallId: string;
  providerCallType: "function_call" | "custom_tool_call";
  providerResponseIdEvidenceKey: string;
  providerCallShapeHash: string;
  argumentShapeHash: string;
  parentTurnDigest: string;
  patchPlanId?: string;
  commandPlanId?: string;
  dryRunId?: string;
  packageScriptEvidenceId?: string;
};

type DirectCardPreviewCompleteness =
  | "complete"
  | "bounded_complete"
  | "truncated_reviewable"
  | "truncated_unreviewable"
  | "redacted_blocked"
  | "unavailable";
```

Approval card rules:

- A card appears only after provider arguments are complete, parseable, supported, and main has created a durable obligation.
- `tool_call_started` / argument deltas may show a passive collecting state with no action buttons.
- Renderer buttons submit `clientToolDecisionId + actionTokenId + expected card/obligation digest + uiProjectionGeneration + sourceDigest`.
- Main revalidates project, session, turn, repair loop, step ordinal, runtime tier, obligation state, action token, ledger head, policy snapshot, and recovery state.
- A stale card click returns a stable blocker and never executes local action.
- A terminal obligation remains visible as history/status, not as an actionable card.
- `displayState=displayable` never implies execution is allowed. Only main-process action-token revalidation can authorize local action.
- Expired action tokens show a refresh affordance that reloads the card projection. The renderer must not silently execute against expired token state.
- Approval is allowed only if `previewCompleteness` is `complete` or `bounded_complete`, or a future tool-specific safe full-review artifact exists and is explicitly acknowledged. For PR 5, patch `truncated_reviewable` remains disabled unless the safe full-review path already exists.

### Read Card

Read card rows:

```text
Path: safe project-relative display path
Policy: allowed / blocked
Size cap: bytes/chars
Result visibility: provider receives bounded redacted envelope after approval
```

No card appears for sensitive-path denial or malformed path. Those render as terminal unsupported/status items.

### Patch Card

Patch card rows:

```text
Files planned
Added/removed line counts
Path policy classes
Dry-run status
Preview completeness
Journal mode
```

Rules:

- Truncated/unreviewable patch previews block approval unless a safe full-review path exists.
- Patch delete remains deferred.
- Generated/vendor/lockfile/app-private/sensitive target policy is shown before action.
- The preview never includes raw patch content beyond the approved renderer preview cap.

### Command Card

Command card rows:

```text
Package script
Script body preview
cwd
timeout
output caps
workspace write risk
network truth
process cleanup capability
workspace-effect scan capability
```

Rules:

- The card must say project code may write files unless backend policy proves otherwise.
- Network helper blocking is not network sandboxing.
- Provider/auth env must never be shown or passed to command children.
- Unsupported command classes render as blockers, not approval cards.

## 10. Stable Transcript Items

Implementation-lane turns render as one turn with item-level state:

```text
provider tool request item
approval card item
local running/status item
result/effect status item
continuation assistant item
terminal turn item
```

Item identity:

```ts
type DirectImplementationLaneTranscriptItemId = {
  sessionId: string;
  turnId: string;
  repairLoopId?: string;
  stepId?: string;
  obligationId?: string;
  itemKind:
    | "tool-request"
    | "approval-card"
    | "local-status"
    | "tool-result"
    | "workspace-effect"
    | "continuation-assistant"
    | "terminal";
};
```

The renderer may update an item's status but must not replace the whole turn with unrelated blobs. Reload must reconstruct the same item IDs from durable artifacts.

## 11. Operation History

PR 5 adds a user-facing operation history panel for Direct implementation-lane events.

Source of truth:

```text
operation ledger
session/turn artifacts
tool obligation artifacts
recovery report artifacts
workspace effect summaries
runtime status snapshots
```

Renderer projection:

```ts
type DirectOperationHistoryProjection = {
  schema: "direct_operation_history_projection@1";
  meta: DirectUiProjectionMeta;
  projectId: string;
  projectionId: string;
  selectedHistoryScope: DirectOperationHistoryScope;
  sourceLedgerHeadDigest: string;
  builtAt: string;
  page: {
    cursor?: string;
    limit: number;
    nextCursor?: string;
  };
  entries: DirectOperationHistoryEntry[];
  rendererSafe: true;
  rawPayloadIncluded: false;
};
```

Paging contract:

```ts
type DirectOperationHistoryScope =
  | "active-turn"
  | "current-session"
  | "project"
  | "selected-artifact";

type DirectOperationHistoryPageRequest = {
  projectId: string;
  sessionId?: string;
  turnId?: string;
  cursor?: string;
  limit: number;
  familyFilter?: string[];
  sinceLedgerSeq?: number;
};

type DirectOperationHistoryPage = {
  rows: DirectOperationHistoryEntry[];
  nextCursor?: string;
  hasMore: boolean;
  sourceLedgerHeadDigest: string;
  pageDigest: string;
  stalePageWarning?: "operation_ledger_changed" | "cursor_expired";
};
```

Entry shape:

```ts
type DirectOperationHistoryEntry = {
  entryId: string;
  occurredAt: string;
  family:
    | "runtime-tier"
    | "direct-turn"
    | "tool-obligation"
    | "read-file"
    | "apply-patch"
    | "run-command"
    | "repair-loop"
    | "workspace-effect"
    | "recovery"
    | "handoff-boundary";
  eventType: string;
  severity: "info" | "warning" | "blocked" | "error";
  title: string;
  summary: string;
  projectId: string;
  sessionId?: string;
  turnId?: string;
  stepId?: string;
  obligationId?: string;
  artifactRefs: Array<{
    kind: string;
    id: string;
    evidenceKey?: string;
  }>;
  evidenceKeys: string[];
  actionability: {
    actionable: false;
    allowedActions: [];
    reason: "history_is_read_only";
  };
  blockerCode?: string;
  policyDigest?: string;
  recoveryState?: string;
  workspaceEffectState?: string;
  providerHandoffState?: string;
  rawLocalPathIncluded: false;
  rawProviderPayloadIncluded: false;
  rawToolOutputIncluded: false;
  rawPatchIncluded: false;
};
```

Rules:

- Operation history entries cite artifact IDs/evidence keys only.
- Entries never include raw request bodies, raw provider frames, file contents, raw patch bodies, raw stdout/stderr, absolute paths, raw hashes, or token-like values.
- Operation history is paged; it must not load unbounded history into the renderer.
- History scope defaults to `active-turn`; session/project scopes must be explicit so the panel stays fast and understandable.
- Cursor pages must be stable under concurrent ledger growth. If the source ledger digest changes, the response includes a stale-page warning or requires refresh.
- Operation history is read-only in PR 5. It does not resolve recovery, retry continuations, rerun commands, revert patches, or edit policy.
- Operation history rows carry `actionability.actionable=false` and `allowedActions=[]`. The UI may link to inspect renderer-safe details but not rerun, retry, resume, revert, edit policy, or mutate handoff/right-pane state.
- Workbench operation history and implementation-lane operation history should share projection conventions where possible, but PR 5 should not pull in PR 6 thread workbench scope.

## 12. Degraded States And Next Actions

The UI must distinguish clean terminal states from local side-effect ambiguity.

Renderer-safe degraded status:

```ts
type DirectUiDegradedState =
  | "none"
  | "waiting_for_user"
  | "recovery_required"
  | "provider_handoff_unknown"
  | "stream_interrupted"
  | "patch_applied_assistant_not_finalized"
  | "command_ran_assistant_not_finalized"
  | "workspace_changed_summary_only"
  | "workspace_effect_scan_missing"
  | "workspace_effect_scan_failed"
  | "workspace_policy_blocked"
  | "raw_exposure_blocked"
  | "manual_recovery_required"
  | "corrupt_untrusted";
```

Workspace visibility row:

```ts
type DirectWorkspaceVisibilityUiState = {
  changedPathCount: number;
  providerVisibility:
    | "not_seen"
    | "summary_only"
    | "partial_content"
    | "all_policy_relevant_content"
    | "unknown";
  visibleMessageCode:
    | "workspace_changed_provider_saw_summary_only"
    | "workspace_changed_provider_saw_partial_content"
    | "workspace_changed_provider_visibility_unknown";
};
```

Next-action availability:

```ts
type DirectUiNextAction = {
  action:
    | "approve"
    | "decline"
    | "cancel"
    | "inspect_history"
    | "inspect_policy"
    | "start_new_session"
    | "switch_to_app_server"
    | "none";
  enabled: boolean;
  reasonCode: string;
  requiresFutureSpec?:
    | "manual_resume"
    | "revert"
    | "policy_edit"
    | "sub_agent_ui"
    | "context_maintenance";
};
```

Copy rules:

- If a patch applied but continuation failed/unknown:

```text
Patch was applied locally.
Assistant continuation did not complete.
messageCode: patch_applied_provider_unknown
```

- If a command ran but continuation failed/unknown:

```text
Command ran locally.
Assistant continuation did not complete.
messageCode: command_ran_provider_unknown
```

- If workspace changed and provider saw only summary:

```text
Workspace changed.
Provider saw a bounded summary, not changed file contents.
messageCode: workspace_changed_provider_saw_summary_only
```

- If a read result was recorded but provider continuation is unknown:

```text
Read result was recorded locally.
Assistant continuation did not complete.
messageCode: read_result_recorded_provider_unknown
```

- If a command ran and workspace changed:

```text
Command ran locally.
Workspace changed.
Provider saw summary only.
```

- If command effect scan failed:

```text
Command ran locally.
Workspace-effect scan failed.
Do not assume workspace is clean.
```

- If manual resume or revert is not implemented, the UI must say so plainly and not show an enabled resume/revert action.
- Workspace visibility is a first-class active-turn/tool status row, not only an operation-history entry or witness chip.

## 13. Project Policy Read-Only View

PR 5 adds a read-only policy view, not an editor:

```ts
type DirectProjectPolicyReadOnlyView = {
  schema: "direct_project_policy_readonly_view@1";
  meta: DirectUiProjectionMeta;
  projectId: string;
  generatedAt: string;
  editable: false;
  source: "policy-snapshot";
  effectiveSource:
    | "default"
    | "project"
    | "workspace-profile"
    | "runtime-profile"
    | "merged";
  policySnapshotDigest: string;

  runtimeTierPolicy: {
    appServerAvailable: boolean;
    directTextAvailable: boolean;
    directImplementationAvailable: boolean;
  };

  commandPolicy: {
    allowedCommandClasses: string[];
    unsupportedCommandClasses: string[];
    timeoutCaps: Record<string, number>;
    outputCaps: Record<string, number>;
    networkHelperCommandsBlocked: boolean;
    networkSandboxProven: boolean;
  };

  pathPolicy: {
    sensitivePathPolicyDigest: string;
    generatedVendorLockfilePolicyDigest: string;
    pathClassCounts?: Record<string, number>;
  };

  capPolicy: {
    readCaps: Record<string, number>;
    patchCaps: Record<string, number>;
    commandCaps: Record<string, number>;
    repairLoopCaps: Record<string, number>;
  };

  evidencePolicy: {
    diagnosticDoesNotPromote: true;
    exactScopeRequired: true;
    expiryDowngradesControls: true;
  };

  rendererSafe: true;
  privateConfigIncluded: false;
  rawPrivateRootsIncluded: false;
  rawPolicyFileIncluded: false;
};
```

Rules:

- Show policy versions, digests, caps, and stable blocker names.
- Do not expose raw private roots, app-private paths, auth material, or raw config files.
- Do not allow editing. The view is visually a snapshot, not a disabled editor that looks editable. Policy editing is a later spec.
- Show the effective policy source without exposing raw config: default, project, workspace profile, runtime profile, or merged.
- If policy source is missing/corrupt, degrade controls and show a stable blocker.

## 14. IPC And Main-Process Revalidation

Renderer IPC additions should be narrow and read-mostly:

```text
direct-ui:get-implementation-status
direct-ui:list-operation-history
direct-ui:get-policy-readonly-view
direct-ui:get-approval-card
direct-ui:submit-tool-decision
direct-ui:refresh-runtime-status
```

Rules:

- `get-*` methods return renderer-safe projections only.
- Main validates the renderer-safe schema and raw-exposure scan before returning any IPC projection.
- Invalid projections return minimal safe failure objects.
- `submit-tool-decision` delegates to existing main-process authority controllers.
- Main revalidates action token, expected digest, ledger head, runtime tier, recovery state, policy snapshot, and exact obligation state.
- IPC returns stable blocker codes. It must not surface stack traces or raw SQLite/internal exceptions.
- IPC must not provide raw artifacts by ID unless a separate app-private diagnostic path exists and is explicitly requested outside renderer surfaces.

## 15. Composer And Turn Routing

Composer law:

- The user cannot submit another message in the same Direct session while a tool/repair-loop step is nonterminal.
- Controller routing, not just renderer disabling, rejects same-session prompt submit with `active_implementation_lane_turn_exists`.
- Fresh new turn after empty/incomplete/content-filter/max-output/stream-interrupted/handoff-unknown remains disabled unless recovery/status policy explicitly allows a safe terminal state.
- Switching to app-server is blocked during active Direct side-effect states.
- Direct text-only composer remains available only under text-only gates and never shows implementation approval cards.

## 16. Right-Pane And Handoff Boundary

PR 5 may show boundary status:

```text
Right-pane ChatGPT: separate
Handoff queue: unchanged
```

PR 5 must not:

- import right-pane ChatGPT transcript as Direct memory;
- mutate right-pane ChatGPT messages;
- enqueue, edit, or delete handoff items;
- use handoff state to prove Direct readiness.

Sentinel tests cover runtime selection, status refresh, approval rendering, decision submit, operation history reads, policy reads, recovery rendering, and transcript rendering.

## 17. Raw-Exposure Policy

Scan all new renderer/report/history surfaces:

```text
runtime status payloads
witness chips
approval cards
tool status rows
operation history projections
policy read-only view
degraded-state messages
headless UI parity reports
console summaries
Markdown summaries
serialized renderer state snapshots
DOM attributes
localStorage
sessionStorage
IndexedDB if used
```

Forbidden:

```text
raw provider request/response frames
raw tool arguments beyond approved preview
raw patch body beyond approved preview
raw stdout/stderr beyond approved preview
file contents
absolute host/WSL paths
raw private roots
raw auth tokens
raw SQLite/internal exception text
unscoped raw digests exposed to renderer/provider
ChatGPT thread URLs
```

If scan fails, write a minimal safe failure report and block the affected projection.

## 18. Headless/UI Regression

Add a fixture-backed UI parity runner, for example:

```text
npm run direct:ui-operation-history
```

It should build fixture renderer projections without starting live provider calls.

Required cases:

```text
runtime status app-server selected
runtime status direct text selected
runtime status implementation-lane ready
implementation-lane blocked by missing evidence
implementation-lane degraded by recovery state
read approval card render and stale-token blocked
patch approval card render and truncated-preview blocked
command approval card render with network truth warning
workspace changed summary-only state
patch applied continuation unknown state
command ran continuation unknown state
operation history paging
operation history raw-exposure scan
policy read-only view
text-only provider tool call shows no approval card
right-pane/handoff mutation sentinel
app-server spawn sentinel for direct UI refresh
```

Report shape:

```ts
type DirectImplementationLaneUiReport = {
  schema: "direct_implementation_lane_ui_report@1";
  runId: string;
  createdAt: string;
  coverageSource: "fixture_ui";
  matrixRowsExercised: Array<"F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "C7" | "I13" | "J1" | "J2" | "J3" | "J4" | "J5" | "J6" | "J7" | "J8">;
  matrixPromotionCandidate: false;
  cases: DirectImplementationLaneUiReportCase[];
  sentinelCounters: {
    providerTransportCalls: number;
    appServerSpawnCalls: number;
    workspaceReadCalls: number;
    patchApplyCalls: number;
    commandRunCalls: number;
    rightPaneMutationCalls: number;
    handoffMutationCalls: number;
    unauthorizedToolActionCalls: number;
  };
  rawExposureScan: {
    scanned: boolean;
    status: "passed" | "failed";
    findingCount: number;
  };
};
```

Fixture UI coverage does not promote rows to real-provider proof. It proves renderer/control-plane parity for already-proven authority paths.

## 19. Implementation Order

### Phase -2 - UI Projection Safety Law

- Add `uiProjectionGeneration`, `sourceDigest`, ledger/status digests, and schema version to every UI projection.
- Define stale blocker codes.
- Validate renderer-safe schemas before IPC.
- Raw-exposure scan projections before IPC.
- Define `fixture_ui` no-promotion report shape.

### Phase -1 - UI Law And Projection Schemas

- Define runtime UI status schema.
- Define witness chip schema.
- Define approval card view schema.
- Define operation history projection schema.
- Define policy read-only view schema.
- Define renderer-safe blocker and warning codes.
- Define grouped readiness facets.
- Define approval display/action/token state.
- Define preview completeness.
- Define operation history `actionability=false`.
- Define policy view `editable=false`.

### Phase 0 - Runtime Status Adapter

- Extend direct runtime status to include implementation-lane readiness.
- Add exact blocker aggregation from evidence, recovery, repair loop, workspace mutation, and policy state.
- Add capability downgrade on expired/mismatched evidence.
- Add witness chip freshness behavior.
- Add quota unknown behavior.
- Add exact model/evidence mismatch behavior.
- Add degraded-to-read-only behavior.
- Add handoff boundary chip invariants.
- Add text-only regression status.

### Phase 1 - Approval Card Projection

- Build read/patch/command card projections from durable obligations.
- Show collecting arguments without buttons.
- Rebuild cards after reload using durable artifacts.
- Submit decisions through existing authority controllers.
- Add stale-card and conflict blockers.
- Add action-token state and expiry behavior.
- Add card provenance and preview completeness.
- Add stale action rejection to projection refresh.

### Phase 2 - Operation History Projection

- Build paged renderer-safe operation history from ledger/artifacts.
- Add families for runtime tier, turn, obligation, read, patch, command, repair loop, workspace effect, recovery, and handoff boundary.
- Add history scopes, cursor paging, source ledger digest, and page digest.
- Add `actionability=false` to every history row.
- Add raw-exposure scan and minimal failure report.

### Phase 3 - Witness Chips And Policy View

- Render model/account/auth/evidence/tier/recovery/workspace/policy/network chips.
- Add read-only policy view.
- Add effective policy source.
- Show network helper blocking vs sandbox truth.
- Show quota unknown warning without overblocking.
- Show caps and policy digests without private roots.

### Phase 4 - Degraded-State UI

- Map recovery and workspace effect states to concise renderer messages.
- Disable unsafe next actions.
- Show local-side-effect truth when assistant continuation is incomplete/unknown.
- Add explicit read-result-recorded, patch-applied, command-ran, workspace-summary-only, and scan-failed message classes.
- Keep manual resume/revert marked as not implemented.

### Phase 5 - UI/Headless Smokes

- Add `direct:ui-operation-history`.
- Add fixture projection cases.
- Add no app-server/right-pane/handoff/provider sentinel coverage.
- Add no workspace read/patch/command sentinel coverage for projection reads.
- Add stale action rejection refresh fixture.
- Add raw-exposure scans.
- Add renderer storage and DOM attribute raw-exposure scans.
- Keep direct text-only tool-call regression green.

## 20. Acceptance Criteria

- Every UI projection includes `uiProjectionGeneration`, `sourceDigest`, `operationLedgerHeadDigest`, `runtimeStatusDigest`, and `schemaVersion`.
- Renderer actions include the generation/digest they saw; stale generation/digest returns stable blocker codes.
- Runtime tier selector shows app-server, Direct text-only, and Direct implementation-lane without implying Direct is production/default.
- Runtime selection remains separate from turn authority and is revalidated at turn/action time.
- Implementation-lane readiness includes grouped facets for canStartTurn, canShowApprovalCards, canApproveRead, canApprovePatch, canApproveCommand, canContinueAfterResult, canRecoverSafely, workspaceMutationTruth, and policyUsable.
- Approval cards appear only after complete supported arguments and durable obligations.
- Approval card data separates display state from action state; displayable cards do not imply executable action.
- Approval cards include action token state, expiry, and allowed action kinds.
- Approval cards include provider-call provenance and tool-specific plan/dry-run/package-script evidence IDs where relevant.
- All cards expose preview completeness.
- Approval actions submit action tokens and expected digests; main revalidates before executing.
- Stale approval cards cannot execute local actions.
- Stale action rejection marks the card stale, refreshes projections, and never retries execution.
- Read, patch, and command cards expose only renderer-safe previews.
- Patch truncated/unreviewable previews block approval unless a safe full-review path exists.
- Command cards show workspace-write and network-sandbox truth accurately.
- Composer submit is blocked by controller while implementation-lane turns are nonterminal.
- Operation history is cursor-paged, renderer-safe, scoped by active-turn/session/project, and cites artifact IDs/evidence keys only.
- Operation history pages include source ledger head digest and page digest.
- Operation history rows include `actionability.actionable=false` and `allowedActions=[]`.
- Operation history cannot retry, resume, rerun, revert, edit policy, or mutate handoff/right-pane state.
- Witness chips are read-only evidence summaries, expose freshness, and cannot promote capability.
- Expired/mismatched evidence chips degrade runtime status but remain explainable.
- Quota unknown does not block Direct implementation lane unless an exact provider/runtime gate requires quota evidence.
- Handoff boundary chip includes no raw ChatGPT URLs and cannot contribute to Direct readiness.
- Project policy view is `editable=false`, shows effective source, and does not expose private roots/raw config.
- Degraded states distinguish read result recorded, patch applied, command ran, provider unknown, and workspace changed summary-only.
- Workspace visibility state is a first-class active-turn UI row, not only operation history.
- `degradedToReadOnly` has exact behavior: read cards only if read gates pass; patch/command blocked; history readable.
- Manual resume and revert are clearly marked not implemented.
- Direct text-only provider tool-call fixture shows no approval card and terminally blocks tools.
- Main validates renderer-safe projection schema before IPC; invalid projections return minimal safe failure objects.
- Raw-exposure scan covers runtime status, witness chips, cards, operation history, policy view, degraded messages, renderer state, DOM attributes, localStorage/sessionStorage, JSON reports, Markdown reports, and console summaries.
- UI refresh/status/history/card reads do not spawn app-server, provider transport, workspace reads, patch apply, or command run.
- UI actions do not mutate right-pane ChatGPT or handoff queue.
- `direct:ui-operation-history` fixture report is schema-validated before write, after write, and after raw-exposure scan.
- UI parity report records `coverageSource=fixture_ui` and `matrixPromotionCandidate=false`.

## 21. Product Boundary

Good:

```text
left Codex lane only
UI parity for already-proven implementation-lane authority
read/patch/command cards
operation history
witness chips
policy read-only view
degraded state truth
no app-server fallback inside direct turns
no right-pane/handoff mutation
```

Not included:

```text
new tools
auto-approval
parallel tools
general shell/network/browser/MCP
patch delete/revert
manual resume
editable policy UI
context maintenance/memory/baton
governance/semantic broker
sub-agent observability
production direct
```

## 22. Final Recommendation

Adopt this as the next direct-branch PR after workspace mutation truth.

The branch has enough headless authority proof. The next risk is user-facing ambiguity. This PR should make the app show the same law the headless harness already enforces:

```text
local authority is explicit
state is inspectable
history is durable
policy is visible
degraded states are honest
the UI cannot bypass the controller
```
