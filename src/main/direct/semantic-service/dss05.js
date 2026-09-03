"use strict";

/*
 * Direct Semantic Service DSS-0.5, generation 1.
 *
 * This module is deliberately page-confined.  It consumes an exact DSS-0.4
 * closed-page handoff and produces advisory-only records.  There is no
 * repository, credential, network, tool, kernel, UI, or mutation authority
 * in this service.  Provider execution is an injected boundary and is
 * unavailable unless the installed runtime/adapter evidence says otherwise.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Dss05SqliteStore } = require("./dss05-sqlite");
const { canonicalJson, digestObject, deepFreeze } = require("./dss02-common");

const MODULE_PATH = path.resolve(__dirname, "resources/dss05-module.v0.json");
const MODULE = JSON.parse(fs.readFileSync(MODULE_PATH, "utf8"));
const MODULE_ID = "direct.semantic-service.dss05.real-closed-page.generation-1";
const MODULE_DIGEST = "sha256:70f1b66394f19d3de5fc32925c858f8dcfcf2bc28e5d7c00f307744ec9f7350a";
const COMBINED_FREEZE_DIGEST = "sha256:0d29f80d9c66f9f1c5aae0e39139fb4c6add536b3468099070894664454b82ac";
const DSS04_SEMANTIC_CANDIDATE = "04c6437522779c060c2c3f3e3050a42ca0b77a1f";
const DSS04_PASS_CLOSURE = "55ef4eef5811cdc753bb810f773564bf11359b5c";
const DSS04_IMPLEMENTATION_SOURCE = "6a1facfa7999b7042304de97e64c1463cff8c09b";
const DSS04_SERVICE_GENERATION = "sha256:f3f7d115b7d8d3f39665c8afddedaa38d3ae1ba4fe91c294270806867594b019";
const PREDECESSOR_CLOSURE = "docs/operations/direct-dss04-realization/local_implementation_closure.v1.json";
const DSS05_SERVICE_GENERATION = digestObject("DirectSemanticService.Dss05.ServiceGeneration.v1", {
  moduleId: MODULE_ID, moduleDigest: MODULE_DIGEST, combinedFreezeDigest: COMBINED_FREEZE_DIGEST,
  predecessor: { semanticCandidate: DSS04_SEMANTIC_CANDIDATE, passClosure: DSS04_PASS_CLOSURE, implementation: DSS04_IMPLEMENTATION_SOURCE }
});
const ATTEMPT_POLICY_REVISION = "dss05-attempt-policy-generation-1";
const CAPSULE_REVISION = "dss05-execution-capsule-generation-1";
const REQUEST_REVISION = "dss05-canonical-request-generation-1";
const QUARANTINE_REVISION = "dss05-raw-quarantine-generation-1";
const USAGE_REVISION = "dss05-usage-generation-1";
const EVALUATION_REVISION = "dss05-evaluation-generation-1";
const DISPOSITION_REVISION = "dss05-selection-policy-generation-1";
const RECOVERY_REVISION = "dss05-recovery-generation-1";
const OUTPUT_SCHEMA_DIGEST = digestObject("DirectSemanticService.Dss05.OutputSchema.v1", {
  schema: "direct-semantic-service-dss05-micro-result.v1", statuses: ["SUPPORTS", "REFUTES", "INCONCLUSIVE", "REMANDS"]
});
const AUTH_NONE = "NONE";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TERMINAL_ATTEMPT_STATES = new Set(["TERMINAL", "FAILED", "INTERRUPTED", "TIMED_OUT", "UNKNOWN_TERMINAL", "CANCELLED_PRESTART", "EXHAUSTED", "RECOVERY_BLOCKED"]);
const RETRYABLE = new Set(["transport_unavailable_before_dispatch", "transport_interrupted_before_raw_capture", "runtime_failed_before_raw_capture", "raw_result_structural_rejection"]);
const CARRIER_MAP = Object.fromEntries(MODULE.carriers.map((carrier) => [carrier.id, carrier]));
const OPERATION_MAP = Object.fromEntries(MODULE.operations.map((operation) => [operation.id, operation]));
const TRANSITION_MAP = new Map(MODULE.qualified_transitions.map((row) => [`${row.operationId}:${row.carrierId}:${row.event}`, row]));
const CARRIER_IDS = Object.freeze(MODULE.carriers.map((carrier) => carrier.id));
const OPERATION_IDS = Object.freeze(MODULE.operations.map((operation) => operation.id));
const QUALIFIED_TRANSITION_IDS = Object.freeze(MODULE.qualified_transitions.map((row) => row.transitionId));
const DSS05_CARRIER_FIELD_MAP = Object.freeze(Object.fromEntries(MODULE.carriers.map((carrier) => [carrier.id, Object.freeze({ stable: Object.freeze([...(carrier.identity?.stable_fields || [])]), generation: Object.freeze([...(carrier.identity?.generation_fields || [])]) })])));

class Dss05Error extends Error {
  constructor(code, message = code, details = undefined) { super(`${code}: ${message}`); this.name = "Dss05Error"; this.code = code; if (details !== undefined) this.details = details; }
}

if (MODULE.module_id !== MODULE_ID || MODULE.carriers.length !== 12 || MODULE.operations.length !== 14 || MODULE.qualified_transitions.length !== 47) {
  throw new Error("DSS05 frozen declaration population mismatch");
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function nowIso(value) { const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value); if (!Number.isFinite(date.getTime())) throw new Error("DSS05_INVALID_TIME"); return date.toISOString(); }
function digest(domain, value) { return digestObject(domain, value); }
function isDigest(value) { return typeof value === "string" && DIGEST.test(value); }
function safeDigest(value, label) { if (!isDigest(value)) throw new Error(`DSS05_INVALID_DIGEST:${label}`); return value; }
function required(value, label) { if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new Error(`DSS05_REQUIRED:${label}`); return value; }
function result(status, extra = {}) { return deepFreeze({ status, authorityEffect: AUTH_NONE, ...clone(extra) }); }
function alias(value, ...keys) { if (value === undefined || value === null) return undefined; for (const key of keys) if (value[key] !== undefined) return value[key]; return undefined; }
function objectWithout(value, fields) { const out = { ...value }; for (const field of fields) delete out[field]; return out; }
function hasForbiddenBoundary(value) {
  if (!value || typeof value !== "object") return false;
  const forbidden = new Set(["credential", "credentials", "token", "accessToken", "refreshToken", "authorization", "endpoint", "url", "repository", "repositoryPath", "filesystem", "network", "tool", "kernelMutation", "projectMutation", "rawPrompt", "prompt", "requestBody", "providerRequest"]);
  return Object.keys(value).some((key) => forbidden.has(key) || (value[key] && typeof value[key] === "object" && hasForbiddenBoundary(value[key])));
}

class Dss05Service {
  constructor(options = {}) {
    this.owner = options.owner || "direct-project-owner";
    if (options.serviceGeneration && options.serviceGeneration !== DSS05_SERVICE_GENERATION) throw new Dss05Error("DSS05_SERVICE_GENERATION_PIN_MISMATCH");
    this.store = options.store || new Dss05SqliteStore({ root: options.root || options.storeRoot, custodyKey: options.custodyKey, now: options.now, failBeforeCommit: options.failBeforeCommit });
    this.clock = () => nowIso(typeof options.now === "function" ? options.now() : options.now);
    this.serviceGeneration = DSS05_SERVICE_GENERATION;
    this.quarantineRoot = path.join(this.store.root, "dss05-raw-quarantine");
    fs.mkdirSync(this.quarantineRoot, { recursive: true, mode: 0o700 });
    this.state = this.store.read() || this._initialState();
    this.stateVerificationError = null;
    try { this._verifyStateEnvelope(); } catch (error) { this.stateVerificationError = error; }
  }

  _initialState() {
    return {
      schema: "direct_semantic_service_dss05_state@1", moduleId: MODULE_ID, moduleDigest: MODULE_DIGEST,
      serviceGeneration: this.serviceGeneration, generation: { serviceGeneration: this.serviceGeneration, state: "READY", revision: 1 },
      handoffs: {}, runtimes: {}, adapters: {}, capsules: {}, requests: {}, attempts: {}, rawResults: {}, responses: {}, usage: {}, evaluations: {}, dispositions: {}, recoveryDispositions: {}, operationInputs: {}, events: []
    };
  }

  _persist() { this.store.write(this.state); }
  _snapshot() { return clone(this.state); }
  _restore(snapshot) { this.state = snapshot; }
  _map(name) { if (!this.state[name]) this.state[name] = {}; return this.state[name]; }
  _ref(domain, value) { return digest(`DirectSemanticService.Dss05.${domain}.v1`, value); }
  _opKey(operation, value) { return this._ref(`Operation.${operation}`, value); }
  _authority(input, owner, root) { const grant = input?.grant || input?.authorization || input?.ownerAuthorization || input?.authority; return Boolean(grant && grant.owner === owner && grant.root === root && grant.authorized === true); }
  _current(value) { return value === this.serviceGeneration || value === this.state.serviceGeneration; }
  _transition(operationId, carrierId, eventName, payload, outcome, fromState, toState) {
    const row = TRANSITION_MAP.get(`${operationId}:${carrierId}:${eventName}`);
    if (!row) throw new Error(`DSS05_UNKNOWN_TRANSITION:${operationId}:${carrierId}:${eventName}`);
    const effectiveFromState = fromState === undefined ? row.fromStates[0] : fromState;
    if (!row.fromStates.includes(effectiveFromState)) throw new Dss05Error("DSS05_TRANSITION_FROM_STATE_INVALID", `${operationId}:${carrierId}:${eventName}`, { fromState: effectiveFromState, allowed: row.fromStates });
    const effectiveOutcome = outcome === undefined ? row.outcomeCases[0] : outcome;
    if (!row.outcomeCases.includes(effectiveOutcome)) throw new Dss05Error("DSS05_TRANSITION_OUTCOME_INVALID", `${operationId}:${carrierId}:${eventName}`, { outcome: effectiveOutcome, allowed: row.outcomeCases });
    const effectiveToState = toState === undefined ? row.toState : toState;
    if (effectiveToState !== row.toState) throw new Dss05Error("DSS05_TRANSITION_DESTINATION_INVALID", `${operationId}:${carrierId}:${eventName}`, { toState: effectiveToState, required: row.toState });
    const event = {
      sequence: this.state.events.length + 1, priorDigest: this.state.events.at(-1)?.eventDigest || null,
      type: operationId, operationId, carrierId, event: eventName, transitionId: row.transitionId, owner: row.owner,
      priorStateSource: row.priorStateSource, fromStates: clone(row.fromStates), fromState: effectiveFromState,
      toState: row.toState, outcome: effectiveOutcome, outcomeCases: clone(row.outcomeCases), payload: clone(payload)
    };
    event.eventDigest = digest("Event", event);
    this.state.events.push(event);
    return event;
  }
  _commit(mutator, before = this._snapshot()) {
    try { const value = mutator(); this._persist(); return value; }
    catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }
  _operationReplay(operation, key, collection, ref) {
    const previous = this.state.operationInputs[operation];
    if (!previous) return null;
    if (previous.inputDigest !== key) return result("IDEMPOTENCY_CONFLICT");
    return result("REPLAYED", collection && previous.ref ? { [collection]: clone(this.state[collection]?.[previous.ref]) } : { ref: previous.ref || ref });
  }
  _remember(operation, key, ref, operationInput) { this.state.operationInputs[operation] = { inputDigest: key, ref, operationInput: clone(operationInput) }; }
  _set(map, ref, value) { this._map(map)[ref] = value; return value; }
  _stateAt(map, ref) { return this.state[map]?.[ref] || Object.values(this.state[map] || {}).find((value) => value["runtimeRef"] === ref || value["workerExecutionRuntimeRevisionRef"] === ref || value["adapterRef"] === ref || value["modelAdapterRevisionRef"] === ref || value["capsuleRef"] === ref || value["requestRef"] === ref || value["attemptRef"] === ref || value["rawResultRef"] === ref || value["microResultRef"] === ref || value["usageReceiptRef"] === ref || value["evaluationRef"] === ref || value["advisoryDispositionRef"] === ref);
  }
  _runtime() { return Object.values(this.state.runtimes).filter((runtime) => runtime.state === "ADMITTED" && (runtime.serviceGeneration === this.serviceGeneration || runtime.dss05_service_generation === this.serviceGeneration)).at(-1) || null; }
  _adapter() { return Object.values(this.state.adapters).filter((adapter) => adapter.state === "ADMITTED" && adapter.dss05_service_generation === this.serviceGeneration).at(-1) || null; }
  _handoff() { return Object.values(this.state.handoffs).find((handoff) => handoff.state === "ADMITTED" && handoff.dss05_service_generation === this.serviceGeneration) || null; }
  _capsule(ref) { return this._stateAt("capsules", ref) || this._handoff()?.capsuleRef && this.state.capsules[this._handoff().capsuleRef]; }
  _request(ref) { return this._stateAt("requests", ref) || Object.values(this.state.requests).find((request) => request.capsuleRef === ref); }
  _attempt(ref) { return this._stateAt("attempts", ref); }
  _validCurrentTuple(capsule, request, attempt) { return Boolean(capsule && capsule.state === "ADMITTED" && capsule.dss05_service_generation === this.serviceGeneration && (!request || (request.capsuleRef === capsule.capsuleRef && request.dss05_service_generation === this.serviceGeneration && (!request.modelAdapterRevisionRef || request.modelAdapterRevisionRef === capsule.modelAdapterRevisionRef))) && (!attempt || (attempt.capsuleRef === capsule.capsuleRef && attempt.dss05_service_generation === this.serviceGeneration && attempt.workerExecutionRuntimeRevisionRef === capsule.workerExecutionRuntimeRevisionRef && attempt.modelAdapterRevisionRef === (capsule.modelAdapterRevisionRef || capsule.backendAdapterRevision))));
  }

  _handoffCandidate(input) {
    const outer = input || {};
    const supplied = outer.handoff || outer.pageHandoff || outer.page || outer;
    const page = supplied.page || supplied.closedPage || supplied.projection || supplied;
    const values = {
      page_ref: alias(supplied, "page_ref", "pageRef") || alias(page, "page_ref", "pageRef", "page_identity", "pageIdentity"),
      materialization_ref: alias(supplied, "materialization_ref", "materializationRef", "plan_ref", "planRef") || alias(page, "materialization_ref", "materializationRef", "plan_ref", "planRef"),
      page_digest: alias(supplied, "page_digest", "pageDigest", "content_seal", "contentSeal") || alias(page, "page_digest", "pageDigest", "content_seal", "contentSeal"),
      route_population_digest: alias(supplied, "route_population_digest", "routePopulationDigest"),
      completeness_receipt_ref: alias(supplied, "completeness_receipt_ref", "completenessReceiptRef"),
      sufficiency_receipt_ref: alias(supplied, "sufficiency_receipt_ref", "sufficiencyReceiptRef"),
      batch_seal_ref: alias(supplied, "batch_seal_ref", "batchSealRef", "materialization_batch_seal", "materializationBatchSeal")
    };
    const predecessor = outer.predecessor || supplied.predecessor || {};
    const generation = alias(supplied, "dss04_service_generation", "dss04ServiceGeneration", "service_generation", "serviceGeneration") || alias(page, "dss04_service_generation", "dss04ServiceGeneration", "service_generation", "serviceGeneration");
    const predecessorValues = {
      dss04_service_generation: generation,
      dss04_semantic_candidate: alias(predecessor, "dss04SemanticCandidate", "dss04_semantic_candidate") || alias(supplied, "dss04_semantic_candidate", "dss04SemanticCandidate"),
      dss04_implementation_source_commit: alias(predecessor, "dss04ImplementationSource", "dss04_implementation_source_commit", "dss04ImplementationSourceCommit") || alias(supplied, "dss04_implementation_source_commit", "dss04ImplementationSourceCommit"),
      projection_revision: alias(supplied, "projection_revision", "projectionRevision") || alias(page, "projection_revision", "projectionRevision")
    };
    return { ...values, ...predecessorValues, owner: alias(supplied, "owner"), root: alias(supplied, "root"), source: clone(supplied), page: clone(page) };
  }

  admitClosedPageHandoff(input = {}) {
    const before = this._snapshot();
    try {
      const candidate = this._handoffCandidate(input);
      const stableFields = ["page_ref", "materialization_ref", "page_digest", "route_population_digest", "completeness_receipt_ref", "sufficiency_receipt_ref", "batch_seal_ref"];
      const generationFields = ["dss04_service_generation", "dss04_semantic_candidate", "dss04_implementation_source_commit", "projection_revision"];
      if (!stableFields.every((field) => typeof candidate[field] === "string" && candidate[field].length) || !generationFields.every((field) => typeof candidate[field] === "string" && candidate[field].length)) {
        this._transition("admit-closed-page-handoff", "e.dss04-closed-page-handoff", "REJECT", { reason: "HANDOFF_INCOMPLETE" }, "REJECTED", "UNSEEN", "REJECTED"); this._persist(); return result("REJECTED", { reason: "HANDOFF_INCOMPLETE" });
      }
      const current = this._handoff();
      const currentnessChanged = current && (candidate.page_ref !== current.page_ref || candidate.materialization_ref !== current.materialization_ref || candidate.page_digest !== current.page_digest || candidate.route_population_digest !== current.route_population_digest || candidate.batch_seal_ref !== current.batch_seal_ref || candidate.dss04_service_generation !== current.dss04_service_generation);
      if (candidate.dss04_service_generation !== DSS04_SERVICE_GENERATION || currentnessChanged) {
        if (current && current.state === "ADMITTED" && candidate.page_ref === current.page_ref) {
          current.state = "STALE"; current.staleAt = this.clock(); current.authorityEffect = AUTH_NONE;
          this._transition("admit-closed-page-handoff", "e.dss04-closed-page-handoff", "MARK_STALE", current, "STALE_GENERATION", "ADMITTED", "STALE"); this._persist();
        }
        return result("STALE_GENERATION", { reason: "DSS04_HANDOFF_CURRENTNESS_MISMATCH" });
      }
      if (!isDigest(candidate.page_digest) || !isDigest(candidate.route_population_digest)) {
        this._transition("admit-closed-page-handoff", "e.dss04-closed-page-handoff", "REJECT", { reason: "HANDOFF_DIGEST_INVALID" }, "REJECTED", "UNSEEN", "REJECTED"); this._persist(); return result("REJECTED", { reason: "HANDOFF_DIGEST_INVALID" });
      }
      const predecessorMatches = candidate.dss04_semantic_candidate === DSS04_SEMANTIC_CANDIDATE && candidate.dss04_implementation_source_commit === DSS04_IMPLEMENTATION_SOURCE && (candidate.source?.dss04_pass_closure || candidate.source?.dss04PassClosure || candidate.source?.dss04_semantic_pass_closure || candidate.source?.dss04SemanticPassClosure || candidate.source?.predecessor?.dss04_pass_closure || candidate.source?.predecessor?.dss04PassClosure || candidate.source?.predecessor?.dss04_semantic_pass_closure || candidate.source?.predecessor?.dss04SemanticPassClosure || input.dss04_pass_closure || input.dss04PassClosure || input.predecessor?.dss04_pass_closure || input.predecessor?.dss04PassClosure) === DSS04_PASS_CLOSURE;
      if (!predecessorMatches || (candidate.owner && candidate.owner !== "dss04-projection-owner") || (candidate.root && candidate.root !== "dss04-projection-root")) {
        this._transition("admit-closed-page-handoff", "e.dss04-closed-page-handoff", "REJECT", { reason: "PREDECESSOR_MISMATCH" }, "REJECTED", "UNSEEN", "REJECTED"); this._persist(); return result("REJECTED", { reason: "PREDECESSOR_MISMATCH" });
      }
      const operationInput = { identity: Object.fromEntries([...stableFields, ...generationFields].map((field) => [field, candidate[field]])), moduleId: MODULE_ID, serviceGeneration: this.serviceGeneration };
      const key = this._opKey("admit-closed-page-handoff", operationInput); const prior = this._operationReplay("admit-closed-page-handoff", key, "handoffs"); if (prior) return prior;
      const handoffIdentity = { ...Object.fromEntries([...stableFields, ...generationFields].map((field) => [field, candidate[field]])), dss05_service_generation: this.serviceGeneration };
      const handoffRef = this._ref("Dss04ClosedPageHandoff", handoffIdentity);
      const existing = this.state.handoffs[handoffRef]; if (existing) return result("REPLAYED", { handoff: clone(existing), capsule: this.state.capsules[existing.capsuleRef] ? clone(this.state.capsules[existing.capsuleRef]) : undefined });
      const value = { ...handoffIdentity, handoffRef, state: "ADMITTED", owner: "dss04-projection-owner", root: "dss04-projection-root", authorityEffect: AUTH_NONE, admittedAt: this.clock() };
      this._set("handoffs", handoffRef, value); this._remember("admit-closed-page-handoff", key, handoffRef, operationInput);
      this._transition("admit-closed-page-handoff", "e.dss04-closed-page-handoff", "ACCEPT", value, "ADMITTED", "UNSEEN", "ADMITTED"); this._persist();
      /* The frozen operation publishes the capsule when its runtime/adapter
       * intersection is already admitted.  Keeping the capsule sub-operation
       * separately keyed also makes a handoff-only retry deterministic. */
      const runtime = this._runtime(); const adapter = this._adapter();
      if (runtime && adapter) {
        const capsuleResult = this.admitClosedPageToCapsule({ ...input, handoff: candidate });
        if (["ADMITTED", "REPLAYED"].includes(capsuleResult.status)) return result(capsuleResult.status, { handoff: clone(this.state.handoffs[handoffRef]), capsule: capsuleResult.capsule });
      }
      return result("ADMITTED", { handoff: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  installWorkerExecutionRuntime(input = {}) {
    const before = this._snapshot();
    try {
      if (!this._authority(input, "dss05-runtime-owner", "dss05-worker-runtime-root")) return result("UNAUTHORIZED");
      const raw = clone(input.runtime || input.descriptor || input);
      if (hasForbiddenBoundary(raw) || raw.projectEvidenceRuntimeRevisionRef || raw.project_evidence_runtime_revision_digest || raw.projectEvidenceRuntime) return result("BROKEN", { reason: "RUNTIME_REVISION_COLLISION" });
      const field = (snake, camel) => alias(raw, snake, camel);
      const stable = { substrateBinding: field("substrate_binding", "substrateBinding"), backendAdapterRevision: field("backend_adapter_revision", "backendAdapterRevision"), processLauncherDigest: field("process_launcher_digest", "processLauncherDigest"), sandboxPolicyDigest: field("sandbox_policy_digest", "sandboxPolicyDigest"), scratchPolicyDigest: field("scratch_policy_digest", "scratchPolicyDigest"), environmentAllowlistDigest: field("environment_allowlist_digest", "environmentAllowlistDigest"), credentialExclusionPolicyDigest: field("credential_exclusion_policy_digest", "credentialExclusionPolicyDigest"), outputCapturePolicyDigest: field("output_capture_policy_digest", "outputCapturePolicyDigest"), runtimeArtifactDigest: field("runtime_artifact_digest", "runtimeArtifactDigest") };
      if (!Object.values(stable).every((value) => typeof value === "string" && value.length) || ["processLauncherDigest", "sandboxPolicyDigest", "scratchPolicyDigest", "environmentAllowlistDigest", "credentialExclusionPolicyDigest", "outputCapturePolicyDigest", "runtimeArtifactDigest"].some((key) => !isDigest(stable[key]))) return result("BROKEN", { reason: "RUNTIME_DESCRIPTOR_INVALID" });
      const runtimeRevision = field("runtime_revision", "runtimeRevision") || "worker-runtime-revision-1";
      const serviceGeneration = field("dss05_service_generation", "dss05ServiceGeneration") || this.serviceGeneration;
      if (!this._current(serviceGeneration)) return result("STALE_PREDECESSOR");
      const evidence = clone(input.availabilityEvidence || input.runtimeEvidence || raw.availabilityEvidence || raw.availability_evidence || {});
      if (hasForbiddenBoundary(evidence)) return result("BROKEN", { reason: "RUNTIME_REVISION_COLLISION" });
      const available = evidence.admitted === true || evidence.state === "ADMITTED";
      const requestedState = String(input.state || raw.state || (available ? "ADMITTED" : "UNAVAILABLE")).toUpperCase();
      const identity = { workerExecutionRuntimeRevisionRef: field("worker_execution_runtime_revision_ref", "workerExecutionRuntimeRevisionRef") || this._ref("WorkerExecutionRuntimeIdentity", { stable, runtimeRevision, serviceGeneration }), ...stable, dss05_service_generation: this.serviceGeneration, runtime_revision: runtimeRevision };
      const expectedRuntimeRef = this._ref("WorkerExecutionRuntimeIdentity", { stable, runtimeRevision, serviceGeneration });
      if (field("worker_execution_runtime_revision_ref", "workerExecutionRuntimeRevisionRef") && identity.workerExecutionRuntimeRevisionRef !== expectedRuntimeRef) return result("BROKEN", { reason: "RUNTIME_IDENTITY_MISMATCH" });
      const ref = identity.workerExecutionRuntimeRevisionRef;
      const opInput = { identity, evidence: digest("RuntimeAvailabilityEvidence", evidence), requestedState };
      const state = ["ADMITTED", "UNAVAILABLE", "REVOKED", "BROKEN"].includes(requestedState) ? requestedState : "BROKEN";
      if (state === "REVOKED") return result("BROKEN", { reason: "RUNTIME_REVOKE_REQUIRES_ADMISSION" });
      const key = this._opKey("install-worker-execution-runtime", opInput); const prior = this._operationReplay("install-worker-execution-runtime", key, "runtimes", ref); if (prior && !(prior.status === "IDEMPOTENCY_CONFLICT" && this.state.runtimes[this.state.operationInputs["install-worker-execution-runtime"]?.ref]?.state === "UNAVAILABLE" && state !== "UNAVAILABLE")) return prior;
      const value = { ...identity, serviceGeneration: this.serviceGeneration, runtimeRef: ref, state, availabilityEvidenceDigest: digest("RuntimeAvailabilityEvidence", evidence), isolation: { repository: false, filesystem: false, network: false, credentials: false, pageOnly: true }, authorityEffect: AUTH_NONE, installedAt: this.clock() };
      this._set("runtimes", ref, value); this._remember("install-worker-execution-runtime", key, ref, opInput);
      const event = state === "ADMITTED" ? "ADMIT" : state === "UNAVAILABLE" ? "MARK_UNAVAILABLE" : state === "REVOKED" ? "REVOKE" : "BREAK";
      this._transition("install-worker-execution-runtime", "d.worker-execution-runtime", event, value, state, "ABSENT", state); this._persist();
      return result(state, { runtime: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  installModelAdapterRevision(input = {}) {
    const before = this._snapshot();
    try {
      if (!this._authority(input, "dss05-adapter-owner", "dss05-model-adapter-root")) return result("UNAUTHORIZED");
      const runtime = this._runtime(); if (!runtime) return result("STALE_PREDECESSOR");
      const raw = clone(input.adapter || input.descriptor || input);
      if (hasForbiddenBoundary(raw)) return result("BROKEN", { reason: "ADAPTER_BOUNDARY_FORBIDDEN" });
      const field = (snake, camel) => alias(raw, snake, camel);
      const evidence = clone(input.providerRuntimeEvidence || input.provider_runtime_evidence || raw.providerRuntimeEvidence || raw.provider_runtime_evidence || {});
      if (hasForbiddenBoundary(evidence)) return result("BROKEN", { reason: "ADAPTER_BOUNDARY_FORBIDDEN" });
      const model = field("model", "model") || field("provider_model", "providerModel") || "unidentified-model";
      const available = evidence.admitted === true || evidence.state === "ADMITTED";
      const evidenceComplete = available && ["providerProfileRevisionRef", "providerAvailabilityDigest", "modelAvailabilityDigest", "endpointPolicyDigest", "credentialExclusionDigest", "observedAt"].every((key) => evidence[key] !== undefined) && ["providerAvailabilityDigest", "modelAvailabilityDigest", "endpointPolicyDigest", "credentialExclusionDigest"].every((key) => isDigest(evidence[key]));
      if (String(model || "").toLowerCase() === "spark" || !evidenceComplete) {
        const unavailableIdentity = { model, runtimeRef: runtime.runtimeRef, dss05_service_generation: this.serviceGeneration, evidenceDigest: digest("ProviderRuntimeEvidence", evidence) };
        const key = this._opKey("install-model-adapter-revision", unavailableIdentity); const prior = this._operationReplay("install-model-adapter-revision", key, "adapters"); if (prior && !(String(model || "").toLowerCase() === "spark" && prior.status === "IDEMPOTENCY_CONFLICT")) return prior;
        const ref = this._ref("ModelAdapterUnavailable", unavailableIdentity); const value = { ...unavailableIdentity, modelAdapterRevisionRef: ref, adapterRef: ref, state: "UNAVAILABLE", standing: String(model || "").toLowerCase() === "spark" ? "EXCLUDED_DEFERRED" : "UNAVAILABLE", authorityEffect: AUTH_NONE, installedAt: this.clock() };
        this._set("adapters", ref, value); this._remember("install-model-adapter-revision", key, ref, unavailableIdentity); this._transition("install-model-adapter-revision", "d.model-adapter-revision", "MARK_UNAVAILABLE", value, "UNAVAILABLE", "ABSENT", "UNAVAILABLE"); this._persist(); return result("UNAVAILABLE", { adapter: value });
      }
      const stable = { adapterBuildDigest: field("adapter_build_digest", "adapterBuildDigest"), providerDialect: field("provider_dialect", "providerDialect"), requestMappingDigest: field("request_mapping_digest", "requestMappingDigest"), responseMappingDigest: field("response_mapping_digest", "responseMappingDigest"), outputSchemaDigest: field("output_schema_digest", "outputSchemaDigest") || OUTPUT_SCHEMA_DIGEST, transportPolicyDigest: field("transport_policy_digest", "transportPolicyDigest") };
      if (!stable.adapterBuildDigest || !stable.providerDialect || !stable.requestMappingDigest || !stable.responseMappingDigest || !stable.transportPolicyDigest || Object.entries(stable).filter(([key]) => key !== "providerDialect").some(([, value]) => !isDigest(value))) return result("BROKEN", { reason: "ADAPTER_DESCRIPTOR_INVALID" });
      const adapterRevision = field("adapter_revision", "adapterRevision") || "model-adapter-revision-1";
      const identity = { modelAdapterRevisionRef: field("model_adapter_revision_ref", "modelAdapterRevisionRef") || this._ref("ModelAdapterIdentity", { stable, adapterRevision, runtime: runtime.runtimeRef }), ...stable, workerExecutionRuntimeRevisionRef: runtime.runtimeRef, dss05_service_generation: this.serviceGeneration, adapter_revision: adapterRevision, providerProfileRevisionRef: field("provider_profile_revision_ref", "providerProfileRevisionRef") || evidence.providerProfileRevisionRef || evidence.provider_profile_revision_ref, providerRuntimeEvidenceDigest: digest("ProviderRuntimeEvidence", evidence) };
      const ref = identity.modelAdapterRevisionRef; const key = this._opKey("install-model-adapter-revision", identity); const prior = this._operationReplay("install-model-adapter-revision", key, "adapters", ref); if (prior && !(prior.status === "IDEMPOTENCY_CONFLICT" && this.state.adapters[this.state.operationInputs["install-model-adapter-revision"]?.ref]?.state === "UNAVAILABLE")) return prior;
      const expectedAdapterRef = this._ref("ModelAdapterIdentity", { stable, adapterRevision, runtime: runtime.runtimeRef });
      if (field("model_adapter_revision_ref", "modelAdapterRevisionRef") && ref !== expectedAdapterRef) return result("BROKEN", { reason: "ADAPTER_IDENTITY_MISMATCH" });
      const value = { ...identity, adapterRef: ref, state: "ADMITTED", standing: "ADMITTED_RUNTIME_EVIDENCE_ONLY", authorityEffect: AUTH_NONE, installedAt: this.clock() };
      this._set("adapters", ref, value); this._remember("install-model-adapter-revision", key, ref, identity); this._transition("install-model-adapter-revision", "d.model-adapter-revision", "ADMIT", value, "ADMITTED", "ABSENT", "ADMITTED"); this._persist(); return result("ADMITTED", { adapter: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  _changeInstalledRevision(kind, input = {}, nextState) {
    const mapName = kind === "runtime" ? "runtimes" : "adapters";
    const carrierId = kind === "runtime" ? "d.worker-execution-runtime" : "d.model-adapter-revision";
    const operationId = kind === "runtime" ? "install-worker-execution-runtime" : "install-model-adapter-revision";
    const owner = kind === "runtime" ? "dss05-runtime-owner" : "dss05-adapter-owner";
    const root = kind === "runtime" ? "dss05-worker-runtime-root" : "dss05-model-adapter-root";
    if (!this._authority(input, owner, root)) return result("UNAUTHORIZED");
    const ref = alias(input, "runtimeRef", "workerExecutionRuntimeRevisionRef", "runtime_ref", "adapterRef", "modelAdapterRevisionRef", "adapter_ref");
    const current = ref ? this._stateAt(mapName, ref) : (kind === "runtime" ? this._runtime() : this._adapter());
    if (!current || !["ADMITTED", "UNAVAILABLE"].includes(current.state)) return result("STALE_PREDECESSOR");
    if (current.state === nextState) return result("REPLAYED", { [kind]: clone(current) });
    if (nextState === "REVOKED" && current.state !== "ADMITTED") return result("STALE_PREDECESSOR");
    const before = this._snapshot();
    try {
      const event = nextState === "UNAVAILABLE" ? "MARK_UNAVAILABLE" : nextState === "REVOKED" ? "REVOKE" : "BREAK";
      const priorState = current.state; current.state = nextState; current.changedAt = this.clock(); current.authorityEffect = AUTH_NONE;
      this._transition(operationId, carrierId, event, current, nextState, priorState, nextState); this._persist(); return result(nextState, { [kind]: clone(current) });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }
  markWorkerExecutionRuntimeUnavailable(input = {}) { return this._changeInstalledRevision("runtime", input, "UNAVAILABLE"); }
  markRuntimeUnavailable(input = {}) { return this.markWorkerExecutionRuntimeUnavailable(input); }
  revokeWorkerExecutionRuntime(input = {}) { return this._changeInstalledRevision("runtime", input, "REVOKED"); }
  revokeWorkerRuntime(input = {}) { return this.revokeWorkerExecutionRuntime(input); }
  breakWorkerExecutionRuntime(input = {}) { return this._changeInstalledRevision("runtime", input, "BROKEN"); }
  breakWorkerRuntime(input = {}) { return this.breakWorkerExecutionRuntime(input); }
  markModelAdapterUnavailable(input = {}) { return this._changeInstalledRevision("adapter", input, "UNAVAILABLE"); }
  markModelAdapterRevisionUnavailable(input = {}) { return this.markModelAdapterUnavailable(input); }
  revokeModelAdapterRevision(input = {}) { return this._changeInstalledRevision("adapter", input, "REVOKED"); }
  breakModelAdapterRevision(input = {}) { return this._changeInstalledRevision("adapter", input, "BROKEN"); }

  markClosedPageHandoffStale(input = {}) {
    const before = this._snapshot();
    try {
      const handoff = this._stateAt("handoffs", alias(input, "handoffRef", "handoff_ref")) || this._handoff();
      if (!handoff) return result("STALE_PREDECESSOR");
      if (handoff.state === "STALE") return result("REPLAYED", { handoff: clone(handoff) });
      if (handoff.state !== "ADMITTED") return result("STALE_PREDECESSOR");
      handoff.state = "STALE"; handoff.staleAt = this.clock(); handoff.authorityEffect = AUTH_NONE;
      this._transition("admit-closed-page-handoff", "e.dss04-closed-page-handoff", "MARK_STALE", handoff, "STALE_GENERATION", "ADMITTED", "STALE"); this._persist(); return result("STALE_GENERATION", { handoff: clone(handoff) });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }
  markHandoffStale(input = {}) { return this.markClosedPageHandoffStale(input); }

  admitPageHandoff(input = {}) { return this.admitClosedPageHandoff(input); }

  _capsuleInput(input, handoff, runtime, adapter) {
    const raw = clone(input.capsule || input);
    if (hasForbiddenBoundary(raw)) throw new Error("DSS05_CAPSULE_BOUNDARY_FORBIDDEN");
    const value = {
      edgeOccurrenceRef: alias(raw, "edgeOccurrenceRef", "edge_occurrence_ref", "occurrenceRef", "occurrence_id") || handoff.page_ref,
      evidenceMaterializationRef: alias(raw, "evidenceMaterializationRef", "evidence_materialization_ref") || handoff.materialization_ref,
      evidenceMaterializationDigest: alias(raw, "evidenceMaterializationDigest", "evidence_materialization_digest") || handoff.page_digest,
      executionProfileRevisionRef: alias(raw, "executionProfileRevisionRef", "execution_profile_revision_ref") || "dss05-execution-profile-generation-1",
      backendAdapterRevision: adapter.adapter_revision,
      providerProfileRevisionRef: adapter.providerProfileRevisionRef || this._ref("ProviderProfileRevision", { adapter: adapter.adapterRef }),
      model: alias(raw, "model") || adapter.model || "admitted-model",
      reasoningEffort: alias(raw, "reasoningEffort", "reasoning_effort") || "default",
      workerExecutionRuntimeRevisionRef: runtime.runtimeRef,
      modelAdapterRevisionRef: adapter.adapterRef,
      executionPolicyRef: alias(raw, "executionPolicyRef", "execution_policy_ref") || this._ref("ExecutionPolicy", { attemptPolicy: ATTEMPT_POLICY_REVISION }),
      outputSchemaDigest: alias(raw, "outputSchemaDigest", "output_schema_digest") || OUTPUT_SCHEMA_DIGEST,
      compilerPinRef: alias(raw, "compilerPinRef", "compiler_pin_ref") || this._ref("CompilerPin", { predecessor: DSS04_IMPLEMENTATION_SOURCE }),
      dss04_service_generation: handoff.dss04_service_generation,
      dss05_service_generation: this.serviceGeneration,
      capsule_revision: alias(raw, "capsule_revision", "capsuleRevision") || CAPSULE_REVISION,
      pageRef: handoff.page_ref, materializationRef: handoff.materialization_ref, batchSealRef: handoff.batch_seal_ref,
      routePopulationDigest: handoff.route_population_digest, completenessReceiptRef: handoff.completeness_receipt_ref, sufficiencyReceiptRef: handoff.sufficiency_receipt_ref
    };
    value.capsuleRef = alias(raw, "capsuleRef", "capsule_ref") || this._ref("ExecutionCapsule", value);
    if (alias(raw, "capsuleRef", "capsule_ref") && value.capsuleRef !== this._ref("ExecutionCapsule", value)) throw new Error("DSS05_CAPSULE_IDENTITY_CONFLICT");
    return value;
  }

  _runtimeAndAdapterCurrent(runtime, adapter) { return Boolean(runtime && adapter && runtime.state === "ADMITTED" && adapter.state === "ADMITTED" && adapter.workerExecutionRuntimeRevisionRef === runtime.runtimeRef && this._current(runtime.dss05_service_generation) && this._current(adapter.dss05_service_generation) && this._runtime()?.runtimeRef === runtime.runtimeRef && this._adapter()?.adapterRef === adapter.adapterRef); }

  admitClosedPageToCapsule(input = {}) {
    const before = this._snapshot();
    try {
      const handoff = this._handoff(); const runtime = this._runtime(); const adapter = this._adapter();
      if (!handoff || !this._runtimeAndAdapterCurrent(runtime, adapter)) return result("STALE_PREDECESSOR");
      const suppliedHandoff = input.handoff || input.pageHandoff || input.page; if (suppliedHandoff && alias(suppliedHandoff, "page_ref", "pageRef") && alias(suppliedHandoff, "page_ref", "pageRef") !== handoff.page_ref) return result("IDEMPOTENCY_CONFLICT");
      const capsule = this._capsuleInput(input, handoff, runtime, adapter);
      const operationInput = { handoff: handoff.handoffRef, runtime: runtime.runtimeRef, adapter: adapter.adapterRef, capsuleIdentity: objectWithout(capsule, ["capsuleRef"]) };
      const key = this._opKey("admit-closed-page-handoff", operationInput); const previous = this.state.operationInputs["admit-closed-page-handoff"];
      const capsulePrevious = this.state.operationInputs["admit-closed-page-handoff:capsule"];
      if (capsulePrevious) {
        if (capsulePrevious.inputDigest !== key) return result("IDEMPOTENCY_CONFLICT");
        const existing = this.state.capsules[capsulePrevious.ref]; return result("REPLAYED", { handoff: clone(handoff), capsule: clone(existing) });
      }
      const existing = this.state.capsules[capsule.capsuleRef]; if (existing) return result("REPLAYED", { handoff: clone(handoff), capsule: clone(existing) });
      const value = { ...capsule, state: "ADMITTED", authorityEffect: AUTH_NONE, admittedAt: this.clock() };
      handoff.capsuleRef = value.capsuleRef; this._set("capsules", value.capsuleRef, value); this._remember("admit-closed-page-handoff:capsule", key, value.capsuleRef, operationInput);
      this._transition("admit-closed-page-handoff", "d.execution-capsule", "ADMIT", value, "ADMITTED", "ABSENT", "ADMITTED"); this._persist();
      return result("ADMITTED", { handoff: clone(handoff), capsule: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); if (["DSS05_CAPSULE_IDENTITY_CONFLICT", "DSS05_CAPSULE_BOUNDARY_FORBIDDEN"].includes(error.message)) { this._transition("admit-closed-page-handoff", "d.execution-capsule", "REJECT", { reason: "ISOLATION_EXCLUSION_VIOLATED", detail: error.message }, "REJECTED", "ABSENT", "REJECTED"); this._persist(); return result("REJECTED", { reason: "ISOLATION_EXCLUSION_VIOLATED" }); } throw error; }
  }

  admitClosedPage(input = {}) { return this.admitClosedPageToCapsule(input); }

  buildCanonicalExecutionRequest(input = {}) {
    const before = this._snapshot();
    try {
      if (hasForbiddenBoundary(input)) { const operationName = "build-canonical-execution-request:reject"; const operationInput = { capsuleRef: alias(input, "capsuleRef", "capsule_ref") || null, forbiddenInputDigest: this._ref("RejectedCallerRequest", input) }; const key = this._opKey("build-canonical-execution-request", operationInput); const prior = this._operationReplay(operationName, key); if (prior) return prior; this._remember(operationName, key, null, operationInput); this._transition("build-canonical-execution-request", "d.execution-request", "REJECT", { reason: "CANONICAL_REQUEST_REJECTED", forbiddenInputDigest: operationInput.forbiddenInputDigest }, "REJECTED", "ABSENT", "REJECTED"); this._persist(); return result("REJECTED", { reason: "CANONICAL_REQUEST_REJECTED" }); }
      const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || input.capsule?.capsuleRef); if (!capsule || capsule.state !== "ADMITTED") return result("STALE_PREDECESSOR");
      const adapter = this._stateAt("adapters", capsule.modelAdapterRevisionRef) || this._adapter(); const runtime = this._stateAt("runtimes", capsule.workerExecutionRuntimeRevisionRef); if (!adapter || adapter.state !== "ADMITTED" || adapter.adapterRef !== capsule.modelAdapterRevisionRef || !runtime || runtime.state !== "ADMITTED" || runtime.runtimeRef !== capsule.workerExecutionRuntimeRevisionRef) return result("STALE_PREDECESSOR");
      const canonical = { schema: "direct-semantic-service-dss05-canonical-request.v1", capsuleRef: capsule.capsuleRef, edgeOccurrenceRef: capsule.edgeOccurrenceRef, evidenceMaterializationRef: capsule.evidenceMaterializationRef, evidenceMaterializationDigest: capsule.evidenceMaterializationDigest, model: capsule.model, reasoningEffort: capsule.reasoningEffort, outputSchemaDigest: capsule.outputSchemaDigest, adapterRevision: adapter.adapter_revision, requestMappingDigest: adapter.requestMappingDigest, executionPolicyRef: capsule.executionPolicyRef };
      const identity = { capsuleRef: capsule.capsuleRef, adapterRevision: adapter.adapter_revision, modelAdapterRevisionRef: adapter.adapterRef, inputProjectionDigest: this._ref("InputProjection", canonical), canonicalRequestDigest: this._ref("CanonicalRequest", canonical), requestSchemaDigest: this._ref("RequestSchema", { schema: canonical.schema }), dss05_service_generation: this.serviceGeneration, request_revision: REQUEST_REVISION };
      const key = this._opKey("build-canonical-execution-request", identity); const prior = this._operationReplay("build-canonical-execution-request", key, "requests"); if (prior) return prior;
      const ref = this._ref("ExecutionRequest", identity); const value = { ...identity, requestRef: ref, canonical, state: "BUILT", authorityEffect: AUTH_NONE, builtAt: this.clock() };
      this._set("requests", ref, value); this._remember("build-canonical-execution-request", key, ref, identity); this._transition("build-canonical-execution-request", "d.execution-request", "BUILD", value, "BUILT", "ABSENT", "BUILT"); this._persist(); return result("BUILT", { request: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  buildExecutionRequest(input = {}) { return this.buildCanonicalExecutionRequest(input); }

  expireExecutionCapsule(input = {}) {
    const before = this._snapshot();
    try {
      const ref = alias(input, "capsuleRef", "capsule_ref") || input.capsule?.capsuleRef; const capsule = this._capsule(ref); if (!capsule || capsule.state !== "ADMITTED") return capsule?.state === "EXPIRED" ? result("REPLAYED", { capsule: clone(capsule) }) : result("STALE_PREDECESSOR");
      const key = this._opKey("expire-execution-capsule", { capsuleRef: capsule.capsuleRef, serviceGeneration: this.serviceGeneration }); const prior = this._operationReplay("expire-execution-capsule", key, "capsules"); if (prior) return prior;
      capsule.state = "EXPIRED"; capsule.expiredAt = this.clock(); this._remember("expire-execution-capsule", key, capsule.capsuleRef, { capsuleRef: capsule.capsuleRef }); this._transition("expire-execution-capsule", "d.execution-capsule", "EXPIRE", capsule, "EXPIRED", "ADMITTED", "EXPIRED"); this._persist(); return result("EXPIRED", { capsule: clone(capsule) });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  allocateExecutionAttempt(input = {}) {
    const before = this._snapshot();
    try {
      const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || input.capsule?.capsuleRef); const request = this._request(alias(input, "requestRef", "request_ref") || input.request?.requestRef || capsule?.capsuleRef); if (!this._validCurrentTuple(capsule, request)) return result("STALE_PREDECESSOR");
      if (input.budgetAvailable === false || input.overBudget === true) return result("OVER_BUDGET");
      const slot = alias(input, "replicateSlotRef", "replicate_slot_ref", "slotRef") || "dss05-replicate-slot-0"; const ordinal = Number.isSafeInteger(input.ordinal) ? input.ordinal : 0;
      const existing = Object.values(this.state.attempts).filter((attempt) => attempt.capsuleRef === capsule.capsuleRef && attempt.replicateSlotRef === slot).sort((left, right) => String(left.allocatedAt).localeCompare(String(right.allocatedAt))).at(-1);
      const operationInput = { capsuleRef: capsule.capsuleRef, requestRef: request.requestRef, replicateSlotRef: slot, ordinal, priorAttemptRef: alias(input, "priorAttemptRef", "prior_attempt_ref") || existing?.attemptRef || null, attemptPolicyRevision: ATTEMPT_POLICY_REVISION };
      const operationName = `allocate-execution-attempt:${capsule.capsuleRef}:${slot}`; const key = this._opKey("allocate-execution-attempt", operationInput); const prior = this._operationReplay(operationName, key, "attempts"); const retryDeclaration = existing && input.priorAttemptRef === existing.attemptRef && TERMINAL_ATTEMPT_STATES.has(existing.state) && RETRYABLE.has(existing.failureClass);
      if (prior && !retryDeclaration) return prior;
      if (existing && !retryDeclaration) { if (existing.attemptLineageDigest === this._ref("AttemptLineage", operationInput)) return result("REPLAYED", { attempt: clone(existing) }); return result("IDEMPOTENCY_CONFLICT"); }
      const identity = { attemptRef: this._ref("ExecutionAttempt", operationInput), jobRef: alias(input, "jobRef", "job_ref") || `job:${capsule.capsuleRef}`, capsuleRef: capsule.capsuleRef, ordinal, replicateSlotRef: slot, priorAttemptRef: operationInput.priorAttemptRef, attemptLineageDigest: this._ref("AttemptLineage", operationInput), allocatedAt: this.clock(), dss05_service_generation: this.serviceGeneration, runtime_revision: this._runtime()?.runtime_revision, workerExecutionRuntimeRevisionRef: capsule.workerExecutionRuntimeRevisionRef, adapter_revision: this._adapter()?.adapter_revision, modelAdapterRevisionRef: capsule.modelAdapterRevisionRef || capsule.backendAdapterRevision, attempt_policy_revision: ATTEMPT_POLICY_REVISION };
      const value = { ...identity, state: "ALLOCATED", authorityEffect: AUTH_NONE }; this._set("attempts", value.attemptRef, value); this._remember(operationName, key, value.attemptRef, operationInput); this._transition("allocate-execution-attempt", "d.execution-attempt", "ALLOCATE", value, "ALLOCATED", "ABSENT", "ALLOCATED"); this._persist(); return result("ALLOCATED", { attempt: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  allocateAttempt(input = {}) { return this.allocateExecutionAttempt(input); }

  dispatchExecutionAttempt(input = {}) {
    const before = this._snapshot();
    try {
      const attempt = this._attempt(alias(input, "attemptRef", "attempt_ref") || input.attempt?.attemptRef); const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || attempt?.capsuleRef); const request = this._request(alias(input, "requestRef", "request_ref") || input.request?.requestRef || capsule?.capsuleRef); const runtime = this._runtime(); const adapter = this._adapter();
      if (!this._validCurrentTuple(capsule, request, attempt) || !this._runtimeAndAdapterCurrent(runtime, adapter)) return result("STALE_GENERATION");
      if (attempt.state === "STARTED") return result("REPLAYED", { attempt: clone(attempt), request: clone(request) });
      if (attempt.state !== "ALLOCATED" || !["BUILT", "DISPATCHED"].includes(request.state)) return result("IDEMPOTENCY_CONFLICT");
      const evidence = adapter.providerRuntimeEvidenceDigest; const admitted = input.providerRuntimeEvidence?.admitted === true || input.providerAvailable === true || input.transportAvailable === true || adapter.standing === "ADMITTED_RUNTIME_EVIDENCE_ONLY";
      if (!evidence || !admitted || input.providerAvailable === false || input.transportAvailable === false || adapter.model === "spark" || adapter.standing === "EXCLUDED_DEFERRED") return result("TRANSPORT_UNAVAILABLE_BEFORE_DISPATCH", { reason: "UNAVAILABLE_BEFORE_DISPATCH" });
      const operationInput = { attemptRef: attempt.attemptRef, requestRef: request.requestRef, capsuleRef: capsule.capsuleRef, runtime: runtime.runtimeRef, adapter: adapter.adapterRef, dispatchBoundary: input.dispatchBoundary || "one-boundary" }; const operationName = `dispatch-execution-attempt:${attempt.attemptRef}`; const key = this._opKey("dispatch-execution-attempt", operationInput); const prior = this._operationReplay(operationName, key, "attempts"); if (prior) return prior;
      if (request.state === "BUILT") { request.state = "DISPATCHED"; request.dispatchedAt = this.clock(); request.dispatchBoundaryDigest = this._ref("DispatchBoundary", operationInput); this._transition("dispatch-execution-attempt", "d.execution-request", "DISPATCH", request, "DISPATCHED", "BUILT", "DISPATCHED"); }
      attempt.state = "STARTED"; attempt.backendProcessRef = alias(input, "backendProcessRef", "backend_process_ref") || this._ref("WorkerProcess", { attempt: attempt.attemptRef, dispatch: request.dispatchBoundaryDigest }); attempt.startedAt = this.clock(); this._remember(operationName, key, attempt.attemptRef, operationInput);
      this._transition("dispatch-execution-attempt", "d.execution-attempt", "START", attempt, "STARTED", "ALLOCATED", "STARTED"); this._persist(); return result("STARTED", { request: clone(request), attempt: clone(attempt) });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  dispatchAttempt(input = {}) { return this.dispatchExecutionAttempt(input); }

  _rawBytes(raw) { if (Buffer.isBuffer(raw)) return Buffer.from(raw); if (typeof raw === "string") return Buffer.from(raw, "utf8"); return Buffer.from(canonicalJson(raw), "utf8"); }
  _quarantinePath(rawDigest) { return path.join(this.quarantineRoot, `${rawDigest.slice(7)}.raw`); }
  _rejectRawCapture(attempt, capsule, adapter, terminal, reason, bytes = null) {
    const rawDigest = bytes ? `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` : null;
    const operationName = `capture-quarantine-raw-result:${attempt.attemptRef}`; const operationInput = { attemptRef: attempt.attemptRef, processRef: attempt.backendProcessRef || null, terminal, rawDigest, reason }; const key = this._opKey("capture-quarantine-raw-result", operationInput); const prior = this._operationReplay(operationName, key); if (prior) return prior;
    const identity = { rawResultRef: this._ref("RejectedRawResult", { attemptRef: attempt.attemptRef, terminal, rawDigest, reason }), attemptRef: attempt.attemptRef, backendProcessRef: attempt.backendProcessRef || null, providerTerminalKind: terminal, mediaType: "application/octet-stream", rawResultDigest: rawDigest || this._ref("RejectedRawBytes", { attempt: attempt.attemptRef, reason }), rawByteCount: bytes?.length || 0, quarantineObjectRef: this._ref("RejectedQuarantineObject", { attempt: attempt.attemptRef, reason }), capturedAt: this.clock(), capsuleRef: capsule.capsuleRef, workerExecutionRuntimeRevisionRef: capsule.workerExecutionRuntimeRevisionRef, modelAdapterRevisionRef: adapter.adapterRef, quarantine_revision: QUARANTINE_REVISION, state: "REJECTED", rejectionReason: reason, authorityEffect: AUTH_NONE };
    this._remember(operationName, key, null, operationInput);
    this._transition("capture-quarantine-raw-result", "e.raw-result-custody", "REJECT", identity, "RAW_CAPTURE_REJECTED", "CAPTURED", "REJECTED"); this._persist();
    return result("RAW_CAPTURE_REJECTED", { rawResult: identity, reason });
  }
  captureQuarantineRawResult(input = {}) {
    const before = this._snapshot();
    try {
      const attempt = this._attempt(alias(input, "attemptRef", "attempt_ref") || input.attempt?.attemptRef); const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || attempt?.capsuleRef); const adapter = this._stateAt("adapters", capsule?.modelAdapterRevisionRef) || this._adapter(); const runtime = this._stateAt("runtimes", capsule?.workerExecutionRuntimeRevisionRef); if (!attempt || !capsule || !adapter || adapter.adapterRef !== capsule.modelAdapterRevisionRef || !this._runtimeAndAdapterCurrent(runtime, adapter) || !this._validCurrentTuple(capsule, null, attempt)) return result("STALE_PREDECESSOR");
      const terminal = String(alias(input, "terminal", "terminalKind", "terminal_kind", "outcome") || (input.raw !== undefined || input.rawResult !== undefined ? "COMPLETE" : "FAIL")).toUpperCase();
      const terminalMap = { COMPLETE: ["TERMINAL", "PROVIDER_COMPLETED", "COMPLETE"], PROVIDER_COMPLETED: ["TERMINAL", "PROVIDER_COMPLETED", "COMPLETE"], FAIL: ["FAILED", "PROVIDER_FAILED", "FAIL"], PROVIDER_FAILED: ["FAILED", "PROVIDER_FAILED", "FAIL"], INTERRUPT: ["INTERRUPTED", "TRANSPORT_INTERRUPTED", "INTERRUPT"], TRANSPORT_INTERRUPTED: ["INTERRUPTED", "TRANSPORT_INTERRUPTED", "INTERRUPT"], TIMEOUT: ["TIMED_OUT", "TIMEOUT", "TIMEOUT"], UNKNOWN_TERMINAL: ["UNKNOWN_TERMINAL", "UNKNOWN_TERMINAL", "UNKNOWN_TERMINAL"] }; const mapped = terminalMap[terminal] || terminalMap.FAIL;
      const hasRaw = input.raw !== undefined || input.rawResult !== undefined || input.providerResult !== undefined;
      const replayProcessRef = alias(input, "backendProcessRef", "backend_process_ref") || attempt.backendProcessRef || null;
      let replayRawDigest = null;
      if (hasRaw) { const replayBytes = this._rawBytes(input.raw !== undefined ? input.raw : input.rawResult !== undefined ? input.rawResult : input.providerResult); if (replayBytes.length === 0 || replayBytes.length > 1024 * 1024) return this._rejectRawCapture(attempt, capsule, adapter, mapped[1], "OUTPUT_BYTE_LIMIT", replayBytes); replayRawDigest = `sha256:${crypto.createHash("sha256").update(replayBytes).digest("hex")}`; }
      const replayOperation = `capture-quarantine-raw-result:${attempt.attemptRef}`;
      const replayInput = hasRaw ? { attemptRef: attempt.attemptRef, processRef: replayProcessRef, rawDigest: replayRawDigest, terminal } : { attemptRef: attempt.attemptRef, processRef: replayProcessRef, terminal, errorClass: alias(input, "failureClass", "failure_class", "reason") || null };
      const replayKey = this._opKey("capture-quarantine-raw-result", replayInput);
      if (attempt.state !== "STARTED") {
        const previous = this.state.operationInputs[replayOperation];
        if (previous && previous.inputDigest === replayKey) return result("REPLAYED", { attempt: clone(attempt), rawResult: previous.ref ? clone(this.state.rawResults[previous.ref]) : null });
        return result("IDEMPOTENCY_CONFLICT", { reason: "TERMINAL_RACE_REJECTED", attempt: clone(attempt) });
      }
      let rawRecord = null; let rawDigest = null;
      if (hasRaw) {
        const bytes = this._rawBytes(input.raw !== undefined ? input.raw : input.rawResult !== undefined ? input.rawResult : input.providerResult); if (bytes.length === 0 || bytes.length > 1024 * 1024) return this._rejectRawCapture(attempt, capsule, adapter, mapped[1], "OUTPUT_BYTE_LIMIT", bytes);
        rawDigest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; const processRef = alias(input, "backendProcessRef", "backend_process_ref") || attempt.backendProcessRef; const identity = { rawResultRef: this._ref("RawResultIdentity", { attemptRef: attempt.attemptRef, processRef, rawDigest, terminal: mapped[1] }), attemptRef: attempt.attemptRef, backendProcessRef: processRef, providerTerminalKind: mapped[1], mediaType: alias(input, "mediaType", "media_type") || "application/json", rawResultDigest: rawDigest, rawByteCount: bytes.length, quarantineObjectRef: this._ref("QuarantineObject", { rawDigest, attemptRef: attempt.attemptRef }), capturedAt: this.clock(), capsuleRef: capsule.capsuleRef, workerExecutionRuntimeRevisionRef: capsule.workerExecutionRuntimeRevisionRef, modelAdapterRevisionRef: adapter.adapterRef, quarantine_revision: QUARANTINE_REVISION };
        const ref = identity.rawResultRef; const operationName = `capture-quarantine-raw-result:${attempt.attemptRef}`; const operationInput = { attemptRef: attempt.attemptRef, processRef, rawDigest, terminal }; const key = this._opKey("capture-quarantine-raw-result", operationInput); const prior = this._operationReplay(operationName, key, "rawResults", ref); if (prior) return prior;
        const file = this._quarantinePath(rawDigest); if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) return this._rejectRawCapture(attempt, capsule, adapter, mapped[1], "QUARANTINE_DIGEST_MISMATCH", bytes); if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { mode: 0o600 }); const observed = fs.readFileSync(file); if (!observed.equals(bytes)) return this._rejectRawCapture(attempt, capsule, adapter, mapped[1], "QUARANTINE_DIGEST_MISMATCH", bytes);
        rawRecord = { ...identity, rawResultRef: ref, state: "CAPTURED", quarantinePath: path.relative(this.store.root, file), authorityEffect: AUTH_NONE }; this._set("rawResults", ref, rawRecord); this._remember(operationName, key, ref, operationInput); this._transition("capture-quarantine-raw-result", "e.raw-result-custody", "CAPTURE", { ...rawRecord, rawPayload: undefined }, "CAPTURED", "ABSENT", "CAPTURED"); rawRecord.state = "QUARANTINED"; rawRecord.quarantinedAt = this.clock(); this._transition("capture-quarantine-raw-result", "e.raw-result-custody", "QUARANTINE", rawRecord, "QUARANTINED", "CAPTURED", "QUARANTINED");
      } else {
        const operationInput = { attemptRef: attempt.attemptRef, processRef: attempt.backendProcessRef || null, terminal, errorClass: alias(input, "failureClass", "failure_class", "reason") || null }; const operationName = `capture-quarantine-raw-result:${attempt.attemptRef}`; const key = this._opKey("capture-quarantine-raw-result", operationInput); const prior = this._operationReplay(operationName, key, "attempts"); if (prior) return prior; this._remember(operationName, key, attempt.attemptRef, operationInput);
      }
      attempt.state = mapped[0]; attempt.providerTerminalKind = mapped[1]; attempt.rawResultRef = rawRecord?.rawResultRef || null; const failureClass = alias(input, "failureClass", "failure_class", "reason") || (mapped[1] === "PROVIDER_FAILED" ? "runtime_failed_before_raw_capture" : null); if (failureClass) attempt.failureClass = failureClass; else delete attempt.failureClass; attempt.terminalAt = this.clock();
      this._transition("capture-quarantine-raw-result", "d.execution-attempt", mapped[2], attempt, mapped[1], "STARTED", mapped[0]); this._persist(); return result(rawRecord ? "QUARANTINED" : mapped[1], { attempt: clone(attempt), rawResult: rawRecord ? clone(rawRecord) : null });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  captureRawResult(input = {}) { return this.captureQuarantineRawResult(input); }

  _rawDocument(rawRecord) {
    const file = path.resolve(this.store.root, rawRecord.quarantinePath || ""); if (!file.startsWith(`${this.quarantineRoot}${path.sep}`) || !fs.existsSync(file)) return { status: "MISSING" };
    const bytes = fs.readFileSync(file); const actual = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (actual !== rawRecord.rawResultDigest || bytes.length !== rawRecord.rawByteCount) return { status: "CORRUPT" }; try { return { status: "OK", document: JSON.parse(bytes.toString("utf8")) }; } catch (_) { return { status: "INVALID_JSON" }; }
  }

  _recordCanonicalRejection(raw, attempt, capsule, rejection) {
    attempt.failureClass = "raw_result_structural_rejection";
    const identity = { rawResultRef: raw.rawResultRef, attemptRef: attempt.attemptRef, capsuleRef: capsule.capsuleRef, outputSchemaDigest: OUTPUT_SCHEMA_DIGEST, rejection };
    const operationName = `admit-canonical-response:${raw.rawResultRef}`; const operationInput = { ...identity }; const key = this._opKey("admit-canonical-response", operationInput); const prior = this._operationReplay(operationName, key, "responses"); if (prior) return prior;
    const ref = this._ref("CanonicalResponse", identity);
    const response = { ...identity, microResultRef: ref, state: "REJECTED", reason: "RAW_RESULT_STRUCTURAL_REJECTION", authorityEffect: AUTH_NONE, recordedAt: this.clock() };
    this._set("responses", ref, response); this._remember(operationName, key, ref, operationInput); this._transition("admit-canonical-response", "d.canonical-response", "REJECT", identity, "RAW_RESULT_STRUCTURAL_REJECTION", "ABSENT", "REJECTED"); this._persist();
    return result("RAW_RESULT_STRUCTURAL_REJECTION", { response });
  }

  admitCanonicalResponse(input = {}) {
    const before = this._snapshot();
    try {
      const raw = this._stateAt("rawResults", alias(input, "rawResultRef", "raw_result_ref") || input.rawResult?.rawResultRef); const attempt = this._attempt(alias(input, "attemptRef", "attempt_ref") || raw?.attemptRef); const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || attempt?.capsuleRef); if (!raw || !attempt || !capsule || raw.attemptRef !== attempt.attemptRef || raw.state !== "QUARANTINED" || !this._validCurrentTuple(capsule, null, attempt)) return result("STALE_PREDECESSOR");
      const parsed = this._rawDocument(raw); if (parsed.status === "MISSING") return result("STALE_PREDECESSOR"); if (parsed.status === "CORRUPT") return result("BINDING_REJECTION", { reason: "RAW_DIGEST_MISMATCH" }); if (parsed.status !== "OK" || !parsed.document || typeof parsed.document !== "object" || Array.isArray(parsed.document)) return this._recordCanonicalRejection(raw, attempt, capsule, parsed.status);
      const doc = parsed.document; const bindings = [["attemptRef", attempt.attemptRef], ["attempt_ref", attempt.attemptRef], ["capsuleRef", capsule.capsuleRef], ["capsule_ref", capsule.capsuleRef], ["edgeOccurrenceRef", capsule.edgeOccurrenceRef], ["edge_occurrence_ref", capsule.edgeOccurrenceRef]]; if (bindings.some(([key, expected]) => doc[key] !== undefined && doc[key] !== expected)) return result("BINDING_REJECTION", { reason: "RAW_BINDING_MISMATCH" });
      const statusRaw = String(doc.resultStatus || doc.result_status || doc.status || doc.verdict || "").toUpperCase(); const status = { SUPPORTS: "SUPPORTS", REFUTES: "REFUTES", INCONCLUSIVE: "INCONCLUSIVE", REMANDS: "REMANDS", REMAND: "REMANDS" }[statusRaw]; if (!status) return this._recordCanonicalRejection(raw, attempt, capsule, "STRUCTURAL");
      const claims = clone(doc.typedClaims || doc.claims || []); const evidenceRefs = clone(doc.evidenceRefs || doc.evidence_refs || []); if (!Array.isArray(claims) || !Array.isArray(evidenceRefs)) return this._recordCanonicalRejection(raw, attempt, capsule, "CLAIMS_SHAPE");
      const identity = { kernelRef: "advisory-kernel:none", capsuleRef: capsule.capsuleRef, attemptRef: attempt.attemptRef, edgeOccurrenceRef: capsule.edgeOccurrenceRef, evidenceMaterializationRef: capsule.evidenceMaterializationRef, evidenceMaterializationDigest: capsule.evidenceMaterializationDigest, resultStatus: status, typedClaimsDigest: this._ref("TypedClaims", claims), evidenceRefsDigest: this._ref("EvidenceRefs", evidenceRefs), dss05_service_generation: this.serviceGeneration, outputSchemaDigest: OUTPUT_SCHEMA_DIGEST, canonical_response_revision: "dss05-canonical-response-generation-1", rawResultRef: raw.rawResultRef };
      const operationName = `admit-canonical-response:${raw.rawResultRef}`; const key = this._opKey("admit-canonical-response", identity); const prior = this._operationReplay(operationName, key, "responses"); if (prior) return prior;
      const ref = this._ref("CanonicalResponse", identity); const value = { ...identity, microResultRef: ref, state: status === "REMANDS" ? "REMANDED" : "ADMITTED", typedClaims: claims, evidenceRefs, authorityEffect: AUTH_NONE, admittedAt: this.clock() }; this._set("responses", ref, value); this._remember(operationName, key, ref, identity); this._transition("admit-canonical-response", "d.canonical-response", status === "REMANDS" ? "REMAND" : "ADMIT", value, status === "REMANDS" ? "REMANDED" : "ADMITTED", "ABSENT", value.state); this._persist(); return result(value.state, { response: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  admitResponse(input = {}) { return this.admitCanonicalResponse(input); }

  _recordUsageRejection(attempt, request, raw, reason) {
    const identity = { attemptRef: attempt.attemptRef, requestDigest: request.canonicalRequestDigest, rawResultDigest: raw?.rawResultDigest || this._ref("MissingRawResult", attempt.attemptRef), providerUsageDigest: this._ref("RejectedProviderUsage", { attempt: attempt.attemptRef, reason }), transportStatus: attempt.providerTerminalKind || "UNAVAILABLE", accountingStatus: "REJECTED", capsuleRef: attempt.capsuleRef, adapterRevision: this._adapter()?.adapterRef || null, usage_schema_revision: USAGE_REVISION };
    const operationName = `record-provider-usage:${attempt.attemptRef}`; const key = this._opKey("record-provider-usage", identity); const prior = this._operationReplay(operationName, key, "usage"); if (prior) return prior;
    const ref = this._ref("UsageReceipt", identity); const value = { ...identity, usageReceiptRef: ref, state: "REJECTED", reason, usage: null, authorityEffect: AUTH_NONE, recordedAt: this.clock() };
    this._set("usage", ref, value); this._remember(operationName, key, ref, identity); this._transition("record-provider-usage", "e.usage-receipt", "REJECT", value, "REJECTED", "ABSENT", "REJECTED"); this._persist(); return result("REJECTED", { usage: value });
  }

  recordProviderUsage(input = {}) {
    const before = this._snapshot();
    try {
      const attempt = this._attempt(alias(input, "attemptRef", "attempt_ref") || input.attempt?.attemptRef); const request = this._request(alias(input, "requestRef", "request_ref") || input.request?.requestRef || attempt?.capsuleRef); const raw = this._stateAt("rawResults", alias(input, "rawResultRef", "raw_result_ref") || input.rawResult?.rawResultRef) || null; const capsule = this._capsule(attempt?.capsuleRef); if (!attempt || !request || !capsule || (raw && raw.attemptRef !== attempt.attemptRef) || !this._validCurrentTuple(capsule, request, attempt)) return result("STALE_PREDECESSOR");
      const usage = input.usage !== undefined ? input.usage : input.providerUsage !== undefined ? input.providerUsage : input.provider_usage; if (usage !== undefined && usage !== null && (typeof usage !== "object" || Array.isArray(usage))) return this._recordUsageRejection(attempt, request, raw, "USAGE_SHAPE"); const transportStatus = alias(input, "transportStatus", "transport_status") || attempt.providerTerminalKind || "UNAVAILABLE"; const accountingStatus = usage && typeof usage === "object" ? "RECORDED" : "INCOMPLETE"; const providerUsageDigest = usage ? this._ref("ProviderUsage", usage) : this._ref("ProviderUsageUnavailable", { attempt: attempt.attemptRef, transportStatus }); const identity = { attemptRef: attempt.attemptRef, requestDigest: request.canonicalRequestDigest, rawResultDigest: raw?.rawResultDigest || this._ref("MissingRawResult", attempt.attemptRef), providerUsageDigest, transportStatus, accountingStatus, capsuleRef: attempt.capsuleRef, adapterRevision: this._adapter()?.adapterRef || this._ref("MissingAdapter", attempt.attemptRef), usage_schema_revision: USAGE_REVISION };
      const operationName = `record-provider-usage:${attempt.attemptRef}`; const key = this._opKey("record-provider-usage", identity); const prior = this._operationReplay(operationName, key, "usage"); if (prior) return prior;
      const ref = this._ref("UsageReceipt", identity); const value = { ...identity, usageReceiptRef: ref, state: accountingStatus, usage: usage ? clone(usage) : null, authorityEffect: AUTH_NONE, recordedAt: this.clock() }; this._set("usage", ref, value); this._remember(operationName, key, ref, identity); this._transition("record-provider-usage", "e.usage-receipt", accountingStatus === "RECORDED" ? "RECORD" : "MARK_INCOMPLETE", value, accountingStatus, "ABSENT", accountingStatus); this._persist(); return result(accountingStatus, { usage: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  recordUsage(input = {}) { return this.recordProviderUsage(input); }

  evaluateExecutionCell(input = {}) {
    const before = this._snapshot();
    try {
      const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || input.capsule?.capsuleRef); const attempt = this._attempt(alias(input, "attemptRef", "attempt_ref") || input.attempt?.attemptRef); const response = this._stateAt("responses", alias(input, "microResultRef", "micro_result_ref", "responseRef") || input.response?.microResultRef || input.response?.responseRef); const usage = this._stateAt("usage", alias(input, "usageReceiptRef", "usage_receipt_ref") || input.usage?.usageReceiptRef); if (!capsule || !attempt || (response && response.attemptRef !== attempt.attemptRef) || (usage && usage.attemptRef !== attempt.attemptRef) || !this._validCurrentTuple(capsule, null, attempt)) return result("STALE_PREDECESSOR");
      const operationInput = { capsuleRef: capsule.capsuleRef, attemptRef: attempt.attemptRef, responseRef: response?.microResultRef || null, usageRef: usage?.usageReceiptRef || null, evaluationPolicyRevision: EVALUATION_REVISION }; const operationName = `evaluate-execution-cell:${attempt.attemptRef}`; const key = this._opKey("evaluate-execution-cell", operationInput); const prior = this._operationReplay(operationName, key, "evaluations"); if (prior) return prior;
      if (!response && TERMINAL_ATTEMPT_STATES.has(attempt.state)) {
        const priorAttemptState = attempt.state; if (attempt.state !== "CANCELLED_PRESTART" && attempt.state !== "UNKNOWN_TERMINAL") { attempt.state = "EXHAUSTED"; this._transition("evaluate-execution-cell", "d.execution-attempt", "EXHAUST", attempt, "ATTEMPT_EXHAUSTED", priorAttemptState, "EXHAUSTED"); }
        const identity = { executionPlanRef: capsule.executionPolicyRef, cellRef: capsule.edgeOccurrenceRef, microResultRefsDigest: this._ref("MicroResultRefs", []), attestationRefsDigest: this._ref("AttestationRefs", []), evaluationPolicyRef: EVALUATION_REVISION, dissentRefsDigest: this._ref("DissentRefs", []), unmetAssuranceRefsDigest: this._ref("UnmetAssuranceRefs", [attempt.failureClass || attempt.state]), dss05_service_generation: this.serviceGeneration, attemptRef: attempt.attemptRef }; const ref = this._ref("ExecutionEvaluation", identity); const value = { ...identity, evaluationRef: ref, state: "REMANDED", standing: "ATTEMPT_EXHAUSTED", authorityEffect: AUTH_NONE, recordedAt: this.clock() }; this._set("evaluations", ref, value); this._remember(operationName, key, ref, operationInput); this._transition("evaluate-execution-cell", "d.execution-evaluation", "REMAND", value, "REMANDED", "ABSENT", "REMANDED"); this._persist(); return result("ATTEMPT_EXHAUSTED", { evaluation: value, attempt: clone(attempt) });
      }
      if (!response || !usage) return this._recordEvaluationRejection(capsule, attempt, response, usage, operationName, key, operationInput, "COMPLETE_POPULATION_REQUIRED");
      const standing = response.state === "REJECTED" ? "REJECTED" : response.state === "REMANDED" || usage.state === "INCOMPLETE" ? "REMANDED" : response.resultStatus; const identity = { executionPlanRef: capsule.executionPolicyRef, cellRef: capsule.edgeOccurrenceRef, microResultRefsDigest: this._ref("MicroResultRefs", [response.microResultRef]), attestationRefsDigest: this._ref("AttestationRefs", [usage.usageReceiptRef]), evaluationPolicyRef: EVALUATION_REVISION, dissentRefsDigest: this._ref("DissentRefs", []), unmetAssuranceRefsDigest: this._ref("UnmetAssuranceRefs", standing === "REMANDED" || standing === "REJECTED" ? ["usage-or-response-remand"] : []), dss05_service_generation: this.serviceGeneration, attemptRef: attempt.attemptRef };
      const ref = this._ref("ExecutionEvaluation", identity); const value = { ...identity, evaluationRef: ref, state: standing === "REMANDED" ? "REMANDED" : standing === "REJECTED" ? "REJECTED" : "RECORDED", standing, authorityEffect: AUTH_NONE, recordedAt: this.clock() }; this._set("evaluations", ref, value); this._remember(operationName, key, ref, operationInput); this._transition("evaluate-execution-cell", "d.execution-evaluation", standing === "REMANDED" ? "REMAND" : standing === "REJECTED" ? "REJECT" : "RECORD", value, value.state, "ABSENT", value.state); this._persist(); return result(value.state, { evaluation: value, attempt: clone(attempt) });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  evaluateCell(input = {}) { return this.evaluateExecutionCell(input); }

  _recordEvaluationRejection(capsule, attempt, response, usage, operationName, key, operationInput, reason) {
    const identity = { executionPlanRef: capsule.executionPolicyRef, cellRef: capsule.edgeOccurrenceRef, microResultRefsDigest: this._ref("MicroResultRefs", response ? [response.microResultRef] : []), attestationRefsDigest: this._ref("AttestationRefs", usage ? [usage.usageReceiptRef] : []), evaluationPolicyRef: EVALUATION_REVISION, dissentRefsDigest: this._ref("DissentRefs", []), unmetAssuranceRefsDigest: this._ref("UnmetAssuranceRefs", [reason]), dss05_service_generation: this.serviceGeneration, attemptRef: attempt.attemptRef };
    const ref = this._ref("ExecutionEvaluation", identity); const value = { ...identity, evaluationRef: ref, state: "REJECTED", standing: "REJECTED", reason, authorityEffect: AUTH_NONE, recordedAt: this.clock() };
    this._set("evaluations", ref, value); this._remember(operationName, key, ref, operationInput); this._transition("evaluate-execution-cell", "d.execution-evaluation", "REJECT", value, "REJECTED", "ABSENT", "REJECTED"); this._persist(); return result("REJECTED", { evaluation: value });
  }

  _coverage(capsule, expectedSlots) {
    const slots = expectedSlots || ["dss05-replicate-slot-0"]; const attempts = slots.map((slot) => Object.values(this.state.attempts).filter((attempt) => attempt.capsuleRef === capsule.capsuleRef && attempt.replicateSlotRef === slot).sort((left, right) => String(left.allocatedAt).localeCompare(String(right.allocatedAt))).at(-1)); const missing = attempts.map((attempt, index) => attempt ? null : slots[index]).filter(Boolean); const rows = attempts.filter(Boolean).map((attempt) => ({ attemptRef: attempt.attemptRef, slot: attempt.replicateSlotRef, state: attempt.state, response: Object.values(this.state.responses).find((response) => response.attemptRef === attempt.attemptRef), usage: Object.values(this.state.usage).find((receipt) => receipt.attemptRef === attempt.attemptRef), evaluation: Object.values(this.state.evaluations).find((evaluation) => evaluation.attemptRef === attempt.attemptRef) })); return { slots, attempts, missing, rows, complete: !missing.length && rows.every((row) => TERMINAL_ATTEMPT_STATES.has(row.state) && row.usage && row.evaluation) };
  }

  sealAdvisoryDisposition(input = {}) {
    const before = this._snapshot();
    try {
      const capsule = this._capsule(alias(input, "capsuleRef", "capsule_ref") || input.capsule?.capsuleRef); if (!capsule) return result("STALE_PREDECESSOR"); const coverage = this._coverage(capsule, input.expectedReplicateSlots || input.expected_replicate_slots); if (coverage.missing.length || !coverage.complete) return result("POPULATION_MISMATCH", { missingSlots: coverage.missing, authorityEffect: AUTH_NONE });
      const operationInput = { capsuleRef: capsule.capsuleRef, slots: coverage.slots, rows: coverage.rows.map((row) => ({ attemptRef: row.attemptRef, state: row.state, response: row.response?.microResultRef || null, usage: row.usage?.usageReceiptRef || null, evaluation: row.evaluation?.evaluationRef || null })) }; const operationName = `seal-advisory-disposition:${capsule.capsuleRef}`; const key = this._opKey("seal-advisory-disposition", operationInput); const prior = this._operationReplay(operationName, key, "dispositions"); if (prior) return prior;
      const statuses = coverage.rows.map((row) => row.response?.resultStatus || row.evaluation?.standing); const state = coverage.rows.some((row) => row.state === "CANCELLED_PRESTART") ? "CANCELLED" : coverage.rows.some((row) => ["FAILED", "INTERRUPTED", "TIMED_OUT", "UNKNOWN_TERMINAL", "EXHAUSTED", "RECOVERY_BLOCKED"].includes(row.state)) || statuses.some((status) => ["REJECTED"].includes(status)) ? "TERMINAL_FAILURES" : statuses.some((status) => ["REMANDED", "ATTEMPT_EXHAUSTED", "INCOMPLETE"].includes(status)) ? "REMANDED" : "SEALED"; const identity = { advisoryDispositionRef: this._ref("AdvisoryDispositionIdentity", operationInput), jobRef: coverage.attempts.find((attempt) => attempt)?.jobRef || `job:${capsule.capsuleRef}`, executionPlanRef: capsule.executionPolicyRef, terminalCoverageReceiptRef: this._ref("TerminalCoverage", operationInput), evaluationRefsDigest: this._ref("EvaluationRefs", coverage.rows.map((row) => row.evaluation.evaluationRef)), openCellRefsDigest: this._ref("OpenCells", []), coveragePosture: state, dss05_service_generation: this.serviceGeneration, selection_policy_revision: DISPOSITION_REVISION };
      const ref = identity.advisoryDispositionRef; const value = { ...identity, advisoryDispositionRef: ref, state, authorityEffect: AUTH_NONE, terminalCoverage: operationInput.rows, sealedAt: this.clock() }; this._set("dispositions", ref, value); this._remember(operationName, key, ref, operationInput); const event = state === "SEALED" ? "SEAL" : state === "REMANDED" ? "REMAND" : state === "CANCELLED" ? "CANCEL" : "FAIL"; this._transition("seal-advisory-disposition", "d.advisory-disposition", event, value, state, "ABSENT", state); this._persist(); return result(state, { disposition: value });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  sealDisposition(input = {}) { return this.sealAdvisoryDisposition(input); }

  cancelExecutionAttempt(input = {}) {
    const before = this._snapshot();
    try {
      const attempt = this._attempt(alias(input, "attemptRef", "attempt_ref") || input.attempt?.attemptRef); if (!attempt) return result("STALE_PREDECESSOR"); const operationName = `cancel-execution-attempt:${attempt.attemptRef}`; const key = this._opKey("cancel-execution-attempt", { attemptRef: attempt.attemptRef, dispatchBoundary: attempt.dispatchBoundaryDigest || null, request: alias(input, "cancellationRef", "cancellation_ref") || null }); const prior = this._operationReplay(operationName, key, "attempts"); if (prior) return prior;
      if (attempt.state === "ALLOCATED") { attempt.state = "CANCELLED_PRESTART"; attempt.cancelledAt = this.clock(); this._remember(operationName, key, attempt.attemptRef, { attemptRef: attempt.attemptRef }); this._transition("cancel-execution-attempt", "d.execution-attempt", "CANCEL", attempt, "CANCELLED_PRESTART", "ALLOCATED", "CANCELLED_PRESTART"); this._persist(); return result("CANCELLED_PRESTART", { attempt: clone(attempt) }); }
      if (attempt.state === "STARTED" || attempt.state === "UNKNOWN_TERMINAL") return result("CANCELLATION_LOST_RACE", { attempt: clone(attempt) });
      if (attempt.state === "TERMINAL") return result("COMPLETE", { attempt: clone(attempt) }); return result("CANCELLATION_LOST_RACE", { attempt: clone(attempt) });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  cancelAttempt(input = {}) { return this.cancelExecutionAttempt(input); }

  _verifyStateEnvelope() {
    if (!this.state || this.state.schema !== "direct_semantic_service_dss05_state@1" || this.state.moduleId !== MODULE_ID || this.state.moduleDigest !== MODULE_DIGEST || this.state.serviceGeneration !== this.serviceGeneration) throw new Error("DSS05_STATE_ENVELOPE_INVALID");
    let prior = null;
    for (const event of this.state.events || []) {
      if (event.priorDigest !== prior) throw new Error("DSS05_EVENT_CHAIN_INVALID");
      const copy = clone(event); delete copy.eventDigest;
      if (event.eventDigest !== digest("Event", copy)) throw new Error("DSS05_EVENT_DIGEST_INVALID");
      const key = `${event.operationId}:${event.carrierId}:${event.event}`;
      const row = TRANSITION_MAP.get(key);
      if (!row) throw new Error("DSS05_EVENT_TRANSITION_INVALID");
      if (event.type !== row.operationId || event.operationId !== row.operationId || event.carrierId !== row.carrierId || event.event !== row.event) throw new Error("DSS05_EVENT_LAW_IDENTITY_INVALID");
      if (event.transitionId !== row.transitionId) throw new Error("DSS05_EVENT_TRANSITION_ID_INVALID");
      if (event.owner !== row.owner) throw new Error("DSS05_EVENT_OWNER_INVALID");
      if (event.priorStateSource !== row.priorStateSource) throw new Error("DSS05_EVENT_PRIOR_STATE_SOURCE_INVALID");
      if (canonicalJson(event.fromStates) !== canonicalJson(row.fromStates)) throw new Error("DSS05_EVENT_FROM_STATES_INVALID");
      if (!row.fromStates.includes(event.fromState)) throw new Error("DSS05_EVENT_FROM_STATE_INVALID");
      if (event.toState !== row.toState) throw new Error("DSS05_EVENT_DESTINATION_INVALID");
      if (!row.outcomeCases.includes(event.outcome)) throw new Error("DSS05_EVENT_OUTCOME_INVALID");
      if (canonicalJson(event.outcomeCases) !== canonicalJson(row.outcomeCases)) throw new Error("DSS05_EVENT_OUTCOME_CASES_INVALID");
      prior = event.eventDigest;
    }
  }
  _sourcePopulationDigest() {
    const source = { handoffs: this.state.handoffs, runtimes: this.state.runtimes, adapters: this.state.adapters, capsules: this.state.capsules, requests: this.state.requests, attempts: this.state.attempts, rawResults: this.state.rawResults, responses: this.state.responses, usage: this.state.usage, evaluations: this.state.evaluations, dispositions: this.state.dispositions, operationInputs: this.state.operationInputs, serviceGeneration: this.state.serviceGeneration };
    return this._ref("AuthoritativeSourcePopulation", source);
  }
  _recoveryChecks() {
    const problems = []; if (this.stateVerificationError) problems.push({ kind: "corrupt", reason: this.stateVerificationError.message });
    for (const [ref, raw] of Object.entries(this.state.rawResults || {})) { const file = path.resolve(this.store.root, raw.quarantinePath || ""); if (!file.startsWith(`${this.quarantineRoot}${path.sep}`) || !fs.existsSync(file)) problems.push({ kind: "gap", reason: `raw-custody-missing.${ref}` }); else { const bytes = fs.readFileSync(file); const actual = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (actual !== raw.rawResultDigest || bytes.length !== raw.rawByteCount) problems.push({ kind: "corrupt", reason: `raw-custody-digest.${ref}` }); } }
    const terminalByAttempt = new Map(); for (const event of this.state.events || []) if (event.carrierId === "d.execution-attempt" && ["COMPLETE", "FAIL", "INTERRUPT", "TIMEOUT", "UNKNOWN_TERMINAL", "CANCEL"].includes(event.event)) { const ref = event.payload?.attemptRef; if (!ref) continue; terminalByAttempt.set(ref, (terminalByAttempt.get(ref) || 0) + 1); } for (const [ref, count] of terminalByAttempt) if (count > 1) problems.push({ kind: "corrupt", reason: `attempt-terminal-race.${ref}` });
    for (const attempt of Object.values(this.state.attempts || {})) if (attempt.state === "STARTED" || attempt.state === "RECOVERY_BLOCKED") problems.push({ kind: "gap", reason: `attempt-open.${attempt.attemptRef}` });
    for (const response of Object.values(this.state.responses || {})) if (response.state === "ADMITTED" && (!this.state.rawResults[response.rawResultRef] || this.state.rawResults[response.rawResultRef].state !== "QUARANTINED")) problems.push({ kind: "corrupt", reason: `response-source.${response.microResultRef}` });
    return problems;
  }

  recoverWorkerExecution(input = {}) {
    const before = this._snapshot();
    try {
      if (input.serviceGeneration && input.serviceGeneration !== this.serviceGeneration && input.serviceGeneration?.serviceGeneration !== this.serviceGeneration) return result("STALE_PREDECESSOR");
      try { this._verifyStateEnvelope(); } catch (error) { this.stateVerificationError = error; }
      const sourceReceiptDigestBefore = this._sourcePopulationDigest(); const eventHeadBefore = this.state.events.at(-1)?.eventDigest || null; const prior = Object.values(this.state.recoveryDispositions).at(-1); const problems = this._recoveryChecks(); const expectedStanding = problems.some((problem) => problem.kind === "corrupt") ? "BROKEN" : problems.length ? "BLOCKED" : "READY"; const expectedReason = problems[0]?.reason || "EXACT_POPULATION_EQUALITY";
      if (prior && prior.authorityEffect !== AUTH_NONE) problems.push({ kind: "corrupt", reason: "recovery-authority-effect-relabelled" });
      if (prior && (prior.state !== prior.status || prior.serviceGeneration !== this.serviceGeneration || prior.dss05_service_generation !== this.serviceGeneration)) problems.push({ kind: "corrupt", reason: "recovery-envelope-relabelled" });
      if (prior && prior.eventLedgerHeadDigest === eventHeadBefore && prior.sourceReceiptDigest !== sourceReceiptDigestBefore) problems.push({ kind: "corrupt", reason: "recovery-source-digest-relabelled" });
      if (prior && prior.eventLedgerHeadDigest === eventHeadBefore && prior.sourceReceiptDigest === sourceReceiptDigestBefore && (prior.status !== expectedStanding || prior.reason !== expectedReason)) problems.push({ kind: "corrupt", reason: "recovery-standing-relabelled" });
      const trustBroken = problems.some((problem) => problem.kind === "corrupt"); const standing = trustBroken ? "BROKEN" : problems.length ? "BLOCKED" : "READY"; const reason = problems[0]?.reason || "EXACT_POPULATION_EQUALITY";
      if (!problems.length && prior && prior.eventLedgerHeadDigest === eventHeadBefore && prior.sourceReceiptDigest === sourceReceiptDigestBefore && prior.serviceGeneration === this.serviceGeneration) return result("REPLAYED", { disposition: clone(prior) });
      if (standing === "BLOCKED") for (const attempt of Object.values(this.state.attempts)) if (attempt.state === "STARTED") { attempt.state = "RECOVERY_BLOCKED"; this._transition("recover-worker-execution", "d.execution-attempt", "BLOCK", attempt, "BLOCKED", "STARTED", "RECOVERY_BLOCKED"); }
      const sourceReceiptDigest = this._sourcePopulationDigest(); const eventHead = this.state.events.at(-1)?.eventDigest || null; const populationDigest = this._ref("ReconstructedPopulation", { handoffs: this.state.handoffs, runtimes: this.state.runtimes, adapters: this.state.adapters, capsules: this.state.capsules, requests: this.state.requests, attempts: this.state.attempts, rawResults: this.state.rawResults, responses: this.state.responses, usage: this.state.usage, evaluations: this.state.evaluations, dispositions: this.state.dispositions }); const identity = { serviceGeneration: this.serviceGeneration, eventLedgerHeadDigest: eventHead, reconstructedPopulationDigest: populationDigest, status: standing, reason, authorityEffect: AUTH_NONE, sourceReceiptDigest, recovery_revision: RECOVERY_REVISION, dss05_service_generation: this.serviceGeneration }; const ref = this._ref("WorkerRecoveryDisposition", identity); const value = { ...identity, recoveryDispositionRef: ref, state: standing, classification: clone(problems), recordedAt: this.clock() }; this._set("recoveryDispositions", ref, value); this._transition("recover-worker-execution", "d.worker-recovery-disposition", "CLASSIFY", value, "RECOVERY_EVENTS_APPENDED", "ABSENT", "ABSENT"); const terminalEvent = standing === "READY" ? "READY" : standing === "BLOCKED" ? "BLOCK" : "BREAK"; this._transition("recover-worker-execution", "d.worker-recovery-disposition", terminalEvent, value, standing, "ABSENT", standing); value.eventLedgerHeadDigest = this.state.events.at(-1)?.eventDigest || null; this._persist(); return result(standing === "READY" ? "READY" : standing, { disposition: value, classifications: problems });
    } catch (error) { this._restore(before); if (error.code === "DSS05_SQLITE_INJECTED_FAILURE") return result("STALE_PREDECESSOR", { errorCode: error.code }); throw error; }
  }

  recoverExecution(input = {}) { return this.recoverWorkerExecution(input); }

  status() {
    const names = ["handoffs", "runtimes", "adapters", "capsules", "requests", "attempts", "rawResults", "responses", "usage", "evaluations", "dispositions", "recoveryDispositions"];
    return deepFreeze({ schema: "direct_semantic_service_dss05_status@1", moduleId: MODULE_ID, moduleDigest: MODULE_DIGEST, serviceGeneration: this.serviceGeneration, generation: clone(this.state.generation), counts: Object.fromEntries(names.map((name) => [name, Object.keys(this.state[name] || {}).length]).concat([["events", this.state.events.length]])), authorityEffect: AUTH_NONE });
  }
  close() { this._persist(); this.store.close(); }
}

function createDss05Service(options) { return new Dss05Service(options); }

module.exports = {
  DSS05_SERVICE_GENERATION, DSS05_MODULE_ID: MODULE_ID, DSS05_MODULE_DIGEST: MODULE_DIGEST, DSS05_COMBINED_FREEZE_DIGEST: COMBINED_FREEZE_DIGEST,
  DSS05_CARRIERS: CARRIER_IDS, DSS05_OPERATIONS: OPERATION_IDS, DSS05_QUALIFIED_TRANSITIONS: QUALIFIED_TRANSITION_IDS,
  DSS05_CARRIER_MAP: CARRIER_MAP, DSS05_CARRIER_FIELD_MAP, DSS05_OPERATION_MAP: OPERATION_MAP, DSS05_TRANSITION_MAP: TRANSITION_MAP,
  Dss05Error, Dss05Service, DirectSemanticServiceDss05: Dss05Service, createDss05Service, Dss05SqliteStore
};
