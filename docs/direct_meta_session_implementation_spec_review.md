# Direct Meta-Session Control Plane Implementation Spec Review

Reviewed files:

- `DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md`
- `DIRECT_META_SESSION_CONTROL_PLANE_IMPLEMENTATION_SPEC.md`
- `codex-review-shell-codex-direct-chatgpt-harness(2).zip`, especially the existing Direct runtime layout under `src/main/direct/` and `package.json` scripts.

## Verdict

The implementation spec is a strong Phase 1A translation of the intent spec. It correctly narrows the first implementation slice to an artifact/status substrate and preserves the central authority law:

```text
MetaSession identity != Direct provider session identity
stored artifact       != runtime authority
transition claim      != transition execution
status projection     != mutation control
```

The proposed module boundary is also right:

```text
src/main/direct/meta-session/
```

This should remain separate from the existing `src/main/direct/session/session-store.js`, because that store owns provider/runtime sessions and turns, while the new store owns procedure identity, context registries, contracts, transition claims, HOB/OTB/BRL rows, pointers, and a meta-session event ledger.

I would classify the implementation spec as:

```text
architecture: strong
Phase 1A scope: mostly correct
implementation-ready: almost, but needs schema/hash/ledger hardening before Codex writes code
```

The main risks are not conceptual. They are determinism risks:

```text
undefined shared refs
ambiguous digest domains
circular ledger hashes
underspecified transition-claim shape
BRL manifest without an expected observation hash
syntax script that may not actually syntax-check every new file
```

Those should be patched before implementation.

---

## What the implementation spec gets right

### 1. It preserves the intent-spec boundary

The intent spec required the first implementation to prove that the meta-session layer is an evidence/control plane, not a hidden execution shortcut. The implementation spec keeps that by making Phase 1A artifact-only and explicitly disallowing provider transport, app-server spawn, workspace reads, patches, commands, Direct provider-session creation, runtime-tier mutation, right-pane mutation, handoff mutation, worker spawning, route dispatch, and transition enforcement.

That is exactly the right first slice.

### 2. It names the object correctly

The implementation spec uses:

```text
DirectMetaSessionStore
DirectMetaSessionV1
DIRECT_META_SESSION_SCHEMA = direct_meta_session@1
```

That avoids the earlier risk of collapsing MetaSession into the existing Direct provider session object.

### 3. It adds the right artifact families for Phase 1A

The following are appropriate Phase 1A artifacts:

```text
MetaSession
ExecutionContextRegistry
RunContract
StateObjectDescriptor
HOB Obligation Status
Transition Claim
Upstream Discriminator Row
BRL Replay-Lock Manifest
Current Pointer Set
Attempt Failure
Event Ledger
Status Projection
```

This gives the future OTB/HOB/BRL machinery a real substrate without granting runtime authority.

### 4. It uses a local fixture regression instead of live/provider tests

The regression script requirement is correct:

```text
network: no
provider credentials: no
app-server: no
Electron: no
WSL: no
workspace mutation: no
```

For this slice, a deterministic temp-root fixture is enough.

### 5. It includes sentinel counters

The zero-authority sentinel counters are valuable. They make the authority boundary testable:

```text
providerTransportCalls: 0
appServerSpawnCalls: 0
workspaceReadCalls: 0
patchApplyCalls: 0
commandRunCalls: 0
directSessionCreates: 0
workerSpawnCalls: 0
routeDispatchCalls: 0
transitionEnforceCalls: 0
```

That should be kept.

---

## Critical hardening patches before implementation

### Patch 1: Define `DirectMetaSourceRefV1` and `DirectMetaArtifactRefV1`

Several artifact shapes use these types, but the implementation spec does not define them:

```text
DirectMetaSourceRefV1
DirectMetaArtifactRefV1
```

This is a blocker because these refs are the backbone of evidence identity.

Add a dedicated file:

```text
src/main/direct/meta-session/source-ref.js
```

or include the definitions in `schemas.js`.

Suggested minimal shape:

```ts
type DirectMetaSourceRefV1 = {
  schemaVersion: "direct_meta_source_ref@1";
  sourceRefId: string;
  sourceKind:
    | "intent_spec"
    | "implementation_spec"
    | "fixture"
    | "prior_artifact"
    | "contract"
    | "context_registry"
    | "hob_row"
    | "otb_row"
    | "brl_row"
    | "diagnostic"
    | "unknown";
  authority: "spec" | "fixture" | "diagnostic" | "derived" | "future";
  sourceDigest: string;
  rendererSafeLabel: string;
  rawTextIncluded: false;
  rawPathIncluded: false;
  rawProviderPayloadIncluded: false;
};

type DirectMetaArtifactRefV1 = {
  schemaVersion: "direct_meta_artifact_ref@1";
  artifactKind: string;
  artifactId: string;
  artifactDigest: string;
  storageSlot?: string;
  rendererSafeLabel?: string;
};
```

Avoid raw paths in `storageSlot`; use symbolic storage slots such as:

```text
artifacts/run-contracts/<id>.json
```

not absolute host paths.

---

### Patch 2: Make digest law domain-separated by artifact kind, not just schema version

The digest law currently says:

```text
artifactDigest = sha256("<schemaVersion>\0" + canonical_json_v1(artifact_without_digest))
```

That is close, but I would make the domain explicit:

```text
sha256("direct-meta-session-artifact@1\0" + schemaVersion + "\0" + artifactKind + "\0" + canonical_json_v1(payload))
```

This prevents accidental cross-kind hash equivalence if two artifacts share a schema-like shape or if a future object changes its schema label incorrectly.

Add a function like:

```js
artifactDigest({ schemaVersion, artifactKind, value })
eventDigest({ value })
ledgerHeadDigest({ previousHeadDigest, eventDigest })
pointerSetDigest({ value })
```

Do not use one loose `digest(value)` everywhere.

---

### Patch 3: Remove circular ledger hash ambiguity

The ledger shape includes both:

```text
eventDigest
ledgerHeadDigest
```

and says:

```text
eventDigest matches event body
ledgerHeadDigest matches chain head
```

This is ambiguous unless the digest-exclusion fields are explicit. Otherwise `eventDigest` can accidentally include `ledgerHeadDigest`, and `ledgerHeadDigest` can include `eventDigest`, creating a circular definition.

Define it as:

```text
eventBodyDigest = digest(event without eventDigest, ledgerHeadDigest, and digest fields)
eventDigest     = digest(previousEventDigest + eventBodyDigest)
ledgerHeadDigest = eventDigest
```

or:

```text
eventDigest = digest(event without eventDigest and ledgerHeadDigest)
ledgerHeadDigest = digest(previousLedgerHeadDigest + eventDigest)
```

Either is fine, but it must be exact.

Also define whether `previousEventDigest` points to:

```text
prior eventDigest
```

or:

```text
prior ledgerHeadDigest
```

Right now it reads like the former, while `ledgerHeadDigest` reads like the latter.

---

### Patch 4: Clarify pointer-update event ordering

The spec says a valid artifact write does:

```text
write artifact
append ledger event
verify ledger head
write current pointer set
```

But the ledger event kinds include:

```text
current_pointer_set_updated
```

If pointer update is a meaningful mutation, it should itself be ledgered. Otherwise the ledger head may not reflect the latest pointer state.

Use one of these two models:

#### Model A: two-event model

```text
1. artifact_recorded event
2. current_pointer_set_updated event
3. pointer file write with ledger head cited
```

#### Model B: combined event model

```text
1. build artifact
2. build next pointer set
3. append event containing both artifact ref and pointer-set ref
4. write artifact + event + pointer set under a single atomic batch discipline
```

For Phase 1A, Model A is easier.

Recommended rule:

```text
No current pointer may cite a ledger head that does not include the pointer-set update event.
```

---

### Patch 5: Add a schema for `index.json`

The store layout includes:

```text
<rootDir>/index.json
```

but the implementation spec does not define its schema, digest, or pointer law.

Add:

```text
DIRECT_META_SESSION_INDEX_SCHEMA = "direct_meta_session_index@1"
```

Suggested fields:

