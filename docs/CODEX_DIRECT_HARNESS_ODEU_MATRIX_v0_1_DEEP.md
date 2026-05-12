# Codex Direct Harness ODEU Capability Matrix v0.1 — Deep Checklist

Scope: long-lived direct ChatGPT/Codex harness branch of `apps/codex-review-shell`, compared against an ideal Codex agentic harness and calibrated against the current direct-branch specs, OAI-side profile material, and fork-derived capability examples.

This update deepens the v0 matrix. The prior matrix was correct at the broad level, but it collapsed several high-leverage dimensions into generic buckets such as “compaction,” “tool broker,” “context packs,” or “multi-agent.” This version expands those areas into capability rows that are specific enough to drive implementation, evidence gates, and product boundary decisions.

Older uploaded reference files from earlier turns may be unavailable; this version uses the current direct-branch bundle and the currently attached/available spec documents.

---

## 0. Core boundary

The direct branch must be understood as three separate layers:

```text
OAI / provider substrate
  model inference, streaming events, tool-call intents, continuation fields,
  usage/model/quota evidence, optional compaction primitives.

Direct Codex harness substrate
  auth handling, local session/thread state, context composition, memory,
  tool authority, workspace mutation, deterministic logs, projections,
  request manifests, recovery, evidence promotion, policy.

Standalone review shell product substrate
  left Codex implementation lane, middle control plane, right ChatGPT review pane.
```

The provider emits **possibilities**: text, reasoning items, tool-call intents, usage, and response identifiers. The harness owns **authority**: what files may be read, what patches may be applied, what commands may run, what context is included, what is stored, what can be replayed, and what fails closed.

---

## 1. Status legend

| Code | Meaning |
|---|---|
| `B-R` | Built and real-provider/headless proved under the current stated baseline. |
| `B-F` | Built or substantially present; fixture/local/smoke coverage, not yet real-provider proved end-to-end. |
| `B-P` | Built partial/scaffold. |
| `S` | Spec exists; implementation not assumed complete. |
| `OAI-A` | OAI/provider primitive is accepted/documented/observed enough to build around, but harness work remains. |
| `OAI-U` | OAI/provider primitive is plausible/observed/unstable; needs probe/profile evidence before normal controls. |
| `FORK` | Exists in the custom Codex fork or fork-derived design surface; not vanilla/OAI law. |
| `LOCAL` | Harness-local deterministic responsibility; OAI does not provide the authority. |
| `NO` | Intentionally unsupported/deferred/blocked. |

Confidence tags used in notes:

| Tag | Meaning |
|---|---|
| `exact` | Directly observed/probed or schema-backed for the current runtime. |
| `accepted` | Accepted profile row or official primitive; still may be scope-specific. |
| `derived` | Derived from logs/projections, lower confidence than raw runtime evidence. |
| `diagnostic` | Useful for visibility, not enough to enable authority. |
| `future` | Needed in ideal harness, not current implementation target. |

---

## 2. First-principles Codex agentic system

A Codex harness is an authority-bearing loop, not merely a chat transcript:

```text
human/project intent
  -> harness-owned context composition
  -> provider request
  -> provider stream
  -> normalized response items
  -> final assistant text OR tool-call intent
  -> harness authority decision
  -> deterministic local action / result evidence
  -> provider continuation
  -> repeat until terminal assistant answer or local stop
```

### 2.1 Raw model/provider supplies

| Provider primitive | What it is | What it does not do |
|---|---|---|
| Model inference | Turns input items/instructions/tools into streamed output. | Does not own local repo truth. |
| Text deltas/messages | Assistant text for UI and terminal answers. | Does not imply task succeeded locally. |
| Reasoning/summary/encrypted reasoning items | Provider/model internal or summarized reasoning evidence, where supported. | Raw reasoning is not renderer/context by default. |
| Tool-call item | A request/intention with name, arguments, call id. | Not authority to read, write, run, browse, spawn, or mutate. |
| Tool-output item shape | Protocol shape for sending result evidence back. | Does not decide whether result evidence is safe or true. |
| Usage/rate/model info | Server-side accounting/model evidence when exposed. | Missing usage is not zero; pricing is not billing truth. |
| `previous_response_id` or equivalent continuity | Provider-side continuation handle. | Not available for imported/history-only sessions; does not carry all instructions automatically. |
| Compaction endpoint/items, if available | Provider-assisted context reduction. | Does not create local memory/governance law by itself. |

### 2.2 Deterministic harness supplies

| Harness component | Deterministic function | Why it is required |
|---|---|---|
| Auth broker | Stores/refreshes credentials in main process, never renderer. | Provider access without leaking tokens. |
| Workspace backend | Canonical local/WSL root, file reads, writes, command execution. | Prevents split-brain paths and unsafe local authority. |
| Session/thread store | Canonical local history of what happened. | Recovery, audit, replay-safety. |
| Operation ledger | Records authority decisions and control mutations. | Prevents hidden state changes and duplicate side effects. |
| Projection store | Rebuildable renderer/context/read models. | Safe UI and safe prompt source selection. |
| Context policy/pack | Provider-neutral exact context material and authority framing. | Prevents ad hoc prompt assembly and prompt-injection leakage. |
| Request manifest | Exact allowed request-shape decision. | Shows what was authorized without storing raw request body. |
| Tool authority router | Converts tool intent into local obligations. | Central deontic boundary. |
| Redaction/raw-exposure scanner | Prevents unsafe artifacts/reports/renderer content. | Protects auth, paths, raw payloads, private data. |
| Idempotency/recovery state machines | Prevent duplicate reads/writes/commands after retry/crash. | Critical once side effects exist. |
| Headless regression harness | Proves real runtime behavior before UI trust. | Keeps UI toggles from becoming capability proof. |

---

## 3. Current branch descent summary

Current direct branch, using the stated real-usage baseline:

| Capability | Status | Notes |
|---|---:|---|
| App-server baseline turn | `B-R` | Standard path remains baseline/default. |
| Direct live probe evidence | `B-R` | Runtime-probed direct text evidence. |
| Strict direct text-only first turn | `B-R` | Fresh request, empty-context policy. |
| Strict direct recent-dialogue follow-up | `B-R` | Local quoted context, no provider continuity. |
| Opt-in guard | `B-R` | Prevents accidental live calls. |
| Idempotency | `B-R` for text | Tool/patch/command side-effect paths still need real proof. |
| Raw-exposure scan | `B-R/B-F` | Text reports proved; expand to all tool/patch/command paths. |
| Read-file implementation loop | `B-F/S` | Authority modules/specs exist; real-provider loop not yet proved. |
| Multi-step read-file loop | `S/B-F` | Designed; real-provider proof pending. |
| Patch apply loop | `B-F/S` | Authority module/spec exists; real-provider write proof pending. |
| Command execution loop | `B-F/S` | Authority module/spec exists; real-provider proof pending. |
| Workspace-effect scan | `S/B-P` | Needed before command path feels safe. |
| Recovery after side effects | `S/B-P` | Major next layer after real loops. |
| Iterative repair loop | `S` | Correct next after real authority loops and recovery. |
| Compaction/memory/governance/sub-agent depth | `FORK/S/B-P` | Under-covered in v0; expanded below. |

