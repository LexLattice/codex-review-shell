"use strict";

const crypto = require("node:crypto");

const DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA = "direct_thread_intake_projection@1";
const DIRECT_THREAD_INTAKE_LINEAGE_SCHEMA = "direct_thread_intake_lineage@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  }
  if (!isPlainObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeString(value, "")).filter(Boolean))];
}

function projectSubstrateBinding(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  const workspaceKind = ["wsl", "windows", "local"].includes(workspace.kind)
    ? workspace.kind
    : "unknown";
  const environmentId = workspaceKind === "wsl"
    ? "env_wsl_native"
    : workspaceKind === "windows"
      ? "env_windows_native"
      : workspaceKind === "local"
        ? "env_local_native"
        : "environment_unknown";
  const displayLabel = normalizeString(
    workspace.label,
    workspaceKind === "wsl"
      ? "WSL workspace"
      : workspaceKind === "windows"
        ? "Windows workspace"
        : workspaceKind === "local"
          ? "Local workspace"
          : "Workspace unavailable",
  );
  return {
    projectId: normalizeString(project.id, ""),
    workspaceKind,
    environmentId,
    displayLabel,
    bindingScope: "project_default",
    inheritedByFreshThread: true,
    operatorMutableInThisAction: false,
    rawPathExposed: false,
  };
}

function normalizeSource(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    sourceState: normalizeString(source.sourceState, "unselected"),
    importId: normalizeString(source.importId, ""),
    handleId: normalizeString(source.handleId, ""),
    sourceClass: normalizeString(source.sourceClass, "codex-cli-jsonl"),
    sourceDisplayName: normalizeString(source.sourceDisplayName, "No source selected"),
    sourceRootDisplayName: normalizeString(source.sourceRootDisplayName, ""),
    providerThreadId: normalizeString(source.providerThreadId || source.threadId, ""),
    timestampStart: normalizeString(source.timestampStart, ""),
    timestampEnd: normalizeString(source.timestampEnd, ""),
    recordCount: Number(source.recordCount || 0),
    importState: normalizeString(source.importState || source.state, ""),
    recoveryState: normalizeString(source.recoveryState, ""),
    materializedSessionId: normalizeString(source.materializedSessionId, ""),
    checkpointEligible: source.checkpointEligible === true,
    duplicateMatched: source.duplicateMatched === true,
    rawPathExposed: false,
    rawRecordsExposed: false,
    rawSourceSha256Exposed: false,
  };
}

function normalizeRuntimeWitness(input = {}) {
  const runtime = isPlainObject(input) ? input : {};
  const transport = normalizeString(runtime.transport, "unavailable");
  return {
    transport,
    runtimePath: normalizeString(runtime.runtimePath, transport === "codex-app-server" ? "app-server" : transport),
    projectBound: runtime.projectBound === true,
    providerResumeCapability: runtime.providerResumeCapability === true,
    providerReadCapability: runtime.providerReadCapability === true,
    freshDirectCapability: runtime.freshDirectCapability === true,
    evidenceState: normalizeString(runtime.evidenceState, "unknown"),
  };
}

function actionProjection({
  kind,
  enabled,
  blockers,
  identityDisposition,
  effect,
  runtimeVerification,
  evidenceRefs,
}) {
  const blockerCodes = uniqueStrings(blockers);
  return {
    kind,
    enabled: enabled === true && blockerCodes.length === 0,
    state: enabled === true && blockerCodes.length === 0 ? "eligible" : "blocked",
    blockerCodes,
    identityDisposition,
    effect,
    runtimeVerification,
    evidenceRefs: uniqueStrings(evidenceRefs),
    createsCanonicalWorldState: false,
    grantsImportedAuthority: false,
  };
}

