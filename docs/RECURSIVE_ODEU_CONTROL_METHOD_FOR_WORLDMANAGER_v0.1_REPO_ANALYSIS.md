# Recursive ODEU Control Method v0.1 — Current Repo Analysis

Status: repo-grounded compatibility and gap analysis. No implementation
authority is implied.

Date: 2026-08-05.

Source proposal:
[Recursive ODEU Control Method for WorldManager v0.1](./RECURSIVE_ODEU_CONTROL_METHOD_FOR_WORLDMANAGER_v0.1.md).
The source was imported unchanged from the operator-supplied document. This
companion note compares it with the current Direct WorldManager implementation
and governing specifications.

## Executive verdict

The high-level method holds. It describes the missing recursive control layer
for the WorldManager architecture:

```text
semantically open ODEU nodes
inside
slot-specific, structurally closed unfold/fold control
```

It should be adopted as a new post-SC11 architecture frontier, provisionally
`WM-SC12`, rather than used to replace the existing keyboard pipeline,
semantic-context/ARO work, project genesis, or epistemic-ledger/semantic-CI
runtime.

The proposal is ahead of the current implementation in its central objects:
there is no recursive ODEU node, exact directional slot-contract registry,
recursive frontier scheduler, convergence/ancestry record, typed join, or
versioned parent-return runtime in the repo today. Its surrounding owner map,
however, is partly behind the repo. Project genesis and native WSL/Windows
substrate binding are already implemented, the ARO pipeline now reaches
bounded native work and semantic verification, thought brushes are live, and
SC11 already provides a bounded production artifact lifecycle with producers,
auditors, trusted witnesses, admission, restart recovery, and headless UI
acceptance.

The correct move is therefore:

> Extend the current WorldManager with recursive semantic control; do not
> rebuild the already implemented ingress, project, environment, ARO,
> WorkThread, ledger, audit, or effect paths under parallel identities.

## Current baseline

| Concern in v0.1 | Current owner | Current posture | Consequence |
| --- | --- | --- | --- |
| Present-focus and jurisdiction | `semantic-discharge-runtime.js`, `settlement.js`, semantic-region bindings, K2 routing/context | implemented | Add recursive-node focus as a compiled facet of existing settlement; do not create a second sovereign router |
| Project seed and constitution | `project-genesis.js`, `control-plane-store.js`, K5G/K6G | implemented | Recursive genesis should wrap or revise the existing candidate/constitution path |
| Environment choice | `realization-discovery.js`, `project-genesis.js`, `project-substrate-runtime.js` | implemented for primary WSL/Windows binding and thread inheritance | Reuse current environment refs and bindings; broad port/migration remains pending |
| Project-world activation | hierarchical-worldmodel transition path | pending | A fully activated new-project proof still depends on this constitutional slice |
| ARO identity and realization | `aro-kernel.js` plus SC7–SC8.5 modules | implemented bounded vertical path | Reuse ARO refs as semantic seeds/targets, but do not identify an ARO with a recursive reasoning-run node |
| Directional thought operations | `thought-brush.js` and ContextCanvas | implemented, temporary, operator/model invoked | Reuse its operator meanings; it is not yet the automatic recursive scheduler |
| Context selection | `semantic-context-kernel.js`, semantic shelves, request manifests, operational meta-context | implemented | Compile each recursive call through the existing bounded importer and omission evidence |
| Project/work execution | WorkThread registry/alignment, Direct role runtime | implemented in bounded paths | Bind recursive frontiers and returns to WorkThreads rather than replacing WorkThread identity |
| Artifact production/audit/admission | SC11 artifact lifecycle and assurance DAG | implemented for the bounded `ImplementationPatch` path | Use artifact constitutions to govern expansion, join, audit, remand, and admission artifacts |
| Event and epistemic provenance | `wm_events`, SC11 epistemic ledger, delivery/subscription runtime | implemented/partially generalized | Append recursive transitions into existing custody; do not create another general event bus |
| General plan worker start | keyboard K6 | pending | A terminal recursive leaf can use the bounded SC11 path now; generic plan execution still waits for K6 |
| Recursive ODEU control objects | none | not implemented | New SC12 kernel required |