Immediate next implementation priority remains: **real-provider implementation-lane harness for read/patch/command, without adding new authority**.

---

# 4. Deep ODEU capability matrix

Each row includes:

- **Ideal**: what a mature Codex harness should eventually have.
- **OAI/server side**: what the server/model provides or allows.
- **Harness provision**: what the local harness must implement.
- **Current**: current direct branch posture.
- **Next proof**: what would promote or validate the capability.

---

## A. Provider, auth, model, transport

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| A1 | ChatGPT subscription Codex auth | Authenticated direct Codex access with account-scope evidence. | `OAI-A`: ChatGPT-login Codex backend path observed/documented for Codex CLI. | Main-process token store, refresh, redaction, account evidence key. | `B-R/B-F` | Strict direct runs with auth-source/profile-source in report. |
| A2 | API-key path separation | Separate provider profile for API-key usage. | `OAI-A` but different policy/billing path. | Separate ODEU profile; never conflate with subscription auth. | `NO` for current direct profile | Separate certification profile if needed. |
| A3 | Direct Responses transport | Stable provider adapter for direct ChatGPT/Codex requests. | `OAI-A/OAI-U`: direct endpoint observed; field support must be probed. | Transport adapter, stream parser, request-shape gates. | `B-R` text, `B-F` tools | Real read/patch/command tool-call cycles. |
| A4 | App-server baseline | Vanilla rich-client protocol and fallback runtime. | `OAI-A`: app-server/CLI path. | App-server manager/session bridge. | `B-R` | Keep baseline green as direct evolves. |
| A5 | SSE stream normalization | Raw provider events become local normalized event ontology. | `OAI-A`: streaming events. | Normalizer with versioned event allowlists and unknown-event policy. | `B-R` text | Tool/patch/command event normalization under real provider. |
| A6 | WebSocket direct transport | Optional lower-latency/session transport. | `OAI-U`; not main direct law. | Transport abstraction and probe evidence. | `NO/B-P` | Dedicated transport profile/probe. |
| A7 | Model catalog and descriptors | Live model descriptors: capabilities, context, reasoning, service tiers. | `OAI-A/OAI-U`: model availability depends auth/account/rollout. | Model evidence resolver; no static-only authority. | `B-P` | Live catalog/profile with exact account-scope evidence. |
| A8 | Reasoning effort / summary / verbosity controls | Per-model controls exposed only when supported. | `OAI-A/OAI-U` by model/request shape. | Profile-gated UI and request manifests. | `B-P/NO` | Probe per model/control/shape. |
| A9 | Prompt cache/session affinity | Cache key/session headers with explicit profile. | `OAI-A/OAI-U`: Codex harnesses use prompt cache/session affinity. | Distinguish cache/session from local thread id. | `S/B-P` | Evidence rows for cache key use and hit/miss if exposed. |
| A10 | Quota/context/rate usage | Runtime chips grounded in provider/account evidence. | `OAI-A` when exposed through app-server/OAI. | Usage ledger/profile rows; no zero inference. | `B-P` | Direct quota/rate snapshot proof. |
| A11 | Error/retry taxonomy | Pre-stream retry only; no retry after bytes/side effects. | `OAI-A`: transport/provider errors. | Request lifecycle states, handoff-unknown states. | `B-R` text, `B-F/S` tools | Tool/patch/command interrupted-state tests. |
| A12 | Provider-side compaction primitive | Optional endpoint/items for reducing context. | `OAI-A/OAI-U`: compact endpoint/items where supported. | Context-maintenance policy; artifact lifetime law. | `S/B-P` | Exact compaction probe and local artifact mapping. |

---

## B. Request, response item, and stream semantics

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| B1 | Provider-neutral start-turn model | Harness-level `StartTurn` maps to provider request. | `OAI-A`: Responses request fields. | Request manifest and provider-input projection. | `B-R/B-F` | Tool request shapes real-proved. |
| B2 | Text-only first turn | Fresh direct request with no tools/no continuity. | `OAI-A`. | Empty-context policy, current-prompt artifact. | `B-R` | Keep regression green. |
| B3 | Recent-dialogue follow-up | Fresh direct request with local quoted transcript. | `OAI-A`: full input list accepted. | Renderer/context projections, context pack. | `B-R` | Multi-turn regression. |
| B4 | Provider response id continuity | Use only with native source proof. | `OAI-A`: `previous_response_id` style continuation. | Source event digest and parent-turn proof. | `B-F` | Real read/patch/command continuation. |
| B5 | Function/custom tool call | Provider emits call id/name/args. | `OAI-A`. | Obligation projection; action-token authorization. | `B-F` | Real provider tool-call fixtures. |
| B6 | Function/custom tool output | Exact output item paired to call id. | `OAI-A`. | Tool result envelope, request manifest, continuation context. | `B-F` | Read/patch/command output shape evidence. |
| B7 | Multiple tool calls | Detect, sequence, or fail closed by policy. | `OAI-A`: possible. | Sequential/parallel tool policy. | `NO/S`: fail closed except planned read loop | Real fixture for multiple call rejection. |
| B8 | Reasoning replay / opaque reasoning | Preserve opaque reasoning only when accepted. | `OAI-A/OAI-U`: reasoning/encrypted content. | Opaque item storage; never renderer raw by default. | `B-P/S` | Probe encrypted reasoning replay if needed. |
| B9 | Message phase preservation | Track final/commentary/tool/status phases. | `OAI-A/OAI-U` if surfaced. | Normalized item phase field. | `B-P` | Stream fixtures with phases. |
| B10 | Unknown event drift handling | Unknown raw event becomes evidence, not crash. | Provider drift possible. | Raw type evidence key, diagnostics, fail-closed if semantic. | `B-R/B-F` | Tool/patch/command unknown-event tests. |
| B11 | Store/control flags | `store=false`, `tools=false`, `parallel_tool_calls=false`, etc. | `OAI-A`: request fields. | Manifest assertions before transport. | `B-R` text, `B-F` tools | Continuation manifest proof for all tools. |
| B12 | Response incomplete/content-filter semantics | Distinguish incomplete from final success. | `OAI-A`: incomplete/failure events. | Terminal taxonomy, composer gating. | `B-F` | Text/tool incomplete fixture. |

