"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SEMANTIC_EVENT_SCHEMA = "direct_world_manager_semantic_event@1";
const TASK_SETTLEMENT_SCHEMA = "direct_world_manager_task_settlement@1";
const AGENT_INSTANTIATION_SCHEMA = "direct_world_manager_agent_instantiation@1";
const AGENT_RESULT_SCHEMA = "direct_world_manager_agent_result@1";
const PLAN_PROPOSAL_SCHEMA = "direct_world_manager_plan_proposal@1";
const IMPLEMENTATION_CONTRACT_SCHEMA = "direct_world_manager_implementation_contract@1";
const SEMANTIC_MOCKUP_STATE_SCHEMA = "direct_world_manager_semantic_mockup_state@1";
const SEMANTIC_MOCKUP_PROJECTION_SCHEMA = "direct_world_manager_semantic_mockup_projection@1";
const SEMANTIC_MOCKUP_STORE_SCHEMA = "direct_world_manager_semantic_mockup_store@1";

const ROUTER_ROLE = "world_manager_router";
const PROJECT_MANAGER_ROLE = "project_manager";
const RECONCILER_ROLE = "world_manager_reconciler";
const SUPPORTED_ROLES = new Set([ROUTER_ROLE, PROJECT_MANAGER_ROLE, RECONCILER_ROLE]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, fallback = "", maxLength = 1200) {
  const text = normalizeString(value, fallback);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function normalizeStringList(value, fallback = [], maxEntries = 12, maxLength = 360) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source
    .map((entry) => boundedString(entry, "", maxLength))
    .filter(Boolean))]
    .slice(0, maxEntries);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (value[key] !== undefined && !key.endsWith("Digest")) output[key] = stableValue(value[key]);
    return output;
  }, {});
}

function digestFor(domain, value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value))}`)
    .digest("hex")}`;
}

function nowIso(clock = Date.now) {
  const value = typeof clock === "function" ? clock() : Date.now();
  return new Date(Number(value) || Date.now()).toISOString();
}

function idFrom(prefix, value) {
  return `${prefix}_${digestFor(`${prefix}@1`, value).slice(7, 23)}`;
}

function rendererSafeError(error) {
  return {
    code: normalizeString(error?.code, "world_manager_semantic_mockup_failed"),
    message: boundedString(error?.message, "The semantic mockup transition failed.", 420),
  };
}

function normalizeProject(input = {}, index = 0, activeProjectId = "") {
  const projectId = normalizeString(input.id || input.projectId, `project_${index + 1}`);
  const active = projectId === activeProjectId || (!activeProjectId && index === 0);
  return {
    projectId,
    name: boundedString(input.name || input.label, `Project ${index + 1}`, 120),
    activityState: active ? "active" : index === 1 ? "semi_active" : "inactive",
    posture: active ? "planning_ready" : index === 1 ? "background_watch" : "quiet",
    summary: boundedString(
      input.summary || input.goal || input.description,
      active ? "Ready for a WorldManager-routed planning interaction." : "No decision currently requires attention.",
      240,
    ),
    activeWorkThreadCount: 0,
    candidateCount: 0,
    canonicalContractCount: 0,
    attentionRequired: false,
    runtimePath: boundedString(input.runtimePath || input.codex?.runtimeMode, "direct", 80),
  };
}

function initialState(input = {}, clock = Date.now) {
  const projectsInput = Array.isArray(input.projects) && input.projects.length
    ? input.projects
    : [
        { id: "direct_runtime", name: "Direct Runtime" },
        { id: "worldmodel_research", name: "Worldmodel Research" },
        { id: "archive", name: "Archive" },
      ];
  const requestedActive = normalizeString(input.activeProjectId, "");
  const activeProjectId = requestedActive || normalizeString(projectsInput[0]?.id, "direct_runtime");
  const createdAt = nowIso(clock);
  const state = {
    schema: SEMANTIC_MOCKUP_STATE_SCHEMA,
    worldId: normalizeString(input.worldId, "world_manager_semantic_mockup"),
    revision: 0,
    mode: normalizeString(input.mode, "fixture"),
    activeProjectId,
    lifecycleState: "idle",
    lifecycleLabel: "World is calm",
    activeOperationId: "",
    projects: projectsInput.slice(0, 8).map((project, index) => normalizeProject(project, index, activeProjectId)),
    messages: [],
    semanticEvents: [],
    taskSettlements: [],
    agentInstantiations: [],
    agentResults: [],
    planProposals: [],
    implementationContracts: [],
    workThreads: [],
    reconciliation: {
      state: "idle",
      proposalId: "",
      summary: "No proposal is awaiting reconciliation.",
      blindspots: [],
      continuationPaths: [],
      recommendation: "",
      resultId: "",
    },
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    rawProviderPayloadIncluded: false,
    rawChainOfThoughtIncluded: false,
  };
  state.stateDigest = digestFor(SEMANTIC_MOCKUP_STATE_SCHEMA, state);
  return state;
}

function finalizeArtifact(schema, artifact, digestField) {
  const value = {
    schema,
    ...artifact,
    rawProviderPayloadIncluded: false,
    rawChainOfThoughtIncluded: false,
  };
  value[digestField] = digestFor(schema, value);
  return value;
}

function buildSemanticEvent(input = {}, clock = Date.now) {
  return finalizeArtifact(SEMANTIC_EVENT_SCHEMA, {
    semanticEventId: normalizeString(input.semanticEventId, idFrom("semantic_event", input)),
    eventKind: normalizeString(input.eventKind, "unknown"),
    epistemicState: normalizeString(input.epistemicState, "observed"),
    authorityState: normalizeString(input.authorityState, "non_authoritative"),
    actorKind: normalizeString(input.actorKind, "system"),
    actorRole: normalizeString(input.actorRole, ""),
    projectId: normalizeString(input.projectId, ""),
    taskType: normalizeString(input.taskType, ""),
    parentSemanticEventIds: normalizeStringList(input.parentSemanticEventIds, [], 12, 180),
    artifactRefs: Array.isArray(input.artifactRefs) ? input.artifactRefs.slice(0, 24) : [],
    rendererSafeSummary: boundedString(input.rendererSafeSummary, "Semantic transition recorded.", 420),
    occurredAt: normalizeString(input.occurredAt, nowIso(clock)),
  }, "eventDigest");
}

