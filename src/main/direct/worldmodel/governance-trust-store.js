"use strict";

// The local trust store is the Wave 26 authority boundary.  Its public handle
// deliberately carries no state: only a factory/open call can create a branded
// handle and only this module can resolve an anchored graph to that handle.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, sha256 } = require("../meta-session/digest");
const { isPlainObject, normalizeId, normalizeString, nowIso } = require("../meta-session/ids");
const { validateGovernanceProvenanceRegistry, registryRef, requireGovernanceProvenanceAdmission } = require("./governance-provenance-registry");

const DIRECT_WORLDMODEL_TRUST_STORE_SCHEMA = "direct_worldmodel_trust_store@1";
const DIRECT_WORLDMODEL_STORE_ADMISSION_SCHEMA = "direct_worldmodel_store_admission@1";
const STORE_HANDLES = new WeakMap();
const ANCHORED_STORES = new Map();
// These caches deliberately protect the local, single-process custody model.
// They are not a substitute for an external signer or multi-process CAS.  They
// do, however, make a copied directory and a same-process restored old head
// fail closed instead of silently replacing the authority the harness already
// learned about.
const AUTHORITY_LOCATIONS = new Map();
const AUTHORITY_HIGH_WATER = new Map();

function fail(code, detail = "") { const error = new Error(detail ? `${code}:${detail}` : code); error.code = code; throw error; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function digest(domain, value) { return sha256(`${domain}\0${canonicalJson(value)}`); }
function atomic(target, value) { fs.mkdirSync(path.dirname(target), { recursive: true }); const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`); try { fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(tmp, target); } catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; } }
function statePath(directory) { return path.join(directory, "trust-store.json"); }
function revisionPath(directory, revision) { return path.join(directory, "revisions", `${String(revision).padStart(12, "0")}.json`); }
function authorityIdentity() { return `sha256:${crypto.randomBytes(32).toString("hex")}`; }
function anchorKey(anchor) { return `${anchor.storeId}:${anchor.graphId}:${anchor.authorityIdentityDigest}:${anchor.anchorDigest}`; }
function canonicalAuthorityDirectory(directory) {
  if (!normalizeString(directory, "")) fail("direct_worldmodel_trust_store_directory_required");
  fs.mkdirSync(directory, { recursive: true });
  return fs.realpathSync(directory);
}
function authorityDirectoryDigest(directory) { return digest("direct-worldmodel-trust-store-authority-directory@1", { directory }); }
function authorityLocationKey(state) { return `${state.storeId}:${state.authorityIdentityDigest}`; }
function assertAuthorityLocation(directory, state) {
  const expectedDigest = authorityDirectoryDigest(directory);
  if (state.authorityDirectoryDigest !== expectedDigest)
    fail("direct_worldmodel_trust_store_authority_location_mismatch");
  const key = authorityLocationKey(state);
  const existing = AUTHORITY_LOCATIONS.get(key);
  if (existing && (existing.directory !== directory || existing.directoryDigest !== expectedDigest))
    fail("direct_worldmodel_trust_store_authority_location_conflict");
  AUTHORITY_LOCATIONS.set(key, { directory, directoryDigest: expectedDigest });
}
function observeAuthorityHighWater(directory, state) {
  const key = authorityLocationKey(state);
  const observed = AUTHORITY_HIGH_WATER.get(key);
  if (observed) {
    if (state.revision < observed.revision)
      fail("direct_worldmodel_trust_store_rollback_detected", "revision_regressed");
    if (state.revision === observed.revision && state.digest !== observed.digest)
      fail("direct_worldmodel_trust_store_rollback_detected", "revision_equivocation");
  }
  if (!observed || state.revision > observed.revision)
    AUTHORITY_HIGH_WATER.set(key, { revision: state.revision, digest: state.digest, directory });
}
function validateState(state) {
  if (!isPlainObject(state) || state.schema !== DIRECT_WORLDMODEL_TRUST_STORE_SCHEMA || !normalizeString(state.storeId, "") || !/^sha256:[a-f0-9]{64}$/i.test(normalizeString(state.authorityIdentityDigest, "")) || !/^sha256:[a-f0-9]{64}$/i.test(normalizeString(state.authorityDirectoryDigest, "")) || !Number.isInteger(state.revision) || state.revision < 0 || !isPlainObject(state.graphs)) fail("direct_worldmodel_trust_store_invalid");
  if (state.digest !== digest("direct-worldmodel-trust-store@1", { ...state, digest: undefined })) fail("direct_worldmodel_trust_store_digest_mismatch");
  return state;
}
function readLatest(directory) {
  const pointer = (() => { try { return JSON.parse(fs.readFileSync(statePath(directory), "utf8")); } catch { return null; } })();
  const revisionsDir = path.join(directory, "revisions");
  const entries = fs.existsSync(revisionsDir) ? fs.readdirSync(revisionsDir).filter((entry) => entry.endsWith(".json")).sort() : [];
  if (!entries.length) return null;
  const latest = JSON.parse(fs.readFileSync(path.join(revisionsDir, entries.at(-1)), "utf8")); validateState(latest);
  if (!pointer || pointer.revision !== latest.revision || pointer.digest !== latest.digest) fail("direct_worldmodel_trust_store_rollback_detected");
  assertAuthorityLocation(directory, latest);
  observeAuthorityHighWater(directory, latest);
  return latest;
}
function makeHandle(directory, state) {
  assertAuthorityLocation(directory, state);
  observeAuthorityHighWater(directory, state);
  const handle = Object.freeze({});
  STORE_HANDLES.set(handle, { directory, state });
  registerAnchors(handle);
  return handle;
}
function privateStore(store) { const value = STORE_HANDLES.get(store); if (!value) fail("direct_worldmodel_trust_store_untrusted_handle"); return value; }
function refresh(store) { const value = privateStore(store); const state = readLatest(value.directory); if (!state) fail("direct_worldmodel_trust_store_missing"); value.state = state; registerAnchors(store); return value; }
function snapshot(store, next) { const value = privateStore(store); assertAuthorityLocation(value.directory, next); atomic(revisionPath(value.directory, next.revision), next); atomic(statePath(value.directory), { revision: next.revision, digest: next.digest }); observeAuthorityHighWater(value.directory, next); value.state = next; registerAnchors(store); return store; }
function buildAnchor(state, graphId) { const normalizedGraphId = normalizeId(graphId, "hierarchical_worldmodel_graph"); const anchor = { kind: "worldmodel_trust_store", storeId: state.storeId, graphId: normalizedGraphId, authorityIdentityDigest: state.authorityIdentityDigest }; anchor.anchorDigest = digest("direct-worldmodel-trust-anchor@2", anchor); return anchor; }
function registerAnchors(store) {
  const { state, directory } = privateStore(store);
  for (const entry of Object.values(state.graphs)) if (entry?.anchor) {
    const key = anchorKey(entry.anchor);
    const incumbent = ANCHORED_STORES.get(key);
    if (incumbent && privateStore(incumbent).directory !== directory)
      fail("direct_worldmodel_trust_store_anchor_registration_takeover");
    ANCHORED_STORES.set(key, store);
  }
}
function assertAnchor(store, graph) { const { state } = refresh(store); const expected = buildAnchor(state, graph?.graphId); const anchor = graph?.trustAnchorRef; if (!anchor || canonicalJson(anchor) !== canonicalJson(expected)) fail("direct_worldmodel_trust_store_graph_anchor_mismatch"); return expected; }
function resolveAuthoritativeWorldmodelTrustStore(graph) {
  const anchor = graph?.trustAnchorRef;
  if (!anchor || anchor.kind !== "worldmodel_trust_store" || !anchor.authorityIdentityDigest || !anchor.anchorDigest) fail("direct_worldmodel_trust_store_graph_anchor_required");
  const store = ANCHORED_STORES.get(anchorKey(anchor));
  if (!store) fail("direct_worldmodel_trust_store_authority_unresolved");
  assertAnchor(store, graph);
  return store;
}
function createWorldmodelTrustStore(directory, input = {}) {
  directory = canonicalAuthorityDirectory(directory);
  const existing = readLatest(directory); if (existing) return makeHandle(directory, existing);
  // authorityIdentityDigest is generated locally.  It is intentionally not
  // read from input, so identical public metadata cannot recreate an anchor.
  const state = { schema: DIRECT_WORLDMODEL_TRUST_STORE_SCHEMA, storeId: normalizeId(input.storeId, "worldmodel_trust_store"), authorityIdentityDigest: authorityIdentity(), authorityDirectoryDigest: authorityDirectoryDigest(directory), revision: 0, createdAt: normalizeString(input.createdAt, nowIso(input.now || Date.now)), graphs: {} };
  state.digest = digest("direct-worldmodel-trust-store@1", state);
  const store = makeHandle(directory, state); return snapshot(store, state);
}
function openWorldmodelTrustStore(directory) { directory = canonicalAuthorityDirectory(directory); const state = readLatest(directory); if (!state) fail("direct_worldmodel_trust_store_missing"); return makeHandle(directory, state); }
function buildWorldmodelTrustAnchor(store, graphId) { return clone(buildAnchor(refresh(store).state, graphId)); }
function initializeAuthoritativeWorldmodelGraph(store, graph, governanceRegistry) {
  const value = refresh(store); const anchor = assertAnchor(store, graph); validateGovernanceProvenanceRegistry(governanceRegistry); if (value.state.graphs[graph.graphId]) fail("direct_worldmodel_trust_store_graph_exists");
  const next = clone(value.state); next.revision += 1; next.graphs[graph.graphId] = { anchor, genesisDigest: graph.digest, headGraphDigest: graph.digest, graph: clone(graph), governanceRegistry: clone(governanceRegistry), registryRef: registryRef(governanceRegistry), storeRevision: next.revision, transitionCount: graph.transitions.length, admissions: {} }; next.digest = digest("direct-worldmodel-trust-store@1", next); snapshot(store, next); return readAuthoritativeWorldmodelGraph(store, graph);
}
// Governance artifacts are installed by the harness between transitions.  The
// opaque branded handle is deliberately required here and is never accepted by
// graph/projection request objects.  This lets a long-lived authoritative graph
// admit a fresh, graph-digest-bound decision without treating a caller registry
// as current truth.
function installAuthoritativeWorldmodelGovernanceRegistry(store, graph, governanceRegistry) {
  const value = refresh(store);
  const current = readAuthoritativeWorldmodelGraph(store, graph);
  validateGovernanceProvenanceRegistry(governanceRegistry);
  if (governanceRegistry.userProfileId !== graph.userProfileId)
    fail("direct_worldmodel_trust_store_registry_user_mismatch");
  if (!governanceRegistry.records.every((record) =>
    record.binding?.graphId === graph.graphId
      && record.binding?.graphDigest === graph.digest
      && record.binding?.userProfileId === graph.userProfileId))
    fail("direct_worldmodel_trust_store_registry_graph_mismatch");
  const entry = value.state.graphs[graph.graphId];
  if (!entry || entry.headGraphDigest !== current.graph.digest)
    fail("direct_worldmodel_trust_store_stale_or_swapped_graph");
  if (Object.keys(entry.admissions || {}).length)
    fail("direct_worldmodel_trust_store_admission_still_open");
  const next = clone(value.state);
  next.revision += 1;
  next.graphs[graph.graphId] = {
    ...next.graphs[graph.graphId],
    governanceRegistry: clone(governanceRegistry),
    registryRef: registryRef(governanceRegistry),
    storeRevision: next.revision,
    admissions: {},
  };
  next.digest = digest("direct-worldmodel-trust-store@1", next);
  snapshot(store, next);
  return readAuthoritativeWorldmodelGraph(store, graph);
}
function readAuthoritativeWorldmodelGraph(store, graph) {
  const value = refresh(store); assertAnchor(store, graph); const entry = value.state.graphs[graph.graphId]; if (!entry || entry.headGraphDigest !== graph.digest) fail("direct_worldmodel_trust_store_stale_or_swapped_graph"); return { graph: clone(entry.graph), governanceRegistry: clone(entry.governanceRegistry), registryRef: clone(entry.registryRef), storeRevision: entry.storeRevision, trustAnchorRef: clone(entry.anchor) };
}
function readAuthoritativeWorldmodelGraphById(store, graphId) {
  const value = refresh(store);
  const id = normalizeId(graphId, "hierarchical_worldmodel_graph");
  const entry = value.state.graphs[id];
  if (!entry?.graph || entry.graph.graphId !== id || entry.headGraphDigest !== entry.graph.digest)
    fail("direct_worldmodel_trust_store_graph_missing", id);
  assertAnchor(store, entry.graph);
  return {
    graph: clone(entry.graph),
    governanceRegistry: clone(entry.governanceRegistry),
    registryRef: clone(entry.registryRef),
    storeRevision: entry.storeRevision,
    trustAnchorRef: clone(entry.anchor),
  };
}
function admitWorldmodelGovernanceRequest(store, input = {}) {
  const value = refresh(store); const current = readAuthoritativeWorldmodelGraph(store, input.graph); const context = isPlainObject(input.context) ? input.context : {};
  requireGovernanceProvenanceAdmission(current.governanceRegistry, { ...context, registryRef: current.registryRef, expectedRegistryRevision: current.governanceRegistry.revision });
  const next = clone(value.state); next.revision += 1; const entry = next.graphs[input.graph.graphId]; entry.storeRevision = next.revision;
  const admission = { schema: DIRECT_WORLDMODEL_STORE_ADMISSION_SCHEMA, admissionId: normalizeId(input.admissionId, "worldmodel_store_admission"), storeId: next.storeId, authorityIdentityDigest: next.authorityIdentityDigest, trustAnchorRef: current.trustAnchorRef, graphRef: { id: current.graph.graphId, digest: current.graph.digest }, registryRef: current.registryRef, storeRevision: entry.storeRevision, actorAgentId: normalizeString(context.agentId, ""), actorRole: normalizeString(context.role, ""), purpose: normalizeString(context.purpose, ""), requiredArtifacts: clone(context.requiredArtifacts || []), issuedAt: normalizeString(input.issuedAt, nowIso(input.now || Date.now)) }; admission.digest = digest("direct-worldmodel-store-admission@2", admission); entry.admissions[admission.admissionId] = clone(admission); next.digest = digest("direct-worldmodel-trust-store@1", next); snapshot(store, next); return clone(admission);
}
function readWorldmodelStoreAdmission(store, graph, admissionId) {
  const value = refresh(store);
  const current = readAuthoritativeWorldmodelGraph(store, graph);
  const id = normalizeId(admissionId, "worldmodel_store_admission");
  const admission = value.state.graphs[current.graph.graphId]
    ?.admissions?.[id];
  return admission ? clone(admission) : null;
}
function validateWorldmodelStoreAdmission(store, graph, admission, context = {}) {
  const value = refresh(store); const current = readAuthoritativeWorldmodelGraph(store, graph); const issued = value.state.graphs[graph.graphId]?.admissions?.[admission?.admissionId];
  if (!isPlainObject(admission) || !issued || canonicalJson(issued) !== canonicalJson(admission) || admission.schema !== DIRECT_WORLDMODEL_STORE_ADMISSION_SCHEMA || admission.digest !== digest("direct-worldmodel-store-admission@2", { ...admission, digest: undefined }) || admission.storeId !== value.state.storeId || admission.authorityIdentityDigest !== value.state.authorityIdentityDigest || admission.storeRevision !== current.storeRevision || admission.graphRef?.digest !== graph.digest || admission.registryRef?.digest !== current.registryRef.digest || admission.actorAgentId !== context.agentId || admission.actorRole !== context.role || admission.purpose !== context.purpose || canonicalJson(admission.requiredArtifacts) !== canonicalJson(context.requiredArtifacts || [])) fail("direct_worldmodel_trust_store_admission_invalid"); return current;
}
function commitAuthoritativeWorldmodelGraph(store, priorGraph, nextGraph, nextRegistry, admission) {
  const value = refresh(store); const current = readAuthoritativeWorldmodelGraph(store, priorGraph); if (admission.storeRevision !== current.storeRevision || nextGraph.trustAnchorRef?.anchorDigest !== current.trustAnchorRef.anchorDigest || nextGraph.trustAnchorRef?.authorityIdentityDigest !== current.trustAnchorRef.authorityIdentityDigest) fail("direct_worldmodel_trust_store_stale_revision"); validateGovernanceProvenanceRegistry(nextRegistry);
  const next = clone(value.state); next.revision += 1; next.graphs[nextGraph.graphId] = { ...next.graphs[nextGraph.graphId], headGraphDigest: nextGraph.digest, graph: clone(nextGraph), governanceRegistry: clone(nextRegistry), registryRef: registryRef(nextRegistry), storeRevision: next.revision, transitionCount: nextGraph.transitions.length, admissions: {} }; next.digest = digest("direct-worldmodel-trust-store@1", next); snapshot(store, next); return readAuthoritativeWorldmodelGraph(store, nextGraph);
}

module.exports = { DIRECT_WORLDMODEL_TRUST_STORE_SCHEMA, DIRECT_WORLDMODEL_STORE_ADMISSION_SCHEMA, createWorldmodelTrustStore, openWorldmodelTrustStore, buildWorldmodelTrustAnchor, resolveAuthoritativeWorldmodelTrustStore, initializeAuthoritativeWorldmodelGraph, installAuthoritativeWorldmodelGovernanceRegistry, readAuthoritativeWorldmodelGraph, readAuthoritativeWorldmodelGraphById, admitWorldmodelGovernanceRequest, readWorldmodelStoreAdmission, validateWorldmodelStoreAdmission, commitAuthoritativeWorldmodelGraph };