---

## C. Canonical storage, projections, and deterministic logs

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| C1 | Canonical direct rollout | Append-safe event history of what happened. | None. | JSONL/events with seq/digest/manifest. | `B-P/B-F` | Manifest law + rebuild tests. |
| C2 | Direct session/thread/turn store | Durable direct-native sessions. | None. | Session/turn artifacts and recovery states. | `B-R/B-F` | Multi-step tool recovery tests. |
| C3 | Operation ledger | Append-only authority/control mutations. | None. | Decision/journal/control events. | `B-P/B-F` | Tool/patch/command ledger order tests. |
| C4 | SQLite/projection store | Rebuildable read/context/control projections. | None. | WAL, FKs, source digests, current pointers. | `B-F` | FK/stale/current-pointer regression. |
| C5 | Renderer transcript projection | Safe UI transcript. | None. | `renderer_transcript@1`. | `B-F` | Parity with old read paths. |
| C6 | Context recent-dialogue projection | Prompt-safe recent transcript evidence. | None. | `context_recent_dialogue@1`. | `B-R/B-F` | Strict follow-up regression. |
| C7 | Obligation projection | Safe active/past tool obligations. | None. | `direct_obligations@1`. | `B-F` | Real read/patch/command cards. |
| C8 | Context pack | Exact provider-neutral material for request. | Provider consumes serialized request only. | App-private pack with policy/authority/omissions. | `B-R/B-F` | Tool/patch/command context packs. |
| C9 | Request manifest | Exact authorized request-shape decision. | Provider receives request. | Manifest with feature flags/evidence refs/no raw body. | `B-R/B-F` | Tool/patch/command manifest proof. |
| C10 | Provider-input projection | Hashable mapping from context pack to provider items. | Provider request schema. | Role mapping, input shape/text hashes. | `B-F` | Regeneration tests. |
| C11 | Recovery classifications | Distinguish healthy, partial, sent-unknown, stream-interrupted, corrupt. | None. | State machines and no-auto-retry law. | `B-P/S` | Crash/restart harness. |
| C12 | Thread analytics / usage projection | Derived analytics, not runtime truth. | Usage/events where exposed. | SQLite/read model, source fingerprints. | `B-P/S` | Analytics source class split. |

---

## D. Context, memory, compaction, and governance — deep rows

This section is the largest change from v0. The prior matrix collapsed too much into “compaction” or “context packs.” An ideal Codex harness needs separate objects for context maintenance, compaction routing, durable memory, baton/frontier artifacts, and governance prompt layering.

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| D1 | Context maintenance route matrix | Explicit routes: compact, refresh, prune, no-op; intra-turn vs turn-boundary; local vs remote engine. | `OAI-A/OAI-U` for compact endpoint/items only. | Route matrix with trigger, timing, engine, artifact lifetime, fail-closed behavior. | `S/B-P`; fork docs mention engines/routes | Define `context_maintenance_route@1` schema and status rows. |
| D2 | Context budget pressure model | Predict context pressure before request. | `OAI-A` usage/model window if exposed. | Token estimates, reserved output/reasoning budget, stale-after-compaction state. | `S/B-P` | Budget estimator + manifest fields. |
| D3 | Remote vanilla compaction | Use provider compaction endpoint/items as admitted. | `OAI-A/OAI-U`. | Request/response profile, compaction artifact, recovery. | `S` | Probe compact endpoint and item shapes. |
| D4 | Remote-hybrid compaction | Provider compact plus local memory/governance preservation. | `OAI-A` compact primitive, but memory/gov local. | Bridge memory/governance into compacted context. | `FORK/S` | Fork profile rows; direct spec later. |
| D5 | Local-pure compaction | Local/model-summarized compaction without provider compact endpoint. | OAI only supplies model text if used. | Summary policy, validation, provenance, no hidden continuity claim. | `FORK/S` | Local compaction pack and quality checks. |
| D6 | Compaction timing law | Distinguish intra-turn, turn-boundary, pre-request, post-tool, post-terminal. | OAI agnostic. | Scheduler/state machine prevents unsafe mid-obligation compaction. | `FORK/S` | Timing-specific transition table. |
| D7 | Continuation bridge / frontier baton | Turn-scoped artifact that survives compaction and carries frontier task state. | OAI can ingest it as developer/user/context item; not native law. | `<continuation_bridge>` or direct `frontier_baton@1` artifact, with task frontier, open obligations, source refs. | `FORK`; direct `S` | Direct `frontier_baton@1` schema and context-pack integration. |
| D8 | Rich review continuation bridge | Heavier baton that includes review obligations, risks, alternatives. | OAI can ingest text/items. | Rich bridge policy, review-specific source refs, no assistant-content confusion. | `FORK` | Decide if standalone shell should only display, not author. |
| D9 | Continuation bridge sub-agent supplement | Carry sub-agent frontier/progress into bridge. | OAI can ingest as context. | Child-agent summaries, unresolved waits, evidence refs. | `FORK` | Sub-agent registry first. |
| D10 | Durable ODEU thread memory | Persistent thread memory separate from compaction summary. | OAI does not store local memory for harness. | `<thread_memory>` / `durable_thread_memory@1` with lifecycle, refresh, governance gating. | `FORK/S` | Direct memory artifact schema and render rules. |
| D11 | Memory refresh law | When memory is refreshed, by whom, with what evidence and model. | OAI can generate summaries if asked. | Memory refresh operation, source digests, redaction, stale/fail states. | `FORK/S` | `thread_memory_refresh@1` operation tests. |
| D12 | Memory vs context separation | Memory is durable; context pack is per-request; compact summary is derived. | OAI agnostic. | Do not conflate memory with recent dialogue or compaction. | `B-P/S` | Schema separation in store/projections. |
| D13 | Fail-closed raw-window trimming | If context window trimming cannot preserve required artifacts, block or ask for maintenance. | OAI only enforces context window limits. | Trim policy with required artifact classes: harness policy, memory, baton, current user, open obligations. | `S` | `raw_window_trim_policy@1` and cap tests. |
| D14 | Context omission ledger | Every omitted span has count/reason/source refs. | OAI none. | Omission markers in context packs and derived previews. | `B-F/S` | Omission marker parity tests. |
| D15 | Governance prompt layering | Compile harness/system/developer/task/runtime/memory/tool policies into ordered layers. | OAI accepts instructions/input items; server may shape prompt internally. | `governance_packet@1`, `compiled_prompt_layers@1`, role mapping, digest. | `FORK/S`; direct has harness policy partial | Direct governance layer artifact and manifest refs. |
| D16 | Strict-v1 shadow governance | Generate diagnostics without blocking. | OAI none. | Shadow compiler with diagnostics/status pill. | `FORK` | Shell diagnostic projection only. |
| D17 | Strict-v1 enforce governance | Governance compiler may block illegal transitions. | OAI none. | Transition legality gates, fail-closed blockers. | `FORK/NO` for standalone default | Keep in odeu track unless feature proves workflow value. |
| D18 | Governance transition legality | Explicit transition graph for route changes: text -> tool -> patch -> command -> compact -> fork. | OAI none. | Legality matrix, blockers, diagnostics. | `S/B-P` | `workflow_transition_graph@1` integration. |
| D19 | Governance diagnostics | Explain missing packet, compile fallback, illegal transition. | OAI none. | Renderer-safe diagnostics, not raw packet editor. | `FORK/S` | Status-only drawer. |
| D20 | Semantic broker active packet | Resolve task semantics, schema, tools, prompt packets, provider route. | OAI may expose tool/schema primitives, not broker. | `semantic_broker_packet@1`: intent classification, tool catalog, schema route, policy outcome. | `FORK/B-P` hidden | Define broker as local policy layer, not generic tool broker. |
| D21 | Semantic broker fallback | If broker cannot classify, degrade to safe text-only or ask human. | OAI none. | Safe fallback rules and evidence. | `S` | Fallback tests. |
| D22 | Context integrity / HMAC chain | Detect tampering/corruption of memory/context/pack artifacts. | OAI none. | HMAC/digest with lineage. | `B-P/S` | Integrity verification in regression. |
| D23 | Maintenance manifests | Compact/refresh/prune manifests with source digest, route, engine, outcome. | OAI compact may return items. | `context_maintenance_manifest@1`. | `S` | Bundle before compaction implementation. |
| D24 | Maintenance UI posture | Show status lane, not chat; status: requested/running/completed/failed/unsupported. | OAI none. | Middle-plane or header diagnostics. | `S` | UX spec. |

