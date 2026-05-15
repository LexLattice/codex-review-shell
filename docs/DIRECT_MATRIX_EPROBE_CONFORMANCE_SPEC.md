# Direct Matrix E-Probe Conformance Spec

## Purpose

The direct roadmap PRs produced a capability matrix and a set of executable
regression reports. This conformance layer makes the relationship explicit:

```text
matrix row law
  -> executable E-probe suite
  -> row-scoped evidence categories
  -> durable conformance report
```

This is not a new direct capability. It is an evidence aggregator that runs the
existing local/headless probe suites and records which matrix rows have
observable behavior evidence.

## Core Law

```text
E-probe pass != production readiness
fixture evidence != real-provider promotion
diagnostic row coverage != local authority
report aggregation != behavior implementation
matrix gap != silent success
```

The report may say a row is covered, failed, or needs more probe expansion. It
must not upgrade runtime authority, change project tier, start live provider
calls by default, mutate app-server state, or treat fixture coverage as a real
provider proof.

## Probe Shape

Every E-probe suite records:

```ts
type DirectMatrixEProbeSuiteResult = {
  probeId: string;
  suiteId: string;
  coverageLevel:
    | "fixture_behavior"
    | "fixture_ui"
    | "headless_runtime"
    | "real_provider"
    | "diagnostic";
  status: "passed" | "failed";
  reportSchema: string;
  reportId: string;
  reportDigest: string;
  reportPathEvidenceKey: string;
  rawReportPathIncluded: false;
  matrixRowsExercised: string[];
  evidenceCategories: Array<
    | "positive"
    | "negative"
    | "recovery"
    | "visibility"
    | "promotion"
  >;
  missingRequiredCategories: string[];
  rawExposureSafe: boolean;
};
```

The categories mean:

- `positive`: intended behavior executed successfully.
- `negative`: adjacent forbidden behavior was blocked or shown as
  non-authoritative.
- `recovery`: interrupted, stale, corrupt, replay, retry, or idempotency law was
  exercised.
- `visibility`: renderer/status/history/witness projection truth was exercised.
- `promotion`: fixture/diagnostic coverage was proven not to promote runtime
  authority.

## Row Conformance

Each matrix row becomes:

```ts
type DirectMatrixRowEProbeConformance = {
  rowId: string;
  capability: string;
  directStatus: string;
  requiredForCurrentConformance: boolean;
  status:
    | "passed"
    | "failed"
    | "needs_probe_expansion"
    | "intentionally_unsupported"
    | "not_required";
  evidenceCategories: string[];
  probeRefs: Array<{
    probeId: string;
    suiteId: string;
    coverageLevel: string;
    reportDigest: string;
    reportPathEvidenceKey: string;
    rawReportPathIncluded: false;
  }>;
};
```

Rows with executable evidence must pass. Rows marked built or scaffolded in the
matrix but not exercised are reported as `needs_probe_expansion`; this is not a
silent pass. Strict mode may fail the whole report on those gaps.

## Current Suite Inventory

`npm run direct:matrix-eprobes` runs these local suites:

- `direct-real-usage-regression.mjs` in preflight mode.
- `direct-implementation-proof-regression.mjs` in preflight mode.
- `direct-recovery-regression.mjs`.
- `direct-iterative-repair-regression.mjs`.
- `direct-workspace-mutation-regression.mjs`.
- `direct-ui-operation-history-regression.mjs`.
- `direct-thread-evidence-workbench-regression.mjs`.
- `direct-governance-broker-regression.mjs`.
- `direct-sub-agent-observability-regression.mjs`.
- `direct-usage-readiness-regression.mjs`.

By default this is a no-live-provider, no-app-server-mutation pass. Live
provider rows remain governed by their existing opt-in scripts and must not be
run implicitly by this aggregator.

## Report

The report schema is:

```text
direct_matrix_eprobe_conformance_report@1
```

The report includes:

- matrix digest;
- per-suite report digests;
- per-row conformance;
- evidence categories;
- explicit probe expansion gaps;
- raw-exposure scan result;
- law flags proving diagnostic/fixture aggregation did not grant authority.

Raw report paths are not written. The report stores path evidence keys only.

## Acceptance

- The aggregator runs the current local/headless E-probe suites.
- Each child report must pass its own schema/raw-exposure/report validation.
- Failed child cases fail their suite and row evidence.
- Rows with executable evidence are mapped back to canonical matrix row IDs.
- Built/scaffolded rows without executable evidence are surfaced as
  `needs_probe_expansion`.
- Fixture-only suites cannot promote real-provider or authority rows.
- The final report is raw-exposure scanned and re-read after write.
- Default mode performs no live provider calls and no app-server mutations.
