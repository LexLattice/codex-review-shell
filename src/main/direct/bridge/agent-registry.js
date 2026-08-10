"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIRECT_AGENT_REGISTRY_SCHEMA = "direct_agent_registry@1";
const DIRECT_AGENT_IDENTITY_SCHEMA = "direct_agent_identity@1";
const DIRECT_AGENT_RUN_SCHEMA = "direct_agent_run@1";
const DIRECT_AGENT_THREAD_LINK_SCHEMA = "direct_agent_thread_link@1";
const DIRECT_AGENT_REGISTRY_PROJECTION_SCHEMA = "direct_agent_registry_projection@1";
const DIRECT_AGENT_REGISTRY_STATUS_SCHEMA = "direct_agent_registry_status@1";

const IDENTITY_CONFIDENCE = new Set(["exact", "declared", "backfilled", "inferred", "unknown"]);
const IDENTITY_LIFECYCLE_STATES = new Set(["active", "idle", "archived", "superseded", "unknown"]);
const AGENT_RUN_KINDS = new Set(["resident", "resident_thread", "resident_headless", "resident_recovery", "spawned_worker", "audit_pass", "headless_route", "memory_extraction", "context_maintenance", "closeout", "diagnostic", "unknown"]);
const AGENT_RUN_OBJECTIVE_KINDS = new Set(["interactive_resident", "worker_task", "audit", "memory_extraction", "context_maintenance", "headless_route", "diagnostic", "unknown"]);
const AGENT_RUN_LIFECYCLES = new Set(["planned", "running", "waiting", "completed", "failed", "cancelled", "handoff_unknown", "recovery_required", "unknown"]);
const THREAD_LINK_KINDS = new Set(["resident_primary", "worker_thread", "audit_thread", "headless_thread", "imported_witness", "derived_projection", "unknown"]);
const THREAD_LINK_RELATIONSHIPS = new Set(["owned_by_agent", "agent_participated", "agent_observed", "parent_child", "imported_evidence", "derived_projection", "unknown"]);
const THREAD_LINK_STATES = new Set(["active", "inactive", "stale", "unknown"]);
const IDENTITY_CONFIDENCE_ORDER = ["unknown", "inferred", "backfilled", "declared", "exact"];
const TERMINAL_DIRECT_FAILURE_STATES = new Set([
  "tool_call_blocked_text_only",
  "response_incomplete",
  "content_filter_terminal",
  "max_output_terminal",
  "empty_output_terminal",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["digest", "registryDigest", "projectionDigest", "identityDigest", "linkDigest", "statusDigest"].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestValue(prefix, value) {
  return `sha256:${sha256(`${prefix}\0${stableJson(value)}`)}`;
}

function boundedPreview(value, maxChars = 220) {
  const text = preserveString(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function safeSlotPart(value, fallback = "agent") {
  const text = normalizeString(value, fallback);
  const safe = text.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return safe || fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function normalizeRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: boundedPreview(source.label || source.rendererSafeLabel || source.kind || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestValue("direct-agent-ref@1", ref);
  return ref;
}

function normalizeRefList(values, fallbackKind = "unknown") {
  const refs = (Array.isArray(values) ? values : [])
    .map((value) => normalizeRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest || ref.label);
  const byDigest = new Map();
  for (const ref of refs) byDigest.set(ref.refDigest, ref);
  return [...byDigest.values()];
}

function mergeRefs(existingRefs = [], candidateRefs = [], fallbackKind = "unknown") {
  const refs = normalizeRefList([
    ...(Array.isArray(existingRefs) ? existingRefs : []),
    ...(Array.isArray(candidateRefs) ? candidateRefs : []),
  ], fallbackKind);
  const byKey = new Map();
  for (const ref of refs) {
    const key = ref.id
      ? `${ref.kind || ""}:${ref.id}`
      : ref.digest
        ? `digest:${ref.digest}`
        : ref.refDigest;
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function normalizeIdentityConfidence(value) {
  const confidence = normalizeString(value, "unknown");
  return IDENTITY_CONFIDENCE.has(confidence) ? confidence : "unknown";
}

function mergeIdentityConfidence(existingValue, candidateValue) {
  const existing = normalizeIdentityConfidence(existingValue);
  const candidate = normalizeIdentityConfidence(candidateValue);
  const existingRank = IDENTITY_CONFIDENCE_ORDER.indexOf(existing);
  const candidateRank = IDENTITY_CONFIDENCE_ORDER.indexOf(candidate);
  return existingRank > candidateRank ? existing : candidate;
}

function normalizeLifecycleState(value) {
  const state = normalizeString(value, "active");
  return IDENTITY_LIFECYCLE_STATES.has(state) ? state : "unknown";
}

function normalizeAgentRunKind(value) {
  const kind = normalizeString(value, "unknown");
  return AGENT_RUN_KINDS.has(kind) ? kind : "unknown";
}

function normalizeAgentRunObjectiveKind(value) {
  const kind = normalizeString(value, "unknown");
  return AGENT_RUN_OBJECTIVE_KINDS.has(kind) ? kind : "unknown";
}

function normalizeAgentRunLifecycle(value) {
  const lifecycle = normalizeString(value, "planned");
  return AGENT_RUN_LIFECYCLES.has(lifecycle) ? lifecycle : "unknown";
}

function normalizeThreadLinkKind(value) {
  const kind = normalizeString(value, "unknown");
  return THREAD_LINK_KINDS.has(kind) ? kind : "unknown";
}

function normalizeThreadLinkRelationship(value) {
  const relationship = normalizeString(value, "unknown");
  return THREAD_LINK_RELATIONSHIPS.has(relationship) ? relationship : "unknown";
}

function normalizeThreadLinkState(value) {
  const state = normalizeString(value, "active");
  return THREAD_LINK_STATES.has(state) ? state : "unknown";
}

function agentThreadLinkIdFromParts(parts = {}, options = {}) {
  const agentId = safeSlotPart(parts.agentId, "direct_agent");
  const threadId = safeSlotPart(parts.threadId || parts.sessionId, "direct_session");
  const identity = {
    projectId: normalizeString(parts.projectId, ""),
    agentId,
    threadId,
    relationship: normalizeThreadLinkRelationship(parts.relationship),
  };
  if (options.includeRunRefs !== false) {
    identity.agentRunId = normalizeString(parts.agentRunId, "");
    identity.linkKind = normalizeThreadLinkKind(parts.linkKind);
  }
  const linkId = `agent_thread_link_${sha256(stableJson(identity)).slice(0, 24)}`;
  return safeSlotPart(linkId, "agent_thread_link");
}

function buildAgentIdentityKey(input = {}) {
  const projectId = normalizeString(input.projectId, "");
  const roleLane = normalizeString(input.roleLane, "implementation");
  const agentClass = normalizeString(input.agentClass || input.agentKind, "primary_coder");
  return {
    schema: "direct_agent_identity_key@1",
    projectId,
    roleLane,
    agentClass,
    workspaceEvidenceKey: normalizeString(input.workspaceEvidenceKey, ""),
    authorityScopeRef: normalizeString(input.authorityScopeRef, ""),
    memoryScopeRef: normalizeString(input.memoryScopeRef, ""),
    source: normalizeString(input.source, "project_role_lane"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function agentIdFor(input = {}) {
  const explicit = normalizeString(input.agentId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "direct_agent");
  const identityKey = input.identityKey && isPlainObject(input.identityKey)
    ? input.identityKey
    : buildAgentIdentityKey(input);
  return `direct_agent_${sha256(stableJson(identityKey)).slice(0, 24)}`;
}

function buildAgentBackfillPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    schema: "direct_agent_backfill_policy@1",
    policyId: normalizeString(source.policyId, "default_resident_agent_backfill@1"),
    grouping: normalizeString(source.grouping, "project_role_lane"),
    mayMergeByDisplayLabel: false,
    mayRewriteSessions: false,
    identityConfidence: normalizeIdentityConfidence(source.identityConfidence || "backfilled"),
    evidenceRule: normalizeString(source.evidenceRule, "session_thread_link_only"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildAgentIdentity(input = {}, options = {}) {
  const now = normalizeString(input.updatedAt, nowIso(options.nowMs));
  const identityKey = buildAgentIdentityKey(input.identityKey || input);
  const agentId = agentIdFor({ ...input, identityKey });
  const confidence = normalizeIdentityConfidence(input.identityConfidence || input.confidence || "unknown");
  const linkedThreadIds = [...new Set((Array.isArray(input.linkedThreadIds) ? input.linkedThreadIds : [])
    .map((threadId) => normalizeString(threadId, ""))
    .filter(Boolean))]
    .sort();
  const activeRunIds = [...new Set((Array.isArray(input.activeRunIds) ? input.activeRunIds : [])
    .map((runId) => normalizeString(runId, ""))
    .filter(Boolean))]
    .sort();
  const identity = {
    schema: DIRECT_AGENT_IDENTITY_SCHEMA,
    agentId,
    projectId: identityKey.projectId,
    identityKey,
    agentClass: identityKey.agentClass,
    roleLane: identityKey.roleLane,
    displayName: boundedPreview(input.displayName || `${identityKey.roleLane} ${identityKey.agentClass}`, 140),
    identityConfidence: confidence,
    lifecycleState: normalizeLifecycleState(input.lifecycleState || input.status),
    lifecycleReason: boundedPreview(input.lifecycleReason || input.statusReason, 220),
    lifecycleUpdatedAt: normalizeString(input.lifecycleUpdatedAt, now),
    createdAt: normalizeString(input.createdAt, now),
    updatedAt: now,
    backfillPolicy: isPlainObject(input.backfillPolicy) ? buildAgentBackfillPolicy(input.backfillPolicy) : null,
    linkedThreadIds,
    activeRunIds,
    sourceRefs: normalizeRefList(input.sourceRefs, "agent_identity_source"),
    notes: boundedPreview(input.notes, 320),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  identity.identityDigest = digestValue("direct-agent-identity@1", identity);
  return identity;
}

function agentRunIdFor(input = {}) {
  const explicit = normalizeString(input.agentRunId || input.runId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "direct_agent_run");
  const basis = {
    projectId: normalizeString(input.projectId, ""),
    agentId: normalizeString(input.agentId, ""),
    runKind: normalizeAgentRunKind(input.runKind),
    threadIds: (Array.isArray(input.threadIds) ? input.threadIds : [input.threadId || input.sessionId])
      .map((threadId) => normalizeString(threadId, ""))
      .filter(Boolean)
      .sort(),
    objectiveDigest: normalizeString(input.objective?.objectiveDigest || input.objectiveDigest, ""),
    objectivePreview: boundedPreview(input.objective?.objectivePreview || input.objectivePreview, 180),
  };
  return `direct_agent_run_${sha256(stableJson(basis)).slice(0, 24)}`;
}

function buildAgentRun(input = {}, options = {}) {
  const now = normalizeString(input.updatedAt || input.startedAt, nowIso(options.nowMs));
  const agentId = safeSlotPart(input.agentId, "unknown_agent");
  const threadIds = [...new Set((Array.isArray(input.threadIds) ? input.threadIds : [input.threadId || input.sessionId])
    .map((threadId) => normalizeString(threadId, ""))
    .filter(Boolean))]
    .sort();
  const objectiveSource = isPlainObject(input.objective) ? input.objective : {};
  const outputContractSource = isPlainObject(input.outputContract) ? input.outputContract : {};
  const run = {
    schema: DIRECT_AGENT_RUN_SCHEMA,
    agentRunId: agentRunIdFor({ ...input, threadIds, agentId }),
    agentId,
    projectId: normalizeString(input.projectId, ""),
    runKind: normalizeAgentRunKind(input.runKind),
    objective: {
      objectiveKind: normalizeAgentRunObjectiveKind(objectiveSource.objectiveKind || input.objectiveKind),
      objectiveDigest: normalizeString(objectiveSource.objectiveDigest || input.objectiveDigest, ""),
      objectivePreview: boundedPreview(objectiveSource.objectivePreview || input.objectivePreview || input.title, 360),
      rawTextIncluded: false,
    },
    outputContract: {
      expectedArtifactKinds: [...new Set((Array.isArray(outputContractSource.expectedArtifactKinds) ? outputContractSource.expectedArtifactKinds : [])
        .map((kind) => normalizeString(kind, ""))
        .filter(Boolean))]
        .sort(),
      resultEnvelopePolicyId: normalizeString(outputContractSource.resultEnvelopePolicyId, ""),
      rawTextIncluded: false,
    },
    parentAgentId: normalizeString(input.parentAgentId, ""),
    parentAgentRunId: normalizeString(input.parentAgentRunId, ""),
    parentThreadId: normalizeString(input.parentThreadId, ""),
    threadIds,
    workThreadId: normalizeString(input.workThreadId, ""),
    startedAt: normalizeString(input.startedAt, now),
    endedAt: normalizeString(input.endedAt, ""),
    lifecycle: normalizeAgentRunLifecycle(input.lifecycle || input.status),
    contextPacketRefs: normalizeRefList(input.contextPacketRefs, "agent_run_context_packet"),
    requestManifestRefs: normalizeRefList(input.requestManifestRefs, "agent_run_request_manifest"),
    resultEnvelopeRefs: normalizeRefList(input.resultEnvelopeRefs, "agent_run_result_envelope"),
    usageRefs: normalizeRefList(input.usageRefs, "agent_run_usage"),
    authorityBoundaryRef: input.authorityBoundaryRef ? normalizeRef(input.authorityBoundaryRef, "agent_run_authority_boundary") : null,
    sourceRefs: normalizeRefList(input.sourceRefs, "agent_run_source"),
    createdAt: normalizeString(input.createdAt, now),
    updatedAt: now,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  run.runDigest = digestValue("direct-agent-run@1", run);
  return run;
}

function buildAgentThreadLink(input = {}, options = {}) {
  const now = normalizeString(input.updatedAt, nowIso(options.nowMs));
  const agentId = safeSlotPart(input.agentId, "direct_agent");
  const threadId = safeSlotPart(input.threadId || input.sessionId, "direct_session");
  const linkKind = normalizeThreadLinkKind(input.linkKind);
  const relationship = normalizeThreadLinkRelationship(input.relationship);
  const linkId = safeSlotPart(
    input.linkId || agentThreadLinkIdFromParts({
      projectId: normalizeString(input.projectId, ""),
      agentId,
      agentRunId: normalizeString(input.agentRunId, ""),
      threadId,
      linkKind,
      relationship,
    }),
    "agent_thread_link",
  );
  const link = {
    schema: DIRECT_AGENT_THREAD_LINK_SCHEMA,
    linkId,
    projectId: normalizeString(input.projectId, ""),
    agentId,
    agentRunId: normalizeString(input.agentRunId, ""),
    threadId,
    linkKind,
    relationship,
    linkState: normalizeThreadLinkState(input.linkState || input.status),
    linkConfidence: normalizeIdentityConfidence(input.linkConfidence || "backfilled"),
    sessionId: normalizeString(input.sessionId || threadId, ""),
    providerThreadId: normalizeString(input.providerThreadId || input.agentThreadId || threadId, ""),
    parentThreadId: normalizeString(input.parentThreadId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    createdAt: normalizeString(input.createdAt, now),
    updatedAt: now,
    sourceRefs: normalizeRefList(input.sourceRefs, "agent_thread_link_source"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  link.linkDigest = digestValue("direct-agent-thread-link@1", link);
  return link;
}

function agentRoleLaneFromSession(session = {}) {
  const agentKind = normalizeString(session.agentKind, "").toLowerCase();
  const agentRole = normalizeString(session.agentRole, "").toLowerCase();
  const combined = `${agentKind} ${agentRole}`;
  if (combined.includes("audit") || combined.includes("review")) return "audit";
  if (combined.includes("research") || combined.includes("scout")) return "research";
  if (combined.includes("orchestrat") || combined.includes("broker")) return "orchestration";
  if (combined.includes("worker") || combined.includes("agent")) return "implementation";
  return "implementation";
}

function agentClassFromSession(session = {}) {
  const agentKind = normalizeString(session.agentKind, "").toLowerCase();
  const agentRole = normalizeString(session.agentRole, "").toLowerCase();
  const combined = `${agentKind} ${agentRole}`;
  if (combined.includes("audit") || combined.includes("review")) return "architecture_auditor";
  if (combined.includes("research") || combined.includes("scout")) return "research_worker";
  if (combined.includes("orchestrat") || combined.includes("broker")) return "orchestrator";
  if (combined.includes("worker") || combined.includes("agent")) return "implementation_worker";
  return "primary_coder";
}

function threadRelationshipFromSession(session = {}) {
  if (normalizeString(session.parentThreadId, "")) return "parent_child";
  if (normalizeString(session.agentKind, "")) return "agent_participated";
  return "owned_by_agent";
}

function threadLinkKindFromSession(session = {}) {
  const agentKind = normalizeString(session.agentKind, "").toLowerCase();
  const agentRole = normalizeString(session.agentRole, "").toLowerCase();
  const combined = `${agentKind} ${agentRole}`;
  if (combined.includes("audit") || combined.includes("review")) return "audit_thread";
  if (normalizeString(session.parentThreadId, "") || combined.includes("worker") || combined.includes("agent")) return "worker_thread";
  if (normalizeString(session.sourceClass, "") === "headless") return "headless_thread";
  return "resident_primary";
}

function agentRunKindFromSession(session = {}) {
  const linkKind = threadLinkKindFromSession(session);
  if (linkKind === "audit_thread") return "audit_pass";
  if (linkKind === "worker_thread") return "spawned_worker";
  if (linkKind === "headless_thread") return "resident_headless";
  return "resident_thread";
}

function agentRunObjectiveKindFromSession(session = {}) {
  const runKind = agentRunKindFromSession(session);
  if (runKind === "audit_pass") return "audit";
  if (runKind === "spawned_worker") return "worker_task";
  if (runKind === "resident_headless") return "headless_route";
  return "interactive_resident";
}

function agentRunLifecycleFromSession(session = {}) {
  const status = normalizeString(session.status, "created");
  if (["active", "running", "streaming"].includes(status)) return "running";
  if (["waiting", "tool_waiting", "authority_waiting"].includes(status)) return "waiting";
  if (["completed", "done"].includes(status)) return "completed";
  if (["failed", "error"].includes(status)) return "failed";
  if (["aborted", "cancelled", "canceled"].includes(status)) return "cancelled";
  if (["transport_handoff_unknown"].includes(status)) return "handoff_unknown";
  if (TERMINAL_DIRECT_FAILURE_STATES.has(status)) return "failed";
  return "planned";
}

function defaultAgentRunInputForSession(session = {}, agentId = "") {
  const contextPacketRefs = [];
  if (normalizeString(session.workerContextPacketId, "")) {
    contextPacketRefs.push({
      kind: "worker_context_packet",
      id: session.workerContextPacketId,
      digest: normalizeString(session.workerContextPacketDigest, ""),
      label: "Worker context packet",
      confidence: "session_source",
    });
  }
  const requestManifestRefs = [];
  if (normalizeString(session.profileSnapshotId, "")) {
    requestManifestRefs.push({
      kind: "profile_snapshot",
      id: session.profileSnapshotId,
      label: "Profile snapshot",
      confidence: "session_source",
    });
  }
  return {
    agentRunId: normalizeString(session.agentRunId, ""),
    projectId: normalizeString(session.projectId, ""),
    agentId,
    runKind: agentRunKindFromSession(session),
    objective: {
      objectiveKind: agentRunObjectiveKindFromSession(session),
      objectivePreview: boundedPreview(session.title || session.agentRole || session.agentKind, 360),
      objectiveDigest: normalizeString(session.workerStartTransitionDigest || session.roleHandoffPacketDigest || "", ""),
    },
    outputContract: {
      expectedArtifactKinds: [],
      resultEnvelopePolicyId: "",
    },
    parentAgentId: normalizeString(session.parentAgentId, ""),
    parentAgentRunId: normalizeString(session.parentAgentRunId, ""),
    parentThreadId: normalizeString(session.parentThreadId, ""),
    threadIds: [session.sessionId],
    workThreadId: normalizeString(session.workThreadId, ""),
    startedAt: normalizeString(session.createdAt, ""),
    endedAt: ["completed", "done", "failed", "error", "aborted", "cancelled", "canceled"].includes(normalizeString(session.status, ""))
      || TERMINAL_DIRECT_FAILURE_STATES.has(normalizeString(session.status, ""))
      ? normalizeString(session.updatedAt, "")
      : "",
    lifecycle: agentRunLifecycleFromSession(session),
    contextPacketRefs,
    requestManifestRefs,
    sourceRefs: sessionSourceRefs(session),
  };
}

function sessionSourceRefs(session = {}) {
  const sessionId = normalizeString(session.sessionId, "");
  const projectId = normalizeString(session.projectId, "");
  const refs = [];
  if (sessionId) {
    refs.push({
      kind: "direct_session",
      id: sessionId,
      label: "Direct session artifact",
      confidence: "session_source",
      digest: digestValue("direct-agent-session-source@1", {
        sessionId,
        projectId,
        updatedAt: normalizeString(session.updatedAt, ""),
      }),
    });
  }
  const agentThreadId = normalizeString(session.agentThreadId, "");
  if (agentThreadId && agentThreadId !== sessionId) {
    refs.push({
      kind: "provider_thread",
      id: agentThreadId,
      label: "Provider thread evidence",
      confidence: "session_source",
    });
  }
  return refs;
}

function defaultResidentAgentInputForSession(session = {}) {
  const roleLane = agentRoleLaneFromSession(session);
  const agentClass = agentClassFromSession(session);
  return {
    agentId: normalizeString(session.agentId, ""),
    projectId: normalizeString(session.projectId, ""),
    roleLane,
    agentClass,
    displayName: `${roleLane} ${agentClass}`,
    identityConfidence: "backfilled",
    lifecycleState: "active",
    backfillPolicy: buildAgentBackfillPolicy(),
    sourceRefs: sessionSourceRefs(session),
  };
}

function buildAgentRegistryProjection(identities = [], links = [], runs = [], options = {}) {
  const projectId = normalizeString(options.projectId, "");
  const filteredIdentities = identities
    .filter((identity) => !projectId || identity.projectId === projectId)
    .sort((left, right) => {
      const laneCompare = String(left.roleLane || "").localeCompare(String(right.roleLane || ""));
      if (laneCompare) return laneCompare;
      return String(left.agentId || "").localeCompare(String(right.agentId || ""));
    });
  const linkCountByAgent = new Map();
  for (const link of links.filter((link) => !projectId || link.projectId === projectId)) {
    linkCountByAgent.set(link.agentId, (linkCountByAgent.get(link.agentId) || 0) + 1);
  }
  const runCountByAgent = new Map();
  const activeRunCountByAgent = new Map();
  const filteredRuns = runs.filter((run) => !projectId || run.projectId === projectId);
  for (const run of filteredRuns) {
    runCountByAgent.set(run.agentId, (runCountByAgent.get(run.agentId) || 0) + 1);
    if (["planned", "running", "waiting", "recovery_required"].includes(run.lifecycle)) {
      activeRunCountByAgent.set(run.agentId, (activeRunCountByAgent.get(run.agentId) || 0) + 1);
    }
  }
  const rows = filteredIdentities.map((identity) => ({
    agentId: identity.agentId,
    projectId: identity.projectId,
    agentClass: identity.agentClass,
    roleLane: identity.roleLane,
    displayName: identity.displayName,
    identityConfidence: identity.identityConfidence,
    lifecycleState: identity.lifecycleState,
    linkedThreadCount: linkCountByAgent.get(identity.agentId) || identity.linkedThreadIds?.length || 0,
    runCount: runCountByAgent.get(identity.agentId) || identity.activeRunIds?.length || 0,
    activeRunCount: activeRunCountByAgent.get(identity.agentId) || 0,
    updatedAt: identity.updatedAt,
    identityDigest: identity.identityDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  }));
  const projection = {
    schema: DIRECT_AGENT_REGISTRY_PROJECTION_SCHEMA,
    projectId,
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    rowCount: rows.length,
    backfilledCount: rows.filter((row) => row.identityConfidence === "backfilled").length,
    activeCount: rows.filter((row) => row.lifecycleState === "active").length,
    runCount: filteredRuns.length,
    activeRunCount: filteredRuns.filter((run) => ["planned", "running", "waiting", "recovery_required"].includes(run.lifecycle)).length,
    rows,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestValue("direct-agent-registry-projection@1", projection);
  return projection;
}

class DirectAgentRegistryStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("DirectAgentRegistryStore requires an explicit rootDir.");
    this.rootDir = path.resolve(rootDir);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
  }

  registryRoot() {
    return path.join(this.rootDir, "agent-registry");
  }

  indexPath() {
    return path.join(this.registryRoot(), "index.json");
  }

  identityPath(agentId) {
    return path.join(this.registryRoot(), "identities", safeSlotPart(agentId, "direct_agent"), "identity.json");
  }

  threadLinkPath(linkId) {
    return path.join(this.registryRoot(), "thread-links", `${safeSlotPart(linkId, "agent_thread_link")}.json`);
  }

  agentRunPath(agentRunId) {
    return path.join(this.registryRoot(), "runs", safeSlotPart(agentRunId, "direct_agent_run"), "run.json");
  }

  ensureRoot() {
    ensureDirectory(path.join(this.registryRoot(), "identities"));
    ensureDirectory(path.join(this.registryRoot(), "thread-links"));
    ensureDirectory(path.join(this.registryRoot(), "runs"));
    if (!fs.existsSync(this.indexPath())) this.writeIndex([], [], []);
  }

  buildIndex(agentRefs = [], threadLinkRefs = [], agentRunRefs = []) {
    const index = {
      schema: DIRECT_AGENT_REGISTRY_SCHEMA,
      updatedAt: nowIso(this.now()),
      agentRefs: Array.isArray(agentRefs) ? agentRefs : [],
      threadLinkRefs: Array.isArray(threadLinkRefs) ? threadLinkRefs : [],
      agentRunRefs: Array.isArray(agentRunRefs) ? agentRunRefs : [],
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
    index.registryDigest = digestValue("direct-agent-registry@1", index);
    return index;
  }

  readIndex() {
    return readJsonFile(this.indexPath()) || this.buildIndex([], [], []);
  }

  writeIndex(agentRefs, threadLinkRefs, agentRunRefs = []) {
    const index = this.buildIndex(agentRefs, threadLinkRefs, agentRunRefs);
    writeJsonAtomic(this.indexPath(), index);
    return index;
  }

  readAgentIdentity(agentId) {
    const id = normalizeString(agentId, "");
    if (!id) return null;
    return readJsonFile(this.identityPath(id));
  }

  readThreadLink(linkId) {
    const id = normalizeString(linkId, "");
    if (!id) return null;
    return readJsonFile(this.threadLinkPath(id));
  }

  readAgentRun(agentRunId) {
    const id = normalizeString(agentRunId, "");
    if (!id) return null;
    return readJsonFile(this.agentRunPath(id));
  }

  upsertAgentIdentity(input = {}, options = {}) {
    this.ensureRoot();
    const candidate = buildAgentIdentity(input, { nowMs: this.now() });
    const existing = this.readAgentIdentity(candidate.agentId);
    const merged = buildAgentIdentity({
      ...(existing || {}),
      ...candidate,
      createdAt: existing?.createdAt || candidate.createdAt,
      identityConfidence: mergeIdentityConfidence(existing?.identityConfidence, candidate.identityConfidence),
      linkedThreadIds: [...new Set([...(existing?.linkedThreadIds || []), ...(candidate.linkedThreadIds || [])])],
      activeRunIds: [...new Set([...(existing?.activeRunIds || []), ...(candidate.activeRunIds || [])])],
      sourceRefs: mergeRefs(existing?.sourceRefs, candidate.sourceRefs, "agent_identity_source"),
    }, { nowMs: this.now() });
    writeJsonAtomic(this.identityPath(merged.agentId), merged);
    if (options.skipIndexUpdate !== true) this.updateIndex({ identity: merged });
    return merged;
  }

  upsertThreadLink(input = {}, options = {}) {
    this.ensureRoot();
    const candidate = buildAgentThreadLink(input, { nowMs: this.now() });
    const legacyLinkId = agentThreadLinkIdFromParts(candidate, { includeRunRefs: false });
    const existing = this.readThreadLink(candidate.linkId)
      || (legacyLinkId !== candidate.linkId ? this.readThreadLink(legacyLinkId) : null);
    const migratedLegacyLinkId = existing?.linkId && existing.linkId !== candidate.linkId ? existing.linkId : "";
    const merged = buildAgentThreadLink({
      ...(existing || {}),
      ...candidate,
      linkId: candidate.linkId,
      createdAt: existing?.createdAt || candidate.createdAt,
      sourceRefs: mergeRefs(existing?.sourceRefs, candidate.sourceRefs, "agent_thread_link_source"),
    }, { nowMs: this.now() });
    writeJsonAtomic(this.threadLinkPath(merged.linkId), merged);
    if (migratedLegacyLinkId) {
      try {
        fs.unlinkSync(this.threadLinkPath(migratedLegacyLinkId));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    if (options.skipIndexUpdate !== true) {
      this.updateIndex({ threadLink: merged, removeThreadLinkIds: migratedLegacyLinkId ? [migratedLegacyLinkId] : [] });
    }
    return merged;
  }

  upsertAgentRun(input = {}, options = {}) {
    this.ensureRoot();
    const candidate = buildAgentRun(input, { nowMs: this.now() });
    const existing = this.readAgentRun(candidate.agentRunId);
    const merged = buildAgentRun({
      ...(existing || {}),
      ...candidate,
      createdAt: existing?.createdAt || candidate.createdAt,
      lifecycle: candidate.lifecycle === "planned" && existing?.lifecycle ? existing.lifecycle : candidate.lifecycle,
      contextPacketRefs: mergeRefs(existing?.contextPacketRefs, candidate.contextPacketRefs, "agent_run_context_packet"),
      requestManifestRefs: mergeRefs(existing?.requestManifestRefs, candidate.requestManifestRefs, "agent_run_request_manifest"),
      resultEnvelopeRefs: mergeRefs(existing?.resultEnvelopeRefs, candidate.resultEnvelopeRefs, "agent_run_result_envelope"),
      usageRefs: mergeRefs(existing?.usageRefs, candidate.usageRefs, "agent_run_usage"),
      sourceRefs: mergeRefs(existing?.sourceRefs, candidate.sourceRefs, "agent_run_source"),
    }, { nowMs: this.now() });
    writeJsonAtomic(this.agentRunPath(merged.agentRunId), merged);
    if (options.skipIndexUpdate !== true) this.updateIndex({ agentRun: merged });
    return merged;
  }

  updateIndex({ identity = null, threadLink = null, agentRun = null, identities = [], threadLinks = [], agentRuns = [], removeThreadLinkIds = [] } = {}) {
    const index = this.readIndex();
    const agentRefs = new Map((index.agentRefs || []).map((ref) => [ref.agentId, ref]));
    const threadLinkRefs = new Map((index.threadLinkRefs || []).map((ref) => [ref.linkId, ref]));
    const agentRunRefs = new Map((index.agentRunRefs || []).map((ref) => [ref.agentRunId, ref]));
    for (const removeId of Array.isArray(removeThreadLinkIds) ? removeThreadLinkIds : []) {
      threadLinkRefs.delete(removeId);
    }
    for (const entry of [identity, ...(Array.isArray(identities) ? identities : [])].filter(Boolean)) {
      agentRefs.set(entry.agentId, {
        agentId: entry.agentId,
        projectId: entry.projectId,
        agentClass: entry.agentClass,
        roleLane: entry.roleLane,
        identityConfidence: entry.identityConfidence,
        lifecycleState: entry.lifecycleState,
        updatedAt: entry.updatedAt,
        identityDigest: entry.identityDigest,
      });
    }
    for (const entry of [threadLink, ...(Array.isArray(threadLinks) ? threadLinks : [])].filter(Boolean)) {
      const legacyLinkId = agentThreadLinkIdFromParts(entry, { includeRunRefs: false });
      if (legacyLinkId && legacyLinkId !== entry.linkId) threadLinkRefs.delete(legacyLinkId);
      threadLinkRefs.set(entry.linkId, {
        linkId: entry.linkId,
        projectId: entry.projectId,
        agentId: entry.agentId,
        agentRunId: entry.agentRunId,
        threadId: entry.threadId,
        linkKind: entry.linkKind,
        relationship: entry.relationship,
        linkState: entry.linkState,
        updatedAt: entry.updatedAt,
        linkDigest: entry.linkDigest,
      });
    }
    for (const entry of [agentRun, ...(Array.isArray(agentRuns) ? agentRuns : [])].filter(Boolean)) {
      agentRunRefs.set(entry.agentRunId, {
        agentRunId: entry.agentRunId,
        projectId: entry.projectId,
        agentId: entry.agentId,
        runKind: entry.runKind,
        lifecycle: entry.lifecycle,
        startedAt: entry.startedAt,
        updatedAt: entry.updatedAt,
        runDigest: entry.runDigest,
      });
    }
    this.writeIndex(
      [...agentRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.roleLane).localeCompare(String(b.roleLane)) || String(a.agentId).localeCompare(String(b.agentId))),
      [...threadLinkRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.linkId).localeCompare(String(b.linkId))),
      [...agentRunRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.agentId).localeCompare(String(b.agentId)) || String(a.agentRunId).localeCompare(String(b.agentRunId))),
    );
  }

  listAgentIdentities(options = {}) {
    this.ensureRoot();
    const projectId = normalizeString(options.projectId, "");
    return (this.readIndex().agentRefs || [])
      .map((ref) => this.readAgentIdentity(ref.agentId))
      .filter(Boolean)
      .filter((identity) => !projectId || identity.projectId === projectId);
  }

  listThreadLinks(options = {}) {
    this.ensureRoot();
    const projectId = normalizeString(options.projectId, "");
    return (this.readIndex().threadLinkRefs || [])
      .map((ref) => this.readThreadLink(ref.linkId))
      .filter(Boolean)
      .filter((link) => !projectId || link.projectId === projectId);
  }

  listAgentRuns(options = {}) {
    this.ensureRoot();
    const projectId = normalizeString(options.projectId, "");
    const agentId = normalizeString(options.agentId, "");
    return (this.readIndex().agentRunRefs || [])
      .map((ref) => this.readAgentRun(ref.agentRunId))
      .filter(Boolean)
      .filter((run) => !projectId || run.projectId === projectId)
      .filter((run) => !agentId || run.agentId === agentId);
  }

  backfillFromSessionStore(sessionStore, options = {}) {
    if (!sessionStore || typeof sessionStore.listSessionIdsFromDisk !== "function") {
      throw new Error("DirectAgentRegistryStore.backfillFromSessionStore requires a DirectSessionStore-like object.");
    }
    this.ensureRoot();
    if (typeof sessionStore.ensure === "function") sessionStore.ensure();
    const projectId = normalizeString(options.projectId, "");
    const touchedAgentIds = new Set();
    const touchedRunIds = new Set();
    const touchedLinkIds = new Set();
    const updatedIdentities = [];
    const updatedAgentRuns = [];
    const updatedThreadLinks = [];
    for (const sessionId of sessionStore.listSessionIdsFromDisk()) {
      const session = sessionStore.readSession(sessionId);
      if (!session || session.schema !== "direct_codex_session@1") continue;
      if (projectId && normalizeString(session.projectId, "") !== projectId) continue;
      const agentInput = defaultResidentAgentInputForSession(session);
      let identity = this.upsertAgentIdentity({
        ...agentInput,
        linkedThreadIds: [session.sessionId],
        sourceRefs: sessionSourceRefs(session),
      }, { skipIndexUpdate: true });
      const run = this.upsertAgentRun(defaultAgentRunInputForSession(session, identity.agentId), { skipIndexUpdate: true });
      touchedRunIds.add(run.agentRunId);
      updatedAgentRuns.push(run);
      identity = this.upsertAgentIdentity({
        ...agentInput,
        linkedThreadIds: [session.sessionId],
        activeRunIds: [run.agentRunId],
        sourceRefs: sessionSourceRefs(session),
      }, { skipIndexUpdate: true });
      touchedAgentIds.add(identity.agentId);
      updatedIdentities.push(identity);
      const link = this.upsertThreadLink({
        projectId: identity.projectId,
        agentId: identity.agentId,
        agentRunId: run.agentRunId,
        threadId: session.sessionId,
        sessionId: session.sessionId,
        agentThreadId: session.agentThreadId,
        parentThreadId: session.parentThreadId,
        primaryThreadId: session.primaryThreadId,
        linkKind: threadLinkKindFromSession(session),
        relationship: threadRelationshipFromSession(session),
        linkState: "active",
        linkConfidence: "backfilled",
        sourceRefs: sessionSourceRefs(session),
      }, { skipIndexUpdate: true });
      touchedLinkIds.add(link.linkId);
      updatedThreadLinks.push(link);
    }
    if (updatedIdentities.length || updatedAgentRuns.length || updatedThreadLinks.length) {
      this.updateIndex({ identities: updatedIdentities, agentRuns: updatedAgentRuns, threadLinks: updatedThreadLinks });
    }
    const projection = this.buildProjection({ projectId });
    const status = this.status({ projectId, projection, threadLinkCount: projection.rows.reduce((count, row) => count + Number(row.linkedThreadCount || 0), 0) });
    return {
      schema: "direct_agent_registry_backfill_report@1",
      projectId,
      generatedAt: nowIso(this.now()),
      touchedAgentCount: touchedAgentIds.size,
      touchedAgentRunCount: touchedRunIds.size,
      touchedThreadLinkCount: touchedLinkIds.size,
      touchedAgentIds: [...touchedAgentIds].sort(),
      touchedAgentRunIds: [...touchedRunIds].sort(),
      touchedLinkIds: [...touchedLinkIds].sort(),
      projection,
      status,
      sessionRewritePerformed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }

  buildProjection(options = {}) {
    return buildAgentRegistryProjection(this.listAgentIdentities(options), this.listThreadLinks(options), this.listAgentRuns(options), {
      ...options,
      generatedAt: nowIso(this.now()),
      nowMs: this.now(),
    });
  }

  status(options = {}) {
    const projectId = normalizeString(options.projectId, "");
    try {
      const projection = isPlainObject(options.projection)
        ? options.projection
        : this.buildProjection({ projectId });
      const threadLinkCount = Number(options.threadLinkCount ?? this.listThreadLinks({ projectId }).length);
      const runCount = Number(options.runCount ?? projection.runCount ?? this.listAgentRuns({ projectId }).length);
      const state = projection.rowCount > 0 || threadLinkCount > 0 || runCount > 0 ? "healthy" : "recovery";
      const status = {
        schema: DIRECT_AGENT_REGISTRY_STATUS_SCHEMA,
        available: true,
        state,
        projectId,
        agentCount: projection.rowCount,
        backfilledCount: projection.backfilledCount,
        activeCount: projection.activeCount,
        runCount,
        activeRunCount: Number(projection.activeRunCount || 0),
        threadLinkCount,
        registryPathExposed: false,
        projectionDigest: projection.projectionDigest,
        updatedAt: projection.generatedAt,
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
      status.statusDigest = digestValue("direct-agent-registry-status@1", status);
      return status;
    } catch (error) {
      return {
        schema: DIRECT_AGENT_REGISTRY_STATUS_SCHEMA,
        available: false,
        state: "degraded",
        projectId,
        agentCount: 0,
        backfilledCount: 0,
        activeCount: 0,
        runCount: 0,
        activeRunCount: 0,
        threadLinkCount: 0,
        registryPathExposed: false,
        errorCode: normalizeString(error?.code || error?.name, "agent_registry_error"),
        errorMessage: boundedPreview(error?.message, 240),
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
    }
  }
}

module.exports = {
  DIRECT_AGENT_IDENTITY_SCHEMA,
  DIRECT_AGENT_RUN_SCHEMA,
  DIRECT_AGENT_REGISTRY_PROJECTION_SCHEMA,
  DIRECT_AGENT_REGISTRY_SCHEMA,
  DIRECT_AGENT_REGISTRY_STATUS_SCHEMA,
  DIRECT_AGENT_THREAD_LINK_SCHEMA,
  DirectAgentRegistryStore,
  agentIdFor,
  agentRunIdFor,
  buildAgentBackfillPolicy,
  buildAgentIdentity,
  buildAgentIdentityKey,
  buildAgentRegistryProjection,
  buildAgentRun,
  buildAgentThreadLink,
  defaultAgentRunInputForSession,
  defaultResidentAgentInputForSession,
};