### D-axis key distinction

```text
Recent dialogue = short-term context source.
Compaction = derived context reduction.
Thread memory = durable state across turns/compactions.
Continuation bridge/baton = turn/frontier survival artifact.
Governance packet = authority/policy layer.
Semantic broker = task/tool/schema routing layer.
```

These are different objects and should not collapse into one “summary.”

---

## E. Workspace, tool authority, and deterministic local actions

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| E1 | WSL/local workspace truth | Canonical workspace root through backend. | None. | Backend attach, path evidence key. | `B-R/B-F` | Keep tool paths routed through backend. |
| E2 | Work tree / preview | Control-plane file awareness. | None. | Backend list/read, caps. | `B-R` | Already baseline. |
| E3 | Read-file authority | Approved project-relative read. | Model may request `read_file`. | Path validation, sensitive policy, bounded result. | `B-F/S` | Real read approval loop. |
| E4 | Multi-step read loop | Sequential approved reads until final. | Model may request repeated calls. | Loop caps, per-step tokens, response chain. | `S/B-F` | Real multi-step read harness. |
| E5 | Patch plan | Provider patch -> structured dry-run plan. | Model may propose patch call/text. | Parser, dialect, path/collision checks. | `B-F/S` | Real provider patch call. |
| E6 | Patch apply journal | Approved patch through backend with journal. | None. | Before/after evidence, apply journal, partial-state handling. | `B-F/S` | Disposable-workspace real patch. |
| E7 | Workspace effect scan | Know what changed after patch/command. | None. | Pre/post status/digest/effect summary. | `S/B-P` | Command mutation fixture. |
| E8 | Revert | User-approved rollback of local changes. | None. | Revert plan, backup evidence, conflict checks. | `NO/S` | Separate spec; do not assume. |
| E9 | Command plan | Model command request -> bounded argv plan. | Model may request command. | Command-class policy, package script validation, cwd/env/caps. | `B-F/S` | Real run_command approval loop. |
| E10 | Command execution | Approved bounded command through backend. | None. | shell=false, timeout, process-tree cleanup, output caps. | `B-F/S` | Real headless command with workspace-effect scan. |
| E11 | Command side-effect truth | Detect generated files/caches/lock changes. | None. | Workspace-effect scan and warnings. | `S/B-P` | Real mutation fixture. |
| E12 | Network/shell/browser/MCP | Broader tools with separate policy. | OAI can emit tool calls if declared. | Separate authority surfaces. | `NO` | Not next. |
| E13 | Auto-approval policies | Allow trusted repeated operations. | OAI none. | Strong policy + audit + reversible scopes. | `NO` | Later only. |
| E14 | Tool-result redaction | Prevent secrets from going back to provider. | OAI none. | Secret scanner before provider continuation. | `B-F/S` | Real result redaction fixture. |
| E15 | Tool-output envelope classes | Result class per read/patch/command. | OAI supports output item shape. | Envelope schemas and evidence gates. | `B-F` | Real loops prove envelopes. |
| E16 | Tool-loop iteration caps | Stop runaway loops. | OAI none. | Step caps, repeated path caps, command caps. | `S/B-F` | Multi-step loop tests. |
| E17 | No-retry-after-side-effect | Prevent duplicate writes/commands after ambiguity. | OAI none. | Handoff-unknown states, idempotency, journal state. | `S/B-P` | Crash/retry regression. |

---

## F. Runtime tiers, UX, and workflow control

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| F1 | App-server tier | Default safe vanilla path. | `OAI-A` app-server. | Manager/session bridge. | `B-R` | Keep green. |
| F2 | Direct text-only tier | Fresh direct text turns, no tools. | Direct text inference. | Toggle, evidence gates, context packs. | `B-R` | Real regression. |
| F3 | Direct recent-dialogue tier | Multi-turn direct text via local context. | Full input accepted. | Projections/context packs. | `B-R` | Real follow-up regression. |
| F4 | Direct implementation lane | Read/patch/command authority loop. | Tool-call intents + continuations. | Authority modules, UI cards, journals. | `B-F/S` | Real read/patch/command harness. |
| F5 | Tier selection law | Selection != turn authority. | None. | Atomic selection, private rollback, re-evaluate on turn. | `B-F` | UI + headless tests. |
| F6 | Approval cards | Main-authoritative actions, renderer hints. | None. | Action tokens, expected digests, stale rejection. | `B-F/S` | Real cards under provider tool calls. |
| F7 | Runtime status/blockers | Explain readiness and degraded states. | None. | Status resolver, blocker taxonomy. | `B-F` | Tool status rows. |
| F8 | Operation history | Durable read/patch/command/fork/lifecycle history. | None. | Operation ledger projections. | `B-F/S` | UI workbench tests. |
| F9 | Header/runtime band witnesses | Model/access/quota/tier/runtime compact status. | Usage/model/account evidence. | Read-only witness chips. | `B-P/S` | Ground in ledger/profile. |
| F10 | Handoff to ChatGPT review | Explicit workflow items, not automation default. | ChatGPT UI is external surface. | Handoff queue/templates/thread deck. | `B-R/B-F` standalone | Keep separate from direct runtime. |

