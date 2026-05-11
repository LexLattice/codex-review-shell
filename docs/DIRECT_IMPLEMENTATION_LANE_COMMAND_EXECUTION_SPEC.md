# Direct Implementation-Lane Command Execution Spec

Status: draft implementation specification for the next direct-runtime bundle on
the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_PATCH_APPLY_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_MULTI_STEP_READONLY_TOOL_LOOP_SPEC.md)
- [DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md](./DIRECT_IMPLEMENTATION_LANE_READONLY_TOOL_UI_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md](./DIRECT_OBLIGATION_PROJECTION_AND_TOOL_CONTEXT_SPEC.md)
- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)

## Purpose

Extend the Direct implementation lane from read/patch capability into the first
bounded command/test execution loop:

```text
implementation-lane turn
  -> optional approved read_file steps
  -> optional approved apply_patch step
  -> provider emits one supported run_command call
  -> shell records a command obligation
  -> shell builds a structured command plan
  -> renderer shows a human approval card
  -> user approves
  -> workspace backend runs the command with bounds
  -> shell records redacted command-result evidence
  -> context pack + request manifest
  -> provider continuation
  -> assistant finalizes the same turn
```

The immediate product goal is test/lint/typecheck verification after direct
patches, without enabling arbitrary shell authority, auto-approval, network
tools, browser/MCP automation, or app-server fallback. Because project commands
can mutate files indirectly, command execution must also record whether the
workspace changed before the provider sees the result.

## Core Invariant

Command support is local execution authority, not provider authority:

```text
provider command call != local execution authority
command preview != process start
user approval != permission for future commands
command output != instruction authority
one run_command step != general shell runtime
```

The provider may propose a command. The main process owns command parsing,
policy classification, cwd containment, environment policy, approval, process
execution, timeout/kill behavior, output redaction, recovery, and continuation
legality.

## Boundary

This bundle does:

- admit exactly one supported `run_command` obligation in one Direct
  implementation-lane turn;
- allow command execution only after complete provider arguments are available;
- convert provider command arguments into a structured command plan before
  renderer approval;
- require a fresh human approval action token;
- execute through the workspace backend only, with `shell=false`;
- enforce cwd containment under the project workspace root;
- run with a bounded timeout, output caps, and sanitized environment policy;
- scan or explicitly report unknown workspace side effects before and after
  execution;
- record exit status, signal, duration, output digests, truncation/redaction
  status, and renderer-safe command summary;
- send one provider continuation with `store=false`, no tool declarations, and
  exactly one command-output item paired to the original call id;
- append final assistant continuation text to the same direct turn;
- keep read-only and patch steps available before the command.

It does not:

- support more than one command obligation per turn;
- support command auto-approval, approval-for-session, or imported approval
  replay;
- support shell string execution, shell metacharacter parsing, pipes, redirects,
  background jobs, TTY prompts, interactive commands, or daemon processes;
- support provider-requested network/browser/MCP automation;
- support command continuations that request another read, patch, or command in
  v0;
- guarantee that project scripts are side-effect-free;
- prove project code cannot perform network access unless the backend provides
  real network isolation;
- run commands in Direct text-only;
- import or mutate right-pane ChatGPT content;
- mutate handoff queue items;
- fall back to app-server inside a direct turn;
- make production `direct` available.

## Relationship To The Previous Bundle

The patch-apply bundle made this shape valid:

```text
read_file step N
  -> apply_patch
  -> workspace apply
  -> patch-result continuation
  -> final assistant
```

This bundle admits one terminal verification/action step:

```text
read_file step N
  -> apply_patch
  -> workspace apply
  -> patch-result continuation
  -> run_command
  -> command-result continuation
  -> final assistant
```

Command execution remains a separate authority class. A read approval never
authorizes a command. A patch approval never authorizes a command. A command
approval never authorizes another command, patch, read, or future process.

## Supported Command Tool Shape

V0 supports exactly one provider command call:

```ts
type DirectCommandToolArguments = {
  command: string;      // executable name or package-manager command
  args?: string[];      // argv entries, not shell text
  cwd?: string;         // project-relative cwd, optional
  reason?: string;      // renderer-safe provider reason
  timeoutMs?: number;   // bounded by local policy
  expectedPurpose?:
    | "test"
    | "lint"
    | "typecheck"
    | "format-check"
    | "build-check"
    | "diagnostic";
};
```

Accepted tool names:

```text
run_command
runCommand
```

Accepted namespace policy:

```text
namespace absent only
```

Accepted provider call/output pairs:

```ts
type DirectCommandProviderShape = {
  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
};
```

`function_call_output` evidence does not prove `custom_tool_call_output`, and
custom-tool evidence does not prove function-call evidence.

Unsupported names for this bundle:

```text
shell
bash
sh
powershell
cmd
python_eval
write_file
apply_patch_command
browser
network
mcp
```

