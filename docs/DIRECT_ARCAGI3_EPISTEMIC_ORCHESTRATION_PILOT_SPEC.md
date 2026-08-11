# Direct ArcAGI3 Epistemic Orchestration Pilot

Status: implemented first Direct Workbench field pilot.

This pilot is deliberately separate from WorldManager canonical governance. It
tests two scale-invariant epistemic capabilities against the same ArcAGI3
repository:

1. typed, source-faithful transcription of Direct workthread activity;
2. canonical purpose ports into a revision-bound repository semantic model.

The pilot is useful only if the resulting objects can be imported by a stronger
upstream reasoner without rereading raw logs or rediscovering the repository.

## Practical outcome

For one configured ArcAGI3 project, Direct Workbench must be able to:

```text
observe the current Git/worktree O revision
  -> admit a bounded ArcAGI3 seed E revision
  -> expose canonical repository ingress ports
  -> rebuild exact typed thread history from persisted events on read
  -> maintain it incrementally while the Direct epistemic service is active
  -> optionally use GPT-5.6 Luna to transcribe linguistic residue
  -> answer purpose-bound IMPORT_CONTEXT requests
  -> preserve exact source and revision lineage
```

This slice prepares the information plane required by a later Max orchestrator
and workspace-manager runner. It does not yet claim recursive coding workers,
automatic worktree creation, semantic repository completeness, or automatic
admission of agent interpretations.

## Scale-invariant kernel

```text
subject O substrate
  -> typed E projection
  -> canonical purpose port
  -> bounded context import
  -> higher-level reasoning
```

The shared kernel owns:

```text
SubjectRef
ORevisionRef
ERevisionRef
EpistemicRecord
EvidenceRef
Standing
Provenance
SemanticPort
ContextImportRequest
ContextImportResult
```

`EpistemicRecord` carries the proposition structure required for epistemic
version control rather than treating prose as the versioned object:

```text
type
semantic key
predicate
scope
quantification
standing
actor / attribution
evidence refs
source refs
dependency refs
validation posture
O revision
E revision
```

Natural-language statements are payload projections of these records. They are
not the identity, standing, or provenance mechanism.

Thread and repository profiles reuse those objects but have different
promotion laws.

## O and E revision law

Git primarily versions admitted repository O. The epistemic store separately
versions what Direct currently understands that O revision to instantiate.

```text
ProjectHead = {
  O_revision,
  E_revision,
  E_coverage,
  E_staleness
}
```

An E revision is always bound to an exact O revision. A new worktree state does
not silently inherit a fresh semantic standing. It either receives a new
revision or reports revalidation debt.

For a Direct workthread, O is the append-only normalized event history plus
exact persisted tool-result state. E is the typed transcription of that
history.

## Thread transcription law

The continuous transcriber is not a semantic observer.

```text
raw event
  -> exact harness fact, when already structured
  -> source-faithful typed description, when linguistic normalization is needed
```

It may record:

```text
AgentAction
ToolInvocation
ToolResult
WorkspaceMutation
TestExecution
AgentClaim
AgentInterpretation
DeclaredBlocker
DeclaredCompletion
TurnOutcome
UsageObservation
```

It may not decide:

```text
whether an agent interpretation is true
whether the task is strategically converging
whether an artifact is ready to merge
whether upstream intervention is required
which continuation should be selected
```

The mandatory three-way distinction is:

```text
what mechanically occurred
what an actor said the event meant
what has independently been validated
```

Every newly persisted normalized event carries a verified source-envelope
digest. The deterministic harness indexes structured runtime and tool facts. The Luna
role receives only bounded linguistic residue and exact candidate evidence
references. Its output has attributed standing and cannot promote a statement
to repository truth.

Luna execution is opt-in for this pilot. Exact event indexing is always local
and deterministic. This prevents normal Direct usage from silently consuming
provider quota.

Official model grounding:

```text
model: gpt-5.6-luna
endpoint: Responses API
features used: streaming and structured output
role: efficient high-volume typed transcription
```

Source: <https://developers.openai.com/api/docs/models/gpt-5.6-luna>

