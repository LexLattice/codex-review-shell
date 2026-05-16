# Direct Recursive ODEU Build Meta-Program

## Purpose

This document adapts the principled recursive ODEU meta-program to this repo's
actual job: constructing and validating a new Direct harness, not reconstructing
a partially known reference program.

The core loop is:

```text
intended capability law / matrix row
  -> native semantic base ontology pass
  -> recursive operator descent
  -> behavior branch tree
  -> terminalization and coverage adequacy audit
  -> E-probe families grouped by branch structure
  -> implementation coverage map grouped by the same tree
  -> fixture / headless / real-usage observations attached back to exact nodes
  -> theory repair before code repair
```

The central correction is methodological:

```text
Failed probes are not a patch list.
Failed probes are evidence that some part of the program theory, branch tree,
implementation map, or probe oracle is wrong.
```

For this project, there is no external cleanroom/reference executable whose
bytes define truth. The primary oracle is the Direct harness law: matrix rows,
spec invariants, authority boundaries, runtime evidence rules, and real-usage
contracts. Live provider/app-server observations are evidence against that law,
not a separate program to imitate blindly.

## Construction Versus Reconstruction

The ProgramBench reconstruction loop uses reference observations to lock unknown
behavior. Our Direct harness loop replaces that with staged law and evidence:

```text
visible spec/matrix law
  -> expected behavior branch
  -> fixture/headless E-probe
  -> real-usage/live E-probe when authority or provider behavior matters
  -> report/evidence artifact
  -> matrix row status
```

Differences from reconstruction:

- No reference executable is treated as behavioral truth.
- No official hidden eval is the final oracle.
- Probe failures can mean the law is under-specified, the implementation is
  wrong, the probe is too synthetic, or the live provider contract drifted.
- Provider/app-server observations are scoped evidence. They do not overrule
  harness authority boundaries.
- We validate intended behavior as real behavior by proving that the branch
  leaves implied by the law execute, block, degrade, or report as specified.

## Source Of Truth Chain

Every new capability should preserve this ordering:

```text
product boundary / matrix row
  -> ODEU law: ontology, deontics, epistemics, utility
  -> recursive behavior branch tree
  -> terminal behavior leaves
  -> E-probe witness map
  -> implementation coverage map
  -> fixture/headless reports
  -> real-usage/live reports where applicable
  -> readiness / promotion status
```

Renderer state, user-facing labels, passing smoke tests, and live provider
successes are not authority by themselves. They become evidence only when tied
to exact branch nodes, exact request/runtime scope, durable artifacts, and
stable report rows.

## Vanilla Sibling As Comparative Instantiation

This project is not designing in a vacuum. We have a sibling implementation:

```text
vanilla Codex CLI / app-server path
```

The app-server path remains the default baseline, and Codex CLI/app-server
behavior is a valuable concrete instantiation of many general concepts:

```text
context management
conversation state
provider continuity
tool approval
operation history
sub-agent display
runtime status
usage / quota visibility
```

For a new Direct capability, do not jump directly from abstract law to our own
implementation. Add a comparative-instantiation pass:

```text
general conceptual representation
  -> vanilla Codex/app-server instantiation profile
  -> Direct harness desired instantiation profile
  -> delta: same concept, broader concept, stricter law, or intentional divergence
```

The vanilla profile is not a reference oracle in the ProgramBench sense. It is
not something Direct must copy byte-for-byte or behavior-for-behavior. It is a
sibling design point that reveals:

- which conceptual nodes are already known to be useful in practice;
- which choices vanilla makes narrowly or implicitly;
- which authority boundaries are app-server-owned rather than renderer-owned;
- which concepts Direct should preserve for compatibility;
- which concepts Direct should broaden, make explicit, or fail closed.

Example for context management:

```text
General concept:
  context evidence selection, pressure, compaction/trim, memory, frontier state,
  omission truth, request source refs, provider continuity, recovery.

Vanilla Codex/app-server instantiation:
  whatever the app-server/CLI exposes or implies about recent context,
  compaction, summaries, session continuity, history, and status events.

Direct desired instantiation:
  explicit context packs, request manifests, maintenance refs, omission ledgers,
  durable memory as quoted evidence, frontier baton as status evidence, and
  provider continuity only when exact evidence authorizes it.
```

