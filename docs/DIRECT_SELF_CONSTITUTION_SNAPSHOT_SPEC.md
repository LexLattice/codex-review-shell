# Direct Self-Constitution Snapshot

Status: implemented first slice, 2026-08-23.

## Problem

An agent must not reconstruct its current role, workspace, authority, provider
readiness, or tool jurisdiction from generic prose. That prose can become stale
while the actual harness binding changes. The resulting model inference may be
internally reasonable and still false because its constitutional premise was
false.

The concrete failure that motivated this slice was a Direct resident agent
describing its persistent WSL project checkout as a disposable workspace. The
statement came from a hard-coded transport instruction, not from current
runtime state.

## Owner and authority

`SelfConstitutionSnapshot` is a read-only object owned and compiled by the
Direct harness. It is current self-knowledge, not model-authored biography.

```text
authoritative harness state
  -> SelfConstitutionSnapshot
  -> provider instruction projection
  -> optional inspect_self_constitution result
  -> human/model-readable explanation
```

The prompt text and tool result are projections of the typed object. They do
not independently define the constitution.

## Canonical object

The first implemented schema is `direct_self_constitution_snapshot@1` and
contains:

- agent identity, role lane, project, work thread, session, turn, model, and
  reasoning effort;
- substrate and workspace binding, including persistence and isolation;
- potential role capabilities, tools declared for the current turn, runtime
  availability, per-call authority, and enactment state;
- primary and child-provider readiness;
- child-agent capacity and context-handoff independence;
- compiled-context and request-manifest references where available;
- currentness, source evidence, privacy flags, and a canonical digest.

Raw workspace paths, credentials, secrets, provider payloads, and private
reasoning are excluded.

## Capability lattice

The snapshot preserves four different questions:

```text
potential
  Is the capability part of the role's catalog?

selected / declared this turn
  Did the harness put it on this provider request?

authorized
  Has the required per-call gate been satisfied?

executed
  Is there runtime evidence that the operation occurred?
```

The standing laws are:

```text
potential does not imply selected
selected does not imply authorized
authorized does not imply executed
```

Blocked, unavailable, operator-gated, stale, and not-selected states remain
distinct rather than collapsing into a Boolean capability claim.

## Workspace semantics

The first slice represents three bindings:

- `persistent_project_checkout`: the Direct Workbench project checkout,
  persistent across turns and app restarts;
- `isolated_worktree`: a child-specific Git worktree retained according to the
  workspace-worker lifecycle;
- `reasoning_only`: no workspace binding.

Tool declarations use the neutral phrase "current constitution-bound project
workspace." They no longer claim that every Direct workspace is disposable.

## Provider delivery

Every implementation-lane request receives a compact authoritative projection
compiled from the same snapshot persisted on its Direct turn. The request shape
records the snapshot id, digest, binding kind, substrate, declared-tool count,
owner, and raw-exposure posture.

The resident read-only tool:

```text
inspect_self_constitution {}
```

recompiles current runtime/provider/capacity facts, links the new revision to
the turn's prior snapshot, and returns a typed result envelope. Calling it
grants no authority and performs no workspace or canonical semantic mutation.

## Failure classification

The object makes three bug classes independently testable:

- model/conformance failure: the self-report disagrees with a valid snapshot;
- harness constitutional failure: the snapshot disagrees with runtime truth;
- schema completeness failure: current runtime truth cannot be represented.

## Verification

Run:

```bash
npm run direct:self-constitution
npm run direct:role-lane-tool-bundle-composer
```

The focused regression proves persistent WSL and isolated-worktree bindings,
capability-state separation, safe provider projection, digest lineage, the
read-only inspection envelope, and removal of raw private paths and stale
disposable-workspace prose.

## Deferred extensions

- Surface the snapshot and revision lineage in the optional Observations pane.
- Attach enacted authority receipts and tool-result evidence to capability rows
  across multi-step turns.
- Compile the same object for every isolated workspace-worker turn rather than
  only representing that binding in the shared compiler.
- Add an independent runtime witness that compares the compiled substrate
  binding against the workspace backend immediately before each mutation.
