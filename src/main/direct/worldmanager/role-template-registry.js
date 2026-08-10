"use strict";

const { digestFor } = require("./control-plane");

const TRUSTED_ROLE_TEMPLATE_SCHEMA = "direct_trusted_role_template@1";
const TRUSTED_ROLE_TEMPLATE_REGISTRY_SCHEMA =
  "direct_trusted_role_template_registry@1";
const AGENT_WORLD_COMPILER_REVISION =
  "world_manager_agent_world_compiler@3";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildTemplate(input) {
  const template = {
    schema: TRUSTED_ROLE_TEMPLATE_SCHEMA,
    roleTemplateId: input.roleTemplateId,
    roleTemplateRevision: 1,
    roleKind: input.roleKind,
    purpose: input.purpose,
    applicableTaskTypes: [...input.applicableTaskTypes].sort(),
    systemInstructionLayers: [...input.systemInstructionLayers],
    responseMode:
      input.responseMode || "structured_semantic_discharge",
    requiredOutputSchema: input.requiredOutputSchema,
    requiredOutputFields: [...input.requiredOutputFields].sort(),
    authorityCeiling: {
      mayReadAdmittedGraphProjection:
        input.authorityCeiling?.mayReadAdmittedGraphProjection === true,
      mayFormulateCandidate:
        input.authorityCeiling?.mayFormulateCandidate === true,
      mayInvokeTools: input.authorityCeiling?.mayInvokeTools === true,
      mayMutateWorkspace:
        input.authorityCeiling?.mayMutateWorkspace === true,
      mayMutateRemoteSystems:
        input.authorityCeiling?.mayMutateRemoteSystems === true,
      mayAdmitCanonicalWorldstate:
        input.authorityCeiling?.mayAdmitCanonicalWorldstate === true,
      mayStartImplementation:
        input.authorityCeiling?.mayStartImplementation === true,
    },
    capabilityCeiling: {
      allowedToolNames: [
        ...(input.capabilityCeiling?.allowedToolNames || []),
      ].sort(),
      allowedEffectClasses: [
        ...(input.capabilityCeiling?.allowedEffectClasses || []),
      ].sort(),
    },
    templateStatus: input.templateStatus || "active_k3",
    compilerCompatibility: [AGENT_WORLD_COMPILER_REVISION],
    sourcePosture: "trusted_harness_code",
    rendererEditable: false,
    modelEditable: false,
    grantsAuthority: false,
  };
  template.digest = digestFor(
    TRUSTED_ROLE_TEMPLATE_SCHEMA,
    template,
    ["digest"],
  );
  return Object.freeze(template);
}

