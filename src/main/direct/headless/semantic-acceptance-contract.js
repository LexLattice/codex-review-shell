"use strict";

const crypto = require("node:crypto");

const DIRECT_SEMANTIC_ACCEPTANCE_SCENARIO_SCHEMA =
  "direct_semantic_acceptance_scenario@1";
const DIRECT_SEMANTIC_ACCEPTANCE_REPORT_SCHEMA =
  "direct_semantic_acceptance_report@1";

const EXECUTORS = new Set([
  "backend_headless",
  "local_xvfb",
  "docker_xvfb",
  "windows_host",
]);
const ACTION_KINDS = new Set([
  "launch_surface",
  "focus_semantic_region",
  "assert_semantic_state",
  "capture_evidence",
]);
const VERDICTS = new Set([
  "passed",
  "failed",
  "blocked",
  "remanded",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function normalizeStringList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(
    source
      .map((value) => normalizeString(value, ""))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        output[key] = stableValue(value[key]);
      }
    }
    return output;
  }
  return value;
}

function digestFor(domain, value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value))}`)
    .digest("hex")}`;
}

function scenarioStep(input = {}, index = 0) {
  return {
    stepId: normalizeString(input.stepId, `step_${index + 1}`),
    actionKind: normalizeString(input.actionKind, "assert_semantic_state"),
    targetRef: {
      kind: normalizeString(input.targetRef?.kind, "semantic_region"),
      id: normalizeString(input.targetRef?.id, ""),
    },
    expectedState: normalizeString(input.expectedState, ""),
    evidenceLabel: normalizeString(input.evidenceLabel, ""),
  };
}

function buildSemanticAcceptanceScenario(input = {}) {
  for (const [index, step] of (
    Array.isArray(input.steps) ? input.steps : []
  ).entries()) {
    if (
      Object.prototype.hasOwnProperty.call(step || {}, "selector") ||
      Object.prototype.hasOwnProperty.call(
        step?.targetRef || {},
        "selector",
      )
    ) {
      const error = new Error(
        `semantic_acceptance_raw_selector_forbidden:${
          normalizeString(step?.stepId, `step_${index + 1}`)
        }`,
      );
      error.code = "semantic_acceptance_raw_selector_forbidden";
      throw error;
    }
  }
  const scenario = {
    schema: DIRECT_SEMANTIC_ACCEPTANCE_SCENARIO_SCHEMA,
    scenarioId: normalizeString(input.scenarioId, "semantic_acceptance_scenario"),
    revision: boundedInteger(input.revision, 1, 1, 1_000_000),
    title: normalizeString(input.title, "Semantic acceptance scenario"),
    description: normalizeString(input.description, ""),
    executor: {
      requested: normalizeString(input.executor?.requested, "docker_xvfb"),
      allowed: normalizeStringList(
        input.executor?.allowed || ["docker_xvfb"],
      ),
    },
    testWorld: {
      fixtureKind: normalizeString(
        input.testWorld?.fixtureKind,
        "empty_world_manager",
      ),
      disposable: input.testWorld?.disposable !== false,
      testWorldAuthorityOnly:
        input.testWorld?.testWorldAuthorityOnly !== false,
      liveProfileMountAllowed:
        input.testWorld?.liveProfileMountAllowed === true,
      writableHostWorkspaceAllowed:
        input.testWorld?.writableHostWorkspaceAllowed === true,
    },
    runtime: {
      surface: normalizeString(
        input.runtime?.surface,
        "world_manager_production",
      ),
      providerTransport: normalizeString(
        input.runtime?.providerTransport,
        "forbidden",
      ),
      network: normalizeString(input.runtime?.network, "none"),
      workspaceMutation: normalizeString(
        input.runtime?.workspaceMutation,
        "forbidden",
      ),
    },
    budget: {
      maxProviderCalls: boundedInteger(
        input.budget?.maxProviderCalls,
        0,
        0,
        100,
      ),
      timeoutMs: boundedInteger(
        input.budget?.timeoutMs,
        60_000,
        1_000,
        900_000,
      ),
      memoryMb: boundedInteger(
        input.budget?.memoryMb,
        2_048,
        256,
        65_536,
      ),
      cpuCount: Math.max(
        0.25,
        Math.min(64, Number(input.budget?.cpuCount || 2)),
      ),
    },
    steps: (Array.isArray(input.steps) ? input.steps : [])
      .map(scenarioStep),
    expectedEvidence: {
      rendererErrorCount: boundedInteger(
        input.expectedEvidence?.rendererErrorCount,
        0,
        0,
        100_000,
      ),
      providerCallCount: boundedInteger(
        input.expectedEvidence?.providerCallCount,
        0,
        0,
        100,
      ),
      projectCount: boundedInteger(
        input.expectedEvidence?.projectCount,
        0,
        0,
        100_000,
      ),
      canonicalAroCount: boundedInteger(
        input.expectedEvidence?.canonicalAroCount,
        0,
        0,
        100_000,
      ),
      workspaceMutationCount: boundedInteger(
        input.expectedEvidence?.workspaceMutationCount,
        0,
        0,
        100_000,
      ),
      requiredArtifactKinds: normalizeStringList(
        input.expectedEvidence?.requiredArtifactKinds ||
          ["acceptance_report", "surface_screenshot"],
      ),
    },
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    grantsProductionAuthority: false,
  };
  scenario.digest = digestFor(
    DIRECT_SEMANTIC_ACCEPTANCE_SCENARIO_SCHEMA,
    scenario,
  );
  return scenario;
}

