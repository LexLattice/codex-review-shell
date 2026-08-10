# Direct Live Probe Evidence Promotion Spec

Status: implementation specification for the next direct-runtime bundle on the
long-lived `codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md](./DIRECT_LIVE_TEXT_TURN_SURFACE_SPEC.md)
- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md](./CHATGPT_CODEX_ODEU_PROFILE_EXTRACTION_SPEC.md)
- [OAI_CODEX_UPSTREAM_ODEU_PROFILE.md](./OAI_CODEX_UPSTREAM_ODEU_PROFILE.md)
- [docs/direct-codex/profile-v0/CHATGPT_CODEX_SUBSCRIPTION_ODEU_PROFILE_v0.md](./direct-codex/profile-v0/CHATGPT_CODEX_SUBSCRIPTION_ODEU_PROFILE_v0.md)

## Purpose

Turn a successful manual live text probe into durable, redacted runtime evidence
that can unlock `direct-experimental/live-text` for the exact model, endpoint,
auth scope, and request shape that were proven.

The previous bundle added the direct live text surface, but the normal app path
still correctly fails closed unless model evidence is `accepted` or
`runtime_probed`. The imported baseline profile marks current model ids as
`observed`, so a real authenticated probe needs somewhere local and explicit to
record:

```text
this account + this endpoint class + this model + this text-only request shape
successfully completed a live direct turn
```

This spec defines that evidence layer.

## Decision

Add a local direct live probe evidence overlay.

```text
manual live probe
  -> direct transport helper
  -> normalized events
  -> redacted diagnostic
  -> DirectLiveProbeEvidenceStore
  -> DirectRuntimeStatus / DirectLiveTextController model evidence view
```

The overlay does not mutate the imported ODEU baseline profile. It is an
account-scoped, request-shape-scoped runtime witness that can produce
`runtime_probed` status for the live text controller.

## Boundary

This bundle changes only the left Codex implementation lane.

It does not:

- make `direct` mode available;
- make direct runtime the default;
- run live backend calls in CI;
- expose raw auth tokens, auth headers, backend request bodies, raw stream
  frames, private prompts, account ids, or workspace paths to the renderer;
- accept broad model availability from one successful probe;
- enable tools, tool continuation, imports, compaction, or right-pane ChatGPT
  thread changes;
- edit the committed imported baseline profile as a side effect of a local
  manual probe.

## Current State

Already available on the direct branch:

- direct auth store, login, refresh, and redacted auth status;
- direct live text surface/controller selected by
  `direct-experimental/live-text`;
- direct transport helpers for text-only SSE requests;
- normalized event and diagnostic redaction helpers;
- direct session persistence and diagnostics;
- manual live probe script gated by `CODEX_DIRECT_LIVE_PROBE=1`;
- smoke coverage for fake live text turns, idempotency, auth/profile gating,
  aborts, reload, tool detection, and renderer redaction.

Missing:

```text
manual live probe result
  -> durable local evidence
  -> runtime_probed model/request-shape status
  -> direct live text panel runnable for that exact scope
