# Direct Epistemic Context Delivery

Status: DW-EPI2 implementation contract

## Purpose

The ArcAGI3 epistemic pilot can observe repository and Direct-thread O, maintain
typed E revisions, expose revisioned semantic ports, and materialize immutable
purpose-sensitive context results. Those results are currently local previews.

DW-EPI2 closes exactly one loop:

```text
typed repository or thread state
  -> immutable context import
  -> exact next-turn admission
  -> Direct context-pack compilation
  -> provider request attempt
  -> durable transport-attempt evidence
```

This is not ambient memory, automatic semantic retrieval, worker-requested
context, or a new provider prompt path. It is a top-down, one-shot affordance
compiled through the existing Direct context-pack and request-manifest path.

## Semantic objects

### Existing materialization receipt

`direct_epistemic_context_result@1` remains the immutable result of selecting
one exact subject, O revision, E revision, semantic port, purpose, facet set,
freshness posture, and raw-evidence policy.

Materialization does not imply admission or delivery.

### ContextDeliveryAdmission

`direct_epistemic_context_delivery_admission@1` binds:

```text
project
exact context-import ref
exact subject / O / E / port refs
target Direct session
target role lane
target WorkThread when present
one-shot delivery policy
operator/higher-layer request identity
```

The admission contains no renderer-supplied prompt body and grants no tool,
workspace, policy, or canonical-world authority.

Only one undelivered admission may be current for a target Direct session. A
new explicit admission supersedes the older undelivered admission visibly.

### ContextDeliveryEvent

`direct_epistemic_context_delivery_event@1` is an append-only, digest-linked
lifecycle event. The first slice uses:

```text
requested
  -> admitted
  -> claimed_for_turn
  -> prepared_for_provider
  -> provider_transport_attempted
```

Terminal alternatives are:

```text
stale
superseded
failed
```

`prepared_for_provider` means the exact projection is present in a persisted
context pack and request manifest. It does not mean the provider received it.

`provider_transport_attempted` is written on the first provider request attempt,
immediately before the fetch is issued. It proves that the exact persisted
projection reached the provider transport boundary. It does **not** prove remote
receipt or acceptance, and it does not imply a response, successful task
outcome, or canonical admission.

### ContextDeliveryProjection

`direct_epistemic_context_delivery_projection@1` is the app-private provider
projection compiled from the admitted import. It contains:

- exact admission/import/subject/O/E/port/record references;
- the selected port purpose and non-authoritative request intent;
- typed records with standing, attribution, predicate, and bounded payload;
- explicit omissions;
- a standing law stating that attributed interpretations remain attributed;
- an explicit statement that the projection grants no authority.

The provider receives this projection as quoted evidence through the existing
Direct context pack. The renderer may select an exact materialized import, but
may not supply or edit the projection text.

## Admission and delivery law

Admission fails closed unless all of the following remain true:

1. the target session belongs to the active project;
2. the import id and digest resolve exactly;
3. the import subject belongs to the active project;
4. the subject O and E heads still equal the import refs;
5. the port ref remains the subject's current port id and digest for the
   imported purpose;
6. the target session role lane and WorkThread still match the admission;
7. the import uses `freshness=exact`, `detailDepth=typed_records`, and
   `rawEvidencePolicy=references_only`;
8. attributed records do not claim epistemic promotion;
9. the bounded provider projection passes Direct raw-exposure checks;
10. the admission has not already been consumed by another turn.

The worker does not request this context. From its perspective, the admitted
projection is part of its initial environment. Active communication remains
top-down; evidence flows upward passively through persisted events.

## Provider-context placement

The existing Direct context pack remains the only compiler:

```text
harness policy
  -> compiled role/world policy when present
  -> historical evidence when selected
  -> admitted epistemic context as quoted evidence
  -> current user intent
```

The provider request manifest records the exact admission, import, O/E, port,
projection, and request-manifest bindings. No raw provider body is persisted.

## Workbench projection

### Run stance

```yaml
task_mode: implementation
execution_mode: standard
grounding:
  doctrine: borrowed
  reference_family: borrowed
  host_repo: repo_grounded
  implementation: static_inspected
  runtime: observed
profile_lineage:
  base_profile: artifact_inspector_reference
  derivative_profile: direct_epistemic_delivery_inspector
  profile_status: validated_local
```

### Source pack

```yaml
host_sources:
  - src/renderer/codex-surface.js
  - src/renderer/codex-surface.css
  - src/renderer/t3-direct-surface.html
  - src/preload-codex-surface.js
  - src/main.js
  - src/main/direct/controller/live-text-controller.js
  - src/main/direct/thread/context-pack.js
  - src/main/direct/epistemic/service.js
  - src/main/direct/epistemic/store.js
related_specs:
  - docs/DIRECT_ARCAGI3_EPISTEMIC_ORCHESTRATION_PILOT_SPEC.md
runtime_observations:
  - scripts/direct-t3-alternate-gui-electron-smoke.mjs
  - admitted state remains visibly distinct from provider-transport witness
```

The existing Epistemic inspector remains the workbench root. Repository/thread
ports and the materialized record preview remain the evidence lane. A distinct
next-turn handoff section is the commit-adjacent lane:

```text
preview evidence
  -> exact target task and role witness
  -> Admit for next Direct turn
  -> admitted / claimed / prepared / provider-transport-attempted state
```

The action does not look like successful remote receipt. `admitted`, `prepared`,
`provider_transport_attempted`, `stale`, `superseded`, and `failed` remain
visibly distinct.
Evidence stays in the same drawer context before admission. Narrow layouts keep
the same vertical order; no route transition hides the evidence.

## First-slice boundaries

Included:

- one exact context import per initial Direct turn;
- normal Direct assistant, compiled manager, and worker sessions through the
  shared context-pack seam;
- restart-safe pending admissions;
- interrupted claim/preparation recovery;
- runtime closure aborts active Direct requests and prevents late transport
  from recreating the epistemic service;
- renderer-safe lifecycle status;
- deterministic provider-body A/B proof.

Deferred:

- automatic semantic selection from the current user message;
- worker-invoked `IMPORT_CONTEXT`;
- bundles containing several imports;
- re-delivery on fresh-request tool continuations;
- incremental observer subscriptions;
- higher-order auditor dispatch;
- evaluation claims about task quality from a mocked provider run.

## Verification matrix

Positive evidence:

1. a materialized ArcAGI3 port can be admitted to an exact Direct session;
2. the next turn consumes it once;
3. the persisted context pack and request manifest cite the exact admission and
   import;
4. the provider body contains the quoted typed projection while an otherwise
   identical baseline body does not;
5. attributed statements remain explicitly attributed;
6. the first request attempt writes `provider_transport_attempted`;
7. restart preserves an unconsumed admission.

Negative evidence:

1. wrong-project target session;
2. import id/digest mismatch;
3. stale O or E head;
4. current semantic-port id or digest drift with unchanged O/E heads;
5. role-lane or WorkThread drift;
6. duplicate consumption;
7. renderer-supplied projection text;
8. raw path or secret exposure in generated context text;
9. interrupted claimed/prepared delivery;
10. context-pack or request-manifest persistence failure before transport.

The acceptance claim is deliberately narrow:

> Direct can deliver one exact, purpose-bound epistemic projection to one exact
> initial provider turn with durable lineage and fail-closed freshness. It does
> not yet choose context autonomously or prove that the context improved the
> task outcome.
