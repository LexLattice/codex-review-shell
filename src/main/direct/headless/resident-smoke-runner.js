"use strict";

const crypto = require("node:crypto");
const {
  buildResidentEpistemicSnapshot,
} = require("../bridge/resident-epistemic-snapshot");
const {
  buildResidentEpistemicContextPolicy,
  applyResidentEpistemicContextPolicy,
  buildResidentSelfReportDiagnostics,
  validateResidentEpistemicContextBundle,
} = require("../bridge/resident-epistemic-context-policy");
const {
  executeHeadlessAffordanceCommand,
} = require("./affordance-command-surface");
const {
  normalizeString,
  stableStringify,
} = require("./bridge-store");

const HEADLESS_RESIDENT_SMOKE_CASE_SCHEMA = "headless_resident_smoke_case@1";
const HEADLESS_RESIDENT_SMOKE_CASE_REPORT_SCHEMA = "headless_resident_smoke_case_report@1";
const HEADLESS_RESIDENT_SMOKE_SUITE_SCHEMA = "headless_resident_smoke_suite@1";
const HEADLESS_RESIDENT_SMOKE_SUITE_REPORT_SCHEMA = "headless_resident_smoke_suite_report@1";
const DEFAULT_CLIENT_ID = "resident_smoke_client";
const DEFAULT_ROUTE_ID = "route_text";
const DEFAULT_ROUTE_VERSION = "v1";
const DEFAULT_WORK_THREAD_ID = "wt_resident_smoke";
const DEFAULT_THREAD_ID = "direct_session_headless_resident_smoke";
const CASE_STATUSES = new Set(["pass", "fail", "skip", "degraded"]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function shortDigest(value) {
  return sha256(value).slice(7, 31);
}

function nowIso(nowMs = Date.now()) {
  const timestamp = Number(nowMs);
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
}

function normalizeStringList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function evidenceRef(kind, label, extra = {}) {
  return {
    kind,
    rendererSafeLabel: label,
    ...extra,
  };
}

function defaultCommandBase(overrides = {}) {
  return {
    clientId: normalizeString(overrides.clientId, DEFAULT_CLIENT_ID),
    requestedRouteId: normalizeString(overrides.requestedRouteId, DEFAULT_ROUTE_ID),
    routeVersion: normalizeString(overrides.routeVersion, DEFAULT_ROUTE_VERSION),
    workThreadId: normalizeString(overrides.workThreadId, DEFAULT_WORK_THREAD_ID),
  };
}

function buildDefaultResidentSmokeSnapshot(options = {}) {
  return buildResidentEpistemicSnapshot({
    workThreadId: normalizeString(options.workThreadId, DEFAULT_WORK_THREAD_ID),
    codexThreadId: normalizeString(options.threadId, DEFAULT_THREAD_ID),
    runtimeFamily: "direct",
    generatedAt: nowIso(options.nowMs),
    declarationDigest: sha256("headless-resident-smoke-declarations@1"),
    projectionBudget: { maxRows: 12, maxChars: 2600, truncationPolicy: "priority_then_summary" },
    rows: [
      {
        subjectKind: "tool",
        subjectId: "direct.read_file",
        displayLabel: "Read file tool",
        status: "callable_now",
        knowledgeClass: "registry_declared",
        callableInCurrentRequest: true,
        declaredAsProviderTool: true,
        controlAvailable: true,
        availableActions: ["call_with_per_call_gate"],
        perCallAuthorityRequired: true,
        authorityUse: "may_prepare_call",
        priority: "critical",
        evidenceRefs: [{ refId: "direct.read_file", source: "tool_declaration" }],
        compactText: "Read file is callable now through a per-call authority gate.",
      },
      {
        subjectKind: "tool",
        subjectId: "direct.patch_apply",
        displayLabel: "Patch apply tool",
        status: "known_disabled",
        knowledgeClass: "registry_declared",
        callableInCurrentRequest: false,
        declaredAsProviderTool: false,
        controlState: "blocked_by_missing_authority",
        blockedActions: ["apply_patch"],
        blockerCodes: ["patch_tool_not_enabled_in_fixture"],
        enablementPath: [{
          kind: "capability_promotion",
          label: "Promote patch apply through the tool activation gate before exposing it.",
          authorityRequired: true,
          enablementPathUse: "operator_explanation_only",
        }],
        authorityUse: "may_not_act",
        priority: "high",
        evidenceRefs: [{ refId: "direct.patch_apply", source: "activation_registry" }],
        compactText: "Patch apply is known but disabled in this smoke fixture.",
      },
      {
        subjectKind: "runtime",
        subjectId: "direct-runtime",
        displayLabel: "Direct runtime",
        status: "known_available",
        knowledgeClass: "exact_runtime",
        authorityUse: "may_not_act",
        priority: "critical",
        evidenceRefs: [{ refId: "route_text", source: "route_status" }],
        compactText: "Direct runtime route is active for this headless smoke.",
      },
      {
        subjectKind: "model",
        subjectId: "gpt-5.5:medium",
        displayLabel: "GPT-5.5 medium",
        status: "known_available",
        knowledgeClass: "provider_metadata",
        authorityUse: "may_not_act",
        priority: "high",
        evidenceRefs: [{ refId: "model:gpt-5.5:medium", source: "provider_metadata" }],
        compactText: "Current model family and reasoning effort are visible as metadata.",
      },
      {
        subjectKind: "quota",
        subjectId: "quota-windows",
        displayLabel: "Quota windows",
        status: "stale",
        freshness: "stale",
        knowledgeClass: "quota_snapshot",
        authorityUse: "may_not_act",
        priority: "normal",
        blockerCodes: ["quota_snapshot_stale"],
        evidenceRefs: [{ refId: "quota:fixture", source: "quota_snapshot" }],
        compactText: "Quota is visible as stale evidence; it must not be treated as fresh quota authority.",
      },
      {
        subjectKind: "context",
        subjectId: "context-pressure",
        displayLabel: "Context pressure",
        status: "known_available",
        knowledgeClass: "derived_projection",
        authorityUse: "may_not_act",
        priority: "normal",
        evidenceRefs: [{ refId: "context:fixture", source: "context_pack" }],
        compactText: "Context pressure facts are visible as a planning witness.",
      },
      {
        subjectKind: "sub_agent",
        subjectId: "agent-carver",
        displayLabel: "Carver sub-agent",
        status: "known_available",
        knowledgeClass: "harness_observed",
        controlState: "blocked_by_policy",
        blockedActions: ["send_input", "close_agent", "resume_agent"],
        blockerCodes: ["no_interference_policy_active"],
        authorityUse: "may_not_act",
        priority: "high",
        evidenceRefs: [{ refId: "sub_agent:carver", source: "sub_agent_e_channel" }],
        compactText: "Sub-agent Carver is observable through the E-channel; interference actions are blocked by policy.",
      },
    ],
  });
}

function buildDefaultResidentSmokeBundle(options = {}) {
  const snapshot = options.snapshot || buildDefaultResidentSmokeSnapshot(options);
  const policy = buildResidentEpistemicContextPolicy({
    policyId: normalizeString(options.policyId, "headless_resident_smoke_policy"),
    projectId: normalizeString(options.projectId, "project_resident_smoke"),
    workThreadId: snapshot.workThreadId,
    includeSubjectKinds: ["tool", "runtime", "model", "quota", "context", "sub_agent"],
    defaultStaleBehavior: "summarize_as_stale",
    projectionBudget: { maxRows: 12, maxChars: 2600, truncationPolicy: "priority_then_summary" },
  });
  return applyResidentEpistemicContextPolicy({ snapshot, policy });
}

function defaultSelfReportFor(caseClass = "") {
  if (caseClass === "tool_visibility_self_report") {
    return {
      source: "fixture_declared",
      claims: [
        { subjectKind: "tool", subjectId: "direct.read_file", field: "callableInCurrentRequest", value: true },
        { subjectKind: "tool", subjectId: "direct.patch_apply", field: "status", value: "known_disabled" },
        { subjectKind: "tool", subjectId: "direct.patch_apply", field: "callableInCurrentRequest", value: false },
      ],
    };
  }
  if (caseClass === "runtime_metadata_visibility") {
    return {
      source: "fixture_declared",
      claims: [
        { subjectKind: "runtime", subjectId: "direct-runtime", field: "status", value: "known_available" },
        { subjectKind: "model", subjectId: "gpt-5.5:medium", field: "status", value: "known_available" },
        { subjectKind: "quota", subjectId: "quota-windows", field: "status", value: "stale" },
        { subjectKind: "context", subjectId: "context-pressure", field: "status", value: "known_available" },
      ],
    };
  }
  if (caseClass === "sub_agent_observation_boundary") {
    return {
      source: "fixture_declared",
      claims: [
        { subjectKind: "sub_agent", subjectId: "agent-carver", field: "status", value: "known_available" },
        { subjectKind: "sub_agent", subjectId: "agent-carver", field: "controlState", value: "blocked_by_policy" },
      ],
    };
  }
  if (caseClass === "overclaim_detection_guard") {
    return {
      source: "fixture_declared",
      claims: [
        { subjectKind: "tool", subjectId: "direct.patch_apply", field: "callableInCurrentRequest", value: true },
        { subjectKind: "tool", subjectId: "missing-tool", field: "status", value: "callable_now" },
      ],
    };
  }
  return { source: "fixture_declared", claims: [] };
}

function smokeCaseIdFor(name = "", index = 0) {
  return `headless_resident_smoke_${shortDigest(`${index}:${name}`)}`;
}

function buildResidentSmokeCase(input = {}, index = 0) {
  const caseClass = normalizeString(input.caseClass || input.scenarioClass, "unknown");
  const caseId = normalizeString(input.caseId, smokeCaseIdFor(input.name || caseClass, index));
  return {
    schema: HEADLESS_RESIDENT_SMOKE_CASE_SCHEMA,
    caseId,
    caseClass,
    name: normalizeString(input.name, caseId),
    description: normalizeString(input.description, ""),
    expectedStatus: normalizeString(input.expectedStatus, "pass"),
    expectedMismatchCount: Math.max(0, Number(input.expectedMismatchCount) || 0),
    expectedUnknownSubjectCount: Math.max(0, Number(input.expectedUnknownSubjectCount) || 0),
    submitThroughBridge: input.submitThroughBridge !== false,
    maxPromptChars: Math.max(200, Number(input.maxPromptChars) || 1600),
    selfReport: isPlainObject(input.selfReport) ? input.selfReport : defaultSelfReportFor(caseClass),
    requiredBundleSubjects: normalizeStringList(input.requiredBundleSubjects),
    evidenceRefs: [
      evidenceRef("headless_resident_smoke_case", "Headless resident smoke case", { artifactId: caseId }),
      ...(Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []),
    ],
  };
}

function buildDefaultHeadlessResidentSmokeSuite(options = {}) {
  const cases = [
    {
      caseClass: "tool_visibility_self_report",
      name: "Tool visibility self-report parity",
      description: "Resident report matches callable and disabled tool rows.",
      requiredBundleSubjects: ["tool:direct.read_file", "tool:direct.patch_apply"],
    },
    {
      caseClass: "runtime_metadata_visibility",
      name: "Runtime metadata visibility",
      description: "Resident report matches runtime, model, quota, and context rows.",
      requiredBundleSubjects: ["runtime:direct-runtime", "model:gpt-5.5:medium", "quota:quota-windows", "context:context-pressure"],
    },
    {
      caseClass: "sub_agent_observation_boundary",
      name: "Sub-agent observation boundary",
      description: "Resident sees sub-agent state as knowledge, not interference authority.",
      requiredBundleSubjects: ["sub_agent:agent-carver"],
    },
    {
      caseClass: "overclaim_detection_guard",
      name: "Unavailable capability overclaim guard",
      description: "Resident overclaims are recorded as mismatches/unknown subjects instead of authority.",
      expectedMismatchCount: 1,
      expectedUnknownSubjectCount: 1,
      requiredBundleSubjects: ["tool:direct.patch_apply"],
    },
  ].map((entry, index) => buildResidentSmokeCase(entry, index));
  return {
    schema: HEADLESS_RESIDENT_SMOKE_SUITE_SCHEMA,
    suiteId: normalizeString(options.suiteId, "headless_resident_smoke_suite_v1"),
    caseCount: cases.length,
    caseClasses: cases.map((entry) => entry.caseClass),
    cases,
    fixtureSafe: true,
    liveProviderRequired: false,
    workspaceMutationExpected: false,
    evidenceRefs: [evidenceRef("headless_resident_smoke_suite", "Default headless resident smoke suite")],
  };
}

function subjectKey(row = {}) {
  return `${normalizeString(row.subjectKind, "unknown")}:${normalizeString(row.subjectId, "")}`;
}

function boundedPrompt(text = "", maxChars = 1600) {
  const source = normalizeString(text, "");
  if (source.length <= maxChars) return source;
  return `${source.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function buildResidentSmokePrompt({ bundle, smokeCase } = {}) {
  const compactText = normalizeString(bundle?.policySnapshot?.compactResidentText, "");
  const instruction = [
    "Return only a JSON object with a claims array.",
    "Each claim must use subjectKind, subjectId, field, and value.",
    "Do not claim a tool is callable unless the witness says callableInCurrentRequest=true.",
    "Do not treat sub-agent observation as control authority.",
    "",
    compactText,
    "",
    `Smoke case: ${normalizeString(smokeCase?.caseClass, "unknown")}`,
  ].join("\n");
  return boundedPrompt(instruction, Math.max(200, Number(smokeCase?.maxPromptChars) || 1600));
}

function assertionRow(input = {}) {
  const passed = input.passed === true;
  return {
    assertionId: normalizeString(input.assertionId, "unknown_assertion"),
    expected: input.expected,
    observed: input.observed,
    passed,
    blockerCode: passed ? "" : normalizeString(input.blockerCode, "assertion_failed"),
  };
}

async function waitForPacketState({ store, packetId, expectedState, timeoutMs = 5000 }) {
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 5000);
  while (Date.now() < deadline) {
    const packet = store.readTurnPacket(packetId);
    if (packet?.state === expectedState) return packet;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return store.readTurnPacket(packetId);
}

function defaultSelfReportProvider({ smokeCase }) {
  return isPlainObject(smokeCase?.selfReport) ? smokeCase.selfReport : { source: "fixture_declared", claims: [] };
}

async function submitSmokePrompt({ daemon, smokeCase, bundle, commandBase, commandRunId }) {
  const prompt = buildResidentSmokePrompt({ bundle, smokeCase });
  const result = executeHeadlessAffordanceCommand({
    daemon,
    command: {
      ...commandBase,
      commandKind: "submit_text_turn",
      commandId: `resident_smoke_submit_${shortDigest(`${smokeCase.caseId}:${commandRunId}`)}`,
      idempotencyKey: `resident-smoke-submit-${shortDigest(`${smokeCase.caseId}:${commandRunId}`)}`,
      text: prompt,
      eventKind: "resident_self_report_smoke",
      factSourcePosture: "harness_diagnostic",
      model: "gpt-5.5",
      reasoningEffort: "low",
    },
  });
  const packet = result?.result?.turnPacket || null;
  const terminalPacket = packet?.packetId
    ? await waitForPacketState({
      store: daemon.store,
      packetId: packet.packetId,
      expectedState: "provider_completed",
      timeoutMs: 5000,
    })
    : null;
  return {
    result,
    promptDigest: sha256(prompt),
    promptChars: prompt.length,
    packet,
    terminalPacket,
  };
}

function requiredSubjectsAssertions(smokeCase = {}, bundle = {}) {
  const rows = Array.isArray(bundle?.policySnapshot?.rows) ? bundle.policySnapshot.rows : [];
  const present = new Set(rows.map(subjectKey));
  return normalizeStringList(smokeCase.requiredBundleSubjects).map((key) => assertionRow({
    assertionId: `subject_visible:${key}`,
    expected: true,
    observed: present.has(key),
    passed: present.has(key),
    blockerCode: "resident_subject_missing",
  }));
}

async function runHeadlessResidentSmokeCase({ daemon, smokeCase, bundle, selfReportProvider, commandBase, commandRunId } = {}) {
  const safeCase = isPlainObject(smokeCase) ? smokeCase : buildResidentSmokeCase({ caseClass: "unknown" });
  const assertions = [];
  let submit = null;
  if (safeCase.submitThroughBridge) {
    submit = await submitSmokePrompt({ daemon, smokeCase: safeCase, bundle, commandBase, commandRunId });
    assertions.push(assertionRow({
      assertionId: "prompt_submit_accepted",
      expected: "accepted",
      observed: submit.result?.status,
      passed: submit.result?.status === "accepted",
      blockerCode: submit.result?.blockerCode,
    }));
    assertions.push(assertionRow({
      assertionId: "prompt_terminal",
      expected: "provider_completed",
      observed: submit.terminalPacket?.state || "",
      passed: submit.terminalPacket?.state === "provider_completed",
      blockerCode: submit.terminalPacket?.blockerCode,
    }));
  }
  assertions.push(...requiredSubjectsAssertions(safeCase, bundle));
  const selfReport = await (selfReportProvider || defaultSelfReportProvider)({ smokeCase: safeCase, bundle, submit });
  const diagnostic = buildResidentSelfReportDiagnostics({
    snapshot: bundle.policySnapshot,
    selfReport,
  });
  assertions.push(assertionRow({
    assertionId: "expected_mismatch_count",
    expected: safeCase.expectedMismatchCount,
    observed: diagnostic.mismatchCount,
    passed: diagnostic.mismatchCount === safeCase.expectedMismatchCount,
  }));
  assertions.push(assertionRow({
    assertionId: "expected_unknown_subject_count",
    expected: safeCase.expectedUnknownSubjectCount,
    observed: diagnostic.unknownSubjectCount,
    passed: diagnostic.unknownSubjectCount === safeCase.expectedUnknownSubjectCount,
  }));
  const status = assertions.some((entry) => entry.passed === false)
    ? "fail"
    : (safeCase.expectedStatus === "degraded" ? "degraded" : "pass");
  return {
    schema: HEADLESS_RESIDENT_SMOKE_CASE_REPORT_SCHEMA,
    caseId: safeCase.caseId,
    caseClass: safeCase.caseClass,
    status,
    expectedStatus: safeCase.expectedStatus,
    promptDigest: submit?.promptDigest || "",
    promptChars: submit?.promptChars || 0,
    submitStatus: submit?.result?.status || "not_submitted",
    providerTransportStarted: submit?.terminalPacket?.providerStarted === true || submit?.result?.providerRequestStarted === true,
    diagnostic,
    assertions,
    evidenceRefs: safeCase.evidenceRefs,
    rawPromptIncluded: false,
    rawPayloadIncluded: false,
    workspaceMutationStarted: false,
    grantsAuthority: false,
  };
}

function suiteSummary(reports = []) {
  const byStatus = {};
  for (const report of reports) byStatus[report.status] = (byStatus[report.status] || 0) + 1;
  return {
    total: reports.length,
    pass: byStatus.pass || 0,
    fail: byStatus.fail || 0,
    skip: byStatus.skip || 0,
    degraded: byStatus.degraded || 0,
    byStatus,
    valid: (byStatus.fail || 0) === 0,
  };
}

async function runHeadlessResidentSmokeSuite({ daemon, suite, bundle, selfReportProvider, commandBase: baseOverrides = {} } = {}) {
  if (!daemon) throw new Error("headless_resident_smoke_missing_daemon");
  const safeSuite = isPlainObject(suite) ? suite : buildDefaultHeadlessResidentSmokeSuite();
  const safeBundle = bundle || buildDefaultResidentSmokeBundle();
  const bundleValidation = validateResidentEpistemicContextBundle(safeBundle);
  const commandBase = defaultCommandBase(baseOverrides);
  const commandRunId = shortDigest(`${safeSuite.suiteId}:${Date.now()}:${crypto.randomUUID()}`);
  const reports = [];
  for (const smokeCase of Array.isArray(safeSuite.cases) ? safeSuite.cases : []) {
    reports.push(await runHeadlessResidentSmokeCase({
      daemon,
      smokeCase,
      bundle: safeBundle,
      selfReportProvider,
      commandBase,
      commandRunId,
    }));
  }
  const summary = suiteSummary(reports);
  return {
    schema: HEADLESS_RESIDENT_SMOKE_SUITE_REPORT_SCHEMA,
    suiteId: normalizeString(safeSuite.suiteId, "headless_resident_smoke_suite_v1"),
    suiteDigest: sha256(stableStringify({
      suiteId: safeSuite.suiteId,
      caseIds: reports.map((report) => report.caseId),
      bundleDigest: safeBundle.bundleDigest,
    })),
    generatedAt: nowIso(),
    bundleDigest: safeBundle.bundleDigest,
    bundleValidation,
    summary: {
      ...summary,
      valid: summary.valid && bundleValidation.length === 0,
    },
    reports,
    rawPromptIncluded: reports.some((report) => report.rawPromptIncluded === true),
    rawPayloadIncluded: reports.some((report) => report.rawPayloadIncluded === true),
    workspaceMutationStarted: reports.some((report) => report.workspaceMutationStarted === true),
    grantsAuthority: reports.some((report) => report.grantsAuthority === true),
  };
}

function validateHeadlessResidentSmokeCaseReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report)) return ["case_report_not_object"];
  if (report.schema !== HEADLESS_RESIDENT_SMOKE_CASE_REPORT_SCHEMA) errors.push("invalid_case_report_schema");
  if (!CASE_STATUSES.has(normalizeString(report.status, ""))) errors.push("invalid_case_status");
  if (!isPlainObject(report.diagnostic)) errors.push("missing_self_report_diagnostic");
  if (!Array.isArray(report.assertions)) errors.push("missing_assertions");
  for (const flag of ["rawPromptIncluded", "rawPayloadIncluded", "workspaceMutationStarted", "grantsAuthority"]) {
    if (report[flag] !== false) errors.push(`resident_smoke_authority_or_raw_leak:${flag}`);
  }
  return errors;
}

function validateHeadlessResidentSmokeSuiteReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report)) return ["suite_report_not_object"];
  if (report.schema !== HEADLESS_RESIDENT_SMOKE_SUITE_REPORT_SCHEMA) errors.push("invalid_suite_report_schema");
  if (!isPlainObject(report.summary)) errors.push("missing_summary");
  if (!Array.isArray(report.reports)) errors.push("missing_reports");
  for (const caseReport of Array.isArray(report.reports) ? report.reports : []) {
    for (const error of validateHeadlessResidentSmokeCaseReport(caseReport)) {
      errors.push(`${caseReport?.caseId || "unknown"}:${error}`);
    }
  }
  for (const error of Array.isArray(report.bundleValidation) ? report.bundleValidation : ["bundle_validation_missing"]) {
    errors.push(`bundle:${error}`);
  }
  for (const flag of ["rawPromptIncluded", "rawPayloadIncluded", "workspaceMutationStarted", "grantsAuthority"]) {
    if (report[flag] !== false) errors.push(`resident_smoke_suite_authority_or_raw_leak:${flag}`);
  }
  return errors;
}

module.exports = {
  HEADLESS_RESIDENT_SMOKE_CASE_REPORT_SCHEMA,
  HEADLESS_RESIDENT_SMOKE_CASE_SCHEMA,
  HEADLESS_RESIDENT_SMOKE_SUITE_REPORT_SCHEMA,
  HEADLESS_RESIDENT_SMOKE_SUITE_SCHEMA,
  buildDefaultHeadlessResidentSmokeSuite,
  buildDefaultResidentSmokeBundle,
  buildDefaultResidentSmokeSnapshot,
  buildResidentSmokeCase,
  buildResidentSmokePrompt,
  runHeadlessResidentSmokeCase,
  runHeadlessResidentSmokeSuite,
  validateHeadlessResidentSmokeCaseReport,
  validateHeadlessResidentSmokeSuiteReport,
};
