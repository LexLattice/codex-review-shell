# Direct Sub-Agent Observability And Containment Spec

Status: draft for PR 10.

Purpose: define the first Direct-harness sub-agent bundle after governance and
semantic broker diagnostics. This PR makes agent activity visible and auditable
without enabling new model-visible tools, child-agent spawning, waits, recursive
delegation, or runtime choreography.

This spec extends:

- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)
- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)
- [SUB_AGENT_TRANSCRIPT_PROJECTION_SPEC.md](SUB_AGENT_TRANSCRIPT_PROJECTION_SPEC.md)
- [SUB_AGENT_META_TAGS_AND_TABBED_PANEL_SPEC.md](SUB_AGENT_META_TAGS_AND_TABBED_PANEL_SPEC.md)

## Verdict

PR 10 should implement **sub-agent observability and containment diagnostics**.

The target rows are:

```text
H1  Agent graph
H2  Agent progress registry
H3  E-witness progress object
H4  Inspect agent progress tool, diagnostic/read-only substrate only
H6  Thread-spawn containment visibility
H8  Sub-agent transcript projection
H9  Agent activity attention model
J9  Fork/direct capability profile visibility
```

Rows that remain explicitly out of scope:

```text
H5  Wait agent progress tool
H7  Collab tool surface
H10 Wait deadlock prevention beyond diagnostic state
```

H5/H7/H10 need a later choreography/recovery spec because they introduce
runtime coordination authority, blocking waits, cancellation, and no-deadlock
semantics.

## Core Law

```text
agent graph != execution authority
progress witness != child transcript
child transcript != primary answer
containment visibility != tool permission
inspect progress != model-visible tool
wait status != wait authority
app-server collab event != Direct provider primitive
renderer tab selection != agent graph authority
source child run != parent tool replay authority
sub-agent evidence != governance enforce mode
agent label != agent identity
model-safe witness != provider-bound context
```

The Direct harness may show agent graph, progress, transcript, attention, and
containment facts. It must not use those facts to spawn, resume, message, wait
on, close, or route sub-agents in PR 10.

## Product Boundary

In scope:

```text
read-only agent graph projection
agent progress registry
agent_progress_witness@1 rows
sub-agent transcript projection and author separation
compact primary-transcript collab activity tags
Codex Sub-agents panel parity, distinct from the right ChatGPT pane
attention/unread/error badges
containment profile visibility
diagnostic inspect-progress projection for renderer/status
operation history rows for agent graph/progress changes
fixture regression and raw-exposure scans
```

Out of scope:

```text
model-visible inspect_agent_progress tool
model-visible wait_agent tool
spawn_agent/send_input/resume/close/list tools in Direct
recursive delegation
sub-agent auto-routing from semantic broker
sub-agent context maintenance or memory editing
provider continuity through child threads
right ChatGPT pane transcript import
right ChatGPT pane navigation/replacement/mutation
handoff queue mutation
app-server fallback inside Direct
new implementation-lane read/patch/command authority
automatic recovery or replay of child work
child transcript/progress injection into context packs, memory, baton,
governance, or semantic broker artifacts
```

Minimum UX copy:

```text
Sub-agents: observed activity only
No spawn/wait controls available
Containment: known/unknown/diagnostic
Child transcript is separate from primary answer
```

## Preconditions

PR 10 assumes these earlier bundles are green:

```text
PR 1 real-provider implementation-lane proof
PR 2 recovery and replay safety
PR 3 iterative implementation repair loop
PR 4 workspace mutation truth and policy substrate
PR 5 implementation-lane UI and operation history
PR 6 thread evidence workbench and derived views
PR 7 fresh fork starts from previews
PR 8 context maintenance, memory, frontier baton
PR 9 governance and semantic broker diagnostics
Direct text-only and recent-dialogue regressions
```

If those preconditions are not green, PR 10 reports diagnostics but does not
promote authority rows.

## Source-Of-Truth Law

Sub-agent state is derived in this order:

```text
canonical session/thread/runtime artifacts
  -> app-server collab events or Direct harness AgentRun records
  -> direct_agent_graph@1
  -> direct_agent_progress_registry@1
  -> agent_progress_witness@1
  -> sub-agent transcript projections
  -> status/operation-history UI projections
```

Rules:

```text
Renderer DOM state is never agent graph authority.
Renderer-selected agent tab is never lifecycle authority.
Child transcript text is never primary transcript truth.
Progress witnesses are summaries, not child transcript archives.
Containment profile visibility is diagnostic and never grants tools.
```

Stored rows must normalize through projection builders. They must not be replayed
through live turn handlers, obligation handlers, provider transports, approval
registries, or context builders.

## Runtime Source Classes

