# Direct recent work and intent reconciliation

Date: 2026-09-06. Current product subject: `main` / `origin/main`,
`e46b3effc95a3fe7e7eb3d3146106b87a5a6c352`.

This is a read-only architectural/status review with four targeted regression
runs. It adds no runtime behavior and does not reopen completed batches.

## Latest intent recovered from CK

The most recent explicit product batch was **Direct app-server default
capability parity**, created September 2 and closed September 3. Its objective
was an ordinary Direct task experience with the complete admitted harness
capability set, selected through one owner-issued full-access task profile,
without repeated local approval interference. Task, project, environment,
child inheritance, restart, revocation, and external-account boundaries remain
exact. App-server stays available as a fallback.

This followed a second major intent: **a persistent semantic-audit service**.
The standalone semantic compiler defines versioned semantic law. Direct owns
the daemon, identities, sealed evidence materialization, scheduling, isolated
execution, attempt accounting, result admission, persistence, and delivery.
A task submits a bounded job and may stop; the service retains responsibility
for work and eventual delivery. Its results remain advisory.

The broader architecture remains one Direct runtime kernel supporting two
experiences: Direct Workbench for ordinary task work, and WorldManager Studio
for semantic settlement and governed project/world state. Workbench task
results do not automatically become canonical WorldManager knowledge.

Therefore the current direction is: make Direct a dependable everyday execution
substrate, then operationalize reusable semantic verification over it. The
older context-checkpoint work remains relevant, but it was not the latest
declared batch priority.

Sources: CK-reconstructed
`docs/operations/direct-appserver-default-capability-parity/batch_charter.v1.json`
and `batch_closeout.v1.json`; the
[semantic-service constitution](../DIRECT_SEMANTIC_SERVICE_V0_CONSTITUTION.md);
the [experience split](../DIRECT_WORKBENCH_AND_WORLDMANAGER_STUDIO_SPLIT_SPEC.md).
The parity closeout explicitly pauses for owner direction rather than naming
another automatic implementation batch.

## What was built recently

| Period / PRs | Delivered capability | Important boundary |
| --- | --- | --- |
| August 11, #295–#302 | General plan-to-execution continuation; Workbench project/thread intake and lifecycle; typed epistemic context admission into actual provider input | Canonical semantic admission and task execution remain distinct. |
| August 11–12, #303, #305, #307–#309 | Workspace workers, lifecycle/recovery, provider-visible worker evidence, live activity, and artifact/audit substrate | Worker completion alone is not an independently verified semantic verdict. |
| August 21–24, #310–#311 and intervening commits | Usage evidence, external-provider worker continuation, self-constitution, and initial semantic-service contracts | Provider-specific evidence does not establish capability on every backend. |
| September 5 local time, #312 | Imported the larger retained product lineage: DSS-0.2–0.6, ordinary Direct full access, process/filesystem execution, thread controls, external capability wiring, and SC11 production delivery debounce, followed by review repairs | Documentation/audit history was deliberately excluded from the PR; source and maintained fixtures were retained. |

### The default task runtime

The five closed parity slices cover:

1. Durable owner-issued task grants and a truthful full tool declaration.
2. Local filesystem/patch execution, stateful process sessions, stdin, bounded
   output, cancellation, and recovery.
3. Resume, fork, rollback, steer, interrupt, and per-turn model/effort/tier
   controls with durable lineage.
4. Account/model/usage/environment surfaces, attachments, hosted tools, and
   configured MCP discovery/resource reads.
5. Ordinary/default Direct selection and an explicit app-server fallback.

Current source creates the default example project with `runtimeMode: direct`
and label `Direct full access`. The current parity ledger classifies 184 local
app-server-profile capability paths: **37 equivalent and 147 intentionally
different**. This is complete classification of that profile, not proof of
184 identical behaviors or automatic parity with every new upstream release.

The archived closeout retains three explicit residuals: dynamic MCP mutation /
elicitation, PTY transport, and live-provider end-to-end mutation evidence.
Plain-pipe stateful execution was sufficient for the accepted local contract.

### The semantic service

| Tranche | Implemented purpose |
| --- | --- |
| DSS-0.1 | Principals, capabilities, immutable registry and compiler identities. |
| DSS-0.2 | Durable daemon/job kernel, SQLite/CAS/quarantine custody, protocol, cancellation, recovery, subscriptions, and acknowledged delivery. |
| DSS-0.3 | Deterministic execution and lifecycle/evidence-law verification. |
| DSS-0.4 | Exact compiler adapter, route compilation, closed evidence-page materialization and sufficiency/currentness checks. |
| DSS-0.5 | Closed-page runtime/model-adapter contracts, request/attempt lineage, raw-result quarantine, canonical response/usage and advisory disposition. |
| DSS-0.6 | Bounded AuditPackage/AuditJob/AuditDisposition handoff, observations, delivery offers, acknowledgments/cursors, replay, restart and wakeup. |

