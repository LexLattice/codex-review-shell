# Direct Active Sub-Agent Policy

Status: implemented Direct Workbench slice, 2026-08-23.

## Purpose

Statements such as:

> From now on, use Sol high workers for implementation instead of Luna max.

are policy mutations, not conversational trivia. Direct persists them as typed,
revisioned objects and resolves future child launches mechanically. The resident
model no longer has to keep rediscovering the rule in a generic context bucket.

This institution sits above the existing workspace-worker delegation and tool
authority policies. It selects a child realization; it does not grant workspace,
remote-mutation, tool, or canonical-worldstate authority.

## Canonical objects

The durable store owns:

- `direct_active_sub_agent_policy@1` revisions;
- `direct_active_sub_agent_policy_semantic_settlement@1` decisions;
- `direct_active_sub_agent_spawn_decision@1` launch-time resolutions;
- `direct_active_sub_agent_policy_exception@1` one-use deviation witnesses;
- `direct_active_sub_agent_policy_projection@1` renderer/self-constitution
  views.

A policy has exact scope, provenance, revision, role bindings, a concurrency
cap, inheritance law, deviation law, and update authority. Role bindings may
declare any subset of:

```text
provider
model
reasoning effort
context handoff
workspace realization
workspace tool profile
```

Unspecified dimensions inherit the explicit request and then the parent
runtime. Exact task policy precedes project policy; exact role precedes `*`.
Concurrency is counted at the policy's own scope: across one task for a task
policy and across all active project children for a project policy.
An admitted revision can explicitly clear earlier governed dimensions back to
inheritance and can set the policy cap to zero to delegate concurrency to the
native runtime.

## Semantic admission

Every Direct implementation-lane user utterance is projected to the
harness-owned `semantic_router` constitutional meta-role. It must discharge
exactly one typed action:

```text
no policy change
propose policy update
request policy clarification
```

The meta-role receives bounded policy state and the current utterance. It has
no launch, workspace, remote, policy-admission, or canonical-worldstate
authority. The user utterance supplies authority; the harness validates and
admits the proposed fields with compare-and-swap revision semantics.

Raw user text and raw provider payloads are not stored in the policy ledger.
The persisted settlement contains the typed result, concise rationale,
constitutional invocation lineage, realization-policy lineage, and telemetry.

The Policy panel also exposes a natural-language editor. Its region fixes task
or project scope, so indexical statements can remain concise while the same
semantic router settles content. Policy mutation is blocked while a project
turn is active.

## Spawn resolution

`spawn_agent` normally needs only a bounded task name, task description, and
semantic role. Before the native pool sees a launch:

```text
requested role/task
  -> exact task/project policy lookup
  -> exact role/wildcard binding
  -> mechanical inherited-dimension closure
  -> concurrency and deviation checks
  -> trusted launch decision
  -> native pool revalidation
```

If no policy exists, launch fails closed with
`direct_active_sub_agent_policy_unsettled`. Self-constitution tells the
resident to ask the user to establish policy instead of inventing defaults.

An explicit mismatch is never silent. It requires a semantic reason and one of:

- `one_time_exception`: allowed only when the active policy delegates that
  authority to the resident; a durable exception receipt is recorded;
- `propose_policy_update`: blocks the launch until the normal semantic
  admission path changes policy. The harness persists a candidate-only update
  request with the deviations, reason, and required authority; it grants no
  launch authority and changes no policy revision.

The native pool accepts policy-governed launches only with the exact in-process
decision issued by the active-policy service. A serialized or renderer-forged
copy is rejected. Launch and status projections retain the policy and decision
references.

## Self-constitution and UX

The owner-issued `direct_self_constitution_snapshot@1` now contains the current
policy state, effective scope, role bindings, concurrency limit, deviation law,
and latest clarification. Provider prose is compiled from that object.

The existing Direct Runtime Inspector `Policy` tab now shows:

- the older read-only implementation policy;
- current active sub-agent policy and source scope;
- role-to-realization bindings;
- task/project semantic policy editor;
- admitted revision history and latest settlement;
- the no-silent-override authority boundary.

## Verification

Run:

```bash
npm run direct:active-sub-agent-policy
npm run direct:role-lane-tool-bundle-composer
npm run direct:self-constitution
npm run direct:native-agent-pool
```

The focused regression covers missing-policy fail-closed behavior, semantic
no-change and admission, task/project inheritance, role realization closure,
reasoned deviations, durable exception witnesses, native-pool enforcement,
forged-decision rejection, constitutional meta-role isolation, and raw-text
non-retention.

## Deferred extensions

- WorldManager-delegated permanent policy admission;
- a structured comparison/revision UX in addition to natural language;
- richer policy conflict and exception graphs;
- mechanically generated provider/model catalog constraints instead of the
  current Direct-supported provider set;
- per-action runtime receipts projected into the policy panel.
