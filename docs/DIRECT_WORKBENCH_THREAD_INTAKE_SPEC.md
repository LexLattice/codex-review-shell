# Direct Workbench Thread Intake

Status: DW-I1 implemented and headless-observed, 2026-08-11.

## Purpose

Direct Workbench admits two operationally distinct ways to continue from a
Codex transcript without borrowing WorldManager semantics:

```text
resume_original_thread
  preserve the provider-owned conversation identity

transplant_into_fresh_direct_thread
  create a new Direct identity from read-only, provenance-bearing context
```

They share transcript discovery and evidence display. They do not share
identity effects or runtime eligibility.

## Controlling Utility And Topology

The active Direct task remains the controlling utility. Thread intake is an
evidence/action dock beside the transcript, not a new control plane:

```text
thread directory | active Direct transcript | thread intake evidence dock
                                      utility rail selects the visible dock
```

The dock exposes the project substrate, source standing, provider identity,
workspace settlement, active runtime, blockers, and the two possible identity
dispositions before either action is available.

## Typed Intake Projection

The main process owns `direct_thread_intake_projection@1`. Its renderer-safe
projection includes:

- source identity and import standing without raw paths or raw records;
- the project-level WSL, Windows, or local substrate binding;
- current runtime capabilities owned by the main process;
- workspace-match evidence;
- eligibility and blocker codes for each intake mode;
- an explicit authority boundary.

The renderer displays that projection and requests a transition. It cannot
assert runtime support, workspace identity, or imported authority.

## Resume Original Thread

This mode is eligible only when:

- a durable provider thread identity exists;
- the active runtime is bound to the selected project;
- the project is using App Server;
- the provider exposes thread resume;
- no active turn would be displaced.

Execution reuses the existing hybrid thread-open path. The provider verifies
the thread at execution time. No new conversation identity is created.

The internal import `threadId` is not sufficient evidence for this action. A
source must carry a distinct durable `providerThreadId` with provenance from a
source record or an explicit provider-identity adapter. Digest-derived local
import IDs therefore cannot enable provider resume.

## Continue As A Fresh Direct Thread

This mode is eligible only when:

- the source is a materialized read-only import;
- checkpoint validation succeeded;
- workspace match is high confidence or explicitly confirmed;
- the active Direct runtime is bound to the project;
- the admitted checkpoint continuation request shape remains available.

The resulting session receives `direct_thread_intake_lineage@1`, creates a new
Direct conversation identity, and inherits the project's declared substrate.
The source transcript remains read-only evidence.

## Authority Boundary

Neither mode performs WorldManager admission. A fresh continuation never
inherits:

- source approvals;
- source tool authority or replay permission;
- source system/developer policy authority;
- canonical worldstate standing.

The intake projection also excludes raw paths, raw transcript records, source
hashes, and authentication material from the renderer contract.

## Runtime Promotion

The production Direct import controller binds the previously observed RUG-008
provider-promotion evidence
`rug008_import_checkpoint_continuation_live_20260518`. Admission requires an
exact match over auth mode, hashed account identity, endpoint class and hash,
model, profile identity/version, seed builder, request builder, and request
shape. Raw account and endpoint values are not projected. Any discriminator
change fails closed with `checkpoint_promotion_scope_mismatch`.

The manual `CODEX_DIRECT_IMPORT_CHECKPOINT_PROBE=1` bootstrap remains available
for new or changed provider scopes; it is no longer required for the exact
promoted production scope.

## Verification

```text
npm run direct:thread-intake
npm run direct:import-checkpoint-continuation -- --mode fixture
npm run direct:t3-alternate-gui
npm run direct:t3-alternate-gui:electron
npm run direct:experience-split
npm run check:main-syntax
```

The focused matrix covers App Server/Direct and Windows/WSL bindings, source
selection versus materialization, mode eligibility, lineage, and renderer
privacy/authority invariants. The Electron smoke opens the intake dock in the
real Direct Workbench, proves exclusive right-dock selection, inspects the
project substrate witness and both mode cards, and records a screenshot.

## Deferred

- semantic ingestion of external threads into WorldManager worldstate;
- additional provider-specific durable-resume adapters;
- cross-machine transcript acquisition and substrate port operations;
- richer source search/filtering when project import inventories grow.
