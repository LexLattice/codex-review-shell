# Direct Semantic Service DSS-0.4 implementation contract

Status: generation-8 semantic-reopen repair draft. Not frozen, ratified, or
authorized for implementation.

Promoted implementation predecessor: DSS-0.3 implementation
`e57e4009312ffe21b22d18d996ff461ad5018388`.

Ratified semantic predecessor: DSS-0.3 candidate
`45ca7736afbb6701d60abcdb6b0dc9888d2741b6`.

Pinned semantic compiler used during construction:
`2dec60ee75178b98b9ae517a576002519e1f0f81`.

## 1. Tranche and authority

DSS-0.4 is the compiler adapter and closed-page materializer. It accepts only
sealed DSS-0.3 results and exact owner-installed project/compiler policy. It
invokes one exact pinned compiler build, admits its output under canonical
Direct custody, and materializes closed worker pages from immutable target
snapshot artifacts.

DSS-0.4 does not execute a model, contact a provider, inspect a live checkout,
accept a worker assertion as project truth, mutate a target project, deliver UI
state, promote compiler law, or reinterpret a DSS-0.3 result. Those powers
belong to later tranches or separate institutions.

The successful lifecycle is:

```text
DSS-0.3 sealed result accepted
-> exact project/compiler/snapshot/runtime inputs admitted
-> pinned compiler executed over closed inputs
-> compiler output canonically admitted
-> route population reconciled
-> closed pages materialized from snapshot artifacts
-> completeness and sufficiency adjudicated
-> known-insufficient pages remanded without worker compute
-> terminal batch sealed
```

No step grants implementation, model-execution, promotion, or project-mutation
authority.

## 2. Closed generation identity

`Dss04ServiceGeneration` identity is:

```text
service_generation
dss03_implementation_commit
dss03_semantic_candidate
dss03_result_schema_revision
dss04_contract_revision
compiler_build_pin_digest
compiler_invocation_contract_digest
compiler_environment_digest
compiler_receipt_normalization_revision
project_registry_root_digest
materializer_revision
materialization_policy_digest
canonical_serialization_revision
store_schema_revision
custody_key_revision
```

Every non-derived field above has one exact canonical value in the frozen
generation declaration. `service_generation` is the domain-separated digest
of the ordered name/value population of all the other fields; hashing field
names without their values is forbidden. Every durable DSS-0.4 object carries
that digest. Generation identity is immutable. A changed value opens a new
generation and cannot alias, resume, or replay an earlier one.

There is one canonical generation-identity object. The semantic-law tuple and
the durable `Dss04ServiceGeneration` carrier expose that same closed field/value
population and the same derived digest; neither is an independent assertion.
Missing, additional, reordered, or unequal advertised carrier values are
`STALE_GENERATION`, even when the semantic-law digest itself is unchanged.

The generation is `OPENING`, `RECOVERING`, `READY`, or `BROKEN`. Only `READY`
admits new work. `BROKEN` is terminal in DSS-0.4.

### 2.1 Owner-sealed contract-authority anchor

Before a DSS-0.4 candidate generation is constructed, the project owner seals
one immutable contract-authority anchor in a prior Git commit. The anchor is a
protected descriptor, not a declaration inside the candidate module. Its
payload fixes the complete service-generation identity, ratified DSS-0.3
predecessor envelope and authenticated source head, owner-issued validator
revision and ISSUE head, every ordered operation-input population, every
operation outcome/effect population, and the complete carrier-event and
qualified-transition relation.

The candidate records the exact anchor commit, artifact path, byte length,
SHA-256, domain-separated payload digest, owner, root, and `PINNED` standing.
Every authority latch and every population validator compares the candidate
against the separately loaded frozen anchor bytes. Equality among candidate-
local declarations, guards, projections, and recomputed digests is necessary
but never sufficient. Changing those local copies together cannot mint a new
generation, predecessor, validator, input population, event, transition, or
outcome.

The anchor has only `PINNED` and `BROKEN`. It cannot be rotated, replaced,
extended, or rewritten within DSS-0.4. Missing bytes, a different Git commit,
path rebinding, digest mismatch, owner/root mismatch, or any candidate/anchor
population difference yields `BROKEN` before evaluation with no effect. A
changed contract requires a newly owner-sealed anchor followed by a new
candidate generation; the candidate cannot reseal its own authority basis.

## 3. Externally constituted roots and pins

The owner installs an immutable `CompilerBuildPin` and
`ProjectRegistryRootPin` before the generation opens. Installation consumes an
owner-controlled protected descriptor and an exact prior commitment; a daemon
caller cannot choose either root or the commitment it is checked against.

The compiler pin binds:

```text
repository_commit
source_tree_digest
entrypoint_digest
interpreter_digest
dependency_lock_digest
installed_environment_digest
invocation_contract_digest
pattern_library_digest
learning_extension_digest
focus_library_digest
```

The project registry root binds the closed signer/key population, revision
schema, namespace, and permitted project identities. Empty, foreign, legacy,
fixture, substituted, or caller-created roots authorize nothing.