```

## ODEU Mapping

The upstream ODEU profile says `runtime_probed` evidence may enable mutation
only when the probe is specific. This bundle uses that rule literally.

| ODEU Object | Evidence Captured | Runtime Use |
| --- | --- | --- |
| `Account` | Redacted auth status, account evidence key, account id source. | Evidence is scoped to the same authenticated account or rejected as mismatched. |
| `Provider` | Endpoint class and redacted endpoint hash. | Evidence applies only to the same direct Codex endpoint class. |
| `Model` | Model id requested and model id observed in stream start. | Evidence applies only to that model id. |
| `Turn` | Sanitized text-only request shape and terminal state. | Evidence applies only to the same request-shape hash. |
| `ResponseItem` | Normalized event types and unknown raw event types. | Unknown events block promotion unless classified later. |
| `ToolCall` | Tool detection summary. | Tool calls make the text-turn probe unstable, not runnable. |
| `Diagnostic` | Redacted request/response summary and exposure flags. | Used for audit and status, never raw renderer exposure. |

## Evidence Scope

One successful probe must not promote a whole runtime.

Promotion scope is the tuple:

```text
profileId
profileHash
authMode
accountEvidenceKey
workspaceEvidenceSource
workspaceScoped
endpointClass
endpointHash
transport
model
requestShapeHash
requestBuilderVersion
transportAdapterVersion
normalizerVersion
redactionVersion
probeScriptVersion
```

Rules:

- `model=gpt-5.4` success does not promote `gpt-5.5`.
- ChatGPT-subscription success does not promote API-key auth.
- One endpoint hash does not promote a different endpoint override.
- Model identity is tracked separately from request-shape hash. A model change
  should report as `model_mismatch`, not only as `request_shape_mismatch`.
- Text-only success does not promote tools, reasoning controls, JSON output,
  continuation, service tier, prompt cache, or model selector controls.
- Evidence with unknown account scope may be stored for diagnostics but must not
  make normal turns runnable.
- Evidence with unknown workspace or tenant scope must not make normal turns
  runnable unless the active ODEU policy explicitly allows account-only scoping.
- Evidence from an old profile id may remain visible but must not make a newer
  profile runnable unless explicitly migrated.

## Store Layout

Add a small local evidence store:

```text
direct-probe-evidence/
  index.json
  evidence/
    <evidence-id>.json
  diagnostics/
    <evidence-id>.redacted.jsonl
```

Recommended module:

```text
src/main/direct/probes/live-probe-evidence-store.js
```

The root should live next to other direct harness state under the app data root.
Tests may pass an explicit temporary root.

Writes must be atomic. A partial write must leave either the previous index or a
recoverable evidence file that can be re-indexed.

## Evidence Schema

Implementation can refine names, but the persisted shape must preserve this
semantic contract:

```ts
type StoredLiveProbeEvidenceStatus =
  | "candidate"
  | "runtime_probed"
  | "unstable"
  | "rejected";

type ComputedLiveProbeEvidenceStatus =
  | StoredLiveProbeEvidenceStatus
  | "expired"
  | "scope_mismatch";

type LiveProbeFailureKind =
  | "auth"
  | "quota"
  | "rate_limit"
  | "transport_pre_stream"
  | "transport_after_stream"
  | "model_unavailable"
  | "malformed_request"
  | "unknown_event"
  | "tool_call_detected"
  | "redaction_failed"
  | "renderer_exposure"
  | "assistant_text_missing"
  | "reasoning_event_detected"
  | "scope_mismatch"
  | "other";

