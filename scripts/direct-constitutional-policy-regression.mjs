#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  activeWorldmodelFixture,
  buildAdminModePolicyUpdate,
  buildAuthorizationRequest,
  buildChildPolicyBoundaryWitness,
  buildConstitutionalPolicyProfile,
  buildConstitutionalPolicyResolutionTrace,
  buildPolicyProfileStore,
  buildSelfBindingPreferenceParserFixture,
  validateAdminModePolicyUpdate,
  validateChildPolicyBoundaryWitness,
  validateConstitutionalPolicyProfile,
  validateConstitutionalPolicyResolutionTrace,
  validatePolicyProfileStore,
  validateSelfBindingPreferenceRecord,
} = require("../src/main/direct/worldmodel");

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, expectedCode, `expected ${expectedCode}, got ${error.code || error.message}`);
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

const now = () => Date.UTC(2026, 6, 3, 15, 0, 0);
const worldmodel = activeWorldmodelFixture("work_thread", {
  revision: 5,
  subjectAgentId: "agent_worker_policy_fixture",
});

const selfBinding = buildSelfBindingPreferenceParserFixture({
  userProfileId: "user_profile_fixture",
  normalizedKind: "avoid_broad_refactor",
  actionClass: "broad_refactor",
  summary: "Avoid broad refactors unless scoped exception evidence exists.",
  defaultPosture: "explicit_user_confirmation_required",
}, { now });
validateSelfBindingPreferenceRecord(selfBinding);
assert.equal(selfBinding.preferenceKind, "avoid_broad_refactor");
assert.equal(selfBinding.rawUserTextIncluded, false);
assert.equal(selfBinding.requiresAdminModeToChange, true);

const parentProfile = buildConstitutionalPolicyProfile({
  profileId: "constitutional_policy_parent_fixture",
  ownerUserId: "user_profile_fixture",
  scope: "project",
  defaultDecision: "manager_discretion",
  selfBindingRecords: [selfBinding],
  policies: [{
    ruleId: "policy_rule_broad_refactor_parent",
    actionClass: "broad_refactor",
    defaultPosture: "explicit_user_confirmation_required",
    evidenceRequirements: ["architecture_need", "blast_radius_summary"],
    exceptions: [{
      exceptionId: "policy_exception_broad_refactor_parent",
      beforePosture: "explicit_user_confirmation_required",
      afterPosture: "manager_discretion",
      evidenceRequirements: ["architecture_need", "blast_radius_summary", "test_blocker"],
      rationale: "Manager may decide when a small patch cannot satisfy tests and evidence is complete.",
    }],
    escalationRule: {
      escalationTarget: "user_confirmation",
      userConfirmationAllowed: true,
      adminModeRequired: false,
    },
    rationale: "Broad refactors require explicit user confirmation unless exception evidence is complete.",
  }, {
    ruleId: "policy_rule_destructive_delete_parent",
    actionClass: "destructive_delete",
    defaultPosture: "admin_mode_required",
    evidenceRequirements: ["explicit_admin_intent", "target_inventory"],
    escalationRule: {
      escalationTarget: "admin_mode",
      userConfirmationAllowed: false,
      adminModeRequired: true,
    },
    rationale: "Destructive delete remains admin-mode only.",
  }],
}, { now });
validateConstitutionalPolicyProfile(parentProfile);
assert.equal(parentProfile.version, 1);
assert.equal(parentProfile.policies.length, 2);

const store = buildPolicyProfileStore({
  storeId: "constitutional_policy_store_fixture",
  profiles: [parentProfile],
}, { now });
validatePolicyProfileStore(store);
assert.equal(store.currentProfileRefs.length, 1);
assert.equal(store.rawPolicyTextIncluded, false);

const broadRequestMissingEvidence = buildAuthorizationRequest({
  requestId: "authorization_request_policy_broad_missing_fixture",
  workerAgentId: "agent_worker_policy_fixture",
  agentRunId: "agent_run_policy_broad_missing_fixture",
  workThreadId: "work_thread_policy_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "broad_refactor",
    roleLane: "implementation_worker",
    targetKind: "workspace",
    targetRefs: [{
      kind: "workspace",
      id: "workspace_fixture",
      digest: "sha256:workspace_fixture",
      label: "Workspace",
    }],
    scope: "project",
    reversibility: "partly_reversible",
    riskLevel: "high",
  },
  evidenceRefs: [{
    kind: "architecture_need",
    id: "architecture_need",
    digest: "sha256:architecture_need",
    label: "Architecture need",
  }],
}, { now });

const missingTrace = buildConstitutionalPolicyResolutionTrace({
  profile: parentProfile,
  request: broadRequestMissingEvidence,
}, { now });
validateConstitutionalPolicyResolutionTrace(missingTrace);
assert.equal(missingTrace.dominantPosture, "explicit_user_confirmation_required");
assert.equal(missingTrace.evidenceSatisfied, false);
assert(missingTrace.missingEvidence.some((item) => item.requirementId === "blast_radius_summary"));
assert.equal(missingTrace.exceptionApplied, null);

