"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const {
  buildToolCapabilityRegistry,
  validateToolCapabilityRegistry,
} = require("../bridge/tool-capability-registry");
const {
  validateDirectEnvironmentTopology,
  validateTopologyCompatibility,
  validateTurnExecutionEnvironment,
} = require("./environment-topology");

const DIRECT_ENVIRONMENT_AWARE_TOOL_CATALOG_SCHEMA = "direct_environment_aware_tool_catalog@1";
const DIRECT_ENVIRONMENT_TOOL_ROUTE_ROW_SCHEMA = "direct_environment_tool_route_row@1";

const ENVIRONMENT_TOOL_ROUTE_CLASSES = Object.freeze([
  "same_environment",
  "cross_environment_tool_session",
  "specialist_worker_required",
  "unsupported_environment",
]);

const ENVIRONMENT_TOOL_ROUTE_STATUSES = Object.freeze([
  "route_available",
  "manager_route_required",
  "remand_required",
  "unsupported",
]);

const ENVIRONMENT_TOOL_ACTION_CLASSES = Object.freeze([
  "local_workspace_action",
  "windows_browser_action",
  "provider_hosted_action",
  "external_service_action",
  "agent_runtime_action",
  "session_control_action",
  "unknown_action",
]);

const OWNER_SOURCES = Object.freeze([
  "tool_route_hint",
  "tool_catalog_row",
  "topology_tool_family",
  "resident_environment_default",
  "unknown",
]);

const DIGEST_FIELDS = new Set([
  "catalogDigest",
  "rowDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_environment_tool_catalog_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_environment_tool_catalog_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_environment_tool_catalog_missing_array", label);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_FIELDS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function validateDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== digestFor(domain, value)) {
    throw validationError("direct_environment_tool_catalog_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function refFrom(kind, id, digest, label, extra = {}) {
  return {
    kind: normalizeString(kind, "unknown"),
    id: normalizeString(id, ""),
    digest: normalizeString(digest, ""),
    label: normalizeString(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    ...extra,
  };
}

function validateRef(ref, label, options = {}) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  if (options.requireId !== false) requireString(ref.id, `${label}.id`);
  if (options.requireDigest !== false) requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded === true || ref.rawPathIncluded === true || ref.rawSecretIncluded === true) {
    throw validationError("direct_environment_tool_catalog_raw_ref_exposure", label);
  }
  return true;
}

function toolKeys(row = {}) {
  return normalizeList([
    row.toolId,
    row.displayName,
    row.odeuFamily,
    ...(Array.isArray(row.vanillaNames) ? row.vanillaNames : []),
    ...(Array.isArray(row.directNames) ? row.directNames : []),
  ]);
}

function buildHintIndex(hints = []) {
  const byKey = new Map();
  for (const hint of Array.isArray(hints) ? hints : []) {
    if (!isPlainObject(hint)) continue;
    for (const key of normalizeList([
      hint.toolId,
      hint.toolName,
      hint.displayName,
      hint.odeuFamily,
      ...(Array.isArray(hint.aliases) ? hint.aliases : []),
    ])) {
      if (!byKey.has(key)) byKey.set(key, hint);
    }
  }
  return byKey;
}

function environmentById(topology = {}, environmentId = "") {
  return (Array.isArray(topology.environments) ? topology.environments : [])
    .find((environment) => environment.environmentId === environmentId) || null;
}

function environmentRef(topology = {}, environmentId = "") {
  const environment = environmentById(topology, environmentId);
  if (!environment) return null;
  return refFrom("direct_environment", environment.environmentId, environment.environmentDigest, environment.displayLabel, {
    environmentKind: environment.environmentKind,
  });
}

function topologyRef(topology = {}) {
  return refFrom("direct_environment_topology", topology.topologyId, topology.topologyDigest, "Direct environment topology", {
    revision: Number(topology.revision || 0),
  });
}

function capabilityRegistryRef(registry = {}) {
  return refFrom("direct_tool_capability_registry", registry.registryId, registry.registryDigest, "Direct tool capability registry", {
    rowCount: Number(registry.rowCount || 0),
  });
}

