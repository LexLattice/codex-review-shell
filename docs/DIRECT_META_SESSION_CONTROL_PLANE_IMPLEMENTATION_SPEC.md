# Direct Meta-Session Control Plane Implementation Spec

Status: pre-implementation spec for the first buildable slice of
[Direct Meta-Session Control Plane Spec](./DIRECT_META_SESSION_CONTROL_PLANE_SPEC.md).

Target branch: `codex/direct-chatgpt-harness`.

Target implementation slice: Phase 1A only.

```text
schemas
  -> artifact store
  -> current pointers
  -> event ledger
  -> state-object descriptors
  -> HOB / OTB / upstream-discriminator / BRL fixture rows
  -> renderer-safe status projection
  -> fixture regression
```

## Purpose

Implement the smallest durable MetaSession substrate that can be validated before
runtime authority is added.

This PR should prove:

```text
MetaSession identity is distinct from Direct provider session identity.
MetaSession state objects are machine-readable.
MetaSession transitions are ledgered and pointer-safe.
MetaSession artifacts are renderer-safe.
MetaSession shadow/status projection does not create runtime authority.
```

It should not prove:

```text
workers can spawn
routes can dispatch
transition guards can block runtime
semantic broker can reroute
enforce mode works
sub-agent choreography works
UI mutation controls exist
```

## Authority Law

Phase 1A is an artifact and status substrate.

```text
stored artifact != runtime authority
valid contract != enforce mode
current pointer != provider session continuity
transition claim != transition execution
discriminator row != automatic patch
BRL manifest != semantic correctness
status projection != mutation control
```

No Phase 1A code path may call provider transport, spawn app-server, read
workspace contents, apply patches, run commands, create Direct provider
sessions, mutate runtime tier, mutate right-pane ChatGPT, or mutate handoff
state.

## Implementation Boundary

Add a new module subtree:

```text
src/main/direct/meta-session/
  constants.js
  digest.js
  ids.js
  source-ref.js
  raw-exposure.js
  schemas.js
  blocker-codes.js
  ledger.js
  store.js
  current-pointers.js
  projection.js
  fixtures.js
  index.js
```

Do not modify implementation-lane runtime controllers, provider transport,
thread store, context pack, request manifest, app-server controller, or UI
mutation routes in this first slice.

Do not add Electron IPC in Phase 1A. Even read-only status IPC should wait until
the artifact store, projection shape, and raw-exposure scan are stable.
Mutation-capable IPC remains out of scope until an `IpcChannelContract` row and
sender-role checks are added.

## Package Integration

Add syntax coverage:

```text
node --check src/main/direct/meta-session/constants.js
node --check src/main/direct/meta-session/digest.js
node --check src/main/direct/meta-session/ids.js
node --check src/main/direct/meta-session/source-ref.js
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

Add a fixture regression script:

```text
scripts/direct-meta-session-control-plane-regression.mjs
npm script: direct:meta-session-control-plane
```

The regression must use a temporary user-data root and must not require network,
provider credentials, app-server, Electron, WSL, or workspace mutation.

## Store Layout

Use an explicit root passed by the caller:

```js
new DirectMetaSessionStore({ rootDir, now, randomId })
```

Recommended on-disk layout:

```text
<rootDir>/
  index.json
  sessions/
    <metaSessionId>/
      session.json
      current-pointers/
        global.json
        meta-session.json
      ledger/
        manifest.json
        events/
          000001_<eventId>.json
          000002_<eventId>.json
      artifacts/
        execution-context-registries/
        state-object-descriptors/
        run-contracts/
        hob-obligation-status/
        transition-claims/
        upstream-discriminators/
        brl-manifests/
        attempts/
        projections/
