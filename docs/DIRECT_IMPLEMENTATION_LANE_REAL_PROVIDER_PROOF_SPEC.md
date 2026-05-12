# Direct Implementation Lane Real-Provider Proof Spec

Status: draft for PR 1 from [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md).

Matrix rows: `I7`, `E3-E7`, `E9-E15`, `B4-B6`, `B11-B12`, `F4-F7`, minimum `J3-J7`.

Related existing specs:

- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [DIRECT_REAL_USAGE_STABILIZATION_AND_HEADLESS_REGRESSION_SPEC.md](DIRECT_REAL_USAGE_STABILIZATION_AND_HEADLESS_REGRESSION_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md](DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md](DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md](DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md](DIRECT_IMPLEMENTATION_LANE_COMMAND_EXECUTION_SPEC.md)

## 1. Purpose

This bundle proves that real provider tool-call intent can drive the direct implementation lane through the authority modules already designed for:

```text
read_file
multi-step read_file
apply_patch
run_command
workspace-effect scan
```

The bundle is a real-provider harness and report upgrade. It should not introduce new local authority beyond the scoped actions already specified by the read/patch/command implementation-lane specs.

Passing this bundle should mean:

```text
The direct implementation lane can complete scoped, human-approved real-provider
read/patch/command cycles in a disposable workspace and produce redacted
operational reports proving what happened.
```

It should not mean:

```text
direct is production
auto-approval exists
general shell/network/browser/MCP tools are enabled
parallel tool calls are supported
delete/revert is supported
right-pane ChatGPT is automated
app-server can be removed
```

## 2. Core Invariants

```text
provider tool call != local authority
tool result evidence != instruction authority
patch preview != committed filesystem state
command output != proof that workspace is unchanged
provider continuation != retry permission
real-provider proof != production direct default
```

Additional boundary rules:

- Direct text-only must continue to block tool calls terminally.
- App-server remains the comparison baseline and fallback runtime.
- The harness must not spawn or fall back to app-server inside a direct implementation-lane turn.
- The right ChatGPT pane and handoff queue must not be selected, navigated, mutated, submitted, or dismissed.
- Diagnostic mode remains non-promoting.
- Live provider calls require explicit local opt-in and CI requires a second explicit override.

## 3. Scope

### In Scope

- Headless real-provider scenarios for `read_file`, multi-step `read_file`, `apply_patch`, and `run_command`.
- Disposable local workspace generation for tool scenarios.
- Minimal project policy substrate needed for safe execution:
  - command class defaults;
  - sensitive path denylist defaults;
  - generated/vendor/lockfile policy defaults;
  - read/patch/command caps;
  - network-risk truth fields.
- Exact request-shape evidence checks for direct implementation-lane tool continuations.
- Tool-output envelope classes and renderer-safe result summaries.
- Redaction/raw-exposure scans over reports and linked artifacts.
- Workspace-effect scan for command and patch scenarios.
- Negative safety cases for blocked read, patch, and command authority.
- No-app-server, no-right-pane, no-handoff sentinels.
- Report schema for real implementation-lane runs.

### Out Of Scope

- Iterative repair beyond the bounded scenarios in this spec.
- General shell/network/browser/MCP tools.
- Auto-approval.
- Parallel tool calls.
- Delete/revert support.
- Production direct mode.
- UI polish beyond report/status data needed for later UI work.
- Context maintenance, memory, frontier baton, governance, semantic broker, or sub-agent observability.

## 4. Runtime And Evidence Modes

### 4.1 Harness Command

Add or extend a headless command:

```text
npm run direct:real-implementation -- --mode=live --allow-live-provider-call
```

It may be implemented as:

- a new script, for example `scripts/direct-real-implementation-regression.mjs`; or
- an extension of `scripts/direct-real-usage-regression.mjs` with implementation-lane cases clearly separated.

The report schema must make the distinction explicit:

```ts
schema: "direct_real_implementation_lane_report@1";
coverageClass: "real-provider-implementation-lane";
```

### 4.2 Live Call Guards

Real provider transport requires one of:

