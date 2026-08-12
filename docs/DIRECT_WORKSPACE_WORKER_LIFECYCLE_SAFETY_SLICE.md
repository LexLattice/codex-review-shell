# Direct workspace-worker lifecycle safety slice

Status: Wave 1C live lifecycle safety substrate and Electron/backend integration.

## Delivered boundary

- Workspace-worker sessions and leases have a durable SQLite/WAL registry with append-only transition events, monotonic revisions, canonical-input-bound operation IDs, and restart-safe cancellation state.
- A running isolated-worktree child enters `cancelling` and retains pool capacity until its runner returns positive cancellation acknowledgement and backend-quiescence evidence. That receipt is bound to the exact launch, lifecycle session, lease, cancellation reason, backend request, and any mutation outcome, then wrapped in a durable lifecycle receipt before it is projected publicly. A queued child may settle immediately because no runner started.
- Pool settlement is idempotent. A durable-registry failure produces `settlement_blocked` and retains the lease for explicit retry.
- Restart recovery imports durable registered/active/cancelling leases as reconciliation candidates. New isolated workers and successful shutdown are blocked until a typed, revision-bound receipt proves provider acknowledgement and backend quiescence; recovered identities are never replayed.
- Provisioning records durable `provisioning` custody before `git worktree add`, records `bound` custody immediately after the backend returns a committed outcome receipt, and retains that exact binding when cancellation races the commit.
- Workspace-backend requests accept an `AbortSignal`, emit a request-scoped `cancelRequest` control envelope, and wait for a backend `{ acknowledged: true, quiesced: true }` response or original request completion before reporting cancellation. Timed-out operations retain caller ownership and remain in drain accounting until that same evidence arrives or the transport closes; a late committed mutation result wins over the timeout.
- Every backend RPC declares a cancellation policy. Reads/processes are cancellable; mutations have a cancellable precommit phase followed by an indivisible commit and typed outcome receipt. A cancellation after commit returns the retained outcome rather than fabricating rollback.
- Linux commands run inside a pinned, verified user/PID/mount namespace and require the complete contained group to become non-mutating before quiescence is admitted. Cancellation kills the namespace group, including detached or re-sessioned descendants. On native Windows, `taskkill /T` is best-effort cleanup rather than proof; subprocess-backed capabilities fail closed until a production Job Object broker can provide a custody receipt.
- Shutdown helpers enforce: stop worker intake, verify restart reconciliation, retry settlement, request cancellation, await child/provider acknowledgement, atomically close backend intake, drain owned backend requests, dispose backends, close registry.
- Cleanup is inspect-only. A plan can become eligible only after exact binding, released lease, process quiescence, an explicit clean Git-status vector, expected head, and explicitly observed zero unique/untracked work are all evidenced. A cleaned transition requires a digest-recomputed typed receipt bound to the exact session revision, binding, plan, and non-force outcome. Force removal is never authorized by this slice.
- Renderer-visible backend status/events use a separate public projection with opaque session-key digests and omit native roots, cwd, commands, private diagnostics, and raw protocol frames.

## Explicit remaining seams

1. The root integration must still obtain cleanup observations inside the resident backend and execute a separately authorized non-force removal. The cleanup module only builds and validates the typed, digest-bound dry-run plan.
2. Restart reconciliation is exposed by the pool/registry but intentionally requires an external verifier to produce the exact quiescence receipt. It is not guessed from process absence and has no renderer mutation control in this slice.
3. Follow-up and resume are not exposed. Abort/interrupt is terminal for this slice; no transport-backed resume primitive exists here.
4. Native Windows can host and attach the resident backend, but subprocess-backed repository/test/worktree capabilities remain unavailable until Job Object creation, assignment, close, and receipt validation are implemented.

## Stop conditions

- Do not release a pool lease when cancellation is unacknowledged or lifecycle settlement cannot be persisted.
- Do not dispose workspace backends before child/provider acknowledgement and backend request drain.
- Do not remove a worktree with a mismatched binding, active process, dirty status, unexpected head, unique commit, untracked work, conflict, or incomplete observation.
- Do not substitute timeout, transport write, or local `AbortSignal` delivery for process-quiescence acknowledgement.
