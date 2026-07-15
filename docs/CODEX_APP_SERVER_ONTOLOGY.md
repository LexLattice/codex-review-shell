# Codex App-Server Ontology Reference

Purpose: stable reference for the canonical Codex thread/message ontology used by this app's middle-plane renderer.

Last verified:
- Codex fork: `/home/rose/work/codex/fork` at `8c68d4c87dc5`
  (`rust-v0.144.4`)
- Active Review Shell WSL CLI: npm-global `@openai/codex@0.145.0-alpha.11`
  at `/home/rose/.nvm/versions/node/v24.14.0/bin/codex`
- Review shell repo: `/home/rose/work/LexLattice/codex-review-shell-direct`
  working tree based on `793e5d4eb3bb`
- Prior inspected release baseline: `rust-v0.142.3`
- Verification date: 2026-07-15

## Why this exists

We had a rendering bug where final assistant output was sometimes grouped under "Thought process".
Root cause: local phase heuristics drifted from Codex canonical `MessagePhase` semantics.

Canonical fix rule:
- Treat assistant message phase `commentary` as thought-process text.
- Treat `final_answer` as final assistant output.
- Treat missing/unknown phase as final assistant output (not thought).

## Release 144 Architectural Baseline And Delta

At release 144, app-server exposes a more complete execution world rather than
only a linear chat transcript. The list combines current baseline capabilities
with changes since the prior `0.142.3` inspection; it does not claim that every
listed primitive first appeared in `0.144.4`:

- `thread/list` can filter direct children or all spawned descendants;
  archive/delete also follow persisted spawn edges.
- Codex core now owns spawned-agent topology behind an `AgentGraphStore` used by
  spawn, close, recursive resume, subtree traversal, archive/delete, and
  feedback paths. This is an authoritative delegation-graph object, but it
  stores topology/lifecycle rather than scoped constitutions or closure reports.
- `thread/fork` can fork through an exact completed `lastTurnId`; resume/fork
  can omit inline turns and page them separately.
- `thread/turns/list` and `thread/items/list` page canonical persisted history
  without resuming the thread. `thread/items/list` can be restricted to one
  `turnId`, but only when the active thread store supports item pagination.
- `environment/add` and `environment/info` make environment identity, native
  shell, and native cwd URI explicit. Thread/turn `environments` select the
  execution worlds, while `selectedCapabilityRoots` bind skills/plugins and
  their MCP runtime to an owning environment.
- Remote-control pairing/status and remote plugin catalog/install-policy
  methods are app-server control-plane capabilities, not ordinary thread items.
- Account rate-limit reads can include typed reset-credit detail rows; reset
  consumption is an idempotent account mutation with optional credit ID.
- App MCP approval posture now includes a `writes` mode, between always-prompt
  and blanket approval. Interactive MCP auth is enabled by default.
- Hosts can supply external Codex authentication and request a hosted success
  redirect for login.
- Effective thread settings are emitted as full snapshots. Persisted model and
  reasoning-effort metadata are restored on resume unless the caller supplies
  an explicit current override. This is substantive thread-local control-state
  continuity, not yet a nested turn/session/project/global control ledger.

Capability caveats:

- `thread/items/list` is experimental and returns JSON-RPC `-32601` when the
  active thread store lacks item pagination.
- `ThreadHistoryMode::Paginated` is represented in protocol and metadata, but
  the current local and in-memory writers reject creation/resume in that mode;
  it is scaffold rather than a generally usable storage mode.
- `environment/info` is an explicit environment probe, but project workspace
  authority and all runtime roots are not thereby made environment-owned.

## Managed Shell Orchestration Compatibility And Alpha Activation

The active project is hosted by the Windows Review Shell but its managed
app-server is routed through Ubuntu WSL to the npm-global Codex alpha. The
source-audit fork remains at stable `0.144.4`; the runtime binary is a separate
installation.

Every managed app-server launch preserves the hosted V2 reserved schema base:

