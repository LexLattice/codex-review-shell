# Codex Direct Harness ODEU Capability Matrix v0.2

Scope: long-lived direct ChatGPT/Codex harness branch of `apps/codex-review-shell`, compared against an ideal Codex agentic harness and calibrated against:

- current direct-branch specs and headless real-usage results;
- OAI/provider profile and app-server baseline concepts;
- custom Codex fork exemplars: continuation bridge, durable thread memory, governance layering, semantic broker, E-witness, and sub-agent containment.

This version supersedes the row structure of v0.1. It keeps the deeper capability coverage, but removes duplicate ownership by making each capability live in exactly one canonical row. Fork-derived material is recorded in a crosswalk, not as a second matrix.

## 0. Version Delta From v0.1

v0.1 correctly expanded the matrix depth, but it duplicated several capabilities across the direct matrix and the fork-derived section. v0.2 applies these rules:

- One canonical row owns each capability.
- Fork examples map to canonical rows as evidence, design precedent, or future specialization.
- Direct-shell status is separated from fork-exemplar status.
- `NO` is reserved for intentionally blocked capabilities, not immediate planned work.
- Real validation evidence is named where available.

Current text baseline evidence:

```text
headless report: direct_real_usage_post_merge_20260512
app-server baseline: passed
direct strict first turn: passed
direct strict recent-dialogue follow-up: passed
live probe: runtime_probed
opt-in guard: passed
idempotency: passed
raw-exposure scan: passed
fixture smoke: passed
```

## 1. Status Legend

| Code | Meaning |
|---|---|
| `B-R` | Built and real-provider/headless proved under the current stated baseline. |
| `B-F` | Built or substantially present; fixture/local/smoke coverage, not yet real-provider proved end-to-end. |
| `B-P` | Built partial/scaffold. |
| `S` | Spec exists or should be drafted; implementation not assumed complete. |
| `OAI-A` | OAI/provider primitive is accepted, documented, or observed enough to build around, but harness work remains. |
| `OAI-U` | OAI/provider primitive is plausible or observed but unstable; needs probe/profile evidence before normal controls. |
| `FORK-B` | Built in the custom Codex fork, not automatically present in the direct shell. |
| `FORK-S` | Specified or designed in fork docs, not necessarily built or direct-shell applicable. |
| `LOCAL` | Harness-local deterministic responsibility; OAI does not grant this authority. |
| `NO` | Intentionally unsupported, blocked, or deferred by doctrine. |

Confidence tags:

| Tag | Meaning |
|---|---|
| `exact` | Directly observed/probed or schema-backed for the current runtime. |
| `accepted` | Accepted primitive or profile row; still may be scope-specific. |
| `derived` | Derived from logs/projections; lower confidence than raw runtime evidence. |
| `diagnostic` | Useful for visibility, not enough to enable authority. |
| `future` | Needed in ideal harness, not current implementation target. |

## 2. Boundary Law

The direct branch has three layers:

```text
OAI / provider substrate
  model inference, streamed events, tool-call intents, continuation handles,
  usage/model/quota evidence, optional compaction primitives.

Direct Codex harness substrate
  auth, local session/thread state, context composition, memory, tool authority,
  workspace mutation, projections, request manifests, recovery, evidence gates.

Standalone review shell product substrate
  left Codex lane, middle control plane, right ChatGPT review pane, handoff UX.
```

Provider output creates possibilities. Harness authority decides what local action, context inclusion, replay, retry, or UI mutation is lawful.

Hard invariants:

```text
provider tool call != local authority
provider continuity handle != imported/session continuity
context projection != canonical rollout truth
text-only direct != implementation-lane direct
diagnostic evidence != readiness promotion
fork exemplar != direct-shell support
right ChatGPT pane != direct Codex memory
```

## 3. Current Descent Summary

| Capability | Direct status | Evidence / note |
|---|---:|---|
| App-server baseline turn | `B-R` | `direct_real_usage_post_merge_20260512` |
| Direct live probe evidence | `B-R` | `runtime_probed`, no unknown raw event types in latest report |
| Strict direct text-only first turn | `B-R` | Fresh request, empty-context policy |
| Strict direct recent-dialogue follow-up | `B-R` | Local quoted context, no provider continuity |
| Opt-in guard | `B-R` | Provider request did not start without opt-in |
| Text idempotency | `B-R` | Existing report returned without rewrite |
| Raw-exposure scan | `B-R/B-F` | Text reports proved; tool paths still need expansion |
| Read-file implementation loop | `B-F/S` | Authority module/spec exists; real provider loop pending |
| Multi-step read-file loop | `B-F/S` | Designed; real provider loop pending |
| Patch apply loop | `B-F/S` | Authority module/spec exists; real provider write proof pending |
| Command execution loop | `B-F/S` | Authority module/spec exists; real provider command proof pending |
| Workspace-effect scan | `S/B-P` | Needed before command path is trusted |
| Recovery after side effects | `S/B-P` | Major next layer after real loops |
| Context maintenance / memory / baton | `S` direct, `FORK-B/FORK-S` exemplars | Track explicitly before long-context direct sessions |
| Governance / semantic broker | `S` direct, `FORK-B/FORK-S` exemplars | Diagnostic/status first |
| Sub-agent observability | `S` direct, `FORK-B/FORK-S` exemplars | Display first, choreography later |

