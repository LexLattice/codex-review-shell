# Direct Wave 26 Terra High vs. Intent — Sol Max Audit

Date: 2026-07-15

Mode: audit only; no implementation, package, fixture, or status-file edits

Scope: Wave 26 PR 151-157 plus the app-server orchestration controls present in the reviewed worktree

## Executive verdict

**RED / REMAND. Wave 26 is a useful fixture substrate, but it does not yet satisfy the specified authority, cross-artifact binding, graph-first compilation, single-memory-authority, or bidirectional propagation laws. It must not be described as complete, production-integrated, or merge-ready.**

All declared Wave 26 regression commands pass. That result is real but narrower than the acceptance claim: the tests establish schema construction, several positive paths, selected local negatives, CAS behavior, raw-transcript exclusion, and additive migration behavior. They do not establish that a hostile or merely inconsistent caller cannot manufacture a locally valid artifact, substitute another project/scope, or report a state transition that never affected runtime state.

Severity counts:

| Severity | Count | Disposition |
|---|---:|---|
| Critical | 6 | Acceptance blockers |
| High | 8 | Acceptance blockers |
| Medium | 4 | Required before completion/status promotion; some may follow the critical fixes |
| Low | 2 | Follow-up hardening |
| **Total** | **20** | **Remand** |

“Critical” here means a Wave 26 acceptance-law failure in the reviewed fixture/library surface. It is not a claim that these modules are already reachable as a deployed remote exploit; production reachability is itself unproven.

## Evidence model and review method

This report distinguishes three evidence levels:

- **Production capability:** code is present below `src/main/direct`, but a capability counts as integrated only when a live manager/context/memory path consumes it and its effects change authoritative runtime state.
- **Fixture substrate:** direct builders, validators, and regression scripts can construct and check artifacts. This is not equivalent to live integration.
- **Documentation claim:** prose/status metadata describes intent or maturity. A truthful “planned”, “local fixture”, or `partial / keep_guarded` claim is not upgraded by passing local fixtures.

Evidence labels used below:

- **Observed:** source, documentation, or a declared regression was inspected/run.
- **Reproduced:** an additional in-memory adversarial probe was executed against the checked-out modules.
- **Inference:** a conclusion drawn from repository-wide use-site search or the combination of observed artifacts; it is called out explicitly.
- **Orchestrator observation:** execution evidence supplied by the supervising run, not independently reproduced through sub-agent spawning by this single-agent audit.

The complete declared Wave 26 command set, syntax precheck, app-server controls regression, and executable information-bridge audit all returned `ok`. The information-bridge audit reported 105 rows, `valid: yes`, 0 missing, 39 implemented, 64 partial, and 2 inherited. Experimental SQLite warnings did not alter the results.

## Invariant matrix

| Intent invariant | Source/library capability | Fixture proof | Active production proof | Documentation posture | Audit result |
|---|---|---|---|---|---|
| World Manager > Project Manager > Thread Manager authority is enforced at every graph write | Actor-role enums and custody metadata exist, but append does not authorize actor against target scope/node | Positive appends and CAS negatives pass | None demonstrated | Spec requires enforcement | **FAIL** |
| Scope CAS is mandatory and revisions advance only for touched scopes | `appendWorldmodelGraphTransition` checks expected scope refs and increments touched refs | Stale/missing CAS cases pass | No live store integration demonstrated | Fixture/local | **PARTIAL PASS** — genuine kernel strength, insufficient authority law |
| Ledger/history is append-only and reconstructable | Transition chaining and digest refs exist; historical bodies and mutation replay validation do not | Head tamper and history-ref checks pass | None demonstrated | Spec requires historical truth | **PARTIAL / FAIL reconstructability** |
| Semantic ingress is evidence-bound before promotion | Raw transcript is excluded and broker output is required; candidate/resolution/custody/authority contexts are not transitively bound | Lawful promotion and selected negative cases pass | No live provider/manager consumer demonstrated | Fixture/local | **FAIL** |
| Role-indexed projection is least-privilege and policy-authorized | Scope filters exist, but caller supplies policy, audit mode, worker allowlist, and seeds; standalone projection refs are forgeable | Positive privacy fixture passes | No policy-authority provider demonstrated | Fixture/local | **FAIL** |
| Manager boot is graph-first and graph truth is compiled into O/E/D/U lanes | Boot and compilation-witness artifacts exist; cross-project boot and empty-lane compilation validate | Empty ActiveInteraction worldmodel is accepted by regression | Existing Thread Manager boot remains ODEU-role projection based | Spec requires graph-first | **FAIL** |
| Canonical graph is the single shared/project memory authority | `ScopedWorldMemoryBinding` and no-double witness exist | A double inclusion is detected as `remand` after both projections exist | AgentMemory selection has no binding/gate input | Compatibility overlay documented | **FAIL** |
| Closure/update/ack artifacts cause governed upward/downward state propagation | Admission can call graph append; packets, acknowledgements, status, and impact artifacts mostly attest outcomes | Artifact-shape and a positive admission path pass | No consumer shown staling/refreshing affected boots | Spec requires propagation | **FAIL** |
| Project execution profile is deterministically resolved from project truth | Contextual resolver checks world/project/control/topology/catalog artifacts | Positive resolution and selected negatives pass | No runtime launch binding demonstrated | Fixture/local | **PARTIAL** |
| Migration is additive, non-destructive, provenance-preserving, and cannot double include | Additive classification and destructive-rewrite flags are real; no-double is post-hoc, report may validate nonzero doubles, drift rewrite drops older refs | Migration games pass, including a deliberate double-remand witness | No migration runner/store cutover shown | Planned/local fixture | **PARTIAL / FAIL no-double gate** |
| Raw transcript/history never becomes context truth | Multiple closed validators reject obvious raw payload fields | Raw-field negative fixtures pass | No contradictory live path found in reviewed scope | Explicitly documented | **PASS for reviewed artifacts** |
| App-server effort/model controls render configured state truthfully | Source distinguishes configured, accepted, effective, and unverified states | Static/orchestration regression passes | Fresh-provider acceptance was observed externally; effective effort remained unobserved | Alpha/fallback and configured-unverified wording | **PARTIAL, truthfully bounded** |

## Findings by severity

### Critical

#### C-01 — Canonical graph append has no write-authority or custody enforcement

`src/main/direct/worldmodel/hierarchical-graph.js:204-224` validates the graph, expected scope revisions, and mutation scope coverage, then commits. It never checks `actorRole`/`actorAgentId` against node `custodianRole`, `authorizedWriterRoles`, project ownership, a Project Manager profile, or a concrete authority decision. Those fields are only normalized on nodes at `:115-118` and on transitions at `:140-147`.

**Reproduced:** a `thread_manager` transition targeting another project with a syntactically valid, separately generated authority source ref returned `committed: true`; the committed node scope was `project_b`.

This defeats the hierarchy’s central enforcement law even though CAS works. Required remedy: make authorization a mandatory contextual precondition of append, bind the authority decision to actor, role, graph, target scopes, exact mutations, expected revisions, and expiry, and reject rather than normalize missing/invalid authority.

#### C-02 — Semantic promotion permits resolution/candidate/scope substitution

`src/main/direct/worldmodel/semantic-ingress.js:138-158` builds target and broker artifacts, but standalone validators do not prove their relationship. Candidate validation at `:163-172` is shape-oriented. Assessment at `:230-252` binds the candidate to ingress/resolution IDs but does not prove that candidate target scopes, node graph/scope, sources, custody witness, and authority decision all refer to the same project and exact proposed mutation. Promotion at `:254-266` therefore commits through the weak append boundary.

**Reproduced:** a target resolution for `project_a` was paired with a candidate that wrote `project_b`; assessment and promotion accepted it, and the committed node was in `project_b`. The “authority” ref was a synthetic metadata-derived digest, not a concrete authorization artifact.

Required remedy: introduce a single contextual admission validator over ingress, broker result, target resolution, candidate, custody matrix/profile, authority decision, graph, expected scope revisions, and exact mutations; persist a digest of that bound envelope in the graph transition.

#### C-03 — Projection privacy is controlled by caller-supplied policy and standalone refs can be forged

`src/main/direct/worldmodel/graph-projection.js:71-95` normalizes caller-provided deny lists, `auditMode`, traversal depth, and worker node allowlists. `:102-135` treats those values and caller seed IDs as authority for omission/selection. `:217-224` emits only `selectionPolicyId`, not a policy artifact ref/digest or graph ref/digest. `:227-251` validates self-contained refs and a recomputed projection digest without a graph context.

**Reproduced:** caller `auditMode: true` selected an archived node; selected refs do not carry lifecycle, so the consumer cannot tell that it is non-current truth. A separately forged projection selecting `foreign_unbound_secret` passed the standalone validator after its digest was recomputed.

Required remedy: resolve policy from a trusted, versioned authority artifact; make audit projections a distinct non-context schema that preserves lifecycle/epistemic status; require context-aware validation against exact graph and policy digests; prevent worker callers from supplying their own allowlist/seeds.

#### C-04 — Cross-project manager boot and empty “compilation” witnesses validate

`src/main/direct/worldmodel/manager-turn-context.js:134-154` checks role/agent agreement but not that a Project Manager profile’s `projectId`/root matches the projection focal project, inspection project, declared ingress scopes, or dialogue frame. `:167-179` checks artifact identities and revisions but never proves that selected graph refs were compiled into O/E/D/U lanes. The ActiveInteraction kernel accepts an optional graph ref at `src/main/direct/worldmodel/kernel.js:271-300`, builds lanes independently at `:304-340`, and validates them independently at `:397-436`.

**Reproduced:** profile project A + projection/inspection project B + ingress hint A produced an accepted boot. A projection with selected graph nodes plus an ActiveInteraction worldmodel with zero task/environment/model-self/governance entries produced an accepted compilation witness.

The declared manager-context regression itself builds the default empty ActiveInteraction worldmodel at `scripts/direct-manager-turn-context-regression.mjs:91-95` and treats the witness as proof. Required remedy: define a deterministic compiler whose output contains a graph-projection ref and per-selected-ref inclusion/omission evidence, and validate boot through one cross-artifact project/scope closure.

#### C-05 — `ScopedWorldMemoryBinding` does not gate actual AgentMemory selection; “no double inclusion” is post-hoc

`src/main/direct/worldmodel/project-memory-propagation.js:101-108` validates a graph-primary binding against a supplied graph, but the actual AgentMemory selector at `src/main/direct/bridge/agent-context-source-refs.js:234-315` has no binding/compatibility-state input and does not exclude graph-primary memories. `src/main/direct/worldmodel/worldmodel-migration.js:101-108` only reports whether a legacy projection and graph projection already contain the same logical memory.

The migration game deliberately constructs both inclusions and obtains `remand` at `scripts/direct-worldmodel-migration-games-regression.mjs:51-57`. That proves detection, not prevention or single-source authority.