function buildTaskSettlement(input = {}, clock = Date.now) {
  return finalizeArtifact(TASK_SETTLEMENT_SCHEMA, {
    taskSettlementId: normalizeString(input.taskSettlementId, idFrom("task_settlement", input)),
    sourceSemanticEventId: normalizeString(input.sourceSemanticEventId, ""),
    projectId: normalizeString(input.projectId, ""),
    taskType: normalizeString(input.taskType, "project_planning"),
    phase: normalizeString(input.phase, "planning"),
    responsibleRole: normalizeString(input.responsibleRole, PROJECT_MANAGER_ROLE),
    actionClasses: normalizeStringList(input.actionClasses, ["propose_plan"], 10, 120),
    worldSliceSelectors: normalizeStringList(input.worldSliceSelectors, ["project_identity", "project_posture"], 12, 160),
    settlementState: normalizeString(input.settlementState, "settled"),
    confidence: normalizeString(input.confidence, "semantic_reasoner"),
    rationale: boundedString(input.rationale, "The request concerns project-scoped planning.", 420),
    settledAt: normalizeString(input.settledAt, nowIso(clock)),
  }, "settlementDigest");
}

function buildAgentInstantiation(input = {}, clock = Date.now) {
  return finalizeArtifact(AGENT_INSTANTIATION_SCHEMA, {
    agentInstantiationId: normalizeString(input.agentInstantiationId, idFrom("agent_instantiation", input)),
    role: normalizeString(input.role, PROJECT_MANAGER_ROLE),
    roleTemplateId: normalizeString(input.roleTemplateId, "project_manager_semantic_mockup@1"),
    projectId: normalizeString(input.projectId, ""),
    taskSettlementId: normalizeString(input.taskSettlementId, ""),
    promptDigest: normalizeString(input.promptDigest, ""),
    worldSliceRefs: Array.isArray(input.worldSliceRefs) ? input.worldSliceRefs.slice(0, 20) : [],
    authorityEnvelope: {
      posture: normalizeString(input.authorityEnvelope?.posture, "advisory_only"),
      mayFormulateResponse: input.authorityEnvelope?.mayFormulateResponse !== false,
      mayAdmitCanonicalState: false,
      mayStartImplementation: false,
    },
    capabilityEnvelope: {
      tools: normalizeStringList(input.capabilityEnvelope?.tools, [], 12, 100),
      network: normalizeString(input.capabilityEnvelope?.network, "provider_transport_only"),
      workspaceMutation: false,
      remoteMutation: false,
    },
    budget: {
      model: normalizeString(input.budget?.model, "runtime_default"),
      reasoningEffort: normalizeString(input.budget?.reasoningEffort, "medium"),
      maxTurns: Number.isFinite(Number(input.budget?.maxTurns)) ? Math.max(1, Number(input.budget.maxTurns)) : 1,
    },
    completionContract: {
      requiredResultSchema: AGENT_RESULT_SCHEMA,
      finalMessageRequired: true,
      telemetryRequired: true,
      canonicalAdmissionAuthority: "world_manager",
    },
    compiledAt: normalizeString(input.compiledAt, nowIso(clock)),
  }, "instantiationDigest");
}

function buildAgentResult(input = {}, clock = Date.now) {
  return finalizeArtifact(AGENT_RESULT_SCHEMA, {
    agentResultId: normalizeString(input.agentResultId, idFrom("agent_result", input)),
    agentInstantiationId: normalizeString(input.agentInstantiationId, ""),
    sourceSemanticEventId: normalizeString(input.sourceSemanticEventId, ""),
    role: normalizeString(input.role, ""),
    projectId: normalizeString(input.projectId, ""),
    terminalState: normalizeString(input.terminalState, "completed"),
    finalMessageAnchor: {
      messageId: normalizeString(input.finalMessageAnchor?.messageId, ""),
      text: boundedString(input.finalMessageAnchor?.text, "", 12_000),
      textDigest: normalizeString(
        input.finalMessageAnchor?.textDigest,
        digestFor("agent_result_final_message@1", normalizeString(input.finalMessageAnchor?.text, "")),
      ),
    },
    semanticPayload: isPlainObject(input.semanticPayload) ? input.semanticPayload : {},
    deterministicTelemetry: {
      runtimeMode: normalizeString(input.deterministicTelemetry?.runtimeMode, "fixture"),
      model: normalizeString(input.deterministicTelemetry?.model, ""),
      reasoningEffort: normalizeString(input.deterministicTelemetry?.reasoningEffort, ""),
      inputTokens: Number(input.deterministicTelemetry?.inputTokens || 0),
      outputTokens: Number(input.deterministicTelemetry?.outputTokens || 0),
      toolCallCount: Number(input.deterministicTelemetry?.toolCallCount || 0),
      toolNames: normalizeStringList(input.deterministicTelemetry?.toolNames, [], 20, 100),
      durationMs: Number(input.deterministicTelemetry?.durationMs || 0),
      telemetrySource: normalizeString(input.deterministicTelemetry?.telemetrySource, "harness_observed"),
    },
    renderedToUser: input.renderedToUser === true,
    relayedToWorldManager: input.relayedToWorldManager === true,
    completedAt: normalizeString(input.completedAt, nowIso(clock)),
  }, "resultDigest");
}