The CK-preserved final v0 acceptance receipt records
`LOCAL_CONSTITUTIONAL_ACCEPTANCE_PASS`: **46 games and 92 primary/counterpart
invocations**, with six fresh games and 40 reused under the recorded evidence
conditions. It records no critical residuals for that historical local subject.
This supersedes the earlier master-status paragraph saying the acceptance
batch is awaiting execution. A new DSS-0.7 semantic tranche is not required to
finish that already-closed local acceptance.

This acceptance does not establish a live deployed service. DSS-0.5 explicitly
excludes Spark/live-provider breadth in its frozen subject; current source
keeps that exclusion. The production daemon/CLI inspected here expose DSS-0.2
protocol ownership, while DSS-0.4/0.5/0.6 are separate service implementations
used by their bounded regression paths. No Electron/main-process consumer of
those later factories was found in this review. Commissioning needs a concrete
adapter/composition scope and its own operational witness, rather than assuming
that exported classes imply a connected production service.

### SC11

The bounded ImplementationPatch artifact lifecycle already joins producer and
independent auditor work, mechanical and semantic evidence, remand/escalation,
gate readiness, and separately authorized canonical admission.

#312 adds runtime-owned debounce/coalescing, timer-driven delivery, pending
outbox reconciliation, correct drain behavior when more work arrives during a
drain, and restart/deadline/lineage handling. The old standby document's
"production debounce" todo is now stale. Generic manager ledger-provider
lanes and true suspended-provider resume remain documented generalization
frontiers.

## What the last PR's review work accomplished