Required remedy: move compatibility state into the authoritative selection boundary, atomically switch a memory from legacy to graph-primary, reject any context assembly that includes both, and make the witness a receipt of an enforced gate rather than an observer.

#### C-06 — Propagation receipts can claim effects that no runtime state transition performed

`src/main/direct/worldmodel/project-memory-propagation.js:112-124` builds update packets, status, acknowledgements, and impact artifacts from caller-supplied refs/outcomes. Acknowledgement validation does not require an actual graph transition/resulting projection, and impact does not stale or refresh any manager boot. The regression supplies `outcome: "applied"` directly at `scripts/direct-project-memory-propagation-regression.mjs:94-95`.

The contextual admission path at `project-memory-propagation.js:126-150` is materially stronger and does call append, including a hard cross-project escalation failure, but it does not turn the surrounding packet/ack/impact protocol into an executed propagation state machine.

Required remedy: make acknowledgements derivable only from persisted transition receipts, bind packet affected IDs to the transition’s exact mutation set, persist delivery state, and require boot/context refresh receipts before reporting impact as applied.

### High

#### H-01 — Semantic idempotency is not persisted for revise operations

`semantic-ingress.js:156-158` computes a normalized semantic mutation digest and `:254-260` passes it into promotion, but `hierarchical-graph.js:140-145` reconstructs a transition from a fixed field list and drops that digest. Duplicate detection at `semantic-ingress.js:215` therefore cannot find it; its fallback covers only add-node semantic basis.

**Reproduced:** two semantically identical revise candidates had the same normalized digest, both committed, and project revision advanced to 2; the stored transition lacked `normalizedSemanticMutationDigest`.

Remedy: include and validate the normalized digest in the canonical transition schema, scope the idempotency key to graph/scope/actor/authority, and test add/revise/lifecycle/edge duplicates.

#### H-02 — Mutation kinds and graph consistency laws collapse into permissive merge behavior

At `hierarchical-graph.js:220-221`, `add_node`, `revise_node`, and `set_node_lifecycle` all merge into an upsert; edge mutation kinds do the same. There is no “add must not exist / revise must exist” law. Edge validation at `:133-138` and graph validation at `:191-199` do not require endpoints to exist, reject duplicate IDs/scoped revision keys, or bind every node’s `scope.userProfileId` to the graph. The graph builder at `:161-164` lets `node.scope.userProfileId` override the graph value. Materialization at `:149-155` treats lifecycle-active/eligible nodes as active even when epistemic status is `refuted`.

**Reproduced:** an active, eligible, epistemically refuted node appeared in active materialization.

Remedy: encode mutation-specific pre/postconditions, enforce graph-wide uniqueness and endpoint/scope identity, and define a single current-truth predicate over lifecycle, epistemic status, integration state, and projection eligibility.

#### H-03 — Append-only history stores historical digests without historical bodies or replay proof

`hierarchical-graph.js:167` initializes history refs; `:171-188` requires each ref ID to name a current entity and only requires one ref to match the current digest. Appends add digest refs at `:220-221`, but old node/edge bodies are overwritten. Graph validation at `:191-199` checks transition chaining/head but does not replay mutation receipts or prove each historical digest against a retained body. History projection at `:227-233` is built from current non-active nodes, not the revision history.

**Reproduced:** two history refs existed for a revised node while only one node body remained stored.

Remedy: persist immutable version records or canonical patches, bind transition before/after digests to them, and validate/replay graph state and scoped revision sequence from genesis/checkpoint.

#### H-04 — Project Manager identity, delegation, custody, and parent linkage remain self-attested in standalone artifacts

`src/main/direct/worldmodel/project-manager.js:33-39` accepts nonempty ref strings; profile validation at `:72-79`, standalone project-state validation at `:102-107`, delegation at `:113-114`, and custody witness/matrix validation at `:116-119` validate locally recomputed artifacts rather than the referenced manager profile, graph root, authority decision, or matrix. The regression explicitly accepts ref-only project state at `scripts/direct-project-manager-regression.mjs:80-87` and delegation at `:104-110`.

The contextual Thread Manager path is stronger when actual objects are supplied (`src/main/direct/thread-manager.js:513-626`), but new profile handling at `:220-240` and validation at `:275-315` still accept non-exact, self-described parent refs.

Remedy: separate portable shape validation from mandatory `validateAgainstContext` admission, require exact SHA-256 refs, and bind parent profile/project root/delegation/authority/custody row in one envelope.

#### H-05 — Profile-resolution outputs can be relabeled independently of their trace

`src/main/direct/worldmodel/project-profile-resolution.js:118-129` performs useful cross-object checks in the resolver. However, standalone result/trace/binding validation at `:95-112` and `:132-136` does not require a remanded result’s project/revision to equal its resolution trace, nor prove referenced catalog/topology/control artifacts. Runtime-verified refs can be self-minted syntactically; specialist contract resolution is optional in the resolver at `:125`.

**Reproduced:** a result labeled project B/revision 99 validated with a trace for project A/revision 3.

Remedy: make the resolved result a closed digest over the exact trace and all selected input refs, require contextual validation before launch, and fail closed when a route requires an absent specialist contract.

#### H-06 — Migration reports may validate while reporting a prohibited double inclusion; drift rewrite loses prior genealogy

`worldmodel-migration.js:110-116` requires a witness per binding and makes counters consistent, but does not require `doubleInclusionCount === 0`; a report containing `remand` witnesses and positive double count can still validate. At `:118-125`, artifact-drift mutation replaces claim/edge `sourceRefs` with `[before, after]`, discarding earlier provenance, while authority is checked mainly by kind/digest shape.

Remedy: completion-grade migration report validation must reject any positive double count, bind witnesses to the exact report graph/projections/bindings, preserve prior source refs or an immutable genealogy, and validate the authority artifact contextually.

#### H-07 — The “upward escalation” integration game proves stale-CAS remand, not lawful bidirectional transfer

`scripts/direct-worldmodel-governance-integration-games-regression.mjs:59-73` labels a project-to-world scenario, but the candidate omits the correct expected revision and receives a generic stale/remand result. Repository search finds `project_to_world_escalation` as an enum/test label, not a production transfer controller. There is no demonstrated accepted transfer with World Manager authority, nor a downward propagation that invalidates and recompiles dependent project/thread contexts.

Remedy: implement explicit upward and downward controllers with source/destination custody, two-sided revision expectations, authority decisions, persisted receipts, and both accepted and denied adversarial games.

#### H-08 — Wave 26 manager/context artifacts are not shown on the existing live boot path

**Inference from repository-wide use-site search:** manager boot, graph-first adapter, and compilation witness are consumed by regression scripts, not by a production manager/context provider. The existing Thread Manager boot path at `src/main/direct/thread-manager.js:743-783` still requests the prior ODEU role projection. The graph ref in the ActiveInteraction worldmodel is optional metadata rather than the source of compiled lanes.

Remedy: integrate behind an explicit guarded path, prove context-provider readback, and keep `ic62` partial/guarded until live Project Manager and Thread Manager boots are graph-derived and observably refreshed.

### Medium

#### M-01 — Dialogue-frame expiry and lifecycle semantics are representational, not enforced

`manager-turn-context.js:83-110` carries frame status and expiry values, but boot/validation does not prove time validity, decision closure, turn identity, or change-ref applicability. Expired/open-frame behavior therefore depends on caller honesty.

#### M-02 — Fixtures favor successful construction and local digest tamper over adversarial cross-binding

Several fixtures use permissive `sha256:<id>`-style refs, assert output labels, or test validators without the context they are supposed to protect. Passing them can mask the difference between cryptographic syntax, a locally recomputed digest, and evidence that a referenced authoritative object existed. Add hostile substitution matrices for project, graph, profile, role, actor, scope, revision, source, and authority independently.

#### M-03 — Status documentation contains internal drift

The Wave 26 spec is correctly marked planning/no PR merged and local fixture work at `docs/DIRECT_WAVE26_HIERARCHICAL_WORLDMODEL_PROJECT_MANAGER_SPEC.md:3-12`; the roadmap remains planned at `docs/DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md:5052`; and `ic62` remains `partial / keep_guarded` at `src/main/direct/bridge/information-registry.js:1882-1903`. Those are appropriate.

However, `docs/DIRECT_PROJECT_MASTER_STATUS.md:13` has a stale update marker, `:274-285` reports 104/63 rather than the executable audit’s 105/64, and `:725-730` still describes the fresh frontier as Wave 25/PR 150. Its older hierarchy summary at `:203-231` does not reflect the new Project Manager layer. Reconcile only after code-law remediation; do not use a docs refresh to imply completion.

#### M-04 — PR 157 review scope is coupled to independent app-server orchestration work

The worktree combines Wave 26 migration/games with app-server model/effort controls, renderer changes, launch/restart descriptors, observability, and a large independent regression. These have different rollback and acceptance surfaces. Split app-server orchestration controls from PR 157 unless there is an explicit dependency and a combined release plan.

### Low / follow-up hardening

#### L-01 — Compressed one-line builders and validators obscure transition laws

Several authority-sensitive functions place complete schemas and validation logic on one line (notably graph transitions, project-manager artifacts, and migration report validation). This makes missing cross-field laws difficult to review and encourages shape-validation to be mistaken for contextual validation. Expand them into named predicates with stable error codes and unit-sized tests.

#### L-02 — Silent enum/ID/default normalization masks invalid caller intent

Builders commonly replace invalid or absent roles, mutation kinds, scopes, IDs, summaries, and outcomes with defaults (for example `hierarchical-graph.js:70-76`, `:90-96`, `:107-123`, and `:140-145`). Defaults are useful for fixtures but unsafe at an admission boundary. Provide strict constructors for governed paths and keep lenient normalization explicitly fixture-only.

## PR-by-PR intent audit with exact source lines

### PR 151 — Hierarchical Worldmodel Kernel

- **Implemented substrate:** schemas/enums at `hierarchical-graph.js:10-35`; canonical digests at `:43-54`; scoped revisions at `:70-87`; graph chain/head/materialized checks at `:191-199`; mandatory scope CAS and touched-revision increment at `:204-224`.
- **Intent break:** authority/custody are not checked before append (`:204-224`) — C-01.
- **Intent break:** transition builder discards normalized semantic mutation digest (`:140-145`) — H-01.
- **Intent break:** upsert-like mutation collapse (`:220-221`), endpoint/uniqueness/scope gaps (`:133-138`, `:161-199`), and lifecycle-only materialization (`:149-155`) — H-02.
- **Intent break:** only historical refs, not reconstructable bodies (`:167`, `:171-188`, `:220-233`) — H-03.
- **PR verdict:** **remand**. CAS is real; canonical authority and historical truth are not.

### PR 152 — Project Manager Role and Scoped Custody

