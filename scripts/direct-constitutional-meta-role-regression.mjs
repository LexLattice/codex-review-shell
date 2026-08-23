#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CONSTITUTIONAL_META_ROLE_CLASS_ID,
  SEMANTIC_ROUTER_META_ROLE_ID,
  buildConstitutionalMetaRoleMember,
  buildConstitutionalMetaRoleRealizationPolicy,
  createDefaultConstitutionalMetaRoleRegistry,
  resolveConstitutionalMetaRoleRuntimeSelection,
  validateConstitutionalMetaRoleInvocation,
} = require(
  "../src/main/direct/worldmanager/constitutional-meta-role",
);
const {
  DirectWorldManagerSemanticIngressRuntime,
} = require(
  "../src/main/direct/worldmanager/semantic-ingress-runtime",
);
const {
  digestFor,
} = require("../src/main/direct/worldmanager/control-plane");

const registry = createDefaultConstitutionalMetaRoleRegistry();
const projection = registry.projection();
assert.equal(registry.roleClass.roleClassId, CONSTITUTIONAL_META_ROLE_CLASS_ID);
assert.equal(registry.roleClass.owner, "harness");
assert.equal(registry.roleClass.userTaskOwnership, false);
assert.equal(registry.roleClass.visibleSpeaker, false);
assert.equal(registry.roleClass.ordinaryRolePickerVisible, false);
assert.equal(registry.roleClass.inheritsChatRuntimeSelection, false);
assert.equal(registry.roleClass.inheritsProjectWorkerPolicy, false);
assert.equal(registry.roleClass.defaultEffectAuthority, "deny");
assert.equal(Object.isFrozen(registry.roleClass), true);
assert.equal(projection.memberCount, 1);
assert.equal(projection.ordinaryRolePickerVisible, false);

const semanticRouter = registry.member(SEMANTIC_ROUTER_META_ROLE_ID);
const semanticRouterPolicy = registry.realizationPolicy(
  SEMANTIC_ROUTER_META_ROLE_ID,
);
assert.ok(semanticRouter);
assert.equal(semanticRouter.lifecycle.visibleSpeaker, false);
assert.equal(semanticRouter.lifecycle.ordinaryRolePickerVisible, false);
assert.equal(semanticRouter.authorityEnvelope.defaultDeny, true);
assert.equal(
  semanticRouter.authorityEnvelope.canonicalAdmissionAuthority,
  "none",
);
assert.ok(
  semanticRouter.authorityEnvelope.forbiddenEffects.includes(
    "workspace_mutation",
  ),
);
assert.deepEqual(
  semanticRouterPolicy.primaryCandidates[0],
  {
    provider: "chatgpt_direct",
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "high",
  },
);
assert.equal(semanticRouterPolicy.userSelectable, false);
assert.equal(semanticRouterPolicy.inheritsChatRuntimeSelection, false);
assert.equal(semanticRouterPolicy.inheritsProjectRuntimeSelection, false);

const activationRef = {
  kind: "world_manager_semantic_event",
  id: "wm_event_meta_role_test",
  digest: digestFor("world_manager_semantic_event", {
    id: "wm_event_meta_role_test",
  }),
};
const invocation = registry.compileInvocation({
  metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
  activationRef,
  createdAt: "2026-08-23T10:00:00.000Z",
});
assert.equal(validateConstitutionalMetaRoleInvocation(invocation), true);
assert.equal(invocation.visibleSpeaker, false);
assert.equal(invocation.userTaskOwnership, false);
assert.equal(invocation.inheritsChatRuntimeSelection, false);
assert.equal(invocation.inheritsProjectRuntimeSelection, false);
assert.equal(invocation.grantsAuthority, false);
assert.equal(Object.isFrozen(invocation), true);

