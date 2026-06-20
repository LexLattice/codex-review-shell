"use strict";

const crypto = require("node:crypto");
const {
  buildDirectToolActivationRegistry,
  validateDirectToolActivationRegistry,
} = require("./tool-activation-registry");
const {
  directImplementationToolSchemas,
} = require("../transport/codex-responses-transport");
const {
  buildContextRemainingWitness,
  buildHumanDecisionLedger,
  buildHumanDecisionResultEnvelope,
  buildHumanDecisionToolPacket,
  buildPermissionWideningDecision,
  buildPermissionWideningRequest,
  buildPlanProjectionMutationEnvelope,
  buildPlanProjectionStore,
} = require("../tools/control-perception-decision-substrate");

const DIRECT_FIRST_TOOL_SLICE_SCHEMA = "direct_first_tool_slice@1";
const DIRECT_FIRST_TOOL_DECLARATION_ROW_SCHEMA = "direct_first_tool_declaration_row@1";
const DIRECT_FIRST_TOOL_CALL_GATE_SCHEMA = "direct_first_tool_call_gate@1";
const DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA = "direct_first_tool_result_envelope@1";

const FIRST_SLICE_TOOLS = new Set(["read_file", "get_context_remaining", "update_plan", "request_user_input", "request_permissions"]);
const TOOL_CLASS_TO_TOOL_NAME = new Map([
  ["local_perception.workspace_read", "read_file"],
  ["session_control.plan_and_context_witness", "get_context_remaining"],
  ["session_control.get_context_remaining", "get_context_remaining"],
  ["session_control.update_plan", "update_plan"],
  ["human_decision.request_user_input", "request_user_input"],
  ["human_decision.request_permissions", "request_permissions"],
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function scalarString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function firstSliceToolName(row = {}) {
  const toolName = normalizeString(row.toolName, "");
  if (FIRST_SLICE_TOOLS.has(toolName)) return toolName;
  const toolClassId = normalizeString(row.toolClassId, "");
  if (TOOL_CLASS_TO_TOOL_NAME.has(toolClassId)) return TOOL_CLASS_TO_TOOL_NAME.get(toolClassId);
  const requestShape = normalizeString(row.providerRequestShapeSupport?.requestShapeFamily, "");
  if (requestShape === "read_file") return "read_file";
  if (requestShape === "context_status_or_control") return "get_context_remaining";
  if (requestShape === "plan_projection") return "update_plan";
  if (requestShape === "direct_human_decision_tool_packet@1") return "request_user_input";
  if (requestShape === "permission_widening_request@1") return "request_permissions";
  return "";
}

function readFileDeclarationSchema() {
  return directImplementationToolSchemas(["read_file"])[0];
}

function contextRemainingDeclarationSchema() {
  return {
    type: "function",
    name: "get_context_remaining",
    description: "Return a display-only estimate of remaining context budget. This does not authorize compaction, new_context, or larger continuation.",
    parameters: {
      type: "object",
      properties: {
        detail: {
          type: "string",
          enum: ["compact", "full"],
          description: "Optional display detail level for the context estimate.",
        },
      },
      additionalProperties: false,
    },
  };
}

function updatePlanDeclarationSchema() {
  return {
    type: "function",
    name: "update_plan",
    description: "Update the assistant working plan projection only. This does not prove completion, mutate project truth, approve tools, or change the WorkThread objective.",
    parameters: {
      type: "object",
      properties: {
        planId: {
          type: "string",
          description: "Stable plan id for the active assistant working plan.",
        },
        updateId: {
          type: "string",
          description: "Optional idempotency key for this plan update.",
        },
        mutationKind: {
          type: "string",
          enum: ["replace_plan", "append_steps", "update_step_status", "clear_plan"],
        },
        expectedBeforePlanDigest: {
          type: "string",
          description: "Optional stale-write guard. If supplied and mismatched, the update is blocked.",
        },
        stepId: {
          type: "string",
          description: "Step id for update_step_status.",
        },
        stepStatus: {
          type: "string",
          enum: ["pending", "in_progress", "completed_in_plan", "blocked", "deferred"],
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              stepId: { type: "string" },
              text: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed_in_plan", "blocked", "deferred"],
              },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  };
}

function requestUserInputDeclarationSchema() {
  return {
    type: "function",
    name: "request_user_input",
    description: "Ask the operator a bounded, non-authoritative question. Choices and free text are context only; this cannot approve tools, widen permissions, mutate workspace, or start a provider turn.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Short operator-facing question or prompt.",
        },
        choices: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              choiceId: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
        freeTextAllowed: {
          type: "boolean",
          description: "Whether the operator may add context-only free text.",
        },
        pendingPolicy: {
          type: "string",
          enum: ["single_pending_per_turn", "single_pending_per_work_thread", "multiple_allowed"],
        },
        expiresAt: {
          type: "string",
          description: "Optional ISO timestamp after which the packet should expire.",
        },
      },
      required: ["prompt", "choices"],
      additionalProperties: false,
    },
  };
}

function requestPermissionsDeclarationSchema() {
  return {
    type: "function",
    name: "request_permissions",
    description: "Request operator-confirmed permission widening for one proposed tool call only. This cannot grant permissions, approve the call, widen session/project/full access, or start a provider turn.",
    parameters: {
      type: "object",
      properties: {
        targetCapability: {
          type: "string",
          description: "Exact capability/tool authority being requested for one proposed call.",
        },
        proposedCallId: {
          type: "string",
          description: "The specific proposed call id this request refers to.",
        },
        scope: {
          type: "string",
          enum: ["single_action", "session", "project", "workspace", "full_access"],
          description: "Only single_action can produce an operator-confirmation-required request in Wave 17.",
        },
        reason: {
          type: "string",
          description: "Short context-only reason for the permission request.",
        },
      },
      required: ["targetCapability", "proposedCallId", "scope"],
      additionalProperties: false,
    },
  };
}

function providerToolSchemaFor(toolName) {
  if (toolName === "read_file") return readFileDeclarationSchema();
  if (toolName === "get_context_remaining") return contextRemainingDeclarationSchema();
  if (toolName === "update_plan") return updatePlanDeclarationSchema();
  if (toolName === "request_user_input") return requestUserInputDeclarationSchema();
  if (toolName === "request_permissions") return requestPermissionsDeclarationSchema();
  return null;
}

function activeFirstSliceRows(registry = {}) {
  return (Array.isArray(registry.rows) ? registry.rows : [])
    .filter((row) => row.state === "active")
    .map((row) => ({ row, toolName: firstSliceToolName(row) }))
    .filter((entry) => FIRST_SLICE_TOOLS.has(entry.toolName));
}

function declarationRowFor(entry = {}, options = {}) {
  const row = isPlainObject(entry.row) ? entry.row : {};
  const toolName = normalizeString(entry.toolName, "");
  const providerToolSchema = providerToolSchemaFor(toolName);
  const declaration = {
    schema: DIRECT_FIRST_TOOL_DECLARATION_ROW_SCHEMA,
    declarationRowId: `first_tool_declaration_${digestFor("direct-first-tool-declaration-row-id@1", {
      activationRowId: row.activationRowId,
      toolName,
      providerToolSchema,
    }).slice(0, 24)}`,
    toolName,
    toolClassId: normalizeString(row.toolClassId, ""),
    toolSchemaVersion: normalizeString(row.toolSchemaVersion, "direct_tool_class@1"),
    activationRowId: normalizeString(row.activationRowId, ""),
    activationRowDigest: normalizeString(row.rowDigest, ""),
    activationState: normalizeString(row.state, ""),
    activationScope: row.scope || {},
    requestShapeFamily: normalizeString(row.providerRequestShapeSupport?.requestShapeFamily, ""),
    providerProfileId: normalizeString(row.providerRequestShapeSupport?.providerProfileId, normalizeString(options.providerProfileId, "")),
    modelId: normalizeString(row.providerRequestShapeSupport?.modelId, normalizeString(options.modelId, "")),
    resultEnvelopePolicyId: normalizeString(row.contextResultEnvelopePolicy?.resultEnvelopeVersion, "tool_result_envelope@1"),
    authorityEnvelopePolicyId: normalizeString(row.authorityEnvelope?.authorityEnvelopeVersion, "authority_envelope@1"),
    recoveryReplayClassifierId: normalizeString(row.recoveryReplayClassifier?.classifierId, "direct_recovery_replay_classifier@1"),
    providerToolSchema,
    providerDeclarationEnabled: true,
    modelVisibleToolEnabled: true,
    perCallAuthorityRequired: true,
    localExecutorRoute: toolName === "read_file"
      ? "src/main/direct/tools/read-only-authority.js"
      : "src/main/direct/tools/control-perception-decision-substrate.js",
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  declaration.providerToolSchemaDigest = digestFor("direct-first-tool-provider-schema@1", providerToolSchema);
  declaration.declarationDigest = digestFor("direct-first-tool-declaration-row@1", declaration);
  return declaration;
}

function buildDirectFirstToolSlice(options = {}) {
  const activationRegistry = isPlainObject(options.activationRegistry)
    ? options.activationRegistry
    : buildDirectToolActivationRegistry(options);
  const activationValidationErrors = validateDirectToolActivationRegistry(activationRegistry);
  const declarations = activeFirstSliceRows(activationRegistry)
    .map((entry) => declarationRowFor(entry, options))
    .filter((row) => row.providerToolSchema);
  const toolDeclarationDigest = digestFor("direct-first-tool-declarations@1", declarations.map((row) => ({
    toolName: row.toolName,
    activationRowDigest: row.activationRowDigest,
    providerToolSchemaDigest: row.providerToolSchemaDigest,
  })));
  const validationErrors = [
    ...activationValidationErrors.map((error) => `activation_registry:${error}`),
    ...(activationRegistry.status !== "passed" ? [`activation_registry_not_passed:${normalizeString(activationRegistry.status, "unknown")}`] : []),
    ...declarations
      .filter((row) => !FIRST_SLICE_TOOLS.has(row.toolName))
      .map((row) => `first_slice_tool_not_allowed:${row.toolName}`),
  ];
  const slice = {
    schema: DIRECT_FIRST_TOOL_SLICE_SCHEMA,
    sliceId: normalizeString(options.sliceId, `direct_first_tool_slice_${digestFor("direct-first-tool-slice-source@1", {
      activationRegistryDigest: activationRegistry.registryDigest,
      toolDeclarationDigest,
    }).slice(0, 24)}`),
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    activationSnapshotId: normalizeString(activationRegistry.snapshot?.snapshotId, ""),
    activationRegistryDigest: normalizeString(activationRegistry.registryDigest, ""),
    sourceRegistryId: normalizeString(activationRegistry.registryId, ""),
    status: validationErrors.length ? "failed" : "passed",
    validationErrors,
    declarationCount: declarations.length,
    declarations,
    toolDeclarationDigest,
    providerRequestPatch: {
      tools: declarations.map((row) => row.providerToolSchema),
      tool_choice: declarations.length ? "auto" : undefined,
      parallel_tool_calls: false,
    },
    providerRequestShape: {
      schema: "direct_first_tool_provider_request_shape@1",
      declaredToolNames: declarations.map((row) => row.toolName),
      toolDeclarationDigest,
      activationSnapshotId: normalizeString(activationRegistry.snapshot?.snapshotId, ""),
      activationRegistryDigest: normalizeString(activationRegistry.registryDigest, ""),
      declarationCount: declarations.length,
      parallelToolCalls: false,
    },
    summary: {
      declaredToolNames: declarations.map((row) => row.toolName),
      readFileDeclared: declarations.some((row) => row.toolName === "read_file"),
      contextRemainingDeclared: declarations.some((row) => row.toolName === "get_context_remaining"),
      updatePlanDeclared: declarations.some((row) => row.toolName === "update_plan"),
      requestUserInputDeclared: declarations.some((row) => row.toolName === "request_user_input"),
      requestPermissionsDeclared: declarations.some((row) => row.toolName === "request_permissions"),
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  slice.sliceDigest = digestFor("direct-first-tool-slice@1", slice);
  return slice;
}

function declarationForTool(slice = {}, toolName = "") {
  return (Array.isArray(slice.declarations) ? slice.declarations : [])
    .find((row) => row.toolName === toolName);
}

function parseArguments(value) {
  if (isPlainObject(value)) return value;
  const text = normalizeString(value, "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    const parseError = new Error(`Tool call arguments are not valid JSON: ${error.message}`);
    parseError.code = "invalid_tool_arguments";
    throw parseError;
  }
}

function normalizeRelativePath(value) {
  const original = normalizeString(value, "");
  const text = original.replace(/\\/g, "/");
  if (
    !text ||
    /[\0-\x1f\x7f]/.test(text) ||
    text.startsWith("/") ||
    /^[A-Za-z]:\//.test(text) ||
    /^mnt\/[a-z]\//i.test(text) ||
    text.includes("://") ||
    text.split("/").includes("..")
  ) {
    const error = new Error("read_file tool requires a relative workspace path.");
    error.code = "invalid_read_file_path";
    throw error;
  }
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    const error = new Error("read_file tool path contains malformed encoding.");
    error.code = "invalid_read_file_path";
    throw error;
  }
  if (
    decoded !== text &&
    (decoded.includes("/") || decoded.includes("\\") || decoded.split(/[\\/]/).includes(".."))
  ) {
    const error = new Error("read_file tool path contains encoded traversal.");
    error.code = "invalid_read_file_path";
    throw error;
  }
  return text.replace(/^\.\/+/, "");
}

function normalizeHumanChoice(choice, index = 0) {
  if (typeof choice === "string") {
    return {
      choiceId: `choice_${index + 1}`,
      label: normalizeString(choice, "").slice(0, 160),
      description: "",
    };
  }
  if (!isPlainObject(choice)) return null;
  const choiceId = scalarString(choice.choiceId).trim() || scalarString(choice.id).trim() || `choice_${index + 1}`;
  const label = scalarString(choice.label).trim() || scalarString(choice.text).trim() || scalarString(choice.value).trim();
  return {
    choiceId: normalizeString(choiceId, `choice_${index + 1}`).slice(0, 80),
    label: normalizeString(label, "").slice(0, 160),
    description: normalizeString(scalarString(choice.description), "").slice(0, 240),
  };
}

function validateToolArguments(toolName, args) {
  if (toolName === "read_file") {
    return {
      path: normalizeRelativePath(args.path || args.relPath || args.relativePath),
    };
  }
  if (toolName === "get_context_remaining") {
    const detail = normalizeString(args.detail, "compact");
    return {
      detail: ["compact", "full"].includes(detail) ? detail : "compact",
    };
  }
  if (toolName === "update_plan") {
    const mutationKind = normalizeString(args.mutationKind, "replace_plan");
    const stepStatus = normalizeString(args.stepStatus, "");
    const steps = Array.isArray(args.steps)
      ? args.steps
        .filter(isPlainObject)
        .map((step, index) => {
          return {
            stepId: normalizeString(step.stepId || step.id, `step_${index + 1}`),
            text: normalizeString(step.text || step.step, ""),
            status: normalizePlanArgumentStatus(step.status, "pending"),
          };
        })
        .filter((step) => step.text)
      : [];
    return {
      planId: normalizeString(args.planId, ""),
      updateId: normalizeString(args.updateId, ""),
      mutationKind: ["replace_plan", "append_steps", "update_step_status", "clear_plan"].includes(mutationKind) ? mutationKind : "replace_plan",
      expectedBeforePlanDigest: normalizeString(args.expectedBeforePlanDigest, ""),
      stepId: normalizeString(args.stepId, ""),
      stepStatus: stepStatus ? normalizePlanArgumentStatus(stepStatus, "") : "",
      steps,
    };
  }
  if (toolName === "request_user_input") {
    const pendingPolicy = normalizeString(args.pendingPolicy, "single_pending_per_turn");
    const choices = (Array.isArray(args.choices) ? args.choices : [])
      .slice(0, 6)
      .map((choice, index) => normalizeHumanChoice(choice, index))
      .filter((choice) => choice && choice.label);
    return {
      promptPreview: normalizeString(args.prompt || args.promptPreview || args.question, "").slice(0, 240),
      choices,
      freeTextAllowed: args.freeTextAllowed === true,
      pendingPolicy: ["single_pending_per_turn", "single_pending_per_work_thread", "multiple_allowed"].includes(pendingPolicy)
        ? pendingPolicy
        : "single_pending_per_turn",
      expiresAt: normalizeString(args.expiresAt, ""),
    };
  }
  if (toolName === "request_permissions") {
    const scope = normalizeString(args.scope || args.requestedScope || args.wideningScope, "single_action");
    return {
      targetCapability: normalizeString(scalarString(args.targetCapability || args.capabilityId || args.toolName), "").slice(0, 120),
      proposedCallId: normalizeString(scalarString(args.proposedCallId || args.callId || args.targetCallId), "").slice(0, 120),
      scope: ["single_action", "session", "project", "workspace", "full_access"].includes(scope) ? scope : "unsupported",
      reason: normalizeString(scalarString(args.reason || args.reasonPreview || args.promptPreview), "").slice(0, 240),
    };
  }
  return {};
}

function normalizePlanArgumentStatus(value, fallback = "pending") {
  const rawStatus = normalizeString(value, fallback);
  const status = rawStatus === "completed" ? "completed_in_plan" : rawStatus;
  return ["pending", "in_progress", "completed_in_plan", "blocked", "deferred"].includes(status) ? status : fallback;
}

function buildDirectFirstToolCallGate(options = {}) {
  const slice = isPlainObject(options.slice) ? options.slice : buildDirectFirstToolSlice(options);
  const toolCall = isPlainObject(options.toolCall) ? options.toolCall : {};
  const toolName = normalizeString(toolCall.name || toolCall.toolName, "");
  const callId = normalizeString(toolCall.callId || toolCall.call_id, "");
  const providerItemId = normalizeString(toolCall.itemId || toolCall.item_id || toolCall.providerItemId || toolCall.id, "");
  const declaration = declarationForTool(slice, toolName);
  const errors = validateDirectFirstToolSlice(slice);
  const blockerCodes = [...errors.map((error) => `slice:${error}`)];
  if (!declaration) blockerCodes.push(`tool_not_declared:${toolName || "unknown"}`);
  let parsedArgs = {};
  try {
    parsedArgs = declaration ? validateToolArguments(toolName, parseArguments(toolCall.arguments || toolCall.argumentsJson || toolCall.args)) : {};
  } catch (error) {
    blockerCodes.push(error.code || "invalid_tool_arguments");
  }
  const gate = {
    schema: DIRECT_FIRST_TOOL_CALL_GATE_SCHEMA,
    gateId: `first_tool_call_gate_${digestFor("direct-first-tool-call-gate-id@1", {
      sliceDigest: slice.sliceDigest,
      callId,
      toolName,
      parsedArgs,
    }).slice(0, 24)}`,
    sliceId: normalizeString(slice.sliceId, ""),
    sliceDigest: normalizeString(slice.sliceDigest, ""),
    activationRegistryDigest: normalizeString(slice.activationRegistryDigest, ""),
    activationSnapshotId: normalizeString(slice.activationSnapshotId, ""),
    toolDeclarationDigest: normalizeString(slice.toolDeclarationDigest, ""),
    declarationRowId: normalizeString(declaration?.declarationRowId, ""),
    declarationDigest: normalizeString(declaration?.declarationDigest, ""),
    activationRowId: normalizeString(declaration?.activationRowId, ""),
    toolName,
    callId,
    providerItemId,
    parsedArguments: parsedArgs,
    status: blockerCodes.length ? "blocked" : "accepted",
    blockerCodes: normalizeStringList(blockerCodes),
    perCallAuthorityRequired: true,
    localExecutorRoute: normalizeString(declaration?.localExecutorRoute, ""),
    resultEnvelopePolicyId: normalizeString(declaration?.resultEnvelopePolicyId, "tool_result_envelope@1"),
    recoveryReplayClassifierId: normalizeString(declaration?.recoveryReplayClassifierId, "direct_recovery_replay_classifier@1"),
    rawArgumentsIncluded: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  gate.gateDigest = digestFor("direct-first-tool-call-gate@1", gate);
  return gate;
}

function buildContextRemainingResultEnvelope(options = {}) {
  const gate = isPlainObject(options.gate) ? options.gate : buildDirectFirstToolCallGate(options);
  const witness = buildContextRemainingWitness({
    ...(options.contextRemainingInput || {}),
    projectId: normalizeString(options.projectId, options.contextRemainingInput?.projectId || ""),
    threadId: normalizeString(options.threadId, options.contextRemainingInput?.threadId || ""),
    turnId: normalizeString(options.turnId, options.contextRemainingInput?.turnId || ""),
    usableFor: "display_only",
    providerTruth: false,
    nowMs: options.nowMs,
  });
  const blockerCodes = [];
  if (gate.status !== "accepted") blockerCodes.push("tool_call_gate_not_accepted");
  if (gate.toolName !== "get_context_remaining") blockerCodes.push("wrong_tool_for_context_remaining_envelope");
  const envelope = {
    schema: DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA,
    envelopeId: `first_tool_result_${digestFor("direct-first-tool-context-result-id@1", {
      gateDigest: gate.gateDigest,
      witnessDigest: witness.witnessDigest,
    }).slice(0, 24)}`,
    toolName: "get_context_remaining",
    callId: normalizeString(gate.callId, ""),
    gateId: normalizeString(gate.gateId, ""),
    gateDigest: normalizeString(gate.gateDigest, ""),
    resultKind: "context_remaining_status",
    status: blockerCodes.length ? "blocked" : "ready_for_provider_continuation",
    blockerCodes,
    providerOutput: {
      kind: "get_context_remaining_result",
      tokensLeft: witness.tokensLeft,
      remainingTokens: witness.remainingTokens,
      usedTokens: witness.usedTokens,
      contextWindow: witness.contextWindow,
      pressurePercent: witness.pressurePercent,
      freshness: witness.freshness,
      confidence: witness.confidence,
      estimateKind: witness.estimateKind,
      usableFor: "display_only",
      permissionToContinue: false,
      compactionAuthority: false,
      providerCompactionAuthority: false,
    },
    witness,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.envelopeDigest = digestFor("direct-first-tool-result-envelope@1", envelope);
  return envelope;
}

function buildUpdatePlanResultEnvelope(options = {}) {
  const gate = isPlainObject(options.gate) ? options.gate : buildDirectFirstToolCallGate(options);
  const parsed = isPlainObject(gate.parsedArguments) ? gate.parsedArguments : {};
  const planStoreInput = isPlainObject(options.planStoreInput) ? options.planStoreInput : {};
  const explicitPlanInput = isPlainObject(options.planInput) ? options.planInput : {};
  const planInput = {
    currentPlan: isPlainObject(explicitPlanInput.currentPlan)
      ? explicitPlanInput.currentPlan
      : isPlainObject(planStoreInput.currentPlan)
        ? planStoreInput.currentPlan
        : undefined,
    currentPlanDigest: normalizeString(explicitPlanInput.currentPlanDigest, normalizeString(planStoreInput.currentPlanDigest, "")),
    ...explicitPlanInput,
    ...parsed,
    projectId: normalizeString(options.projectId, explicitPlanInput.projectId || ""),
    workThreadId: normalizeString(options.workThreadId, explicitPlanInput.workThreadId || ""),
    threadId: normalizeString(options.threadId, explicitPlanInput.threadId || ""),
    sourceTurnId: normalizeString(options.turnId, explicitPlanInput.sourceTurnId || explicitPlanInput.turnId || ""),
    actorKind: "resident_model",
    planOwner: "resident_model",
    planAuthority: "assistant_working_plan",
    nowMs: options.nowMs,
  };
  const planEnvelope = buildPlanProjectionMutationEnvelope(planInput);
  const planStore = buildPlanProjectionStore({
    ...planStoreInput,
    projectId: planInput.projectId,
    workThreadId: planInput.workThreadId,
    threadId: planInput.threadId,
    planId: planEnvelope.planId,
    envelope: planEnvelope,
    nowMs: options.nowMs,
  });
  const blockerCodes = [];
  if (gate.status !== "accepted") blockerCodes.push("tool_call_gate_not_accepted");
  if (gate.toolName !== "update_plan") blockerCodes.push("wrong_tool_for_update_plan_envelope");
  if (planEnvelope.blocked === true) blockerCodes.push(...planEnvelope.blockerCodes.map((code) => `plan:${code}`));
  const envelope = {
    schema: DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA,
    envelopeId: `first_tool_result_${digestFor("direct-first-tool-plan-result-id@1", {
      gateDigest: gate.gateDigest,
      planEnvelopeDigest: planEnvelope.envelopeDigest,
      planStoreDigest: planStore.storeDigest,
    }).slice(0, 24)}`,
    toolName: "update_plan",
    callId: normalizeString(gate.callId, ""),
    gateId: normalizeString(gate.gateId, ""),
    gateDigest: normalizeString(gate.gateDigest, ""),
    resultKind: "plan_projection_update",
    status: blockerCodes.length ? "blocked" : "ready_for_provider_continuation",
    blockerCodes: normalizeStringList(blockerCodes),
    providerOutput: {
      kind: "update_plan_result",
      planId: planEnvelope.planId,
      updateId: planEnvelope.updateId,
      mutationKind: planEnvelope.mutationKind,
      blocked: planEnvelope.blocked,
      blockerCodes: planEnvelope.blockerCodes,
      planOwner: planEnvelope.planOwner,
      planAuthority: planEnvelope.planAuthority,
      currentPlanDigest: planStore.currentPlanDigest,
      mutatesWorkThreadTruth: false,
      mutatesProjectTruth: false,
      mutatesOperatorPlan: false,
      closesObligations: false,
      marksWorkThreadComplete: false,
      approvesTools: false,
      provesCompletion: false,
    },
    planEnvelope,
    planStore,
    contextAdmission: {
      admittedAs: "plan_evidence",
      rawTextIncluded: false,
      mutatesWorkThreadTruth: false,
      provesCompletion: false,
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.envelopeDigest = digestFor("direct-first-tool-result-envelope@1", envelope);
  return envelope;
}

function buildRequestUserInputResultEnvelope(options = {}) {
  const gate = isPlainObject(options.gate) ? options.gate : buildDirectFirstToolCallGate(options);
  const parsed = isPlainObject(gate.parsedArguments) ? gate.parsedArguments : {};
  const decisionPacket = buildHumanDecisionToolPacket({
    ...(options.humanDecisionInput || {}),
    ...parsed,
    projectId: normalizeString(options.projectId, options.humanDecisionInput?.projectId || ""),
    workThreadId: normalizeString(options.workThreadId, options.humanDecisionInput?.workThreadId || ""),
    threadId: normalizeString(options.threadId, options.humanDecisionInput?.threadId || ""),
    turnId: normalizeString(options.turnId, options.humanDecisionInput?.turnId || ""),
    toolKind: "request_user_input",
    status: "pending",
    nowMs: options.nowMs,
  });
  const blockerCodes = [];
  if (gate.status !== "accepted") blockerCodes.push("tool_call_gate_not_accepted");
  if (gate.toolName !== "request_user_input") blockerCodes.push("wrong_tool_for_request_user_input_envelope");
  if (!decisionPacket.promptPreview) blockerCodes.push("human_decision_missing_prompt");
  if (decisionPacket.boundedChoiceCount < 1) blockerCodes.push("human_decision_missing_bounded_choices");
  const existingPackets = Array.isArray(options.humanDecisionLedgerInput?.packets) ? options.humanDecisionLedgerInput.packets : [];
  const ledgerPackets = blockerCodes.length ? existingPackets : [...existingPackets, decisionPacket];
  const decisionLedger = buildHumanDecisionLedger({
    ...(options.humanDecisionLedgerInput || {}),
    projectId: decisionPacket.projectId,
    workThreadId: decisionPacket.workThreadId,
    threadId: decisionPacket.threadId,
    packets: ledgerPackets,
    results: Array.isArray(options.humanDecisionLedgerInput?.results) ? options.humanDecisionLedgerInput.results : [],
    nowMs: options.nowMs,
  });
  const envelope = {
    schema: DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA,
    envelopeId: `first_tool_result_${digestFor("direct-first-tool-human-decision-result-id@1", {
      gateDigest: gate.gateDigest,
      packetDigest: decisionPacket.packetDigest,
      ledgerDigest: decisionLedger.ledgerDigest,
    }).slice(0, 24)}`,
    toolName: "request_user_input",
    callId: normalizeString(gate.callId, ""),
    gateId: normalizeString(gate.gateId, ""),
    gateDigest: normalizeString(gate.gateDigest, ""),
    resultKind: "human_decision_packet",
    status: blockerCodes.length ? "blocked" : "waiting_for_human",
    blockerCodes: normalizeStringList(blockerCodes),
    providerOutput: {
      kind: "request_user_input_result",
      decisionPacketId: decisionPacket.decisionPacketId,
      status: blockerCodes.length ? "blocked" : decisionPacket.status,
      boundedChoiceCount: decisionPacket.boundedChoiceCount,
      pendingPolicy: decisionPacket.pendingPolicy,
      freeTextAllowed: decisionPacket.freeTextAllowed,
      freeTextPolicy: "context_only",
      authorityGranted: false,
      mayStartProviderTurn: false,
      mayApproveToolAction: false,
      mayMutateWorkspace: false,
      freeTextCanWidenAuthority: false,
      pendingPacketCount: decisionLedger.pendingPacketCount,
    },
    decisionPacket,
    decisionLedger,
    contextAdmission: {
      admittedAs: "operator_decision",
      admissionState: blockerCodes.length ? "blocked" : "pending",
      rawTextIncluded: false,
      authorityGranted: false,
      mayStartProviderTurn: false,
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.envelopeDigest = digestFor("direct-first-tool-result-envelope@1", envelope);
  return envelope;
}

function buildHumanDecisionAnswerResultEnvelope(input = {}) {
  const result = buildHumanDecisionResultEnvelope(input);
  const envelope = {
    schema: DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA,
    envelopeId: `first_tool_result_${digestFor("direct-first-tool-human-decision-answer-id@1", result).slice(0, 24)}`,
    toolName: "request_user_input",
    callId: normalizeString(input.callId, ""),
    gateId: normalizeString(input.gateId, ""),
    gateDigest: normalizeString(input.gateDigest, ""),
    resultKind: "human_decision_result",
    status: result.resultState,
    blockerCodes: [],
    providerOutput: {
      kind: "request_user_input_answer",
      decisionPacketId: result.decisionPacketId,
      selectedChoiceIds: result.selectedChoiceIds,
      freeTextPresent: result.freeTextPresent,
      freeTextAdmittedAs: result.freeTextAdmittedAs,
      authorityGranted: false,
      mayStartProviderTurn: false,
    },
    humanDecisionResult: result,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.envelopeDigest = digestFor("direct-first-tool-result-envelope@1", envelope);
  return envelope;
}

function buildRequestPermissionsResultEnvelope(options = {}) {
  const gate = isPlainObject(options.gate) ? options.gate : buildDirectFirstToolCallGate(options);
  const parsed = isPlainObject(gate.parsedArguments) ? gate.parsedArguments : {};
  const permissionRequest = buildPermissionWideningRequest({
    ...(options.permissionRequestInput || {}),
    ...parsed,
    projectId: normalizeString(options.projectId, options.permissionRequestInput?.projectId || ""),
    workThreadId: normalizeString(options.workThreadId, options.permissionRequestInput?.workThreadId || ""),
    threadId: normalizeString(options.threadId, options.permissionRequestInput?.threadId || ""),
    turnId: normalizeString(options.turnId, options.permissionRequestInput?.turnId || ""),
    sourceCallId: normalizeString(gate.callId, options.permissionRequestInput?.sourceCallId || ""),
    nowMs: options.nowMs,
  });
  const decisionDefaults = {
    decisionState: permissionRequest.status === "blocked" ? "denied" : "operator_confirm_required",
    operatorConfirmationRequired: permissionRequest.status !== "blocked",
  };
  const decisionOverride = permissionRequest.status === "blocked" ? {} : (options.permissionDecisionInput || {});
  const permissionDecision = buildPermissionWideningDecision({
    ...decisionDefaults,
    ...decisionOverride,
    requestId: permissionRequest.requestId,
    nowMs: options.nowMs,
  });
  const blockerCodes = [];
  if (gate.status !== "accepted") blockerCodes.push("tool_call_gate_not_accepted");
  if (gate.toolName !== "request_permissions") blockerCodes.push("wrong_tool_for_request_permissions_envelope");
  blockerCodes.push(...permissionRequest.blockerCodes);
  const status = blockerCodes.length ? "blocked" : "operator_confirmation_required";
  const envelope = {
    schema: DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA,
    envelopeId: `first_tool_result_${digestFor("direct-first-tool-permission-result-id@1", {
      gateDigest: gate.gateDigest,
      requestDigest: permissionRequest.requestDigest,
      decisionDigest: permissionDecision.decisionDigest,
    }).slice(0, 24)}`,
    toolName: "request_permissions",
    callId: normalizeString(gate.callId, ""),
    gateId: normalizeString(gate.gateId, ""),
    gateDigest: normalizeString(gate.gateDigest, ""),
    resultKind: "permission_widening_request",
    status,
    blockerCodes: normalizeStringList(blockerCodes),
    providerOutput: {
      kind: "request_permissions_result",
      requestId: permissionRequest.requestId,
      status,
      targetCapability: permissionRequest.targetCapability,
      proposedCallId: permissionRequest.proposedCallId,
      scope: permissionRequest.scope,
      requiresOperatorConfirmation: permissionRequest.requiresOperatorConfirmation,
      decisionRequiredBeforeGrant: true,
      authorityGranted: false,
      permissionGranted: false,
      mayStartProviderTurn: false,
      mayMutateWorkspace: false,
      broadAuthorityRequested: permissionRequest.broadAuthorityRequested,
    },
    permissionRequest,
    permissionDecision,
    contextAdmission: {
      admittedAs: "permission_request_status",
      admissionState: status,
      rawTextIncluded: false,
      authorityGranted: false,
      mayStartProviderTurn: false,
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.envelopeDigest = digestFor("direct-first-tool-result-envelope@1", envelope);
  return envelope;
}

function validateDirectFirstToolSlice(slice = {}) {
  const errors = [];
  if (!isPlainObject(slice) || slice.schema !== DIRECT_FIRST_TOOL_SLICE_SCHEMA) return ["direct_first_tool_slice_schema_mismatch"];
  if (!slice.activationRegistryDigest || !slice.activationSnapshotId || !slice.toolDeclarationDigest) errors.push("first_tool_slice_missing_frozen_refs");
  for (const row of Array.isArray(slice.declarations) ? slice.declarations : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_FIRST_TOOL_DECLARATION_ROW_SCHEMA) {
      errors.push("first_tool_declaration_row_schema_mismatch");
      continue;
    }
    if (!FIRST_SLICE_TOOLS.has(row.toolName)) errors.push(`first_tool_declaration_not_allowed:${row.toolName || ""}`);
    if (row.providerDeclarationEnabled !== true || row.modelVisibleToolEnabled !== true) errors.push(`first_tool_declaration_not_enabled:${row.toolName || ""}`);
    if (row.perCallAuthorityRequired !== true) errors.push(`first_tool_declaration_missing_per_call_authority:${row.toolName || ""}`);
    if (!row.activationRowId || !row.activationRowDigest || row.activationState !== "active") errors.push(`first_tool_declaration_missing_active_activation:${row.toolName || ""}`);
    if (!isPlainObject(row.providerToolSchema) || row.providerToolSchema.name !== row.toolName) errors.push(`first_tool_provider_schema_mismatch:${row.toolName || ""}`);
    for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
      if (row[flag] !== false) errors.push(`first_tool_declaration_raw_leak:${row.toolName || ""}:${flag}`);
    }
  }
  if (!isPlainObject(slice.providerRequestPatch) || !Array.isArray(slice.providerRequestPatch.tools)) errors.push("first_tool_request_patch_missing");
  if (slice.providerRequestPatch?.parallel_tool_calls !== false) errors.push("first_tool_parallel_calls_not_disabled");
  for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    if (slice[flag] !== false) errors.push(`first_tool_slice_raw_leak:${flag}`);
  }
  if (Array.isArray(slice.validationErrors) && slice.validationErrors.length && slice.status !== "failed") {
    errors.push("first_tool_validation_errors_without_failed_status");
  }
  return errors;
}

function validateDirectFirstToolCallGate(gate = {}) {
  const errors = [];
  if (!isPlainObject(gate) || gate.schema !== DIRECT_FIRST_TOOL_CALL_GATE_SCHEMA) return ["direct_first_tool_call_gate_schema_mismatch"];
  if (gate.status === "accepted") {
    if (!FIRST_SLICE_TOOLS.has(gate.toolName)) errors.push(`first_tool_call_gate_tool_not_allowed:${gate.toolName || ""}`);
    if (!gate.declarationDigest || !gate.toolDeclarationDigest || !gate.activationRowId) errors.push("first_tool_call_gate_missing_frozen_refs");
    if (gate.perCallAuthorityRequired !== true) errors.push("first_tool_call_gate_missing_per_call_authority");
  }
  for (const flag of ["rawArgumentsIncluded", "rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawSecretIncluded"]) {
    if (gate[flag] !== false) errors.push(`first_tool_call_gate_raw_leak:${flag}`);
  }
  return errors;
}

module.exports = {
  DIRECT_FIRST_TOOL_CALL_GATE_SCHEMA,
  DIRECT_FIRST_TOOL_DECLARATION_ROW_SCHEMA,
  DIRECT_FIRST_TOOL_RESULT_ENVELOPE_SCHEMA,
  DIRECT_FIRST_TOOL_SLICE_SCHEMA,
  buildContextRemainingResultEnvelope,
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildHumanDecisionAnswerResultEnvelope,
  buildRequestPermissionsResultEnvelope,
  buildRequestUserInputResultEnvelope,
  buildUpdatePlanResultEnvelope,
  validateDirectFirstToolCallGate,
  validateDirectFirstToolSlice,
};
