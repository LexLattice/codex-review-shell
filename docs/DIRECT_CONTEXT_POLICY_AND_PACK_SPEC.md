# Direct Context Policy And Pack Spec

Status: implementation specification for the next direct-runtime storage bundle
on the long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md](./DIRECT_IMPORT_CHECKPOINT_CONTINUATION_SPEC.md)
- [DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md](./DIRECT_READONLY_TOOL_CONTINUATION_SPEC.md)
- [DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md](./DIRECT_EXPERIMENTAL_PROJECT_ACTIVATION_SPEC.md)

## Purpose

Add the first direct context construction layer:

```text
renderer/imported/direct artifacts
  -> renderer_transcript projection
  -> context_recent_dialogue projection
  -> direct_context_pack artifact
  -> direct_request_manifest artifact/row
  -> request_built turn evidence
```

The previous bundle proved that direct/imported session artifacts can be indexed
and projected into renderer-safe transcript views. This bundle defines how the
direct runtime can turn selected projections into explicit, auditable model
input without parsing raw rollout/session files ad hoc.

The core invariant remains:

```text
canonical rollout/session artifacts preserve what happened
projections are rebuildable information views
context packs record what the model was actually given
request manifests record how the request was allowed to be sent
```

## Why This Next

The current direct branch has:

- direct session artifacts;
- SQLite thread/index/projection store;
- `renderer_transcript@1` projections;
- `compact_transcript@1` deterministic derived projections;
- direct live text and import checkpoint continuation request paths.

The missing bridge is:

```text
safe projection -> exact model context -> request manifest
```

Without this layer, every future direct request, compaction pass, recovery flow,
or merge/prune experiment would be tempted to assemble context directly from raw
session files or renderer rows. That would make context behavior hard to audit
and would violate the projection-store doctrine.

## Decision

Implement a context policy and context pack module for direct-owned runtime
requests.

Initial modules:

```text
DirectContextPolicyRegistry
  -> owns built-in policy definitions and policy digests
  -> persists policy snapshots/artifacts outside SQLite-only state

DirectContextProjectionBuilder
  -> derives context_recent_dialogue@1 from valid renderer_transcript@1
  -> frames transcript text as historical evidence, not instruction authority

DirectContextPackBuilder
  -> builds direct_context_pack@1 artifacts from context-safe projections,
     harness policy, and current user intent

DirectRequestManifestBuilder
  -> records request-shape, model/evidence, endpoint class/hash, and feature
     flags without storing raw auth or raw backend request bodies
```

This bundle should prepare `projection_read` and `context_build_required`, but
must not silently enable either mode. The existing runtime remains explicit and
direct-experimental.

## Boundary

This bundle does:

- add context/projection policy artifacts or equivalent policy snapshots;
- add a context-safe `context_recent_dialogue@1` projection;
- build and persist `direct_context_pack@1` artifacts before direct requests;
- build and persist `direct_request_manifest@1` artifacts/rows before direct
  requests;
- make direct live text turns cite `contextBuildId` and `requestManifestId`;
- make import checkpoint continuation turns cite `contextBuildId` and
  `requestManifestId`;
- store request manifests in `direct_request_manifests`;
- store context build rows in `direct_context_builds`;
- add crash/recovery classifications for orphan context packs and request
  manifests;
- keep raw request body, raw auth, raw backend frames, and tokens below the
  main-process boundary.

It does not:

- make production `direct` mode available;
- make direct runtime the default;
- enable write/shell/network tools;
- make compact projections usable as context;
- let renderer projections directly become model context;
- import right-pane ChatGPT transcript content;
- implement semantic/model-generated compaction;
- implement merge/prune/fork/bridge runtime behavior;
- remove the legacy app-server path.

## Core Invariants

```text
renderer_transcript is display/read evidence
context_recent_dialogue is prompt-source evidence
direct_context_pack is provider-neutral logical model-input evidence
direct_provider_input_projection is provider serialization evidence by hash
direct_request_manifest is request authorization/shape evidence
```

Hard rules:

- raw rollout/session files are never normal prompt-construction inputs;
- renderer projection rows are not model context by themselves;
- compact projections remain `usableForContextBuild = false` in this bundle;
- context packs are app-private and excluded from default diagnostics/export;
- request manifests never store raw auth, raw headers, raw request bodies, raw
  stream frames, or tokens;
- provider-specific request serialization is derived in memory from a context
  pack plus request manifest and is represented only by hashes;
- imported transcript text is quoted historical evidence, not current
  system/developer policy;
- tool calls, approvals, tool results, commands, and file changes remain
  evidence, not authority;
