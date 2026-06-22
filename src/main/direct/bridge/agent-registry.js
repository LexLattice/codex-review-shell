"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIRECT_AGENT_REGISTRY_SCHEMA = "direct_agent_registry@1";
const DIRECT_AGENT_IDENTITY_SCHEMA = "direct_agent_identity@1";
const DIRECT_AGENT_THREAD_LINK_SCHEMA = "direct_agent_thread_link@1";
const DIRECT_AGENT_REGISTRY_PROJECTION_SCHEMA = "direct_agent_registry_projection@1";
const DIRECT_AGENT_REGISTRY_STATUS_SCHEMA = "direct_agent_registry_status@1";

const IDENTITY_CONFIDENCE = new Set(["exact", "declared", "backfilled", "inferred", "unknown"]);
const IDENTITY_LIFECYCLE_STATES = new Set(["active", "idle", "archived", "superseded", "unknown"]);
const THREAD_LINK_RELATIONSHIPS = new Set(["primary_thread", "continuation_thread", "worker_thread", "observer_thread", "unknown"]);
const THREAD_LINK_STATES = new Set(["active", "inactive", "stale", "unknown"]);

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

function normalizeIdentityConfidence(value) {
  const confidence = normalizeString(value, "unknown");
  return IDENTITY_CONFIDENCE.has(confidence) ? confidence : "unknown";
}

function normalizeLifecycleState(value) {
  const state = normalizeString(value, "active");
  return IDENTITY_LIFECYCLE_STATES.has(state) ? state : "unknown";
}

function normalizeThreadLinkRelationship(value) {
  const relationship = normalizeString(value, "unknown");
  return THREAD_LINK_RELATIONSHIPS.has(relationship) ? relationship : "unknown";
}