const sparkSelection = resolveConstitutionalMetaRoleRuntimeSelection({
  invocation,
  realizationPolicy: semanticRouterPolicy,
  catalog: {
    providerDefaultModel: "gpt-5.6-sol",
    bundledDefaultModel: "gpt-5.5",
    models: [
      {
        id: "gpt-5.6-sol",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.3-codex-spark",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
    ],
  },
});
assert.equal(sparkSelection.model, "gpt-5.3-codex-spark");
assert.equal(sparkSelection.reasoningEffort, "high");
assert.equal(sparkSelection.modelSource, "constitutional_meta_role_policy");
assert.equal(sparkSelection.userSelectable, false);
assert.equal(sparkSelection.inheritedFromChat, false);
assert.equal(sparkSelection.inheritedFromProject, false);

const fallbackSelection = resolveConstitutionalMetaRoleRuntimeSelection({
  invocation,
  realizationPolicy: semanticRouterPolicy,
  catalog: {
    providerDefaultModel: "gpt-5.6-sol",
    bundledDefaultModel: "gpt-5.5",
    models: [{
      id: "gpt-5.6-sol",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium", "high"],
    }],
  },
});
assert.equal(fallbackSelection.model, "gpt-5.6-sol");
assert.equal(
  fallbackSelection.modelSource,
  "constitutional_meta_role_provider_fallback",
);

const autoReviewPolicy = buildConstitutionalMetaRoleRealizationPolicy({
  realizationPolicyId: "auto_review.realization@1",
  metaRoleId: "auto_review",
  primaryCandidates: [{
    provider: "chatgpt_direct",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
  }],
});
const autoReviewMember = buildConstitutionalMetaRoleMember({
  roleClass: registry.roleClass,
  realizationPolicy: autoReviewPolicy,
  metaRoleId: "auto_review",
  displayName: "Automatic review",
  constitutionalFunction:
    "Evaluate one proposed operation under a bounded review jurisdiction.",
  activation: {
    mode: "typed_predicate",
    eventTypes: ["approval_gated_operation"],
  },
  inputObjectKinds: ["proposed_operation", "resolved_permission_policy"],
  outputObjectKinds: ["approval_verdict"],
  capabilityNames: ["submit_approval_verdict"],
  authorityEnvelope: {
    permittedActs: ["review_operation"],
    forbiddenEffects: ["workspace_mutation", "policy_mutation"],
    canonicalAdmissionAuthority: "none",
    externalEffectAuthority: "compiled_review_jurisdiction_only",
  },
  failurePostures: ["visible_remand"],
});
registry.register({
  member: autoReviewMember,
  realizationPolicy: autoReviewPolicy,
});
assert.equal(registry.projection().memberCount, 2);
assert.equal(
  registry.member("auto_review").roleClassRef.digest,
  registry.roleClass.digest,
);
assert.throws(
  () => registry.register({
    member: autoReviewMember,
    realizationPolicy: autoReviewPolicy,
  }),
  /constitutional_meta_role_duplicate_member/,
);
const autoReviewInvocation = registry.compileInvocation({
  metaRoleId: "auto_review",
  activationRef: {
    kind: "approval_gated_operation",
    id: "operation_review_fixture",
    digest: digestFor("approval_gated_operation", {
      id: "operation_review_fixture",
    }),
  },
  authorityGrantRef: {
    kind: "compiled_review_jurisdiction",
    id: "review_jurisdiction_fixture",
    digest: digestFor("compiled_review_jurisdiction", {
      id: "review_jurisdiction_fixture",
    }),
  },
  createdAt: "2026-08-23T10:30:00.000Z",
});
assert.equal(autoReviewInvocation.grantsAuthority, true);
assert.equal(
  autoReviewInvocation.authorityGrantRef.kind,
  "compiled_review_jurisdiction",
);
assert.throws(
  () => registry.compileInvocation({
    metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
    activationRef,
    authorityGrantRef: autoReviewInvocation.authorityGrantRef,
  }),
  /constitutional_meta_role_authority_not_declared/,
);

let runnerRequest = null;
const semanticRuntime = new DirectWorldManagerSemanticIngressRuntime({
  metaRoleRegistry: createDefaultConstitutionalMetaRoleRegistry(),
  now: () => Date.parse("2026-08-23T11:00:00.000Z"),
  runner(input) {
    runnerRequest = input;
    return {
      actionCalls: [{
        callId: "semantic_router_call",
        name: "wm_discharge_world_conversation",
        argumentsJson: JSON.stringify({
          conversationKind: {
            mode: "freeform",
            existingTypeRef: "",
            proposedLabel: "",
            parentTypeRef: "",
            differentia: "",
            components: [],
            freeformCharacterization: "ordinary greeting",
          },
          responseIntent: "Respond naturally.",
          contextNeeds: [],
          rationaleSummary:
            "The utterance is ordinary world-scoped conversation.",
        }),
      }],
      telemetry: {
        runtimeMode: "fixture",
        model: "gpt-5.3-codex-spark",
        reasoningEffort: "high",
        toolCallCount: 1,
        toolNames: ["wm_discharge_world_conversation"],
      },
    };
  },
});
const event = {
  semanticEventId: "wm_event_meta_role_runtime",
  clientRequestId: "meta_role_runtime",
  eventDigest: digestFor("world_manager_semantic_event", {
    id: "wm_event_meta_role_runtime",
  }),
};
const run = semanticRuntime.run({
  userWorldId: "user_world_meta_role",
  projects: [{
    projectId: "project_meta_role",
    name: "Meta Role",
    summary: "Meta-role regression project.",
  }],
  event,
  message: {
    messageId: "wm_message_meta_role_runtime",
    messageDigest: digestFor("world_manager_message", { text: "hey" }),
    text: "hey",
  },
  request: { scopeHint: { bindingPosture: "ambient_focus" } },
  focusedProjectId: "project_meta_role",
  graphBinding: {
    bindingId: "worldmodel_binding_meta_role_runtime",
    digest: digestFor("worldmodel_binding", {
      id: "worldmodel_binding_meta_role_runtime",
    }),
  },
  pendingDecisions: [],
});
assert.equal(run.runState, "completed");
assert.equal(run.telemetry.metaRoleId, SEMANTIC_ROUTER_META_ROLE_ID);
assert.equal(
  run.requestManifest.constitutionalMetaRoleInvocation.metaRoleId,
  SEMANTIC_ROUTER_META_ROLE_ID,
);
assert.equal(
  runnerRequest.runtimeRoleClass,
  "constitutional_meta_role",
);
assert.equal(runnerRequest.metaRoleId, SEMANTIC_ROUTER_META_ROLE_ID);
assert.equal(
  runnerRequest.metaRoleRealizationPolicy.userSelectable,
  false,
);
assert.equal(
  runnerRequest.outputContract.metaRoleMemberRef.id,
  SEMANTIC_ROUTER_META_ROLE_ID,
);
assert.match(
  runnerRequest.instructions,
  /not a user task role, visible speaker, project worker, or ordinary model-selected agent/i,
);

console.log(JSON.stringify({
  ok: true,
  regression: "direct-constitutional-meta-role",
  proofs: {
    classInvariantsCompiled: true,
    semanticRouterRegisteredAsMember: true,
    newMembersUseSameRegistrationPath: true,
    narrowAuthorityRequiresExactGrant: true,
    sparkHighPreferredIndependently: true,
    providerFallbackIsExplicit: true,
    ordinaryRolePickerExcluded: true,
    invocationLineagePersisted: true,
    semanticIngressUsesCompiledMetaRole: true,
  },
}, null, 2));
