#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  conversationFixtureResult,
  createSemanticIngressFixture,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const {
  DirectWorldManagerControlPlaneStore,
} = require(
  "../src/main/direct/worldmanager/control-plane-store",
);
const {
  DirectWorldManagerService,
} = require(
  "../src/main/direct/worldmanager/service",
);
const {
  bindOperationalMetaContextToCompiledContext,
  buildContextRequirementSet,
  buildSemanticContextImportRequest,
  materializeSemanticContext,
  validateContextRequirementSet,
} = require(
  "../src/main/direct/worldmanager/semantic-context-kernel",
);
const {
  DIRECT_COMPILED_AGENT_TURN_POLICY_ID,
  buildContextPack,
  buildRequestManifest,
} = require(
  "../src/main/direct/thread/context-pack",
);
const {
  digestFor,
} = require(
  "../src/main/direct/worldmanager/control-plane",
);

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "direct-world-manager-sc4-",
  ),
);
let tick = Date.parse("2026-07-30T09:00:00.000Z");
const now = () => {
  tick += 1_000;
  return tick;
};
const projects = [
  {
    id: "project_alpha",
    name: "Project Alpha",
    summary: "SC4 focal project.",
    runtimePath: "direct",
  },
  {
    id: "project_beta",
    name: "Project Beta",
    summary:
      "SC4 peer project whose context must remain excluded.",
    runtimePath: "direct",
  },
];
const store = new DirectWorldManagerControlPlaneStore({
  rootDir,
  now,
});
const service = new DirectWorldManagerService({
  store,
  userWorldId: "user_world_sc4",
  projects,
  activeProjectId: "project_beta",
  semanticIngressRunner: createSemanticIngressFixture({
    overrides: {
      sc4_world_conversation:
        conversationFixtureResult(),
    },
  }),
  now,
});
service.bootstrap();

function submit(clientRequestId, text, projectId) {
  return service.submit({
    schema: "direct_world_manager_submit_request@1",
    clientRequestId,
    text,
    scopeHint: { projectId },
    expectedProjectionRevision:
      service.snapshot().projectionRevision,
    attachmentDraftRefs: [],
  });
}

const worldConversation = submit(
  "sc4_world_conversation",
  "Hello. Keep this as ordinary world conversation.",
  "",
);
const worldConversationContext =
  store.operationalMetaContextForSemanticEvent(
    worldConversation.receipt.semanticEventRef.id,
  );
assert.ok(worldConversationContext);
assert.equal(
  worldConversationContext.bundle.sourceShelfRefs
    .some((ref) =>
      ref.label === "user_world_project_ecology"),
  false,
);
const planned = submit(
  "sc4_alpha_plan",
  "Plan the next Alpha milestone without starting implementation.",
  "project_alpha",
);
const eventId = planned.receipt.semanticEventRef.id;
const persisted =
  store.settlementForSemanticEvent(eventId);
const storedWorld = store.agentWorldForSemanticEvent(
  eventId,
  { full: true },
);
assert.ok(persisted?.taskSettlement);
assert.ok(storedWorld?.compilation);

const first = store.operationalMetaContextForSemanticEvent(
  eventId,
);
assert.ok(first);
assert.equal(
  first.requirementSet.schema,
  "direct_context_requirement_set@1",
);
assert.equal(
  first.importRequest.schema,
  "direct_semantic_context_import_request@1",
);
assert.equal(
  first.bundle.schema,
  "direct_semantic_context_bundle@1",
);
assert.equal(
  first.selectionWitness.schema,
  "direct_semantic_context_selection_witness@1",
);
assert.equal(
  first.operationalManifest.schema,
  "direct_operational_meta_context_manifest@1",
);
assert.equal(first.bundle.freshness, "fresh");
assert.equal(first.bundle.worldEffect, "none");
assert.equal(first.bundle.grantsAuthority, false);
assert.equal(
  first.operationalManifest.grantsAuthority,
  false,
);
assert.equal(
  first.requirementSet.scope.projectId,
  "project_alpha",
);
assert.ok(
  first.bundle.sourceShelfRefs.length >= 3,
);
const betaShelfIds = new Set(
  store.listSemanticShelves({
    currentOnly: true,
    limit: 5000,
  })
    .filter((shelf) =>
      shelf.anchorRefs.some((ref) =>
        ref.kind === "project" &&
        ref.id === "project_beta"))
    .map((shelf) => shelf.shelfId),
);
assert.equal(
  first.bundle.sourceShelfRefs.some((ref) =>
    betaShelfIds.has(ref.id)),
  false,
);
assert.ok(
  first.selectionWitness.crossScopeExclusions
    .some((ref) => betaShelfIds.has(ref.id)),
);
assert.equal(
  first.bundle.content.relevantEvents.some((event) =>
    event.eventRef.id === eventId),
  false,
);
assert.ok(
  first.bundle.content.relevantEvents.every((event) =>
    typeof event.semanticSummary === "string" &&
    !("text" in event)),
);