- **Implemented substrate:** Project Manager profile/project state/delegation/custody schemas in `project-manager.js:50-119`; contextual object checks exist in the stronger Thread Manager delegation path at `thread-manager.js:513-626`.
- **Intent break:** permissive refs and standalone self-attestation at `project-manager.js:33-39`, `:72-79`, `:102-119`; new Thread Manager parent-profile path at `thread-manager.js:220-240`, `:275-315` does not require exact contextual parent proof — H-04.
- **PR verdict:** **remand**. The role noun exists; the authority edge is not universally enforced.

### PR 153 — Semantic Ingress and Governed Idea Promotion

- **Implemented substrate:** ingress/broker raw-state boundary at `semantic-ingress.js:97-135`; explicit resolution artifact at `:138-145`; assessment/promotion APIs at `:230-266`; hard cross-project escalation rejection in the separate memory admission controller at `project-memory-propagation.js:148-150`.
- **Intent break:** ingress, resolution, candidate target, graph scope, custody, authority, and exact mutation are not closed over one context (`semantic-ingress.js:146-172`, `:185-208`, `:210-252`) — C-02.
- **Intent break:** semantic digest is calculated but lost before persistence (`semantic-ingress.js:156-158`, `:215`, `:254-260`; `hierarchical-graph.js:140-145`) — H-01.
- **PR verdict:** **remand**. Raw transcript exclusion is strong; governed promotion is substitutable.

### PR 154 — Role-Indexed Graph Context

- **Implemented substrate:** explicit audience roles/entry paths at `graph-projection.js:15-20`; graph validation and bounded traversal at `:150-205`; raw transcript and authority flags are hard-false at `:159-160`, `:250-251`; boot/compilation artifact schemas at `manager-turn-context.js:134-179`.
- **Intent break:** caller-supplied policy/audit/worker allowlist/seeds and graph-unbound standalone projection (`graph-projection.js:71-95`, `:102-135`, `:217-251`) — C-03.
- **Intent break:** boot project/scope closure and compilation-to-lanes are not proved (`manager-turn-context.js:134-179`; `kernel.js:271-340`, `:397-436`) — C-04.
- **Intent break:** production use-site is not demonstrated; existing Thread Manager boot remains prior projection based (`thread-manager.js:743-783`) — H-08, explicitly an inference from use-site search.
- **PR verdict:** **remand**. Projection artifact generation is not yet an authority-safe context path.

### PR 155 — Project Memory and Bidirectional Propagation

- **Implemented substrate:** closure/candidate/binding/update schemas at `project-memory-propagation.js:58-124`; contextual graph admission and hard cross-project rejection at `:126-150`.
- **Intent break:** graph-primary binding is not consumed by actual AgentMemory selection (`agent-context-source-refs.js:234-315`) and no-double is post-hoc (`worldmodel-migration.js:101-108`) — C-05.
- **Intent break:** packet/ack/status/impact artifacts can claim effects without persisted delivery, transition, or boot refresh (`project-memory-propagation.js:112-124`) — C-06.
- **Additional gap:** closure validates completed/archived WorkThread plus an ODEU result but does not bind the result envelope’s call/agent/project/work-thread identity to that WorkThread (`project-memory-propagation.js:58-76`).
- **PR verdict:** **remand**. One admission helper mutates the graph; the end-to-end propagation law is absent.

### PR 156 — Project Execution-Profile Resolution

- **Implemented substrate:** exact SHA syntax and typed refs at `project-profile-resolution.js:25`, `:36-42`; contextual resolver cross-checks world/project/control/topology/catalog at `:118-129`.
- **Intent break:** portable trace/binding/result/notification validators are not closed over the resolver inputs and allow result/trace relabeling (`:95-112`, `:132-136`) — H-05.
- **Additional gap:** effective control status and refs can be self-minted outside the contextual resolver (`:47-78`); specialist contract is optional at `:125`.
- **PR verdict:** **remand**, with a comparatively strong core resolver worth preserving.

### PR 157 — Compatibility Migration and Agentic Games

- **Implemented substrate:** additive legacy-memory classification and provenance objects at `worldmodel-migration.js:60-81`; WorkThread/project linkage at `:84-93`; explicit non-destructive/no-automatic-promotion report flags at `:110-116`; artifact drift detection at `:118-125`.
- **Intent break:** no-double witness observes rather than gates (`:101-108`); report accepts a consistent positive double count (`:110-116`) — C-05/H-06.
- **Intent break:** drift rewrite replaces prior source genealogy (`:123`) — H-06.
- **Intent break:** upward game is stale-CAS remand rather than a lawful transfer (`direct-worldmodel-governance-integration-games-regression.mjs:59-73`) — H-07.
- **Review risk:** unrelated app-server orchestration controls are coupled into the same change surface — M-04.
- **PR verdict:** **remand**. Migration remains additive and guarded, but convergence/no-double/bidirectional acceptance is not established.

## Transition-law and adversarial analysis

| Artifact / transition | Required law | Positive evidence | Representative negative/adversarial evidence | Result |
|---|---|---|---|---|
| Graph transition append | Actor is authorized for exact target scope/mutations and CAS is current | Declared CAS tests pass | **Reproduced:** `thread_manager` wrote project B and committed | **FAIL authority; PASS local CAS** |
| Node lifecycle/materialization | Refuted/stale/conflicted truth cannot appear active | Lifecycle filters exist | **Reproduced:** active + epistemic `refuted` materialized as active | **FAIL** |
| Graph revision/history | Every revision is reconstructable and receipt-bound | Head tamper/history-ref tests pass | **Reproduced:** 2 refs, 1 retained body; no replay check | **FAIL** |
| Project Manager profile/delegation/custody | Referenced parent, project root, authority, and custody row exist and agree | Contextual Thread Manager path checks real objects when supplied | Regression explicitly accepts ref-only artifacts | **FAIL as universal boundary** |
| Semantic target resolution -> candidate -> promotion | Same ingress/project/scope/source/authority/mutation throughout | Lawful positive promotion passes | **Reproduced:** resolution A committed candidate B | **FAIL** |
| Semantic duplicate detection | Same normalized semantic change is a no-op | Add-node/idempotency positive case passes | **Reproduced:** identical revise twice committed, revision 2 | **FAIL** |
| Graph projection | Trusted policy + exact graph determine selected refs | Budget/scope/raw-state fixtures pass | **Reproduced:** audit caller selected archived; forged foreign ref validates | **FAIL** |
| Manager boot | Profile, projection, inspection, ingress, frame all share project/scope/revision | Positive boot fixture passes | **Reproduced:** profile A + projection/inspection B accepted | **FAIL** |
| Graph-to-ODEU compilation witness | Selected graph truth is accounted for in each lane or explicit omission | Witness digest/identity checks pass | **Reproduced:** selected nodes + four empty lanes accepted | **FAIL** |
| Scoped memory binding/context selection | Graph-primary item cannot be included through legacy selector | Post-hoc witness computes double | Existing fixture creates both and returns remand | **FAIL prevention** |
| Update packet -> acknowledgement -> impact | Ack/impact follows persisted graph change and affected boot refresh | Shape regressions pass | Caller supplies `outcome: applied`; no resulting transition required | **FAIL** |
| Profile resolution result | Result is inseparable from exact trace and inputs | Contextual resolver positive/negative tests pass | **Reproduced:** result B/rev99 with trace A/rev3 validates | **FAIL standalone admission** |
| Migration report | Completion report cannot validate prohibited double inclusion | Counter consistency is checked | Source permits positive double with remand witness | **FAIL completion law** |
| Project-to-world / world-to-project propagation | Authorized two-sided transfer changes source/destination state and refreshes consumers | A remand scenario is labeled escalation | Stale-CAS remand; no accepted transfer/controller found | **NOT PROVEN** |

Adversarial probe summary (all in-memory; no repository writes):

```text
unauthorizedProjectWrite: committed=true actorRole=thread_manager targetScope=project_b
targetResolutionSubstitution: committed=true resolutionTarget=project_a committedNodeScope=project_b
crossProjectBoot: accepted=true profileProjectId=A projectionProjectId=B inspectionProjectId=B
emptyCompilationWitness: accepted=true selectedNodeCount=2 laneEntries=0/0/0/0
callerAuditMode: archivedSelected=true selectedRefCarriesLifecycle=false
standaloneProjectionForgery: validatorAccepted=true selected=foreign_unbound_secret
activeRefutedMaterialization: appearsActive=true
normalizedReviseDedup: sameNormalizedDigest=true bothCommitted=true finalProjectRevision=2 persistedDigest=false
appendOnlyBodyHistory: historyRefsForNode=2 storedBodiesForNode=1
profileResolutionRelabel: validatorAccepted=true result=B/rev99 trace=A/rev3
```

## Fixture and test coverage map

Every listed command passed in this checkout.

| Command / fixture | What it actually proves | Material law not proved |
|---|---|---|
| `precheck:syntax` | Current JS parses | Runtime/context law |
| `direct:hierarchical-worldmodel-graph` | Canonical builder/digests, positive append, CAS/remand, head/history tamper checks | Actor authorization, mutation preconditions, endpoints/uniqueness, reconstructable versions, epistemic active predicate |
| `direct:project-manager` | Artifact construction and some self-consistency; ref-only compatibility | Concrete parent/project/authority/custody existence and universal enforcement |
| `direct:worldmodel-semantic-ingress` | Ingress/broker/candidate/promotion happy path, raw exclusion, selected custody negatives | Cross-project substitution matrix, authority existence, revise/edge dedup persistence |
| `direct:worldmodel-graph-projection` | Role/focal-scope selection, budget, raw/authority false, selected privacy cases | Trusted policy provenance, audit-context separation, worker allowlist authority, graph-bound standalone validation |
| `direct:manager-turn-context` | Artifact identities, refs, positive boot/witness shape | Project closure, expiry, selected-ref-to-lane compilation; fixture uses empty lanes at `:91-95` |
| `direct:project-memory-propagation` | Closure/candidate/binding shapes and one contextual admission | Result-to-thread identity, selector gate, persisted delivery/ack, actual stale/refresh impact |
| `direct:project-profile-resolution` | Strong contextual positive resolution and selected invalid inputs | Result/trace relabel, authoritative runtime launch use, optional specialist-contract failure |
| `direct:worldmodel-migration-games` | Additive candidates, linkage, witness/report construction, drift case | Atomic cutover, zero-double enforcement, full provenance retention |
| `direct:worldmodel-manager-convergence-games` | Cross-artifact happy-path assembly and lifecycle/history outputs | Hostile substitutions, graph-derived lanes, live context consumer |
| `direct:worldmodel-governance-integration-games` | Outcome-level scenarios for remand/admission/privacy/profile | Accepted bidirectional transfer; the upward case is stale-CAS remand |
| `codex:appserver-orchestration-controls` | Source/config/descriptor/UI contract regression | Provider-effective model/effort; live effective effort remains unobserved |
| `direct:information-bridge-audit` | Registry/document table is executable and internally valid: 105/39/64/2 | Capability completeness; `ic62` correctly remains partial/guarded |

