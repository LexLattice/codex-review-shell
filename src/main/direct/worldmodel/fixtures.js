"use strict";

const {
  buildActiveInteractionWorldmodel,
} = require("./kernel");

function fixtureNow() {
  return Date.UTC(2026, 6, 3, 9, 0, 0);
}

function safeFixtureId(value) {
  return String(value || "worldmodel_fixture")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "worldmodel_fixture";
}

function fixtureSourceRefs(label = "worldmodel_fixture") {
  const safeLabel = safeFixtureId(label);
  return [
    {
      sourceRefId: `source_${safeLabel}`,
      sourceKind: "family_specific",
      sourceId: label,
      sourceConfidence: "fixture",
      freshness: "fresh",
      rowId: `${label}_row_1`,
      observedAt: "2026-07-03T09:00:00.000Z",
    },
  ];
}

function laneFixture(laneLabel, sourceRefs = fixtureSourceRefs(laneLabel)) {
  const safeLaneLabel = safeFixtureId(laneLabel);
  return {
    laneId: `${safeLaneLabel}_lane_fixture`,
    status: "complete",
    sourceRefs,
    O: {
      summary: `${laneLabel} object world`,
      entries: [{
        entryId: `${safeLaneLabel}_O_entry_fixture`,
        statement: `${laneLabel} object state is typed.`,
      }],
    },
    E: {
      summary: `${laneLabel} evidence world`,
      entries: [{
        entryId: `${safeLaneLabel}_E_entry_fixture`,
        statement: `${laneLabel} evidence is fixture-backed.`,
      }],
    },
    D: {
      summary: `${laneLabel} deontic world`,
      entries: [{
        entryId: `${safeLaneLabel}_D_entry_fixture`,
        statement: `${laneLabel} authority boundary is explicit.`,
      }],
    },
    U: {
      summary: `${laneLabel} utility world`,
      entries: [{
        entryId: `${safeLaneLabel}_U_entry_fixture`,
        statement: `${laneLabel} success criteria are stated.`,
      }],
    },
  };
}

function scopeFixture(scopeKind = "session") {
  if (scopeKind === "global_user") {
    return {
      scopeKind,
      userProfileId: "user_profile_fixture",
    };
  }
  if (scopeKind === "project") {
    return {
      scopeKind,
      userProfileId: "user_profile_fixture",
      projectId: "project_fixture",
    };
  }
  if (scopeKind === "work_thread") {
    return {
      scopeKind,
      userProfileId: "user_profile_fixture",
      projectId: "project_fixture",
      workThreadId: "work_thread_fixture",
    };
  }
  return {
    scopeKind: "session",
    userProfileId: "user_profile_fixture",
    projectId: "project_fixture",
    sessionId: "direct_session_fixture",
  };
}

function activeWorldmodelFixture(scopeKind = "session", overrides = {}) {
  const sourceRefs = fixtureSourceRefs(`worldmodel_${scopeKind}`);
  return buildActiveInteractionWorldmodel({
    worldmodelId: `worldmodel_${scopeKind}_fixture`,
    rootWorldmodelId: "worldmodel_root_fixture",
    parentWorldmodelId: overrides.parentWorldmodelId,
    scope: scopeFixture(scopeKind),
    managerAgentId: "agent_worldmodel_manager_fixture",
    subjectAgentId: overrides.subjectAgentId || "agent_resident_fixture",
    activeThreadId: overrides.activeThreadId || (scopeKind === "session" ? "direct_session_fixture" : ""),
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T09:00:00.000Z",
    revision: overrides.revision || 1,
    previousDigest: overrides.previousDigest,
    sourceRefs,
    staleRefs: overrides.staleRefs || [],
    task: laneFixture("task", sourceRefs),
    environment: laneFixture("environment", sourceRefs),
    modelSelf: laneFixture("model_self", sourceRefs),
    governance: laneFixture("governance", sourceRefs),
    unknowns: overrides.unknowns || [],
    openRemands: overrides.openRemands || [],
  }, { now: fixtureNow });
}

function existingDirectSessionWorldmodelFixture() {
  return activeWorldmodelFixture("session", {
    subjectAgentId: "agent_direct_session_fixture",
    activeThreadId: "direct_session_4e85a44054e74fda",
    unknowns: [
      {
        unknownKind: "capability_unknown",
        laneKey: "modelSelf",
        summary: "Fixture records that live tool promotion can be unknown without collapsing the worldmodel.",
        sourceRefs: fixtureSourceRefs("direct_session_capability_unknown"),
      },
    ],
    openRemands: [
      {
        remandKind: "need_manager_resolution",
        laneKey: "governance",
        summary: "Manager should resolve standing policy before a worker receives expanded authority.",
        sourceRefs: fixtureSourceRefs("direct_session_policy_remand"),
      },
    ],
  });
}

function missingLaneWorldmodelFixture(laneKey = "task") {
  const worldmodel = activeWorldmodelFixture("session");
  delete worldmodel[laneKey];
  worldmodel.digest = "sha256:fixture_invalid_missing_lane";
  return worldmodel;
}

module.exports = {
  activeWorldmodelFixture,
  existingDirectSessionWorldmodelFixture,
  fixtureSourceRefs,
  laneFixture,
  missingLaneWorldmodelFixture,
  scopeFixture,
};