function topologyCompatibilityRef(compatibility = {}) {
  return refFrom("environment_topology_compatibility", compatibility.expectedTopologyId || compatibility.currentTopologyId, compatibility.compatibilityDigest, `Topology compatibility: ${compatibility.compatibility || "unknown"}`, {
    routeMayProceed: compatibility.routeMayProceed === true,
    requiresRemand: compatibility.requiresRemand === true,
  });
}

function rowCapabilityRef(row = {}) {
  return refFrom("direct_tool_capability_row", row.toolId, row.rowDigest, row.displayName || row.toolId, {
    odeuFamily: normalizeString(row.odeuFamily, ""),
  });
}

function mappingBetween(topology = {}, fromEnvironmentId = "", toEnvironmentId = "") {
  return (Array.isArray(topology.mappings) ? topology.mappings : [])
    .find((mapping) => {
      const forward = mapping.fromEnvironmentId === fromEnvironmentId && mapping.toEnvironmentId === toEnvironmentId;
      const reverse = mapping.direction === "two_way" && mapping.fromEnvironmentId === toEnvironmentId && mapping.toEnvironmentId === fromEnvironmentId;
      return (forward || reverse) && mapping.readAllowed !== false;
    }) || null;
}

function mappingRef(mapping = null) {
  if (!mapping) return null;
  return refFrom("direct_environment_path_mapping", mapping.mappingId, mapping.mappingDigest, mapping.mappingKind, {
    readAllowed: mapping.readAllowed !== false,
    writeAllowed: mapping.writeAllowed === true,
  });
}

function actionClassFor(row = {}, hint = {}) {
  const explicit = normalizeString(hint.actionClass, "") || normalizeString(hint.environmentActionClass, "") || normalizeString(row.environmentActionClass, "") || normalizeString(row.actionClass, "");
  if (ENVIRONMENT_TOOL_ACTION_CLASSES.includes(explicit)) return explicit;
  const family = normalizeString(row.odeuFamily, "");
  if (family === "workspace_process_authority" || family === "local_perception") return "local_workspace_action";
  if (family === "provider_hosted_tools") return "provider_hosted_action";
  if (family === "external_capability_discovery" || family === "external_resource_action_authority") return "external_service_action";
  if (family === "agent_runtime" || family === "batch_agent_orchestration") return "agent_runtime_action";
  if (family === "session_control_state" || family === "human_authority_bridge") return "session_control_action";
  return "unknown_action";
}

function topologyToolFamilyOwner(topology = {}, row = {}) {
  const keys = new Set(toolKeys(row));
  for (const environment of Array.isArray(topology.environments) ? topology.environments : []) {
    for (const ref of Array.isArray(environment.availableToolFamilyRefs) ? environment.availableToolFamilyRefs : []) {
      if (keys.has(normalizeString(ref.id, "")) || keys.has(normalizeString(ref.label, ""))) {
        return environment.environmentId;
      }
    }
  }
  return "";
}

function ownerFor({ row = {}, hint = null, topology = {}, turnEnvironment = {} } = {}) {
  const hintOwner = normalizeString(hint?.ownerEnvironmentId, "") || normalizeString(hint?.environmentOwnerId, "");
  if (hintOwner) {
    const ownerSource = hint?.ownerSource === "tool_catalog_row" ? "tool_catalog_row" : "tool_route_hint";
    return { ownerEnvironmentId: hintOwner, ownerSource };
  }
  const rowOwner = normalizeString(row.ownerEnvironmentId, "") || normalizeString(row.environmentOwnerId, "");
  if (rowOwner) return { ownerEnvironmentId: rowOwner, ownerSource: "tool_catalog_row" };
  const topologyOwner = topologyToolFamilyOwner(topology, row);
  if (topologyOwner) return { ownerEnvironmentId: topologyOwner, ownerSource: "topology_tool_family" };
  const residentOwner = normalizeString(turnEnvironment.residentEnvironmentId, "") || normalizeString(topology.defaultEnvironmentId, "");
  if (residentOwner) return { ownerEnvironmentId: residentOwner, ownerSource: "resident_environment_default" };
  return { ownerEnvironmentId: "", ownerSource: "unknown" };
}

