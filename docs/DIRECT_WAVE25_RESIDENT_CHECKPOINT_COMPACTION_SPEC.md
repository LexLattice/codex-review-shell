# Direct Wave 25: Resident Checkpoint Compaction

Status: implementation slice.

## Purpose

Restore the useful part of the old custom compaction workflow in the direct
harness: when context pressure or a server pre-compaction warning appears, ask
the resident model for a strict JSON checkpoint of its current working state and
persist that checkpoint as context-maintenance evidence.

The v0 target is deliberately small. It creates a checkpoint artifact before
context loss, but it does not execute provider compaction and does not silently
mutate the next request context.

## Standing Laws

```text
Resident checkpoint != provider compaction.
Resident checkpoint payload != automatic context mutation.
Resident checkpoint payload != new_context authority.
Resident checkpoint prompt != raw transcript archive.
Resident checkpoint persistence != proof that every obligation is complete.
```

The checkpoint is a resident-authored continuity witness. Future context
construction may cite it, but only through explicit context-admission logic.

## Trigger Sources

Supported v0 trigger evidence:

```text
serverPreCompactionWarning
context pressure over configured threshold
context pressure state approaching_budget / over_budget
manual checkpoint request
turn-boundary checkpoint request
```

Trigger decisions produce a renderer-safe decision object with pressure state,
threshold, blockers, and trigger kind. Missing context or an active provider turn
can defer the checkpoint rather than blocking normal interaction.

## Artifacts

### `DirectResidentContextCheckpointRequest`

Captures:

```text
projectId
threadId
turnId
workThreadId
triggerDecision
sourceRefs
promptVersion
checkpointJsonSchema
providerTransportAllowed
automaticContextMutationAllowed=false
providerCompactionAllowed=false
rawPromptIncluded=false
rawTranscriptIncluded=false
requestDigest
```

The request is what the harness intends to ask the resident model. It is not a
claim that provider transport or compaction already happened.

### `DirectResidentContextCheckpointPayload`

Strict resident JSON payload:

```text
schema
taskState: currentGoal, phase, progressSummary
openObligations: summary, status, nextStep
evidenceState: knownFacts, uncertainties, sourceRefs
artifactRefs: artifactKind, displayPath, purpose, state
toolState: pendingToolCalls, importantToolResults
decisions: summary, reason, source
risks: summary, severity, mitigation
nextActions
confidence
```

Wrong schema, invalid JSON, missing current goal, missing progress summary, or
missing next actions make the checkpoint invalid.

### `DirectResidentContextCheckpoint`

Normalized and validated checkpoint:

```text
checkpointId
requestId
projectId / threadId / turnId / workThreadId
state
validationErrors
payload
requestDigest
sourceDigest
evidenceRefs
automaticContextMutationAllowed=false
providerCompactionAllowed=false
rawResidentOutputIncluded=false
rawPromptIncluded=false
checkpointDigest
```

Ready checkpoints can be persisted as context-maintenance artifacts.

### `DirectResidentContextCheckpointReport`

Small proof report asserting:

```text
request schema is valid
checkpoint is ready or persisted
no context mutation authority was granted
no provider compaction authority was granted
raw prompt/resident output are excluded
```

## Persistence

Persisted checkpoints are written under the direct thread context-maintenance
artifact surface:

```text
<checkpointId>.json
resident-checkpoint-latest.json
<requestId>.json
```

The thread operation ledger records:

```text
operationType = resident_context_checkpoint
effectKind = resident_context_checkpoint_persisted
```

This gives future context construction a stable artifact to cite without making
the artifact automatically active.

## Deferred Scope

Deferred until later proof:

```text
live automatic resident checkpoint call from the active turn stream
provider-side compaction execution
new_context resident-callable authority
automatic checkpoint admission into future context packs
checkpoint UI review/edit/accept flow
checkpoint conflict resolution across multiple checkpoint artifacts
```

The first live integration should be opt-in and observable. It should not add
new gates that block basic direct chat until manual and headless testing proves
the flow.

## PR Plan

| PR | Purpose | Deliverable |
| --- | --- | --- |
| `#150` | Resident checkpoint compaction first slice | Schema, trigger decision, prompt builder, strict parser/validator, context-maintenance persistence, operation ledger type, bridge registry row, focused regression |

## Acceptance Checks

```text
Trigger decision requests a checkpoint for server warning or high pressure.
Request artifact denies automatic context mutation and provider compaction.
Prompt requests one strict JSON object and excludes raw transcript archival.
Wrong resident payload schema is rejected.
Invalid resident JSON is rejected.
Missing current goal/progress/next actions are rejected.
Ready checkpoint validates and can be persisted.
Persisted checkpoint writes latest/checkpoint/request artifacts.
Operation ledger records resident_context_checkpoint.
Report proves no provider compaction, no automatic context mutation, and no raw output inclusion.
```