Unsupported calls become terminal unsupported evidence. They must not show an
approval button, spawn a process, or send a continuation.

Multiple tool calls fail closed:

```text
If a provider response contains more than one tool call:
  no read card
  no patch card
  no command card
  no workspace command
  terminal unsupported: multiple_tool_calls_unsupported
```

If a response emits `read_file`, `apply_patch`, and/or `run_command` together,
v0 does not choose an order. It fails closed.

## Command Position In The Turn

`run_command` is allowed only when no other direct tool step is nonterminal.

Blocked active states include:

```text
collecting_arguments
waiting_for_approval
approved
result_recorded
patch_planned
patch_approved
patch_result_recorded
context_built
request_built
continuation_sent
streaming_continuation
```

If a command call appears while a read or patch step is active, fail closed:

```text
command_during_active_tool_step_unsupported
```

V0 command continuation is terminal:

```text
command result continuation -> assistant final answer
```

If the command continuation emits any tool call, fail closed:

```text
nested_tool_after_command_unsupported
```

No follow-up command, read, patch, or repair loop is supported in this bundle.

## Request-Shape Evidence

Command execution requires a distinct evidence scope. Text-only, read-only, and
patch continuation evidence do not unlock command execution.

```ts
type DirectCommandExecutionEvidenceScope = {
  requestShapeClass: "direct_command_execution_continuation@1";
  model: string;
  endpointHash: string;
  accountEvidenceKey: string;

  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";
  toolOutputItemType: "function_call_output" | "custom_tool_call_output";
  toolName: "run_command";
  namespacePolicy: "absent-only";

  commandArgumentShapeHash: string;
  commandPlanShapeHash: string;
  commandResultEnvelopeShapeHash: string;
  continuationRequestShapeHash: string;
  continuationNormalizerVersion: string;
  requestBuilderVersion: string;
  commandPolicyVersion: string;
  commandRunnerVersion: string;
  redactionVersion: string;

  store: false;
  toolDeclarations: false;
  toolOutputItem: true;
  previousResponseId: true;
  parallelToolCalls: false;
};
```

The command gate is action-specific:

```ts
directImplementationLane.commandExecution = {
  canShowCommandObligations: boolean;
  canPlanCommand: boolean;
  canApproveCommand: boolean;
  canRunCommand: boolean;
  canSendCommandContinuation: boolean;
  blockerCodes: DirectCommandBlockerCode[];
};
```

Missing command evidence must not block read-only or patch functionality. It
only blocks command approval/execution.

## Command Policy

V0 uses a conservative policy classification before approval:

```ts
type DirectCommandPolicy = {
  policyId: "direct_command_execution_policy@1";
  shell: false;
  interactive: false;
  tty: false;
  allowBackgroundProcesses: false;
  allowNetworkTools: false;
  workspaceWritePolicy: DirectCommandWorkspaceWritePolicy;
  requireHumanApproval: true;
  allowedCommandClasses: DirectCommandClass[];
  deniedExecutableNames: string[];
  deniedArgPatterns: string[];
};

type DirectCommandWorkspaceWritePolicy =
  | "must_not_write"
  | "writes_possible_with_warning"
  | "writes_expected_but_bounded"
  | "blocked";
```

V0 command classes are intentionally narrow. Implement package-manager scripts
first:

```text
package-manager script:
  npm run <script>
  npm test
  pnpm run <script>
  pnpm test
  yarn run <script>
  yarn test
  bun run <script>
  bun test
```

Return stable blockers for well-known direct executable checks until each class
has fixture coverage and platform-specific argv behavior tested:

```text
well-known project checks when present:
  npm exec tsc -- --noEmit
  npx tsc --noEmit
  pytest
  python -m pytest
  go test ./...
  cargo test
```

```text
command_class_deferred
command_policy_unsupported
```

Write-risk defaults:

```text
npm test / pnpm test / yarn test / bun test:
  writes_possible_with_warning

npm run <script> / pnpm run <script> / yarn run <script> / bun run <script>:
  writes_possible_with_warning unless script metadata classifies it stricter

format-check / typecheck classes:
  must_not_write when implemented

build-check:
  writes_possible_with_warning or blocked in v0
```

If a `must_not_write` command changes files, the result is not clean success:

```text
completed_with_unexpected_workspace_changes
```

Denied executable names by default:

```text
sh
bash
zsh
fish
cmd
powershell
pwsh
curl
wget
ssh
scp
rsync
nc
netcat
docker
podman
kubectl
terraform
rm
mv
cp
chmod
chown
sudo
```

Denied shell syntax in argv:

```text
|
||
&
&&
;
>
>>
<
`...`
$(...)
${...}
*
?
~
```

This is not a security proof that project scripts are harmless. It is a v0
command-shape policy. The UI must still warn:

```text
This command runs local project code and may change generated files, caches, or
other workspace state.
```

Denied shell syntax applies to provider-supplied argv. Package script bodies are
local project metadata and may contain shell syntax because package managers may
invoke scripts through a shell internally.

V0 package script body policy:

```text
script body contains denied network/deployment/daemon helpers:
  block before approval

script body contains shell metacharacters but no denied helper executable:
  warn, because package manager script execution may use a shell internally
```

Network risk copy must be truthful:

```text
Known network helper commands are blocked.
Project code is not network-sandboxed unless the backend reports network
isolation support.
```

Package-manager scripts must be validated against the local manifest before
approval:

```ts
type DirectPackageScriptEvidence = {
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  packageJsonRelPath: string;
  scriptName: string;
  scriptExists: boolean;
  scriptCommandEvidenceKey?: string;
  scriptCommandPreview?: string;
  scriptBodyPolicy:
    | "safe_preview"
    | "warn_shell_syntax"
    | "blocked_dangerous_helper"
    | "missing";
};
```

If the script does not exist:

```text
package_script_missing
```

## Command Plan

Before renderer approval, main builds a command plan:

```ts
type DirectCommandExecutionPlan = {
  schema: "direct_command_execution_plan@1";
  commandPlanId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  obligationId: string;

  providerResponseId: string;
  providerCallId: string;
  providerCallItemId?: string;
  parentResponseSource:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream"
    | "native_direct_patch_continuation_stream";
  parentResponseSourceEventDigest: string;
  parentTurnDigest: string;

  toolName: "run_command";
  providerCallType: "function_call" | "custom_tool_call";
  providerOutputType: "function_call_output" | "custom_tool_call_output";

  commandClass:
    | "package_script"
    | "well_known_test"
    | "well_known_lint"
    | "well_known_typecheck";
  displayCommand: string;
  executable: string;
  args: string[];
  cwdRelPath: string;
  cwdEvidenceKey: string;
  timeoutMs: number;
  executableResolution: {
    executable: string;
    resolvedKind: "PATH" | "package-manager" | "absolute-blocked" | "unknown";
    resolvedEvidenceKey?: string;
    pathDigestMode: "hmac_sha256" | "none";
  };
  packageScriptEvidence?: DirectPackageScriptEvidence;

  policy: {
    policyId: "direct_command_execution_policy@1";
    policyDigest: string;
    shell: false;
    interactive: false;
    knownNetworkCommandHelpersBlocked: true;
    networkAccessNotProvenAbsent: boolean;
    workspaceWritePolicy: DirectCommandWorkspaceWritePolicy;
  };

  caps: {
    maxTimeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    maxProviderOutputChars: number;
  };

  integrity: {
    algorithm: "sha256" | "hmac-sha256";
    keyId?: string;
    artifactDigest: string;
  };

  safety: {
    rawWorkspacePathExposed: false;
    rawEnvExposed: false;
    rawProviderPayloadExposed: false;
    shellDisabled: true;
    interactiveBlocked: true;
    networkToolBlocked: boolean;
    networkIsolationSupported: boolean;
    processTreeCleanupSupported: boolean;
    commandPolicyWarning: string;
  };

  status:
    | "planned"
    | "policy_blocked"
    | "approval_waiting"
    | "approved"
    | "declined"
    | "canceled"
    | "running"
    | "result_recorded"
    | "continuation_sent"
    | "failed";
  blockerCode?: DirectCommandBlockerCode;
};
```

The plan must never include raw absolute paths, raw environment variables,
tokens, auth headers, or raw provider request bodies.

Before execution, main re-resolves or revalidates executable resolution when the
backend can provide evidence. If the effective package manager, executable
resolution, or relevant `PATH` evidence changed since planning, execution blocks
with:

```text
command_plan_integrity_mismatch
```

## Approval Token

Command approval requires an action token. Renderer buttons are not authority.

```ts
type DirectCommandExecutionActionToken = {
  tokenId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  obligationId: string;
  commandPlanId: string;
  action: "approve" | "decline" | "cancel";
  obligationDigest: string;
  commandPlanDigest: string;
  commandPlanIntegrityDigest: string;
  operationLedgerHeadDigest: string;
  selectedRuntimeDigest: string;
  workspaceEvidenceKey: string;
  expiresAt: string;
};
```

Decision conflict rules:

```text
same clientCommandDecisionId + same obligation + same action:
  return existing decision/run/continuation snapshot

same clientCommandDecisionId + different obligation:
  reject client_decision_id_conflict

same clientCommandDecisionId + same obligation + different action:
  reject client_decision_id_conflict

approve after decline/cancel:
  reject terminal_decision_exists

decline/cancel after command_started:
  reject too_late_for_decision
```

## Workspace Execution

Workspace execution happens only through the workspace backend.

Required backend behavior:

```text
spawn executable with argv
shell=false
cwd is canonicalized project-relative path under workspace root
environment is sanitized
stdout/stderr captured separately
timeout enforced
SIGTERM then SIGKILL cleanup
exit code and signal recorded
no raw absolute paths in renderer-safe output
```

Backend capability truth is explicit:

```ts
type DirectCommandBackendCapabilities = {
  shellFalseSupported: boolean;
  cwdContainmentSupported: boolean;
  timeoutKillSupported: boolean;
  envSanitizationSupported: boolean;
  networkIsolationSupported: boolean;
  processTreeKillSupported: boolean;
  workspaceEffectScanSupported: boolean;
};
```

Required capabilities:

```text
shellFalseSupported
cwdContainmentSupported
timeoutKillSupported
envSanitizationSupported
processTreeKillSupported
workspaceEffectScanSupported
```

If any required capability is missing:

```text
workspace_command_backend_unavailable
```

If network isolation is missing, command execution may still proceed only with
truthful UI/provider status:

```text
Network helper commands are blocked, but project code is not network-sandboxed.
```

Timeout cleanup must terminate the process tree, not only the parent process:

```text
Linux/WSL:
  start in a process group and kill the group on timeout

Windows:
  use a Job Object or equivalent process-tree cleanup when implemented
```

If process-tree cleanup is unsupported, command execution blocks in v0.

Execution write order:

```text
1. acquire project runtime lock
2. acquire turn tool-step lock
3. acquire command obligation lock
4. validate action token and clientCommandDecisionId
5. re-read project generation, runtime tier, operation ledger head, and store health
6. revalidate command plan digest and cwd containment
7. write command_execution_planned operation event
8. mark command obligation approved
9. write command_execution_started event
10. spawn process through workspace backend
11. capture bounded stdout/stderr
12. scan workspace effects
13. classify terminal state
14. scan/redact command result and all renderer/provider surfaces
15. record command result artifact
16. build command continuation context and request manifest
17. only then send provider continuation
```

If the process starts and the local shell crashes before terminal status is
known, recovery must classify:

```text
command_handoff_unknown
```

No automatic rerun is allowed after process start.

Post-run daemon/orphan detection is required when the backend can support it:

```ts
backgroundProcessCheck: {
  supported: boolean;
  orphanedProcessSuspected: boolean;
  detailsPreview?: string;
};
```

If an orphaned process is suspected:

```text
command_completed_with_orphan_warning
```

Do not present the command as clean.

## Workspace Effect Scan

Commands can mutate files even when requested as tests or checks. Every command
result must include a workspace effect summary, or explicitly record that the
scan was unsupported/failed.

```ts
type DirectCommandWorkspaceEffectSummary = {
  preCommandWorkspaceDigest?: string;
  postCommandWorkspaceDigest?: string;
  changedPathCount: number;
  changedPathsPreview: Array<{
    relPath: string;
    changeKind: "created" | "modified" | "deleted" | "unknown";
  }>;
  changedPathsTruncated: boolean;
  scanScope: "git-status" | "workspace-index" | "none";
  scanFailed: boolean;
};
```

V0 may use a backend-owned `git status --porcelain` scan or a backend-native
workspace index. This scan is not provider-proposed command execution and must
not use shell parsing.

If changed files are detected:

```text
Command completed, but workspace changed.
Assistant saw command result only; it did not receive full changed-file contents.
```

Provider output must include:

```json
{
  "workspaceChangesDetected": true,
  "workspaceChangesPreview": [],
  "workspaceChangesTruncated": false,
  "workspaceChangeScanSupported": true
}
```

If the effect scan is unsupported:

```json
{
  "workspaceChangeScanSupported": false
}
```

## Environment Policy

Default environment policy:

```ts
type DirectCommandEnvironmentPolicy = {
  inheritedEnv: "minimal";
  allowedEnvNames: string[];
  deniedEnvNamePatterns: string[];
  injectProjectEnv: false;
  exposeEnvToRenderer: false;
  exposeEnvToProvider: false;
};
```

Allowed environment names should be minimal, for example:

```text
PATH
HOME
TMPDIR
TEMP
TMP
CI=1
NO_COLOR=1
```

Denied patterns include:

```text
*TOKEN*
*KEY*
*SECRET*
*COOKIE*
*SESSION*
OPENAI_*
ANTHROPIC_*
GITHUB_TOKEN
NPM_TOKEN
```

The provider and renderer must never receive raw environment values.

## Result Artifact

Command results are evidence, not instruction authority.