```text
-c features.multi_agent_v2.hide_spawn_agent_metadata=true
```

The disabled profile also sets
`features.multi_agent_v2.expose_spawn_agent_model_overrides=false` explicitly,
because the alpha defaults that narrower capability on. The project-scoped
enabled profile changes only that value to `true`.

This explicit guard corrects an earlier shell profile that set the value to
`false`. On `0.144.4`, the false value changes the provider-reserved
`collaboration.spawn_agent` schema by adding `agent_type`, `model`,
`reasoning_effort`, and `service_tier` (and by changing its output shape).
Hosted GPT-5.6 rejects that client-mutated schema before inference.

The project-scoped alpha profile additionally requests the upstream narrow
split:

```text
-c features.multi_agent_v2.expose_spawn_agent_model_overrides=true
```

`0.145.0-alpha.11` contains commits `ea15456284` and `92938d880e`, so its
canonical visible V2 input surface is:

```text
task_name
message
fork_turns
model
reasoning_effort
```

`agent_type` and `service_tier` remain hidden and the output remains
`task_name` rather than the nickname-bearing broad form. Disabling the project
control returns to the stable three-field/provider-managed profile.

The root orchestration control remains reasoning effort: `ultra` selects the
upstream proactive posture and lower efforts retain explicit-request
delegation. Root effort selection does not imply per-spawn child model/effort
authority. On the stock release-144 path those choices are provider-managed,
whereas the enabled alpha path lets the root request them within the active
multi-agent backend. Any model/effort later reported on collaboration items is
still the stronger runtime evidence.

The fork transition law remains relevant to future worker profiles:

```text
fork_turns = all (including omission)
  -> child inherits parent model, effort, and role
  -> model/effort overrides are rejected

fork_turns = none or a positive bounded turn count
  -> alpha path may request model/effort
  -> a configured default child role may also be applied
```

Because hidden metadata does not expose `agent_type`, named-role selection is
not currently available to the root. A later compatibility slice may map one
shell-selected lower-effort worker profile to Codex's `default` agent role for
bounded/fresh forks without changing the reserved tool schema.

For new enabled tasks, the project profile is also projected as a thread-start
developer instruction: bounded specialist work prefers `fork_turns=none`, Low
effort, and an omitted model so the active backend chooses a compatible child.
This cost/profile preference does not broaden worker action authority.

The active runtime now adopts upstream's model/effort-only exposure switch.
The project setting is still a requested-capability fact: the selected binary,
active model/backend, and child collaboration result must witness actual
acceptance. It must not be inferred merely from the checkbox.

An app-server `gpt-5.6-sol` Ultra provider smoke accepted the split reserved
schema without the former tools 400. A fresh low-effort child request emitted
canonical `childActivity`, completed its collaboration wait, and returned to
the root. Because that child activity did not expose an effective runtime
profile, a later canonical child runtime item is still required before claiming
the requested effort was actually applied.

The multi-agent version is sticky per task. A fresh task can adopt current V2
metadata, but it cannot repair the old process-wide malformed schema: the
review shell/app-server must first restart under the corrected descriptor.

Workers remain parent-mediated and read-only from the operator's perspective:
their activity, output, model, and effort evidence may be inspected, but the
shell adds neither a user-to-worker composer nor client-side spawn authority.

The Windows PATH Codex and vanilla desktop's bundled WSL Codex remain distinct
runtimes. Both Review Shell launchers default WSL tasks to the logged-in
`/home/rose/.codex` account/runtime home plus the WSL npm binary; the
repo-local `.codex-home` remains isolated but is not currently authenticated.
An enabled split profile also preserves the configured WSL command for
tasks sourced from the desktop home, so their auth/history home cannot silently
substitute the older bundled executable. The disabled fallback profile may
still use the home-bundled route and therefore has its own capability posture.

Detailed shell contract:
[Codex App-Server Orchestration Controls Spec](./CODEX_APP_SERVER_ORCHESTRATION_CONTROLS_SPEC.md).