---

## G. Imports, derived views, thread workbench

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| G1 | Legacy Codex JSONL import | Source evidence only. | App-server/CLI source. | Parser, validation report, no continuity. | `B-F` | Import fixtures. |
| G2 | Import checkpoint continuation | Fresh direct session from validated checkpoint. | Text inference only. | Seed/context/manifest. | `B-F/S` | Real checkpoint follow-up test. |
| G3 | Import UX/status | Safe import workbench. | None. | Renderer-safe projections, hide/status. | `B-F/S` | UI tests. |
| G4 | Thread graph | Lifecycle/relationship graph. | None. | Edges, external refs, operation history. | `B-F/S` | Workbench IPC tests. |
| G5 | Merge preview | Non-runnable derived view. | None. | Source refs, stable preview items. | `B-F/S` | Preview tests. |
| G6 | Prune preview | Non-runnable derived view with omission markers. | None. | Omission markers and caps. | `B-F/S` | Prune preview tests. |
| G7 | Fork preview | Non-runnable seed preview. | None. | Seed metadata only. | `B-F/S` | Fork preview tests. |
| G8 | Start fresh fork | Fresh direct-native session from preview. | Text inference. | Seed/context/manifest; no provider continuity. | `S/B-P` | Real fresh fork from direct preview. |
| G9 | Derived preview fork | Fresh session from merge/prune preview. | Text inference. | Derived seed with omission truth. | `S` | Later. |
| G10 | ChatGPT external refs | Link direct thread to ChatGPT binding, no import. | ChatGPT UI separate. | External ref by binding id only. | `B-P/S` | Workbench external ref tests. |
| G11 | Purge/delete | Intentional removal with tombstones. | None. | Deletion plans, tombstones. | `NO/S` | Defer. |

---

## H. Fork-derived context, governance, observability, and sub-agent depth

This is the exemplar-driven addition. These are not all direct-branch commitments. They are capability rows that must exist in the ideal ODEU matrix so they do not disappear under vague labels.

| # | Capability | Ideal | OAI/server side | Harness/fork provision | Current direct branch | Promotion rule |
|---:|---|---|---|---|---:|---|
| H1 | Context maintenance route matrix | Explicit matrix of compact/refresh/prune/no-op, timing, engine, artifact lifetime. | `OAI-A/OAI-U` only for compact primitive. | Fork route matrix or direct `context_maintenance_route@1`. | `FORK/S` | Promote after route manifest + fail-closed tests. |
| H2 | Compaction engine selection | `remote_vanilla`, `remote_hybrid`, `local_pure` with deontic consequences. | Remote compact primitive where available. | Config/profile + maintenance manifests. | `FORK/S` | Do not expose until engine evidence exists. |
| H3 | Continuation bridge / frontier baton | Turn-scoped state that survives compaction and captures frontier. | OAI can ingest as context; not native. | Fork `<continuation_bridge>` or direct `frontier_baton@1`. | `FORK/S` | Add separate row in context pack; not assistant content. |
| H4 | Rich review bridge | Frontier plus review critique/risk/alternatives. | OAI can generate/consume text. | Bridge-generation policy and diagnostics. | `FORK/S` | Useful for ChatGPT/Codex handoff later. |
| H5 | Durable ODEU thread memory | Long-lived memory artifact separate from compaction and recent context. | OAI none. | `<thread_memory>` / `durable_thread_memory@1`. | `FORK/S` | Promote only as visibility first, not editor. |
| H6 | Memory refresh operation | Refresh durable memory from source transcript/context. | OAI can summarize if called. | Memory refresh manifest and diagnostics. | `FORK/S` | Needs source digests and redaction. |
| H7 | Fail-closed memory/trim law | If memory/bridge required but cannot fit, fail or maintain; never silently drop. | OAI context-window limits only. | Trim policy with required artifact set. | `S` | Critical for long direct sessions. |
| H8 | Governance prompt layering | Constitutional/role/task/runtime/tool/memory layers with digest. | OAI accepts instructions/input items. | Strict-v1 packets/compiler or direct governance packet. | `FORK/S` | Status pill first; editor deferred. |
| H9 | Governance transition legality | Legal route transitions and blocking diagnostics. | OAI none. | Workflow transition graph and compiler. | `S/B-P` | Connect to runtime/tool state machines. |
| H10 | Governance diagnostics | Compile errors, fallback semantics, illegal transition explanation. | OAI none. | Renderer-safe diagnostics. | `FORK/S` | Advanced drawer. |
| H11 | Semantic broker active packet | Resolve user/task semantics to tools/schemas/context policy. | OAI can follow schema/tool descriptions. | `semantic_broker_packet@1`; fork semantic broker evidence. | `FORK/B-P` hidden | Promote only after explicit runtime contract. |
| H12 | Semantic broker fallback | Ask user or degrade to safe text-only if broker uncertain. | OAI none. | Fallback transition law. | `S` | Avoid misrouting tools. |
| H13 | E-witness sub-agent progress registry | Live progress/attention witness for child agents. | OAI none directly; model may call tools. | Agent progress registry, evidence refs, progress rows. | `FORK/S` | Display only; no choreography in standalone. |
| H14 | Inspect agent progress tool | Model-visible `inspect_agent_progress`. | OAI tool-call primitive only. | Tool definition + local registry lookup. | `FORK/S` | Diagnostic; not user action first. |
| H15 | Wait agent progress tool | Model-visible wait/synchronization tool. | OAI tool-call primitive only. | Wait state, timeout, cancel, no deadlock law. | `FORK/S` | Requires concurrency/recovery law. |
| H16 | Thread-spawn sub-agent containment | Spawned child agent tool surface is bounded. | OAI can emit spawn-like calls if declared. | Sub-agent tool plan, permissions inheritance, child workspace scopes. | `FORK/S` | Keep in ODEU track until app-server/direct exposes cleanly. |
| H17 | Collab tool surface | spawn/send/followup/wait/close/list tools. | OAI only tool-call substrate. | Multi-agent orchestration and graph store. | `FORK/S` | Standalone shows evidence, not choreography. |
| H18 | Sub-agent transcript projection | Child agent transcript separate from main transcript. | OAI none. | Agent graph provider, hydration, tabbed panel. | `B-P/S` docs | Good for visibility once agent graph is real. |
| H19 | Agent activity attention model | Badges/unread/error/attention for child agents. | OAI none. | Activity projection, stale guards. | `S` | Useful UI but after registry. |
| H20 | Sub-agent progress wait deadlock prevention | Avoid blocking primary turn forever. | OAI none. | Wait caps, cancellation, terminal states. | `S` | Required before `wait_agent` promotion. |
| H21 | Fork-specific capability detection | Distinguish vanilla vs fork support by schema/config/probe. | OAI none. | Capability profile and no path-substring proof. | `B-P/S` | Already documented; implement as profile rows. |
| H22 | Fork artifact rendering | Render `<thread_memory>`, `<continuation_bridge>`, sub-agent artifacts as operational context. | OAI none. | Collapsible non-chat lanes. | `S` | Avoid assistant-content confusion. |
| H23 | Fork knobs UX posture | Advanced/status-only/authority-sensitive tiers. | OAI none. | Capability tiers from internal knobs map. | `S/B-P` | Prevent standalone shell from becoming fork dashboard. |
| H24 | Update/build workflow helpers | Maintenance commands for fork development. | None. | Local scripts/checks. | `NO` matrix core | Appendix only; not runtime ODEU. |