```ts
type DirectCommandExecutionResult = {
  schema: "direct_command_execution_result@1";
  commandResultId: string;
  commandPlanId: string;
  obligationId: string;
  tool: "run_command";

  status:
    | "completed"
    | "completed_with_workspace_changes"
    | "completed_with_unexpected_workspace_changes"
    | "failed_exit"
    | "timed_out"
    | "canceled"
    | "spawn_failed"
    | "handoff_unknown"
    | "redaction_blocked";
  exitCode?: number;
  signal?: string;
  durationMs: number;
  timedOut: boolean;

  stdout: {
    textPreview: string;
    textEvidenceKey?: string;
    hashMode: "none" | "hmac_sha256";
    byteCount: number;
    truncated: boolean;
  };
  stderr: {
    textPreview: string;
    textEvidenceKey?: string;
    hashMode: "none" | "hmac_sha256";
    byteCount: number;
    truncated: boolean;
  };

  workspaceEffects: DirectCommandWorkspaceEffectSummary;
  backgroundProcessCheck: {
    supported: boolean;
    orphanedProcessSuspected: boolean;
    detailsPreview?: string;
  };

  redaction: {
    scanned: boolean;
    scanVersion: string;
    status: "passed" | "redacted" | "blocked";
    categories?: string[];
  };

  providerOutputText: string;
  providerOutputChars: number;
  sideEffectPossible: true;
  success: boolean;
  rawWorkspacePathExposed: false;
  rawEnvExposed: false;
  rawCommandOutputUnbounded: false;
};
```

Provider output envelope:

```json
{
  "kind": "run_command_result",
  "command": "npm test",
  "cwd": ".",
  "status": "completed",
  "exitCode": 0,
  "signal": null,
  "durationMs": 1234,
  "stdoutPreview": "...",
  "stderrPreview": "...",
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "timedOut": false,
  "success": true,
  "sideEffectPossible": true,
  "workspaceChangeScanSupported": true,
  "workspaceChangesDetected": false,
  "workspaceChangesPreview": [],
  "workspaceChangesTruncated": false
}
```

The provider output is capped and redacted. It must not include raw absolute
paths, raw environment values, raw tokens, raw auth headers, or unbounded
terminal output.

Raw stdout/stderr hashes are not renderer/provider fields by default. Use local
HMAC evidence keys for report correlation, or omit hashes entirely.

Nonzero exits are command evidence, not local transport failure:

```text
exitCode === 0:
  status=completed, success=true

exitCode !== 0:
  status=failed_exit, success=false
  send provider continuation if redaction passes
```

## Caps

Recommended v0 defaults:

```ts
MAX_DIRECT_COMMAND_TIMEOUT_MS = 120_000;
MAX_DIRECT_COMMAND_STDOUT_BYTES = 96 * 1024;
MAX_DIRECT_COMMAND_STDERR_BYTES = 96 * 1024;
MAX_DIRECT_COMMAND_PROVIDER_OUTPUT_CHARS = 64 * 1024;
MAX_DIRECT_COMMAND_APPROVAL_SUMMARY_CHARS = 2000;
MAX_DIRECT_COMMAND_ARG_COUNT = 64;
MAX_DIRECT_COMMAND_ARG_CHARS = 4096;
```

If caps are exceeded:

```text
command argument caps:
  block before approval

stdout/stderr caps:
  truncate with honest flags and omitted byte counts

provider output cap:
  include bounded summaries and truncation flags

redaction blocked:
  stop locally and send no provider continuation
```

Redaction scan points:

```text
command plan displayCommand
package script body preview
stdout preview
stderr preview
providerOutputText
renderer approval card payload
operation history summary
headless report
```

If output redaction blocks after the command ran:

```text
command may have run locally
no provider continuation is sent
UI shows command result redaction blocked
```

## Continuation Context

Command continuation uses a dedicated context policy:

```text
direct_command_execution_continuation@1
```

Context source:

```text
direct_obligations@1
  -> command_execution_context@1
  -> direct_context_pack@1
  -> provider_input_projection
  -> direct_request_manifest@1
```

Command result output is quoted local evidence:

```ts
type CommandContextMessageAuthority =
  | "harness-policy"
  | "command-result-evidence"
  | "status-evidence";
```

The continuation provider input must include current harness policy and
command-continuation policy every time. Because `previous_response_id` does not
carry previous instructions automatically, the continuation request must be
self-contained.

Continuation request manifest:

```ts
type DirectCommandContinuationManifestFields = {
  requestShapeClass: "direct_command_execution_continuation@1";
  store: false;
  toolDeclarations: false;
  toolOutputItem: true;
  previousResponseIdUsed: true;
  providerContinuityHandleUsed: true;
  importedContinuityHandleUsed: false;
  parallelToolCalls: false;
  commandResultId: string;
  commandPlanId: string;
};
```

`tools=false` means no tool declarations and no permission to request additional
tools. The input may include exactly one accepted tool-output item paired to the
original command call id.

Decline/cancel policy for v0:

```text
decline/cancel ends locally
no process starts
no provider continuation is sent
```

If a future bundle sends decline/cancel back to the provider, it must use
`direct_command_execution_continuation@1` evidence and a bounded tool-output
envelope.

