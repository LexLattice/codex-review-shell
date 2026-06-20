# Direct Wave 18: External Discovery And MCP Resource Read

Status: planning spec for Wave 18.

Primary dependencies:

```text
docs/DIRECT_INFORMATION_BRIDGE_CONSTITUTION.md
docs/DIRECT_ODEU_LIVE_CAPABILITY_KERNEL_WAVE_SPEC.md
docs/DIRECT_TOOL_AUTHORITY_FAMILIES_WAVE_SPEC.md
docs/DIRECT_REMAINING_LIVE_CAPABILITY_PROMOTION_SPEC.md
docs/DIRECT_WAVE17_HUMAN_CONTROL_READONLY_TOOLS_SPEC.md
src/main/direct/external/capability-discovery.js
src/main/direct/external/mcp-boundary.js
src/main/direct/headless/first-tool-slice.js
src/main/direct/bridge/tool-capability-registry.js
```

## Purpose

Wave 18 promotes the first external-capability family into direct-path live
readiness without collapsing discovery, external read, external action, and
plugin mutation into one authority class.

The first usable slice is:

```text
external discovery:
  tool_search
  list_mcp_resources
  list_mcp_resource_templates
  list_available_plugins_to_install as discovery-only posture

read-only external perception:
  read_mcp_resource with server identity, resource identity, size caps,
  redaction, source provenance, and context-admission policy

explicitly deferred:
  dynamic MCP tool calls
  plugin installation
  connector/account/resource mutation
  browser/network action execution
```

Wave 18 is not "turn on MCP." It is the first lawful bridge layer for external
discovery and bounded imported resource reads.

## Core Doctrine

External capabilities are not project truth and not resident authority.

```text
tool_search != tool execution
list_mcp_resources != resource read
read_mcp_resource = external perception, not workspace evidence
MCP dynamic tool call = external action, not Wave 18
plugin list = discovery
plugin install = capability mutation, not Wave 18
external result != context until admitted
context admission != project-state mutation
```

Global invariant:

```text
discovered != declared
declared != approved
read != trusted
imported != project-owned
resource payload != resident context by default
plugin candidate != installable authority
```

Wave 18 consumes the shared ODEU live-capability kernel:

```text
capability row
  -> external source identity witness
  -> promotion decision
  -> activation row
  -> declaration snapshot
  -> per-call authority decision
  -> external result envelope
  -> context admission record
  -> resident/operator witness
  -> usability proof
```

## MCP Server Selection And Identity Law

Wave 18 must not silently choose an MCP server.

Every MCP discovery/read call that can target more than one source must include
an exact server selector:

```ts
type McpServerSelector =
  | { kind: "server_identity_id"; serverIdentityId: string }
  | { kind: "configured_default"; defaultId: string };
```

If more than one MCP server is available and no exact selector/default is
admissible:

```text
blocker = mcp_server_ambiguous
```

Blocker vocabulary:

```text
mcp_server_missing
mcp_server_ambiguous
mcp_server_disabled
mcp_server_identity_stale
mcp_server_auth_unavailable
mcp_server_trust_unknown
```

`McpServerIdentityWitness` is the authority anchor for all MCP discovery/read
operations:

```ts
type McpServerIdentityWitness = {
  schema: "mcp_server_identity_witness@1";
  witnessId: string;
  serverIdentityId: string;
  displayName: string;
  transportKind:
    | "stdio"
    | "http"
    | "sse"
    | "websocket"
    | "connector"
    | "unknown";
  endpointEvidenceKey?: string;
  serverFingerprint?: string;
  serverVersion?: string;
  configuredBy:
    | "project_config"
    | "operator"
    | "runtime_profile"
    | "fixture"
    | "unknown";
  authPosture:
    | "none"
    | "local_only"
    | "credentialed"
    | "oauth"
    | "unknown";
  trustState:
    | "trusted_local"
    | "project_configured"
    | "operator_approved"
    | "external_untrusted"
    | "unknown";
  enabledState:
    | "enabled"
    | "disabled"
    | "degraded"
    | "unknown";
  freshness: "fresh" | "stale" | "unknown";
  evidenceRefs: EvidenceRef[];
  rawEndpointIncluded: false;
  rawCredentialIncluded: false;
};
```

