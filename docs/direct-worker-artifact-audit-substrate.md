# Direct worker artifact/audit substrate

Status: pilot substrate. This is a Direct Workbench ledger. It neither reads nor writes WorldManager canonical stores and it has no project-truth authority.

## Law and boundary

An orchestrator or manager declares one immutable, project-scoped artifact-class policy. The policy binds actors to roles, keeps `read`, `propose`, `challenge`, `admit`, and `subscribe` rights independent, names eligible producer and auditor roles, states auditor-separation requirements, and designates the sole admission role. The harness compiles that declaration into a deterministic routing plan. A plan identifies eligible role bindings; it does not select or launch a provider.

Each instance follows this typed lifecycle:

`requested -> under_production -> candidate -> under_audit -> supported | requires_revision | contradicted -> admitted | rejected | remanded`

A remanded artifact advances to a new revision only when production restarts. Every audit is bound to the exact project, workthread, artifact, revision, policy digest, requirement, actor, and typed evidence references. A new revision has a fresh audit set. A workspace-worker terminal reference is evidence for `candidate_recorded`; it is never evidence of admission and never changes project truth.

Workers do not actively message or request the parent. Candidate and verdict facts are append-only ledger transitions. A parent must hold both `read` and `subscribe`, create an immutable subscription, and poll a bounded safe projection. Projections contain typed transition metadata and exact evidence references only; they contain no prompts, paths, provider payloads, transcripts, commands, or artifact bodies.

## Persistence and concurrency

`DirectArtifactAuditStore` uses a dedicated SQLite database with WAL, foreign keys, full synchronous durability, and immediate transactions. Policy snapshots, events, and audit verdicts are append-only. The mutable artifact head is a projection updated by exact revision/state/version compare-and-swap in the same transaction as its event. Idempotency is scoped by actor, operation, and key and binds the canonical request digest; reuse with different input is rejected.

The store rejects unknown or forged actor/role pairs, missing rights, policy digest substitution, cross-project or cross-revision references, stale heads, duplicate requirement verdicts, reuse of one auditor identity within a revision, missing or untyped evidence, forbidden self-audit, and incomplete admission. Admission requires a complete `supported` audit set plus an explicit `admitted` decision from the designated role.

## Integration seams

The substrate deliberately does not connect to the native agent pool, workspace backend, provider runtime, `src/main.js`, or WorldManager. A later integration may translate workspace-worker terminal envelopes into exact `workspace_worker_terminal` references and may execute a compiled routing plan. That adapter must preserve the policy digest and scope and must not promote a candidate to project truth. A separate, explicitly authorized bridge would be required for any canonical WorldManager admission.
