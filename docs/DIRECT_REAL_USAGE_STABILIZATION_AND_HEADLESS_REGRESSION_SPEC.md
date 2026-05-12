# Direct Real Usage Stabilization and Headless Regression Spec

Status: draft stabilization specification for the long-lived
`codex/direct-chatgpt-harness` branch.

Related docs:

- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md](./DIRECT_LIVE_PROBE_EVIDENCE_PROMOTION_SPEC.md)
- [DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md](./DIRECT_TEXT_ONLY_RUNTIME_TIER_AND_TOGGLE_SPEC.md)
- [DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md](./DIRECT_TEXT_ONLY_MULTITURN_RECENT_DIALOGUE_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md](./DIRECT_RENDERER_TRANSCRIPT_PROJECTION_SPEC.md)
- [DIRECT_REAL_USAGE_TEST_LOG_2026-05-12.md](./audits/DIRECT_REAL_USAGE_TEST_LOG_2026-05-12.md)

## Purpose

Stabilize the direct headless real-usage path before adding another
implementation-lane capability.

The 2026-05-12 real-usage pass proved that:

```text
app-server baseline works
direct live probe works
direct diagnostic first turn works
direct strict first turn is blocked by evidence scope mismatch
direct recent-dialogue follow-up fails before transport with SQLite FK error
```

This bundle fixes the real direct text path and adds a repeatable regression
runner so future direct-branch work can prove the same path quickly.

## Core Invariant

```text
strict direct turn uses accepted/runtime-probed evidence
diagnostic direct turn does not satisfy activation/readiness gates
recent-dialogue follow-up uses durable local projections before transport
real-usage regression != production direct default
```

The repair must not weaken direct readiness rules. It should make valid evidence
usable, not bypass evidence. It should make follow-up projection persistence
lawful, not skip the projection/context path.

## Boundary

This bundle does:

- repair live-probe evidence scope resolution for strict direct text turns;
- repair direct recent-dialogue headless follow-up persistence/projection order;
- normalize pre-transport projection/store failures into stable blocker codes;
- add a repeatable headless real-usage regression runner;
- record app-server baseline, direct strict first turn, direct follow-up,
  opt-in guard, idempotency, and raw-exposure scan results;
- keep implementation-lane read/patch/command real-provider testing logged as a
  separate future harness.

It does not:

- make direct production or default;
- loosen implementation-lane activation gates;
- make diagnostic runs satisfy activation;
- auto-probe missing evidence from the real-turn runner;
- enable tools in Direct text-only;
- exercise real read/patch/command approval loops;
- mutate the right ChatGPT pane;
- create or modify handoff queue items;
- remove app-server or treat app-server/direct as identical.

## Findings To Close

### REAL-001 - Strict direct first turn blocked by scope mismatch

Observed:

```text
fresh live probe:
  status = runtime_probed
  usable = true
  evidenceId = live_probe_evidence_95c70e3151fc4ee3a2ac

strict direct first turn:
  status = blocked
  failure.code = live_evidence_scope_mismatch
  providerRequestStarted = false
```

Local inspection showed scope matching against the selected index entry failed
for all scope dimensions:

```text
profile
account
endpoint
request shape
model
workspace allowance
version tuple
```

The likely implementation fault is that index matching can select an incomplete
compact evidence row instead of hydrating the full evidence artifact.

### REAL-002 - Recent-dialogue follow-up fails with SQLite FK error

Observed:

```text
first diagnostic direct turn:
  status = diagnostic
  requestLifecycle = completed
  createdThreadId = direct_session_...

follow-up with --from-report:
  status = failed
  failure.code = ERR_SQLITE_ERROR
  failure.rendererSafeMessage = FOREIGN KEY constraint failed
  providerRequestStarted = false
```

This is a local persistence/projection failure before transport. The follow-up
path must write parent rows and projection dependencies in a stable order and
must report renderer-safe blocker codes instead of leaking raw SQLite errors.

### REAL-003 - Standard headless runner is text-only

Observed:

```text
scripts/codex-real-turn.mjs --runtime=direct
  exercises text-only turns
  records toolExecuted=false
  records continuationSent=false
```