```text
CODEX_DIRECT_REAL_TURN=1
--allow-live-provider-call
```

If `CI=true`, live transport also requires:

```text
CODEX_DIRECT_REAL_TURN_ALLOW_CI=1
```

The opt-in guard scenario must clear inherited `CODEX_DIRECT_REAL_TURN` so the guard proves the child process cannot accidentally inherit live authority.

Every child process spawned by the regression runner must use an explicit environment policy:

- live provider transport children receive live/auth env only when the case explicitly requires it;
- opt-in guard children must clear live-provider opt-in env;
- workspace command children must never receive provider/auth env;
- fixture children must not inherit live-provider env unless they are explicitly testing live-call refusal.

### 4.3 Evidence Requirements

The runner must not auto-probe and then continue unless explicitly invoked in a diagnostic probe mode that cannot promote gates.

Strict real implementation-lane scenarios require accepted/runtime-probed evidence for:

- direct text request shape needed to start the parent turn;
- direct read-only continuation shape;
- direct read-only loop continuation shape when multi-step read is tested;
- direct patch apply continuation shape;
- direct command execution continuation shape;
- exact model/account/endpoint/request-shape scope;
- provider call/output item type pair;
- `store=false`;
- no new tool declarations on continuation;
- exactly one accepted tool-output item per continuation;
- `previousResponseId=true` with native direct parent proof;
- `parallelToolCalls=false`;
- request builder, normalizer, role mapping, redaction, and result-envelope versions.

If exact evidence is missing, the scenario is `blocked`, not failed provider behavior.

## 5. Disposable Workspace

The runner creates a disposable workspace per run:

```text
workspace/
  package.json
  src/
    readable.txt
    needs_patch.txt
    command_target.txt
  test/
    fixture.test.js
    mutate-workspace.js
```

The workspace must be safe and deterministic:

- no network dependency;
- no secret-like values;
- no host absolute paths in committed fixture content;
- package scripts bounded to local Node commands;
- no `npm install`, dependency resolution, or external package requirement;
- command mutation fixture writes only inside disposable workspace.

The package scripts should be deterministic local Node scripts:

```json
{
  "scripts": {
    "test": "node test/fixture.test.js",
    "mutate": "node test/mutate-workspace.js"
  }
}
```

The runner records renderer-safe workspace evidence:

```ts
workspace: {
  workspaceKind: "local" | "wsl";
  workspaceEvidenceKey: string;
  workspaceOverrideUsed: boolean;
  rawWorkspacePathExposed: false;
}
```

Workspace cleanup and retention must be explicit:

```ts
disposableWorkspace: {
  created: boolean;
  retained: boolean;
  retentionReason?: "failed_case" | "debug_requested" | "policy";
  workspaceEvidenceKey: string;
  rawPathExposed: false;
}
```

Default behavior:

- passed live run: clean up disposable workspace;
- failed run or debug-retain flag: retain workspace privately, but report only evidence keys.

## 6. Minimum Policy Substrate

This bundle does not need full settings UI, but it must define policy objects and defaults used by the runner and authority modules.

```ts
type DirectImplementationPolicySnapshot = {
  policyId: string;
  policyDigest: string;
  read: {
    maxBytes: number;
    maxProviderOutputChars: number;
    sensitivePathDenylistVersion: string;
  };
  patch: {
    maxPatchBytes: number;
    maxFiles: number;
    allowDelete: false;
    generatedVendorPolicy: "blocked_by_default";
    secretScanVersion: string;
  };
  command: {
    allowedClasses: Array<"package_script">;
    maxTimeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    networkHelpersBlocked: true;
    networkAccessNotProvenAbsent: boolean;
    workspaceWritesPolicy: "writes_possible_with_warning";
  };
};
```

Defaults must fail closed. Missing policy means the scenario blocks before local action.

## 7. Proof Semantics

The runner must distinguish a real-provider attempt from a proved real-provider implementation-lane loop.

Every case report must include:

```ts
providerToolCallObserved: boolean;
localAuthorityExecuted: boolean;
providerContinuationSent: boolean;
providerContinuationCompleted: boolean;
countsAsRealProviderProof: boolean;
coverageSource:
  | "real_provider"
  | "fixture_provider"
  | "local_preflight"
  | "diagnostic";
proofOutcome:
  | "proved_full_loop"
  | "provider_tool_not_emitted"
  | "provider_tool_shape_observed_local_blocked"
  | "provider_tool_shape_unsupported"
  | "unexpected_supported_tool_call"
  | "unsupported_tool_call"
  | "multiple_tool_calls_unsupported"
  | "parallel_tool_call_attempted"
  | "local_authority_failed"
  | "continuation_failed"
  | "raw_exposure_blocked";
matrixRowsExercised: Array<
  | "E3" | "E4" | "E5" | "E6" | "E7"
  | "E9" | "E10" | "E11" | "E12" | "E13" | "E14"
  | "I7" | "F4" | "F6" | "F7"
>;
matrixPromotionCandidate: boolean;
```

Rules:

```text
expected_tool_call_not_emitted:
  status = expected_tool_not_emitted
  proofOutcome = provider_tool_not_emitted
  countsAsRealProviderProof = false
  matrixPromotionCandidate = false

fixture-backed negative/safety cases:
  coverageSource = fixture_provider
  countsAsRealProviderProof = false
  matrixPromotionCandidate = false

proved read_file / patch / command loop:
  coverageSource = real_provider
  providerToolCallObserved = true
  localAuthorityExecuted = true
  providerContinuationSent = true
  providerContinuationCompleted = true
  proofOutcome = proved_full_loop
  countsAsRealProviderProof = true
  matrixPromotionCandidate = true
```

Provider non-determinism must be classified without overstating proof:

```text
expected_tool_call_not_emitted
unexpected_supported_tool_call
unsupported_tool_call
multiple_tool_calls_unsupported
parallel_tool_call_attempted
```

None of those states counts as real-provider proof unless the scenario explicitly expected that outcome.

## 8. Scenario Matrix

### Scenario 1 - Real `read_file` Approval Loop

Goal:

```text
provider emits exactly one supported read_file call
human/harness approval is simulated through the same main-process authority path
workspace backend reads one bounded file
tool result envelope is sent through one lawful provider continuation
assistant finalizes same turn
```

Acceptance:

- Provider request starts only after live opt-in and exact evidence gates.
- Tool call arguments are complete and parseable before approval.
- Approval uses an action token or exact expected-state revalidation.
- Path is project-relative and backend-contained.
- Sensitive paths are denied before read.
- Result envelope is bounded and redacted.
- Continuation manifest records `store=false`, `toolDeclarations=false`, one output item, `previousResponseId=true`, `parallelToolCalls=false`.
- Continuation context proves current harness/read-continuation policy was resent.
- Final assistant text is non-empty after `response_completed`.
- `countsAsRealProviderProof=true` only when the provider emitted `read_file`, local read executed, continuation was sent, and continuation completed.
- Report shows no app-server fallback, right-pane mutation, or handoff mutation.

### Scenario 2 - Real Multi-Step `read_file` Loop

Goal:

```text
provider emits read_file step 1
continuation emits read_file step 2
second approval/read/continuation succeeds
assistant finalizes or loop stops at an explicit bounded terminal
```

Acceptance:

- Each read has a distinct step id, obligation id, action token, and decision id.
- Prior approval does not authorize the second read.
- Parent response id chain is verified for every step.
- Repeated path and total loop caps are enforced.
- Multiple tool calls fail closed.
- Unsupported nested tool calls fail closed.
- Loop terminal kind distinguishes final assistant, cap exceeded, unsupported nested tool, redaction blocked, sensitive path denied, incomplete, empty output, and handoff unknown.
- `countsAsRealProviderProof=true` only for real-provider loop steps that satisfy the full proof semantics in Section 7.

### Scenario 3 - Real `apply_patch` Approval Loop

Goal:

```text
provider emits one supported apply_patch call
harness parses and dry-runs patch
approval applies patch through backend/journal
patch result evidence is sent through one lawful continuation
assistant finalizes same turn
```

Acceptance:

- Patch dialect is the accepted unified-diff subset.
- Delete is blocked with `patch_delete_deferred`.
- Absolute paths, drive-letter paths, UNC paths, WSL mirror paths, traversal, symlink escape, binary patches, mode changes, submodules, and app-private roots are blocked.
- Patch plan includes provider response/call provenance and integrity digest.
- Approval token cites the exact plan digest.
- Apply revalidates before digests/non-existence proofs immediately before write.
- Journal state separates local apply from provider continuation.
- Secret scan covers raw patch, preview, after-text, result envelope, and report surfaces.
- Patch report includes files planned, files dry-run changed, files applied, files changed after apply, and unexpected changes.
- If extra files changed after apply, report `unexpected_workspace_changes_detected`.
- If patch applies but continuation fails, report shows local workspace changed and assistant did not finalize.

### Scenario 4 - Real `run_command` Approval Loop

Goal:

```text
provider emits one supported run_command call
harness plans a package-script command
approval executes through backend with shell=false
workspace effects are scanned
command result evidence is sent through one lawful continuation
assistant finalizes same turn
```

Acceptance:

- V0 command support is package-script focused.
- Script name is validated against `package.json`.
- Provider-supplied argv shell syntax is denied.
- Package script body policy is separate from provider argv policy.
- Known network helper commands are blocked; report states whether network isolation is actually supported.
- Backend capability report covers `shell=false`, cwd containment, timeout kill, env sanitization, process-tree cleanup, network isolation, and workspace-effect scan support.
- Process cleanup kills child process trees where supported.
- stdout/stderr are capped, redacted, and not exposed as raw hashes by default.
- Nonzero exit is evidence, not transport failure.
- Workspace changes are reported in UI/report/provider envelope.
- Command case cannot count as proof for `E11` unless workspace-effect scan is supported and ran.
- If workspace-effect scan is unsupported, classify as `completed_with_unverified_workspace_effects` and set `countsAsRealProviderProof=false` for `E11`.
- Decline/cancel ends locally in v0 unless a safe continuation is explicitly gated.

### Scenario 5 - Negative Safety Cases

Goal:

```text
blocked authority paths remain blocked and are reported separately from
real-provider proof.
```

Minimum negative cases:

```text
read_file asks for .env -> sensitive_path_denied
apply_patch includes delete -> patch_delete_deferred
run_command requests unsupported command/network helper -> command_class_blocked
```

These may be fixture-backed if real provider behavior is not reliable. Reports must label them as negative safety coverage and never count them as real-provider implementation-lane proof.

### Scenario 6 - Direct Text-Only Regression

Goal:

```text
same provider/tool-call fixture under Direct text-only
  -> no approval card
  -> no workspace read/write/command
  -> no continuation
  -> terminal tool_call_blocked_text_only
```

This scenario may use a fixture if a real provider cannot be reliably made to emit the required tool call under text-only. The report must label fixture coverage as not real-provider implementation-lane coverage.

### Scenario 7 - Opt-In Guard

Goal:

```text
implementation-lane live command without opt-in blocks before provider transport
```

Acceptance:

- `providerRequestStarted=false`.
- `providerBytesObserved=false`.
- failure code is `live_provider_call_opt_in_missing`.
- inherited live env opt-in is cleared for the child guard process.

### Scenario 8 - Raw-Exposure Scan

Scan:

- implementation-lane summary report;
- linked per-turn reports;
- linked tool result summaries;
- linked patch/command reports;
- stdout/stderr previews;
- patch previews;
- patch result envelopes;
- command result envelopes;
- workspace-effect summaries;
- operation history summaries;
- optional Markdown summary;
- console summary captured in fixture tests where feasible.

Block if report surfaces include:

```text
raw auth
raw request body
raw backend frames
raw absolute workspace/WSL paths
raw provider frames
ChatGPT thread URLs
token-like values
unredacted secret-like file output
SQLite/internal FK exception text
```

## 9. Report Schema