### H-axis decisive rule

Fork-derived primitives are **design inspiration and optional provider/runtime specialization**. They are not the standalone product identity. They should enter the direct shell only when:

1. the active runtime proves support by schema/config/probe/artifact;
2. the capability has an ODEU row with deontic rules;
3. the UI posture is status/diagnostic first unless it directly improves day-to-day workflow;
4. missing support fails closed rather than degrading into raw controls.

---

## I. Evidence, profile, testing, and safety

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| I1 | ODEU profile schema | Versioned capability schema. | Source evidence from OAI/docs/probes. | Profile package and resolver. | `B-R` | Keep updated with new probes. |
| I2 | Evidence states | candidate/probed/accepted/unstable/rejected/expired. | None. | Evidence store/index/hydration. | `B-R/B-F` | Hydration/scoping regression. |
| I3 | Exact-scope live evidence | Capability only for exact account/model/endpoint/request shape. | OAI primitive observed/probed. | Scope resolver and mismatch categories. | `B-R` text | Tool evidence scopes. |
| I4 | Diagnostic non-promotion | Diagnostic live calls do not unlock normal controls. | None. | Run mode and report states. | `B-R` | Keep in regression. |
| I5 | Raw-exposure scanning | Scan artifacts/reports/renderer/DOM/storage. | None. | Scanner and minimal safe failure report. | `B-R/B-F` | Extend to tool paths. |
| I6 | Headless text regression | Real appserver/direct text runs. | OAI/app-server/direct. | Scripts and reports. | `B-R` | Keep green. |
| I7 | Headless implementation-lane regression | Real provider read/patch/command loops. | OAI tool calls + local actions. | Disposable workspace, scripted tasks. | `NO/S` | Immediate next. |
| I8 | Fixture suite | Fast deterministic fixtures. | None. | Fake events/transports. | `B-R/B-F` | Expand for command/patch. |
| I9 | Recovery/replay suite | Crash/reload between every state. | None. | State rehydration and no auto-retry. | `S/B-P` | After real loops. |
| I10 | Usage ledger | Neutral runtime usage evidence. | App-server/direct usage where exposed. | Ledger rows, manifest, privacy. | Main spec, not direct core | May feed status later. |
| I11 | Cost estimator | Derived pricing from usage + dated pricing snapshot. | OAI pricing external/current. | Separate derived ledger. | `NO/S` | Later; not billing truth. |
| I12 | Drift watch | Detect backend/schema/event drift. | Provider changes. | Unknown event/profile delta/report. | `B-F` | Regression deltas. |
| I13 | Capability downgrade | Disable controls when evidence expires/mismatches. | None. | Runtime status and blockers. | `B-F` | UI status tests. |
| I14 | CI live-call guard | Prevent accidental provider calls. | None. | Env/flag gates. | `B-R` | Keep. |
| I15 | Report schema validation | Reports validate before/write/after scan. | None. | JSON schema/runtime validator. | `B-F` | Extend. |

---

## J. Policy, configuration, and project-level controls

| # | Capability | Ideal | OAI/server side | Harness provision | Current | Next proof |
|---:|---|---|---|---|---:|---|
| J1 | Project provider profile | App-server/direct/custom fork selection. | Provider independent. | Project config and capability profile. | `B-F` | UX polish. |
| J2 | Direct tier policy | App-server, direct text-only, direct implementation lane. | OAI none. | Selection audit/rollback. | `B-F/B-R` text | UI proof. |
| J3 | Allowed command classes | Project-scoped command policy. | OAI none. | Policy config + command planner. | `S/B-P` | Command spec implementation. |
| J4 | Sensitive path denylist | Project/local policy. | OAI none. | Denylist + extra-confirmation policy. | `B-F/S` | Tool/patch/command tests. |
| J5 | Generated/vendor/lockfile policy | Workspace mutation policy. | OAI none. | Path class policy. | `S` | Patch/command workspace effects. |
| J6 | Read/patch/command caps | Project caps for bytes/chars/steps/time. | OAI none. | Policy snapshot and action cards. | `B-F/S` | Real tool regression. |
| J7 | Network-risk policy | Warnings/blockers by backend sandbox and command class. | OAI none. | Command backend capability truth. | `S` | Command implementation. |
| J8 | Model/evidence status | Project-specific direct model readiness. | OAI model/support. | Status resolver. | `B-F` | UI status. |
| J9 | Fork capability profile | Detect fork methods/keys/artifacts. | OAI none. | Capability profile extension. | `S/B-P` docs | Implement schema/config/probe checks. |
| J10 | Governance mode settings | off/shadow/enforce, if fork supports. | OAI none. | Advanced provider drawer/status. | `FORK/S` | Status only first. |
| J11 | Compaction/memory settings | Engine/model/reasoning/bridge variants. | OAI compact if used. | Advanced config, not core UI. | `FORK/S` | Status/diagnostics only. |
| J12 | Maintenance hygiene | Docs, migration notes, branch readiness. | None. | Checklists and automated regression. | `B-P/S` | Mainline readiness track. |