function routePreferenceFor(row = {}, hint = {}) {
  return normalizeString(hint.routeClass || hint.preferredRouteClass || hint.environmentRouteClass || row.environmentRouteClass || row.preferredRouteClass, "");
}

function explanationFor({ row = {}, routeClass = "", routeStatus = "", ownerRef = null, residentRef = null, blockers = [] } = {}) {
  const toolName = normalizeString(row.displayName || row.toolId, "tool");
  const owner = normalizeString(ownerRef?.label, "unknown environment");
  const resident = normalizeString(residentRef?.label, "resident environment");
  if (blockers.includes("environment_topology_missing")) return `${toolName} cannot be environment-routed until the active environment topology is loaded.`;
  if (blockers.includes("turn_environment_missing")) return `${toolName} cannot be environment-routed until the turn execution environment is known.`;
  if (blockers.includes("environment_topology_requires_remand")) return `${toolName} needs a refreshed environment topology before routing.`;
  if (routeClass === "same_environment") return `${toolName} belongs to ${resident}; it can be requested in the resident environment, but per-call authority still applies.`;
  if (routeClass === "cross_environment_tool_session") return `${toolName} belongs to ${owner}; use a bounded cross-environment tool session from ${resident}. This does not grant workspace mutation authority.`;
  if (routeClass === "specialist_worker_required") return `${toolName} belongs to ${owner}; delegate to a specialist worker rather than switching the resident agent.`;
  if (routeStatus === "unsupported") return `${toolName} cannot be routed from ${resident} to ${owner} with the current topology.`;
  return `${toolName} has unknown environment routing; refresh topology before use.`;
}

function buildRouteRow({ row = {}, hint = null, topology = null, turnEnvironment = null, topologyCompatibility = null, registry = {}, now } = {}) {
  const blockers = [];
  if (!topology) blockers.push("environment_topology_missing");
  if (!turnEnvironment) blockers.push("turn_environment_missing");
  if (topologyCompatibility?.requiresRemand === true) blockers.push("environment_topology_requires_remand");

  const residentEnvironmentId = normalizeString(turnEnvironment?.residentEnvironmentId, "") || normalizeString(topology?.defaultEnvironmentId, "");
  const { ownerEnvironmentId, ownerSource } = ownerFor({ row, hint, topology: topology || {}, turnEnvironment: turnEnvironment || {} });
  const ownerEnvironment = topology ? environmentById(topology, ownerEnvironmentId) : null;
  const residentEnvironment = topology ? environmentById(topology, residentEnvironmentId) : null;
  if (topology && (!ownerEnvironmentId || !ownerEnvironment)) blockers.push("owner_environment_missing");
  if (topology && (!residentEnvironmentId || !residentEnvironment)) blockers.push("resident_environment_missing");

  const ownerRef = topology ? environmentRef(topology, ownerEnvironmentId) : null;
  const residentRef = topology ? environmentRef(topology, residentEnvironmentId) : null;
  const actionClass = actionClassFor(row, hint || {});
  const preference = routePreferenceFor(row, hint || {});
  const mapping = topology && residentEnvironmentId && ownerEnvironmentId && residentEnvironmentId !== ownerEnvironmentId
    ? mappingBetween(topology, residentEnvironmentId, ownerEnvironmentId)
    : null;

  let routeClass = "unsupported_environment";
  let routeStatus = blockers.length ? "remand_required" : "unsupported";
  if (!blockers.length && ownerEnvironmentId === residentEnvironmentId) {
    routeClass = "same_environment";
    routeStatus = "route_available";
  } else if (!blockers.length && preference === "specialist_worker_required") {
    routeClass = "specialist_worker_required";
    routeStatus = "manager_route_required";
  } else if (!blockers.length && preference === "cross_environment_tool_session" && mapping) {
    routeClass = "cross_environment_tool_session";
    routeStatus = "manager_route_required";
  } else if (!blockers.length && mapping) {
    routeClass = actionClass === "windows_browser_action" ? "specialist_worker_required" : "cross_environment_tool_session";
    routeStatus = "manager_route_required";
  } else if (!blockers.length) {
    blockers.push("environment_route_unavailable");
  }

  const sourceRefs = [
    capabilityRegistryRef(registry),
    rowCapabilityRef(row),
  ];
  if (topology) sourceRefs.push(topologyRef(topology));
  if (topologyCompatibility) sourceRefs.push(topologyCompatibilityRef(topologyCompatibility));
  const routeMappingRef = mappingRef(mapping);
  if (routeMappingRef) sourceRefs.push(routeMappingRef);

  const routeRow = {
    schema: DIRECT_ENVIRONMENT_TOOL_ROUTE_ROW_SCHEMA,
    rowId: `direct_environment_tool_route_row_${digestFor("direct-environment-tool-route-row-id@1", {
      toolId: row.toolId,
      ownerEnvironmentId,
      residentEnvironmentId,
      routeClass,
      topologyDigest: topology?.topologyDigest,
    }).slice(7, 31)}`,
    toolId: normalizeString(row.toolId, "unknown_tool"),
    displayName: normalizeString(row.displayName || row.toolId, "Tool"),
    odeuFamily: normalizeString(row.odeuFamily, "unknown"),
    actionClass,
    ownerEnvironmentId: normalizeString(ownerEnvironmentId, ""),
    ownerSource: pickEnum(ownerSource, OWNER_SOURCES, "unknown"),
    ownerEnvironmentRef: ownerRef || refFrom("direct_environment", ownerEnvironmentId, "", ownerEnvironmentId || "unknown environment"),
    residentEnvironmentRef: residentRef || refFrom("direct_environment", residentEnvironmentId, "", residentEnvironmentId || "unknown resident environment"),
    routeClass,
    routeStatus,
    routeMayProceed: routeStatus === "route_available" || routeStatus === "manager_route_required",
    perCallAuthorityRequired: true,
    environmentRouteGrantsAuthority: false,
    providerDeclarationEnabledInThisPr: false,
    localExecutionEnabledInThisPr: false,
    workspaceMutationAuthorized: false,
    blockerCodes: normalizeList(blockers),
    residentCapabilityExplanation: explanationFor({ row, routeClass, routeStatus, ownerRef, residentRef, blockers }),
    sourceRefs,
    rawTopologyPayloadIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(nowIso(now), nowIso()),
  };
  if (routeMappingRef) routeRow.environmentPathMappingRef = routeMappingRef;
  routeRow.rowDigest = digestFor("direct-environment-tool-route-row@1", routeRow);
  return routeRow;
}

