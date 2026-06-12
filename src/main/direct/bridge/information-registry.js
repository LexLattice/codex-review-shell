"use strict";

const DIRECT_INFORMATION_BRIDGE_REGISTRY_SCHEMA = "direct_information_bridge_registry@1";
const DIRECT_INFORMATION_BRIDGE_AUDIT_SCHEMA = "direct_information_bridge_implementation_audit@1";

const BRIDGE_ROLES = new Set([
  "canonical_evidence",
  "derived_projection",
  "context_construction",
  "authority_gate",
  "action_executor",
  "memory_continuity",
  "observability_surface",
  "governance_routing",
]);

const IMPLEMENTATION_STATES = new Set(["implemented", "partial", "inherited", "missing"]);

const DIRECT_INFORMATION_BRIDGE_ROWS = Object.freeze([
  {
    id: "ic1.direct-session-rollout",
    name: "Direct session and turn evidence",
    role: "canonical_evidence",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/session/session-store.js", "src/main/direct/controller/live-text-controller.js"],
    ontology: { objectKinds: ["direct_codex_session", "direct_codex_turn", "direct_codex_tool_obligation"], sourceWorld: "harness" },
    bridgeFit: "Preserves direct turn, event, tool-obligation, and import evidence without treating provider output as local authority.",
    realignment: "Add explicit BridgeInformationClass ids to emitted artifacts so downstream context and recovery code can cite the registry row directly.",
  },
  {
    id: "ic1.direct-thread-operation-ledger",
    name: "Direct thread operation ledger",
    role: "canonical_evidence",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/thread/thread-store.js", "src/main/direct/thread/thread-workbench-controller.js"],
    ontology: { objectKinds: ["direct_thread_operation_event", "direct_rollout_manifest"], sourceWorld: "harness" },
    bridgeFit: "Records thread lifecycle, graph, bridge, projection, context, and tool-result operations as replay-safe evidence.",
    realignment: "Separate low-level Codex thread ids from future work-thread ids in operation scopes.",
  },
  {
    id: "ic1.direct-meta-session-ledger",
    name: "Direct meta-session ledger",
    role: "canonical_evidence",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/meta-session/store.js", "src/main/direct/meta-session/ledger.js", "src/main/direct/meta-session/projection.js"],
    ontology: { objectKinds: ["meta_session", "run_contract", "cross_context_route", "transition_guard_decision"], sourceWorld: "harness" },
    bridgeFit: "Already models higher-plane context registry, contracts, route artifacts, guard decisions, and current pointers.",
    realignment: "Use this as a substrate for work-thread orchestration, not as a replacement for object-level worker/auditor evidence.",
  },
  {
    id: "ic2.renderer-transcript-projection",
    name: "Renderer transcript projections",
    role: "derived_projection",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/thread/renderer-transcript-projection.js", "src/main/direct/thread/thread-store.js"],
    ontology: { objectKinds: ["renderer_transcript_projection", "compact_transcript_projection"], sourceWorld: "derived" },
    bridgeFit: "Provides rebuildable UI and compact transcript views over canonical evidence without becoming source truth.",
    realignment: "Add explicit raw-exposure and context-eligibility tags per projection item.",
  },
  {
    id: "ic2.thread-workbench-projections",
    name: "Thread workbench projections",
    role: "derived_projection",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/thread/thread-evidence-workbench.js", "src/main/direct/thread/thread-workbench-controller.js"],
    ontology: { objectKinds: ["thread_lifecycle", "thread_graph", "merge_preview", "prune_preview", "fork_preview"], sourceWorld: "derived" },
    bridgeFit: "Materializes lifecycle, graph, evidence, merge, prune, and fork views for inspection and controlled fresh starts.",
    realignment: "Make all previews cite whether they are context-eligible, runnable, or display-only under the registry law.",
  },
  {
    id: "ic3.context-pack-and-request-manifest",
    name: "Context pack and request manifest",
    role: "context_construction",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/thread/context-pack.js", "src/main/direct/thread/obligation-projection.js"],
    ontology: { objectKinds: ["direct_context_pack", "direct_request_manifest", "direct_provider_input_projection"], sourceWorld: "harness" },
    bridgeFit: "Compiles selected evidence into provider input while denying hidden provider continuity and imported action authority.",
    realignment: "Represent selected inputs as registry-classed context items instead of only policy-specific records.",
  },
  {
    id: "ic3.context-maintenance-memory-baton",
    name: "Context maintenance, durable memory, and frontier baton",
    role: "memory_continuity",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/context/maintenance.js", "src/main.js"],
    ontology: { objectKinds: ["context_pressure_estimate", "context_omission_ledger", "durable_thread_memory", "frontier_baton"], sourceWorld: "harness" },
    bridgeFit: "Defines pressure, omission, memory, and baton artifacts with display-only app-server sibling evidence.",
    realignment: "Promote memory/compaction/baton from diagnostics into explicit user-visible information-governance transitions when ready.",
  },
  {
    id: "ic4.read-file-authority",
    name: "Read-file authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/read-only-authority.js", "src/main/direct/controller/live-text-controller.js"],
    ontology: { objectKinds: ["readonly_tool_authority_decision", "readonly_tool_result", "readonly_tool_continuation_request"], sourceWorld: "workspace" },
    bridgeFit: "Separates provider read intent from local path validation, result evidence, redaction, and continuation construction.",
    realignment: "Normalize read approval/result/continuation rows under a shared AuthorityBearingTransition envelope.",
  },
  {
    id: "ic4.patch-authority",
    name: "Patch authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/patch-apply-authority.js", "src/main/direct/workspace/mutation-truth.js"],
    ontology: { objectKinds: ["patch_apply_plan", "patch_apply_result", "workspace_effect_summary"], sourceWorld: "workspace" },
    bridgeFit: "Treats apply_patch as model proposal plus local plan, approval, mutation evidence, provider visibility, and recovery posture.",
    realignment: "Unify patch plans with command/read transitions in the bridge transition registry.",
  },
  {
    id: "ic4.command-authority",
    name: "Command execution authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/command-execution-authority.js", "src/main/direct/workspace/mutation-truth.js"],
    ontology: { objectKinds: ["command_execution_plan", "command_execution_result", "workspace_effect_summary"], sourceWorld: "workspace" },
    bridgeFit: "Models shell execution as an authority-bearing action with command policy, result evidence, and workspace-effect accounting.",
    realignment: "Add registry-level risk classes for network/process/workspace/environment authority before expanding command scope.",
  },
  {
    id: "ic5.recovery-and-replay-safety",
    name: "Recovery and replay safety",
    role: "governance_routing",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/recovery/recovery-scanner.js", "src/main/direct/repair/repair-loop.js"],
    ontology: { objectKinds: ["direct_recovery_report", "repair_loop"], sourceWorld: "harness" },
    bridgeFit: "Audits active obligations and ledgers without replaying provider calls, file reads, patches, commands, or continuations.",
    realignment: "Use registry rows to classify which missing evidence blocks recovery versus degrades UI only.",
  },
  {
    id: "ic6.semantic-governance-broker",
    name: "Governance and semantic broker diagnostics",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/governance/broker.js", "src/main/direct/thread/thread-store.js"],
    ontology: { objectKinds: ["governance_packet", "semantic_broker_packet", "workflow_transition_graph"], sourceWorld: "harness" },
    bridgeFit: "Builds shadow governance packets and semantic broker diagnostics with source refs and non-enforced routing claims.",
    realignment: "Introduce first-class work-thread routing before any enforce-mode broker mutation is allowed.",
  },
  {
    id: "ic7.sub-agent-observability",
    name: "Sub-agent observability and containment",
    role: "observability_surface",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/agents/observability.js", "src/renderer/codex-surface.js"],
    ontology: { objectKinds: ["direct_agent_graph", "agent_progress_witness", "sub_agent_transcript_projection"], sourceWorld: "sub_agent" },
    bridgeFit: "Provides agent identity, progress, containment, transcript, and attention projections without collapsing child agents into operator/Codex roles.",
    realignment: "Tie agent nodes to AgentClassSpec and WorkThread scope so direct-native multi-agent runs are not merely UI projections.",
  },
  {
    id: "ic8.usage-quota-readiness",
    name: "Usage, quota, model, and readiness evidence",
    role: "observability_surface",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/readiness/usage-readiness.js", "src/main/direct/usage/turn-attribution.js"],
    ontology: { objectKinds: ["usage_readiness", "turn_usage_attribution", "model_evidence", "quota_evidence"], sourceWorld: "model_provider" },
    bridgeFit: "Tracks model/quota/usage evidence and main/sub-agent attribution postures without claiming exactness where evidence is missing.",
    realignment: "Do not derive per-agent token truth without direct provider/harness event evidence; keep vanilla app-server totals as inherited evidence only.",
  },
  {
    id: "ic9.direct-runtime-selection",
    name: "Direct runtime selection and activation",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_and_simplify_ui",
    sourceFiles: ["src/main/direct/runtime/project-activation.js", "src/main/direct/runtime/runtime-path-selection.js", "src/main/direct/runtime/runtime-status.js", "src/main.js", "src/renderer/app.js"],
    ontology: { objectKinds: ["runtime_selection", "activation_gate", "runtime_status"], sourceWorld: "harness" },
    bridgeFit: "Can persist app-server/direct-text/direct-implementation runtime path with activation gates and stale-digest checks.",
    realignment: "Move noisy diagnostics into settings and expose a small provider-path switch as a project/work-thread decision.",
  },
  {
    id: "ic10.retained-appserver-path",
    name: "Retained vanilla app-server path",
    role: "observability_surface",
    implementationState: "inherited",
    directPathPosture: "retain_when_aligned",
    sourceFiles: ["src/main/codex-app-server.js", "src/main/codex-surface-session.js", "src/renderer/codex-surface.js"],
    ontology: { objectKinds: ["vanilla_app_server_surface", "vanilla_runtime_profile", "app_server_thread"], sourceWorld: "model_provider" },
    bridgeFit: "Remains the stable vanilla lane for behavior that already fits the higher-level bridge without direct-native replacement.",
    realignment: "When vanilla behavior conflicts with work-thread/context/authority laws, leave it in app-server mode and build a direct-native alternative.",
  },
  {
    id: "ic11.inherited-shell-ux",
    name: "Inherited shell UX surfaces",
    role: "observability_surface",
    implementationState: "inherited",
    directPathPosture: "retain_when_aligned",
    sourceFiles: ["src/renderer/app.js", "src/renderer/codex-surface.js", "src/main.js"],
    ontology: { objectKinds: ["composer", "bottom_band", "middle_plane", "right_plane", "file_stash", "web_view"], sourceWorld: "human_interface" },
    bridgeFit: "Provides useful daily UX inherited from main: composer, transcript, ChatGPT linkage, middle-plane files/web/project stash, and runtime status.",
    realignment: "Direct-native UX should keep surfaces that preserve bridge law and replace surfaces that encode repo/chat/session as the work unit.",
  },
  {
    id: "ic12.work-thread-registry",
    name: "Work-thread registry and broker",
    role: "governance_routing",
    implementationState: "missing",
    directPathPosture: "build_next",
    sourceFiles: [],
    ontology: { objectKinds: ["work_thread", "work_target_resolution", "context_packet_ref", "authority_boundary"], sourceWorld: "harness" },
    bridgeFit: "This is the key missing abstraction: current repo/chat/folder are projections, not the active work unit.",
    realignment: "Build a canonical WorkThread object and broker that routes utterances by ontology, branch/workspace, objective, constraints, artifacts, and open obligations.",
  },
  {
    id: "ic13.bridge-information-registry",
    name: "Bridge information class registry",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "bootstrap_now",
    sourceFiles: ["src/main/direct/bridge/information-registry.js", "docs/DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md", "docs/DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md"],
    ontology: { objectKinds: ["bridge_information_class", "implementation_audit"], sourceWorld: "harness" },
    bridgeFit: "Maps current direct-path components to information roles before adding more storage, context, authority, or UI features.",
    realignment: "Promote this static audit into a stricter preflight gate for future direct feature specs and tests.",
  },
  {
    id: "ic14.skills-hooks-apps",
    name: "Skills, hooks, and app connectors as bridge modules",
    role: "governance_routing",
    implementationState: "missing",
    directPathPosture: "design_before_build",
    sourceFiles: [],
    ontology: { objectKinds: ["skill_module", "hook_contract", "connector_capability", "capability_context_law"], sourceWorld: "connector" },
    bridgeFit: "Not yet direct-native. Existing plugin/skill behavior is inherited from Codex/Desktop, not governed by direct bridge rows.",
    realignment: "Define which skills/hooks can contribute context, request tools, mutate workspace, or route work-thread transitions before implementation.",
  },
  {
    id: "ic15.direct-settings-surface",
    name: "Direct settings and bridge status surface",
    role: "observability_surface",
    implementationState: "missing",
    directPathPosture: "build_after_registry",
    sourceFiles: [],
    ontology: { objectKinds: ["settings_surface", "runtime_profile_view", "bridge_registry_view"], sourceWorld: "human_interface" },
    bridgeFit: "Current diagnostics occupy too much runtime space; direct settings should expose profile, registry, context, memory, skills, and runtime choices lawfully.",
    realignment: "Move detailed diagnostics out of the Codex transcript lane and into a settings/control surface.",
  },
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function validateBridgeInformationRow(row = {}) {
  const errors = [];
  if (!normalizeString(row.id, "")) errors.push("missing_id");
  if (!normalizeString(row.name, "")) errors.push("missing_name");
  if (!BRIDGE_ROLES.has(row.role)) errors.push(`invalid_role:${row.role || ""}`);
  if (!IMPLEMENTATION_STATES.has(row.implementationState)) errors.push(`invalid_implementation_state:${row.implementationState || ""}`);
  if (!normalizeString(row.directPathPosture, "")) errors.push("missing_direct_path_posture");
  if (!isPlainObject(row.ontology)) errors.push("missing_ontology");
  if (!normalizeString(row.bridgeFit, "")) errors.push("missing_bridge_fit");
  if (!normalizeString(row.realignment, "")) errors.push("missing_realignment");
  if (!Array.isArray(row.sourceFiles)) errors.push("source_files_not_array");
  return errors;
}