Minimum missing fixture families:

1. A Cartesian cross-binding suite that substitutes one of graph, user, project, work thread, profile, agent, role, ingress, source, authority, target, and revision while holding all other artifacts valid.
2. Mutation-specific state-machine tests: add-existing, revise-missing, lifecycle-missing, foreign endpoint, duplicate ID, duplicate scope ref, cross-user node, active+refuted, and transition replay mismatch.
3. Authority tests with concrete signed/digested authority-decision objects, including expired, wrong actor, wrong role, wrong scope, wrong mutation digest, and reused decision.
4. Projection tests with an independently supplied trusted policy object; audit views must never be accepted as current manager context.
5. Compiler accounting tests proving every selected ref is either represented in a typed lane with lineage or explicitly omitted with a lawful reason.
6. Memory cutover tests proving the legacy selector cannot include graph-primary rows and context assembly fails atomically on any double.
7. Propagation state-machine tests with persisted pending/delivered/applied/failed transitions and boot invalidation/recompilation readback.
8. Accepted and denied project-to-world and world-to-project transfers with two-sided revisions and custody decisions.

## Terra High blindspot comparison

No separate Terra High reasoning transcript was audited. “Likely first-pass” below is therefore an explicit inference from the green declared suite, local-fixture status, and the implementation’s artifact-heavy shape—not a claim about hidden reviewer behavior.

| Area | Likely first-pass conclusion from green fixtures | Sol Max adversarial correction | Remediation gate |
|---|---|---|---|
| Canonical append | CAS + transition ledger means writes are governed | CAS is strong, but any enumerated actor can write any target when refs are syntactically valid | Contextual authorization before append |
| Semantic ingress | Broker + resolution + custody + authority artifact names imply closed promotion | Artifacts are individually valid but substitutable across projects/scopes | One bound admission envelope |
| Projection privacy | Role filters and omission counts establish least privilege | Caller controls audit mode, seeds, deny lists, and worker allowlist; standalone refs forge | Trusted policy + graph-bound validation |
| Graph-first context | Boot and compilation witness prove the graph reached ODEU | Empty lanes validate; boot artifacts can disagree on project | Deterministic compiler + inclusion accounting |
| Memory convergence | No-double witness protects compatibility | It observes a double after selection; selector never consumes the binding | Atomic selection gate/cutover |
| Propagation | Packet/ack/impact schemas prove bidirectional updates | Caller can claim applied; no runtime state/boot changed | Persisted delivery and refresh receipts |
| Profile resolution | Strong resolver means result artifacts are safe | Standalone result can be relabeled away from trace | Closed result digest/context validation |
| Migration | Non-destructive flags and remand counters satisfy migration safety | A completion report can validate with positive doubles; drift loses older refs | Zero-double completion gate + immutable genealogy |
| Integration games | Named scenarios establish convergence | Upward “escalation” only proves stale-CAS remand | Accepted/denied two-sided transfer games |
| Registry/status | Passing audit row can justify completion | Registry accurately says partial/guarded; master counts/frontier are stale | Keep `ic62` guarded; reconcile after law proof |

## App-server orchestration observations

The app-server work is materially more honest about observability than the Wave 26 artifact stack. `docs/CODEX_APP_SERVER_ORCHESTRATION_CONTROLS_SPEC.md:25-63`, `:351-424`, and `:426-485` distinguish configured intent, provider acceptance, and effective runtime proof. `src/main/codex-app-server.js:362-391` represents effective model/effort as unknown/unverified when it cannot be observed; launch/restart descriptor construction at `:438-538` preserves requested configuration. The static regression passes.

**Orchestrator observation:** task-local model/reasoning knobs were exposed successfully and a fresh low-effort child descriptor/activity was accepted, but effective effort was not observable. Repeated delegated-agent stalls were also observed. This audit did not spawn agents, by instruction, so those runtime observations were not independently reproduced here.

Operational conclusions:

- Keep UI/runtime wording at “configured” or “provider accepted” unless effective model/effort is read back from an authoritative provider event.
- Favor a small number of large, narrow, bounded tasks over broad fan-out until stall behavior has a reliable retry/timeout/reconciliation path.
- Record stall/timeout/cancellation as runtime activity with task ID, configured model/effort, provider acceptance, and last known state; do not infer effective effort from configuration.
- Split app-server orchestration controls from PR 157. They are independently valuable and independently rollbackable.

## Maintainability, refactor, and review risks

1. **Shape validation is repeatedly used where contextual validation is required.** Adopt a naming rule: `validateXShape` for portable artifacts and `admitXAgainstContext` for authority boundaries. Only the latter may lead to state change or runtime context use.
2. **Refs are not evidence by themselves.** Standardize exact SHA-256 syntax and a resolver interface that proves kind/ID/digest against an authoritative store. Metadata-derived hashes must not be treated as authorization.
3. **Too many builders normalize invalid inputs.** Strict governed constructors should reject; fixture conveniences can live in test helpers.
4. **Transition effects are duplicated across modules.** Centralize graph authorization, mutation preconditions, scope CAS, idempotency, immutable history, and receipt creation in one kernel.
5. **Projection and compilation are separate claims.** Make the compiler consume exactly one graph projection and produce lineage-bearing lane entries plus explicit omissions.
6. **Artifact receipts have no state-machine owner.** Introduce persistent propagation/delivery state rather than caller-authored `applied` booleans.
7. **Large one-line validators increase review risk.** Decompose by invariant, not only schema section, and attach one negative test to every predicate.
8. **PR 157 is too broad if app-server controls remain attached.** Migration, games, launch semantics, UI truth, and provider observability should not share a single acceptance/rollback unit without necessity.

## Required remediation and resolution order

1. **Seal the graph write boundary (C-01, H-01, H-02, H-03).** Add contextual authority/custody, strict mutation laws, persisted normalized idempotency digest, immutable version history, and replay validation. All later features depend on this.
2. **Close semantic promotion (C-02).** Bind ingress through exact persisted transition; add the substitution matrix.
3. **Make projection policy authoritative (C-03).** Separate audit/history views from current context and require graph/policy-bound validation.
4. **Implement graph-first compilation and boot closure (C-04, H-08).** Integrate a guarded live consumer and prove selected-ref accounting/readback.
5. **Enforce single memory authority (C-05).** Put compatibility state at selection/context assembly, perform atomic cutover, and make any double impossible rather than reportable.
6. **Build an executed propagation state machine (C-06, H-07).** Bind closure results, delivery, graph receipts, affected contexts, invalidation, recompilation, and two-sided transfers.
7. **Close Project Manager and profile-resolution evidence (H-04, H-05).** Resolve all authority/profile/catalog/topology refs contextually before use.
8. **Harden migration completion (H-06).** Require zero doubles, immutable provenance, exact graph/projection binding, and safe restart/resume.
9. **Expand adversarial fixtures and reconcile docs (M-02, M-03).** Update counts/frontier only after the executable audit and acceptance matrix agree.
10. **Split and independently gate app-server controls (M-04).** Preserve configured-vs-effective truth and add stall reconciliation evidence.

## Acceptance gate

Wave 26 may move beyond planned/local-fixture/guarded status only when all of the following are demonstrated in one fresh checkout:

- Every Critical and High finding above has a code-level invariant and at least one hostile negative fixture.
- Graph append rejects wrong actor/role/project/scope/authority even with otherwise valid digests and current CAS.
- Every committed transition is idempotent by normalized semantic mutation, mutation-specific, and historically replayable.
- Semantic promotion cannot substitute any artifact across user/project/work-thread boundaries.
- Manager projections are produced from trusted policy, audit/history views cannot enter current context, and standalone projections are verified against exact graph/policy digests.
- A production-context readback proves selected graph refs compiled into O/E/D/U lanes; empty or cross-project compilation fails.
- Graph-primary memory cannot be selected through legacy AgentMemory and a completion report cannot exist with a positive double count.
- Update acknowledgements and impact are derived from persisted transitions and verified boot/context refreshes.
- At least one authorized upward transfer and one authorized downward propagation commit, while wrong-custodian, stale, cross-project, and reused-authority cases fail.
- Project profile resolution is bound to the exact runtime launch decision and cannot be relabeled.
- `direct:information-bridge-audit` remains valid, `ic62` stays guarded until production readback passes, docs counts/status are reconciled, and app-server controls are reviewed on their own acceptance surface.

Until then, the correct disposition is **REMAND; preserve the local fixtures, do not claim completion, and do not merge PR 151-157 as a production-capable hierarchy/convergence wave.**

## 2026-07-15 — Post-remediation Sol Max resolution verification

### Resolution verdict

**RED / REMAND remains the production-capability verdict.** The frozen post-remediation tree is materially stronger than the tree reviewed above, and several original findings are resolved at the local guarded-fixture boundary. It still does not prove a production-capable hierarchy/convergence wave. Critical findings remain open around the provenance trust root, authoritative memory selection, and context-free propagation effect receipts. High findings remain open around replay immutability, universal Project Manager admission, provenance-preserving drift, and a live graph-first manager/context consumer.

This is not a rollback of the remediation credit. The new governance registry, exact semantic admission, graph-derived compiler, explicit legacy boot posture, cutover registry, two-leg propagation controllers, replacement boots, and app-server launch correlation are real improvements. The remaining issue is that locally self-consistent artifacts are still being treated as authoritative or production-effective at several boundaries where the specification requires an independent owner, persisted state, or live readback.

### Verification methodology and proof boundary

The verification was performed after the remediation tree was declared frozen. Earlier race-era probe dispositions were discarded and every result below comes from the frozen tree.

1. Re-read the complete 2,136-line Wave 26 specification and the complete 394-line original audit.
2. Inspected the current Wave 26 graph, governance registry, Project Manager, semantic ingress, graph projection, manager-turn context, Thread Manager boot, project-memory propagation, migration, profile-resolution, AgentMemory selector/admission workflow, app-server adapter, `CodexSurfaceSession`, and all corresponding regressions/integration games.
3. Ran the declared syntax and regression suites without modifying source files.
4. Re-ran C-01 through C-06, H-01 through H-08, and relevant M/L probes by streaming temporary mutations of the committed regression fixtures to `node --input-type=module`. The streamed probes made no repository writes.
5. Classified evidence into four non-interchangeable tiers:
   - **portable shape:** a builder/validator accepts a self-contained artifact;
   - **local contextual fixture:** in-memory objects are cross-checked in one Node process;
   - **guarded session fixture:** the real local session adapter talks to a test WebSocket provider;
   - **production/provider/runtime proof:** an authoritative store/signer and actual runtime consumer/provider readback establish the effect.

No result in this section promotes a lower tier into a higher one by inference. In particular, a locally built governance registry is not an externally anchored trust root, an in-memory propagation controller is not persisted delivery, and a local WebSocket provider emulator is not authoritative external-provider readback.