The protocol now has a clearer canonical/compatibility direction:

```text
core TurnItem
  -> app-server ThreadItem + lifecycle
  -> legacy event fan-out when compatibility requires it
```

Command, dynamic-tool, collaboration, sub-agent, hook, review, and
extension-owned activity should be read from canonical items when available,
not reconstructed from legacy event names.

## Canonical message phase ontology

Source:
- `codex-rs/protocol/src/models.rs` (`MessagePhase`)
- `codex-rs/app-server-protocol/schema/typescript/MessagePhase.ts`

Enum values:
- `commentary`
- `final_answer`

Design note from upstream:
- Providers may not emit phase consistently.
- Consumers must preserve compatibility behavior when phase is absent.

## Canonical thread item ontology (v2)

Source:
- `codex-rs/app-server-protocol/src/protocol/v2/item.rs` (`ThreadItem`)
- `codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`

`ThreadItem` variants:
- `userMessage { id, clientId?, content[] }`
- `hookPrompt { id, fragments[] }`
- `agentMessage { id, text, phase?, memoryCitation? }`
- `plan { id, text }`
- `reasoning { id, summary[], content[] }`
- `commandExecution { id, command, cwd, processId?, source, status, commandActions[], aggregatedOutput?, exitCode?, durationMs? }`
- `fileChange { id, changes[], status }`
- `mcpToolCall { id, server, tool, status, arguments, appContext?, mcpAppResourceUri?, pluginId?, result?, error?, durationMs? }`
- `dynamicToolCall { id, namespace?, tool, arguments, status, contentItems?, success?, durationMs? }`
- `collabAgentToolCall { id, tool, status, senderThreadId, receiverThreadIds[], prompt?, model?, reasoningEffort?, agentsStates }`
- `subAgentActivity { id, kind, agentThreadId, agentPath }`
- `webSearch { id, query, action? }`
- `imageView { id, path }`
- `sleep { id, durationMs }`
- `imageGeneration { id, status, revisedPrompt?, result, savedPath? }`
- `enteredReviewMode { id, review }`
- `exitedReviewMode { id, review }`
- `contextCompaction { id }`

Release-144 notes:
- `userMessage.content[]` image variants preserve requested image fidelity:
  `image { url, detail? }` and `localImage { path, detail? }`.
- The current `ImageDetail` values are `auto | low | high | original`; consumers
  must preserve future/unknown compatibility rather than assuming the narrower
  release-132 pair.
- `contextCompaction { id }` remains the app-server thread item used to show
  compaction activity, even though the lower Responses history now distinguishes
  `compaction_trigger` input from encrypted `compaction` output.
- `subAgentActivity` is distinct from `collabAgentToolCall`: the former records
  child lifecycle/activity, while the latter records a collaboration operation.
- `mcpToolCall.appContext` and `pluginId` preserve connector/plugin provenance;
  the top-level `mcpAppResourceUri` is deprecated compatibility data.

## Streaming lifecycle ontology

Source:
- `codex-rs/app-server/README.md` (Items section)
- `codex-rs/app-server-protocol/src/protocol/common.rs` (notification method names)

Lifecycle:
- `item/started`: first full item snapshot.
- `item/completed`: authoritative final item snapshot.

Delta streams:
- `item/agentMessage/delta` -> incremental assistant text by `itemId`.
- `item/plan/delta` -> plan text deltas (experimental).
- `item/reasoning/summaryTextDelta` + `item/reasoning/summaryPartAdded`.
- `item/reasoning/textDelta` (raw reasoning content path).
- `item/commandExecution/outputDelta`.
- `item/commandExecution/terminalInteraction`.
- `item/fileChange/patchUpdated`, `item/fileChange/outputDelta`.
- `item/mcpToolCall/progress`.

Related process streams exist outside the ordinary item-delta namespace:

- `command/exec/outputDelta` for app-server-managed exec sessions.
- experimental `process/outputDelta` and `process/exited` for spawned processes.