function normalizeThreadLinkState(value) {
  const state = normalizeString(value, "active");
  return THREAD_LINK_STATES.has(state) ? state : "unknown";
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

function buildAgentThreadLink(input = {}, options = {}) {
  const now = normalizeString(input.updatedAt, nowIso(options.nowMs));
  const agentId = safeSlotPart(input.agentId, "direct_agent");
  const threadId = safeSlotPart(input.threadId || input.sessionId, "direct_session");
  const relationship = normalizeThreadLinkRelationship(input.relationship || input.linkKind);
  const linkId = safeSlotPart(
    input.linkId || `agent_thread_link_${sha256(stableJson({
      projectId: normalizeString(input.projectId, ""),
      agentId,
      threadId,
      relationship,
    })).slice(0, 24)}`,
    "agent_thread_link",
  );
  const link = {
    schema: DIRECT_AGENT_THREAD_LINK_SCHEMA,
    linkId,
    projectId: normalizeString(input.projectId, ""),
    agentId,
    threadId,
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
  if (normalizeString(session.parentThreadId, "")) return "worker_thread";
  if (normalizeString(session.agentKind, "")) return "worker_thread";
  return "primary_thread";
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

function buildAgentRegistryProjection(identities = [], links = [], options = {}) {
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
  const rows = filteredIdentities.map((identity) => ({
    agentId: identity.agentId,
    projectId: identity.projectId,
    agentClass: identity.agentClass,
    roleLane: identity.roleLane,
    displayName: identity.displayName,
    identityConfidence: identity.identityConfidence,
    lifecycleState: identity.lifecycleState,
    linkedThreadCount: linkCountByAgent.get(identity.agentId) || identity.linkedThreadIds?.length || 0,
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

  ensureRoot() {
    ensureDirectory(path.join(this.registryRoot(), "identities"));
    ensureDirectory(path.join(this.registryRoot(), "thread-links"));
    if (!fs.existsSync(this.indexPath())) this.writeIndex([], []);
  }

  buildIndex(agentRefs = [], threadLinkRefs = []) {
    const index = {
      schema: DIRECT_AGENT_REGISTRY_SCHEMA,
      updatedAt: nowIso(this.now()),
      agentRefs: Array.isArray(agentRefs) ? agentRefs : [],
      threadLinkRefs: Array.isArray(threadLinkRefs) ? threadLinkRefs : [],
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
    index.registryDigest = digestValue("direct-agent-registry@1", index);
    return index;
  }

  readIndex() {
    return readJsonFile(this.indexPath()) || this.buildIndex([], []);
  }

  writeIndex(agentRefs, threadLinkRefs) {
    const index = this.buildIndex(agentRefs, threadLinkRefs);
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

  upsertAgentIdentity(input = {}) {
    this.ensureRoot();
    const candidate = buildAgentIdentity(input, { nowMs: this.now() });
    const existing = this.readAgentIdentity(candidate.agentId);
    const merged = buildAgentIdentity({
      ...(existing || {}),
      ...candidate,
      createdAt: existing?.createdAt || candidate.createdAt,
      linkedThreadIds: [...new Set([...(existing?.linkedThreadIds || []), ...(candidate.linkedThreadIds || [])])],
      activeRunIds: [...new Set([...(existing?.activeRunIds || []), ...(candidate.activeRunIds || [])])],
      sourceRefs: [...(existing?.sourceRefs || []), ...(candidate.sourceRefs || [])],
    }, { nowMs: this.now() });
    writeJsonAtomic(this.identityPath(merged.agentId), merged);
    this.updateIndex({ identity: merged });
    return merged;
  }

  upsertThreadLink(input = {}) {
    this.ensureRoot();
    const candidate = buildAgentThreadLink(input, { nowMs: this.now() });
    const existing = this.readThreadLink(candidate.linkId);
    const merged = buildAgentThreadLink({
      ...(existing || {}),
      ...candidate,
      createdAt: existing?.createdAt || candidate.createdAt,
      sourceRefs: [...(existing?.sourceRefs || []), ...(candidate.sourceRefs || [])],
    }, { nowMs: this.now() });
    writeJsonAtomic(this.threadLinkPath(merged.linkId), merged);
    this.updateIndex({ threadLink: merged });
    return merged;
  }

  updateIndex({ identity = null, threadLink = null } = {}) {
    const index = this.readIndex();
    const agentRefs = new Map((index.agentRefs || []).map((ref) => [ref.agentId, ref]));
    const threadLinkRefs = new Map((index.threadLinkRefs || []).map((ref) => [ref.linkId, ref]));
    if (identity) {
      agentRefs.set(identity.agentId, {
        agentId: identity.agentId,
        projectId: identity.projectId,
        agentClass: identity.agentClass,
        roleLane: identity.roleLane,
        identityConfidence: identity.identityConfidence,
        lifecycleState: identity.lifecycleState,
        updatedAt: identity.updatedAt,
        identityDigest: identity.identityDigest,
      });
    }
    if (threadLink) {
      threadLinkRefs.set(threadLink.linkId, {
        linkId: threadLink.linkId,
        projectId: threadLink.projectId,
        agentId: threadLink.agentId,
        threadId: threadLink.threadId,
        relationship: threadLink.relationship,
        linkState: threadLink.linkState,
        updatedAt: threadLink.updatedAt,
        linkDigest: threadLink.linkDigest,
      });
    }
    this.writeIndex(
      [...agentRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.roleLane).localeCompare(String(b.roleLane)) || String(a.agentId).localeCompare(String(b.agentId))),
      [...threadLinkRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.linkId).localeCompare(String(b.linkId))),
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

  backfillFromSessionStore(sessionStore, options = {}) {
    if (!sessionStore || typeof sessionStore.listSessionIdsFromDisk !== "function") {
      throw new Error("DirectAgentRegistryStore.backfillFromSessionStore requires a DirectSessionStore-like object.");
    }
    this.ensureRoot();
    if (typeof sessionStore.ensure === "function") sessionStore.ensure();
    const projectId = normalizeString(options.projectId, "");
    const touchedAgentIds = new Set();
    const touchedLinkIds = new Set();
    for (const sessionId of sessionStore.listSessionIdsFromDisk()) {
      const session = sessionStore.readSession(sessionId);
      if (!session || session.schema !== "direct_codex_session@1") continue;
      if (projectId && normalizeString(session.projectId, "") !== projectId) continue;
      const agentInput = defaultResidentAgentInputForSession(session);
      const priorAgent = this.readAgentIdentity(agentIdFor(agentInput));
      const identity = this.upsertAgentIdentity({
        ...(priorAgent || {}),
        ...agentInput,
        linkedThreadIds: [...new Set([...(priorAgent?.linkedThreadIds || []), session.sessionId])],
        sourceRefs: [...(priorAgent?.sourceRefs || []), ...sessionSourceRefs(session)],
      });
      touchedAgentIds.add(identity.agentId);
      const link = this.upsertThreadLink({
        projectId: identity.projectId,
        agentId: identity.agentId,
        threadId: session.sessionId,
        sessionId: session.sessionId,
        agentThreadId: session.agentThreadId,
        parentThreadId: session.parentThreadId,
        primaryThreadId: session.primaryThreadId,
        relationship: threadRelationshipFromSession(session),
        linkState: "active",
        linkConfidence: "backfilled",
        sourceRefs: sessionSourceRefs(session),
      });
      touchedLinkIds.add(link.linkId);
    }
    const projection = this.buildProjection({ projectId });
    return {
      schema: "direct_agent_registry_backfill_report@1",
      projectId,
      generatedAt: nowIso(this.now()),
      touchedAgentCount: touchedAgentIds.size,
      touchedThreadLinkCount: touchedLinkIds.size,
      touchedAgentIds: [...touchedAgentIds].sort(),
      touchedLinkIds: [...touchedLinkIds].sort(),
      projection,
      status: this.status({ projectId }),
      sessionRewritePerformed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }

  buildProjection(options = {}) {
    return buildAgentRegistryProjection(this.listAgentIdentities(options), this.listThreadLinks(options), {
      ...options,
      generatedAt: nowIso(this.now()),
      nowMs: this.now(),
    });
  }

  status(options = {}) {
    const projectId = normalizeString(options.projectId, "");
    try {
      const projection = this.buildProjection({ projectId });
      const links = this.listThreadLinks({ projectId });
      const state = projection.rowCount > 0 || links.length > 0 ? "healthy" : "recovery";
      const status = {
        schema: DIRECT_AGENT_REGISTRY_STATUS_SCHEMA,
        available: true,
        state,
        projectId,
        agentCount: projection.rowCount,
        backfilledCount: projection.backfilledCount,
        activeCount: projection.activeCount,
        threadLinkCount: links.length,
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
  DIRECT_AGENT_REGISTRY_PROJECTION_SCHEMA,
  DIRECT_AGENT_REGISTRY_SCHEMA,
  DIRECT_AGENT_REGISTRY_STATUS_SCHEMA,
  DIRECT_AGENT_THREAD_LINK_SCHEMA,
  DirectAgentRegistryStore,
  agentIdFor,
  buildAgentBackfillPolicy,
  buildAgentIdentity,
  buildAgentIdentityKey,
  buildAgentRegistryProjection,
  buildAgentThreadLink,
  defaultResidentAgentInputForSession,
};
