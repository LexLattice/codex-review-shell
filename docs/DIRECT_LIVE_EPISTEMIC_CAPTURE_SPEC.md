# Direct Live Epistemic Capture

Status: Wave 1B implementation contract.

## Law

```text
provider-normalized event
  -> strict synchronous append to the Direct turn JSONL (O)
  -> deterministic typed event projection (E)
  -> passive live-activity read model
```

The append must finish before the transport reports the normalized frame to a
durable-capture caller. Display-only callbacks remain best-effort. A callback
failure is visible and may not be swallowed as if capture succeeded. A durable
callback may return a promise, but the transport awaits it serially before
reading past the frame; a rejection is not retried by terminal reconciliation.

O is the append-only normalized-event file plus exact typed tool results. Each
persisted event carries its source-envelope digest. E is a deterministic
projection bound to an exact O prefix and a durable source cursor. E records use
`mechanically_observed` standing and `epistemicPromotion=false`. An event that
has no deterministic mapping produces `UnclassifiedNormalizedEvent` with an
explicit omission code and a digest of the unprojected payload; its prose or
arguments are not copied into E.

A provider frame unknown to the normalizer becomes a bounded
`unclassified_provider_event` in O containing only its raw type, source index,
and raw-type/payload digests. The provider payload itself is never copied into
the normalized stream or E.

Luna is not part of this path. Luna remains an explicitly requested bounded
linguistic-residue job whose records have attributed standing.

## Capture lifecycle

`DirectTurnCaptureWriter` owns:

```text
open
  -> appendEventPrefix / appendToolResult
  -> finalize against the complete provider result
  -> recover the persisted prefix after restart
```

The turn identity is fixed from child, attempt, prompt, and context digests
before any provider response id exists. Prefix replay is idempotent only when
the overlapping event digests match. A skipped offset, divergent overlap,
conflicting terminal replay, or interrupted active capture creates a durable
`direct_turn_capture_gap@1` receipt. A full terminal result may append a missing
suffix only after verifying the entire persisted overlap.

Completed capture and terminal turn state share one atomic turn-file
replacement. Exact replay against a completed capture is a no-op; any new event
suffix or tool result after completion is a durable terminal conflict. Captured
tool results use `direct_captured_tool_result@1`, an explicit field allowlist,
recursive raw/path rejection, and a recomputed canonical persistence digest.
Legacy response-id-based turn identities are adopted in place and carry a
stable pre-response identity alias so an upgrade does not duplicate evidence.

Session recovery marks an interrupted capture incomplete without changing or
inventing provider evidence. On epistemic-service restart, persisted Direct
sessions are compared with `direct_epistemic_thread_cursor@1`; missing or stale
cursors are deterministically caught up without invoking a provider.

## Passive projection

`direct_live_activity_projection@1` may expose only:

- project/session/turn identity;
- turn and terminal status;
- persisted event/tool-result counts and digests;
- deterministic typed record classes and counts;
- capture state and exact gap-receipt refs;
- deterministic O/E cursor refs.

It contains no partial prose, raw tool arguments, native paths, provider frames,
or context body. It is never model context, never enables the composer, never
grants control or canonical standing, and never sends a worker message.

## Root live boundaries

`src/main.js` opens a native-child writer before each reasoning-only child
provider invocation. Its strict callback is the transport commit boundary and
one aggregate result is finalized once; the former terminal compatibility
append is not invoked on this path.

For an isolated workspace child, the runtime calls a harness-owned capture
adapter factory immediately after the immutable contract and binding exist.
The contract identity is part of the stable pre-provider attempt identity, so a
new workspace realization cannot collide with an earlier child turn.
Each provider step maps its local normalized offsets into the aggregate turn's
global offsets. The step prefix is reconciled before tool execution, each safe
typed tool result is appended immediately after execution, and exactly one
aggregate turn is finalized. A failed strict append poisons that adapter: later
terminal evidence cannot silently recapture or relabel the partial turn.
Cancellation finalizes the observed aborted prefix when transport reconciliation
is available; a strict capture failure remains incomplete with durable gap refs.

The native-agent pool accepts only
`direct_native_agent_epistemic_progress@1`: capture state and identity plus a
validated `direct_live_activity_projection@1`. Updating it mutates only the
passive pool record. It does not emit a pool change, resolve a waiter, create a
child result/message, admit context, or start transcript promotion. Existing
list/inspect and terminal wait packets expose the passive projection; no new
renderer IPC is required for headless orchestration.

Primary Direct and continuation controllers remain deliberately deferred. The
current primary routes do not yet share one unambiguous pre-response attempt
identity with their existing terminal persistence paths. They must adopt this
adapter only in a change that simultaneously removes the corresponding
terminal append, so O cannot be duplicated.

## Verification

`scripts/direct-live-epistemic-capture-regression.mjs` proves pre-terminal
durability, stable pre-response child identity, deterministic cursor advance,
typed unclassified omissions, terminal-prefix reconciliation, durable gap
receipts, restart catch-up, projection raw-exposure safety, and zero automatic
Luna invocations.

`scripts/direct-live-child-observation-regression.mjs` proves native and
workspace root wiring headlessly: durable O and projected E while execution is
paused mid-stream and between tool/provider steps, global workspace offsets,
immediate typed tool-result capture, restart catch-up, exact terminal replay,
passive pool inspection without waiter wakeup, and zero Luna invocation,
bottom-up messages, or child-transcript promotion.
