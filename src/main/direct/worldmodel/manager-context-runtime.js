"use strict";

// This is a deliberately small local-runtime integration, not a generic
// request provider registry.  The harness installs one closure over an
// authoritative trust-store handle and a graph identity; context requests can
// only select that installed closure.  They cannot provide a graph, registry,
// store, admission, or provider implementation of their own.
const {
  buildGraphOdeuCompilation,
  buildManagerGraphFirstContextAdapter,
} = require("./manager-turn-context");
const {
  readAuthoritativeWorldmodelGraph,
} = require("./governance-trust-store");

const HEADLESS_CURRENT_GRAPH_PROVIDER_ID = "headless_current_graph";
let headlessCurrentGraphProvider = null;

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : ""; }
function object(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function sameGraph(left, right) { return left?.graphId === right?.graphId && left?.digest === right?.digest; }

// Kept as an explicit compatibility-only registration surface.  Direct
// context builds never consult it: a request-selected provider is not a
// current-graph authority source.
const providers = new Map();
function registerManagerGraphContextProvider(providerId, provider) {
  const id = text(providerId);
  if (!id || !provider || typeof provider.resolveManagerGraphContext !== "function") fail("direct_manager_runtime_provider_invalid", id || "provider");
  providers.set(id, provider);
  return { providerId: id, registered: true, providerRegistry: "direct_manager_graph_context_runtime@1", consumableByDirectContext: false };
}
function unregisterManagerGraphContextProvider(providerId) { providers.delete(text(providerId)); }

function installHeadlessCurrentGraphContextProvider(input = {}) {
  if (!object(input) || !input.trustStore || !input.graph || typeof input.resolveManagerContext !== "function") {
    fail("direct_manager_runtime_headless_provider_invalid");
  }
  let authoritative;
  try { authoritative = readAuthoritativeWorldmodelGraph(input.trustStore, input.graph); }
  catch (cause) { fail(cause?.code || "direct_manager_runtime_headless_provider_store_invalid"); }
  if (!sameGraph(authoritative.graph, input.graph)) fail("direct_manager_runtime_headless_provider_graph_mismatch");
  headlessCurrentGraphProvider = Object.freeze({
    trustStore: input.trustStore,
    graphId: authoritative.graph.graphId,
    current: authoritative,
    resolveManagerContext: input.resolveManagerContext,
  });
  return {
    providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID,
    graphId: authoritative.graph.graphId,
    graphDigest: authoritative.graph.digest,
    installed: true,
  };
}
function uninstallHeadlessCurrentGraphContextProvider() { headlessCurrentGraphProvider = null; }

function resolveHeadlessCurrentGraphContext(request) {
  const provider = headlessCurrentGraphProvider;
  if (!provider) fail("direct_manager_runtime_headless_provider_unavailable");
  // The only graph supplied to the recipe is freshly read from the pinned
  // handle.  A stale graph, arbitrary registry, or foreign store is never a
  // context request input.
  let authoritative;
  try {
    // `readAuthoritativeWorldmodelGraph` needs the exact anchored graph to
    // prove it is current.  Keep the last trusted graph inside the closure.
    authoritative = provider.current;
    if (!authoritative) fail("direct_manager_runtime_headless_provider_unavailable");
    authoritative = readAuthoritativeWorldmodelGraph(provider.trustStore, authoritative.graph);
  } catch (cause) {
    fail(cause?.code || "direct_manager_runtime_current_graph_unavailable", provider.graphId);
  }
  const resolved = provider.resolveManagerContext({
    projectId: request.projectId,
    threadId: request.threadId,
    turnId: request.turnId,
    graph: authoritative.graph,
    governanceRegistry: authoritative.governanceRegistry,
    registryRef: authoritative.registryRef,
    storeRevision: authoritative.storeRevision,
  });
  if (!object(resolved) || !resolved.bootPacket || !object(resolved.graphContext) || !resolved.storeAdmission) {
    fail("direct_manager_runtime_headless_provider_readback_invalid");
  }
  const supplied = resolved.graphContext;
  if ((supplied.graph && !sameGraph(supplied.graph, authoritative.graph)) ||
      (supplied.governanceRegistry && JSON.stringify(supplied.governanceRegistry) !== JSON.stringify(authoritative.governanceRegistry)) ||
      (supplied.registryRef && JSON.stringify(supplied.registryRef) !== JSON.stringify(authoritative.registryRef))) {
    fail("direct_manager_runtime_headless_provider_substitution");
  }
  return {
    bootPacket: resolved.bootPacket,
    compilationId: text(resolved.compilationId) || `headless_${resolved.bootPacket.bootPacketId}`,
    graphContext: {
      ...supplied,
      graph: authoritative.graph,
      governanceRegistry: authoritative.governanceRegistry,
      registryRef: authoritative.registryRef,
      expectedRegistryRevision: authoritative.governanceRegistry.revision,
      trustStore: provider.trustStore,
      storeAdmission: resolved.storeAdmission,
    },
  };
}

function consumeManagerGraphContextForDirectContext(input = {}) {
  const config = input.managerGraphContextRuntime;
  if (!config || config.enabled !== true) {
    return { active: false, status: "inactive_unconfigured", remainingProductionBoundary: "No harness-owned headless current-graph provider is installed." };
  }
  if (!object(config) || Object.keys(config).some((key) => !["enabled", "providerId"].includes(key))) fail("direct_manager_runtime_configuration_invalid");
  if (text(config.providerId || HEADLESS_CURRENT_GRAPH_PROVIDER_ID) !== HEADLESS_CURRENT_GRAPH_PROVIDER_ID) fail("direct_manager_runtime_provider_substitution_forbidden", text(config.providerId));
  const resolved = resolveHeadlessCurrentGraphContext({ projectId: text(input.projectId), threadId: text(input.threadId), turnId: text(input.turnId) });
  const graphContext = resolved.graphContext;
  const { currentIngress, dialogueFrame, targetedEvidenceInspectionArtifacts, ...compilerContext } = graphContext;
  const compilation = buildGraphOdeuCompilation({ ...compilerContext, compilationId: resolved.compilationId });
  const adapter = buildManagerGraphFirstContextAdapter({ bootPacket: resolved.bootPacket, graphContext: { ...graphContext, compilation } });
  const selected = [...graphContext.graphProjection.selectedNodeRefs, ...graphContext.graphProjection.selectedEdgeRefs]
    .map((ref) => `${ref.kind}:${ref.id}:${ref.digest}`).sort();
  const compiled = compilation.laneEntries.map((entry) => `${entry.ref.kind}:${entry.ref.id}:${entry.ref.digest}`).sort();
  if (!selected.length || selected.length !== compiled.length || selected.some((ref, index) => ref !== compiled[index])) fail("direct_manager_runtime_compilation_readback_mismatch", HEADLESS_CURRENT_GRAPH_PROVIDER_ID);
  const odeuEntries = ["O", "E", "D", "U"].flatMap((laneKey) => compilation.activeInteractionWorldmodel.task[laneKey].entries.map((entry) => ({ laneKey, entryId: entry.entryId, statement: entry.statement, sourceRef: entry.sourceRefs[0] ? { sourceId: entry.sourceRefs[0].sourceId, sourceDigest: entry.sourceRefs[0].sourceDigest?.value } : null })));
  if (odeuEntries.length !== compiled.length || odeuEntries.some((entry) => !entry.sourceRef?.sourceId)) fail("direct_manager_runtime_odeu_materialization_mismatch", HEADLESS_CURRENT_GRAPH_PROVIDER_ID);
  return {
    active: true,
    status: "compiled_and_readback",
    providerId: HEADLESS_CURRENT_GRAPH_PROVIDER_ID,
    adapterRef: { id: adapter.adapterId, digest: adapter.adapterDigest },
    compilationRef: { id: compilation.compilationId, digest: compilation.digest },
    storeAdmissionRef: compilation.storeAdmissionRef,
    bootPacketRef: { id: resolved.bootPacket.bootPacketId, digest: resolved.bootPacket.digest },
    selectedRefs: selected,
    odeuEntries,
    rawTextIncluded: false,
    grantsAuthority: false,
  };
}

module.exports = {
  HEADLESS_CURRENT_GRAPH_PROVIDER_ID,
  registerManagerGraphContextProvider,
  unregisterManagerGraphContextProvider,
  installHeadlessCurrentGraphContextProvider,
  uninstallHeadlessCurrentGraphContextProvider,
  consumeManagerGraphContextForDirectContext,
};