## Previous Response Proof

The continuation must cite the response id that emitted the command call:

```ts
type DirectCommandPreviousResponseProof = {
  id: string;
  source:
    | "native_direct_initial_stream"
    | "native_direct_tool_continuation_stream"
    | "native_direct_patch_continuation_stream";
  sourceEventDigest: string;
  sourceTurnDigest: string;
  sourceRequestManifestId: string;
  importedContinuityHandleUsed: false;
};
```

If proof is missing:

```text
command_continuation_failed: missing_native_parent_continuity
```

No command result continuation may be sent without native direct parent
continuity proof.

## Terminal States

Local command execution and provider continuation are separate state machines:

```ts
type DirectCommandExecutionState =
  | "not_started"
  | "planned"
  | "running"
  | "completed"
  | "timed_out"
  | "spawn_failed"
  | "handoff_unknown"
  | "redaction_blocked";

type DirectCommandContinuationState =
  | "not_built"
  | "context_built"
  | "request_built"
  | "sent"
  | "streaming"
  | "completed"
  | "handoff_unknown"
  | "failed";
```

A command can have run locally even if provider continuation failed. UI and
operation history must not collapse those states.

Command step terminal kinds:

```ts
type DirectCommandExecutionTerminalKind =
  | "completed_exit_zero"
  | "completed_nonzero_exit"
  | "completed_with_workspace_changes"
  | "completed_with_unexpected_workspace_changes"
  | "command_completed_with_orphan_warning"
  | "timed_out"
  | "canceled"
  | "spawn_failed"
  | "redaction_blocked"
  | "command_handoff_unknown"
  | "command_result_recorded"
  | "continuation_context_failed"
  | "continuation_request_failed"
  | "continuation_handoff_unknown"
  | "continuation_completed_final_assistant"
  | "continuation_response_incomplete"
  | "empty_command_continuation_output"
  | "nested_tool_after_command_unsupported";
```

Turn terminal behavior:

```text
command declined:
  turn failed or aborted locally, no process start

command exits zero:
  send command-result continuation, success=true

command exits nonzero:
  send command-result continuation unless redaction blocks, success=false

command times out:
  send timeout result continuation unless output redaction blocks

spawn fails before process start:
  local terminal or safe failure continuation depending on policy

command handoff unknown after process start:
  local terminal, no automatic rerun

continuation completes with non-empty assistant text:
  turn completed

continuation emits any tool:
  turn failed with nested_tool_after_command_unsupported
```

Nonzero exits are not local failures. They are command evidence. The assistant
should interpret them and explain next steps.

Nested tool calls after command result are all fail-closed:

```text
nested read_file:
  nested_tool_after_command_unsupported

nested apply_patch:
  nested_tool_after_command_unsupported

nested run_command:
  nested_tool_after_command_unsupported
```

## UI

Command approval card shows:

```text
command display string
cwd display path
command class
workspace write policy
backend capability summary
provider reason
timeout
side-effect warning
network/tool policy warning
approval buttons
```

It must not show:

```text
raw absolute paths
raw env values
raw provider payload
raw auth material
raw request body
```

Button states:

```text
Approve:
  enabled only when command plan is valid, evidence is ready, and token is fresh

Decline:
  terminal local decision, no process start

Cancel:
  terminal local decision, no process start
```

While the command is running:

```text
composer disabled
runtime rollback disabled
approval buttons disabled
status item shows running + elapsed time
```

After local command completion but before provider continuation terminal:

```text
command result recorded
assistant continuation pending/streaming/failed
```

If command ran but provider continuation failed:

```text
Command was executed locally.
Assistant continuation did not complete.
Do not assume the model saw the command result.
```

If workspace changes are detected:

```text
Command completed, but workspace changed.
The assistant saw command output and a changed-file summary only.
```

Transcript item identity is stable:

```text
provider command request item
approval card item
running status item
result status item
continuation assistant item
terminal state item
```

Renderer reload must reconstruct these items from durable obligation/result
artifacts instead of replacing them with one mutable blob.

## Runtime Selection And Rollback

Implementation-lane status adds:

```ts
directImplementationLane.commandExecution = {
  canShowCommandObligations: boolean;
  canPlanCommand: boolean;
  canApproveCommand: boolean;
  canRunCommand: boolean;
  canSendCommandContinuation: boolean;
  activeCommandRecoveryState?: DirectCommandRecoveryState;
  blockerCodes: DirectCommandBlockerCode[];
};
```

Rollback to app-server is blocked while any command step is:

```text
collecting_arguments
approval_waiting
approved
running
result_recorded
context_built
request_built
continuation_sent
streaming_continuation
```

Rollback after terminal command state is allowed.

Old `direct-experimental/live-text` configs without a direct tier must never be
migrated into command execution readiness.

