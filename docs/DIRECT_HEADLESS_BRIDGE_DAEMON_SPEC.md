# Direct Headless Bridge Daemon Spec

Status: design draft for a future direct information-bridge wave.

Related docs:

- [DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md](./DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md)
- [DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md](./DIRECT_INFORMATION_BRIDGE_WAVE_ROADMAP.md)
- [DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md](./DIRECT_HEADLESS_RUNTIME_PARITY_HARNESS_SPEC.md)
- [DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md](./DIRECT_THREAD_LOG_AND_PROJECTION_STORE_SPEC.md)
- [DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md](./DIRECT_CONTEXT_POLICY_AND_PACK_SPEC.md)
- [DIRECT_USAGE_QUOTA_MODEL_EVIDENCE_AND_MAINLINE_READINESS_SPEC.md](./DIRECT_USAGE_QUOTA_MODEL_EVIDENCE_AND_MAINLINE_READINESS_SPEC.md)

## Purpose

Build a long-lived local service that can operate the direct information bridge
without opening the Electron frontend.

The daemon is not merely a headless prompt sender. It is a governed transport
and routing layer for typed information events:

```text
external component
  -> typed event envelope
  -> ingress validation
  -> WorkThread / route resolution
  -> context and authority gate
  -> Codex/direct turn or other bridge endpoint
  -> structured result
  -> egress routing
  -> optional human decision loop
```

The motivating example is a deterministic trading pipeline:

```text
crypto signal engine
  -> emits predefined JSON event
  -> linked headless Codex thread processes it
  -> Codex output is reduced to a structured decision packet
  -> packet routes to a user channel with allowed choices
  -> user reply routes back into the same bridge thread
  -> downstream action is handled by predefined rules
```

The same architecture should later support build pipelines, monitoring alerts,
benchmark harnesses, review bots, research workflows, and workspace-specific
UX panels.

## Core Invariants

```text
headless daemon != frontend bypass
event accepted != action authorized
JSON schema valid != route authorized
Codex output != downstream command
external event != operator message unless declared
route selection != WorkThread truth
egress delivery != human approval
route configuration != low-authority preference
free-text human note != expanded authority
```

The daemon exists to preserve the information bridge laws when no frontend is
open. It must reuse the same WorkThread, context, authority, runtime metadata,
usage facts, and persistence organs as the GUI path.

## Boundary

This daemon does:

- run as a long-lived local process;
- expose local-only ingress APIs for typed event envelopes;
- persist an inbox/outbox/event log;
- resolve events to configured WorkThreads and route bindings;
- build direct context packs and request manifests;
- start governed direct Codex turns when a route allows it;
- record runtime analytics facts and usage evidence;
- emit structured result artifacts;
- route results to configured egress adapters;
- support human-in-the-loop decision packets;
- allow the Electron UI to attach later and inspect the same daemon state.

It does not:

- grant arbitrary local network access;
- place trades, run commands, apply patches, or mutate workspaces by itself;
- treat a JSON event as user approval;
- make Codex output executable without a route-specific reducer and authority
  gate;
- expose raw auth tokens, raw provider payloads, raw local paths, or raw trading
  account identifiers;
- replace the app-server lane;
- require the Electron frontend to be open;
- force all external integrations to speak natural language.

## Relation To Existing Headless Scripts

Existing one-shot scripts:

```text
scripts/codex-real-turn.mjs
scripts/direct-codex-real-turn.mjs
```

These are useful for explicit real-turn smoke/probe runs. They start, run one
request, write a redacted report, and exit.

The daemon is different:

```text
one-shot script:
  manual test/probe runner

headless daemon:
  persistent bridge service, inbox/outbox, route store, event loop
```

The daemon may reuse script internals where appropriate, but it must not be a
thin loop around the one-shot CLI. It needs durable message identity, route
state, backpressure, auth/session reuse, and observable lifecycle.

## Example: Trading Signal Event

