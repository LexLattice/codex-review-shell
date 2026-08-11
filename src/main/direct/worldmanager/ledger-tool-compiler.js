"use strict";

const crypto = require("node:crypto");

const LEDGER_TOOL_OPERATION_REGISTRY_SCHEMA =
  "direct_ledger_tool_operation_registry@1";
const ROLE_LEDGER_TOOL_BUNDLE_SCHEMA =
  "direct_role_ledger_tool_bundle@1";
const LEDGER_CALL_DECISION_SCHEMA =
  "direct_ledger_call_decision@1";

const ROLE_LANES = new Set([
  "implementation_worker",
  "review_auditor",
  "project_manager",
  "world_manager",
  "meta_orchestrator",
  "headless_daemon",
]);

const RIGHTS = new Set([
  "observe",
  "propose",
  "challenge",
  "assess",
  "admit",
  "authorize",
  "execute",
  "subscribe",
  "acknowledge",
]);

const COMMON_FIELDS = Object.freeze({
  subjectScope: {
    type: "object",
    description:
      "Exact semantic subject scope for this act. Scope does not grant authority.",
    properties: {
      kind: {
        type: "string",
        enum: ["user_world", "project", "work_thread", "artifact", "agent_run"],
      },
      userWorldId: { type: "string" },
      projectId: { type: "string" },
      workThreadId: { type: "string" },
      artifactLifecycleId: { type: "string" },
      agentRunId: { type: "string" },
    },
    required: ["kind", "userWorldId"],
    additionalProperties: false,
  },
  objectRefs: {
    type: "array",
    items: { $ref: "#/$defs/exactRef" },
    maxItems: 64,
  },
  evidenceRefs: {
    type: "array",
    items: { $ref: "#/$defs/exactRef" },
    maxItems: 64,
  },
  affectsRefs: {
    type: "array",
    items: { $ref: "#/$defs/exactRef" },
    maxItems: 64,
  },
  expectedRevisionVector: {
    type: "array",
    items: {
      type: "object",
      properties: {
        scopeKind: { type: "string" },
        scopeId: { type: "string" },
        revision: { type: "integer", minimum: 0 },
        digest: { type: "string" },
      },
      required: ["scopeKind", "scopeId", "revision", "digest"],
      additionalProperties: false,
    },
    maxItems: 32,
  },
  semanticPayload: {
    type: "object",
    description:
      "Open semantic content governed by the selected act type. Shape is validated; semantic truth is not reverse-validated by the harness.",
    additionalProperties: true,
  },
  rendererSafeSummary: { type: "string", maxLength: 1200 },
  idempotencyKey: { type: "string", minLength: 1, maxLength: 320 },
});

const EXACT_REF_DEF = Object.freeze({
  type: "object",
  properties: {
    kind: { type: "string" },
    id: { type: "string" },
    digest: { type: "string" },
  },
  required: ["kind", "id", "digest"],
  additionalProperties: false,
});