Immediate next implementation priority:

```text
Real-provider implementation-lane harness for read/patch/command,
without adding new authority.
```

## 4. Canonical ODEU Capability Matrix

Each capability appears once. Fork-derived precedents are linked later in the crosswalk.

### A. Provider, Auth, Model, Transport

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| A1 | ChatGPT subscription Codex auth | Account-scoped direct Codex access. | `OAI-A`: Codex subscription auth path observed through Codex surfaces. | Main-process auth store, refresh, account evidence key, no renderer tokens. | `B-R` for strict headless text; `B-F` for full UX persistence | Auth-source/profile-source reports in UI/headless. |
| A2 | API-key profile separation | API-key path is a separate provider profile. | `OAI-A`, but different billing/policy path. | Separate profile and evidence gates. | `NO` for current direct profile | Separate certification profile if needed. |
| A3 | Direct Responses transport | Stable direct provider adapter. | `OAI-A/OAI-U`: exact fields are request-shape scoped. | Transport adapter, stream parser, request-shape evidence. | `B-R` text, `B-F` tools | Real read/patch/command tool-call cycles. |
| A4 | App-server baseline | Vanilla rich-client baseline remains available. | `OAI-A`: app-server/CLI path. | App-server manager/session bridge. | `B-R` | Keep green as direct evolves. |
| A5 | Stream normalization | Raw events become local normalized ontology. | `OAI-A`: streaming events. | Versioned normalizer, unknown-event policy. | `B-R` text | Tool/patch/command stream proof. |
| A6 | WebSocket direct transport | Optional alternate transport. | `OAI-U`. | Separate transport profile/probe. | `NO/B-P` | Dedicated probe if ever needed. |
| A7 | Model descriptors/catalog | Live descriptors for model, context, reasoning, service tier. | `OAI-A/OAI-U`, account dependent. | Model evidence resolver, no static-only authority. | `B-P` | Live account-scoped catalog evidence. |
| A8 | Reasoning/verbosity controls | Per-model controls only where proven. | `OAI-A/OAI-U`. | Profile-gated UI and manifests. | `B-P/NO` | Probe per model/control/shape. |
| A9 | Prompt cache/session affinity | Explicit cache/session behavior, not local continuity. | `OAI-A/OAI-U`. | Cache/session evidence separate from thread id. | `S/B-P` | Evidence rows for cache/session use. |
| A10 | Usage/quota/rate evidence | Runtime status grounded in provider evidence. | `OAI-A` where exposed. | Usage ledger/profile rows, no zero inference. | `B-P` | Direct quota/rate snapshot proof. |
| A11 | Error/retry taxonomy | Pre-stream retry only; no retry after bytes/side effects. | `OAI-A`. | Lifecycle states, handoff-unknown states. | `B-R` text, `B-F/S` tools | Interrupted tool/patch/command tests. |
| A12 | Provider compaction primitive | Optional provider-assisted compaction. | `OAI-A/OAI-U`. | Context-maintenance policy and profile mapping. | `S` | Compact endpoint/item probe. |

### B. Request, Response Item, Stream Semantics

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| B1 | Provider-neutral turn request | Harness `StartTurn` maps to provider request. | `OAI-A`. | Request manifest and provider-input projection. | `B-R/B-F` | Tool request-shape real proof. |
| B2 | Text-only first turn | Fresh direct request, no tools, no continuity. | `OAI-A`. | Empty-context policy, current-prompt artifact. | `B-R` | Keep regression green. |
| B3 | Recent-dialogue follow-up | Fresh request with quoted local transcript context. | `OAI-A`: full input accepted. | Renderer/context projections, context pack. | `B-R` | Keep regression green. |
| B4 | Provider response id continuity | Native parent proof required before use. | `OAI-A`: `previous_response_id` style continuation. | Source event digest and parent-turn proof. | `B-F` | Real tool-result continuations. |
| B5 | Function/custom tool call | Tool-call intent, not authority. | `OAI-A`. | Obligation projection and action-token flow. | `B-F` | Real provider tool-call traces. |
| B6 | Function/custom tool output | Exact output item paired to call id. | `OAI-A`. | Result envelope, context pack, manifest. | `B-F` | Read/patch/command output evidence. |
| B7 | Multiple tool calls | Sequence or fail closed by explicit policy. | `OAI-A`: possible. | Sequential/parallel policy. | `NO/S` except bounded read-loop plan | Multiple-call rejection fixture. |
| B8 | Reasoning/encrypted reasoning | Opaque/raw reasoning handled by policy. | `OAI-A/OAI-U`. | Opaque storage or omission counts; no raw renderer default. | `B-P/S` | Reasoning-event probe if needed. |
| B9 | Message phase preservation | Preserve commentary/final/tool/status phases. | `OAI-A/OAI-U`. | Normalized item phase fields. | `B-P` | Stream fixtures with phases. |
| B10 | Unknown event handling | Drift becomes evidence, not silent success. | Provider drift possible. | Raw type evidence key, fail-closed semantic unknowns. | `B-R/B-F` | Tool unknown-event tests. |
| B11 | Request control flags | `store=false`, no declarations unless authorized, `parallel_tool_calls=false`. | `OAI-A`. | Manifest assertion before transport. | `B-R` text, `B-F` tools | Continuation manifest proof. |
| B12 | Incomplete/failure terminal states | Incomplete is not final success. | `OAI-A`. | Terminal taxonomy and composer gating. | `B-F` | Incomplete/empty fixtures. |