A deterministic crypto pipeline may publish an event like:

```json
{
  "schema": "trading_signal_event@1",
  "eventId": "sig_20260615_btc_breakout_001",
  "sourceSystem": "venustrade.signal-engine",
  "eventClass": "alert",
  "strategyId": "btc_breakout_v4",
  "symbol": "BTCUSDT",
  "timeframe": "15m",
  "eventKind": "signal_triggered",
  "observedAt": "2026-06-15T09:15:00Z",
  "factSourcePosture": "client_declared",
  "payloadRef": {
    "kind": "local_artifact",
    "evidenceKey": "artifact:signal_snapshot:abc123"
  },
  "facts": {
    "signal": "breakout",
    "confidence": 0.78,
    "volatilityRegime": "high",
    "riskBand": "yellow"
  },
  "requestedBridgeRoute": "trading.signal.codex-review",
  "requestedRouteVersion": "route_v3",
  "idempotencyKey": "venustrade:btc_breakout_v4:20260615T091500Z"
}
```

The daemon does not infer that this is an operator instruction. It validates
the event against an allowlisted ingress contract and resolves it to a route:

```text
route: trading.signal.codex-review
  routeVersion: route_v3
  workThreadId: wt_venustrade_signal_review
  codexThreadId: direct_session_trading_signal_review
  model: route default
  context policy: trading_signal_event_review@1
  output reducer: trading_signal_decision_packet@1
  egress: user_decision_channel + audit log
```

Codex may produce a structured result:

```json
{
  "schema": "trading_signal_decision_packet@1",
  "eventId": "sig_20260615_btc_breakout_001",
  "verdict": "needs_human_decision",
  "summary": "Breakout signal is plausible but volatility is high.",
  "choices": [
    { "choiceId": "observe", "label": "Observe only" },
    { "choiceId": "paper_trade", "label": "Paper trade" },
    { "choiceId": "dismiss", "label": "Dismiss signal" }
  ],
  "recommendedChoiceId": "observe",
  "riskNotesRef": {
    "kind": "bridge_artifact",
    "evidenceKey": "artifact:risk_notes:def456"
  }
}
```

The daemon then routes this to an egress adapter. A user reply is not free text
authority; it is a typed decision event:

```json
{
  "schema": "human_decision_reply@1",
  "decisionId": "dec_sig_20260615_btc_breakout_001",
  "choiceId": "observe",
  "operatorEvidenceKey": "operator:rose:local-session",
  "eventClass": "operator_reply",
  "receivedAt": "2026-06-15T09:18:00Z"
}
```

Any real trading/order action remains outside v0 and must be a separate
authority-bearing integration. This daemon can transport and audit decision
information; it must not become an implicit trading executor.

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| `DirectBridgeDaemon` | support artifact | build | long-lived local process lifecycle |
| `BridgeClientRegistry` | support artifact | build | allowed clients, scopes, credentials, rate limits |
| `BridgeIngressContract` | support artifact | build | event schemas, validation, raw-exposure policy |
| `BridgeEventEnvelope` | support artifact | build | idempotent typed event identity |
| `BridgeRouteBinding` | support artifact | build | source event kind to WorkThread/thread/action route |
| `BridgeRouteGovernanceRecord` | support artifact | build | route versioning, authorization, rollback posture |
| `BridgeEventLifecycleWitness` | support artifact | build | phase transitions and replay safety |
| `BridgeInboxStore` | support artifact | build | durable accepted/blocked event log |
| `BridgeOutboxStore` | support artifact | build | durable egress action queue |
| `BridgeRouteResolver` | support artifact | align/build | WorkThread and route eligibility |
| `HeadlessTurnPacket` | support artifact | align/build | direct Codex request intent from validated event |
| `StructuredOutputReducer` | support artifact | build | Codex output to route-specific result schema |
| `ReducedResult` | support artifact | build | reducer output with source/context/route provenance |
| `HumanDecisionPacket` | support artifact | build | bounded human choice request/reply |
| `InterruptionPolicy` | support artifact | build | egress priority, quiet hours, escalation, staleness |
| `BridgeDeliveryReceipt` | support artifact | build | egress delivery state and retry evidence |
| `BridgeDaemonStatusProjection` | surface artifact | build | renderer/CLI-safe daemon health |

