# Direct Context Management Recursive ODEU - Phase D

Status: Phase D E-probe design artifact. This document turns Phase C terminal
leaves into concrete probe rows and a first-pass current coverage map. It is
not the probe implementation and not an implementation plan.

Related:

- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_B.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_B.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_C.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)

## Purpose

Phase D answers:

```text
Which E-probes should exist?
What terminal law does each probe witness?
What scenario should it exercise?
What artifacts or status surfaces should it inspect?
What negative authority claims must it assert?
Which probes are already covered, partial, missing, vanilla-only, or live-gated?
```

This phase is deliberately one step before code. A probe failure should first
be interpreted as a possible theory or witness-design failure, not as a patch
list.

## Probe Row Shape

Each probe row should eventually become executable with this shape:

```yaml
probeId: stable id
terminalLeaves: Phase C leaves witnessed
sourceClass:
  - direct_fixture
  - direct_headless
  - direct_ui
  - direct_recovery
  - direct_live_gated
  - vanilla_sibling
setup: fixture or real scenario
action: operation performed
witness: artifacts/status/reports inspected
expected: exact positive observation
negativeAssertions: authority/raw-exposure/non-mutation observations
failureMeaning: theory-level interpretation
coverageStatus:
  - covered_existing_smoke
  - covered_existing_fixture
  - partial_existing
  - missing_probe
  - live_gated
  - vanilla_probe_needed
  - product_decision_needed
```

Core negative assertions reused across probes:

```text
no provider transport unless probe is explicitly live-gated;
no app-server mutation unless probe is explicitly vanilla sibling mutation;
no workspace read/patch/command;
no right-pane ChatGPT mutation;
no handoff mutation;
no hidden rebuild on status read;
no raw request body stored;
no raw prompt/assistant output in reports unless the probe is a bounded
  renderer/content projection test with raw-exposure scan passing.
```

## Current Coverage Sources

Existing coverage discovered during Phase D drafting:

```text
scripts/direct-codex-smoke.mjs:
  renderer transcript projection;
  context recent-dialogue projection;
  empty-context pack;
  recent-dialogue context pack;
  request manifest;
  provider input projection boundaries;
  compact projection unsafe for context build;
  fresh-context tool continuation;
  fork/preview context-pack boundaries.

scripts/direct-context-maintenance-regression.mjs:
  context pressure estimates;
  route selection;
  required artifact at risk block;
  active obligation and handoff unknown blocks;
  provider compaction missing evidence block;
  trim plan;
  omission ledger;
  omission parity for fixture context pack;
  durable memory;
  memory refresh failed current retained;
  frontier baton;
  maintenance status projection display-only fields;
  raw-exposure scan and minimal safe failure posture.
```

Coverage interpretation:

```text
existing smoke coverage proves current local fixture behavior only;
existing fixture maintenance coverage proves schema/law behavior only;
neither proves live provider compact primitive;
neither proves vanilla app-server parity unless explicitly run against app-server;
neither settles product decisions around manual compact, memory mode/reset, or
automatic maintenance.
```

## E-Probe Matrix

### P-CM-1 Projection Source And Staleness

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-PROJ-001 | C-CM-1.1, C-CM-1.2 | direct_headless | Build a session, renderer projection, then inspect canonical session artifacts. | Projection has source refs; canonical artifacts remain unchanged by projection build. | covered_existing_smoke |
| E-CM-PROJ-002 | C-CM-1.3 | direct_headless | Build context_recent_dialogue from renderer projection. | Projection cites renderer projection id/digest and stable source item keys. | covered_existing_smoke |
| E-CM-PROJ-003 | C-CM-1.4 | direct_recovery | Change or invalidate source renderer projection after context projection build, then attempt context build. | Context build blocks or marks stale; no provider transport. | partial_existing |
| E-CM-PROJ-004 | C-CM-1.5 | direct_headless | Build a text turn with no selected recent dialogue. | Empty-context policy and explicit empty context pack, not error. | covered_existing_smoke |
| E-CM-PROJ-005 | C-CM-1.2, C-CM-9.2 | direct_headless | Rebuild unchanged renderer projection. | Current pointer reuses or updates deterministically; stale generation is detectable. | partial_existing |
| E-CM-PROJ-006 | C-CM-1.6 | vanilla_sibling | Observe app-server thread/read or turns/list output. | ThreadItems are app-server status/canonical surfaces and are marked sibling evidence only. | vanilla_probe_needed |