```ts
type DirectMetaSessionIndexV1 = {
  schemaVersion: "direct_meta_session_index@1";
  sessionRefs: DirectMetaArtifactRefV1[];
  currentGlobalPointerSetId?: string;
  lastUpdatedAt: string;
  digest: string;
};
```

The index should not be a hidden source of authority. It should be a lookup structure only.

---

### Patch 6: Expand `TransitionClaim` into a real OTB transition-claim object

The current shape is too thin:

```ts
transitionId
fromState
toState
objectRefs
evidenceRequired
evidenceForbidden
allowedFailureStates
enforceableInThisPr: false
```

It records something, but it does not yet support the OTB model from the previous arc:

```text
O = object identity and carried artifacts
E = evidence required / forbidden / warrant boundary
D = obligations created / preserved / discharged / blocked / deferred
U = intended use, allowed next phases, forbidden promotions
```

Add at least:

```ts
claimingActorRef
claimSource
fromPhase
toPhase
claimedTransitionKind
claimedReadinessPosture
claimedEvidencePosture
claimedPromotion
objectBridge
evidenceBridge
obligationBridge
useBridge
requestedNextFrontier
validationStatus
```

Minimal shape:

```ts
type DirectMetaTransitionClaimV1 = {
  schemaVersion: "direct_meta_transition_claim@1";
  transitionClaimId: string;
  metaSessionId: string;
  claimingActorRef: string;
  claimSource: "fixture" | "manual" | "future_worker" | "diagnostic";
  fromPhase: string;
  toPhase: string;
  claimedTransitionKind: string;
  claimedReadinessPosture: string;
  claimedEvidencePosture: string;
  claimedPromotion: "none" | "scoped" | "official_ready" | "gold";
  objectBridge: {
    carriedArtifactRefs: DirectMetaArtifactRefV1[];
    transformedArtifactRefs: DirectMetaArtifactRefV1[];
    comparisonTargetRefs: DirectMetaArtifactRefV1[];
  };
  evidenceBridge: {
    requiredEvidenceRefs: DirectMetaSourceRefV1[];
    forbiddenEvidenceClasses: string[];
    observedEvidenceRefs: DirectMetaSourceRefV1[];
  };
  obligationBridge: {
    created: string[];
    preserved: string[];
    discharged: string[];
    blocked: string[];
    deferred: string[];
  };
  useBridge: {
    intendedUse: string;
    allowedNextPhases: string[];
    forbiddenPromotions: string[];
  };
  enforceableInThisPr: false;
  rawTextIncluded: false;
  digest: string;
};
```

The current simplified form risks reintroducing the failure OTB was meant to prevent:

```text
artifact exists -> transition assumed legal
```

---

### Patch 7: BRL manifest must include the expected observation hash

The current BRL shape has:

```ts
expectedHashProvenance: string
validationCommand?: string
```

but no actual expected observation hash.

That means it is not a replay lock yet. It is a replay-lock note.

Add:

```ts
expectedObservationHash: string;
observedSurfaceRefs: DirectMetaArtifactRefV1[];
protectedSurfaces: string[];
ignoredSurfaces: string[];
canonicalObservationHash?: string;
rawObservationHash?: string;
environmentProfileRef?: DirectMetaArtifactRefV1;
mutationPolicy: "non_mutating" | "mutating_with_after_hash" | "future";
manifestLifecycle: "draft" | "locked" | "retired";
```

Also replace `validationCommand?: string` with a safer object:

```ts
validationCommandRef?: {
  commandKind: "npm_script" | "fixture_runner" | "future";
  rendererSafeCommandLabel: string;
  argvDigest?: string;
  rawCommandIncluded: false;
};
```

A raw shell command string can contain paths, secrets, or executable authority. For Phase 1A, it should be a reference, not an execution instruction.

---

### Patch 8: Syntax coverage must include every new file

The package integration says to add something like:

```text
node --check src/main/direct/meta-session/index.js
```

That is not enough. `node --check index.js` does not syntax-check every required module in the tree.

Patch the requirement to add every new file explicitly to `check:direct-syntax`:

```text
node --check src/main/direct/meta-session/constants.js
node --check src/main/direct/meta-session/digest.js
node --check src/main/direct/meta-session/ids.js
node --check src/main/direct/meta-session/raw-exposure.js
node --check src/main/direct/meta-session/schemas.js
node --check src/main/direct/meta-session/blocker-codes.js
node --check src/main/direct/meta-session/ledger.js
node --check src/main/direct/meta-session/store.js
node --check src/main/direct/meta-session/current-pointers.js
node --check src/main/direct/meta-session/projection.js
node --check src/main/direct/meta-session/fixtures.js
node --check src/main/direct/meta-session/index.js
node --check scripts/direct-meta-session-control-plane-regression.mjs
```

The existing repo uses explicit syntax-check lists, so the spec should match that style.

---

### Patch 9: Do not allow `storagePaths` to become raw paths

`StateObjectDescriptor.codeAnchors.storagePaths` is risky because the raw-exposure scanner blocks raw host/WSL paths.

Use one of these instead:

```text
storageSlots
storagePathTemplates
repoRelativeCodeAnchors
symbolicStorageRefs
```

Example:

```ts
storageSlots: ["artifacts/run-contracts", "ledger/events"]
```

not:

```text
/home/user/project/...
C:\Users\...
\\wsl$\...
```

The field should explicitly say:

```text
storage slots are symbolic, not raw filesystem paths
```

---

### Patch 10: Make raw-exposure scanning precise enough to avoid both leaks and false positives

The hard blockers are correct, but the implementation needs a defined scanner contract.

Add:

```ts
type RawExposureFinding = {
  findingKind:
    | "host_path"
    | "wsl_path"
    | "chatgpt_url"
    | "provider_payload"
    | "compiled_prompt"
    | "transcript_text"
    | "tool_output"
    | "token"
    | "secret_like";
  jsonPointer: string;
  evidenceClass: "key_name" | "value_pattern" | "schema_flag";
  rendererSafeSummary: string;
};
```

The scanner should use both:

```text
key-based detection
value-pattern detection
```

and it should support explicit safe placeholder patterns such as:

```text
[REDACTED:host-path]
[source-ref:...]
[artifact-ref:...]
```

without treating those placeholders as leaks.

---

## Medium-severity patches

### 1. Split `HOB Obligation Status` coverage status more finely

The current statuses are:

```text
covered
proved_irrelevant
pass_through
deferred_with_risk
blocked_pending_evidence
```

`covered` is too broad for the long-term system. Consider:

```text
covered_terminalized
covered_by_probe_matrix
covered_by_reference_observation
covered_by_source_tail
scoped_ready_only
```

For Phase 1A, the simple status is acceptable if the row also carries:

```text
evidenceAuthority
coverageKind
readinessPosture
```

### 2. Add root lifecycle status to MetaSession

`MetaSession.status` currently has:

```text
open | stopped | archived | forked
```

That is fine, but contract lifecycle is separate. Make the split explicit in tests:

```text
MetaSession.status != RunContract.status
```

Add a regression case:

```text
archived_meta_session_cannot_activate_contract
```

or, if activation is allowed only for open sessions:

```text
activation_blocked_when_meta_session_not_open
```

### 3. Define exact epoch law

The spec says:

```text
run_contract_draft_lock_activate_advances_epoch
```

but does not specify which actions increment:

```text
contractVersion
sessionEpoch
activationEpoch
```

Suggested law:

```text
create session: sessionEpoch = 1
contract draft: contractVersion assigned, sessionEpoch unchanged
contract lock: contractVersion stable, sessionEpoch unchanged
contract activate: sessionEpoch increments by 1, activeContractId set
contract amendment: new contractVersion, activation increments sessionEpoch on activate
```

Whatever law is chosen should be tested.

### 4. Add execution-context digest per context

The registry has a `sourceDigest`, but each context should also have a digest or identity hash:

```ts
contextDigest: string
```

That will matter later for cross-context staleness and route validation.

### 5. Add concurrency / single-writer assumption

The store should state whether Phase 1A assumes:

```text
single process / single writer
```