This is correct for the existing runner. Real-provider implementation-lane
approval loops need a later dedicated harness and are intentionally out of
scope for this stabilization bundle.

## Live Evidence Scope Repair

### Evidence Scope Contract

Strict direct text turns require accepted runtime evidence for the exact shape:

```ts
type DirectTextTurnLiveEvidenceScope = {
  requestShapeClass:
    | "direct_text_turn_empty_context@1"
    | "direct_text_turn_recent_dialogue@1";
  model: string;
  profileId: string;
  profileHash: string;
  profileSource: string;
  authSource: "direct-auth-store" | "codex-cli-auth" | "unknown";
  endpointClass: "chatgpt-codex-responses";
  endpointHash: string;
  accountEvidenceKey: string;
  workspaceScope: {
    projectScoped: boolean;
    workspaceBindingEvidenceKey: string;
    workspaceAccessRequired: false;
  };
  requestShapeHash: string;
  versions: {
    requestBuilderVersion: string;
    transportAdapterVersion: string;
    normalizerVersion: string;
    redactionVersion: string;
    profileVersion: number;
  };
};
```

Evidence for one request shape must not unlock another request shape:

```text
direct_text_turn_empty_context@1 != direct_text_turn_recent_dialogue@1
direct_text_turn_empty_context@1 != direct_fork_start_live_text@1
direct_text_turn_empty_context@1 != direct_readonly_tool_continuation@1
```

### Index and Artifact Law

The evidence store may keep a compact index for lookup, but scope validation
must validate against complete evidence.

Rules:

```text
1. If an index row has all scope fields, it may be matched directly.
2. If an index row is compact or legacy, hydrate the evidence artifact before
   returning scope_mismatch.
3. If the artifact is missing, return live_evidence_artifact_missing.
4. If the artifact is corrupt or fails schema validation, return
   live_evidence_artifact_corrupt.
5. If the artifact is expired, return live_evidence_expired.
6. If the artifact is valid but scope differs, return
   live_evidence_scope_mismatch with renderer-safe mismatch categories.
```

Renderer-safe mismatch categories:

```ts
type DirectLiveEvidenceScopeMismatchKind =
  | "profile"
  | "account"
  | "endpoint"
  | "auth_source"
  | "evidence_artifact"
  | "request_shape_class"
  | "request_shape_hash"
  | "model"
  | "workspace"
  | "version";
```

Do not expose raw endpoint URLs, raw account identifiers, token material, raw
profile JSON, raw request bodies, raw source hashes, or workspace paths in
renderer-visible status or headless reports.

Runtime-probed evidence is valid if the normalizer policy accepted the observed
event set for the exact request-shape class under the recorded normalizer
version. The resolver must not hardcode one historical event vocabulary, such
as requiring only `response_created`, when the accepted probe recorded:

```text
session_started
message_delta
usage_delta
response_completed
```

Request-shape family and exact request-shape digest are separate facts:

```text
request_shape_class_mismatch:
  wrong capability family

request_shape_hash_mismatch:
  same family but exact request fields/version differ
```

### Evidence Write Repair

New live-probe evidence writes should store enough scope metadata in the index
to avoid false mismatch:

```ts
type DirectLiveProbeEvidenceIndexEntry = {
  evidenceId: string;
  status: "candidate" | "runtime_probed" | "rejected" | "expired";
  scopeCompleteness: "full" | "compact" | "legacy";
  observedAt: string;
  expiresAt: string;
  model: string;
  scope?: {
    profileId: string;
    profileHash: string;
    profileSource: string;
    authSource: string;
    endpointClass: string;
    endpointHash: string;
    accountEvidenceKey: string;
    requestShapeHash: string;
    workspaceScope: {
      projectScoped: boolean;
      workspaceBindingEvidenceKey: string;
      workspaceAccessRequired: false;
    };
    versionsDigest: string;
  };
  artifactDigest?: string;
};
```

Rows with `scopeCompleteness="full"` may be compared directly. Rows with
`scopeCompleteness="compact"` or `scopeCompleteness="legacy"` must hydrate the
artifact before returning mismatch.

Legacy rows without `scopeCompleteness` or `scope` are allowed only as hydrated
rows. They must not produce false `scope_mismatch` before artifact hydration.