[PR #312](https://github.com/LexLattice/codex-review-shell/pull/312) merged at
`e46b3ef`, from final head `427b584`. Its current PR body still names initial
head `ae936b3` and describes one linear commit, so those fields are historical.
The final PR has 13 commits: the product import plus 12 successor commits.

GitHub contains 40 top-level P1/P2 review comments across its successive
subjects, plus replies. This is a comment count, not a count of unresolved or
independent defects. The repairs cluster around five requirements:

- **Authority must come from the owner:** prevent renderer/request-created
  grants and preserve exact current task/environment scope.
- **Effects and recovery must stay truthful:** durable command/patch claims,
  no fabricated success or silent replay after ambiguous execution, stale
  rollback rejection, and reconciliation of persisted recovery state.
- **Processes must actually settle:** bounded process I/O, chunk-safe decoding
  and framing, asynchronous error handling, stdin continuity, backpressure,
  cancellation escalation, and child reaping.
- **Delivery must be durable and usable:** debounce timers must dispatch;
  newly queued work must drain; waits return acknowledgeable offers; cursors
  advance only through the correct acknowledgment.
- **Evidence must retain identity:** attachment and MCP result custody,
  bounded reads/patch inputs, CAS identity reuse, and relocatable provisioned
  compiler custody.

The CK-preserved realization-closure method captures the broader lesson:
freeze semantic meaning, then explicitly map operations, storage, dependencies,
effects, authority and recovery into the implementation before coding. Review
repairs should conserve that law, not let backend accidents define new law.

## What remains, in recommended order

1. **Triage the surviving SC11 runtime-evidence gate failure.** The current
   test times out at `runtime evidence lifecycle gate ready`, with
   `artifact_runtime_repository_state_stale` in its diagnostics. This review
   confirms a failing gate, not its root cause. Restore a meaningful green
   integration witness before extending that path.
2. **Run a bounded everyday-use acceptance for ordinary Direct.** The local
   parity route passes, including restart and zero per-call local approvals;
   its provider and delegated child are mocked. The archived parity closeout
   explicitly leaves a real-provider end-to-end mutation run unexecuted.
   Tie that acceptance to the actual selected provider/environment and current
   merged source, with app-server fallback still available.
3. **Commission the semantic service as one usable path.** Define how the
   existing daemon, compiler/materializer, closed-page adapter, and task
   submission/result-delivery client compose. Preserve the completed local
   v0 semantics and explicitly settle any newly required live adapter boundary.
   The constitution's proposed first industrial experiment is one S14 family
   with 8–12 pre-adjudicated cases, including support, refutation, missing or
   stale evidence, insufficient routes, malformed output and a counterexample.
   Model agreement alone is not success; failures must be attributable to
   kernel, route, materialization, isolation, execution, admission or evaluation.
4. **Reconcile current operational evidence and documentation.** This document
   provides a current overlay. The main master/standby files still mix old
   branch pointers, unstarted batches, and now-completed work. The historical
   46-game receipt and the merged/repaired source are different subjects;
   preserve their relationship and use proportional current gates instead of
   transferring exact-head acceptance or blindly repeating the expensive old
   DSS-0.4 route. Some archived gate command names also need mapping to current
   package scripts.
5. **Then select the next deeper semantic frontier.** The existing WorldManager
   map lists authoritative project-world activation/porting, canonical
   user-authored policy admission, remaining SC11 generalization, the SC12
   recursive ODEU control circuit, K7 renderer hardening, and voice/live
   acceptance. Those are real backlog items, not evidence that the last parity
   or v0 local-acceptance batch is unfinished. Resident checkpoint continuity
   is another concrete candidate, as described in the preceding comparison.

Items 2–3 are my recommended product direction from the documented intent;
they are not a previously authorized next batch. The current request is an
overview, so no implementation or live commissioning was started.

## CK custody and source reconciliation

The maintained
[custody pointer](../../src/main/direct/semantic-service/resources/dss04-ck-custody-pointer.v1.json)
binds three accepted raw intakes beneath
`/home/rose/data/ck-evidence-vault/raw/direct-harness/`:

- `direct-harness-20260903-00c38bcc`: archaeological source and evidence cutoff
  at `00c38bccd0cd771789f65d3db55086798721ffce`.
- `direct-harness-20260904-postcutoff-docs-0158cbfe`: six supplementary
  documentation/closeout objects, including the corrected SC11 roadmap.
- `direct-harness-20260904-recomposition-manifests-a1`: exact retained/excluded
  path manifests.

For this review, custody receipts and immutable manifests were checked against
the maintained pointer's file hashes; export manifests were checked against
the immutable manifests. The archaeological bundle hash was verified and an
isolated bare reconstruction passed `git fsck --full`. Retrieved document
bytes were checked against their path length and SHA-256 before use. No
archaeological history was attached to the product repository.

Important source records inside the first accepted bundle:

- `docs/operations/direct-appserver-default-capability-parity/batch_charter.v1.json`
- `docs/operations/direct-appserver-default-capability-parity/batch_closeout.v1.json`
- `docs/operations/direct-semantic-service-v0-constitutional-acceptance/slice_03_final_integration_gate_receipt.v1.json`
  — receipt digest `sha256:ea4b50f941c96fec530365c50b8e8ec13f6cca529119ade3bf8bd51e6f0aa409`.
- `docs/DIRECT_PROJECT_MASTER_STATUS.md` — September 2 snapshot plus local
  constitutional acceptance closeout.
- `docs/DIRECT_SEMANTIC_REALIZATION_CLOSURE_METHOD.md` and the DSS-0.2–0.6
  implementation contracts.

Older records saying `CK_READY_NOT_DELIVERED` are superseded as descriptions
of **raw storage** by the later accepted custody receipts. Raw custody does not
establish admitted knowledge, semantic-law promotion, or commissioning.
The pointer's source cutoff also must not be treated as a snapshot of all the
later #312 repair commits; those were inspected through current Git/PR evidence.

## Current verification

| Check at `e46b3ef` | Result |
| --- | --- |
| Current parity ledger validation | PASS; 184 classified paths |
| `direct-appserver-capability-parity-integration-regression.mjs` | PASS; local execution, mocked provider/child, interrupt/resume, usage and restart |
| `direct-world-manager-epistemic-fabric-regression.mjs` | PASS; includes production debounce/coalescing/restart games |
| `direct-headless-implementation-runtime-regression.mjs` | PASS; the old PR-body failure is no longer current |
| `direct-world-manager-runtime-evidence-bridge-regression.mjs` | FAIL; lifecycle gate-ready timeout and stale repository-state diagnostic |

Temporary retrieval copies, GitHub snapshots and current test output are under
`/tmp/direct-pr312-overview-uDWLYm/`; they are convenience artifacts, not new CK
custody. No full suite, full SC11 aggregate, Electron/web gate, ARC SDK run,
live-provider run or expensive historical DSS-0.4 acceptance rerun was made.
The runtime-evidence failure was recorded without changing code or tests.

### September 6 follow-up: SC11 fixture repair

The first triage item above is resolved in the working tree. The regression
fixture stamped repository observations with a fixed August clock while patch
and command authorities recorded actual wall time. The production stale-evidence
rejection was correct. The fixture now uses monotonic time aligned with the wall
clock and explicitly checks that the focused-test record precedes the repository
observation, which precedes the runtime receipt. Production sources are unchanged.

Luna returned the bounded repair through the owner–worker CLI. Owner validation
found the exact return current and internally consistent; independent reruns of
the runtime-evidence bridge and epistemic-fabric regressions both passed, as did
`git diff --check`. Stale observations and model self-reports remain rejected;
gate readiness remains distinct from canonical admission.

Owner acceptance covers this fixture repair only. The worker return retains seven
unsettled project-discovery/closure obligations and does not establish whole-project
semantic closure. Local workflow artifacts and owner evidence are under
`/tmp/direct-sc11-semantic-worker-tTfQ32/`; they are temporary evidence, not CK
custody. The broader gates and live runs listed above were not run in this repair.

### September 6 follow-up: ordinary Direct live acceptance

Item 2 was executed as a bounded acceptance and **failed**. The new
`scripts/direct-everyday-live-acceptance.mjs` uses the production controller,
task grant, stateful execution and local filesystem adapters, a real scoped
readiness probe, and a disposable three-file arithmetic fixture. Its offline
regression passes 25 executable rejection cases plus carrier extraction,
the local fixture oracle, output containment and explicit live opt-in checks.
The existing parity integration regression also passes. These offline results
do not establish live acceptance.

Two distinct live selections were observed:

- The saved Windows Direct profile selected `gpt-5.6-sol / ultra`. A real
  readiness probe returned HTTP 200 and the same model; the mutation request
  returned HTTP 400 because this endpoint rejects `ultra` and supports up to
  `max`. Evidence: `/tmp/direct-everyday-live-owner/run-dYkFxp/report.json`.
- The owner explicitly selected `gpt-5.6-sol / max` for the second isolated run.
  All five provider requests returned HTTP 200. Real command execution, zero
  per-call approval requests, and task/grant restart readback were observed.
  No source repair occurred; the run failed on an empty `write_stdin` request
  after a previously running process had already terminated. Evidence:
  `/tmp/direct-everyday-live-owner/run-XoOV6r/report.json`.

The earliest source-confirmed defect is loss of original task context in
`continueAfterSafeResidentUtilityResult`: its fresh-context request supplies
the latest tool result but neither the original repair instruction nor a
previous-response handle. Continuations also omit the selected reasoning effort.
The second run retained an earlier result inside its producer obligation but
lost that result from `turn.toolResults`. The terminal-session polling failure
is a later independent boundary issue. Preserve this order when constituting
the next runtime repair; increasing timeouts or constraining the model to one
tool call would not repair these contracts.

The worker's candidate was returned for repair and then corrected by the owner;
final owner checks are in
`/tmp/direct-everyday-worker-gr2ip_ul/owner-final-checks.json`. Source investigation
is retained in `earliest-boundary.json` in the same directory. These are local
temporary observations, not CK custody or semantic proof. Source HEAD was
`e46b3effc95a3fe7e7eb3d3146106b87a5a6c352`, with exact source content digests in
each run report. Production sources and saved app configuration were unchanged.
No full suite, full SC11 aggregate, GUI/Electron/web gate, delegated-child live
acceptance, or ARC SDK run was performed for this step.

### September 7 follow-up: continuation repair and passing live acceptance

The three runtime faults above are repaired in the working tree. The controller
now preserves the fully admitted initial input, instructions, and selected runtime
settings in a durable, task/turn-bound snapshot. Fresh utility continuations reuse
that context and append quoted results joined to their exact producing obligations.
Missing or mismatched context remands explicitly. Each utility result now carries
its obligation ID. Empty process polls authorize the exact session before returning
its current state, including after exit; terminal writes and EOF remain rejected.
Initial request reconstruction also preserves the selected service tier.

All seven bounded package checks pass. Owner independently reran the continuation,
utility, full-local-harness and parity regressions. Both thread-store routes complete
real local read–repair–test sequences with three distinct results and restart
readback. Eighteen context/lineage negatives pass. Isolated original-HEAD witnesses
reproduce the missing context snapshot, loss of the first of three results, and
rejected empty terminal poll; repaired producer/poll witnesses pass.

The new real-provider acceptance **passed** with `gpt-5.6-sol / max`: four HTTP-200
requests including readiness, two actual completed command results, exact source
repair, unchanged test and manifest, independently passing test, zero per-call
approvals, and successful task/grant restart readback. Cleanup completed with no
active sessions. Live evidence is
`/tmp/direct-continuity-live-owner/run-4t3rrN/report.json`; the tested source digest
is `5399ff63544d8c3fb377057f9ab0507a45bf8a890a74140f520c36d2a86ed752`.

Owner closeout and exact package/check identities are in
`/tmp/direct-continuity-repair-66ej385w/owner-closeout.json`. The worker's intermediate
witnesses were rejected and corrected by the owner. All semantic proof statuses
remain UNPROVEN and seven module closure/discovery obligations remain unavailable;
this is bounded acceptance, not whole-project semantic closure. The package receipt
identifies the candidate before this documentation append. Evidence remains local
temporary storage, not CK custody. Changes are uncommitted.

Saved settings were not changed: `ultra` remains unsupported by this endpoint.
Legacy in-flight turns missing the new context snapshot now remand explicitly.
No full suite, full SC11 aggregate, GUI/Electron/web gate, delegated-child or
interrupt live acceptance, or ARC SDK run was performed in this repair.
