# ChatGPT Codex ODEU Profile Extraction Spec

Status: root implementation spec for extracting the server-side capability
profile that the direct ChatGPT/Codex harness is allowed to expose.

Related specs:

- [CHATGPT_CODEX_DIRECT_PATH_SPEC.md](./CHATGPT_CODEX_DIRECT_PATH_SPEC.md)
- [WORKFLOW_TRANSITION_GRAPH_SPEC.md](./WORKFLOW_TRANSITION_GRAPH_SPEC.md)
- [CODEX_INTERNAL_KNOBS_ODEU_MAP.md](./CODEX_INTERNAL_KNOBS_ODEU_MAP.md)

## Purpose

The direct harness must be built from the server-side ODEU profile, not from a
clone of Codex CLI, Pi, or any other harness.

The ODEU profile answers:

```text
What does this ChatGPT/Codex subscription path actually support,
how do we know,
what authority boundaries apply,
and what user utility can safely be exposed?
```

This profile is the logical root for direct-harness functionality. UX controls,
tool routing, session replay, compaction, imports, and analytics should only
become first-class features after the relevant capability is observed, probed,
normalized, and accepted into the profile.

## Worktree Strategy

This line of work should live in a separate long-lived worktree:

```text
/home/rose/work/LexLattice/codex-review-shell-direct
```

Recommended branch:

```text
codex/direct-chatgpt-harness
```

`/home/rose/work/LexLattice/codex-review-shell` remains the current mainline
Codex CLI/app-server UX path. The direct branch can periodically absorb mainline
UX improvements, but it should not become default until the ODEU profile,
direct auth, direct model call, tool loop, and import gates pass.

## Reference Specimens

Reference specimens are evidence sources, not architecture owners.

Initial local sources:

| Source | Local path | Useful evidence |
| --- | --- | --- |
| Pi OpenAI Codex OAuth | `/home/rose/work/pi-mono/packages/ai/src/utils/oauth/openai-codex.ts` | OAuth parameters, callback/manual paste shape, token refresh, account id claim. |
| Pi Codex Responses provider | `/home/rose/work/pi-mono/packages/ai/src/providers/openai-codex-responses.ts` | Endpoint, headers, SSE/WebSocket parsing, cache-affinity identifiers, event mapping, retry/error behavior. |
| Pi Codex tests | `/home/rose/work/pi-mono/packages/ai/test/openai-codex-stream.test.ts` | Expected stream behavior, cache-affinity checks, terminal status mapping. |
| Pi model metadata | `/home/rose/work/pi-mono/packages/ai/src/models.generated.ts` | Observed model ids and coarse capability flags. |
| Codex CLI fork | `/home/rose/work/codex/fork` | Highest-signal upstream drift oracle for official harness behavior. |

Extraction rule:

```text
specimen observation -> probe hypothesis -> local fixture/probe -> ODEU delta
```

Do not copy implementation unless a separate license review and attribution
decision explicitly allows it. Prefer re-expressing behavior as local probes,
normalizers, and profile deltas.

## Profile Shape

The profile is versioned and evidence-backed.

```ts
type DirectCodexOdeuProfile = {
  profileVersion: number;
  backendContractVersion: string;
  observedAt: string;
  source: "fixture" | "live-probe" | "imported-baseline";
  transport: "sse" | "websocket";

  ontology: {
    models: DirectModelCapability[];
    requestFields: ProfileFieldEvidence[];
    responseEventTypes: ProfileFieldEvidence[];
    reasoningShapes: ProfileFieldEvidence[];
    toolCallShapes: ProfileFieldEvidence[];
    continuationShapes: ProfileFieldEvidence[];
    importSourceShapes: ProfileFieldEvidence[];
  };

  deontics: {
    authRequirements: ProfileFieldEvidence[];
    tokenStorageRules: string[];
    workspaceAuthorityRules: string[];
    approvalRequiredFor: string[];
    blockedBehaviors: string[];
  };

  epistemics: {
    evidenceSources: ProfileEvidenceSource[];
    confidenceByCapability: Record<string, "observed" | "probed" | "accepted" | "unstable" | "rejected">;
    unknowns: string[];
    driftWatch: string[];
  };

  utility: {
    latency: ProfileMetricEvidence[];
    usageFields: ProfileFieldEvidence[];
    retryBehavior: ProfileFieldEvidence[];
    degradationModes: string[];
  };
};
```

