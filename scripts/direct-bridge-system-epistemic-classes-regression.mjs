import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildBridgeSystemEpistemicRows,
  buildBridgeSystemEpistemicSnapshot,
  validateBridgeSystemEpistemicSnapshot,
} = require("../src/main/direct/bridge/bridge-system-epistemic-classes.js");

const generatedAt = "2026-06-18T13:00:00.000Z";
const fixtureFacts = [
  {
    subjectKind: "runtime",
    subjectId: "runtime-route",
    displayLabel: "Direct runtime route",
    family: "runtime/provider/model",
    status: "known_available",
    knowledgeClass: "exact_runtime",
    evidenceSource: "runtime_status",
    evidenceRefs: [{ refId: "runtime_status_current", source: "runtime_status", digest: "sha256:runtime" }],
    compactText: "Direct runtime route is active.",
  },
  {
    subjectKind: "provider",
    subjectId: "provider-profile",
    displayLabel: "OpenAI subscription profile",
    family: "runtime/provider/model",
    status: "known_available",
    knowledgeClass: "exact_runtime",
    evidenceSource: "provider_metadata",
    compactText: "Provider profile is available without exposing account identifiers.",
  },
  {
    subjectKind: "model",
    subjectId: "active-model",
    displayLabel: "GPT-5.5 medium",
    family: "runtime/provider/model",
    status: "known_available",
    knowledgeClass: "exact_runtime",
    evidenceSource: "provider_metadata",
    compactText: "Current model is GPT-5.5 with medium effort.",
  },
  {
    subjectKind: "quota",
    subjectId: "quota-windows",
    displayLabel: "Quota windows",
    family: "quota/account",
    status: "stale",
    knowledgeClass: "harness_observed",
    evidenceSource: "quota_snapshot",
    compactText: "Quota snapshot is stale.",
  },
  {
    subjectKind: "account_action",
    subjectId: "reset-credit",
    displayLabel: "Reset credit",
    family: "quota/account",
    status: "blocked_by_policy",
    blockerCodes: ["operator_confirmation_required"],
    evidenceSource: "quota_snapshot",
    compactText: "Reset credit consumption requires explicit operator confirmation.",
  },
  {
    subjectKind: "context",
    subjectId: "context-pack",
    displayLabel: "Context pack",
    family: "context/memory",
    status: "known_available",
    evidenceSource: "context_pack",
    compactText: "Context pack digest is available.",
  },
  {
    subjectKind: "memory",
    subjectId: "durable-memory",
    displayLabel: "Durable memory",
    family: "context/memory",
    status: "known_disabled",
    evidenceSource: "memory_frontier",
    compactText: "Durable memory mutation is disabled.",
  },
  {
    subjectKind: "baton",
    subjectId: "frontier-baton",
    displayLabel: "Frontier baton",
    family: "context/memory",
    status: "known_available",
    evidenceSource: "memory_frontier",
    compactText: "Frontier baton is fresh.",
  },
  {
    subjectKind: "context",
    subjectId: "compaction",
    displayLabel: "Compaction gate",
    family: "context/memory",
    status: "blocked_by_missing_evidence",
    evidenceSource: "context_pack",
    compactText: "Compaction is blocked until a gate witness exists.",
  },
  {
    subjectKind: "workspace",
    subjectId: "workspace-policy",
    displayLabel: "Workspace policy",
    family: "workspace/artifact",
    status: "known_available",
    evidenceSource: "workspace_policy",
    compactText: "Workspace policy is visible; mutation still requires authority.",
  },
  {
    subjectKind: "artifact",
    subjectId: "file-viewer",
    displayLabel: "File viewer",
    family: "workspace/artifact",
    status: "known_available",
    evidenceSource: "workspace_artifact",
    compactText: "File viewer route is available.",
  },
  {
    subjectKind: "stash",
    subjectId: "project-stash",
    displayLabel: "Project stash",
    family: "workspace/artifact",
    status: "unknown",
    evidenceSource: "workspace_artifact",
    compactText: "Project stash has no current count witness.",
  },
  {
    subjectKind: "skill",
    subjectId: "skills",
    displayLabel: "Skills",
    family: "modules/external",
    status: "known_available",
    evidenceSource: "module_capability",
    compactText: "Skills are classified but not executed by this witness.",
  },
  {
    subjectKind: "hook",
    subjectId: "hooks",
    displayLabel: "Hooks",
    family: "modules/external",
    status: "known_disabled",
    evidenceSource: "module_capability",
    compactText: "Hooks are disabled.",
  },
  {
    subjectKind: "app",
    subjectId: "apps",
    displayLabel: "Apps",
    family: "modules/external",
    status: "blocked_by_auth",
    evidenceSource: "module_capability",
    compactText: "Some apps are blocked by auth.",
  },
  {
    subjectKind: "mcp",
    subjectId: "mcp-resources",
    displayLabel: "MCP resources",
    family: "modules/external",
    status: "blocked_by_runtime",
    evidenceSource: "module_capability",
    compactText: "MCP resources require runtime support.",
  },
  {
    subjectKind: "external_capability",
    subjectId: "external-capabilities",
    displayLabel: "External capabilities",
    family: "modules/external",
    status: "blocked_by_missing_evidence",
    evidenceSource: "module_capability",
    compactText: "External capabilities need promotion evidence.",
  },
  {
    subjectKind: "browser",
    subjectId: "middle-web",
    displayLabel: "Middle web route",
    family: "routes",
    status: "known_available",
    evidenceSource: "route_status",
    compactText: "Middle web route exists; navigation requires route policy.",
  },
  {
    subjectKind: "headless_route",
    subjectId: "headless-daemon",
    displayLabel: "Headless daemon",
    family: "routes",
    status: "temporarily_unavailable",
    evidenceSource: "headless_daemon",
    compactText: "Headless daemon route is temporarily unavailable.",
  },
  {
    subjectKind: "thread",
    subjectId: "active-thread",
    displayLabel: "Active thread",
    family: "thread/workthread/orchestration",
    status: "known_available",
    evidenceSource: "orchestration_state",
    compactText: "Active direct thread is known.",
  },
  {
    subjectKind: "work_thread",
    subjectId: "active-work-thread",
    displayLabel: "Active WorkThread",
    family: "thread/workthread/orchestration",
    status: "known_available",
    evidenceSource: "orchestration_state",
    compactText: "Active WorkThread binding is known.",
  },
  {
    subjectKind: "goal",
    subjectId: "goal-state",
    displayLabel: "Goal state",
    family: "thread/workthread/orchestration",
    status: "unknown",
    evidenceSource: "orchestration_state",
    compactText: "Goal state is not available.",
  },
  {
    subjectKind: "orchestration",
    subjectId: "orchestration-state",
    displayLabel: "Orchestration state",
    family: "thread/workthread/orchestration",
    status: "blocked_by_workthread",
    evidenceSource: "orchestration_state",
    compactText: "Orchestration transition is blocked by unresolved WorkThread routing.",
  },
];