## Object Model

```ts
type BridgeDaemonInstance = {
  schema: "bridge_daemon_instance@1";
  daemonId: string;
  profileId: string;
  startedAt: string;
  state: "starting" | "ready" | "degraded" | "stopping" | "failed";
  listenMode: "loopback_http" | "unix_socket" | "windows_named_pipe" | "stdio";
  listenLabel: string;
  directRuntimePath: "direct-text" | "direct-implementation" | "app-server";
  rawEndpointExposedToRenderer: false;
};

type BridgeClientRegistration = {
  schema: "bridge_client_registration@1";
  clientId: string;
  displayLabel: string;
  clientKind:
    | "local_pipeline"
    | "cli"
    | "automation"
    | "electron_ui"
    | "workspace_app"
    | "unknown";
  allowedIngressContracts: string[];
  allowedRoutes: string[];
  authMode: "capability_token" | "signed_request" | "stdio_parent" | "disabled";
  rateLimitPolicyRef?: string;
  status: "active" | "paused" | "revoked";
};

type BridgeEventEnvelope = {
  schema: "bridge_event_envelope@1";
  envelopeId: string;
  idempotencyKey: string;
  processingIdentity: string;
  clientId: string;
  sourceSystem: string;
  eventSchema: string;
  eventClass:
    | "observation"
    | "alert"
    | "external_request"
    | "operator_reply"
    | "scheduler_tick"
    | "artifact_available"
    | "diagnostic";
  eventKind: string;
  factSourcePosture:
    | "client_declared"
    | "pipeline_verified"
    | "daemon_verified"
    | "model_inferred"
    | "operator_confirmed";
  lifecycle:
    | "received"
    | "blocked_ingress"
    | "accepted_inbox"
    | "route_blocked"
    | "route_resolved"
    | "queued_for_turn"
    | "provider_request_started"
    | "provider_completed"
    | "reducer_failed"
    | "result_reduced"
    | "egress_queued"
    | "egress_sent"
    | "human_decision_pending"
    | "human_reply_received"
    | "closed"
    | "failed_replay_unsafe";
  receivedAt: string;
  declaredWorkThreadId?: string;
  requestedRouteId?: string;
  routeVersion?: string;
  payloadDigest: string;
  payloadStorageRef?: EvidenceRef;
  rawPayloadIncluded: false;
  evidenceRefs: EvidenceRef[];
};

type BridgeRouteBinding = {
  schema: "bridge_route_binding@1";
  routeId: string;
  routeVersion: string;
  status: "active" | "paused" | "disabled";
  ingressContractRef: string;
  workThreadId: string;
  targetKind: "codex_direct_thread" | "codex_appserver_thread" | "human_channel" | "local_artifact_only";
  targetThreadRef?: {
    runtimePath: "direct-text" | "direct-implementation" | "app-server";
    threadId: string;
  };
  contextPolicyRef: string;
  modelPolicyRef?: string;
  outputReducerRef?: string;
  egressPolicyRefs: string[];
  interruptionPolicyRef?: string;
  authorityBoundaryRef: string;
  toolAuthorityMode:
    | "disabled"
    | "read_only"
    | "patch_allowed"
    | "command_allowed";
  dependencyBundle: {
    ingressContractRef: string;
    contextPolicyRef: string;
    modelPolicyRef?: string;
    outputReducerRef?: string;
    egressPolicyRefs: string[];
    interruptionPolicyRef?: string;
    authorityBoundaryRef: string;
    toolAuthorityMode: string;
  };
  routeDigest: string;
};

type BridgeRouteGovernanceRecord = {
  schema: "bridge_route_governance_record@1";
  routeId: string;
  oldRouteVersion?: string;
  newRouteVersion: string;
  oldRouteDigest?: string;
  newRouteDigest: string;
  authorizingOperatorEvidenceKey: string;
  migrationReason: string;
  affectedClientIds: string[];
  affectedIngressContractRefs: string[];
  activatedAt: string;
  rollbackPosture: "rollback_available" | "manual_repair_required" | "not_reversible";
};

type HeadlessTurnPacket = {
  schema: "headless_turn_packet@1";
  packetId: string;
  envelopeId: string;
  routeId: string;
  routeVersion: string;
  workThreadId: string;
  targetThreadId: string;
  contextBuildId: string;
  requestManifestId: string;
  model: string;
  reasoningEffort?: string;
  serviceTier?: string;
  turnIntent:
    | "event_review"
    | "decision_support"
    | "artifact_review"
    | "operator_reply"
    | "diagnostic";
  inferenceWitness: {
    providerProfileId: string;
    directRuntimeVersion: string;
    contextPolicyRef: string;
    authorityBoundaryRef: string;
    requestManifestId: string;
    routeVersion: string;
    outputReducerRef?: string;
  };
  rawEventPayloadIncluded: false;
};

type BridgeEgressAction = {
  schema: "bridge_egress_action@1";
  actionId: string;
  envelopeId: string;
  routeId: string;
  actionKind:
    | "write_artifact"
    | "notify_user"
    | "request_human_decision"
    | "send_structured_reply"
    | "no_action";
  destinationRef: EvidenceRef;
  payloadDigest: string;
  status: "queued" | "sent" | "failed" | "blocked" | "expired";
  retryPolicyRef?: string;
};

type InterruptionPolicy = {
  schema: "bridge_interruption_policy@1";
  policyId: string;
  priority: "log_only" | "notify_passive" | "ask_when_available" | "interrupt_now";
  quietHoursPolicyRef?: string;
  maxInterruptionsPerWindow?: number;
  supersessionKeyTemplate?: string;
  supersessionPolicy?: "latest_wins" | "keep_all" | "collapse_until_human_seen";
  escalationChannelOrder: string[];
  staleAfter?: string;
};
```