The DSS-0.3 input is an owner-issued sealed-result envelope, not an arbitrary
payload bearing a seal-shaped field. Its canonical identity binds the exact
DSS-0.3 service generation, promoted implementation commit, ratified semantic
candidate, result-schema revision, job/result identities, terminal result event
head, full result-population coverage digest, seal receipt digest, and sealing
owner revision. `accept-dss03-sealed-result` verifies the predecessor root,
receipt, coverage, and source standing `SEALED` at one latch. Missing,
unsealed, partially covered, foreign-owner, stale, or substituted inputs have
no accepting effect.

The acceptance latch compares the envelope and owner-issued receipt
field-for-field. The service generation, implementation commit, semantic
candidate, schema revision, job/result identities, terminal event head,
coverage digest, seal digest, receipt digest, sealing-owner revision, authority
owner/root, and actual source lifecycle head must all agree with the exact
ratified predecessor relation. A declaration that merely lists those fields,
or metadata saying `SEALED` while the source head is not `SEALED`, proves
nothing.

The authenticated predecessor lifecycle head is itself a durable joined input,
not metadata synthesized by DSS-0.4. Its digest commits the envelope identity,
owner/root, `SEAL` event, `SEALED` standing, predecessor terminal head, and
receipt digest. The operation guard must equal that actual head and the
carrier's authority owner/root exactly.

Both roots have only `ABSENT -> PINNED -> BROKEN`. Rotation, retirement,
replacement, revival, and historical rewrite are absent from this tranche.
Removal, unreadability, mismatch, or substitution produces `BROKEN` and blocks
readiness.

## 4. Immutable project and target inputs

`ProjectRegistryRevision` identity is:

```text
project_id
registry_revision
predecessor_digest
registry_root_digest
project_policy_digest
allowed_target_kinds_digest
allowed_compiler_profiles_digest
allowed_evidence_runtime_profiles_digest
signature_digest
```

It is admitted only after exact signature, predecessor, namespace, population,
and policy verification against the installed root. A mutable alias, branch,
tag, workspace name, or path is never a registry identity.

`TargetSnapshotReceipt` identity is:

```text
project_id
project_registry_revision_digest
target_revision
snapshot_root_digest
file_inventory_digest
executable_root_inventory_digest
language_inventory_digest
submodule_inventory_digest
lfs_inventory_digest
generated_input_inventory_digest
cartography_digest
snapshot_policy_digest
capture_tool_revision
capture_environment_digest
captured_at
```

The receipt enumerates every file and authority-bearing or executable root in
the governed project boundary. Each member binds canonical relative path,
object kind, mode, byte length, content digest, provenance, and container/root
membership. Symlink escapes, case aliases, Unicode aliases, path traversal,
unresolved submodules, LFS pointers without objects, and undeclared generated
inputs reject.

The immutable snapshot artifact population is content-addressed and
publish-before-reference. DSS-0.4 reads only those artifacts. It never
re-resolves the target revision or opens the live project path.

`ProjectEvidenceRuntimeRevision` identity is:

```text
project_id
project_registry_revision_digest
target_snapshot_receipt_digest
runtime_revision
evidence_source_catalog_digest
evidence_toolchain_digest
evidence_policy_digest
availability_snapshot_digest
isolation_profile_digest
environment_digest
```

Availability is explicit evidence. Missing or unavailable evidence is a typed
fact and never becomes an empty positive witness.

## 5. Compilation request and replay identity

`CompilationRequest` identity is:

```text
service_generation
request_id
dss03_result_seal_digest
project_registry_revision_digest
target_snapshot_receipt_digest
semantic_contract_module_digest
project_evidence_runtime_revision_digest
compiler_build_pin_digest
compiler_invocation_contract_digest
compiler_receipt_normalization_revision
compilation_profile_digest
requested_route_scope_digest
materialization_policy_digest
```

Every outcome-changing input is included. Exact retry returns the original
durable result and consumes no second reservation. Same `request_id` with any
changed semantic input returns `IDEMPOTENCY_CONFLICT` with zero state advance.

The requested route scope is a closed selection expressed in stable project
identities. Exhaustive compilation requires the complete discovered occurrence
population. A partial scope is permitted only when policy explicitly permits it
and the compiler proves occurrence closure for that selection.

## 6. Pinned compiler execution

`execute-pinned-compilation` consumes the exact current generation, request,
compiler pin, project registry revision, target snapshot, evidence runtime, and
snapshot artifact population. The request names exactly one admitted
`semantic-contract-module.v0` artifact by content digest. Before process start
the service verifies every pin, that module artifact, and the complete snapshot
population under one generation/readiness latch.

That ordered input population is fixed by the prior owner-sealed
contract-authority anchor. Editing the operation, the semantic declaration,
and all read-only projections together does not change the anchored
population and therefore rejects.

The compiler process receives a new empty working directory containing only
canonical materializations of declared snapshot artifacts and one immutable
request envelope. Network is disabled. Environment variables, inherited file
descriptors, credentials, user configuration, caches, mutable aliases, and
undeclared paths are absent. The executable, interpreter, dependencies,
environment, invocation arguments, and input population must match the pin.
The pinned learned-compiler entrypoint receives the immutable module artifact
as its declared input. Target-project source bytes, a Direct-local fixture, a
wrapper outside the pin, or a caller-selected program can never be the
entrypoint.