The implementation can refine names, but it must preserve the four ODEU axes:
ontology, deontics, epistemics, utility.

## Capability Acceptance States

Every capability moves through explicit states.

| State | Meaning |
| --- | --- |
| `observed` | Seen in a specimen or raw backend event, not yet trusted. |
| `probed` | Exercised by a local controlled probe or fixture. |
| `accepted` | Stable enough to gate a harness feature. |
| `unstable` | Exists but cannot be exposed without fallback or warning. |
| `rejected` | Observed but not lawful for this harness. |

UX rule:

```text
Only accepted capabilities become normal user-facing controls.
Unstable capabilities may appear only as diagnostics or lab toggles.
Rejected capabilities must not be exposed.
```

## Probe Lifecycle

Each probe has the same lifecycle:

1. `hypothesis`: what capability or shape is being tested.
2. `fixture`: redacted raw request/stream evidence or a live-probe plan.
3. `normalization`: conversion into local direct-harness events.
4. `profile_delta`: proposed ODEU profile change.
5. `acceptance`: accepted, unstable, rejected, or needs more evidence.

Minimum probes:

- OAuth authorization URL construction.
- OAuth callback and manual paste parsing.
- Token refresh and account id extraction.
- Plain text SSE turn.
- Reasoning-summary SSE turn.
- Tool-call request shape.
- Tool-result continuation shape.
- Abort behavior.
- Terminal status mapping.
- Retryable rate/server failure mapping.
- Prompt-cache/session-affinity identifiers.
- WebSocket parity only after SSE baseline is accepted.

## Fixture And Storage Layout

Recommended direct-branch layout:

```text
src/main/direct/
  auth/
  transport/
  normalizer/
  odeu-profile/
  import/

test/fixtures/direct-codex/
  raw/
  normalized/
  profile-deltas/

docs/direct-codex/
  profile-baseline.md
  specimen-map.md
```

Raw fixture files must be redacted before commit.

Required redactions:

- bearer tokens;
- refresh tokens;
- authorization codes;
- account ids unless replaced by stable local placeholders;
- private prompts;
- private workspace paths;
- tool outputs containing local source content unless explicitly fixture-safe;
- cookies or browser-derived headers.

## Normalized Event Contract

All backend events must normalize before ADEU code sees them.

Minimum normalized event classes:

```text
session_started
message_delta
reasoning_delta
tool_call_started
tool_call_delta
tool_call_completed
usage_delta
response_completed
response_incomplete
response_failed
transport_error
auth_error
quota_error
aborted
```

The event normalizer must retain enough source metadata to audit the mapping,
but ADEU session code must not branch on raw backend event names.

## Thread Import Profile

Import capability is part of the profile because imported threads define what
state can be continued lawfully.

Each source harness needs a source ontology:

```text
source identity
thread id
session file path
timestamp model
message roles
reasoning representation
tool-call representation
tool-result representation
approval representation
file-change representation
error representation
compaction representation
```

Initial import target:

```text
Codex CLI/app-server JSONL -> normalized evidence graph -> ADEU session candidate
```

Import acceptance gates:

- role boundaries preserved;
- user-visible text preserved;
- final assistant messages separated from reasoning/tool process;
- tool calls and results paired where possible;
- unpaired obligations marked unresolved;
- source timestamps retained;
- source harness and file path retained;
- no imported tool call is auto-replayed;
- session is read-only until a direct-harness checkpoint is generated.

## Reporting

The profile extractor should produce a human-readable report before any direct
feature is made default.

Minimum report sections:

- accepted capabilities;
- unstable capabilities;
- rejected capabilities;
- unknowns;
- specimen observations used;
- probes executed;
- raw fixture ids;
- normalized event ids;
- security redactions applied;
- recommended UX affordances;
- blocked UX affordances.

## First Implementation Slice

The first code slice should not perform live OAuth or live model calls.

Implement:

- profile schema types;
- fixture redaction helpers;
- fixture loader;
- raw-to-normalized event normalizer for stored fixtures;
- profile-delta builder;
- baseline report generator;
- import ontology skeleton for Codex CLI/app-server JSONL.

Only after this exists should live auth and live transport be added.