const rowInputs = buildBridgeSystemEpistemicRows({
  generatedAt,
  includeDefaultRows: false,
  facts: fixtureFacts,
});

assert.equal(rowInputs.length, fixtureFacts.length);
for (const row of rowInputs) {
  assert.equal(row.callableInCurrentRequest, false);
  assert.equal(row.declaredAsProviderTool, false);
  assert.equal(row.controlAvailable, false);
  assert.equal(row.controlAuthorityRequired, false);
  assert.equal(row.authorityUse, "may_not_act");
  assert.equal(row.extensions.readOnlyWitness, true);
  assert.equal(row.extensions.rawSecretsExposed, false);
  assert.equal(row.extensions.rawPathsExposed, false);
  assert.equal(row.extensions.rawPayloadExposed, false);
  assert.equal(row.extensions.accountMutationAllowed, false);
  assert.equal(row.extensions.memoryMutationAllowed, false);
  assert.equal(row.extensions.browserAutomationAllowed, false);
  assert.equal(row.extensions.mcpExecutionAllowed, false);
  assert.equal(row.extensions.routeExecutionAllowed, false);
}

const snapshot = buildBridgeSystemEpistemicSnapshot({
  generatedAt,
  workThreadId: "work_thread_pr76",
  codexThreadId: "direct_session_pr76",
  includeDefaultRows: false,
  facts: fixtureFacts,
});