Failure meaning:

```text
Projection failures usually indicate the source/projection theory is wrong.
Do not patch by copying renderer text into context without source refs.
```

### P-CM-2 Context Pack And Request Manifest

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-PACK-001 | C-CM-2.1 | direct_headless | Build recent-dialogue context pack. | `direct_context_pack@1` has policy, source refs, caps, current intent, rawRequestBodyExposed=false. | covered_existing_smoke |
| E-CM-PACK-002 | C-CM-2.2 | direct_headless | Build request manifest from pack. | `direct_request_manifest@1` records request shape and enabled features separately. | covered_existing_smoke |
| E-CM-PACK-003 | C-CM-2.3 | direct_headless + raw | Inspect provider input projection and manifest. | Shape/text hashes present; raw request body stored=false; raw scan passes. | covered_existing_smoke |
| E-CM-PACK-004 | C-CM-2.4 | direct_recovery | Simulate crash after pack write and before manifest write. | Recovery sees pack-only pre-transport state; no send inferred. | missing_probe |
| E-CM-PACK-005 | C-CM-2.5 | direct_headless | Remove required maintenance ref before manifest build. | Build blocks or explicit degraded state; missing ref not silently omitted. | partial_existing |
| E-CM-PACK-006 | C-CM-2.6 | direct_headless | Add diagnostic governance/status refs and compare provider input text/hash. | Refs cited by digest; PR-diagnostic refs do not mutate provider input text. | partial_existing |

Negative assertions:

```text
no raw provider request body persisted;
no provider transport before durable context pack and manifest;
no diagnostic/status ref becomes provider instruction authority by accident.
```

### P-CM-3 Provider Continuity

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-CONT-001 | C-CM-3.1 | direct_headless | Build follow-up recent-dialogue text turn. | Manifest has previousResponseIdUsed=false; prompt quotes history as evidence. | covered_existing_smoke |
| E-CM-CONT-002 | C-CM-3.2 | direct_headless | Build imported checkpoint continuation context. | Imported evidence flags deny provider continuity. | partial_existing |
| E-CM-CONT-003 | C-CM-3.3 | direct_headless | Start fresh fork from preview fixture. | New request has no source previous_response_id; seed/context/manifest are fresh. | covered_existing_smoke |
| E-CM-CONT-004 | C-CM-3.4 | direct_live_gated | Exercise native previous_response_id only when exact evidence exists. | Exact request-shape proof or unsupported/block state; no inference from output quality. | live_gated |
| E-CM-CONT-005 | C-CM-3.5 | vanilla_sibling | Observe app-server resume/turn continuity. | Valid app-server continuity evidence remains tagged vanilla sibling. | vanilla_probe_needed |
| E-CM-CONT-006 | C-CM-3.6 | direct_fixture | Feed provider compact-like artifact into maintenance fixture. | It is opaque/compact evidence, not durable memory or continuity proof. | partial_existing |

Failure meaning:

```text
Continuity probe failures should trigger a theory audit around request controls.
Conversational output similarity is not evidence.
```