Important:
- Reconstruct full state by applying deltas, then trust `item/completed` as final state.

## Persistence ontology (on-disk rollout history)

Source:
- `codex-rs/protocol/src/protocol.rs` (`RolloutItem`, `EventMsg`, `SessionMeta`)
- `codex-rs/protocol/src/models.rs` (`ResponseItem`)
- `codex-rs/app-server-protocol/src/protocol/thread_history.rs` (history reducer)

Persisted line item union:
- `session_meta`
- `response_item`
- `inter_agent_communication` (legacy model-visible delivery)
- `inter_agent_communication_metadata` (local delivery metadata)
- `compacted`
- `turn_context`
- `world_state`
- `event_msg`

Historical reconstruction:
- App-server rebuilds turns by reducing persisted `RolloutItem` + `EventMsg` into v2 `ThreadItem` turns.
- `EventMsg::AgentMessage` carries `phase`.
- `TurnItem::AgentMessage` preserves that phase into v2 `ThreadItem::AgentMessage`.
- Paginated history preserves canonical item IDs and turn IDs so
  `thread/items/list` does not need to infer item membership from display order.
- `world_state` stores a full baseline or patch used by Codex core to restore
  model-visible world-state diffing. It is context/persistence evidence, not a
  `ThreadItem` and not normal transcript text. The legacy app-server history
  projection currently recognizes and ignores this rollout variant rather than
  exposing a typed public world-state item.

## Thread Graph And History Ontology

- `thread.parentThreadId` is the immediate persisted spawn parent when known.
- `thread/list { parentThreadId }` returns direct spawned children.
- `thread/list { ancestorThreadId }` returns spawned descendants at any depth.
- Review and Guardian threads are excluded from these spawn-edge filters.
- `thread/fork { lastTurnId }` copies history through that completed turn,
  inclusive. An in-progress target is rejected.
- `excludeTurns` avoids embedding full history in resume/fork responses;
  `thread/turns/list` and `thread/items/list` become the authoritative page
  channels when the selected store supports the requested pagination method.
- Forking a mid-turn thread without `lastTurnId` records an interruption marker
  instead of silently inheriting an unmarked partial suffix.

Rendering law:

```text
spawn lineage != fork lineage != live session tree
```

Preserve `parentThreadId`, `forkedFromId`, and `sessionId` separately.

## Environment And Capability-Root Ontology

- `environment/add` registers or replaces a named remote execution environment.
- `environment/info` returns its detected shell and default cwd as an
  environment-native canonical `file:` URI.
- Thread-level `environments` are sticky defaults; turn-level `environments`
  override them for one turn. Omitted, empty, and explicit lists have different
  meanings.
- `selectedCapabilityRoots` names environment-owned skill/plugin roots using
  that environment's native absolute paths.
- Stdio MCP servers from a selected plugin start in the owning environment;
  HTTP MCP uses that environment's HTTP client.

Deontic law:

```text
environment exists
  != capability selected
  != tool authorized
  != workspace mutation authority
```

## Session/thread source ontology

Source:
- `codex-rs/protocol/src/protocol.rs` (`SessionSource`)
- `codex-rs/app-server-protocol/schema/typescript/v2/SessionSource.ts`
- `codex-rs/app-server-protocol/schema/typescript/v2/ThreadSourceKind.ts`

Observed source families:
- `cli`
- `vscode`
- `exec`
- `appServer`/`mcp`
- `subAgent` variants
- `custom`
- `unknown`

This matters for list/filter behavior; do not hardcode only `vscode` sources.

## Permission Profile Ontology

Source:
- `codex-rs/app-server-protocol/schema/typescript/v2/ActivePermissionProfile.ts`
- `codex-rs/app-server-protocol/schema/typescript/v2/Config.ts`

Current posture:
- App-server exposes named permission profiles and active profile provenance;
  selected profiles can inherit through `extends`, reflected by an optional
  parent profile identifier.