This gives us two anchors: the broad conceptual tree and one real sibling
implementation. Direct then becomes a deliberate instantiation, not an isolated
invention and not an app-server clone.

### Comparative Instantiation Node Fields

Any behavior tree node may carry implementation-profile annotations:

```yaml
concept_node_id: N-...
concept_label: Context omission truth
vanilla_instantiation:
  source: codex_cli | app_server | app_server_event | observed_ui | docs | unknown
  instantiated: true | false | unknown
  representation: implicit | explicit | hidden | unavailable | unknown
  authority_owner: app_server | cli | renderer | provider | unknown
  evidence_refs: []
  constraints_or_gaps: []
direct_instantiation:
  target_status: implement | preserve_baseline | broaden | stricter_fail_closed | defer | reject
  representation: explicit_artifact | projection | runtime_gate | report | none
  authority_owner: direct_harness | app_server_baseline | renderer_display_only
  evidence_required:
    - fixture_probe
    - headless_probe
    - real_usage_probe
  divergence_reason: ""
```

### Comparative Outcomes

The delta between vanilla and Direct should be classified:

```text
same_concept_same_shape
same_concept_more_explicit
same_concept_stricter_authority
same_concept_broader_coverage
same_concept_display_only_in_direct
vanilla_only_preserved_by_app_server_path
direct_only_new_concept
intentional_divergence
unknown_requires_vanilla_probe
```

This classification matters for E-probes. If Direct claims compatibility with a
vanilla concept, include a parity or migration probe. If Direct intentionally
diverges, include a probe proving the divergence is explicit and user-safe. If
vanilla behavior is unknown, mark it as sibling-pressure, not as Direct law.

## Phase A: Native Semantic Base Ontology Pass

Before designing probes or code, describe what kind of machine this feature is.
For Direct harness work, extract these base node families when present:

```text
capability row / product boundary
runtime source
provider/app-server profile
project/session/thread/turn entity
request / stream / normalized event entity
local authority / obligation / approval entity
workspace effect / policy entity
context / memory / governance / sub-agent evidence entity
renderer projection / UI action entity
operation ledger / recovery entity
side-effect surface
error / degraded / blocked state
readiness / promotion state
```

Each base node should include:

```text
node_id
semantic_name
matrix_rows
program_role
source_basis
evidence_authority
vanilla_instantiation_summary
direct_instantiation_target
known_consumers
known_observable_surfaces
initial_risk
open_questions
```

Example:

```text
Runtime path selection is a project-scoped persisted setting that chooses
between app-server and direct execution surfaces. It is not turn authority by
itself. It affects runtime status, composer availability, request routing, and
rollback behavior.
```

That one sentence implies runtime identity, persistence, UI projection, startup
hydration, turn gating, rollback, app-server preservation, and stale-state
branches.

## Phase B: Recursive Operator Descent

Apply the same operator calculus to every behavior-bearing node. A branch is
meaningful when two possible child worlds can differ in:

```text
accepted user action
runtime authority
provider request shape
local side effect
workspace state
context inclusion
renderer projection
operation history
recovery classification
blocked/degraded state
report or promotion status
future downstream behavior
```

A branch may stop only when all applicable operations are exhausted, proven
pass-through, locked by evidence, covered by probes, or explicitly deferred.

### OP-B: Boundary / Entity Reification

Question:

```text
What is this thing, what counts as one instance of it, and what distinguishes
it from neighboring things?
```

Direct examples:

- Runtime tier selection is not turn authority.
- Provider summary visibility is not provider file-content visibility.
- Durable memory is not current system/developer policy.
- Sub-agent progress is not wait/inspect authority.

### OP-D: Decomposition / Part Extraction

Question:

```text
What fields, sub-objects, phases, artifacts, resources, or controls constitute
this node?
```

Direct examples:

- A request has context pack, request manifest, provider input projection,
  request-shape evidence, endpoint evidence, and raw-storage audit.
- A workspace effect summary has pre-state, post-state, path policy,
  provider visibility, and recovery state.

### OP-R: Role / Consumer Split

Question:

```text
Who consumes this node, and can different consumers require different truths?
```

