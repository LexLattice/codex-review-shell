"use strict";

const crypto = require("node:crypto");
const {
  executeHeadlessAffordanceCommand,
} = require("./affordance-command-surface");
const {
  normalizeString,
  stableStringify,
} = require("./bridge-store");

const HEADLESS_AFFORDANCE_SCENARIO_SCHEMA = "headless_affordance_scenario@1";
const HEADLESS_AFFORDANCE_SCENARIO_REPORT_SCHEMA = "headless_affordance_scenario_report@1";
const HEADLESS_AFFORDANCE_SCENARIO_SUITE_SCHEMA = "headless_affordance_scenario_suite@1";
const HEADLESS_AFFORDANCE_SCENARIO_SUITE_REPORT_SCHEMA = "headless_affordance_scenario_suite_report@1";
const SCENARIO_STATUSES = new Set(["pass", "fail", "skip", "degraded"]);
const DEFAULT_CLIENT_ID = "affordance_scenario_client";
const DEFAULT_ROUTE_ID = "route_text";
const DEFAULT_ROUTE_VERSION = "v1";
const DEFAULT_WORK_THREAD_ID = "wt_affordance_scenario";
const DEFAULT_THREAD_ID = "direct_session_headless_affordance_scenario";

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
  const timestamp = nowMs !== undefined && nowMs !== null ? Number(nowMs) : Date.now();
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
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

function scenarioIdFor(name = "", index = 0) {
  return `headless_affordance_scenario_${shortDigest(`${index}:${name}`)}`;
}

function buildScenario(input = {}, index = 0) {
  const scenarioId = normalizeString(input.scenarioId, scenarioIdFor(input.name || input.scenarioClass || "scenario", index));
  return {
    schema: HEADLESS_AFFORDANCE_SCENARIO_SCHEMA,
    scenarioId,
    scenarioClass: normalizeString(input.scenarioClass, "unknown"),
    name: normalizeString(input.name, scenarioId),
    description: normalizeString(input.description, ""),
    requiredBackendCapabilities: Array.isArray(input.requiredBackendCapabilities)
      ? input.requiredBackendCapabilities.map((item) => normalizeString(item, "")).filter(Boolean)
      : [],
    fixtureSafe: input.fixtureSafe !== false,
    providerTransportExpected: input.providerTransportExpected === true,
    workspaceMutationExpected: input.workspaceMutationExpected === true,
    expectedStatus: normalizeString(input.expectedStatus, "pass"),
    expectedAssertions: Array.isArray(input.expectedAssertions) ? input.expectedAssertions : [],
    commands: Array.isArray(input.commands) ? input.commands : [],
    waits: Array.isArray(input.waits) ? input.waits : [],
    unsupportedReason: normalizeString(input.unsupportedReason, ""),
    evidenceRefs: [
      evidenceRef("headless_affordance_scenario", "Headless affordance scenario fixture", { artifactId: scenarioId }),
      ...(Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []),
    ],
  };
}