If hydration changes selected evidence, resolution must continue:

```text
index row A:
  compact
  model matches
  hydrated artifact scope mismatches

index row B:
  full
  exact scope matches

resolver result:
  use row B
  do not stop at row A mismatch
```

### Diagnostic Mode

Diagnostic runs remain useful but non-authoritative:

```text
--require-live-evidence=false
--evidence-mode=diagnostic-no-promotion
```

Diagnostic mode may run live direct transport with explicit live-call opt-in,
but it must not:

- promote evidence;
- satisfy direct UI selection gates;
- satisfy implementation-lane activation gates;
- hide strict-mode evidence failures.

## Recent-Dialogue Follow-Up Repair

### Required Flow

The `--from-report` follow-up path must resolve the previous direct thread
structurally:

```text
first report
  -> createdThreadId / createdSessionId
  -> session artifact
  -> previous completed turn
  -> renderer_transcript@1
  -> context_recent_dialogue@1
  -> direct_context_pack@1
  -> direct_request_manifest@1
  -> fresh provider request
```

The report path itself is not authority. It only supplies renderer-safe ids and
digests that the main stores must revalidate.

### Projection Store Ordering

The follow-up implementation must not create projection rows that reference
missing parent rows.

Executable order:

```text
1. Read source session.
2. Read and validate previous completed turn.
3. Ensure session row exists in direct thread/projection store.
4. Ensure every source turn row exists in direct thread/projection store.
5. Build or refresh renderer_transcript@1.
6. Commit renderer projection row and set current renderer pointer.
7. Build context_recent_dialogue@1 from the current renderer projection.
8. Commit context projection row and set current context pointer.
9. Create the new follow-up turn.
10. Build direct_context_pack@1 from the frozen context projection.
11. Revalidate frozen projection pointer/digest.
12. Build direct_request_manifest@1.
13. Only then start provider transport.
```

If a transaction is used, parent session/turn/projection rows must be inserted
before child rows that reference them. Failed projection attempts must not
replace current valid pointers.

Database law:

```text
No child projection row may be inserted outside a transaction that already
contains or has committed its parent session/turn/projection rows.
```

SQLite tests must run with:

```text
PRAGMA foreign_keys=ON
```

Current pointer updates are last and conditional:

```text
insert projection row
insert projection items/refs
validate row count and source digest
mark projection valid
update current_renderer_projection_id / current_context_projection_id
```

Failed or blocked projection attempts may be retained as build history, but they
must not become current renderer/context pointers.

### Follow-Up Input Contract

The headless runner should preserve and pass source ids from `--from-report`:

```ts
type DirectHeadlessFollowupSource = {
  fromReportPath?: string; // local private runner state only
  sourceReportId: string;
  sourceReportRunMode: "strict" | "diagnostic-no-promotion";
  sourceReportStatus: "completed" | "diagnostic" | "failed" | "blocked";
  sourceThreadId: string;
  sourceSessionId: string;
  expectedPreviousTurnId: string;
  expectedPreviousTurnDigest?: string;
  expectedNextTurnOrdinal: number;
};
```

Normal UI follow-up from a displayed transcript must pass displayed projection
ids/digests. Headless recovery may omit them only if the controller records the
resolved ids/digests in the report.

Stale-source behavior:

```text
source report previousTurnId = X
store current previous turn = Y
  -> previous_turn_changed

source thread/session missing
  -> direct_thread_missing

source report was diagnostic and strict follow-up was requested
  -> source_report_not_strict
```

Diagnostic follow-up is allowed only in diagnostic mode:

```text
diagnostic first-turn report -> diagnostic follow-up only
strict follow-up -> strict/completed source report only
```

This prevents diagnostic artifacts from accidentally seeding strict readiness.

### Stable Failure Codes

Pre-transport local failures should be renderer-safe:

```ts
type DirectRecentDialogueFollowupBlocker =
  | "direct_thread_missing"
  | "direct_thread_project_mismatch"
  | "direct_thread_schema_too_old"
  | "source_report_not_strict"
  | "previous_turn_changed"
  | "previous_turn_not_safe"
  | "missing_previous_request_manifest"
  | "missing_previous_context_pack"
  | "renderer_projection_failed"
  | "context_projection_failed"
  | "projection_store_integrity_failed"
  | "operation_ledger_changed"
  | "context_store_unhealthy"
  | "request_manifest_failed";
```