`CompilerProcessObservation` binds process identity, start/end monotonic times,
exit status, stdout/stderr byte counts and seals, resource accounting,
isolation observation, and the exact input/output custody digests. Process
success is evidence only; it is not output admission.

Raw compiler bytes are captured to private quarantine before parsing. They are
never authoritative compiler output and are not returned through a safe
projection.

## 7. Compiler-output admission and route closure

`admit-compiler-output` consumes the exact current generation, compiler pin,
request, process observation, target-snapshot receipt, and the request's exact
semantic-module artifact in addition to the quarantined bytes. It parses the
pinned compiler's deterministic JSON serialization, canonicalizes the parsed
receipt internally, and validates:

- exact generation and every compilation input digest;
- canonical serialization and content seal;
- compiler build, invocation, environment, and pattern-library identities;
- the exact `semantic-compilation-receipt.v0` field population, compiler
  identity/version, module identity/digest, pattern-library digest, verdict,
  reconciliation, obligation count/order, and static-remand population;
- obligation, route, input-fact, contact, evidence-demand, exclusion, and
  static-remand population counts and digests after the closed normalization
  relation below;
- unique stable identities and absence of aliases or duplicate occurrences;
- occurrence-level bidirectional reconciliation between discovered project
  effects and declared compiler contacts;
- explicit owner and authority provenance for every effect-bearing route;
- every exclusion against an owner-ratified non-reachability or semantic-
  irrelevance theorem;
- no path, project fact, authority, or evidence outside admitted inputs.

### 7.1 Closed compiler-receipt normalization

The pinned compiler emits proof obligations; it does not natively emit DSS-0.4
routes, occurrences, contacts, input facts, or evidence demands. Those
populations are constituted only by the owner-sealed
`Dss04CompilerReceiptNormalization.v2` relation. They are not inferred by a
fixture, adapter convention, model, caller, or implementation heuristic.

For one exact admitted learned-compiler receipt, normalization is a total,
deterministic function:

1. Each compiler obligation is copied field-for-field except that its `id`
   becomes `obligation_id`. Its canonical order remains compiler order.
2. Exactly one route and one contact occurrence are derived for each
   obligation. `route_id` commits the receipt digest and obligation row;
   `occurrence_id` commits the module digest, obligation identity, subject,
   pattern, template, and declared surface-reference population.
3. Exactly one input fact is derived for each obligation. It identifies the
   obligation subject and exact semantic-module digest; it grants no project
   fact beyond the compiler-declared subject.
4. Exactly one evidence demand is derived for every ordered
   `(route_id, required_evidence)` pair. Evidence objects are never accepted
   inline at this boundary; later materialization resolves each demand only
   through the admitted project-evidence runtime.
5. Exactly one contact joins each route to its occurrence. Missing, extra,
   duplicated, reordered, or cross-route contacts reject.
6. Each compiler-reconciled excluded surface must join exactly one exclusion
   in the semantic module with the same surface, owner, and nonempty theorem.
   The normalized exclusion commits that theorem. An unmatched exclusion is a
   typed remand and never an admitted route.
7. Compiler static remands are copied exactly and force `REMANDED`; they can
   never be normalized into admitted routes.

The relation fixes closed field populations and domain-separated digest
domains for the source receipt, normalized obligation rows, routes,
occurrences, input facts, contacts, evidence demands, exclusions, and static
remands. Route authority is always the declared `dss04-route-owner` under
`dss04-route-custody-root`; normalization cannot mint another owner or root.
The exact request scope, project identity, target-snapshot receipt, semantic-
module digest, compiler pin, normalization revision, and service generation
are copied from authenticated operation inputs into every applicable output
identity.

The normalized populations and their digests are recomputed at admission and
compared by exact ordered equality. Caller-supplied or compiler-supplied
`routes`, `contacts`, `input_facts`, `evidence_demands`, or normalized digests
are forbidden fields and cause `OUTPUT_REJECTED`; they never override the
function. Missing receipt fields, schema/version mismatch, module mismatch,
pattern mismatch, malformed obligations, duplicate IDs, count/order drift,
unclassified surfaces, or a normalization mismatch is `POPULATION_MISMATCH`
or `OUTPUT_REJECTED` with no positive effect.

Exact replay of the same source receipt and authenticated input tuple returns
the original normalized bundle and route set. Any changed receipt byte,
module, request, pin, snapshot, normalization revision, obligation,
reconciliation, theorem, or derived population conflicts or rejects. Recovery
recomputes the full normalization from the quarantined source receipt and
authenticated inputs; it never trusts a persisted disposition or derived row.
Recovery requires exact equality of `status`, `reason`, source-receipt digest,
authority effect, normalization receipt, and every obligation, route,
occurrence, input-fact, contact, evidence-demand, exclusion, and static-remand
population. A missing source receipt/module/input, unequal disposition or
recomputation, or orphan derived population blocks readiness. In particular,
a recomputed `REMANDED`/`TYPED_REMAND_ONLY` result can never recover from a
persisted `ADMITTED`/`NORMALIZED_POPULATIONS_ADMITTED` relabel.