## Local API Surface

V0 should prefer a local-only API with one canonical envelope:

```text
POST /v1/bridge/events
GET  /v1/bridge/events/:envelopeId
GET  /v1/bridge/routes
GET  /v1/bridge/status
GET  /v1/bridge/threads/:threadId/status
POST /v1/bridge/human-decisions/:decisionId/replies
GET  /v1/bridge/stream   # SSE or WebSocket for status/event updates
```

Alternative transports may be added behind the same semantic contract:

```text
loopback HTTP
Unix socket
Windows named pipe
stdio parent process
```

The API protocol is not the authority boundary. The authority boundary is the
combination of client registration, route binding, WorkThread resolution,
context manifest, runtime evidence, and action gate.

## Lifecycle Law

Every accepted or blocked event must have a stored lifecycle phase. The daemon
must not hold meaningful bridge state only in memory.

```text
No daemon event without a phase.
No phase transition without a stored transition witness.
No restart replay without a replay-safe phase.
```

Allowed lifecycle phases:

```text
received
blocked_ingress
accepted_inbox
route_blocked
route_resolved
queued_for_turn
provider_request_started
provider_completed
reducer_failed
result_reduced
egress_queued
egress_sent
human_decision_pending
human_reply_received
closed
failed_replay_unsafe
```

Replay rules:

- `received` without `accepted_inbox` may be safely ignored or revalidated.
- `accepted_inbox` may be routed if no provider request has started.
- `queued_for_turn` may resume only if its processing identity is unchanged.
- `provider_request_started` without terminal provider evidence becomes
  `failed_replay_unsafe` unless the provider exposes an exact safe resume.