## No active bottom-up communication

```text
active control:
  operator -> orchestrator -> workspace manager -> worker

passive evidence:
  runtime/workthread -> append-only event store -> typed transcription
  higher roles -> IMPORT_CONTEXT over prepared objects
```

The transcriber never sends a message to a working agent. A downstream role
never requests context, capabilities, escalation, or workers from upstream.
An inability or missing affordance may be recorded as an outcome, after which
an upstream role independently chooses any later intervention.

## Repository semantic ports

A repository port is a versioned traversal contract over one shared semantic
model, not a saved prose summary.

The first ArcAGI3 profile exposes:

```text
architecture_mutation
failure_diagnosis
game_instance_diagnosis
impact_analysis
patch_audit
test_evidence
```

Each port determines:

```text
entry semantic objects
traversal order
default facets
evidence requirements
implementation descent references
omission policy
```

The initial E revision is intentionally bounded. Profile revision 2 pins the
full SHA-256 digest of every source entitled to support a seed law. A missing,
changed, unstable, or unsafe source makes the observation incomplete, prevents
admission, and creates explicit cartography/revalidation debt. It admits project-constitution
and engineering laws backed by the repository's `AGENTS.md`, maintained surface
map, audit procedure, and test manifests. It does not claim a complete ArcAGI3
ontology.

Raw `rg`, AST, and file tools remain lawful substrate affordances. Missing or
stale canonical ingress is explicit cartography debt rather than permission to
pretend the port is complete.

## Purpose-bound context import

The common request is:

```text
IMPORT_CONTEXT {
  subject
  O_revision
  E_revision
  port
  purpose
  facets
  detail_depth
  since_revision
}
```

The result contains only already-prepared typed records, exact provenance,
freshness, omissions, and source revision witnesses. It contains no raw
transcript, private workspace locator, provider secret, or implicit authority.

In this slice, `detail_depth=typed_records`,
`raw_evidence_policy=references_only`, and an unbounded typed-record count are
the only supported materialization posture. Unsupported detail/raw/token
requests fail visibly instead of being ignored. `since_revision` is executed
as a semantic-key/digest delta over the active E lineage.

Examples:

```text
thread.tool_activity
thread.agent_interpretations
thread.execution_outcomes
thread.full_typed_history

repo.architecture_mutation
repo.failure_diagnosis
repo.patch_audit
```

Higher-order status synthesis is not continuous infrastructure. If the
orchestrator needs blocker diagnosis, integration readiness, causal failure
analysis, or architectural implication, it instantiates an ordinary bounded
auditor. That auditor begins from typed transcription and repository E, then
selectively descends through source references.

## Storage

One Direct epistemic SQLite v2 store contains both scales:

```text
subjects
O revisions
E revisions
typed records
semantic ports
context-import receipts
transcription jobs and receipts
```

Raw Direct rollout/session artifacts remain the source of dialogical truth.
Git and worktree evidence remain the source of repository O identity. The
epistemic database is rebuildable from those sources plus admitted seed/profile
revisions.

## First UI surface

The ordinary Direct Workbench runtime inspector receives an `Epistemic` tab.
It exposes:

```text
repository O/E head and dirty/staleness posture
available canonical ports
typed thread record counts and transcriber posture
Luna model/effort selection used by the pilot
purpose-specific context imports
explicit refresh/sync/transcribe actions
```

Inspection grants no repository, thread, or authority mutation. “Materialize
local preview” creates an immutable receipt for inspection only; it does not
admit context to a Direct turn and sends nothing to a provider.

## Pilot comparison

The eventual ArcAGI3 field experiment uses the same O revision, objective,
models, effort, tool rights, and budget across:

| Variant | Thread projection | Repository ingress |
|---|---|---|
| Baseline | raw logs | raw repository exploration |
| T | typed transcription | raw repository exploration |
| R | raw logs | canonical repository ports |
| T+R | typed transcription | canonical repository ports |

Primary measures are context tokens, raw probes, time to governing boundary,
duplicate exploration, invalid game-specific generalization, coordination
interventions, useful artifacts, and reusable E revisions.

