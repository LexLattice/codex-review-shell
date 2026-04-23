# Codex App-Server Ontology Reference

Purpose: stable reference for the canonical Codex thread/message ontology used by this app's middle-plane renderer.

Last verified:
- Codex fork: `/home/rose/work/codex/fork` at `d5e9bd3890`
- Review shell repo: `/home/rose/work/LexLattice/codex-review-shell` at `784f29f`
- Verification date: 2026-04-23

## Why this exists

We had a rendering bug where final assistant output was sometimes grouped under "Thought process".
Root cause: local phase heuristics drifted from Codex canonical `MessagePhase` semantics.

Canonical fix rule:
- Treat assistant message phase `commentary` as thought-process text.
- Treat `final_answer` as final assistant output.
- Treat missing/unknown phase as final assistant output (not thought).

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
- `codex-rs/app-server-protocol/src/protocol/v2.rs` (`ThreadItem`)
- `codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`

`ThreadItem` variants:
- `userMessage { id, content[] }`
- `hookPrompt { id, fragments[] }`
- `agentMessage { id, text, phase?, memoryCitation? }`
- `plan { id, text }`
- `reasoning { id, summary[], content[] }`
- `commandExecution { id, command, cwd, processId?, source, status, commandActions[], aggregatedOutput?, exitCode?, durationMs? }`
- `fileChange { id, changes[], status }`
- `mcpToolCall { id, server, tool, status, arguments, mcpAppResourceUri?, result?, error?, durationMs? }`
- `dynamicToolCall { id, namespace?, tool, arguments, status, contentItems?, success?, durationMs? }`
- `collabAgentToolCall { id, tool, status, senderThreadId, receiverThreadIds[], prompt?, model?, reasoningEffort?, agentsStates }`
- `webSearch { id, query, action? }`
- `imageView { id, path }`
- `imageGeneration { id, status, revisedPrompt?, result, savedPath? }`
- `enteredReviewMode { id, review }`
- `exitedReviewMode { id, review }`
- `contextCompaction { id }`

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
- `item/fileChange/patchUpdated`, `item/fileChange/outputDelta`.

Important:
- Reconstruct full state by applying deltas, then trust `item/completed` as final state.

## Persistence ontology (on-disk rollout history)

Source:
- `codex-rs/protocol/src/protocol.rs` (`RolloutItem`, `EventMsg`, `SessionMeta`)
- `codex-rs/protocol/src/models.rs` (`ResponseItem`)
- `codex-rs/app-server-protocol/src/protocol/thread_history.rs` (history reducer)

Persisted line item union:
- `session_meta`
- `session_state`
- `response_item`
- `compacted`
- `turn_context`
- `event_msg`

Historical reconstruction:
- App-server rebuilds turns by reducing persisted `RolloutItem` + `EventMsg` into v2 `ThreadItem` turns.
- `EventMsg::AgentMessage` carries `phase`.
- `TurnItem::AgentMessage` preserves that phase into v2 `ThreadItem::AgentMessage`.

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
- Re-check `ServerNotification` methods for item lifecycle and deltas.
- Re-run one live thread where assistant emits commentary + final answer.
- Re-run one stored transcript path and confirm final answer is not in thought block.
