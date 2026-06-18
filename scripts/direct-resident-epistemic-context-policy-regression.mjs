import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildBridgeSystemEpistemicSnapshot,
} = require("../src/main/direct/bridge/bridge-system-epistemic-classes.js");
const {
  buildResidentEpistemicContextPolicy,
  applyResidentEpistemicContextPolicy,
  buildResidentEpistemicSettingsProjection,
  buildResidentSelfReportDiagnostics,
  validateResidentEpistemicContextBundle,
} = require("../src/main/direct/bridge/resident-epistemic-context-policy.js");

const generatedAt = "2026-06-18T14:00:00.000Z";
const baseSnapshot = buildBridgeSystemEpistemicSnapshot({
  generatedAt,
  workThreadId: "work_thread_pr77",
  codexThreadId: "direct_session_pr77",
  includeDefaultRows: false,
  facts: [
    {
      subjectKind: "runtime",
      subjectId: "runtime-route",
      displayLabel: "Direct runtime route",
      status: "known_available",
      knowledgeClass: "exact_runtime",
      compactText: "Direct runtime route is active.",
    },
    {
      subjectKind: "model",
      subjectId: "active-model",
      displayLabel: "GPT-5.5 medium",
      status: "known_available",
      knowledgeClass: "exact_runtime",
      compactText: "Actual model and effort are known.",
    },
    {
      subjectKind: "quota",
      subjectId: "quota-windows",
      displayLabel: "Quota windows",
      status: "stale",
      freshness: "stale",
      compactText: "Quota snapshot is stale.",
    },
    {
      subjectKind: "account_action",
      subjectId: "reset-credit",
      displayLabel: "Reset credit",
      status: "blocked_by_policy",
      compactText: "Reset credit requires operator confirmation.",
    },
    {
      subjectKind: "context",
      subjectId: "context-pack",
      displayLabel: "Context pack",
      status: "known_available",
      compactText: "Context pack is ready.",
    },
    {
      subjectKind: "memory",
      subjectId: "durable-memory",
      displayLabel: "Durable memory",
      status: "known_disabled",
      compactText: "Memory mutation is disabled.",
    },
    {
      subjectKind: "browser",
      subjectId: "middle-web",
      displayLabel: "Middle web route",
      status: "known_available",
      compactText: "Middle web route exists.",
    },
    {
      subjectKind: "mcp",
      subjectId: "mcp-resources",
      displayLabel: "MCP resources",
      status: "blocked_by_runtime",
      compactText: "MCP needs runtime support.",
    },
    {
      subjectKind: "goal",
      subjectId: "goal-state",
      displayLabel: "Goal state",
      status: "unknown",
      compactText: "Goal state is unknown.",
    },
  ],
});

const policy = buildResidentEpistemicContextPolicy({
  policyId: "policy_pr77",
  projectId: "project_pr77",
  workThreadId: "work_thread_pr77",
  includeSubjectKinds: ["runtime", "model", "quota", "context", "memory", "browser", "mcp", "goal"],
  defaultStaleBehavior: "summarize_as_stale",
  classPolicies: [
    { subjectKind: "memory", staleBehavior: "include_with_warning" },
    { subjectKind: "mcp", include: true },
  ],
  projectionBudget: { maxRows: 6, maxChars: 1200, truncationPolicy: "priority_then_summary" },
});

assert.equal(policy.schema, "resident_epistemic_context_policy@1");
assert.equal(policy.manualRawRowEditingAllowed, false);
assert.equal(policy.arbitraryPromptInjectionAllowed, false);
assert.equal(policy.disabledCapabilityPromotionAllowed, false);

const malformedBudgetPolicy = buildResidentEpistemicContextPolicy({
  classPolicies: [{ subjectKind: "runtime", maxRows: "abc" }],
  projectionBudget: { maxRows: "abc", maxChars: "not-a-number" },
});
assert.equal(malformedBudgetPolicy.classPolicies[0].maxRows, 0);
assert.equal(malformedBudgetPolicy.projectionBudget.maxRows, 12);
assert.equal(malformedBudgetPolicy.projectionBudget.maxChars, 2400);

const bundle = applyResidentEpistemicContextPolicy({
  snapshot: baseSnapshot.residentSnapshot,
  policy,
});

assert.deepEqual(validateResidentEpistemicContextBundle(bundle), []);
assert.equal(bundle.schema, "resident_epistemic_context_bundle@1");
assert.equal(bundle.contextInjectionBlocked, false);
assert.equal(bundle.grantsAuthority, false);
assert.equal(bundle.manualRawRowEditingAllowed, false);
assert.equal(bundle.arbitraryPromptInjectionAllowed, false);
assert.equal(bundle.disabledCapabilityPromotionAllowed, false);
assert.equal(bundle.contextItem.schema, "resident_epistemic_context_item@1");
assert.equal(bundle.contextItem.grantsAuthority, false);
assert.equal(bundle.contextItem.snapshotDigest, bundle.policySnapshot.snapshotDigest);
assert.equal(bundle.policySnapshot.projectionBudget.maxRows, 6);
assert.ok(bundle.policySnapshot.compactResidentText.includes("Harness epistemic witness:"));
assert.equal(bundle.staleWarnings.length, 1);
assert.equal(bundle.staleWarnings[0].subjectKind, "quota");
assert.ok(bundle.policySnapshot.rows.find((row) => row.subjectKind === "quota").blockerCodes.includes("stale_summarized_by_policy"));
assert.equal(bundle.omittedClassCounts.account_action, 1);
assert.equal(bundle.policySnapshot.rows.some((row) => row.subjectKind === "account_action"), false);
assert.equal(bundle.includedRowIds.length, bundle.contextItem.includedRowIds.length);

