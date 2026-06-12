"use strict";

const crypto = require("node:crypto");

const DIRECT_AGENT_CLASS_REGISTRY_SCHEMA = "direct_agent_class_registry@1";
const DIRECT_AGENT_CLASS_SPEC_SCHEMA = "direct_agent_class_spec@1";
const DIRECT_AGENT_CLASS_STATUS_PROJECTION_SCHEMA = "direct_agent_class_status_projection@1";

const AGENT_CLASS_KINDS = new Set([
  "primary_agent",
  "implementation_worker",
  "audit_worker",
  "fix_worker",
  "closeout_worker",
  "meta_orchestrator",
  "work_thread_broker",
  "memory_compaction_worker",
  "governance_broker",
  "sub_agent_worker",
]);

const CONTEXT_FAMILIES = new Set([
  "operator_intent",
  "work_thread_identity",
  "authority_boundary",
  "context_packet",
  "implementation_evidence",
  "audit_artifact",
  "fix_request",
  "closure_packet",
  "workflow_plan",
  "routing_evidence",
  "memory_baton_omission",
  "governance_packet",
  "sub_agent_graph",
  "runtime_status",
]);

const ARTIFACT_FAMILIES = new Set([
  "implementation_evidence_artifact",
  "audit_artifact",
  "fix_artifact",
  "closeout_artifact",
  "workflow_transition_artifact",
  "work_target_resolution",
  "memory_baton_omission_witness",
  "governance_shadow_packet",
  "sub_agent_result_artifact",
  "operator_response",
  "diagnostic_status",
]);