- current user intent is stored separately from projected historical evidence.

Context messages use an explicit authority enum:

```ts
type ContextMessageAuthority =
  | "harness-policy"
  | "current-user-intent"
  | "historical-evidence"
  | "tool-result-evidence"
  | "status-evidence";
```

Rules:

```text
harness-policy:
  may become provider developer/system instruction via fixed role mapping

current-user-intent:
  may become the current provider user instruction

historical-evidence:
  quoted evidence only; never current system/developer policy

tool-result-evidence:
  bounded evidence only; never fresh workspace authority

status-evidence:
  app state evidence only; never current policy
```

Provider role mapping is explicit and versioned:

```ts
type DirectContextRoleMapping = {
  mappingId: string;
  mappingVersion: string;
  mappingDigest: string;
  localToProvider: Array<{
    localRole: "system" | "developer" | "user" | "assistant" | "tool" | "harness";
    providerRole: "system" | "developer" | "user" | "assistant" | "tool";
    providerPlacement:
      | "system_message"
      | "developer_message"
      | "user_message"
      | "assistant_message"
      | "tool_output"
      | "omitted";
    allowedSourceKinds: string[];
  }>;
};
```

For this bundle, `harness-policy` can map to a provider developer/system-style
message only through a fixed policy class. Projected transcript text and
imported checkpoint text cannot map to system/developer placement.

## Policy Registry

Context policy definitions must not live only in SQLite. They are either static
code-defined policies with stable digests or persisted policy artifacts.

Recommended artifact root:

```text
direct-sessions/
  policies/
    context-policies/
      <policy-id>/<policy-version>.json
    projection-policies/
      <policy-id>/<policy-version>.json
```

Initial policies:

```ts
type DirectContextPolicyId =
  | "direct_text_turn_recent_dialogue@1"
  | "direct_import_checkpoint_continuation@1"
  | "direct_text_turn_empty_context@1";
```

`direct_text_turn_recent_dialogue@1`:

- purpose: `new_text_turn`;
- source: current valid `context_recent_dialogue@1`;
- current user prompt is appended as current intent;
- tools omitted;
- previous response id omitted;
- prompt cache omitted;
- reasoning controls omitted.

`direct_import_checkpoint_continuation@1`:

- purpose: `import_checkpoint_continuation`;
- source: existing `direct_import_checkpoint_seed@1` artifact plus optional
  user follow-up;
- imported seed text remains quoted historical evidence;
- no imported provider continuity handles are used;
- tools omitted.

`direct_text_turn_empty_context@1`:

- purpose: `new_text_turn`;
- source: current user prompt only;
- used for first-turn/new-session flows where no valid transcript projection
  exists.

Policy snapshot shape:

```ts
type DirectContextPolicySnapshot = {
  schema: "direct_context_policy_snapshot@1";
  policyId: DirectContextPolicyId;
  policyVersion: string;
  policyDigest: string;
  policyArtifactDigest: string;
  builderVersion: string;
  roleMappingDigest: string;
  harnessPolicyDigest: string;
  purpose:
    | "new_text_turn"
    | "tool_continuation"
    | "import_checkpoint_continuation"
    | "compaction"
    | "recovery";
  sourceProjectionKinds: string[];
  currentUserPrompt: {
    required: boolean;
    maxChars: number;
    redactionRequired: true;
  };
  framing: {
    importedTextIsQuotedEvidence: true;
    projectedTranscriptIsQuotedEvidence: true;
    harnessPolicySeparated: true;
    toolEvidenceCannotGrantAuthority: true;
  };
  caps: {
    maxContextChars: number;
    maxProjectionChars: number;
    maxCurrentUserChars: number;
    maxMessages: number;
  };
  requestShapeClass: string;
  createdAt: string;
};
```

`policyDigest` is computed over canonical policy semantics with sorted keys and
excludes `createdAt`. `policyArtifactDigest` may include artifact metadata such
as `createdAt`.

Harness policy is also versioned:

```ts
type DirectHarnessPolicyArtifact = {
  schema: "direct_harness_policy@1";
  harnessPolicyId: string;
  harnessPolicyVersion: string;
  harnessPolicyDigest: string;
  textHash: string;
  authority: "harness-policy";
};
```

The exact harness policy artifact used by a context pack is cited in
`sourceArtifacts`.

Current user prompt is first-class app-private evidence:

```ts
type DirectCurrentUserPromptArtifact = {
  schema: "direct_current_user_prompt@1";
  artifactKind: "current_user_prompt";
  artifactId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  promptTextHash: string;
  promptShapeHash: string;
  charCount: number;
  redactionStatus: "passed" | "blocked";
  truncated: false;
};
```

