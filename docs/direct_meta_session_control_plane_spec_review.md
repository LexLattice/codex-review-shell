# Review: Direct Meta-Session Control Plane Spec

## Verdict

`DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md` is the right architectural direction for the `codex/direct-chatgpt-harness` path. It cleanly targets the failure mode we have seen across the ADEU/ProgramBench work:

```text
local orchestrator chases task objective
  -> phase identity and evidence posture drift
  -> run is later discovered to have skipped / contaminated / over-promoted a transition
```

The spec’s core move is correct:

```text
Session          != thread id / branch / repo / chat transcript
ExecutionContext != Session
RunContract      != prose plan
transition claim != transition authority
worker output    != validated artifact
```

This is exactly the control-plane layer that should sit above the existing Direct session/turn store, governance shadow diagnostics, context-maintenance artifacts, and sub-agent observability diagnostics already present in the repo.

The main implementation risk is a naming and authority collapse: the repo already has `DirectSessionStore` and `direct_codex_session@1` for provider/runtime sessions. The new object is a **meta-session**, not an extension of the current turn/session store. It should be implemented as a separate meta-session store and ledger with its own schema namespace.

## Fit with the current repo

The repository already contains good lower-layer pieces:

```text
src/main/direct/session/session-store.js
  direct Codex session / turn / tool-obligation storage

src/main/direct/governance/broker.js
  governance packet, compiled prompt layers, workflow transition graph,
  semantic broker diagnostics; shadow/non-authority posture

src/main/direct/context/maintenance.js
  context pressure, trim plans, omission ledgers, memory/baton discipline

src/main/direct/agents/observability.js
  agent graph/progress/transcript projection as diagnostic evidence

src/main/direct/thread/*
  thread workbench, context packs, obligation projection, renderer projections

src/main/direct/tools/*
  read/patch/command authority boundaries
```

The new spec should not replace these. It should add a higher control layer:

```text
src/main/direct/meta-session/*
```

that stores meta-session identity, execution-context registry, run contracts, transition claims, instruction packages, route events, and session-level ledger pointers.

## Strongest parts of the spec

### 1. Three-depth authority split

The distinction between:

```text
L1 meta-session governor
L2 session orchestrator
L3 workers
```

is strong and necessary. It prevents the orchestrator from becoming both phase-transition authority and task-solver.

### 2. Session / ExecutionContext / RunContract split

This is the most important ontology. It prevents these false equivalences:

```text
thread id      = session
repo path      = context identity
branch name    = jurisdiction proof
chat transcript = evidence ledger
run plan prose = locked contract
```

### 3. Shadow vs enforce boundary

The spec correctly says the first implementation is diagnostic/shadow only. A transition guard’s “would deny” must not block runtime paths until enforce mode is separately built and contract-authorized.

### 4. Instruction inheritance compiler

Treating `AGENTS.md` and repo policy as input sources, not active contracts, is exactly right. Workers need compiled role packages with inclusion and omission ledgers, not blind inheritance of every project instruction.

### 5. Current-pointer and attempt-history discipline

The “valid artifact may become current; failed/corrupt/raw-exposure artifact remains attempt history” rule is the correct implementation invariant.

## Critical hardening patches

### Patch 1: Rename the primary object to `MetaSession` everywhere in implementation

The spec uses `Session` as a conceptual object, but the repo already uses `DirectSessionStore` and direct session records. To avoid a dangerous collision, implementation schemas should use explicit names:

```text
direct_meta_session@1
direct_meta_session_contract@1
direct_execution_context_registry@1
direct_run_contract@1
direct_meta_session_event_ledger@1
direct_meta_current_pointer_set@1
```

Avoid implementing this as a mode inside `DirectSessionStore`. Create a separate `DirectMetaSessionStore`.

Recommended module:

```text
src/main/direct/meta-session/store.js
```

### Patch 2: Split session status from contract status

The contract type currently has:

```ts
status: "draft" | "locked" | "active" | "amended" | "retired";
```

