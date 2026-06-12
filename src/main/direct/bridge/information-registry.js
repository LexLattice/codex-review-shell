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
const SOURCE_WORLDS = new Set([
  "human_interface",
  "model_provider",
  "workspace",
  "harness",
  "connector",
  "sub_agent",
  "derived",
]);

function ontologyShape(objectKinds, sourceWorld, options = {}) {
  const kinds = Array.isArray(objectKinds) ? objectKinds.filter(Boolean) : [];
  const objectKind = options.objectKind || kinds[0] || "";
  return {
    objectKind,
    objectKinds: kinds,
    identityFields: Array.isArray(options.identityFields) && options.identityFields.length
      ? options.identityFields
      : ["projectId", `${objectKind || "object"}Id`],
    schema: options.schema || (objectKind ? `${objectKind}@1` : ""),
    version: options.version || "1",
    sourceWorld,
  };
}

const DIRECT_INFORMATION_BRIDGE_ROWS = Object.freeze([
  {
    id: "ic1.direct-session-rollout",
    name: "Direct session and turn evidence",
    role: "canonical_evidence",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/session/session-store.js", "src/main/direct/controller/live-text-controller.js"],
    ontology: ontologyShape(["direct_codex_session", "direct_codex_turn", "direct_codex_tool_obligation"], "harness", {
      identityFields: ["projectId", "sessionId", "turnId", "obligationId"],
      schema: "direct_codex_session@1",
    }),
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
    ontology: ontologyShape(["direct_thread_operation_event", "direct_rollout_manifest"], "harness", {
      identityFields: ["projectId", "threadId", "operationId", "ledgerSeq"],
      schema: "direct_thread_operation_event@1",
    }),
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
    ontology: ontologyShape(["meta_session", "run_contract", "cross_context_route", "transition_guard_decision"], "harness", {
      identityFields: ["metaSessionId", "artifactId", "ledgerHeadDigest"],
      schema: "direct_meta_session@1",
    }),
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
    ontology: ontologyShape(["renderer_transcript_projection", "compact_transcript_projection"], "derived", {
      identityFields: ["projectId", "threadId", "projectionId", "sourceDigest"],
      schema: "renderer_transcript_projection@1",
    }),
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
    ontology: ontologyShape(["thread_lifecycle", "thread_graph", "merge_preview", "prune_preview", "fork_preview"], "derived", {
      identityFields: ["projectId", "threadId", "projectionKind", "projectionId"],
      schema: "thread_lifecycle@1",
    }),
    bridgeFit: "Materializes lifecycle, graph, evidence, merge, prune, and fork views for inspection and controlled fresh starts.",
    realignment: "Make all previews cite whether they are context-eligible, runnable, or display-only under the registry law.",
  },
  {
    id: "ic3.context-pack-and-request-manifest",
    name: "Context pack and request manifest",
    role: "context_construction",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/thread/context-pack.js", "src/main/direct/thread/obligation-projection.js", "src/main/direct/bridge/work-thread-alignment.js"],
    ontology: ontologyShape(["direct_context_pack", "direct_request_manifest", "direct_provider_input_projection"], "harness", {
      identityFields: ["projectId", "threadId", "turnId", "contextPackId", "requestManifestId"],
      schema: "direct_context_pack@1",
    }),
    bridgeFit: "Compiles selected evidence into provider input while denying hidden provider continuity and imported action authority; context packs may now cite WorkThread bindings.",
    realignment: "Represent selected inputs as registry-classed context items instead of only policy-specific records; keep WorkThread binding citation non-authoritative until routing is enforced.",
  },
  {
    id: "ic3.context-maintenance-memory-baton",
    name: "Context maintenance, durable memory, and frontier baton",
    role: "memory_continuity",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/context/maintenance.js", "scripts/direct-memory-baton-compaction-productization-regression.mjs", "src/main.js"],
    ontology: ontologyShape(["context_pressure_estimate", "context_omission_ledger", "context_loss_witness", "context_continuity_transition", "durable_thread_memory", "frontier_baton"], "harness", {
      identityFields: ["projectId", "threadId", "artifactId", "sourceDigest"],
      schema: "context_maintenance_manifest@1",
    }),
    bridgeFit: "Defines pressure, omission, memory, baton, context-loss, and continuity transition artifacts with display-only app-server sibling evidence.",
    realignment: "Memory/baton/compaction now have productized visibility witnesses; provider compaction, memory editing, and replay authority remain gated until separate live evidence and authority controls exist.",
  },
  {
    id: "ic4.read-file-authority",
    name: "Read-file authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/read-only-authority.js", "src/main/direct/controller/live-text-controller.js", "src/main/direct/bridge/work-thread-alignment.js"],
    ontology: ontologyShape(["readonly_tool_authority_decision", "readonly_tool_result", "readonly_tool_continuation_request"], "workspace", {
      identityFields: ["projectId", "threadId", "turnId", "obligationId", "resultId"],
      schema: "direct_codex_readonly_tool_authority_decision@1",
    }),
    bridgeFit: "Separates provider read intent from local path validation, result evidence, redaction, and continuation construction under a shared AuthorityBearingTransition envelope.",
    realignment: "Wire WorkThread-bound authority transitions into enforced broker routing only after shadow routing is promoted.",
  },
  {
    id: "ic4.patch-authority",
    name: "Patch authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/patch-apply-authority.js", "src/main/direct/workspace/mutation-truth.js", "src/main/direct/bridge/work-thread-alignment.js"],
    ontology: ontologyShape(["patch_apply_plan", "patch_apply_result", "workspace_effect_summary"], "workspace", {
      identityFields: ["projectId", "threadId", "turnId", "obligationId", "patchPlanId", "resultId"],
      schema: "direct_patch_apply_plan@1",
    }),
    bridgeFit: "Treats apply_patch as model proposal plus local plan, approval, mutation evidence, provider visibility, recovery posture, and a shared AuthorityBearingTransition envelope.",
    realignment: "Keep patch transition envelopes diagnostic until WorkThread routing can enforce exact target scope.",
  },
  {
    id: "ic4.command-authority",
    name: "Command execution authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/command-execution-authority.js", "src/main/direct/workspace/mutation-truth.js", "src/main/direct/bridge/work-thread-alignment.js"],
    ontology: ontologyShape(["command_execution_plan", "command_execution_result", "workspace_effect_summary"], "workspace", {
      identityFields: ["projectId", "threadId", "turnId", "obligationId", "commandPlanId", "resultId"],
      schema: "direct_command_execution_plan@1",
    }),
    bridgeFit: "Models shell execution as an authority-bearing action with command policy, result evidence, workspace-effect accounting, and a shared AuthorityBearingTransition envelope.",
    realignment: "Add registry-level risk classes for network/process/workspace/environment authority before expanding command scope or enforcing routing.",
  },
  {
    id: "ic5.recovery-and-replay-safety",
    name: "Recovery and replay safety",
    role: "governance_routing",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/recovery/recovery-scanner.js", "src/main/direct/repair/repair-loop.js"],
    ontology: ontologyShape(["direct_recovery_report", "repair_loop"], "harness", {
      identityFields: ["projectId", "sessionId", "turnId", "reportId"],
      schema: "direct_recovery_report@1",
    }),
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
    ontology: ontologyShape(["governance_packet", "semantic_broker_packet", "workflow_transition_graph"], "harness", {
      identityFields: ["projectId", "threadId", "turnId", "packetId"],
      schema: "governance_packet@1",
    }),
    bridgeFit: "Builds shadow governance packets and semantic broker diagnostics with source refs, WorkThread binding citations, AuthorityBearingTransition citations, and non-enforced routing claims.",
    realignment: "Keep WorkThread and authority-transition citations diagnostic-only until explicit promotion criteria introduce enforce-mode broker routing.",
  },
  {
    id: "ic7.sub-agent-observability",
    name: "Sub-agent observability and containment",
    role: "observability_surface",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/agents/observability.js", "src/main/direct/bridge/agent-class-spec.js", "src/main/direct/bridge/work-thread-registry.js", "src/renderer/codex-surface.js"],
    ontology: ontologyShape(["direct_agent_graph", "agent_progress_witness", "sub_agent_transcript_projection", "direct_worker_graph_alignment"], "sub_agent", {
      identityFields: ["projectId", "workThreadId", "parentThreadId", "agentThreadId", "agentNodeId"],
      schema: "direct_agent_graph@1",
    }),
    bridgeFit: "Provides agent identity, progress, containment, transcript, attention, and WorkThread-scoped worker graph projections without collapsing child agents into operator/Codex roles.",
    realignment: "Worker graph alignment now maps observed agent nodes to AgentClassSpec and WorkThread evidence while keeping routing/spawn/output-promotion authority disabled.",
  },
  {
    id: "ic8.usage-quota-readiness",
    name: "Usage, quota, model, and readiness evidence",
    role: "observability_surface",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/readiness/usage-readiness.js", "src/main/direct/usage/turn-attribution.js"],
    ontology: ontologyShape(["usage_readiness", "turn_usage_attribution", "model_evidence", "quota_evidence"], "model_provider", {
      identityFields: ["projectId", "threadId", "turnId", "usageRef", "modelId"],
      schema: "usage_readiness@1",
    }),
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
    ontology: ontologyShape(["runtime_selection", "activation_gate", "runtime_status"], "harness", {
      identityFields: ["projectId", "runtimePath", "activationId", "gateId"],
      schema: "direct_runtime_status@1",
    }),
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
    ontology: ontologyShape(["vanilla_app_server_surface", "vanilla_runtime_profile", "app_server_thread"], "model_provider", {
      identityFields: ["projectId", "threadId", "providerProfileId"],
      schema: "vanilla_app_server_surface@1",
    }),
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
    ontology: ontologyShape(["composer", "bottom_band", "middle_plane", "right_plane", "file_stash", "web_view"], "human_interface", {
      identityFields: ["projectId", "surfaceId", "uiProjectionGeneration"],
      schema: "inherited_shell_ux@1",
    }),
    bridgeFit: "Provides useful daily UX inherited from main: composer, transcript, ChatGPT linkage, middle-plane files/web/project stash, and runtime status.",
    realignment: "Direct-native UX should keep surfaces that preserve bridge law and replace surfaces that encode repo/chat/session as the work unit.",
  },
  {
    id: "ic12.work-thread-registry",
    name: "Work-thread registry and broker",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/bridge/work-thread-registry.js", "src/main/direct/ui/settings-surface.js", "scripts/direct-workthread-foundation-regression.mjs"],
    ontology: ontologyShape(["work_thread", "work_target_resolution", "work_target_resolution_report", "context_packet_ref", "authority_boundary"], "harness", {
      identityFields: ["workThreadId", "projectId", "ontologyProfileRef"],
      schema: "work_thread@1",
    }),
    bridgeFit: "Adds the canonical WorkThread object/store plus read-only projection, WorkTargetResolution, and productized target-gate report with stale and ambiguity blockers.",
    realignment: "Resolver reports are operator-visible and block ambiguous/stale target routing, but still grant no mutation/provider authority until explicit enforcement is implemented.",
  },
  {
    id: "ic13.bridge-information-registry",
    name: "Bridge information class registry",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "bootstrap_now",
    sourceFiles: ["src/main/direct/bridge/information-registry.js", "docs/DIRECT_INFORMATION_BRIDGE_REGISTRY_SPEC.md", "docs/DIRECT_INFORMATION_BRIDGE_IMPLEMENTATION_AUDIT.md"],
    ontology: ontologyShape(["bridge_information_class", "implementation_audit"], "harness", {
      identityFields: ["id", "registrySchema", "generatedAt"],
      schema: DIRECT_INFORMATION_BRIDGE_REGISTRY_SCHEMA,
    }),
    bridgeFit: "Maps current direct-path components to information roles before adding more storage, context, authority, or UI features.",
    realignment: "Promote this static audit into a stricter preflight gate for future direct feature specs and tests.",
  },
  {
    id: "ic14.skills-hooks-apps",
    name: "Skills, hooks, and app connectors as bridge modules",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/bridge/skills-hooks-apps.js", "scripts/direct-skills-hooks-apps-bridge-regression.mjs"],
    ontology: ontologyShape(["skill_module", "hook_contract", "connector_capability", "capability_context_law"], "connector", {
      identityFields: ["moduleId", "connectorId", "capabilityId"],
      schema: "bridge_skill_module@1",
    }),
    bridgeFit: "Classifies skills, hooks, apps, and connector capabilities as bridge modules with context/evidence/action-proposal posture before any execution runner exists.",
    realignment: "Keep module execution, auto-invocation, workspace mutation, provider calls, and WorkThread routing disabled until separate authority gates are implemented.",
  },
  {
    id: "ic15.direct-settings-surface",
    name: "Direct settings and bridge status surface",
    role: "observability_surface",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/ui/settings-surface.js", "scripts/direct-settings-bridge-status-regression.mjs", "src/main.js", "src/preload.js", "src/renderer/app.js"],
    ontology: ontologyShape(["settings_surface", "runtime_profile_view", "bridge_registry_view"], "human_interface", {
      identityFields: ["projectId", "settingsSurfaceId", "profileId"],
      schema: "direct_settings_surface@1",
    }),
    bridgeFit: "Builds a renderer-safe, display-only settings projection over runtime/profile, registry, WorkThread, governance, module, and continuity status.",
    realignment: "Full settings workflows remain future work; this surface exposes status without enabling routing, mutation, module execution, memory editing, or provider compaction.",
  },
  {
    id: "ic16.agent-class-spec-registry",
    name: "Agent class role contract registry",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/bridge/agent-class-spec.js", "scripts/direct-agent-class-spec-regression.mjs", "src/main/direct/ui/settings-surface.js", "src/main.js"],
    ontology: ontologyShape(["agent_class_spec", "agent_role_contract", "agent_class_status_projection"], "harness", {
      identityFields: ["agentClassId", "agentClassKind", "contractVersion"],
      schema: "direct_agent_class_spec@1",
    }),
    bridgeFit: "Declares role contracts for primary, worker, auditor, broker, orchestrator, memory, governance, closeout, fix, and sub-agent classes before execution routing exists.",
    realignment: "Keep role contracts display-only until later PRs bind worker graphs, WorkThread routing, and authority gates to concrete execution surfaces.",
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
  if (!isPlainObject(row)) {
    errors.push("invalid_row_object");
    return errors;
  }
  if (!normalizeString(row.id, "")) errors.push("missing_id");
  if (!normalizeString(row.name, "")) errors.push("missing_name");
  if (!BRIDGE_ROLES.has(row.role)) errors.push(`invalid_role:${row.role || ""}`);
  if (!IMPLEMENTATION_STATES.has(row.implementationState)) errors.push(`invalid_implementation_state:${row.implementationState || ""}`);
  if (!normalizeString(row.directPathPosture, "")) errors.push("missing_direct_path_posture");
  if (!isPlainObject(row.ontology)) {
    errors.push("missing_ontology");
  } else {
    if (!normalizeString(row.ontology.objectKind, "")) errors.push("missing_ontology_objectKind");
    if (!Array.isArray(row.ontology.identityFields) || !row.ontology.identityFields.length) {
      errors.push("missing_ontology_identityFields");
    }
    if (!normalizeString(row.ontology.schema, "")) errors.push("missing_ontology_schema");
    if (!normalizeString(row.ontology.version, "")) errors.push("missing_ontology_version");
    if (!SOURCE_WORLDS.has(row.ontology.sourceWorld)) {
      errors.push(`invalid_ontology_sourceWorld:${row.ontology.sourceWorld || ""}`);
    }
  }
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