function buildDefaultHeadlessAffordanceScenarioSuite(options = {}) {
  const commandBase = defaultCommandBase(options);
  const scenarios = [
    {
      scenarioClass: "direct_session_creation_resume",
      name: "Submit text turn and read resulting turn packet",
      description: "Exercises direct session creation/resume through a fixture-safe text turn and packet read.",
      requiredBackendCapabilities: ["headless_affordance_command_surface", "headless_direct_text_runtime"],
      expectedStatus: "pass",
      expectedAssertions: [
        { assertionId: "submit_status", expected: "accepted" },
        { assertionId: "packet_read", expected: "completed" },
        { assertionId: "packet_terminal", expected: "provider_completed" },
        { assertionId: "raw_prompt_hidden", expected: true },
      ],
      commands: [
        {
          stepId: "submit",
          command: {
            ...commandBase,
            commandKind: "submit_text_turn",
            commandId: "scenario_direct_session_submit",
            idempotencyKey: "scenario-direct-session-submit",
            text: "Scenario: submit a direct text turn.",
            model: "gpt-5.5",
            reasoningEffort: "medium",
          },
          expectStatus: "accepted",
          captureTurnPacketAs: "primaryPacket",
        },
        {
          stepId: "read_packet",
          command: {
            ...commandBase,
            commandKind: "read_turn_packet",
            commandId: "scenario_direct_session_read_packet",
            targetFrom: {
              packetRef: "primaryPacket",
            },
          },
          expectStatus: "completed",
          expectRawPromptHidden: true,
        },
      ],
      waits: [
        {
          packetRef: "primaryPacket",
          expectedState: "provider_completed",
          timeoutMs: 5000,
        },
      ],
    },
    {
      scenarioClass: "active_turn_queue_steer_stop",
      name: "Queue behind active turn and expose unsupported controls truthfully",
      description: "Exercises queue semantics while proving steer/stop are blocked until runtime support exists.",
      requiredBackendCapabilities: ["headless_affordance_command_surface", "headless_direct_text_runtime"],
      expectedStatus: "degraded",
      expectedAssertions: [
        { assertionId: "first_submit", expected: "accepted" },
        { assertionId: "second_queue", expected: "accepted" },
        { assertionId: "second_initial_state", expected: "queued" },
        { assertionId: "steer_blocked", expected: "steer_not_supported_by_headless_runtime" },
        { assertionId: "stop_blocked", expected: "stop_not_supported_by_headless_runtime" },
      ],
      commands: [
        {
          stepId: "submit_first",
          command: {
            ...commandBase,
            commandKind: "submit_text_turn",
            commandId: "scenario_active_submit_first",
            idempotencyKey: "scenario-active-submit-first",
            text: "Scenario: first active turn.",
          },
          expectStatus: "accepted",
          captureTurnPacketAs: "activePacket",
        },
        {
          stepId: "queue_second",
          command: {
            ...commandBase,
            commandKind: "queue_text_turn",
            commandId: "scenario_active_queue_second",
            idempotencyKey: "scenario-active-queue-second",
            text: "Scenario: queued turn.",
          },
          expectStatus: "accepted",
          expectTurnPacketState: "queued",
          captureTurnPacketAs: "queuedPacket",
        },
        {
          stepId: "steer",
          command: {
            ...commandBase,
            commandKind: "steer_text_turn",
            commandId: "scenario_active_steer",
            text: "Scenario: steer current turn.",
            target: {
              threadId: normalizeString(options.threadId, DEFAULT_THREAD_ID),
            },
          },
          expectStatus: "blocked",
          expectBlockerCode: "steer_not_supported_by_headless_runtime",
        },
        {
          stepId: "stop",
          command: {
            ...commandBase,
            commandKind: "stop_active_turn",
            commandId: "scenario_active_stop",
            target: {
              threadId: normalizeString(options.threadId, DEFAULT_THREAD_ID),
            },
          },
          expectStatus: "blocked",
          expectBlockerCode: "stop_not_supported_by_headless_runtime",
        },
      ],
      waits: [
        { packetRef: "activePacket", expectedState: "provider_completed", timeoutMs: 5000 },
        { packetRef: "queuedPacket", expectedState: "provider_completed", timeoutMs: 5000 },
      ],
    },
    {
      scenarioClass: "runtime_metadata_context_projection",
      name: "Read bridge status projection",
      description: "Exercises runtime/status projection without provider payload reads.",
      requiredBackendCapabilities: ["headless_affordance_command_surface"],
      expectedStatus: "pass",
      expectedAssertions: [
        { assertionId: "status_schema", expected: "bridge_daemon_status_projection@1" },
        { assertionId: "raw_payloads_hidden", expected: false },
      ],
      commands: [
        {
          stepId: "read_status",
          command: {
            ...commandBase,
            commandKind: "read_bridge_status",
            commandId: "scenario_runtime_status",
          },
          expectStatus: "completed",
          expectResultSchema: "bridge_daemon_status_projection@1",
        },
      ],
    },
    {
      scenarioClass: "tool_availability_self_report_parity",
      name: "Tool availability self-report parity placeholder",
      description: "Records that live resident self-report comparison is reserved for PR80.",
      requiredBackendCapabilities: ["resident_epistemic_context_bundle", "live_resident_self_report"],
      expectedStatus: "skip",
      unsupportedReason: "live_resident_self_report_is_pr80_scope",
      expectedAssertions: [
        { assertionId: "skip_reason_recorded", expected: "live_resident_self_report_is_pr80_scope" },
      ],
    },
    {
      scenarioClass: "sub_agent_observable_state_governance",
      name: "Sub-agent E-channel governance placeholder",
      description: "Records that sub-agent observation scenarios require a fixture graph provider in a later slice.",
      requiredBackendCapabilities: ["sub_agent_e_channel_snapshot", "sub_agent_fixture_graph_provider"],
      expectedStatus: "skip",
      unsupportedReason: "sub_agent_fixture_graph_provider_not_wired",
      expectedAssertions: [
        { assertionId: "skip_reason_recorded", expected: "sub_agent_fixture_graph_provider_not_wired" },
      ],
    },
    {
      scenarioClass: "context_memory_baton_compaction_witness",
      name: "Context/memory/baton/compaction witness placeholder",
      description: "Records witness-class expectation while actual request-context inclusion is not yet injected by default.",
      requiredBackendCapabilities: ["resident_epistemic_context_policy", "context_pack_preview"],
      expectedStatus: "degraded",
      unsupportedReason: "context_bundle_live_request_injection_deferred",
      expectedAssertions: [
        { assertionId: "degraded_reason_recorded", expected: "context_bundle_live_request_injection_deferred" },
      ],
    },
    {
      scenarioClass: "analytics_fact_persistence_turn_attribution",
      name: "Analytics fact persistence placeholder",
      description: "Records that scenario-level analytics verification needs the next attribution fixture bridge.",
      requiredBackendCapabilities: ["runtime_analytics_facts", "headless_turn_attribution_probe"],
      expectedStatus: "skip",
      unsupportedReason: "headless_turn_attribution_probe_not_wired",
      expectedAssertions: [
        { assertionId: "skip_reason_recorded", expected: "headless_turn_attribution_probe_not_wired" },
      ],
    },
  ].map((scenario, index) => buildScenario(scenario, index));

  return {
    schema: HEADLESS_AFFORDANCE_SCENARIO_SUITE_SCHEMA,
    suiteId: normalizeString(options.suiteId, "headless_affordance_scenario_suite_v1"),
    scenarioCount: scenarios.length,
    scenarioClasses: scenarios.map((scenario) => scenario.scenarioClass),
    scenarios,
    fixtureSafe: true,
    providerTransportExpected: false,
    workspaceMutationExpected: false,
    evidenceRefs: [evidenceRef("headless_affordance_scenario_suite", "Default headless affordance scenario suite")],
  };
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

function statusFromAssertions(scenario = {}, assertions = []) {
  const expectedStatus = normalizeString(scenario.expectedStatus, "pass");
  if (expectedStatus === "skip") return "skip";
  if (assertions.some((assertion) => assertion.passed === false)) return "fail";
  return expectedStatus === "degraded" ? "degraded" : "pass";
}

function blockedScenarioReport(scenario = {}, reason = "") {
  const expectedStatus = normalizeString(scenario.expectedStatus, "skip");
  return {
    schema: HEADLESS_AFFORDANCE_SCENARIO_REPORT_SCHEMA,
    scenarioId: scenario.scenarioId,
    scenarioClass: scenario.scenarioClass,
    status: expectedStatus === "degraded" ? "degraded" : "skip",
    expectedStatus,
    reason: normalizeString(reason || scenario.unsupportedReason, "scenario_not_executable"),
    assertions: (Array.isArray(scenario.expectedAssertions) ? scenario.expectedAssertions : []).map((item) => assertionRow({
      assertionId: item.assertionId,
      expected: item.expected,
      observed: normalizeString(reason || scenario.unsupportedReason, ""),
      passed: true,
    })),
    commandResults: [],
    evidenceRefs: scenario.evidenceRefs,
    rawPayloadIncluded: false,
    providerTransportStarted: false,
    workspaceMutationStarted: false,
  };
}

async function runScenarioCommand({ daemon, scenario, step, captures }) {
  const command = { ...(isPlainObject(step.command) ? step.command : {}) };
  if (isPlainObject(command.targetFrom) && command.targetFrom.packetRef) {
    const packet = captures.get(command.targetFrom.packetRef);
    command.target = {
      ...(isPlainObject(command.target) ? command.target : {}),
      packetId: normalizeString(packet?.packetId, ""),
    };
    delete command.targetFrom;
  }
  const result = executeHeadlessAffordanceCommand({ daemon, command });
  const turnPacket = isPlainObject(result?.result?.turnPacket) ? result.result.turnPacket : null;
  if (step.captureTurnPacketAs && turnPacket) captures.set(step.captureTurnPacketAs, turnPacket);
  const assertions = [
    assertionRow({
      assertionId: `${step.stepId}_status`,
      expected: step.expectStatus,
      observed: result?.status,
      passed: !step.expectStatus || result?.status === step.expectStatus,
      blockerCode: result?.blockerCode,
    }),
  ];
  if (step.expectBlockerCode) {
    assertions.push(assertionRow({
      assertionId: `${step.stepId}_blocker`,
      expected: step.expectBlockerCode,
      observed: result?.blockerCode,
      passed: result?.blockerCode === step.expectBlockerCode,
      blockerCode: result?.blockerCode,
    }));
  }
  if (step.expectResultSchema) {
    assertions.push(assertionRow({
      assertionId: `${step.stepId}_result_schema`,
      expected: step.expectResultSchema,
      observed: result?.result?.schema,
      passed: result?.result?.schema === step.expectResultSchema,
    }));
  }
  if (step.expectTurnPacketState) {
    assertions.push(assertionRow({
      assertionId: `${step.stepId}_turn_packet_state`,
      expected: step.expectTurnPacketState,
      observed: turnPacket?.state,
      passed: turnPacket?.state === step.expectTurnPacketState,
    }));
  }
  if (step.expectRawPromptHidden) {
    const rawPromptHidden = result?.result?.promptText === undefined && result?.result?.rawPrompt === undefined;
    assertions.push(assertionRow({
      assertionId: `${step.stepId}_raw_prompt_hidden`,
      expected: true,
      observed: rawPromptHidden,
      passed: rawPromptHidden === true,
    }));
  }
  return { result, assertions };
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

async function runHeadlessAffordanceScenario({ daemon, scenario }) {
  const captures = new Map();
  const commandResults = [];
  const assertions = [];
  if (!Array.isArray(scenario.commands) || !scenario.commands.length) {
    return blockedScenarioReport(scenario, scenario.unsupportedReason);
  }
  for (const step of scenario.commands) {
    const commandReport = await runScenarioCommand({ daemon, scenario, step, captures });
    commandResults.push({
      stepId: normalizeString(step.stepId, "unknown_step"),
      commandKind: normalizeString(step.command?.commandKind, ""),
      status: normalizeString(commandReport.result?.status, ""),
      blockerCode: normalizeString(commandReport.result?.blockerCode, ""),
      providerRequestStarted: commandReport.result?.providerRequestStarted === true,
      rawPayloadIncluded: commandReport.result?.rawPayloadIncluded === true,
    });
    assertions.push(...commandReport.assertions);
  }
  for (const wait of Array.isArray(scenario.waits) ? scenario.waits : []) {
    const packet = captures.get(wait.packetRef);
    const observed = packet?.packetId
      ? await waitForPacketState({
        store: daemon.store,
        packetId: packet.packetId,
        expectedState: wait.expectedState,
        timeoutMs: wait.timeoutMs,
      })
      : null;
    assertions.push(assertionRow({
      assertionId: `wait_${wait.packetRef}_${wait.expectedState}`,
      expected: wait.expectedState,
      observed: observed?.state || "",
      passed: observed?.state === wait.expectedState,
      blockerCode: observed?.blockerCode || "",
    }));
  }
  const status = statusFromAssertions(scenario, assertions);
  return {
    schema: HEADLESS_AFFORDANCE_SCENARIO_REPORT_SCHEMA,
    scenarioId: scenario.scenarioId,
    scenarioClass: scenario.scenarioClass,
    status,
    expectedStatus: scenario.expectedStatus,
    reason: status === "degraded" ? normalizeString(scenario.unsupportedReason, "degraded_by_expected_capability_gap") : "",
    assertions,
    commandResults,
    evidenceRefs: scenario.evidenceRefs,
    rawPayloadIncluded: commandResults.some((row) => row.rawPayloadIncluded === true),
    providerTransportStarted: commandResults.some((row) => row.providerRequestStarted === true),
    workspaceMutationStarted: false,
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

async function runHeadlessAffordanceScenarioSuite({ daemon, suite }) {
  const safeSuite = isPlainObject(suite) ? suite : buildDefaultHeadlessAffordanceScenarioSuite();
  const reports = [];
  for (const scenario of Array.isArray(safeSuite.scenarios) ? safeSuite.scenarios : []) {
    reports.push(await runHeadlessAffordanceScenario({ daemon, scenario }));
  }
  const summary = suiteSummary(reports);
  return {
    schema: HEADLESS_AFFORDANCE_SCENARIO_SUITE_REPORT_SCHEMA,
    suiteId: normalizeString(safeSuite.suiteId, "headless_affordance_scenario_suite_v1"),
    suiteDigest: sha256(stableStringify({
      suiteId: safeSuite.suiteId,
      scenarioIds: reports.map((report) => report.scenarioId),
    })),
    generatedAt: nowIso(),
    summary,
    reports,
    rawPayloadIncluded: reports.some((report) => report.rawPayloadIncluded === true),
    providerTransportStarted: reports.some((report) => report.providerTransportStarted === true),
    workspaceMutationStarted: reports.some((report) => report.workspaceMutationStarted === true),
  };
}

function validateHeadlessAffordanceScenarioReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report)) return ["report_not_object"];
  if (report.schema !== HEADLESS_AFFORDANCE_SCENARIO_REPORT_SCHEMA) errors.push("invalid_report_schema");
  if (!normalizeString(report.scenarioId, "")) errors.push("missing_scenario_id");
  if (!SCENARIO_STATUSES.has(normalizeString(report.status, ""))) errors.push("invalid_status");
  if (!Array.isArray(report.assertions)) errors.push("missing_assertions");
  if (report.rawPayloadIncluded === true) errors.push("raw_payload_included");
  return errors;
}

function validateHeadlessAffordanceScenarioSuiteReport(report = {}) {
  const errors = [];
  if (!isPlainObject(report)) return ["suite_report_not_object"];
  if (report.schema !== HEADLESS_AFFORDANCE_SCENARIO_SUITE_REPORT_SCHEMA) errors.push("invalid_suite_report_schema");
  if (!isPlainObject(report.summary)) errors.push("missing_summary");
  if (!Array.isArray(report.reports)) errors.push("missing_reports");
  for (const scenarioReport of Array.isArray(report.reports) ? report.reports : []) {
    for (const error of validateHeadlessAffordanceScenarioReport(scenarioReport)) {
      errors.push(`${scenarioReport.scenarioId || "unknown"}:${error}`);
    }
  }
  if (report.rawPayloadIncluded === true) errors.push("suite_raw_payload_included");
  if (report.workspaceMutationStarted === true) errors.push("unexpected_workspace_mutation");
  return errors;
}

module.exports = {
  HEADLESS_AFFORDANCE_SCENARIO_REPORT_SCHEMA,
  HEADLESS_AFFORDANCE_SCENARIO_SCHEMA,
  HEADLESS_AFFORDANCE_SCENARIO_SUITE_REPORT_SCHEMA,
  HEADLESS_AFFORDANCE_SCENARIO_SUITE_SCHEMA,
  buildDefaultHeadlessAffordanceScenarioSuite,
  buildScenario,
  runHeadlessAffordanceScenario,
  runHeadlessAffordanceScenarioSuite,
  validateHeadlessAffordanceScenarioReport,
  validateHeadlessAffordanceScenarioSuiteReport,
};
