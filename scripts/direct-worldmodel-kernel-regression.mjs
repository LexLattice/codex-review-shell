#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA,
  DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA,
  DIRECT_WORLD_SCOPE_REF_SCHEMA,
  activeWorldmodelFixture,
  buildActiveInteractionWorldmodel,
  buildRevisionCompatibility,
  directWorldmodelDigest,
  existingDirectSessionWorldmodelFixture,
  fixtureSourceRefs,
  missingLaneWorldmodelFixture,
  normalizeWorldScopeRef,
  validateActiveInteractionWorldmodel,
  validateRevisionCompatibility,
  validateSourceRefs,
  validateWorldScopeRef,
} = require("../src/main/direct/worldmodel");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, expectedCode) {
  try {
    fn();
  } catch (error) {
    if (expectedCode && error.code !== expectedCode && !String(error.message || "").includes(expectedCode)) {
      throw new Error(`expected ${expectedCode}, got ${error.code || error.message}`);
    }
    return error;
  }
  throw new Error(`expected throw: ${expectedCode}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resign(worldmodel) {
  worldmodel.digest = directWorldmodelDigest(worldmodel);
  return worldmodel;
}

const fixtureA = activeWorldmodelFixture("session");
const fixtureB = activeWorldmodelFixture("session");
assert(fixtureA.digest === fixtureB.digest, "fixture worldmodel digest should be deterministic");
assert(fixtureA.sourceRefs[0].sourceRefId === fixtureB.sourceRefs[0].sourceRefId, "fixture sourceRefId should be deterministic");

for (const scopeKind of ["global_user", "project", "work_thread", "session"]) {
  const worldmodel = activeWorldmodelFixture(scopeKind);
  assert(worldmodel.schema === DIRECT_ACTIVE_INTERACTION_WORLDMODEL_SCHEMA, `${scopeKind} schema mismatch`);
  assert(worldmodel.scope.schema === DIRECT_WORLD_SCOPE_REF_SCHEMA, `${scopeKind} scope schema mismatch`);
  assert(worldmodel.scope.scopeKind === scopeKind, `${scopeKind} scope kind mismatch`);
  assert(worldmodel.rootWorldmodelId === "worldmodel_root_fixture", `${scopeKind} root id mismatch`);
  assert(worldmodel.revision === 1, `${scopeKind} revision mismatch`);
  assert(worldmodel.digest === directWorldmodelDigest(worldmodel), `${scopeKind} digest mismatch`);
  validateActiveInteractionWorldmodel(worldmodel);
}

const globalWorld = activeWorldmodelFixture("global_user");
assert(!globalWorld.scope.projectId, "global_user scope must not require projectId");
assert(!globalWorld.scope.workThreadId, "global_user scope must not require workThreadId");
validateWorldScopeRef(globalWorld.scope);

const projectWorld = activeWorldmodelFixture("project");
assert(projectWorld.scope.projectId === "project_fixture", "project scope projectId mismatch");
assert(!projectWorld.scope.workThreadId, "project scope must not require workThreadId");

const sessionWorld = activeWorldmodelFixture("session");
assert(sessionWorld.scope.sessionId === "direct_session_fixture", "session scope sessionId mismatch");
assert(!sessionWorld.scope.workThreadId, "session scope can exist before WorkThread selection");

const workThreadWorld = activeWorldmodelFixture("work_thread");
assert(workThreadWorld.scope.workThreadId === "work_thread_fixture", "work_thread scope workThreadId mismatch");

expectThrows(() => validateWorldScopeRef({
  ...workThreadWorld.scope,
  workThreadId: "",
}), "direct_worldmodel_missing_string");

const existingSession = existingDirectSessionWorldmodelFixture();
validateActiveInteractionWorldmodel(existingSession);
assert(existingSession.activeThreadId === "direct_session_4e85a44054e74fda", "existing direct session fixture should carry thread id");
assert(existingSession.unknowns.length === 1, "existing direct session fixture should include unknown row");
assert(existingSession.openRemands.length === 1, "existing direct session fixture should include remand row");

const invalidUnknownLane = resign(clone(existingSession));
invalidUnknownLane.unknowns[0].laneKey = "invalidLane";
invalidUnknownLane.digest = directWorldmodelDigest(invalidUnknownLane);
expectThrows(() => validateActiveInteractionWorldmodel(invalidUnknownLane), "direct_worldmodel_invalid_lane_key");

const invalidRemandLane = resign(clone(existingSession));
invalidRemandLane.openRemands[0].laneKey = "invalidLane";
invalidRemandLane.digest = directWorldmodelDigest(invalidRemandLane);
expectThrows(() => validateActiveInteractionWorldmodel(invalidRemandLane), "direct_worldmodel_invalid_lane_key");

const badUnknownDigest = resign(clone(existingSession));
badUnknownDigest.unknowns[0].unknownDigest = "sha256:bad";
badUnknownDigest.digest = directWorldmodelDigest(badUnknownDigest);
expectThrows(() => validateActiveInteractionWorldmodel(badUnknownDigest), "direct_worldmodel_digest_mismatch");

const badRemandDigest = resign(clone(existingSession));
badRemandDigest.openRemands[0].remandDigest = "sha256:bad";
badRemandDigest.digest = directWorldmodelDigest(badRemandDigest);
expectThrows(() => validateActiveInteractionWorldmodel(badRemandDigest), "direct_worldmodel_digest_mismatch");

for (const laneKey of ["task", "environment", "modelSelf", "governance"]) {
  const invalid = missingLaneWorldmodelFixture(laneKey);
  expectThrows(() => validateActiveInteractionWorldmodel(invalid), "direct_worldmodel_invalid_object");
}

const sourceRefs = fixtureSourceRefs("source_ref_validation");
const sourceWorld = buildActiveInteractionWorldmodel({
  worldmodelId: "worldmodel_source_ref_validation",
  scope: {
    scopeKind: "project",
    userProfileId: "user_profile_fixture",
    projectId: "project_fixture",
  },
  sourceRefs,
  task: {
    status: "complete",
    sourceRefs,
    O: ["task object"],
    E: ["task evidence"],
    D: ["task deontic"],
    U: ["task utility"],
  },
  environment: {
    status: "complete",
    sourceRefs,
    O: ["environment object"],
    E: ["environment evidence"],
    D: ["environment deontic"],
    U: ["environment utility"],
  },
  modelSelf: {
    status: "complete",
    sourceRefs,
    O: ["model object"],
    E: ["model evidence"],
    D: ["model deontic"],
    U: ["model utility"],
  },
  governance: {
    status: "complete",
    sourceRefs,
    O: ["governance object"],
    E: ["governance evidence"],
    D: ["governance deontic"],
    U: ["governance utility"],
  },
}, { now: () => Date.UTC(2026, 6, 3, 9, 0, 0) });
validateActiveInteractionWorldmodel(sourceWorld);
validateSourceRefs(sourceWorld.sourceRefs, "sourceWorld.sourceRefs");
expectThrows(() => validateSourceRefs([{ schema: "bad_source_ref@1" }], "badRefs"), "direct_worldmodel_invalid_source_ref");

const badScopeDigest = resign(clone(sourceWorld));
badScopeDigest.scope.scopeDigest = "sha256:bad";
badScopeDigest.digest = directWorldmodelDigest(badScopeDigest);
expectThrows(() => validateActiveInteractionWorldmodel(badScopeDigest), "direct_worldmodel_digest_mismatch");

const badSectionDigest = resign(clone(sourceWorld));
badSectionDigest.task.O.sectionDigest = "sha256:bad";
badSectionDigest.digest = directWorldmodelDigest(badSectionDigest);
expectThrows(() => validateActiveInteractionWorldmodel(badSectionDigest), "direct_worldmodel_digest_mismatch");

const badLaneDigest = resign(clone(sourceWorld));
badLaneDigest.task.laneDigest = "sha256:bad";
badLaneDigest.digest = directWorldmodelDigest(badLaneDigest);
expectThrows(() => validateActiveInteractionWorldmodel(badLaneDigest), "direct_worldmodel_digest_mismatch");

const invalidOptionalField = resign({
  ...sourceWorld,
  parentWorldmodelId: "",
});
expectThrows(() => validateActiveInteractionWorldmodel(invalidOptionalField), "direct_worldmodel_missing_string");

const invalidPreviousDigest = resign({
  ...sourceWorld,
  previousDigest: "not-a-digest",
});
expectThrows(() => validateActiveInteractionWorldmodel(invalidPreviousDigest), "direct_worldmodel_invalid_previous_digest");

const revisionSame = buildRevisionCompatibility({
  expectedWorldmodelId: sourceWorld.worldmodelId,
  expectedRevision: sourceWorld.revision,
  currentWorldmodel: sourceWorld,
  checkedAt: "2026-07-03T09:01:00.000Z",
});
assert(revisionSame.schema === DIRECT_WORLDMODEL_REVISION_COMPATIBILITY_SCHEMA, "revision schema mismatch");
assert(revisionSame.compatibility === "same", "same revision should be compatible");
assert(revisionSame.requiresRemand === false, "same revision should not remand");
validateRevisionCompatibility(revisionSame);

expectThrows(() => validateRevisionCompatibility({
  ...revisionSame,
  compatibilityDigest: "sha256:bad",
}), "direct_worldmodel_digest_mismatch");

const revisionStale = buildRevisionCompatibility({
  expectedWorldmodelId: sourceWorld.worldmodelId,
  expectedRevision: 1,
  currentWorldmodel: { ...sourceWorld, revision: 3 },
});
assert(revisionStale.compatibility === "stale", "older expected revision should be stale");
assert(revisionStale.requiresRemand === true, "stale revision should remand");

const revisionFuture = buildRevisionCompatibility({
  expectedWorldmodelId: sourceWorld.worldmodelId,
  expectedRevision: 5,
  currentWorldmodel: { ...sourceWorld, revision: 3 },
});
assert(revisionFuture.compatibility === "future", "newer expected revision should be future");

const revisionDifferent = buildRevisionCompatibility({
  expectedWorldmodelId: "worldmodel_other",
  expectedRevision: sourceWorld.revision,
  currentWorldmodel: sourceWorld,
});
assert(revisionDifferent.compatibility === "different_worldmodel", "different worldmodel should be detected");

const chained = buildActiveInteractionWorldmodel({
  ...sourceWorld,
  worldmodelId: "worldmodel_child_fixture",
  parentWorldmodelId: sourceWorld.worldmodelId,
  previousDigest: sourceWorld.digest,
  revision: 2,
}, { now: () => Date.UTC(2026, 6, 3, 9, 2, 0) });
assert(chained.parentWorldmodelId === sourceWorld.worldmodelId, "parent worldmodel id missing");
assert(chained.previousDigest === sourceWorld.digest, "previous digest chain missing");
validateActiveInteractionWorldmodel(chained);

const tampered = {
  ...sourceWorld,
  managerAgentId: "agent_tampered",
};
expectThrows(() => validateActiveInteractionWorldmodel(tampered), "direct_worldmodel_digest_mismatch");

const normalizedScope = normalizeWorldScopeRef({
  scopeKind: "session",
  userProfileId: "user_profile_fixture",
  sessionId: "direct_session_fixture",
  workThreadId: "work_thread_optional_fixture",
});
assert(normalizedScope.workThreadId === "work_thread_optional_fixture", "session scope should preserve optional workThreadId");
validateWorldScopeRef(normalizedScope);

console.log("direct worldmodel kernel regression passed");
