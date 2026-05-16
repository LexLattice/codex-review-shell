# Direct Context Management Recursive ODEU - Phase C

Status: Phase C terminalization artifact. This document converts the Phase B
branch tree into terminal leaves and E-probe witness targets. It is not an
implementation plan and does not prescribe code changes.

Related:

- [DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md](./DIRECT_RECURSIVE_ODEU_BUILD_META_PROGRAM.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_A.md)
- [DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_B.md](./DIRECT_CONTEXT_MANAGEMENT_RECURSIVE_ODEU_PHASE_B.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md](./DIRECT_CONTEXT_MAINTENANCE_MEMORY_FRONTIER_BATON_SPEC.md)
- [CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md](./CODEX_DIRECT_HARNESS_ODEU_MATRIX_v0_2.md)

## Purpose

Phase C answers:

```text
Which context-management branches are terminal?
What exact law does each terminal leaf claim?
What would count as evidence that the leaf exists in actual behavior?
Which leaves are Direct-only, vanilla-sibling parity, intentionally out of
scope, or still product decisions?
```

This is the step before building a probe suite. Phase C chooses the terminal
claims and evidence shape; Phase D should turn them into executable E-probes.

## Terminalization Rules

A terminal leaf is closed only when all of these are true:

```text
1. The leaf has one behavior sentence that can be falsified.
2. The leaf names the artifact or runtime surface where behavior appears.
3. The leaf names the authority class behind the claim.
4. The leaf names a witness type that could prove or disprove it.
5. The leaf does not rely on a broader sibling behavior unless explicitly
   classified as vanilla/app-server parity.
```

Closure classes:

```text
closed_by_direct_law:
  Required by Direct matrix/spec law; implementation and probes must conform.

closed_by_current_direct_code:
  Observed in current Direct code; still needs regression witness if important.

closed_by_vanilla_sibling_profile:
  App-server/Codex CLI behavior that informs compatibility, not Direct law.

open_requires_probe:
  Theory is clear but actual behavior must be observed.

open_requires_product_decision:
  Multiple lawful branches remain; choose product posture before probes.

intentionally_out_of_scope:
  Valid general concept but not part of the current Direct context-management
  phase.

diagnostic_only:
  May be shown or reported but cannot authorize provider input, local action,
  runtime switch, or capability promotion.
```

Probe witness families:

```text
E-CM-ARTIFACT:
  read persisted Direct artifacts and verify ids, digests, refs, flags, and
  state transitions.

E-CM-HEADLESS:
  run a Direct headless scenario and inspect generated artifacts/status.

E-CM-UI:
  inspect renderer-safe projections, status rows, and operation history.

E-CM-RECOVERY:
  simulate missing/corrupt/interrupted artifacts and observe recovery state.

E-CM-VANILLA:
  observe app-server/Codex CLI sibling behavior as compatibility evidence.

E-CM-LIVE:
  exercise an explicitly opted-in live Direct provider request shape.

E-CM-RAW:
  run raw-exposure scans over artifacts, reports, renderer state, and summaries.
```

## Phase C Terminal Leaf Ledger

### C-CM-1 Canonical Truth And Projection

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-1.1 | Canonical conversation truth is source session/thread artifact truth, not renderer transcript text. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-1.2 | A renderer transcript projection can become stale without mutating canonical truth. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-1.3 | A context-safe projection must cite source projection ids/digests and stable item keys before it can feed a context pack. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-1.4 | A stale context-safe projection cannot silently feed a new provider request as exact current context. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-1.5 | Empty or small recent-dialogue selection is explicit context state, not projection failure. | open_requires_probe | E-CM-HEADLESS |
| C-CM-1.6 | App-server ThreadItems are vanilla sibling canonical/status surfaces, not Direct canonical artifacts. | closed_by_vanilla_sibling_profile | E-CM-VANILLA |

Phase D probe pressure:

```text
Build, stale, and empty-selection cases should be distinct. A failed
empty-selection case is theory evidence, not a request to add one-off padding.
```

### C-CM-2 Context Pack And Request Manifest

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-2.1 | A Direct context pack is provider-neutral logical input, not a provider request body. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-2.2 | A Direct request manifest records request-shape authorization separately from context material. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-2.3 | Provider input projection records shape/text hashes but does not store raw provider request body. | closed_by_direct_law | E-CM-RAW |
| C-CM-2.4 | Context pack must be persisted before request manifest; manifest must be persisted before provider transport. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-2.5 | Missing required source refs block request construction or downgrade to an explicit degraded state; they cannot be omitted silently. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-2.6 | Governance/status/diagnostic refs may be cited by digest without mutating provider input text in phases where they are diagnostic only. | closed_by_direct_law | E-CM-ARTIFACT |

Phase D probe pressure:

```text
The manifest sequence probe should test crash/recovery boundaries, not only
happy-path artifact presence.
```