Wave 18 `read_mcp_resource` requires:

```text
serverIdentityId exact
enabledState=enabled
trustState != unknown
freshness=fresh
```

## First Usable Slice

Wave 18 first usable slice:

```text
1. Resident can inspect external discovery posture and know what is available,
   disabled, blocked, or needs setup.
2. Resident can call a bounded discovery tool surface for tool_search and MCP
   list operations when the harness exposes safe provider/tool metadata.
3. Resident can request a read-only MCP resource fetch only when the source
   server identity, resource identity, result caps, and trust posture are known.
4. The harness emits imported-resource evidence with provenance, truncation,
   redaction, and context-admission status.
5. Dynamic MCP actions, plugin install, and connector mutation remain visible
   as unavailable/operator-only with reasons.
```

## Standing Non-Goals

Wave 18 does not implement:

```text
dynamic MCP tool execution
MCP mutating actions
plugin installation
provider-hosted web_search or image_generation
broad browser/network automation
connector account/resource mutation
external result as project truth
external result as workspace evidence without staging/citation
raw external resource payloads in renderer or resident context by default
secret/cookie/auth payload exposure
parallel external tool calls
```

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| ExternalCapabilityProfile | support artifact | build/align | Maps external discovery/read/action/plugin families to lifecycle state and declaration eligibility |
| ExternalSourceIdentityWitness | evidence artifact | build | Names server/provider/source identity, trust state, auth posture, and freshness |
| ExternalCapabilityDescriptor | support artifact | align | Discovery descriptor with schema/source digest, permission class, side-effect class, and enabled state |
| ExternalToolSearchInput | support artifact | build | Bounds discovery families, includeBlocked posture, max results, and laundering prevention |
| ExternalDiscoveryResultEnvelope | evidence artifact | build | Sanitized discovery result with no execution or provider declaration side effect |
| McpServerIdentityWitness | evidence artifact | build | MCP server identity, source, trust, connector/session posture, and schema version |
| McpServerSelector | authority artifact | build | Exact server selection/default witness; prevents accidental cross-source reads |
| McpResourceDescriptor | evidence artifact | build | Resource URI digest/display, template digest, MIME/kind hint, and read eligibility |
| McpResourceIdentity | evidence artifact | build | Normalized/digested resource identity scoped to server identity |
| McpResourceReadEnvelope | authority/evidence artifact | build | Per-call read-only resource fetch result with caps, redaction, truncation, and trust posture |
| ExternalResultContextAdmissionPolicy | authority artifact | build | Decides whether discovery/read result may enter context as summary, excerpt, ref, or blocked |
| DynamicMcpActionBlockedProjection | support artifact | build | Resident-visible blocked/deferred status for dynamic MCP tools |
| PluginInstallBlockedProjection | support artifact | build | Resident-visible operator-only/deferred status for plugin install |
| ExternalToolResidentDeclaration | support artifact | build | Frozen provider-visible declaration snapshot for Wave 18 discovery/read tools only |
| ExternalToolUsabilityProof | proof artifact | build | Positive/negative headless scenarios and resident/operator witness rows |

Existing substrate alignment:

```text
src/main/direct/external/capability-discovery.js
  already models:
    external_capability_descriptor@1
    external_capability_discovery_registry@1
    external_capability_discovery_status_projection@1

src/main/direct/external/mcp-boundary.js
  already models:
    mcp_external_source_provenance@1
    mcp_resource_read_boundary@1
    mcp_dynamic_tool_call_boundary@1
    mcp_resource_tool_boundary_status@1
```

Wave 18 should reuse these schemas when semantically sufficient and introduce
successor schemas only where live declaration/result-admission law needs a
more precise contract.

## Descriptor And Resource Identity Law

Every discovered external capability must declare what kind of object it is and
what execution posture applies in Wave 18:

```ts
type ExternalCapabilityDescriptor = {
  descriptorKind:
    | "discovery_only"
    | "external_resource"
    | "external_action_tool"
    | "plugin_candidate"
    | "provider_hosted_tool";
  executionState:
    | "not_executable_in_wave18"
    | "readable_with_gate"
    | "blocked"
    | "operator_only"
    | "future_wave";
  providerDeclarationGranted: false;
  executionAuthorityGranted: false;
};
```

Discovery should include blocked/deferred rows where relevant so the resident
does not infer absence:

```text
discoverable
readable
callable
installable
blocked
operator_only
deferred
```

MCP resource identity must be normalized and privacy-preserving:

```ts
type McpResourceIdentity = {
  resourceIdentityId: string;
  serverIdentityId: string;
  resourceUriEvidenceKey: string;
  resourceDisplay: string;
  resourceUriDigest: string;
  uriSchemeClass:
    | "mcp_resource"
    | "file_like"
    | "http_like"
    | "custom"
    | "unknown";
  templateRef?: EvidenceRef;
  templateParamDigest?: string;
  normalizedBy: string;
  rawResourceUriIncluded: false;
};
```

Resource identity blockers:

```text
resource_uri_raw_exposure
resource_uri_scheme_blocked
resource_uri_template_param_invalid
resource_uri_server_mismatch
resource_uri_digest_mismatch
```

## Tool Semantics

### tool_search

Classification:

```text
ODEU family: external capability discovery
side effect: discovery/read of tool metadata only
authority: non-executing evidence
resident-callable in first slice: yes, if host tool metadata exists
context admission: descriptor summary only
```

Rules:

```text
- tool_search returns capability descriptors, not callable authority.
- Discovered tools are never auto-declared to the provider.
- Descriptor rows must include source, schema digest where available,
  permission class, side-effect class, and trust posture.
- Missing or inaccessible discovery backend returns unavailable evidence, not
  an empty successful list.
- Resident-visible text must distinguish "available to discover" from
  "available to execute."
- Result context admission is summary/ref by default.
- Search scope and maxResults must be bounded by request and policy.
- Raw schemas/endpoints are summarized and digested by default.
```

Input shape:

```ts
type ExternalToolSearchInput = {
  query?: string;
  families?: Array<
    | "mcp_resource"
    | "mcp_tool"
    | "plugin_candidate"
    | "hosted_provider_tool"
    | "local_direct_tool"
  >;
  includeBlocked?: boolean;
  maxResults: number;
};
```

Default posture:

```text
families = ["mcp_resource", "mcp_tool", "plugin_candidate"]
includeBlocked = true
maxResults = bounded
```

Required result posture:

```ts
type ExternalDiscoveryResultEnvelope = {
  schema: "external_discovery_result_envelope@1";
  envelopeId: string;
  toolName: "tool_search" | "list_mcp_resources" | "list_mcp_resource_templates" | "list_available_plugins_to_install";
  projectId: string;
  workThreadId?: string;
  threadId?: string;
  turnId?: string;
  searchInput?: ExternalToolSearchInput;
  serverSelector?: McpServerSelector;
  status: "completed" | "unavailable" | "blocked" | "degraded";
  descriptorCount: number;
  descriptors: ExternalCapabilityDescriptor[];
  sourceIdentityRefs: EvidenceRef[];
  contextAdmission:
    | "summary_admitted"
    | "ref_only"
    | "blocked"
    | "not_requested";
  executionAuthorityGranted: false;
  providerDeclarationGranted: false;
  rawExternalPayloadIncluded: false;
  rawSecretIncluded: false;
  evidenceRefs: EvidenceRef[];
};
```

### list_mcp_resources / list_mcp_resource_templates

Classification:

```text
ODEU family: external resource discovery
side effect: metadata discovery only
authority: non-executing evidence
resident-callable in first slice: yes, when MCP source identity is known
context admission: descriptor summary only
```

Rules:

```text
- MCP server identity must be explicit before list results are admitted.
- Resource URI is not exposed raw by default; display label and URI digest are
  preferred.
- Template parameters must be schema-digested and bounded.
- Resource descriptors must not imply read permission.
- If server identity/trust is unknown, list result is degraded or blocked.
- Large list results are capped and summarized.
- Multi-server ambiguity blocks unless a server selector/default is exact.
```

