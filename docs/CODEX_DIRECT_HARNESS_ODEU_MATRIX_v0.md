# Codex Direct Harness ODEU Capability Matrix v0

Scope: long-lived direct ChatGPT/Codex harness branch of `apps/codex-review-shell`, compared against an ideal Codex agentic harness.

This document separates:

- **OAI / provider substrate**: model inference, streaming events, tool-call intents, usage/quota/model information, continuation shapes.
- **Harness deterministic substrate**: auth handling, workspace bridge, file/patch/command authority, journals, projections, context packs, request manifests, approval UI, redaction, recovery.
- **UX/control substrate**: left Codex lane, middle control plane, thread workbench, runtime tiers, headless regression.

## Status legend

| Code | Meaning |
|---|---|
| `B-R` | Built and real-provider/headless proved under current stated baseline. |
| `B-F` | Built or substantially present in code; fixture/smoke/local coverage, not yet real-provider proved end-to-end. |
| `B-P` | Built partial/scaffold; not complete enough to treat as usable. |
| `S` | Spec exists; implementation not assumed complete. |
| `OAI-A` | OAI/server side accepted or documented/observed as usable primitive, but harness work remains. |
| `OAI-U` | OAI/server side exists or is plausible/observed but unstable; requires probe/profile evidence. |
| `LOCAL` | Pure harness/local deterministic responsibility; OAI does not grant this. |
| `NO` | Intentionally not supported / blocked in current doctrine. |

## First-principles Codex agentic system

A Codex agentic harness is not just a chat UI. It is a controlled loop around a model that emits text and possible tool-call intents.

```text
Human/project intent
  -> harness-owned context composition
  -> provider request
  -> model stream
  -> normalized response items
  -> final assistant text OR tool-call intent
  -> harness authority decision
  -> deterministic local action / result evidence
  -> provider continuation
  -> repeat until final terminal answer or local stop
```

### Raw model / provider layer

The provider can supply:

- model inference over a Responses-style request;
- streaming deltas and completed/failure events;
- assistant messages;
- reasoning summaries and/or encrypted reasoning content where supported;
- tool-call intents such as function/custom calls;
- usage/account/rate/context/model evidence where exposed;
- continuation mechanisms, including full stateless input and, where admitted, `previous_response_id`;
- optional hosted tools or compaction primitives where supported by the provider profile.

The provider does **not** supply local workspace authority. A model-emitted `read_file`, `apply_patch`, or `run_command` is a request, not permission.

### Harness deterministic layer

The harness must own:

- project/workspace binding;
- WSL/local workspace bridge;
- canonical local thread/session storage;
- normalized event store;
- projection/read models;
- context composition and prompt framing;
- request manifests;
- local tool broker;
- approvals and action tokens;
- file/patch/command execution;
- journals and workspace effect summaries;
- redaction and raw-exposure policy;
- idempotency, crash recovery, and no-retry-after-side-effect law.

### Memory and context types

| Memory type | Owner | Purpose | Canonical? | Current branch posture |
|---|---|---|---:|---|
| Provider latent/model state | OAI | Model inference internals. | No local access | OAI substrate only. |
| Provider response chain | OAI + harness | `previous_response_id` style continuity. | Provider canonical if used | Used only where explicitly gated; text-only uses local stateless context. |
| Local canonical rollout/session artifacts | Harness | What happened locally. | Yes | Built. |
| Operation ledger | Harness | Authority/control mutations. | Yes for control | Built/scaffolded in thread store/workbench path. |
| SQLite/projection store | Harness | Renderer/context/search/read models. | Rebuildable | Built. |
| Context packs | Harness | Exact provider-neutral material sent/used for request building. | App-private evidence | Built. |
| Request manifests | Harness | Exact authorized request-shape decision without raw body. | App-private evidence | Built. |
| Compaction summaries | Provider or harness | Context reduction. | Derived | OAI-supported; not yet direct production path. |
| ChatGPT review threads | External ChatGPT UI | Review/world-model partner memory. | Separate surface | Bound in standalone shell; not direct Codex memory. |

---

## ODEU matrix

