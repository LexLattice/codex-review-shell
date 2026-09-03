"use strict";

const crypto = require("node:crypto");
const {
  authorizeDirectThreadHarnessCapability,
  capabilityNames: harnessGrantCapabilityNames,
} = require("../authority/direct-thread-harness-grant");

const DIRECT_SELF_CONSTITUTION_SNAPSHOT_SCHEMA =
  "direct_self_constitution_snapshot@1";
const DIRECT_SELF_CONSTITUTION_TOOL_NAME = "inspect_self_constitution";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256")
    .update(`${domain}:${stableStringify(value)}`)
    .digest("hex")}`;
}

function workspaceConstitution(project = {}, session = {}) {
  const workspace = isPlainObject(session.workspace) && Object.keys(session.workspace).length
    ? session.workspace
    : isPlainObject(project.workspace) ? project.workspace : {};
  const explicitMode = normalizeString(
    session.workspaceMode || session.workspaceExecution?.workspaceMode,
    "",
  );
  const substrateKind = normalizeString(workspace.kind, "unknown");
  if (explicitMode === "reasoning_only") {
    return {
      substrateKind: "none",
      bindingKind: "reasoning_only",
      persistence: "no_workspace",
      isolation: "no_workspace",
      projectCheckout: false,
      rawWorkspacePathIncluded: false,
    };
  }
  if (explicitMode === "isolated_worktree") {
    return {
      substrateKind,
      bindingKind: "isolated_worktree",
      persistence: "persistent_until_harness_cleanup",
      isolation: "child_specific_git_worktree",
      projectCheckout: true,
      rawWorkspacePathIncluded: false,
    };
  }
  return {
    substrateKind,
    bindingKind: "persistent_project_checkout",
    persistence: "persistent_across_turns_and_app_restarts",
    isolation: "project_bound_checkout",
    projectCheckout: true,
    rawWorkspacePathIncluded: false,
  };
}

function laneFromComposition(composition = {}) {
  const selection = composition?.composerInput?.laneSelection || {};
  const lanes = Array.isArray(composition?.roleLaneRegistry?.lanes)
    ? composition.roleLaneRegistry.lanes
    : Array.isArray(composition?.roleLaneRegistry?.rows)
      ? composition.roleLaneRegistry.rows
      : [];
  const lane = lanes.find((candidate) => (
    normalizeString(candidate?.laneId, "") === normalizeString(selection.laneId, "")
  )) || lanes.find((candidate) => (
    normalizeString(candidate?.laneKind, "") === normalizeString(selection.laneKind, "")
  )) || {};
  return { selection, lane };
}

function potentialToolNames(input = {}) {
  const explicit = normalizeStringList(input.potentialToolNames);
  if (explicit.length) return explicit;
  const grant = isPlainObject(input.harnessGrant)
    ? input.harnessGrant
    : isPlainObject(input.toolComposition?.composerInput?.harnessGrant)
      ? input.toolComposition.composerInput.harnessGrant
      : null;
  const granted = harnessGrantCapabilityNames(grant || {});
  if (granted.length) return granted;
  const { lane } = laneFromComposition(input.toolComposition);
  return normalizeStringList(lane.defaultToolNames);
}

function declaredToolNames(input = {}) {
  const explicit = normalizeStringList(input.declaredToolNames);
  if (explicit.length) return explicit;
  return normalizeStringList(
    input.toolComposition?.providerDeclaredToolBundle?.declaredToolNames,
  );
}

function unavailableRows(input = {}) {
  const rows = input.toolComposition?.residentCapabilityCatalogue?.knownUnavailable;
  return Array.isArray(rows) ? rows : [];
}

function authorityProjection(toolName, harnessGrant = null, input = {}) {
  if (harnessGrant) {
    const authorization = authorizeDirectThreadHarnessCapability(harnessGrant, toolName, {
      taskId: input.threadId,
      threadId: input.threadId,
      projectId: input.projectId,
      runtimeAdmittedCapabilityNames: input.runtimeAdmittedCapabilityNames,
    });
    if (authorization.authorized) {
      return {
        requirement: "durable_task_grant",
        state: "authorized",
        authorityMode: "durable_task_grant",
        grantId: authorization.grantId,
        grantRevision: authorization.grantRevision,
        approvalPolicy: authorization.approvalPolicy,
        sandboxMode: authorization.sandboxMode,
        authorizationDoesNotImplyExecution: true,
      };
    }
  }
  if (["apply_patch", "run_command"].includes(toolName)) {
    return {
      requirement: "per_action_human_approval",
      state: "not_requested",
      authorizationDoesNotImplyExecution: true,
    };
  }
  if (toolName === "read_file") {
    return {
      requirement: "per_call_workspace_read_gate",
      state: "not_requested",
      authorizationDoesNotImplyExecution: true,
    };
  }
  if (toolName === "request_user_input") {
    return {
      requirement: "human_decision_packet",
      state: "not_requested",
      authorizationDoesNotImplyExecution: true,
    };
  }
  if (["spawn_agent", "wait_agent"].includes(toolName)) {
    return {
      requirement: "harness_agent_runtime_gate",
      state: "not_requested",
      authorizationDoesNotImplyExecution: true,
    };
  }
  if (["web_search", "image_generation"].includes(toolName)) {
    return {
      requirement: "provider_capability_evidence",
      state: "not_requested",
      authorizationDoesNotImplyExecution: true,
    };
  }
  return {
    requirement: "none_read_only_projection",
    state: "not_required",
    authorizationDoesNotImplyExecution: true,
  };
}

function capabilityRows(input = {}) {
  const potential = potentialToolNames(input);
  const declared = declaredToolNames(input);
  const harnessGrant = isPlainObject(input.harnessGrant)
    ? input.harnessGrant
    : isPlainObject(input.toolComposition?.composerInput?.harnessGrant)
      ? input.toolComposition.composerInput.harnessGrant
      : null;
  const granted = harnessGrantCapabilityNames(harnessGrant || {});
  const declaredSet = new Set(declared);
  const unavailableByName = new Map(unavailableRows(input).map((row) => [
    normalizeString(row?.toolName, ""),
    row,
  ]));
  const enactmentUpdates = isPlainObject(input.enactmentUpdates)
    ? input.enactmentUpdates
    : {};
  return normalizeStringList([...potential, ...declared, ...granted, ...unavailableByName.keys()])
    .map((toolName) => {
      const unavailable = unavailableByName.get(toolName);
      const selected = declaredSet.has(toolName);
      const enactment = isPlainObject(enactmentUpdates[toolName])
        ? enactmentUpdates[toolName]
        : {};
      return {
        toolName,
        potentialState: potential.includes(toolName) ? "role_catalogued" : "request_specific",
        selectionState: selected ? "declared_this_turn" : "not_selected_this_turn",
        availability: selected
          ? "callable_now"
          : normalizeString(unavailable?.status, "not_selected"),
        blockerCode: selected
          ? ""
          : normalizeString(unavailable?.reason, ""),
        authority: {
          ...authorityProjection(toolName, harnessGrant, {
            projectId: normalizeString(input.project?.id || input.project?.projectId || input.session?.projectId, ""),
            threadId: normalizeString(input.session?.sessionId || input.sessionId, ""),
            runtimeAdmittedCapabilityNames: declared,
          }),
          ...(isPlainObject(enactment.authority) ? enactment.authority : {}),
        },
        cataloguedState: "catalogued",
        declaredState: selected ? "declared" : "not_declared",
        grantedState: granted.includes(toolName) ? "granted" : "not_granted",
        callableState: selected && (!harnessGrant || granted.includes(toolName)) ? "callable" : "not_callable",
        enactedState: normalizeString(enactment.state, "unrequested") === "executed" ? "enacted" : "not_enacted",
        enactment: {
          state: normalizeString(enactment.state, "unrequested"),
          evidenceRef: normalizeString(enactment.evidenceRef, ""),
        },
      };
    });
}

function safeProviderProfiles(pool = {}) {
  return (Array.isArray(pool.providerProfiles) ? pool.providerProfiles : [])
    .map((profile) => ({
      providerId: normalizeString(profile?.providerId, ""),
      status: normalizeString(profile?.status, "unknown"),
      blockerCode: normalizeString(profile?.blockerCode, ""),
      model: normalizeString(profile?.model, ""),
      transport: normalizeString(profile?.transport, "unknown"),
      childToolsAllowed: profile?.childToolsAllowed === true,
      automaticTransportContinuation: profile?.autoContinuation === true,
      rawCredentialIncluded: false,
      rawSecretIncluded: false,
    }))
    .filter((profile) => profile.providerId)
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function safeActiveSubAgentPolicy(projection = {}) {
  const source = isPlainObject(projection) ? projection : {};
  const policy = isPlainObject(source.activePolicy)
    ? source.activePolicy
    : null;
  const updateRequests = Array.isArray(source.recentUpdateRequests)
    ? source.recentUpdateRequests
    : [];
  return {
    state: normalizeString(source.state, "unsettled"),
    resolutionSource: normalizeString(
      source.resolutionSource,
      "none",
    ),
    activePolicyRef: isPlainObject(source.activePolicyRef)
      ? { ...source.activePolicyRef }
      : null,
    scope: policy && isPlainObject(policy.scope)
      ? { ...policy.scope }
      : null,
    roleBindings: policy
      ? (Array.isArray(policy.roleBindings)
          ? policy.roleBindings
          : []).map((binding) => ({ ...binding }))
      : [],
    maxActiveChildren: Number(policy?.maxActiveChildren || 0),
    deviationRule: policy && isPlainObject(policy.deviationRule)
      ? { ...policy.deviationRule }
      : null,
    spawnPosture: normalizeString(
      source.spawnPosture,
      "block_and_request_policy_settlement",
    ),
    latestSemanticSettlement:
      isPlainObject(source.latestSemanticSettlement)
        ? {
            settlementId: normalizeString(
              source.latestSemanticSettlement.settlementId,
              "",
            ),
            state: normalizeString(
              source.latestSemanticSettlement.state,
              "",
            ),
            summary: normalizeString(
              source.latestSemanticSettlement.summary,
              "",
            ),
            clarificationQuestion: normalizeString(
              source.latestSemanticSettlement.clarificationQuestion,
              "",
            ),
            digest: normalizeString(
              source.latestSemanticSettlement.digest,
              "",
            ),
          }
        : null,
    pendingUpdateRequestCount: updateRequests.filter(
      (entry) => entry?.state === "candidate_only",
    ).length,
    latestUpdateRequest: isPlainObject(updateRequests[0])
      ? {
          requestId: normalizeString(updateRequests[0].requestId, ""),
          state: normalizeString(updateRequests[0].state, ""),
          roleId: normalizeString(updateRequests[0].roleId, ""),
          digest: normalizeString(updateRequests[0].digest, ""),
          launchAuthorityGranted:
            updateRequests[0].launchAuthorityGranted === true,
        }
      : null,
    owner: "direct_harness",
    rendererMayInventDefault: false,
    silentOverrideAllowed: false,
    grantsWorkspaceAuthority: false,
    grantsRemoteMutationAuthority: false,
  };
}

function compileDirectSelfConstitutionSnapshot(input = {}) {
  const project = isPlainObject(input.project) ? input.project : {};
  const session = isPlainObject(input.session) ? input.session : {};
  const status = isPlainObject(input.status) ? input.status : {};
  const composition = isPlainObject(input.toolComposition)
    ? input.toolComposition
    : {};
  const { selection } = laneFromComposition(composition);
  const pool = isPlainObject(input.subAgentPoolDescriptor)
    ? input.subAgentPoolDescriptor
    : {};
  const observedAt = normalizeString(input.observedAt, new Date().toISOString());
  const projectId = normalizeString(
    project.id || project.projectId || session.projectId,
    "project_direct",
  );
  const sessionId = normalizeString(session.sessionId || input.sessionId, "direct_session");
  const turnId = normalizeString(input.turnId, "direct_turn");
  const rows = capabilityRows(input);
  const base = {
    schema: DIRECT_SELF_CONSTITUTION_SNAPSHOT_SCHEMA,
    identity: {
      agentClass: "direct_resident_agent",
      roleId: normalizeString(
        selection.roleId || session.agentRole,
        "implementation_worker",
      ),
      laneKind: normalizeString(selection.laneKind, "implementation_worker"),
      projectId,
      workThreadId: normalizeString(
        selection.workThreadId || session.workThreadId,
        "",
      ),
      sessionId,
      turnId,
      model: normalizeString(input.model || session.model || status.model, ""),
      reasoningEffort: normalizeString(
        input.reasoningEffort || session.reasoningEffort,
        "",
      ),
    },
    projectBinding: {
      projectId,
      ...workspaceConstitution(project, session),
    },
    capabilities: {
      potentialToolNames: potentialToolNames(input),
      declaredThisTurn: declaredToolNames(input),
      grantedThisTurn: harnessGrantCapabilityNames(
        isPlainObject(input.harnessGrant)
          ? input.harnessGrant
          : isPlainObject(composition.composerInput?.harnessGrant)
            ? composition.composerInput.harnessGrant
            : {},
      ),
      grantId: normalizeString(
        input.harnessGrant?.grantId || composition.composerInput?.harnessGrant?.grantId,
        "",
      ),
      grantRevision: Number(
        input.harnessGrant?.grantRevision || composition.composerInput?.harnessGrant?.grantRevision || 0,
      ),
      grantApprovalPolicy: normalizeString(
        input.harnessGrant?.approvalPolicy || composition.composerInput?.harnessGrant?.approvalPolicy,
        "",
      ),
      grantSandboxMode: normalizeString(
        input.harnessGrant?.sandboxMode || composition.composerInput?.harnessGrant?.sandboxMode,
        "",
      ),
      rows,
      potentialDoesNotImplySelected: true,
      selectedDoesNotImplyAuthorized: true,
      authorizedDoesNotImplyExecuted: true,
    },
    providerReadiness: {
      primary: {
        providerId: "chatgpt-direct",
        status: normalizeString(status.status, "unknown"),
        evidenceRef: normalizeString(status.evidenceId, ""),
      },
      childProviders: safeProviderProfiles(pool),
    },
    delegationCapacity: {
      maxActiveChildren: Number(pool.maxActiveChildren || 0),
      maxQueuedChildren: Number(pool.maxQueuedChildren || 0),
      activeChildren: Number(pool.activeChildren || 0),
      queuedChildren: Number(pool.queuedChildren || 0),
      acceptingNewChildren: pool.acceptingNewChildren === true,
      capacityScope: normalizeString(pool.capacityScope, "unknown"),
      contextHandoffIndependentOfModel:
        pool.contextHandoffIndependentOfModel === true,
      contextHandoffIndependentOfReasoningEffort:
        pool.contextHandoffIndependentOfReasoningEffort === true,
    },
    activeSubAgentPolicy: safeActiveSubAgentPolicy(
      input.activeSubAgentPolicy,
    ),
    contextManifest: {
      compiledAgentContextId: normalizeString(
        input.compiledAgentContext?.compiledAgentContextId,
        "",
      ),
      contextBuildId: normalizeString(input.contextBuildId, ""),
      requestManifestId: normalizeString(input.requestManifestId, ""),
      currentUserMessageIncluded: true,
      rendererInstructionInputAccepted: false,
      admittedConversationContextMayBeIncluded: true,
      rawConversationLogBlindlyImported: false,
    },
    currentness: {
      observedAt,
      freshness: "current_at_compilation",
      supersedesDigest: normalizeString(input.supersedesDigest, ""),
      owner: "direct_harness",
    },
    sourceRefs: {
      roleLaneSelectionDigest: normalizeString(selection.selectionDigest, ""),
      toolCompositionWitnessDigest: normalizeString(
        composition.witness?.witnessDigest,
        "",
      ),
      providerBundleDigest: normalizeString(
        composition.providerDeclaredToolBundle?.declarationDigest,
        "",
      ),
      projectBindingDigest: normalizeString(session.workThreadBindingDigest, ""),
      modelEvidenceRef: normalizeString(status.evidenceId, ""),
    },
    safety: {
      readOnlyProjection: true,
      grantsAuthority: false,
      executesCapabilities: false,
      rawWorkspacePathIncluded: false,
      rawCredentialIncluded: false,
      rawSecretIncluded: false,
      rawChainOfThoughtIncluded: false,
    },
  };
  const digest = digestFor("direct-self-constitution-snapshot@1", base);
  return {
    ...base,
    snapshotId: `direct_self_constitution_${digest.slice(7, 31)}`,
    digest,
  };
}

function validateDirectSelfConstitutionSnapshot(snapshot = {}) {
  const errors = [];
  if (snapshot.schema !== DIRECT_SELF_CONSTITUTION_SNAPSHOT_SCHEMA) {
    errors.push("self_constitution_schema_mismatch");
  }
  for (const field of ["agentClass", "roleId", "projectId", "sessionId", "turnId"]) {
    if (!normalizeString(snapshot.identity?.[field], "")) errors.push(`missing_identity_${field}`);
  }
  if (!normalizeString(snapshot.projectBinding?.bindingKind, "")) {
    errors.push("missing_project_binding_kind");
  }
  if (!Array.isArray(snapshot.capabilities?.rows)) errors.push("capability_rows_not_array");
  if (!isPlainObject(snapshot.activeSubAgentPolicy)) {
    errors.push("active_sub_agent_policy_not_object");
  }
  if (
    snapshot.activeSubAgentPolicy?.state === "active" &&
    !snapshot.activeSubAgentPolicy?.activePolicyRef?.digest
  ) {
    errors.push("active_sub_agent_policy_ref_missing");
  }
  if (snapshot.safety?.readOnlyProjection !== true) errors.push("projection_not_read_only");
  if (snapshot.safety?.grantsAuthority !== false) errors.push("projection_grants_authority");
  if (snapshot.safety?.executesCapabilities !== false) errors.push("projection_executes_capabilities");
  if (snapshot.safety?.rawWorkspacePathIncluded !== false) errors.push("raw_workspace_path_flag_not_false");
  if (snapshot.safety?.rawSecretIncluded !== false) errors.push("raw_secret_flag_not_false");
  const { digest, snapshotId: _snapshotId, ...base } = snapshot;
  const expectedDigest = digestFor("direct-self-constitution-snapshot@1", base);
  if (digest !== expectedDigest) errors.push("self_constitution_digest_mismatch");
  return errors;
}

function renderDirectSelfConstitutionInstructions(snapshot = {}) {
  const errors = validateDirectSelfConstitutionSnapshot(snapshot);
  if (errors.length) {
    const error = new Error(`Direct self constitution is invalid: ${errors.join(", ")}`);
    error.code = "direct_self_constitution_invalid";
    error.validationErrors = errors;
    throw error;
  }
  const declared = snapshot.capabilities.declaredThisTurn.length
    ? snapshot.capabilities.declaredThisTurn.join(", ")
    : "none";
  const gated = snapshot.capabilities.rows
    .filter((row) => row.selectionState === "declared_this_turn" && row.authority.state !== "not_required")
    .map((row) => `${row.toolName}:${row.authority.requirement}`);
  const childProviders = snapshot.providerReadiness.childProviders
    .map((provider) => `${provider.providerId}=${provider.status}${provider.blockerCode ? `(${provider.blockerCode})` : ""}`);
  const binding = snapshot.projectBinding;
  const subAgentPolicy = snapshot.activeSubAgentPolicy;
  const grantSentence = snapshot.capabilities.grantId
    ? `The current task grant ${snapshot.capabilities.grantId} revision ${snapshot.capabilities.grantRevision} authorizes the runtime-admitted subset under approval policy ${snapshot.capabilities.grantApprovalPolicy || "unknown"} and sandbox ${snapshot.capabilities.grantSandboxMode || "unknown"}; authorization still does not prove execution.`
    : "No durable full-access task grant is active for this projection.";
  const policyBindings = subAgentPolicy.roleBindings.map((entry) => {
    const dimensions = [
      entry.providerId && `provider=${entry.providerId}`,
      entry.model && `model=${entry.model}`,
      entry.reasoningEffort && `effort=${entry.reasoningEffort}`,
      entry.forkTurns && `context=${entry.forkTurns}`,
      entry.workspaceMode && `workspace=${entry.workspaceMode}`,
      entry.toolProfile && `tools=${entry.toolProfile}`,
    ].filter(Boolean);
    return `${entry.roleId}[${dimensions.length ? dimensions.join(",") : "inherit request then parent"}]`;
  });
  const workspaceSentence = binding.bindingKind === "reasoning_only"
    ? "This turn has no workspace binding."
    : `The active workspace is a ${binding.bindingKind} on the ${binding.substrateKind} substrate; its persistence is ${binding.persistence}.`;
  return [
    `Authoritative Direct self constitution (${snapshot.digest}).`,
    `You are the ${snapshot.identity.roleId} role in the ${snapshot.identity.laneKind} lane for project ${snapshot.identity.projectId}.`,
    workspaceSentence,
    "Treat that workspace statement as authoritative: never describe a persistent project checkout as disposable, temporary, or isolated unless this snapshot says so.",
    `Tools declared for this turn: ${declared}.`,
    grantSentence,
    gated.length
      ? `Declared calls still governed by per-call authority: ${gated.join(", ")}.`
      : "No declared call is currently waiting for a separate authority grant.",
    "A role-catalogued capability is not necessarily selected for this turn; a declared tool is not thereby authorized; authorization is not evidence of execution.",
    `Primary provider readiness is ${snapshot.providerReadiness.primary.status}${snapshot.identity.model ? ` for ${snapshot.identity.model}` : ""}.`,
    `Child provider readiness: ${childProviders.length ? childProviders.join(", ") : "no child-provider profile is currently projected"}.`,
    `Child capacity is ${snapshot.delegationCapacity.maxActiveChildren} active slots and ${snapshot.delegationCapacity.maxQueuedChildren} queued slots; consult provider readiness before claiming a child provider is usable now.`,
    subAgentPolicy.state === "active"
      ? `Active sub-agent policy (${subAgentPolicy.activePolicyRef.digest}) resolves ${policyBindings.join("; ")}; its policy concurrency limit is ${subAgentPolicy.maxActiveChildren || "the runtime limit"}. Normally request a child by role and task and omit governed realization knobs so the harness inherits them mechanically.`
      : "No active sub-agent policy is settled for this task or project. Child launch is blocked: ask the user to establish the worker roles, provider/model/effort, context handoff, and realization policy instead of inventing defaults.",
    subAgentPolicy.latestSemanticSettlement?.state === "clarification_required"
      ? `The policy router requires clarification: ${subAgentPolicy.latestSemanticSettlement.clarificationQuestion}`
      : "Any explicit launch mismatch requires a semantic reason and either a one-time-exception disposition or a separately admitted permanent policy update; never silently override policy.",
    subAgentPolicy.pendingUpdateRequestCount
      ? `${subAgentPolicy.pendingUpdateRequestCount} candidate sub-agent policy revision request(s) await separate admission and grant no launch authority.`
      : "No candidate sub-agent policy revision is currently projected.",
    `Use ${DIRECT_SELF_CONSTITUTION_TOOL_NAME} to refresh this owner-issued projection when the user asks about your current role, workspace, tools, providers, context, authority, or delegation capacity.`,
    "Do not reconstruct current self-knowledge from generic prompt prose when it conflicts with this snapshot.",
  ].join(" ");
}

function buildSelfConstitutionResultEnvelope(snapshot = {}, input = {}) {
  const errors = validateDirectSelfConstitutionSnapshot(snapshot);
  if (errors.length) {
    const error = new Error(`Direct self constitution is invalid: ${errors.join(", ")}`);
    error.code = "direct_self_constitution_invalid";
    throw error;
  }
  const providerOutput = {
    kind: "inspect_self_constitution_result",
    status: "completed",
    snapshot,
    interpretationLaw: {
      snapshotIsOwnerIssued: true,
      potentialDoesNotImplySelected: true,
      selectedDoesNotImplyAuthorized: true,
      authorizedDoesNotImplyExecuted: true,
      historicalPromptProseIsNotCurrentAuthority: true,
    },
  };
  const envelope = {
    schema: "direct_self_constitution_result_envelope@1",
    envelopeId: `self_constitution_result_${snapshot.digest.slice(7, 31)}`,
    toolName: DIRECT_SELF_CONSTITUTION_TOOL_NAME,
    callId: normalizeString(input.callId, ""),
    resultKind: "self_constitution_snapshot",
    status: "ready_for_provider_continuation",
    providerOutput,
    sideEffectExecuted: false,
    semanticEffectRecorded: false,
    canonicalEffect: false,
    contextAdmission: {
      admittedAs: "owner_issued_self_constitution_projection",
      admissionState: "admitted",
      readOnly: true,
      grantsAuthority: false,
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.envelopeDigest = digestFor(
    "direct-self-constitution-result-envelope@1",
    envelope,
  );
  return envelope;
}

module.exports = {
  DIRECT_SELF_CONSTITUTION_SNAPSHOT_SCHEMA,
  DIRECT_SELF_CONSTITUTION_TOOL_NAME,
  buildSelfConstitutionResultEnvelope,
  compileDirectSelfConstitutionSnapshot,
  renderDirectSelfConstitutionInstructions,
  validateDirectSelfConstitutionSnapshot,
};