Relevant current sources:

- [Keyboard pipeline](./DIRECT_WORLD_MANAGER_KEYBOARD_PIPELINE_SPEC.md)
- [Project genesis and substrate](./DIRECT_WORLD_MANAGER_PROJECT_GENESIS_AND_SUBSTRATE_SPEC.md)
- [Semantic context, ARO, and thought tools](./DIRECT_WORLD_MANAGER_SEMANTIC_CONTEXT_ARO_AND_THOUGHT_TOOLS_DESIGN.md)
- [Epistemic ledger and semantic CI](./DIRECT_WORLD_MANAGER_EPISTEMIC_LEDGER_AND_SEMANTIC_CI_SPEC.md)
- [`aro-kernel.js`](../src/main/direct/worldmanager/aro-kernel.js)
- [`thought-brush.js`](../src/main/direct/worldmanager/thought-brush.js)
- [`project-genesis.js`](../src/main/direct/worldmanager/project-genesis.js)
- [`project-substrate-runtime.js`](../src/main/direct/worldmanager/project-substrate-runtime.js)
- [`epistemic-fabric-runtime.js`](../src/main/direct/worldmanager/epistemic-fabric-runtime.js)
- [`control-plane-store.js`](../src/main/direct/worldmanager/control-plane-store.js)
- [`service.js`](../src/main/direct/worldmanager/service.js)

## What v0.1 gets right

### The unfold/fold control law

The strongest part of the proposal is the separation between semantic
authorship and structural control:

```text
reasoner:
  authors the local ODEU and candidate meanings

harness:
  selects the exact slot contract
  schedules eligible children
  enforces bounds and return obligations
  preserves revision and provenance topology
```

This matches the existing Direct doctrine that schemas govern form,
references, authority, and lifecycle without reverse-validating open semantic
content against a closed vocabulary.

### Slot typing is dependent, not merely directional

`back`, `front`, `up`, and `down` are insufficient as global prompts. The
lawful operator is determined by the full slot address:

```text
(parent semantic type,
 parent revision,
 source ODEU member,
 direction,
 scope owner,
 active constitution,
 evidence posture)
```

This is the correct control primitive. `ProjectSeed.O.down` and
`FontArchitectureOption.O.down` may both descend, but they must expose
different admissible child families and completion rules.

### Operational recursion with an acyclic semantic history

The proposed revision law is compatible with current append-only custody:

```text
Parent@1 -> children -> join -> ParentDelta -> Parent@2
```

The scheduler may loop; the persisted semantic history does not mutate or
create a back-edge into `Parent@1`.

### Convergence is an inspectable rational reinforcement

The convergence and upward-ancestry sections correctly reject confidence by
voice, repetition, or raw incoming-edge count. Distant lawful paths reaching
one endpoint can reinforce it, but only after shared premises, copied evidence,
and common framing have been factored.

The proposal is especially well aligned with the current epistemic ledger:
the ledger can preserve every path and standing change without forcing the
canonical worldmodel to accept the endpoint.

### Up is both abstraction and regulation

The upward path does more than generalize. It identifies:

- shared generative premises;
- false independence;
- the smallest lawful scope owner;
- project-to-world promotion requirements;
- systematic framing risks.

That is the correct mechanism for preventing one local rule from becoming
ambient world law.

### Semantic leaves do not execute themselves

The bridge in section 18 matches the implemented SC11 distinction:

```text
semantic necessity
  != valid implementation
  != effect authority
  != observed satisfaction of the parent purpose
```

Recursive ODEU should generate governed artifact requirements. SC11 should
continue to own production, required audits, trusted runtime witnesses,
remand/escalation, and scoped canonical admission.

## Corrections required before implementation

### 1. Update the repo and module owner map