- Thread start/resume/fork responses still expose legacy `sandbox` and
  approval-policy fields, but exact permission provenance should be read as
  `activePermissionProfile` when present.
- Shell clients should treat profile IDs as provenance/status evidence, not as a
  full permission policy export.
- Command approval requests may provide `availableDecisions`, additional
  filesystem/network permissions, and proposed persistent policy amendments.
  Render what the server actually offers; do not manufacture a generic yes/no
  permission box.

Compatibility changes to preserve explicitly:

- `AskForApproval::OnFailure` is no longer a current approval-policy value.
- `AuthMode::Headers` is an externally supplied request-header mode; it must not
  be rendered as a signed-in human ChatGPT account.
- `SessionBudgetExceeded` is a distinct typed failure, not a generic turn error.
- `thread/rollback` is deprecated compatibility surface.
- MCP startup failure can name `reauthenticationRequired`, which should route to
  reconnect UX rather than ordinary retry.

## Thread Control-State Ontology

- `thread/settings/update` changes a loaded thread's effective next-turn
  settings without starting a turn or adding transcript content.
- `thread/settings/updated` emits the full effective settings only when they
  actually change.
- Core persists `ThreadSettingsAppliedEvent` with model, provider, service tier,
  approval/reviewer posture, permission profile, cwd, reasoning effort/summary,
  personality, and collaboration mode.
- Thread metadata now retains model and reasoning effort, and resume uses those
  values unless an explicit current model/provider/effort override is supplied.

Control law:

```text
visible knob change
  -> explicit thread settings transition
  -> persisted thread-local metadata

but not yet
  -> scoped and durable constitutional control ledger
```

Direct still needs scope (`turn | session | thread | project | global`),
durability, authority/rationale, revision provenance, and a compact effective
control snapshot if those controls are to participate in the active ODEU world.

## Middle-plane rendering rules (policy for this repo)

1. Assistant message classification:
- `phase === "commentary"` -> thought process bucket.
- `phase === "final_answer"` -> regular assistant bubble.
- `phase missing/null/unknown` -> regular assistant bubble.

2. Tool and reasoning grouping:
- Keep reasoning/tool-like items collapsed by default.
- Never hide final assistant output inside thought groups.

3. Delta handling:
- `item/agentMessage/delta` should route by `itemId`.
- Route to thought bucket only if the tracked item phase is `commentary`.

4. Historical transcripts:
- When phase is present in stored transcript entries, apply same rule.
- If phase is absent in stored entries, treat as regular assistant output.

## Bug pattern we hit (for future audits)

Anti-pattern:
- "Non-empty phase and not in a local final-ish keyword list" => thought.

Why it failed:
- Canonical final identifier is `final_answer`, not `final`/`answer`/`completed`.
- Unknown phase values must not be interpreted as thought by default.

Correct strategy:
- Whitelist-only thought classification (`commentary`), not blacklist-final classification.

## Fast re-validation checklist

When upstream changes:
- Re-check `MessagePhase` enum in protocol and generated schema.
- Re-check `ThreadItem::AgentMessage` fields.
- Re-check the complete `ThreadItem` union and canonical core `TurnItem` map.
- Re-check `ServerNotification` methods for item lifecycle and deltas.
- Re-check thread graph filters, fork-through-turn behavior, and paginated
  turn/item history methods.
- Re-check environment methods, thread/turn selection semantics, and capability
  root ownership.
- Re-check permission-profile provenance, approval decisions, and account
  mutation request shapes.
- Re-check thread settings snapshots, persisted resume fallback, and explicit
  override precedence.
- Re-check experimental history methods against the actually selected thread
  store rather than treating schema existence as runtime support.
- Re-check persisted `RolloutItem` variants, especially `world_state` and
  compaction replacement history.
- Re-run one live thread where assistant emits commentary + final answer.
- Re-run one stored transcript path and confirm final answer is not in thought block.
