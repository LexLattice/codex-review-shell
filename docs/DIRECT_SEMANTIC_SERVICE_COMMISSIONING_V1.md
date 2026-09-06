# Direct semantic service commissioning v1

This revision commissions a local, advisory path for one finite S14 M2
occurrence-chain review. It is a new composition contract. DSS-0.2 retains
durable admission and authenticated transport; its frozen custody projections
and DSS-0.4/0.5/0.6 generation identities do not acquire new meanings.

## Authority and evidence

The owner installs an immutable commissioning pack in the protected host
profile. Its digest binds the exact compiler source closure, interpreter,
S14 source module, finite evidence snapshots, route selector, worker revision,
and attempt policy. Installation authorizes this bounded audit only. Neither
fixture evidence nor a compiler receipt constitutes an M0/M1/M2 authority root.
The compiler holdout's unresolved production executor registry remains unresolved.

Local `init` creates and consumes its one-use bootstrap secret inside the same
owner process, under a signed `owner_local_initialization` descriptor policy.
It does not claim an inherited file descriptor. Later task processes use the
separate protected task credential and actual socket challenge/proof exchange.

A task supplies an ordinary authenticated SemanticJobRequest containing exact
installed references. Caller prose, executable paths, modules, evidence bytes,
runtime settings, and expected verdicts cannot enter this request. Admission
requires the installed reference tuple to match before any work is queued.
An exact idempotency replay returns the same durable job; conflicting reuse
fails. The submit proof, principal, verifier, request digest, and installed
pack are retained as the durable authorization basis for coordination.

The trusted compiler runs the actual installed compiler source in a separate
network-isolated process. Its immutable input is the installed S14 module.
Source bytes and interpreter identity are checked before dispatch. The
compilation's module digest, obligation identities, static remands, and exact
selected subject/template population are checked before page construction.
The full compilation stays in host custody; materialization selects a declared
finite review, rather than representing that review as full-module coverage.

The page contains the compilation digest, relevant obligation identities,
bounded kernel law, and exactly one installed evidence snapshot. Expected
outcomes and host paths are absent. Every compiled obligation remains
UNPROVEN: SUPPORTS means only that this finite, declared evidence satisfies
the commissioning kernel. It is not proof of production currentness, native
population completeness, lineage authority, lease validity, or S14 acceptance.

## Kernel and admission

The first kernel reviews a finite, ordered occurrence chain: one declared
entity, one genesis endpoint, unique bindings, consecutive ordinals, exact
predecessor and adjacent endpoint joins, and no repeated occurrence apart
from that adjacent join. Snapshot revision and occurrence identity are distinct
types of reference. Missing lineage or incomplete evidence remands; stale
revision remands; an unresolved alternative yields INCONCLUSIVE; a broken
finite topology yields REFUTES; a coherent finite chain yields SUPPORTS.

The deterministic worker receives only its closed JSON page and attempt
identity over stdin. The installed launcher uses a fresh network/PID/mount
namespace, cleared environment, private scratch, read-only worker and system
runtime, no repository/home/profile mounts, bounded time and bytes, and no
caller-supplied commands. Actual process and isolation observations accompany
the raw result. A missing launcher or failed isolation yields unavailable
transport, never invented availability evidence. A model provider is a separate
backend that must independently meet this boundary; deterministic acceptance
does not claim provider acceptance.

Raw compiler and worker bytes enter durable custody before canonical admission.
Admission checks the exact attempt/page/worker binding, closed response shape,
allowed status, page-local evidence references, and authorityEffect=none.
Malformed or foreign output is retained and rejected. Admission validates the
response contract, not the truth of its verdict. The commissioning test oracle
is separately pre-adjudicated and is never supplied to the worker.

## Durable coordination and recovery

The new coordinator owns explicitly named commissioning tables in the daemon's
existing SQLite store, under the same exclusive writer lock. Its authenticated
append-only records bind each state revision and prior record. They do not
insert execution claims into DSS-0.2's custody-only event population.

The existing admission is the durable outbox: if a process stops before the
commissioning row exists, recovery reconstructs it from the admitted request
and its genuine authorization record. Before handoff, the coordinator checks
the admitted credential is still current and the installed references match.
It acquires the existing generation-fenced handoff lease and records the
existing later-tranche handoff. The original submit authorization delegates
only this exact installed revision; recovery does not reuse an old challenge
as a fresh client proof or fabricate an authorization receipt.

Queued work can resume after restart. A previously dispatched attempt with no
durable raw outcome is interrupted/REMANDED, with no silent rerun. Durable raw
output may be admitted after restart without launching the worker again.
Terminal results survive submitting-task exit and daemon restart. Restart
reconciles the commissioning record chain, admission joins, handoff, raw bytes,
result identity, delivery offers, and acknowledgments before serving results.
Corrupt or orphaned records block commissioning.