const preparedAgain =
  service.prepareOperationalMetaContext(
    persisted.taskSettlement,
    storedWorld.compilation,
  );
assert.equal(preparedAgain.reused, true);
assert.equal(
  preparedAgain.bundle.contextBundleId,
  first.bundle.contextBundleId,
);

const boundCompiledContext =
  bindOperationalMetaContextToCompiledContext(
    storedWorld.compilation.compiledAgentContext,
    preparedAgain.binding,
  );
const contextPack = buildContextPack({
  projectId: "project_alpha",
  threadId: "sc4_thread",
  turnId: "sc4_turn",
  purpose: "direct_compiled_agent_turn",
  policyId: DIRECT_COMPILED_AGENT_TURN_POLICY_ID,
  currentUserPrompt:
    "Plan the next Alpha milestone.",
  compiledAgentContext: boundCompiledContext,
  nowMs: now(),
});
const semanticContextMessage =
  contextPack.messages.find((message) =>
    message.authority ===
      "semantic-context-evidence");
assert.ok(semanticContextMessage);
assert.equal(
  semanticContextMessage.quotedEvidence,
  true,
);
assert.equal(
  semanticContextMessage.grantsAuthority,
  false,
);
assert.ok(
  contextPack.sourceArtifacts.some((artifact) =>
    artifact.artifactKind ===
      "operational_meta_context_manifest"),
);
const { requestManifest } = buildRequestManifest({
  contextPack,
  model: "gpt-5.6-sol",
  requestShape: {
    requestShapeClass:
      "direct_compiled_agent_turn@1",
    toolCount: 0,
  },
  nowMs: now(),
});
assert.equal(
  requestManifest.operationalMetaContext
    .operationalMetaContextRef.id,
  first.operationalManifest
    .operationalMetaContextId,
);
assert.equal(
  requestManifest.operationalMetaContext
    .rendererProviderInputMutationAccepted,
  false,
);
assert.equal(
  requestManifest.rawRequestBodyStored,
  false,
);

const constrainedRequirements =
  buildContextRequirementSet({
    taskSettlement: persisted.taskSettlement,
    compilation: storedWorld.compilation,
    userWorldId: "user_world_sc4",
    maxInputTokens: 256,
    maxObjects: 1,
    latestTurns: 1,
    createdAt:
      persisted.taskSettlement.createdAt,
  });
const constrainedRequest =
  buildSemanticContextImportRequest({
    requirementSet: constrainedRequirements,
    createdAt:
      persisted.taskSettlement.createdAt,
  });
const constrained = materializeSemanticContext({
  requirementSet: constrainedRequirements,
  importRequest: constrainedRequest,
  compilation: storedWorld.compilation,
  repository: store,
  createdAt:
    persisted.taskSettlement.createdAt,
});
assert.ok(
  constrained.selectionWitness.estimatedTokens <=
    constrainedRequirements.budget.maxInputTokens,
);
assert.ok(
  constrained.bundle.content.semanticObjects.length <= 1,
);

const foreignAnchorRequirements =
  structuredClone(constrainedRequirements);
foreignAnchorRequirements.anchors.find((anchor) =>
  anchor.kind === "project").ref.id = "project_beta";
foreignAnchorRequirements.digest = digestFor(
  foreignAnchorRequirements.schema,
  foreignAnchorRequirements,
  ["digest"],
);
assert.throws(
  () => validateContextRequirementSet(
    foreignAnchorRequirements,
  ),
  (error) =>
    error.code ===
      "semantic_context_requirement_scope_mismatch",
);

submit(
  "sc4_alpha_followup",
  "Refine Alpha's next milestone and keep it provisional.",
  "project_alpha",
);
const refreshed =
  service.prepareOperationalMetaContext(
    persisted.taskSettlement,
    storedWorld.compilation,
  );
assert.equal(refreshed.reused, false);
assert.notEqual(
  refreshed.bundle.dependencyDigest,
  first.bundle.dependencyDigest,
);
assert.notEqual(
  refreshed.bundle.contextBundleId,
  first.bundle.contextBundleId,
);
const historicalForAgent =
  store.listOperationalMetaContexts({
    full: true,
    currentOnly: false,
    limit: 5000,
  }).filter((record) =>
    record.requirementSet.agentInstantiationRef.id ===
      first.requirementSet.agentInstantiationRef.id);