Direct examples:

- A patch result is local recovery truth, provider-facing summary evidence, UI
  status, and operation history evidence. Those are different consumers.
- A witness chip informs the user but does not promote capability.

### OP-L: Lattice / Value-State Split

Question:

```text
What are the relevant states of presence, type, value, defaulting, emptiness,
multiplicity, freshness, and conflict?
```

Direct examples:

- Evidence can be accepted, runtime-probed, expired, mismatched, diagnostic,
  missing, corrupt, or scope-mismatched.
- Provider visibility can be none, summary-only, partial content, all relevant
  content, stale content, or unknown.

### OP-T: Temporal / Lifecycle Split

Question:

```text
When does this node appear, become valid, affect state, become provider-visible,
become recoverable, and cease to matter?
```

Direct examples:

- Tool arguments are not approvable until complete and parseable.
- Command workspace scanning happens after command process cleanup.
- Fresh fork local artifacts may exist before provider completion.

### OP-S: Subject / Selection / Aggregation Split

Question:

```text
Which subject owns this fact, which rows are selected, and what denominator
does the aggregate decision use?
```

Direct examples:

- One real live read probe does not prove patch or command request shapes.
- Fixture UI coverage does not promote real runtime authority.
- Quota exhaustion for live probes does not block reading existing reports.

### OP-P: Projection / External Surface Split

Question:

```text
Where does this node become observable, and what grammar or schema controls
that surface?
```

Direct examples:

- Renderer projection, operation history row, JSON report, Markdown summary,
  provider request body, and context pack are separate surfaces.
- Raw-exposure scan requirements differ between app-private artifacts and
  renderer-safe projections.

### OP-F: Failure / Negation / Invalidity Split

Question:

```text
What if this node is invalid, unavailable, contradictory, stale, partial,
unsupported, or unsafe, and where does failure surface?
```

Direct examples:

- Stale UI action returns a stable blocker and refreshes projection instead of
  retrying execution.
- Missing required omission ledger blocks context build.
- Unknown provider event type blocks affected request-shape promotion.

### OP-C: Composition / Interaction / Non-Commutation Split

Question:

```text
When two branches are both active, do their operations commute? If not, which
order or precedence wins?
```

Direct examples:

- Runtime tier x active local action: rollback is blocked until terminal.
- Tool result x provider continuation: local result can be durable while
  provider continuation is unknown.
- Workspace mutation x context maintenance: required workspace-effect evidence
  must not be trimmed silently.

### OP-E: Evidence / Authority Split

Question:

```text
Why do we believe this branch exists, and is it implementation truth, fixture
truth, real-runtime truth, live-provider truth, or only a candidate?
```

Direct evidence states:

```text
spec_law
matrix_law
fixture_probe
headless_runtime_probe
real_runtime_probe
real_provider_probe
diagnostic_only
report_validation
drift_pressure
explicit_deferral
conflict_isolated
```

## Phase C: Terminalization And Coverage Adequacy

A leaf is not terminal merely because one representative test exists. It is
terminal only when no sibling branch can preserve the same high-level primitive
while changing:

```text
authority decision
provider request shape
local mutation
workspace effect truth
context inclusion
renderer-visible status
operation ledger row
recovery state
report promotion
```

Probe closure requires:

```text
every high-risk primitive has terminal leaves;
every terminal leaf has fixture/headless/live coverage or explicit deferral;
every representative probe states which siblings it does not cover;
fixture-only coverage is not treated as real-provider/runtime proof;
negative-control probes prove forbidden paths stay forbidden;
real-usage probes exist where user-facing runtime behavior matters.
```

## Node Schema