The imported target name and proposed `src/main/direct/world-manager/` family
predate the current implementation. The active implementation is already
concentrated in:

```text
src/main/direct/worldmanager/
```

with a large existing `control-plane-store.js`, `service.js`, concern-specific
kernels, and the SC11 state stores. New modules should follow that topology,
for example:

```text
recursive-odeu-kernel.js
recursive-odeu-slot-registry.js
recursive-odeu-identity.js
recursive-odeu-scheduler.js
recursive-odeu-convergence.js
recursive-odeu-join.js
recursive-odeu-projection.js
```

Do not introduce parallel `constants.js`, `schemas.js`, `store.js`, or a
hyphenated directory until an actual ownership split requires them.

### 2. Treat new-project initialization as an integration proof

The proposal describes project genesis and environment selection as if they
were missing. They now exist:

```text
project seed
  -> grounded realization snapshot
  -> typed genesis result
  -> reconciled constitution candidate
  -> evidence review
  -> operator admission
  -> runtime default
  -> WSL/Windows workspace binding
  -> WorkThread environment inheritance
```

SC12 should insert recursive ODEU lineage around this path. It should not mint
a second project constitution or substrate-binding protocol.

### 3. Do not duplicate environment truth

There is no current `ProjectEnvironmentConstitution` object. Its proposed
meaning is distributed across:

- `ProjectConstitution` environment fields;
- `ProjectRuntimeDefaultBinding`;
- `ProjectWorkspaceBinding`;
- `ThreadEnvironmentBinding`;
- `StepEnvironmentSnapshot`;
- `ChildEnvironmentInheritance`.

The first SC12 slice should compile a semantic environment-constitution
projection over those exact refs. A new canonical object is justified only if
it owns law that cannot be expressed as a revision of the current project
constitution. Duplicating the same primary/Git/allowed-environment facts would
create competing truth.

### 4. ARO and recursive node are different identities

The current `AbstractReasoningObject` represents an intensional object with
required, possible, and counterfactual branches plus realization bindings.
A `RecursiveOdeuNode` represents one revisioned reasoning state around a seed
under an exact run and slot constitution.

Therefore:

```text
ARO
  may seed or be targeted by many recursive nodes

RecursiveOdeuNode
  references an ARO/decision/project/claim/option
  but does not replace that object's canonical identity
```

Collapsing the two would make a temporary reasoning frontier appear to revise
the underlying semantic object automatically.

### 5. Mechanical identity is not semantic equivalence

The harness may mechanically deduplicate:

- the same exact ID and revision;
- the same content-addressed event or artifact submission;
- replay of the same idempotency key.

It cannot decide that differently worded endpoints are the same abstract
object merely from hashing or similarity. The lawful path is:

```text
candidate endpoint identities
  -> semantic equivalence proposal
  -> exact path and ancestry witnesses
  -> required audit/review
  -> canonical shared endpoint decision
```

Consequently, “identity and deduplication” in the harness authority list must
be split into mechanical replay identity and governed semantic
canonicalization.

### 6. Preserve teleology/causality separation inside `front`

The latest concept defines:

```text
back  = causality
front = purpose
up    = meta
down  = substrate
```

The imported text sometimes groups downstream causal effects into `front`.
Slot contracts should distinguish at least:

```text
serves / intends / values / success_for     teleological
causes / enables / risks / follows_from     causal projection
```

An effect is not a purpose merely because it occurs later. The current thought
brush registry already separates `effect_projection` from other semantic
altitudes and can inform this distinction.

### 7. The four directions are obligations selected by contract

“Every eligible item unfolds in four directions” must not become an
unconditional Cartesian explosion. A trusted slot registry determines which
directions are required, optional, prohibited, already satisfied, or deferred
for each exact node revision. Every admitted option must receive ODEU treatment
or a typed exclusion, but not every textual field must spawn four provider
turns.

### 8. Existing SC11 is more mature than the proposal assumes

The current bounded `ImplementationPatch` lifecycle already provides:

- role-compiled ledger operations;
- durable subscriptions and delivery;
- producer and independent auditor WorkThreads;
- exact lifecycle revisions and assurance DAGs;
- trusted patch/test/repository witnesses;
- automatic remand and escalation;
- scoped hierarchical-worldmodel admission;
- Electron and Docker/Xvfb acceptance.

Recursive expansions, joins, and convergence audits should become artifact
classes on that fabric where scrutiny is required. A second recursive worker
router would recreate token-level orchestration that SC11 already removed.

### 9. Keep the two ledgers distinct but linked

The current implementation has both:

```text
wm_events
  conversation/control lineage

wm_epistemic_events
  generalized role-governed reason-state deltas and delivery
```

Recursive scheduler events should enter the existing event/control custody and
publish relevant epistemic standing changes through exact adapters. They
should not create a third universal event ledger.

## Updated logical object map

| Proposed object | Recommended integration |
| --- | --- |
| `direct_world_focus_resolution@1` | Compile as a recursive-focus projection referencing the existing SemanticSettlement, TaskSettlement, navigation/region binding, and routing decision |
| `direct_recursive_odeu_node@1` | New append-only reasoning-state object; exact seed ref and optional ARO ref; never grants authority |
| `direct_recursive_odeu_slot_contract@1` | New trusted registry object, versioned with the harness; model cannot invent it at runtime |
| `direct_recursive_odeu_directional_expansion@1` | New typed semantic artifact produced under one exact slot contract |
| `direct_recursive_odeu_convergence_record@1` | New candidate/validated provenance object; preserves paths and independence classes, does not itself admit endpoint identity |
| `direct_recursive_odeu_join_record@1` | New typed artifact with constitution-selected audit and remand law |
| `direct_recursive_odeu_parent_return@1` | New exact return artifact producing a candidate parent delta and successor ref |
| scope-promotion proposal/decision | Implement through the semantic artifact and governed decision/admission machinery rather than a silent graph rewrite |
| project/world state revision | Reuse hierarchical-worldmodel scope-CAS for canonical transitions; keep recursive parent revisions non-canonical until admitted |
| recursive frontier/run status | New control-plane projections and durable scheduler rows; never semantic or effect authority |

## Updated graph model

The proposed three DAGs and ledger remain useful conceptual projections, but
they need not become three unrelated graph engines.

```text
semantic reasoning DAG
  recursive nodes, directional expansions, shared endpoints, parent revisions
  persisted under WorldManager semantic custody

delivery/assurance DAG
  WorkThreads, artifact lifecycles, audits, remands, gates
  owned by current SC11/runtime substrates

self-development DAG
  the same recursive kernel with architecture_self scope and different slot law

event/epistemic ledgers
  immutable temporal and reason-state provenance linking all three projections
```

The project-delivery and self-development DAGs are typed uses of existing
owners, not justification for duplicate databases.

## Recommended `WM-SC12` sequence

### `WM-SC12.1` — Recursive kernel and trusted slot registry

Implement schemas, validators, exact refs, revisions, predecessor law, trusted
slot-contract registry, deterministic bounds, and restart verification. No
provider calls, scheduling, project mutation, or canonical effects.

Initial contracts should cover only:

```text
ProjectSeed.O/D/E/U x back/front/up/down where licensed
EnvironmentOption.O/D/E/U x licensed directions
```

### `WM-SC12.2` — Frontier scheduler and bounded context compilation

Persist run/frontier state, select exact required slots, compile each call
through the existing semantic context importer, record omissions, enforce
child/depth/node/attention budgets, and resume idempotently after restart.

The scheduler owns when a semantic call is due. It does not author its content.

### `WM-SC12.3` — Directional expansion artifact lifecycle

Add a fixed semantic action/tool contract for one exact slot. Register every
expansion as a candidate artifact and route any required assurance through
SC11. Structurally valid open content is accepted as candidate meaning; it is
not reverse-validated against a closed answer taxonomy.