### P-CM-4 Context Pressure And Route Selection

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-ROUTE-001 | C-CM-4.1 | direct_fixture | Build within-budget pressure estimate and route. | Route no_op or estimate-only; no trim permission implied. | covered_existing_fixture |
| E-CM-ROUTE-002 | C-CM-4.2 | direct_fixture | Build pressure with visible and hidden required refs. | total estimate includes hidden required tokens and requiredRefsAccountedFor=true. | covered_existing_fixture |
| E-CM-ROUTE-003 | C-CM-4.3 | direct_fixture | Set pressureState=unknown and trimRequested=true. | Route blocked with pressure_unknown_over_budget_risk. | covered_existing_fixture |
| E-CM-ROUTE-004 | C-CM-4.4 | direct_fixture | Select route twice with same canonical input. | Same inputDigest/route digest or explicitly linked repeated attempt. | partial_existing |
| E-CM-ROUTE-005 | C-CM-4.5 | direct_fixture | Select maintenance during active obligation. | Blocked route; no context pack/provider/workspace action. | covered_existing_fixture |
| E-CM-ROUTE-006 | C-CM-4.5 | direct_fixture | Select maintenance with handoff unknown or corrupt ledger. | Blocked route with stable blocker code. | partial_existing |
| E-CM-ROUTE-007 | C-CM-4.6 | vanilla_sibling | Observe app-server automatic/manual compaction. | Marked app-server compaction proof, not Direct automatic compaction proof. | vanilla_probe_needed |

Negative assertions:

```text
route selection never calls provider transport;
route selection never mutates workspace or app-server;
unknown pressure never authorizes trim.
```

### P-CM-5 Trim And Omission Truth

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-OMIT-001 | C-CM-5.1 | direct_fixture | Build local trim route and trim plan. | `raw_window_trim_plan@1` exists before ledger. | covered_existing_fixture |
| E-CM-OMIT-002 | C-CM-5.2 | direct_fixture | Candidate omission includes required artifact class. | Omission ledger build blocks with required-artifact blocker. | covered_existing_fixture |
| E-CM-OMIT-003 | C-CM-5.3 | direct_fixture | Build omission ledger from optional omissions. | Each entry has source kind/id/digest/count/reason/rawTextIncluded=false. | covered_existing_fixture |
| E-CM-OMIT-004 | C-CM-5.4 | direct_fixture | Build context pack using omission ledger. | Context pack omitted counts match ledger totals. | covered_existing_fixture |
| E-CM-OMIT-005 | C-CM-5.4 | direct_fixture_negative | Corrupt ledger total or context count. | Report validation or parity assertion fails closed. | missing_probe |
| E-CM-OMIT-006 | C-CM-5.5 | direct_artifact | Inspect canonical source after trim fixture. | Omitted source is still referenced and not deleted canonical history. | partial_existing |
| E-CM-OMIT-007 | C-CM-5.6 | vanilla_sibling | Observe app-server contextCompaction item. | Item has compaction status, not structured omission ledger. | vanilla_probe_needed |

Failure meaning:

```text
Omission failures usually mean the denominator is underspecified. Repair the
denominator theory before changing count code.
```

### P-CM-6 Durable Memory

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-MEM-001 | C-CM-6.1, C-CM-6.2 | direct_fixture | Build durable memory with one decision entry. | Entry has authority/contextUse/sourceRefs/confidence/staleness/conflict fields; not policy. | covered_existing_fixture |
| E-CM-MEM-002 | C-CM-6.3 | direct_fixture | Build memory conflicting with current user intent. | Memory omitted, stale, or conflictResolution=current_evidence_wins. | missing_probe |
| E-CM-MEM-003 | C-CM-6.3 | direct_fixture | Build memory conflicting with workspace evidence. | Memory not included as current fact; explicit conflict state. | implemented_phase_i |
| E-CM-MEM-004 | C-CM-6.4 | direct_recovery | Simulate failed memory refresh. | Current memory pointer retained; recovery state says failed_current_retained. | covered_existing_fixture |
| E-CM-MEM-005 | C-CM-6.5 | direct_raw | Search IPC/status/report surfaces for memory authoring endpoint. | No renderer input path directly creates/updates/deletes memory entries. | partial_existing |
| E-CM-MEM-006 | C-CM-6.6 | vanilla_sibling | Exercise or inspect thread/memoryMode/set and memory/reset. | Marked vanilla sibling controls; no Direct editor semantics inferred. | vanilla_probe_needed |

Negative assertions:

```text
memory entry text is not system/developer policy;
renderer cannot author memory entries;
failed refresh does not replace current memory.
```