But “close, archive, fork” applies to the meta-session, not necessarily the contract. Use separate state machines:

```ts
type DirectMetaSessionStatusV1 =
  | "open"
  | "stopped"
  | "archived"
  | "forked";

type DirectRunContractStatusV1 =
  | "draft"
  | "locked"
  | "active"
  | "superseded"
  | "retired";
```

`amended` should usually be an event or lineage relation, not a durable terminal status. A contract amendment creates a new contract/epoch and supersedes the old one.

### Patch 3: Define epoch law precisely

The spec says activation creates a new epoch, and amendments also create new epochs. That is directionally right but needs a deterministic rule.

Recommended:

```text
contractVersion:
  increments on content-level contract amendment

sessionEpoch:
  increments when the active contract pointer changes or enforcement posture changes

activationEpoch:
  the epoch value cited by runtime artifacts
```

Every instruction package, transition request, route, worker packet, and guard result must cite:

```text
sessionId
contractId
contractVersion
sessionEpoch
contextId
observedLedgerHead
```

### Patch 4: Domain-separated canonical digests

The spec says artifacts have digests, but it should define digest domain separation. Existing repo modules use stable JSON stringification and `sha256`; the meta-session layer should reuse that pattern but make the hash domain explicit.

Example:

```text
artifactDigest = sha256(
  "direct_meta_session_contract@1\0" + canonical_json_v1(contract_without_digest)
)
```

Do this for:

```text
contract digest
context registry digest
instruction package digest
transition claim digest
guard result digest
route proposal digest
ledger event digest
current pointer set digest
```

Without domain separation, two different artifact classes can accidentally share a digest domain.

### Patch 5: Shadow guard decisions should not look like enforce decisions

`DirectTransitionGuardResultV1` currently has:

```ts
decision: "allow" | "deny" | "ask_human" | "reclassify" | "stop";
```

In shadow mode, this can be misread as runtime authority. Add an effect mode or separate shadow decision vocabulary:

```ts
type DirectTransitionGuardModeV1 =
  | "shadow"
  | "enforce_unavailable"
  | "enforce";

type DirectTransitionGuardDecisionV1 =
  | "allow"
  | "deny"
  | "ask_human"
  | "reclassify"
  | "stop";

type DirectTransitionGuardEffectV1 =
  | "diagnostic_only"
  | "runtime_block_applied"
  | "runtime_route_mutated"
  | "runtime_stop_applied";
```

Then assert:

```text
mode = shadow -> effect = diagnostic_only
mode = enforce_unavailable -> effect = diagnostic_only
```

Renderer copy can say “would deny,” but the artifact should carry the normalized decision and effect.

### Patch 6: Separate deterministic guard from semantic broker recommendation

The spec says the transition guard is “deterministic where possible and semantic where needed.” For enforce safety, semantic recommendations must not directly authorize runtime mutation.

Recommended split:

```text
DirectTransitionGuard
  deterministic schema/evidence/phase/authority validation

DirectSemanticTransitionRecommendation
  semantic classification / ambiguity / suggested route

DirectTransitionAdjudication
  combines deterministic guard + semantic recommendation + human approval policy
```

Rule:

```text
semantic recommendation may increase uncertainty, ask-human, or require amendment;
semantic recommendation alone may not create enforce authority.
```

### Patch 7: Cross-context route needs proposal/accept/dispatch split

`DirectCrossContextRouteV1` has `humanApproved: boolean`. That is not enough for stale-state safety.

Use three artifacts/events:

```text
cross_context_route_proposed
cross_context_route_accepted
cross_context_route_dispatched
```

The accepted/dispatch artifact should cite:

```text
routeProposalDigest
observedContextDigests at proposal time
observedContextDigests at dispatch time
observedLedgerHead at proposal time
observedLedgerHead at dispatch time
staleBlockerCode if changed
```

If any target context changed, dispatch fails closed.

### Patch 8: Define `ExecutionContext` more concretely

The spec gives examples but should include a schema-level shape early:

```ts
type DirectExecutionContextV1 = {
  schemaVersion: "direct_execution_context@1";
  contextId: string;
  contextKind:
    | "repo_workspace"
    | "chat_thread"
    | "direct_runtime_lane"
    | "app_server_lane"
    | "external_workspace"
    | "imported_legacy";
  jurisdiction: SessionJurisdictionV1;
  workspaceBindingDigest?: string;
  repoRootEvidenceDigest?: string;
  branchEvidenceDigest?: string;
  threadBindingDigest?: string;
  runtimeLaneDigest?: string;
  sourceClass:
    | "direct_native"
    | "app_server"
    | "legacy_imported"
    | "fixture"
    | "diagnostic";
  rendererSafeLabel: string;
  rawPathIncluded: false;
  activeStateDigest: string;
};
```

This prevents accidental use of path/branch/thread label as context identity.

### Patch 9: Instruction packages need an ephemeral launch path

The spec correctly says instruction packages should not store raw compiled prompt text. But workers still need actual prompt text at launch time.

Implementation should split:

```text
DirectInstructionPackageRecord
  persisted refs, omissions, digest, authority summary, output schema

DirectInstructionLaunchEnvelope
  ephemeral raw compiled prompt text, redacted where required,
  never persisted by default
```

The launch envelope can be built just-in-time from the package record and source artifacts. The persisted package stores only the digest and references.

### Patch 10: Raw-exposure law needs a shared scanner contract

The spec says raw-exposure scans happen before current pointer update. Good. But implementers need a concrete scanner profile:

```text
rawTextIncluded
rawTranscriptIncluded
rawPathIncluded
rawChatGptUrlIncluded
rawProviderPayloadIncluded
rawToolOutputIncluded
privateTokenIncluded
secretLikeValueIncluded
```

A failure should create only:

```text
direct_meta_session_attempt_failure@1
```

with renderer-safe reason and no raw payload.

### Patch 11: Current pointers should be scoped, not one global mutable row

The spec lists:

```text
current_meta_session_id
current_meta_session_contract_id
current_execution_context_registry_id
...
```

But in a multi-session app, pointer sets need scope:

```text
global current pointer set
surface-local current pointer set
meta-session current pointer set
context-local current pointer set
```

At minimum:

```ts
type DirectMetaCurrentPointerSetV1 = {
  pointerSetId: string;
  scopeKind: "global" | "surface" | "meta_session" | "execution_context";
  scopeId: string;
  currentMetaSessionId?: string;
  currentContractId?: string;
  currentContractEpoch?: number;
  currentContextRegistryId?: string;
  currentLedgerHead?: string;
  integrity: ...;
};
```

### Patch 12: Ledger needs a hash-chain invariant

The event ledger should be append-only with:

```text
sequence
previousEventDigest
eventDigest
ledgerHeadDigest
```

All current pointers should cite a ledger head. If the ledger is corrupt, no current pointer should advance. Renderer status should show minimal safe recovery state.

## Implementation mapping for this repo

Recommended files:

```text
src/main/direct/meta-session/
  constants.js
  digest.js
  source-ref.js
  blocker-codes.js
  schemas.js
  raw-exposure.js
  store.js
  current-pointers.js
  ledger.js
  execution-context.js
  contract.js
  instruction-package.js
  transition-claim.js
  transition-guard.js
  cross-context-route.js
  projection.js
  index.js
```

Recommended regression script:

```text
scripts/direct-meta-session-control-plane-regression.mjs
```

Recommended package entries:

```json
{
  "direct:meta-session-control-plane": "node ./scripts/direct-meta-session-control-plane-regression.mjs"
}
```

and add the new source files to `check:direct-syntax` / `check:script-syntax`.

Recommended doc location:

```text
docs/DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md
```

The uploaded spec’s relative links assume it is near the related Direct docs. If it is placed at repo root, links like `./META_ORCHESTRATOR_LOOP_ODEU_SPEC.md` will not resolve; if it is placed under `docs/`, they will.

## Suggested first implementation slice

Do not implement the whole spec in one PR. Use a narrow `Phase 1A`:

```text
Phase 1A: schemas + store + current pointers + ledger + fixture regression
```

In scope:

```text
DirectMetaSessionStore
contract draft/lock/activate artifacts
execution context registry artifacts
current pointer set
attempt history records
ledger append with hash chain
schema validation before pointer update
raw-exposure minimal blocker
renderer-safe status projection
stable blocker codes
fixture regression script
```

Out of scope for 1A:

```text
actual worker spawning
instruction compiler launch envelope
runtime transition blocking
semantic broker rerouting
enforced mode
sub-agent choreography
UI workbench beyond minimal status projection
```

Then:

```text
Phase 1B: instruction package records and omission ledger
Phase 1C: shadow transition guard and transition claim artifacts
Phase 1D: cross-context route proposal/accept/dispatch with staleness blocking
Phase 1E: UI/status projection
Phase 2+: enforce mode only after shadow diagnostics and recovery are proved
```

## Acceptance tests to add

Add fixture/headless cases for:

```text
1. two execution contexts with same repo label but different context ids do not collapse;
2. UI selected tab does not mutate active meta-session pointer;
3. route proposal becomes stale after context digest changes;
4. stale route dispatch writes attempt failure but leaves current pointers unchanged;
5. invalid contract schema writes attempt history only;
6. raw path / raw transcript in artifact blocks current pointer update;
7. shadow transition guard returns diagnostic_only effect and does not block runtime;
8. enforce mode cannot be enabled by config flag without contract epoch support;
9. instruction package omits excluded AGENTS sections and records omission refs;
10. raw compiled prompt text is not persisted in normal instruction package;
11. amendment creates new epoch and invalidates old instruction package for launch;
12. app-server evidence cannot be promoted to Direct-native worker authority;
13. source-class split appears in renderer-safe status;
14. ledger hash-chain corruption blocks pointer advancement;
15. contract digest mismatch yields stable blocker code;
16. cross-context broadcast mutation requires explicit route event;
17. worker artifact submitted without contract id/epoch is rejected;
18. route confidence low requires ask/propose, not dispatch;
19. previous valid current pointer survives schema-invalid attempt;
20. renderer projection never includes raw path, raw provider payload, or raw transcript text.
```

## Spec wording changes I recommend

### Replace

```text
Session
```

where the implementation artifact is meant, with:

```text
MetaSession
```

Keep `Session` only as the conceptual discussion term.

### Replace

```text
The transition guard is deterministic where possible and semantic where needed.
```

with:

```text
The transition guard is deterministic for enforceable legality. Semantic broker
recommendations may classify ambiguity, propose routes, or request human review,
but they do not create enforce authority without deterministic guard support and
contract policy.
```

### Replace

```text
Shadow transition diagnostic != runtime blocker
```

with the stronger artifact law:

```text
In shadow mode, guard decisions must carry effect=diagnostic_only. Any runtime
block, route mutation, worker dispatch mutation, or status degradation is a
contract violation.
```

### Add

```text
MetaSessionStore is separate from DirectSessionStore. DirectSessionStore owns
provider turns and tool obligations. MetaSessionStore owns procedure identity,
contracts, context registries, transition claims, and session-level ledger.
```

## Final assessment

The spec is promotion-worthy as the next design layer, provided implementation starts narrow and keeps the non-authority boundary hard.

The most important fixes before coding are:

```text
1. rename implementation object to MetaSession;
2. split meta-session store from existing direct session/turn store;
3. make shadow guard effects diagnostic-only at schema level;
4. define digest canonicalization and ledger hash-chain law;
5. split deterministic transition guard from semantic recommendation;
6. make cross-context routing proposal/accept/dispatch stateful;
7. add scoped current pointers and attempt-history invariants;
8. add fixture regression before any UI/enforce/choreography work.
```

The one-line summary:

```text
This spec should become the Direct path’s meta-control plane, but only if it is
implemented as a separate, digest-backed, shadow-first MetaSession layer rather
than as another narrative status overlay on the existing DirectSessionStore.
```