function buildDirectThreadIntakeProjection(input = {}) {
  const project = isPlainObject(input.project) ? input.project : {};
  const source = normalizeSource(input.source);
  const runtime = normalizeRuntimeWitness(input.runtime);
  const substrate = projectSubstrateBinding(project);
  const workspaceMatch = isPlainObject(input.workspaceMatch) ? input.workspaceMatch : {};
  const workspaceMatched = workspaceMatch.status === "matched" &&
    (workspaceMatch.confidence === "high" || workspaceMatch.matchMethod === "user-confirmed");

  const resumeBlockers = [];
  if (!source.providerThreadId) resumeBlockers.push("provider_thread_identity_missing");
  if (!runtime.projectBound) resumeBlockers.push("runtime_project_binding_unproven");
  if (runtime.transport !== "codex-app-server") resumeBlockers.push("app_server_runtime_required");
  if (!runtime.providerResumeCapability) resumeBlockers.push("provider_resume_capability_unavailable");

  const freshBlockers = [];
  if (!source.importId || !source.materializedSessionId) freshBlockers.push("read_only_import_required");
  if (source.importState !== "checkpoint-validated") freshBlockers.push("checkpoint_validation_required");
  if (!workspaceMatched) freshBlockers.push("workspace_match_required");
  if (!runtime.projectBound) freshBlockers.push("runtime_project_binding_unproven");
  if (!runtime.freshDirectCapability) freshBlockers.push("direct_runtime_required");
  if (normalizeString(input.freshContinuationBlockReason, "")) {
    freshBlockers.push(input.freshContinuationBlockReason);
  }

  const projection = {
    schema: DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA,
    generatedAt: normalizeString(input.generatedAt, new Date().toISOString()),
    projectId: normalizeString(project.id, ""),
    controlPlane: "direct-thread",
    interactionLaw: "operator_selects_identity_disposition",
    source,
    projectSubstrateBinding: substrate,
    workspaceMatch: {
      status: normalizeString(workspaceMatch.status, "unknown"),
      confidence: normalizeString(workspaceMatch.confidence, "none"),
      matchMethod: normalizeString(workspaceMatch.matchMethod, "none"),
      matched: workspaceMatched,
      rawPathExposed: false,
    },
    runtime,
    modes: {
      resumeOriginalThread: actionProjection({
        kind: "resume_original_thread",
        enabled: true,
        blockers: resumeBlockers,
        identityDisposition: "preserve_provider_thread_identity",
        effect: "attach_to_existing_provider_thread",
        runtimeVerification: "provider_verifies_thread_on_execution",
        evidenceRefs: [
          source.providerThreadId ? "source_provider_thread_id" : "",
          runtime.providerResumeCapability ? "active_runtime_thread_resume_capability" : "",
        ],
      }),
      continueInFreshDirectThread: actionProjection({
        kind: "transplant_into_fresh_direct_thread",
        enabled: true,
        blockers: freshBlockers,
        identityDisposition: "create_new_direct_thread_identity",
        effect: "compile_imported_transcript_as_non_authoritative_context",
        runtimeVerification: "direct_checkpoint_request_shape_prevalidated",
        evidenceRefs: [
          source.importId ? "materialized_import_lineage" : "",
          source.importState === "checkpoint-validated" ? "checkpoint_validation_report" : "",
          workspaceMatched ? "workspace_match_witness" : "",
          runtime.freshDirectCapability ? "active_direct_runtime_capability" : "",
        ],
      }),
    },
    authorityBoundary: {
      importedApprovalsCarryAuthority: false,
      importedToolCallsReplayable: false,
      importedSystemDeveloperPolicyAuthoritative: false,
      sourceTranscriptRemainsReadOnly: true,
      worldManagerAdmissionPerformed: false,
    },
    rawPathExposed: false,
    rawRecordsExposed: false,
    rawSourceSha256Exposed: false,
  };
  projection.projectionDigest = digest(projection);
  assertDirectThreadIntakeProjectionSafe(projection);
  return projection;
}

function buildDirectThreadIntakeLineage(projection = {}, mode = "transplant_into_fresh_direct_thread") {
  if (projection.schema !== DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA) {
    throw new Error("direct_thread_intake_projection_required");
  }
  const action = mode === "resume_original_thread"
    ? projection.modes?.resumeOriginalThread
    : projection.modes?.continueInFreshDirectThread;
  if (!action?.enabled) {
    const error = new Error(`direct_thread_intake_mode_blocked:${mode}`);
    error.code = action?.blockerCodes?.[0] || "direct_thread_intake_mode_blocked";
    throw error;
  }
  const lineage = {
    schema: DIRECT_THREAD_INTAKE_LINEAGE_SCHEMA,
    mode,
    projectId: projection.projectId,
    source: {
      importId: projection.source.importId,
      materializedSessionId: projection.source.materializedSessionId,
      providerThreadId: projection.source.providerThreadId,
      sourceClass: projection.source.sourceClass,
      sourceDisplayName: projection.source.sourceDisplayName,
    },
    identityDisposition: action.identityDisposition,
    projectSubstrateBinding: projection.projectSubstrateBinding,
    importedAuthorityInherited: false,
    sourceTranscriptRemainsReadOnly: true,
    projectionDigest: projection.projectionDigest,
  };
  lineage.lineageDigest = digest(lineage);
  return lineage;
}

function assertDirectThreadIntakeProjectionSafe(projection = {}) {
  if (projection.schema !== DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA) {
    throw new Error("direct_thread_intake_projection_schema_mismatch");
  }
  if (projection.controlPlane !== "direct-thread") {
    throw new Error("direct_thread_intake_control_plane_mismatch");
  }
  if (projection.rawPathExposed || projection.rawRecordsExposed || projection.rawSourceSha256Exposed) {
    throw new Error("direct_thread_intake_raw_source_exposure");
  }
  if (projection.source?.rawPathExposed || projection.source?.rawRecordsExposed || projection.source?.rawSourceSha256Exposed) {
    throw new Error("direct_thread_intake_source_exposure");
  }
  if (projection.projectSubstrateBinding?.rawPathExposed) {
    throw new Error("direct_thread_intake_substrate_path_exposure");
  }
  if (projection.authorityBoundary?.importedApprovalsCarryAuthority !== false ||
      projection.authorityBoundary?.importedToolCallsReplayable !== false ||
      projection.authorityBoundary?.worldManagerAdmissionPerformed !== false) {
    throw new Error("direct_thread_intake_authority_inflation");
  }
  return true;
}

module.exports = {
  DIRECT_THREAD_INTAKE_LINEAGE_SCHEMA,
  DIRECT_THREAD_INTAKE_PROJECTION_SCHEMA,
  assertDirectThreadIntakeProjectionSafe,
  buildDirectThreadIntakeLineage,
  buildDirectThreadIntakeProjection,
  projectSubstrateBinding,
};