### Exact commands and hostile-probe catalog

The frozen-tree regression sweep was:

```bash
for f in \
  scripts/direct-hierarchical-worldmodel-graph-regression.mjs \
  scripts/direct-project-manager-regression.mjs \
  scripts/direct-worldmodel-semantic-ingress-regression.mjs \
  scripts/direct-worldmodel-graph-projection-regression.mjs \
  scripts/direct-manager-turn-context-regression.mjs \
  scripts/direct-thread-manager-boot-regression.mjs \
  scripts/direct-agent-context-source-refs-regression.mjs \
  scripts/direct-project-memory-propagation-regression.mjs \
  scripts/direct-project-profile-resolution-regression.mjs \
  scripts/direct-project-profile-appserver-session-regression.mjs \
  scripts/direct-worldmodel-migration-games-regression.mjs \
  scripts/direct-worldmodel-manager-convergence-games-regression.mjs \
  scripts/direct-worldmodel-governance-integration-games-regression.mjs \
  scripts/codex-app-server-orchestration-controls-regression.mjs
do
  node "$f" || exit
done
```

All fourteen commands passed. The additional repository checks were:

```bash
npm run precheck:syntax && npm run direct:information-bridge-audit
```

Both passed. The executable information-bridge audit reported `Rows: 105`, `Valid: yes`, `implemented=39`, `partial=64`, `inherited=2`, and retained `ic62.wave26-hierarchical-worldmodel-fixture-substrate` as `partial / keep_guarded`.

Hostile probes used this no-write command form:

```bash
sed -e 's#require("../src#require("./src#' \
  -e '<probe-specific streamed fixture mutation>' \
  scripts/<named-regression>.mjs | node --input-type=module
```

The exact injected conditions and observed results were:

| Probe | Base regression and exact injected condition | Frozen-tree observation |
|---|---|---|
| C-01 trust-root probe | `direct-hierarchical-worldmodel-graph-regression.mjs`; create profile/custody/authority/admission and a registry through the public registry builder for `actorAgentId: "attacker_unregistered_pm"`, then append | `{"probe":"self_minted_governance_write","actor":"attacker_unregistered_pm","committed":true,"storedActor":"attacker_unregistered_pm","registryConsumed":true}` |
| C-02 substitution | `direct-worldmodel-semantic-ingress-regression.mjs`; use the exact admission chain for candidate A and substitute independently valid candidate B at promotion | `{"probe":"semantic_substitution","threw":false,"committed":false,"decision":"remand","omission":"direct_hierarchical_graph_contextual_admission_mismatch"}` |
| C-03 policy provenance | `direct-worldmodel-graph-projection-regression.mjs`; replace the configured policy body with a different digest under the same policy ID and construct a matching registry through the public builder | `{"probe":"self_minted_policy_registry","configuredDigest":"sha256:535a...","attackerPolicyDigest":"sha256:e1d0...","samePolicyId":true,"admitted":true,"selected":1}` |
| C-04 compiler | `direct-manager-turn-context-regression.mjs`; omit `graphOdeuCompilation`, then build a lawful compilation | `{"probe":"empty_compiler_rejected","missingCompilationCode":"direct_manager_turn_context_compilation_required","selectedRefs":3,"compiledEntries":3,"witnessCompilationDigest":true}` |
| C-04/H-08 worker boot | `direct-thread-manager-boot-regression.mjs`; call default `buildWorkerBootPacket` without graph context and compare explicit legacy and guarded calls | `{"probe":"wave26_boot_without_graph","code":"direct_thread_manager_wave26_graph_context_required","legacyPosture":"legacy_non_wave26_odeu","guardedPosture":"wave26_graph_derived","guardedHasCompilation":true}` |
| C-05 selector omission | `direct-agent-context-source-refs-regression.mjs`; after a real completed cutover to `graph_primary`, omit both registry and Wave 26 flag from an otherwise eligible legacy row; separately supply a shallow fake registry | `{"probe":"memory_cutover_bypass","realCutoverState":"graph_primary","omittedFlagSelected":1,"fakeRegistryError":"direct_memory_authority_cutover_registry_invalid"}` |
| C-05 live workflow | `direct-agent-memory-admission-gate-regression.mjs`; supply `wave26GraphContext: true`, `graphContext`, and a registry to `runMemoryAdmissionWorkflow` | throws `direct_agent_memory_cutover_registry_required`; the workflow forwards the registry and flag but drops `graphContext` before calling the selector |
| C-06 propagation record | `direct-worldmodel-governance-integration-games-regression.mjs`; reuse a lawful controller record's bindings/boot refresh, put the same transition on both legs, relabel direction/project, and claim unrelated node `unrelated_node` | `{"probe":"standalone_false_propagation_receipt","accepted":true,"direction":"world_to_project","projectId":"project_b","sameTransition":true,"claimedNode":"unrelated_node"}` |
| C-06 acknowledgement | `direct-project-memory-propagation-regression.mjs`; mark the world update packet `applied` using the unrelated memory-promotion transition | `{"probe":"unrelated_transition_applied_ack","accepted":true,"outcome":"applied","packetSource":"world_transition","destinationTransition":"semantic_promotion_transition_1b3d5c8b962c4599"}` |
| H-03 replay | `direct-hierarchical-worldmodel-graph-regression.mjs`; change the last transition actor to `forged_actor` and recompute the graph digest; separately replace genesis with current state, erase transitions, reset history bodies/refs/head, and recompute | `{"probe":"replay_authority_and_history_rewrite","forgedActorAccepted":"forged_actor","erasedTransitionCount":0,"replayAccepted":true}` |
| H-04 universal admission | `direct-project-manager-regression.mjs`; inspect the accepted ref-only ProjectWorld and operational delegation beside the separately built contextual admission | `{"probe":"operational_delegation_admission_binding","refOnlyProjectWorldValidated":true,"delegationStatus":"ready_for_thread_manager","delegationHasContextualAdmission":false,"contextualAdmissionExistsSeparately":true}` |
| H-05 runtime relabel/correlation | `direct-project-profile-resolution-regression.mjs`; send a free-floating matching item, an exact correlated item, then replay it | `{"probe":"profile_runtime_correlation","freeFloating":"not_yet_observed","verified":"runtime_verified","replay":"not_yet_observed","providerStatus":"canonical_launch_response_observed"}` |
| H-06 genealogy | `direct-worldmodel-migration-games-regression.mjs`; revise the drift node and edge with only `[artifactBeforeRef, artifactAfterRef]`, omitting every prior source ref | `{"probe":"lossy_drift_genealogy","committed":true,"nodeSourceIds":["artifact","artifact"],"edgeSourceIds":["artifact","artifact"]}` |
| H-01 | `direct-worldmodel-semantic-ingress-regression.mjs`; submit the same normalized semantic mutation through a second candidate/idempotency key | `{"probe":"normalized_semantic_idempotency","sameDigest":true,"secondDecision":"defer","secondCommitted":false}` |
| H-02 | `direct-hierarchical-worldmodel-graph-regression.mjs`; add a different body at existing target `authorized_add` with current CAS; separately materialize an active/eligible but `refuted` node | `{"probe":"mutation_and_current_truth","addExistingCode":"direct_hierarchical_graph_add_target_exists","refutedAppearsActive":false}`; declared foreign-user, custody, expiry, and graph-consistency negatives also pass |
| H-07 | `direct-worldmodel-governance-integration-games-regression.mjs`; accepted upward/downward controllers plus wrong direction, foreign transition, stale graph/boot/registry, wrong role/project, and replay attempts | pass locally; both controller records reach `applied` and replacement compilation digests equal destination graph digests |
| M-01 | Source inspection of `manager-turn-context.js:116-143`; try values outside the expiry enum versus semantically expired/closed frames | invalid enum rejects, but no timestamp/turn/decision-closure applicability is evaluated |
| M-03 | `npm run direct:information-bridge-audit` plus current status/roadmap comparison | executable `105/39/64/2`; master status still says `104/63` and Wave 25/PR 150 is the current frontier |

The elided digest suffixes in the C-03 display are only presentation shortening; the probe used and compared the complete exact SHA-256 strings.

### Resolution matrix

`Resolved` below means resolved only at the explicitly named local boundary. `Partial` means a meaningful invariant was added but the original acceptance law still has a bypass or a higher-tier proof is absent. `Open` means the hostile condition remains directly reproducible.

