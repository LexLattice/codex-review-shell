# Upstream Codex Release 145 Impact Audit

Date: 2026-07-22

Purpose: record the exact stable Codex `0.145.0` source and runtime baseline,
distinguish it from the preceding `0.145.0-alpha.11` operational overlay, and
decide which new app-server and core capabilities should be adopted by the
Direct harness.

## Evidence Snapshot

| Object | Evidence |
| --- | --- |
| Vanilla repository | `/home/rose/work/codex/fork` |
| Stable tracking ref | `origin/upstream-latest-release` |
| Official stable release | [`rust-v0.145.0`](https://github.com/openai/codex/releases/tag/rust-v0.145.0) |
| Stable release commit | `25af12f7e61572b0bc18ddb1008be543b91519b0` |
| Previous documented baseline | `rust-v0.144.4` at `8c68d4c87dc54d38861f5114e920c3de2efa5876` |
| Immediate previous stable patch | `rust-v0.144.6` at `5d1fbf26c43abc65a203928b2e31561cb039e06d` |
| Active Review Shell WSL runtime | npm-global `@openai/codex@0.145.0` (`codex-cli 0.145.0`) at `/home/rose/.nvm/versions/node/v24.14.0/bin/codex` |
| Previous operational overlay | `@openai/codex@0.145.0-alpha.11` at `b8cc3a63247f2242647c27ca4df56e8b6e483737` |
| Fork audit ref | `origin/main` at `923840b357e15195e66f7e82ac81ee0f39fc7050` |
| Direct evidence ref | `f4c3b32fd2b349a09b5b032f0f23dbe4bbd8e8e5` on `codex/appserver-native-thread-routing` |

The stable tracking workflow had already advanced
`origin/upstream-latest-release` to the exact `rust-v0.145.0` commit before this
audit. No local inspection branch was created or moved.

The managed WSL route was upgraded after the source audit. Both PATH resolution
and the configured absolute binary now report `codex-cli 0.145.0`. A live
app-server real turn authenticated through the CLI account, initialized,
streamed `stable-145-ready.`, emitted normal usage/rate-limit evidence, and
completed without tool execution. A separate read-only probe returned 11
installed, enabled, callable apps from `app/installed`; `app/read` resolved
metadata for all 11 with no missing IDs and `includeTools: false`.

## Executive Result

Release 145 materially improves the substrate used by this project:

```text
usable paginated thread history
+ stable multi-agent V2 lifecycle
+ authoritative direct-input eligibility
+ installed/callable app state and app metadata reads
+ explicit environment connection status
+ app-server emission timestamps
+ stronger contextual fork, import, compaction, and teardown semantics
```

The strongest opportunities are not new ODEU laws. They are better provider
evidence and execution primitives beneath the laws already implemented or
specified by Direct.

Priority order and current state:

1. upgrade and probe the stable runtime — **complete for a root real turn and
   read-only app inventory**;
2. adopt emission timestamps, direct-input eligibility, and environment state
   — **implemented and regression-covered**;
3. adopt installed app/runtime metadata — **implemented as non-authoritative
   runtime evidence; Direct tool-bundle integration remains pending**;
4. build an opt-in paginated-history adapter;
5. reuse contextual fork and import primitives;
6. defer audio/realtime and Bedrock until a product requirement exists.

## Stable Baseline Versus Previous Alpha Activation

The shell previously used a 145-family alpha to expose the provider-owned split
`spawn_agent` fields `model` and `reasoning_effort`. That work must not be
reported as newly activated by the stable source refresh. The same configured
split is now launched through stable `0.145.0`.

The stable release adds or completes capabilities absent or incomplete in the
previous alpha overlay, including:

- searchable and legacy-projectable paginated history;
- paginated history names, memories, and stronger sub-agent support;
- `thread.canAcceptDirectInput`;
- `app/read` and richer `app/installed` runtime state;
- cursor-bearing resume behavior for paginated threads;
- complete audio input/history/tool-output support;
- final stabilization of multi-agent V2.

Other useful 145-family features, including `emittedAtMs`,
`rawResponse/completed`, and `environment/status`, already existed in the
previous alpha. The shell now consumes the timestamp and environment evidence;
raw response events remain deliberately disabled by default.

## 1. Paginated Thread History Became Usable

`thread/start` can now select experimental `historyMode: "paginated"`.
Projection-backed history supports:

- durable paginated turn and item storage;
- efficient resume without mandatory full transcript reconstruction;
- `excludeTurns: true` plus `turnsBackwardsCursor` and
  `itemsBackwardsCursor`;
- a one-round-trip `initialTurnsPage` on resume;
- `thread/turns/list` with `summary` or `full` item views;
- `thread/items/list` across a thread or restricted to one turn;
- `thread/searchOccurrences` over visible user and final-assistant messages;
- persisted names, memories, Git metadata, and spawned-agent history;
- a legacy history projection for clients that still need reconstructed views.

This is a direct fit for:

- the thread workbench;
- resident and long-running work threads;
- thread search;
- bounded transcript hydration;
- checkpoint and compaction review;
- sub-agent transcript projection.

Compatibility boundary:

- `thread/read(includeTurns: true)` is unsupported for paginated threads;
- live notifications must be joined with durable pages without duplication;
- cursor state becomes part of the projection-store checkpoint;
- experimental methods require `capabilities.experimentalApi = true`;
- legacy threads must remain readable without migration.

Disposition: **adopt behind an opt-in `paginated-v1` runtime profile**. Do not
change the default until the renderer and projection store have cursor-aware
coverage.

## 2. Multi-Agent V2 Became A Stronger Provider Substrate

Release 145 marks multi-agent V2 stable and strengthens:

- configured child model and reasoning defaults;
- role validation and restoration on resume;
- paginated sub-agent history;
- parent-owned child threads that reject direct turn input;
- `thread.canAcceptDirectInput` as an explicit capability;
- more reliable navigation and liveness.

This converges with Direct's worker-containment and role-lane work, but it does
not replace:

- child-authority subset proofs;
- boot packets and scoped constitutions;
- semantic closure reports;
- project/worldmodel revision checks;
- Direct's user-to-child interaction law.

Disposition: **adopt canonical lifecycle and eligibility evidence**. Replace
heuristics about whether a child accepts input with `canAcceptDirectInput` when
available, while preserving fail-closed behavior when it is `null` or absent.

The prior alpha split-schema activation remains historical evidence for that
pinned runtime. Stable installation and a root real-turn probe are now proven.
A stable child-spawn probe that records the effective child model and effort is
still required before promoting those per-child fields from configured request
evidence to a stable runtime-effect witness.

## 3. App And Connector State Became More Truthful

New or expanded app-server calls provide two different views:

- `app/installed`: effective installed, enabled, and callable state, optionally
  evaluated against one loaded thread;
- `app/read`: canonical metadata and optional public tool summaries for a
  bounded set of connector IDs.

The resulting evidence chain matches the Direct capability model:

```text
known app
  -> installed
  -> enabled under effective policy
  -> callable with at least one model-visible tool
  -> tool selected
  -> action separately authorized
```

`app/read` requires ChatGPT authentication and returns metadata rather than
runtime authorization. `callable` is stronger runtime evidence, but it still
does not authorize a side effect.

Disposition: **adopt in the tool-capability registry and role-lane tool bundle
composer**. Preserve the current distinction between discovery, selection,
authorization, execution, and validated effect.

## 4. Environment Lifecycle Evidence Is Now Explicit

`environment/status` reports `ready`, `pending`, `disconnected`, or `unknown`
without starting or recovering the environment. Thread-scoped environment
connected/disconnected notifications identify the affected thread and
environment.

This should replace inferred status in:

- WSL and remote environment topology;
- async-work readiness;
- environment transition witnesses;
- environment-aware tool catalogs;
- UI explanations for pending versus failed execution worlds.

Environment readiness still does not grant workspace mutation authority.

Disposition: **adopt as read-only provider evidence**, joined with local
topology and authority objects.

## 5. Event Ordering And Usage Evidence Improved

Current app-server notifications include optional envelope-level
`emittedAtMs`, recorded before transport serialization. The shell currently
falls back through payload timestamps and then local receipt time.

Direct should preserve three distinct clocks:

```text
provider/event timestamp, when present
app-server emittedAtMs
local receipt timestamp
```

This improves replay ordering, latency analysis, sub-agent activity reduction,
and evidence provenance.

`rawResponse/completed` can expose exact usage for each upstream Responses API
completion when `experimentalRawEvents` is enabled. It is internal-only,
transient, not replayed, and may be absent or contain `usage: null`.

Disposition:

- **adopt `emittedAtMs` immediately after the stable runtime probe**;
- **consume exact raw usage only when present**;
- **do not enable raw events globally or make them a required contract**;
- retain `thread/tokenUsage/updated` and account rate-limit reads as supported
  primary evidence.

## 6. Contextual Fork And Retry Semantics Improved

Editing an earlier prompt and retrying a safety-buffered turn now create a
contextual branch while preserving the original conversation, attachments, and
mention bindings.

Relevant app-server boundaries include:

- `lastTurnId` for an inclusive completed-turn boundary;
- experimental `beforeTurnId` for a boundary before an in-progress or completed
  turn;
- interruption markers when forking a mid-turn source;
- `deferGoalContinuation` for a fork that carries the source goal but permits
  one explicit turn before automatic continuation;
- paged fork history through `excludeTurns`.

Disposition: **adapt these primitives into Direct fork previews**. The harness
must still produce authority and context-loss witnesses before treating a fork
as a lawful semantic continuation.

## 7. Compaction, Memory, And Teardown Strengthened

Release 145 adds or completes:

- automatic-compaction fallback token-budget controls;
- more efficient remote-compaction history handling;
- memories for paginated threads;
- stronger compaction/session hook ordering;
- `SessionEnd` hooks before idle unload, archive, delete, and graceful shutdown.

`SessionEnd` is useful for cleanup and telemetry, but it is not a constitutional
checkpoint:

- it runs only for root threads;
- it is advisory and cannot block teardown;
- its timeout is short;
- it reports a generic reason.

Disposition: **use teardown hooks as evidence or best-effort cleanup only**.
Keep Direct checkpoint, omission, admission, and closure artifacts durable and
independently enforced.

## 8. Imports, MCP, Windows, Audio, And Providers

Other relevant changes:

- external-agent import now covers more Cursor and Claude Code configuration,
  MCP servers, plugins, commands, sessions, memories, connector candidates,
  provenance, and failure subtypes;
- MCP startup and OAuth are less likely to block thread startup, and tool
  catalogs can be safely reused or explicitly excluded from caching;
- native Windows exec-server sandboxing, proxy enforcement, quoting, and helper
  console behavior improved;
- audio inputs, audio tool outputs, local audio history, and realtime V3 were
  added;
- managed Amazon Bedrock login and custom transports were added.

Disposition:

- **adopt structured import evidence and failure types**;
- **keep MCP startup status visible and bounded**;
- **retain WSL as the current primary execution route while noting improved
  Windows-native viability**;
- **defer audio/realtime and Bedrock** until a concrete product requirement
  supplies their authority, UX, and test boundaries.

## Direct Adoption Matrix

| Release-145 capability | Current Direct posture | Disposition |
| --- | --- | --- |
| Paginated thread history and search | Legacy/full-history renderer and projection assumptions | Build an opt-in cursor-aware adapter |
| `emittedAtMs` | Payload timestamps plus local receipt fallback | Preserve as a separate evidence clock |
| `canAcceptDirectInput` | Interaction eligibility partly inferred | Adopt and fail closed when unknown |
| `app/installed`, `app/read` | Main-authorized reads, normalized snapshot, and capability-drawer evidence implemented | Keep evidence non-authoritative; next join it to the Direct registry/bundle composer |
| `environment/status` and connection events | Provider state is normalized and shown in the environment witness | Next join it to Direct transition witnesses |
| Exact raw response usage | Raw events explicitly disabled | Optional diagnostic consumption only |
| Contextual fork boundaries | Fork preview and continuation laws modeled | Reuse primitives under Direct admission law |
| Paginated memories and `SessionEnd` | Durable memory/checkpoint laws exist | Use as substrate/evidence, not authority |
| Expanded external-agent import | Import checkpoint path exists | Consume structured provenance and failures |
| Stable multi-agent V2 | Stable root real turn is live-probed; split schema is configured | Re-probe a child and require effective model/effort evidence before promotion |
| Audio/realtime V3 | No active product requirement | Defer |
| Bedrock auth/transports | Generic provider profile only | Defer |

## Compatibility And Non-Claims

- Stable `0.145.0` is the active managed WSL binary, but this does not prove
  every optional or experimental release-145 path.
- Experimental API presence is not permission to enable a feature by default.
- `rawResponse/completed` is internal-only and is not a durable usage ledger.
- `app/read` metadata does not prove runtime callability or action authority.
- `environment/status: ready` does not grant filesystem or network authority.
- `turn/completed` still carries an empty `items` array; canonical items remain
  the streamed `item/*` notifications.
- Paginated and legacy threads require separate read paths until the adapter
  proves lossless projection and replay.
- Stable multi-agent execution does not supply Direct's recursive
  constitutional relay or semantic closure law.

## Recommended Implementation Sequence

1. **Complete:** install stable `@openai/codex@0.145.0` for the managed WSL
   route; alpha.11 remains a historical comparison and `0.144.4` the documented
   safe rollback.
2. **Partial:** root real-turn and app inventory/metadata live probes pass;
   stable model/effort child-spawn, import, and paginated-history probes remain.
3. **Complete:** add envelope timestamp, `canAcceptDirectInput`, and
   environment-state normalization.
4. **Complete for shell evidence:** add `app/installed` and `app/read`
   ingestion. Direct registry and role-lane consumption remain separate work.
5. Implement a fixture-first paginated history adapter and live-page join.
6. Probe one isolated paginated thread before enabling a project-level flag.
7. Integrate contextual forks and structured imports after history parity.

The audit now records the stable runtime promotion and the first two bounded
evidence adapters. It does not promote paginated history, contextual forks,
raw events, or per-child model/effort effects.

## Implementation Progress — Stable Runtime And Evidence Slices

The first release-145 compatibility slices are implemented against the stable
managed CLI:

- app-server notification envelopes preserve `emittedAtMs` alongside a
  separate local receipt clock through the renderer bridge;
- notification-backed usage-ledger rows preserve both clocks without replacing
  provider event timestamps;
- `thread.canAcceptDirectInput` is normalized into accepted, rejected, unknown,
  or legacy-unreported states;
- explicit `false` and explicit `null` eligibility fail closed at both composer
  and mutation-call boundaries, while a genuinely absent field retains the
  alpha/legacy compatibility path;
- thread environment connection notifications are normalized immediately and
  followed by a separately allowlisted, read-only `environment/status` probe;
- the environment drawer and witness chips render environment identity, status,
  evidence source, observation time, and failure detail;
- `app/installed` and `app/read` are separately allowlisted main-process reads;
- installed, enabled, callable, metadata, and missing-ID evidence is normalized
  into `codex_app_evidence_snapshot@1` and rendered in the capability drawer;
- connector tool summaries are opt-in, bounded display metadata and explicitly
  grant neither provider tool declaration nor action authority;
- `npm run codex:release-145-evidence` covers timestamp preservation,
  eligibility gating, environment normalization, app-evidence boundaries,
  bridge delivery, and usage collector delivery.

Live stable witnesses on 2026-07-22:

- exact binary and PATH command both report `codex-cli 0.145.0`;
- one authenticated app-server turn completed with the exact response
  `stable-145-ready.` and no tool execution;
- `app/installed` reported 11 installed/enabled/callable apps and `app/read`
  returned all 11 metadata records with no missing IDs; tool summaries were not
  requested.

Implementation files:

- `src/renderer/codex-app-server-evidence.js`;
- `src/main/codex-surface-session.js`;
- `src/main/usage-ledger-collector.js`;
- `src/renderer/codex-surface.js`;
- `scripts/codex-app-server-release-145-evidence-regression.mjs`.

Still pending: a stable child-spawn model/effort witness, the paginated-history
adapter and isolated live probe, Direct registry/bundle consumption of app
evidence, and contextual-fork/import adapters. Stable root-turn and read-only
app evidence are proven; those pending capabilities are not implied by that
promotion.