function buildEnvironmentAwareToolCatalog(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const capabilityRegistry = isPlainObject(source.capabilityRegistry)
    ? source.capabilityRegistry
    : buildToolCapabilityRegistry(source.capabilityRegistryInput || source);
  validateToolCapabilityRegistry(capabilityRegistry);

  const topology = source.topology || source.environmentTopology || null;
  if (topology) validateDirectEnvironmentTopology(topology);
  const turnEnvironment = source.turnEnvironment || source.turnExecutionEnvironment || null;
  if (turnEnvironment) validateTurnExecutionEnvironment(turnEnvironment);
  const topologyCompatibility = source.topologyCompatibility || null;
  if (topologyCompatibility) validateTopologyCompatibility(topologyCompatibility);

  const registryInputRows = Array.isArray(source.capabilityRegistryInput?.rows)
    ? source.capabilityRegistryInput.rows
    : Array.isArray(source.rows)
      ? source.rows
      : [];
  const routeHints = [
    ...registryInputRows.filter(isPlainObject).map((row) => ({ ...row, ownerSource: "tool_catalog_row" })),
    ...(Array.isArray(source.environmentOwnerHints) ? source.environmentOwnerHints : []),
    ...(Array.isArray(source.toolEnvironmentRoutes) ? source.toolEnvironmentRoutes : []),
    ...(Array.isArray(source.routeHints) ? source.routeHints : []),
  ];
  const hints = buildHintIndex(routeHints);
  const routeRows = (Array.isArray(capabilityRegistry.rows) ? capabilityRegistry.rows : [])
    .map((row) => buildRouteRow({
      row,
      hint: toolKeys(row).map((key) => hints.get(key)).find(Boolean) || null,
      topology,
      turnEnvironment,
      topologyCompatibility,
      registry: capabilityRegistry,
      now: options.now || source.now,
    }));

  const byRouteClass = ENVIRONMENT_TOOL_ROUTE_CLASSES.reduce((acc, routeClass) => {
    const count = routeRows.filter((row) => row.routeClass === routeClass).length;
    if (count) acc[routeClass] = count;
    return acc;
  }, {});

  const catalog = {
    schema: DIRECT_ENVIRONMENT_AWARE_TOOL_CATALOG_SCHEMA,
    catalogId: normalizeId(source.catalogId, "direct_environment_aware_tool_catalog"),
    projectId: normalizeString(source.projectId, capabilityRegistry.projectId || topology?.projectId || ""),
    workThreadId: normalizeString(source.workThreadId, capabilityRegistry.workThreadId || turnEnvironment?.workThreadId || ""),
    capabilityRegistryRef: capabilityRegistryRef(capabilityRegistry),
    topologyRef: topology ? topologyRef(topology) : refFrom("direct_environment_topology", "", "", "Missing environment topology"),
    turnEnvironmentRef: refFrom(
      "turn_execution_environment",
      turnEnvironment?.turnId,
      turnEnvironment?.turnEnvironmentDigest,
      "Turn execution environment",
      { residentEnvironmentId: normalizeString(turnEnvironment?.residentEnvironmentId, "") },
    ),
    routeRows,
    byRouteClass,
    rowCount: routeRows.length,
    residentExplanationSummary: routeRows.some((row) => row.blockerCodes.includes("environment_topology_requires_remand"))
      ? "Environment-aware tool routes need topology refresh before routed actions."
      : "Environment-aware tool routes explain where tools live; authority remains per call.",
    catalogGrantsAuthority: false,
    providerDeclarationEnabledInThisPr: false,
    localExecutionEnabledInThisPr: false,
    workspaceMutationAuthorized: false,
    rawTopologyPayloadIncluded: false,
    rawToolPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
  };
  if (topologyCompatibility) catalog.topologyCompatibilityRef = topologyCompatibilityRef(topologyCompatibility);
  catalog.catalogDigest = digestFor("direct-environment-aware-tool-catalog@1", catalog);
  return catalog;
}