### P-CM-7 Memory Refresh

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-REFRESH-001 | C-CM-7.1 | direct_fixture | Build refresh manifest and memory artifact. | Manifest ids differ from memory ids and cite source/current/next state. | covered_existing_fixture |
| E-CM-REFRESH-002 | C-CM-7.2 | direct_fixture | Build refresh with stale or renderer-DOM-only source ref. | Refresh blocks or records source_stale/source_digest_mismatch. | implemented_phase_i |
| E-CM-REFRESH-003 | C-CM-7.3 | direct_headless | Request local deterministic refresh through route. | Route/manifest/pointer law observed; no renderer direct authoring. | implemented_phase_i |
| E-CM-REFRESH-004 | C-CM-7.4 | direct_artifact | Attempt local_model_text/provider_text_summary without required request artifacts. | Diagnostic/block state; no promotion. | missing_probe |
| E-CM-REFRESH-005 | C-CM-7.5 | direct_fixture | Provide provider compact primitive output. | Stored/cited as compact item only; not durable memory text. | partial_existing |

Failure meaning:

```text
Refresh failures should be clustered by source freshness, pointer law, and
provider/model-output authority rather than treated as serialization defects.
```

### P-CM-8 Frontier Baton

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-BATON-001 | C-CM-8.1, C-CM-8.2 | direct_fixture | Build baton with frontier state and refs. | Baton has source refs and authority false fields. | covered_existing_fixture |
| E-CM-BATON-002 | C-CM-8.3 | direct_fixture | Require baton but omit baton ref from context refs. | Context/ref validation blocks with required baton missing. | covered_existing_fixture |
| E-CM-BATON-003 | C-CM-8.3 | direct_fixture | Baton missing when route does not require it. | No global block; no provider-visible baton context is created. | implemented_second_loop |
| E-CM-BATON-004 | C-CM-8.4 | direct_recovery | Supersede baton and then attempt to include old baton. | Required stale/superseded baton blocks with `required_baton_stale`; optional stale/superseded baton is omitted from provider-visible context. | implemented_phase_g |
| E-CM-BATON-005 | C-CM-8.5 | vanilla_sibling | Inspect app-server active turn/status concepts. | No explicit baton artifact inferred from vanilla status. | vanilla_probe_needed |

Negative assertions:

```text
baton cannot approve, replay, continue, or create provider continuity;
baton cannot become primary transcript content.
```

### P-CM-9 Status And UI Posture

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-STATUS-001 | C-CM-9.1 | direct_ui | Render or inspect maintenance status projection. | Status item type is non-chat/status; not user/assistant transcript. | partial_existing |
| E-CM-STATUS-002 | C-CM-9.2 | direct_ui | Submit action/read against stale projection generation. | Stale state rejected or refreshed; no execution retry. | implemented_phase_j |
| E-CM-STATUS-003 | C-CM-9.3 | direct_ui | Inspect operation history rows for maintenance. | actionability.actionable=false, allowedActions=[]. | partial_existing |
| E-CM-STATUS-004 | C-CM-9.4 | vanilla_sibling + product | Observe app-server contextCompaction status and desired Direct display placement. | Display-only sibling status recorded without Direct artifact promotion. | implemented_phase_k |
| E-CM-STATUS-005 | C-CM-9.5 | direct_ui | Status says composer blocked/allowed. | Runtime/controller authority is separate; status alone cannot send provider request. | implemented_phase_j |

Negative assertions:

```text
status reads do not rebuild maintenance artifacts;
status display does not mutate runtime tier, provider transport, or app-server.
```