### C. Canonical Storage, Projections, Artifacts

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| C1 | Canonical direct rollout | Append-safe event history. | None. | Events with seq/digest/manifest refs. | `B-P/B-F` | Rebuild and manifest-law tests. |
| C2 | Direct session/thread/turn store | Durable direct-native sessions. | None. | Session/turn artifacts and recovery states. | `B-R/B-F` | Multi-step tool recovery. |
| C3 | Operation ledger | Authority/control mutations are durable. | None. | Decision/journal/control events. | `B-P/B-F` | Tool/patch/command ledger order. |
| C4 | SQLite projection store | Rebuildable read/context/control projections. | None. | WAL/FKs/source digests/current pointers. | `B-F` | FK/current-pointer regressions. |
| C5 | Renderer transcript projection | Safe UI transcript. | None. | `renderer_transcript@1`. | `B-F` | UI parity tests. |
| C6 | Context recent-dialogue projection | Prompt-safe recent transcript evidence. | None. | `context_recent_dialogue@1`. | `B-R/B-F` | Strict follow-up regression. |
| C7 | Obligation projection | Safe active/past tool obligations. | None. | `direct_obligations@1`. | `B-F` | Real provider approval cards. |
| C8 | Context pack | Exact provider-neutral request material. | Provider consumes serialized request only. | App-private pack with policy/source refs/omissions. | `B-R/B-F` | Tool/patch/command packs. |
| C9 | Request manifest | Exact authorized request-shape decision. | Provider receives request. | Manifest with flags/evidence refs/no raw body. | `B-R/B-F` | Tool manifests. |
| C10 | Provider-input projection | Reproducible mapping from pack to provider items. | Provider request schema. | Role mapping and input shape/text hashes. | `B-F` | Regeneration tests. |
| C11 | Recovery classifications | Healthy/partial/sent-unknown/interrupted/corrupt states. | None. | Recovery state machine. | `B-P/S` | Crash/restart harness. |
| C12 | Context integrity chain | Detect corruption/tampering. | None. | HMAC/digest with lineage. | `B-P/S` | Integrity checks in regression. |
| C13 | Thread analytics/usage projection | Derived analytics, not runtime truth. | Usage/events where exposed. | SQLite/read model and source fingerprints. | `B-P/S` | Source-class split. |

### D. Context Maintenance, Memory, Governance, Semantic Routing