or implements file locks.

For Phase 1A, single-writer is acceptable. Say it explicitly:

```text
Concurrent writers are out of scope. If concurrent mutation is detected or lock file exists, writes fail with schema_invalid or ledger_corrupt until a later lock protocol exists.
```

### 6. Make status projection source digest deterministic

`StatusProjection.sourceDigest` should be defined as a digest over:

```text
current pointer set digest
ledger head digest
counted artifact refs
projection schema version
```

not over wall-clock `generatedAt`.

Otherwise the projection digest may change just because it was rendered later.

### 7. Add a no-IPC default

The implementation spec says if Electron IPC is added, it must be read-only. For Phase 1A, I would be stricter:

```text
No IPC should be added in Phase 1A.
```

Read-only IPC can be Phase 1B, after the status projection is stable.

---

## Repo-fit notes

The proposed module path fits the existing repo:

```text
src/main/direct/meta-session/
```

The existing repo already has parallel Direct modules:

```text
src/main/direct/session/session-store.js
src/main/direct/governance/broker.js
src/main/direct/probes/live-probe-evidence-store.js
src/main/direct/runtime/project-activation.js
```

The implementation should imitate the existing style:

```text
CommonJS
node:fs / node:path / node:crypto
explicit constants
plain validation functions
safe ids
atomic JSON writes with temp file + rename
fixture regression scripts under scripts/
```

The package script update should respect the repo’s existing explicit syntax-check style. Do not rely on broad globbing unless the repo deliberately moves to a generated syntax manifest.

---

## Recommended Phase 1A acceptance tests after patching

Keep all existing listed cases and add these:

```text
source_ref_schema_required_for_all_evidence_refs
artifact_ref_digest_required_for_all_artifact_refs
index_json_created_and_digest_valid
canonical_digest_domain_separates_artifact_kinds
event_digest_excludes_eventDigest_and_ledgerHeadDigest
ledger_head_digest_chain_detects_reordered_events
pointer_update_is_ledgered_before_pointer_becomes_current
context_digest_changes_when_jurisdiction_changes
contract_lock_does_not_equal_activation_authority
session_epoch_law_is_stable
transition_claim_requires_OEDU_bridge_fields
transition_claim_forbidden_evidence_is_recorded
brl_manifest_requires_expected_observation_hash
brl_validation_command_is_ref_not_raw_shell
storage_slots_are_symbolic_not_raw_paths
status_projection_source_digest_excludes_generatedAt
node_check_covers_every_new_meta_session_file
no_ipc_modules_touched_in_phase_1a
```

---

## Recommended implementation order after hardening

The current order is good. I would amend it to:

```text
1. constants.js, blocker-codes.js, ids.js
2. digest.js with explicit domain-separated digest functions
3. source-ref.js / artifact-ref schema helpers
4. raw-exposure.js with finding objects and placeholder allowances
5. schemas.js validation functions
6. ledger.js with non-circular event/head digests
7. current-pointers.js with ledgered pointer updates
8. store.js write methods and attempt-failure handling
9. projection.js renderer-safe status projection
10. fixtures.js fixture builders
11. direct-meta-session-control-plane-regression.mjs
12. package.json script updates with every new file explicitly syntax-checked
```

---

## Final recommendation

Proceed with this implementation spec after a small hardening revision.

The spec already has the correct architectural boundary. The critical patches are:

```text
1. Define source/artifact refs.
2. Make digest and ledger hash law non-circular and domain-separated.
3. Ledger current-pointer updates explicitly.
4. Expand TransitionClaim into an O/E/D/U bridge object.
5. Add expected observation hashes to BRL manifests.
6. Add index.json schema.
7. Make syntax checking cover every new file.
8. Replace raw command/path-like fields with safe refs or symbolic slots.
```

With those patches, Phase 1A becomes a safe, buildable substrate for the later instruction compiler, shadow transition guard, enforce mode, and three-depth runtime. Without them, the implementation could still work as a status store, but it would be too easy for later phases to inherit ambiguous artifact identity, weak transition claims, or replay-lock rows that do not actually lock behavior.