### P-CM-10 Recovery And Integrity

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-REC-001 | C-CM-10.1 | direct_recovery | Startup with healthy maintenance artifacts. | Recovery classifies healthy without rerunning maintenance. | partial_existing |
| E-CM-REC-002 | C-CM-10.2 | direct_recovery | Pack exists, manifest missing. | Pre-transport recoverable/degraded state; no provider send inferred. | implemented_second_loop |
| E-CM-REC-003 | C-CM-10.3 | direct_recovery | Trim plan exists, omission ledger missing. | Clean context use blocked; recovery state identifies missing ledger. | implemented_second_loop |
| E-CM-REC-004 | C-CM-10.4 | direct_recovery | Required memory/baton/omission refs missing. | Request manifest build blocks with stable missing-ref code. | partial_existing |
| E-CM-REC-005 | C-CM-10.5 | direct_raw | Inject raw exposure into report/status candidate. | Minimal safe blocked report/status; no unsafe artifact current pointer. | covered_existing_fixture |
| E-CM-REC-006 | C-CM-10.6 | direct_recovery | Read status for stale/missing artifacts. | Read reports stale/missing/corrupt; no hidden rebuild. | implemented_second_loop |

Sentinel expectations:

```text
providerTransportCalls=0;
appServerMutationCalls=0;
workspaceReadCalls=0;
patchApplyCalls=0;
commandRunCalls=0;
rightPaneMutationCalls=0;
handoffMutationCalls=0.
```

### P-CM-11 Vanilla Sibling Context Management

| Probe | Leaves | Source | Setup / Action | Expected Witness | Coverage |
| --- | --- | --- | --- | --- | --- |
| E-CM-VAN-001 | C-CM-1.6, C-CM-3.5 | vanilla_sibling | Start/read/resume app-server thread. | Thread continuity and ThreadItems observed as app-server-owned. | implemented_phase_k |
| E-CM-VAN-002 | C-CM-4.6, C-CM-5.6 | vanilla_sibling | Trigger thread/compact/start. | contextCompaction started/completed item lifecycle. | implemented_phase_k |
| E-CM-VAN-003 | C-CM-6.6 | vanilla_sibling | Set thread memory mode. | Memory eligibility setting changes app-server state only. | implemented_phase_k |
| E-CM-VAN-004 | C-CM-6.6 | vanilla_sibling | Run memory reset in isolated CODEX_HOME. | Memory artifacts reset while Direct memory artifacts are not inferred. | implemented_phase_k |
| E-CM-VAN-005 | C-CM-9.4 | vanilla_sibling + product | Feed contextCompaction sibling evidence into Direct status design. | Display decision captured without Direct artifact promotion. | implemented_phase_k |

Vanilla probe rule:

```text
Vanilla probes compare conceptual instantiation. They are not reference-oracle
tests for Direct unless a specific parity law is added.
```

## Gap Classification

Current high-value missing probes:

```text
none in the current local/fixture context-management E-probe matrix.
```

Likely implementation gaps versus missing-probe gaps:

```text
missing_probe_only:
  none in the current local/fixture context-management E-probe matrix.

possible_implementation_gap:
  none from the current local E-probe slice.

product_decision_needed:
  none for the next status-only implementation slice; Phase L records the
  current posture. Future execution controls require new discriminator rows.

live_gated:
  native previous_response_id proof;
  provider compact primitive proof.
```

## Phase D Adequacy Criteria

Before moving to Phase E probe implementation, this matrix is adequate only if:

```text
every Phase C terminal leaf has at least one probe row;
every high-risk law has a negative or blocked probe;
every vanilla sibling row is explicitly sibling-scoped;
every live-provider row is opt-in gated;
every current coverage claim names the existing script family;
every missing probe has a theory-level failure meaning;
product decisions are separated from probe construction.
```

Current adequacy status:

```text
terminal leaf coverage: complete at design level
negative probe coverage: incomplete but identified
vanilla sibling probe coverage: missing
live provider probe coverage: intentionally gated
current implementation coverage map: first pass complete
ready for Phase E probe implementation: not yet; review product-decision rows
  first
```

## Phase D Stop Point

Phase D defines the probe map. The next phase is Phase E:

```text
choose first probe slice
implement probes without changing behavior
run existing coverage to establish baseline
run new probes
cluster failures by theory miss
repair theory or implementation only after clustering
```

Do not implement all missing probes at once. Start with the highest-risk slice:

```text
pack/manifest recovery
stale projection
omission parity negative
memory conflict
baton supersession
required stale baton blocking
optional stale baton omission
```