These are canonical direct-shell capability rows. Fork docs provide exemplars but do not automatically promote direct status.

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| D1 | Context maintenance route matrix | Explicit compact/refresh/prune/no-op, timing, engine, artifact lifetime. | `OAI-A/OAI-U` only for compact primitive. | `context_maintenance_route@1`, route law, fail-closed outcomes. | `S`; fork exemplar `FORK-B/FORK-S` | Route manifest and timing tests. |
| D2 | Context budget pressure model | Predict pressure before request. | Usage/model window if exposed. | Token estimates, reserved output/reasoning budget. | `S/B-P` | Budget fields in manifest. |
| D3 | Remote vanilla compaction | Provider compact endpoint/items as admitted. | `OAI-A/OAI-U`. | Request/response profile, compaction artifact. | `S` | Probe compact item shapes. |
| D4 | Remote-hybrid compaction | Provider compact plus local memory/governance preservation. | Provider compact primitive only. | Reinject required local artifacts. | `S`; fork exemplar | Direct spec after route matrix. |
| D5 | Local-pure compaction | Local/model-summarized compaction without provider compact endpoint. | Model text only if used. | Summary policy, validation, provenance. | `S`; fork exemplar | Local compaction pack and quality checks. |
| D6 | Compaction timing law | Intra-turn/turn-boundary/pre-request/post-tool/post-terminal are distinct. | OAI agnostic. | Scheduler prevents unsafe mid-obligation compaction. | `S`; fork exemplar | Transition table. |
| D7 | Continuation bridge/frontier baton | Turn-scoped artifact carrying frontier across compaction. | OAI can ingest as context, not native law. | `frontier_baton@1` or bridge artifact with open obligations/source refs. | `S`; fork built bridge | Direct baton schema and pack integration. |
| D8 | Rich review bridge | Frontier plus review risks/alternatives. | OAI can generate/consume text. | Review-specific bridge policy. | `S`; fork exemplar | Decide display-only vs authoring. |
| D9 | Bridge sub-agent supplement | Carry child-agent frontier/progress into bridge. | OAI can ingest as context. | Child summaries and unresolved waits. | `S`; fork exemplar | Requires agent registry. |
| D10 | Durable ODEU thread memory | Long-lived memory separate from recent context and compaction summary. | OAI none. | `durable_thread_memory@1`, refresh/governance lifecycle. | `S`; fork built thread memory | Direct memory artifact visibility first. |
| D11 | Memory refresh operation | Refresh durable memory from source refs. | OAI can summarize if asked. | Refresh manifest, source digests, redaction. | `S`; fork exemplar | `thread_memory_refresh@1` tests. |
| D12 | Memory/context/summary separation | Memory, context pack, and compaction summary are distinct. | OAI agnostic. | Separate schema/storage/rendering paths. | `B-P/S` | Store/projection schema split. |
| D13 | Fail-closed raw-window trimming | Required artifacts are never silently dropped. | Context-window limits only. | Trim policy with required artifact classes. | `S`; fork exemplar | `raw_window_trim_policy@1`. |
| D14 | Context omission ledger | Every omitted span has source/count/reason. | None. | Omission markers in packs/previews. | `B-F/S` | Omission parity tests. |
| D15 | Governance prompt layering | Ordered harness/system/developer/task/runtime/memory/tool layers. | OAI accepts instructions/input items. | `governance_packet@1`, `compiled_prompt_layers@1`, role mapping digest. | `S`; fork built prompt layering | Status artifact and manifest refs. |
| D16 | Governance shadow mode | Diagnostics without blocking. | None. | Shadow compiler and renderer-safe status. | `S`; fork exemplar | Diagnostic projection. |
| D17 | Governance enforce mode | Compiler may block illegal transitions. | None. | Transition legality gates and blockers. | `NO/S` for direct default | Keep hidden until workflow value is proved. |
| D18 | Governance transition legality | Explicit transition graph for text/tool/patch/command/compact/fork. | None. | `workflow_transition_graph@1`. | `S/B-P` | Connect to tool state machines. |
| D19 | Governance diagnostics | Explain missing packet, compile fallback, illegal transition. | None. | Renderer-safe diagnostics. | `S`; fork exemplar | Advanced drawer/status only. |
| D20 | Semantic broker active packet | Resolve user/task semantics to schema/tool/context route. | OAI can follow schema/tool descriptions, not broker law. | `semantic_broker_packet@1`, registry snapshot, candidate/adjudication evidence. | `S/B-P`; fork hidden/built partial | Define runtime contract before UI. |
| D21 | Semantic broker fallback | Ask/degrade safely when uncertain. | None. | Fallback transition law. | `S` | Ambiguity tests. |
| D22 | Maintenance manifests | Compact/refresh/prune manifest with source digest, route, engine, outcome. | Provider compact may return items. | `context_maintenance_manifest@1`. | `S` | First maintenance bundle. |
| D23 | Maintenance UI posture | Status lane, not chat transcript. | None. | Requested/running/completed/failed/unsupported status. | `S` | UX spec. |

Key distinction:

```text
Recent dialogue = short-term context source.
Compaction = derived context reduction.
Thread memory = durable continuity state.
Continuation bridge/baton = turn/frontier survival artifact.
Governance packet = authority/policy layer.
Semantic broker = task/tool/schema routing layer.
```

### E. Workspace, Tool Authority, Deterministic Actions

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| E1 | WSL/local workspace truth | Canonical workspace root through backend. | None. | Backend attach and path evidence key. | `B-R/B-F` | Keep tool paths backend-routed. |
| E2 | Work tree/file preview | Control-plane file awareness. | None. | Backend list/read and caps. | `B-R` | Baseline. |
| E3 | Read-file authority | Approved project-relative read. | Model may request tool call. | Path validation, sensitive policy, bounded result. | `B-F/S` | Real read approval loop. |
| E4 | Multi-step read loop | Sequential approved reads. | Model may request repeated calls. | Loop caps, per-step tokens, response chain. | `B-F/S` | Real multi-step read. |
| E5 | Patch planning | Provider patch becomes structured dry-run plan. | Model may propose patch. | Parser, dialect, path/collision checks. | `B-F/S` | Real provider patch call. |
| E6 | Patch apply journal | Approved patch through backend with journal. | None. | Before/after evidence, partial-state handling. | `B-F/S` | Disposable workspace patch. |
| E7 | Workspace effect scan | Know what changed after patch/command. | None. | Pre/post status/digest/effect summary. | `S/B-P` | Command mutation fixture. |
| E8 | Revert | User-approved rollback of local changes. | None. | Revert plan and conflict checks. | `NO/S` | Separate spec. |
| E9 | Command planning | Model command request becomes bounded argv plan. | Model may request command. | Command-class policy, package script validation, cwd/env/caps. | `B-F/S` | Real command approval loop. |
| E10 | Command execution | Approved bounded command through backend. | None. | `shell=false`, timeout, process-tree cleanup, output caps. | `B-F/S` | Real command with effect scan. |
| E11 | Command side-effect truth | Commands may mutate workspace. | None. | Workspace-effect scan and warnings. | `S/B-P` | Mutation fixture. |
| E12 | Tool-result redaction | Prevent unsafe output to provider/renderer. | None. | Secret scanner before continuation/report. | `B-F/S` | Real redaction fixture. |
| E13 | Tool-output envelope classes | Result classes per read/patch/command. | Tool-output item shape. | Envelope schemas and evidence gates. | `B-F` | Real loops prove envelopes. |
| E14 | Tool-loop iteration caps | Stop runaway loops. | None. | Step/repeated-path/command caps. | `S/B-F` | Multi-step loop tests. |
| E15 | No retry after side effect | No duplicate writes/commands after ambiguity. | None. | Handoff-unknown states, idempotency, journal. | `S/B-P` | Crash/retry regression. |
| E16 | Broad shell/network/browser/MCP | High-authority tools. | Tool substrate possible if declared. | Separate authority surfaces. | `NO` | Not next. |
| E17 | Auto-approval | Trusted repeated actions. | None. | Strong policy, audit, reversible scopes. | `NO` | Later only. |