```yaml
node_id: N-...
parent_id: N-... | null
path: Direct/RuntimePathSelection/Persistence/RestartHydration
semantic_label: Runtime path default persists across app restart
matrix_rows: [F5, F9, J1]
source_basis:
  evidence_authority: matrix_law | spec_law | fixture_probe | real_runtime_probe | real_provider_probe | diagnostic_only
  source_refs: []
operator_that_created_node: OP-T
applied_operators:
  OP-B: exhausted | produced_children | not_applicable | deferred
  OP-D: exhausted | produced_children | not_applicable | deferred
  OP-R: exhausted | produced_children | not_applicable | deferred
  OP-L: open | exhausted | produced_children | not_applicable | deferred
  OP-T: open | exhausted | produced_children | not_applicable | deferred
  OP-S: open | exhausted | produced_children | not_applicable | deferred
  OP-P: open | exhausted | produced_children | not_applicable | deferred
  OP-F: open | exhausted | produced_children | not_applicable | deferred
  OP-C: open | exhausted | produced_children | not_applicable | deferred
  OP-E: current_status
consumers:
  - runtime_status
  - composer
  - request_router
  - renderer_settings
  - readiness_report
observable_surfaces:
  - renderer_ui
  - local_config
  - runtime_status_projection
  - operation_history
  - report
risk:
  authority_sensitive: true
  provider_shape_sensitive: false
  local_side_effect: false
  persistence_sensitive: true
  raw_exposure_sensitive: false
terminal_status: open | probe_required | locked | deferred | pass_through | conflict_isolated
probe_refs: []
implementation_owner: runtime_path_selection | controller | renderer | store | report | unknown
known_conflicts: []
candidate_upstream_discriminators: []
counterfactual_probe_refs: []
regression_retention_probe_refs: []
```

## E-Probe Row Schema

An E-probe is a witness for a branch distinction.

```yaml
probe_id: EP-...
primary_node_path: Direct/ContextMaintenance/OmissionLedger/RequiredArtifactBlock
operator_witnessed: OP-F
sibling_branches_separated:
  - optional context omission creates omission ledger
  - required artifact omission blocks before context send
fixture_or_scenario: required_class_omission_ledger_blocks
realism_tier: fixture | headless_runtime | real_runtime | real_provider | diagnostic
observable_surface:
  - blocker_code
  - context_pack_absent
  - provider_transport_calls_zero
expected_observation_kind: block_with_stable_code
negative_controls:
  - no_provider_transport
  - no_workspace_mutation
interaction_partner_paths:
  - Direct/ContextPack/RequiredMaintenanceRefs
oracle_authority: matrix_law
implementation_owner: context_maintenance
report_refs: []
```

## Probe Family Types

```text
authority discriminator probe
  Separates allowed, blocked, degraded, and diagnostic branches.

state lattice probe
  Covers absent/missing/stale/corrupt/expired/mismatched/unknown states.

lifecycle-order probe
  Covers durable-before-transport, action-before-continuation, scan-after-command,
  and recovery-after-interruption order.

scope/denominator probe
  Covers exact model/request/account/project scope and fixture-vs-live promotion.

projection/schema probe
  Covers renderer-safe projections, report schemas, raw-exposure flags, and
  request manifest/provider input projections.

failure-precedence probe
  Covers blocker priority, stale action rejection, corrupt artifact recovery,
  and unsupported provider event handling.

interaction probe
  Covers non-commuting branches sharing runtime tier, provider transport,
  workspace state, context budget, or UI action state.

real-usage probe
  Exercises actual user-facing workflows through app-server/direct routing,
  text, tool loops, fork starts, persistence, and recovery surfaces.
```

Probe families are grouped by nearest common ancestor in the ontology tree, not
by superficial test script or implementation module.

## Implementation Coverage Map

Code coverage is semantic coverage over behavior leaves.

```yaml
behavior_leaf: N-...
primary_operator: OP-C
implementation_owner: live_text_controller
fixtures: [EP-...]
asserted_surfaces:
  - request_manifest
  - provider_input_projection
  - transport_lifecycle
  - operation_history
state_invariant_refs: [N-...]
negative_controls:
  - no_app_server_fallback
  - no_previous_response_id_when_fresh_context
known_conflicts: []
```

Repair routing:

```text
OP-B failure -> boundary/type model or identity ownership
OP-D failure -> schema/field/artifact decomposition
OP-R failure -> role split or consumer-specific truth
OP-L failure -> state lattice and defaulting
OP-T failure -> lifecycle/recovery ordering
OP-S failure -> scope, subject, denominator, promotion logic
OP-P failure -> renderer/report/request projection
OP-F failure -> blocker, degraded state, invalidity, recovery
OP-C failure -> orchestration, precedence, non-commutation
OP-E failure -> evidence state, probe oracle, report promotion
```

