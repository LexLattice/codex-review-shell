# Direct worker artifact/audit substrate

Status: pilot substrate. This is a Direct Workbench ledger. It neither reads nor writes WorldManager canonical stores and it has no project-truth authority.

## Law and boundary

The trusted harness pins an artifact-class policy digest and actor/role/purpose bindings before opening the store. It issues opaque declaration, action, and evidence-registration principals; copied JSON and a role claimed inside a proposed policy have no authority. A declaration principal is checked against the harness binding independently of the proposed policy. The resulting policy is rebuilt, recursively frozen, and revalidated whenever it crosses a persistence or routing boundary.

The policy keeps `read`, `propose`, `challenge`, `admit`, and `subscribe` rights independent, names eligible producer and auditor roles, states producer/auditor separation requirements, and designates the sole admission role. Routing performs deterministic bipartite matching: each required audit must have a different auditor, and every advertised producer must have a complete feasible audit assignment that observes required producer separation. An impossible policy is rejected at declaration. A plan identifies eligible bindings and witness assignments; it does not select or launch a provider.

Each instance follows this typed lifecycle:

`requested -> under_production -> candidate -> under_audit -> supported | requires_revision | contradicted -> admitted | rejected | remanded`

A remanded artifact advances to a new revision only when production restarts. Every audit is bound to the exact project, workthread, artifact class, artifact, revision, policy digest, requirement, actor, and registered evidence record. Evidence cannot be introduced with caller-chosen reference syntax: the trusted adapter registers a canonical record whose source capture, session, turn, and canonical-envelope digest are persisted, then lifecycle calls resolve the returned ID/digest pointer from the registry. A new revision has a fresh audit set. A workspace-worker terminal record is evidence for `candidate_recorded`; it is never evidence of admission and never changes project truth.

Workers do not actively message or request the parent. Candidate and verdict facts are append-only ledger transitions. A parent must hold both `read` and `subscribe`, create an immutable subscription, and poll a bounded safe projection. Projections contain typed transition metadata and exact evidence references only; they contain no prompts, paths, provider payloads, transcripts, commands, or artifact bodies.

## Persistence and concurrency

`createDirectArtifactAuditStore` derives a dedicated SQLite path from an absolute root and bounded store identity. It accepts neither a database handle nor an arbitrary database filename. Before running DDL it rejects symlinks, borrowed/foreign schemas, unexpected tables (including WorldManager tables), mismatched path/store/authority identity, and altered schema definitions. The handle and every mutation helper are JavaScript-private.

The database uses WAL, foreign keys, full synchronous durability, and store-owned immediate transactions. An unexpected outer or reentrant transaction is rejected instead of returning success for work another caller can roll back. Policy declarations, registered evidence, events, audit verdicts, and subscriptions are append-only. Events form one sequence-contiguous digest chain from a store-specific genesis digest. The mutable artifact head is a projection updated by exact revision/state/version compare-and-swap in the same transaction as its event. Idempotency is scoped by actor, operation, and key; it persists a safe canonical input envelope and its digest, and reuse with different input is rejected.

Every open runs SQLite integrity and foreign-key checks, revalidates canonical policy/evidence/event JSON and row bindings, checks declaration/registration/subscription hashes and the event chain, replays authorization and lifecycle history, reconstructs all audit sets and heads, and compares those projections with persisted rows. Any foreign, incomplete, or tampered store fails closed.

The store rejects unissued or copied principals, unknown or forged actor/role pairs, missing rights, policy digest substitution, unregistered or cross-scope evidence, stale heads, duplicate requirement verdicts, reuse of one auditor identity within a revision, forbidden self-audit, and incomplete admission. Admission requires a complete `supported` audit set plus an explicit `admitted` decision from the designated role. Raw-shaped keys and path-like values are rejected recursively at both API ingress and final event construction.

## Integration seams

The substrate deliberately does not connect to the native agent pool, workspace backend, provider runtime, `src/main.js`, or WorldManager. A later integration may receive a service-issued principal, resolve a durable workspace-worker capture, and register its canonical terminal-envelope digest as `workspace_worker_terminal` evidence. That adapter must preserve the capture/session/turn identity, policy digest, and full artifact scope; it must not accept a caller-minted evidence record, actively message an upstream agent, or promote a candidate to project truth. A separate, explicitly authorized bridge would be required for any canonical WorldManager admission.
