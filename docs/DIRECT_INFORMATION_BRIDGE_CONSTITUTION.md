# Direct Information Bridge Constitution

Status: root architecture doctrine for the long-lived
`codex/direct-chatgpt-harness` branch.

Source inputs:

- User/GPT synthesis pasted in-thread on unified information bridge.
- Attached GPT synthesis:
  `/mnt/c/Users/Rose/.codex/attachments/747c8eb5-b098-4938-9070-3fc11d897bf6/pasted-text.txt`
- Existing direct storage, context, recovery, mutation, memory/frontier, and
  meta-session specs.

Related docs:

- [DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md](./DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)
- [DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md](./DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md)
- [DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md](./DIRECT_WORKSPACE_MUTATION_TRUTH_AND_POLICY_SPEC.md)
- [DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md](./DIRECT_SUB_AGENT_OBSERVABILITY_AND_CONTAINMENT_SPEC.md)
- [DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md](./DIRECT_GOVERNANCE_AND_SEMANTIC_BROKER_DIAGNOSTICS_SPEC.md)
- [DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md](./DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md)

## Root Stance

The direct harness is not fundamentally a Codex clone, a tool runner, a thread
store, or a UI shell. It is an institutionalized information bridge between:

```text
human authority / project owner
  <-> harness information institution
  <-> OAI-side model intelligence
```

Everything else is mediating infrastructure:

```text
host machine
WSL backend
repo/filesystem
database
JSON rollouts
operation ledger
context packs
request manifests
tool calls
approval cards
memory
compaction
baton
skills
hooks
UI panes
provider APIs
```

These are not separate feature families. They are organs of one bridge that
stores, selects, transforms, authorizes, transmits, materializes, audits, or
forgets information between the human and the model.

## Primary Chain

The harness governs this chain:

```text
Human intention
  -> interface event
  -> stored artifact
  -> selected context
  -> provider request
  -> model activation
  -> model output
  -> harness interpretation
  -> UI presentation
  -> human perception / decision
  -> possible action
  -> world mutation
  -> new evidence
```

Every step can preserve, distort, compress, authorize, omit, or falsify the
interaction. The harness exists to make those transitions explicit enough that
the human and model can cooperate without hidden ambiguity.

## Core Invariants

```text
memory is not source truth
git is not source truth
workspace folder is not source truth
chat session is not source truth
database projection is not source truth
UI state is not source truth
provider response is not local action authority
model intent is not permission
human approval is not proof of outcome
tool result is not proof that the provider saw the result
context inclusion is not endorsement
compaction is authorized loss, not perfect preservation
```

The source truth is not any one substrate. The source truth is the explicitly
declared ODEU mapping of the relevant work world, backed by cited evidence
artifacts and lawful transition records.

## Information Role Law

Every component must declare its role in the bridge before it becomes a durable
architecture dependency.

Allowed root roles:

```text
canonical evidence store
derived projection
context construction mechanism
authority gate
action executor
memory / continuity artifact
observability surface
governance / routing rule
```

No component should be added as a "feature" unless it can answer:

```text
What information does it preserve?
What information does it compress?
What information does it omit?
What information does it expose?
What authority does it carry?
Who can consume it?
Who can mutate it?
What evidence proves it?
What context packet can cite it?
What action, if any, can it authorize?
```

## Action As Information

Action is not outside information. Action is information with world-state
changing force.

Examples:

```text
read_file
  world -> harness evidence -> model context

apply_patch
  model proposal -> human approval -> workspace mutation -> evidence -> model context

run_command
  model proposal -> human approval -> process execution -> stdout/stderr/effect evidence -> model context
```

Therefore, tools are not merely callable functions. They are authority-bearing
information transitions.

## Bridge Artifact Classes

### Canonical Event Evidence

Purpose:

```text
preserve what happened
```

Examples:

- append-safe JSON rollouts;
- normalized event logs;
- operation ledgers;
- patch journals;
- command execution records;
- approval decisions;
- provider request/response envelope evidence when safe.

Rules:

- Canonical artifacts are append-safe or explicitly versioned.
- Recovery consumes canonical artifacts without replaying side effects.
- Canonical artifacts may be private and app-owned; renderer projection is a
  separate object.

### Derived Projection

Purpose:

```text
make canonical evidence usable for UI, search, context building, diagnostics,
thread graphs, and governance
```

Examples:

- renderer transcript projection;
- compact transcript projection;
- thread list/index rows;
- current workbench status;
- sub-agent graph projection;
- usage summaries.