If a failure maps to no leaf, the theory tree is missing a branch.

## Conflict Branch Reconciliation

When two sibling branches cannot both stay green under the same broad
implementation rule, do not choose one leaf and keep broad-patching until the
other fails. Treat the red/green conflict as evidence that the ontology tree is
missing a parent discriminator.

Construction version:

```text
repair fixes one Direct branch but regresses another
  -> stop broad patching
  -> move upward to the smallest shared parent node or shared authority surface
  -> name the flat rule that made the branches conflict
  -> derive candidate upstream discriminators from the law or sibling profile
  -> build counterfactual E-probes that differ only by the proposed discriminator
  -> keep regression-retention probes for the branch that was already green
  -> patch only after the discriminator is specified by matrix/spec law,
     vanilla sibling evidence, fixture/headless evidence, or live evidence
```

The repair artifact should be an upstream-discriminator row before it is a code
patch:

```yaml
conflict_id: CM-CONFLICT-...
shared_parent_node: Direct/ContextMaintenance/FrontierBaton
conflicting_branches:
  - required stale baton blocks context build
  - optional stale baton is omitted from provider-visible context
flat_rule_that_failed: stale baton is either always invalid or always ignored
candidate_discriminator:
  name: baton_requirement
  values: [required, optional]
  evidence_authority: matrix_law
counterfactual_probes:
  - required_stale_baton_blocks
  - optional_stale_baton_omits
regression_retention_probes:
  - current_valid_baton_included
implementation_owner: context_pack
```

For Direct construction, the discriminator can come from:

```text
matrix/spec law
vanilla app-server sibling instantiation
fixture/headless observation
real-runtime observation
live-provider observation
explicit product decision
```

It must not come from:

```text
making a local patch pass one failing assertion;
renderer wording alone;
provider output quality alone;
one branch's green probe without a counterfactual sibling probe.
```

Direct examples:

- `baton_requirement` separates required stale baton blocking from optional
  stale baton omission.
- `source_ref_freshness` separates valid memory refresh sources from
  renderer-DOM-only, stale, blocked, corrupt, or digest-missing sources.
- `action_kind` separates display/inspect status reads from provider-send or
  request-build actions.
- `runtime_family` separates app-server contextCompaction sibling evidence from
  Direct provider compact primitive proof.
- `provider_visibility_class` separates summary-only workspace visibility from
  changed-content visibility.

This rule is especially important for new-program construction because there is
no hidden reference executable to settle the conflict later. If the upstream
discriminator is absent, the correct next step is to update the law or mark the
branch conflict-isolated, not to overfit code to the most recent red probe.

## Bookkeeper Audit

The bookkeeper audits operator continuity, not just whether a checklist exists.

For every node:

```text
Did every applicable operator run, or receive a not-applicable/deferral reason?
Did every operator-produced child receive terminal status?
Does every behavior-bearing leaf have a probe, observation lock, or deferral?
Does every probe witness a specific sibling distinction?
Do non-commuting shared-surface interactions have OP-C probes?
Is fixture evidence prevented from promoting live/runtime authority?
Are provider/app-server observations exact-scope?
Are negative controls proving forbidden paths stay forbidden?
Did any repair that affected sibling branches identify an upstream
  discriminator first?
```

Blocking bookkeeper failures:

```text
operator_not_applied
operator_output_silent_drop
child_without_terminal_status
probe_without_operator_witness
behavior_leaf_without_probe_or_deferral
interaction_missing_for_shared_surface
fixture_overpromoted_to_live_truth
diagnostic_overpromoted_to_authority
live_observation_scope_mismatch
report_green_badge_without_negative_controls
branch_conflict_patched_without_discriminator
counterfactual_probe_missing_for_conflict
regression_retention_probe_missing_for_conflict
```

## Observation And Repair Loop

Observations update the tree before code is patched.

