# Sub-Agent Meta Tags And Tabbed Panel Spec

Status: implementation-ready refinement.

Purpose: refine sub-agent projection after the first multi-agent implementation
so the primary Codex transcript stays a primary-thread transcript, while the
right plane owns child-agent conversations behind agent tabs.

This spec extends:

- `SUB_AGENT_TRANSCRIPT_PROJECTION_SPEC.md`

## Morphic Stance

```yaml
task_mode: implementation_design
execution_mode: standard
grounding_status: repo_grounded
implementation_inspection_status: implementation_inspected
runtime_observation_status: screenshots_and_code_inspection
profile_lineage:
  base_profile: codex_sub_agent_transcript_projection
  derivative_profile: codex_sub_agent_meta_tags_and_tabs
  profile_status: proposed_local
```

Morphic rule:

```text
Primary transcript = primary conversation plus compact transition evidence.
Right sub-agent pane = child-agent conversations.
No child prompt or child answer may be projected as operator or primary Codex.
```

## Problem

The first sub-agent projection correctly introduced an agent graph, but it still
allows two projection problems:

1. Main Codex transcript can show sub-agent material as if it were normal primary
   chat/process content.
2. The right plane stacks every child-agent conversation vertically, which makes
   concurrent agents hard to inspect and causes the right pane to become a long
   mixed feed.

The desired behavior is:

```text
Main Codex transcript:
  Agent Scout created.
  Sent input to Scout.
  Waiting for Scout.
  Scout completed.

Right Sub-agents pane:
  [Scout] [Reviewer] [Explorer]
  selected tab displays one child-agent conversation
```

Agent names in the main transcript are clickable chips. Activating a chip selects
the Sub-agents tab in the right plane and opens that specific agent tab.

## Protocol Evidence

Codex app-server already exposes compact collaboration events:

```text
ThreadItem::CollabAgentToolCall {
  id,
  tool,
  status,
  sender_thread_id,
  receiver_thread_ids,
  prompt,
  model,
  reasoning_effort,
  agents_states
}
```

Supported tools:

```text
spawnAgent
sendInput
resumeAgent
wait
closeAgent
```

These items are the lawful source for primary-transcript meta-tags. They are not
child chat messages. The child conversations remain scoped to child thread ids
and are displayed only in the right Sub-agents pane.

The vanilla Codex TUI follows the same semantic split: collaboration actions are
rendered as compact history cells such as spawned, sent input, waiting, resumed,
and closed, while child-agent transcripts are not flattened as the operator's
own messages.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `CollabActivityTagProjection` | support artifact | build | Turns collab tool-call items into compact primary-transcript meta-tags. |
| `AgentChipAction` | surface/action artifact | build | Clickable agent identity chip that focuses the right-plane Sub-agents tab. |
| `PrimaryTranscriptCollabFilter` | support artifact | build | Ensures collab items update graph/meta-tags but do not enter thought/tool/chat bodies. |
| `SubAgentTabSelectionState` | support artifact | build | Preserves selected child agent across graph updates and thread refreshes. |
| `TabbedSubAgentPanelProjection` | surface artifact | build | Renders one selected child-agent transcript behind an agent tab strip. |
| `AgentGraphRevisionGuard` | support artifact | align | Rejects stale chip-focus or hydration events from prior primary threads. |

## Object Model

```ts
type CollabActivityTagKind =
  | "agent_spawned"
  | "input_sent"
  | "agent_resumed"
  | "agent_waiting"
  | "agent_closed"
  | "agent_failed"
  | "agent_activity";

type CollabActivityTagProjection = {
  id: string;
  kind: CollabActivityTagKind;
  status: "inProgress" | "completed" | "failed" | "unknown";
  callId?: string;
  senderThreadId?: string;
  receiverThreadIds: string[];
  label: string;
  promptPreview?: string;
  model?: string;
  reasoningEffort?: string;
  agents: Array<{
    threadId: string;
    displayLabel: string;
    nickname?: string;
    role?: string;
    lifecycleStatus?: string;
    activityStatus?: string;
    clickable: boolean;
  }>;
  evidenceRefs: EvidenceRef[];
};

type AgentChipAction = {
  type: "focus_sub_agent";
  projectId: string;
  primaryThreadId: string;
  graphRevision: number;
  receiverThreadId: string;
};

type SubAgentTabSelectionState = {
  projectId: string;
  primaryThreadId: string;
  graphRevision: number;
  selectedReceiverThreadId?: string;
  selectedBy: "operator" | "auto_first_active" | "agent_chip" | "restore";
  selectedAt: string;
};
```

## Primary Transcript Projection

### Rule

```text
CollabAgentToolCall items belong to primary-thread transition evidence.
They do not belong to primary chat bubbles.
They do not belong to the normal shell/tool/patch thought groups.
They never render child prompts or child answers inline.
```

### Rendering

Primary transcript renders compact meta-tags:

```text
Sub-agent activity
  Created Scout
  Sent input to Scout
  Waiting for Scout
  Closed Scout
```

The agent label is a chip:

```text
[Scout]
```

Clicking the chip executes:

```text
FocusSubAgent(projectId, primaryThreadId, receiverThreadId, graphRevision)
  -> select right-plane Sub-agents tab
  -> select matching agent tab
  -> display that child transcript
```

If a collab event has multiple receivers:

```text
Sent input to [Scout] [Reviewer] +2
```

V0 may render all receiver chips when space allows and collapse overflow into a
count. The overflow count is informational only unless a later menu is added.

If a `spawnAgent` item is in progress and no receiver thread id exists yet:

```text
Creating sub-agent...
```

This tag is inert until a receiver id is available.

### Status Mapping

```text
spawnAgent + completed -> Created <agent>
spawnAgent + inProgress -> Creating sub-agent...
sendInput + completed -> Sent input to <agent>
resumeAgent + completed -> Resumed <agent>
wait + inProgress -> Waiting for <agent>
wait + completed -> Wait completed for <agent>
closeAgent + completed -> Closed <agent>
status failed -> <action> failed for <agent>
unknown tool/status -> Sub-agent activity for <agent>
```

## Thought Process Boundary

The Thought process accordion may still contain:

```text
reasoning/commentary
shell/tool calls
patches
```

It must not contain full sub-agent conversations. Collab activity may be shown as
a compact separate sub-section only if it uses the same meta-tag projection and
does not duplicate the standalone primary-transcript meta-tag. The preferred v0
behavior is one standalone compact meta-tag row per collab action.

## Right-Plane Tabbed Sub-Agents Panel

### Topology

```text
Right plane
  ChatGPT tab | Sub-agents tab

Sub-agents tab
  [Scout] [Reviewer] [Explorer]  // tab strip
  selected child transcript
```

Only the selected child-agent conversation is displayed. Agent cards are not
stacked vertically as full conversations.

### Tab Labels

Starter tab label:

```text
agent.nickname || agent.role || Agent <short id>
```

If labels collide:

```text
Scout · a13f
Scout · 91c2
```

Tabs may add compact status witnesses:

```text
Scout · running
Reviewer · done
Explorer · failed
```

V0 should keep these small enough that the tab strip remains scannable.

### Selection Rules

```text
If operator selects an agent tab:
  keep that selection while the agent remains in the current graph.

If an agent chip is clicked in the primary transcript:
  select Sub-agents tab and select that agent.

If no operator selection exists:
  select the first active/running/waiting agent.

If no active agent exists:
  select the first known agent by stable graph order.

If the selected agent disappears after graph refresh:
  fall back using the same active-first rule.
```

The Sub-agents tab is scoped to the currently open primary Codex thread. Switching
primary threads switches or clears the visible agent graph.

## Stored/Live Parity

Stored JSONL and live app-server events must project identically:

```text
stored collab item -> graph update + meta-tag
live collab item -> graph update + meta-tag
stored child rows -> right-plane child transcript only
live child rows -> right-plane child transcript only
```

Stored rows must not be replayed through live event lifecycle handlers. They
normalize into presentation models and then render through pure projection
functions.

Deduplication remains conservative:

```text
Deduplicate by stable item id/call id/event id or schema-equivalent adjacent
duplicates only. Never deduplicate child-agent text by text alone.
```

## Stale Event Rules

Every agent graph update, chip focus request, and child hydration result carries:

```text
projectId
primaryThreadId
graphRevision
activationEpoch, when available
```

Late events from a previous project/thread/activation epoch must not:

```text
change the selected right-plane agent
reopen the Sub-agents tab
append child transcript content
rewrite primary transcript meta-tags
```

## Security And Privacy

Main transcript meta-tags use prompt previews only when useful and bounded.
Prompt full text belongs in the selected child-agent detail pane, not in compact
primary history.

All prompt text, child output, and diagnostics render via `textContent` or the
existing safe typed-token projection. No sub-agent content is inserted as HTML.

## Implementation Order

1. Add `PrimaryTranscriptCollabFilter` so collab items update the agent graph but
   no longer enter normal chat/thought/tool bodies.
2. Add `CollabActivityTagProjection` and render compact primary-transcript
   meta-tags for stored and live collab items.
3. Add `AgentChipAction` bridge from Codex surface to shell app.
4. Add `SubAgentTabSelectionState` and tabbed right-plane projection.
5. Preserve selection across graph updates and reject stale graph events.
6. Validate stored/live parity with the existing sub-agent fixtures.

## Acceptance Criteria

- Primary Codex transcript no longer renders child-agent prompts as `You`.
- Primary Codex transcript no longer renders child-agent answers as primary
  `Codex`.
- Main thought/process groups no longer expand into full sub-agent conversations.
- Collab actions render as compact meta-tags such as created, sent input,
  waiting, resumed, closed, or failed.
- Agent chips are clickable when a receiver thread id is available.
- Clicking an agent chip selects the right-plane Sub-agents tab and opens the
  matching agent tab.
- Right Sub-agents pane shows a tab strip of agents and exactly one selected
  child-agent conversation.
- Manual selected-agent tab remains selected across graph updates when still
  valid.
- Stored transcript reload and live streaming produce equivalent sub-agent
  meta-tags and right-pane selection behavior.
- Stale graph/hydration events from a prior primary thread do not mutate the
  current right pane.
- Validation passes with `npm run validate` and `npm run smoke`.