const OPERATION_ROWS = Object.freeze([
  ["ledger_publish_observation", "observation", "observe", ["implementation_worker", "review_auditor", "project_manager", "world_manager"], false],
  ["ledger_propose_claim", "proposal", "propose", ["implementation_worker", "review_auditor", "project_manager", "world_manager", "meta_orchestrator"], false],
  ["ledger_attach_evidence", "observation", "propose", ["implementation_worker", "review_auditor", "project_manager", "world_manager"], false],
  ["ledger_raise_contradiction", "challenge", "challenge", ["implementation_worker", "review_auditor", "project_manager", "world_manager"], false],
  ["ledger_raise_blocker", "challenge", "challenge", ["implementation_worker", "review_auditor", "project_manager", "world_manager"], false],
  ["ledger_request_authorization", "request", "propose", ["implementation_worker", "review_auditor", "project_manager", "meta_orchestrator"], false],
  ["ledger_report_progress", "observation", "propose", ["implementation_worker", "project_manager", "meta_orchestrator"], false],
  ["ledger_submit_candidate_artifact", "proposal", "propose", ["implementation_worker", "project_manager", "world_manager"], false],
  ["ledger_submit_closure", "proposal", "propose", ["implementation_worker", "review_auditor", "project_manager"], false],
  ["ledger_retract_candidate", "retraction", "propose", ["implementation_worker", "review_auditor", "project_manager", "world_manager"], false],
  ["ledger_ack_delivery", "mechanical_witness", "acknowledge", ["implementation_worker", "review_auditor", "project_manager", "world_manager", "meta_orchestrator", "headless_daemon"], false],
  ["ledger_import_delivery_context", "request", "observe", ["implementation_worker", "review_auditor", "project_manager", "world_manager", "meta_orchestrator"], false],
  ["ledger_challenge_claim", "challenge", "challenge", ["review_auditor"], false],
  ["ledger_request_evidence", "request", "assess", ["review_auditor"], false],
  ["ledger_submit_audit_verdict", "assessment", "assess", ["review_auditor"], false],
  ["ledger_validate_closure_candidate", "assessment", "assess", ["review_auditor"], false],
  ["ledger_activate_artifact_request", "authorization", "authorize", ["project_manager", "world_manager", "meta_orchestrator"], false],
  ["ledger_assign_obligation", "authorization", "authorize", ["project_manager", "world_manager"], false],
  ["ledger_remand_artifact", "assessment", "assess", ["project_manager", "world_manager"], false],
  ["ledger_admit_project_delta", "admission", "admit", ["project_manager", "world_manager"], true],
  ["ledger_resolve_project_scope", "assessment", "assess", ["project_manager", "world_manager"], false],
  ["ledger_resolve_world_scope", "assessment", "assess", ["world_manager"], false],
  ["ledger_admit_canonical", "admission", "admit", ["world_manager"], true],
  ["ledger_supersede_canonical", "admission", "admit", ["world_manager"], true],
  ["ledger_authorize_transition", "authorization", "authorize", ["world_manager"], true],
  ["ledger_admit_artifact_type_constitution", "admission", "admit", ["world_manager"], true],
  ["ledger_modify_policy", "admission", "admit", ["world_manager"], true],
  ["ledger_create_watch", "request", "subscribe", ["implementation_worker", "review_auditor", "project_manager", "world_manager", "meta_orchestrator"], false],
  ["ledger_revise_watch", "request", "subscribe", ["implementation_worker", "review_auditor", "project_manager", "world_manager", "meta_orchestrator"], false],
  ["ledger_remove_watch", "request", "subscribe", ["implementation_worker", "review_auditor", "project_manager", "world_manager", "meta_orchestrator"], false],
  ["ledger_publish_mechanical_witness", "mechanical_witness", "observe", ["headless_daemon"], false],
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableValue(value, omitted = new Set()) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, omitted));
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (!omitted.has(key) && typeof value[key] !== "undefined") {
      output[key] = stableValue(value[key], omitted);
    }
    return output;
  }, {});
}