### C-CM-3 Provider Continuity

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-3.1 | Quoted recent dialogue in a fresh Direct request does not imply provider previous-response continuity. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-3.2 | Imported checkpoint evidence never grants provider continuity. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-3.3 | Fresh fork seed evidence never reuses source provider response ids. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-3.4 | Native previous_response_id continuity is exact request-shape evidence only; missing proof blocks or marks unsupported. | open_requires_probe | E-CM-LIVE |
| C-CM-3.5 | App-server-owned continuity is valid for the app-server path but cannot promote Direct continuity evidence. | closed_by_vanilla_sibling_profile | E-CM-VANILLA |
| C-CM-3.6 | Provider compact output, when present, is not durable memory and not provider continuity unless a separate continuity proof exists. | closed_by_direct_law | E-CM-ARTIFACT |

Phase D probe pressure:

```text
Continuity probes must inspect request controls, not only visible model output.
Provider behavior that appears conversational is not continuity proof.
```

### C-CM-4 Context Pressure And Route Selection

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-4.1 | Context pressure estimate is diagnostic input, not permission to trim. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-4.2 | Pressure estimate must account for hidden required refs such as policy, tool results, workspace effects, memory, baton, and omission summaries. | open_requires_probe | E-CM-HEADLESS |
| C-CM-4.3 | Unknown pressure cannot automatically authorize trim, compaction, or memory refresh. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-4.4 | Route decisions are idempotent by route input digest, policy digest, and selector version. | open_requires_probe | E-CM-ARTIFACT |
| C-CM-4.5 | Maintenance route blocks during active local action, pending obligation, handoff unknown, corrupt ledger, or renderer-only truth. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-4.6 | App-server automatic compaction is sibling behavior; it does not prove Direct automatic compaction. | closed_by_vanilla_sibling_profile | E-CM-VANILLA |

Phase D probe pressure:

```text
Route probes should include blocked cases. A no-op/healthy happy path does not
prove fail-closed context maintenance.
```

### C-CM-5 Trim And Omission Truth

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-5.1 | A raw-window trim plan must exist before a trim can be applied. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-5.2 | Required artifact classes at risk block trim rather than becoming omitted context. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-5.3 | Every omitted source item must have an omission ledger entry with source/count/reason evidence. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-5.4 | Context pack omitted counts must equal omission ledger totals for the same denominator. | open_requires_probe | E-CM-HEADLESS |
| C-CM-5.5 | Omitted material is not hidden context and is not deleted canonical history. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-5.6 | Vanilla contextCompaction item is not an omission ledger. | closed_by_vanilla_sibling_profile | E-CM-VANILLA |

Phase D probe pressure:

```text
Omission parity is a core correctness surface. If parity fails, repair the
theory of denominators before patching count arithmetic.
```

### C-CM-6 Durable Memory

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-6.1 | Durable memory is context evidence, not current system/developer policy. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-6.2 | Memory entries must carry authority, contextUse, source refs, confidence, staleness, and conflict state. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-6.3 | Memory conflicting with current user intent or workspace evidence is omitted, stale, or marked current-evidence-wins. | open_requires_probe | E-CM-HEADLESS |
| C-CM-6.4 | Failed, blocked, or corrupt memory refresh attempts cannot replace the current memory pointer. | closed_by_direct_law | E-CM-RECOVERY |
| C-CM-6.5 | No renderer IPC may directly author memory entries in the current Direct law. | closed_by_direct_law | E-CM-RAW |
| C-CM-6.6 | Vanilla memoryMode/reset are sibling memory controls, not Direct memory editor semantics. | closed_by_vanilla_sibling_profile | E-CM-VANILLA |

Phase D probe pressure:

```text
Memory probes should test conflict and pointer law, not only valid memory
serialization.
```

### C-CM-7 Memory Refresh

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-7.1 | A memory refresh manifest is distinct from memory entry content. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-7.2 | Memory refresh source refs must be current, digest-verified, and not renderer-DOM-only. | closed_by_direct_law | E-CM-HEADLESS |
| C-CM-7.3 | Local deterministic memory refresh may run only through the maintenance route and pointer law. | open_requires_probe | E-CM-HEADLESS |
| C-CM-7.4 | Local model/provider text memory refresh is diagnostic unless it has its own context pack, request manifest, raw-exposure scan, and report posture. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-7.5 | Provider compact primitive output cannot be directly converted into durable memory text. | closed_by_direct_law | E-CM-ARTIFACT |

Phase D probe pressure:

```text
Refresh probes need interruption cases. Completed-only probes miss the pointer
law that matters.
```

### C-CM-8 Frontier Baton

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-8.1 | Frontier baton summarizes task frontier and refs; it is not canonical transcript. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-8.2 | Baton carries replayAuthority=false, approvalAuthority=false, and continuationAuthority=false. | closed_by_direct_law | E-CM-ARTIFACT |
| C-CM-8.3 | Required baton missing, stale, or superseded blocks only the route/context build that requires it. | open_requires_probe | E-CM-HEADLESS |
| C-CM-8.4 | Stale or superseded baton is never provider-visible context; required stale baton blocks, optional stale baton is omitted. | open_requires_probe | E-CM-RECOVERY |
| C-CM-8.5 | Vanilla active-turn/status concepts do not imply an explicit baton artifact. | closed_by_vanilla_sibling_profile | E-CM-VANILLA |