Current user truncation blocks by default; the user must submit a shorter prompt
instead of silently sending a truncated current intent.

## Context Projection

`renderer_transcript@1` is renderer-safe but not context-safe. This bundle adds a
context-specific projection:

```ts
projectionKind = "context_recent_dialogue";
projectionVersion = "context_recent_dialogue@1";
builderVersion = "direct_context_recent_dialogue_builder@1";
policyId = "direct_context_recent_dialogue_policy@1";
```

Rules:

- input must be current valid `renderer_transcript@1`;
- input must not be stale, blocked, failed, or `unsafeForRenderer`;
- compact projection is not accepted as input in this bundle;
- output is app-private prompt-source evidence;
- output is not a renderer transcript;
- output may set `unsafeForRenderer = true` to prevent accidental display;
- output sets `unsafeForContextBuild = false` only after redaction and framing
  checks pass.

Resolution must use projection-kind-specific current pointers:

```text
renderer source:
  current_renderer_projection_id

context source:
  current_context_recent_dialogue_projection_id or equivalent current-by-kind row

never use:
  current_compact_projection_id
  stale renderer projection
  last projection attempt
  blocked projection
```

Context source digest is canonical:

```ts
contextRecentDialogueSourceDigest = hash(canonicalJson({
  schema: "context_recent_dialogue_source@1",
  rendererProjectionId,
  rendererProjectionDigest,
  rendererProjectionVersion,
  selectedItemStableKeys,
  selectedItemTextDigests,
  operationLedgerHeadDigest,
  builderVersion,
  policyDigest,
  redactionVersion,
  caps,
}));
```

Do not include:

```text
context projection id being built
build timestamp
raw text bodies unless already represented by item text digests
```

For this bundle, `context_recent_dialogue@1` derives from the text rows available
under `renderer_transcript@1` caps. If the renderer projection truncated content,
the context projection must record that truncation and cannot imply full history
was available.

Allowed source item kinds:

```text
user_message
assistant_message
tool_call       -> bounded evidence summary only
tool_result     -> bounded evidence summary only
status          -> bounded state summary only
checkpoint_seed -> lineage/summary only, never full seed text
```

Excluded:

```text
raw reasoning
diagnostic payloads
raw backend events
raw imported JSONL
raw source paths
auth-like material
unbounded tool results
active approval controls
system/developer/runtime policy imported from legacy sources
```

Context projection item shape:

```ts
type DirectContextRecentDialogueItem = {
  itemId: string;
  stableSourceItemKey: string;
  sourceRendererProjectionId: string;
  sourceRendererItemId: string;
  threadId: string;
  turnId?: string;
  role: "user" | "assistant" | "harness";
  sourceKind: "projection" | "obligation" | "status";
  text: string;
  textDigest: string;
  textTruncated: boolean;
  omittedCounts: Record<string, number>;
  framing: {
    quotedEvidence: true;
    instructionAuthority: false;
    toolAuthority: false;
  };
  flags: {
    rendererSafe: false;
    usableForContextBuild: true;
    rawCredentialsExposed: false;
    rawPathExposed: false;
    rawBackendFrameExposed: false;
  };
};
```

If any item cannot be made context-safe, the context projection is `blocked` and
cannot be used to build a context pack.

## Context Pack

Context packs are exact app-private evidence for model input.

Recommended artifact root:

```text
direct-sessions/
  rollouts/<project-id>/<thread-id>/context-packs/
    <context-build-id>.json
```

Schema:

```ts
type DirectContextPack = {
  schema: "direct_context_pack@1";
  contextBuildId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  builtAt: string;

  policy: {
    policyId: DirectContextPolicyId;
    policyVersion: string;
    policyDigest: string;
    policySnapshot: DirectContextPolicySnapshot;
    purpose:
      | "new_text_turn"
      | "tool_continuation"
      | "import_checkpoint_continuation"
      | "compaction"
      | "recovery";
  };

  sourceProjections: Array<{
    projectionId: string;
    projectionKind: string;
    projectionVersion: string;
    projectionDigest: string;
    sourceRolloutIds: string[];
    sourceEventRangeDigest: string;
    unsafeForContextBuild: false;
  }>;

  sourceArtifacts: Array<{
    artifactKind:
      | "checkpoint_seed"
      | "tool_result"
      | "current_user_prompt"
      | "harness_policy";
    artifactId: string;
    artifactDigest: string;
    appPrivate: true;
  }>;

  content: {
    instructionsClass: string;
    messages: Array<{
      role: "system" | "developer" | "user" | "assistant" | "tool" | "harness";
      text: string;
      sourceKind:
        | "current-user"
        | "projection"
        | "checkpoint-seed"
        | "obligation"
        | "harness-policy";
      sourceRef?: string;
      quotedEvidence: boolean;
      authority: ContextMessageAuthority;
    }>;
  };

  caps: {
    maxChars: number;
    maxProjectionChars: number;
    maxCurrentUserChars: number;
    truncated: boolean;
    omittedCounts: Record<string, number>;
  };

  digest: {
    contentHash: string;
    shapeHash: string;
    redactionVersion: string;
  };

  budget: {
    modelContextWindowEstimate?: number;
    estimatedInputTokens?: number;
    reservedReasoningAndOutputTokens?: number;
    budgetPolicyId: string;
    budgetExceeded: boolean;
  };

  integrity: {
    algorithm: "hmac-sha256" | "sha256";
    keyId?: string;
    artifactDigest: string;
    previousArtifactDigest?: string;
  };

  retention: {
    class: "app-private-context-evidence";
    defaultExport: false;
    redactionRequiredForExport: true;
    purgeEligibleAfter?: string;
  };

  safety: {
    rawAuthExposed: false;
    rawPathExposed: false;
    rawBackendFrameExposed: false;
    rawRequestBodyStored: false;
    importedPolicyAuthorityCarried: false;
    toolAuthorityGrantedByTranscript: false;
  };
};
```

The context pack may contain sensitive project/user text. It is safe for main
process storage, not for default renderer state or default diagnostics export.

Context packs are idempotent by canonical input key:

```ts
type DirectContextBuildInputKey = {
  projectId: string;
  threadId: string;
  turnId: string;
  policyDigest: string;
  sourceProjectionDigests: string[];
  sourceArtifactDigests: string[];
  currentUserPromptHash?: string;
  capsDigest: string;
  builderVersion: string;
  redactionVersion: string;
};
```

Rules:

```text
same input key:
  return existing contextBuildId

different input key before provider transport:
  create a new build attempt and supersede old pre-transport build

different input key after provider transport started:
  never mutate the old context pack
```

Blocked context build attempts are persisted as safe summaries:

```ts
type DirectContextBuildAttempt = {
  contextBuildAttemptId: string;
  turnId: string;
  status: "blocked" | "failed";
  blockerCode: DirectContextBuildBlocker;
  rendererSafeMessage: string;
  rawContextExposed: false;
  providerRequestStarted: false;
};
```

Unsafe context text is not written when redaction, caps, or raw-exposure checks
block the build.

## Request Manifest

The context pack records context material. The request manifest records the
runtime request decision.

Recommended artifact root:

```text
direct-sessions/
  rollouts/<project-id>/<thread-id>/request-manifests/
    <request-manifest-id>.json
```

Schema:

```ts
type DirectRequestManifest = {
  schema: "direct_request_manifest@1";
  requestManifestId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  contextBuildId: string;
  builtAt: string;

  runtimeMode: "direct-experimental";
  transport: "live-text";
  model: string;
  modelEvidenceRef: string;
  modelEvidenceState: "accepted" | "runtime_probed";
  endpointClass: string;
  endpointHash: string;
  requestShapeHash: string;
  requestShapeClass:
    | "text_only"
    | "import_checkpoint_continuation"
    | "read_only_tool_continuation";

  enabledFeatures: {
    store: false;
    tools: boolean;
    previousResponseId: boolean;
    reasoning: boolean;
    structuredOutput: boolean;
    serviceTier: boolean;
    promptCache: boolean;
    includes: boolean;
  };

  continuity: {
    previousResponseIdUsed: false;
    providerContinuityHandleUsed: false;
    importedContinuityHandleUsed: false;
    continuityPolicy: "fresh_request";
  };

  capabilityEvidence: {
    modelEvidenceRef: string;
    requestShapeEvidenceRef: string;
    endpointEvidenceRef: string;
    contextPolicyEvidenceRef?: string;
  };

  context: {
    contextBuildId: string;
    contextPackContentHash: string;
    contextPackShapeHash: string;
    policyDigest: string;
    roleMappingDigest: string;
  };

  providerInputProjection: {
    providerInputProjectionId: string;
    provider: "chatgpt-codex-responses";
    requestShapeClass: string;
    roleMappingDigest: string;
    providerInputShapeHash: string;
    providerInputTextHash: string;
    rawRequestBodyStored: false;
  };

  safety: {
    rawAuthExposed: false;
    rawHeadersStored: false;
    rawRequestBodyStored: false;
    rawBackendFrameStored: false;
    rendererExposed: false;
  };

  requestBodyStorageAudit: {
    rawBodyPersisted: false;
    rawHeadersPersisted: false;
    scanVersion: string;
  };
};
```