```ts
type DirectAgentRuntimeSourceClass =
  | "codex_app_server_collab"
  | "direct_harness_agent_run"
  | "legacy_imported_evidence"
  | "fixture"
  | "unknown";

type DirectAgentSourceSchemaRef = {
  runtimeSourceClass: DirectAgentRuntimeSourceClass;
  codexVersion?: string;
  appServerSchemaGeneratedAt?: string;
  appServerSchemaDigest?: string;
  sourceNormalizerVersion: string;
  experimentalApiEnabled?: boolean;
};
```

App-server-derived evidence must cite schema/version evidence when available.
`CollabAgentToolCall`, `agents_states`, and `SessionSource::SubAgent` evidence
must be normalized through a versioned normalizer; app-server events are not one
timeless schema.

### Codex App-Server Source

The Codex executable/app-server path may derive agent graph data from:

```text
thread metadata
SessionSource::SubAgent / threadSpawn metadata
CollabAgentToolCall items
agents_states
stored JSONL session rows
```

This is source evidence for projection only. It is not imported into Direct as
provider continuity and must not cause Direct provider calls.

Allowed app-server source ingestion in PR 10:

```text
consume already-captured app-server notifications
read stored JSONL/session rows
optionally call read-only list/read methods if explicitly configured
```

Forbidden app-server actions in PR 10:

```text
thread/start
turn/start
turn/steer
thread/fork
approval responses
spawn/send/wait/close/list mutation
any active-turn control or mutation
```

### Direct Harness Source

The Direct OAI path has no upstream sub-agent primitive in PR 10. It may derive
agent graph data only from harness-owned records:

```text
AgentRun records
AgentThreadRef records
future direct controller diagnostics
fixture records
```

If no Direct harness record exists, the graph state is:

```text
agent_graph_not_available
```

not an inferred provider capability.

### Legacy Imported Evidence

`legacy_imported_evidence` may create display-only graph/progress/transcript
projection with `sourceConfidence="derived"` or `sourceConfidence="diagnostic"`.
It cannot create current runtime sub-agent nodes with exact confidence, cannot
enable containment claims, and cannot feed future wait/spawn tools.

### Fork Capability Visibility

`J9` capability visibility follows the v0.2 proof rule:

```text
Never infer fork capability from path substrings.
```

Fork/direct capability visibility requires one of:

```text
runtime schema includes method/field
config/profile API returns fork-specific key/value
runtime probe succeeds
executable identity/version marker is verified
historical artifact is present for rendering only, not enabling controls
```

Missing or historical-only proof produces diagnostic visibility, not controls.

## Evidence Refs

```ts
type DirectAgentEvidenceRefKind =
  | "session_metadata"
  | "collab_tool_call"
  | "agents_states"
  | "agent_run_record"
  | "thread_graph_projection"
  | "progress_registry"
  | "progress_witness"
  | "transcript_projection"
  | "containment_profile"
  | "operation_ledger"
  | "fixture";

type DirectAgentEvidenceRef = {
  kind: DirectAgentEvidenceRefKind;
  artifactId: string;
  artifactDigest: string;
  sourceConfidence:
    | "exact"
    | "accepted"
    | "derived"
    | "diagnostic"
    | "future";
  rendererSafeLabel: string;
  rawTextIncluded: false;
  rawPathIncluded: false;
  rawChatGptUrlIncluded: false;
};
```

Evidence refs cite artifact ids and local evidence keys only. They do not carry
raw prompts, child transcript text, raw file paths, provider frames, raw hashes,
or ChatGPT URLs.

## Agent Identity And Source Digests

Do not merge child agents by label, nickname, role, prompt text, transcript text,
or display order. Identity resolution is explicit:

```ts
type DirectAgentIdentityResolution = {
  identityKey: string;
  source:
    | "thread_id"
    | "agent_run_record"
    | "agent_thread_ref"
    | "collab_tool_call"
    | "session_metadata"
    | "fixture";
  confidence: "exact" | "derived" | "diagnostic" | "unknown";
  collisionState:
    | "none"
    | "duplicate_label"
    | "duplicate_thread_ref"
    | "conflicting_sources"
    | "unknown";
};
```

If two nodes share a label but not an exact identity key, keep them separate and
mark the labels ambiguous.

Graph source digests are canonical:

```ts
type DirectAgentGraphSourceDigestInput = {
  schema: "direct_agent_graph_source@1";
  projectId: string;
  primaryThreadId: string;
  runtimeSourceClass: DirectAgentRuntimeSourceClass;
  sourceEventDigests: string[];
  sourceThreadIds: string[];
  sourceSchemaRefDigest: string;
  containmentProfileDigest?: string;
  normalizerVersion: string;
  operationLedgerHeadDigest?: string;
};
```

The digest input excludes renderer tab selection, timestamps, display labels, raw
transcript text, and raw prompts.

## Current Pointer Law

Projection pointers are kind-specific:

```text
current_agent_graph_id
current_agent_progress_registry_id
current_agent_attention_projection_id
current_agent_containment_profile_id
current_sub_agent_transcript_projection_id
```

Rules:

```text
valid projection -> may become current
blocked/failed projection -> attempt history only
stale projection -> readable if renderer-safe, not authority
corrupt projection -> minimal safe status only
```

Current pointers update only after schema validation, digest validation, and
raw-exposure scan pass. A failed graph/progress/transcript rebuild must not
replace the last safe current projection.

## Agent Graph

Add `direct_agent_graph@1`:

```ts
type DirectAgentGraph = {
  schema: "direct_agent_graph@1";
  agentGraphId: string;
  projectId: string;
  primaryThreadId: string;
  runtimeSourceClass: DirectAgentRuntimeSourceClass;
  graphRevision: number;
  activationEpoch?: number;
  sourceSchemaRef: DirectAgentSourceSchemaRef;
  sourceSchemaRefDigest: string;
  sourceDigest: string;
  operationLedgerHeadDigest?: string;
  containmentProfileId?: string;
  containmentProfileDigest?: string;
  maxGraphDepth: number;
  cycleDetected: boolean;
  cyclePolicy: "break_and_mark" | "block_projection";
  directProviderPrimitiveProven: false;
  providerContinuityGranted: false;
  directRuntimeAuthorityGranted: false;
  nodes: DirectAgentGraphNode[];
  edges: DirectAgentGraphEdge[];
  counts: {
    total: number;
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    stale: number;
    unknown: number;
  };
  lifecycle: "empty" | "active" | "terminal" | "stale" | "degraded" | "corrupt";
  rendererSafeSummary: string;
  rawTranscriptIncluded: false;
  rawPromptIncluded: false;
  rawProviderFrameIncluded: false;
};

type DirectAgentGraphNode = {
  agentNodeId: string;
  agentThreadId: string;
  parentThreadId?: string;
  depth: number;
  role?: string;
  nickname?: string;
  displayLabel: string;
  identityResolution: DirectAgentIdentityResolution;
  labelConfidence:
    | "thread_metadata"
    | "collab_tool_call"
    | "harness_record"
    | "fixture"
    | "unknown";
  lifecycleState:
    | "discovered"
    | "starting"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "closed"
    | "stale"
    | "not_found"
    | "unknown";
  activityState:
    | "idle"
    | "active"
    | "responding"
    | "blocked"
    | "attention_required"
    | "unknown";
  transcriptProjectionId?: string;
  progressWitnessId?: string;
  containmentState:
    | "known_contained"
    | "observed_external"
    | "unknown"
    | "violated"
    | "not_applicable";
  evidenceRefs: DirectAgentEvidenceRef[];
};

type DirectAgentGraphEdge = {
  edgeId: string;
  edgeKind:
    | "spawned_child"
    | "sent_input"
    | "resumed"
    | "waited_on"
    | "closed"
    | "reported_progress"
    | "derived_from_fixture";
  sourceAgentNodeId: string;
  targetAgentNodeId: string;
  parentThreadId: string;
  childThreadId: string;
  sourceCallId?: string;
  status: "in_progress" | "completed" | "failed" | "unknown";
  systemOwned: true;
  removableByUser: false;
  evidenceRefs: DirectAgentEvidenceRef[];
};
```

Graph edges are system-owned diagnostic edges. User bridge/unlink operations from
the thread workbench must not remove agent lineage/progress edges in PR 10.

Edge direction is fixed:

```text
spawned_child: parent -> child
sent_input: parent -> child
resumed: parent -> child
waited_on: parent -> child
closed: parent -> child
reported_progress: child -> parent
derived_from_fixture: fixture source -> node
```

Nested graphs must obey `maxGraphDepth`. Cycles from conflicting evidence either
break and mark affected nodes or block the projection with
`agent_graph_cycle_detected`; recursive labels must never loop indefinitely.

## Progress Registry

Add `direct_agent_progress_registry@1`:

```ts
type DirectAgentProgressRegistry = {
  schema: "direct_agent_progress_registry@1";
  progressRegistryId: string;
  projectId: string;
  primaryThreadId: string;
  agentGraphId: string;
  graphRevision: number;
  registrySeq: number;
  stalenessPolicy: DirectAgentProgressStalenessPolicy;
  sourceDigest: string;
  entries: DirectAgentProgressEntry[];
  activeWorkCount: number;
  blockedCount: number;
  attentionCount: number;
  staleCount: number;
  rendererSafeSummary: string;
  rawPromptIncluded: false;
  rawTranscriptIncluded: false;
  rawToolArgsIncluded: false;
};

type DirectAgentProgressEntry = {
  progressEntryId: string;
  agentThreadId: string;
  progressSeq: number;
  phase:
    | "discovered"
    | "created"
    | "input_sent"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "closed"
    | "stale"
    | "unknown";
  activeWorkSummary?: string;
  blockerCodes: DirectAgentProgressBlockerCode[];
  lastEventAt?: string;
  lastEventDigest?: string;
  transitionState:
    | "valid"
    | "progress_transition_invalid"
    | "stale_due_to_policy"
    | "unknown";
  evidenceRefs: DirectAgentEvidenceRef[];
};

type DirectAgentProgressStalenessPolicy = {
  staleAfterMs: number;
  terminalNeverStalesForMs?: number;
  unknownWhenNoEventDigest: boolean;
};

type DirectAgentProgressBlockerCode =
  | "metadata_missing"
  | "transcript_hydration_failed"
  | "child_thread_not_found"
  | "graph_stale"
  | "containment_unknown"
  | "source_digest_mismatch"
  | "raw_exposure_blocked"
  | "unsupported_runtime_source"
  | "unknown";
```

Progress entries are summaries over events. They are not an event log and cannot
be used to replay child activity.

Allowed progress phase transitions:

```text
discovered -> created | running | unknown
created -> input_sent | running | failed | stale
input_sent -> running | waiting | failed | stale
running -> waiting | completed | failed | stale
waiting -> running | completed | failed | stale
completed -> closed | stale
failed -> closed | stale
closed -> stale
```

Invalid transitions degrade the entry with `progress_transition_invalid` rather
than crashing. If no recent event arrives for an active/running/waiting agent,
the staleness policy moves it to `stale`; it must not remain active forever.

## E-Witness Progress Object

Add `agent_progress_witness@1`:

```ts
type DirectAgentProgressWitness = {
  schema: "agent_progress_witness@1";
  witnessId: string;
  projectId: string;
  primaryThreadId: string;
  agentThreadId: string;
  agentGraphId: string;
  progressRegistryId: string;
  progressEntryId: string;
  witnessSeq: number;
  phase: DirectAgentProgressEntry["phase"];
  attentionState:
    | "none"
    | "unread"
    | "active"
    | "blocked"
    | "failed"
    | "stale"
    | "unknown";
  rendererSafeSummary: string;
  modelSafeSummary: string;
  modelSafeSummaryUse:
    | "future_tool_candidate_only"
    | "diagnostic_only"
    | "blocked";
  inspectableInRenderer: true;
  modelVisibleToolEnabledInThisPr: false;
  waitEnabledInThisPr: false;
  spawnEnabledInThisPr: false;
  replayAuthority: false;
  continuationAuthority: false;
  approvalAuthority: false;
  evidenceRefs: DirectAgentEvidenceRef[];
  rawPromptIncluded: false;
  rawTranscriptIncluded: false;
  rawProviderFrameIncluded: false;
};
```

`modelSafeSummary` means it is safe enough for a future model-visible inspect
tool. It does not mean PR 10 sends the witness to the provider.
`modelSafeSummary` is app-private by default; reports may include bounded
previews only after raw-exposure scan, and no provider request includes it in
PR 10.

## Inspect Progress Boundary

PR 10 may add a renderer/status read shape:

```ts
type DirectAgentProgressInspectionRequest = {
  projectId: string;
  primaryThreadId: string;
  requestedAgentThreadId?: string;
  cursor?: string;
  limit: number;
};

type DirectAgentProgressInspection = {
  schema: "direct_agent_progress_inspection@1";
  inspectionId: string;
  projectId: string;
  primaryThreadId: string;
  requestedAgentThreadId?: string;
  agentGraphId: string;
  progressRegistryId: string;
  witnesses: DirectAgentProgressWitness[];
  nextCursor?: string;
  hasMore: boolean;
  maxWitnessesReturned: number;
  actionability: {
    actionable: false;
    allowedActions: [];
    reason: "inspection_is_read_only";
  };
  providerToolCallUsed: false;
  appServerMutationUsed: false;
  rightPaneMutationUsed: false;
  handoffMutationUsed: false;
};
```

There is no provider tool declaration for inspect progress in PR 10. There is no
`inspect_agent_progress` tool in request manifests. A future tool needs a
separate spec with request-shape evidence, recovery, caps, and no-deadlock law.

## Containment Profile

Add `direct_agent_containment_profile@1`:

```ts
type DirectAgentContainmentProfile = {
  schema: "direct_agent_containment_profile@1";
  containmentProfileId: string;
  projectId: string;
  runtimeSourceClass: DirectAgentRuntimeSourceClass;
  profileSource:
    | "direct_capability_profile"
    | "app_server_observed_metadata"
    | "fork_capability_profile"
    | "fixture"
    | "unknown";
  containmentEvidence: {
    source:
      | "direct_capability_profile"
      | "app_server_observed_metadata"
      | "fork_capability_profile"
      | "fixture"
      | "unknown";
    sourceConfidence: "exact" | "derived" | "diagnostic" | "future";
    schemaRef?: DirectAgentSourceSchemaRef;
  };
  profileDigest: string;
  appliesToAgentThreadIds: string[];
  toolSurfaceVisibility:
    | "none"
    | "observed_only"
    | "declared_bounded"
    | "unknown";
  spawnAllowedInThisPr: false;
  sendInputAllowedInThisPr: false;
  waitAllowedInThisPr: false;
  closeAllowedInThisPr: false;
  recursiveDelegationAllowedInThisPr: false;
  implementationLaneToolsGrantedByThisProfile: false;
  providerTransportGrantedByThisProfile: false;
  workspaceMutationGrantedByThisProfile: false;
  networkGrantedByThisProfile: false;
  rendererSafeSummary: string;
  rawConfigIncluded: false;
  rawPromptIncluded: false;
};
```

Containment profile rows explain what is known or unknown. They do not grant
authority and do not update project runtime tier selection.
Unknown containment degrades status; it never assumes safety.

## Transcript Projection

PR 10 should align the Direct harness with the existing sub-agent transcript
projection docs:

```text
primary transcript:
  primary conversation plus compact agent activity tags

Codex Sub-agents panel:
  selected child-agent transcript only
```

Rules:

```text
Child userMessage is never rendered as operator "You".
Child agentMessage is never rendered as primary "Codex".
Child transcript rows do not enter thought/tool/patch groups.
Unknown child identity renders as unknown, not primary.
Nested parent/child labels are recursive when evidence exists.
```

Add a Direct-owned projection wrapper:

```ts
type DirectAgentActivityTag = {
  tagId: string;
  agentThreadId: string;
  attentionState:
    | "active"
    | "blocked"
    | "failed"
    | "completed"
    | "stale"
    | "unknown";
  rendererSafeLabel: string;
  progressWitnessId?: string;
  actionability: {
    actionable: false;
    allowedActions: [];
  };
  rawTranscriptIncluded: false;
};

type DirectSubAgentTranscriptProjection = {
  schema: "direct_sub_agent_transcript_projection@1";
  transcriptProjectionId: string;
  projectId: string;
  primaryThreadId: string;
  agentThreadId: string;
  agentGraphId: string;
  graphRevision: number;
  activationEpoch?: number;
  itemCount: number;
  itemsTruncated: boolean;
  maxItemsReturned: number;
  nextCursor?: string;
  hasMore: boolean;
  maxTextPreviewChars: number;
  rendererSafeItems: DirectSubAgentTranscriptItem[];
  sourceDigest: string;
  rawProviderFrameIncluded: false;
  rawHostPathIncluded: false;
};

type DirectSubAgentTranscriptItem = {
  itemId: string;
  sourceItemId?: string;
  authorKind:
    | "parent_agent"
    | "child_agent"
    | "harness_controller"
    | "tool"
    | "system"
    | "unknown_agent";
  rendererSafeTextPreview: string;
  textTruncated: boolean;
  evidenceRefs: DirectAgentEvidenceRef[];
};
```

Full child transcript content may be displayed in the renderer through existing
safe text projection, but transcript detail is paged and bounded. Reports and
diagnostic artifacts use previews, counts, and evidence refs only.

The Codex Sub-agents panel is distinct from the right ChatGPT pane. Rendering,
selecting, or auto-switching the Sub-agents panel must not navigate, replace, or
mutate the right ChatGPT thread.

## Attention Model

Add `direct_agent_attention_projection@1`:

```ts
type DirectAgentAttentionProjection = {
  schema: "direct_agent_attention_projection@1";
  attentionProjectionId: string;
  projectId: string;
  primaryThreadId: string;
  agentGraphId: string;
  graphRevision: number;
  tabBadge: {
    total: number;
    active: number;
    unread: number;
    failed: number;
    blocked: number;
  };
  perAgent: Array<{
    agentThreadId: string;
    attentionState:
      | "none"
      | "unread"
      | "active"
      | "failed"
      | "blocked"
      | "stale";
    selectedByDefault: boolean;
    rendererSafeSummary: string;
  }>;
  autoSwitchRecommended: boolean;
  autoSwitchApplied: boolean;
  autoSwitchReason:
    | "first_active_agent"
    | "user_pinned_chatgpt"
    | "chatgpt_composer_nonempty"
    | "stale_graph"
    | "not_applicable";
  autoSwitchAuthority: "renderer_only";
  runtimeStateMutated: false;
};

type DirectSelectedAgentTabState = {
  selectedAgentThreadId?: string;
  selectedAtGraphRevision: number;
  selectedAtActivationEpoch?: number;
  selectionState:
    | "valid"
    | "stale_graph"
    | "agent_not_found"
    | "child_thread_not_found"
    | "unknown";
};
```