const TEMPLATE_INPUTS = Object.freeze([
  {
    roleTemplateId: "world_manager.constitutional@1",
    roleKind: "world_manager",
    purpose:
      "Maintain world-level posture and answer naturally without silently admitting canonical state.",
    applicableTaskTypes: [
      "implementation_request",
      "policy_discussion",
      "portfolio_planning",
      "project_ecology_status",
      "project_discussion",
      "project_initialization",
      "project_planning",
      "project_review",
      "cross_project_comparison",
      "semantic_decision_deliberation",
      "world_conversation",
    ],
    systemInstructionLayers: [
      "You are the constitutional WorldManager for this settled task.",
      "Reason only from the admitted graph projection, the current user directive, and the compiled task constitution.",
      "Keep global posture, distinguish candidates from canonical state, surface uncertainty when relevant, and reply directly to the user in natural language.",
      "Do not wrap the reply in JSON, a schema-shaped object, or a semantic-settlement envelope. Semantic discharge and canonical effects are separate harness-owned operations.",
      "Do not claim provider continuity, workspace effects, canonical admission, implementation start, or authority beyond the compiled envelopes.",
    ],
    responseMode: "natural_language",
    requiredOutputSchema: "direct_final_assistant_message@1",
    requiredOutputFields: ["text"],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
  },
  {
    roleTemplateId: "world_manager.project_genesis@1",
    roleKind: "world_manager",
    purpose:
      "Interpret a new-project idea and formulate a grounded project-constitution candidate from harness-observed realization options.",
    applicableTaskTypes: ["project_initialization"],
    systemInstructionLayers: [
      "You are the constitutional WorldManager responsible for project genesis before a Project Manager exists.",
      "Interpret the user's project idea at world scope and rank only the harness-observed realization options supplied in the trusted evidence layer.",
      "Prefer the environment whose native capabilities best fit the project's dominant work. Keep blocked or unavailable options visibly blocked.",
      "Return exactly one strict project-genesis result. projectConstitution must contain proposedProjectId, name, summary, primaryAgentEnvironmentId, allowedEnvironmentIds, and gitAuthorityEnvironmentId.",
      "realizationRecommendations must contain rank, environmentId, rationale as an array of strings, and tradeoffs as an array of strings.",
      "This result is advisory. Do not claim that a project, workspace, repository, executor, or canonical constitution has been created.",
    ],
    responseMode: "structured_semantic_discharge",
    requiredOutputSchema:
      "direct_world_manager_project_genesis_result@1",
    requiredOutputFields: [
      "openDecisions",
      "projectConstitution",
      "realizationRecommendations",
      "semanticSummary",
    ],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
  },
  {
    roleTemplateId: "project_manager.planning@1",
    roleKind: "project_manager",
    purpose:
      "Formulate and explain a project-scoped plan naturally while preserving the boundary between proposal and canonical commitment.",
    applicableTaskTypes: ["project_planning"],
    systemInstructionLayers: [
      "You are the Project Manager planning organ for the bound project and task.",
      "Formulate a project-scoped proposal from the admitted graph projection and the current user directive, then present it directly to the user in natural language.",
      "Expose relevant open decisions, constraints, and continuation paths. Do not wrap the reply in JSON or a schema-shaped object; semantic registration is a separate WorldManager operation.",
      "Do not mutate files or remotes, admit worldstate, start implementation, invoke tools, or imply that the proposal is canonical.",
    ],
    responseMode: "natural_language",
    requiredOutputSchema: "direct_final_assistant_message@1",
    requiredOutputFields: ["text"],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
  },
  {
    roleTemplateId: "project_manager.reconciliation_support@1",
    roleKind: "project_manager",
    purpose:
      "Interpret a bounded project request and answer naturally without producing effects.",
    applicableTaskTypes: [
      "implementation_request",
      "policy_discussion",
      "project_discussion",
      "project_review",
    ],
    systemInstructionLayers: [
      "You are a bounded Project Manager reasoning organ for the bound project and task.",
      "Assess the current request from the admitted project graph and compiled constitution.",
      "Reply directly to the user in natural language and surface relevant open decisions or lawful continuations.",
      "Do not wrap the reply in JSON or a schema-shaped object; semantic registration is a separate WorldManager operation.",
      "Do not execute implementation, invoke tools, mutate files or remotes, or admit canonical worldstate.",
    ],
    responseMode: "natural_language",
    requiredOutputSchema: "direct_final_assistant_message@1",
    requiredOutputFields: ["text"],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
  },
  {
    roleTemplateId: "thread_manager.implementation@1",
    roleKind: "thread_manager",
    purpose:
      "Future implementation-thread manager template reserved for a contract-bound runtime.",
    applicableTaskTypes: ["implementation_request"],
    systemInstructionLayers: [
      "Manage only the admitted implementation contract and its WorkThread.",
      "Delegate within the compiled authority and capability envelopes.",
      "Do not treat activity as completion or exceed the parent contract.",
    ],
    requiredOutputSchema: "direct_thread_manager_result@1",
    requiredOutputFields: ["closureState", "evidenceRefs", "semanticSummary"],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
    templateStatus: "reserved_future_runtime",
  },
  {
    roleTemplateId: "worker.implementation@1",
    roleKind: "worker",
    purpose:
      "Future implementation worker template reserved for attenuated delegated work.",
    applicableTaskTypes: ["implementation_request"],
    systemInstructionLayers: [
      "Implement only the bounded delegated task.",
      "Remain within the compiled capability and authority envelopes.",
      "Return evidence and never self-admit completion.",
    ],
    requiredOutputSchema: "direct_worker_implementation_result@1",
    requiredOutputFields: ["evidenceRefs", "semanticSummary", "terminalState"],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
    templateStatus: "reserved_future_runtime",
  },
  {
    roleTemplateId: "reviewer.closure@1",
    roleKind: "reviewer",
    purpose:
      "Future closure reviewer template reserved for evidence-backed completion assessment.",
    applicableTaskTypes: ["project_review"],
    systemInstructionLayers: [
      "Review the bounded object against its completion contract and evidence.",
      "Report gaps explicitly and never repair the object under review.",
      "Return a typed closure recommendation without self-admitting completion.",
    ],
    requiredOutputSchema: "direct_reviewer_closure_result@1",
    requiredOutputFields: ["evidenceRefs", "findings", "recommendation"],
    authorityCeiling: {
      mayReadAdmittedGraphProjection: true,
      mayFormulateCandidate: true,
    },
    templateStatus: "reserved_future_runtime",
  },
]);