| Finding | Status | Post-remediation evidence | Remaining boundary or gate |
|---|---|---|---|
| C-01 graph write authority | **PARTIAL — Critical remains** | Append now requires exact contextual admission, authorization, registry membership, current registry revision, and one-shot consumption. Cross-binding and replay negatives pass. | The registry itself is caller-constructible from caller-provided bodies/bindings. An arbitrary new actor can mint the whole local trust chain and commit. Require an independently owned resolver/store/signer and make append resolve or verify an anchored registry snapshot that the request cannot mint. |
| C-02 semantic substitution | **RESOLVED — local contextual fixture** | Valid A admission plus valid B candidate remands with `direct_hierarchical_graph_contextual_admission_mismatch`. | No production ingress/store consumer was demonstrated; retain guarded posture. |
| C-03 projection policy authority | **PARTIAL — Critical remains** | Projection requires an exact policy body/digest and registry admission; audit/current schemas and contextual validation are stronger. | A caller can mint a different same-ID policy and matching registry. Pin the configured policy digest in an independently authoritative registry and resolve it outside the request. |
| C-04 graph-first compilation/boot closure | **RESOLVED — local guarded fixture** | Empty compilation rejects; every selected ref is accounted for in typed O/E/D/U entries; Project Manager scope/digest closure and default worker graph context are mandatory. | Production use is tracked by H-08, not inferred from the fixture. |
| C-05 single memory authority | **OPEN — Critical** | A genuine registry is deeply validated when the selector is told it is on the Wave 26/cutover path; shallow registry forgery rejects; migration completion requires zero doubles and cutover receipts. | The selector can still choose an unlabelled legacy row when registry/flag is omitted, even after authoritative cutover. The live admission workflow also drops `graphContext`. Cutover state must be resolved by memory ID unconditionally at selection/context assembly, and the workflow must forward the complete context. |
| C-06 truthful propagation effects | **PARTIAL — Critical remains** | New source/destination controllers consume real admitted transitions, bind registries/scopes, reject stale/foreign inputs, and build replacement graph compilations/boots. | Public propagation-record and acknowledgement validators still accept effect claims that are not verified against the graphs, packet mutation set, project/direction, or persisted delivery owner. Only a context-admitted, persisted controller receipt may be allowed to mean `applied`. |
| H-01 semantic idempotency | **RESOLVED — local contextual fixture** | Normalized semantic mutation digest is persisted and scoped duplicate detection remands a second equivalent mutation. | Keep mutation-family hostile cases in the permanent suite. |
| H-02 mutation/graph laws | **RESOLVED — local graph kernel** | Add/revise preconditions, uniqueness, endpoints, user/scope consistency, custody, CAS, and current-truth filtering are enforced. | This does not cure H-03's rewriteable replay anchor. |
| H-03 immutable history/replay | **OPEN — High** | Version bodies and before/after receipts now exist, and ordinary head/history tamper cases reject. | Replay accepts an actor rewrite and accepts erasing all transitions by redefining genesis/current history. Bind every actor/authority field into immutable transition receipts and verify from an externally anchored genesis/checkpoint that callers cannot rewrite. |
| H-04 Project Manager identity/delegation/custody | **PARTIAL — High remains** | `buildProjectManagerContextualAdmission` now binds graph/root/profile/custody/authority/registry exactly. | The operational delegation still becomes `ready_for_thread_manager` without that admission, and ref-only ProjectWorld remains portable/self-attested. Require contextual admission at the operational consumer, with an explicitly separate legacy posture. The C-01 trust-root gate also applies. |
| H-05 profile relabel/runtime correlation | **RESOLVED — guarded local app-server session** | Launch request rejects configured relabel, response receipt binds connection/request/project/revision/task/thread/turn/run/launch/configuration, mismatch/replay cannot verify, and the real `CodexSurfaceSession` path passes against a WebSocket test provider. | This is not proof of effective model/effort from the external Codex provider. Keep wording at configured/provider-accepted unless an authoritative provider event supplies effective readback. |
| H-06 migration completion/genealogy | **PARTIAL — High remains** | Completion report now rejects any positive double count and graph-primary bindings require cutover receipts. | Drift admission still allows node/edge revisions that discard all older source refs. Require prior-source superset preservation or an immutable genealogy relation verified during append. |
| H-07 bidirectional controller | **RESOLVED — local guarded fixture** | Authorized project-to-world and world-to-project legs apply, update two sides, and produce graph-derived replacement compilations/boots; hostile stale/foreign/reused cases reject. | C-06 still prevents treating portable records as authoritative runtime effect receipts; no persistent production delivery owner was shown. |
| H-08 live graph-first consumer | **PARTIAL — High remains** | Default Wave 26 worker boot is graph-derived; legacy boot is explicitly `legacy_non_wave26_odeu`; propagation refresh invokes the graph compiler. | Repository use-site search still finds manager graph-first adapter and normal worker-boot construction only in regressions, not an active manager/context provider. Wire the guarded path into the real runtime, prove readback, restart/stale refresh, and retain `ic62` guarded until then. |
| M-01 frame expiry/lifecycle | **OPEN — Medium** | Expiry values are a required enum. | No time, turn identity, decision closure, or change applicability evaluation exists at boot/admission. |
| M-02 adversarial fixtures | **PARTIAL — Medium** | The suite now contains substantially more cross-binding, stale, replay, registry, compilation, propagation, cutover, and runtime-correlation negatives. | The hostile probes above that still pass are not permanent failing fixtures. Add them as acceptance tests before changing status. |
| M-03 status drift | **OPEN — Medium** | Executable audit is valid and `ic62` remains correctly guarded. | `DIRECT_PROJECT_MASTER_STATUS.md` remains stale at `104/63`, its update marker is 2026-07-13, and its frontier remains Wave 25/PR 150. Reconcile without claiming Wave 26 completion. |
| M-04 coupled review surface | **OPEN — Medium/process** | App-server correlation now has an independently useful regression and real local session integration. | The working change surface still combines hierarchy/migration and app-server controls. Split the acceptance/rollback units or document an explicit combined release dependency and plan. |
| L-01 compressed validators | **OPEN — Low** | Some graph kernel sections are decomposed. | Authority-sensitive registry, manager-context, and other validators still compress multiple laws into single lines; decompose into named predicates with one hostile test per predicate. |
| L-02 silent normalization | **PARTIAL/OPEN — Low** | Governed paths reject more missing or mismatched context. | Public builders still silently default governed meanings—for example propagation direction/state. Use strict admission constructors; keep lenient normalization fixture-only and explicitly named. |

### Newly isolated remediation findings

These are not double-counted as separate acceptance failures; they identify the concrete post-remediation mechanisms behind the mapped original findings.

1. **N-01 — Caller-minted governance is a local registry, not a trust root (Critical; maps C-01/C-03/H-04).** `governance-provenance-registry.js:3-6` explicitly disclaims an external signer, while `:43-47` constructs the authoritative snapshot directly from caller records. Exact digest, membership, revision, and one-shot checks protect internal consistency after construction, but do not establish who was permitted to construct the profile, policy, custody, or authority bodies.
2. **N-02 — The live AgentMemory workflow cannot currently carry a valid Wave 26 selector context (Critical; maps C-05/H-08).** `agent-context-source-refs.js:386-428` requires `graphContext` for governed/cutover selection. `agent-memory-admission-gate.js:443-457` forwards `wave26GraphContext`, registry, and a top-level projection, but not `graphContext`; the behavioral probe fails before contextual validation. Independently, omitting all cutover signals allows an unlabelled legacy row to select.
3. **N-03 — Strong propagation controllers coexist with context-free effect schemas (Critical; maps C-06).** `project-memory-propagation.js:1235-1355` performs contextual transition work, but `:1182-1233` validates a portable applied record without those graphs/transitions, and `:1484-1621` accepts any supplied exact transition ref for an applied acknowledgement. Consumers can therefore bypass controller truth by accepting the portable schema as evidence of effect.
4. **N-04 — Replay is self-consistency, not immutability (High; maps H-03).** `validateWorldmodelGraphReplay` detects ordinary inconsistent heads, but a caller who rewrites actor/genesis/history and recomputes the enclosing graph digest can produce a new self-consistent story. An immutable anchor or authoritative store comparison is absent.
5. **N-05 — Contextual Project Manager admission is optional at the operational delegation boundary (High; maps H-04).** The new admission object is strong when explicitly invoked, but the normal delegation object neither embeds nor resolves it before declaring readiness.

### Honest production and provider boundaries

- The governance registry is an in-process artifact with no demonstrated persistent authoritative owner, external signature, ACL, or anti-rollback storage. It must not be described as production authority.
- Graph, migration, and propagation proofs are in-memory Node fixtures. No crash/restart, multi-process race, durable transaction, or authoritative-store reconciliation was demonstrated.
- The graph-first manager adapter has no demonstrated active production context-provider use site. Default worker construction is stronger, but the normal construction call is still exercised only by its regression.
- The AgentMemory governed path has a concrete live forwarding defect and an omission bypass; single-memory authority is therefore not established even locally end to end.
- The app-server session regression uses the actual local `CodexSurfaceSession` and correlation logic, but the WebSocket peer is a test provider. It proves adapter/session behavior, not external Codex provider-effective model or reasoning-effort truth.
- `ic62` being `partial / keep_guarded` is accurate. Passing local regressions does not authorize a documentation or release-status promotion.

### Exact remaining Critical/High acceptance gate

Wave 26 remains remanded until one fresh checkout demonstrates all of the following as permanent hostile fixtures and, where stated, production readback:

1. **Independent governance root:** append/projection/delegation resolve profiles, policies, custody, authority decisions, and current registry revision from a store/signer the request cannot construct or rewrite. The C-01 arbitrary actor and C-03 same-ID/different-policy probes must reject.
2. **Immutable replay:** transition digests bind actor, role, authority/admission, exact mutations, receipts, and chain position; replay begins from an externally anchored genesis/checkpoint. Both actor rewrite and transition-erasure probes must reject.
3. **Universal operational admission:** Project Manager delegation/boot cannot become ready from ref-only artifacts; the exact contextual admission and current independent registry snapshot are required at the consumer. Legacy behavior must use an explicit non-Wave-26 posture.
4. **Authoritative memory selection:** the selector resolves cutover state by memory identity even when callers omit flags/registries, rejects legacy inclusion of graph-primary memory, receives complete `graphContext` through the live workflow, and atomically prevents dual inclusion.
5. **Contextual persisted propagation truth:** only a persisted state-machine owner may emit `applied`; record/ack admission verifies exact source/destination graphs and transitions, direction/project/scope, packet mutation set, registry consumption, affected IDs, and replacement boot/context readback. Both false-receipt probes must reject.
6. **Immutable drift genealogy:** a drift revision cannot remove earlier source genealogy, whether preserved as a strict source-ref superset or through an immutable parent/version relation. The lossy drift probe must reject.
7. **Live graph-first readback:** the real manager/context runtime consumes the exact projection/compilation/default Wave 26 boot, proves selected-ref O/E/D/U accounting, and demonstrates stale propagation refresh/restart behavior. Fixture-only call sites are insufficient.
8. **Provider truth remains scoped:** external effective model/effort is called verified only when an authoritative provider event, correlated to the exact launch receipt, reports it. Local WebSocket emulation may support guarded adapter acceptance but not production-effective claims.

### Terra High blindspot delta after remediation

| Area | What Terra remediation correctly repaired | Remaining Sol Max correction |
|---|---|---|
| Governance | Added exact bodies, graph/user/project/scope/role/agent bindings, registry CAS, and one-shot consumption | The request can still mint the registry and every admitted body; consistency is not provenance authority |
| Semantic ingress | Closed the candidate/resolution/admission/mutation substitution chain | This closure is effective locally; production provenance still depends on N-01 |
| Projection | Added exact policy and graph context, separated shape admission, and blocked the original standalone forgery | A same-ID replacement policy plus caller-minted registry remains admissible |
| Compilation/boot | Added deterministic selected-ref accounting and made default Wave 26 worker boot graph-derived | A fixture call is not an active manager/context-provider readback; H-08 remains |
| Memory | Added cutover registry, deep validation, zero-double completion, and receipts | The selection boundary trusts caller presence/row labels, and the live workflow drops the required graph context |
| Propagation | Added real two-leg controllers, transition bindings, registry consumption, and replacement boots | Portable record/ack validators still allow fabricated effects outside those controllers |
| History | Added version bodies and mutation receipts | Self-consistent actor/genesis rewriting still passes because no immutable anchor owns history |
| Project Manager | Added a strong contextual admission artifact | The operational delegation boundary does not require it |
| Migration | Enforced zero-double completion and cutover receipts | Artifact-drift revisions may still erase prior source genealogy |
| Profile runtime | Added request/response/session correlation and replay protection in the real local session | The peer is an emulator; effective external-provider model/effort remains unproved |

The post-remediation conclusion is therefore: **preserve and build on the improved guarded substrate, but keep Wave 26 and `ic62` remanded/partial. Do not describe this tree as production-integrated, production-authoritative, completion-grade, or merge-ready for the hierarchy/convergence wave until the Critical/High gate above passes.**

## Final remediation verification