Rules:

- Projections are rebuildable.
- Projections cite source spans, policy versions, and digests.
- Projections never outrank canonical evidence.
- Renderer projections are not model context by themselves.

### Context Construction

Purpose:

```text
compile selected information into model-consumable input
```

Examples:

- direct context pack;
- request manifest;
- recent dialogue projection;
- obligation context;
- tool continuation context;
- fork/checkpoint context.

Rules:

- Context packs record what the model was actually given.
- Request manifests record why the provider request was lawful.
- Raw rollout/session files are not normal prompt-construction inputs.
- Context inclusion does not create truth or action authority.

### Memory, Compaction, Baton, Frontier

Purpose:

```text
manage continuity under context pressure
```

Distinctions:

```text
information with persistence = memory
information with authorized compression = compaction
information with frontier relevance = baton
information with unresolved obligation = obligation context
information with stale or incomplete evidence = risk surface
```

Rules:

- Memory is evidence, not source truth.
- Compaction must declare loss, policy, source spans, and residual risk.
- Baton/frontier artifacts must distinguish current obligations from historical
  background.
- Model-generated summaries require provenance and may not silently replace
  canonical evidence.

### Authority Gate

Purpose:

```text
decide whether a transition may occur
```

Examples:

- approval card;
- semantic broker;
- direct governance packet;
- provider capability profile;
- sandbox/access policy;
- replay safety classifier;
- project/work-thread target resolver.

Rules:

- Authority gates must be main-process or backend mediated.
- Renderer affordance is not authority.
- A configured preference is not proven runtime capability.
- Unknown state fails closed for mutation.

### Action Executor

Purpose:

```text
materialize authorized information as world change
```

Examples:

- read-only tool executor;
- patch apply executor;
- command executor;
- workspace staging writer;
- ChatGPT/Codex bridge macro;
- hook runner.

Rules:

- Executors require explicit authority input.
- Executors emit outcome evidence.
- Executors must be idempotency-aware where replay is possible.
- Failed, interrupted, and unknown outcomes are not success.

### Observability Surface

Purpose:

```text
make bridge state inspectable by the human
```

Examples:

- Codex transcript;
- runtime provider status;
- bottom usage/access band;
- middle analytics tab;
- direct thread workbench;
- sub-agent panel;
- recovery diagnostics.

Rules:

- UI state is a projection, not source truth.
- UI may express authority, but may not mint authority.
- Missing evidence renders as unknown, unavailable, degraded, or blocked.
- Action surfaces must show state transitions and failure posture.

### Governance And Routing

Purpose:

```text
route information to the right work world, role, context, and authority boundary
```

Examples:

- project broker;
- work-thread resolver;
- meta-session controller;
- semantic broker;
- agent role router;
- hook policy.

Rules:

- No task may mutate a workspace until its work-thread target is resolved.
- No routing decision may rely only on chat recency when repo, branch, artifact,
  or ontology evidence conflicts.
- A broker routes; it does not silently become the worker or auditor.
- Object-level validity belongs to the assigned validation role, not the
  workflow router unless explicitly contracted.

## Storage Constitution

Storage is not one thing.

```text
append-safe JSON artifacts
  canonical event/dialogue/control evidence

SQLite databases
  indexes, projections, current views, graph state, search, workbench state

context pack artifacts
  exact model input evidence

request manifests
  request authorization and provider-shape evidence

operation ledgers
  human/app control mutations and action transitions

memory / compaction / baton artifacts
  managed continuity under context pressure

UI state
  ephemeral display and interaction state only
```

Rules:

- SQLite may cache and index truth, but does not replace canonical artifacts.
- Raw provider/auth frames stay below the safe renderer boundary.
- Renderer-safe rows must not expose raw auth, raw provider payloads, hidden
  prompts, or raw local paths unless an explicit private diagnostic mode allows
  it.
- Database rows that summarize or classify must cite source artifacts or declare
  unavailable evidence.

## Context Constitution

Context is not "whatever fits in the prompt." Context is selected bridge
information with declared authority.

Context classes:

```text
operator intent
active work-thread state
recent dialogue evidence
current obligations
selected memory
selected artifact excerpts
tool continuation evidence
governance constraints
provider/runtime settings
```

Rules:

- Every provider request cites a context pack and request manifest.
- Context packs distinguish instruction authority from historical evidence.
- Context packs distinguish human text, model text, tool evidence, memory,
  compaction, and governance material.