### A. Provider, auth, model, and transport

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| A1 | ChatGPT subscription auth for Codex | Account/auth surface | Tokens never renderer-visible | Auth status, account evidence key | Enables subscription path | `OAI-A` | `B-F/B-R`: direct auth store, codex-cli auth fallback, live probe path. |
| A2 | API-key Codex path | Account/auth surface | Separate policy/billing path | API-key evidence | Alternative provider mode | `NO` for this profile | `NO`: intentionally out of direct ChatGPT-subscription profile. |
| A3 | Direct Codex Responses endpoint | Provider endpoint | Not public API contract; profile-gated | endpointHash, requestShapeHash, probe evidence | Enables direct runtime | `OAI-A/OAI-U` depending exact field | `B-R` for text-only under stated green baseline; `B-F` for tools. |
| A4 | App-server compatibility path | JSON-RPC client protocol | Vanilla path remains default/main | schema/version/app-server event evidence | Stable baseline | `OAI-A` official/client protocol | `B-R` on main/branch baseline. |
| A5 | SSE streaming | Stream event channel | Normalize raw events | raw event set + normalizer version | Low latency UI | `OAI-A` | `B-R` for direct text; built normalizer. |
| A6 | WebSocket streaming | Stream transport | Optional, unstable | separate transport evidence | Lower overhead/session channel | `OAI-U` | `NO/B-P`: not default; deferred. |
| A7 | Model catalog/listing | Model descriptor | Do not expose unsupported controls | model evidence, profile | model picker, context caps | `OAI-A/OAI-U` | `B-P`: profile/static/model resolver; live model catalog not fully authoritative. |
| A8 | Reasoning effort controls | request.reasoning | Model-specific; gated | profile/model evidence | tune cost/quality | `OAI-A/OAI-U` | `B-P`: represented in profile, not normal direct UI. |
| A9 | Text verbosity controls | request.text.verbosity | Model-specific; gated | profile/model evidence | output style/cost | `OAI-A/OAI-U` | `B-P/NO`: mostly deferred. |
| A10 | Usage/rate-limit/quota | usage/rate snapshots | Do not infer missing as zero | token usage, rate-limit event | budget/status | `OAI-A` via app-server/profile; direct needs probe | `B-P`: direct usage deltas captured; full quota UI not finished. |

### B. Request, stream, and response ontology

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| B1 | Provider-neutral turn request | StartTurn, input, instructions | request fields gated by evidence | request manifest | deterministic request law | `OAI-A` request fields | `B-R/B-F`: direct live text manifests; tool manifolds built. |
| B2 | Assistant text streaming | message/output text deltas | final text requires terminal event | normalized message_delta/completed | live transcript | `OAI-A` | `B-R` for direct text. |
| B3 | Function/custom tool-call intent | ToolCall | intent only, not authority | call id/type/args evidence | agentic loop | `OAI-A` | `B-F`: read/patch/command authority modules; real tool loops pending. |
| B4 | Tool-output continuation | ToolOutput item | only after local authority/result | output item + previous response proof | complete tool loops | `OAI-A/OAI-U` exact direct shape needs probe | `B-F`: local fixture/support; real-provider pending. |
| B5 | `store=false` stateless posture | request.store | must be explicit | manifest proof | privacy/ZDR alignment | `OAI-A` | `B-R` text; built in manifests. |
| B6 | `previous_response_id` continuity | Continuity handle | only when source proof exists; instructions resent | previous response id source digest | efficient tool continuations | `OAI-A` | `B-F`: allowed for tool continuations, not text-only; real loops pending. |
| B7 | Full stateless context continuation | Local context pack | harness owns context | context pack + manifest | ZDR-compatible multi-turn | `OAI-A` supported concept; Codex uses it | `B-R` text-only recent-dialogue under stated baseline. |
| B8 | Reasoning summaries/encrypted reasoning | ResponseItem.reasoning | raw reasoning not renderer/context by default | omitted counts / encrypted opaque items | latent continuity/debug | `OAI-A/OAI-U` | `B-P`: profile/normalizer awareness; raw reasoning blocked. |
| B9 | Unknown event handling | Unknown event | fail closed or diagnostic only | raw type evidence key | drift detection | LOCAL with OAI event substrate | `B-R/B-F`: normalizer + profile deltas. |