### read_mcp_resource

Classification:

```text
ODEU family: external resource perception
side effect: external read
authority: per-call read authority
resident-callable in first slice: guarded yes, only with source/resource/cap evidence
context admission: ref/summary/excerpt after policy
```

Rules:

```text
- read_mcp_resource requires McpServerIdentityWitness.
- read_mcp_resource requires McpResourceDescriptor or equivalent source ref.
- Resource URI must be normalized, digested, and checked against the selected
  server/template identity.
- Result payload is capped before storage/projection.
- Redaction scan runs before renderer/resident projection.
- Context admission must declare whether the result is summary, bounded
  excerpt, ref-only, or blocked.
- Imported external text is not project truth and not workspace evidence until
  a later explicit staging/citation transition.
- Binary or unknown resources are ref-only or blocked in Wave 18.
- Failure/unavailable states remain evidence rows with reasons.
- sideEffectClass is external_read, not none.
- No automatic replay after handoff/unknown state.
- If request bytes were sent and the outcome is unknown, classify the read as
  ambiguous/failed; do not retry silently.
- Cached read evidence must be labeled separately from fresh external reads.
```

Required result posture:

```ts
type McpResourceReadEnvelope = {
  schema: "mcp_resource_read_envelope@1";
  envelopeId: string;
  projectId: string;
  workThreadId?: string;
  threadId?: string;
  turnId?: string;
  serverSelector: McpServerSelector;
  serverIdentityRef: EvidenceRef;
  resourceDescriptorRef: EvidenceRef;
  resourceIdentity: McpResourceIdentity;
  resourceUriEvidenceKey: string;
  resourceDisplay: string;
  status:
    | "completed"
    | "blocked"
    | "unavailable"
    | "unsupported"
    | "failed";
  sideEffectClass: "external_read";
  mimeKind: "text" | "json" | "markdown" | "binary" | "unknown";
  contentHandling:
    | "text_excerpt_allowed"
    | "json_summary_allowed"
    | "markdown_excerpt_allowed"
    | "binary_ref_only"
    | "unknown_blocked"
    | "oversize_blocked";
  byteCount?: number;
  truncationState: "none" | "truncated" | "omitted";
  redactionState: "passed" | "redacted" | "blocked" | "not_scanned";
  payloadRetention:
    | "not_stored"
    | "stored_redacted"
    | "stored_digest_only"
    | "stored_private_artifact";
  payloadArtifactRef?: EvidenceRef;
  payloadDigest?: string;
  readFreshness:
    | "fresh_external_read"
    | "cached_fresh"
    | "cached_stale"
    | "unknown";
  sourceObservedAt?: string;
  cacheEntryId?: string;
  cachePolicyDigest?: string;
  readReplayPolicy: {
    idempotencyKey: string;
    mayAutoRetry: false;
    mayReplayAfterHandoffUnknown: false;
    cacheMaySatisfyRepeatRead: boolean;
  };
  contextAdmission:
    | "summary_admitted"
    | "excerpt_admitted"
    | "ref_only"
    | "blocked";
  resultTrustLevel:
    | "external_untrusted"
    | "external_authenticated"
    | "local_connector_reported"
    | "unknown";
  rawResourcePayloadIncluded: false;
  rawResourceUriIncluded: false;
  rawSecretIncluded: false;
  executionAuthorityGranted: false;
  workspaceMutationStarted: false;
  evidenceRefs: EvidenceRef[];
};
```

Status law:

```text
status = terminal operation state
truncationState = payload size handling
redactionState = privacy/security handling
```

Examples:

```text
successful read with truncated excerpt:
  status=completed
  truncationState=truncated

payload blocked by redaction:
  status=blocked
  redactionState=blocked
```

### dynamic MCP tools

Classification:

```text
ODEU family: external action
side effect: unknown to mutating
authority: blocked/deferred in Wave 18
resident-callable in first slice: no
context admission: blocked projection only
```