const broadRequestWithExceptionEvidence = buildAuthorizationRequest({
  requestId: "authorization_request_policy_broad_exception_fixture",
  workerAgentId: "agent_worker_policy_fixture",
  agentRunId: "agent_run_policy_broad_exception_fixture",
  workThreadId: "work_thread_policy_fixture",
  worldmodel,
  requestedAction: {
    actionClass: "broad_refactor",
    roleLane: "implementation_worker",
    targetKind: "workspace",
    targetRefs: [{
      kind: "workspace",
      id: "workspace_fixture",
      digest: "sha256:workspace_fixture",
      label: "Workspace",
    }],
    scope: "project",
    reversibility: "partly_reversible",
    riskLevel: "high",
  },
  evidenceRefs: [{
    kind: "architecture_need",
    id: "architecture_need",
    digest: "sha256:architecture_need",
    label: "Architecture need",
  }, {
    kind: "blast_radius_summary",
    id: "blast_radius_summary",
    digest: "sha256:blast_radius_summary",
    label: "Blast radius summary",
  }, {
    kind: "test_blocker",
    id: "test_blocker",
    digest: "sha256:test_blocker",
    label: "Test blocker",
  }],
}, { now });

const exceptionTrace = buildConstitutionalPolicyResolutionTrace({
  profile: parentProfile,
  request: broadRequestWithExceptionEvidence,
}, { now });
validateConstitutionalPolicyResolutionTrace(exceptionTrace);
assert.equal(exceptionTrace.dominantPosture, "manager_discretion");
assert.equal(exceptionTrace.evidenceSatisfied, true);
assert.equal(exceptionTrace.exceptionApplied.beforePosture, "explicit_user_confirmation_required");
assert.equal(exceptionTrace.exceptionApplied.afterPosture, "manager_discretion");

expectThrows(() => buildAdminModePolicyUpdate({
  policyProfileId: parentProfile.profileId,
  userRoleState: "user_mode",
  changeKind: "modify_policy",
  actionClass: "broad_refactor",
  beforeDigest: parentProfile.profileDigest,
  afterDigest: "sha256:after_policy_digest",
  expectedBenefits: ["User casually said yes"],
  failureModes: ["Would silently mutate standing policy"],
}), "direct_constitutional_policy_admin_mode_required");

const adminUpdate = buildAdminModePolicyUpdate({
  updateId: "admin_policy_update_fixture",
  policyProfileId: parentProfile.profileId,
  userRoleState: "admin_mode",
  changeKind: "modify_policy",
  actionClass: "broad_refactor",
  beforeDigest: parentProfile.profileDigest,
  afterDigest: "sha256:after_policy_digest",
  expectedBenefits: ["Permit documented exception"],
  failureModes: ["Over-broad future authorization"],
  exceptionRules: [{
    exceptionId: "policy_exception_admin_update_fixture",
    beforePosture: "explicit_user_confirmation_required",
    afterPosture: "manager_discretion",
    evidenceRequirements: ["architecture_need", "blast_radius_summary"],
    rationale: "Admin-reviewed exception rule.",
  }],
  futureAutomationAllowed: false,
  futureEscalationRequiredWhen: ["public API changes", "account mutation"],
}, { now });
validateAdminModePolicyUpdate(adminUpdate);
assert.equal(adminUpdate.userRoleState, "admin_mode");
assert.equal(adminUpdate.rawUserTextIncluded, false);

const childBroadProfile = buildConstitutionalPolicyProfile({
  profileId: "constitutional_policy_child_broad_fixture",
  ownerUserId: "user_profile_fixture",
  scope: "work_thread",
  defaultDecision: "manager_discretion",
  policies: [{
    ruleId: "policy_rule_broad_refactor_child_broad",
    actionClass: "broad_refactor",
    defaultPosture: "allow",
    evidenceRequirements: [],
    rationale: "Attempted child broadening.",
  }],
}, { now });
validateConstitutionalPolicyProfile(childBroadProfile);

const broadeningWitness = buildChildPolicyBoundaryWitness({
  parentProfile,
  childProfile: childBroadProfile,
}, { now });
validateChildPolicyBoundaryWitness(broadeningWitness);
assert.equal(broadeningWitness.decision, "blocked_child_broadening");
assert.equal(broadeningWitness.blocksPromotion, true);
assert.equal(broadeningWitness.broadeningRows[0].actionClass, "broad_refactor");

const adminBroadeningWitness = buildChildPolicyBoundaryWitness({
  parentProfile,
  childProfile: childBroadProfile,
  adminUpdate,
}, { now });
validateChildPolicyBoundaryWitness(adminBroadeningWitness);
assert.equal(adminBroadeningWitness.decision, "admin_authorized_broadening");
assert.equal(adminBroadeningWitness.blocksPromotion, false);

const childNarrowProfile = buildConstitutionalPolicyProfile({
  profileId: "constitutional_policy_child_narrow_fixture",
  ownerUserId: "user_profile_fixture",
  scope: "work_thread",
  defaultDecision: "deny",
  policies: [{
    ruleId: "policy_rule_broad_refactor_child_narrow",
    actionClass: "broad_refactor",
    defaultPosture: "admin_mode_required",
    evidenceRequirements: ["explicit_admin_intent"],
    rationale: "Child narrows parent broad-refactor policy.",
  }],
}, { now });
const narrowWitness = buildChildPolicyBoundaryWitness({
  parentProfile,
  childProfile: childNarrowProfile,
}, { now });
validateChildPolicyBoundaryWitness(narrowWitness);
assert.equal(narrowWitness.decision, "same_or_narrower");
assert.equal(narrowWitness.blocksPromotion, false);

console.log("direct constitutional policy regression passed");