const FORBIDDEN_CONFLATIONS = new Set([
  "worker_self_audits_completion",
  "auditor_mutates_object_artifact",
  "meta_orchestrator_performs_object_audit",
  "broker_executes_worker_task",
  "memory_becomes_policy_authority",
  "baton_becomes_replay_authority",
  "sub_agent_reply_becomes_primary_final",
  "router_uses_chat_recency_as_sole_authority",
  "skill_classification_enables_execution",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestFor(domain, value) {
  return sha256(`${domain}:${stableStringify(value)}`);
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && !Number.isNaN(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeList(values, allowedSet, fallback = "unknown") {
  const source = Array.isArray(values) ? values : [];
  const filtered = [...new Set(source
    .map((value) => normalizeString(value, ""))
    .filter((value) => allowedSet.has(value)))]
    .sort((a, b) => a.localeCompare(b));
  return filtered.length ? filtered : (allowedSet.has(fallback) ? [fallback] : []);
}

function normalizeEvidenceRef(input = {}, fallbackKind = "agent_class_spec") {
  const ref = isPlainObject(input) ? input : {};
  const output = {
    kind: normalizeString(ref.kind, fallbackKind),
    artifactId: normalizeString(ref.artifactId || ref.id, ""),
    artifactDigest: normalizeString(ref.artifactDigest || ref.digest, ""),
    sourceConfidence: normalizeString(ref.sourceConfidence, "declared_contract"),
    rendererSafeLabel: boundedString(ref.rendererSafeLabel || ref.label || fallbackKind, 160),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  output.refDigest = digestFor("direct-agent-class-evidence-ref@1", output);
  return output;
}

function normalizeEvidenceRefs(values, fallbackKind = "agent_class_spec") {
  return (Array.isArray(values) ? values : []).map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeAgentClassKind(value) {
  const kind = normalizeString(value, "sub_agent_worker");
  return AGENT_CLASS_KINDS.has(kind) ? kind : "sub_agent_worker";
}

function requestedExecutionAuthority(input = {}) {
  return Boolean(
    input.executionEnabledInThisPr ||
      input.routingEnabledInThisPr ||
      input.providerCallEnabledInThisPr ||
      input.workspaceMutationEnabledInThisPr ||
      input.objectAuditAutomationEnabledInThisPr ||
      input.subAgentSpawnEnabledInThisPr ||
      input.memoryMutationEnabledInThisPr ||
      input.providerCompactionEnabledInThisPr,
  );
}

function buildAuthorityContract(input = {}) {
  const authority = isPlainObject(input.authorityContract) ? input.authorityContract : input;
  return {
    mayProposeProviderRequest: authority.mayProposeProviderRequest === true,
    mayJudgeObjectValidity: authority.mayJudgeObjectValidity === true,
    mayRecommendWorkflowTransition: authority.mayRecommendWorkflowTransition === true,
    maySelectWorkflowTransition: authority.maySelectWorkflowTransition === true,
    mayResolveWorkTarget: authority.mayResolveWorkTarget === true,
    mayClassifyGovernance: authority.mayClassifyGovernance === true,
    mayConstructMemoryOrBaton: authority.mayConstructMemoryOrBaton === true,
    mayReadWorkspaceEvidence: authority.mayReadWorkspaceEvidence === true,
    mayProposeWorkspaceMutation: authority.mayProposeWorkspaceMutation === true,
    mayExecuteWorkspaceMutation: false,
    maySpawnSubAgent: false,
    mayCallProviderDirectly: false,
    mayMutateMemory: false,
    mayRunProviderCompaction: false,
    executionEnabledInThisPr: false,
    routingEnabledInThisPr: false,
    providerCallEnabledInThisPr: false,
    workspaceMutationEnabledInThisPr: false,
    objectAuditAutomationEnabledInThisPr: false,
    subAgentSpawnEnabledInThisPr: false,
    memoryMutationEnabledInThisPr: false,
    providerCompactionEnabledInThisPr: false,
    authorityInflationAttempted: requestedExecutionAuthority(authority),
  };
}

function buildAgentClassSpec(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const agentClassKind = normalizeAgentClassKind(source.agentClassKind || source.kind);
  const agentClassId = normalizeString(source.agentClassId || source.id, agentClassKind);
  const spec = {
    schema: DIRECT_AGENT_CLASS_SPEC_SCHEMA,
    agentClassId,
    agentClassKind,
    displayName: boundedString(source.displayName || source.name || agentClassKind, 160),
    contractVersion: normalizeString(source.contractVersion, "agent-class-contract@1"),
    purpose: boundedString(source.purpose || source.summary, 500),
    consumedContextFamilies: normalizeList(source.consumedContextFamilies, CONTEXT_FAMILIES),
    producedArtifactFamilies: normalizeList(source.producedArtifactFamilies, ARTIFACT_FAMILIES),
    authorityContract: buildAuthorityContract(source),
    forbiddenConflations: normalizeList(source.forbiddenConflations, FORBIDDEN_CONFLATIONS),
    handoffInputs: Array.isArray(source.handoffInputs) ? source.handoffInputs.map((item) => boundedString(item, 120)).filter(Boolean) : [],
    handoffOutputs: Array.isArray(source.handoffOutputs) ? source.handoffOutputs.map((item) => boundedString(item, 120)).filter(Boolean) : [],
    status: normalizeString(source.status, "declared_shadow"),
    executionStatus: "not_executable",
    routingStatus: "not_enforced",
    rendererSafeSummary: boundedString(source.rendererSafeSummary || `${agentClassKind} role contract is declared but not executable.`, 360),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "agent_class_spec"),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  spec.specDigest = digestFor("direct-agent-class-spec@1", spec);
  return spec;
}

function defaultAgentClassInputs() {
  return [
    {
      agentClassKind: "primary_agent",
      displayName: "Primary agent",
      purpose: "Owns the primary conversation with the operator and may propose work, but must not certify its own completion.",
      consumedContextFamilies: ["operator_intent", "work_thread_identity", "authority_boundary", "context_packet", "runtime_status"],
      producedArtifactFamilies: ["operator_response", "diagnostic_status"],
      authorityContract: { mayProposeProviderRequest: true, mayReadWorkspaceEvidence: true, mayProposeWorkspaceMutation: true },
      forbiddenConflations: ["worker_self_audits_completion", "sub_agent_reply_becomes_primary_final"],
    },
    {
      agentClassKind: "implementation_worker",
      displayName: "Implementation worker",
      purpose: "Produces object-level implementation artifacts and implementation evidence under a bounded work packet.",
      consumedContextFamilies: ["operator_intent", "work_thread_identity", "authority_boundary", "context_packet"],
      producedArtifactFamilies: ["implementation_evidence_artifact"],
      authorityContract: { mayProposeProviderRequest: true, mayReadWorkspaceEvidence: true, mayProposeWorkspaceMutation: true },
      forbiddenConflations: ["worker_self_audits_completion"],
    },
    {
      agentClassKind: "audit_worker",
      displayName: "Audit worker",
      purpose: "Judges implementation evidence against intent contracts without mutating the object artifact.",
      consumedContextFamilies: ["work_thread_identity", "authority_boundary", "implementation_evidence"],
      producedArtifactFamilies: ["audit_artifact"],
      authorityContract: { mayJudgeObjectValidity: true, mayRecommendWorkflowTransition: true, mayReadWorkspaceEvidence: true },
      forbiddenConflations: ["auditor_mutates_object_artifact"],
    },
    {
      agentClassKind: "fix_worker",
      displayName: "Fix worker",
      purpose: "Produces bounded fixes responding to audit findings; does not replace auditor verdicts.",
      consumedContextFamilies: ["work_thread_identity", "authority_boundary", "audit_artifact", "fix_request"],
      producedArtifactFamilies: ["fix_artifact", "implementation_evidence_artifact"],
      authorityContract: { mayProposeProviderRequest: true, mayReadWorkspaceEvidence: true, mayProposeWorkspaceMutation: true },
      forbiddenConflations: ["worker_self_audits_completion"],
    },
    {
      agentClassKind: "closeout_worker",
      displayName: "Closeout worker",
      purpose: "Produces closure evidence and promotion packets after required artifacts exist.",
      consumedContextFamilies: ["work_thread_identity", "audit_artifact", "implementation_evidence"],
      producedArtifactFamilies: ["closeout_artifact"],
      authorityContract: { mayRecommendWorkflowTransition: true },
      forbiddenConflations: ["meta_orchestrator_performs_object_audit"],
    },
    {
      agentClassKind: "meta_orchestrator",
      displayName: "Meta-orchestrator",
      purpose: "Maintains plan pointer and routes typed artifacts by transition law without performing deep object-level audit.",
      consumedContextFamilies: ["workflow_plan", "work_thread_identity", "audit_artifact", "closure_packet"],
      producedArtifactFamilies: ["workflow_transition_artifact"],
      authorityContract: { maySelectWorkflowTransition: true },
      forbiddenConflations: ["meta_orchestrator_performs_object_audit", "broker_executes_worker_task"],
    },
    {
      agentClassKind: "work_thread_broker",
      displayName: "Work-thread broker",
      purpose: "Resolves incoming operator requests to active work-thread ontology before mutation or delegation.",
      consumedContextFamilies: ["operator_intent", "work_thread_identity", "routing_evidence"],
      producedArtifactFamilies: ["work_target_resolution"],
      authorityContract: { mayResolveWorkTarget: true, mayRecommendWorkflowTransition: true },
      forbiddenConflations: ["broker_executes_worker_task", "router_uses_chat_recency_as_sole_authority"],
    },
    {
      agentClassKind: "memory_compaction_worker",
      displayName: "Memory/compaction worker",
      purpose: "Constructs memory, baton, omission, and context-loss witnesses without gaining replay or policy authority.",
      consumedContextFamilies: ["work_thread_identity", "memory_baton_omission", "context_packet"],
      producedArtifactFamilies: ["memory_baton_omission_witness"],
      authorityContract: { mayConstructMemoryOrBaton: true },
      forbiddenConflations: ["memory_becomes_policy_authority", "baton_becomes_replay_authority"],
    },
    {
      agentClassKind: "governance_broker",
      displayName: "Governance broker",
      purpose: "Classifies policy, route, and authority posture while remaining separate from object-level workers.",
      consumedContextFamilies: ["governance_packet", "work_thread_identity", "authority_boundary"],
      producedArtifactFamilies: ["governance_shadow_packet"],
      authorityContract: { mayClassifyGovernance: true, mayRecommendWorkflowTransition: true },
      forbiddenConflations: ["broker_executes_worker_task", "skill_classification_enables_execution"],
    },
    {
      agentClassKind: "sub_agent_worker",
      displayName: "Sub-agent worker",
      purpose: "Runs bounded delegated work streams whose dialogue must not flatten into the primary transcript.",
      consumedContextFamilies: ["sub_agent_graph", "work_thread_identity", "authority_boundary", "context_packet"],
      producedArtifactFamilies: ["sub_agent_result_artifact", "implementation_evidence_artifact"],
      authorityContract: { mayProposeProviderRequest: true, mayReadWorkspaceEvidence: true, mayProposeWorkspaceMutation: true },
      forbiddenConflations: ["sub_agent_reply_becomes_primary_final", "worker_self_audits_completion"],
    },
  ];
}

function buildAgentClassRegistry(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const specs = (Array.isArray(source.specs) && source.specs.length ? source.specs : defaultAgentClassInputs())
    .map((spec) => buildAgentClassSpec(spec))
    .sort((a, b) => a.agentClassKind.localeCompare(b.agentClassKind));
  const registrySource = {
    specs: specs.map((spec) => ({
      agentClassId: spec.agentClassId,
      agentClassKind: spec.agentClassKind,
      specDigest: spec.specDigest,
      consumedContextFamilies: spec.consumedContextFamilies,
      producedArtifactFamilies: spec.producedArtifactFamilies,
    })),
  };
  const registryDigest = digestFor("direct-agent-class-registry-source@1", registrySource);
  const registry = {
    schema: DIRECT_AGENT_CLASS_REGISTRY_SCHEMA,
    registryId: normalizeString(source.registryId, `agent_class_registry_${registryDigest.slice(0, 24)}`),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    mode: normalizeString(source.mode, "shadow"),
    specCount: specs.length,
    specs,
    registrySourceDigest: registryDigest,
    executionEnabledInThisPr: false,
    routingEnabledInThisPr: false,
    providerCallEnabledInThisPr: false,
    workspaceMutationEnabledInThisPr: false,
    objectAuditAutomationEnabledInThisPr: false,
    subAgentSpawnEnabledInThisPr: false,
    memoryMutationEnabledInThisPr: false,
    providerCompactionEnabledInThisPr: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
  };
  registry.registryDigest = digestFor("direct-agent-class-registry@1", registry);
  return registry;
}

function buildAgentClassStatusProjection(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const registry = isPlainObject(source.registry) ? source.registry : buildAgentClassRegistry(source);
  const specs = Array.isArray(registry.specs) ? registry.specs : [];
  const authorityInflationAttempted = specs.some((spec) => spec.authorityContract?.authorityInflationAttempted === true);
  const byKind = specs.reduce((acc, spec) => {
    acc[spec.agentClassKind] = (acc[spec.agentClassKind] || 0) + 1;
    return acc;
  }, {});
  const projection = {
    schema: DIRECT_AGENT_CLASS_STATUS_PROJECTION_SCHEMA,
    projectId: normalizeString(source.projectId, registry.projectId || ""),
    workThreadId: normalizeString(source.workThreadId, registry.workThreadId || ""),
    uiProjectionGeneration: Number(source.uiProjectionGeneration || 1),
    registryId: normalizeString(registry.registryId, ""),
    registryDigest: normalizeString(registry.registryDigest, ""),
    status: normalizeString(source.status, "shadow_only"),
    specCount: specs.length,
    byKind,
    executionEnabledInThisPr: false,
    routingEnabledInThisPr: false,
    providerCallEnabledInThisPr: false,
    workspaceMutationEnabledInThisPr: false,
    objectAuditAutomationEnabledInThisPr: false,
    subAgentSpawnEnabledInThisPr: false,
    memoryMutationEnabledInThisPr: false,
    providerCompactionEnabledInThisPr: false,
    actionable: false,
    authorityInflationAttempted,
    rendererSafeSummary: boundedString(
      source.rendererSafeSummary || "Agent role contracts are declared for inspection only; no worker routing or execution is enabled.",
      360,
    ),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("direct-agent-class-status-projection@1", projection);
  return projection;
}

function validateAgentClassRegistry(registry = {}) {
  if (!isPlainObject(registry) || registry.schema !== DIRECT_AGENT_CLASS_REGISTRY_SCHEMA) {
    throw new Error("direct_agent_class_registry_schema_mismatch");
  }
  const specs = Array.isArray(registry.specs) ? registry.specs : [];
  if (!specs.length) throw new Error("direct_agent_class_registry_empty");
  for (const spec of specs) {
    if (spec.schema !== DIRECT_AGENT_CLASS_SPEC_SCHEMA) throw new Error(`direct_agent_class_spec_schema_mismatch:${spec.agentClassId || ""}`);
    if (!AGENT_CLASS_KINDS.has(spec.agentClassKind)) throw new Error(`direct_agent_class_kind_invalid:${spec.agentClassKind || ""}`);
    if (spec.executionStatus !== "not_executable" || spec.routingStatus !== "not_enforced") {
      throw new Error(`direct_agent_class_authority_enabled:${spec.agentClassId}`);
    }
    for (const flag of [
      "executionEnabledInThisPr",
      "routingEnabledInThisPr",
      "providerCallEnabledInThisPr",
      "workspaceMutationEnabledInThisPr",
      "objectAuditAutomationEnabledInThisPr",
      "subAgentSpawnEnabledInThisPr",
      "memoryMutationEnabledInThisPr",
      "providerCompactionEnabledInThisPr",
    ]) {
      if (spec.authorityContract?.[flag] !== false || registry[flag] !== false) {
        throw new Error(`direct_agent_class_authority_leak:${flag}`);
      }
    }
    if (spec.rawTextIncluded !== false || spec.rawSecretIncluded !== false) {
      throw new Error(`direct_agent_class_raw_exposure:${spec.agentClassId}`);
    }
  }
  return true;
}

module.exports = {
  AGENT_CLASS_KINDS,
  ARTIFACT_FAMILIES,
  CONTEXT_FAMILIES,
  DIRECT_AGENT_CLASS_REGISTRY_SCHEMA,
  DIRECT_AGENT_CLASS_SPEC_SCHEMA,
  DIRECT_AGENT_CLASS_STATUS_PROJECTION_SCHEMA,
  FORBIDDEN_CONFLATIONS,
  buildAgentClassRegistry,
  buildAgentClassSpec,
  buildAgentClassStatusProjection,
  defaultAgentClassInputs,
  stableStringify,
  validateAgentClassRegistry,
};