function buildDirectInformationBridgeAudit(options = {}) {
  const rows = DIRECT_INFORMATION_BRIDGE_ROWS.map((row) => ({
    ...row,
    sourceFiles: [...(row.sourceFiles || [])],
    ontology: { ...(row.ontology || {}) },
  }));
  const rowErrors = rows
    .map((row) => ({ id: row.id, errors: validateBridgeInformationRow(row) }))
    .filter((entry) => entry.errors.length);
  return {
    schema: DIRECT_INFORMATION_BRIDGE_AUDIT_SCHEMA,
    registrySchema: DIRECT_INFORMATION_BRIDGE_REGISTRY_SCHEMA,
    generatedAt: normalizeString(options.generatedAt, new Date().toISOString()),
    branch: normalizeString(options.branch, ""),
    baseBranch: normalizeString(options.baseBranch, "codex/direct-chatgpt-harness"),
    posture: "App-server remains retained when it aligns with the bridge law; direct-native replacements are built only where vanilla semantics conflict with work-thread, context, authority, or evidence laws.",
    summary: {
      totalRows: rows.length,
      byRole: countBy(rows, "role"),
      byImplementationState: countBy(rows, "implementationState"),
      byDirectPathPosture: countBy(rows, "directPathPosture"),
      valid: rowErrors.length === 0,
      rowErrorCount: rowErrors.length,
    },
    rows,
    rowErrors,
  };
}

module.exports = {
  DIRECT_INFORMATION_BRIDGE_AUDIT_SCHEMA,
  DIRECT_INFORMATION_BRIDGE_REGISTRY_SCHEMA,
  DIRECT_INFORMATION_BRIDGE_ROWS,
  buildDirectInformationBridgeAudit,
  validateBridgeInformationRow,
};