function validateSemanticAcceptanceScenario(value) {
  const errors = [];
  if (
    !isPlainObject(value) ||
    value.schema !== DIRECT_SEMANTIC_ACCEPTANCE_SCENARIO_SCHEMA
  ) {
    return ["semantic_acceptance_scenario_schema_mismatch"];
  }
  if (!normalizeString(value.scenarioId, "")) {
    errors.push("semantic_acceptance_scenario_id_missing");
  }
  if (!EXECUTORS.has(value.executor?.requested)) {
    errors.push("semantic_acceptance_executor_unknown");
  }
  if (
    !Array.isArray(value.executor?.allowed) ||
    !value.executor.allowed.includes(value.executor?.requested)
  ) {
    errors.push("semantic_acceptance_executor_not_allowed");
  }
  if (
    value.testWorld?.disposable !== true ||
    value.testWorld?.testWorldAuthorityOnly !== true
  ) {
    errors.push("semantic_acceptance_disposable_test_world_required");
  }
  if (
    value.testWorld?.liveProfileMountAllowed !== false ||
    value.testWorld?.writableHostWorkspaceAllowed !== false
  ) {
    errors.push("semantic_acceptance_host_authority_boundary_invalid");
  }
  if (
    value.runtime?.providerTransport === "forbidden" &&
    value.budget?.maxProviderCalls !== 0
  ) {
    errors.push("semantic_acceptance_provider_budget_invalid");
  }
  if (
    value.runtime?.workspaceMutation === "forbidden" &&
    value.expectedEvidence?.workspaceMutationCount !== 0
  ) {
    errors.push("semantic_acceptance_workspace_effect_expectation_invalid");
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    errors.push("semantic_acceptance_steps_missing");
  } else {
    const stepIds = new Set();
    for (const step of value.steps) {
      if (!normalizeString(step?.stepId, "") || stepIds.has(step.stepId)) {
        errors.push("semantic_acceptance_step_identity_invalid");
      }
      stepIds.add(step?.stepId);
      if (!ACTION_KINDS.has(step?.actionKind)) {
        errors.push(`semantic_acceptance_action_unknown:${step?.actionKind || ""}`);
      }
      if (!normalizeString(step?.targetRef?.id, "")) {
        errors.push(`semantic_acceptance_step_target_missing:${step?.stepId || ""}`);
      }
      if (
        Object.prototype.hasOwnProperty.call(step || {}, "selector") ||
        Object.prototype.hasOwnProperty.call(step?.targetRef || {}, "selector")
      ) {
        errors.push(`semantic_acceptance_raw_selector_forbidden:${step?.stepId || ""}`);
      }
    }
  }
  if (
    value.rawPromptIncluded !== false ||
    value.rawProviderPayloadIncluded !== false ||
    value.grantsProductionAuthority !== false
  ) {
    errors.push("semantic_acceptance_raw_or_authority_posture_invalid");
  }
  if (
    value.digest !==
    digestFor(
      DIRECT_SEMANTIC_ACCEPTANCE_SCENARIO_SCHEMA,
      { ...value, digest: undefined },
    )
  ) {
    errors.push("semantic_acceptance_scenario_digest_mismatch");
  }
  return [...new Set(errors)];
}