Rules:

```text
- Dynamic MCP tools may be discovered and classified.
- Dynamic MCP tools must not be provider-declared in Wave 18.
- Any provider-emitted dynamic MCP call is undeclared/blocked.
- Mutating/external-action status must be visible to resident/operator.
- Later waves must add per-tool permission class, schema witness, approval, and
  replay/cancellation law before execution.
```

Blocked projection:

```ts
type DynamicMcpActionBlockedProjection = {
  schema: "dynamic_mcp_action_blocked_projection@1";
  toolDescriptorId: string;
  serverIdentityRef: EvidenceRef;
  toolNameDisplay: string;
  reason:
    | "external_action_not_in_wave18"
    | "permission_class_unknown"
    | "mutating_action_blocked"
    | "schema_missing"
    | "approval_law_missing"
    | "replay_law_missing";
  residentVisible: true;
  providerDeclared: false;
  executionAuthorityGranted: false;
};
```

### list_available_plugins_to_install / request_plugin_install

Classification:

```text
plugin list = capability discovery
plugin install = capability mutation
```

Rules:

```text
- Plugin candidates may be visible as discovery-only descriptors.
- Plugin install remains operator-only/deferred and not provider-declared.
- Requesting install through resident tool calls is blocked in Wave 18.
- Candidate descriptors must not imply installation, trust, or execution.
- resident-visible plugin candidate != install request affordance.
```

Plugin candidate descriptor posture:

```ts
type PluginCandidateDiscoveryPosture = {
  pluginInstallState:
    | "not_supported_in_wave18"
    | "operator_only_future"
    | "blocked"
    | "unknown";
  pluginTrustState:
    | "verified_source"
    | "unverified_source"
    | "unknown";
  installAuthorityGranted: false;
};
```

## Context Admission Law

External result context admission must be explicit.

```text
discovery result:
  default = summary/ref only

MCP resource read:
  default = ref or bounded excerpt
  never = raw full payload by default

dynamic action/plugin install:
  default = blocked projection only
```

External context admission must also state who can see what:

```text
resident context != operator UI != provider continuation
```

Admission fields:

```ts
type ExternalResultContextAdmission = {
  schema: "external_result_context_admission@1";
  admissionId: string;
  sourceEnvelopeId: string;
  resultKind:
    | "external_discovery"
    | "mcp_resource_read"
    | "dynamic_mcp_action_blocked"
    | "plugin_install_blocked";
  admissionState:
    | "summary_admitted"
    | "excerpt_admitted"
    | "ref_only"
    | "blocked";
  visibility: {
    residentContext:
      | "none"
      | "summary"
      | "bounded_excerpt"
      | "ref_only";
    operatorUi:
      | "summary"
      | "bounded_excerpt"
      | "ref_only"
      | "blocked";
    providerContinuation:
      | "not_sent"
      | "summary_only"
      | "bounded_excerpt"
      | "ref_only";
  };
  admittedTokenBudget?: number;
  excerptByteLimit?: number;
  truncationState: "none" | "truncated" | "omitted";
  redactionState: "passed" | "redacted" | "blocked";
  projectTruthGranted: false;
  workspaceEvidenceGranted: false;
  authorityGranted: false;
  evidenceRefs: EvidenceRef[];
};
```

Resident-visible admitted content must include source trust posture:

```text
External MCP resource from <display source>; trust=<trustState>; not project truth.
```

Memory law:

```text
External results may be context evidence for the current turn.
They must not become durable memory unless a later memory-admission workflow
explicitly admits them with source provenance and trust state.
```

## Provider Declaration Law

Provider-visible declarations are allowed only for Wave 18-safe discovery/read
tools after lifecycle evidence and activation rows exist.

Declaration law:

```text
resident-visible discovery status
  !=
provider-declared discovery tool
```

Allowed in Wave 18 first slice:

```text
tool_search
list_mcp_resources
list_mcp_resource_templates
read_mcp_resource, guarded by source/resource caps
```

Not allowed:

```text
mcp_dynamic_tool_call
request_plugin_install
browser/network open-ended tools
provider-hosted web_search/image_generation
```