The manifest may store request shape and feature flags. It must not store the
raw provider request body, access token, refresh token, auth headers, cookies, or
raw backend stream frames.

Request manifests are idempotent by canonical input key:

```ts
type DirectRequestManifestInputKey = {
  projectId: string;
  threadId: string;
  turnId: string;
  contextBuildId: string;
  model: string;
  modelEvidenceRef: string;
  endpointHash: string;
  requestShapeHash: string;
  requestBuilderVersion: string;
  roleMappingDigest: string;
};
```

Rules:

```text
same input key:
  return existing requestManifestId

different manifest for same turn before request_built:
  create a new manifest attempt and supersede old pre-transport manifest

different manifest after request_built:
  requires a new turn or explicit failed/replaced pre-transport state
```

The provider-specific request body is generated in memory from:

```text
direct_context_pack + direct_request_manifest + role mapping
```

It must be possible to regenerate the same `providerInputTextHash` and
`providerInputShapeHash` from those artifacts without reading raw session,
rollout, renderer rows, or imported JSONL files.

## Request Construction Flows

### Direct Live Text Turn

```text
turn/start
  -> validate direct runtime/auth/model evidence
  -> resolve context policy
  -> build/refresh context_recent_dialogue projection when applicable
  -> build direct_context_pack
  -> build direct_request_manifest
  -> write turn request_built state citing both ids
  -> send provider request
```

First-turn sessions may use `direct_text_turn_empty_context@1`.

Empty context means:

```text
- no historical projection source
- harness policy is still present
- current user prompt is required
- sourceProjections = []
- sourceArtifacts includes current_user_prompt and harness_policy
- omittedCounts.history = 0
```

It does not mean "no harness policy".

Non-first-turn sessions use `direct_text_turn_recent_dialogue@1` only when a
valid context projection exists. If projection state is stale/blocked/corrupt,
new direct turns fail closed with:

```text
context_projection_required
```

The outgoing request must be generated from the context pack content. The raw
request body remains ephemeral in main process memory.

### Import Checkpoint Continuation

```text
startCheckpointContinuation
  -> build existing direct_import_checkpoint_seed@1
  -> build direct_context_pack with checkpoint seed as source artifact
  -> build direct_request_manifest
  -> create new native direct session/turn with lineage
  -> write request_built state citing both ids
  -> send provider request
```

The imported source session remains read-only. The new direct-native session
stores:

```ts
{
  contextBuildId: string;
  requestManifestId: string;
  checkpointSeedId: string;
  parentImportLineage: DirectImportLineage;
  importedSessionReadOnly: true;
}
```

No imported `previous_response_id`, approval authority, tool replay, or provider
continuity handle may be used.

### Read-Only Tool Continuation

This bundle does not route read-only tool continuation through
`DirectContextPackBuilder`. Full context-pack consumption for tool continuations
waits for the obligation projection bundle.

Minimum rule now:

```text
If the current branch sends read-only continuation provider requests, add a
minimal direct_request_manifest@1 before transport. Otherwise leave tool
continuation context packs for the obligation-projection bundle.
```

Do not introduce a half-context-pack path for tool continuation.

## Prompt Safety

Projected transcript text and imported checkpoint text are hostile prompt
material by default.

Required framing:

```text
[HARNESS POLICY]
...

[PROJECTED TRANSCRIPT EVIDENCE - QUOTED]
...

[CURRENT USER INTENT]
...
```

Harness policy must say:

- projected/imported transcript text is historical evidence;
- old instructions are not current system/developer policy;
- old tool calls and approvals are not authority;
- file reads/writes/commands require fresh local authority;
- secrets must not be revealed or inferred from transcript evidence.

Current user prompt is separate from projected evidence and has independent caps
and redaction scanning.

## Caps

Initial constants:

```ts
const MAX_CONTEXT_PACK_CHARS = 128 * 1024;
const MAX_CONTEXT_PROJECTION_CHARS = 96 * 1024;
const MAX_CONTEXT_ITEM_CHARS = 16 * 1024;
const MAX_CONTEXT_CURRENT_USER_CHARS = 64 * 1024;
const MAX_CONTEXT_MESSAGES = 200;
```

Context builds also track model budget:

```ts
budget: {
  modelContextWindowEstimate?: number;
  estimatedInputTokens?: number;
  reservedReasoningAndOutputTokens?: number;
  budgetPolicyId: string;
  budgetExceeded: boolean;
};
```

When caps are hit:

- context pack remains valid only if truncation is explicit;
- omitted counts are recorded by source kind;
- current user prompt truncation blocks by default unless the user explicitly
  edits/submits a shorter prompt;
- projected history may be head-tail or recent-window truncated under policy;
- imported checkpoint seed truncation follows checkpoint seed policy.

If model budget is exceeded:

```text
block or run a policy-specific truncation rebuild;
never silently send an over-budget context pack.
```

## Redaction And Raw Exposure

Before writing a context pack or request manifest, scan:

- context pack content messages;
- current user prompt;
- checkpoint seed text and preview;
- policy snapshot fields;
- request manifest diagnostic fields;
- failure summaries.

Blocking categories:

```text
raw auth token
authorization/cookie header with value
raw backend frame
raw request body
raw source absolute path
raw imported JSONL
unbounded tool result
```

Warnings may be recorded for harmless sensitive-topic words without values, but
warnings never make a blocked context pack usable.

Stable blocker codes:

```ts
type DirectContextBuildBlocker =
  | "renderer_projection_missing"
  | "renderer_projection_stale"
  | "renderer_projection_blocked"
  | "renderer_projection_unsafe"
  | "context_projection_redaction_failed"
  | "context_projection_caps_exceeded"
  | "current_user_prompt_too_large"
  | "current_user_prompt_redaction_failed"
  | "checkpoint_seed_missing"
  | "checkpoint_seed_redaction_failed"
  | "policy_digest_mismatch"
  | "policy_artifact_missing"
  | "raw_auth_exposed"
  | "raw_path_exposed"
  | "raw_backend_frame_exposed"
  | "request_manifest_write_failed"
  | "context_pack_write_failed"
  | "artifact_integrity_failed";
```

## Database Integration

Use existing tables:

```text
direct_context_policies
direct_context_builds
direct_request_manifests
direct_projections
direct_projection_items
direct_turns.context_build_id
```

Recommended `DirectThreadStore` methods:

```ts
class DirectThreadStore {
  writeContextPolicySnapshot(policy): PolicySummary;
  buildContextRecentDialogueProjection(threadId, options): DirectProjectionSummary;
  writeContextPack(contextPack, options): ContextBuildSummary;
  readContextPack(contextBuildId): DirectContextPack | null;
  writeRequestManifest(requestManifest, options): RequestManifestSummary;
  readRequestManifest(requestManifestId): DirectRequestManifest | null;
  recoverContextArtifacts(options): ContextRecoveryReport;
}
```

If `direct_turns` needs a request manifest pointer, add:

```sql
request_manifest_id text
```

or store the linkage through `direct_request_manifests(turn_id)`.

Context pack paths are private. Renderer-safe status may expose only:

```ts
{
  contextBuildId: string;
  policyId: string;
  purpose: string;
  builtAt: string;
  truncated: boolean;
  omittedCounts: Record<string, number>;
  rawPathExposed: false;
  contextTextExposed: false;
  requestManifestTextExposed: false;
  artifactIntegrityStatus: "verified" | "missing" | "corrupt" | "unknown";
}
```

## Durable Write Order

For direct live text and checkpoint continuation:

```text
1. create/load session and turn
2. resolve policy snapshot
3. resolve/build source projections
4. write context pack artifact to temp file
5. fsync/rename context pack artifact where platform support allows it
6. begin SQLite transaction
7. insert direct_context_builds row
8. commit
9. write request manifest artifact to temp file
10. fsync/rename request manifest artifact where platform support allows it
11. begin SQLite transaction
12. insert direct_request_manifests row
13. update direct_turns.context_build_id/request_manifest_id
14. append request_built rollout event citing both ids and hashes
15. commit
16. send provider request
17. append normalized provider/harness events
```

If platform `fsync` cannot be used reliably, the implementation must document
the platform behavior and recovery assumptions. No provider request may start
before steps 4-15 complete.

`request_built` evidence cites hashes, not only ids:

```ts
{
  contextBuildId,
  contextPackContentHash,
  contextPackShapeHash,
  requestManifestId,
  requestShapeHash,
  modelEvidenceRef,
  policyDigest,
  roleMappingDigest
}
```

Build locks:

```text
one context build lock per turnId
one request manifest lock per turnId
checkpoint continuation includes continuation id in the build lock
```

Rules:

```text
turn/start cannot send provider request while a context build is pending
same clientTurnRequestId shares the same build
different client ids for the same active turn are rejected
```

## Recovery

Recovery states:

```ts
type DirectContextRecoveryState =
  | "healthy"
  | "orphan_context_pack"
  | "orphan_request_manifest"
  | "request_built_unsent_or_unknown"
  | "interrupted_stream"
  | "context_artifact_missing"
  | "context_artifact_corrupt"
  | "request_manifest_missing"
  | "request_manifest_corrupt";
```

Rules:

- context pack exists but no DB row: index as orphan and do not use for new
  turns until repaired;
- DB row exists but artifact missing: mark corrupt and block context builds for
  that turn;
- request manifest exists but no `request_built`: mark recoverable pre-transport;
- `request_built` exists but no provider event: mark
  `request_built_unsent_or_unknown`;
- provider events exist without terminal event: existing interrupted-stream
  recovery applies;
- recovery never sends a request automatically.

## Runtime Status

Add a context status section under direct thread store/runtime status:

```ts
directThreadStore.context = {
  policyCount: number;
  contextBuildCount: number;
  requestManifestCount: number;
  contextBuildsAllowed: boolean;
  contextBuildRequiredForNewTurns: boolean;
  reasonIfBlocked?: DirectContextBuildBlocker;
  contextPackRecoveryState:
    | "healthy"
    | "degraded"
    | "rebuilding"
    | "corrupt"
    | "disabled";
  lastContextBuildAt?: string;
  rawContextExposed: false;
};
```

Activation/degraded behavior:

- `projection_read` mode: context health is diagnostic;
- `context_build_required` mode: context health is a hard gate for new direct
  turns;
- completed sessions may remain readable;
- new direct turns are blocked if context packs are required and context state is
  corrupt;
- rollback to legacy app-server remains available;
- no app-server fallback occurs inside `direct-experimental` turns.

## Implementation Order

### Phase -1: Context Authority Law

- Define `ContextMessageAuthority`.
- Define provider role mapping artifact.
- Define harness policy artifact.
- Define current-user-prompt artifact.
- Define provider-input projection hash.

### Phase 0: Policy Registry

- Add built-in policy definitions.
- Add canonical policy digesting, excluding `createdAt`.
- Add separate policy artifact digest.
- Persist policy snapshots/artifacts.
- Index policies in `direct_context_policies`.
- Include role mapping and harness policy digests.

### Phase 1: Context Projection

- Build `context_recent_dialogue@1` from valid `renderer_transcript@1`.
- Quote/frame projected transcript evidence.
- Exclude raw reasoning, diagnostics, executable tool controls, and imported
  runtime policy.
- Mark blocked on redaction/raw-exposure failure.
- Keep compact projection out of context builds.
- Record renderer truncation honestly.
- Compute canonical context projection source digest.

### Phase 2: Context Pack Store

- Add context pack artifact paths.
- Add atomic context pack writes.
- Add current-user-prompt artifacts.
- Add harness policy artifacts.
- Add HMAC/integrity metadata when available.
- Add idempotent context build input keys.
- Add blocked build attempt records.
- Insert `direct_context_builds` rows.
- Read/recover context pack artifacts.
- Expose renderer-safe summaries only.

### Phase 3: Request Manifest Store

- Add request manifest artifact paths.
- Insert `direct_request_manifests` rows.
- Record request shape, model evidence, endpoint hash, feature flags, and context
  pack linkage.
- Record request shape evidence refs, `store=false`, `includes=false`, and
  continuity fields.
- Record provider input projection hashes and role mapping digest.
- Add idempotent request manifest input keys.
- Do not store raw request bodies or auth headers.

### Phase 4: Live Text Integration

- Make direct live text turn build context pack and request manifest before
  request transport.
- Persist `contextBuildId` and `requestManifestId` on turn state.
- Make `request_built` cite context/request hashes, policy digest, model
  evidence, and role mapping digest.
- Keep first-turn empty-context policy available.
- Block when required context projections are stale/blocked/corrupt.
- Prove provider input can be generated from context pack and manifest only.

### Phase 5: Import Checkpoint Continuation Integration

- Wrap existing checkpoint seed as a context pack source artifact.
- Persist context pack and request manifest before transport.
- Store ids on continuation session and turn.
- Do not change imported source session runnability.

### Phase 6: Recovery And Status

- Detect orphan/corrupt context artifacts.
- Add status counts and degraded reasons.
- Add smokes for crash points before transport.

## Smoke Tests

Add or extend `direct:smoke` coverage for:

- policy snapshot digest stability;
- context projection builds from renderer transcript;
- compact projection is rejected as context source;
- raw reasoning is not included in context projection or context pack;
- imported transcript text is quoted evidence, not instruction authority;
- context pack writes atomically and indexes in `direct_context_builds`;
- request manifest writes atomically and indexes in `direct_request_manifests`;
- direct live text turn records `contextBuildId` and `requestManifestId`;
- checkpoint continuation records `contextBuildId` and `requestManifestId`;
- first-turn empty context still includes harness policy and current user intent;
- non-first-turn context resolution cannot use compact, blocked, stale, or last
  attempt projections;