type DirectLiveProbeEvidence = {
  schema: "direct_codex_live_probe_evidence@1";
  evidenceId: string;
  status: StoredLiveProbeEvidenceStatus;
  source: "manual-live-probe" | "fake-smoke";
  createdAt: string;
  expiresAt: string;

  versions: {
    evidenceSchemaVersion: 1;
    profileId: string;
    profileVersion?: number;
    profileHash: string;
    requestBuilderVersion: string;
    transportAdapterVersion: string;
    normalizerVersion: string;
    redactionVersion: string;
    probeScriptVersion: string;
  };

  profile: {
    profileId: string;
    profileObservedAt: string;
    profileSource: string;
    profileHash: string;
  };

  auth: {
    authMode: "chatgpt";
    storageMode: "file" | "memory" | "unknown";
    accountIdSource: "token-claim" | "profile-endpoint" | "unknown";
    accountEvidenceKey: string;
    accountEvidenceKeyDerivation: "local-hmac-sha256";
    workspaceEvidenceSource: "token-claim" | "profile-endpoint" | "project-binding" | "unknown";
    workspaceScoped: boolean;
    rawTokensExposed: false;
  };

  provider: {
    endpointClass: "chatgpt-codex-responses";
    endpointHash: string;
    transport: "sse";
  };

  model: {
    requested: string;
    observed?: string;
    evidenceState: StoredLiveProbeEvidenceStatus;
    mismatchReason?: string;
  };

  requestShape: {
    shapeHash: string;
    schema: "direct_text_request_shape@1";
    requestBuilderVersion: string;
    stream: true;
    store: false;
    instructionClass: "fixed-live-text-probe";
    textInputKind: "plain-user-text";
    toolCount: 0;
    functionCallOutputCount: 0;
    forbiddenFieldsPresent: false;
  };

  probePrompt: {
    promptClass: "fixed-live-text-probe";
    promptHash: string;
    privatePromptExposed: false;
  };

  result: {
    ok: boolean;
    terminalState: "completed" | "failed" | "aborted" | "tool_waiting";
    failureKind?: LiveProbeFailureKind;
    responseStatus: number;
    contentType: string;
    normalizedEventTypes: string[];
    unknownRawTypes: string[];
    toolCallDetected: boolean;
    assistantTextObserved: boolean;
    assistantTextCharCount: number;
    usageSummary: {
      observed: boolean;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };

  diagnostics: {
    diagnosticId: string;
    rawAuthHeadersExposed: false;
    rawBackendRequestsExposed: false;
    rawBackendFramesExposed: false;
    privatePromptExposed: false;
    rawAccountIdExposed: false;
  };

  integrity: {
    algorithm: "hmac-sha256";
    keyId: string;
    digest: string;
  };
};
```

`expired` is not persisted as a primary evidence status. It is computed from
`expiresAt` when reading evidence. This avoids rewriting historical evidence
records just because time passed.

## Request Shape Hash

The request-shape hash must be canonical and must not include private prompt
text.

The request-shape hash must use deterministic, domain-separated canonical JSON:

```text
hashInput = canonicalJson({
  schema: "direct_text_request_shape@1",
  requestBuilderVersion,
  stream: true,
  store: false,
  instructionClass: "fixed-live-text-probe",
  inputKind: "one_plain_user_text",
  tools: "omitted",
  tool_choice: "omitted",
  parallel_tool_calls: "omitted",
  reasoning: "omitted",
  text_format: "omitted",
  include: "omitted",
  service_tier: "omitted",
  prompt_cache_key: "omitted",
  previous_response_id: "omitted"
})
```

Canonical hashing rules:

- sort object keys recursively;
- exclude model id, prompt body, raw instructions text, auth/account data,
  endpoint data, timestamps, request ids, and session ids;
- use an explicit schema/domain string;
- use a stable request-builder version;
- report model mismatches separately from request-shape mismatches.

Only the fixed built-in live probe prompt may produce `runtime_probed` evidence.
User-provided prompts may be stored as diagnostic evidence, but they must not
unlock runtime.

## Promotion Rules

An evidence record may be `runtime_probed` only when all of these are true:

- direct auth status is authenticated;
- account evidence key is known;
- account evidence key is derived by local HMAC, not raw or unsalted account id;
- workspace scope is known or the active ODEU policy explicitly allows
  account-only scoping;
- request shape matches the text-only allowlist;
- probe prompt class is `fixed-live-text-probe`;
- backend response is 2xx;
- terminal state is `completed`;
- normalized events include `message_delta` and `response_completed`;
- assistant text was observed and has non-zero length;
- normalized event types are limited to this bundle's promotion allowlist:
  `session_started`, `message_delta`, `usage_delta`, and
  `response_completed`;
- no `auth_error`, `quota_error`, `transport_error`, `response_failed`,
  `response_incomplete`, or `aborted` normalized events are present;
- no `reasoning_delta` is present unless a later accepted profile capability
  explicitly allows it;
- no tool call is detected;
- unknown raw event list is empty;
- all renderer/raw exposure flags are false;
- diagnostic redaction passes;
- model observed in the stream is empty or matches the requested model;
- evidence has not expired.

Classify other outcomes:

| Outcome | Evidence Status |
| --- | --- |
| Completed text turn with unknown raw event | `candidate` or `unstable`, not runnable. |
| Tool call emitted | `unstable`, useful for tool-detection evidence only. |
| Auth failure | `unstable` with `failureKind="auth"`; does not reject the model/request shape. |
| Quota/rate failure | `unstable` with `failureKind="quota"` or `"rate_limit"`; not model rejection. |
| Transport failure before stream | `unstable` with `failureKind="transport_pre_stream"`. |
| Failure after stream start | `unstable` with `failureKind="transport_after_stream"`; original request is not retried blindly. |
| Model unavailable | `rejected` with `failureKind="model_unavailable"` for that model/request/auth/endpoint scope. |
| Malformed request | `rejected` with `failureKind="malformed_request"` for that request builder/request shape. |
| Redaction or renderer exposure failure | `rejected` with `failureKind="redaction_failed"` or `"renderer_exposure"` and blocks export. |
| Evidence past expiry | computed `expired`; visible but not runnable. |

## Evidence Expiry

Default expiry should be conservative:

```text
runtime_probed evidence expires after 7 days
unstable/rejected evidence expires after 24 hours
fake-smoke evidence never leaves temporary test roots
```

The exact values can be constants, but runtime status must display stale or
expired evidence distinctly. Expired evidence must not make `turnRunnable` true.
The store should compute expiry at read time instead of rewriting evidence
records.

## Account And Integrity Keys

Evidence needs a local secret for scope and integrity projections.

Requirements:

- derive `accountEvidenceKey` with `HMAC-SHA256(localEvidenceSecret,
  effectiveAccountScope)`;
- include auth mode, account/user identity, workspace/tenant identity, and safe
  plan or entitlement class in `effectiveAccountScope` when available;
- never persist raw account id, raw workspace id, or an unsalted account hash;
- if workspace/tenant identity is unavailable, record
  `workspaceEvidenceSource: "unknown"` and `workspaceScoped: false`;
- generate or load the local evidence secret from private app data or the direct
  auth environment;
- do not export the HMAC secret in diagnostics;
- sign each evidence record with a local HMAC integrity digest over canonical
  evidence JSON excluding the `integrity.digest` field.

This integrity check is not a hard security boundary against a local privileged
attacker. It is a corruption and casual-tampering guard because local evidence
can make an explicit direct panel runnable.

## Runtime Status Projection

Extend `DirectRuntimeStatus` with a live probe evidence projection:

```ts
type DirectLiveProbeEvidenceStatusView = {
  available: boolean;
  usable: boolean;
  status:
    | "missing"
    | "candidate"
    | "runtime_probed"
    | "unstable"
    | "rejected"
    | "expired"
    | "scope_mismatch";
  model: string;
  modelSource: "live-probe";
  modelEvidenceState: "runtime_probed";
  evidenceId: string;
  observedAt: string;
  expiresAt: string;
  scope: {
    profileMatches: boolean;
    accountMatches: boolean;
    endpointMatches: boolean;
    requestShapeMatches: boolean;
  };
  rawTokensExposed: false;
  rawBackendFramesExposed: false;
};
```

For `direct-experimental/live-text`:

```text
accepted static profile evidence
  OR usable live probe evidence
  -> turnRunnable true
```

Observed static profile evidence alone remains non-runnable.

`findUsableEvidence(scope)` must use deterministic precedence:

1. Current direct auth status must be valid first.
2. Find the latest unexpired `runtime_probed` evidence matching exact scope.
3. Ignore `fake-smoke` evidence unless explicit test resolver mode is enabled.
4. Candidate, unstable, rejected, scope-mismatched, and expired evidence never
   makes `turnRunnable` true.
5. Recent auth, quota, or rate failures may show warning/degraded status but do
   not erase a still-valid positive witness.
6. Model/request rejected evidence may explain `profile_required` if no valid
   positive witness exists.

## Controller Integration

`DirectLiveTextController` should not know how to scan files itself. It should
receive either:

```ts
probeEvidenceStore?: DirectLiveProbeEvidenceStore
```

or a narrow resolver:

```ts
resolveModelEvidence(project, requestShape): DirectModelEvidence
```

The evidence resolver returns:

```ts
type DirectModelEvidence = {
  model: string;
  modelSource: "odeu-profile" | "live-probe";
  modelEvidenceState: "accepted" | "runtime_probed" | "candidate" | "unknown";
  accepted: boolean;
  evidenceId?: string;
  reason?: string;
};
```

The controller remains fail-closed. If evidence is missing, expired, mismatched,
or only candidate/unstable, `statusForProject` returns `profile_required` with a
specific reason.

## Manual Probe Script

Update:

```text
scripts/direct-codex-live-probe.mjs
```

New behavior:

- still refuses to run unless `CODEX_DIRECT_LIVE_PROBE=1`;
- reads direct auth from the configured app auth store;
- runs one text-only live probe;
- writes the persisted direct session as today;
- records live probe evidence into `DirectLiveProbeEvidenceStore`;
- prints a redacted summary including `evidenceId`, `status`, `usable`, and
  `expiresAt`;
- exits non-zero only for runner/setup errors, not for a legitimate rejected or
  unstable backend result unless explicitly requested by env.

Suggested optional env:

```text
CODEX_DIRECT_PROBE_EVIDENCE_ROOT
CODEX_DIRECT_PROBE_EVIDENCE_TTL_MS
CODEX_DIRECT_PROBE_FAIL_ON_NON_RUNNABLE=1
CODEX_DIRECT_LIVE_PROBE_ALLOW_CI=1
```

The script must not write raw tokens, raw auth headers, raw stream frames, or
private prompts to evidence records.

If `CI=true`, `direct:probe:live` must refuse to run unless
`CODEX_DIRECT_LIVE_PROBE_ALLOW_CI=1` is also set. This prevents inherited
environment variables from causing accidental live backend calls.

## App UI

The first implementation should keep UI small:

- runtime status can show `Live probe: missing/runtime_probed/expired`;
- direct live text readiness can say whether it is unlocked by static profile or
  live probe evidence;
- no in-app button to run the live probe yet;
- no model selector expansion from probe evidence beyond the proven model.

A later bundle can add a safe "Run live probe" action if the product needs it.

## Diagnostics And Redaction

Evidence records are local runtime state, not committed fixtures.

Still, they must obey the same redaction posture:

- no raw bearer/access/refresh tokens;
- no raw authorization codes;
- no cookies;
- no raw account ids;
- no private workspace paths;
- no raw backend request bodies;
- no raw stream frames;
- no private prompt text outside redacted diagnostic preview;
- no tool output content beyond existing redacted summaries.

Evidence summaries may include:

- normalized event type names;
- response status and content type;
- request-shape flags;
- model id;
- endpoint class;
- endpoint hash;
- redacted account evidence key;
- diagnostic id.

## Fake Evidence Isolation

Smoke tests may write `source="fake-smoke"` evidence, but normal app runtime must
ignore it unless explicit test resolver mode is enabled.

Rules:

- fake-smoke evidence root must not equal the app userData direct evidence root;
- fake-smoke evidence is allowed only in temporary test roots;
- fake-smoke evidence must not be emitted by the manual live probe script;
- fake-smoke evidence must not make a normal desktop project runnable.

## Implementation Plan

### Step 1: Schema And Evaluator

Add:

- evidence schema constants;
- canonical scope builder;
- request-shape hash;
- promotion evaluator;
- failure-kind taxonomy;
- redaction assertion;
- integrity digest helpers.

### Step 2: Evidence Store

Add `DirectLiveProbeEvidenceStore`:

- atomic JSON writes;
- index recovery from evidence files;
- `recordEvidence(result, context)`;
- `findUsableEvidence(scope)`;
- redaction assertion before write;
- expiry handling.

### Step 3: Fake-Smoke Tests

Add tests before runtime wiring:

- successful exact match;
- model mismatch;
- account mismatch;
- endpoint mismatch;
- request-shape mismatch;
- expired evidence;
- fake evidence ignored outside test mode;
- unknown event not runnable;
- reasoning event not runnable;
- tool call not runnable;
- auth/quota/transport failures not runnable;

### Step 4: Runtime Status Overlay

Thread evidence store status into:

- `buildDirectRuntimeStatusForProject`;
- `DirectRuntimeStatus.liveTextRuntime`;
- `DirectLiveTextController.statusForProject`;
- direct runtime diagnostics.

### Step 5: Manual Probe Recording

Update the manual live probe script to record evidence and print the redacted
evidence summary.

### Step 6: Smoke Coverage

Extend `npm run direct:smoke` end to end:

- successful fake live text probe records `runtime_probed`;
- runtime status becomes runnable only for matching model/request/auth/profile
  scope;
- model mismatch remains `profile_required`;
- endpoint mismatch remains `profile_required`;
- account mismatch remains `profile_required`;
- expired evidence remains visible but not runnable;
- unknown raw event evidence is candidate/unstable and not runnable;
- tool-call evidence is unstable and not runnable for text turns;
- auth/quota/transport failures do not promote;
- raw exposure flags stay false.

## Acceptance Criteria

This bundle is complete when:

- manual live probe can record a redacted evidence record;
- `expired` is computed from `expiresAt` and does not require rewriting
  evidence files;
- model evidence state can represent candidate, unstable, rejected, and
  runtime-probed outcomes;
- evidence scope includes profile hash, request-builder version, transport
  adapter version, normalizer version, redaction version, and probe script
  version;
- account evidence key is HMAC/local-secret-derived and never a raw or unsalted
  account id;
- local evidence records carry an integrity HMAC;
- fake-smoke evidence can make `direct-experimental/live-text` runnable for the
  exact proven scope only in explicit test mode;
- fake-smoke evidence is ignored by the normal resolver outside explicit test
  mode;
- observed baseline models alone still do not make turns runnable;
- the committed baseline profile is not modified by local probe runs;
- runtime status shows live probe evidence state and expiry;
- live text controller accepts `runtime_probed` evidence from the overlay;
- stale, mismatched, unstable, rejected, and expired evidence fail closed with a
  clear reason;
- non-empty assistant text is required for `runtime_probed`;
- `reasoning_delta` does not promote `runtime_probed` in this bundle;
- usage summary can be absent without being represented as fake zero-token
  evidence;
- auth/quota/rate failures do not create model/request-shape rejection;
- latest matching `runtime_probed` evidence wins for runnable status when
  current auth is valid;
- no raw auth/request/stream data reaches renderer or evidence records;
- `direct:probe:live` refuses to run in CI unless
  `CODEX_DIRECT_LIVE_PROBE_ALLOW_CI=1`;
- `npm run direct:smoke` covers evidence promotion without a real backend;
- `CODEX_DIRECT_LIVE_PROBE=1 npm run direct:probe:live` remains the only path
  that makes a real backend call.

## Explicit Non-Default Rule

Passing this bundle means:

```text
one explicit direct-experimental/live-text project can become runnable after a
matching manual live probe succeeds for the current account and request shape.
```

It does not mean:

```text
direct mode is production-ready
direct is default
tools can run
imports can continue
model controls are broadly enabled
```

The next gates after this bundle remain:

- real manual live probe run against the current account;
- tool-call detection evidence review from live backend;
- one read-only tool authority and continuation loop;
- restart recovery audit across live completed/failed/aborted/tool-waiting
  sessions;
- model/catalog/quota evidence.