Phase D probe pressure:

```text
Baton probes should include authority-negative assertions. A correct summary
with authority flags missing is not closed.
```

### C-CM-9 Maintenance Status And UI Posture

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-9.1 | Maintenance status is display-only and cannot become chat transcript content. | closed_by_direct_law | E-CM-UI |
| C-CM-9.2 | Status projections include generation/source digests and are stale-rejectable. | closed_by_direct_law | E-CM-UI |
| C-CM-9.3 | Operation history rows are read-only and actionability=false. | closed_by_direct_law | E-CM-UI |
| C-CM-9.4 | App-server contextCompaction item should be displayed as app-server path status, not Direct maintenance artifact proof. | open_requires_product_decision | E-CM-VANILLA |
| C-CM-9.5 | Status may explain composer blocked/allowed state but cannot itself authorize composer or provider transport. | closed_by_direct_law | E-CM-UI |

Phase D probe pressure:

```text
UI probes should inspect actionability fields and transcript placement, not just
visible labels.
```

### C-CM-10 Recovery And Integrity

| Leaf | Terminal Law | Closure | Witness |
| --- | --- | --- | --- |
| C-CM-10.1 | Startup recovery classifies context artifacts without rerunning maintenance. | closed_by_direct_law | E-CM-RECOVERY |
| C-CM-10.2 | Missing manifest after context pack is pre-transport recoverable and must not imply provider send. | closed_by_direct_law | E-CM-RECOVERY |
| C-CM-10.3 | Trim plan without omission ledger blocks clean context use. | closed_by_direct_law | E-CM-RECOVERY |
| C-CM-10.4 | Missing required memory/baton/omission refs block request manifests that require them. | closed_by_direct_law | E-CM-RECOVERY |
| C-CM-10.5 | Raw-exposure failure writes or returns only minimal safe blocked status/report. | closed_by_direct_law | E-CM-RAW |
| C-CM-10.6 | Status reads must not silently rebuild context maintenance artifacts. | closed_by_direct_law | E-CM-RECOVERY |

Phase D probe pressure:

```text
Recovery probes should assert no provider transport, app-server mutation,
workspace read, patch apply, command run, or hidden rebuild occurred.
```

## Coverage Adequacy Map

Minimum Phase D probe families needed for adequate theory coverage:

```text
P-CM-1 Projection source and staleness:
  valid projection, stale source, empty selection, raw exposure blocked.

P-CM-2 Context pack / manifest sequence:
  pack only, manifest only impossible, manifest before send, raw request not
  stored, missing required refs.

P-CM-3 Continuity:
  fresh quoted recent dialogue, imported checkpoint, fresh fork seed,
  unsupported previous_response_id proof, app-server path distinction.

P-CM-4 Pressure and route:
  within budget no-op, unknown pressure, over budget local trim, required
  artifact at risk, active obligation blocked.

P-CM-5 Omission parity:
  no omission, optional omission represented, required omission blocked,
  ledger totals mismatch.

P-CM-6 Durable memory:
  valid memory entry, conflict with current user intent, conflict with
  workspace evidence, failed refresh current retained, raw exposure blocked.

P-CM-7 Frontier baton:
  optional baton, required baton present, required baton missing, required
  stale/superseded baton, optional stale/superseded baton, authority-negative
  fields.

P-CM-8 Status and UI:
  status display-only, not chat transcript, stale projection rejection,
  actionability=false.

P-CM-9 Recovery:
  route planned no manifest, trim plan no ledger, missing ledger, corrupt
  memory, stale baton, provider handoff unknown, raw exposure.

P-CM-10 Vanilla sibling parity:
  app-server contextCompaction lifecycle, thread/memoryMode/set, memory/reset,
  fork/rollback shape, with all results marked sibling evidence.
```

Coverage is inadequate if it contains only happy paths. Each high-risk law must
have at least one negative or blocked witness.

## Product Decisions Still Open

These are not probe problems yet:

```text
D-CM-1 Direct compact action:
  Should Direct expose a manual compact action, or keep compaction behind
  app-server fallback and future maintenance routing?

D-CM-2 Direct memory eligibility:
  Should Direct add a project/thread memory eligibility setting analogous to
  vanilla thread/memoryMode/set?

D-CM-3 Direct memory reset:
  Should Direct expose reset as app-private maintenance, app-server sibling
  action only, or no UI action?

D-CM-4 First automatic maintenance behavior:
  Should the first live Direct behavior be status-only, manual local trim,
  automatic pre-request local trim, or provider compact diagnostic only?

D-CM-5 App-server compaction status display:
  Should app-server contextCompaction appear in the shared runtime status lane,
  operation history only, or a separate app-server-path status surface?
```

Phase D should avoid generating implementation probes that assume answers to
these product decisions.

## Phase C Stop Point

Phase C closes the theory into terminal leaves and probe families. The next
phase is Phase D:

```text
E-probe design
probe fixture design
oracle/witness definition
current implementation coverage map
gap classification
```

Do not implement from Phase C directly. If a Phase D probe fails, treat the
failure first as evidence about context-management theory, not as a patch list.