### F. Runtime Tiers, UX, Workflow Control

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| F1 | App-server tier | Default safe vanilla path. | `OAI-A`. | Manager/session bridge. | `B-R` | Keep green. |
| F2 | Direct text-only tier | Fresh direct text turns, no tools. | Direct text inference. | Toggle/evidence gates/context packs. | `B-R` | Keep regression green. |
| F3 | Direct recent-dialogue tier | Multi-turn direct text via local context. | Full input accepted. | Projections/context packs. | `B-R` | Keep regression green. |
| F4 | Direct implementation lane | Read/patch/command authority loop. | Tool-call intents + continuations. | Authority modules, cards, journals. | `B-F/S` | Real read/patch/command harness. |
| F5 | Tier selection law | Selection is not turn authority. | None. | Atomic selection, rollback, turn-time re-eval. | `B-F` | UI/headless tests. |
| F6 | Approval cards | Renderer hints only; main authoritative. | None. | Action tokens and digest revalidation. | `B-F/S` | Real cards under provider calls. |
| F7 | Runtime status/blockers | Explain readiness/degraded states. | None. | Status resolver and blocker taxonomy. | `B-F` | Tool status rows. |
| F8 | Operation history | Durable read/patch/command/fork/lifecycle history. | None. | Operation ledger projections. | `B-F/S` | Workbench tests. |
| F9 | Runtime witness chips | Model/access/quota/tier/compact status. | Usage/model/account evidence. | Read-only witnesses. | `B-P/S` | Ground in profile/ledger. |
| F10 | ChatGPT handoff boundary | Explicit handoff items, no automatic direct mutation. | ChatGPT UI separate. | Handoff queue/templates/thread deck. | `B-R/B-F` shell | Keep separate from direct runtime. |

### G. Imports, Derived Views, Thread Workbench

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| G1 | Legacy Codex JSONL import | Source evidence only. | App-server/CLI source. | Parser, validation report, no continuity. | `B-F` | Import fixtures. |
| G2 | Import checkpoint continuation | Fresh direct session from validated checkpoint. | Text inference only. | Seed/context/manifest. | `B-F/S` | Real checkpoint follow-up. |
| G3 | Import UX/status | Safe import workbench. | None. | Renderer-safe projections. | `B-F/S` | UI tests. |
| G4 | Thread graph | Lifecycle/relationship graph. | None. | Edges, refs, operation history. | `B-F/S` | Workbench IPC tests. |
| G5 | Merge preview | Non-runnable derived view. | None. | Source refs and stable preview rows. | `B-F/S` | Preview tests. |
| G6 | Prune preview | Non-runnable view with omission markers. | None. | Omission markers and caps. | `B-F/S` | Prune tests. |
| G7 | Fork preview | Non-runnable seed preview. | None. | Seed metadata only. | `B-F/S` | Fork preview tests. |
| G8 | Start fresh fork | Fresh session from preview, no provider continuity. | Text inference. | Seed/context/manifest. | `S/B-P` | Real fresh fork from direct preview. |
| G9 | Derived preview fork | Fresh session from merge/prune preview. | Text inference. | Derived seed with omission truth. | `S` | Later. |
| G10 | ChatGPT external refs | Link to external ChatGPT binding without import. | ChatGPT UI separate. | External ref by binding id. | `B-P/S` | Workbench external-ref tests. |
| G11 | Purge/delete | Intentional removal with tombstones. | None. | Deletion plans and tombstones. | `NO/S` | Defer. |

### H. Sub-agent Observability And Collaboration