## Recovery

Recovery classifications:

```ts
type DirectCommandRecoveryState =
  | "healthy"
  | "waiting_for_user"
  | "approved_no_process"
  | "process_started_no_result"
  | "result_recorded_no_context"
  | "context_built_no_manifest"
  | "request_built_not_sent"
  | "continuation_sent_no_bytes"
  | "stream_interrupted"
  | "terminal"
  | "corrupt";
```

Rules:

```text
approved_no_process:
  may allow user to re-approve or cancel if no process was started

process_started_no_result:
  do not rerun automatically
  show command_handoff_unknown / recovery required

result_recorded_no_context:
  may rebuild context from command result artifact

request_built_not_sent:
  may send only if no provider handoff occurred

continuation_sent_no_bytes:
  no automatic retry

corrupt:
  thread enters degraded read-only status for command execution
```

## Operation Ledger Events

Required event order:

```text
command_obligation_recorded
command_plan_built
command_decision_committed
command_execution_planned
command_execution_started
command_execution_terminal
command_result_recorded
command_continuation_context_built
command_continuation_request_built
command_continuation_sent
command_continuation_stream_started
command_continuation_terminal
```

Each event cites ids and hashes:

```text
commandPlanId
commandPlanDigest
commandResultId
stdoutEvidenceKey
stderrEvidenceKey
workspaceEffectSummaryDigest
contextBuildId
requestManifestId
providerInputShapeHash
operationId
```

No event may store raw command output beyond bounded/redacted summaries.

## Headless Scenarios

Add fixture scenarios:

```text
readonly-read-then-command-fixture
patch-then-command-fixture
command-nonzero-fixture
command-timeout-fixture
command-redaction-blocked-fixture
command-workspace-change-fixture
text-only-command-blocked-fixture
```

`command-workspace-change-fixture` uses a safe temp workspace command that
creates or modifies a temp file and proves:

```text
workspaceChangesDetected=true
provider output says changes were detected
renderer-safe result exposes no raw host path
```

Nested tool smokes after command continuation:

```text
nested read_file after command -> fail closed
nested apply_patch after command -> fail closed
nested run_command after command -> fail closed
```

Live command execution requires explicit opt-in:

```text
--allow-live-provider-call
CODEX_DIRECT_REAL_TURN=1
```

CI additionally requires:

```text
CODEX_DIRECT_REAL_TURN_ALLOW_CI=1
```

The runner must not auto-probe missing command evidence and then continue.

## Raw-Exposure Tests

Scan:

```text
serialized command plan
approval card params
command result artifact
context pack summary
request manifest
provider output envelope
renderer transcript rows
headless report
DOM attributes
browser storage
handoff queue text
```

Assert absence of:

```text
raw absolute paths
raw env values
auth headers
tokens
cookies
raw request body
raw provider frames
unbounded stdout/stderr
raw WSL mirror paths
ChatGPT URLs
```

## Sentinels

Tests install throw-on-call sentinels for:

```text
app-server spawn/fallback
right-pane ChatGPT navigation/mutation
handoff queue create/modify/dismiss/submit
browser automation
MCP tools
network helper APIs
patch apply during command execution
read_file during command execution
command execution in Direct text-only
```

Sentinels cover:

```text
runtime selection
composer submit
command obligation normalization
approval card rendering
approve/decline/cancel
workspace command execution
context build
manifest build
continuation transport
terminal handling
headless reports
```

## Blocker Codes

```text
command_execution_evidence_missing
command_execution_evidence_expired
command_tool_shape_unsupported
unsupported_command_tool_name
unsupported_command_namespace
malformed_command_arguments
command_policy_unsupported
command_class_deferred
package_script_missing
package_script_body_blocked
command_shell_syntax_rejected
command_network_tool_rejected
network_isolation_unavailable
command_interactive_rejected
command_cwd_outside_workspace
command_env_policy_rejected
command_plan_missing
command_plan_integrity_mismatch
stale_command_action_token
client_command_decision_id_conflict
terminal_decision_exists
too_late_for_decision
workspace_command_backend_unavailable
command_spawn_failed
command_timed_out
command_handoff_unknown
process_tree_cleanup_unavailable
workspace_effect_scan_unavailable
completed_with_unexpected_workspace_changes
command_completed_with_orphan_warning
command_result_redaction_blocked
command_continuation_context_failed
command_continuation_request_failed
command_continuation_handoff_unknown
empty_command_continuation_output
nested_tool_after_command_unsupported
command_during_active_tool_step_unsupported
multiple_tool_calls_unsupported
direct_text_only_command_blocked
```

## Implementation Order

### Phase -1 - Command Law

