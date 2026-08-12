# Direct workspace-worker lifecycle safety slice

Status: Wave 1C substrate, not yet wired into the Electron root or WSL process-group executor.

## Delivered boundary

- Workspace-worker sessions and leases have a durable SQLite/WAL registry with append-only transition events, monotonic revisions, canonical-input-bound operation IDs, and restart-safe cancellation state.
- A running isolated-worktree child enters `cancelling` and retains pool capacity until its runner returns positive cancellation acknowledgement and backend-quiescence evidence. A queued child may settle immediately because no runner started.
- Pool settlement is idempotent. A durable-registry failure produces `settlement_blocked` and retains the lease for explicit retry.
- Workspace-backend requests accept an `AbortSignal`, emit a request-scoped `cancelRequest` control envelope, and wait for a backend `{ acknowledged: true, quiesced: true }` response or original request completion before reporting cancellation. Timed-out operations remain in drain accounting until that same evidence arrives or the transport closes.
- Shutdown helpers enforce: stop intake, request cancellation, await child/provider acknowledgement, drain backend requests, dispose backends, close registry.
- Cleanup is inspect-only. A plan can become eligible only after exact binding, released lease, process quiescence, an explicit clean Git-status vector, expected head, and explicitly observed zero unique/untracked work are all evidenced. A cleaned transition requires a digest-recomputed typed receipt bound to the exact session revision, binding, plan, and non-force outcome. Force removal is never authorized by this slice.

## Explicit integration seams

1. `src/main.js` must construct the registry, inject it into `DirectNativeAgentPool`, bind the private provisioning receipt after `git worktree add`, and call the ordered shutdown helper. This slice intentionally does not edit `src/main.js`.
2. `src/backend/wsl-agent.js` must implement request-ID tracking plus the `cancelRequest` acknowledgement only after its process group is quiescent. Until then, no caller should claim live process cancellation. This slice intentionally does not edit `wsl-agent.js`.
3. The root integration must obtain cleanup observations inside the resident backend, compare them with the durable binding, and execute a separately authorized non-force removal. The cleanup module only builds and validates a dry-run plan.
4. Follow-up and resume are not exposed. Abort/interrupt is terminal for this slice; no transport-backed resume primitive exists here.

## Stop conditions

- Do not release a pool lease when cancellation is unacknowledged or lifecycle settlement cannot be persisted.
- Do not dispose workspace backends before child/provider acknowledgement and backend request drain.
- Do not remove a worktree with a mismatched binding, active process, dirty status, unexpected head, unique commit, untracked work, conflict, or incomplete observation.
- Do not substitute timeout, transport write, or local `AbortSignal` delivery for process-quiescence acknowledgement.