This section is canonical for agent/sub-agent depth. The custom fork provides exemplars, but direct-shell support is not assumed.

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| H1 | Agent graph | Parent/child agent relationship graph. | None or app-server events. | Agent graph store and projections. | `S/B-P` | Read-only graph projection. |
| H2 | Agent progress registry | Live progress/attention witness for child agents. | None directly. | Progress reducer, seq, phase, active work, blockers. | `S`; fork built E-witness | Diagnostic registry first. |
| H3 | E-witness progress object | Renderer/model-safe progress witness. | Tool-call substrate only if exposed. | `agent_progress_witness@1`. | `S`; fork built | Display-only rows. |
| H4 | Inspect agent progress tool | Model-visible inspection of child progress. | OAI tool-call primitive only. | Tool definition + local registry lookup. | `S`; fork built | Diagnostic only before choreography. |
| H5 | Wait agent progress tool | Model-visible wait/synchronization tool. | OAI tool-call primitive only. | Wait state, timeout, cancel, no-deadlock law. | `S`; fork built | Requires recovery/concurrency law. |
| H6 | Thread-spawn containment | Spawned child tool surface is bounded. | Tool substrate only. | Tool-surface policy and permissions inheritance. | `S`; fork built | Direct/app-server capability profile. |
| H7 | Collab tool surface | spawn/send/followup/wait/close/list tools. | Tool substrate only. | Multi-agent orchestration and graph store. | `S` | Standalone should show evidence before choreography. |
| H8 | Sub-agent transcript projection | Child transcript separate from main transcript. | None. | Transcript hydration and tabs/panels. | `S/B-P` docs | UI after graph/registry. |
| H9 | Agent activity attention model | Badges/unread/error/attention. | None. | Activity projection and stale guards. | `S` | Useful after registry. |
| H10 | Wait deadlock prevention | Primary lane cannot wait forever. | None. | Wait caps, cancellation, terminal states. | `S` | Required before wait promotion. |

### I. Evidence, Profile, Testing, Safety

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| I1 | ODEU profile schema | Versioned capability schema. | Source evidence from docs/probes. | Profile package and resolver. | `B-R` | Keep updated. |
| I2 | Evidence states | candidate/probed/accepted/unstable/rejected/expired. | None. | Evidence store/index/hydration. | `B-R/B-F` | Scope regressions. |
| I3 | Exact-scope evidence | Capability only for account/model/endpoint/request shape. | Observed/probed primitive. | Scope resolver and mismatch categories. | `B-R` text | Tool evidence scopes. |
| I4 | Diagnostic non-promotion | Diagnostics do not unlock controls. | None. | Run modes/report states. | `B-R` | Keep regression. |
| I5 | Raw-exposure scanning | Scan reports/artifacts/renderer/storage. | None. | Scanner and minimal safe failure report. | `B-R/B-F` | Extend to tools. |
| I6 | Headless text regression | Real appserver/direct text runs. | OAI/app-server/direct. | Scripts and reports. | `B-R` | Keep green. |
| I7 | Headless implementation-lane regression | Real provider read/patch/command loops. | OAI tool calls + local actions. | Disposable workspace, scripted tasks. | `S` | Immediate next. |
| I8 | Fixture suite | Fast deterministic fixtures. | None. | Fake events/transports. | `B-R/B-F` | Expand for command/patch. |
| I9 | Recovery/replay suite | Crash/reload between every state. | None. | State rehydration and no auto-retry. | `S/B-P` | After real loops. |
| I10 | Usage ledger | Neutral runtime usage evidence. | Usage where exposed. | Ledger rows and privacy policy. | `S/B-P` | Feed status later. |
| I11 | Cost estimator | Derived pricing, never billing truth. | Pricing is external/current. | Separate derived ledger. | `NO/S` | Later. |
| I12 | Drift watch | Detect backend/schema/event drift. | Provider changes. | Unknown event/profile delta/report. | `B-F` | Regression deltas. |
| I13 | Capability downgrade | Disable controls when evidence expires/mismatches. | None. | Runtime status and blockers. | `B-F` | UI tests. |
| I14 | CI live-call guard | Prevent accidental provider calls. | None. | Env/flag gates. | `B-R` | Keep. |
| I15 | Report schema validation | Validate before/write/after scan. | None. | Runtime validators/schema. | `B-F` | Extend. |

### J. Policy, Configuration, Project Controls