function digestFor(domain, value, omitted = []) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value, new Set(omitted)))}`)
    .digest("hex")}`;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function exactRef(value, label = "ref") {
  const ref = {
    kind: text(value?.kind, ""),
    id: text(value?.id || value?.refId, ""),
    digest: text(value?.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!ref.kind || !ref.id || !ref.digest) fail("ledger_tool_ref_invalid", label);
  return ref;
}

function scopeFrom(value = {}) {
  const scope = {
    kind: text(value.kind, "user_world"),
    userWorldId: text(value.userWorldId, "user_world_local"),
    projectId: text(value.projectId, ""),
    workThreadId: text(value.workThreadId, ""),
    artifactLifecycleId: text(value.artifactLifecycleId, ""),
    agentRunId: text(value.agentRunId, ""),
  };
  if (
    !["user_world", "project", "work_thread", "artifact", "agent_run"].includes(scope.kind) ||
    (scope.kind === "project" && !scope.projectId) ||
    (scope.kind === "work_thread" && (!scope.projectId || !scope.workThreadId)) ||
    (scope.kind === "artifact" && !scope.artifactLifecycleId) ||
    (scope.kind === "agent_run" && !scope.agentRunId)
  ) {
    fail("ledger_tool_scope_invalid", scope.kind);
  }
  return scope;
}

function parametersFor(operationName) {
  const operationSpecific = {};
  const required = ["subjectScope", "semanticPayload", "rendererSafeSummary", "idempotencyKey"];
  if (operationName.includes("delivery_context")) {
    operationSpecific.deliveryRef = { $ref: "#/$defs/exactRef" };
    required.push("deliveryRef");
  }
  if (operationName === "ledger_ack_delivery") {
    operationSpecific.deliveryRef = { $ref: "#/$defs/exactRef" };
    operationSpecific.expectedCursor = { type: "integer", minimum: 0 };
    required.push("deliveryRef", "expectedCursor");
  }
  if (operationName.endsWith("watch")) {
    operationSpecific.watchRef = { $ref: "#/$defs/exactRef" };
  }
  return {
    type: "object",
    properties: { ...COMMON_FIELDS, ...operationSpecific },
    required,
    additionalProperties: false,
    $defs: { exactRef: EXACT_REF_DEF },
  };
}

function operationRegistry(options = {}) {
  const operations = OPERATION_ROWS.map(([
    operationName,
    actClass,
    requiredRight,
    allowedRoleLanes,
    authorityBearing,
  ]) => {
    const operation = {
      operationName,
      conceptualName: operationName.replace(/^ledger_/, "ledger.").replace(/_/g, "_"),
      actClass,
      requiredRight,
      allowedRoleLanes: [...allowedRoleLanes],
      authorityBearing,
      canonicalEffectWithoutExternalReceipt: false,
      providerDeclaration: {
        type: "function",
        name: operationName,
        description: `${operationName.replace(/^ledger_/, "Ledger ").replace(/_/g, " ")}. The operation preserves typed semantic force and does not grant authority beyond the caller's compiled constitution.`,
        parameters: parametersFor(operationName),
        strict: true,
      },
    };
    operation.operationDigest = digestFor("direct-ledger-tool-operation@1", operation);
    return Object.freeze(operation);
  });
  const registry = {
    schema: LEDGER_TOOL_OPERATION_REGISTRY_SCHEMA,
    registryId: text(options.registryId, "direct_ledger_tool_operation_registry"),
    revision: 1,
    operations,
    unrestrictedWriteAvailable: false,
    semanticContentReverseValidated: false,
    generatedAt: text(options.generatedAt, nowIso(options.now)),
  };
  registry.digest = digestFor(LEDGER_TOOL_OPERATION_REGISTRY_SCHEMA, registry, ["digest"]);
  validateOperationRegistry(registry);
  return registry;
}

function validateOperationRegistry(registry) {
  if (
    !isPlainObject(registry) ||
    registry.schema !== LEDGER_TOOL_OPERATION_REGISTRY_SCHEMA ||
    !Array.isArray(registry.operations) ||
    !registry.operations.length ||
    registry.unrestrictedWriteAvailable !== false ||
    registry.semanticContentReverseValidated !== false
  ) {
    fail("ledger_tool_registry_invalid");
  }
  const names = new Set();
  for (const operation of registry.operations) {
    if (
      !text(operation.operationName, "") ||
      operation.operationName === "ledger_write" ||
      names.has(operation.operationName) ||
      !RIGHTS.has(operation.requiredRight) ||
      !Array.isArray(operation.allowedRoleLanes) ||
      operation.allowedRoleLanes.some((role) => !ROLE_LANES.has(role)) ||
      operation.canonicalEffectWithoutExternalReceipt !== false ||
      operation.providerDeclaration?.name !== operation.operationName
    ) {
      fail("ledger_tool_operation_invalid", operation.operationName);
    }
    names.add(operation.operationName);
  }
  if (registry.digest !== digestFor(LEDGER_TOOL_OPERATION_REGISTRY_SCHEMA, registry, ["digest"])) {
    fail("ledger_tool_registry_digest_invalid");
  }
  return true;
}

function compileRoleLedgerToolBundle(input = {}) {
  const registry = input.registry || operationRegistry({ now: input.now });
  validateOperationRegistry(registry);
  const roleLane = text(input.roleLane || input.role, "");
  if (!ROLE_LANES.has(roleLane)) fail("ledger_tool_role_lane_invalid", roleLane);
  const scope = scopeFrom(input.scope || {});
  const allowedRights = new Set(
    (Array.isArray(input.allowedRights) ? input.allowedRights : [...RIGHTS])
      .filter((right) => RIGHTS.has(right)),
  );
  const disabledOperations = new Set(
    (Array.isArray(input.disabledOperations) ? input.disabledOperations : []).map((value) => text(value, "")),
  );
  const canonicalAdmissionEnabled = input.canonicalAdmissionEnabled === true;
  const operations = registry.operations.filter((operation) =>
    operation.allowedRoleLanes.includes(roleLane) &&
    allowedRights.has(operation.requiredRight) &&
    !disabledOperations.has(operation.operationName) &&
    (!operation.authorityBearing || canonicalAdmissionEnabled),
  );
  const bundle = {
    schema: ROLE_LEDGER_TOOL_BUNDLE_SCHEMA,
    bundleId: text(
      input.bundleId,
      `role_ledger_tool_bundle_${digestFor("direct-role-ledger-tool-bundle-id@1", {
        roleLane,
        scope,
        operationNames: operations.map((operation) => operation.operationName),
      }).slice(7, 31)}`,
    ),
    roleLane,
    actorRef: exactRef(input.actorRef, "actorRef"),
    agentWorldRef: exactRef(input.agentWorldRef, "agentWorldRef"),
    authorityBoundaryRef: exactRef(input.authorityBoundaryRef, "authorityBoundaryRef"),
    scope,
    rights: [...allowedRights].sort(),
    operationNames: operations.map((operation) => operation.operationName),
    providerDeclarations: operations.map((operation) => operation.providerDeclaration),
    authorityBearingOperationNames: operations
      .filter((operation) => operation.authorityBearing)
      .map((operation) => operation.operationName),
    unrestrictedWriteAvailable: false,
    canonicalAdmissionEnabled,
    perCallDecisionRequired: true,
    compiledAt: text(input.compiledAt, nowIso(input.now)),
    grantsAuthority: false,
  };
  bundle.digest = digestFor(ROLE_LEDGER_TOOL_BUNDLE_SCHEMA, bundle, ["digest"]);
  validateRoleLedgerToolBundle(bundle, registry);
  return bundle;
}

function validateRoleLedgerToolBundle(bundle, registry = operationRegistry()) {
  if (
    !isPlainObject(bundle) ||
    bundle.schema !== ROLE_LEDGER_TOOL_BUNDLE_SCHEMA ||
    !ROLE_LANES.has(bundle.roleLane) ||
    !Array.isArray(bundle.operationNames) ||
    !Array.isArray(bundle.providerDeclarations) ||
    bundle.unrestrictedWriteAvailable !== false ||
    bundle.perCallDecisionRequired !== true ||
    bundle.grantsAuthority !== false
  ) {
    fail("role_ledger_tool_bundle_invalid");
  }
  exactRef(bundle.actorRef, "bundle.actorRef");
  exactRef(bundle.agentWorldRef, "bundle.agentWorldRef");
  exactRef(bundle.authorityBoundaryRef, "bundle.authorityBoundaryRef");
  scopeFrom(bundle.scope);
  const registryByName = new Map(registry.operations.map((operation) => [operation.operationName, operation]));
  for (const name of bundle.operationNames) {
    const operation = registryByName.get(name);
    if (!operation || !operation.allowedRoleLanes.includes(bundle.roleLane)) {
      fail("role_ledger_tool_operation_leak", name);
    }
    if (operation.authorityBearing && bundle.canonicalAdmissionEnabled !== true) {
      fail("role_ledger_tool_authority_leak", name);
    }
  }
  if (bundle.digest !== digestFor(ROLE_LEDGER_TOOL_BUNDLE_SCHEMA, bundle, ["digest"])) {
    fail("role_ledger_tool_bundle_digest_invalid");
  }
  return true;
}

function sameScopeOrChild(compiled, requested) {
  if (compiled.userWorldId !== requested.userWorldId) return false;
  if (compiled.kind === "user_world") return true;
  if (compiled.projectId !== requested.projectId) return false;
  if (compiled.kind === "project") return true;
  if (compiled.workThreadId !== requested.workThreadId) return false;
  if (compiled.kind === "work_thread") return true;
  if (compiled.kind === "artifact") {
    return compiled.artifactLifecycleId === requested.artifactLifecycleId;
  }
  return compiled.agentRunId === requested.agentRunId;
}

function decideLedgerToolCall(input = {}) {
  const registry = input.registry || operationRegistry({ now: input.now });
  const bundle = input.bundle;
  validateRoleLedgerToolBundle(bundle, registry);
  const operationName = text(input.operationName, "");
  const operation = registry.operations.find((entry) => entry.operationName === operationName);
  const argumentsValue = isPlainObject(input.arguments) ? input.arguments : {};
  const blockerCodes = [];
  if (!operation) blockerCodes.push("operation_unknown");
  if (!bundle.operationNames.includes(operationName)) blockerCodes.push("operation_not_compiled");
  if (operation && !bundle.rights.includes(operation.requiredRight)) blockerCodes.push("right_not_compiled");
  let requestedScope = null;
  try {
    requestedScope = scopeFrom(argumentsValue.subjectScope || {});
  } catch {
    blockerCodes.push("subject_scope_invalid");
  }
  if (requestedScope && !sameScopeOrChild(bundle.scope, requestedScope)) {
    blockerCodes.push("subject_scope_outside_compiled_boundary");
  }
  const idempotencyKey = text(argumentsValue.idempotencyKey, "");
  if (!idempotencyKey) blockerCodes.push("idempotency_key_missing");
  const expectedRevisionVector = Array.isArray(argumentsValue.expectedRevisionVector)
    ? argumentsValue.expectedRevisionVector
    : [];
  const currentRevisionByScope = isPlainObject(input.currentRevisionByScope)
    ? input.currentRevisionByScope
    : {};
  for (const revision of expectedRevisionVector) {
    const key = `${text(revision?.scopeKind, "")}:${text(revision?.scopeId, "")}`;
    const current = currentRevisionByScope[key];
    if (!current) {
      blockerCodes.push(`revision_unknown:${key}`);
    } else if (
      Number(current.revision) !== Number(revision?.revision) ||
      text(current.digest, "") !== text(revision?.digest, "")
    ) {
      blockerCodes.push(`stale_revision:${key}`);
    }
  }
  const visible = new Set(
    (Array.isArray(input.visibleEvidenceRefs) ? input.visibleEvidenceRefs : [])
      .map((ref) => `${text(ref?.kind, "")}:${text(ref?.id, "")}:${text(ref?.digest, "")}`),
  );
  for (const ref of Array.isArray(argumentsValue.evidenceRefs) ? argumentsValue.evidenceRefs : []) {
    const key = `${text(ref?.kind, "")}:${text(ref?.id, "")}:${text(ref?.digest, "")}`;
    if (!visible.has(key)) blockerCodes.push(`evidence_not_visible:${text(ref?.id, "unknown")}`);
  }
  if (operation?.authorityBearing && input.externalAuthorityReceiptPresent !== true) {
    blockerCodes.push("external_authority_receipt_required");
  }
  const allowed = blockerCodes.length === 0;
  const decision = {
    schema: LEDGER_CALL_DECISION_SCHEMA,
    decisionId: `ledger_call_decision_${digestFor("direct-ledger-call-decision-id@1", {
      bundleId: bundle.bundleId,
      operationName,
      idempotencyKey,
    }).slice(7, 31)}`,
    bundleRef: {
      kind: "role_ledger_tool_bundle",
      id: bundle.bundleId,
      digest: bundle.digest,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    operationName,
    requiredRight: operation?.requiredRight || "unknown",
    requestedScope,
    allowed,
    blockerCodes: [...new Set(blockerCodes)],
    idempotencyKey,
    canonicalEffectAuthorized: Boolean(
      allowed && operation?.authorityBearing && input.externalAuthorityReceiptPresent === true,
    ),
    semanticContentValidated: false,
    decidedAt: text(input.decidedAt, nowIso(input.now)),
    grantsAuthority: false,
  };
  decision.digest = digestFor(LEDGER_CALL_DECISION_SCHEMA, decision, ["digest"]);
  return decision;
}

module.exports = {
  LEDGER_CALL_DECISION_SCHEMA,
  LEDGER_TOOL_OPERATION_REGISTRY_SCHEMA,
  ROLE_LEDGER_TOOL_BUNDLE_SCHEMA,
  RIGHTS,
  ROLE_LANES,
  compileRoleLedgerToolBundle,
  decideLedgerToolCall,
  operationRegistry,
  validateOperationRegistry,
  validateRoleLedgerToolBundle,
};