```

Use atomic JSON writes. Reuse the existing direct store style where practical:

```text
CommonJS modules
explicit schema constants
plain validation functions
safe id normalization
stable digest helpers
writeJsonAtomic-style writes
fixture regression scripts
```

Phase 1A assumes a single process/single writer. Concurrent mutation protocols
and file locks are out of scope. If a future caller detects concurrent mutation
or a stale lock marker, writes should fail closed rather than attempt recovery in
this slice.

Do not use the existing `DirectSessionStore` as the MetaSession store. The
existing Direct session store owns provider/runtime sessions and turns. The new
store owns procedure identity, contexts, contracts, transition claims,
discriminators, BRL rows, pointers, and the MetaSession event ledger.

## Schema Constants

Define schema constants:

```js
DIRECT_META_SESSION_INDEX_SCHEMA = "direct_meta_session_index@1"
DIRECT_META_SOURCE_REF_SCHEMA = "direct_meta_source_ref@1"
DIRECT_META_ARTIFACT_REF_SCHEMA = "direct_meta_artifact_ref@1"
DIRECT_META_SESSION_SCHEMA = "direct_meta_session@1"
DIRECT_EXECUTION_CONTEXT_SCHEMA = "direct_execution_context@1"
DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA = "direct_execution_context_registry@1"
DIRECT_RUN_CONTRACT_SCHEMA = "direct_run_contract@1"
DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA = "direct_meta_state_object_descriptor@1"
DIRECT_HOB_OBLIGATION_STATUS_SCHEMA = "direct_meta_hob_obligation_status@1"
DIRECT_TRANSITION_CLAIM_SCHEMA = "direct_meta_transition_claim@1"
DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA = "direct_meta_upstream_discriminator_row@1"
DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA = "direct_meta_brl_replay_lock_manifest@1"
DIRECT_META_CURRENT_POINTER_SET_SCHEMA = "direct_meta_current_pointer_set@1"
DIRECT_META_SESSION_EVENT_SCHEMA = "direct_meta_session_event@1"
DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA = "direct_meta_session_event_ledger_manifest@1"
DIRECT_META_ATTEMPT_FAILURE_SCHEMA = "direct_meta_session_attempt_failure@1"
DIRECT_META_STATUS_PROJECTION_SCHEMA = "direct_meta_session_status_projection@1"
DIRECT_META_CONTROL_PLANE_REPORT_SCHEMA = "direct_meta_session_control_plane_report@1"
```

## Digest Law

Implement one canonical JSON serializer in `digest.js`.

Rules:

```text
object keys sorted recursively
undefined omitted or normalized consistently
digest fields omitted when calculating their own value
schemaVersion included in digest domain
artifact kind included in artifact digest domain
```

Digest format:

```text
sha256:<hex>
```

Domain rules:

```text
artifactDigest = sha256(
  "direct-meta-session-artifact@1\0"
  + schemaVersion + "\0"
  + artifactKind + "\0"
  + canonical_json_v1(artifact_without_digest)
)

eventBodyDigest = sha256(
  "direct-meta-session-event-body@1\0"
  + canonical_json_v1(event_without_eventDigest_and_ledgerHeadDigest)
)

eventDigest = sha256(
  "direct-meta-session-event@1\0"
  + previousEventDigest + "\0"
  + eventBodyDigest
)

ledgerHeadDigest = eventDigest