const TEMPLATES = Object.freeze(TEMPLATE_INPUTS.map(buildTemplate));
const TEMPLATE_BY_ID = new Map(
  TEMPLATES.map((template) => [template.roleTemplateId, template]),
);

function trustedRoleTemplateRegistry() {
  const registry = {
    schema: TRUSTED_ROLE_TEMPLATE_REGISTRY_SCHEMA,
    registryId: "world_manager_trusted_role_templates@1",
    compilerRevision: AGENT_WORLD_COMPILER_REVISION,
    templates: TEMPLATES.map(clone),
    rendererRegistrationAllowed: false,
    modelRegistrationAllowed: false,
    grantsAuthority: false,
  };
  registry.digest = digestFor(
    TRUSTED_ROLE_TEMPLATE_REGISTRY_SCHEMA,
    registry,
    ["digest"],
  );
  return registry;
}

function getTrustedRoleTemplate(roleTemplateId) {
  const template = TEMPLATE_BY_ID.get(String(roleTemplateId || ""));
  if (!template) {
    fail("world_manager_role_template_unavailable", roleTemplateId);
  }
  return clone(template);
}

function selectTrustedRoleTemplate(taskSettlement) {
  let roleTemplateId;
  if (taskSettlement?.taskType === "project_initialization") {
    roleTemplateId = "world_manager.project_genesis@1";
  } else if (taskSettlement?.responsibleRole === "world_manager") {
    roleTemplateId = "world_manager.constitutional@1";
  } else if (taskSettlement?.taskType === "project_planning") {
    roleTemplateId = "project_manager.planning@1";
  } else {
    roleTemplateId = "project_manager.reconciliation_support@1";
  }
  const template = getTrustedRoleTemplate(roleTemplateId);
  if (
    template.roleKind !== taskSettlement?.responsibleRole ||
    !template.applicableTaskTypes.includes(taskSettlement?.taskType) ||
    template.templateStatus !== "active_k3"
  ) {
    fail(
      "world_manager_role_template_task_mismatch",
      `${roleTemplateId}:${taskSettlement?.taskType || ""}`,
    );
  }
  return template;
}

module.exports = {
  AGENT_WORLD_COMPILER_REVISION,
  TRUSTED_ROLE_TEMPLATE_REGISTRY_SCHEMA,
  TRUSTED_ROLE_TEMPLATE_SCHEMA,
  getTrustedRoleTemplate,
  selectTrustedRoleTemplate,
  trustedRoleTemplateRegistry,
};