### C. Local canonical storage, projections, and context composition

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| C1 | Direct session store | Session/thread/turn | app-private, append-safe | session/turn artifacts | restart/recovery | LOCAL | `B-R/B-F`: DirectSessionStore exists. |
| C2 | Canonical rollout/event log | Rollout events | never rewrite what happened | event digests/seq | audit/rebuild | LOCAL | `B-P/B-F`: thread store + events; not fully ideal manifest law. |
| C3 | SQLite projection store | projections/items | rebuildable, not canonical | source digest, validity | renderer/context/read models | LOCAL | `B-F`: implemented thread store/projections. |
| C4 | Renderer transcript projection | renderer_transcript@1 | no raw reasoning/paths/secrets | projection digest | safe display | LOCAL | `B-F`: implemented. |
| C5 | Context recent-dialogue projection | context_recent_dialogue@1 | valid projection only | context projection digest | multi-turn text | LOCAL | `B-R` under stated green baseline; code present. |
| C6 | Context packs | DirectContextPack | app-private; not raw request body | pack hash/policy/source refs | exact context evidence | LOCAL + OAI request substrate | `B-F/B-R`: implemented for text; tool paths partial. |
| C7 | Request manifests | DirectRequestManifest | request body not persisted | shape hash, evidence refs | request audit | LOCAL | `B-F/B-R`: implemented for text; tool paths partial. |
| C8 | Provider-input projection | role/input mapping hash | no raw body | input shape/text hash | proves serialization | LOCAL | `B-F`: present in context-pack path. |
| C9 | Prompt/current user artifact | current user prompt | redacted/capped | prompt hash | idempotency/context | LOCAL | `B-F`: headless/direct turn paths. |
| C10 | Prompt-cache policy | prompt_cache_key | stable prefix only | cache key evidence | latency/cost | `OAI-A` | `NO/B-P`: not yet normal direct feature. |
| C11 | Context budget accounting | token budget/model window | fail closed over budget | usage/model context evidence | avoid truncation failures | `OAI-A` usage/model; harness computes | `B-P`: caps exist; ideal budget not complete. |
| C12 | Compaction | compaction item/summary | derived, policy-bound | compaction artifact | long contexts | `OAI-A/OAI-U` | `S/B-P`: profile/doc only; not implemented as direct lane normal path. |

### D. Workspace, files, patches, commands

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| D1 | WSL/local workspace truth | WorkspaceBinding | backend owns canonical root | workspace evidence key | file/command authority | LOCAL | `B-R/B-F`: WSL backend exists from v1.1; direct tools route through it. |
| D2 | Work tree/file preview | WorkTree/FilePreview | read-only UI | backend read/list evidence | control-plane utility | LOCAL | `B-R`: baseline shell feature. |
| D3 | `read_file` tool loop | read obligation/result | approval per read; no auto-read | action token, result artifact | inspect repo | OAI emits function calls; LOCAL executes | `B-F`: authority module; real-provider pending. |
| D4 | Multi-step read loop | read loop steps | each read separately approved | step/loop chain evidence | actual inspection loop | OAI emits repeated calls; LOCAL executes | `S/B-F`: spec/code partial? real-provider pending. |
| D5 | Patch planning/dry-run | PatchPlan | preview != commit | parser/dry-run evidence | safe write prep | OAI emits patch call; LOCAL plans | `B-F`: patch authority module present. |
| D6 | Patch apply/journal | PatchApplyResult | human approval; backend/journal write | before/after evidence | implementation mutation | LOCAL | `B-F`: module present; real-provider pending; delete/revert likely not production. |
| D7 | Command execution | CommandPlan/Result | human approval; shell=false; caps | command result artifact | verify/test | LOCAL, model can request | `B-F`: package-script-focused module present; real-provider pending. |
| D8 | Workspace effect scan | WorkspaceEffectSummary | no claim if unsupported | pre/post diff/status | know local changes | LOCAL | `S/B-P`: planned; command module not ideal-complete. |
| D9 | Revert/rollback of workspace changes | RevertPlan | separate approval/policy | patch journal/effect records | safety recovery | LOCAL | `NO/S`: explicitly deferred. |
| D10 | Shell/network/browser/MCP execution | tool obligations | high-risk, separate policy | separate evidence gates | broader agent powers | OAI can emit/gate calls; LOCAL authority | `NO`: intentionally blocked/deferred. |