The admitted `CompilerOutputBundle` is `UNPARSED`, `ADMITTED`, `REMANDED`, or
`REJECTED`. Schema/custody/identity failure is `REJECTED`. A compiler-declared
static remand or lawful known-insufficiency is `REMANDED`. Only a zero-static-
remand, fully reconciled bundle can become `ADMITTED`.

`CompilerOutputBundle` identity additionally binds the source-receipt digest,
normalization revision, input-fact population digest, and contact-occurrence
reconciliation digest. `CompiledRouteSet` identity additionally binds the
normalization-receipt digest and includes the complete route and occurrence
population digests, not only aggregate counts. A missing, extra, duplicated,
or reordered occurrence changes identity and rejects admission.

Compiler output cannot modify the compiler pin, project registry, snapshot,
evidence runtime, materialization policy, or its own authority.

## 8. Closed-page materialization

`MaterializationPlan` is deterministically derived from one admitted route set.
Its identity binds:

```text
compiler_output_bundle_digest
compiled_route_set_digest
ordered_route_population_digest
ordered_page_identity_population_digest
route_to_page_partition_digest
materialization_policy_digest
page_byte_budget
page_token_budget
evidence_byte_budget
```

Every admitted route belongs to exactly one page or to one explicit
non-materializable remand partition. No route is silently dropped, duplicated,
or split across pages without a declared composition relation.

A `ClosedEvidencePage` binds one page identity, route population, exact project
facts, exact source fragments, evidence objects, unavailable-evidence markers,
policy excerpts, predecessor receipts, authority context, and all byte/token
budgets. Every member refers to an immutable admitted snapshot or evidence
artifact by digest and bounded locator. No live lookup occurs during or after
materialization.

Page identity includes content bytes and semantic input populations. Two pages
with different project facts, route membership, evidence availability, policy,
or authority context cannot share identity.

Publication is CAS-first. Artifact verification precedes the transaction that
records the page reference, page event, derived heads, and idempotency binding.
No prepared reference can point to an absent or unverified object.

## 9. Completeness, sufficiency, and deterministic remand

`PageCompletenessReceipt` proves exact conservation:

```text
required route occurrences
= materialized route occurrences
+ explicitly remanded route occurrences
```

It also reconciles every required evidence demand to exactly one present
artifact, explicit unavailable marker, or typed policy-forbidden marker, with a
reverse map proving that every page member was demanded.

`PageSufficiencyReceipt` is distinct. Completeness does not imply sufficiency.
`project-closed-page` consumes the exact current `Dss04ServiceGeneration` at
the same read boundary as the page, completeness receipt, sufficiency receipt,
and batch seal. A stale page package therefore reaches `STALE_GENERATION`
before projection; currentness cannot be inferred from those artifacts alone.
Every outcome projection binds the complete ordered operation-input
population exactly. A subset projection, including one that omits the service
generation, is invalid rather than a lawful read-only outcome.
It evaluates the page against the exact worker task contract and proves either:

- `SUFFICIENT`: the page alone contains every fact and authority-neutral
  observation permitted to the later worker; or
- `KNOWN_INSUFFICIENT`: one or more exact demands are unavailable, forbidden,
  contradictory, stale, over budget, or outside the closed page.

`KNOWN_INSUFFICIENT` deterministically creates a
`KnownInsufficiencyRemand` before any worker compute. A remand names the exact
failed demands, policies, route occurrences, and evidence states. It cannot be
laundered into a sufficient page or advisory result.

No model, worker, heuristic score, majority, compiler process exit status, or
page byte presence can grant completeness or sufficiency.

## 10. Page-fault and novel-edge candidates

A later worker may submit a `PageFaultCandidate` or `NovelEdgeCandidate`, but
the candidate is an untrusted observation. Its identity binds the worker
runtime, task, attempt, page, route, claimed missing fact/edge, bounded rationale,
and source locator. It grants no project fact, compiler law, page mutation,
retry, or expanded visibility.

`validate-candidate-independently` runs only in a separately authorized DSS-0.4
validation lane. It consumes the current immutable snapshot, registry, evidence
runtime, compiler pin, candidate, and a validator revision distinct from the
worker runtime. Outcomes are `VALIDATED`, `REFUTED`, `STALE`, `OUT_OF_SCOPE`, or
`INCONCLUSIVE`.

The validator revision is read at the same validation latch and must have
durable lifecycle standing `ISSUED`. `UNSEEN` and `REVOKED` revisions produce a
non-authorizing stale/unauthorized outcome with no candidate-validation effect.

The guard is checked against the authenticated durable validator event head,
not against a static allowed-state list. The head binds the exact validator
revision, service generation, predecessor head, event, and resulting standing;
only `ISSUE: UNSEEN -> ISSUED` authorizes validation. Missing, stale, foreign,
or `REVOKE: ISSUED -> REVOKED` heads authorize nothing.

The validator revision has one closed owner-issued identity tuple containing
revision, build, policy, schema, issued-at, and service-generation values. Its
revision digest is recomputed from that tuple. The lifecycle-head digest is
then recomputed from the revision digest, continuity, owner, event, standing,
and service generation. Copying the same stale digest into both the carrier and
operation guard does not make it current.