---

# 5. ODEU checklist by axis with deeper sub-capabilities

## 5.1 Ontology checklist

### Provider and stream ontology

- [x] Auth/account evidence object.
- [x] Endpoint profile and endpoint hash.
- [x] Model evidence object.
- [x] Request-shape class and request-shape hash.
- [x] Stream normalized event types.
- [x] Assistant message item.
- [x] Function/custom tool-call item.
- [x] Function/custom tool-output item.
- [x] Usage event/snapshot object.
- [ ] Reasoning/encrypted reasoning replay object accepted for direct path.
- [ ] Compaction item/object accepted for direct path.
- [ ] Prompt-cache/session-affinity object.

### Local deterministic ontology

- [x] Project/workspace binding.
- [x] Direct session/thread/turn.
- [x] Renderer transcript projection.
- [x] Context projection.
- [x] Context pack.
- [x] Request manifest.
- [x] Tool obligation.
- [x] Tool result artifact.
- [x] Import/checkpoint artifact.
- [x] Thread graph/control projection.
- [ ] Canonical rollout manifest ideal-complete.
- [ ] Operation ledger ideal-complete.
- [ ] Workspace effect summary real-proved.
- [ ] Patch journal real-proved.
- [ ] Command result real-proved.
- [ ] Revert plan.

### Context/memory/governance ontology

- [ ] Context maintenance route matrix.
- [ ] Context maintenance manifest.
- [ ] Durable thread memory artifact.
- [ ] Thread memory refresh operation.
- [ ] Continuation bridge/frontier baton.
- [ ] Rich review bridge artifact.
- [ ] Governance packet.
- [ ] Compiled prompt layers artifact.
- [ ] Governance transition legality artifact.
- [ ] Semantic broker active packet.
- [ ] Raw-window trim policy.
- [ ] Context omission ledger ideal-complete.

### Multi-agent/sub-agent ontology

- [ ] Agent graph.
- [ ] Agent progress registry.
- [ ] E-witness/progress witness object.
- [ ] Inspect/wait progress tool obligations.
- [ ] Sub-agent transcript projection.
- [ ] Sub-agent attention model.
- [ ] Thread-spawn containment policy.
- [ ] Collab tool surface registry.

---

## 5.2 Deontic checklist

### Already present or well-framed

- [x] Provider tool call is not authority.
- [x] Renderer never receives raw auth tokens.
- [x] Direct text-only cannot execute tools.
- [x] Direct implementation lane is distinct from text-only.
- [x] App-server remains default/baseline.
- [x] Live calls require explicit opt-in.
- [x] Diagnostic runs do not promote readiness.
- [x] No app-server fallback inside direct turns.
- [x] No right-pane ChatGPT mutation by direct runtime.
- [x] No handoff queue mutation by direct runtime.

### Needs real-provider proof

- [ ] Real read approval: each read has fresh authority.
- [ ] Real multi-step read: repeated reads have separate approvals and caps.
- [ ] Real patch apply: preview/dry-run/journal/write authority.
- [ ] Real command run: bounded approval, process cleanup, effect scan.
- [ ] No duplicate side effects after restart/retry.
- [ ] Handoff-unknown states never auto-retry.
- [ ] Workspace changed but model did not see contents is visible.

### Needs future governance/policy proof

- [ ] Governance packet can block illegal transition.
- [ ] Context route matrix can fail closed.
- [ ] Thread memory never silently overrides current user intent.
- [ ] Baton/frontier artifacts never become assistant content.
- [ ] Semantic broker uncertainty asks/degrades, not misroutes.
- [ ] Sub-agent wait cannot deadlock primary lane.
- [ ] Sub-agent spawn containment prevents authority leakage.

---

## 5.3 Epistemic checklist

### Built evidence classes

- [x] Imported baseline ODEU profile.
- [x] Live probe evidence.
- [x] Text-only strict real report.
- [x] Recent-dialogue strict real report.
- [x] Fixture smoke reports.
- [x] Raw-exposure scan reports.
- [x] App-server baseline comparison report.

### Missing evidence classes

- [ ] Real provider `read_file` tool-call trace.
- [ ] Real provider multi-step `read_file` trace.
- [ ] Real provider `apply_patch` trace.
- [ ] Real provider `run_command` trace.
- [ ] Real provider continuation after tool result.
- [ ] Workspace effect scan report.
- [ ] Interrupted-state recovery reports.
- [ ] Compaction route evidence.
- [ ] Memory refresh evidence.
- [ ] Governance compile/transition evidence.
- [ ] Semantic broker routing evidence.
- [ ] Sub-agent progress/wait evidence.

---

## 5.4 Utility checklist

### Current utility

- [x] Direct text-only conversation.
- [x] Direct recent-dialogue follow-up.
- [x] App-server fallback/baseline.
- [x] Project-bound ChatGPT thread deck remains separate.
- [x] WSL/local workspace work tree/preview.
- [x] Headless real text regression.

### Utility not yet realized

- [ ] Repo inspection via real read-file loop.
- [ ] Implementation via real patch apply.
- [ ] Verification via real command run.
- [ ] Iterative repair after command failure.
- [ ] Workspace-effect awareness.
- [ ] Recovery after local side effect.
- [ ] Long-context continuity through memory/compaction/baton.
- [ ] Sub-agent observability.
- [ ] Governance diagnostics.
- [ ] Project policy configuration.

---

# 6. Descent map: ideal to current to next

## 6.1 Ideal implementation-lane loop

```text
User asks implementation task
  -> semantic broker classifies task and expected tool surface
  -> governance packet compiles harness/tool/context policy
  -> context route matrix builds recent context + memory + baton
  -> request manifest authorizes provider request
  -> provider streams response
  -> provider emits read_file / apply_patch / run_command / other supported tool
  -> obligation projection creates card
  -> user approves or declines
  -> workspace backend executes deterministic action
  -> workspace effect/journal/result artifact recorded
  -> context pack for continuation includes result evidence, policy, no hidden authority
  -> provider continuation
  -> repeat until terminal assistant message
  -> operation ledger and canonical rollout are durable
  -> context maintenance decides whether memory/baton/compaction refresh is needed
```

## 6.2 Current direct branch

```text
Direct text-only first turn:             real green
Direct recent-dialogue follow-up:        real green
App-server baseline:                     real green
Direct read/patch/command modules:       built/spec/fixture, not real-proved
Compaction/memory/governance/sub-agent:  mostly fork-derived/spec/diagnostic
Workspace effect/recovery:               next-after-real-loops
```