### E. Runtime tiers and UI control

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| E1 | App-server tier | app-server runtime | baseline/default | app-server events | stable fallback | `OAI-A` app-server | `B-R`. |
| E2 | Direct text-only tier | direct text runtime | no tools; no continuity | live evidence | useful direct chat | OAI direct endpoint | `B-R` per stated baseline. |
| E3 | Direct text-only multi-turn | recent dialogue | local quoted evidence, no previous_response_id | context projection/manifest | real chat loop | OAI supports stateless full input | `B-R` per stated baseline. |
| E4 | Direct implementation lane | implementation tier | requires read/patch/command gates | tool evidence | Codex-like work | OAI emits tool calls; LOCAL authority | `B-F/S`: local modules; real provider gap. |
| E5 | Runtime selection/rollback | project binding | atomic, no active-turn rollback | audit record | safe UX | LOCAL | `B-F`: project activation/runtime status code. |
| E6 | Approval cards | read/patch/command cards | renderer hints only; main authoritative | action tokens/digests | human control | LOCAL | `B-F`: tool authority + UI scaffolding likely partial. |
| E7 | Degraded-state UI | blockers/status | never hide risk | blocker codes | user recovery | LOCAL | `B-F`: runtime status has blockers; ideal not complete. |

### F. Imports, thread graph, workbench, and derived views

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| F1 | Codex JSONL import | ImportedSession | evidence only, not provider continuity | validation report | migration/history | LOCAL; app-server source | `B-F`: import controller present. |
| F2 | Import checkpoint continuation | fresh direct session from checkpoint | no imported provider id/approval replay | seed/context/manifest | resume from history safely | OAI text inference only | `B-F`: checkpoint continuation module. |
| F3 | Import UX/status | imports tab/status | renderer-safe only | projections/report | usability | LOCAL | `B-F`: import controller; UI not fully verified. |
| F4 | Thread graph/workbench | graph edges/lifecycle | projection/control only | operation ledger | manage sessions | LOCAL | `B-F`: thread-workbench controller present. |
| F5 | Merge/prune/fork previews | derived projections | non-runnable previews | source refs/digests | organize context | LOCAL | `B-F/S`: specs and controller support; real UX unknown. |
| F6 | Start fresh fork from preview | new direct session | no provider continuity | seed/context/manifest | branch work | OAI text inference | `S/B-P`: specs; implementation uncertain. |
| F7 | ChatGPT thread refs | external ref | no transcript import/mutation | binding id/evidence key | dual-partner workflow | N/A | `B-R` thread deck for shell; direct store refs partial. |

### G. Evidence, profile, testing, safety

| # | Capability | O | D | E | U | OAI support | Current branch |
|---:|---|---|---|---|---|---|---|
| G1 | ODEU profile schema/report | provider profile | controls require accepted evidence | schema/profile artifacts | capability gating | OAI profile is observed/imported | `B-R`: profile-v0 + report scripts. |
| G2 | Live probe evidence | runtime_probed witness | exact scope only | evidence store/index | unlock direct fields | OAI direct endpoint | `B-R` for text evidence under stated baseline. |
| G3 | Evidence promotion states | candidate/runtime_probed/expired/etc | no over-promotion | evidence status | safe rollout | LOCAL | `B-R/B-F`: evidence store. |
| G4 | Fixture smoke | fixture harness | not real-provider proof | smoke reports | fast regression | LOCAL | `B-R`: direct:smoke. |
| G5 | Headless real-turn harness | appserver/direct runs | live opt-in; redacted reports | reports | real validation | OAI/app-server/direct | `B-R`: current baseline for text. |
| G6 | Real implementation-lane harness | real read/patch/command loops | no new authority; prove existing loops | real reports | confidence gap closure | OAI emits tool calls; LOCAL executes | `NO/S`: proposed immediate next. |
| G7 | Raw-exposure scanner | redaction | block unsafe reports | scan results | privacy | LOCAL | `B-R/B-F`: redaction modules and report scans. |
| G8 | Idempotency/no-retry | client ids and state machines | no duplicate side effects | run ids/step ids/journals | crash safety | LOCAL | `B-R` text; `B-F/S` tools. |
| G9 | Recovery/replay safety | recover interrupted states | never auto-retry after side-effect | state classifications | durability | LOCAL | `B-P/S`: major next after real loops. |
| G10 | Usage ledger | neutral usage evidence | no semantic overclaiming | app-server/usage rows | cost/context/activity | app-server/usage events | `main-branch spec`; not direct core yet. |

---

## Ideal harness checklist by ODEU axis

### Ontology checklist