Validation never mutates the frozen compilation or page. `VALIDATED` produces
an append-only candidate record for a future generation or owner review.
Recompilation requires a new request/generation under normal authority.

## 11. Batch terminality and sealing

Every planned page reaches exactly one terminal state:
`SUFFICIENT`, `KNOWN_INSUFFICIENT`, `REJECTED`, or `CANCELLED_PRESTART`.

`MaterializationBatchSeal` binds the exact planned population, every page event
head, every completeness/sufficiency/remand receipt, all candidate-validation
heads, accounting, and the terminal coverage digest. `seal-materialization-
batch` requires complete terminal coverage and CAS verification of every
referenced artifact.

The seal transaction records a `PREPARED` seal only after artifact publication
and verification, then atomically advances references and seal to `SEALED`.
Recovery may complete a valid prepared seal or block it; it cannot infer
completion from artifact existence, process success, partial receipts, or
aggregate counts.

## 12. Concurrency, leases, and cancellation

All authority-relevant writes use one SQLite transaction and compare exact
generation, predecessor event head, population digest, and fencing token.
Operations sharing a generation head, route population, page identity,
reservation, or seal serialize that invariant even when request keys differ.

Compilation and page materialization use durable allocations and bounded
leases. Expired or foreign leases authorize nothing. Exact replay converges;
changed work conflicts. Resource reservations cover raw bytes, admitted output,
page bytes/tokens, evidence bytes, page count, outstanding work, and quarantine.

Cancellation is prospective. Prestart cancellation may terminalize an
unstarted request/page under exact current DSS-0.2 authorization. Once compiler
or materializer execution starts, cancellation is a request whose race is
adjudicated against the durable terminal event. Cancellation cannot erase raw
custody, receipts, accounting, candidates, or event history.

Every qualified transition names the same owner as its owning operation.
Prior-state sources use only the closed values `OPERATION_INPUT`,
`CARRIER_INITIAL_STATE`, and
`CREATED_EARLIER_IN_SAME_ATOMIC_OPERATION`; a missing, legacy, or unknown value
is rejected before evaluation and is never normalized to an initial state.

The finite carrier-event, qualified-transition, operation-outcome, effect, and
outcome-binding populations are exact against the prior owner-sealed
contract-authority anchor. Candidate-local population digests are integrity
checks only: recomputing them after an event swap, transition rewrite, outcome
addition, or coordinated declaration edit never authorizes the mutation.

## 13. Recovery and readiness

Recovery begins with an exclusive SQLite-held writer lock and a closed durable
population enumeration. It validates generation/root pins, schema, custody
keys, CAS/quarantine objects, requests, idempotency bindings, compiler runs,
raw captures, admitted bundles, routes, plans, pages, receipts, remands,
candidates, validations, leases, accounting, seals, and event chains.

For every admitted or remanded compiler bundle, recovery also reloads the
quarantined pinned-compiler receipt and exact semantic-module artifact,
re-executes `Dss04CompilerReceiptNormalization.v2`, and requires field-for-
field equality of the complete disposition envelope and durable obligation,
route, occurrence, input-fact, contact, evidence-demand, exclusion, and
static-remand populations.

It rejects gaps, forks, cycles, duplicate genesis, stale generations, missing
outputs, orphan references, invalid custody tags, unknown rows, and projection
heads not exactly derivable from validated history.

Recovery classifies every nonterminal item:

```text
allocated but unstarted          -> ABANDONED_PRESTART
compiler started/no terminal     -> INTERRUPTED_COMPILATION
raw captured/not admitted        -> ADMISSION_PENDING
route set/no plan                -> PLANNING_PENDING
page allocated/not started       -> ABANDONED_PRESTART
materialization started/no event -> INTERRUPTED_MATERIALIZATION
page artifact/no receipt         -> RECEIPT_PENDING
complete/not sufficient          -> SUFFICIENCY_PENDING
terminal pages/no seal           -> SEAL_PENDING
prepared seal                    -> COMPLETE_OR_BLOCK_PREPARED_SEAL
sealed batch                     -> TERMINAL
```

Allocations and expired leases are released only through durable recovery
events. Derived projections are rebuilt, never trusted. The recovery latch
clears only after the complete population, event heads, idempotency indexes,
route/page partitions, terminal coverage, accounting, and seal state reconcile
and one `READY` event commits. Partial recovery is `BLOCKED`.

## 14. Closed failure algebra

Public and durable outcomes are limited to:

```text
ACCEPTED
REPLAYED
READY
ADMITTED
MATERIALIZED
COMPLETE
SUFFICIENT
KNOWN_INSUFFICIENT
REMANDED
VALIDATED
REFUTED
INCONCLUSIVE
STALE_GENERATION
STALE_PREDECESSOR
IDEMPOTENCY_CONFLICT
UNAUTHORIZED
PIN_MISMATCH
ROOT_BROKEN
SNAPSHOT_INVALID
EVIDENCE_RUNTIME_INVALID
ISOLATION_FAILED
COMPILER_FAILED
OUTPUT_REJECTED
POPULATION_MISMATCH
OVER_BUDGET
LEASE_CONFLICT
CANCELLED_PRESTART
CANCELLATION_REQUESTED
CANCELLATION_LOST_RACE
CORRUPT
BLOCKED
BROKEN
```