## 6.3 Immediate next bundle

```text
Real-provider implementation-lane harness for read/patch/command
```

It should prove:

1. A real provider can emit a supported `read_file` call.
2. The harness can display/approve/read/respond once.
3. A real provider can continue and either finalize or request another read.
4. A real provider can emit a supported `apply_patch` call in a disposable workspace.
5. The harness can plan/dry-run/approve/apply/journal/respond.
6. A real provider can emit a supported `run_command` call.
7. The harness can plan/approve/run/capture/scan/respond.
8. Reports prove no raw exposure, no app-server fallback, no right-pane mutation, no handoff mutation.

It should not add:

```text
auto-approval
general shell/network/browser/MCP tools
parallel tool calls
delete/revert unless separately scoped
production direct mode
right-pane ChatGPT automation
```

---

# 7. Capability gaps exposed by the deeper matrix

The deeper matrix changes the roadmap in a useful way. It shows several capabilities that should be tracked explicitly, even if not implemented next.

## 7.1 Gaps that directly affect implementation-lane correctness

| Gap | Why it matters | Next treatment |
|---|---|---|
| Workspace-effect scan | Commands/scripts can mutate workspace invisibly. | Include in real command harness. |
| Patch journal/recovery | Writes need crash-safe recovery. | Include in patch real harness and recovery pass. |
| Handoff-unknown states | Prevent duplicate side effects. | Recovery pass after real loops. |
| Tool-result redaction | Read/command output can leak secrets to provider. | Include in real tool harness. |
| Per-step loop evidence | Multi-step loops need parent response chain proof. | Include in multi-step read harness. |

## 7.2 Gaps that affect long-context Codex behavior

| Gap | Why it matters | Next treatment |
|---|---|---|
| Context maintenance route matrix | Avoids ad hoc compaction and unsafe trimming. | Spec after real implementation loops. |
| Durable thread memory | Compaction summary alone cannot carry stable thread facts. | Add memory row/artifact before long sessions. |
| Continuation bridge/frontier baton | Preserves task frontier across compaction/turn boundaries. | Add baton schema after memory/compaction route. |
| Fail-closed raw-window trimming | Prevents silent loss of policy/current task/open obligations. | Add before enabling automatic compaction. |

## 7.3 Gaps that affect governance and routing

| Gap | Why it matters | Next treatment |
|---|---|---|
| Governance prompt layering | Keeps harness policy distinct from history/user text. | Add artifact-level prompt layer digests. |
| Transition legality | Prevents illegal route jumps: e.g., compact during active write. | Connect to workflow transition graph. |
| Semantic broker | Separates task/schema/tool routing from generic tool broker. | Keep hidden until contract exists. |

## 7.4 Gaps that affect multi-agent observability

| Gap | Why it matters | Next treatment |
|---|---|---|
| Agent progress registry | Needed before inspect/wait tools can be safe. | Diagnostic-only registry first. |
| E-witness progress | Lets model/user know child-agent progress without transcript merge. | Add after registry. |
| Thread-spawn containment | Prevents sub-agent authority leakage. | ODEU track first. |
| Sub-agent transcript projection | Keeps child transcripts visible but separate. | UI after registry/graph. |

---

# 8. Fork-specific capability treatment

The custom Codex fork can inform the direct shell, but it should not define the standalone product identity.

## 8.1 Capabilities to treat as reusable design primitives

- Context maintenance route matrix.
- Continuation bridge / frontier baton.
- Durable thread memory.
- Governance prompt layering and diagnostics.
- Semantic broker packet.
- Sub-agent progress registry.
- Inspect/wait progress tools.
- Thread-spawn containment.

## 8.2 Capabilities to keep out of normal standalone UX for now

- Raw governance packet editor.
- Raw compaction engine authoring.
- Multi-agent choreography controls.
- Arbitrary semantic broker authoring.
- Raw config overrides.
- Auto-approval or hidden authority expansion.

## 8.3 Required evidence before surfacing fork-derived controls

A fork-derived control may surface only if one of these proves support:

1. active runtime schema includes the method/field;
2. `config/read` returns a fork-specific key/value;
3. a runtime probe succeeds;
4. an executable identity/version marker is verified;
5. historical transcript artifact is present **only for rendering historical artifacts**, not for enabling new controls.

Never use a path substring such as `/codex/fork` as capability proof.

---

# 9. Recommended next roadmap after this deeper matrix

## Stage 1 — Real implementation-lane proof

```text
real read_file approval loop
real multi-step read_file loop
real apply_patch approval loop in disposable workspace
real run_command approval loop in disposable workspace
workspace-effect scan
```

No new authority. Prove the existing authority.

## Stage 2 — Recovery and replay safety

```text
provider requested tool, app restarted
approval card reloads safely
tool result recorded but continuation not sent
patch applied but continuation failed
command ran but continuation failed
handoff unknown never auto-retries
```

## Stage 3 — Iterative repair loop

```text
read -> patch -> command -> next patch/read -> command again
```

Add bounded sequencing and per-step approval.

## Stage 4 — Workspace change authority

```text
workspace effect summaries
patch journal inspection
generated/vendor/lockfile policy
workspace changed but model did not see contents
optional revert spec
```

## Stage 5 — Context maintenance / memory / baton

```text
context route matrix
thread memory
frontier baton
compaction manifests
fail-closed trimming
```

## Stage 6 — Governance and semantic broker

```text
governance packet diagnostics
transition legality
semantic broker packet
fallback/ask-human behavior
```

## Stage 7 — Sub-agent observability

```text
progress registry
e-witness rows
inspect/wait tools
sub-agent transcript projection
containment policy
```

## Stage 8 — UI polish and mainline readiness

```text
tier selector status matching headless gates
approval cards
operation history
project policy controls
docs alignment
automated regression suite
merge-behind-flag checklist
```

---

# 10. Main conclusion

The v0 matrix was right but too compressed. The v0.1 matrix must preserve at least these additional first-class rows:

```text
context maintenance route matrix
continuation bridge / frontier baton
durable thread memory
memory refresh law
fail-closed raw-window trimming
governance prompt layering
governance transition legality
semantic broker active packet
e-witness sub-agent progress registry
inspect/wait agent progress tools
thread-spawn sub-agent containment
workspace-effect scan
patch journal/recovery
command side-effect truth
```

The immediate next work should still be **real-provider implementation-lane harness for read/patch/command**. The deeper rows do not change the next step; they prevent the roadmap from forgetting context, memory, governance, semantic routing, and sub-agent observability once the core implementation lane starts working.