- Context builders must not read raw history ad hoc when versioned projections
  exist.
- Context builders must record omission/compression decisions when those
  decisions matter to the task.

## Agent Constitution

Agents are not chats. Agents are role-specific bridge participants.

Root agent classes:

```text
operator broker
project/work-thread broker
implementation worker
audit worker
fix worker
closeout worker
meta-orchestrator
sub-agent worker
memory/compaction worker
governance/semantic broker
```

Rules:

- Each agent class consumes a declared context packet family.
- Each agent class produces a declared artifact family.
- A worker produces object-level artifacts.
- An auditor judges object-level artifacts.
- A meta-orchestrator validates artifact class/provenance and advances the loop.
- A broker resolves target world and routes work; it must not silently perform
  object-level work unless that role is explicitly assigned.
- Sub-agent outputs do not become primary transcript messages unless projected
  through a parent activity summary or selected agent view.

## Skills, Hooks, Apps, And Tools

These are information bridge modules, not miscellaneous extensions.

### Skills

Role:

```text
typed procedural context modules
```

Rules:

- Skill invocation must declare why the skill is relevant to the current
  work-thread/context packet.
- Skills provide context/procedure; they do not create authority to mutate.
- Skill outputs that affect durable state must be captured as evidence or
  projected into a context pack.

### Hooks

Role:

```text
event-triggered information/action transforms
```

Rules:

- Hook trigger, input, authority, side effects, and output evidence must be
  explicit.
- Hooks that mutate world state require the same authority discipline as tools.
- Hooks that only enrich context still need provenance and staleness posture.

### Apps / Connectors

Role:

```text
external information surfaces and action endpoints
```

Rules:

- Connector output is imported evidence, not project truth.
- Connector actions must declare external authority and side effect scope.
- Imported external files/messages must be staged, witnessed, or cited before
  they enter context or action flows.

### Tools

Role:

```text
authority-bearing local or provider actions
```

Rules:

- Tool calls require capability evidence and policy.
- Tool inputs/outputs are evidence-bearing information.
- Tool execution and tool continuation are separate transitions.
- Replay safety must distinguish local side effect from provider continuation.

## Work-Thread Constitution

The real unit of work is not a repo, folder, branch, chat, or provider thread.

```text
active work thread
  = project ontology
  + branch/workspace identity
  + current objective
  + live constraints
  + context packet
  + authority boundary
  + open obligations
  + endpoint bindings
```

Endpoint bindings may include:

```text
direct harness thread
Codex app-server thread
ChatGPT review thread
sub-agent threads
artifact roots
repo/branch/worktree refs
```

Rules:

- Endpoint bindings are projections of a work thread, not the classifier.
- Thread lists should be organized by work-thread semantics, not only by
  repo/folder recency.
- A wrong-thread user utterance should be routed through work-thread resolution
  before mutation.
- Ambiguity must be surfaced when multiple active work threads share a repo/root
  but differ by branch, objective, or authority boundary.

## Bridge Failure Classes

Common failures this constitution is meant to prevent:

```text
projection laundering
  derived UI/database state treated as canonical truth

authority inflation
  label/config/preference treated as permission or capability

context smuggling
  raw or stale information enters model input without policy/provenance

action replay
  local side effect or provider continuation repeated after ambiguous restart

memory overclaim
  memory/summary treated as exact source evidence

thread flattening
  sub-agent or external thread messages rendered as primary human/model dialogue

world-target confusion
  task mutates the wrong repo/branch/work-thread due to chat recency

silent compression loss
  compaction hides decisive unresolved obligations or uncertainty

renderer authority leak
  renderer-visible control string becomes action authority
```

## Acceptance Criteria For Future Specs

Any direct-path feature spec should include:

- bridge role classification;
- canonical evidence source;
- derived projection shape, if any;
- context impact;
- authority/mutation boundary;
- persistence location and retention rule;
- renderer-safe exposure rule;
- recovery/replay posture;
- agent role, if any;
- work-thread routing implication;
- raw-exposure and privacy constraints.

The operational registry gate is defined in
[DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md](./DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md).
Feature specs should instantiate that gate before selecting storage, context,
UI, agent, hook, skill, or action implementation.

Passing a feature spec should mean:

```text
The feature's role in the human <-> harness <-> model information bridge is
explicit, bounded, and auditable.
```

It should not mean:

```text
The feature can store, summarize, route, expose, or act on information merely
because it is convenient.
```