## Acceptance boundary

The first slice is complete when regression/headless evidence proves:

1. the same O evidence produces an idempotent O revision;
2. E can revise without changing O;
3. thread records preserve actor/output/interpretation/validation distinctions;
4. Luna output cannot promote an attributed claim to admitted repository truth;
5. repository ports return stable purpose-bound object sets;
6. tool activity is omitted when the importing purpose does not select it;
7. every context result carries exact O/E and provenance witnesses;
8. the Direct Workbench inspector can initialize, refresh, import, and inspect
   the pilot without exposing private paths;
9. local and resident-backend read-only ArcAGI3 smoke runs succeed against the
   actual repository and reconstruct identical O/E identities.

## Implemented pilot status

The first vertical slice is implemented on
`codex/arcagi3-epistemic-orchestration-pilot`.

Implemented:

```text
shared Subject / O revision / E revision / record / port / import kernel
  -> one Direct-owned SQLite store for repository and thread subjects
  -> resident-workspace Git/worktree observation, including untracked content hashes
  -> fail-closed resident schema, bounds, digest, omission, coherence, and O/E validation
  -> identical repository O/E identity through local and WSL resident observation
  -> bounded ArcAGI3 profile revision 2 with pinned evidence sources
  -> six revisioned repository ingress ports
  -> deterministic transcription of persisted Direct normalized events
  -> private native-child event persistence before parent-facing result reduction
  -> explicit Luna structured-output transcription of assistant residue
  -> idempotent Luna receipts plus provider cancellation on service shutdown
  -> attributed-standing and no-promotion enforcement for Luna records
  -> purpose-sensitive immutable import receipts
  -> atomic compare-and-swap publication of E head, records, ports, and completed transcription receipt
  -> separately idempotent, immutable purpose-sensitive context receipts
  -> restart verification plus explicit interrupted-transcription recovery
  -> closed native-agent pool cancellation and typed capture-gap projection
  -> Direct Workbench Epistemic inspector and narrow IPC surface
```

Verification commands:

```text
npm run direct:arcagi3-epistemic
npm run direct:arcagi3-epistemic:local-smoke
npm run direct:arcagi3-epistemic:resident-smoke
npm run direct:t3-alternate-gui:electron
```

Both smokes read the actual ArcAGI3 repository and compare Git plus full
worktree/source evidence before and after. The local smoke writes its Direct
store and synthetic thread fixture under a temporary directory. The resident
smoke performs only the bounded substrate-local observation and proves that it
reconstructs the same O/E IDs without exposing a workspace path or file body.
Either smoke fails if its observation detects a repository change.

## Honest frontier after this slice

The pool's public parent-facing result remains a bounded terminal summary.
Privately, Main now persists each native child's normalized provider events as
a separate Direct child session before that reduction, with project, parent,
workthread, agent, model, and effort attribution. The child prompt and inherited
context are represented only by digests. The same deterministic and Luna paths
can therefore cover actual downstream child workthreads without adding a
child-to-parent message or any new child affordance.

Capture currently occurs when the child provider turn returns. It is lossless
for the normalized result received by Main but not an incremental live prefix
if the process dies mid-turn. A capture failure is carried as an explicit
omission on the provider-backed child result and the operator-facing pool
record, but there is not yet a separate durable capture-gap outbox. Closing the
Direct runtime aborts active native-child provider work and cancels queued
children before session teardown. Native children otherwise remain
reasoning-only: they have no tools, recursive spawn, or workspace authority in
this slice.

Other explicit deferrals:

```text
incremental Direct and native-child SSE prefix durability before a provider turn terminates
app-server notification/request/response transcription
automatic admission of IMPORT_CONTEXT into a worker context pack
purpose-bound higher-order auditor dispatch
child workspace tools and per-child Git worktrees
live provider evaluation of Luna quality and model-catalog preflight
```

These are not hidden behind a generic “continuous observer” claim. The present
pilot proves the shared language, storage, revision, port, purpose-identity,
renderer-safety, and actual-repository boundaries first.
