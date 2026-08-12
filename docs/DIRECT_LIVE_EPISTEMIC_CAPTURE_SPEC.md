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
failure is visible and may not be swallowed as if capture succeeded.

O is the append-only normalized-event file plus exact typed tool results. Each
persisted event carries its source-envelope digest. E is a deterministic
projection bound to an exact O prefix and a durable source cursor. E records use
`mechanically_observed` standing and `epistemicPromotion=false`. An event that
has no deterministic mapping produces `UnclassifiedNormalizedEvent` with an
explicit omission code and a digest of the unprojected payload; its prose or
arguments are not copied into E.

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

## Remaining root wiring seams

The integration owner must wire without changing this contract:

1. In `src/main.js`, open a native-child capture writer before invoking the
   provider, pass `writer.strictCommitCallback()` as
   `onNormalizedEventsCommitted`, and call `writer.finalize(result)` after the
   provider returns. The compatibility `persistNativeChildProviderTurn` remains
   valid for terminal-only callers but is not live-prefix durability.
2. Primary Direct and continuation controllers must give each provider attempt
   an unambiguous capture identity before adopting the strict hook; they must not
   append the same terminal batch a second time.
3. Native-agent pool status may copy only the safe live-activity cursor/count
   fields. It must not receive raw events or treat a progress update as a child
   message or parent-context admission.
4. Renderer IPC may send a scoped invalidation cursor and refetch this read
   model. It must not expose under-construction prose or use the projection for
   composer/context authority.

## Verification

`scripts/direct-live-epistemic-capture-regression.mjs` proves pre-terminal
durability, stable pre-response child identity, deterministic cursor advance,
typed unclassified omissions, terminal-prefix reconciliation, durable gap
receipts, restart catch-up, projection raw-exposure safety, and zero automatic
Luna invocations.