Auto-switch remains conservative and renderer-scoped. It is not runtime
authority and never changes Direct session state, project selection, Codex
session selection, or right ChatGPT thread state.

## Staleness And Recovery

Every graph/status/action projection carries:

```text
projectId
primaryThreadId
agentGraphId
graphRevision
activationEpoch, when available
sourceDigest
operationLedgerHeadDigest, when available
uiProjectionGeneration
```

Renderer actions, such as focusing an agent tab, must submit the generation and
graph revision they saw. Main rejects stale requests with stable blockers:

```text
agent_graph_stale
agent_graph_source_digest_mismatch
agent_graph_cycle_detected
agent_thread_missing
primary_thread_changed
activation_epoch_changed
renderer_projection_stale
raw_exposure_blocked
unsupported_runtime_source
```

Add recovery states:

```ts
type DirectAgentObservabilityRecoveryState =
  | "healthy"
  | "graph_missing"
  | "graph_stale"
  | "graph_corrupt"
  | "graph_cycle_detected"
  | "graph_digest_mismatch"
  | "progress_registry_missing"
  | "progress_registry_stale"
  | "witness_missing"
  | "witness_digest_mismatch"
  | "transcript_projection_missing"
  | "transcript_hydration_failed"
  | "containment_unknown"
  | "containment_profile_missing"
  | "source_thread_not_found"
  | "raw_exposure_blocked"
  | "unsupported_runtime_source"
  | "corrupt"
  | "unknown";
```

Recovery may classify and project existing evidence. It must not spawn agents,
send input, wait, close, call provider transport, create request manifests, or
mutate the ChatGPT handoff queue.

Read paths must not rebuild projections implicitly:

```text
read_agent_graph_status:
  may report stale/missing/corrupt
  must not rebuild from source

refresh_agent_graph_projection:
  explicit diagnostic maintenance action
```

Sub-agent transcript/progress may be displayed and cited as future evidence, but
PR 10 must not include it in context packs, request manifests, durable memory,
frontier baton, governance packet, or semantic broker packet.

## Operation Ledger Events

Add operation events that cite ids/digests only:

```text
agent_graph_projection_recorded
agent_graph_stale_event_rejected
agent_progress_registry_recorded
agent_progress_witness_recorded
sub_agent_transcript_projection_recorded
agent_attention_projection_recorded
agent_containment_profile_recorded
agent_projection_recovery_classified
agent_observability_status_recorded
agent_observability_blocked_raw_exposure
```

These events are history and diagnostics. They do not imply actionability.

## Report Schema

Add `direct_sub_agent_observability_report@1`:

```ts
type DirectSubAgentObservabilityReport = {
  schema: "direct_sub_agent_observability_report@1";
  generatedAt: string;
  coverageSource:
    | "fixture_sub_agent_observability"
    | "real_app_server_projection"
    | "direct_harness_fixture"
    | "diagnostic";
  matrixRowsExercised: string[];
  matrixPromotionCandidate: false;
  authorityPromotionCandidate: false;
  runtimeAuthorityExercised: false;
  providerAuthorityExercised: false;
  promotionCandidates: {
    H1_agentGraph_projection: boolean;
    H2_progressRegistry_fixture: boolean;
    H3_witness_fixture: boolean;
    H4_inspectToolAuthority: false;
    H5_waitToolAuthority: false;
    H6_containmentVisibility: boolean;
    H7_collabToolAuthority: false;
    H8_transcriptProjection_fixture: boolean;
    H9_attentionModel_fixture: boolean;
    H10_waitDeadlockPrevention: false;
    J9_capabilityProfileVisibility: boolean;
  };
  sentinelCounters: DirectSubAgentObservabilitySentinelCounters;
  rawExposureScan: "passed" | "blocked";
  schemaValidation: "passed" | "failed";
  cases: DirectSubAgentObservabilityCase[];
};

type DirectSubAgentObservabilitySentinelCounters = {
  providerTransportCalls: number;
  appServerMutationCalls: number;
  appServerTurnStartCalls: number;
  appServerApprovalResponseCalls: number;
  workspaceReadCalls: number;
  patchApplyCalls: number;
  commandRunCalls: number;
  contextPackBuilds: number;
  requestManifestBuilds: number;
  directSessionCreates: number;
  spawnAgentCalls: number;
  sendInputCalls: number;
  waitAgentCalls: number;
  closeAgentCalls: number;
  rightPaneMutationCalls: number;
  handoffMutationCalls: number;
};
```

Fixture reports cannot promote runtime authority rows. Real app-server
projection may prove UI/projection behavior for app-server source data, but it
does not promote Direct provider sub-agent authority.

## Raw-Exposure Rules

Scan:

```text
agent graph projections
progress registry
progress witnesses
transcript projection previews
attention projections
containment profiles
operation history rows
renderer status payloads
reports and Markdown summaries
serialized renderer state
DOM attributes
localStorage/sessionStorage if used
IndexedDB if used
Sub-agents tab state
selected agent ids and labels
progress summaries
modelSafeSummary previews when exported
```

Forbidden:

```text
raw provider frames
raw child prompts in reports
full child transcript text in reports
raw tool args
raw stdout/stderr
absolute host or WSL paths
raw ChatGPT URLs
auth tokens
internal SQLite exception text
unscoped raw hashes
```

Renderer display may show safe child transcript text through the existing safe
text projection. Diagnostic reports must use counts, previews, and evidence refs.

## Fixture Matrix

Required fixture cases:

```text
single_child_spawn_progress_completed
multi_receiver_send_input_progress
nested_child_agent_graph
agent_identity_duplicate_label_not_merged
agent_graph_cycle_detected
child_metadata_missing_unknown_label
child_thread_not_found_hydration_failed
stored_live_projection_parity
child_user_message_not_operator
child_agent_message_not_primary_codex
unknown_child_identity_not_primary
nested_child_label_not_primary
collab_activity_tag_not_thought_body
right_sub_agents_tab_single_selected_child
agent_chip_focus_rejects_stale_graph
selected_agent_tab_activation_epoch_rejected
attention_badge_failed_child
containment_profile_known_contained
containment_profile_unknown_degrades_status
fork_capability_path_substring_not_proof
progress_witness_no_replay_authority
progress_transition_invalid_degrades
active_progress_stales_by_policy
inspect_progress_renderer_read_only
provider_tool_declaration_absent
wait_tool_absent
spawn_tool_absent
child_transcript_not_context_pack_input
app_server_source_ingestion_read_only
legacy_imported_evidence_display_only
raw_exposure_blocked
sentinel_no_runtime_authority
```

Optional diagnostic cases:

```text
real_app_server_projection_from_stored_collab_items
direct_harness_fixture_agent_run_records
legacy_imported_subagent_evidence_projection
```

## Implementation Order

### Phase -3 - Boundary Inventory And Prohibitions

```text
inventory existing sub-agent UI/projection code
inventory app-server collab item normalization
inventory Direct harness records that can identify AgentRun/AgentThreadRef
classify any existing spawn/wait/send/close paths as prohibited for PR 10
classify app-server calls as read-only source ingestion or forbidden mutation
classify Sub-agents panel code as renderer-only
```

### Phase -2 - Identity And Source Law

```text
agent identity resolution
source schema/version refs
runtime source class behavior
graph source digest canonicalization
legacy imported evidence quarantine
fork capability proof rule
```

### Phase -1 - Schemas And Non-Authority Law

```text
direct_agent_graph@1
direct_agent_progress_registry@1
agent_progress_witness@1
direct_agent_containment_profile@1
direct_sub_agent_transcript_projection@1
direct_agent_attention_projection@1
direct_sub_agent_observability_report@1
graph pointer law
progress transition matrix
staleness policy
modelSafeSummary use flag
containment evidence scope
attention auto-switch renderer-only law
recovery state enum
sentinel counters
stable stale blocker codes
```

### Phase 0 - Agent Graph Projection

```text
normalize app-server collab events and Direct fixture records into one graph
preserve project/thread/runtime source class
record graph revision and source digest
record edge direction/invariants
enforce depth cap/cycle policy
reject stale graph updates
do not infer identity from text
update current pointer only after schema/raw-exposure validation
do not rebuild on read
```

### Phase 1 - Progress Registry And Witnesses

```text
reduce graph/events into progress entries
emit agent_progress_witness@1 summaries
force replayAuthority=false, approvalAuthority=false, continuationAuthority=false
keep witnesses provider-safe but not provider-bound
validate phase transitions
enforce progressSeq monotonicity
degrade stale active work
page renderer inspection
```

### Phase 2 - Transcript And Attention Projection

```text
align primary transcript collab tags with existing sub-agent docs
render child transcript only in the Sub-agents pane
add attention/unread/error badges
preserve manual selected-agent tab across graph updates
page child transcript detail
render activity tags with actionability=false
ensure auto-switch cannot touch right ChatGPT pane or runtime state
```

### Phase 3 - Containment Visibility

```text
record containment profile snapshot
show known/unknown/degraded tool-surface visibility
do not grant spawn/wait/send/close/read/patch/command authority
connect J9 capability profile evidence as display/status only
record containment source confidence
```

### Phase 4 - Recovery, Reports, Regression

```text
classify graph/progress/witness/transcript/containment recovery states
write fixture report with no-promotion tags
raw-exposure scan all projections/reports
assert sentinel counters are zero for forbidden paths
run stored/live projection parity cases
split report promotion by H row
scan renderer storage and Sub-agents tab state
```