Raw `ERR_SQLITE_ERROR`, stack traces, SQL statements, SQLite file paths, and
absolute store paths must not appear in renderer-visible reports.

## Regression Runner

Add a repeatable local runner:

```text
scripts/direct-real-usage-regression.mjs
```

Optional npm alias:

```json
{
  "direct:real-usage": "node ./scripts/direct-real-usage-regression.mjs"
}
```

### Modes

```ts
type DirectRealUsageRegressionMode =
  | "preflight"
  | "live";
```

`preflight` mode:

- must not call the provider;
- may validate auth presence, existing evidence status, report schema, and
  workspace creation.

`live` mode:

- requires explicit opt-in:

```text
CODEX_DIRECT_REAL_TURN=1 or --allow-live-provider-call
```

- refuses in CI unless:

```text
CODEX_DIRECT_REAL_TURN_ALLOW_CI=1
```

- may run the explicit live probe only if requested by a separate flag:

```text
--run-live-probe
```

The real-turn runner must not silently probe when evidence is missing.

### Test Matrix

The live regression should run in this order:

```text
1. app-server baseline first turn
2. strict direct first turn
3. direct recent-dialogue follow-up from the strict direct report
4. direct opt-in guard without live-call opt-in
5. direct client-run-id idempotency check
6. report raw-exposure scan
```

If step 2 fails, step 3 is skipped with:

```text
skipped_dependency_failed
```

The runner may also run:

```text
npm run direct:smoke
```

but must label it fixture-backed, not real-provider coverage.

### Disposable Workspace

Each run creates a disposable workspace with safe fixture content:

```text
README.md
src/example.txt
package.json with harmless scripts
```

The runner report may include a local report path on stdout, but the JSON/MD
summary should use report ids, artifact ids, evidence keys, and relative
workspace labels rather than raw absolute workspace paths by default.

### Report Shape

```ts
type DirectRealUsageRegressionReport = {
  schema: "direct_real_usage_regression_report@1";
  runId: string;
  branch: string;
  commit: string;
  createdAt: string;
  mode: "preflight" | "live";
  liveProviderCallOptIn: boolean;
  liveProbe?: {
    ran: boolean;
    status: "runtime_probed" | "candidate" | "failed" | "skipped";
    evidenceId?: string;
    expiresAt?: string;
    unknownRawEventTypeCount: number;
  };
  cases: Array<{
    caseId: string;
    runtime: "appserver" | "direct" | "local";
    status: "passed" | "failed" | "blocked" | "skipped";
    reportId?: string;
    requestLifecycle?: string;
    providerRequestStarted: boolean;
    providerBytesObserved: boolean;
    failureCode?: string;
    terminalState?: string;
    assistantPreview?: string;
    notes?: string[];
  }>;
  rawExposureScan: {
    scanned: boolean;
    status: "passed" | "failed";
    checkedPatterns: string[];
    findingCount: number;
  };
  fixtureSmoke?: {
    ran: boolean;
    exitCode?: number;
    status: "passed" | "failed" | "skipped";
    coverageClass: "fixture-backed-not-real-provider";
  };
  futureGaps: Array<{
    gapId:
      | "real_read_file_approval_loop"
      | "real_apply_patch_approval_loop"
      | "real_run_command_approval_loop"
      | "real_command_workspace_effect_scan";
    status: "not_covered";
  }>;
};
```

Follow-up reports should include source report provenance:

```ts
type DirectHeadlessFollowupReportSource = {
  reportId: string;
  runMode: "strict" | "diagnostic-no-promotion";
  status: "completed" | "diagnostic" | "failed" | "blocked";
  providerRequestStarted: boolean;
  providerBytesObserved: boolean;
};
```

### Raw-Exposure Scan

Scan generated regression reports, optional Markdown summaries, linked headless
reports, and captured console summaries where feasible for:

```text
raw auth fields
Bearer-like strings
OpenAI/API-key-like strings
refresh/access token field names with values
raw request bodies
raw backend frames
absolute workspace paths
WSL mirror paths
ChatGPT URLs
stack traces
SQL statements
SQLite database paths
```