```ts
type DirectRealImplementationLaneReport = {
  schema: "direct_real_implementation_lane_report@1";
  runId: string;
  createdAt: string;
  mode: "preflight" | "live";
  runMode: "strict" | "diagnostic-no-promotion";
  coverageClass: "real-provider-implementation-lane";
  liveProviderCallOptIn: boolean;
  branch: string;
  commit: string;
  workspace: {
    workspaceEvidenceKey: string;
    workspaceOverrideUsed: boolean;
    rawWorkspacePathExposed: false;
  };
  disposableWorkspace: {
    created: boolean;
    retained: boolean;
    retentionReason?: "failed_case" | "debug_requested" | "policy";
    workspaceEvidenceKey: string;
    rawPathExposed: false;
  };
  policy: {
    policyId: string;
    policyDigest: string;
  };
  liveProbe?: {
    ran: boolean;
    status: "runtime_probed" | "candidate" | "failed" | "skipped";
    evidenceId?: string;
    expiresAt?: string;
    unknownRawEventTypeCount: number;
  };
  cases: DirectImplementationCaseReport[];
  appServerBaseline?: {
    ran: boolean;
    status: "passed" | "failed" | "skipped";
    purpose: "sanity_baseline_not_promotion";
  };
  rawExposureScan: {
    scanned: boolean;
    status: "passed" | "failed";
    findingCount: number;
    checkedPatterns: string[];
  };
  fixtureSmoke: {
    ran: boolean;
    status: "passed" | "failed" | "skipped";
    coverageClass: "fixture-backed-not-real-provider";
  };
  futureGaps: Array<{
    gapId: string;
    status: "not_covered" | "partially_covered";
  }>;
};
```

Case reports:

```ts
type DirectImplementationCaseReport = {
  caseId:
    | "read_file_single"
    | "read_file_multi_step"
    | "apply_patch"
    | "run_command"
    | "negative_safety"
    | "direct_text_only_tool_block"
    | "opt_in_guard";
  runtime: "direct" | "fixture";
  status:
    | "proved"
    | "blocked"
    | "expected_tool_not_emitted"
    | "unsupported_tool_shape"
    | "failed"
    | "redaction_blocked"
    | "skipped";
  coverageSource:
    | "real_provider"
    | "fixture_provider"
    | "local_preflight"
    | "diagnostic";
  proofOutcome:
    | "proved_full_loop"
    | "provider_tool_not_emitted"
    | "provider_tool_shape_observed_local_blocked"
    | "provider_tool_shape_unsupported"
    | "unexpected_supported_tool_call"
    | "unsupported_tool_call"
    | "multiple_tool_calls_unsupported"
    | "parallel_tool_call_attempted"
    | "local_authority_failed"
    | "continuation_failed"
    | "raw_exposure_blocked";
  requestLifecycle:
    | "preflight_blocked"
    | "provider_request_started"
    | "provider_tool_call_observed"
    | "request_built"
    | "transport_handoff_started"
    | "transport_handoff_unknown"
    | "streaming"
    | "local_authority_waiting"
    | "waiting_for_approval"
    | "local_action_executed"
    | "local_action_running"
    | "continuation_request_built"
    | "continuation_sent"
    | "continuation_streaming"
    | "completed"
    | "failed"
    | "interrupted";
  providerRequestStarted: boolean;
  providerBytesObserved: boolean;
  providerToolCallObserved: boolean;
  continuationSent: boolean;
  continuationBytesObserved: boolean;
  providerContinuationSent: boolean;
  providerContinuationCompleted: boolean;
  localAuthorityExecuted: boolean;
  countsAsRealProviderProof: boolean;
  matrixRowsExercised: Array<
    | "E3" | "E4" | "E5" | "E6" | "E7"
    | "E9" | "E10" | "E11" | "E12" | "E13" | "E14"
    | "I7" | "F4" | "F6" | "F7"
  >;
  matrixPromotionCandidate: boolean;
  failureCode?: string;
  terminalKind?: string;
  toolDeclarationEvidence: {
    declaredToolNames: string[];
    declaredToolSchemasHash: string;
    declaredToolCount: number;
    toolChoicePolicy: "auto" | "required" | "none";
  };
  toolElicitation: {
    strategy: "prompt_only" | "tool_choice_required" | "tool_choice_auto" | "other";
    evidenceRef?: string;
  };
  evidence: {
    requestShapeClass?: string;
    parentResponseProofPresent: boolean;
    contextPackIds: string[];
    requestManifestIds: string[];
    providerInputProjectionIds: string[];
    operationIds: string[];
  };
  localAction: {
    actionType?: "read_file" | "apply_patch" | "run_command";
    executed: boolean;
    decisionId?: string;
    resultArtifactId?: string;
    workspaceWriteExecuted: boolean;
    workspaceChangesDetected?: boolean;
    workspaceEffectScanRan?: boolean;
    unexpectedWorkspaceChangesDetected?: boolean;
  };
  safety: {
    rawAuthExposed: false;
    rawRequestBodyExposed: false;
    rawProviderFramesExposed: false;
    rawWorkspacePathExposed: false;
    rightPaneMutated: false;
    handoffMutated: false;
    appServerFallbackUsed: false;
  };
};
```