pointerSetDigest = sha256(
  "direct-meta-session-pointer-set@1\0"
  + canonical_json_v1(pointer_without_pointerSetDigest)
)
```

`previousEventDigest` points to the prior event's `eventDigest`, not to a
separate head value. The first event uses an empty previous event digest.

Implementation should expose separate helpers instead of one loose digest
function:

```js
artifactDigest({ schemaVersion, artifactKind, value })
eventBodyDigest(value)
eventDigest({ previousEventDigest, eventBodyDigest })
pointerSetDigest(value)
genericDigest(value)
```

Do not use display labels, renderer-selected tabs, timestamps, raw prompt text,
raw transcript text, raw paths, raw provider payloads, or client operation ids
as semantic discriminator inputs unless the schema explicitly says they are
part of that artifact's source identity.

## Raw-Exposure Scanner

Implement `assertMetaSessionRendererSafe(value)` and
`scanMetaSessionRawExposure(value)`.

Hard blockers:

```text
raw host path
raw WSL path
raw ChatGPT URL
raw provider request/response/frame
raw compiled prompt text
raw transcript text
raw tool output
auth token / cookie / bearer token / API key
secret-like value
```

Finding shape:

```ts
type DirectMetaRawExposureFindingV1 = {
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

The scanner should combine key-based detection, value-pattern detection, and
explicit schema flag checks. Safe placeholder values are allowed:

```text
[REDACTED:host-path]
[source-ref:<id>]
[artifact-ref:<id>]
```

Every renderer-safe artifact should carry explicit false flags where relevant:

```ts
{
  rawTextIncluded: false,
  rawTranscriptIncluded: false,
  rawPathIncluded: false,
  rawChatGptUrlIncluded: false,
  rawProviderPayloadIncluded: false,
  rawToolOutputIncluded: false,
  privateTokenIncluded: false,
  secretLikeValueIncluded: false
}
```

Raw-exposure failure writes an attempt failure artifact and leaves current
pointers unchanged.

## Blocker Codes

Export a stable enum:

```text
session_missing
session_pointer_stale
contract_missing
contract_digest_mismatch
contract_epoch_stale
context_missing
context_digest_mismatch
context_jurisdiction_ambiguous
route_stale
transition_not_allowed
required_evidence_missing
worker_authority_missing
amendment_required
human_approval_required
raw_exposure_blocked
schema_invalid
ledger_corrupt
enforce_mode_unavailable
sub_agent_choreography_unavailable
upstream_discriminator_missing
ipc_contract_missing
status_projection_only
```

Renderer copy may be friendlier, but reports and tests should assert blocker
codes exactly.

## Artifact Shapes

### Source And Artifact Refs

Evidence and artifact refs are first-class schemas. They are not raw paths,
provider frames, or transcript excerpts.

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

`storageSlot` is symbolic and repo-local to the MetaSession store layout:

```text
artifacts/run-contracts/<id>.json
ledger/events/<event>.json
```

It must never be an absolute host path, WSL path, or URL.

### Index

The root index is a lookup object, not hidden authority.

```ts
type DirectMetaSessionIndexV1 = {
  schemaVersion: "direct_meta_session_index@1";
  sessionRefs: DirectMetaArtifactRefV1[];
  currentGlobalPointerSetId?: string;
  lastUpdatedAt: string;
  digest: string;
};
```

The index digest should exclude wall-clock-only fields if they do not affect
lookup truth. Missing or corrupt index state can be rebuilt only from existing
safe artifacts in a future explicit maintenance route; Phase 1A should report
the failure rather than silently rebuilding on read.

### MetaSession

Minimum Phase 1A shape:

```ts
type DirectMetaSessionV1 = {
  schemaVersion: "direct_meta_session@1";
  metaSessionId: string;
  title: string;
  status: "open" | "stopped" | "archived" | "forked";
  createdAt: string;
  updatedAt: string;
  sessionEpoch: number;
  activeContractId?: string;
  activeContractVersion?: number;
  contextRegistryId?: string;
  sourceRefs: DirectMetaSourceRefV1[];
  rawTextIncluded: false;
  digest: string;
};
```

### Execution Context Registry

The registry proves that equal display labels are not identity.

```ts
type DirectExecutionContextRegistryV1 = {
  schemaVersion: "direct_execution_context_registry@1";
  registryId: string;
  metaSessionId: string;
  contexts: DirectExecutionContextV1[];
  createdAt: string;
  sourceDigest: string;
  digest: string;
};
```

Each context includes:

```ts
contextId
contextDigest
contextKind
runtimeSourceClass
jurisdiction
displayLabel
evidenceRefs
rawPathIncluded: false
rawChatGptUrlIncluded: false
```

`contextDigest` changes when jurisdiction, runtime source class, or evidence
identity changes. Display labels alone are not context identity.

### Run Contract

Phase 1A supports draft, lock, and activate artifacts. Activation only updates
MetaSession pointers and epoch; it does not enforce runtime behavior.

```ts
status: "draft" | "locked" | "active" | "superseded" | "retired"
contractVersion: number
sessionEpoch: number
authorityPolicy
amendmentPolicy
stopPolicy
transitionPolicy
instructionPolicy
evidencePolicy
```

Epoch law:

```text
create session: sessionEpoch = 1
draft contract: assigns contractVersion, sessionEpoch unchanged
lock contract: contractVersion stable, sessionEpoch unchanged
activate contract: sessionEpoch increments by 1 and activeContractId is set
amendment: creates a new contractVersion; activation increments sessionEpoch
archive/stopped session: later contract activation is blocked
```

Regression should prove `MetaSession.status != RunContract.status`.

### State Object Descriptor

Every Phase 1A state object has a descriptor:

```ts
type DirectMetaStateObjectDescriptorV1 = {
  schemaVersion: "direct_meta_state_object_descriptor@1";
  id: string;
  ownerKind:
    | "meta_session_state"
    | "context_registry_state"
    | "contract_state"
    | "instruction_state"
    | "transition_state"
    | "route_state"
    | "ledger_state"
    | "projection_state";
  producers: string[];
  consumers: string[];
  codeAnchors: {
    producers: string[];
    consumers: string[];
    ipcChannels: string[];
    shellEvents: string[];
    storageSlots: string[];
  };
  evidenceAuthority: string[];
  statusLattice: string[];
  projections: string[];
  mutationRoutes: string[];
  staleEventRisks: string[];
  unsupportedStates: string[];
  preservationSentinels: string[];
  validationRefs: string[];
  rawTextIncluded: false;
  digest: string;
};
```

Phase 1A descriptors may point to planned code anchors if the implementation
owner is intentionally not built yet, but the descriptor must say that the owner
is absent rather than implying runtime authority.

`storageSlots` are symbolic store slots, not raw filesystem paths.

### HOB Obligation Status

HOB rows make inherited obligations explicit:

```ts
type DirectMetaHobObligationStatusV1 = {
  schemaVersion: "direct_meta_hob_obligation_status@1";
  rowId: string;
  ownerStateObjectId: string;
  obligationId: string;
  status:
    | "covered"
    | "proved_irrelevant"
    | "pass_through"
    | "deferred_with_risk"
    | "blocked_pending_evidence";
  evidenceRefs: DirectMetaSourceRefV1[];
  evidenceAuthority: "spec" | "fixture" | "diagnostic" | "derived" | "future";
  coverageKind:
    | "covered_terminalized"
    | "covered_by_probe_matrix"
    | "covered_by_reference_observation"
    | "covered_by_source_tail"
    | "scoped_ready_only"
    | "unknown";
  readinessPosture: "ready" | "diagnostic" | "blocked" | "future";
  rendererSafeSummary: string;
  rawTextIncluded: false;
  digest: string;
};
```

### Transition Claim

OTB rows exist before mutation-capable routes:

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

This prevents the invalid shortcut:

```text
artifact exists -> transition assumed legal
```

### Upstream Discriminator Row

Required when two branches would otherwise be flattened into one rule:

```ts
type DirectMetaUpstreamDiscriminatorRowV1 = {
  schemaVersion: "direct_meta_upstream_discriminator_row@1";
  rowId: string;
  ownerStateObjectId: string;
  conflictingBranches: Array<{
    branchId: string;
    rendererSafeSummary: string;
    expectedLawRef: string;
    regressionLockRef?: string;
  }>;
  proposedDiscriminator: {
    discriminatorId: string;
    discriminatorKind:
      | "runtime_source_class"
      | "authority_mode"
      | "projection_freshness"
      | "context_jurisdiction"
      | "contract_epoch"
      | "surface_trust"
      | "worker_depth"
      | "other";
    rendererSafeRule: string;
  };
  counterfactualProbeRefs: string[];
  status:
    | "proposed"
    | "observed"
    | "specified_by_contract"
    | "rejected"
    | "blocked";
  rawTextIncluded: false;
  digest: string;
};
```

### BRL Replay-Lock Manifest

BRL rows protect observations before shared projection refactors:

```ts
type DirectMetaBrlReplayLockManifestV1 = {
  schemaVersion: "direct_meta_brl_replay_lock_manifest@1";
  lockId: string;
  ownerSurface: string;
  protectedSurfaces: string[];
  ignoredSurfaces: string[];
  observedSurfaceRefs: DirectMetaArtifactRefV1[];
  canonicalizationProfile: string;
  expectedObservationHash: string;
  canonicalObservationHash?: string;
  rawObservationHash?: string;
  expectedHashProvenance: string;
  environmentProfileRef?: DirectMetaArtifactRefV1;
  mutationPolicy: "non_mutating" | "mutating_with_after_hash" | "future";
  manifestLifecycle: "draft" | "locked" | "retired";
  failureMeaning: "protected_projection_changed_not_product_truth";
  validationCommandRef?: {
    commandKind: "npm_script" | "fixture_runner" | "future";
    rendererSafeCommandLabel: string;
    argvDigest?: string;
    rawCommandIncluded: false;
  };
  rawTextIncluded: false;
  digest: string;
};
```

The manifest must contain an expected observation hash. Otherwise it is only a
note, not a replay lock. Raw shell commands are not stored.

### Current Pointer Set

Pointer sets are scoped:

```ts
type DirectMetaCurrentPointerSetV1 = {
  schemaVersion: "direct_meta_current_pointer_set@1";
  pointerSetId: string;
  scopeKind: "global" | "surface" | "meta_session" | "execution_context";
  scopeId: string;
  currentMetaSessionId?: string;
  currentContractId?: string;
  currentContractVersion?: number;
  currentSessionEpoch?: number;
  currentContextRegistryId?: string;
  currentLedgerHead?: string;
  indexDigest?: string;
  pointerSetDigest: string;
};
```

Pointers advance only after:

```text
schema validation passes
raw-exposure scan passes
artifact digest is stable
ledger event append succeeds
ledger head is verified
```

Blocked, failed, raw-exposure, or corrupt artifacts are attempt history only.

### Attempt Failure

Attempt failure artifact:

```ts
type DirectMetaSessionAttemptFailureV1 = {
  schemaVersion: "direct_meta_session_attempt_failure@1";
  attemptId: string;
  attemptKind:
    | "session"
    | "context_registry"
    | "contract"
    | "descriptor"
    | "hob"
    | "transition_claim"
    | "upstream_discriminator"
    | "brl"
    | "pointer"
    | "projection";
  blockerCode: DirectMetaSessionBlockerCodeV1;
  rendererSafeSummary: string;
  currentPointersChanged: false;
  rawTextIncluded: false;
  digest: string;
};
```

## Ledger

Ledger event shape:

```ts
type DirectMetaSessionEventV1 = {
  schemaVersion: "direct_meta_session_event@1";
  eventId: string;
  sequence: number;
  eventKind:
    | "meta_session_created"
    | "execution_context_registry_recorded"
    | "state_object_descriptor_recorded"
    | "run_contract_drafted"
    | "run_contract_locked"
    | "run_contract_activated"
    | "hob_obligation_status_recorded"
    | "transition_claim_recorded"
    | "upstream_discriminator_recorded"
    | "brl_replay_lock_manifest_recorded"
    | "current_pointer_set_updated"
    | "attempt_failure_recorded"
    | "status_projection_recorded";
  metaSessionId: string;
  artifactRefs: DirectMetaArtifactRefV1[];
  previousEventDigest?: string;
  eventBodyDigest: string;
  eventDigest: string;
  ledgerHeadDigest: string;
  createdAt: string;
};
```

Manifest shape:

```ts
type DirectMetaSessionEventLedgerManifestV1 = {
  schemaVersion: "direct_meta_session_event_ledger_manifest@1";
  metaSessionId: string;
  eventCount: number;
  ledgerHeadDigest?: string;
  lastSequence: number;
  corrupted: boolean;
  digest: string;
};
```

Ledger verification checks:

```text
sequence is monotonic
previousEventDigest matches prior eventDigest
eventBodyDigest matches event without eventDigest and ledgerHeadDigest
eventDigest matches previousEventDigest + eventBodyDigest
ledgerHeadDigest equals eventDigest for the current event
manifest lastSequence/eventCount/head match event files
```

If verification fails, projection returns degraded status and pointer
advancement is blocked with `ledger_corrupt`.

## Store API

Export from `index.js`:

```js
module.exports = {
  DirectMetaSessionStore,
  buildDirectMetaSessionStatusProjection,
  validateDirectMetaSessionArtifact,
  assertMetaSessionRendererSafe,
  verifyDirectMetaSessionLedger,
  DIRECT_META_SESSION_BLOCKER_CODES,
};
```

Initial store methods:

```js
createMetaSession(input)
recordExecutionContextRegistry(metaSessionId, input)
recordStateObjectDescriptor(metaSessionId, input)
draftRunContract(metaSessionId, input)
lockRunContract(metaSessionId, contractId)
activateRunContract(metaSessionId, contractId)
recordHobObligationStatus(metaSessionId, input)
recordTransitionClaim(metaSessionId, input)
recordUpstreamDiscriminator(metaSessionId, input)
recordBrlReplayLockManifest(metaSessionId, input)
recordAttemptFailure(metaSessionId, input)
readCurrentPointers(metaSessionId)
buildStatusProjection(metaSessionId)
verifyLedger(metaSessionId)
```

Every write method returns:

```ts
{
  ok: boolean;
  artifact?: object;
  artifactRef?: DirectMetaArtifactRefV1;
  ledgerEvent?: DirectMetaSessionEventV1;
  currentPointerSet?: DirectMetaCurrentPointerSetV1;
  blockerCode?: DirectMetaSessionBlockerCodeV1;
  attemptFailure?: DirectMetaSessionAttemptFailureV1;
}
```

Errors caused by invalid fixture input should become failed return objects when
the invalid input is part of the regression surface. Programmer errors can
throw.

## Pointer Advancement Order

For a valid artifact:

```text
normalize input
build artifact without digest
calculate digest
validate schema
run raw-exposure scan
write artifact atomically
append artifact_recorded ledger event atomically
verify ledger head
build next pointer set if this artifact updates current state
append current_pointer_set_updated event
write current pointer set atomically citing the pointer-update ledger head
return artifact + event + pointer
```

For an invalid artifact:

```text
build minimal safe attempt failure
validate attempt failure
raw-exposure scan attempt failure
write attempt failure atomically
append attempt_failure_recorded event if ledger is healthy
leave current pointers unchanged
return blocker
```

Do not partially update a pointer before the artifact and event are durable.

No current pointer may cite a ledger head that does not include the
`current_pointer_set_updated` event for that pointer state.

## Status Projection

Phase 1A status projection is read-only:

```ts
type DirectMetaSessionStatusProjectionV1 = {
  schemaVersion: "direct_meta_session_status_projection@1";
  projectionId: string;
  metaSessionId?: string;
  generatedAt: string;
  sourceDigest: string;
  ledgerHeadDigest?: string;
  health:
    | "ok"
    | "degraded"
    | "missing"
    | "ledger_corrupt"
    | "raw_exposure_blocked"
    | "schema_invalid";
  currentPointers?: DirectMetaCurrentPointerSetV1;
  counts: {
    contexts: number;
    contracts: number;
    descriptors: number;
    hobRows: number;
    transitionClaims: number;
    upstreamDiscriminators: number;
    brlManifests: number;
    ledgerEvents: number;
    attemptFailures: number;
  };
  capabilities: {
    statusRead: true;
    mutationIpcAvailable: false;
    workerSpawnAvailable: false;
    routeDispatchAvailable: false;
    transitionEnforceAvailable: false;
    semanticBrokerRerouteAvailable: false;
  };
  actionability: {
    actionable: false;
    allowedActions: [];
  };
  rawTextIncluded: false;
  rawTranscriptIncluded: false;
  rawPathIncluded: false;
  rawChatGptUrlIncluded: false;
  rawProviderPayloadIncluded: false;
};
```

Projection reads must not rebuild missing artifacts implicitly. They may report
missing/stale/corrupt. Refresh/rebuild endpoints are future work.

`sourceDigest` is deterministic over:

```text
current pointer set digest
ledger head digest
counted artifact refs
projection schema version
```

It must exclude `generatedAt`.

## Regression Script

Create `scripts/direct-meta-session-control-plane-regression.mjs`.

Minimum cases:

```text
create_meta_session_writes_session_and_ledger_event
source_ref_schema_required_for_all_evidence_refs
artifact_ref_digest_required_for_all_artifact_refs
index_json_created_and_digest_valid
two_contexts_same_label_do_not_collapse
context_digest_changes_when_jurisdiction_changes
state_object_descriptor_requires_code_anchors
storage_slots_are_symbolic_not_raw_paths
hob_rows_accept_all_status_values
hob_rows_include_evidence_authority_coverage_kind_and_readiness
activation_blocked_when_meta_session_not_open
contract_lock_does_not_equal_activation_authority
session_epoch_law_is_stable
run_contract_draft_lock_activate_advances_epoch
transition_claim_recorded_before_mutation_routes
transition_claim_requires_oedu_bridge_fields
transition_claim_forbidden_evidence_is_recorded
upstream_discriminator_required_for_flattened_runtime_source_rule
brl_manifest_recorded_for_status_projection_owner
brl_manifest_requires_expected_observation_hash
brl_validation_command_is_ref_not_raw_shell
canonical_digest_domain_separates_artifact_kinds
event_digest_excludes_eventDigest_and_ledgerHeadDigest
ledger_head_digest_chain_detects_reordered_events
pointer_update_is_ledgered_before_pointer_becomes_current
raw_path_blocks_pointer_update
raw_provider_payload_blocks_pointer_update
invalid_schema_writes_attempt_failure
ledger_hash_chain_corruption_blocks_pointer_advance
status_projection_source_digest_excludes_generatedAt
status_projection_is_renderer_safe
status_projection_actionability_false
phase_1a_capabilities_all_non_authority
node_check_covers_every_new_meta_session_file
no_ipc_modules_touched_in_phase_1a
sentinel_counters_all_zero
```

Sentinel counters:

```ts
{
  providerTransportCalls: 0,
  appServerSpawnCalls: 0,
  appServerMutationCalls: 0,
  workspaceReadCalls: 0,
  patchApplyCalls: 0,
  commandRunCalls: 0,
  contextPackBuilds: 0,
  requestManifestBuilds: 0,
  directSessionCreates: 0,
  runtimeTierMutationCalls: 0,
  rightPaneMutationCalls: 0,
  handoffMutationCalls: 0,
  workerSpawnCalls: 0,
  routeDispatchCalls: 0,
  transitionEnforceCalls: 0
}
```

The script should write a report under the temp root:

```text
direct-meta-session-control-plane-report.json
```

Report fields:

```ts
{
  schema: "direct_meta_session_control_plane_report@1",
  generatedAt,
  coverageSource: "fixture_meta_session_control_plane",
  matrixPromotionCandidate: false,
  authorityPromotionCandidate: false,
  runtimeAuthorityExercised: false,
  providerAuthorityExercised: false,
  cases,
  sentinelCounters,
  rawExposureScan,
  result: "passed" | "failed"
}
```

## Syntax And Validation Gates

Implementation PR should run:

```text
npm run check:syntax
npm run direct:meta-session-control-plane
```

Optional broader gate:

```text
npm run validate
```

Do not add live/provider tests for this slice.

## Expected PR Shape

First implementation PR should include:

```text
src/main/direct/meta-session/*.js
scripts/direct-meta-session-control-plane-regression.mjs
package.json script updates
docs/README.md link already present or preserved
```

It should not include:

```text
renderer UI workbench
preload bridge mutation APIs
runtime controller changes
provider request changes
context-pack/request-manifest inclusion
worker/sub-agent orchestration
enforce-mode gates
```

## Implementation Order

Recommended order:

```text
1. constants.js, blocker-codes.js, ids.js
2. digest.js with domain-separated digest functions
3. source-ref.js / artifact-ref helpers
4. raw-exposure.js with finding objects and placeholder allowances
5. schemas.js validation functions
6. ledger.js with non-circular event/head digests
7. current-pointers.js with ledgered pointer updates
8. store.js write methods and attempt failure handling
9. projection.js renderer-safe status projection
10. fixtures.js fixture builders
11. direct-meta-session-control-plane-regression.mjs
12. package.json script and syntax coverage for every new file
```

Keep every function deterministic where possible. Inject `now` and `randomId`
in tests.

## Code Review Checklist

Reviewers should reject the implementation if:

```text
MetaSessionStore writes through DirectSessionStore
provider transport can be reached
app-server spawn or mutation can be reached
workspace reads, patches, or commands can be reached
raw paths/provider payloads/transcripts appear in projections or reports
current pointers advance after failed validation
ledger corruption is ignored
shadow artifacts block runtime behavior
status projection exposes actionability
mutation IPC appears without IpcChannelContract
any IPC appears in Phase 1A
```

## Done Criteria

Phase 1A is complete when:

```text
artifact store exists
source/artifact refs exist
index schema exists
schema validation exists
raw-exposure scan exists
domain-separated digest helpers exist
ledger hash chain exists
current pointer update law is tested
state-object descriptors exist
HOB / OTB / upstream-discriminator / BRL rows exist
status projection is renderer-safe and non-actionable
fixture regression passes
syntax checks pass
no runtime/provider/workspace/app-server authority path is exercised
```