If a raw-exposure blocker is found:

```text
1. Do not write the unsafe full regression report.
2. Write a minimal redaction-failed report.
3. Exit nonzero.
```

Minimal report:

```ts
type DirectRealUsageRedactionFailedReport = {
  schema: "direct_real_usage_regression_report@1";
  runId: string;
  status: "failed";
  failureCode: "raw_exposure_blocked";
  rawExposureBlocked: true;
};
```

Report write flow:

```text
1. Build report object.
2. Validate schema.
3. Serialize.
4. Run raw-exposure scan.
5. Write full report only if safe.
6. Re-read report.
7. Validate schema again.
```

If scan fails, write and validate only the minimal redaction-failed report.

## UI Implication

This bundle does not change the UI directly, but it should unblock the next UI
test pass.

After this bundle:

```text
Direct text-only selected
  -> strict first turn works with accepted live evidence
  -> follow-up works through recent dialogue
```

The implementation-lane controls remain separate:

```text
Direct implementation lane
  -> requires read/patch/command evidence and approval harness
```

## Recovery and Idempotency

### Evidence Recovery

If the evidence index is compact or stale:

```text
hydrate artifact
validate artifact digest if available
rebuild renderer-safe index row
do not promote candidate evidence
do not rewrite evidence status unless the artifact proves the status
```

If hydration fails, return a stable blocker.

### Headless Run Idempotency

Existing `client-run-id` semantics stay intact:

```text
same client-run-id + same runtime + same project + same prompt digest +
same request shape:
  return existing report

same client-run-id + different runtime/project/prompt/request shape:
  reject client_run_id_conflict

previous report providerBytesObserved=true:
  never auto-rerun under the same id
```

The regression runner should generate deterministic case ids within a unique
run id. Rerunning the same top-level regression run id should return the
existing summary or fail with an explicit conflict.

## Implementation Order

### Phase 0 - Reproduce and Guard

- Keep the 2026-05-12 audit log as the baseline.
- Add a failing unit/regression test for strict direct evidence after a live
  probe artifact is present.
- Add a failing unit/regression test for follow-up projection persistence from
  a completed direct first-turn report.
- Keep foreign-key enforcement on in projection-store tests.

### Phase 1 - Evidence Scope Repair

- Add `scopeCompleteness`.
- Hydrate legacy/compact index rows before returning scope mismatch.
- Store full renderer-safe scope metadata on new live-probe index rows.
- Add mismatch-category reporting without raw scope values.
- Distinguish `request_shape_class_mismatch` from
  `request_shape_hash_mismatch`.
- Distinguish `auth_source` and `evidence_artifact` blockers.
- Verify strict direct first turn no longer needs diagnostic bypass.

### Phase 2 - Recent Dialogue Persistence Repair

- Fix session/turn/projection insert ordering.
- Ensure current renderer/context pointers are set only after valid commits.
- Reclassify raw SQLite errors into stable renderer-safe blocker codes.
- Verify `--from-report` follow-up builds context and manifest before
  transport.

### Phase 3 - Headless From-Report Hardening

- Add source report mode/status to follow-up reports.
- Reject diagnostic source reports for strict follow-up.
- Validate expected previous turn id/digest and next ordinal.
- Add stale-source blocker codes such as `previous_turn_changed`.

### Phase 4 - Regression Runner

- Add `scripts/direct-real-usage-regression.mjs`.
- Add the npm alias if desired.
- Create disposable workspace fixtures.
- Run app-server baseline, strict direct first turn, strict direct follow-up,
  opt-in guard, idempotency, and raw-exposure scan.
- Emit a compact JSON report and optional Markdown summary.
- Include `fixtureSmoke.coverageClass`.
- Include explicit `futureGaps` entries for implementation-lane real-provider
  coverage.

### Phase 5 - Real Re-Test

- Run live probe explicitly.
- Run the new regression runner in live mode.
- Compare against the 2026-05-12 audit log.
- Log remaining gaps without fixing them inside the test pass.

## Smoke Tests

Add or update tests for:

```text
- live probe writes evidence index row with scope metadata
- evidence index rows carry `scopeCompleteness`
- compact legacy evidence row hydrates artifact before scope_mismatch
- hydrated mismatching compact row does not prevent a later exact full-row match
- missing evidence artifact returns live_evidence_artifact_missing
- corrupt evidence artifact returns live_evidence_artifact_corrupt
- request shape class mismatch and request shape hash mismatch are distinct
- auth source/profile source mismatch is renderer-safe
- runtime-probed evidence remains tied to its accepted normalizer event policy
- strict direct first turn succeeds after runtime_probed probe evidence
- diagnostic direct run still does not satisfy activation/readiness gates
- --probe-if-missing remains blocked outside diagnostic probe mode
- SQLite projection tests run with foreign_keys=ON
- recent-dialogue follow-up from report succeeds
- recent-dialogue follow-up preserves from-report source ids in report
- strict follow-up rejects diagnostic source reports
- diagnostic follow-up may use diagnostic source reports only in diagnostic mode
- projection parent rows exist before child projection rows
- current projection pointers update only after valid projection commit
- raw SQLite errors are converted to renderer-safe failure codes
- direct opt-in guard blocks before transport
- client-run-id idempotency returns existing report without rewrite
- raw-exposure scan covers generated JSON reports, Markdown summaries, linked
  headless reports, and captured console summaries where feasible
- report schema validates before write and after write
- direct:smoke remains fixture-backed and is labeled as such
- future implementation-lane real-provider gaps are recorded as not_covered
```

## Acceptance Criteria

- A fresh explicit live probe can produce evidence that strict direct first turn
  accepts without diagnostic mode.
- Evidence scope matching hydrates compact/legacy rows before returning
  `live_evidence_scope_mismatch`.
- Compact/legacy rows cannot return mismatch until artifact hydration is
  attempted.
- Hydrated mismatching compact rows do not block discovery of a later exact
  matching evidence row.
- Evidence mismatch reports include only renderer-safe mismatch categories.
- `request_shape_class_mismatch` and `request_shape_hash_mismatch` are distinct.
- `auth_source` and `evidence_artifact` are renderer-safe blocker categories.
- Evidence matching accepts the event vocabulary recorded by runtime-probed
  evidence under its normalizer version.
- Diagnostic mode remains non-promoting and cannot satisfy activation gates.
- Headless direct first turn exits `completed` in strict mode when evidence,
  auth, and store health are valid.
- Headless direct follow-up with `--from-report` exits `completed` and records
  `twoTurnReport`.
- Headless strict follow-up records source report mode/status and rejects
  diagnostic source reports unless running diagnostic mode.
- Follow-up reports include renderer/context projection ids and digests when
  available.
- Follow-up provider transport never starts until context pack and request
  manifest are durable.
- SQLite tests run with `foreign_keys=ON`.
- Current projection pointers update only after the full valid projection
  transaction commits.
- Failed/blocked projection attempts never replace current valid pointers.
- SQLite/store failures are reported as stable renderer-safe blocker codes, not
  raw `ERR_SQLITE_ERROR`.
- The real-usage regression runner can execute the matrix and produce a
  redacted summary.
- The regression runner refuses live provider calls without explicit opt-in.
- The regression runner does not auto-run live probes unless explicitly asked.
- Regression reports validate against schema before write and after write.
- Generated JSON reports and Markdown summaries pass raw-exposure scanning.
- `fixtureSmoke.coverageClass` explicitly says
  `fixture-backed-not-real-provider`.
- `futureGaps` records read_file/apply_patch/run_command/workspace-effect
  real-provider harness gaps as `not_covered`.
- Implementation-lane read/patch/command real-provider harness remains a
  logged future gap, not silently claimed as covered.

## Final Target

Passing this bundle should mean:

```text
The direct branch can reliably run a strict real text-only first turn and a
strict real recent-dialogue follow-up through the headless harness, with valid
live evidence, durable context/request artifacts, and redacted regression
reports.
```

It should not mean:

```text
direct is production
diagnostic runs satisfy gates
tools are enabled in text-only
implementation-lane real approval loops are fully tested
right-pane ChatGPT is controlled
handoffs are mutated
app-server can be removed
```