- Define `direct_command_execution_continuation@1` evidence scope.
- Choose package-manager scripts as the v0 command class.
- Define package manifest/script validation and script body policy.
- Define command policy and command classes.
- Define workspace write policy classes and workspace effect scan requirements.
- Define backend capability requirements, including process-tree cleanup.
- Choose decline/cancel local-terminal no-continuation policy.
- Define command terminal states and recovery classes.
- Define action-token and idempotency rules.
- Keep command readiness action-specific.

### Phase 0 - Command Plan

- Detect complete supported `run_command` calls.
- Reject multiple calls, namespaces, shell syntax, and unsupported commands.
- Canonicalize cwd through workspace backend.
- Resolve command class and executable.
- Validate package script existence/body policy.
- Record executable resolution evidence.
- Build command plan artifact with integrity.
- Render approval card with side-effect warning.

### Phase 1 - Decision Controller

- Revalidate project/generation/runtime tier/ledger/turn/obligation.
- Enforce action token and `clientCommandDecisionId`.
- Record approve/decline/cancel.
- Block rollback while nonterminal.

### Phase 2 - Workspace Execution

- Add backend `runCommand` policy wrapper for direct command obligations.
- Spawn with `shell=false`.
- Enforce timeout and process cleanup.
- Capture bounded stdout/stderr.
- Pre/post workspace effect scan.
- Background/orphan process suspicion check where supported.
- Record result artifact.
- Redact/scan before continuation.

### Phase 3 - Continuation

- Build `command_execution_context@1`.
- Build context pack with command-result evidence.
- Build request manifest with `store=false`, one output item, and
  `previousResponseId=true`.
- Include workspace-change summary in provider output.
- Re-send harness and command-continuation policy.
- Send continuation.
- Fail closed on nested tools.

### Phase 4 - UI And Headless

- Command approval card.
- Running/result status items.
- Headless fixture scenarios.
- Raw-exposure scans.
- Sentinels.

## Acceptance Criteria

- Direct implementation lane exposes command execution readiness separately from
  read-only and patch readiness.
- Direct text-only command calls terminally block with no approval card and no
  process spawn.
- `run_command` approval appears only after complete parseable arguments and a
  valid command plan.
- Commands execute through workspace backend only, with `shell=false`.
- Cwd is project-relative and realpath-contained under the workspace root.
- V0 command support is explicit; package scripts are validated against local
  package manifests, and deferred well-known checks return
  `command_class_deferred`.
- Package script body policy is separate from provider argv shell-syntax policy.
- Shell syntax, interactive commands, background jobs, network tools, and
  unsupported command classes are rejected before approval.
- UI and provider output state that project code may still perform network or
  workspace writes unless backend sandboxing proves otherwise.
- Backend capability reporting covers process-tree cleanup, env sanitization,
  timeout kill, network isolation, and workspace effect scanning.
- Process cleanup kills child process trees where supported; unsupported cleanup
  blocks command execution in v0.
- Approval requires a fresh action token and idempotent
  `clientCommandDecisionId`.
- A process that has started is never automatically rerun after interruption or
  handoff uncertainty.
- Command stdout/stderr are capped, redacted, and represented with honest
  truncation flags.
- Command stdout/stderr hashes are local HMAC evidence keys or omitted from
  renderer/provider output by default.
- Redaction scans command plan, package script preview, stdout/stderr, provider
  output envelope, operation history, renderer card, and headless report.
- Workspace effects are scanned and included in command result/provider output,
  or unsupported scanning is explicitly recorded.
- Workspace changes detected by a command are visible in UI and provider output.
- Nonzero command exit is sent as command evidence, not treated as local
  transport failure.
- Decline/cancel ends locally in v0 and sends no provider continuation.
- Command execution state and command continuation state are separate.
- Command result continuation uses
  `direct_command_execution_continuation@1`, `store=false`, no tool
  declarations, one tool-output item, `previousResponseId=true`, and
  `parallelToolCalls=false`.
- Continuation provider input includes current harness and command policy.
- Nested read/patch/command tool calls after command result are terminal
  unsupported in v0.
- Command transcript uses stable item identities for request, approval, running
  status, result, continuation assistant, and terminal state.
- Headless fixtures cover workspace-changing command behavior.
- Operation ledger records command plan, decision, execution start/terminal,
  result, context, request, send, stream, and terminal events.
- Rollback to app-server is blocked while command execution or command
  continuation is active.
- Tests prove no app-server fallback, no right-pane mutation, no handoff
  mutation, no browser/MCP/network helper usage, and no direct text-only command
  execution.

## Final Boundary

Passing this bundle should mean:

```text
The Direct implementation lane can run one human-approved, bounded project
command/test step, record redacted result evidence, and send one lawful provider
continuation.
```

It should not mean:

```text
direct is production
general shell runtime is enabled
commands are auto-approved
network/browser/MCP tools are enabled
iterative patch-test-repatch loops are supported
project scripts are proven side-effect-free
right-pane ChatGPT is controlled
app-server can be removed
```