```text
fixture/headless probe green
  -> mark leaf fixture-locked or headless-locked only

real-usage/live probe green
  -> mark exact-scope live/runtime leaf locked

probe failure
  -> attach failure to nearest node
  -> classify as implementation defect, missing branch, under-realistic probe,
     oracle mismatch, live provider drift, or scope conflict

clustered failures
  -> run theory audit
  -> repair branch tree and probe map
  -> then remand implementation by primary operator/owner

branch conflict after repair
  -> attach both red and green observations to the shared parent node
  -> derive candidate upstream discriminator
  -> add counterfactual probes that differ only by the discriminator
  -> keep the previously green branch as a retention probe
  -> patch only after the discriminator is law-backed or evidence-backed
```

Do not patch failures one by one until the theory audit says they are localized
implementation defects.

## Standard Workflow For Future PRs

For each new Direct harness capability:

```text
1. Draft or update matrix law.
2. Build native semantic base ontology.
3. Run recursive operator descent.
4. Terminalize leaves and audit coverage adequacy.
5. Profile vanilla Codex/app-server as a sibling instantiation of the same
   concept where relevant.
6. Classify the Direct delta: same shape, broader coverage, stricter authority,
   display-only, defer, reject, or intentional divergence.
7. Produce E-probe witness map and implementation coverage map.
8. Implement narrowly against the branch tree.
9. Run fixture/headless probes.
10. Run real-usage/live probes when authority, transport, persistence, or UI
   behavior must be proven in actual use.
11. Cluster failures by wrong theory, not by failing assertion.
12. For intertwined red/green branches, add an upstream-discriminator row and
    counterfactual probes before implementation patching.
13. Repair theory first, then implementation.
14. Record report/promotion state with exact evidence scope.
```

## Minimal Generator Prompt Skeleton

```text
You are the Direct recursive ODEU build generator.

Do not enumerate edge cases first.

Read the current Direct harness matrix/spec/user goal and infer the base
ontology: capability row, runtime source, provider/app-server profile, local
authority, request/event entities, workspace/context/governance/sub-agent
evidence, renderer projections, operation ledger, recovery, errors, and
readiness/promotion surfaces.

When a vanilla Codex CLI/app-server sibling concept exists, profile it as one
concrete instantiation of the general concept before proposing the Direct
instantiation. Treat it as design evidence and compatibility pressure, not as a
reference oracle.

Then recursively apply:
OP-B boundary, OP-D decomposition, OP-R role/consumer, OP-L lattice,
OP-T lifecycle, OP-S subject/selection/aggregation, OP-P projection,
OP-F failure/negation, OP-C composition/interaction, OP-E evidence/authority.

For every operation:
- state why it applies or is not applicable;
- create children when observably distinct behavior can result;
- attach evidence authority and matrix rows;
- stop only with locked, probed, pass-through, deferred, or conflict-isolated
  status.

When observations or repairs create conflicting sibling branches, ascend to the
smallest shared parent, name the missing upstream discriminator, and emit
counterfactual probes plus regression-retention probes before proposing a code
patch.

Finally emit:
1. recursive ontology tree;
2. operator application ledger;
3. terminal behavior leaves;
4. E-probe witness map;
5. implementation coverage map;
6. upstream-discriminator rows for any conflicts;
7. bookkeeper questions and residual risks.
```

## Minimal Bookkeeper Prompt Skeleton

```text
You are the Direct adversarial recursive ODEU bookkeeper.

Audit the generator tree, not just the final obligations.

For every node:
- verify every applicable operator was applied, declared not applicable, or
  deferred;
- verify every child has terminal status;
- verify every behavior-bearing leaf has a probe, observation lock, or explicit
  deferral;
- verify every probe witnesses a specific operator split and sibling
  distinction;
- verify non-commuting interactions have OP-C rows;
- reject fixture-to-live overpromotion;
- reject diagnostic-to-authority overpromotion;
- reject green reports without negative controls for forbidden paths.
- reject conflict repairs that did not identify the parent discriminator and
  add counterfactual plus retention probes.

Return blocking objections with the smallest missing node/operator/probe repair.
```

## Immediate Use

Use this before the next feature list and before broad real-usage testing. The
expected artifact is not a long prose spec first. It is:

```text
recursive_ontology_tree
operator_application_ledger
terminal_leaf_ledger
e_probe_witness_map
implementation_coverage_map
bookkeeper_operator_audit
```

Those artifacts can then be collapsed into the PR spec, regression matrix, and
real-usage test plan.