assert.equal(historicalForAgent.length, 2);
assert.equal(
  historicalForAgent.filter((record) =>
    record.currentState === "current").length,
  1,
);
assert.equal(
  historicalForAgent.filter((record) =>
    record.currentState === "stale").length,
  1,
);

const ecologyStatus = submit(
  "sc4_project_ecology_status",
  "What is the current status of our projects?",
  "",
);
const ecologyEventId =
  ecologyStatus.receipt.semanticEventRef.id;
const ecologyPersisted =
  store.settlementForSemanticEvent(ecologyEventId);
const ecologyWorld =
  store.agentWorldForSemanticEvent(
    ecologyEventId,
    { full: true },
  );
assert.equal(
  ecologyPersisted.taskSettlement.taskType,
  "project_ecology_status",
);
assert.equal(
  ecologyPersisted.taskSettlement.projectId,
  "",
);
const ecologyContext =
  store.operationalMetaContextForSemanticEvent(
    ecologyEventId,
  );
assert.deepEqual(
  ecologyContext.requirementSet.requiredShelfKinds,
  ["user_world_project_ecology"],
);
assert.equal(ecologyContext.requirementSet.scope.kind, "user_world");
assert.equal(
  ecologyContext.requirementSet.scope.subjectKind,
  "project_ecology",
);
assert.deepEqual(
  ecologyContext.requirementSet.scope.subjectProjectIds,
  ["project_alpha", "project_beta"],
);
assert.ok(
  ecologyContext.bundle.sourceShelfRefs.some((ref) =>
    ref.label === "user_world_project_ecology"),
);
const projectStatuses =
  ecologyContext.bundle.content.semanticObjects
    .filter((object) =>
      object.objectClass === "project_status");
assert.deepEqual(
  projectStatuses.map((object) =>
    object.boundedProjection.projectId).sort(),
  ["project_alpha", "project_beta"],
);
assert.ok(
  projectStatuses.every((object) =>
    object.boundedProjection.statusSummary &&
    object.boundedProjection.summary),
);
assert.equal(
  ecologyContext.bundle.sourceShelfRefs.some((ref) =>
    ref.label?.startsWith("project_")),
  false,
);
const ecologyPrepared =
  service.prepareOperationalMetaContext(
    ecologyPersisted.taskSettlement,
    ecologyWorld.compilation,
  );
assert.match(
  ecologyPrepared.binding.providerProjectionText,
  /Admitted bounded project-ecology status:/,
);
assert.match(
  ecologyPrepared.binding.providerProjectionText,
  /Project Alpha/,
);
assert.match(
  ecologyPrepared.binding.providerProjectionText,
  /Project Beta/,
);

const linked =
  store.linkOperationalMetaContextToRequestManifest({
    operationalContext: refreshed,
    directSessionId: "sc4_direct_session",
    directTurnId: "sc4_direct_turn",
    requestManifestId:
      requestManifest.requestManifestId,
  });
assert.equal(linked.link.grantsAuthority, false);
assert.equal(
  store.operationalMetaContextForAgentInstantiation(
    refreshed.requirementSet.agentInstantiationRef.id,
  ).link.requestManifestId,
  requestManifest.requestManifestId,
);
const projection = service.snapshot();
assert.equal(
  projection.operationalMetaContext.schema,
  "direct_operational_meta_context_projection@1",
);
assert.equal(
  projection.operationalMetaContext
    .canonicalWorldstateMutation,
  false,
);
assert.equal(
  projection.operationalMetaContext.grantsAuthority,
  false,
);
assert.ok(
  projection.operationalMetaContext.currentManifestCount >=
    2,
);

service.close();

console.log(JSON.stringify({
  ok: true,
  regression:
    "direct-world-manager-semantic-context-sc4",
  proofs: {
    contextRequirementsCompiledFromSettlement: true,
    worldConversationDoesNotAmbientlyImportProjectEcology:
      true,
    worldGovernedEcologyStatusImportsBoundedProjectObjects:
      true,
    importContextMaterializesTypedBundle: true,
    semanticOutcomesAndObjectsAreBudgeted: true,
    crossProjectShelvesFailClosed: true,
    selectionOmissionsAreWitnessed: true,
    repeatedImportsReuseExactCache: true,
    dependencyChangesInvalidateImmutableCache: true,
    providerInputUsesQuotedNonAuthorityEvidence: true,
    directRequestManifestPinsContextLineage: true,
    rendererProjectionExposesNoRawEvidence: true,
  },
}, null, 2));