Rejecting, remanded, corrupt, blocked, stale, cancelled, refuted, or
inconclusive standing cannot bind an authorizing, admitted, sufficient, ready,
complete, or sealed outcome. Every lifecycle transition has one exact carrier,
owner operation, prior-state source, from/to states, and explicit nonempty
outcome set. No token match, list order, cross-output event, or fallback may
supply a transition or outcome.

Every operation input population is independently declared by the contract and
sealed as one ordered population before operation/output projections are
derived. Operation inputs, read-only projection inputs, custody joins, and the
declared population must be exactly equal; coordinated deletion or substitution
across the operation and its projections remains invalid.

Lifecycle reconciliation uses exact set equality. The declared carrier/event
population equals the transition carrier/event population, and each transition
relation binds its transition ID, carrier, event, operation, owner, prior-state
source, from/to states, and outcome cases. Each outcome binding names exactly
the complete matching transition-ID set—neither a subset nor a superset.

## 15. Required games

The tests-first semantic contract must execute at least these games:

1. exact compilation retry returns one result and one reservation;
2. changed compilation input under one request identity conflicts with no effect;
3. caller-selected or substituted compiler root grants nothing;
4. changed compiler source, entrypoint, interpreter, lock, environment, or invocation rejects;
5. a mutable compiler alias cannot enter a request;
6. a mutable project alias or live path cannot enter a snapshot;
7. symlink escape, case/Unicode alias, traversal, unresolved submodule, missing LFS object, or undeclared generated input rejects;
8. a snapshot missing one executable root fails discovery closure;
9. a hidden wrapper/launcher effect fails transitive effect closure;
10. a declared contact without an occurrence and an occurrence without a contact both reject;
11. an exclusion without a true theorem rejects;
12. changed evidence availability changes evidence-runtime identity;
13. unavailable evidence is explicit and never a positive witness;
14. compiler isolation exposes no network, credentials, user configuration, cache, or undeclared file;
15. process success without admitted output grants nothing;
16. malformed, noncanonical, foreign, stale, duplicate, or population-drifting compiler output rejects;
17. static remand output cannot become admitted routes;
18. route counts matching while occurrence identity differs rejects;
19. every route is mapped once to a page or explicit remand;
20. different page semantic inputs cannot share an identity;
21. page publication cannot leave a durable reference to a missing artifact;
22. completeness with unavailable evidence does not imply sufficiency;
23. known insufficiency remands before any worker compute;
24. a remanded page cannot be sealed as sufficient;
25. worker page-fault and novel-edge assertions grant no fact, retry, or visibility;
26. candidate validation uses current independent authority and preserves frozen pages;
27. stale candidate validation cannot become validated;
28. batch sealing requires exact terminal page coverage and every referenced artifact;
29. crash at each publish/transaction/seal boundary reconstructs without false completion;
30. concurrent identical work converges and conflicting work rejects;
31. cross-key work sharing a generation head or population serializes;
32. expired/foreign leases authorize nothing and recovery releases them durably;
33. cancellation races preserve terminal history, raw custody, receipts, and accounting;
34. recovery rejects gaps, forks, cycles, duplicate genesis, missing outputs, orphan rows, and bad custody;
35. recovery cannot reach READY with any request, route, page, receipt, candidate, lease, or seal population omitted;
36. projection loss rebuilds exactly from durable history;
37. `REJECTED`, `REMANDED`, `BLOCKED`, `CORRUPT`, and `STALE` cannot bind positive outcomes;
38. deleting or adding one lifecycle/outcome binding fails population reconciliation;
39. DSS-0.4 performs no model/provider call and mutates no target repository;
40. DSS-0.5/DSS-0.6 surfaces remain absent and authority-neutral.
41. the exact pinned learned-compiler receipt deterministically normalizes one
    route, contact, and input fact per obligation and one demand per required
    evidence member;
42. exact receipt normalization replay is byte-identical and consumes no new
    reservation;
43. a changed, reordered, missing, extra, or duplicate obligation changes the
    affected identities or rejects;
44. caller/compiler supplied routes, contacts, input facts, evidence demands,
    or normalized digests reject rather than override the closed function;
45. module identity/digest mismatch, missing semantic-module artifact, wrong
    compiler schema/version/pattern digest, or stale normalization revision
    rejects with no admitted route;
46. every excluded surface joins exactly one owner theorem; a missing,
    substituted, or extra theorem remands or rejects;
47. a static-remand receipt cannot produce an admitted bundle or route set;
48. recovery blocks when any persisted normalized member or digest differs
    from exact recomputation.
49. recovery blocks when persisted normalization status, reason, source-
    receipt digest, or authority effect differs from exact recomputation;
    unchanged normalized rows cannot launder `REMANDED` into `ADMITTED`.

## 16. Handoff condition

The slice is semantically complete only when:

- the full compiler-informed declaration compiles with zero static remands;
- every emitted known-edge obligation has a generation-bound drafter
  disposition, exact evidence locator/digest, applicability reasoning, and
  positive and negative neighbor for the same law;
- every compiler-caused drafting repair is recorded from failing draft/check to
  repair and passing check;
- every carrier event and operation outcome reconciles through exact qualified
  transitions;
- the 48 required games execute over the frozen declaration;
- the candidate, compiler receipts, witnesses, tests, ledgers, surface
  partition, and manifest are frozen together;
- an independent semantic-spec audit seals `PASS_AND_UNLOCK` over that exact
  generation.

Until then implementation, merge, promotion, commissioning, activation, DSS-0.5,
and DSS-0.6 authority remain withheld.

## 17. Project surface

```text
DSS04_SURFACE policy.dss-v0-constitution POLICY dss-v0-owner
DSS04_SURFACE policy.dss03-ratified-contract POLICY dss03-owner
DSS04_SURFACE policy.dss04-implementation-contract POLICY dss04-candidate-owner
DSS04_SURFACE policy.compiler-build-pin POLICY dss04-installation-owner
DSS04_SURFACE policy.project-registry POLICY dss04-project-registry-owner
DSS04_SURFACE policy.materialization-policy POLICY dss04-materializer-owner
DSS04_SURFACE source.dss03-sealed-results SOURCE dss03-sealing-owner
DSS04_SURFACE source.owner-compiler-root SOURCE dss04-installation-owner
DSS04_SURFACE source.owner-project-registry-root SOURCE dss04-installation-owner
DSS04_SURFACE source.target-snapshot-artifacts SOURCE dss04-snapshot-owner
DSS04_SURFACE source.project-evidence-artifacts SOURCE dss04-evidence-runtime-owner
DSS04_SURFACE source.compiler-process-observations SOURCE dss04-compiler-runtime-owner
DSS04_SURFACE source.worker-candidate-channel SOURCE dss05-worker-owner
DSS04_SURFACE object.dss04-service-generation PERSISTED_OBJECT dss04-store-owner
DSS04_SURFACE object.compiler-build-pin PERSISTED_OBJECT dss04-installation-owner
DSS04_SURFACE object.project-registry-root-pin PERSISTED_OBJECT dss04-installation-owner
DSS04_SURFACE object.project-registry-revision PERSISTED_OBJECT dss04-project-registry-owner
DSS04_SURFACE object.target-snapshot-receipt PERSISTED_OBJECT dss04-snapshot-owner
DSS04_SURFACE object.target-snapshot-artifact PERSISTED_OBJECT dss04-snapshot-owner
DSS04_SURFACE object.project-evidence-runtime-revision PERSISTED_OBJECT dss04-evidence-runtime-owner
DSS04_SURFACE object.compilation-request PERSISTED_OBJECT dss04-compilation-owner
DSS04_SURFACE object.compilation-idempotency-binding PERSISTED_OBJECT dss04-compilation-owner
DSS04_SURFACE object.compiler-process-observation PERSISTED_OBJECT dss04-compiler-runtime-owner
DSS04_SURFACE object.raw-compiler-output PERSISTED_OBJECT dss04-quarantine-owner
DSS04_SURFACE object.compiler-output-bundle PERSISTED_OBJECT dss04-output-admission-owner
DSS04_SURFACE object.compiled-route-set PERSISTED_OBJECT dss04-route-owner
DSS04_SURFACE object.materialization-plan PERSISTED_OBJECT dss04-materializer-owner
DSS04_SURFACE object.closed-evidence-page PERSISTED_OBJECT dss04-materializer-owner
DSS04_SURFACE object.page-completeness-receipt PERSISTED_OBJECT dss04-completeness-owner
DSS04_SURFACE object.page-sufficiency-receipt PERSISTED_OBJECT dss04-sufficiency-owner
DSS04_SURFACE object.known-insufficiency-remand PERSISTED_OBJECT dss04-remand-owner
DSS04_SURFACE object.page-fault-candidate PERSISTED_OBJECT dss04-candidate-owner
DSS04_SURFACE object.novel-edge-candidate PERSISTED_OBJECT dss04-candidate-owner
DSS04_SURFACE object.candidate-validation-record PERSISTED_OBJECT dss04-candidate-validation-owner
DSS04_SURFACE object.materialization-batch-seal PERSISTED_OBJECT dss04-sealing-owner
DSS04_SURFACE object.dss04-recovery-disposition PERSISTED_OBJECT dss04-recovery-owner
DSS04_SURFACE object.dss04-event-ledger PERSISTED_OBJECT dss04-event-owner
DSS04_SURFACE object.dss04-derived-heads PERSISTED_OBJECT dss04-reducer-owner
DSS04_SURFACE object.dss04-allocation PERSISTED_OBJECT dss04-scheduler-owner
DSS04_SURFACE object.dss04-lease PERSISTED_OBJECT dss04-scheduler-owner
DSS04_SURFACE object.dss04-accounting PERSISTED_OBJECT dss04-accounting-owner
DSS04_SURFACE grant.dss04-administration AUTHORITY_GRANT dss04-installation-owner
DSS04_SURFACE grant.compilation-request AUTHORITY_GRANT dss03-authority-owner
DSS04_SURFACE grant.pinned-compiler-execution AUTHORITY_GRANT dss04-compiler-runtime-owner
DSS04_SURFACE grant.materialization AUTHORITY_GRANT dss04-materializer-owner
DSS04_SURFACE grant.candidate-validation AUTHORITY_GRANT dss04-candidate-validation-owner
DSS04_SURFACE grant.dss04-cancellation AUTHORITY_GRANT dss03-authority-owner
DSS04_SURFACE interface.dss03-result-handoff EXTERNAL_INTERFACE dss04-compilation-owner
DSS04_SURFACE interface.dss04-closed-page-projection EXTERNAL_INTERFACE dss05-worker-owner
DSS04_SURFACE interface.dss04-candidate-intake EXTERNAL_INTERFACE dss04-candidate-owner
DSS04_SURFACE operation.open-dss04-generation OPERATION dss04-store-owner
DSS04_SURFACE operation.install-compiler-build-pin OPERATION dss04-installation-owner
DSS04_SURFACE operation.install-project-registry-root-pin OPERATION dss04-installation-owner
DSS04_SURFACE operation.admit-project-registry-revision OPERATION dss04-project-registry-owner
DSS04_SURFACE operation.admit-target-snapshot OPERATION dss04-snapshot-owner
DSS04_SURFACE operation.admit-project-evidence-runtime OPERATION dss04-evidence-runtime-owner
DSS04_SURFACE operation.accept-dss03-sealed-result OPERATION dss04-compilation-owner
DSS04_SURFACE operation.submit-compilation-request OPERATION dss04-compilation-owner
DSS04_SURFACE operation.allocate-dss04-work OPERATION dss04-scheduler-owner
DSS04_SURFACE operation.acquire-dss04-lease OPERATION dss04-scheduler-owner
DSS04_SURFACE operation.execute-pinned-compilation OPERATION dss04-compiler-runtime-owner
DSS04_SURFACE operation.capture-compiler-output OPERATION dss04-quarantine-owner
DSS04_SURFACE operation.admit-compiler-output OPERATION dss04-output-admission-owner
DSS04_SURFACE operation.instantiate-materialization-plan OPERATION dss04-materializer-owner
DSS04_SURFACE operation.materialize-closed-page OPERATION dss04-materializer-owner
DSS04_SURFACE operation.evaluate-page-completeness OPERATION dss04-completeness-owner
DSS04_SURFACE operation.evaluate-page-sufficiency OPERATION dss04-sufficiency-owner
DSS04_SURFACE operation.issue-known-insufficiency-remand OPERATION dss04-remand-owner
DSS04_SURFACE operation.submit-page-fault-candidate OPERATION dss04-candidate-owner
DSS04_SURFACE operation.submit-novel-edge-candidate OPERATION dss04-candidate-owner
DSS04_SURFACE operation.validate-candidate-independently OPERATION dss04-candidate-validation-owner
DSS04_SURFACE operation.seal-materialization-batch OPERATION dss04-sealing-owner
DSS04_SURFACE operation.request-dss04-cancellation OPERATION dss04-cancellation-owner
DSS04_SURFACE operation.adjudicate-dss04-cancellation OPERATION dss04-cancellation-owner
DSS04_SURFACE operation.record-dss04-accounting OPERATION dss04-accounting-owner
DSS04_SURFACE operation.release-dss04-lease OPERATION dss04-scheduler-owner
DSS04_SURFACE operation.recover-dss04-generation OPERATION dss04-recovery-owner
DSS04_SURFACE operation.project-closed-page OPERATION dss04-projection-owner
DSS04_SURFACE mutation.dss04-event-transaction MUTATION_PATH dss04-event-owner
DSS04_SURFACE mutation.compiler-output-admission MUTATION_PATH dss04-output-admission-owner
DSS04_SURFACE mutation.page-publish-before-reference MUTATION_PATH dss04-materializer-owner
DSS04_SURFACE mutation.route-page-partition-transaction MUTATION_PATH dss04-materializer-owner
DSS04_SURFACE mutation.receipt-adjudication-transaction MUTATION_PATH dss04-sufficiency-owner
DSS04_SURFACE mutation.candidate-validation-transaction MUTATION_PATH dss04-candidate-validation-owner
DSS04_SURFACE mutation.batch-seal-transaction MUTATION_PATH dss04-sealing-owner
DSS04_SURFACE mutation.recovery-classification-transaction MUTATION_PATH dss04-recovery-owner
DSS04_SURFACE clock.dss04-service-generation CLOCK dss04-store-owner
DSS04_SURFACE clock.compiler-runtime CLOCK dss04-compiler-runtime-owner
DSS04_SURFACE clock.snapshot-capture CLOCK dss04-snapshot-owner
DSS04_SURFACE consumer.dss03-sealed-results CONSUMER dss04-compilation-owner
DSS04_SURFACE consumer.future-dss05-closed-page-worker CONSUMER dss05-owner
DSS04_SURFACE consumer.future-dss06-ui-handoff CONSUMER dss06-owner
```