- `result_reduced` may enqueue egress if the outbox row is missing and the
  reducer digest still matches.
- `egress_queued` may retry only under the egress retry policy.

## Event Class Law

The event class determines what kind of semantic claim the event can make:

```ts
type BridgeEventClass =
  | "observation"
  | "alert"
  | "external_request"
  | "operator_reply"
  | "scheduler_tick"
  | "artifact_available"
  | "diagnostic";
```

Rules:

- `observation` may trigger review, summary, or decision-support packets.
- `alert` may trigger interruption policy evaluation.
- `external_request` may request service but grants no authority by itself.
- `operator_reply` may continue a pending decision loop.
- `scheduler_tick` may check state but must not invent new work.
- `artifact_available` may route an artifact reference for review.
- `diagnostic` may be logged and inspected; it does not route to provider unless
  a diagnostic route explicitly allows it.

The daemon must not interpret a typed system event as human/operator will unless
the event class and route binding explicitly declare that posture.

## Fact Authority Law

Facts carried by an ingress event are not automatically daemon-verified facts.
They must declare source posture:

```ts
type FactSourcePosture =
  | "client_declared"
  | "pipeline_verified"
  | "daemon_verified"
  | "model_inferred"
  | "operator_confirmed";
```

For the trading example:

```text
facts.signal = "breakout"
```

means:

```text
the signal pipeline asserted breakout
```

unless a verifier upgrades the posture. Codex may reason over client-declared
facts, but reducers and egress actions must preserve the distinction between
client assertions, daemon verification, model inference, and operator
confirmation.

## Security And Trust Boundary

Default posture:

- bind only to `127.0.0.1` or local socket;
- reject non-loopback traffic;
- require per-client capability token or signed request;
- store tokens only under private app profile state;
- do not expose raw tokens to renderer, logs, reports, or event rows;
- require timestamp/nonce/idempotency replay checks;
- reject unknown event schemas unless a route explicitly allows diagnostic
  capture;
- rate-limit per client and per route;
- use bounded queue sizes;
- never deserialize code or run event-provided handlers;
- preserve raw payloads only behind private evidence refs when configured.

For WSL/Windows:

```text
workspace truth remains WSL-native when the workspace is WSL.
Windows relay paths are transport convenience, not workspace truth.
```

If a Windows component needs to submit an event to a WSL daemon, the relay must
not mint workspace authority or rewrite file paths into authority-bearing
claims.

## Persistence

The daemon should extend the direct store with durable bridge tables:

```text
direct_bridge_clients
direct_bridge_routes
direct_bridge_inbox_events
direct_bridge_lifecycle_events
direct_bridge_route_governance
direct_bridge_route_decisions
direct_bridge_turn_packets
direct_bridge_reduced_results
direct_bridge_outbox_actions
direct_bridge_delivery_receipts
direct_bridge_human_decisions
```

Rules:

- inbox append happens before work starts;
- idempotency key prevents duplicate turns;
- route decisions are persisted as evidence;
- lifecycle transitions are persisted as evidence;
- route versions used for accepted events are frozen on the event record;
- no raw prompt/event/provider payload by default;
- output reducers write structured artifacts with digests/evidence refs;
- egress action state is persisted before delivery attempt;
- retries must be explicit and bounded;
- failed delivery does not erase the Codex turn result;
- daemon restart resumes queued actions only when replay is safe.

The daemon should reuse:

```text
DirectThreadStore
DirectSessionStore
context packs
request manifests
runtime analytics facts
usage ledger rows
WorkThread registry
governance/authority packets
```

## Route Governance Law

Route creation and route edits are authority-bearing governance acts. A route
binding decides which events reach which WorkThread, which model/runtime is
used, which context is included, which reducer is trusted, which egress channels
receive output, and which authority boundary applies.

Route changes require:

```text
route id
old route version
new route version
authorizing operator evidence
migration reason
affected clients/contracts
old route digest
new route digest
route dependency bundle digest
activation time
rollback posture
```