**Frozen-tree verdict: RED / REMAND remains.** The final remediation adds useful owner-side mechanisms, but attacker probes still reproduce C-01, C-03, C-05, C-06, H-03, H-04, and H-08 at current public/runtime boundaries. H-06 is resolved at the guarded local boundary. This disposition does not require the full product UI or external-provider context replacement that the Wave 26 specification explicitly excludes.

Focused affected regressions:

```bash
for f in \
  scripts/direct-hierarchical-worldmodel-graph-regression.mjs \
  scripts/direct-worldmodel-graph-projection-regression.mjs \
  scripts/direct-project-manager-regression.mjs \
  scripts/direct-manager-turn-context-regression.mjs \
  scripts/direct-thread-manager-boot-regression.mjs \
  scripts/direct-agent-context-source-refs-regression.mjs \
  scripts/direct-agent-memory-admission-gate-regression.mjs \
  scripts/direct-project-memory-propagation-regression.mjs \
  scripts/direct-worldmodel-migration-games-regression.mjs \
  scripts/direct-worldmodel-governance-integration-games-regression.mjs
do
  node "$f" || exit
done
```

All ten passed. Hostile probes were streamed from those fixtures through `sed ... | node --input-type=module`; they made no repository writes.

| Finding | Final status | Exact executable evidence | Remaining gate |
|---|---|---|---|
| C-01 | **PARTIAL / Critical remains** | The originally pinned store rejects the arbitrary actor with `direct_hierarchical_graph_store_admission_required`. A second directory created with the same `storeId` and `createdAt` produces the same deterministic anchor and commits as `attacker_unregistered_pm`. | Make the harness store identity uncloneable, pin/inject it outside request inputs, require anchoring on every active write path, encapsulate mutable store state, and add locked/CAS commits. An external signer is not required for the scoped local harness, but a caller-recreatable store is not an authority boundary. |
| C-03 | **PARTIAL / Critical remains** | The pinned store rejects a same-ID replacement policy with `direct_worldmodel_graph_projection_store_registry_substitution`; the same-metadata rogue store admits that replacement policy and attacker registry. | Apply the C-01 uncloneable/pinned store gate to current-context policy admission and require the store-owned exact policy body. |
| C-05 | **OPEN / Critical** | Missing resolver now fails closed and the lawful graph-primary workflow selects zero legacy rows. However, a caller resolver returning the valid pre-cutover `legacy_memory_primary` registry plus an alternate valid projection selects the already-cut-over memory; `runMemoryAdmissionWorkflow({legacyNonWave26Context:true})` also selects it without a resolver. | Resolve every memory ID from a harness-owned durable current cutover head; do not accept caller authority resolvers/registries or a caller legacy opt-out on the normal workflow. Keep the explicitly named legacy helper outside Wave 26 admission. |
| C-06 | **PARTIAL / Critical remains** | Portable applied records and direct applied builders now reject with `direct_project_memory_propagation_authoritative_admission_required`, and a real store reloads an applied record after restart. But a duck-typed object implementing the expected store methods, combined with the public `_controllerAdmission` option, admits an unrelated transition as an applied acknowledgement. | Brand/encapsulate factory-created stores, obtain the store from the harness rather than request context, remove public internal-admission switches, and make acknowledgement admission verify the persisted branded entry itself. |
| H-03 | **PARTIAL / High remains** | Actor rewrite and genesis/history erasure both reject against the original store. Separate stores recreated with the same public metadata have the same anchor and make both rewritten histories pass `validateWorldmodelGraphReplay`. | Bind genesis/head to an uncloneable pinned store identity and immutable current head. Multi-process locking/CAS remains a later custody boundary, but deterministic local anchor substitution must fail now. |
| H-04 | **PARTIAL / High remains** | The normal builder rejects omitted contextual admission and labels explicit legacy delegation diagnostic-only. A self-minted PM/WM/custody/registry chain still reaches `ready_for_thread_manager`, even on a graph carrying a claimed trust anchor without store admission. Separately, the portable validator accepts a recomputed Project A packet carrying Project B's admission ref. | Require authoritative store admission inside PM contextual admission, then resolve and revalidate the exact admission/body set at delegation/boot consumption; a digest ref alone is not operational admission. |
| H-06 | **RESOLVED — guarded local law** | The prior `[artifactBeforeRef, artifactAfterRef]` replacement now returns `committed:false` and `artifact_drift_genealogy_not_preserved`; lawful drift preserves every prior node/edge source ref. | Durable authority inherits C-01, but no independent H-06 genealogy gap remains. |
| H-08 | **PARTIAL / High remains** | The guarded provider compiles three selected refs into three O/E/D/U entries; ordinary context-pack and indexed `DirectThreadStore` persist `compiled_and_readback`, while an unknown provider rejects. However, `manager-turn-context` drops `trustStore`/`storeAdmission`, so an authoritative anchored graph cannot traverse this adapter; only the regression registers a provider. | Install a harness-owned headless provider backed by the current trust store, forward store admission through compilation/boot, and prove the existing context-pack/ThreadStore path with that provider. Full production UI and external-provider replacement remain out of scope and are not required by this gate. |

Representative hostile outputs:

```json
{"probe":"c01_legitimate_store_self_mint","committed":false,"remand":"direct_hierarchical_graph_store_admission_required","storeHeadUnchanged":true}
{"probe":"c01_recreated_store_identity","sameAnchor":true,"committed":true,"actor":"attacker_unregistered_pm","rogueHeadAdvanced":true}
{"probe":"c03_legitimate_store_same_id_policy","admitted":false,"code":"direct_worldmodel_graph_projection_store_registry_substitution"}
{"probe":"c03_recreated_store_identity","sameAnchor":true,"admitted":true,"policyId":"project_a_projection_policy"}
{"probe":"stale_memory_authority_resolver","realCutoverState":"graph_primary","attackerRegistryState":"legacy_memory_primary","attackerProjectionNodes":["independent_goal"],"selected":1}
{"probe":"C05_live_legacy_optout","actualAuthorityState":"graph_primary","workflowPosture":"legacy_non_wave26_readback","selectedCount":1,"resolverPresent":false}
{"probe":"propagation_false_effect_gate","portableApplied":"direct_project_memory_propagation_authoritative_admission_required","directAppliedBuild":"direct_project_memory_propagation_authoritative_admission_required","storedRestartReadback":"applied"}
{"probe":"duck_store_false_ack","admission":"accepted","packetSource":"world_transition","destinationTransition":"semantic_promotion_transition_a3d82ff71012491a"}
{"probe":"h03_recreated_store_identity","actorSameAnchor":true,"actorRewriteAccepted":true,"rewrittenActor":"forged_actor","erasedSameAnchor":true,"erasedGenesisAccepted":true,"erasedTransitions":0}
{"probe":"forged_operational_pm_delegation","result":"accepted","packetProject":"project_fixture","borrowedAdmissionId":"contextual_pm_admission","status":"ready_for_thread_manager"}
{"probe":"lossless_drift_gate","committed":false,"remand":"artifact_drift_genealogy_not_preserved","priorNodeSources":1,"priorEdgeSources":1}
{"probe":"H08_thread_store_path","storedStatus":"compiled_and_readback","persistedStatus":"compiled_and_readback","compilationDigestBoundInShape":true}
```

Proof boundary: `governance-trust-store.js` and the propagation store provide atomic single-process filesystem persistence, not an external signer/provider or demonstrated multi-process custody. Those excluded/later boundaries do not by themselves block Wave 26's bounded fixture/headless claim. The reproduced same-identity store substitution, caller authority-resolver/legacy bypass, duck-store effect claim, uncontextualized delegation ref, and inability to carry the authoritative store through the headless manager adapter are inside the current guarded substrate and therefore do block completion. Keep Wave 26 and `ic62` **partial / keep_guarded**.

## Final acceptance verification

Date: 2026-07-15

### Final verdict

**GREEN for the Wave 26 specification's bounded fixture/headless completion gate. RED: no. REMAND: no.** The final working tree closes the previously reproduced C-01, C-03, C-05, C-06, H-03, H-04, H-06, and H-08 bypasses at the declared local, single-process authority boundary. This GREEN supersedes the earlier dispositions only for the final remediated tree and the bounded claim at specification lines 2129–2136; the earlier RED sections remain preserved as historical audit evidence of the pre-remediation trees.

This is not a production-authority promotion. `ic62.wave26-hierarchical-worldmodel-fixture-substrate` correctly remains `partial / keep_guarded`, because the executable information-bridge registry describes broader resident/product integration, while this acceptance verifies the narrower Wave 26 claim: implemented hierarchical semantic substrate plus fixture/headless proof. No full production manager UI, default production bootstrap, external signer, provider-context replacement, automatic historical ingestion, multi-process CAS, or repository/runtime-truth oracle is claimed.

### Fresh-tree verification method

The final pass re-read the current intent specification and current source after the last trust-store and memory-runtime remediations. It did not carry forward a prior disposition. It inspected the graph/trust store, projection admission, Project Manager operational admission, manager-context runtime, context-pack and `DirectThreadStore` consumer, AgentMemory authority selection, propagation controller/store, migration genealogy, and their current regressions.

The complete affected matrix was rerun:

```bash
for f in \
  scripts/direct-hierarchical-worldmodel-graph-regression.mjs \
  scripts/direct-worldmodel-graph-projection-regression.mjs \
  scripts/direct-worldmodel-semantic-ingress-regression.mjs \
  scripts/direct-project-manager-regression.mjs \
  scripts/direct-manager-turn-context-regression.mjs \
  scripts/direct-thread-manager-boot-regression.mjs \
  scripts/direct-agent-context-source-refs-regression.mjs \
  scripts/direct-agent-memory-admission-gate-regression.mjs \
  scripts/direct-project-memory-propagation-regression.mjs \
  scripts/direct-project-profile-resolution-regression.mjs \
  scripts/direct-project-profile-appserver-session-regression.mjs \
  scripts/direct-worldmodel-migration-games-regression.mjs \
  scripts/direct-worldmodel-manager-convergence-games-regression.mjs \
  scripts/direct-worldmodel-governance-integration-games-regression.mjs
do
  node "$f" || exit
done
```

All fourteen regressions passed. The final repository checks also passed:

```bash
npm run precheck:syntax
node --check src/main/direct/worldmodel/manager-context-runtime.js
npm run direct:information-bridge-audit
git diff --check
```

The executable audit reported `Rows: 105`, `Valid: yes`, `Missing source files: 0`, `implemented=39`, `partial=64`, `inherited=2`, and retained `ic62` as `partial / keep_guarded`.

### Final resolution matrix

