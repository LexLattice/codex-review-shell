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
    name: "Thread workbench and deck projections",
    role: "derived_projection",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/thread/thread-deck.js", "src/main/direct/thread/thread-evidence-workbench.js", "src/main/direct/thread/thread-workbench-controller.js"],
    ontology: ontologyShape(["direct_thread_deck_projection", "thread_lifecycle", "thread_graph", "merge_preview", "prune_preview", "fork_preview"], "derived", {
      identityFields: ["projectId", "threadId", "projectionKind", "projectionId"],
      schema: "direct_thread_deck_projection@1",
    }),
    bridgeFit: "Materializes the direct-native thread deck plus lifecycle, graph, evidence, merge, prune, and fork views for inspection and controlled fresh starts.",
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
    sourceFiles: ["src/main/direct/context/maintenance.js", "scripts/direct-memory-baton-compaction-productization-regression.mjs", "scripts/direct-compaction-workflow-gate-regression.mjs", "src/main.js"],
    ontology: ontologyShape(["context_pressure_estimate", "context_omission_ledger", "context_loss_witness", "context_compaction_plan", "context_compaction_gate", "context_continuity_transition", "durable_thread_memory", "thread_memory_review_packet", "thread_memory_refresh_proposal", "thread_memory_reset_policy", "thread_memory_reset_confirmation", "frontier_baton"], "harness", {
      identityFields: ["projectId", "threadId", "artifactId", "sourceDigest"],
      schema: "context_maintenance_manifest@1",
    }),
    bridgeFit: "Defines pressure, omission, compaction planning/gates, memory review/refresh/reset workflow, baton, context-loss, and continuity transition artifacts with display-only app-server sibling evidence.",
    realignment: "Compaction now has local plan and manual-gate witnesses; actual compact execution, memory mutation/reset, provider compaction, and replay authority remain gated until separate live evidence and authority controls exist.",
  },
  {
    id: "ic4.read-file-authority",
    name: "Read-file authority transition",
    role: "authority_gate",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/tools/read-only-authority.js", "src/main/direct/controller/live-text-controller.js", "src/main/direct/bridge/work-thread-alignment.js", "scripts/direct-read-tool-loop-regression.mjs"],
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
    sourceFiles: ["src/main/direct/tools/patch-apply-authority.js", "src/main/direct/workspace/mutation-truth.js", "src/main/direct/bridge/work-thread-alignment.js", "scripts/direct-patch-tool-loop-regression.mjs"],
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
    sourceFiles: ["src/main/direct/tools/command-execution-authority.js", "src/main/direct/workspace/mutation-truth.js", "src/main/direct/bridge/work-thread-alignment.js", "scripts/direct-command-tool-loop-regression.mjs"],
    ontology: ontologyShape(["command_execution_plan", "command_execution_result", "workspace_effect_summary"], "workspace", {
      identityFields: ["projectId", "threadId", "turnId", "obligationId", "commandPlanId", "resultId"],
      schema: "direct_command_execution_plan@1",
    }),
    bridgeFit: "Models shell execution as an authority-bearing action with command policy, result evidence, workspace-effect accounting, and a shared AuthorityBearingTransition envelope.",
    realignment: "Add registry-level risk classes for network/process/workspace/environment authority before expanding command scope or enforcing routing.",
  },
  {
    id: "ic4.workspace-mutation-truth",
    name: "Workspace mutation truth and policy projection",
    role: "canonical_evidence",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/workspace/mutation-truth.js", "scripts/direct-workspace-mutation-regression.mjs"],
    ontology: ontologyShape(["workspace_effect_summary", "workspace_policy_row", "workspace_effect_class_projection", "revert_plan_preview"], "workspace", {
      identityFields: ["projectId", "sessionId", "turnId", "effectSummaryId", "policyDigest"],
      schema: "direct_workspace_effect_summary@1",
    }),
    bridgeFit: "Separates direct patch effects, command-observed effects, untracked changes, pre-existing dirty state, and policy-blocked classes without exposing raw paths or granting revert authority.",
    realignment: "Keep revert preview display-only and require future authority transitions before executing cleanup/revert or broadening generated/vendor/lockfile policy.",
  },
  {
    id: "ic5.recovery-and-replay-safety",
    name: "Recovery and replay safety",
    role: "governance_routing",
    implementationState: "implemented",
    directPathPosture: "keep",
    sourceFiles: ["src/main/direct/recovery/recovery-scanner.js", "src/main/direct/repair/repair-loop.js", "scripts/direct-recovery-regression.mjs", "scripts/direct-tool-continuation-repair-loop-regression.mjs"],
    ontology: ontologyShape(["direct_recovery_report", "repair_loop"], "harness", {
      identityFields: ["projectId", "sessionId", "turnId", "reportId"],
      schema: "direct_recovery_report@1",
    }),
    bridgeFit: "Audits active obligations and ledgers without replaying provider calls, file reads, patches, commands, or continuations; fixture-proves recovery lifecycle, replay-safety projection, and a bounded read -> patch -> command -> repair loop with explicit continuation evidence.",
    realignment: "Use registry rows to classify which missing evidence blocks recovery versus degrades UI only; live-provider repair-loop promotion and manual resume/replay actions remain gated by real continuation evidence.",
  },
  {
    id: "ic6.semantic-governance-broker",
    name: "Governance and semantic broker diagnostics",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/governance/broker.js", "src/main/direct/bridge/controlled-routing.js", "src/main/direct/thread/thread-store.js"],
    ontology: ontologyShape(["governance_packet", "semantic_broker_packet", "workflow_transition_graph", "controlled_routing_slice"], "harness", {
      identityFields: ["projectId", "threadId", "turnId", "packetId"],
      schema: "governance_packet@1",
    }),
    bridgeFit: "Builds shadow governance packets, semantic broker diagnostics, preflight recommendation classes, and one controlled routing slice that can cite WorkTargetResolution, AgentClassSpec, and context-pack evidence before the existing direct text turn path.",
    realignment: "Controlled routing may permit only the existing direct text turn start scope; workspace mutation, tool execution, autonomous routing, multi-agent orchestration, and object-level audit remain disabled.",
  },
  {
    id: "ic6.direct-role-handoff-packet",
    name: "Direct route-to-role handoff packet",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/bridge/role-handoff-packet.js", "scripts/direct-role-handoff-packet-regression.mjs", "src/main/direct/governance/broker.js", "src/main/direct/bridge/agent-class-spec.js"],
    ontology: ontologyShape(["direct_role_handoff_packet", "direct_role_handoff_preview", "semantic_broker_preflight", "agent_class_spec"], "harness", {
      identityFields: ["projectId", "handoffPacketId", "preflightId", "workThreadId", "agentClassId"],
      schema: "direct_role_handoff_packet@1",
    }),
    bridgeFit: "Turns semantic broker route-to-role recommendations into explicit, renderer-safe handoff packets that cite WorkThread, operator broker, preflight, AgentClassSpec, authority, context, and expected output evidence.",
    realignment: "Packet accept/reject posture is display-only in this slice; provider calls, worker spawning, object-level audit, workspace mutation, and orchestration loops remain disabled until a later authority-bearing transition grants them.",
  },
  {
    id: "ic6.direct-worker-start-v0",
    name: "Direct explicit worker start V0",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_guarded",
    sourceFiles: ["src/main/direct/bridge/worker-start.js", "src/main/direct/controller/live-text-controller.js", "scripts/direct-worker-start-regression.mjs", "src/main/direct/agents/observability.js"],
    ontology: ontologyShape(["direct_worker_start_transition", "direct_worker_context_packet", "direct_worker_start_result", "direct_worker_graph_alignment"], "harness", {
      identityFields: ["projectId", "workerStartTransitionId", "handoffPacketId", "workerSessionId", "workerTurnId"],
      schema: "direct_worker_start_transition@1",
    }),
    bridgeFit: "Converts an operator-accepted role handoff into exactly one direct worker session and worker turn with context, handoff evidence, and worker graph alignment preserved separately from the primary transcript.",
    realignment: "This slice permits only a single explicit direct worker text turn; recursive worker spawning, workflow closure, object audit certification, and workspace mutation remain disabled.",
  },
  {
    id: "ic6.direct-meta-orchestrator-shadow",
    name: "Direct meta-orchestrator and auditor loop shadow",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/bridge/meta-orchestrator-shadow.js", "scripts/direct-meta-orchestrator-shadow-regression.mjs", "src/main/direct/bridge/worker-start.js", "src/main/direct/bridge/agent-class-spec.js"],
    ontology: ontologyShape(["direct_meta_orchestrator_plan_pointer", "direct_meta_orchestrator_step_event", "direct_implementation_evidence_artifact", "direct_audit_artifact", "direct_meta_orchestrator_transition_gate"], "harness", {
      identityFields: ["projectId", "workThreadId", "planId", "stepId", "artifactId", "gateId"],
      schema: "direct_meta_orchestrator_transition_gate@1",
    }),
    bridgeFit: "Represents the long-horizon loop as typed institutional events and artifacts: worker evidence is structurally routable, auditor artifacts carry object-level certification, and the meta-orchestrator gate applies only shallow transition law.",
    realignment: "This slice is shadow-only: no autonomous scheduler, no hidden super-auditor behavior, no worker self-completion judgment, no provider calls, and no workflow closure automation.",
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
    sourceFiles: ["src/main/direct/readiness/usage-readiness.js", "src/main/direct/usage/turn-attribution.js", "src/main/direct/usage/agent-ledger.js", "scripts/direct-agent-usage-ledger-regression.mjs"],
    ontology: ontologyShape(["usage_readiness", "turn_usage_attribution", "direct_agent_usage_ledger", "direct_agent_usage_summary_projection", "model_evidence", "quota_evidence"], "model_provider", {
      identityFields: ["projectId", "threadId", "turnId", "agentThreadId", "workThreadId", "usageRef", "modelId"],
      schema: "usage_readiness@1",
    }),
    bridgeFit: "Tracks model/quota/usage evidence, per-turn attribution, and direct agent/work-thread/route usage summaries without claiming exactness where evidence is missing.",
    realignment: "Direct agent usage rows are exact only where provider events reported usage; missing rows are explicit, cost remains uncomputed, and vanilla app-server totals stay inherited evidence only.",
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
    name: "Work-thread registry and operator broker",
    role: "governance_routing",
    implementationState: "partial",
    directPathPosture: "keep_shadow",
    sourceFiles: ["src/main/direct/bridge/work-thread-registry.js", "src/main/direct/governance/operator-broker-resolution.js", "src/main/direct/ui/settings-surface.js", "scripts/direct-workthread-foundation-regression.mjs", "scripts/direct-operator-broker-resolution-regression.mjs"],
    ontology: ontologyShape(["work_thread", "work_target_resolution", "work_target_resolution_report", "operator_broker_resolution", "context_packet_ref", "authority_boundary"], "harness", {
      identityFields: ["workThreadId", "projectId", "ontologyProfileRef"],
      schema: "work_thread@1",
    }),
    bridgeFit: "Adds the canonical WorkThread object/store plus read-only projection, WorkTargetResolution, productized target-gate report, and operator broker resolution over active work-world inputs.",
    realignment: "Broker resolutions make candidates, confidence, ambiguity, and non-target preservation constraints visible, but still grant no mutation/provider authority until explicit enforcement is implemented.",
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
    sourceFiles: ["src/main/direct/bridge/skills-hooks-apps.js", "scripts/direct-skills-hooks-apps-bridge-regression.mjs", "scripts/direct-module-execution-gates-regression.mjs"],
    ontology: ontologyShape(["skill_module", "hook_contract", "connector_capability", "capability_context_law", "bridge_context_contribution", "bridge_evidence_import_row", "bridge_hook_proposal", "bridge_execution_gate"], "connector", {
      identityFields: ["moduleId", "connectorId", "capabilityId"],
      schema: "bridge_skill_module@1",
    }),
    bridgeFit: "Classifies skills, hooks, apps, and connector capabilities as bridge modules with context/evidence/action-proposal posture, then projects contribution/import/proposal/gate artifacts before any execution runner exists.",
    realignment: "Context-only skill refs, connector evidence rows, hook proposals, and execution gates are visible; module execution, auto-invocation, workspace mutation, provider calls, and WorkThread routing remain disabled.",
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
    bridgeFit: "Builds a renderer-safe, display-only settings projection over runtime/profile, registry, WorkThread, operator broker, governance, module, and continuity status.",
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
  {
    id: "ic17.direct-attachment-capability",
    name: "Direct attachment capability and submit semantics",
    role: "authority_gate",
    implementationState: "partial",
    directPathPosture: "keep_and_align",
    sourceFiles: ["src/main/direct/attachments/capability.js", "scripts/direct-attachment-capability-regression.mjs", "src/main/direct/controller/live-text-controller.js", "src/main/direct/controller/fixture-controller.js", "src/renderer/codex-surface.js"],
    ontology: ontologyShape(["direct_attachment_capability_projection", "direct_attachment_submit_packet", "attachment_transcript_witness"], "harness", {
      identityFields: ["projectId", "draftId", "turnClientId", "packetId"],
      schema: "direct_attachment_submit_packet@1",
    }),
    bridgeFit: "Classifies staged composer attachments for direct turns as provider payloads, workspace refs, staged refs, text refs, or unsupported without exposing raw paths or raw payloads.",
    realignment: "Direct provider file/image payloads remain unsupported until runtime evidence proves them; v0 accepts governed workspace/staged references and records blocked-state witnesses for unsupported drafts.",
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
