# Direct Path Test Round Observations

Status: working notes
Scope: direct harness branch usability and architecture follow-up items

This document records observations from manual Direct path testing that are not immediate blockers, but should be revisited once the current test round is complete.

## Current Test Baseline

- Direct runtime switching now reaches a live Direct session instead of staying blocked behind app-server-only setup paths.
- The current user-facing backend split is `App Server` versus `Direct`; internal direct lanes such as text-only/tool implementation should not leak as top-level UX choices.
- Test session observed: `direct_session_4e85a44054e74fda`.
- The observed Direct session completed one turn successfully with live provider evidence, normalized events, context pack, request manifest, rollout manifest, and redacted diagnostics.

## Observations To Revisit

### Direct Session Export Shape

The completed Direct turn is represented in session messages and normalized events, but the turn JSON does not expose a simple top-level assistant output field.

Potential optimization:

- Add a stable turn summary/projection field for quick inspection and fixture assertions.
- Keep raw provider payloads out of the turn file; this should be a normalized projection only.

Reason:

- Debugging and manual audit are easier when each turn has a compact `userText` / `assistantText` / `status` / `usage` summary.

### Direct Startup And Setup Flow

Direct embark now works, but the startup sequence should be reviewed as a whole after more manual runs.

Potential optimization:

- Make the Direct setup state explicit in the UI: authenticated, live probe available, runtime selected, session ready.
- Avoid any hidden dependency on app-server setup RPCs when Direct is active.
- Keep active-session switching separate from persistent default selection.

Reason:

- Direct should feel like a first-class backend path, not like app-server mode with missing methods patched over.

### New Thread Entry Point

The Direct path needs a clean "new thread" route as a primary manual testing path.

Potential optimization:

- Add a visible `New Thread` affordance scoped to the active backend.
- When Direct is selected, start a Direct-managed thread without requiring an existing app-server thread.
- Keep thread identity control-plane invariant rather than repo/folder-first.

Reason:

- A new user will normally test Direct by starting a fresh thread, not by switching an existing app-server thread.

### Runtime Diagnostics Placement

The full runtime diagnostics panel still occupies too much prime Codex-plane space for normal Direct testing.

Potential optimization:

- Move full diagnostics into a settings/control surface.
- Keep only compact live state in the main Codex surface.

Reason:

- Main workflow space should prioritize transcript, composer, and immediate runtime witnesses.

### Usage And Timing Projection

The first successful Direct session has usage evidence, response id, timing, and attribution status.

Potential optimization:

- Surface compact turn-level usage/timing in the Direct transcript and analytics surfaces.
- Keep exact usage evidence separate from estimates.

Reason:

- This is one of the main advantages of Direct: we can design evidence-native turn accounting instead of reverse-engineering from app-server projections.

### Capability Naming

The old `direct-text` / `direct-tool` split remains useful internally, but should not define the main UX.

Potential optimization:

- Treat those as Direct capability tiers or implementation modes.
- Present the user with one Direct backend unless a lower-level diagnostic/settings surface is open.

Reason:

- The product choice is backend ownership: vanilla app-server path versus our Direct implementation.

## Non-Goals For This Observation Log

- This is not an implementation spec.
- This is not an acceptance checklist.
- This does not replace the Direct information bridge roadmap.
- This should collect rough edges discovered during testing, then be distilled into future PR specs.