| Finding | Final disposition | Fresh-tree evidence | Guarded residual, if any |
|---|---|---|---|
| C-01 — graph write authority | **RESOLVED — bounded local authority** | Current append requires an anchored graph and an exact, store-issued, graph/revision/actor/role/purpose/artifact-bound admission. The store handle is opaque and branded; its authority identity is randomly generated rather than caller supplied. The active resolver is selected from the graph anchor, not a request store. Same-metadata recreation has a different anchor, and copied-directory registration is rejected by canonical authority-location binding. | The local store trusts custody of its app-private directory. Coordinated replacement of every local revision and cache across a fresh process is not prevented by an external signer or OS-backed monotonic counter. |
| C-03 — projection policy authority | **RESOLVED — bounded local authority** | Current-context projection resolves the exact store-owned profile and policy, rejects request policy/profile/registry substitution, and validates a store-issued `current_context` admission. Same-ID/different-body policy attacks and copied-store resolver takeover reject. | Policy custody inherits the same local-store/OS boundary as C-01. Audit-history projections remain explicitly non-current-context. |
| C-05 — single AgentMemory authority | **RESOLVED — bounded local authority** | Normal Wave 26 selection rejects caller resolvers, registries, request-supplied runtimes, and the legacy boolean opt-out. The live workflow receives the harness-injected branded runtime, whose graph-primary head selects zero legacy rows. The durable head is now paired with an append-only hash-chained ledger; restoring the exact valid pre-cutover head while newer ledger evidence exists fails closed. | Coordinated rollback or deletion of both local head and full ledger across a fresh process needs external append-only storage/signing/CAS. The separately named legacy helper remains compatibility-only and cannot claim Wave 26 graph context. |
| C-06 — propagation effect truth | **RESOLVED — bounded local controller** | Portable `applied` records and direct applied acknowledgements reject. Only a WeakMap-branded controller over a factory store can emit/read an applied record. Admission revalidates distinct source/destination transitions, exact pre/post graphs and governance registries, direction/project/scope, consumed admissions/authorizations, mutation IDs, packet equality, and graph-derived replacement boot/context. Duck stores and the former public `_controllerAdmission` trick reject. | Persistence is single-process and file-backed; cross-process locking, external delivery acknowledgements, and hostile same-user store-directory replacement remain later custody work. |
| H-03 — replay immutability | **RESOLVED — bounded local authority** | Actor rewrite, genesis/history erasure, stale graph, and legacy replay of an anchored graph reject against the store head. Store state binds a random authority identity to its canonical real directory; copied stores cannot register the same anchor. Same-process high-water checks reject revision regression/equivocation, while same-path lawful reopen succeeds. | A fresh process has no external monotonic witness if an actor can coherently replace the complete app-private store. That is an explicit OS/external-custody residual, not a request-level replay path. |
| H-04 — universal Project Manager admission | **RESOLVED — operational boundary** | Contextual PM admission resolves the anchored current graph and exact store registry, requires the store-issued admission and exact WM/PM/root/custody/authority bodies, and binds exact Thread Manager/WorkThread bodies. Wave 26 delegation construction and consumption require the full contextual body set; a digest ref alone, cross-project borrowing, omitted store admission, and a self-minted registry reject. Explicit legacy delegation is diagnostic-only and cannot be `ready_for_thread_manager`. | Store-issued context admissions remain local single-process artifacts and inherit C-01 custody limits. |
| H-06 — migration genealogy | **RESOLVED — guarded local law** | Artifact drift now requires both before/after evidence and preserves every prior exact node and edge source identity. The former `[artifactBeforeRef, artifactAfterRef]` replacement remands with `artifact_drift_genealogy_not_preserved`; the lawful path commits and preserves the independent goal. | Long-term physical evidence retention remains outside Wave 26, as the specification states. |
| H-08 — graph-first live consumer | **RESOLVED — bounded headless consumer** | A harness-installed `headless_current_graph` provider is pinned to an authoritative trust-store handle. Manager compilation now carries the store admission through projection and boot admission. The ordinary `buildContextPack` path materializes one O/E/D/U entry per selected graph ref into provider-consumed context, and indexed `DirectThreadStore` persistence/readback reports `compiled_and_readback`. Unknown providers, stale admissions, substituted projections, and missing admissions fail closed; explicit reinstall with a fresh admission restores service. | Provider reinstall is an explicit lifecycle step after authority-head change; no default production bootstrap, production manager UI, or external-provider context replacement is claimed. |

### Hostile probe results after final remediation

The permanent regressions now include the prior attacker classes. Two additional streamed mutations re-ran the exact last-mile rollback/copy attacks without repository writes. Representative final outputs were:

```json
{"probe":"copied_store_unkeyed_actor_rewrite_after_fix","openCode":"direct_worldmodel_trust_store_authority_location_mismatch","replayCode":"direct_worldmodel_trust_store_stale_or_swapped_graph","originalStillUsable":true}
{"probe":"memory_runtime_valid_head_rollback_after_fix","beforeRollbackSelected":0,"reopenCode":"direct_memory_authority_runtime_rollback_detected"}
{"probe":"forged_operational_pm_delegation","result":"rejected","code":"direct_thread_manager_project_operational_context_required"}
{"probe":"anchored_pm_self_mint","result":"rejected","code":"direct_worldmodel_trust_store_authority_unresolved"}
{"probe":"self_minted_pm_registry","result":"rejected","code":"direct_project_manager_context_store_registry_substitution"}
{"probe":"omitted_pm_store_admission","result":"rejected","code":"direct_project_manager_context_store_admission_required"}
{"probe":"cross_project_borrowed_pm_ref","result":"rejected","code":"direct_thread_manager_project_operational_context_mismatch"}
{"probe":"lawful_trusted_pm_delegation","result":"ready_for_thread_manager","boot":"ready_for_worker_boot"}
```

The propagation games additionally reject a relabelled portable applied record, a duck-typed controller, a caller `_controllerAdmission` flag, wrong direction/project/scope, reused or same transition on both legs, stale graph/boot/registry, packet mutation mismatch, and unrelated destination acknowledgement. The manager-context games reject caller-selected providers, substituted audience/projection, missing store admission, and stale admission after store revision; the lawful installed-provider and restart paths both return `compiled_and_readback`.

### Integration consistency

The final contracts now compose without the former authority downgrades:

1. Graph writes, current projections, Project Manager delegation, manager context, propagation refresh, migration drift, and project-memory admission all resolve or carry the same anchored graph/store posture; none silently falls back to portable digest shape as effect authority.
2. Current Wave 26 APIs fail closed. Historical behavior is available only through explicitly named legacy helpers/postures and cannot be presented as Wave 26 operational readiness.
3. Graph-primary memory authority reaches both direct selection and `runMemoryAdmissionWorkflow`; caller omission, stale resolver injection, or legacy opt-out no longer changes the selected authority.
4. Propagation's portable schemas remain evidence shapes, while `applied` is reserved for controller-owned persisted state and exact contextual readback.
5. Manager graph semantics reach the same context-pack, request-manifest/provider-input, and `DirectThreadStore` persistence path used by an ordinary direct text turn, while historical transcript remains excluded by default.
6. The convergence, migration, projection, propagation, profile-resolution, and app-server/session games pass together in one tree; no integration test requires weakening another module's authority check.

### Guarded residuals and non-blocking boundaries

The following are honest guarded residuals, not hidden completion claims:

- Trust, memory-cutover, and propagation persistence are local filesystem mechanisms. They do not provide external signatures, TPM/OS monotonic counters, hostile same-user isolation, coordinated whole-store rollback resistance across a fresh process, or multi-process transaction locking.
- The headless manager provider deliberately fails closed when its store admission/head becomes stale and requires owner reinstall with a fresh current recipe. Automatic production lifecycle/bootstrap wiring is later work.
- The context consumer proves local provider-input construction and persisted readback, not that an external provider independently attested effective model context or reasoning effort.
- Wave 26 does not claim full production manager UX, autonomous historical transcript mining, universal ordinary-chat migration, physical evidence retention, or automatic equivalence between graph claims and repository/runtime truth.
- `ic62` remains `partial / keep_guarded`; GREEN here authorizes the bounded Wave 26 fixture/headless acceptance claim, not a broader resident-product or production-authority claim.

### Terra High blindspot taxonomy

| Blindspot pattern | What the earlier Terra High work missed | Final closure / lesson |
|---|---|---|
| Self-consistency mistaken for provenance | Canonical digests and caller-built registries proved internal agreement but not who owned the graph, profile, policy, or decision. | Pin active graph/projection admission to an opaque harness store and exact store-owned bodies; keep portable builders non-authoritative. |
| Public metadata mistaken for store identity | A deterministic anchor let another directory recreate the same authority. The first random-identity fix still needed explicit copied-directory and high-water probes. | Generate identity outside caller input, bind it to canonical real location, refuse cross-location registration, and retain an in-process high-water witness. |
| Caller optionality at authority boundaries | Resolver/registry presence, a Wave 26 flag, and a normal-workflow legacy opt-out let callers choose the memory authority story. | Make current selection always resolve the injected owner runtime; reject caller authority carriers and keep legacy behavior in separately named APIs. |
| A valid cache mistaken for a current head | The first durable memory runtime accepted a byte-valid older cutover head after restart. | Pair the head cache with an append-only hash-chained ledger and require exact terminal equality; keep coordinated whole-store rollback as an explicit external-custody boundary. |
| Duck typing mistaken for capability ownership | Method-shaped propagation stores and a public internal option could fabricate `applied`. | Use module-private symbols plus WeakMap-branded opaque handles/controllers, and derive applied acknowledgements only from verified persisted entries. |
| Ref transport mistaken for operational admission | A PM admission digest could travel with delegation without resolving exact bodies at the consumer. | Re-run complete anchored contextual admission at delegation build, validation, and boot consumption; legacy ref-only packets remain diagnostic. |
| Fixture adapter mistaken for a consumer | Graph compilation existed, but no ordinary context-pack/provider-input persistence path consumed it. | Install one harness-owned headless current-graph provider and prove O/E/D/U materialization through `buildContextPack`, request input, and `DirectThreadStore` readback. |
| New evidence mistaken for replacement genealogy | Drift handling could replace prior source refs with only before/after artifact refs. | Enforce prior-source supersets on revised node and edge bodies and retain a permanent lossy-genealogy negative. |
| Happy-path restart mistaken for rollback resistance | Reopen tests did not restore an older valid state or copy the authority directory. | Add byte-valid old-head restoration, copied-location takeover, actor/history rewrite, and original-authority-survival probes as permanent acceptance tests. |
| Production demands blurred with the scoped spec | Earlier audit language sometimes treated missing external signer/provider/product UI as equivalent to failure of the expressly bounded fixture/headless gate. | Keep both truths explicit: GREEN for the bounded Wave 26 completion gate; guarded/partial for production custody and resident-product integration. |

### Acceptance conclusion

The final remediated tree is **GREEN** for Wave 26's bounded fixture/headless completion claim. There is **no remaining RED or REMAND** among C-01, C-03, C-05, C-06, H-03, H-04, H-06, or H-08 at that boundary. The remaining items above are guarded custody/product boundaries and must not be silently promoted into production claims.