| # | Capability | Ideal | OAI/server side | Harness provision | Direct status | Next proof |
|---:|---|---|---|---|---:|---|
| J1 | Project provider profile | App-server/direct/fork capability selection. | Provider independent. | Project config and capability profile. | `B-F` | UX polish. |
| J2 | Direct tier policy | App-server, text-only, implementation-lane. | None. | Selection audit/rollback. | `B-F/B-R` text | UI proof. |
| J3 | Allowed command classes | Project-scoped command policy. | None. | Policy config + command planner. | `S/B-P` | Command implementation. |
| J4 | Sensitive path denylist | Project/local policy. | None. | Denylist and confirmation policy. | `B-F/S` | Tool/patch/command tests. |
| J5 | Generated/vendor/lockfile policy | Workspace mutation policy. | None. | Path class policy. | `S` | Patch/command effects. |
| J6 | Read/patch/command caps | Project caps for bytes/chars/steps/time. | None. | Policy snapshot and cards. | `B-F/S` | Real tool regression. |
| J7 | Network-risk policy | Truthful backend capability and warnings. | None. | Command backend capability truth. | `S` | Command implementation. |
| J8 | Model/evidence status | Project-specific readiness. | Model/account support. | Status resolver. | `B-F` | UI status. |
| J9 | Fork capability profile | Detect fork methods/keys/artifacts. | None. | Schema/config/probe checks, not path substring. | `S/B-P` | Capability rows. |
| J10 | Governance mode settings | off/shadow/enforce if supported. | None. | Advanced provider/status drawer. | `S`; fork exemplar | Status first. |
| J11 | Compaction/memory settings | Engine/model/reasoning/bridge variants. | Provider compact if used. | Advanced config/status. | `S`; fork exemplar | Diagnostics only first. |
| J12 | Maintenance hygiene | Docs/migration/regression readiness. | None. | Checklists and automated regression. | `B-P/S` | Mainline readiness. |

## 5. Fork Exemplar Crosswalk

Fork-derived capabilities should guide design, not silently enable direct-shell controls.

| Fork exemplar | Fork docs/source family | Canonical rows | Direct-shell posture |
|---|---|---|---|
| Continuation bridge, baton/rich review | `docs/fork/custom-fork-module-inventory.md`, compaction bridge specs | D7, D8, D9, D22, D23 | Adopt as `frontier_baton@1` only after context route matrix exists. |
| Durable ODEU thread memory | thread-memory and context-maintenance docs | D10, D11, D12, D13 | Visibility/status first; no editor initially. |
| Compaction route matrix | `compaction-policy-route-matrix.md` | D1, D3-D6, D22, J11 | Direct spec should copy route/timing/lifetime law, not implementation details blindly. |
| Fail-closed memory and raw trimming | compaction hardening specs | D13, I9 | Required before automatic compaction. |
| Governance packets/compiler/transitions | governance docs and strict-v1 specs | D15-D19, J10 | Status/diagnostic first; enforce mode hidden until value is proved. |
| Semantic broker | semantic broker specs/audits | D20, D21 | Prompt/schema routing layer; not a generic tool broker. |
| E-witness progress | agent observability docs | H2-H5 | Read-only diagnostic projection first. |
| Thread-spawn sub-agent containment | tool-surface policy docs | H6, H7, J9 | Capability-profile gated; no recursive delegation by default. |
| Sub-agent transcript/activity | fork UI/progress concepts | H1, H8, H9, H10 | UI after graph/registry. |
| Build/update helpers | fork maintenance docs | J12 only | Appendix/maintenance track, not runtime ODEU. |

## 6. Promotion Rules

A capability can move forward only when the promotion evidence matches its authority level.

| Promotion | Required evidence |
|---|---|
| `S -> B-P` | Schema or scaffold exists; no runtime promise. |
| `B-P -> B-F` | Local fixtures/smokes prove deterministic behavior. |
| `B-F -> B-R` | Headless real-provider or real-runtime proof under scoped opt-in. |
| `FORK-B -> direct S` | Direct-shell spec maps fork primitive to direct row and product boundary. |
| `FORK-B -> direct B-F` | Direct implementation exists with local tests, not merely fork source. |
| direct control visible in UI | Runtime status can explain support/blockers without raw exposure. |
| direct authority enabled | Main-process gate revalidates exact evidence immediately before action. |

For fork-derived controls, support must be proven by one of:

1. active runtime schema includes the method/field;
2. config/profile API returns a fork-specific key/value;
3. runtime probe succeeds;
4. executable identity/version marker is verified;
5. historical artifact is present for rendering only, not enabling new controls.

Never use a path substring such as `/codex/fork` as capability proof.

## 7. Roadmap Anchored In Rows

### Stage 1 - Real implementation-lane proof

Rows: I7, E3-E7, E9-E15, B4-B6, B11-B12, F4-F7, minimum J3-J7.

```text
real read_file approval loop
real multi-step read_file loop
real apply_patch approval loop in disposable workspace
real run_command approval loop in disposable workspace
workspace-effect scan
```

No new authority. Prove existing authority. Include the minimum policy substrate needed for safe execution: allowed command classes, sensitive path defaults, generated/vendor/lockfile policy defaults, read/patch/command caps, and network-risk truth. Full settings UI can wait, but policy objects and safe defaults should not.

### Stage 2 - Recovery and replay safety

Rows: A11, C1-C3, C11-C12, E15, I9.

```text
provider requested tool, app restarted
approval card reloads safely
tool result recorded but continuation not sent
patch applied but continuation failed
command ran but continuation failed
handoff unknown never auto-retries
```

Keep this as its own bundle after real loops. It shares state-machine, ledger, journal, handoff-unknown, and no-auto-retry concerns that should not be hidden inside the first real-provider proof PR.

### Stage 3 - Iterative repair loop