Report artifact rule:

```text
Reports contain artifact ids and evidence keys only.
Reports do not contain raw context text, raw request body, raw patch body,
raw stdout/stderr, raw file contents, or raw local paths.
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

If raw-exposure scan fails:

```text
write minimal safe failure report
validate minimal report schema
```

## 10. Provider Prompt Strategy

The harness may use deterministic fixture prompts to encourage tool calls, but the report must not assume text equality.

Examples:

```text
Read scenario:
Please inspect src/readable.txt using the available read_file tool and then summarize it.

Patch scenario:
Please update src/needs_patch.txt by changing the word alpha to beta using apply_patch only.

Command scenario:
Please run the package test script using run_command and summarize the result.
```

The system/harness policy must declare only the tool under test for that scenario unless the scenario explicitly tests sequencing.

Scenario-specific tool declarations:

```text
single read:
  declared tools = ["read_file"]

multi-step read:
  declared tools = ["read_file"]

patch:
  declared tools = ["apply_patch"]

command:
  declared tools = ["run_command"]
```

Each report records declared tool names, declared schema hash, declared tool count, and tool-choice strategy. If `tool_choice_required` or equivalent is used, it must be request-shape/evidence scoped. If not accepted by the ODEU profile, the report must show `toolElicitation.strategy="prompt_only"` or another explicit non-required strategy.

If the provider produces a final answer without the expected tool call, classify as:

```text
expected_tool_call_not_emitted
```

This is a harness/provider behavior result, not a local authority failure and not proof for matrix promotion.

For every provider continuation:

```text
context pack includes current harness policy
provider input projection includes current tool-continuation policy
request manifest records roleMappingDigest, harnessPolicyDigest, and contextPolicyDigest
```

## 11. Sentinels

Install sentinels around:

- app-server spawn/fallback;
- right-pane ChatGPT selection/navigation/reload/mutation;
- handoff queue create/modify/dismiss/submit;
- broad shell/network/browser/MCP tool execution;
- direct text-only tool approval path;
- parallel tool-call execution;
- delete/revert execution.

Sentinel failure blocks the case and marks report status failed.

## 12. Implementation Order

### Phase -1 - Proof Semantics And Report Law

- Define `status`, `proofOutcome`, `coverageSource`, and `requestLifecycle`.
- Define `matrixRowsExercised` and `matrixPromotionCandidate`.
- Define `providerToolCallObserved`, `localAuthorityExecuted`, `providerContinuationSent`, `providerContinuationCompleted`, and `countsAsRealProviderProof`.
- Define artifact-id-only report rules.
- Define provider non-determinism classifications.
- Define schema validation before and after redaction scan.

### Phase 0 - Report And Policy Scaffolding

- Add report schema/validator.
- Add policy snapshot defaults for the runner.
- Add raw-exposure scanner coverage for implementation-lane artifacts.
- Add app-server/right-pane/handoff sentinels.
- Add child-process env isolation.
- Add minimal safe failure report.

### Phase 1 - Real Read Scenarios

- Single `read_file` real provider case.
- Multi-step `read_file` real provider case.
- Negative sensitive-path fixture/proof.
- Parent response proof and per-step idempotency.
- Redaction and result envelope reporting.
- Clear not-emitted classification when provider does not call the expected tool.

### Phase 2 - Real Patch Scenario

- Disposable file patch task.
- Patch plan/dry-run/apply/journal through existing authority module.
- Workspace-effect and continuation reporting.
- Delete blocked with `patch_delete_deferred`.
- Unexpected extra workspace changes detected.
- Patch plan/report artifact ids only.
- Continuation policy resent.

### Phase 3 - Real Command Scenario

- Package-script command task.
- Backend capability report.
- Process cleanup, output caps/redaction, workspace-effect scan.
- Local package scripts only.
- Workspace-effect scan required for command side-effect proof.
- Command child receives no provider auth env.
- Network helper fixture blocked.

### Phase 4 - Regression Matrix

- Direct text-only tool-call block fixture.
- Opt-in guard.
- Idempotency for real implementation-lane case where safe.
- Raw-exposure scan.
- Summary Markdown/JSON reports.
- Fixture coverage cannot promote.
- Provider non-determinism classifications.
- Optional app-server baseline summary.

## 13. Acceptance Criteria

- The runner can execute in preflight mode without provider calls.
- Live mode refuses without explicit live opt-in.
- CI live mode refuses without explicit CI opt-in.
- Missing exact tool continuation evidence blocks before provider continuation.
- Every case report includes `providerToolCallObserved`, `localAuthorityExecuted`, `providerContinuationSent`, `providerContinuationCompleted`, and `countsAsRealProviderProof`.
- Every case includes `coverageSource`.
- Only `coverageSource="real_provider"` can set `matrixPromotionCandidate=true`.
- Every case maps to `matrixRowsExercised` and `matrixPromotionCandidate`.
- `expected_tool_call_not_emitted` is not a passing proof state and cannot promote matrix rows.
- Provider non-determinism is classified as `expected_tool_call_not_emitted`, `unexpected_supported_tool_call`, `unsupported_tool_call`, `multiple_tool_calls_unsupported`, or `parallel_tool_call_attempted`.
- Tool declarations are scenario-specific and report declared tool names, schema hash, and tool-choice strategy.
- `read_file` single-step case proves a full loop against a real provider or records a stable expected-tool-not-emitted result that does not promote.
- Multi-step read case passes or records stable bounded terminal classifications.
- Patch case applies only through existing patch authority, with journal evidence.
- Command case runs only through existing command authority, with workspace-effect summary.
- Command case cannot count as `E11` proof unless workspace-effect scan is supported and ran.
- Patch case reports expected and unexpected workspace changes after apply.
- Every continuation manifest records `store=false`, no new tool declarations, one output item, `previousResponseId=true`, and `parallelToolCalls=false`.
- Every provider continuation proves current harness/tool-continuation policy was resent.
- Tool result envelopes are bounded and redacted.
- Workspace-effect scan is recorded or unsupported scanning is explicit.
- Reports contain artifact ids/evidence keys only, not raw context, raw request bodies, raw patch bodies, raw stdout/stderr, raw file contents, or raw local paths.
- Report schema validates before serialization, after serialization, and after redaction scan.
- Child processes receive no provider/auth env unless explicitly required for live provider transport.
- Disposable command scripts use only local Node files and do not require package install or network access.
- No report exposes raw auth, raw request body, raw provider frames, raw absolute paths, or secret-like output.
- No direct case mutates right-pane ChatGPT or handoff state.
- No direct case uses app-server fallback.
- Direct text-only still blocks tool calls.
- Fixture-backed negative tests are reported separately and never counted as real-provider implementation-lane coverage.
- The report keeps future gaps explicit for recovery, iterative repair, context maintenance, governance, and sub-agent observability.

## 14. Non-Goals

This PR must not update the matrix rows to `B-R` merely because fixtures pass. A row moves to `B-R` only when the report contains real-provider coverage for that exact scope.

This PR must not make implementation-lane direct the default. It remains experimental and evidence-gated.