function buildSemanticAcceptanceReport(input = {}) {
  const report = {
    schema: DIRECT_SEMANTIC_ACCEPTANCE_REPORT_SCHEMA,
    reportId: normalizeString(input.reportId, "semantic_acceptance_report"),
    runId: normalizeString(input.runId, ""),
    scenarioRef: {
      id: normalizeString(input.scenarioRef?.id, ""),
      digest: normalizeString(input.scenarioRef?.digest, ""),
    },
    executor: normalizeString(input.executor, "docker_xvfb"),
    executorInstanceId: normalizeString(input.executorInstanceId, ""),
    verdict: VERDICTS.has(input.verdict) ? input.verdict : "failed",
    startedAt: normalizeString(input.startedAt, ""),
    completedAt: normalizeString(input.completedAt, ""),
    durationMs: boundedInteger(input.durationMs, 0, 0, 3_600_000),
    checks: (Array.isArray(input.checks) ? input.checks : []).map((check) => ({
      checkId: normalizeString(check?.checkId, ""),
      passed: check?.passed === true,
      expected: check?.expected,
      observed: check?.observed,
      blockerCode: normalizeString(check?.blockerCode, ""),
    })),
    stepResults: (Array.isArray(input.stepResults) ? input.stepResults : [])
      .map((step) => ({
        stepId: normalizeString(step?.stepId, ""),
        actionKind: normalizeString(step?.actionKind, ""),
        status: normalizeString(step?.status, "failed"),
        evidenceRefs: normalizeStringList(step?.evidenceRefs),
      })),
    artifactRefs: (Array.isArray(input.artifactRefs) ? input.artifactRefs : [])
      .map((artifact) => ({
        kind: normalizeString(artifact?.kind, ""),
        relativePath: normalizeString(artifact?.relativePath, ""),
        digest: normalizeString(artifact?.digest, ""),
      })),
    runtimeEvidence: {
      rendererErrorCount: boundedInteger(
        input.runtimeEvidence?.rendererErrorCount,
        0,
        0,
        100_000,
      ),
      providerCallCount: boundedInteger(
        input.runtimeEvidence?.providerCallCount,
        0,
        0,
        100_000,
      ),
      projectCount: boundedInteger(
        input.runtimeEvidence?.projectCount,
        0,
        0,
        100_000,
      ),
      canonicalAroCount: boundedInteger(
        input.runtimeEvidence?.canonicalAroCount,
        0,
        0,
        100_000,
      ),
      workspaceMutationCount: boundedInteger(
        input.runtimeEvidence?.workspaceMutationCount,
        0,
        0,
        100_000,
      ),
      authorityIdentityDigest: normalizeString(
        input.runtimeEvidence?.authorityIdentityDigest,
        "",
      ),
      liveProfileMounted: input.runtimeEvidence?.liveProfileMounted === true,
      writableHostWorkspaceMounted:
        input.runtimeEvidence?.writableHostWorkspaceMounted === true,
    },
    failure: input.failure
      ? {
          code: normalizeString(input.failure.code, "semantic_acceptance_failed"),
          message: normalizeString(input.failure.message, ""),
        }
      : null,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    productionAuthorityGranted: false,
  };
  report.digest = digestFor(
    DIRECT_SEMANTIC_ACCEPTANCE_REPORT_SCHEMA,
    report,
  );
  return report;
}

function validateSemanticAcceptanceReport(value) {
  const errors = [];
  if (
    !isPlainObject(value) ||
    value.schema !== DIRECT_SEMANTIC_ACCEPTANCE_REPORT_SCHEMA
  ) {
    return ["semantic_acceptance_report_schema_mismatch"];
  }
  if (!normalizeString(value.runId, "")) {
    errors.push("semantic_acceptance_report_run_id_missing");
  }
  if (!EXECUTORS.has(value.executor)) {
    errors.push("semantic_acceptance_report_executor_unknown");
  }
  if (!VERDICTS.has(value.verdict)) {
    errors.push("semantic_acceptance_report_verdict_unknown");
  }
  if (
    value.rawPromptIncluded !== false ||
    value.rawProviderPayloadIncluded !== false ||
    value.productionAuthorityGranted !== false
  ) {
    errors.push("semantic_acceptance_report_raw_or_authority_posture_invalid");
  }
  if (
    value.runtimeEvidence?.liveProfileMounted !== false ||
    value.runtimeEvidence?.writableHostWorkspaceMounted !== false
  ) {
    errors.push("semantic_acceptance_report_host_mount_boundary_invalid");
  }
  if (
    value.verdict === "passed" &&
    (value.checks || []).some((check) => check?.passed !== true)
  ) {
    errors.push("semantic_acceptance_report_pass_with_failed_checks");
  }
  if (
    value.digest !==
    digestFor(
      DIRECT_SEMANTIC_ACCEPTANCE_REPORT_SCHEMA,
      { ...value, digest: undefined },
    )
  ) {
    errors.push("semantic_acceptance_report_digest_mismatch");
  }
  return [...new Set(errors)];
}

module.exports = {
  ACTION_KINDS,
  DIRECT_SEMANTIC_ACCEPTANCE_REPORT_SCHEMA,
  DIRECT_SEMANTIC_ACCEPTANCE_SCENARIO_SCHEMA,
  EXECUTORS,
  buildSemanticAcceptanceReport,
  buildSemanticAcceptanceScenario,
  digestFor,
  validateSemanticAcceptanceReport,
  validateSemanticAcceptanceScenario,
};