const settings = buildResidentEpistemicSettingsProjection(bundle);
assert.equal(settings.schema, "resident_epistemic_settings_projection@1");
assert.equal(settings.contextInjectionBlocked, false);
assert.equal(settings.rawSecretsExposed, false);
assert.equal(settings.rawPayloadExposed, false);
assert.ok(settings.rowCount >= 1);
assert.ok(settings.compactInjectedText.includes("Harness epistemic witness:"));
assert.equal(settings.omittedClassCounts.account_action, 1);

const pressurePolicy = buildResidentEpistemicContextPolicy({
  includeAccountActionsWhenQuotaPressure: true,
  quotaPressure: true,
  projectionBudget: { maxRows: 12, maxChars: 2000 },
});
const pressureBundle = applyResidentEpistemicContextPolicy({
  snapshot: baseSnapshot.residentSnapshot,
  policy: pressurePolicy,
});
assert.deepEqual(validateResidentEpistemicContextBundle(pressureBundle), []);
assert.equal(pressureBundle.policySnapshot.rows.some((row) => row.subjectKind === "account_action"), true);

const omitPolicy = buildResidentEpistemicContextPolicy({
  defaultStaleBehavior: "omit_row",
  includeSubjectKinds: ["runtime", "quota"],
});
const omitBundle = applyResidentEpistemicContextPolicy({
  snapshot: baseSnapshot.residentSnapshot,
  policy: omitPolicy,
});
assert.deepEqual(validateResidentEpistemicContextBundle(omitBundle), []);
assert.equal(omitBundle.policySnapshot.rows.some((row) => row.subjectKind === "quota"), false);
assert.equal(omitBundle.omittedClassCounts.quota, 1);

const blockPolicy = buildResidentEpistemicContextPolicy({
  includeSubjectKinds: ["runtime", "quota"],
  defaultStaleBehavior: "block_context_injection",
});
const blockedBundle = applyResidentEpistemicContextPolicy({
  snapshot: baseSnapshot.residentSnapshot,
  policy: blockPolicy,
});
assert.deepEqual(validateResidentEpistemicContextBundle(blockedBundle), []);
assert.equal(blockedBundle.contextInjectionBlocked, true);
assert.equal(blockedBundle.contextItem, null);
assert.equal(blockedBundle.staleWarnings.length, 1);

const budgetPolicy = buildResidentEpistemicContextPolicy({
  includeSubjectKinds: ["runtime", "model", "context", "memory", "browser", "mcp", "goal"],
  projectionBudget: { maxRows: 2, maxChars: 500 },
});
const budgetBundle = applyResidentEpistemicContextPolicy({
  snapshot: baseSnapshot.residentSnapshot,
  policy: budgetPolicy,
});
assert.deepEqual(validateResidentEpistemicContextBundle(budgetBundle), []);
assert.equal(budgetBundle.contextInjectionBlocked, false);
assert.ok(Object.values(budgetBundle.omittedClassCounts).reduce((total, count) => total + count, 0) > 0);
assert.equal(budgetBundle.policySnapshot.snapshotCompleteness, "budgeted_with_omissions");

const plainPolicyWithBadArrays = {
  includeSubjectKinds: "runtime",
  excludeSubjectKinds: 7,
  includeFamilies: null,
  excludeFamilies: false,
  projectionBudget: { maxRows: 4, maxChars: 900 },
};
const malformedRowsSnapshot = {
  ...baseSnapshot.residentSnapshot,
  rows: [null, ...baseSnapshot.residentSnapshot.rows, "bad-row"],
};
const malformedBundle = applyResidentEpistemicContextPolicy({
  snapshot: malformedRowsSnapshot,
  policy: plainPolicyWithBadArrays,
});
assert.deepEqual(validateResidentEpistemicContextBundle(malformedBundle), []);

const diagnostic = buildResidentSelfReportDiagnostics({
  snapshot: {
    ...bundle.policySnapshot,
    rows: [null, ...bundle.policySnapshot.rows],
  },
  selfReport: {
    claims: [
      { subjectKind: "runtime", subjectId: "runtime-route", field: "status", value: "known_available" },
      { subjectKind: "model", subjectId: "active-model", field: "status", value: "unknown" },
      { subjectKind: "browser", subjectId: "middle-web", field: "callableInCurrentRequest", value: true },
      { subjectKind: "tool", subjectId: "missing-tool", field: "status", value: "callable_now" },
    ],
  },
});
assert.equal(diagnostic.schema, "resident_epistemic_self_report_diagnostic@1");
assert.equal(diagnostic.findingCount, 4);
assert.equal(diagnostic.mismatchCount, 2);
assert.equal(diagnostic.unknownSubjectCount, 1);
assert.equal(diagnostic.grantsAuthority, false);

const authorityLeak = structuredClone(bundle);
authorityLeak.grantsAuthority = true;
assert.ok(validateResidentEpistemicContextBundle(authorityLeak).includes("resident_epistemic_context_authority_or_raw_leak:grantsAuthority"));

console.log("direct-resident-epistemic-context-policy regression passed");
