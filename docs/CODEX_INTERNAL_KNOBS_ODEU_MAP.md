# Codex Internal Knobs ODEU Map

Status: design reference for mapping Codex runtime/config/protocol controls into
`codex-review-shell` capability and UX decisions.

Related specs:

- [APP_SERVER_CONTROLLER_SPEC.md](./APP_SERVER_CONTROLLER_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [CODEX_APP_SERVER_ONTOLOGY.md](./CODEX_APP_SERVER_ONTOLOGY.md)

Source baseline:

- Vanilla/fork protocol source: `/home/rose/work/codex/fork`
- Active local schema checked: `codex-rs/app-server-protocol/schema/typescript`
- Local fork branch during mapping: `codex/update-0.125-align`

This document is not a product settings wishlist. It is a control map for the
custom Codex UX: which Codex knobs exist, which are vanilla versus fork
extensions, what evidence proves they are available, and what UX posture is
lawful inside this standalone shell.

## Controller Rule

The shell must stay schema-led.

The controller may expose a Codex knob only when at least one of these evidence
sources confirms it for the attached executable:

1. Generated app-server schema for the active binary.
2. Runtime `initialize` / capability response.
3. Runtime method success from an explicit read-only or otherwise safe probe.
4. `config/read` output from that same binary, including extra fork keys.
5. A pinned bundled schema for a pinned executable version.

Do not infer fork capability from path names, project names, or old local config.
Do not execute destructive or state-shaping methods, such as `thread/prune/start`,
only to prove capability.

## ODEU Legend

`O` means the canonical object whose state the shell may represent.

`D` means the decision or knob the user, project, or controller can set.

`E` means the required evidence source before the UX can expose or enable that
knob.

`U` means the lawful UX posture in `codex-review-shell`.

## Capability Profile Extension

`WORKFLOW_TRANSITION_GRAPH_SPEC.md` already introduces
`CodexRuntimeCapabilityProfile`. For knob mapping, extend it with a normalized
knob profile:

```ts
type CodexKnobCapabilityProfile = {
  provenance: {
    binaryPath: string;
    codexVersion?: string;
    commitSha?: string;
    schemaSource: "generated" | "bundled" | "unknown";
    schemaGeneratedAt?: string;
    experimentalApi: boolean;
  };
  vanilla: {
    transports: TransportKnobs;
    thread: ThreadKnobs;
    turn: TurnKnobs;
    model: ModelKnobs;
    authority: AuthorityKnobs;
    config: ConfigKnobs;
    tools: ToolKnobs;
    serverRequests: ServerRequestKnobs;
    threadHistory: ThreadHistoryKnobs;
  };
  fork: {
    present: boolean;
    governance: ForkGovernanceKnobs;
    contextMaintenance: ForkContextMaintenanceKnobs;
    continuationBridge: ForkContinuationBridgeKnobs;
    threadMemory: ForkThreadMemoryKnobs;
    observability: ForkObservabilityKnobs;
  };
};
```

The renderer should consume this profile as evidence. It should not recompute
capabilities from raw config or raw schema strings in many places.

Capability profiles form a hierarchy, not parallel sources of truth:

```text
CodexRuntimeCapabilityProfile
  raw executable, transport, protocol, schema, and initialize evidence

CodexKnobCapabilityProfile
  normalized ODEU map of runtime/config/tool/server-request knobs

ShellVisibleCodexCapabilities
  renderer-safe projection used to gate visible affordances
```

The main process should own derivation. Renderers should receive the safe
projection plus diagnostics, not raw bearer tokens, raw schema blobs, or
unverified fork claims.

## UX Exposure Tiers

| Tier | Meaning | UX posture |
| --- | --- | --- |
| `core` | Needed for normal shell operation. | Visible and directly usable. |
| `safe-advanced` | Useful and reversible, but not needed every turn. | Visible in an advanced drawer or project settings. |
| `authority-sensitive` | Can change execution, permissions, or persistent policy. | Visible with evidence and explicit commit boundary. |
| `diagnostic` | Useful for debugging attached runtime behavior. | Read-only or copyable diagnostics. |
| `compatibility` | Supported to preserve behavior across older protocol shapes. | Render with a legacy label; do not promote as preferred UX. |
| `odeu-harness` | Belongs in deeper ADEU/ODEU control surfaces. | Do not build full editor in this shell; expose status or link-out only. |
| `hidden` | Removed, unsupported, or unsafe without deeper handling. | Hide or show disabled diagnostic only. |

## Vanilla Baseline / Inherited Knobs

These controls are available or discoverable in vanilla Codex through the
app-server protocol and config schema. The fork inherits them, but they do not
require fork-specific behavior. The shell should implement these before
fork-enhanced affordances.

### Runtime And Transport

| O | D | E | U |
| --- | --- | --- | --- |
| `CodexRuntime` | `binaryPath` | Project config plus app-server launch result. | `core`; show executable identity in diagnostics. |
| `CodexRuntime` | runtime host: `host`, `wsl`, `auto` | Shell project workspace kind and `codex-app-server.js` descriptor. | `core`; project-level runtime selector. |
| `CodexHome` | `CODEX_HOME` / source home | Selected `CodexThreadRef.sourceHome`, manager descriptor, process env. | `core`; visible because thread switching across homes depends on it. |
| `CodexTransport` | `ws://127.0.0.1:PORT` | Current managed app-server descriptor. | `core`; current default in this shell. |
| `CodexTransport` | `stdio://` | Generated schema is not enough; launch probe must pass. | `safe-advanced`; opt-in until parity checks pass. |
| `RemoteAuth` | bearer token file/env | Controller spec auth config and connection success. | `authority-sensitive`; main-process only, never renderer-visible token. |
| `ProtocolVersion` | schema source and `experimentalApi` | Generated schema plus initialize response. | `core`; always show in diagnostics. |
| `Readiness` | ready timeout / startup attempts | Shell env `CODEX_APP_SERVER_READY_TIMEOUT_MS`, `CODEX_APP_SERVER_STARTUP_ATTEMPTS`. | `diagnostic`; do not expose as normal user settings yet. |

Controller implication: transport choice gates every app-server action. A
disabled thread/turn control should explain missing transport evidence, not look
like an empty project.

### Thread Lifecycle

| O | D | E | U |
| --- | --- | --- | --- |
| `CodexThread` | `thread/start` | `ClientRequest` schema includes method and `ThreadStartParams`. | `core`; used by composer when no thread exists. |
| `CodexThread` | `thread/read` | `ClientRequest` schema includes method. | `core`; transcript visibility. |
| `CodexThread` | `thread/resume` | `ThreadResumeParams` schema and runtime success. | `core`; live attach/open selected thread. |
| `CodexThread` | `thread/fork` | `ThreadForkParams` schema. | `safe-advanced`; explicit new-thread affordance only. |
| `CodexThread` | `thread/list` filters: cursor, limit, sort, sourceKinds, archived, cwd, state DB only, search | `ThreadListParams` schema. | `core` for project/cwd filters; advanced for source/archive/state DB. |
| `CodexThread` | archive, unarchive, unsubscribe, set name, metadata update | `ClientRequest` method union. | `safe-advanced`; avoid destructive ambiguity. |
| `CodexThread` | `persistExtendedHistory` | `ThreadStartParams`, `ThreadResumeParams`, `ThreadForkParams`. | `core`; default `true` for this shell because richer resume/read rendering depends on it. |
| `CodexThread` | `experimentalRawEvents` | `ThreadStartParams` gated experimental field. | `diagnostic`; do not enable by default. |
| `CodexThread` | resume by `history` or `path` | `ThreadResumeParams` marks both unstable. | `diagnostic`; avoid user-facing control until needed. |

Controller implication: project activation and manual thread selection must
terminate in the same `SelectCodexThread` transition. Thread identity must carry
`threadId`, `sourceHome`, and preferably `sessionFilePath`.

### Thread Start Overrides

| O | D | E | U |
| --- | --- | --- | --- |
| `ThreadConfig` | `cwd` | `ThreadStartParams.cwd`, response `cwd`. | `core`; project workspace binding. |
| `ThreadConfig` | `model` | `ThreadStartParams.model`, `model/list`. | `core`; project-level selector. |
| `ThreadConfig` | `modelProvider` | `ThreadStartParams.modelProvider`, `config/read.model_provider`. | `safe-advanced`; needed for local providers. |
| `ThreadConfig` | `serviceTier` | `ThreadStartParams.serviceTier`. | `safe-advanced`; expose only if model/provider supports it. |
| `ThreadConfig` | `approvalPolicy` | `ThreadStartParams.approvalPolicy`. | `authority-sensitive`; clear safety copy. |
| `ThreadConfig` | `approvalsReviewer` | Experimental schema field and `config/read.approvalsReviewer`. | `authority-sensitive`; `auto_review` requires clear evidence. |
| `ThreadConfig` | `sandbox` / `permissionProfile` | `ThreadStartParams`; response includes canonical `permissionProfile`. | `authority-sensitive`; prefer permission profile over legacy sandbox when present. |
| `ThreadConfig` | `baseInstructions`, `developerInstructions`, `personality` | `ThreadStartParams` schema. | `safe-advanced`; project default drawer, not primary composer. |
| `ThreadConfig` | `ephemeral`, `sessionStartSource` | `ThreadStartParams` schema. | `diagnostic`; avoid broad UX until semantics are productized. |
| `ThreadConfig` | arbitrary `config` overrides | `ThreadStartParams.config`. | `odeu-harness`; raw override editor belongs outside v0 shell. |

### Turn Controls

| O | D | E | U |
| --- | --- | --- | --- |
| `CodexTurn` | `turn/start` with text input | `TurnStartParams.input`. | `core`; composer action. |
| `CodexTurn` | `turn/steer` | `ClientRequest` method union and non-steerable turn state. | `safe-advanced`; only while a live turn supports steering. |
| `CodexTurn` | `turn/interrupt` | `ClientRequest` method union. | `core`; visible while running. |
| `TurnConfig` | turn-level `cwd` | `TurnStartParams.cwd`. | `safe-advanced`; avoid accidental project drift. |
| `TurnConfig` | turn-level `model`, `serviceTier`, `effort`, `summary`, `personality` | `TurnStartParams` schema. | `safe-advanced`; compact per-turn controls. |
| `TurnConfig` | turn-level `approvalPolicy`, `approvalsReviewer`, `sandboxPolicy`, `permissionProfile` | `TurnStartParams` schema. | `authority-sensitive`; explicit change summary before submit. |
| `TurnConfig` | `outputSchema` | `TurnStartParams.outputSchema`. | `odeu-harness`; useful for structured tasks but too raw for base shell. |
| `TurnConfig` | `collaborationMode` | Experimental `TurnStartParams.collaborationMode`. | `diagnostic` or `odeu-harness`; do not infer from UI labels alone. |

### Model And Reasoning

| O | D | E | U |
| --- | --- | --- | --- |
| `ModelCatalog` | `model/list`, `includeHidden` | `ModelListParams`. | `core` for visible models; advanced toggle for hidden. |
| `ModelConfig` | `model`, `review_model`, `model_provider` | `config/read`, `ThreadStartParams`, project config. | `core` for model; advanced for provider/review model. |
| `ModelConfig` | `model_reasoning_effort` / turn `effort` | `ReasoningEffort` type and config. | `core` if project uses Codex heavily; otherwise safe-advanced. |
| `ModelConfig` | `model_reasoning_summary` / turn `summary` | `ReasoningSummary` type and config. | `safe-advanced`; rendering must distinguish summary from hidden/raw reasoning. |
| `ModelConfig` | `model_verbosity` | `Config` schema. | `safe-advanced`; GPT-5-specific copy. |
| `ModelConfig` | `model_context_window`, `model_auto_compact_token_limit` | `Config` schema. | `diagnostic`; users should not casually tune token windows. |
| `ModelConfig` | `model_catalog_json`, custom providers | Config TOML source, not v2 typed config. | `diagnostic`; surface active result, not raw editor. |

### Authority, Permissions, And Approval

| O | D | E | U |
| --- | --- | --- | --- |
| `ApprovalPolicy` | `untrusted`, `on-failure`, `on-request`, granular policy, `never` | `AskForApproval` schema. | `authority-sensitive`; must show risk impact. |
| `ApprovalsReviewer` | `user`, `auto_review`, `guardian_subagent` | `ApprovalsReviewer` schema and experimental config field. | `authority-sensitive`; `guardian_subagent` is compatibility-sensitive. |
| `SandboxMode` | `read-only`, `workspace-write`, `danger-full-access` | `SandboxMode` schema. | `authority-sensitive`; `danger-full-access` needs explicit confirmation. |
| `PermissionProfile` | managed, disabled, external | `PermissionProfile` schema and thread response. | `authority-sensitive`; canonical permissions view when available. |
| `CommandApproval` | command/network approval decisions | `item/commandExecution/requestApproval`. | `core`; primary request card. |
| `FileChangeApproval` | patch/file approval decisions | `item/fileChange/requestApproval`. | `core`; block approval when diff is unavailable. |
| `PermissionsApproval` | additional permissions | `item/permissions/requestApproval` or command `additionalPermissions`. | `authority-sensitive`; grant subset only. |
| `LegacyApproval` | `execCommandApproval`, `applyPatchApproval` | `ServerRequest` union. | `compatibility`; support but label as legacy. |

Controller implication: authority controls are not ordinary preferences. They
need evidence, visible current state, and an explicit commit boundary.

### Server-Initiated Requests

| O | D | E | U |
| --- | --- | --- | --- |
| `PendingCodexServerRequest` | command execution approval | `ServerRequest` union. | `core`; inline card plus middle-plane queue. |
| `PendingCodexServerRequest` | file change approval | `ServerRequest` union plus item/diff correlation. | `core`; evidence-before-approve. |
| `PendingCodexServerRequest` | tool user input | `item/tool/requestUserInput`. | `core` once schema is verified; explicit user answer. |
| `PendingCodexServerRequest` | MCP elicitation | `mcpServer/elicitation/request`. | `safe-advanced`; URL/form modes with safe external-open rules. |
| `PendingCodexServerRequest` | permissions approval | `item/permissions/requestApproval`. | `authority-sensitive`; subset grant. |
| `PendingCodexServerRequest` | dynamic tool call | `item/tool/call`. | `hidden` in v0 except diagnostic unsupported response. |
| `PendingCodexServerRequest` | ChatGPT token refresh | `account/chatgptAuthTokens/refresh`. | `hidden` in v0 except diagnostic unsupported response. |
| `PendingCodexServerRequest` | unknown method | Runtime JSON-RPC request. | `diagnostic`; store, show, send unsupported error. |

### Config And Profiles

| O | D | E | U |
| --- | --- | --- | --- |
| `CodexConfig` | `config/read` effective config | `ConfigReadParams`, active app-server response. | `core`; source for capability diagnostics. |
| `CodexConfig` | include layers | `ConfigReadParams.includeLayers`. | `diagnostic`; useful for conflict explanation. |
| `CodexConfig` | `config/value/write` | `ConfigValueWriteParams`. | `authority-sensitive`; write preview required. |
| `CodexConfig` | `config/batchWrite` with hot reload | `ConfigBatchWriteParams`. | `authority-sensitive`; batch diff and expected version required. |
| `Profile` | active `profile`, named `profiles` | `Config` and `ProfileV2`. | `safe-advanced`; good project-level selector. |
| `ConfigRequirements` | allowed approval/sandbox/reviewer values | `configRequirements/read`. | `core` for disabling illegal UI options. |
| `ExperimentalFeature` | list and enablement set | `experimentalFeature/list`, `experimentalFeature/enablement/set`. | `safe-advanced`; never auto-enable under-development features. |

Config write UX must show target file, expected version, key path, old value,
new value, and reload behavior before commit.

### Tools, Apps, MCP, Skills, Plugins

| O | D | E | U |
| --- | --- | --- | --- |
| `FeatureFlags` | `[features]` toggles | `experimentalFeature/list`, config schema, runtime feature behavior. | `safe-advanced`; stable flags only by default. |
| `ShellTool` | `shell_tool`, `unified_exec`, shell snapshot, zsh fork | Feature registry and generated tool behavior. | `diagnostic` in shell; command approval cards are primary UX. |
| `WebSearch` | config `web_search`, `tools.web_search` | `Config`, `ToolsV2`, feature flags. | `safe-advanced`; show cached/live/disabled distinction. |
| `ViewImage` | `tools.view_image` | `ToolsV2`. | `safe-advanced`; capability indicator. |
| `Apps` | app list, app tool approvals | `app/list`, `Config.apps`, app tool config. | `safe-advanced`; do not build full app marketplace editor first. |
| `McpServer` | status, reload, OAuth login, resource read, tool call | `mcpServer*` and `mcpServerStatus/list` methods. | `safe-advanced`; MCP execution remains authority-sensitive. |
| `Skills` | list and config write | `skills/list`, `skills/config/write`. | `safe-advanced`; source roots should be visible. |
| `Plugins` | list/read/install/uninstall, marketplace add/remove/upgrade | plugin and marketplace methods. | `safe-advanced`; install/uninstall needs explicit commit boundary. |
| `ExperimentalTools` | JS REPL, code mode, image generation, browser use, computer use | Feature registry plus tool availability. | Capability badge first; real controls only when UX can render evidence and failure states. |

### Filesystem, Command, Account, And Feedback Methods

These are app-server methods, but they are not all appropriate as direct shell
controls.

| O | D | E | U |
| --- | --- | --- | --- |
| `Filesystem` | `fs/readFile`, `fs/writeFile`, `fs/remove`, `fs/copy`, watch/unwatch | `ClientRequest` union. | `odeu-harness`; use for controlled artifacts, not a generic file manager first. |
| `CommandProcess` | `command/exec`, write, resize, terminate | `ClientRequest` union. | `odeu-harness`; separate trust model from Codex tool approvals. |
| `ThreadShellCommand` | `thread/shellCommand` | `ClientRequest` union, unsandboxed note in schema. | `hidden` unless a clear operator terminal is designed. |
| `Account` | login/logout/read/rate limits | Account methods. | `diagnostic` or setup flow only. |
| `Feedback` | `feedback/upload` | `ClientRequest` union. | `hidden` unless product support flow exists. |

## Fork-Enhanced Knobs

These controls are specific to this fork or are vanilla methods whose semantics
are materially enhanced by fork code. They must be disabled for vanilla Codex
unless capability evidence confirms them.

### Fork Detection And Evidence

Do not use a path substring such as `/codex/fork` as proof.

Acceptable evidence:

- `config/read` returns fork-only extra keys such as `governance_path_variant`,
  `compaction_engine`, or `continuation_bridge_variant`.
- Generated schema includes fork-added methods such as `thread/refresh/start`
  and `thread/prune/start`.
- A runtime probe for a fork method succeeds on the active app-server.
- The executable identity includes a verified commit/version marker from the
  launched binary or build metadata.
- A rendered thread contains fork artifact blocks such as `<thread_memory>` or
  `<continuation_bridge>`, but this proves historical artifact presence only,
  not that the current runtime supports creating new ones.

### Governance Path

| O | D | E | U |
| --- | --- | --- | --- |
| `ForkGovernancePath` | `governance_path_variant=off` | `config/read` extra key or config schema from fork. | `safe-advanced`; show as disabled governance. |
| `ForkGovernancePath` | `strict_v1_shadow` | Same plus prompt-layer artifact visibility in request/rollout when active. | `safe-advanced`; recommended visible fork mode. |
| `ForkGovernancePath` | `strict_v1_enforce` | Same plus explicit user choice. | `authority-sensitive`; can block transitions and alter prompt layering. |
| `PromptLayerPacket` | constitutional, role, task, runtime layers | Fork prompt-layer request payloads or rollout artifacts. | `diagnostic`; show compiled layer status, not raw editing in shell v0. |
| `GovernanceDiagnostics` | compile errors, missing packet fallback semantics | Fork diagnostics in generated prompt-layer payload. | `diagnostic`; useful for explaining behavior. |

UX posture: the shell may show a governance status pill and diagnostics panel.
It should not become the packet authoring environment. Packet authoring belongs
in a deeper ODEU harness unless separately scoped.

### Context Maintenance And Compaction

| O | D | E | U |
| --- | --- | --- | --- |
| `CompactionEngine` | `remote_vanilla` | Fork config enum. | `safe-advanced`; compatibility mode. |
| `CompactionEngine` | `remote_hybrid` | Fork config enum, default in fork. | `safe-advanced`; show as fork default when detected. |
| `CompactionEngine` | `local_pure` | Fork config enum. | `authority-sensitive`; may change history shaping without remote compact endpoint. |
| `ContextMaintenanceModel` | `context_maintenance_model`, including `current_thread` | Fork config extra key. | `safe-advanced`; advanced model routing. |
| `ContextMaintenanceReasoning` | `current_thread`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | Fork config enum. | `safe-advanced`; keep out of primary composer. |
| `ThreadRefresh` | `thread/refresh/start` | Generated `ClientRequest` method plus runtime success. | `safe-advanced`; explicit maintenance action. |
| `ThreadPrune` | `thread/prune/start` | Generated `ClientRequest` method plus runtime success. | `authority-sensitive`; destructive/shape-changing semantics. |

UX posture: refresh/prune/compact controls need a status surface that distinguishes
requested, running, completed, failed, and unsupported. They should not look like
normal chat messages.

### Continuation Bridge

| O | D | E | U |
| --- | --- | --- | --- |
| `ContinuationBridge` | `continuation_bridge_variant=baton` | Fork config enum. | `safe-advanced`; compact continuity mode. |
| `ContinuationBridge` | `continuation_bridge_variant=rich_review` | Fork config enum. | `safe-advanced`; heavier review continuity mode. |
| `ContinuationBridge` | `continuation_bridge_model` | Fork config extra key. | `safe-advanced`; model override for bridge generation. |
| `ContinuationBridge` | `continuation_bridge_reasoning_effort` | Fork config extra key. | `safe-advanced`; advanced only. |
| `ContinuationBridge` | inline prompt override / file prompt override | Fork config extra keys. | `odeu-harness`; authoring prompt templates is not a base shell setting. |
| `ContinuationBridgeArtifact` | `<continuation_bridge>` tagged developer item | Transcript/rollout evidence. | `diagnostic`; render as continuity artifact, not assistant content. |
| `ContinuationBridgeSubagents` | `<continuation_bridge_subagents>` supplement | Transcript/rollout evidence. | `diagnostic`; useful for continuity debugging. |

UX posture: bridge artifacts are operational context, not conversational content.
Render them in a collapsible context-maintenance lane if surfaced at all.

### Thread Memory

| O | D | E | U |
| --- | --- | --- | --- |
| `ThreadMemoryGovernance` | disabled when governance path is `off` | Fork route matrix behavior and config. | `diagnostic`; explain why memory is inactive. |
| `ThreadMemoryGovernance` | enabled when strict governance path is shadow/enforce | Fork route matrix behavior and config. | `safe-advanced`; status only by default. |
| `ThreadMemoryArtifact` | `<thread_memory>` tagged developer item | Transcript/rollout evidence. | `diagnostic`; render as memory artifact, not chat message. |
| `ThreadMemoryRefresh` | generated before remote compact in strict mode | Fork runtime tests and artifacts. | `diagnostic`; expose last refresh result when available. |

UX posture: do not build a memory editor in `codex-review-shell` v0. The useful
control is visibility: whether memory is active, when it refreshed, and whether
the active thread contains memory artifacts.

### Fork Observability And Multi-Agent Controls

| O | D | E | U |
| --- | --- | --- | --- |
| `AgentProgress` | model-visible `inspect_agent_progress` | Tool availability in active tool plan or transcript/tool call evidence. | `diagnostic`; show progress when present, not as a standalone orchestrator. |
| `AgentProgress` | model-visible `wait_for_agent_progress` | Same. | `diagnostic`; not a user action in shell v0. |
| `SubagentToolSurface` | thread-spawn containment rules | Fork tests/tool-plan evidence; hard to inspect via app-server today. | `diagnostic`; no direct UX until app-server exposes tool plan. |
| `CollabTools` | `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, `list_agents` | Feature flags plus tool plan/transcript evidence. | `odeu-harness`; shell may display activity, not manage choreography. |
| `SemanticBroker` | `semantic_broker` feature | Feature registry says under development. | `hidden`; do not expose without explicit runtime contract. |

UX posture: multi-agent internals are high-power orchestration state. The
standalone shell should show evidence and diagnostics, while deeper ADEU/ODEU
surfaces own authoring and choreography controls.

## Vanilla Versus Fork Separation Rules

1. Vanilla controls are schema-derived app-server methods, typed config fields,
   server requests, and feature flags present in the active generated schema.
2. Fork controls are extra config keys, fork-added methods, fork artifacts, or
   model-visible tools whose behavior depends on fork code.
3. Fork controls must be absent or disabled when the capability profile cannot
   prove fork support.
4. A historical artifact in a transcript is not proof that the currently attached
   binary can generate or maintain that artifact.
5. Removed compatibility flags, especially `tui_app_server`, must never appear
   as live UX switches.
6. `remote_control` is not the shell control plane for v0; app-server JSON-RPC is.
7. Raw `config` overrides on thread start/resume are ODEU-harness controls, not
   normal project settings.

## Proposed Capability Buckets For The Shell

Use these buckets when implementing `CodexRuntimeCapabilityProfile`:

```ts
type ShellVisibleCodexCapabilities = {
  coreRuntime: {
    canConnect: boolean;
    transports: Array<"websocket" | "stdio">;
    canInitialize: boolean;
    schemaSource: "generated" | "bundled" | "unknown";
  };
  threads: {
    canStart: boolean;
    canRead: boolean;
    canResume: boolean;
    canList: boolean;
    canFork: boolean;
    canPersistExtendedHistory: boolean;
  };
  turns: {
    canStart: boolean;
    canSteer: boolean;
    canInterrupt: boolean;
    canOverrideModel: boolean;
    canOverrideReasoning: boolean;
    canUseOutputSchema: boolean;
  };
  authority: {
    approvalPolicies: string[];
    approvalsReviewers: string[];
    sandboxModes: string[];
    permissionProfile: boolean;
    commandApproval: boolean;
    fileChangeApproval: boolean;
    permissionsApproval: boolean;
  };
  requests: {
    supportedServerMethods: string[];
    unsupportedButHandledMethods: string[];
    unknownRequestPolicy: "error-visible" | "drop-risk";
  };
  fork: {
    present: boolean;
    governancePath: boolean;
    contextMaintenance: boolean;
    continuationBridge: boolean;
    threadMemoryArtifacts: boolean;
    refreshPruneMethods: boolean;
    agentProgressArtifacts: boolean;
  };
};
```

Unknown capability behavior:

- keep project and ChatGPT surfaces usable
- allow read-only Codex transcript rendering from local logs
- disable live Codex controls that require app-server proof
- disable fork-only affordances
- show a compact capability diagnostics panel

## Current Shell Integration Points

| Area | Current file | Mapping implication |
| --- | --- | --- |
| App-server process launch | `src/main/codex-app-server.js` | Add executable/schema identity and transport evidence here. |
| JSON-RPC session and request registry | `src/main/codex-surface-session.js` | Attach capability profile to connection id; keep request methods schema-derived. |
| Codex surface thread/turn calls | `src/renderer/codex-surface.js` | Gate `thread/start`, `thread/resume`, `turn/start`, and request cards from profile evidence. |
| Middle-plane pending request queue | `src/renderer/app.js` | Consume summarized request evidence; avoid raw policy editing. |
| Project/thread transition model | `docs/WORKFLOW_TRANSITION_GRAPH_SPEC.md` | Treat capability profile as the evidence object for all Codex UX actions. |
| Controller safety spec | `docs/APP_SERVER_CONTROLLER_SPEC.md` | This map supplies the knob taxonomy behind that controller. |

## Recommended Implementation Order

1. Add generated-schema metadata and method extraction to the app-server manager.
2. Build `CodexRuntimeCapabilityProfile` and expose it to both Codex surface and
   middle plane.
3. Gate current thread/turn actions and server request cards from the profile.
4. Add main-process `ActivationEpoch` guards for project/surface loading.
5. Add `codex-surface:thread-state` evidence so active-thread truth follows
   rendered/live-attached state, not request acceptance.
6. Add vanilla settings surfaces for model, reasoning effort, approval policy,
   sandbox/permission profile, and transport diagnostics.
7. Add fork diagnostics for governance, context maintenance, continuation bridge,
   and thread memory only after fork evidence is present.
8. Add fork actions `thread/refresh/start` and `thread/prune/start` only with
   clear maintenance-state rendering and explicit commit boundaries.
9. Keep raw config override editing, prompt packet authoring, memory editing, and
   multi-agent choreography for a deeper ODEU harness.

## Validation Questions

Before exposing any new Codex knob, answer:

1. Which ODEU object owns this state?
2. Which generated schema type or runtime probe proves it exists?
3. Is the knob vanilla, fork-enhanced, or unknown for this executable?
4. Does changing it affect authority, execution, persistence, or prompt law?
5. What current state and evidence must be visible before commit?
6. What does the shell show when the knob is unsupported?
7. Does this belong in the standalone shell or in a deeper ODEU harness?