assert.deepEqual(validateBridgeSystemEpistemicSnapshot(snapshot), []);
assert.equal(snapshot.schema, "bridge_system_epistemic_snapshot@1");
assert.equal(snapshot.readOnlyWitness, true);
assert.equal(snapshot.contextInjectionEnabled, false);
assert.equal(snapshot.accountMutationAllowed, false);
assert.equal(snapshot.memoryMutationAllowed, false);
assert.equal(snapshot.browserAutomationAllowed, false);
assert.equal(snapshot.mcpExecutionAllowed, false);
assert.equal(snapshot.routeExecutionAllowed, false);
assert.equal(snapshot.rawSecretsExposed, false);
assert.equal(snapshot.rawPathsExposed, false);
assert.equal(snapshot.rawPayloadExposed, false);
assert.equal(snapshot.residentSnapshot.rows.length, fixtureFacts.length);
assert.equal(snapshot.bySubjectKind.runtime, 1);
assert.equal(snapshot.bySubjectKind.model, 1);
assert.equal(snapshot.bySubjectKind.quota, 1);
assert.equal(snapshot.bySubjectKind.account_action, 1);
assert.equal(snapshot.bySubjectKind.context, 2);
assert.equal(snapshot.bySubjectKind.memory, 1);
assert.equal(snapshot.bySubjectKind.baton, 1);
assert.equal(snapshot.bySubjectKind.workspace, 1);
assert.equal(snapshot.bySubjectKind.artifact, 1);
assert.equal(snapshot.bySubjectKind.stash, 1);
assert.equal(snapshot.bySubjectKind.skill, 1);
assert.equal(snapshot.bySubjectKind.hook, 1);
assert.equal(snapshot.bySubjectKind.app, 1);
assert.equal(snapshot.bySubjectKind.mcp, 1);
assert.equal(snapshot.bySubjectKind.external_capability, 1);
assert.equal(snapshot.bySubjectKind.browser, 1);
assert.equal(snapshot.bySubjectKind.headless_route, 1);
assert.equal(snapshot.bySubjectKind.thread, 1);
assert.equal(snapshot.bySubjectKind.work_thread, 1);
assert.equal(snapshot.bySubjectKind.goal, 1);
assert.equal(snapshot.bySubjectKind.orchestration, 1);
assert.equal(snapshot.byStatus.unknown, 2);
assert.equal(snapshot.byStatus.stale, 1);
assert.equal(snapshot.preview.schema, "bridge_system_epistemic_preview@1");
assert.equal(snapshot.preview.readOnlyWitness, true);
assert.ok(snapshot.preview.compactLines.length > 0);

const bySubject = new Map(snapshot.residentSnapshot.rows.map((row) => [`${row.subjectKind}:${row.subjectId}`, row]));
assert.equal(bySubject.get("runtime:runtime-route").knowledgeClass, "exact_runtime");
assert.equal(bySubject.get("runtime:runtime-route").channels.epistemic.visibility, "summary_only");
assert.ok(bySubject.get("quota:quota-windows").blockerCodes.includes("stale_epistemic_row"));
assert.ok(bySubject.get("account_action:reset-credit").blockerCodes.includes("account_mutation_requires_operator"));
assert.ok(bySubject.get("memory:durable-memory").blockerCodes.includes("memory_mutation_blocked"));
assert.ok(bySubject.get("context:compaction").blockerCodes.includes("context_mutation_or_compaction_requires_gate"));
assert.ok(bySubject.get("workspace:workspace-policy").blockerCodes.includes("workspace_mutation_requires_authority"));
assert.ok(bySubject.get("skill:skills").blockerCodes.includes("execution_requires_promotion"));
assert.ok(bySubject.get("browser:middle-web").blockerCodes.includes("route_execution_requires_authority"));
assert.ok(bySubject.get("orchestration:orchestration-state").blockerCodes.includes("orchestration_transition_requires_authority"));

const defaultSnapshot = buildBridgeSystemEpistemicSnapshot({
  generatedAt,
  workThreadId: "work_thread_default_pr76",
});
assert.deepEqual(validateBridgeSystemEpistemicSnapshot(defaultSnapshot), []);
assert.ok(defaultSnapshot.rowCount >= 20);
assert.ok(defaultSnapshot.byStatus.unknown >= 1);

const authorityLeak = structuredClone(snapshot);
authorityLeak.accountMutationAllowed = true;
assert.ok(validateBridgeSystemEpistemicSnapshot(authorityLeak).includes("bridge_system_epistemic_authority_or_raw_leak:accountMutationAllowed"));

const callableLeak = structuredClone(snapshot);
callableLeak.residentSnapshot.rows.find((row) => row.subjectKind === "runtime" && row.subjectId === "runtime-route").callableInCurrentRequest = true;
assert.ok(validateBridgeSystemEpistemicSnapshot(callableLeak).includes("bridge_system_epistemic_callable_row:runtime:runtime-route"));

const routeLeak = structuredClone(snapshot);
routeLeak.residentSnapshot.rows.find((row) => row.subjectKind === "runtime" && row.subjectId === "runtime-route").extensions.routeExecutionAllowed = true;
assert.ok(validateBridgeSystemEpistemicSnapshot(routeLeak).includes("bridge_system_epistemic_row_leak_or_authority:runtime:runtime-route:routeExecutionAllowed"));

console.log("direct-bridge-system-epistemic-classes regression passed");