## Acceptance Criteria

- PR 10 creates a durable/read-only agent graph projection.
- App-server-derived agent evidence records Codex version/schema digest/normalizer
  version where available.
- Agent graph data is sourced from app-server collab evidence or Direct
  harness-owned agent records, never renderer DOM state.
- Agent identity resolution never merges nodes by nickname, role, label, prompt,
  transcript text, or display order alone.
- Graph source digest is canonical and excludes renderer tab selection,
  timestamps, labels, prompts, and transcript text.
- Graph edge directions and invariants are defined, including nested-agent cycle
  handling and depth caps.
- Current graph/progress/attention/transcript/containment pointers update only
  after schema validation and raw-exposure scan.
- Progress registry entries are summaries and cannot replay child activity.
- Progress phase transitions are validated against a transition matrix.
- Progress staleness policy moves old active/running/waiting states to stale
  rather than leaving them active forever.
- `agent_progress_witness@1` has replay/approval/continuation authority set to
  false.
- `modelSafeSummary` has an explicit future-tool/diagnostic use state and is
  never sent to a provider in PR 10.
- Renderer progress inspection is paged and has `actionability=false`.
- There is no model-visible inspect progress tool declaration in PR 10.
- There is no model-visible wait tool declaration in PR 10.
- There is no Direct spawn/send/resume/close/list collab tool in PR 10.
- App-server source ingestion is read-only; no app-server thread/start,
  turn/start, turn/steer, fork, approval response, or mutation occurs.
- Sub-agent prompts are never labeled as operator `You`.
- Sub-agent outputs are never labeled as primary `Codex`.
- Primary transcript shows compact sub-agent activity tags only.
- Primary transcript activity tags use a schema with `actionability=false`.
- Codex Sub-agents panel shows one selected child transcript with stable tab
  selection.
- Codex Sub-agents panel rendering never navigates, replaces, or mutates the
  right ChatGPT pane.
- Child transcript projections are paged/bounded; reports use previews, counts,
  and evidence refs only.
- Agent chip focus rejects stale graph revisions and stale activation epochs.
- Selected-agent tab state includes graph revision and activation epoch.
- Auto-switch is renderer-only and cannot change project/session/runtime/right
  ChatGPT state.
- Containment profile visibility cannot grant read/patch/command/provider or
  workspace authority.
- Containment evidence includes source confidence and schema/profile refs.
- Unknown containment degrades status instead of assuming safety.
- J9 fork/direct capability visibility follows v0.2 proof rules and never
  infers support from path substrings.
- App-server collab evidence has explicit fields proving it grants no Direct
  provider primitive, runtime authority, or provider continuity.
- Recovery classifies graph/progress/transcript/containment states without
  provider transport, app-server mutation, workspace reads, patch apply,
  command run, right ChatGPT pane mutation, or handoff mutation.
- Reading graph/progress/status does not rebuild projections; refresh is
  explicit.
- PR 10 does not feed child transcript/progress into context packs, request
  manifests, durable memory, frontier baton, governance packet, or semantic
  broker packet.
- Legacy imported sub-agent evidence remains display-only with derived or
  diagnostic confidence.
- Operation history rows are read-only and have `actionability=false`.
- Operation history has event names for graph/progress/witness/transcript/
  attention/containment projection writes.
- Reports set `coverageSource=fixture_sub_agent_observability`,
  `matrixPromotionCandidate=false`, `authorityPromotionCandidate=false`,
  `runtimeAuthorityExercised=false`, and `providerAuthorityExercised=false`.
- Reports split promotion candidates by H row and keep H4/H5/H7/H10 authority
  false.
- Fixture coverage exercises H1/H2/H3/H6/H8/H9/J9 and keeps H4/H5/H7/H10
  authority promotion false.
- Raw-exposure scans cover graph/progress/witness/transcript previews/status,
  operation history, renderer state, DOM attributes, localStorage/sessionStorage,
  IndexedDB if used, Sub-agents tab state, labels, summaries, and report
  artifacts.
- Sentinel counters include provider transport, app-server mutation, app-server
  turn start, approval response, workspace read, patch apply, command run,
  context pack, request manifest, direct session creation, spawn/send/wait/close,
  right ChatGPT pane mutation, and handoff mutation.

## Success Meaning

Passing PR 10 should mean:

```text
The shell can show and recover renderer-safe sub-agent graph, progress,
containment, attention, and transcript evidence without flattening child work
into the primary transcript or enabling model-visible multi-agent tools.
```

It should **not** mean:

```text
Direct can spawn sub-agents
Direct can wait on sub-agents
semantic broker can route to sub-agents
sub-agent progress can replay tools
child transcripts are primary conversation
child runs create provider continuity
right ChatGPT pane is imported or controlled
handoffs are mutated
app-server can be removed
direct is production/default
```