function buildPlanProposal(input = {}, clock = Date.now) {
  const features = (Array.isArray(input.features) ? input.features : []).slice(0, 12).map((feature, index) => ({
    featureId: normalizeString(feature?.featureId || feature?.id, `feature_${index + 1}`),
    title: boundedString(feature?.title || feature, `Feature ${index + 1}`, 180),
    outcome: boundedString(feature?.outcome || feature?.description, "", 420),
    status: "proposed",
  }));
  return finalizeArtifact(PLAN_PROPOSAL_SCHEMA, {
    proposalId: normalizeString(input.proposalId, idFrom("plan_proposal", input)),
    projectId: normalizeString(input.projectId, ""),
    taskSettlementId: normalizeString(input.taskSettlementId, ""),
    sourceAgentResultId: normalizeString(input.sourceAgentResultId, ""),
    parentProposalId: normalizeString(input.parentProposalId, ""),
    title: boundedString(input.title, "Project plan proposal", 180),
    summary: boundedString(input.summary, "", 1200),
    features,
    openQuestions: normalizeStringList(input.openQuestions, [], 10, 420),
    state: normalizeString(input.state, "candidate"),
    reconciliationState: normalizeString(input.reconciliationState, "pending"),
    evidenceReviewState: normalizeString(input.evidenceReviewState, "unreviewed"),
    evidenceReviewedAt: normalizeString(input.evidenceReviewedAt, ""),
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice(0, 24) : [],
    admissionDecisionEventId: normalizeString(input.admissionDecisionEventId, ""),
    createdAt: normalizeString(input.createdAt, nowIso(clock)),
    admittedAt: normalizeString(input.admittedAt, ""),
  }, "proposalDigest");
}