- [x] Account/auth identity objects.
- [x] Provider profile and direct ODEU profile.
- [x] Model descriptor / model evidence concept.
- [x] Direct session/thread/turn objects.
- [x] Normalized event ontology.
- [x] Response item/message/tool-call ontology.
- [x] Renderer transcript projection.
- [x] Context projection/context pack/request manifest objects.
- [x] Tool obligation objects for read/patch/command.
- [x] Import/checkpoint objects.
- [x] Thread graph/workbench objects.
- [ ] Mature compaction/memory objects.
- [ ] Mature quota/context-budget/cost objects for direct path.
- [ ] Mature workspace-effect/revert objects.

### Deontic checklist

- [x] Renderer never gets raw auth tokens.
- [x] Provider tool calls are requests, not authority.
- [x] Direct text-only cannot execute tools.
- [x] Implementation lane separates read/patch/command authority.
- [x] Explicit live-call opt-in in headless path.
- [x] `store=false` / local stateless context posture represented.
- [x] App-server remains fallback/default, not silently replaced.
- [ ] Real-provider read loop approval proven.
- [ ] Real-provider patch approval and journaled apply proven.
- [ ] Real-provider command approval and workspace effect scan proven.
- [ ] Crash/restart replay safety for all tool states proven.
- [ ] Revert/rollback authority defined.
- [ ] Network/MCP/browser authority intentionally deferred.

### Epistemic checklist

- [x] Imported baseline ODEU profile.
- [x] Runtime-probed direct text evidence.
- [x] Fixture smoke coverage.
- [x] Real headless text-only first/follow-up baseline per current stated status.
- [x] Raw-exposure report scans.
- [ ] Real-provider implementation-lane evidence for read/patch/command.
- [ ] Direct model catalog/live quota evidence.
- [ ] Tool-loop evidence split by function/custom output and parent response source.
- [ ] Workspace-effect evidence after command/patch.
- [ ] Compaction correctness evidence.

### Utility checklist

- [x] Text-only direct chat loop useful enough for manual dialogue.
- [x] App-server baseline remains usable.
- [x] Headless regression path exists.
- [x] Project/thread control plane remains separate from ChatGPT review pane.
- [ ] Implementation lane feels like Codex only after real read/patch/command loops.
- [ ] Recovery UX for interrupted tool states.
- [ ] Project policy controls for commands/paths/caps.
- [ ] Context compaction for long-running direct sessions.
- [ ] Runtime quota/context/budget chips grounded in provider evidence.

---

## Descent from ideal to current branch

### Current validated baseline

Based on the current stated baseline and repo contents, the direct branch has reached:

```text
app-server baseline: real green
live probe evidence: real green
direct text-only first turn: real green
direct recent-dialogue follow-up: real green
opt-in guard: green
idempotency: green
raw-exposure scan: green
```

### Current local-but-not-real-provider implementation-lane state

The repo contains local authority modules for:

```text
read_file
apply_patch
run_command
```

and supporting projection/context/manifest/thread-store infrastructure. The missing confidence is not design; it is real-provider proof that the model emits the expected tool calls and the harness completes the cycles safely.

### Immediate next ODEU work item

The next work item should be a **Real Implementation-Lane Harness**, not more authority:

```text
1. real read_file approval loop
2. real multi-step read_file loop
3. real apply_patch approval loop against disposable workspace
4. real run_command approval loop against disposable workspace
5. command workspace-effect scan
```

Acceptance should mean:

```text
The harness can complete real provider tool-call cycles under current authority modules.
```

It should not mean:

```text
direct is production
tools are generally enabled
auto-approval exists
write/shell/network authority is broad
app-server can be removed
```

## Recommended near-term roadmap anchored in the matrix

1. **Real implementation-lane harness**: prove existing read/patch/command paths with live provider traffic.
2. **Recovery and replay safety**: restart/reload tests for every wait/side-effect state.
3. **Iterative repair loop**: bounded read → patch → command → next patch/read/command, with caps and per-step approval.
4. **Workspace change authority**: effect scans, generated/vendor policy, patch journals, local-changed-but-model-not-informed status.
5. **UI parity for proven flows**: tier selector, approval cards, operation history, degraded states, no guessing.
6. **Project policy configuration**: allowed command classes, sensitive paths, caps, model/evidence status.
7. **Mainline readiness**: app-server default preserved; direct behind flag; docs/migration/regression checklist.