Rules:

- Events already accepted under `routeVersion=N` continue under that route
  version unless an explicit replay/fork record is created.
- The frozen route version includes its dependency bundle:
  `ingressContractRef`, `contextPolicyRef`, `modelPolicyRef`,
  `outputReducerRef`, `egressPolicyRefs`, `interruptionPolicyRef`,
  `authorityBoundaryRef`, and `toolAuthorityMode`.
- Later route edits must not silently alter an event's authority path.
- Disabled routes reject new events but do not erase historical route evidence.
- Route rollback is itself a new route governance record.
- Route bindings are configuration only after they pass governance validation.

## Idempotency And Processing Identity

Event identity and processing identity are distinct:

```text
event identity =
  sourceSystem + eventSchema + business idempotency key

processing identity =
  event identity + routeId + routeVersion + targetThreadId + reducerVersion
```

Rules:

- Same event identity and same processing identity means duplicate; no new turn.
- Same event identity with an explicitly authorized new route version or replay
  id may create a new processing identity.
- A new route version does not retroactively reprocess old events.
- If provider bytes were observed, the same processing identity must never
  auto-rerun.
- Manual replay/fork requires a route governance or operator replay witness.

## Routing Law

Route resolution should proceed in this order:

```text
1. validate client registration
2. validate event schema and raw-exposure policy
3. check idempotency/replay state
4. resolve requested route or candidate routes
5. resolve WorkThread
6. validate route binding and authority boundary
7. build context packet and request manifest
8. start or queue the target turn
9. reduce output to route result
10. enqueue egress action
```

If route resolution is ambiguous:

```text
status = blocked
reason = route_ambiguity
providerRequestStarted = false
```

No fallback to "most recent chat" is allowed.

## Active-Turn Semantics

If a route targets a Codex thread with an active turn, the daemon must choose a
configured active-turn policy:

```ts
type ActiveTurnIngressPolicy =
  | "reject_while_active"
  | "queue_after_active_turn"
  | "steer_active_turn"
  | "route_to_new_thread";
```

The default should be:

```text
queue_after_active_turn
```

`steer_active_turn` requires route-specific proof that steering is safe and
that the target runtime supports it. External events must not silently become
steering messages.

## Interruption Policy

Not every valid event deserves human interruption. Egress routes that reach a
human channel must declare an interruption policy:

```ts
type InterruptionPriority =
  | "log_only"
  | "notify_passive"
  | "ask_when_available"
  | "interrupt_now";
```

Rules:

- `log_only` records the result but does not message the operator.
- `notify_passive` may send a passive notification without requiring a reply.
- `ask_when_available` creates a decision packet but respects quiet hours and
  rate limits.
- `interrupt_now` must be rare, route-scoped, rate-limited, and justified by
  explicit event evidence.
- Supersession/coalescing must be explicit for high-frequency event sources:
  `latest_wins`, `keep_all`, or `collapse_until_human_seen`.
- Quiet hours, escalation order, stale-after policy, and max interruptions per
  window belong in the route/egress policy, not in Codex output.

ODEU split:

```text
O decides which work-world/user context is active.
E decides whether evidence is fresh enough.
D decides which channel is lawful.
U decides whether interruption is worth it.
```

## Output Reduction

Codex natural-language output is not enough for egress automation. Every route
that sends output outside the Codex thread must define an output reducer:

```text
assistant output
  -> structured reducer
  -> schema validation
  -> authority/egress gate
  -> outbox action
```

Reducer modes:

```ts
type OutputReducerMode =
  | "json_contract_required"
  | "markdown_summary_only"
  | "human_review_required"
  | "artifact_only";
```

A reduced result must preserve semantic provenance:

```ts
type ReducedResult = {
  schema: string;
  sourceEnvelopeId: string;
  routeId: string;
  routeVersion: string;
  reducerId: string;
  reducerVersion: string;
  reducerMode: OutputReducerMode;
  sourceOutputDigest: string;
  contextBuildId: string;
  requestManifestId: string;
  inferenceWitness: {
    providerProfileId: string;
    directRuntimeVersion: string;
    model: string;
    reasoningEffort?: string;
    serviceTier?: string;
    authorityBoundaryRef: string;
  };
  evidenceRefs: EvidenceRef[];
  confidence?: number;
  reductionStatus: "valid" | "needs_human_review" | "invalid";
};
```

For the trading example, v0 should use:

```text
json_contract_required or human_review_required
```

No downstream trading/order action should be driven by unconstrained prose.

Reducer laws:

- Reducer validates shape.
- Reducer does not create authority.
- Reducer does not create facts without evidence refs.
- Reducer output must cite the source event, source output digest, context
  build, request manifest, route version, and inference witness.
- Invalid reducer output routes to human review or failure, not egress
  automation.

## Human Decision Loop

The daemon should support a first-class human decision packet:

```ts
type HumanDecisionPacket = {
  schema: "human_decision_packet@1";
  decisionId: string;
  sourceEnvelopeId: string;
  workThreadId: string;
  promptSummary: string;
  choices: Array<{
    choiceId: string;
    label: string;
    description?: string;
    consequenceClass?: "informational" | "local_artifact" | "external_action";
  }>;
  defaultChoiceId?: string;
  expiresAt?: string;
  replyRouteId: string;
};
```

The reply is also a typed event, not arbitrary authority:

```ts
type HumanDecisionReply = {
  schema: "human_decision_reply@1";
  decisionId: string;
  choiceId: string;
  operatorEvidenceKey: string;
  receivedAt: string;
  freeTextNote?: string;
};
```

If a choice has external-action consequences, the daemon must route it to a
separate action-specific authority gate. V0 should keep external actions
disabled unless separately specified.

Free-text rule:

```text
freeTextNote is commentary/evidence only.
It cannot change choiceId, consequenceClass, route, or action authority.
If the free-text note requests a different action, create a new decision packet.
```

In other words:

```text
bounded choice = authority-bearing
free text = non-authority-bearing context
```

## Observability

The daemon must expose renderer/CLI-safe status:

```ts
type BridgeDaemonStatusProjection = {
  schema: "bridge_daemon_status_projection@1";
  daemonState: "ready" | "degraded" | "failed" | "stopped";
  activeRoutes: number;
  queuedInboxEvents: number;
  activeTurns: number;
  queuedEgressActions: number;
  failedEgressActions: number;
  lastEventAt?: string;
  lastErrorClass?: string;
  rawSecretsExposed: false;
  rawPayloadsExposed: false;
};
```

The Electron app should later be able to attach to the daemon and render:

- active routes;
- queued events;
- active turns;
- pending human decisions;
- outbox failures;
- per-route usage/latency facts.

## Failure Modes

| Failure | Required behavior |
| --- | --- |
| Auth missing/expired | Block route, emit `auth_unavailable`, no provider request |
| Model metadata stale | Degrade or block depending route policy |
| Unknown event schema | Reject or diagnostic-capture only |
| Route ambiguity | Block, no provider request |
| WorkThread missing | Block, no provider request |
| Active turn conflict | Apply configured active-turn policy |
| Queue full | Reject with backpressure receipt |
| Provider unavailable | Persist blocked/failed turn packet, no silent fallback |
| Output schema invalid | Route to human review or mark reducer failed |
| Human reply expired | Record `human_reply_expired`, do not apply reply |
| Human reply invalid choice | Record `human_reply_invalid_choice`, ask again or close per policy |
| Human reply duplicate | Record `human_reply_duplicate`, return prior decision state |
| Human reply after decision closed | Record `human_reply_decision_closed`, do not reopen implicitly |
| Egress delivery failed | Preserve result, retry if policy allows |
| Daemon crash | Resume only idempotent inbox/outbox rows |

## Implementation Phases

