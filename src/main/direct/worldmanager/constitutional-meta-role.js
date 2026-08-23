"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const CONSTITUTIONAL_META_ROLE_CLASS_SCHEMA =
  "direct_constitutional_meta_role_class@1";
const CONSTITUTIONAL_META_ROLE_MEMBER_SCHEMA =
  "direct_constitutional_meta_role_member@1";
const CONSTITUTIONAL_META_ROLE_REALIZATION_POLICY_SCHEMA =
  "direct_constitutional_meta_role_realization_policy@1";
const CONSTITUTIONAL_META_ROLE_INVOCATION_SCHEMA =
  "direct_constitutional_meta_role_invocation@1";
const CONSTITUTIONAL_META_ROLE_REGISTRY_PROJECTION_SCHEMA =
  "direct_constitutional_meta_role_registry_projection@1";

const CONSTITUTIONAL_META_ROLE_CLASS_ID =
  "constitutional_meta_role";
const SEMANTIC_ROUTER_META_ROLE_ID = "semantic_router";

const SEMANTIC_ROUTER_ACTIONS = Object.freeze([
  "wm_discharge_world_conversation",
  "wm_discharge_world_introspection",
  "wm_discharge_project_ecology_concern",
  "wm_discharge_decision_concern",
  "wm_discharge_project_concern",
  "wm_discharge_project_genesis",
  "wm_discharge_clarification",
  "wm_discharge_split",
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
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function required(value, label) {
  const result = text(value, "");
  if (!result) fail("constitutional_meta_role_missing_string", label);
  return result;
}

function strings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => text(entry, ""))
    .filter(Boolean))].sort();
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function exactRef(value, label) {
  if (!isPlainObject(value)) {
    fail("constitutional_meta_role_ref_required", label);
  }
  const result = {
    kind: required(value.kind, `${label}.kind`),
    id: required(value.id, `${label}.id`),
    digest: required(value.digest, `${label}.digest`),
  };
  if (!/^sha256:[a-f0-9]{64}$/i.test(result.digest)) {
    fail("constitutional_meta_role_ref_digest_invalid", label);
  }
  return result;
}