Any declaration snapshot must include:

```text
tool name
tool schema digest
source identity dependency
permission class
side-effect class
result envelope schema
context admission policy
negative capability blockers
```

Required declaration shape:

```ts
type ExternalToolResidentDeclaration = {
  declarationId: string;
  activationSnapshotId: string;
  declarationDigest: string;
  declaredTools: Array<
    | "tool_search"
    | "list_mcp_resources"
    | "list_mcp_resource_templates"
    | "read_mcp_resource"
  >;
  blockedTools: Array<
    | "mcp_dynamic_tool_call"
    | "request_plugin_install"
    | "web_search"
    | "image_generation"
  >;
  serverScope?: string[];
  resultEnvelopeSchema: string;
  contextAdmissionPolicyId: string;
};
```

Every provider tool call must match the frozen declaration digest. Unknown or
dynamic external calls are blocked as:

```text
blocked_undeclared_external_tool_call
```

## Security And Privacy

Hard laws:

```text
- No raw secrets, cookies, bearer tokens, OAuth tokens, provider payloads, or
  connector credentials enter resident or renderer state.
- Raw resource URI is not exposed by default; use display and evidence key.
- Raw resource payload is never passed through without redaction/caps.
- External results are untrusted by default.
- External result failures are evidence; they must not be hidden as empty
  success.
- External actions are not replay-safe by default.
- Raw endpoints and credentials are excluded from identity witnesses.
- Resource URI evidence keys/digests are preferred over raw URIs.
- Payload retention must be explicit for every external read.
```

## PR Sequence

### PR 109: External Capability Profile

Branch:

```text
codex/direct-external-capability-profile
```

Deliverables:

```text
ExternalCapabilityProfile
ExternalSourceIdentityWitness
McpServerIdentityWitness
McpServerSelector ambiguity/blocker vocabulary
ExternalCapabilityDescriptor alignment with ODEU lifecycle rows
descriptorKind/executionState fields
known disabled/deferred rows for dynamic MCP actions and plugin install
resident/operator compact witness projection
regression fixture over existing discovery/MCP/plugin substrate
information registry row
roadmap update
```

Non-goals:

```text
no resident-callable provider declarations
no external resource reads
no dynamic MCP action execution
no plugin install
```

### PR 110: Resident External Discovery Tools

Branch:

```text
codex/direct-external-discovery-tools
```

Deliverables:

```text
resident-callable declaration rows for safe discovery tools
ExternalToolSearchInput with families/includeBlocked/maxResults
tool_search result envelope
list_mcp_resources result envelope
list_mcp_resource_templates result envelope
plugin candidate list as discovery-only descriptor when available
source identity and schema digest checks
serverSelector where applicable
result cap/truncation policy for large descriptor sets
headless regression for unavailable/degraded discovery
```

Non-goals:

```text
no read_mcp_resource
no dynamic MCP tool calls
no plugin install
no discovered-tool auto-promotion
```

### PR 111: MCP Resource Read Envelope

Branch:

```text
codex/direct-mcp-resource-read-envelope
```

Deliverables:

```text
McpServerIdentityWitness
McpResourceDescriptor
McpResourceIdentity
McpResourceReadEnvelope
per-call source/resource eligibility gate
URI digest/display policy
size/MIME caps
redaction and truncation posture
sideEffectClass=external_read
readReplayPolicy with no automatic replay after handoff/unknown
readFreshness/cache posture
payloadRetention policy
contentHandling policy
blocked rows for binary/oversize/unknown-source resources
headless regression for read success/degraded/blocked paths
```

Non-goals:

```text
no dynamic MCP action calls
no workspace staging of imported resources
no full raw payload admission
no project-truth mutation
```

### PR 112: External Result Context Admission

Branch:

```text
codex/direct-external-result-context-admission
```

Deliverables:

```text
ExternalResultContextAdmissionPolicy
summary/ref/excerpt/blocked admission rows
resident/operator/provider visibility channels
trust-level and freshness projection
external trust warning in resident-visible admitted text
no automatic durable memory admission
resident-visible source/truncation/redaction witness
operator projection for imported external evidence
negative tests proving raw payload, raw URI, secret, and project-truth leakage
are blocked
```