### Phase 1: Spec And Schema Fixtures

- Define bridge envelope, event lifecycle, route governance, route, inbox,
  outbox, decision, reduced result, and status schemas.
- Add fixture tests for trading-style events.
- Add route-version/idempotency fixtures.
- Add raw-exposure scanner fixtures.
- No daemon process yet.

### Phase 2: Local Daemon Skeleton

- Add `scripts/direct-bridge-daemon.mjs`.
- Bind loopback/local socket only.
- Implement `/status`, `/events`, route validation, idempotency, and inbox
  persistence.
- No provider turns yet.

### Phase 3: Route To Direct Codex Thread

- Reuse direct context packs, request manifests, auth, runtime metadata, and
  direct turn controller.
- Support `queue_after_active_turn`.
- Persist turn packets and analytics facts.

### Phase 4: Output Reducer And Outbox

- Add route-specific reducer contracts.
- Persist outbox actions and delivery receipts.
- Support `write_artifact` and `notify_user` as safe first egress actions.
- Add reducer provenance checks over source output digest, route version,
  context build, request manifest, and inference witness.

### Phase 5: Human Decision Loop

- Add decision packet and reply ingestion.
- Route replies back into the same WorkThread/thread according to route policy.
- Preserve `freeTextNote` as non-authority context only.
- Keep external action execution disabled.

### Phase 6: Electron Attach And Control Surface

- Let the frontend discover/attach to the daemon.
- Render daemon status, queue state, active turns, and pending decisions.
- Add pause/resume route controls and safe drain/shutdown.

## Acceptance Criteria

- The daemon can run without opening Electron.
- All ingress events validate against explicit schemas.
- Every event has a stored lifecycle phase and every phase transition has a
  witness.
- Event class controls whether the event is observation, alert, request,
  operator reply, scheduler tick, artifact availability, or diagnostic.
- No provider request starts for unknown clients, unknown schemas, ambiguous
  routes, missing WorkThreads, missing auth, or blocked authority boundaries.
- Route creation/editing is recorded as route governance with route version,
  operator evidence, route digest, activation time, and rollback posture.
- Route governance freezes the dependency bundle: ingress contract, context
  policy, model policy, reducer, egress policies, interruption policy,
  authority boundary, and tool-authority mode.
- Event facts declare fact-source posture and are not treated as daemon-verified
  unless a verifier upgrades them.
- Event processing freezes the route version used for that event.
- Route-aware idempotency prevents duplicate turns for duplicate processing
  identities.
- The daemon persists inbox, route decision, turn packet, outbox, and delivery
  receipt rows.
- The daemon persists reduced-result rows when output leaves the Codex thread.
- Direct context packs and request manifests are used for Codex turns.
- Headless turn packets include an inference witness over provider profile,
  direct runtime version, model/settings, context policy, authority boundary,
  request manifest, and route version.
- Runtime analytics facts are written for direct turns.
- Raw prompt/event/provider/auth/path payloads are excluded from normal reports.
- Active-turn policy is explicit per route.
- Interruption policy is explicit before any human-channel egress.
- High-frequency alert routes define a supersession/coalescing policy.
- Tool authority mode is explicit per route and defaults to `disabled`.
- Codex prose is not sent to external systems without an output reducer or
  human-review route.
- Human decisions are typed replies with bounded choices.
- Human `freeTextNote` cannot widen authority or change the selected choice.
- Expired, duplicate, invalid-choice, and closed-decision human replies produce
  explicit failure states.
- External trading/order execution is not present in v0.
- The Electron frontend can later attach without becoming the source of daemon
  truth.

## Final Shape

```text
deterministic system event
  -> headless bridge daemon
  -> WorkThread route
  -> direct Codex processing
  -> structured reducer
  -> user decision / artifact / downstream message
  -> persisted evidence and analytics
```

This is the backend form of the unified information bridge. The frontend is one
surface over the bridge, not the bridge itself.