- `request_built` records context/request hashes, model evidence ref, policy
  digest, and role mapping digest;
- provider input hashes can be regenerated from context pack and request
  manifest without reading raw session/rollout/import files;
- provider request is not sent if context pack write fails;
- provider request is not sent if request manifest write fails;
- raw auth/request/backend frames are absent from artifacts;
- orphan context pack recovery is reported and does not auto-send;
- corrupt context artifact blocks new direct turns when context is required.

## Acceptance Criteria

- Context policy definitions are canonical outside SQLite or snapshotted into
  every context pack.
- Context pack is provider-neutral logical input; provider-specific serialization
  is represented only by provider-input projection hashes and role mapping.
- Local `harness` role has an explicit provider role mapping.
- Context messages use `ContextMessageAuthority`, not only an instruction
  boolean.
- Policy semantic digest excludes `createdAt`; artifact digest may include
  metadata.
- Harness policy is a versioned artifact with id/version/digest.
- Current user prompt is a first-class app-private artifact with independent
  caps, hash, and redaction result.
- `context_recent_dialogue@1` consumes only valid `renderer_transcript@1` and
  never consumes raw session/rollout files directly.
- `compact_transcript@1` is not accepted as context input in this bundle.
- Context projection uses kind-specific current projection pointers and cannot
  accidentally use compact/blocked/stale projections.
- Context projection source digest is canonical and excludes build timestamps
  and projection ids.
- If renderer transcript rows were truncated, context projection records
  truncation and cannot imply full history was available.
- Context projection output is framed as evidence and marked usable for context
  only after redaction passes.
- Context build and request manifest creation are idempotent by canonical input
  keys.
- Context pack and request manifest writes are atomic with temp-file/rename
  behavior and DB transaction boundaries.
- Every direct live text request persists a context pack before transport.
- Every direct live text request persists a request manifest before transport.
- Import checkpoint continuation persists a context pack and request manifest
  before transport.
- Turns cite `contextBuildId`, `requestManifestId`, context hashes, request shape
  hash, model evidence ref, policy digest, and role mapping digest.
- Request manifests store request shape/feature decisions, not raw request
  bodies or credentials.
- Request manifest includes `store: false`, `includes: false`, and explicit
  continuity fields proving no `previous_response_id` or imported continuity
  handle was used.
- Request manifest includes request shape, endpoint, model, and context policy
  evidence refs.
- Context packs are app-private and excluded from default diagnostics/export.
- Context pack artifacts carry integrity metadata, preferably HMAC when
  available.
- Renderer-safe context summaries expose no context text and include artifact
  integrity status.
- Current user prompt has independent caps and redaction checks.
- Context packs include model/context budget estimates and block or rebuild when
  budget is exceeded.
- Imported/projected transcript text cannot carry tool authority or system
  policy authority.
- Blocked context build attempts are persisted as safe summaries without writing
  unsafe context text.
- Stable blocker codes exist for projection missing/stale/blocked, redaction
  failure, prompt too large, policy mismatch, raw exposure, write failure, and
  integrity failure.
- Read-only tool continuation either receives only a minimal request manifest
  before transport or waits for the later obligation-projection bundle.
- Context build failures fail closed and do not start provider transport.
- Recovery can distinguish orphan context packs, orphan request manifests,
  request-built-without-stream, and interrupted streams.
- Direct runtime status reports context health without exposing private paths or
  context text.
- Direct activation/degraded status distinguishes diagnostic context health from
  hard `context_build_required` gating.
- Existing direct auth, live text, import, projection, activation, and smoke
  tests remain compatible.

## Non-Goals

- Model-generated semantic summaries.
- Compaction checkpoints.
- Merge/prune/fork/bridge context policies.
- Full search index integration.
- Write/shell/network tools.
- Production `direct` mode.
- Importing or storing right-pane ChatGPT transcript content.
- Removing `codex app-server` legacy mode.

## Summary

This module turns the direct projection store into an auditable context
construction substrate.

Passing this bundle should mean:

```text
Direct live text and checkpoint continuation requests have durable,
app-private context packs and request manifests that cite context-safe
projections and policy digests before any provider transport starts.
```

It should not mean:

```text
compact projections are prompt context
renderer projections are runtime authority
direct mode is production
tools/write operations are enabled
right-pane ChatGPT content is imported
raw rollouts stop being canonical
```