function buildImplementationContract(input = {}, clock = Date.now) {
  return finalizeArtifact(IMPLEMENTATION_CONTRACT_SCHEMA, {
    implementationContractId: normalizeString(input.implementationContractId, idFrom("implementation_contract", input)),
    projectId: normalizeString(input.projectId, ""),
    admittedProposalId: normalizeString(input.admittedProposalId, ""),
    admissionSemanticEventId: normalizeString(input.admissionSemanticEventId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    state: normalizeString(input.state, "active"),
    objective: boundedString(input.objective, "Implement the admitted project plan.", 1200),
    deliverables: normalizeStringList(input.deliverables, [], 16, 420),
    obligations: normalizeStringList(
      input.obligations,
      ["Preserve proposal lineage.", "Report evidence before claiming completion."],
      16,
      420,
    ),
    completionCriteria: normalizeStringList(
      input.completionCriteria,
      ["Every admitted feature has a closure result.", "No activity is represented as success without evidence."],
      16,
      420,
    ),
    authority: {
      admittedBy: normalizeString(input.authority?.admittedBy, "operator"),
      admissionKind: "explicit_greenlight",
      remoteMutationAllowed: false,
      canonicalMutationAuthority: "world_manager",
    },
    createdAt: normalizeString(input.createdAt, nowIso(clock)),
  }, "contractDigest");
}

function parseJsonObject(text) {
  const source = normalizeString(text, "");
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], source];
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(source.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.trim());
      if (isPlainObject(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function roleInstructions(role) {
  if (role === ROUTER_ROLE) {
    return [
      "You are the fixed constitutional WorldManager semantic router.",
      "Classify the user's request without solving the project task.",
      "Return strict JSON with: projectId, taskType, phase, responsibleRole, actionClasses, worldSliceSelectors, rationale.",
      "Use responsibleRole project_manager for project planning.",
      "Do not include markdown or commentary outside the JSON object.",
    ].join(" ");
  }
  if (role === PROJECT_MANAGER_ROLE) {
    return [
      "You are a bounded Project Manager instantiated for one project-planning request.",
      "Formulate the project-scoped response, but do not claim WorldManager admission authority and do not begin implementation.",
      "Return strict JSON with: responseText, title, summary, features (array of {title,outcome}), openQuestions.",
      "The responseText should be concise, decision-oriented prose suitable for the unified conversation.",
      "Do not include markdown fences or commentary outside the JSON object.",
    ].join(" ");
  }
  if (role === RECONCILER_ROLE) {
    return [
      "You are the fixed constitutional WorldManager reconciling a Project Manager result against higher project posture.",
      "Do not micro-audit implementation details and do not silently admit the proposal.",
      "Return strict JSON with: summary, blindspots, continuationPaths, recommendation.",
      "Keep the proposal candidate unless the operator explicitly greenlights it.",
      "Do not include markdown or commentary outside the JSON object.",
    ].join(" ");
  }
  throw new Error(`Unsupported semantic mockup role: ${role}`);
}

function fixtureFeatures() {
  return [
    {
      title: "Semantic completion relay",
      outcome: "Turn final messages become typed AgentResults and enter the WorldManager inbox.",
    },
    {
      title: "Task settlement",
      outcome: "Project, task type and responsible role are settled before delegation.",
    },
    {
      title: "Compiled Project Manager",
      outcome: "A trusted role template is bound to the project world slice and a narrow authority envelope.",
    },
    {
      title: "Unified semantic workbench",
      outcome: "One conversation renders role provenance, reconciliation and same-context evidence.",
    },
    {
      title: "Admission and execution lineage",
      outcome: "Greenlight creates a canonical plan, implementation contract and active WorkThread.",
    },
  ];
}

async function deterministicSemanticRoleRunner(input = {}) {
  const role = normalizeString(input.role, "");
  if (role === ROUTER_ROLE) {
    const data = {
      projectId: normalizeString(input.projectId, "direct_runtime"),
      taskType: "project_planning",
      phase: "planning",
      responsibleRole: PROJECT_MANAGER_ROLE,
      actionClasses: ["propose_plan", "request_decision"],
      worldSliceSelectors: ["project_identity", "project_posture", "standing_project_policies", "active_goals"],
      rationale: "The user is asking to plan a project-scoped implementation sequence.",
    };
    return {
      outputText: JSON.stringify(data),
      data,
      telemetry: { runtimeMode: "fixture", model: "deterministic-semantic-fixture", reasoningEffort: "none", toolCallCount: 0 },
    };
  }
  if (role === PROJECT_MANAGER_ROLE) {
    const features = fixtureFeatures();
    const data = {
      responseText: "I would implement this as one narrow semantic slice. First we establish the completion relay and task settlement, then compile one bounded Project Manager, render its answer in the unified conversation, and keep admission as a separate WorldManager decision.",
      title: "WorldManager semantic mockup vertical slice",
      summary: "Prove one governed planning interaction end to end before generalizing roles, policies or runtime paths.",
      features,
      openQuestions: ["Whether the first admitted contract should start a fixture WorkThread or a live implementation worker."],
    };
    return {
      outputText: JSON.stringify(data),
      data,
      telemetry: { runtimeMode: "fixture", model: "deterministic-semantic-fixture", reasoningEffort: "none", toolCallCount: 0 },
    };
  }
  if (role === RECONCILER_ROLE) {
    const data = {
      summary: "The proposal advances the current architecture by testing the supra-agent interaction rather than expanding isolated substrate.",
      blindspots: [
        "The first slice does not yet prove mechanical project-policy inheritance.",
        "A live worker start would test a broader authority boundary than the planning interaction requires.",
      ],
      continuationPaths: [
        "Admit the planning slice and create a bounded implementation contract.",
        "Refine the proposal before admission.",
        "Keep the proposal candidate and test another planning turn.",
      ],
      recommendation: "Admit only after inspecting settlement, instantiation, result and reconciliation evidence.",
    };
    return {
      outputText: JSON.stringify(data),
      data,
      telemetry: { runtimeMode: "fixture", model: "deterministic-semantic-fixture", reasoningEffort: "none", toolCallCount: 0 },
    };
  }
  throw new Error(`Unsupported deterministic semantic role: ${role}`);
}

class DirectWorldManagerSemanticStore {
  constructor(input = {}) {
    const rootDir = normalizeString(input.rootDir, "");
    this.filePath = normalizeString(input.filePath, rootDir ? path.join(rootDir, "semantic-mockup-state.json") : "");
    this.memoryState = null;
  }

  readState() {
    if (!this.filePath) return this.memoryState ? structuredClone(this.memoryState) : null;
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  writeState(state) {
    const safeState = structuredClone(state);
    if (!this.filePath) {
      this.memoryState = safeState;
      return structuredClone(safeState);
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(safeState, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, this.filePath);
    return structuredClone(safeState);
  }

  reset() {
    this.memoryState = null;
    if (this.filePath) {
      try {
        fs.unlinkSync(this.filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  descriptor() {
    return {
      schema: SEMANTIC_MOCKUP_STORE_SCHEMA,
      persistence: this.filePath ? "json_atomic" : "memory",
      rawProviderPayloadStored: false,
      rawChainOfThoughtStored: false,
    };
  }
}

class DirectWorldManagerSemanticCoordinator {
  constructor(input = {}) {
    this.clock = typeof input.clock === "function" ? input.clock : Date.now;
    this.store = input.store || new DirectWorldManagerSemanticStore();
    this.roleRunner = typeof input.roleRunner === "function" ? input.roleRunner : deterministicSemanticRoleRunner;
    this.onTransition = typeof input.onTransition === "function" ? input.onTransition : null;
    this.state = this.store.readState() || initialState(input, this.clock);
    this.configureProjects(input.projects, input.activeProjectId);
    this.persist();
  }

  configureProjects(projects, activeProjectId = "") {
    if (!Array.isArray(projects) || !projects.length) return false;
    const selected = normalizeString(activeProjectId, this.state.activeProjectId) ||
      normalizeString(projects[0]?.id, this.state.activeProjectId);
    const existingById = new Map(this.state.projects.map((project) => [project.projectId, project]));
    const nextProjects = projects.slice(0, 8).map((project, index) => {
      const projectId = normalizeString(project.id || project.projectId, "");
      const existing = existingById.get(projectId) || {};
      const normalized = normalizeProject(project, index, selected);
      return {
        ...existing,
        ...normalized,
        candidateCount: Number(existing.candidateCount || 0),
        canonicalContractCount: Number(existing.canonicalContractCount || 0),
        activeWorkThreadCount: Number(existing.activeWorkThreadCount || 0),
        attentionRequired: existing.attentionRequired === true,
        posture: normalizeString(existing.posture, normalized.posture),
        activityState: projectId === selected ? "active" : index === 1 ? "semi_active" : "inactive",
      };
    });
    const changed = this.state.activeProjectId !== selected ||
      JSON.stringify(this.state.projects) !== JSON.stringify(nextProjects);
    if (changed) {
      this.state.activeProjectId = selected;
      this.state.projects = nextProjects;
    }
    return changed;
  }

  persist() {
    this.state.revision += 1;
    this.state.updatedAt = nowIso(this.clock);
    this.state.stateDigest = digestFor(SEMANTIC_MOCKUP_STATE_SCHEMA, this.state);
    this.store.writeState(this.state);
    return this.state;
  }

  async emitTransition(reason) {
    const projection = this.snapshot();
    if (this.onTransition) await this.onTransition({ reason, projection });
    return projection;
  }

  appendEvent(input) {
    const event = buildSemanticEvent(input, this.clock);
    this.state.semanticEvents.push(event);
    return event;
  }

  project(projectId = "") {
    return this.state.projects.find((project) => project.projectId === projectId) ||
      this.state.projects.find((project) => project.projectId === this.state.activeProjectId) ||
      this.state.projects[0];
  }

  rolePrompt(role, input = {}) {
    const project = this.project(input.projectId);
    if (role === ROUTER_ROLE) {
      return [
        `Known project: ${project.projectId} (${project.name}).`,
        `User request: ${normalizeString(input.userText, "")}`,
      ].join("\n");
    }
    if (role === PROJECT_MANAGER_ROLE) {
      return [
        `Project: ${project.projectId} (${project.name})`,
        `Project posture: ${project.summary}`,
        `Task settlement: ${JSON.stringify(input.settlement || {})}`,
        `User request: ${normalizeString(input.userText, "")}`,
      ].join("\n");
    }
    return [
      `Project: ${project.projectId} (${project.name})`,
      `Higher posture: ${project.summary}`,
      `User request: ${normalizeString(input.userText, "")}`,
      `Task settlement: ${JSON.stringify(input.settlement || {})}`,
      `Project Manager result: ${JSON.stringify(input.agentResult?.semanticPayload || {})}`,
      `Candidate proposal: ${JSON.stringify(input.proposal || {})}`,
    ].join("\n");
  }

  async runRole(role, input = {}) {
    if (!SUPPORTED_ROLES.has(role)) throw new Error(`Unsupported semantic mockup role: ${role}`);
    const started = Date.now();
    const result = await this.roleRunner({
      role,
      mode: this.state.mode,
      projectId: input.projectId,
      instructions: roleInstructions(role),
      prompt: this.rolePrompt(role, input),
      ...input,
    });
    const outputText = normalizeString(result?.outputText || result?.text, "");
    const data = isPlainObject(result?.data) ? result.data : parseJsonObject(outputText);
    if (!data) {
      const error = new Error(`${role} did not return the required structured semantic result.`);
      error.code = "semantic_role_result_invalid";
      throw error;
    }
    return {
      outputText,
      data,
      telemetry: {
        ...(isPlainObject(result?.telemetry) ? result.telemetry : {}),
        durationMs: Number(result?.telemetry?.durationMs || Math.max(0, Date.now() - started)),
      },
    };
  }

  async submitPlanningMessage(input = {}) {
    const text = boundedString(input.text || input.message, "", 12_000);
    if (!text) throw new Error("A planning message is required.");
    if (this.state.activeOperationId) {
      const error = new Error("The WorldManager already has an active semantic operation.");
      error.code = "semantic_operation_active";
      throw error;
    }
    const project = this.project(normalizeString(input.projectId, this.state.activeProjectId));
    const operationId = idFrom("semantic_operation", {
      text,
      projectId: project.projectId,
      revision: this.state.revision,
      at: nowIso(this.clock),
    });
    this.state.mode = normalizeString(input.mode, this.state.mode || "fixture");
    this.state.activeOperationId = operationId;
    this.state.lifecycleState = "routing";
    this.state.lifecycleLabel = "WorldManager is settling project and task";
    this.state.lastError = null;
    const userEvent = this.appendEvent({
      eventKind: "user_utterance_observed",
      epistemicState: "observed",
      authorityState: "user_authored",
      actorKind: "user",
      actorRole: "operator",
      projectId: project.projectId,
      rendererSafeSummary: boundedString(text, "", 240),
    });
    const userMessage = {
      messageId: idFrom("unified_message", { event: userEvent.semanticEventId, role: "user" }),
      semanticEventId: userEvent.semanticEventId,
      authorKind: "user",
      authorRole: "operator",
      projectId: project.projectId,
      text,
      state: "observed",
      provenanceLabel: "You",
      createdAt: userEvent.occurredAt,
    };
    this.state.messages.push(userMessage);
    this.persist();
    await this.emitTransition("user_message_observed");

    try {
      const routing = await this.runRole(ROUTER_ROLE, {
        projectId: project.projectId,
        userText: text,
      });
      const settlement = buildTaskSettlement({
        ...routing.data,
        projectId: normalizeString(routing.data.projectId, project.projectId),
        sourceSemanticEventId: userEvent.semanticEventId,
      }, this.clock);
      this.state.taskSettlements.push(settlement);
      const settlementEvent = this.appendEvent({
        eventKind: "task_settled",
        epistemicState: "validated",
        authorityState: "world_manager_settlement",
        actorKind: "agent",
        actorRole: ROUTER_ROLE,
        projectId: settlement.projectId,
        taskType: settlement.taskType,
        parentSemanticEventIds: [userEvent.semanticEventId],
        artifactRefs: [{ kind: "task_settlement", id: settlement.taskSettlementId, digest: settlement.settlementDigest }],
        rendererSafeSummary: `Routed to ${settlement.responsibleRole.replace(/_/g, " ")} for ${settlement.taskType.replace(/_/g, " ")}.`,
      });
      this.state.lifecycleState = "delegating";
      this.state.lifecycleLabel = `Compiling ${settlement.responsibleRole.replace(/_/g, " ")}`;
      this.persist();
      await this.emitTransition("task_settled");

      const pmPrompt = this.rolePrompt(PROJECT_MANAGER_ROLE, {
        projectId: settlement.projectId,
        userText: text,
        settlement,
      });
      const instantiation = buildAgentInstantiation({
        role: PROJECT_MANAGER_ROLE,
        projectId: settlement.projectId,
        taskSettlementId: settlement.taskSettlementId,
        promptDigest: digestFor("project_manager_compiled_prompt@1", pmPrompt),
        worldSliceRefs: settlement.worldSliceSelectors.map((selector) => ({
          kind: "world_slice_selector",
          id: selector,
          digest: digestFor("world_slice_selector@1", { projectId: settlement.projectId, selector }),
        })),
        budget: {
          model: normalizeString(input.model, "runtime_default"),
          reasoningEffort: normalizeString(input.reasoningEffort, "medium"),
          maxTurns: 1,
        },
      }, this.clock);
      this.state.agentInstantiations.push(instantiation);
      const instantiationEvent = this.appendEvent({
        eventKind: "agent_instantiated",
        epistemicState: "validated",
        authorityState: "bounded_delegation",
        actorKind: "system",
        actorRole: "world_manager_harness",
        projectId: settlement.projectId,
        taskType: settlement.taskType,
        parentSemanticEventIds: [settlementEvent.semanticEventId],
        artifactRefs: [{ kind: "agent_instantiation", id: instantiation.agentInstantiationId, digest: instantiation.instantiationDigest }],
        rendererSafeSummary: "A bounded Project Manager was compiled from the settled project slice.",
      });
      this.state.lifecycleState = "project_manager_active";
      this.state.lifecycleLabel = "Project Manager is formulating the response";
      this.persist();
      await this.emitTransition("project_manager_started");

      const pmRun = await this.runRole(PROJECT_MANAGER_ROLE, {
        projectId: settlement.projectId,
        userText: text,
        settlement,
        instantiation,
      });
      const responseText = boundedString(pmRun.data.responseText, pmRun.outputText, 12_000);
      const assistantMessageId = idFrom("unified_message", {
        instantiation: instantiation.agentInstantiationId,
        responseText,
      });
      const pmResult = buildAgentResult({
        agentInstantiationId: instantiation.agentInstantiationId,
        sourceSemanticEventId: instantiationEvent.semanticEventId,
        role: PROJECT_MANAGER_ROLE,
        projectId: settlement.projectId,
        finalMessageAnchor: {
          messageId: assistantMessageId,
          text: responseText,
        },
        semanticPayload: pmRun.data,
        deterministicTelemetry: {
          ...pmRun.telemetry,
          runtimeMode: normalizeString(pmRun.telemetry.runtimeMode, this.state.mode),
        },
        renderedToUser: true,
        relayedToWorldManager: true,
      }, this.clock);
      this.state.agentResults.push(pmResult);
      const pmResultEvent = this.appendEvent({
        eventKind: "agent_result_completed",
        epistemicState: "observed",
        authorityState: "project_manager_advisory",
        actorKind: "agent",
        actorRole: PROJECT_MANAGER_ROLE,
        projectId: settlement.projectId,
        taskType: settlement.taskType,
        parentSemanticEventIds: [instantiationEvent.semanticEventId],
        artifactRefs: [{ kind: "agent_result", id: pmResult.agentResultId, digest: pmResult.resultDigest }],
        rendererSafeSummary: "Project Manager response completed and entered the WorldManager semantic inbox.",
      });
      this.state.messages.push({
        messageId: assistantMessageId,
        semanticEventId: pmResultEvent.semanticEventId,
        agentResultId: pmResult.agentResultId,
        authorKind: "agent",
        authorRole: PROJECT_MANAGER_ROLE,
        projectId: settlement.projectId,
        text: responseText,
        state: "advisory",
        provenanceLabel: "Project Manager · Direct Runtime",
        createdAt: pmResult.completedAt,
      });
      const proposal = buildPlanProposal({
        projectId: settlement.projectId,
        taskSettlementId: settlement.taskSettlementId,
        sourceAgentResultId: pmResult.agentResultId,
        title: pmRun.data.title,
        summary: pmRun.data.summary,
        features: pmRun.data.features,
        openQuestions: pmRun.data.openQuestions,
        evidenceRefs: [
          { kind: "semantic_event", id: userEvent.semanticEventId, digest: userEvent.eventDigest },
          { kind: "task_settlement", id: settlement.taskSettlementId, digest: settlement.settlementDigest },
          { kind: "agent_instantiation", id: instantiation.agentInstantiationId, digest: instantiation.instantiationDigest },
          { kind: "agent_result", id: pmResult.agentResultId, digest: pmResult.resultDigest },
        ],
      }, this.clock);
      this.state.planProposals.push(proposal);
      project.candidateCount += 1;
      project.attentionRequired = true;
      project.posture = "candidate_awaiting_reconciliation";
      this.state.lifecycleState = "reconciling";
      this.state.lifecycleLabel = "Response visible · WorldManager is reconciling";
      this.state.reconciliation = {
        state: "processing",
        proposalId: proposal.proposalId,
        summary: "WorldManager is assessing the proposal against higher project posture.",
        blindspots: [],
        continuationPaths: [],
        recommendation: "",
        resultId: "",
      };
      this.persist();
      await this.emitTransition("project_manager_result_visible");

      const reconciliationRun = await this.runRole(RECONCILER_ROLE, {
        projectId: settlement.projectId,
        userText: text,
        settlement,
        agentResult: pmResult,
        proposal,
      });
      const reconciliationMessageId = idFrom("world_manager_reconciliation", {
        proposalId: proposal.proposalId,
        data: reconciliationRun.data,
      });
      const reconciliationResult = buildAgentResult({
        agentInstantiationId: "world_manager_fixed_constitutional_root",
        sourceSemanticEventId: pmResultEvent.semanticEventId,
        role: RECONCILER_ROLE,
        projectId: settlement.projectId,
        finalMessageAnchor: {
          messageId: reconciliationMessageId,
          text: normalizeString(reconciliationRun.data.summary, reconciliationRun.outputText),
        },
        semanticPayload: reconciliationRun.data,
        deterministicTelemetry: {
          ...reconciliationRun.telemetry,
          runtimeMode: normalizeString(reconciliationRun.telemetry.runtimeMode, this.state.mode),
        },
        renderedToUser: false,
        relayedToWorldManager: true,
      }, this.clock);
      this.state.agentResults.push(reconciliationResult);
      const reconciliationEvent = this.appendEvent({
        eventKind: "proposal_reconciled",
        epistemicState: "validated",
        authorityState: "world_manager_advisory",
        actorKind: "agent",
        actorRole: RECONCILER_ROLE,
        projectId: settlement.projectId,
        taskType: settlement.taskType,
        parentSemanticEventIds: [pmResultEvent.semanticEventId],
        artifactRefs: [
          { kind: "plan_proposal", id: proposal.proposalId, digest: proposal.proposalDigest },
          { kind: "agent_result", id: reconciliationResult.agentResultId, digest: reconciliationResult.resultDigest },
        ],
        rendererSafeSummary: "WorldManager reconciliation completed; the proposal remains a candidate.",
      });
      const proposalIndex = this.state.planProposals.findIndex((candidate) => candidate.proposalId === proposal.proposalId);
      this.state.planProposals[proposalIndex] = buildPlanProposal({
        ...proposal,
        reconciliationState: "reconciled",
        evidenceRefs: [
          ...proposal.evidenceRefs,
          { kind: "semantic_event", id: reconciliationEvent.semanticEventId, digest: reconciliationEvent.eventDigest },
          { kind: "agent_result", id: reconciliationResult.agentResultId, digest: reconciliationResult.resultDigest },
        ],
      }, this.clock);
      this.state.reconciliation = {
        state: "resolved",
        proposalId: proposal.proposalId,
        summary: boundedString(reconciliationRun.data.summary, "", 1200),
        blindspots: normalizeStringList(reconciliationRun.data.blindspots, [], 10, 420),
        continuationPaths: normalizeStringList(reconciliationRun.data.continuationPaths, [], 10, 420),
        recommendation: boundedString(reconciliationRun.data.recommendation, "", 1200),
        resultId: reconciliationResult.agentResultId,
      };
      this.state.lifecycleState = "candidate_ready";
      this.state.lifecycleLabel = "Candidate reconciled · evidence review required";
      this.state.activeOperationId = "";
      project.posture = "candidate_ready";
      this.persist();
      return this.emitTransition("reconciliation_completed");
    } catch (error) {
      this.state.activeOperationId = "";
      this.state.lifecycleState = "failed";
      this.state.lifecycleLabel = "Semantic transition failed";
      this.state.lastError = rendererSafeError(error);
      this.appendEvent({
        eventKind: "semantic_operation_failed",
        epistemicState: "conflicted",
        authorityState: "no_transition",
        actorKind: "system",
        actorRole: "world_manager_harness",
        projectId: project.projectId,
        parentSemanticEventIds: [userEvent.semanticEventId],
        rendererSafeSummary: this.state.lastError.message,
      });
      this.persist();
      await this.emitTransition("semantic_operation_failed");
      throw error;
    }
  }

  async inspectProposal(input = {}) {
    const proposalId = normalizeString(input.proposalId, "");
    const index = this.state.planProposals.findIndex((proposal) => proposal.proposalId === proposalId);
    if (index < 0) throw new Error("Plan proposal not found.");
    const proposal = this.state.planProposals[index];
    const reviewEvent = this.appendEvent({
      eventKind: "proposal_evidence_inspected",
      epistemicState: "observed",
      authorityState: "operator_review",
      actorKind: "user",
      actorRole: "operator",
      projectId: proposal.projectId,
      parentSemanticEventIds: proposal.evidenceRefs
        .filter((ref) => ref.kind === "semantic_event")
        .map((ref) => ref.id),
      artifactRefs: [{ kind: "plan_proposal", id: proposal.proposalId, digest: proposal.proposalDigest }],
      rendererSafeSummary: "The operator opened the same-context semantic evidence for this proposal.",
    });
    this.state.planProposals[index] = buildPlanProposal({
      ...proposal,
      evidenceReviewState: "reviewed",
      evidenceReviewedAt: reviewEvent.occurredAt,
      evidenceRefs: [
        ...proposal.evidenceRefs,
        { kind: "semantic_event", id: reviewEvent.semanticEventId, digest: reviewEvent.eventDigest },
      ],
    }, this.clock);
    this.state.lifecycleLabel = "Evidence inspected · candidate may be greenlit";
    this.persist();
    return this.emitTransition("proposal_evidence_inspected");
  }

  async admitProposal(input = {}) {
    const proposalId = normalizeString(input.proposalId, "");
    const index = this.state.planProposals.findIndex((proposal) => proposal.proposalId === proposalId);
    if (index < 0) throw new Error("Plan proposal not found.");
    const proposal = this.state.planProposals[index];
    if (proposal.state !== "candidate") {
      const error = new Error("Only a candidate proposal can be admitted.");
      error.code = "proposal_not_candidate";
      throw error;
    }
    if (proposal.reconciliationState !== "reconciled") {
      const error = new Error("WorldManager reconciliation must complete before admission.");
      error.code = "proposal_not_reconciled";
      throw error;
    }
    if (proposal.evidenceReviewState !== "reviewed") {
      const error = new Error("Inspect the proposal evidence before greenlighting canonical admission.");
      error.code = "proposal_evidence_not_reviewed";
      throw error;
    }
    const decisionEvent = this.appendEvent({
      eventKind: "proposal_admitted",
      epistemicState: "authoritative",
      authorityState: "explicit_operator_greenlight",
      actorKind: "user",
      actorRole: "operator",
      projectId: proposal.projectId,
      taskType: "project_planning",
      parentSemanticEventIds: proposal.evidenceRefs
        .filter((ref) => ref.kind === "semantic_event")
        .map((ref) => ref.id),
      artifactRefs: [{ kind: "plan_proposal", id: proposal.proposalId, digest: proposal.proposalDigest }],
      rendererSafeSummary: "The operator greenlit the reconciled proposal for canonical admission.",
    });
    const admittedProposal = buildPlanProposal({
      ...proposal,
      state: "canonical",
      admissionDecisionEventId: decisionEvent.semanticEventId,
      admittedAt: decisionEvent.occurredAt,
    }, this.clock);
    this.state.planProposals[index] = admittedProposal;
    const workThreadId = idFrom("work_thread", {
      proposalId,
      decisionEventId: decisionEvent.semanticEventId,
    });
    const contract = buildImplementationContract({
      projectId: proposal.projectId,
      admittedProposalId: proposal.proposalId,
      admissionSemanticEventId: decisionEvent.semanticEventId,
      workThreadId,
      objective: proposal.summary || proposal.title,
      deliverables: proposal.features.map((feature) => feature.title),
      authority: { admittedBy: normalizeString(input.actorId, "operator") },
    }, this.clock);
    this.state.implementationContracts.push(contract);
    this.state.workThreads.push({
      schema: "direct_world_manager_mockup_work_thread@1",
      workThreadId,
      projectId: proposal.projectId,
      implementationContractId: contract.implementationContractId,
      state: "active",
      phase: "contract_received",
      statusLabel: "Implementation contract active · no completion claimed",
      progress: 0,
      createdAt: decisionEvent.occurredAt,
      rawWorkerTranscriptIncluded: false,
    });
    const contractEvent = this.appendEvent({
      eventKind: "implementation_contract_created",
      epistemicState: "authoritative",
      authorityState: "world_manager_canonical_write",
      actorKind: "system",
      actorRole: "world_manager",
      projectId: proposal.projectId,
      taskType: "implementation",
      parentSemanticEventIds: [decisionEvent.semanticEventId],
      artifactRefs: [
        { kind: "plan_proposal", id: admittedProposal.proposalId, digest: admittedProposal.proposalDigest },
        { kind: "implementation_contract", id: contract.implementationContractId, digest: contract.contractDigest },
        { kind: "work_thread", id: workThreadId },
      ],
      rendererSafeSummary: "Canonical implementation contract created and handed to an active WorkThread.",
    });
    const project = this.project(proposal.projectId);
    project.candidateCount = Math.max(0, project.candidateCount - 1);
    project.canonicalContractCount += 1;
    project.activeWorkThreadCount += 1;
    project.attentionRequired = false;
    project.posture = "implementation_active";
    this.state.lifecycleState = "implementation_active";
    this.state.lifecycleLabel = "Canonical contract active · implementation has started";
    this.state.reconciliation = {
      ...this.state.reconciliation,
      state: "admitted",
      summary: "The reconciled proposal is now canonical and linked to an active implementation contract.",
    };
    this.persist();
    await this.emitTransition("proposal_admitted");
    return {
      projection: this.snapshot(),
      proposal: admittedProposal,
      implementationContract: contract,
      workThread: this.state.workThreads.find((thread) => thread.workThreadId === workThreadId),
      semanticEvent: contractEvent,
    };
  }

  async reset(input = {}) {
    const projects = Array.isArray(input.projects) ? input.projects : this.state.projects.map((project) => ({
      id: project.projectId,
      name: project.name,
      summary: project.summary,
      runtimePath: project.runtimePath,
    }));
    const activeProjectId = normalizeString(input.activeProjectId, this.state.activeProjectId);
    this.store.reset();
    this.state = initialState({
      projects,
      activeProjectId,
      mode: normalizeString(input.mode, this.state.mode),
    }, this.clock);
    this.persist();
    return this.emitTransition("semantic_mockup_reset");
  }

  snapshot() {
    const latestProposal = this.state.planProposals[this.state.planProposals.length - 1] || null;
    const latestContract = this.state.implementationContracts[this.state.implementationContracts.length - 1] || null;
    const latestWorkThread = this.state.workThreads[this.state.workThreads.length - 1] || null;
    const projection = {
      schema: SEMANTIC_MOCKUP_PROJECTION_SCHEMA,
      worldId: this.state.worldId,
      revision: this.state.revision,
      mode: this.state.mode,
      lifecycleState: this.state.lifecycleState,
      lifecycleLabel: this.state.lifecycleLabel,
      busy: Boolean(this.state.activeOperationId),
      activeProjectId: this.state.activeProjectId,
      projects: structuredClone(this.state.projects),
      messages: structuredClone(this.state.messages),
      latestProposal: structuredClone(latestProposal),
      latestContract: structuredClone(latestContract),
      latestWorkThread: structuredClone(latestWorkThread),
      reconciliation: structuredClone(this.state.reconciliation),
      semanticLineage: this.state.semanticEvents.slice(-24).map((event) => ({
        semanticEventId: event.semanticEventId,
        eventKind: event.eventKind,
        epistemicState: event.epistemicState,
        authorityState: event.authorityState,
        actorRole: event.actorRole,
        parentSemanticEventIds: event.parentSemanticEventIds,
        artifactRefs: event.artifactRefs,
        rendererSafeSummary: event.rendererSafeSummary,
        occurredAt: event.occurredAt,
        eventDigest: event.eventDigest,
      })),
      evidence: latestProposal ? {
        proposal: structuredClone(latestProposal),
        settlement: structuredClone(this.state.taskSettlements.find((item) => item.taskSettlementId === latestProposal.taskSettlementId) || null),
        projectManagerResult: structuredClone(this.state.agentResults.find((item) => item.agentResultId === latestProposal.sourceAgentResultId) || null),
        projectManagerInstantiation: null,
        reconciliationResult: structuredClone(this.state.agentResults.find((item) => item.agentResultId === this.state.reconciliation.resultId) || null),
      } : null,
      lastError: structuredClone(this.state.lastError),
      stateDigest: this.state.stateDigest,
      updatedAt: this.state.updatedAt,
      store: this.store.descriptor(),
      truthPosture: {
        candidateIsCanonical: latestProposal?.state === "canonical",
        activityIsCompletion: false,
        rawChainOfThoughtExposed: false,
        uiMayMintAuthority: false,
      },
    };
    if (projection.evidence?.projectManagerResult) {
      projection.evidence.projectManagerInstantiation = structuredClone(
        this.state.agentInstantiations.find(
          (item) => item.agentInstantiationId === projection.evidence.projectManagerResult.agentInstantiationId,
        ) || null,
      );
    }
    projection.projectionDigest = digestFor(SEMANTIC_MOCKUP_PROJECTION_SCHEMA, projection);
    return projection;
  }
}

function assertSemanticMockupProjectionSafe(projection = {}) {
  if (!isPlainObject(projection) || projection.schema !== SEMANTIC_MOCKUP_PROJECTION_SCHEMA) {
    throw new Error("world_manager_semantic_mockup_projection_schema_mismatch");
  }
  if (projection.truthPosture?.uiMayMintAuthority !== false) {
    throw new Error("world_manager_semantic_mockup_ui_authority_inflation");
  }
  if (projection.truthPosture?.rawChainOfThoughtExposed !== false) {
    throw new Error("world_manager_semantic_mockup_chain_of_thought_exposure");
  }
  if (projection.latestProposal?.state === "candidate" && projection.truthPosture?.candidateIsCanonical !== false) {
    throw new Error("world_manager_semantic_mockup_candidate_authority_inflation");
  }
  if (projection.latestWorkThread?.state === "active" && projection.truthPosture?.activityIsCompletion !== false) {
    throw new Error("world_manager_semantic_mockup_activity_success_inflation");
  }
  return true;
}

module.exports = {
  AGENT_INSTANTIATION_SCHEMA,
  AGENT_RESULT_SCHEMA,
  DirectWorldManagerSemanticCoordinator,
  DirectWorldManagerSemanticStore,
  IMPLEMENTATION_CONTRACT_SCHEMA,
  PLAN_PROPOSAL_SCHEMA,
  PROJECT_MANAGER_ROLE,
  RECONCILER_ROLE,
  ROUTER_ROLE,
  SEMANTIC_EVENT_SCHEMA,
  SEMANTIC_MOCKUP_PROJECTION_SCHEMA,
  SEMANTIC_MOCKUP_STATE_SCHEMA,
  TASK_SETTLEMENT_SCHEMA,
  assertSemanticMockupProjectionSafe,
  buildAgentInstantiation,
  buildAgentResult,
  buildImplementationContract,
  buildPlanProposal,
  buildSemanticEvent,
  buildTaskSettlement,
  deterministicSemanticRoleRunner,
  digestFor,
  parseJsonObject,
  roleInstructions,
};
