"use strict";

/*
 * Direct Semantic Service DSS-0.6, generation 1.
 *
 * This is the bounded, advisory-only WorkThread -> AuditPackage -> durable
 * disposition handoff.  The daemon owns every authoritative identity and
 * projection.  Electron and CLI values are transport data only; neither is
 * allowed to mint identity, execute provider work, acknowledge delivery, or
 * advance a cursor.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Dss06SqliteStore } = require("./dss06-sqlite");
const bootstrap = require("./bootstrap-provisioning");
const { Dss02Store } = require("./store");
const { Dss02Authority } = require("./authority-store");
const { Dss02CustodyKeyring } = require("./custody-keyring");
const { Dss02EventLedger } = require("./event-ledger");
const { DSS02_SCHEMA, DSS02_PROTOCOL, canonicalJson, digestObject, deepFreeze } = require("./dss02-common");

const MODULE_PATH = path.resolve(__dirname, "resources/dss06-module.v0.json");
const MODULE = JSON.parse(fs.readFileSync(MODULE_PATH, "utf8"));
const MODULE_ID = "direct.semantic-service.dss06.direct-electron-handoff.generation-1";
const MODULE_DIGEST = "sha256:bf8f9271c49cbf3b57dc9962f85cf650a66a12670d1c4b2525925cac7331fa73";
const COMBINED_FREEZE_DIGEST = "sha256:2de4267457d29179038857c42ff1873e05f4dee6d56d5182f5e5ba226a1ba0d3";
const PREDECESSOR = Object.freeze({
  moduleId: "direct.semantic-service.dss05.real-closed-page.generation-1",
  moduleDigest: "sha256:70f1b66394f19d3de5fc32925c858f8dcfcf2bc28e5d7c00f307744ec9f7350a",
  combinedFreezeDigest: "sha256:0d29f80d9c66f9f1c5aae0e39139fb4c6add536b3468099070894664454b82ac",
  manifest: "docs/audits/direct-semantic-service-dss05-generation-1/candidate_manifest.v1.json",
  implementationSource: "edb589ec248fcec1f116944ffa84ed6feec5b8a3",
  implementationClosure: "0889369",
  focusedAcceptanceReceipt: "sha256:54f3210e94458149ba8275ff57d270cad94d7dd435e07830f28fefcf6b7bfde2",
});
const DSS06_SERVICE_GENERATION = digestObject("DirectSemanticService.Dss06.ServiceGeneration.v1", {
  moduleId: MODULE_ID, moduleDigest: MODULE_DIGEST, combinedFreezeDigest: COMBINED_FREEZE_DIGEST, predecessor: PREDECESSOR,
});
const AUTH_NONE = "NONE";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CARRIER_MAP = Object.fromEntries(MODULE.carriers.map((carrier) => [carrier.id, carrier]));
const OPERATION_MAP = Object.fromEntries(MODULE.operations.map((operation) => [operation.id, operation]));
const TRANSITION_MAP = new Map(MODULE.qualified_transitions.map((row) => [`${row.operationId}:${row.carrierId}:${row.event}`, row]));
const CARRIER_IDS = Object.freeze(MODULE.carriers.map((carrier) => carrier.id));
const OPERATION_IDS = Object.freeze(MODULE.operations.map((operation) => operation.id));
const QUALIFIED_TRANSITION_IDS = Object.freeze(MODULE.qualified_transitions.map((row) => row.transitionId));
const CARRIER_FIELD_MAP = Object.freeze(Object.fromEntries(MODULE.carriers.map((carrier) => [carrier.id, Object.freeze({ stable: Object.freeze([...(carrier.identity?.stable_fields || [])]), generation: Object.freeze([...(carrier.identity?.generation_fields || [])]) })])));
const CAPABILITY_FAMILIES = Object.freeze({
  submit: "submit_audit_package",
  read: "read_audit_disposition",
  "subscribe-ack": "subscribe_disposition_ack",
  wakeup: "wake_task",
});
const CAPABILITY_CARRIERS = Object.freeze({
  submit: "d.submit-capability",
  read: "d.read-capability",
  "subscribe-ack": "d.subscribe-ack-capability",
  wakeup: "d.wakeup-capability",
});
const CAPABILITY_BIND_OPS = Object.freeze({
  submit: "bind-submit-capability",
  read: "bind-read-capability",
  "subscribe-ack": "bind-subscribe-ack-capability",
  wakeup: "bind-wakeup-capability",
});
const CAPABILITY_OWNERS = Object.freeze({
  submit: ["dss06-submit-capability-owner", "dss06-submit-capability-root"],
  read: ["dss06-read-capability-owner", "dss06-read-capability-root"],
  "subscribe-ack": ["dss06-subscribe-ack-owner", "dss06-subscribe-ack-root"],
  wakeup: ["dss06-wakeup-capability-owner", "dss06-wakeup-capability-root"],
});

class Dss06Error extends Error {
  constructor(code, message = code, details = undefined) { super(`${code}: ${message}`); this.name = "Dss06Error"; this.code = code; if (details !== undefined) this.details = details; }
}

if (MODULE.module_id !== MODULE_ID || MODULE.carriers.length !== 17 || MODULE.operations.length !== 17 || MODULE.qualified_transitions.length !== 66) throw new Error("DSS06 frozen declaration population mismatch");

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function nowIso(value) { const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value); if (!Number.isFinite(date.getTime())) throw new Dss06Error("DSS06_INVALID_TIME"); return date.toISOString(); }
function digest(domain, value) { return digestObject(domain, value); }
function isDigest(value) { return typeof value === "string" && DIGEST.test(value); }
function alias(value, ...keys) { if (!value || typeof value !== "object") return undefined; for (const key of keys) if (value[key] !== undefined) return value[key]; return undefined; }
function result(status, extra = {}) { return deepFreeze({ status, authorityEffect: AUTH_NONE, ...clone(extra) }); }
function required(value, label) { if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new Dss06Error("DSS06_REQUIRED", label); return value; }
function validRef(value) { return typeof value === "string" && value.length > 0 && value.trim() === value; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keyOf(value) { return Object.keys(value || {}).sort().join("\u0000"); }
function hasForbiddenBoundary(value) {
  if (!value || typeof value !== "object") return false;
  const forbidden = new Set(["credential", "credentials", "token", "accessToken", "refreshToken", "authorization", "endpoint", "url", "repository", "repositoryPath", "filesystem", "network", "tool", "kernelMutation", "projectMutation", "rawPrompt", "prompt", "requestBody", "providerRequest", "ownerAuthorization", "ownerRoot"]);
  return Object.keys(value).some((key) => forbidden.has(key) || (value[key] && typeof value[key] === "object" && hasForbiddenBoundary(value[key])));
}

class Dss06Service {
  #authority;
  #authorityStore;
  #authorityKeyring;
  #authorityLedger;

  constructor(options = {}) {
    if (options.serviceGeneration && options.serviceGeneration !== DSS06_SERVICE_GENERATION) throw new Dss06Error("DSS06_SERVICE_GENERATION_PIN_MISMATCH");
    this.serviceGeneration = DSS06_SERVICE_GENERATION;
    this.store = options.store || new Dss06SqliteStore({ root: options.root || options.storeRoot, custodyKey: options.custodyKey, now: options.now, failBeforeCommit: options.failBeforeCommit });
    this.clock = () => nowIso(typeof options.now === "function" ? options.now() : options.now);
    this.state = this.store.read() || this._initialState();
    this.stateVerificationError = null;
    this.authorityVerificationError = null;
    this.#authority = null;
    this.#authorityStore = null;
    this.#authorityKeyring = null;
    this.#authorityLedger = null;
    this._bootstrapFaultPhase = options.bootstrapFaultPhase || null;
    this._authorityStatus = this._openAuthorityFoundation(options);
    try { this._verifyStateEnvelope(); } catch (error) { this.stateVerificationError = error; }
    this._reconcilePreparedBootstrap();
    if (options.bootstrapRecords) this.bootstrapOwnerIssuedRecords(options.bootstrapRecords);
  }

  _initialState() {
    return {
      schema: "direct_semantic_service_dss06_state@1", moduleId: MODULE_ID, moduleDigest: MODULE_DIGEST, serviceGeneration: this.serviceGeneration,
      generation: { serviceGeneration: this.serviceGeneration, state: "READY", revision: 1 },
      registries: { principals: {}, projects: {}, tasks: {}, workThreads: {}, predecessorDispositions: {}, continuations: {} },
      authority: null,
      health: {}, packages: {}, jobs: {}, attempts: {}, decisions: {}, dispositions: {}, lineages: {}, capabilities: {},
      subscriptions: {}, offers: {}, acknowledgments: {}, cursors: {}, wakeups: {}, recoveryDispositions: {}, operationInputs: {}, events: [],
    };
  }
  _authorityRootRecord(pinStatus) {
    const existing = this.#authorityStore.get("SELECT * FROM owner_roots WHERE profile_ref=?", this.authorityProfileRef);
    if (existing && (existing.owner_root_fingerprint !== pinStatus.pin.ownerRootFingerprint || existing.root_pin_digest !== pinStatus.pin.pinDigest || existing.installation_configuration_revision !== pinStatus.pin.configurationRevision)) {
      this.#authorityStore.run("UPDATE owner_roots SET status='BROKEN',observed_at=? WHERE profile_ref=?", this.clock(), this.authorityProfileRef);
      throw new Dss06Error("DSS06_AUTHORITY_ROOT_MISMATCH");
    }
    if (!existing) this.#authorityStore.run("INSERT INTO owner_roots(root_ref,profile_ref,owner_root_fingerprint,owner_root_algorithm,installation_configuration_revision,root_pin_digest,installation_event_digest,status,observed_at) VALUES(?,?,?,?,?,?,?,?,?)", `dss06-owner-root-${pinStatus.pin.ownerRootFingerprint}`, this.authorityProfileRef, pinStatus.pin.ownerRootFingerprint, pinStatus.pin.ownerRootAlgorithm, pinStatus.pin.configurationRevision, pinStatus.pin.pinDigest, pinStatus.pin.installationEventDigest, "PINNED", this.clock());
  }
  _wireAuthorityStore() {
    this.#authority = new Dss02Authority({ store: this.#authorityStore, profileRef: this.authorityProfileRef, protocolRevision: DSS02_PROTOCOL, now: this.clock });
    this.#authorityKeyring = new Dss02CustodyKeyring({ store: this.#authorityStore, now: this.clock });
    this.#authorityLedger = new Dss02EventLedger({ store: this.#authorityStore, keyring: this.#authorityKeyring, now: this.clock });
    this.#authorityKeyring.ledger = this.#authorityLedger;
    this.#authority.ledger = this.#authorityLedger;
  }
  _authorityFoundationFromStore(pinStatus) {
    const principalRows = this.#authorityStore.all("SELECT * FROM principals ORDER BY principal_ref");
    const verifierRows = this.#authorityStore.all("SELECT * FROM verifiers ORDER BY verifier_ref");
    if (principalRows.length !== 1 || verifierRows.length !== 1) throw new Dss06Error("DSS06_AUTHORITY_POPULATION_INVALID");
    const principal = this.#authority.getPrincipal(principalRows[0].principal_ref);
    const verifier = this.#authority.getVerifier(verifierRows[0].verifier_ref);
    if (!principal || !verifier || principal.principalRef !== verifier.principalRef || principal.subjectRef !== this.authorityProfileRef || principal.issuerRevision !== "owner-bootstrap-issuer@1" || verifier.issuerRevision !== "owner-bootstrap-issuer@1") throw new Dss06Error("DSS06_AUTHORITY_LINEAGE_INVALID");
    const commitmentRow = this.#authorityStore.get("SELECT * FROM bootstrap_commitments WHERE profile_ref=?", this.authorityProfileRef);
    const attemptRow = commitmentRow && this.#authorityStore.get("SELECT * FROM bootstrap_attempts WHERE commitment_ref=?", commitmentRow.commitment_ref);
    const authorizationRow = attemptRow && this.#authorityStore.get("SELECT * FROM bootstrap_authorizations WHERE commitment_ref=?", commitmentRow.commitment_ref);
    const artifacts = bootstrap.verifyBootstrapArtifacts({ installationRoot: this.authorityInstallationRoot, profileRoot: this.authorityProfileRoot, commitmentRow, attemptRow, authorizationRow });
    if (artifacts.commitment.profileRef !== this.authorityProfileRef || artifacts.commitment.ownerRootFingerprint !== pinStatus.pin.ownerRootFingerprint || artifacts.attempt.state !== "ATTEMPT_CLAIMED" || artifacts.commitment.maximumAttempts !== 1 || authorizationRow?.state !== "AUTHORIZED_ONCE") throw new Dss06Error("DSS06_AUTHORITY_BOOTSTRAP_LINEAGE_INVALID");
    this.#authority.assertCurrentVerifier(verifier.verifierRef, { operation: "service-administration", now: this.clock() });
    this.#authorityKeyring.verifyLineage();
    this.#authorityLedger.verify();
    this.#authority.reconcileEvents();
    const foundation = {
      schema: "direct_semantic_dss06_authority_foundation@1", profileRef: this.authorityProfileRef,
      ownerRootFingerprint: pinStatus.pin.ownerRootFingerprint, ownerRootPinDigest: pinStatus.pin.pinDigest,
      commitmentRef: artifacts.commitment.commitmentRef, commitmentDigest: artifacts.commitment.commitmentDigest,
      attemptRef: artifacts.attempt.attemptRef, attemptDigest: artifacts.attempt.attemptDigest,
      authorizationRef: authorizationRow.authorization_ref, authorizationDigest: authorizationRow.authorization_digest,
      principalRef: principal.principalRef, principalLineageRevision: principal.lineageRevision,
      verifierRef: verifier.verifierRef, verifierRevision: verifier.verifierRevision, issuerRevision: verifier.issuerRevision,
      sourceDigest: digest("Dss06.AuthorityFoundation", { profileRef: this.authorityProfileRef, ownerRootFingerprint: pinStatus.pin.ownerRootFingerprint, ownerRootPinDigest: pinStatus.pin.pinDigest, commitment: artifacts.commitment, attempt: artifacts.attempt, authorization: JSON.parse(authorizationRow.payload_json), principal, verifier }),
      authorityEffect: AUTH_NONE,
    };
    return Object.freeze(foundation);
  }
  _openAuthorityFoundation(options) {
    this.authorityInstallationRoot = options.installationRoot || options.authorityInstallationRoot || null;
    this.authorityProfileRoot = options.authorityProfileRoot || options.authorityRoot || null;
    this.authorityProfileRef = options.authorityProfileRef || `${MODULE_ID}.authority`;
    if (!this.authorityInstallationRoot || !this.authorityProfileRoot) return Object.freeze({ status: "MISSING", reason: "DSS06_AUTHORITY_CUSTODY_REQUIRED" });
    try {
      const pinStatus = bootstrap.verifyOwnerBootstrapRootPin({ installationRoot: this.authorityInstallationRoot });
      if (pinStatus.status !== "PINNED") return Object.freeze({ status: "BROKEN", reason: "DSS06_AUTHORITY_ROOT_BROKEN" });
      this.#authorityStore = new Dss02Store({ profileRoot: this.authorityProfileRoot, profileRef: this.authorityProfileRef, now: this.clock });
      this.#authorityStore.open();
      this._authorityRootRecord(pinStatus);
      this._wireAuthorityStore();
      const principal = this.#authorityStore.get("SELECT principal_ref FROM principals LIMIT 1");
      if (!principal) return Object.freeze({ status: "UNPROVISIONED", reason: "DSS06_AUTHORITY_BOOTSTRAP_REQUIRED", ownerRootFingerprint: pinStatus.pin.ownerRootFingerprint, ownerRootPinDigest: pinStatus.pin.pinDigest });
      this.#authorityStore.createGeneration(DSS02_SCHEMA);
      return Object.freeze({ status: "CURRENT", ...this._authorityFoundationFromStore(pinStatus) });
    } catch (error) {
      try { this.#authorityStore?.close(); } catch (_) {}
      this.#authority = null; this.#authorityStore = null; this.#authorityKeyring = null; this.#authorityLedger = null;
      return Object.freeze({ status: "BROKEN", reason: error.code || "DSS06_AUTHORITY_CUSTODY_BROKEN" });
    }
  }
  _refreshAuthorityFoundation() {
    const pinStatus = bootstrap.verifyOwnerBootstrapRootPin({ installationRoot: this.authorityInstallationRoot });
    if (pinStatus.status !== "PINNED") throw new Dss06Error("DSS06_AUTHORITY_ROOT_BROKEN");
    return Object.freeze({ status: "CURRENT", ...this._authorityFoundationFromStore(pinStatus) });
  }
  _authorityReceipt(receipt, operation = "service-administration", expectedRequestDigest = undefined) {
    if (!receipt || !isObject(receipt) || receipt.decision !== "AUTHORIZED" || receipt.operation !== operation || !this.#authority || !this.#authorityStore || this._authorityStatus.status !== "CURRENT") return null;
    try {
      const unsigned = { ...receipt }; delete unsigned.authorizationDigest;
      if (!isDigest(receipt.authorizationDigest) || digestObject("DirectSemanticService.RequestAuthorizationReceipt.v1", unsigned) !== receipt.authorizationDigest) return null;
      const row = this.#authorityStore.get("SELECT r.*, c.daemon_generation AS challenge_generation FROM authorization_receipts r JOIN authorization_challenges c ON c.challenge_ref=r.challenge_ref WHERE r.receipt_ref=?", receipt.receiptRef);
      const generation = this.#authorityStore.currentGeneration();
      if (!row || !generation || row.challenge_generation !== generation.generation_ref || row.decision !== "AUTHORIZED" || row.operation !== operation || row.principal_ref !== receipt.principalRef || row.verifier_ref !== receipt.verifierRef) return null;
      if (row.request_digest !== receipt.requestDigest || row.authorization_digest && row.authorization_digest !== receipt.authorizationDigest) return null;
      if (expectedRequestDigest !== undefined && receipt.requestDigest !== expectedRequestDigest) return null;
      this.#authority.assertCurrentVerifier(receipt.verifierRef, { operation, now: this.clock });
      if (receipt.verifierRef !== this._authorityStatus.verifierRef) return null;
      return receipt;
    } catch (_) { return null; }
  }
  _validateAuthorityFoundation() {
    if (this._authorityStatus.status !== "CURRENT" || !this.#authority) return { ok: false, code: "AUTHORITY_CUSTODY_BROKEN" };
    try {
      const current = this._refreshAuthorityFoundation();
      if (!this.state.authority || this.state.authority.sourceDigest !== current.sourceDigest || this.state.authority.verifierRef !== current.verifierRef || this.state.authority.verifierRevision !== current.verifierRevision) return { ok: false, code: "AUTHORITY_LINEAGE_MISMATCH" };
      this._authorityStatus = current;
      return { ok: true, foundation: current };
    } catch (error) {
      this._authorityStatus = Object.freeze({ status: "BROKEN", reason: error.code || "DSS06_AUTHORITY_CUSTODY_BROKEN" });
      return { ok: false, code: this._authorityStatus.reason };
    }
  }

  /*
   * The only authority material exposed by the service is the public verifier
   * record and a one-use challenge.  Neither method returns a credential,
   * private key, bootstrap secret, or authority object.  The signed proof is
   * resolved by the private DSS-0.2 custody below and is consequently valid
   * across process boundaries without trusting JS object identity.
   */
  authorityVerifierRecord() {
    const authority = this._validateAuthorityFoundation();
    if (!authority.ok) return result(authority.code);
    try {
      const verifier = this.#authority.getVerifier(this._authorityStatus.verifierRef);
      if (!verifier) return result("AUTHORITY_CUSTODY_BROKEN");
      return result("CURRENT", { verifier: clone(verifier) });
    } catch (_) {
      return result("AUTHORITY_CUSTODY_BROKEN");
    }
  }

  issueAuthorityChallenge(input = {}) {
    if (this._capInputRejected(input) || !isObject(input.transportObservation) || input.transportObservation.status !== "OBSERVED") return result("UNAUTHORIZED");
    const authority = this._validateAuthorityFoundation();
    if (!authority.ok) return result(authority.code);
    try {
      const challenge = this.#authority.issueAuthorizationChallenge({ connectionRef: input.connectionRef, transportObservation: clone(input.transportObservation), ttlMs: input.ttlMs });
      return result("ISSUED", { challenge });
    } catch (_) {
      return result("UNAUTHORIZED");
    }
  }

  resolveAuthorityAuthorization(input = {}) {
    if (this._capInputRejected(input) || !isObject(input.transportObservation) || input.transportObservation.status !== "OBSERVED" || !isObject(input.proof)) return result("UNAUTHORIZED");
    const authority = this._validateAuthorityFoundation();
    if (!authority.ok) return result(authority.code);
    try {
      const resolved = this.#authority.resolveDaemonCredential({
        connectionRef: input.connectionRef,
        transportObservation: clone(input.transportObservation),
        challengeRef: input.challengeRef,
        proof: clone(input.proof),
        requestDigest: input.requestDigest,
        operation: input.operation || "service-administration",
        purposeScopes: clone(input.purposeScopes || []),
        objectScopeDigest: input.objectScopeDigest,
        registryRevisionSet: clone(input.registryRevisionSet || []),
        now: this.clock(),
      });
      const extra = { reasonCode: resolved.reasonCode || null };
      if (resolved.decision === "AUTHORIZED") extra.authorizationReceipt = clone(resolved.receipt);
      return result(resolved.decision, extra);
    } catch (_) {
      return result("UNAUTHORIZED");
    }
  }
  _consumeBootstrapFault(phase) {
    if (this._bootstrapFaultPhase !== phase) return false;
    this._bootstrapFaultPhase = null;
    return true;
  }
  _authorityMatchesBootstrapPlan(plan) {
    const expected = plan?.authority;
    const current = this._authorityStatus;
    return current?.status === "CURRENT" && expected && current.profileRef === expected.profileRef && current.ownerRootFingerprint === expected.ownerRootFingerprint && current.ownerRootPinDigest === expected.ownerRootPinDigest && current.commitmentRef === expected.commitmentRef && current.commitmentDigest === expected.commitmentDigest && current.attemptRef === expected.attemptRef && current.attemptDigest === expected.attemptDigest && current.authorizationRef === expected.authorizationRef && current.authorizationDigest === expected.authorizationDigest;
  }
  _verifyBootstrapIntent() {
    const intent = this.state.bootstrapIntent;
    if (!intent) return null;
    if (!isObject(intent) || intent.schema !== "direct_semantic_dss06_bootstrap_intent@1" || !["PREPARED", "COMPLETE"].includes(intent.state) || !isDigest(intent.planDigest) || !isObject(intent.plan) || intent.plan.serviceGeneration !== this.serviceGeneration) throw new Dss06Error("DSS06_BOOTSTRAP_INTENT_INVALID");
    if (intent.planDigest !== digest("Dss06.BootstrapPlan", intent.plan)) throw new Dss06Error("DSS06_BOOTSTRAP_PLAN_DIGEST_INVALID");
    const unsigned = { ...intent }; delete unsigned.intentDigest;
    if (!isDigest(intent.intentDigest) || intent.intentDigest !== digest("Dss06.BootstrapIntent", unsigned)) throw new Dss06Error("DSS06_BOOTSTRAP_INTENT_DIGEST_INVALID");
    if (intent.plan.authority?.profileRef !== this.authorityProfileRef || intent.plan.authority?.ownerRootPinDigest === undefined) throw new Dss06Error("DSS06_BOOTSTRAP_INTENT_AUTHORITY_INVALID");
    if (intent.state === "COMPLETE" && this.state.bootstrap?.state !== "COMPLETE") throw new Dss06Error("DSS06_BOOTSTRAP_COMPLETION_INVALID");
    if (intent.state === "PREPARED" && this.state.bootstrap?.state === "COMPLETE") throw new Dss06Error("DSS06_BOOTSTRAP_COMPLETION_INVALID");
    return intent;
  }
  _publishBootstrapPlan(plan) {
    if (!this._authorityMatchesBootstrapPlan(plan)) throw new Dss06Error("DSS06_BOOTSTRAP_AUTHORITY_MISMATCH");
    const registryMaps = ["principals", "projects", "tasks", "workThreads", "predecessorDispositions", "continuations"];
    if (registryMaps.some((map) => Object.keys(this.state.registries?.[map] || {}).length) || Object.keys(this.state.capabilities || {}).length) throw new Dss06Error("DSS06_BOOTSTRAP_DUPLICATE_POPULATION");
    const semantic = plan.semantic;
    const principalData = semantic.principal;
    const projectData = semantic.project;
    const taskData = semantic.task;
    const threadData = semantic.workThread;
    const predecessor = semantic.predecessor;
    const now = this.clock();
    this.state.registries.principals[semantic.principalRef] = { principalRef: semantic.principalRef, principalId: principalData.principalId || principalData.id || "principal", state: "CURRENT", ownerIssued: true, revision: 1, createdAt: now };
    this.state.registries.projects[semantic.projectRef] = { projectRef: semantic.projectRef, projectId: projectData.projectId || projectData.id || "project", projectRegistryRevisionRef: semantic.projectRevisionRef, state: "CURRENT", ownerIssued: true, revision: 1, createdAt: now };
    this.state.registries.tasks[semantic.taskRef] = { taskRef: semantic.taskRef, taskId: taskData.taskId || taskData.id || "task", projectRef: semantic.projectRef, state: "CURRENT", ownerIssued: true, revision: 1, createdAt: now };
    this.state.registries.workThreads[semantic.workThreadRef] = { workThreadRef: semantic.workThreadRef, threadId: threadData.threadId || threadData.id || "work-thread", taskRef: semantic.taskRef, principalRef: semantic.principalRef, state: "CURRENT", ownerIssued: true, revision: 1, createdAt: now };
    this.state.registries.predecessorDispositions[semantic.predecessorRef] = {
      predecessorRef: semantic.predecessorRef, dss05DispositionRef: semantic.dss05DispositionRef, dss05DispositionDigest: semantic.dss05DispositionDigest, dss05ArtifactLineageRefsDigest: semantic.dss05ArtifactLineageRefsDigest,
      dss05ModuleId: predecessor.moduleId || PREDECESSOR.moduleId, dss05ModuleDigest: predecessor.moduleDigest || PREDECESSOR.moduleDigest, dss05CombinedFreezeDigest: predecessor.combinedFreezeDigest || PREDECESSOR.combinedFreezeDigest,
      artifactRefs: clone(predecessor.artifactRefs || predecessor.artifactLineage || []), sourceCustodyDigest: predecessor.sourceCustodyDigest || this._ref("Dss05SourceCustody", predecessor), state: "CURRENT", ownerIssued: true, revision: 1, createdAt: now,
    };
    const refs = { principalRef: semantic.principalRef, projectRef: semantic.projectRef, projectRegistryRevisionRef: semantic.projectRevisionRef, taskRef: semantic.taskRef, workThreadRef: semantic.workThreadRef, predecessorRef: semantic.predecessorRef, dss05DispositionRef: semantic.dss05DispositionRef, dss05DispositionDigest: semantic.dss05DispositionDigest, dss05ArtifactLineageRefsDigest: semantic.dss05ArtifactLineageRefsDigest };
    for (const kind of Object.keys(CAPABILITY_FAMILIES)) {
      const { spec, scope, revision, ref, scopeDigest, currentRevisionRef, budgetRef, remainingBudget } = semantic.capabilities[kind];
      const record = {
        schema: "direct_semantic_service_dss06_owner_issued_verifier@1", capabilityRef: ref, family: CAPABILITY_FAMILIES[kind], operation: CAPABILITY_FAMILIES[kind], carrierId: CAPABILITY_CARRIERS[kind],
        principalRef: scope.principalRef, projectRef: scope.projectRef, taskRef: scope.taskRef, jobRef: scope.jobRef, subscriptionRef: scope.subscriptionRef, projectionDigest: scope.projectionDigest, continuationRef: scope.continuationRef, contractDigest: scope.contractDigest,
        scopeDigest, currentRevisionRef, issuedAt: spec.issuedAt || now, expiresAt: spec.expiresAt || new Date(new Date(now).getTime() + 3600000).toISOString(), revocationEpoch: Number.isInteger(spec.revocationEpoch) ? spec.revocationEpoch : 0, budgetRef, remainingBudget,
        state: "ABSENT", ownerIssued: true, issuerOwner: CAPABILITY_OWNERS[kind][0], issuerRoot: CAPABILITY_OWNERS[kind][1], capabilityRevision: revision, serviceGeneration: this.serviceGeneration,
        issuerVerifierRef: this._authorityStatus.verifierRef, issuerVerifierRevision: this._authorityStatus.verifierRevision, issuerPrincipalRef: this._authorityStatus.principalRef, issuerPrincipalLineageRevision: this._authorityStatus.principalLineageRevision, authoritySourceDigest: this._authorityStatus.sourceDigest, authorityBootstrapAuthorizationDigest: this._authorityStatus.authorizationDigest, authorityBootstrapAttemptDigest: this._authorityStatus.attemptDigest, authorityRootPinDigest: this._authorityStatus.ownerRootPinDigest, authorityEffect: AUTH_NONE,
      };
      this.state.capabilities[ref] = record;
      const publicKind = kind === "subscribe-ack" ? "subscribeAck" : kind;
      refs[`${publicKind}CapabilityRef`] = ref; refs[`${publicKind}CapabilityRevisionRef`] = record.currentRevisionRef;
    }
    this.state.registries.continuations[semantic.continuationRef] = { continuationRef: semantic.continuationRef, taskRef: semantic.taskRef, contractDigest: semantic.contractDigest, contract: semantic.continuation.contract || "dss06-task-wakeup-v1", state: "CURRENT", ownerIssued: true, createdAt: now };
    refs.continuationRef = semantic.continuationRef; refs.contractDigest = semantic.contractDigest; refs.authoritySourceDigest = this._authorityStatus.sourceDigest;
    this.state.authority = clone(this._authorityStatus);
    const completeBase = { ...this.state.bootstrapIntent, state: "COMPLETE", completedAt: now };
    delete completeBase.intentDigest;
    completeBase.intentDigest = digest("Dss06.BootstrapIntent", completeBase);
    this.state.bootstrapIntent = completeBase;
    this.state.bootstrap = { state: "COMPLETE", revision: 1, refs: clone(refs), recordedAt: now, authorityEffect: AUTH_NONE };
    return refs;
  }
  _completePreparedBootstrap() {
    const intent = this.state.bootstrapIntent;
    if (!intent || intent.state !== "PREPARED") return result("REPLAYED", { references: this._bootstrapReferences() });
    if (this._authorityStatus.status !== "CURRENT") return result("BOOTSTRAP_BLOCKED", { reason: "DSS06_BOOTSTRAP_AUTHORITY_UNPROVISIONED" });
    if (!this._authorityMatchesBootstrapPlan(intent.plan)) return result("BROKEN", { reason: "DSS06_BOOTSTRAP_AUTHORITY_MISMATCH" });
    const before = this._snapshot();
    try {
      const refs = this._publishBootstrapPlan(intent.plan);
      this._persist();
      return result("BOOTSTRAPPED", { references: refs });
    } catch (error) {
      this._restore(before);
      if (error.code === "DSS06_SQLITE_INJECTED_FAILURE") return result("STALE_CURRENTNESS", { errorCode: error.code });
      if (error instanceof Dss06Error) return result("BROKEN", { reason: error.code });
      throw error;
    }
  }
  _reconcilePreparedBootstrap() {
    const intent = this.state.bootstrapIntent;
    if (!intent || intent.state !== "PREPARED") return;
    try {
      this._verifyBootstrapIntent();
      if (this._authorityStatus.status === "CURRENT") {
        const completed = this._completePreparedBootstrap();
        if (["BOOTSTRAPPED", "REPLAYED"].includes(completed.status)) return;
        this.authorityVerificationError = new Dss06Error(completed.reason || "DSS06_BOOTSTRAP_RECONCILIATION_BLOCKED");
      }
    } catch (error) {
      this.authorityVerificationError = error;
    }
  }
  _map(name) { if (!this.state[name]) this.state[name] = {}; return this.state[name]; }
  _ref(domain, value) { return digest(`DirectSemanticService.Dss06.${domain}.v1`, value); }
  _snapshot() { return clone(this.state); }
  _restore(snapshot) { this.state = snapshot; }
  _persist() { this.store.write(this.state); }
  _set(map, ref, value) { this._map(map)[ref] = value; return value; }
  _lookup(map, ref, aliases = []) {
    if (!validRef(ref)) return null;
    const direct = this.state[map]?.[ref]; if (direct) return direct;
    return Object.values(this.state[map] || {}).find((value) => [ref, ...aliases].some((field) => value[field] === ref)) || null;
  }
  _remember(operation, key, ref, input) { this.state.operationInputs[key] = { operation, inputDigest: key, ref: ref || null, operationInput: clone(input) }; }
  _replay(operation, key, map, ref) {
    const prior = this.state.operationInputs[key];
    if (!prior) return null;
    if (prior.operation !== operation) return result("IDEMPOTENCY_CONFLICT");
    const itemRef = prior.ref || ref;
    return result("REPLAYED", map && itemRef ? { [map]: clone(this.state[map]?.[itemRef]) } : { ref: itemRef });
  }
  _capInputRejected(input) {
    return ["capability", "submitCapability", "readCapability", "subscribeAckCapability", "wakeupCapability", "verifier", "authorization", "grant", "ownerAuthorization"].some((key) => isObject(input?.[key]));
  }
  _transition(operationId, carrierId, eventName, payload = {}, outcome, fromState, toState) {
    const row = TRANSITION_MAP.get(`${operationId}:${carrierId}:${eventName}`);
    if (!row) throw new Dss06Error("DSS06_UNKNOWN_TRANSITION", `${operationId}:${carrierId}:${eventName}`);
    const effectiveFrom = fromState === undefined ? row.fromStates[0] : fromState;
    if (!row.fromStates.includes(effectiveFrom)) throw new Dss06Error("DSS06_TRANSITION_FROM_STATE_INVALID", `${operationId}:${carrierId}:${eventName}`, { fromState: effectiveFrom, allowed: row.fromStates });
    const effectiveOutcome = outcome === undefined ? row.outcomeCases[0] : outcome;
    if (!row.outcomeCases.includes(effectiveOutcome)) throw new Dss06Error("DSS06_TRANSITION_OUTCOME_INVALID", `${operationId}:${carrierId}:${eventName}`, { outcome: effectiveOutcome, allowed: row.outcomeCases });
    const effectiveTo = toState === undefined ? row.toState : toState;
    if (effectiveTo !== row.toState) throw new Dss06Error("DSS06_TRANSITION_DESTINATION_INVALID", `${operationId}:${carrierId}:${eventName}`, { toState: effectiveTo, required: row.toState });
    const event = {
      sequence: this.state.events.length + 1, priorDigest: this.state.events.at(-1)?.eventDigest || null,
      type: row.operationId, operationId: row.operationId, carrierId: row.carrierId, outputCarrierId: row.outputCarrierId,
      event: row.event, transitionId: row.transitionId, owner: row.owner, priorStateSource: row.priorStateSource,
      sourceStates: clone(row.sourceStates), fromStates: clone(row.fromStates), fromState: effectiveFrom,
      destinationState: row.destinationState, toState: row.toState, outcome: effectiveOutcome, outcomeCases: clone(row.outcomeCases),
      authorityEffect: AUTH_NONE, payload: clone(payload),
    };
    event.eventDigest = digest("Event", event);
    this.state.events.push(event);
    return event;
  }
  _commit(mutator, fallback = "STALE_CURRENTNESS") {
    const before = this._snapshot();
    try { const value = mutator(); this._persist(); return value; }
    catch (error) { this._restore(before); if (error.code === "DSS06_SQLITE_INJECTED_FAILURE") return result(fallback, { errorCode: error.code }); throw error; }
  }

  _scopeDigest(scope) { return digest("Dss06.CapabilityScope", scope); }
  _capabilityRef(family, scope, revision) { return this._ref("Capability", { family, scope, revision }); }
  _capabilityInput(input, kind) {
    const ref = alias(input, "capabilityRef", "capability_ref", `${kind}CapabilityRef`, `${kind}_capability_ref`, "verifierRef", "verifier_ref");
    return validRef(ref) ? ref : null;
  }
  _scopeMatches(cap, request) {
    const fields = ["principalRef", "projectRef", "taskRef", "jobRef", "subscriptionRef", "projectionDigest", "continuationRef", "contractDigest"];
    for (const field of fields) {
      const expected = cap[field]; const actual = request[field];
      if (expected === undefined || expected === null || expected === "*" || actual === undefined || actual === null) continue;
      if (Array.isArray(expected) ? !expected.includes(actual) : expected !== actual) return false;
    }
    if (request.scopeDigest && cap.scopeDigest !== request.scopeDigest) return false;
    if (request.currentRevisionRef && cap.currentRevisionRef !== request.currentRevisionRef) return false;
    if (request.revocationEpoch !== undefined && cap.revocationEpoch !== request.revocationEpoch) return false;
    if (request.timeFence && request.timeFence > cap.expiresAt) return false;
    return true;
  }
  _authorizeCapability(ref, kind, request = {}, { consume = false } = {}) {
    const authority = this._validateAuthorityFoundation();
    if (!authority.ok) return { ok: false, code: authority.code };
    const cap = this.state.capabilities?.[ref];
    if (!cap || cap.ownerIssued !== true || cap.serviceGeneration !== this.serviceGeneration || cap.issuerVerifierRef !== authority.foundation.verifierRef || cap.issuerVerifierRevision !== authority.foundation.verifierRevision || cap.authoritySourceDigest !== authority.foundation.sourceDigest || cap.authorityBootstrapAuthorizationDigest !== authority.foundation.authorizationDigest || cap.authorityBootstrapAttemptDigest !== authority.foundation.attemptDigest || cap.authorityRootPinDigest !== authority.foundation.ownerRootPinDigest) return { ok: false, code: "CAPABILITY_NON_SUBSTITUTION" };
    if (cap.family !== CAPABILITY_FAMILIES[kind] || cap.operation !== CAPABILITY_FAMILIES[kind]) return { ok: false, code: "CAPABILITY_NON_SUBSTITUTION" };
    if (cap.state !== "CURRENT") return { ok: false, code: cap.state === "EXPIRED" ? "EXPIRED" : cap.state === "REVOKED" ? "REVOKED" : "STALE_CURRENTNESS" };
    if (new Date(cap.expiresAt).getTime() <= new Date(this.clock()).getTime()) return { ok: false, code: "EXPIRED" };
    if (!this._scopeMatches(cap, request)) return { ok: false, code: "CAPABILITY_SCOPE_MISMATCH" };
    if (!Number.isInteger(cap.remainingBudget) || cap.remainingBudget <= 0) return { ok: false, code: "CAPABILITY_BUDGET_EXHAUSTED" };
    if (consume) { cap.remainingBudget -= 1; cap.lastUsedAt = this.clock(); }
    return { ok: true, cap };
  }
  _authorizationFailure(kind, auth, { observation = false } = {}) {
    if (observation) return result("OBSERVATION_AUTHORITY_INVALID");
    if (auth.code === "CAPABILITY_NON_SUBSTITUTION") return result("CAPABILITY_NON_SUBSTITUTION");
    if (auth.code === "EXPIRED" || auth.code === "REVOKED") return result("AUTHORITY_INVALIDATED");
    return result(auth.code || "UNAUTHORIZED");
  }

  /* DSS-0.6 consumes a one-use DSS-0.2 offline ceremony.  The ceremony
   * records are input data only; the owner-root pin, commitment, attempt,
   * authorization, verifier, and currentness lineage are re-resolved from
   * protected durable custody before any local identity is constituted. */
  bootstrapOwnerIssuedRecords(input = {}) {
    const before = this._snapshot(); const fail = (status, extra = {}) => { this._restore(before); return result(status, extra); };
    if (this._authorityStatus.status === "MISSING") return result("AUTHORITY_BOOTSTRAP_REQUIRED");
    if (this._authorityStatus.status === "BROKEN") return result("AUTHORITY_CUSTODY_BROKEN");
    if (Object.keys(this.state.registries.principals).length) return result("REPLAYED", { references: this._bootstrapReferences() });
    if (this._authorityStatus.status === "CURRENT") {
      if (this.state.bootstrapIntent?.state === "PREPARED") {
        try { this._verifyBootstrapIntent(); } catch (error) { return result("BROKEN", { reason: error.code || "DSS06_BOOTSTRAP_INTENT_INVALID" }); }
        return this._completePreparedBootstrap();
      }
      return result("REBOOTSTRAP_FORBIDDEN");
    }
    const authorityBootstrap = input.authorityBootstrap || input.ownerBootstrap || input.bootstrap;
    if (!isObject(authorityBootstrap) || hasForbiddenBoundary(authorityBootstrap)) return result("AUTHORITY_BOOTSTRAP_REQUIRED");
    const authorityProfileRoot = authorityBootstrap.authorityProfileRoot || authorityBootstrap.profileRoot;
    const authorityInstallationRoot = authorityBootstrap.authorityInstallationRoot || authorityBootstrap.installationRoot;
    if ((authorityProfileRoot && path.resolve(authorityProfileRoot) !== path.resolve(this.authorityProfileRoot)) || (authorityInstallationRoot && path.resolve(authorityInstallationRoot) !== path.resolve(this.authorityInstallationRoot))) return result("AUTHORITY_BOOTSTRAP_MISMATCH");
    /* Preflight every semantic input before consuming the durable one-use
     * authority ceremony.  A malformed caller payload must never constitute
     * an otherwise unusable authority foundation. */
    const supplied = input.records || input;
    const principalData = clone(supplied.principal || { principalId: "dss06-test-principal" });
    const projectData = clone(supplied.project || { projectId: "dss06-test-project" });
    const taskData = clone(supplied.task || { taskId: "dss06-test-task" });
    const threadData = clone(supplied.workThread || supplied.thread || { threadId: "dss06-test-work-thread" });
    if ([principalData, projectData, taskData, threadData].some(hasForbiddenBoundary)) return result("UNAUTHORIZED");
    const principalRef = principalData.principalRef || this._ref("Principal", { id: principalData.principalId || principalData.id || "principal", generation: this.serviceGeneration });
    const projectRef = projectData.projectRef || this._ref("Project", { id: projectData.projectId || projectData.id || "project", generation: this.serviceGeneration });
    const projectRevisionRef = projectData.projectRegistryRevisionRef || this._ref("ProjectRegistryRevision", { projectRef, revision: projectData.revision || 1, generation: this.serviceGeneration });
    const taskRef = taskData.taskRef || this._ref("Task", { id: taskData.taskId || taskData.id || "task", projectRef, generation: this.serviceGeneration });
    const workThreadRef = threadData.workThreadRef || this._ref("WorkThread", { id: threadData.threadId || threadData.id || "work-thread", taskRef, principalRef, generation: this.serviceGeneration });
    const predecessor = clone(supplied.predecessor || supplied.dss05 || {
      dss05DispositionRef: "dss05-disposition-1", dss05DispositionDigest: "sha256:" + "1".repeat(64), dss05ArtifactLineageRefsDigest: "sha256:" + "2".repeat(64),
      artifactRefs: [], sourceCustodyDigest: "sha256:" + "3".repeat(64), moduleId: PREDECESSOR.moduleId, moduleDigest: PREDECESSOR.moduleDigest, combinedFreezeDigest: PREDECESSOR.combinedFreezeDigest,
    });
    if (hasForbiddenBoundary(predecessor)) return result("UNAUTHORIZED");
    const dss05DispositionRef = predecessor.dss05DispositionRef || predecessor.dispositionRef;
    const dss05DispositionDigest = predecessor.dss05DispositionDigest || predecessor.dispositionDigest;
    const dss05ArtifactLineageRefsDigest = predecessor.dss05ArtifactLineageRefsDigest || predecessor.artifactLineageRefsDigest;
    if (![dss05DispositionRef, dss05DispositionDigest, dss05ArtifactLineageRefsDigest].every(validRef) || !isDigest(dss05DispositionDigest) || !isDigest(dss05ArtifactLineageRefsDigest)) return result("PREDECESSOR_MISMATCH");
    if ((predecessor.moduleId || PREDECESSOR.moduleId) !== PREDECESSOR.moduleId || (predecessor.moduleDigest || PREDECESSOR.moduleDigest) !== PREDECESSOR.moduleDigest || (predecessor.combinedFreezeDigest || PREDECESSOR.combinedFreezeDigest) !== PREDECESSOR.combinedFreezeDigest) return result("PREDECESSOR_MISMATCH");
    if (predecessor.sourceCustodyDigest !== undefined && predecessor.sourceCustodyDigest !== null && !isDigest(predecessor.sourceCustodyDigest)) return result("PREDECESSOR_MISMATCH");
    const capabilitySpecs = supplied.capabilities || {};
    const capabilityInputs = {};
    const capabilityRefs = new Set();
    for (const kind of Object.keys(CAPABILITY_FAMILIES)) {
      const spec = clone(capabilitySpecs[kind] || capabilitySpecs[CAPABILITY_FAMILIES[kind]] || {});
      if (hasForbiddenBoundary(spec)) return result("UNAUTHORIZED");
      const scope = {
        principalRef: spec.principalRef || principalRef, projectRef: spec.projectRef || projectRef,
        taskRef: spec.taskRef || taskRef, jobRef: spec.jobRef === undefined ? "*" : spec.jobRef,
        subscriptionRef: spec.subscriptionRef === undefined ? "*" : spec.subscriptionRef,
        projectionDigest: spec.projectionDigest === undefined ? "*" : spec.projectionDigest,
        continuationRef: spec.continuationRef === undefined ? "*" : spec.continuationRef,
        contractDigest: spec.contractDigest === undefined ? "*" : spec.contractDigest,
      };
      const revision = spec.capabilityRevision || `${kind}-capability-revision-1`;
      const ref = spec.capabilityRef || this._capabilityRef(CAPABILITY_FAMILIES[kind], scope, revision);
      const scopeDigest = spec.scopeDigest || this._scopeDigest(scope);
      const currentRevisionRef = spec.currentRevisionRef || this._ref("CapabilityRevision", { ref, revision });
      const budgetRef = spec.budgetRef || this._ref("CapabilityBudget", { ref, revision });
      const remainingBudget = Number.isInteger(spec.budget) ? spec.budget : 100;
      if (capabilityRefs.has(ref)) return result("CAPABILITY_NON_SUBSTITUTION");
      if (!isDigest(scopeDigest) || !isDigest(currentRevisionRef) || !isDigest(budgetRef) || remainingBudget < 1) return result("UNAUTHORIZED");
      capabilityRefs.add(ref);
      capabilityInputs[kind] = { spec, scope, revision, ref, scopeDigest, currentRevisionRef, budgetRef, remainingBudget };
    }
    const continuation = clone(supplied.continuation || supplied.continuationContract || {});
    if (hasForbiddenBoundary(continuation)) return result("UNAUTHORIZED");
    const continuationRef = continuation.continuationRef || this._ref("Continuation", { taskRef, contract: continuation.contract || "dss06-task-wakeup-v1" });
    const contractDigest = continuation.contractDigest || digest("Dss06.ContinuationContract", { taskRef, continuationRef, contract: continuation.contract || "dss06-task-wakeup-v1" });
    if (!validRef(continuationRef) || !isDigest(contractDigest)) return result("UNAUTHORIZED");
    const commitment = authorityBootstrap.bootstrapCommitment || authorityBootstrap.commitment;
    const attempt = authorityBootstrap.bootstrapAttempt || authorityBootstrap.attempt;
    const authorization = authorityBootstrap.bootstrapAuthorization || authorityBootstrap.authorization;
    let pinStatus;
    try {
      if (!commitment || !attempt || !authorization) return result("AUTHORITY_BOOTSTRAP_INVALID");
      pinStatus = bootstrap.verifyOwnerBootstrapRootPin({ installationRoot: this.authorityInstallationRoot });
      bootstrap.verifyBootstrapArtifacts({
        installationRoot: this.authorityInstallationRoot,
        profileRoot: this.authorityProfileRoot,
        commitmentRow: { payload_json: canonicalJson(commitment) },
        attemptRow: { attempt_ref: attempt.attemptRef, attempt_digest: attempt.attemptDigest },
        authorizationRow: { payload_json: canonicalJson(authorization), authorization_digest: authorization.authorizationDigest },
      });
      if (authorization.decision !== "AUTHORIZED_ONCE" || attempt.state !== "ATTEMPT_CLAIMED" || commitment.profileRef !== this.authorityProfileRef) return result("AUTHORITY_BOOTSTRAP_INVALID");
    } catch (_) { return result("AUTHORITY_BOOTSTRAP_INVALID"); }
    const authorityPlan = {
      profileRef: this.authorityProfileRef, ownerRootFingerprint: pinStatus.pin.ownerRootFingerprint, ownerRootPinDigest: pinStatus.pin.pinDigest,
      commitmentRef: commitment.commitmentRef, commitmentDigest: commitment.commitmentDigest, attemptRef: attempt.attemptRef, attemptDigest: attempt.attemptDigest,
      authorizationRef: authorization.authorizationRef, authorizationDigest: authorization.authorizationDigest,
    };
    const semanticPlan = {
      principal: principalData, project: projectData, task: taskData, workThread: threadData, predecessor,
      principalRef, projectRef, projectRevisionRef, taskRef, workThreadRef, predecessorRef: this._ref("Dss05Disposition", { dss05DispositionRef, dss05DispositionDigest, dss05ArtifactLineageRefsDigest }),
      dss05DispositionRef, dss05DispositionDigest, dss05ArtifactLineageRefsDigest,
      capabilities: capabilityInputs, continuation: { ...continuation, continuationRef, contractDigest }, continuationRef, contractDigest,
    };
    const plan = { schema: "direct_semantic_dss06_bootstrap_plan@1", serviceGeneration: this.serviceGeneration, semantic: semanticPlan, authority: authorityPlan };
    const planDigest = digest("Dss06.BootstrapPlan", plan);
    let intent = this.state.bootstrapIntent;
    if (intent) {
      try { this._verifyBootstrapIntent(); } catch (error) { return result("BROKEN", { reason: error.code || "DSS06_BOOTSTRAP_INTENT_INVALID" }); }
      if (intent.planDigest !== planDigest) return result("AUTHORITY_BOOTSTRAP_MISMATCH");
      if (intent.state === "COMPLETE") return result("REPLAYED", { references: this._bootstrapReferences() });
    } else {
      const intentBase = { schema: "direct_semantic_dss06_bootstrap_intent@1", state: "PREPARED", planDigest, plan, preparedAt: this.clock(), authorityEffect: AUTH_NONE };
      intent = { ...intentBase, intentDigest: digest("Dss06.BootstrapIntent", intentBase) };
      this.state.bootstrapIntent = intent;
      if (this._consumeBootstrapFault("before-prepared")) return fail("STALE_CURRENTNESS", { phase: "BEFORE_PREPARED" });
      try { this._persist(); } catch (error) { this._restore(before); if (error.code === "DSS06_SQLITE_INJECTED_FAILURE") return result("STALE_CURRENTNESS", { errorCode: error.code, phase: "BEFORE_PREPARED" }); throw error; }
      if (this._consumeBootstrapFault("after-prepared")) return result("STALE_CURRENTNESS", { phase: "AFTER_PREPARED" });
    }
    if (this._authorityStatus.status === "CURRENT") {
      if (!this._authorityMatchesBootstrapPlan(plan)) return result("BROKEN", { reason: "DSS06_BOOTSTRAP_AUTHORITY_MISMATCH" });
      return this._completePreparedBootstrap();
    }
    if (this._authorityStatus.status !== "UNPROVISIONED" || !this.#authorityStore || !this.#authority) return result("BOOTSTRAP_BLOCKED", { reason: "DSS06_BOOTSTRAP_AUTHORITY_UNAVAILABLE" });
    try {
      this.#authorityStore.createGeneration(DSS02_SCHEMA);
      this.#authority.bootstrapDaemonAuthority({ bootstrapAuthorization: authorization, bootstrapCommitment: commitment, bootstrapAttempt: attempt, administratorPublicKey: pinStatus.pin.ownerRootPublicKey, attemptReceiptDigest: attempt.attemptDigest, keyring: this.#authorityKeyring });
      this._authorityStatus = this._refreshAuthorityFoundation();
    } catch (error) {
      this._authorityStatus = Object.freeze({ status: "BROKEN", reason: error.code || "DSS06_AUTHORITY_BOOTSTRAP_FAILED" });
      return result("AUTHORITY_BOOTSTRAP_INVALID", { reason: this._authorityStatus.reason });
    }
    if (this._consumeBootstrapFault("after-authority")) return result("STALE_CURRENTNESS", { phase: "AFTER_AUTHORITY" });
    return this._completePreparedBootstrap();
  }

  _bootstrapReferences() { return clone(this.state.bootstrap?.refs || {}); }
  bootstrapOwnerIssued(input = {}) { return this.bootstrapOwnerIssuedRecords(input); }
  provisionOwnerIssuedRecords(input = {}) { return this.bootstrapOwnerIssuedRecords(input); }
  issueOwnerIssuedCapabilities(input = {}) { return this.bootstrapOwnerIssuedRecords(input); }

  _bindCapability(kind, input = {}) {
    if (this._capInputRejected(input)) return result("UNAUTHORIZED");
    const authority = this._validateAuthorityFoundation(); if (!authority.ok) return result(authority.code);
    const ref = this._capabilityInput(input, kind); const cap = ref && this.state.capabilities[ref];
    if (!cap || cap.ownerIssued !== true || cap.serviceGeneration !== this.serviceGeneration || cap.issuerVerifierRef !== authority.foundation.verifierRef || cap.issuerVerifierRevision !== authority.foundation.verifierRevision || cap.authoritySourceDigest !== authority.foundation.sourceDigest || cap.family !== CAPABILITY_FAMILIES[kind] || cap.carrierId !== CAPABILITY_CARRIERS[kind]) return result("UNAUTHORIZED");
    if (cap.state === "CURRENT") return result("REPLAYED", { capability: clone(cap) });
    if (cap.state === "EXPIRED") return result("EXPIRED");
    if (cap.state === "REVOKED") return result("REVOKED");
    const operation = CAPABILITY_BIND_OPS[kind]; const operationInput = { capabilityRef: ref, family: cap.family, currentRevisionRef: cap.currentRevisionRef, scopeDigest: cap.scopeDigest };
    const key = this._ref(`Operation.${operation}`, operationInput); const prior = this._replay(operation, key, "capabilities", ref); if (prior) return prior;
    return this._commit(() => { cap.state = "CURRENT"; cap.boundAt = this.clock(); this._remember(operation, key, ref, operationInput); this._transition(operation, CAPABILITY_CARRIERS[kind], "VERIFY", cap, "CURRENT", "ABSENT", "CURRENT"); return result("CURRENT", { capability: clone(cap) }); });
  }
  bindSubmitCapability(input = {}) { return this._bindCapability("submit", input); }
  bindReadCapability(input = {}) { return this._bindCapability("read", input); }
  bindSubscribeAckCapability(input = {}) { return this._bindCapability("subscribe-ack", input); }
  bindWakeupCapability(input = {}) { return this._bindCapability("wakeup", input); }
  bindSubscribeCapability(input = {}) { return this.bindSubscribeAckCapability(input); }

  _packageInput(input) {
    const supplied = clone(input.package || input.auditPackage || input.workThreadEnvelope || input);
    if (!isObject(supplied) || hasForbiddenBoundary(supplied)) return null;
    if (["capability", "submitCapability", "readCapability", "subscribeAckCapability", "wakeupCapability", "verifier", "authorization", "grant"].some((key) => isObject(supplied[key]))) return null;
    const fields = {
      projectRef: alias(supplied, "projectRef", "project_ref"), projectRegistryRevisionRef: alias(supplied, "projectRegistryRevisionRef", "project_registry_revision_ref"),
      taskRef: alias(supplied, "taskRef", "task_ref"), workThreadRef: alias(supplied, "workThreadRef", "work_thread_ref"), principalRef: alias(supplied, "principalRef", "principal_ref"),
      submitCapabilityRef: alias(supplied, "submitCapabilityRef", "submit_capability_ref"), readCapabilityRef: alias(supplied, "readCapabilityRef", "read_capability_ref"),
      subscribeAckCapabilityRef: alias(supplied, "subscribeAckCapabilityRef", "subscribe_ack_capability_ref"), wakeupCapabilityRef: alias(supplied, "wakeupCapabilityRef", "wakeup_capability_ref"),
      dss05DispositionRef: alias(supplied, "dss05DispositionRef", "dss05_disposition_ref"), dss05DispositionDigest: alias(supplied, "dss05DispositionDigest", "dss05_disposition_digest"),
      dss05ArtifactLineageRefsDigest: alias(supplied, "dss05ArtifactLineageRefsDigest", "dss05_artifact_lineage_refs_digest"), idempotencyKey: alias(supplied, "idempotencyKey", "idempotency_key"),
      packageSchemaRevision: alias(supplied, "packageSchemaRevision", "package_schema_revision") || "direct-semantic-dss06-audit-package@1",
    };
    const envelope = { ...supplied, ...fields };
    for (const key of Object.keys(envelope)) if (envelope[key] === undefined) delete envelope[key];
    delete envelope.packageRef; delete envelope.packageDigest; delete envelope.state; delete envelope.admittedAt; delete envelope.boundAt;
    return envelope;
  }
  _predecessorForPackage(pkg) {
    return Object.values(this.state.registries.predecessorDispositions).find((record) => record.dss05DispositionRef === pkg.dss05DispositionRef && record.dss05DispositionDigest === pkg.dss05DispositionDigest && record.dss05ArtifactLineageRefsDigest === pkg.dss05ArtifactLineageRefsDigest) || null;
  }
  submitAuditPackage(input = {}) {
    if (this._capInputRejected(input)) return result("UNAUTHORIZED");
    const identityEnvelope = input.package || input.auditPackage || input.workThreadEnvelope || input;
    if (["principal", "project", "task", "workThread", "thread", "owner", "root"].some((key) => isObject(identityEnvelope?.[key]))) return result("REJECTED", { reason: "IDENTITY_NOT_PROVEN" });
    const pkg = this._packageInput(input); if (!pkg) return result("REJECTED");
    const requiredFields = ["projectRef", "projectRegistryRevisionRef", "taskRef", "workThreadRef", "principalRef", "submitCapabilityRef", "readCapabilityRef", "subscribeAckCapabilityRef", "wakeupCapabilityRef", "dss05DispositionRef", "dss05DispositionDigest", "dss05ArtifactLineageRefsDigest", "idempotencyKey"];
    if (!requiredFields.every((field) => validRef(pkg[field]))) return result("REJECTED", { reason: "IDENTITY_NOT_PROVEN" });
    const principal = this.state.registries.principals[pkg.principalRef]; const project = this.state.registries.projects[pkg.projectRef]; const task = this.state.registries.tasks[pkg.taskRef]; const thread = this.state.registries.workThreads[pkg.workThreadRef]; const predecessor = this._predecessorForPackage(pkg);
    if (!principal || !project || !task || !thread || task.projectRef !== pkg.projectRef || thread.taskRef !== pkg.taskRef || thread.principalRef !== pkg.principalRef || project.projectRegistryRevisionRef !== pkg.projectRegistryRevisionRef || !predecessor) return result("PREDECESSOR_MISMATCH", { reason: "IDENTITY_NOT_PROVEN" });
    const cap = this._authorizeCapability(pkg.submitCapabilityRef, "submit", { principalRef: pkg.principalRef, projectRef: pkg.projectRef, taskRef: pkg.taskRef, scopeDigest: input.scopeDigest });
    if (!cap.ok) return this._authorizationFailure("submit", cap);
    const packageDigest = this._ref("AuditPackageCanonical", pkg); const packageRef = this._ref("AuditPackage", { packageDigest, serviceGeneration: this.serviceGeneration });
    if (input.packageRef && input.packageRef !== packageRef) return result("REJECTED", { reason: "PACKAGE_IDENTITY_MISMATCH" });
    const operationInput = { principalRef: pkg.principalRef, projectRef: pkg.projectRef, taskRef: pkg.taskRef, idempotencyKey: pkg.idempotencyKey, packageDigest };
    /* Idempotency is scoped by the caller's exact identity tuple, not by the
     * package digest.  A changed package with the same key must conflict and
     * cannot create a second service-owned job. */
    const key = this._ref("Operation.submit-audit-package", { principalRef: pkg.principalRef, projectRef: pkg.projectRef, taskRef: pkg.taskRef, idempotencyKey: pkg.idempotencyKey });
    const prior = this.state.operationInputs[key];
    if (prior) {
      if (prior.operation !== "submit-audit-package" || prior.packageDigest !== packageDigest) return result("IDEMPOTENCY_CONFLICT");
      return result("REPLAYED", { package: clone(this.state.packages[prior.ref]), job: clone(this.state.jobs[prior.jobRef]), lineage: clone(this.state.lineages[prior.lineageRef]) });
    }
    const jobRef = this._ref("AuditJob", { packageRef, packageDigest, serviceGeneration: this.serviceGeneration });
    const lineageRef = this._ref("AuditLineage", { packageRef, jobRef, dss05DispositionRef: pkg.dss05DispositionRef, dss05DispositionDigest: pkg.dss05DispositionDigest, dss05ArtifactLineageRefsDigest: pkg.dss05ArtifactLineageRefsDigest, serviceGeneration: this.serviceGeneration });
    return this._commit(() => {
      this._authorizeCapability(pkg.submitCapabilityRef, "submit", { principalRef: pkg.principalRef, projectRef: pkg.projectRef, taskRef: pkg.taskRef }, { consume: true });
      const packageRecord = { ...pkg, packageRef, packageDigest, state: "UNSUBMITTED", serviceGeneration: this.serviceGeneration, authorityEffect: AUTH_NONE, submittedAt: this.clock() };
      this._set("packages", packageRef, packageRecord); this._transition("submit-audit-package", "d.audit-package", "SUBMIT", packageRecord, "SUBMITTED", "UNSUBMITTED", "SUBMITTED");
      packageRecord.state = "BOUND"; packageRecord.boundAt = this.clock(); this._transition("submit-audit-package", "d.audit-package", "BIND", packageRecord, "BOUND", "SUBMITTED", "BOUND");
      const job = { jobRef, packageRef, packageDigest, projectRef: pkg.projectRef, taskRef: pkg.taskRef, workThreadRef: pkg.workThreadRef, principalRef: pkg.principalRef, jobIdempotencyDigest: this._ref("JobIdempotency", operationInput), serviceGenerationRef: this.serviceGeneration, dss06_service_generation: this.serviceGeneration, state: "UNSEEN", authorityEffect: AUTH_NONE, admittedAt: this.clock() };
      this._set("jobs", jobRef, job); job.state = "ADMITTED"; this._transition("submit-audit-package", "d.audit-job", "ADMIT", job, "ADMITTED", "UNSEEN", "ADMITTED");
      const lineage = { lineageRef, packageRef, jobRef, dss05ModuleId: predecessor.dss05ModuleId, dss05ModuleDigest: predecessor.dss05ModuleDigest, dss05DispositionRef: predecessor.dss05DispositionRef, dss05DispositionDigest: predecessor.dss05DispositionDigest, artifactRefsDigest: predecessor.dss05ArtifactLineageRefsDigest, sourceCustodyDigest: predecessor.sourceCustodyDigest, dss06_service_generation: this.serviceGeneration, state: "ABSENT", authorityEffect: AUTH_NONE };
      this._set("lineages", lineageRef, lineage); lineage.state = "BOUND"; this._transition("submit-audit-package", "e.audit-lineage", "BIND", lineage, "BOUND", "ABSENT", "BOUND");
      this._remember("submit-audit-package", key, packageRef, { ...operationInput, jobRef, lineageRef }); this.state.operationInputs[key].jobRef = jobRef; this.state.operationInputs[key].lineageRef = lineageRef; this.state.operationInputs[key].packageDigest = packageDigest;
      return result("BOUND", { package: clone(packageRecord), job: clone(job), lineage: clone(lineage) });
    });
  }
  submitAuditPackageFromWorkThread(input = {}) { return this.submitAuditPackage(input); }
  submitPackage(input = {}) { return this.submitAuditPackage(input); }

  startAuditAttempt(input = {}) {
    const packageRef = alias(input, "packageRef", "package_ref"); const jobRef = alias(input, "jobRef", "job_ref"); const pkg = this._lookup("packages", packageRef, ["packageRef"]); const job = this._lookup("jobs", jobRef, ["jobRef"]);
    if (!pkg || !job || job.packageRef !== pkg.packageRef || pkg.state !== "BOUND" || job.state !== "ADMITTED") return result("JOB_NOT_READY");
    const ordinal = Number.isInteger(input.attemptOrdinal) ? input.attemptOrdinal : 1;
    if (ordinal < 1 || ordinal > 1) return result("OVER_BUDGET");
    const attemptRef = this._ref("AuditAttempt", { jobRef: job.jobRef, packageRef: pkg.packageRef, attemptOrdinal: ordinal, serviceGeneration: this.serviceGeneration });
    const opInput = { packageRef: pkg.packageRef, jobRef: job.jobRef, attemptOrdinal: ordinal, attemptRef }; const key = this._ref("Operation.start-audit-attempt", opInput); const prior = this._replay("start-audit-attempt", key, "attempts", attemptRef); if (prior) return prior;
    if (Object.values(this.state.attempts).some((attempt) => attempt.jobRef === job.jobRef && attempt.state !== "CANCELLED")) return result("OVER_BUDGET");
    return this._commit(() => {
      const attempt = { attemptRef, jobRef: job.jobRef, packageRef: pkg.packageRef, attemptOrdinal: ordinal, attemptLineageDigest: this._ref("AttemptLineage", { jobRef: job.jobRef, packageRef: pkg.packageRef, ordinal }), allocatedAt: this.clock(), terminalAt: null, dss06_service_generation: this.serviceGeneration, state: "UNALLOCATED", authorityEffect: AUTH_NONE };
      this._set("attempts", attemptRef, attempt); attempt.state = "ALLOCATED"; this._transition("start-audit-attempt", "d.audit-attempt", "ALLOCATE", attempt, "ALLOCATED", "UNALLOCATED", "ALLOCATED"); attempt.state = "STARTED"; attempt.startedAt = this.clock(); this._transition("start-audit-attempt", "d.audit-attempt", "START", attempt, "STARTED", "ALLOCATED", "STARTED");
      job.state = "RUNNING"; job.startedAt = this.clock(); this._transition("start-audit-attempt", "d.audit-job", "START", job, "RUNNING", "ADMITTED", "RUNNING");
      this._remember("start-audit-attempt", key, attemptRef, opInput); return result("STARTED", { job: clone(job), attempt: clone(attempt) });
    });
  }
  startAttempt(input = {}) { return this.startAuditAttempt(input); }

  recordAuditDecision(input = {}) {
    const attemptRef = alias(input, "attemptRef", "attempt_ref"); const attempt = this._lookup("attempts", attemptRef, ["attemptRef"]); const job = attempt && this.state.jobs[attempt.jobRef]; const lineage = job && Object.values(this.state.lineages).find((item) => item.jobRef === job.jobRef);
    if (!attempt || !job || !lineage || attempt.state !== "STARTED") return result("REJECTED", { reason: "ATTEMPT_NOT_READY" });
    const suppliedDigest = alias(input, "dss05DispositionDigest", "dss05_disposition_digest", "sourceLineageDigest"); if (suppliedDigest && suppliedDigest !== lineage.dss05DispositionDigest) return result("LINEAGE_MISMATCH");
    const kind = String(alias(input, "decisionKind", "decision", "status") || "RECORDED").toUpperCase(); const state = kind === "UNKNOWN" || kind === "UNKNOWN_TERMINAL" ? "UNKNOWN" : kind === "REMAND" || kind === "REMANDED" ? "REMANDED" : kind === "REJECT" || kind === "REJECTED" ? "REJECTED" : "RECORDED";
    const event = state === "UNKNOWN" ? "UNKNOWN_TERMINAL" : state === "REMANDED" ? "REMAND" : state === "REJECTED" ? "REJECT" : "RECORD"; const decisionRef = this._ref("AuditDecision", { attemptRef, jobRef: job.jobRef, dss05DispositionDigest: lineage.dss05DispositionDigest, decisionKind: state, serviceGeneration: this.serviceGeneration }); const opInput = { attemptRef, jobRef: job.jobRef, decisionRef, decisionKind: state, sourceLineageDigest: lineage.dss05DispositionDigest }; const key = this._ref("Operation.record-audit-decision", opInput); const prior = this._replay("record-audit-decision", key, "decisions", decisionRef); if (prior) return prior;
    if (Object.values(this.state.decisions).some((decision) => decision.attemptRef === attemptRef)) return result("IDEMPOTENCY_CONFLICT");
    return this._commit(() => {
      attempt.state = state === "UNKNOWN" ? "UNKNOWN" : "TERMINAL"; attempt.terminalAt = this.clock(); attempt.terminalOutcome = state; this._transition("record-audit-decision", "d.audit-attempt", event === "RECORD" ? "COMPLETE" : event, attempt, state === "UNKNOWN" ? "UNKNOWN" : "TERMINAL", "STARTED", state === "UNKNOWN" ? "UNKNOWN" : "TERMINAL");
      /* The frozen decision carrier has no UNKNOWN state.  An unknown
       * execution therefore closes the attempt as UNKNOWN but records the
       * advisory decision through the typed REJECTED terminal branch; the
       * decisionKind preserves the reason for the resulting FAILED
       * disposition without laundering a state outside the declaration. */
      const decisionState = state === "UNKNOWN" ? "REJECTED" : state;
      const decision = { decisionRef, jobRef: job.jobRef, packageRef: job.packageRef, attemptRef, dss05DispositionRef: lineage.dss05DispositionRef, dss05DispositionDigest: lineage.dss05DispositionDigest, decisionKind: state, sourceLineageDigest: lineage.dss05DispositionDigest, dss06_service_generation: this.serviceGeneration, state: decisionState, authorityEffect: AUTH_NONE, recordedAt: this.clock() };
      this._set("decisions", decisionRef, decision); this._transition("record-audit-decision", "d.audit-decision", decisionState === "RECORDED" ? "RECORD" : decisionState === "REMANDED" ? "REMAND" : "REJECT", decision, decisionState, "ABSENT", decisionState); this._remember("record-audit-decision", key, decisionRef, opInput); return result(state === "UNKNOWN" ? "UNKNOWN" : state, { attempt: clone(attempt), decision: clone(decision) });
    });
  }
  recordDecision(input = {}) { return this.recordAuditDecision(input); }

  sealAuditDisposition(input = {}) {
    const jobRef = alias(input, "jobRef", "job_ref"); const job = this._lookup("jobs", jobRef, ["jobRef"]); const pkg = job && this.state.packages[job.packageRef]; const attempt = job && Object.values(this.state.attempts).find((item) => item.jobRef === job.jobRef); const decision = attempt && Object.values(this.state.decisions).find((item) => item.attemptRef === attempt.attemptRef); const lineage = job && Object.values(this.state.lineages).find((item) => item.jobRef === job.jobRef);
    if (!job || !pkg || !attempt || !decision || !lineage) return result("POPULATION_MISMATCH");
    if (input.packageRef && input.packageRef !== pkg.packageRef || input.attemptRef && input.attemptRef !== attempt.attemptRef || input.decisionRef && input.decisionRef !== decision.decisionRef) return result("POPULATION_MISMATCH");
    if (attempt.state !== "TERMINAL" && attempt.state !== "UNKNOWN") return result("TERMINAL");
    if (Object.values(this.state.dispositions).some((item) => item.jobRef === job.jobRef)) return result("REPLAYED", { disposition: clone(Object.values(this.state.dispositions).find((item) => item.jobRef === job.jobRef)) });
    const status = job.state === "CANCELLED" ? "CANCELLED" : decision.state === "REMANDED" ? "REMANDED" : decision.state === "UNKNOWN" || decision.state === "REJECTED" ? "FAILED" : "SEALED";
    const dispositionRef = this._ref("AuditDisposition", { jobRef: job.jobRef, packageRef: pkg.packageRef, decisionRef: decision.decisionRef, status, dss05DispositionDigest: lineage.dss05DispositionDigest, serviceGeneration: this.serviceGeneration }); const opInput = { jobRef: job.jobRef, packageRef: pkg.packageRef, attemptRef: attempt.attemptRef, decisionRef: decision.decisionRef, status, lineageRef: lineage.lineageRef }; const key = this._ref("Operation.seal-audit-disposition", opInput); const prior = this._replay("seal-audit-disposition", key, "dispositions", dispositionRef); if (prior) return prior;
    return this._commit(() => {
      if (job.state === "RUNNING") { job.state = "TERMINAL"; job.terminalAt = this.clock(); this._transition("seal-audit-disposition", "d.audit-job", "COMPLETE", job, "TERMINAL", "RUNNING", "TERMINAL"); }
      const disposition = { dispositionRef, jobRef: job.jobRef, packageRef: pkg.packageRef, dss05DispositionRef: lineage.dss05DispositionRef, dss05DispositionDigest: lineage.dss05DispositionDigest, decisionRefsDigest: this._ref("DecisionRefs", [decision.decisionRef]), artifactLineageDigest: lineage.artifactRefsDigest, status, authorityEffect: AUTH_NONE, dss06_service_generation: this.serviceGeneration, state: "ABSENT", sealedAt: this.clock() };
      this._set("dispositions", dispositionRef, disposition); const event = status === "SEALED" ? "SEAL" : status === "REMANDED" ? "REMAND" : status === "CANCELLED" ? "CANCEL" : "FAIL"; disposition.state = status; this._transition("seal-audit-disposition", "d.audit-disposition", event, disposition, status, "ABSENT", status); this._remember("seal-audit-disposition", key, dispositionRef, opInput); return result(status, { job: clone(job), disposition: clone(disposition) });
    });
  }
  sealDisposition(input = {}) { return this.sealAuditDisposition(input); }

  _safeJob(job) { return job && (({ jobRef, packageRef, packageDigest, projectRef, taskRef, workThreadRef, principalRef, state, serviceGenerationRef, authorityEffect }) => ({ jobRef, packageRef, packageDigest, projectRef, taskRef, workThreadRef, principalRef, state, serviceGenerationRef, authorityEffect }))(job); }
  _safeAttempt(attempt) { return attempt && (({ attemptRef, jobRef, packageRef, attemptOrdinal, attemptLineageDigest, state, terminalOutcome, authorityEffect }) => ({ attemptRef, jobRef, packageRef, attemptOrdinal, attemptLineageDigest, state, terminalOutcome, authorityEffect }))(attempt); }
  _safeDecision(decision) { return decision && (({ decisionRef, jobRef, packageRef, attemptRef, dss05DispositionRef, dss05DispositionDigest, decisionKind, sourceLineageDigest, state, authorityEffect }) => ({ decisionRef, jobRef, packageRef, attemptRef, dss05DispositionRef, dss05DispositionDigest, decisionKind, sourceLineageDigest, state, authorityEffect }))(decision); }
  _safeDisposition(disposition) { return disposition && (({ dispositionRef, jobRef, packageRef, dss05DispositionRef, dss05DispositionDigest, decisionRefsDigest, artifactLineageDigest, status, state, authorityEffect }) => ({ dispositionRef, jobRef, packageRef, dss05DispositionRef, dss05DispositionDigest, decisionRefsDigest, artifactLineageDigest, status, state, authorityEffect }))(disposition); }
  _safeSubscription(subscription) { return subscription && (({ subscriptionRef, jobRef, packageRef, subscriberPrincipalRef, readCapabilityRevisionRef, subscribeAckCapabilityRevisionRef, eventFilterDigest, returnProjectionDigest, deliveryAdapter, startingCursor, revocationEpoch, state, authorityEffect }) => ({ subscriptionRef, jobRef, packageRef, subscriberPrincipalRef, readCapabilityRevisionRef, subscribeAckCapabilityRevisionRef, eventFilterDigest, returnProjectionDigest, deliveryAdapter, startingCursor, revocationEpoch, state, authorityEffect }))(subscription); }
  _projection(disposition, job) { return { schema: "direct_semantic_dss06_bounded_disposition_projection@1", jobRef: job.jobRef, packageRef: job.packageRef, dispositionRef: disposition.dispositionRef, status: disposition.status, dss05DispositionRef: disposition.dss05DispositionRef, dss05DispositionDigest: disposition.dss05DispositionDigest, artifactLineageDigest: disposition.artifactLineageDigest, authorityEffect: AUTH_NONE }; }
  _headDigest() { return this._ref("EventLedgerHead", { sequence: this.state.events.length, eventDigest: this.state.events.at(-1)?.eventDigest || null }); }

  observeDaemonHealth(input = {}) {
    if (this._capInputRejected(input)) return result("OBSERVATION_AUTHORITY_INVALID");
    const ref = this._capabilityInput(input, "read"); const request = { principalRef: input.principalRef, projectRef: input.projectRef, taskRef: input.taskRef, jobRef: input.jobRef, projectionDigest: input.projectionDigest || "*", scopeDigest: input.scopeDigest, currentRevisionRef: input.currentRevisionRef, revocationEpoch: input.revocationEpoch, timeFence: input.timeFence };
    const auth = this._authorizeCapability(ref, "read", request); if (!auth.ok) return this._authorizationFailure("read", auth, { observation: true });
    const requested = String(input.healthState || input.state || this.state.daemonHealth || "UNAVAILABLE").toUpperCase(); const target = ["HEALTHY", "DEGRADED", "UNAVAILABLE"].includes(requested) ? requested : "UNAVAILABLE"; const healthRef = this._ref("DaemonHealth", { serviceGeneration: this.serviceGeneration }); const current = this.state.health[healthRef];
    if (target === "DEGRADED" && !current) return result("OBSERVATION_NOT_READY");
    return this._commit(() => {
      this._authorizeCapability(ref, "read", request, { consume: true });
      if (target === "UNAVAILABLE") return result("UNAVAILABLE");
      if (current && current.state === target) return result("REPLAYED", { observation: clone(current) });
      const from = current?.state || "UNOBSERVED"; const event = target === "DEGRADED" ? "DEGRADE" : target === "HEALTHY" && from !== "UNOBSERVED" ? "RESTORE" : "OBSERVE"; const observation = { healthRef, serviceGeneration: this.serviceGeneration, daemonHeadDigest: this._headDigest(), healthState: target, observedAt: this.clock(), dss06_service_generation: this.serviceGeneration, state: target, authorityEffect: AUTH_NONE };
      this._set("health", healthRef, observation); this._transition("observe-daemon-health", "e.daemon-health-observation", event, observation, target, from, target); return result(target, { observation: clone(observation) });
    });
  }
  observeHealth(input = {}) { return this.observeDaemonHealth(input); }

  inspectAuditSurfaces(input = {}) {
    if (this._capInputRejected(input)) return result("OBSERVATION_AUTHORITY_INVALID");
    const ref = this._capabilityInput(input, "read"); const jobRef = alias(input, "jobRef", "job_ref"); const request = { principalRef: input.principalRef, projectRef: input.projectRef, taskRef: input.taskRef, jobRef: jobRef || "*", projectionDigest: input.projectionDigest || "*", scopeDigest: input.scopeDigest, currentRevisionRef: input.currentRevisionRef, revocationEpoch: input.revocationEpoch, timeFence: input.timeFence };
    const auth = this._authorizeCapability(ref, "read", request); if (!auth.ok) return this._authorizationFailure("read", auth, { observation: true });
    const headDigest = this._headDigest(); if (input.headDigest && input.headDigest !== headDigest) return result("STALE_HEAD");
    const jobs = Object.values(this.state.jobs).filter((item) => !jobRef || jobRef === "*" || item.jobRef === jobRef).map((item) => this._safeJob(item)); const attempts = Object.values(this.state.attempts).filter((item) => !jobRef || jobRef === "*" || this.state.jobs[item.jobRef]?.jobRef === jobRef).map((item) => this._safeAttempt(item)); const decisions = Object.values(this.state.decisions).filter((item) => !jobRef || jobRef === "*" || this.state.jobs[item.jobRef]?.jobRef === jobRef).map((item) => this._safeDecision(item)); const dispositions = Object.values(this.state.dispositions).filter((item) => !jobRef || jobRef === "*" || item.jobRef === jobRef).map((item) => this._safeDisposition(item)); const subscriptions = Object.values(this.state.subscriptions).filter((item) => !jobRef || jobRef === "*" || item.jobRef === jobRef).map((item) => this._safeSubscription(item));
    const projection = { headDigest, jobs, attempts, decisions, dispositions, subscriptions }; const projectionDigest = this._ref("AuditSurfaceProjection", projection);
    if (input.projectionDigest && input.projectionDigest !== "*" && input.projectionDigest !== projectionDigest) return result("STALE_HEAD");
    return this._commit(() => { this._authorizeCapability(ref, "read", request, { consume: true }); return result("AUTHORIZED", { projectionDigest, headDigest, jobs, attempts, decisions, dispositions, subscriptions }); });
  }
  inspectSurfaces(input = {}) { return this.inspectAuditSurfaces(input); }

  createDispositionSubscription(input = {}) {
    if (this._capInputRejected(input)) return result("DENIED");
    const jobRef = alias(input, "jobRef", "job_ref"); const job = this.state.jobs[jobRef]; const disposition = job && Object.values(this.state.dispositions).find((item) => item.jobRef === jobRef); if (!job || !disposition || !["SEALED", "REMANDED", "FAILED", "CANCELLED"].includes(disposition.status)) return result("DENIED");
    const subscriberPrincipalRef = alias(input, "subscriberPrincipalRef", "subscriber_principal_ref", "principalRef", "principal_ref"); const readRef = this._capabilityInput(input, "read"); const ackRef = alias(input, "subscribeAckCapabilityRef", "subscribe_ack_capability_ref", "ackCapabilityRef", "ack_capability_ref"); const readAuth = this._authorizeCapability(readRef, "read", { principalRef: subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef }); const ackAuth = this._authorizeCapability(ackRef, "subscribe-ack", { principalRef: subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef });
    if (!readAuth.ok) return this._authorizationFailure("read", readAuth); if (!ackAuth.ok) return this._authorizationFailure("subscribe-ack", ackAuth); if (!this.state.registries.principals[subscriberPrincipalRef]) return result("DENIED");
    const returnProjectionDigest = input.returnProjectionDigest || this._ref("DispositionProjection", this._projection(disposition, job)); const eventFilterDigest = input.eventFilterDigest || this._ref("EventFilter", input.eventFilter || ["disposition"]); const adapter = input.deliveryAdapter || input.adapter || "cli_poll"; if (!["cli_poll", "electron", "direct_task_wakeup"].includes(adapter)) return result("DENIED");
    const startingCursor = Number.isInteger(input.startingCursor) ? input.startingCursor : 0; if (startingCursor !== 0) return result("DENIED"); const subscriptionRef = this._ref("DeliverySubscription", { jobRef, subscriberPrincipalRef, readCapabilityRevisionRef: readAuth.cap.currentRevisionRef, subscribeAckCapabilityRevisionRef: ackAuth.cap.currentRevisionRef, eventFilterDigest, returnProjectionDigest, adapter, startingCursor, revocationEpoch: Math.max(readAuth.cap.revocationEpoch, ackAuth.cap.revocationEpoch), serviceGeneration: this.serviceGeneration }); const opInput = { subscriptionRef, jobRef, subscriberPrincipalRef, returnProjectionDigest, eventFilterDigest, adapter, readCapabilityRevisionRef: readAuth.cap.currentRevisionRef, subscribeAckCapabilityRevisionRef: ackAuth.cap.currentRevisionRef }; const key = this._ref("Operation.create-disposition-subscription", opInput); const prior = this._replay("create-disposition-subscription", key, "subscriptions", subscriptionRef); if (prior) return prior;
    return this._commit(() => {
      this._authorizeCapability(readRef, "read", { principalRef: subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef }, { consume: true }); this._authorizeCapability(ackRef, "subscribe-ack", { principalRef: subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef }, { consume: true });
      const wakeupCapabilityRef = this._capabilityInput(input, "wakeup"); const subscription = { subscriptionRef, jobRef, packageRef: job.packageRef, subscriberPrincipalRef, readCapabilityRef: readRef, subscribeAckCapabilityRef: ackRef, wakeupCapabilityRef: wakeupCapabilityRef || null, readCapabilityRevisionRef: readAuth.cap.currentRevisionRef, subscribeAckCapabilityRevisionRef: ackAuth.cap.currentRevisionRef, eventFilterDigest, returnProjectionDigest, deliveryAdapter: adapter, startingCursor, revocationEpoch: Math.max(readAuth.cap.revocationEpoch, ackAuth.cap.revocationEpoch), dss06_service_generation: this.serviceGeneration, state: "UNCREATED", authorityEffect: AUTH_NONE, createdAt: this.clock() };
      this._set("subscriptions", subscriptionRef, subscription); subscription.state = "ACTIVE"; this._transition("create-disposition-subscription", "e.delivery-subscription", "CREATE", subscription, "ACTIVE", "UNCREATED", "ACTIVE"); const cursorRef = this._ref("DeliveryCursor", { subscriptionRef, revision: this.serviceGeneration }); const cursor = { cursorRef, subscriptionRef, subscriptionRevisionRef: this._ref("SubscriptionRevision", subscription), acknowledgedSequence: startingCursor, acknowledgmentDigest: null, offeredSequence: startingCursor, globalEventHeadDigest: this._headDigest(), dss06_service_generation: this.serviceGeneration, state: "AT_START", authorityEffect: AUTH_NONE }; this._set("cursors", cursorRef, cursor); this._transition("create-disposition-subscription", "e.delivery-cursor", "INITIALIZE", cursor, "AT_START", "AT_START", "AT_START"); this._remember("create-disposition-subscription", key, subscriptionRef, opInput); this.state.operationInputs[key].cursorRef = cursorRef; return result("ACTIVE", { subscription: clone(subscription), cursor: clone(cursor) });
    });
  }
  createSubscription(input = {}) { return this.createDispositionSubscription(input); }

  _subscriptionCursor(subscription) { return Object.values(this.state.cursors).find((cursor) => cursor.subscriptionRef === subscription.subscriptionRef) || null; }
  _activeDispositionForSubscription(subscription) { const job = this.state.jobs[subscription.jobRef]; const disposition = job && Object.values(this.state.dispositions).find((item) => item.jobRef === job.jobRef); return { job, disposition }; }
  _offerProjectionDigest(disposition, job) { return this._ref("DispositionProjection", this._projection(disposition, job)); }
  offerDispositionDelivery(input = {}) {
    if (this._capInputRejected(input)) return result("DENIED"); const subscriptionRef = alias(input, "subscriptionRef", "subscription_ref"); const subscription = this.state.subscriptions[subscriptionRef]; if (!subscription) return result("DENIED"); const cursor = this._subscriptionCursor(subscription); const { job, disposition } = this._activeDispositionForSubscription(subscription); if (!cursor || !job || !disposition) return result("NO_NEW_EVENTS");
    const readRef = this._capabilityInput(input, "read"); const auth = this._authorizeCapability(readRef, "read", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, projectionDigest: subscription.returnProjectionDigest, currentRevisionRef: subscription.readCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch });
    if (!auth.ok) {
      if ((auth.code === "EXPIRED" || auth.code === "REVOKED" || auth.code === "STALE_CURRENTNESS") && subscription.state === "ACTIVE") return this._commit(() => { subscription.state = "PAUSED"; this._transition("offer-disposition-delivery", "e.delivery-subscription", "PAUSE", subscription, "PAUSED", "ACTIVE", "PAUSED"); return result("SUBSCRIPTION_PAUSED"); });
      return this._authorizationFailure("read", auth);
    }
    const currentOffer = Object.values(this.state.offers).find((offer) => offer.subscriptionRef === subscriptionRef && offer.state === "OFFERED"); if (currentOffer) return this._commit(() => { this._authorizeCapability(readRef, "read", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, projectionDigest: subscription.returnProjectionDigest, currentRevisionRef: subscription.readCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch }, { consume: true }); return result("REPLAYED", { offer: clone(currentOffer), cursor: clone(cursor) }); });
    if (!["ACTIVE"].includes(subscription.state)) return result("SUBSCRIPTION_PAUSED"); if (cursor.acknowledgedSequence >= 1) return result("NO_NEW_EVENTS", { cursor: clone(cursor) });
    const previousExpired = Object.values(this.state.offers).find((offer) => offer.subscriptionRef === subscriptionRef && ["EXPIRED_UNACKNOWLEDGED", "AUTHORITY_INVALIDATED"].includes(offer.state)); const event = previousExpired ? "REPLAY" : "OFFER"; const deliveryAttemptRef = this._ref("DeliveryAttempt", { subscriptionRef, attempt: Object.values(this.state.offers).filter((offer) => offer.subscriptionRef === subscriptionRef).length + 1, acknowledgedSequence: cursor.acknowledgedSequence }); const projection = this._projection(disposition, job); const projectionDigest = this._offerProjectionDigest(disposition, job); const offerRef = this._ref("DeliveryOffer", { subscriptionRef, deliveryAttemptRef, projectionDigest, firstSequence: 1, lastSequence: 1, serviceGeneration: this.serviceGeneration }); const opInput = { subscriptionRef, readCapabilityRef: readRef, deliveryAttemptRef, projectionDigest, firstSequence: 1, lastSequence: 1 }; const key = this._ref("Operation.offer-disposition-delivery", opInput); const prior = this._replay("offer-disposition-delivery", key, "offers", offerRef); if (prior) return prior;
    return this._commit(() => {
      this._authorizeCapability(readRef, "read", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, projectionDigest: subscription.returnProjectionDigest, currentRevisionRef: subscription.readCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch }, { consume: true });
      const offer = { deliveryAttemptRef, offerRef, subscriptionRef, jobRef: job.jobRef, packageRef: job.packageRef, firstSequence: 1, lastSequence: 1, projectionDigest, authorizationReceiptDigest: this._ref("DeliveryAuthorization", { readCapabilityRef: readRef, currentRevisionRef: auth.cap.currentRevisionRef, projectionDigest }), offeredAt: this.clock(), acknowledgmentDeadline: new Date(new Date(this.clock()).getTime() + 60000).toISOString(), projection, dss06_service_generation: this.serviceGeneration, state: "UNPREPARED", authorityEffect: AUTH_NONE };
      this._set("offers", offerRef, offer); offer.state = "OFFERED"; this._transition("offer-disposition-delivery", "e.delivery-offer", event, offer, "OFFERED", previousExpired ? previousExpired.state : "UNPREPARED", "OFFERED");
      const cursorPriorState = cursor.state; cursor.offeredSequence = 1; cursor.globalEventHeadDigest = this._headDigest(); cursor.state = "CURRENT";
      /* The frozen cursor population has no OFFER transition.  Its REPLAY
       * row is the sole offered-position transition and is intentionally
       * applicable to the first offer as a derived CURRENT head. */
      this._transition("offer-disposition-delivery", "e.delivery-cursor", "REPLAY", cursor, "CURRENT", cursorPriorState === "AT_START" ? "CURRENT" : cursorPriorState, "CURRENT"); this._remember("offer-disposition-delivery", key, offerRef, opInput); return result("OFFERED", { offer: clone(offer), cursor: clone(cursor) });
    });
  }
  offerDelivery(input = {}) { return this.offerDispositionDelivery(input); }
  expireDeliveryOffer(input = {}) { const offer = this.state.offers[alias(input, "offerRef", "offer_ref")]; if (!offer || offer.state !== "OFFERED") return result("REPLAYED", { offer: clone(offer) }); return this._commit(() => { offer.state = "EXPIRED_UNACKNOWLEDGED"; this._transition("offer-disposition-delivery", "e.delivery-offer", "EXPIRE", offer, "EXPIRED_UNACKNOWLEDGED", "OFFERED", "EXPIRED_UNACKNOWLEDGED"); return result("EXPIRED_UNACKNOWLEDGED", { offer: clone(offer) }); }); }

  acknowledgeDispositionDelivery(input = {}) {
    if (this._capInputRejected(input)) return result("REJECTED"); const offer = this.state.offers[alias(input, "offerRef", "offer_ref")]; if (!offer) return result("REJECTED"); const subscription = this.state.subscriptions[offer.subscriptionRef]; const cursor = subscription && this._subscriptionCursor(subscription); const job = subscription && this.state.jobs[subscription.jobRef]; if (!subscription || !cursor || !job) return result("REJECTED"); const ackRef = alias(input, "subscribeAckCapabilityRef", "subscribe_ack_capability_ref", "ackCapabilityRef", "ack_capability_ref"); const auth = this._authorizeCapability(ackRef, "subscribe-ack", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, subscriptionRef: subscription.subscriptionRef, projectionDigest: offer.projectionDigest, currentRevisionRef: subscription.subscribeAckCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch }); if (!auth.ok) return this._authorizationFailure("subscribe-ack", auth);
    const principalRef = input.subscriberPrincipalRef || input.principalRef || subscription.subscriberPrincipalRef; const projectionDigest = input.projectionDigest; const sequence = Number.isInteger(input.sequence) ? input.sequence : Number.isInteger(input.lastSequence) ? input.lastSequence : offer.lastSequence; const exact = principalRef === subscription.subscriberPrincipalRef && projectionDigest === offer.projectionDigest && sequence === offer.lastSequence && (input.deliveryAttemptRef === undefined || input.deliveryAttemptRef === offer.deliveryAttemptRef);
    const existingAck = Object.values(this.state.acknowledgments).find((ack) => ack.deliveryAttemptRef === offer.deliveryAttemptRef && ack.state === "ACKNOWLEDGED"); if (existingAck && exact) return this._commit(() => { this._authorizeCapability(ackRef, "subscribe-ack", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, subscriptionRef: subscription.subscriptionRef, projectionDigest: offer.projectionDigest, currentRevisionRef: subscription.subscribeAckCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch }, { consume: true }); return result("EXACT_REPLAY", { acknowledgment: clone(existingAck), cursor: clone(cursor), offer: clone(offer) }); });
    const reason = principalRef !== subscription.subscriberPrincipalRef ? "FOREIGN_PRINCIPAL" : projectionDigest !== offer.projectionDigest ? "DIGEST_MISMATCH" : sequence !== cursor.acknowledgedSequence + 1 ? "NONCONTIGUOUS" : offer.state !== "OFFERED" ? "EXPIRED_OFFER" : "ACKNOWLEDGMENT_REJECTED";
    if (reason !== "ACKNOWLEDGMENT_REJECTED" || !exact) return this._commit(() => { this._authorizeCapability(ackRef, "subscribe-ack", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, subscriptionRef: subscription.subscriptionRef, projectionDigest: offer.projectionDigest, currentRevisionRef: subscription.subscribeAckCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch }, { consume: true }); const rejectionRef = this._ref("DeliveryAcknowledgment", { offerRef: offer.offerRef, reason, projectionDigest: projectionDigest || null, sequence }); const acknowledgment = { acknowledgmentRef: rejectionRef, deliveryAttemptRef: offer.deliveryAttemptRef, subscriptionRef: subscription.subscriptionRef, subscriberPrincipalRef: principalRef, projectionDigest: projectionDigest || null, acknowledgedAt: this.clock(), priorAcknowledgedCursor: cursor.acknowledgedSequence, dss06_service_generation: this.serviceGeneration, state: "REJECTED", reason, authorityEffect: AUTH_NONE }; this._set("acknowledgments", rejectionRef, acknowledgment); this._transition("acknowledge-disposition-delivery", "e.delivery-acknowledgment", "REJECT", acknowledgment, "REJECTED", "ABSENT", "REJECTED"); return result(reason === "DIGEST_MISMATCH" ? "DIGEST_MISMATCH" : reason === "NONCONTIGUOUS" ? "NONCONTIGUOUS" : "REJECTED", { acknowledgment: clone(acknowledgment), cursor: clone(cursor) }); });
    return this._commit(() => {
      this._authorizeCapability(ackRef, "subscribe-ack", { principalRef: subscription.subscriberPrincipalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, subscriptionRef: subscription.subscriptionRef, projectionDigest: offer.projectionDigest, currentRevisionRef: subscription.subscribeAckCapabilityRevisionRef, revocationEpoch: subscription.revocationEpoch }, { consume: true }); const acknowledgmentRef = this._ref("DeliveryAcknowledgment", { offerRef: offer.offerRef, projectionDigest: offer.projectionDigest, sequence }); const acknowledgment = { acknowledgmentRef, deliveryAttemptRef: offer.deliveryAttemptRef, subscriptionRef: subscription.subscriptionRef, subscriberPrincipalRef: subscription.subscriberPrincipalRef, projectionDigest: offer.projectionDigest, acknowledgedSequence: sequence, acknowledgedAt: this.clock(), priorAcknowledgedCursor: cursor.acknowledgedSequence, dss06_service_generation: this.serviceGeneration, state: "ABSENT", authorityEffect: AUTH_NONE }; this._set("acknowledgments", acknowledgmentRef, acknowledgment); acknowledgment.state = "ACKNOWLEDGED"; this._transition("acknowledge-disposition-delivery", "e.delivery-acknowledgment", "ACKNOWLEDGE", acknowledgment, "ACKNOWLEDGED", "ABSENT", "ACKNOWLEDGED"); offer.state = "ACKNOWLEDGED"; this._transition("acknowledge-disposition-delivery", "e.delivery-offer", "ACKNOWLEDGE", offer, "ACKNOWLEDGED", "OFFERED", "ACKNOWLEDGED"); const cursorPriorState = cursor.state; cursor.acknowledgedSequence = offer.lastSequence; cursor.acknowledgmentDigest = offer.projectionDigest; cursor.state = "CURRENT"; this._transition("acknowledge-disposition-delivery", "e.delivery-cursor", "ADVANCE", cursor, "CURRENT", cursorPriorState, "CURRENT"); return result("ACKNOWLEDGED", { acknowledgment: clone(acknowledgment), offer: clone(offer), cursor: clone(cursor) });
    });
  }
  acknowledgeDelivery(input = {}) { return this.acknowledgeDispositionDelivery(input); }

  wakeAuditTask(input = {}) {
    if (this._capInputRejected(input) || input.acknowledge === true || input.advanceCursor === true || input.cursor !== undefined || input.rawPayload !== undefined || input.capabilityMaterial !== undefined) return result("WAKEUP_BOUNDARY_VIOLATION"); const offer = this.state.offers[alias(input, "offerRef", "offer_ref")]; const subscription = offer && this.state.subscriptions[offer.subscriptionRef]; const job = subscription && this.state.jobs[subscription.jobRef]; const disposition = job && Object.values(this.state.dispositions).find((item) => item.jobRef === job.jobRef); const wakeRef = this._capabilityInput(input, "wakeup"); if (!offer || !subscription || !job || !disposition) return result("DENIED"); const continuationRef = alias(input, "continuationRef", "continuation_ref"); const continuation = this.state.registries.continuations[continuationRef || ""]; if (!continuation || continuation.taskRef !== job.taskRef) return result("DENIED"); const auth = this._authorizeCapability(wakeRef, "wakeup", { principalRef: job.principalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, continuationRef, contractDigest: continuation.contractDigest }); if (!auth.ok) return this._authorizationFailure("wakeup", auth); if (offer.state !== "OFFERED" && offer.state !== "ACKNOWLEDGED") return result("EXPIRED");
    const wakeKey = this._ref("WakeupIdempotency", { taskRef: job.taskRef, jobRef: job.jobRef, deliveryAttemptRef: offer.deliveryAttemptRef, projectionDigest: offer.projectionDigest }); const prior = this.state.operationInputs[wakeKey]; if (prior) return result("REPLAYED", { wakeup: clone(this.state.wakeups[prior.ref]) });
    return this._commit(() => { this._authorizeCapability(wakeRef, "wakeup", { principalRef: job.principalRef, projectRef: job.projectRef, taskRef: job.taskRef, jobRef: job.jobRef, continuationRef, contractDigest: continuation.contractDigest }, { consume: true }); const wakeupRef = this._ref("TaskWakeup", { taskRef: job.taskRef, jobRef: job.jobRef, deliveryAttemptRef: offer.deliveryAttemptRef, projectionDigest: offer.projectionDigest }); const wakeup = { wakeupRef, taskRef: job.taskRef, jobRef: job.jobRef, packageRef: job.packageRef, dispositionRef: disposition.dispositionRef, deliveryAttemptRef: offer.deliveryAttemptRef, projectionDigest: offer.projectionDigest, artifactLineageDigest: disposition.artifactLineageDigest, continuationRef, contractDigest: continuation.contractDigest, dss06_service_generation: this.serviceGeneration, state: "UNPREPARED", authorityEffect: AUTH_NONE, offeredAt: this.clock() }; this._set("wakeups", wakeupRef, wakeup); wakeup.state = "OFFERED"; this._transition("wake-audit-task", "e.task-wakeup", "OFFER", wakeup, "OFFERED", "UNPREPARED", "OFFERED"); wakeup.state = "DELIVERED"; wakeup.deliveredAt = this.clock(); this._transition("wake-audit-task", "e.task-wakeup", "DELIVER", wakeup, "DELIVERED", "OFFERED", "DELIVERED"); this._remember("wake-audit-task", wakeKey, wakeupRef, { taskRef: job.taskRef, jobRef: job.jobRef, deliveryAttemptRef: offer.deliveryAttemptRef, projectionDigest: offer.projectionDigest }); return result("DELIVERED", { wakeup: clone(wakeup) }); });
  }
  wakeTask(input = {}) { return this.wakeAuditTask(input); }

  cancelAuditJob(input = {}) {
    const job = this.state.jobs[alias(input, "jobRef", "job_ref")]; if (!job) return result("CANCELLATION_LOST_RACE"); const attempt = Object.values(this.state.attempts).find((item) => item.jobRef === job.jobRef); if (job.state === "CANCELLED") return result("REPLAYED", { job: clone(job), attempt: clone(attempt) }); if (attempt?.state === "STARTED" || attempt?.state === "UNKNOWN") return result("CANCELLATION_LOST_RACE", { job: clone(job), attempt: clone(attempt) }); if (!["ADMITTED", "RUNNING"].includes(job.state)) return result("UNKNOWN", { job: clone(job), attempt: clone(attempt) });
    return this._commit(() => { if (attempt && attempt.state === "ALLOCATED") { attempt.state = "CANCELLED"; attempt.terminalAt = this.clock(); this._transition("cancel-audit-job", "d.audit-attempt", "CANCEL", attempt, "CANCELLED", "ALLOCATED", "CANCELLED"); } const from = job.state; job.state = "CANCELLED"; job.cancelledAt = this.clock(); this._transition("cancel-audit-job", "d.audit-job", "CANCEL", job, "CANCELLED", from, "CANCELLED"); return result("CANCELLED", { job: clone(job), attempt: clone(attempt) }); });
  }
  cancelJob(input = {}) { return this.cancelAuditJob(input); }

  expireRevokeAuthority(input = {}) {
    if (this._capInputRejected(input)) return result("UNAUTHORIZED");
    const ref = alias(input, "capabilityRef", "capability_ref", "targetRef", "target_ref", "subscriptionRef", "offerRef", "acknowledgmentRef", "lineageRef"); const action = String(input.action || input.transition || "REVOKE").toUpperCase();
    const commandDigest = digest("Dss06.AuthorityCommand", { action, targetRef: ref });
    const receipt = this._authorityReceipt(input.authorizationReceipt || input.authorityReceipt, "service-administration", commandDigest); if (!receipt) return result("UNAUTHORIZED");
    const capability = this.state.capabilities[ref]; if (capability) { if (capability.state !== "CURRENT") return result(capability.state === "EXPIRED" ? "EXACT_REPLAY" : "REVOKED"); const kind = Object.keys(CAPABILITY_FAMILIES).find((item) => CAPABILITY_FAMILIES[item] === capability.family); const event = action === "EXPIRE" ? "EXPIRE" : "REVOKE"; const next = event === "EXPIRE" ? "EXPIRED" : "REVOKED"; return this._commit(() => { capability.state = next; capability.changedAt = this.clock(); this._transition("expire-revoke-authority", CAPABILITY_CARRIERS[kind], event, capability, next, "CURRENT", next); for (const subscription of Object.values(this.state.subscriptions)) if ([subscription.readCapabilityRef, subscription.subscribeAckCapabilityRef, subscription.wakeupCapabilityRef].includes(capability.capabilityRef) || [subscription.readCapabilityRevisionRef, subscription.subscribeAckCapabilityRevisionRef].includes(capability.currentRevisionRef)) if (["ACTIVE", "PAUSED"].includes(subscription.state)) { const from = subscription.state; subscription.state = "SUPERSEDED"; this._transition("expire-revoke-authority", "e.delivery-subscription", "SUPERSEDE", subscription, "SUPERSEDED", from, "SUPERSEDED"); } return result(next, { capability: clone(capability) }); }); }
    const lineage = this.state.lineages[ref]; if (lineage && lineage.state === "BOUND") return this._commit(() => { lineage.state = action === "EXPIRE" ? "INVALID" : "REVOKED"; this._transition("expire-revoke-authority", "e.audit-lineage", action === "EXPIRE" ? "INVALIDATE" : "REVOKE", lineage, lineage.state, "BOUND", lineage.state); return result(lineage.state, { lineage: clone(lineage) }); });
    const subscription = this.state.subscriptions[ref]; if (subscription && ["ACTIVE", "PAUSED"].includes(subscription.state)) return this._commit(() => { const from = subscription.state; subscription.state = action === "EXPIRE" ? "EXPIRED" : "SUPERSEDED"; this._transition("expire-revoke-authority", "e.delivery-subscription", action === "EXPIRE" ? "EXPIRE" : "SUPERSEDE", subscription, subscription.state, from, subscription.state); return result(subscription.state, { subscription: clone(subscription) }); });
    const offer = this.state.offers[ref]; if (offer && offer.state === "OFFERED") return this._commit(() => { offer.state = "AUTHORITY_INVALIDATED"; this._transition("expire-revoke-authority", "e.delivery-offer", "INVALIDATE", offer, "AUTHORITY_INVALIDATED", "OFFERED", "AUTHORITY_INVALIDATED"); return result("AUTHORITY_INVALIDATED", { offer: clone(offer) }); });
    return result("STALE_CURRENTNESS");
  }
  expireAuthority(input = {}) { return this.expireRevokeAuthority(input); }
  revokeAuthority(input = {}) { return this.expireRevokeAuthority({ ...input, action: "REVOKE" }); }

  _recordRefForCarrier(carrierId, payload) {
    const fields = { "e.daemon-health-observation": "healthRef", "d.audit-package": "packageRef", "d.audit-job": "jobRef", "d.audit-attempt": "attemptRef", "d.audit-decision": "decisionRef", "d.audit-disposition": "dispositionRef", "e.audit-lineage": "lineageRef", "d.submit-capability": "capabilityRef", "d.read-capability": "capabilityRef", "d.subscribe-ack-capability": "capabilityRef", "d.wakeup-capability": "capabilityRef", "e.delivery-subscription": "subscriptionRef", "e.delivery-offer": "offerRef", "e.delivery-acknowledgment": "acknowledgmentRef", "e.delivery-cursor": "cursorRef", "e.task-wakeup": "wakeupRef", "e.recovery-disposition": "recoveryDispositionRef" }; const field = fields[carrierId]; return field && payload && payload[field];
  }
  _verifyStateEnvelope() {
    if (!this.state || this.state.schema !== "direct_semantic_service_dss06_state@1" || this.state.moduleId !== MODULE_ID || this.state.moduleDigest !== MODULE_DIGEST || this.state.serviceGeneration !== this.serviceGeneration) throw new Dss06Error("DSS06_STATE_ENVELOPE_INVALID");
    const bootstrapIntent = this._verifyBootstrapIntent();
    if (this._authorityStatus.status === "CURRENT" && this.state.bootstrap?.state !== "COMPLETE" && bootstrapIntent?.state !== "PREPARED") throw new Dss06Error("DSS06_BOOTSTRAP_AUTHORITY_ORPHAN");
    if (bootstrapIntent?.state === "PREPARED" && this._authorityStatus.status === "CURRENT" && !this._authorityMatchesBootstrapPlan(bootstrapIntent.plan)) throw new Dss06Error("DSS06_BOOTSTRAP_AUTHORITY_MISMATCH");
    if (Object.keys(this.state.registries?.principals || {}).length && (!this.state.authority || this._authorityStatus.status !== "CURRENT" || this.state.authority.sourceDigest !== this._authorityStatus.sourceDigest || this.state.authority.verifierRef !== this._authorityStatus.verifierRef || this.state.authority.verifierRevision !== this._authorityStatus.verifierRevision)) throw new Dss06Error("DSS06_AUTHORITY_LINEAGE_INVALID");
    let prior = null; for (const event of this.state.events || []) {
      if (event.priorDigest !== prior) throw new Dss06Error("DSS06_EVENT_CHAIN_INVALID"); const copy = clone(event); delete copy.eventDigest; if (event.eventDigest !== digest("Event", copy)) throw new Dss06Error("DSS06_EVENT_DIGEST_INVALID"); const row = TRANSITION_MAP.get(`${event.operationId}:${event.carrierId}:${event.event}`); if (!row) throw new Dss06Error("DSS06_EVENT_TRANSITION_INVALID");
      if (event.type !== row.operationId || event.operationId !== row.operationId || event.carrierId !== row.carrierId || event.outputCarrierId !== row.outputCarrierId || event.event !== row.event) throw new Dss06Error("DSS06_EVENT_LAW_IDENTITY_INVALID"); if (event.transitionId !== row.transitionId || event.owner !== row.owner || event.priorStateSource !== row.priorStateSource) throw new Dss06Error("DSS06_EVENT_ROW_METADATA_INVALID"); if (canonicalJson(event.sourceStates) !== canonicalJson(row.sourceStates) || canonicalJson(event.fromStates) !== canonicalJson(row.fromStates)) throw new Dss06Error("DSS06_EVENT_SOURCE_STATES_INVALID"); if (!row.fromStates.includes(event.fromState) || event.toState !== row.toState || event.destinationState !== row.destinationState) throw new Dss06Error("DSS06_EVENT_DESTINATION_INVALID"); if (!row.outcomeCases.includes(event.outcome) || canonicalJson(event.outcomeCases) !== canonicalJson(row.outcomeCases)) throw new Dss06Error("DSS06_EVENT_OUTCOME_INVALID"); if (event.authorityEffect !== AUTH_NONE) throw new Dss06Error("DSS06_EVENT_AUTHORITY_EFFECT_INVALID"); prior = event.eventDigest;
    }
    return true;
  }
  _sourceDigest() {
    const source = { registries: this.state.registries, health: this.state.health, packages: this.state.packages, jobs: this.state.jobs, attempts: this.state.attempts, decisions: this.state.decisions, dispositions: this.state.dispositions, lineages: this.state.lineages, capabilities: this.state.capabilities, subscriptions: this.state.subscriptions, offers: this.state.offers, acknowledgments: this.state.acknowledgments, cursors: this.state.cursors, wakeups: this.state.wakeups, operationInputs: this.state.operationInputs, generation: this.state.generation, bootstrapIntent: this.state.bootstrapIntent || null, serviceGeneration: this.serviceGeneration }; return this._ref("AuthoritativeSourcePopulation", source);
  }
  _recoveryChecks() {
    const problems = []; if (this.stateVerificationError) problems.push({ kind: "corrupt", reason: this.stateVerificationError.code || this.stateVerificationError.message });
    const bootstrapIntent = this.state.bootstrapIntent;
    if (bootstrapIntent?.state === "PREPARED") {
      if (this._authorityStatus.status === "CURRENT" && !this._authorityMatchesBootstrapPlan(bootstrapIntent.plan)) problems.push({ kind: "corrupt", reason: "bootstrap-intent-authority-mismatch" });
      else if (this._authorityStatus.status !== "CURRENT") problems.push({ kind: "gap", reason: "bootstrap-intent-authority-unprovisioned" });
    } else if (this._authorityStatus.status === "CURRENT" && this.state.bootstrap?.state !== "COMPLETE") problems.push({ kind: "corrupt", reason: "authority-without-complete-bootstrap" });
    const maps = ["packages", "jobs", "attempts", "decisions", "dispositions", "lineages", "subscriptions", "offers", "acknowledgments", "cursors", "wakeups"];
    for (const map of maps) for (const [ref, item] of Object.entries(this.state[map] || {})) { const expected = `${map === "packages" ? "package" : map === "jobs" ? "job" : map === "attempts" ? "attempt" : map === "decisions" ? "decision" : map === "dispositions" ? "disposition" : map === "lineages" ? "lineage" : map === "subscriptions" ? "subscription" : map === "offers" ? "offer" : map === "acknowledgments" ? "acknowledgment" : map === "cursors" ? "cursor" : "wakeup"}Ref`; if (item[expected] !== ref) problems.push({ kind: "corrupt", reason: `relabel.${map}.${ref}` }); }
    for (const job of Object.values(this.state.jobs)) if (!this.state.packages[job.packageRef] || !this.state.lineages[job.packageRef] && !Object.values(this.state.lineages).some((lineage) => lineage.jobRef === job.jobRef)) problems.push({ kind: "orphan", reason: `job-package-lineage.${job.jobRef}` });
    for (const attempt of Object.values(this.state.attempts)) if (!this.state.jobs[attempt.jobRef] || !this.state.packages[attempt.packageRef]) problems.push({ kind: "orphan", reason: `attempt-parent.${attempt.attemptRef}` });
    for (const decision of Object.values(this.state.decisions)) if (!this.state.attempts[decision.attemptRef]) problems.push({ kind: "orphan", reason: `decision-attempt.${decision.decisionRef}` });
    for (const disposition of Object.values(this.state.dispositions)) if (!this.state.jobs[disposition.jobRef] || !Object.values(this.state.decisions).some((decision) => decision.jobRef === disposition.jobRef)) problems.push({ kind: "orphan", reason: `disposition-population.${disposition.dispositionRef}` });
    for (const subscription of Object.values(this.state.subscriptions)) if (!this.state.jobs[subscription.jobRef] || !Object.values(this.state.cursors).some((cursor) => cursor.subscriptionRef === subscription.subscriptionRef)) problems.push({ kind: "orphan", reason: `subscription-cursor.${subscription.subscriptionRef}` });
    for (const offer of Object.values(this.state.offers)) if (!this.state.subscriptions[offer.subscriptionRef] || !Object.values(this.state.cursors).some((cursor) => cursor.subscriptionRef === offer.subscriptionRef)) problems.push({ kind: "orphan", reason: `offer-subscription.${offer.offerRef}` });
    for (const cursor of Object.values(this.state.cursors)) {
      if (cursor.acknowledgedSequence > cursor.offeredSequence || cursor.acknowledgedSequence < 0) problems.push({ kind: "gap", reason: `cursor-law.${cursor.cursorRef}` });
      if (cursor.acknowledgedSequence > 0 && !Object.values(this.state.acknowledgments).some((ack) => ack.subscriptionRef === cursor.subscriptionRef && ack.state === "ACKNOWLEDGED" && ack.acknowledgedSequence === cursor.acknowledgedSequence && ack.projectionDigest === cursor.acknowledgmentDigest)) problems.push({ kind: "gap", reason: `cursor-without-ack.${cursor.cursorRef}` });
      if (cursor.offeredSequence > 0 && !Object.values(this.state.offers).some((offer) => offer.subscriptionRef === cursor.subscriptionRef && offer.firstSequence <= cursor.offeredSequence && offer.lastSequence >= cursor.offeredSequence)) problems.push({ kind: "orphan", reason: `cursor-without-offer.${cursor.cursorRef}` });
    }
    for (const attempt of Object.values(this.state.attempts)) if (attempt.state === "STARTED") problems.push({ kind: "gap", reason: `attempt-open.${attempt.attemptRef}` });
    const eventStates = new Map(); for (const event of this.state.events || []) { const ref = this._recordRefForCarrier(event.carrierId, event.payload); if (!ref) continue; const key = `${event.carrierId}:${ref}`; const row = TRANSITION_MAP.get(`${event.operationId}:${event.carrierId}:${event.event}`); const priorState = eventStates.get(key); const derivedOfferCursorStart = event.carrierId === "e.delivery-cursor" && event.operationId === "offer-disposition-delivery" && event.event === "REPLAY" && priorState === "AT_START"; if (priorState && !row.fromStates.includes(priorState) && !derivedOfferCursorStart) problems.push({ kind: "fork", reason: `event-from-state.${key}` }); eventStates.set(key, row.toState); }
    const stateMaps = { "e.daemon-health-observation": "health", "d.audit-package": "packages", "d.audit-job": "jobs", "d.audit-attempt": "attempts", "d.audit-decision": "decisions", "d.audit-disposition": "dispositions", "e.audit-lineage": "lineages", "d.submit-capability": "capabilities", "d.read-capability": "capabilities", "d.subscribe-ack-capability": "capabilities", "d.wakeup-capability": "capabilities", "e.delivery-subscription": "subscriptions", "e.delivery-offer": "offers", "e.delivery-acknowledgment": "acknowledgments", "e.delivery-cursor": "cursors", "e.task-wakeup": "wakeups", "e.recovery-disposition": "recoveryDispositions" };
    const stateRefFields = { "e.daemon-health-observation": "healthRef", "d.audit-package": "packageRef", "d.audit-job": "jobRef", "d.audit-attempt": "attemptRef", "d.audit-decision": "decisionRef", "d.audit-disposition": "dispositionRef", "e.audit-lineage": "lineageRef", "d.submit-capability": "capabilityRef", "d.read-capability": "capabilityRef", "d.subscribe-ack-capability": "capabilityRef", "d.wakeup-capability": "capabilityRef", "e.delivery-subscription": "subscriptionRef", "e.delivery-offer": "offerRef", "e.delivery-acknowledgment": "acknowledgmentRef", "e.delivery-cursor": "cursorRef", "e.task-wakeup": "wakeupRef", "e.recovery-disposition": "recoveryDispositionRef" };
    const capabilityFamilyByCarrier = { "d.submit-capability": "submit_audit_package", "d.read-capability": "read_audit_disposition", "d.subscribe-ack-capability": "subscribe_disposition_ack", "d.wakeup-capability": "wake_task" };
    for (const [carrier, map] of Object.entries(stateMaps)) for (const item of Object.values(this.state[map] || {})) { if (map === "capabilities" && item.family !== capabilityFamilyByCarrier[carrier]) continue; const ref = item[stateRefFields[carrier]]; const derived = eventStates.get(`${carrier}:${ref}`); if (!derived && !(map === "capabilities" && item.state === "ABSENT")) problems.push({ kind: "orphan", reason: `missing-event.${carrier}.${ref}` }); else if (derived && item.state !== derived && !(carrier === "e.delivery-cursor" && item.state === "CURRENT" && derived === "AT_START")) problems.push({ kind: "corrupt", reason: `state-relabel.${carrier}.${ref}` }); }
    return problems;
  }
  recoverDss06Lineage(input = {}) {
    if (input.serviceGeneration && input.serviceGeneration !== this.serviceGeneration) return result("STALE_CURRENTNESS"); try { this._verifyStateEnvelope(); this.stateVerificationError = null; } catch (error) { this.stateVerificationError = error; }
    if (this.state.bootstrapIntent?.state === "PREPARED" && this._authorityStatus.status === "CURRENT") {
      const reconciled = this._completePreparedBootstrap();
      if (reconciled.status === "BOOTSTRAPPED") return reconciled;
      if (reconciled.status === "BROKEN") return reconciled;
    }
    if (this.stateVerificationError) return result("BROKEN", { reason: this.stateVerificationError.code || this.stateVerificationError.message });
    const sourceDigest = this._sourceDigest(); const eventHeadBefore = this.state.events.at(-1)?.eventDigest || null; const prior = Object.values(this.state.recoveryDispositions).at(-1); if (prior && prior.sourceReceiptDigest === sourceDigest && (prior.recoveryInputEventLedgerHeadDigest === eventHeadBefore || prior.eventLedgerHeadDigest === eventHeadBefore)) return result("REPLAYED", { disposition: clone(prior) });
    const problems = this._recoveryChecks(); const broken = problems.some((problem) => ["corrupt", "fork"].includes(problem.kind)); const standing = broken ? "BROKEN" : problems.length ? "BLOCKED" : "READY"; const reason = problems[0]?.reason || "EXACT_POPULATION_EQUALITY";
    if (this.stateVerificationError) return result("BROKEN", { reason: this.stateVerificationError.code || this.stateVerificationError.message });
    return this._commit(() => {
      const recoveryRef = this._ref("RecoveryDisposition", { sourceDigest, eventHeadBefore, status: standing, reason, serviceGeneration: this.serviceGeneration }); const record = { recoveryDispositionRef: recoveryRef, status: standing, state: "ABSENT", reason, sourceReceiptDigest: sourceDigest, recoveryInputEventLedgerHeadDigest: eventHeadBefore, eventLedgerHeadDigest: eventHeadBefore, reconstructedPopulationDigest: this._sourceDigest(), recovery_revision: "dss06-recovery-generation-1", dss06_service_generation: this.serviceGeneration, authorityEffect: AUTH_NONE, classification: clone(problems), recordedAt: this.clock() }; this._set("recoveryDispositions", recoveryRef, record); this._transition("recover-dss06-lineage", "e.recovery-disposition", "START", record, "ENUMERATING", "ABSENT", "ENUMERATING"); record.state = "ENUMERATING"; this._transition("recover-dss06-lineage", "e.recovery-disposition", "ENUMERATE", record, "VERIFYING", "ENUMERATING", "VERIFYING"); record.state = "VERIFYING"; if (standing === "READY") { this._transition("recover-dss06-lineage", "e.recovery-disposition", "VERIFY", record, "VERIFYING", "VERIFYING", "VERIFYING"); record.state = "READY"; this._transition("recover-dss06-lineage", "e.recovery-disposition", "READY", record, "READY", "VERIFYING", "READY"); } else { record.state = standing; this._transition("recover-dss06-lineage", "e.recovery-disposition", broken ? "BROKEN" : "BLOCK", record, standing, "VERIFYING", standing); for (const attempt of Object.values(this.state.attempts)) if (attempt.state === "STARTED") { const job = this.state.jobs[attempt.jobRef]; if (job && ["UNSEEN", "ADMITTED", "RUNNING"].includes(job.state)) { job.state = "RECOVERY_BLOCKED"; this._transition("recover-dss06-lineage", "d.audit-job", "BLOCK", job, "RECOVERY_BLOCKED", "RUNNING", "RECOVERY_BLOCKED"); } } }
      this.state.generation.state = standing; record.eventLedgerHeadDigest = this.state.events.at(-1)?.eventDigest || null; return result(standing, { disposition: clone(record), classifications: clone(problems) });
    });
  }
  recoverLineage(input = {}) { return this.recoverDss06Lineage(input); }

  status() { const names = ["registries", "health", "packages", "jobs", "attempts", "decisions", "dispositions", "lineages", "capabilities", "subscriptions", "offers", "acknowledgments", "cursors", "wakeups", "recoveryDispositions"]; return deepFreeze({ schema: "direct_semantic_service_dss06_status@1", moduleId: MODULE_ID, moduleDigest: MODULE_DIGEST, serviceGeneration: this.serviceGeneration, generation: clone(this.state.generation), counts: Object.fromEntries(names.map((name) => [name, Object.keys(this.state[name] || {}).length]).concat([["events", this.state.events.length]])), authorityEffect: AUTH_NONE }); }
  close() { this._persist(); this.store.close(); try { this.#authorityStore?.close(); } catch (_) {} }
}

function createDss06Service(options) { return new Dss06Service(options); }

module.exports = {
  DSS06_SERVICE_GENERATION, DSS06_MODULE_ID: MODULE_ID, DSS06_MODULE_DIGEST: MODULE_DIGEST, DSS06_COMBINED_FREEZE_DIGEST: COMBINED_FREEZE_DIGEST,
  DSS06_PREDECESSOR: PREDECESSOR, DSS06_CARRIERS: CARRIER_IDS, DSS06_OPERATIONS: OPERATION_IDS, DSS06_QUALIFIED_TRANSITIONS: QUALIFIED_TRANSITION_IDS,
  DSS06_MODULE: MODULE, DSS06_CARRIER_MAP: CARRIER_MAP, DSS06_CARRIER_FIELD_MAP: CARRIER_FIELD_MAP, DSS06_OPERATION_MAP: OPERATION_MAP, DSS06_TRANSITION_MAP: TRANSITION_MAP,
  Dss06Error, Dss06Service, DirectSemanticServiceDss06: Dss06Service, createDss06Service, Dss06SqliteStore,
};