function validateEnvironmentAwareToolCatalog(catalog = {}) {
  requirePlainObject(catalog, "environmentAwareToolCatalog");
  if (catalog.schema !== DIRECT_ENVIRONMENT_AWARE_TOOL_CATALOG_SCHEMA) {
    throw validationError("direct_environment_tool_catalog_schema_mismatch", "environmentAwareToolCatalog");
  }
  requireString(catalog.catalogId, "environmentAwareToolCatalog.catalogId");
  validateRef(catalog.capabilityRegistryRef, "environmentAwareToolCatalog.capabilityRegistryRef", { requireDigest: false });
  validateRef(catalog.topologyRef, "environmentAwareToolCatalog.topologyRef", { requireId: false, requireDigest: false });
  validateRef(catalog.turnEnvironmentRef, "environmentAwareToolCatalog.turnEnvironmentRef", { requireId: false, requireDigest: false });
  if (catalog.topologyCompatibilityRef) validateRef(catalog.topologyCompatibilityRef, "environmentAwareToolCatalog.topologyCompatibilityRef", { requireId: false });
  requireArray(catalog.routeRows, "environmentAwareToolCatalog.routeRows");
  if (catalog.routeRows.length !== Number(catalog.rowCount)) {
    throw validationError("direct_environment_tool_catalog_row_count_mismatch", "environmentAwareToolCatalog.rowCount");
  }
  for (const row of catalog.routeRows) {
    requirePlainObject(row, "environmentAwareToolCatalog.routeRows.item");
    if (row.schema !== DIRECT_ENVIRONMENT_TOOL_ROUTE_ROW_SCHEMA) {
      throw validationError("direct_environment_tool_catalog_row_schema_mismatch", row.rowId || "");
    }
    requireString(row.rowId, "environmentAwareToolCatalog.routeRows.item.rowId");
    requireString(row.toolId, "environmentAwareToolCatalog.routeRows.item.toolId");
    if (!ENVIRONMENT_TOOL_ACTION_CLASSES.includes(row.actionClass)) {
      throw validationError("direct_environment_tool_catalog_invalid_action_class", row.toolId);
    }
    if (!ENVIRONMENT_TOOL_ROUTE_CLASSES.includes(row.routeClass)) {
      throw validationError("direct_environment_tool_catalog_invalid_route_class", row.toolId);
    }
    if (!ENVIRONMENT_TOOL_ROUTE_STATUSES.includes(row.routeStatus)) {
      throw validationError("direct_environment_tool_catalog_invalid_route_status", row.toolId);
    }
    if (!OWNER_SOURCES.includes(row.ownerSource)) {
      throw validationError("direct_environment_tool_catalog_invalid_owner_source", row.toolId);
    }
    validateRef(row.ownerEnvironmentRef, "environmentAwareToolCatalog.routeRows.item.ownerEnvironmentRef", { requireId: false, requireDigest: false });
    validateRef(row.residentEnvironmentRef, "environmentAwareToolCatalog.routeRows.item.residentEnvironmentRef", { requireId: false, requireDigest: false });
    if (row.environmentPathMappingRef) {
      validateRef(row.environmentPathMappingRef, "environmentAwareToolCatalog.routeRows.item.environmentPathMappingRef", { requireDigest: false });
    }
    requireArray(row.blockerCodes, "environmentAwareToolCatalog.routeRows.item.blockerCodes");
    requireString(row.residentCapabilityExplanation, "environmentAwareToolCatalog.routeRows.item.residentCapabilityExplanation");
    requireArray(row.sourceRefs, "environmentAwareToolCatalog.routeRows.item.sourceRefs");
    for (const ref of row.sourceRefs) {
      validateRef(ref, "environmentAwareToolCatalog.routeRows.item.sourceRefs.item", { requireId: false, requireDigest: false });
    }
    if (row.routeClass === "unsupported_environment" && row.routeMayProceed === true) {
      throw validationError("direct_environment_tool_catalog_unsupported_route_proceeds", row.toolId);
    }
    if (row.environmentRouteGrantsAuthority !== false || row.providerDeclarationEnabledInThisPr !== false || row.localExecutionEnabledInThisPr !== false || row.workspaceMutationAuthorized !== false) {
      throw validationError("direct_environment_tool_catalog_authority_leak", row.toolId);
    }
    if (row.rawTopologyPayloadIncluded === true || row.rawToolPayloadIncluded === true || row.rawTextIncluded === true || row.rawPathIncluded === true || row.rawSecretIncluded === true) {
      throw validationError("direct_environment_tool_catalog_raw_row_exposure", row.toolId);
    }
    validateDigest(row, "rowDigest", "direct-environment-tool-route-row@1", "environmentAwareToolCatalog.routeRows.item");
  }
  if (catalog.catalogGrantsAuthority !== false || catalog.providerDeclarationEnabledInThisPr !== false || catalog.localExecutionEnabledInThisPr !== false || catalog.workspaceMutationAuthorized !== false) {
    throw validationError("direct_environment_tool_catalog_authority_leak", "environmentAwareToolCatalog");
  }
  if (catalog.rawTopologyPayloadIncluded === true || catalog.rawToolPayloadIncluded === true || catalog.rawTextIncluded === true || catalog.rawPathIncluded === true || catalog.rawSecretIncluded === true) {
    throw validationError("direct_environment_tool_catalog_raw_exposure", "environmentAwareToolCatalog");
  }
  validateDigest(catalog, "catalogDigest", "direct-environment-aware-tool-catalog@1", "environmentAwareToolCatalog");
  return true;
}

module.exports = {
  DIRECT_ENVIRONMENT_AWARE_TOOL_CATALOG_SCHEMA,
  DIRECT_ENVIRONMENT_TOOL_ROUTE_ROW_SCHEMA,
  ENVIRONMENT_TOOL_ACTION_CLASSES,
  ENVIRONMENT_TOOL_ROUTE_CLASSES,
  ENVIRONMENT_TOOL_ROUTE_STATUSES,
  buildEnvironmentAwareToolCatalog,
  validateEnvironmentAwareToolCatalog,
};