Rows: E4, E14, E15, F4, D18.

```text
read -> patch -> command -> next patch/read -> command again
```

Bound sequencing, per-step approval, and transition legality.

### Stage 4 - Workspace change authority

Rows: E6-E8, E11, J4-J7.

```text
workspace effect summaries
patch journal inspection
generated/vendor/lockfile policy
workspace changed but model did not see contents
optional revert spec
```

### Stage 5 - Context maintenance, memory, baton

Rows: D1-D14, D22-D23, A12, J11.

```text
context route matrix
context maintenance manifest
durable thread memory
frontier baton
fail-closed trimming
```

Implementation order inside this stage should start with route matrix and maintenance manifests, then durable memory, then frontier baton, then automatic trimming/maintenance behavior. Governance enforcement and semantic broker routing should not be prerequisites for basic context maintenance.

### Stage 6 - Governance and semantic broker

Rows: D15-D21, J10.

```text
governance packet diagnostics
transition legality
semantic broker packet
fallback/ask-human behavior
```

### Stage 7 - Sub-agent observability

Rows: H1-H10, J9.

```text
agent graph
progress registry
E-witness rows
inspect/wait tools
sub-agent transcript projection
containment policy
```

Sub-agent work should be read-only/diagnostic first: graph, progress registry, E-witness rows, transcript projection, and containment visibility. Do not promote inspect/wait tools before registry semantics and wait no-deadlock law exist.

### Stage 8 - UI polish and mainline readiness

Rows: F1-F10, I1-I15, J1-J12.

```text
tier selector status matching headless gates
approval cards
operation history
project policy controls
docs alignment
automated regression suite
merge-behind-flag checklist
```

## 8. PR Affinity Bundles

The roadmap stages above are capability stages. Implementation should usually happen through affinity bundles: groups of rows that share state, tests, code paths, and safety gates.

The controlling bundle plan is recorded separately in:

- [CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md](CODEX_DIRECT_HARNESS_PR_AFFINITY_BUNDLES_v0.md)

Bundle rules:

- Do not split read-file, multi-step read, apply-patch, run-command, and workspace-effect scan into separate first-pass specs unless the implementation becomes too large. They are one real-provider implementation-lane proof bundle.
- Do not merge recovery/replay safety into the first real-provider proof beyond minimal report states. Recovery is its own state-machine and journal-law bundle.
- Do not split context route matrix, memory refresh, frontier baton, raw-window trimming, and maintenance manifests into unrelated specs at first. They are one context-maintenance family, with internal ordering.
- Do not split governance packet, transition legality, semantic broker packet, and fallback/ask-human behavior at first. They are one routing/governance diagnostics family.
- Do not mix implementation-lane tool authority, context maintenance/memory, and sub-agent observability in one PR. They touch different authority surfaces.

Recommended PR order:

```text
1. Real-provider implementation-lane proof
2. Recovery and replay safety
3. Iterative implementation repair loop
4. Workspace mutation truth and policy substrate
5. Implementation-lane UI and operation history
6. Thread evidence workbench and derived views
7. Fresh fork starts from previews
8. Context maintenance, memory, frontier baton
9. Governance and semantic broker diagnostics
10. Sub-agent observability and containment
11. Usage/quota/model evidence and mainline readiness
```

There is one acceptable swap: if app usability needs to catch up sooner, bundle 5 may move before bundle 3. Context maintenance, governance, and sub-agent work should not move ahead of real implementation-lane proof and recovery.

## 9. Immediate Next Spec

The next spec should target Stage 1:

```text
Headless real-provider implementation-lane harness for read_file,
multi-step read_file, apply_patch, run_command, and workspace-effect scan.
```

It should not add new authority. It should prove:

1. provider can emit a supported `read_file` call;
2. harness can approve, read, record result evidence, and continue;
3. provider can emit a second supported read and the loop remains bounded;
4. provider can emit a supported `apply_patch` call in a disposable workspace;
5. harness can plan, dry-run, approve, apply, journal, and continue;
6. provider can emit a supported `run_command` call;
7. harness can plan, approve, run, capture, scan, and continue;
8. reports prove no raw exposure, no app-server fallback inside direct, no right-pane mutation, and no handoff mutation.

It should explicitly not mean:

```text
direct is production
auto-approval exists
general shell/network/browser/MCP tools are enabled
parallel tool calls are supported
delete/revert is supported
right-pane ChatGPT is automated
app-server can be removed
```

## 10. Main Conclusion

v0.2 keeps the deeper v0.1 coverage while assigning a single owner row to each capability.

The direct branch is now real-green for text. The next confidence gap is implementation-lane real-provider proof. Fork-derived depth should remain visible in the roadmap, but it should enter the direct shell through explicit row-owned specs:

```text
context route matrix
frontier baton
durable thread memory
governance prompt layers
semantic broker packet
E-witness progress registry
thread-spawn containment
```

Those do not change the immediate next step. They prevent the roadmap from collapsing long-context, governance, routing, and sub-agent observability into vague buckets once the implementation lane starts working.