### `WM-SC12.4` — Child ODEU recursion and typed exclusion

Every admitted option becomes a child node or receives an explicit exclusion
artifact with reason, authority, and residual risk. Prove no silent option
loss, no unlicensed child type, deterministic bounds, and no semantic cycles.

### `WM-SC12.5` — Upward ancestry and convergence

Introduce exact path witnesses, semantic equivalence proposals, shared-root
discovery, independence classes, duplicate derivation factoring, scope-owner
proposals, and no-scalar convergence anatomy. Mechanical exact replay can
dedupe automatically; semantic endpoint merging requires governed standing.

### `WM-SC12.6` — Join and versioned parent return

Join siblings under an exact join contract, preserve alternatives and
contradictions, produce O/D/E/U parent deltas, and create `Parent@2` without
mutating `Parent@1`. Required joins may be declared as semantic-CI artifact
lifecycles with auditors selected by constitution.

### `WM-SC12.7` — Existing project-genesis integration proof

Run the loop around the current K5G/K6G project-genesis path:

```text
user seed
  -> recursive ProjectSeed root
  -> typed directional expansions
  -> child option ODEUs
  -> environment comparison
  -> convergence/upward audit
  -> parent return
  -> existing ProjectConstitutionCandidate
```

Evidence review, operator admission, substrate provisioning, and project-world
activation retain their existing owners. The recursive loop grants none of
those effects.

### `WM-SC12.8` — Semantic UX and self-development dogfood

Project one stable event identity across root, slots, children, convergence,
join, and parent revision. Keep the default surface compact and expose the DAG
through semantic zoom. Then use `architecture_self` scope to design or audit
one subsequent WorldManager change, preserving its architecture-parent return
as dogfood evidence.

## Live spot check: current project genesis

The live control-plane state inspected on 2026-08-05 contains the new
non-canonical candidate:

```text
project_jbig2_glyph_ontology_pdf
JBIG2 Glyph Ontology PDF Reconstructor
```

The current genesis turn produced one flat typed payload containing ten
free-form project decisions, then the harness created one separate
constitution-admission decision. The semantic artifact registry therefore has
eleven active decision objects for that candidate. This is useful evidence of
both the strength and the present limit of K5G:

```text
current:
  one manager turn -> flat open-decision list

SC12 target:
  seed ODEU -> exact directional provenance -> option ODEUs
  -> convergence/ancestry -> joined parent revision
```

The operator-observed UI count of nine does not match the eleven active backend
artifacts and remains a separate projection/count defect. Recursive control
would improve decision provenance, but it must not be used to conceal or
explain away that current truth mismatch.

The same live turn also proves that the newly added manager runtime preference
was effective: provider telemetry records `gpt-5.6-sol` at `xhigh`.

## No-authority-widening proof obligation

Every SC12 artifact must preserve:

```text
focus resolution        grants no route/effect authority
recursive node          grants no canonical or execution authority
slot contract           constrains reasoning; grants no project mutation
directional expansion   candidate meaning only
convergence record      provenance/standing only
join                    candidate parent delta only
parent return           successor proposal only
frontier                 scheduler pointer only
semantic leaf           work requirement only
```

Canonical project/world change continues through existing scoped admission.
Workspace, Git, remote, and external effects continue through existing
capability and approval gates. A recursive loop can recommend that a
transition is required; it cannot manufacture the authority to perform it.

## Conclusion

The imported v0.1 is a strong architecture synthesis and should become the
conceptual parent of `WM-SC12`. Its direct thesis, source-slot-specific typing,
versioned fold, convergence anatomy, upward ancestry audit, boundedness, and
authority separation are current and valuable.

Its implementation handoff should be revised around the repo that now exists:

```text
SC1-SC11 provide the semantic, operational, ledger, and assurance organs.
SC12 should provide the recursive nervous loop that composes them.
```

The next implementation action should be a bounded `WM-SC12.1` spec and
kernel design, not a rewrite of project initialization and not immediate broad
recursive execution.