Non-goals:

```text
no richer UI for browsing MCP resources
no persistent artifact import/staging
no dynamic external action approval
```

### PR 113: Wave 18 Usability Proof Gate

Branch:

```text
codex/direct-external-wave18-usability-gate
```

Deliverables:

```text
ExternalToolUsabilityProof
resident/operator witness rows
manual usability gate rows
headless scenario suite
negative scenario matrix
deterministic negative tests for discovered-as-declared collapse,
multiple MCP servers without selector, stale/unknown server identity,
raw endpoint/token leakage, raw resource URI/payload leakage, binary/oversize
resources, dynamic MCP action, plugin install, memory smuggling, and
project-truth laundering
information registry row
roadmap/audit update marking Wave 18 complete when gates pass
```

Non-goals:

```text
no Wave 19 provider-hosted tools
no Wave 20 new_context/compaction execution
no Wave 21 code-mode execution
```

## Acceptance Criteria

General:

```text
- Every promoted discovery/read tool cites ODEU lifecycle rows.
- Every provider-declared external tool has a frozen declaration digest.
- Every external source has identity/trust/freshness evidence.
- Every external read has per-call authority and result envelope.
- Every external result has a context-admission record.
- Missing external evidence is unavailable/degraded, not inferred as empty.
- Dynamic action and plugin install are visible as blocked/deferred, not absent.
- Discovery results never auto-promote tools to executable authority.
- All MCP discovery/read calls are scoped to an exact serverIdentityId/default
  or block as ambiguous.
- McpServerIdentityWitness includes transport, auth posture, trust state,
  enabled state, freshness, and raw endpoint/credential exclusion.
- ExternalCapabilityDescriptor distinguishes discovery_only, external_resource,
  external_action_tool, plugin_candidate, and provider_hosted_tool.
- read_mcp_resource uses sideEffectClass=external_read and mayAutoRetry=false
  after unknown/handoff.
- McpResourceReadEnvelope separates terminal status from redaction/truncation
  state.
- Payload retention policy is explicit.
- Context admission includes resident/operator/provider visibility channels.
- External results do not become durable memory automatically.
- Resident-visible admitted external content includes trust/provenance warning.
```

Specific:

```text
- tool_search returns descriptors only and cannot execute discovered tools.
- list_mcp_resources/list_mcp_resource_templates require server identity.
- read_mcp_resource blocks unknown server identity.
- read_mcp_resource blocks raw URI and raw payload exposure by default.
- read_mcp_resource enforces size/MIME caps before context admission.
- External result context admission distinguishes summary, excerpt, ref-only,
  and blocked.
- External results never become project truth or workspace evidence in Wave 18.
- Dynamic MCP calls are not provider-declared and are blocked if emitted.
- request_plugin_install is not resident-callable in Wave 18.
- Plugin candidates are discoverable but installAuthorityGranted=false.
- Binary/unknown resources are blocked or ref-only by contentHandling policy.
- Headless tests cover all positive and negative scenarios listed above.
```

Failure classes to test:

```text
discovery-declaration laundering:
  discovered MCP tool becomes provider-declared

read-trust laundering:
  external resource read treated as project truth

resource URI leakage:
  raw URI/path/token appears in resident/renderer state

external payload smuggling:
  raw resource payload enters context without admission policy

action-read collapse:
  dynamic MCP action treated as resource read

plugin candidate inflation:
  plugin listing treated as install authority

server ambiguity:
  read occurs against wrong MCP server

retry replay:
  external read repeats after unknown/handoff state

memory smuggling:
  external result silently becomes durable memory
```

## Completion Gate

Wave 18 is complete when:

```text
The resident can lawfully discover external capabilities and perform bounded
read-only MCP resource perception with source identity, caps, redaction,
provenance, and context-admission witnesses, while dynamic external actions,
plugin installation, provider-hosted tools, and context-world transitions
remain blocked until later waves.
```