Cancellation before the existing handoff retains DSS-0.2's cancellation law.
After handoff it reports the lost race; this tranche does not promise forced
cancellation of a started audit. Host shutdown aborts its active child and
persists interruption when possible. Abrupt death uses the restart rule above.

## Projection and acknowledgment

Commissioning responses use their own schema and projection revision. A
current authenticated credential may read or acknowledge only its principal's
job. The original custody projection remains available under its own revision.
Result offers contain a stable digest of the exact safe terminal projection,
an immutable delivery identity, job and principal binding, and a revision.
Acknowledgment consumes that exact offer and digest. It never admits a raw
result or grants semantic authority. A lost acknowledgment can be replayed;
an unacknowledged terminal offer remains retrievable across daemon generations.

The public projection omits raw bytes, private keys, paths, compiler source,
credential records, and process environment. Every result remains advisory
with authorityEffect=none. Process observations, malformed outputs, and local
test receipts stay in protected host custody or external scratch evidence.

## Commissioning evidence

Acceptance requires an independently pre-adjudicated mixed finite family,
actual compiler and isolated worker processes, authenticated task submission,
exact replay/conflict and foreign-principal negatives, quarantine/admission
negatives, and submitting-task exit plus daemon restart with exact result
retrieval and acknowledgment. It must distinguish completed deterministic
commissioning from any unrun live provider, UI, full-regression, or production
S14 gate.

## Operator commands

Use Node 24 (the service uses `node:sqlite`) and Linux with bubblewrap and
unprivileged namespaces. Run from this repository. Initialize new, private
installation/profile paths; initialization refuses to overwrite an existing
installation. `--compiler-root` must be the authoritative semantic compiler
checkout with its working `.venv` and clean installed source closure.

```sh
npm run direct:semantic-service-commission -- init --installation-root /absolute/private/installation --profile-root /absolute/private/profile --compiler-root /absolute/semantic-compiler
npm run direct:semantic-service-commission -- start --config /absolute/private/profile/host/host-config.json
```

Keep the host running in an independent terminal or supervised process. In a
separate task/terminal, submit the installed request path reported by `init`:

```sh
npm run direct:semantic-service-commission -- client --config /absolute/private/profile/host/host-config.json submit /absolute/private/profile/host/requests/request-1.json
npm run direct:semantic-service-commission -- client --config /absolute/private/profile/host/host-config.json results JOB_REF
npm run direct:semantic-service-commission -- client --config /absolute/private/profile/host/host-config.json ack DELIVERY_REF --digest PROJECTION_DIGEST
```

The submitting process may exit. Stop the host with SIGTERM and use the same
`start` command to recover. No OS autostart or graphical task integration is
installed by these commands. Profiles pin implementation bytes: source changes
require a new profile; this revision supplies no in-place migration.

For a real model backend, add `--provider-auth-root /absolute/direct-auth` to
`init`, or use `--provider-auth-file /absolute/codex/auth.json` for an
explicit existing Codex CLI credential file. No credential source is selected
by the submitting task and there is no implicit fallback. The trusted host reads existing credentials and sends one closed-page
request to the fixed Codex Responses endpoint using `gpt-5.6-sol`, reasoning
`max`, no tools, no prior conversation, and `store:false`. The model receives
only fixed kernel instructions and the materialized page/attempt identity.
Network and authentication belong to the host; this is remote request
isolation, not a claimed local network namespace around the model. The pack
pins adapter, transport, and host Node bytes. Requests have a 60-second limit,
a 2-MiB wire cap, a 64-KiB result cap, and no retry or credential refresh.
Provider errors remand. Raw wire data is retained in protected custody before
admission; public projections omit it. The installed evidence is synthetic
commissioning evidence, not repository content or production authority.

```sh
npm run direct:semantic-service-commissioning -- --compiler-root /absolute/semantic-compiler
npm run direct:semantic-service-commissioning-recovery -- --compiler-root /absolute/semantic-compiler
npm run direct:semantic-service-commissioning-provider
npm run direct:semantic-service-commissioning -- --compiler-root /absolute/semantic-compiler --provider-auth-root /absolute/direct-auth --allow-live
```

The provider regression uses mocks only. The final command explicitly performs
live requests across the ten pre-adjudicated cases and repeats the durable
lifecycle checks. It retains a receipt in `/tmp`, prints its path, and fails
if any actual result differs from the sealed oracle. An intentional final
corruption witness leaves its disposable acceptance profile unusable.