function ref(kind, value, idField = "id", digestField = "digest") {
  return {
    kind,
    id: required(value?.[idField], `${kind}.id`),
    digest: required(value?.[digestField], `${kind}.digest`),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function buildConstitutionalMetaRoleClass() {
  const value = {
    schema: CONSTITUTIONAL_META_ROLE_CLASS_SCHEMA,
    roleClassId: CONSTITUTIONAL_META_ROLE_CLASS_ID,
    owner: "harness",
    instantiationAuthority: "harness_only",
    activationPosture: "typed_event_or_predicate",
    inputPosture: "compiled_typed_projection",
    outputPosture: "typed_constitutional_artifact",
    userTaskOwnership: false,
    visibleSpeaker: false,
    ordinaryRolePickerVisible: false,
    inheritsChatRuntimeSelection: false,
    inheritsProjectWorkerPolicy: false,
    defaultEffectAuthority: "deny",
    explicitMemberAuthorityRequired: true,
    provenanceRequired: true,
    failurePostures: [
      "bounded_retry",
      "configured_fallback",
      "constitutional_escalation",
      "visible_remand",
    ],
  };
  value.digest = digestFor(
    CONSTITUTIONAL_META_ROLE_CLASS_SCHEMA,
    value,
    ["digest"],
  );
  validateConstitutionalMetaRoleClass(value);
  return deepFreeze(value);
}

function validateConstitutionalMetaRoleClass(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== CONSTITUTIONAL_META_ROLE_CLASS_SCHEMA ||
    value.roleClassId !== CONSTITUTIONAL_META_ROLE_CLASS_ID
  ) {
    fail("constitutional_meta_role_class_schema_mismatch");
  }
  if (
    value.owner !== "harness" ||
    value.instantiationAuthority !== "harness_only" ||
    value.userTaskOwnership !== false ||
    value.visibleSpeaker !== false ||
    value.ordinaryRolePickerVisible !== false ||
    value.inheritsChatRuntimeSelection !== false ||
    value.inheritsProjectWorkerPolicy !== false ||
    value.defaultEffectAuthority !== "deny" ||
    value.explicitMemberAuthorityRequired !== true ||
    value.provenanceRequired !== true ||
    !Array.isArray(value.failurePostures)
  ) {
    fail("constitutional_meta_role_class_boundary_violation");
  }
  if (
    value.digest !== digestFor(
      CONSTITUTIONAL_META_ROLE_CLASS_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("constitutional_meta_role_class_digest_mismatch");
  }
  return true;
}

function buildConstitutionalMetaRoleRealizationPolicy(input = {}) {
  const candidates = (Array.isArray(input.primaryCandidates)
    ? input.primaryCandidates
    : [])
    .map((candidate) => ({
      provider: text(candidate?.provider, "chatgpt_direct"),
      model: required(candidate?.model, "realizationPolicy.candidate.model"),
      reasoningEffort: text(candidate?.reasoningEffort, "high"),
    }));
  if (!candidates.length) {
    fail("constitutional_meta_role_realization_candidate_required");
  }
  const value = {
    schema: CONSTITUTIONAL_META_ROLE_REALIZATION_POLICY_SCHEMA,
    realizationPolicyId: required(
      input.realizationPolicyId,
      "realizationPolicy.id",
    ),
    metaRoleId: required(input.metaRoleId, "realizationPolicy.metaRoleId"),
    owner: "harness",
    selectionScope: "constitutional_meta_role_only",
    userSelectable: false,
    inheritsChatRuntimeSelection: false,
    inheritsProjectRuntimeSelection: false,
    primaryCandidates: candidates,
    fallbackPosture: text(
      input.fallbackPosture,
      "provider_default_then_bundled",
    ),
    contextPosture: text(
      input.contextPosture,
      "bounded_by_member_input_contract",
    ),
    retryPosture: text(input.retryPosture, "bounded_contract_retry"),
    escalationPosture: text(
      input.escalationPosture,
      "reflective_world_manager",
    ),
  };
  value.digest = digestFor(
    CONSTITUTIONAL_META_ROLE_REALIZATION_POLICY_SCHEMA,
    value,
    ["digest"],
  );
  validateConstitutionalMetaRoleRealizationPolicy(value);
  return deepFreeze(value);
}

function validateConstitutionalMetaRoleRealizationPolicy(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      CONSTITUTIONAL_META_ROLE_REALIZATION_POLICY_SCHEMA
  ) {
    fail("constitutional_meta_role_realization_policy_schema_mismatch");
  }
  required(value.realizationPolicyId, "realizationPolicy.id");
  required(value.metaRoleId, "realizationPolicy.metaRoleId");
  if (
    value.owner !== "harness" ||
    value.selectionScope !== "constitutional_meta_role_only" ||
    value.userSelectable !== false ||
    value.inheritsChatRuntimeSelection !== false ||
    value.inheritsProjectRuntimeSelection !== false ||
    !Array.isArray(value.primaryCandidates) ||
    !value.primaryCandidates.length
  ) {
    fail("constitutional_meta_role_realization_policy_boundary_violation");
  }
  for (const candidate of value.primaryCandidates) {
    required(candidate.provider, "realizationPolicy.candidate.provider");
    required(candidate.model, "realizationPolicy.candidate.model");
    required(
      candidate.reasoningEffort,
      "realizationPolicy.candidate.reasoningEffort",
    );
  }
  if (
    value.digest !== digestFor(
      CONSTITUTIONAL_META_ROLE_REALIZATION_POLICY_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("constitutional_meta_role_realization_policy_digest_mismatch");
  }
  return true;
}

function buildConstitutionalMetaRoleMember(input = {}) {
  const roleClass = input.roleClass || buildConstitutionalMetaRoleClass();
  validateConstitutionalMetaRoleClass(roleClass);
  const realizationPolicy = input.realizationPolicy;
  validateConstitutionalMetaRoleRealizationPolicy(realizationPolicy);
  const metaRoleId = required(input.metaRoleId, "metaRole.id");
  if (realizationPolicy.metaRoleId !== metaRoleId) {
    fail("constitutional_meta_role_realization_member_mismatch", metaRoleId);
  }
  const value = {
    schema: CONSTITUTIONAL_META_ROLE_MEMBER_SCHEMA,
    metaRoleId,
    displayName: required(input.displayName, "metaRole.displayName"),
    roleClassRef: ref(
      "constitutional_meta_role_class",
      roleClass,
      "roleClassId",
    ),
    constitutionalFunction: required(
      input.constitutionalFunction,
      "metaRole.constitutionalFunction",
    ),
    activation: {
      mode: text(input.activation?.mode, "typed_event"),
      eventTypes: strings(input.activation?.eventTypes),
    },
    inputObjectKinds: strings(input.inputObjectKinds),
    outputObjectKinds: strings(input.outputObjectKinds),
    capabilityNames: strings(input.capabilityNames),
    authorityEnvelope: {
      defaultDeny: true,
      permittedActs: strings(input.authorityEnvelope?.permittedActs),
      forbiddenEffects: strings(input.authorityEnvelope?.forbiddenEffects),
      canonicalAdmissionAuthority:
        text(
          input.authorityEnvelope?.canonicalAdmissionAuthority,
          "none",
        ),
      externalEffectAuthority:
        text(input.authorityEnvelope?.externalEffectAuthority, "none"),
    },
    lifecycle: {
      mode: text(input.lifecycle?.mode, "invocation_scoped"),
      userTaskOwnership: false,
      visibleSpeaker: false,
      ordinaryRolePickerVisible: false,
    },
    realizationPolicyRef: ref(
      "constitutional_meta_role_realization_policy",
      realizationPolicy,
      "realizationPolicyId",
    ),
    failurePostures: strings(input.failurePostures),
  };
  value.digest = digestFor(
    CONSTITUTIONAL_META_ROLE_MEMBER_SCHEMA,
    value,
    ["digest"],
  );
  validateConstitutionalMetaRoleMember(value, {
    roleClass,
    realizationPolicy,
  });
  return deepFreeze(value);
}

function validateConstitutionalMetaRoleMember(value, context = {}) {
  if (
    !isPlainObject(value) ||
    value.schema !== CONSTITUTIONAL_META_ROLE_MEMBER_SCHEMA
  ) {
    fail("constitutional_meta_role_member_schema_mismatch");
  }
  required(value.metaRoleId, "metaRole.id");
  exactRef(value.roleClassRef, "metaRole.roleClassRef");
  exactRef(value.realizationPolicyRef, "metaRole.realizationPolicyRef");
  if (
    !isPlainObject(value.activation) ||
    !Array.isArray(value.activation.eventTypes) ||
    !Array.isArray(value.inputObjectKinds) ||
    !Array.isArray(value.outputObjectKinds) ||
    !Array.isArray(value.capabilityNames) ||
    !isPlainObject(value.authorityEnvelope) ||
    value.authorityEnvelope.defaultDeny !== true ||
    !Array.isArray(value.authorityEnvelope.permittedActs) ||
    !Array.isArray(value.authorityEnvelope.forbiddenEffects) ||
    !isPlainObject(value.lifecycle) ||
    value.lifecycle.userTaskOwnership !== false ||
    value.lifecycle.visibleSpeaker !== false ||
    value.lifecycle.ordinaryRolePickerVisible !== false ||
    !Array.isArray(value.failurePostures)
  ) {
    fail("constitutional_meta_role_member_boundary_violation");
  }
  if (context.roleClass) {
    validateConstitutionalMetaRoleClass(context.roleClass);
    if (
      value.roleClassRef.id !== context.roleClass.roleClassId ||
      value.roleClassRef.digest !== context.roleClass.digest
    ) {
      fail("constitutional_meta_role_member_class_ref_mismatch");
    }
  }
  if (context.realizationPolicy) {
    validateConstitutionalMetaRoleRealizationPolicy(
      context.realizationPolicy,
    );
    if (
      value.realizationPolicyRef.id !==
        context.realizationPolicy.realizationPolicyId ||
      value.realizationPolicyRef.digest !== context.realizationPolicy.digest ||
      value.metaRoleId !== context.realizationPolicy.metaRoleId
    ) {
      fail("constitutional_meta_role_member_policy_ref_mismatch");
    }
  }
  if (
    value.digest !== digestFor(
      CONSTITUTIONAL_META_ROLE_MEMBER_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("constitutional_meta_role_member_digest_mismatch");
  }
  return true;
}

function buildSemanticRouterMetaRole(roleClass) {
  const realizationPolicy =
    buildConstitutionalMetaRoleRealizationPolicy({
      realizationPolicyId: "semantic_router.realization@1",
      metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
      primaryCandidates: [{
        provider: "chatgpt_direct",
        model: "gpt-5.3-codex-spark",
        reasoningEffort: "high",
      }],
      fallbackPosture: "provider_default_then_bundled",
      contextPosture: "bounded_semantic_ingress_projection",
      retryPosture: "bounded_contract_retry",
      escalationPosture: "reflective_world_manager",
    });
  const member = buildConstitutionalMetaRoleMember({
    roleClass,
    realizationPolicy,
    metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
    displayName: "Semantic router",
    constitutionalFunction:
      "Settle semantic ingress into one typed meta-contract without solving the downstream task.",
    activation: {
      mode: "typed_event",
      eventTypes: [
        "world_manager_semantic_event",
        "semantic_child_contract",
      ],
    },
    inputObjectKinds: [
      "semantic_ingress_projection",
      "semantic_child_contract",
    ],
    outputObjectKinds: [
      "semantic_discharge",
      "semantic_routing_witness",
    ],
    capabilityNames: SEMANTIC_ROUTER_ACTIONS,
    authorityEnvelope: {
      permittedActs: [
        "classify_ingress",
        "propose_route",
        "request_clarification",
        "split_semantic_contract",
      ],
      forbiddenEffects: [
        "canonical_admission",
        "external_effect",
        "policy_mutation",
        "remote_mutation",
        "workspace_mutation",
        "worker_start",
      ],
      canonicalAdmissionAuthority: "none",
      externalEffectAuthority: "none",
    },
    lifecycle: { mode: "invocation_scoped" },
    failurePostures: [
      "bounded_retry",
      "configured_fallback",
      "reflective_world_manager",
      "visible_remand",
    ],
  });
  return { member, realizationPolicy };
}

function buildConstitutionalMetaRoleInvocation(input = {}) {
  const roleClass = input.roleClass;
  const member = input.member;
  const realizationPolicy = input.realizationPolicy;
  validateConstitutionalMetaRoleClass(roleClass);
  validateConstitutionalMetaRoleMember(member, {
    roleClass,
    realizationPolicy,
  });
  const activationRef = exactRef(
    input.activationRef,
    "metaRoleInvocation.activationRef",
  );
  const memberDeclaresAuthority =
    member.authorityEnvelope.canonicalAdmissionAuthority !== "none" ||
    member.authorityEnvelope.externalEffectAuthority !== "none";
  const authorityGrantRef = input.authorityGrantRef
    ? exactRef(
        input.authorityGrantRef,
        "metaRoleInvocation.authorityGrantRef",
      )
    : null;
  if (authorityGrantRef && !memberDeclaresAuthority) {
    fail("constitutional_meta_role_authority_not_declared", member.metaRoleId);
  }
  const createdAt = text(input.createdAt, nowIso(input.now));
  const value = {
    schema: CONSTITUTIONAL_META_ROLE_INVOCATION_SCHEMA,
    metaRoleInvocationId: stableId(
      "constitutional_meta_role_invocation",
      {
        metaRoleId: member.metaRoleId,
        activationRef,
        memberDigest: member.digest,
      },
    ),
    metaRoleId: member.metaRoleId,
    roleClassRef: member.roleClassRef,
    memberRef: ref(
      "constitutional_meta_role_member",
      member,
      "metaRoleId",
    ),
    realizationPolicyRef: member.realizationPolicyRef,
    activationRef,
    capabilityNames: [...member.capabilityNames],
    authorityEnvelope: {
      ...member.authorityEnvelope,
      permittedActs: [...member.authorityEnvelope.permittedActs],
      forbiddenEffects: [...member.authorityEnvelope.forbiddenEffects],
    },
    lifecycleMode: member.lifecycle.mode,
    userTaskOwnership: false,
    visibleSpeaker: false,
    ordinaryRolePickerVisible: false,
    inheritsChatRuntimeSelection: false,
    inheritsProjectRuntimeSelection: false,
    authorityGrantRef,
    grantsAuthority: Boolean(authorityGrantRef),
    createdAt,
  };
  value.digest = digestFor(
    CONSTITUTIONAL_META_ROLE_INVOCATION_SCHEMA,
    value,
    ["digest"],
  );
  validateConstitutionalMetaRoleInvocation(value, {
    roleClass,
    member,
    realizationPolicy,
  });
  return deepFreeze(value);
}

function validateConstitutionalMetaRoleInvocation(value, context = {}) {
  if (
    !isPlainObject(value) ||
    value.schema !== CONSTITUTIONAL_META_ROLE_INVOCATION_SCHEMA
  ) {
    fail("constitutional_meta_role_invocation_schema_mismatch");
  }
  required(value.metaRoleInvocationId, "metaRoleInvocation.id");
  required(value.metaRoleId, "metaRoleInvocation.metaRoleId");
  exactRef(value.roleClassRef, "metaRoleInvocation.roleClassRef");
  exactRef(value.memberRef, "metaRoleInvocation.memberRef");
  exactRef(
    value.realizationPolicyRef,
    "metaRoleInvocation.realizationPolicyRef",
  );
  exactRef(value.activationRef, "metaRoleInvocation.activationRef");
  if (
    !Array.isArray(value.capabilityNames) ||
    !isPlainObject(value.authorityEnvelope) ||
    value.authorityEnvelope.defaultDeny !== true ||
    value.userTaskOwnership !== false ||
    value.visibleSpeaker !== false ||
    value.ordinaryRolePickerVisible !== false ||
    value.inheritsChatRuntimeSelection !== false ||
    value.inheritsProjectRuntimeSelection !== false ||
    typeof value.grantsAuthority !== "boolean" ||
    (value.grantsAuthority && !value.authorityGrantRef) ||
    (!value.grantsAuthority && value.authorityGrantRef)
  ) {
    fail("constitutional_meta_role_invocation_boundary_violation");
  }
  if (value.authorityGrantRef) {
    exactRef(
      value.authorityGrantRef,
      "metaRoleInvocation.authorityGrantRef",
    );
  }
  if (context.member) {
    validateConstitutionalMetaRoleMember(context.member, context);
    if (
      value.metaRoleId !== context.member.metaRoleId ||
      value.memberRef.digest !== context.member.digest ||
      JSON.stringify(value.capabilityNames) !==
        JSON.stringify(context.member.capabilityNames)
    ) {
      fail("constitutional_meta_role_invocation_member_mismatch");
    }
  }
  if (
    value.digest !== digestFor(
      CONSTITUTIONAL_META_ROLE_INVOCATION_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("constitutional_meta_role_invocation_digest_mismatch");
  }
  return true;
}

function modelDescriptor(catalog, model) {
  return (Array.isArray(catalog?.models) ? catalog.models : [])
    .find((entry) => text(entry?.id || entry?.model, "") === model) || null;
}

function supportedEfforts(descriptor) {
  const raw = Array.isArray(descriptor?.supportedReasoningEfforts)
    ? descriptor.supportedReasoningEfforts
    : Array.isArray(descriptor?.supported_reasoning_efforts)
      ? descriptor.supported_reasoning_efforts
      : [];
  return strings(raw.map((entry) =>
    typeof entry === "string"
      ? entry
      : entry?.reasoningEffort || entry?.reasoning_effort || entry?.effort));
}

function resolveConstitutionalMetaRoleRuntimeSelection(input = {}) {
  const invocation = input.invocation;
  const policy = input.realizationPolicy;
  validateConstitutionalMetaRoleInvocation(invocation);
  validateConstitutionalMetaRoleRealizationPolicy(policy);
  if (
    invocation.metaRoleId !== policy.metaRoleId ||
    invocation.realizationPolicyRef.id !== policy.realizationPolicyId ||
    invocation.realizationPolicyRef.digest !== policy.digest
  ) {
    fail("constitutional_meta_role_runtime_policy_mismatch");
  }
  const catalog = input.catalog || { models: [] };
  let selectedCandidate = null;
  let descriptor = null;
  for (const candidate of policy.primaryCandidates) {
    const observed = modelDescriptor(catalog, candidate.model);
    if (!observed) continue;
    selectedCandidate = candidate;
    descriptor = observed;
    break;
  }
  let modelSource = "constitutional_meta_role_policy";
  if (!selectedCandidate) {
    const fallbackModels = [
      text(catalog.providerDefaultModel, ""),
      text(catalog.bundledDefaultModel, ""),
      text(catalog.models?.[0]?.id || catalog.models?.[0]?.model, ""),
    ].filter(Boolean);
    const fallbackModel = fallbackModels.find((candidate) =>
      modelDescriptor(catalog, candidate)) || "";
    if (fallbackModel) {
      descriptor = modelDescriptor(catalog, fallbackModel);
      selectedCandidate = {
        provider: "chatgpt_direct",
        model: fallbackModel,
        reasoningEffort:
          text(descriptor?.defaultReasoningEffort, "") || "medium",
      };
      modelSource = fallbackModel === catalog.providerDefaultModel
        ? "constitutional_meta_role_provider_fallback"
        : "constitutional_meta_role_bundled_fallback";
    } else {
      selectedCandidate = policy.primaryCandidates[0];
      modelSource = "constitutional_meta_role_policy_unverified";
    }
  }
  const efforts = supportedEfforts(descriptor);
  let reasoningEffort = text(
    selectedCandidate.reasoningEffort,
    text(descriptor?.defaultReasoningEffort, "medium"),
  );
  if (efforts.length && !efforts.includes(reasoningEffort)) {
    reasoningEffort = text(
      descriptor?.defaultReasoningEffort,
      efforts.includes("high") ? "high" : efforts[0],
    );
  }
  return {
    metaRoleId: invocation.metaRoleId,
    model: selectedCandidate.model,
    reasoningEffort,
    modelSource,
    reasoningEffortSource: "constitutional_meta_role_policy",
    descriptor,
    catalog,
    realizationPolicyRef: invocation.realizationPolicyRef,
    userSelectable: false,
    inheritedFromChat: false,
    inheritedFromProject: false,
  };
}

class ConstitutionalMetaRoleRegistry {
  constructor(options = {}) {
    this.roleClass = options.roleClass ||
      buildConstitutionalMetaRoleClass();
    validateConstitutionalMetaRoleClass(this.roleClass);
    this.members = new Map();
    this.policies = new Map();
  }

  register(input = {}) {
    validateConstitutionalMetaRoleMember(input.member, {
      roleClass: this.roleClass,
      realizationPolicy: input.realizationPolicy,
    });
    validateConstitutionalMetaRoleRealizationPolicy(
      input.realizationPolicy,
    );
    if (this.members.has(input.member.metaRoleId)) {
      fail(
        "constitutional_meta_role_duplicate_member",
        input.member.metaRoleId,
      );
    }
    this.members.set(input.member.metaRoleId, input.member);
    this.policies.set(
      input.realizationPolicy.realizationPolicyId,
      input.realizationPolicy,
    );
    return input.member;
  }

  member(metaRoleId) {
    return this.members.get(text(metaRoleId, "")) || null;
  }

  realizationPolicy(metaRoleId) {
    const member = this.member(metaRoleId);
    return member
      ? this.policies.get(member.realizationPolicyRef.id) || null
      : null;
  }

  compileInvocation(input = {}) {
    const member = this.member(input.metaRoleId);
    const realizationPolicy = this.realizationPolicy(input.metaRoleId);
    if (!member || !realizationPolicy) {
      fail(
        "constitutional_meta_role_member_unknown",
        text(input.metaRoleId, ""),
      );
    }
    return buildConstitutionalMetaRoleInvocation({
      ...input,
      roleClass: this.roleClass,
      member,
      realizationPolicy,
    });
  }

  projection() {
    const members = [...this.members.values()]
      .sort((left, right) => left.metaRoleId.localeCompare(right.metaRoleId))
      .map((member) => {
        const policy = this.realizationPolicy(member.metaRoleId);
        return {
          metaRoleId: member.metaRoleId,
          displayName: member.displayName,
          constitutionalFunction: member.constitutionalFunction,
          memberRef: ref(
            "constitutional_meta_role_member",
            member,
            "metaRoleId",
          ),
          activationMode: member.activation.mode,
          capabilityNames: [...member.capabilityNames],
          authorityEnvelope: {
            ...member.authorityEnvelope,
            permittedActs: [...member.authorityEnvelope.permittedActs],
            forbiddenEffects: [...member.authorityEnvelope.forbiddenEffects],
          },
          realization: {
            policyRef: member.realizationPolicyRef,
            primaryCandidates: policy.primaryCandidates.map((entry) => ({
              ...entry,
            })),
            fallbackPosture: policy.fallbackPosture,
            userSelectable: false,
          },
          visibleSpeaker: false,
          ordinaryRolePickerVisible: false,
        };
      });
    const value = {
      schema: CONSTITUTIONAL_META_ROLE_REGISTRY_PROJECTION_SCHEMA,
      roleClassRef: ref(
        "constitutional_meta_role_class",
        this.roleClass,
        "roleClassId",
      ),
      owner: "harness",
      memberCount: members.length,
      members,
      ordinaryRolePickerVisible: false,
      grantsAuthority: false,
    };
    value.digest = digestFor(
      CONSTITUTIONAL_META_ROLE_REGISTRY_PROJECTION_SCHEMA,
      value,
      ["digest"],
    );
    return value;
  }
}

function createDefaultConstitutionalMetaRoleRegistry() {
  const registry = new ConstitutionalMetaRoleRegistry();
  registry.register(buildSemanticRouterMetaRole(registry.roleClass));
  return registry;
}

module.exports = {
  CONSTITUTIONAL_META_ROLE_CLASS_ID,
  CONSTITUTIONAL_META_ROLE_CLASS_SCHEMA,
  CONSTITUTIONAL_META_ROLE_INVOCATION_SCHEMA,
  CONSTITUTIONAL_META_ROLE_MEMBER_SCHEMA,
  CONSTITUTIONAL_META_ROLE_REALIZATION_POLICY_SCHEMA,
  CONSTITUTIONAL_META_ROLE_REGISTRY_PROJECTION_SCHEMA,
  SEMANTIC_ROUTER_ACTIONS,
  SEMANTIC_ROUTER_META_ROLE_ID,
  ConstitutionalMetaRoleRegistry,
  buildConstitutionalMetaRoleClass,
  buildConstitutionalMetaRoleInvocation,
  buildConstitutionalMetaRoleMember,
  buildConstitutionalMetaRoleRealizationPolicy,
  buildSemanticRouterMetaRole,
  createDefaultConstitutionalMetaRoleRegistry,
  resolveConstitutionalMetaRoleRuntimeSelection,
  validateConstitutionalMetaRoleClass,
  validateConstitutionalMetaRoleInvocation,
  validateConstitutionalMetaRoleMember,
  validateConstitutionalMetaRoleRealizationPolicy,
};
