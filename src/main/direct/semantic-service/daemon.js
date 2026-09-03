"use strict";

const {
  DSS02_SCHEMA,
  DSS02_PROTOCOL,
  dss02Fail,
  ensureObject,
  immutableId,
  digestObject,
  isoNow,
  randomRef,
  safeJson,
  assertNoExecutionClaim,
} = require("./dss02-common");
const { Dss02Store } = require("./store");
const bootstrap = require("./bootstrap-provisioning");
const { Dss02Authority } = require("./authority-store");
const { Dss02CustodyKeyring } = require("./custody-keyring");
const { Dss02EventLedger } = require("./event-ledger");
const { Dss02Capacity } = require("./capacity");
const { Dss02WaiterGate } = require("./waiter-gate");
const { Dss02Leases } = require("./leases");
const { Dss02Cas } = require("./cas");
const { Dss02Quarantine } = require("./quarantine");
const { Dss02Idempotency, Dss02JobAdmission } = require("./idempotency");
const { Dss02Cancellation } = require("./cancellation");
const { Dss02Dispatch } = require("./dispatch");
const { Dss02Projection } = require("./projection");
const { Dss02Delivery } = require("./delivery");
const { Dss02Recovery } = require("./recovery");
const { Dss02ProtocolServer } = require("./protocol");

const DAEMON_REVISION = "direct-semanticd@0.2";

class DirectSemanticDaemon {
  constructor(options = {}) {
    if (!options || typeof options !== "object") dss02Fail("DSS02_DAEMON_OPTIONS_INVALID");
    const allowed = new Set(["profileRoot", "installationRoot", "profileRef", "now", "limits", "protocolRevision", "listen", "bootstrap"]);
    for (const key of Object.keys(options)) if (!allowed.has(key)) dss02Fail("DSS02_DAEMON_OPTIONS_INVALID", key);
    if (!options.profileRoot || !options.installationRoot) dss02Fail("DSS02_DAEMON_ROOTS_REQUIRED");
    this.profileRef = options.profileRef || "direct-profile";
    this.profileRoot = options.profileRoot;
    this.installationRoot = options.installationRoot;
    this.now = options.now;
    this.protocolRevision = options.protocolRevision || DSS02_PROTOCOL;
    this.limitOptions = options.limits;
    this.listenByDefault = options.listen === true;
    this.bootstrapOptions = options.bootstrap;
    this.store = new Dss02Store({ profileRoot: this.profileRoot, profileRef: this.profileRef, now: this.now });
    this.authority = null;
    this.keyring = null;
    this.ledger = null;
    this.capacity = null;
    this.waiterGate = null;
    this.leases = null;
    this.cas = null;
    this.quarantine = null;
    this.idempotency = null;
    this.admission = null;
    this.cancellation = null;
    this.dispatch = null;
    this.projection = null;
    this.delivery = null;
    this.recovery = null;
    this.protocol = null;
    this.generation = null;
    this.ready = false;
    this.started = false;
    this.blockedReason = null;
    this.connections = new Map();
    this.waiters = new Map();
    this.unsubscribeLedgerEvents = null;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  installRootRecord(pinStatus) {
    if (pinStatus.status !== "PINNED") { this.blockedReason = "DSS02_OWNER_ROOT_BROKEN"; return false; }
    const existing = this.store.get("SELECT * FROM owner_roots WHERE profile_ref=?", this.profileRef);
    if (existing && (existing.owner_root_fingerprint !== pinStatus.pin.ownerRootFingerprint || existing.root_pin_digest !== pinStatus.pin.pinDigest || existing.installation_configuration_revision !== pinStatus.pin.configurationRevision)) {
      this.store.run("UPDATE owner_roots SET status='BROKEN',observed_at=? WHERE profile_ref=?", this.clock(), this.profileRef);
      this.blockedReason = "DSS02_OWNER_ROOT_MISMATCH";
      return false;
    }
    if (!existing) this.store.run("INSERT INTO owner_roots(root_ref,profile_ref,owner_root_fingerprint,owner_root_algorithm,installation_configuration_revision,root_pin_digest,installation_event_digest,status,observed_at) VALUES(?,?,?,?,?,?,?,?,?)", randomRef("owner-root"), this.profileRef, pinStatus.pin.ownerRootFingerprint, pinStatus.pin.ownerRootAlgorithm, pinStatus.pin.configurationRevision, pinStatus.pin.pinDigest, pinStatus.pin.installationEventDigest, "PINNED", this.clock());
    return true;
  }

  wire() {
    this.authority = new Dss02Authority({ store: this.store, profileRef: this.profileRef, protocolRevision: this.protocolRevision, now: this.now });
    this.keyring = new Dss02CustodyKeyring({ store: this.store, now: this.now });
    this.ledger = new Dss02EventLedger({ store: this.store, keyring: this.keyring, now: this.now });
    this.keyring.ledger = this.ledger;
    this.authority.ledger = this.ledger;
    this.capacity = new Dss02Capacity({ store: this.store, limits: this.limitOptions, now: this.now });
    this.waiterGate = new Dss02WaiterGate({ profileRef: this.profileRef, generationRef: this.generation.generationRef, limit: this.capacity.limits.waiters, now: this.now });
    this.leases = new Dss02Leases({ store: this.store, ledger: this.ledger, authority: this.authority, now: this.now, currentGeneration: () => this.generation?.generationRef });
    this.cas = new Dss02Cas({ store: this.store, now: this.now });
    this.quarantine = new Dss02Quarantine({ store: this.store, now: this.now });
    this.idempotency = new Dss02Idempotency({ store: this.store, now: this.now });
    this.dispatch = new Dss02Dispatch({ store: this.store, ledger: this.ledger, leases: this.leases, authority: this.authority, now: this.now, currentGeneration: () => this.generation?.generationRef });
    this.admission = new Dss02JobAdmission({ store: this.store, ledger: this.ledger, capacity: this.capacity, dispatch: this.dispatch, authority: this.authority, idempotency: this.idempotency, now: this.now });
    this.cancellation = new Dss02Cancellation({ store: this.store, ledger: this.ledger, capacity: this.capacity, authority: this.authority, now: this.now });
    this.projection = new Dss02Projection({ store: this.store, ledger: this.ledger, authority: this.authority, now: this.now });
    this.delivery = new Dss02Delivery({ store: this.store, ledger: this.ledger, authority: this.authority, projection: this.projection, cas: this.cas, capacity: this.capacity, now: this.now });
    this.unsubscribeLedgerEvents?.();
    this.unsubscribeLedgerEvents = this.ledger.subscribe((event) => this.notifyWaiters(event));
    this.recovery = new Dss02Recovery({ store: this.store, ledger: this.ledger, cas: this.cas, quarantine: this.quarantine, authority: this.authority, capacity: this.capacity, waiterGate: this.waiterGate, installationRoot: this.installationRoot, profileRoot: this.profileRoot, now: this.now });
  }

  start({ listen = this.listenByDefault, bootstrap: bootstrapOptions = this.bootstrapOptions } = {}) {
    if (this.started) return this.status();
    this.store.open();
    try {
      const pinStatus = bootstrap.verifyOwnerBootstrapRootPin({ installationRoot: this.installationRoot });
      if (!this.installRootRecord(pinStatus)) { this.store.ready = false; this.started = true; return this.status(); }
      this.generation = this.store.createGeneration(DSS02_SCHEMA);
      this.wire();
      const principals = this.store.get("SELECT principal_ref FROM principals LIMIT 1");
      if (!principals && bootstrapOptions) this.bootstrap(bootstrapOptions);
      const principalAfterBootstrap = this.store.get("SELECT principal_ref FROM principals LIMIT 1");
      const custodyCount = Number(this.store.get("SELECT COUNT(*) AS count FROM custody_keys").count);
      if (principalAfterBootstrap && custodyCount === 0) dss02Fail("DSS02_CUSTODY_UNINITIALIZED");
      if (!principalAfterBootstrap) {
        this.ready = false;
        const blockedAttempt = this.store.get("SELECT authorization_ref FROM bootstrap_authorizations WHERE state<>'AUTHORIZED_ONCE' LIMIT 1") || this.store.get("SELECT attempt_ref FROM bootstrap_attempts LIMIT 1");
        this.blockedReason = this.blockedReason || (blockedAttempt ? "DSS02_BOOTSTRAP_ATTEMPT_BLOCKED" : "DSS02_BOOTSTRAP_REQUIRED");
      } else if (custodyCount > 0) {
        const disposition = this.recovery.recover({ generationRef: this.generation.generationRef, ownerRootStatus: pinStatus.status, ownerRootFingerprint: pinStatus.pin.ownerRootFingerprint, waiterGate: this.waiterGate });
        this.ready = disposition.state !== "BLOCKED";
        this.blockedReason = disposition.state === "BLOCKED" ? disposition.classifications[0]?.reasonCode : null;
      }
      this.started = true;
      if (listen && this.ready) { this.protocol = new Dss02ProtocolServer({ daemon: this }); return this.protocol.start().then(() => this.status()); }
      return this.status();
    } catch (error) {
      this.ready = false; this.blockedReason = error.code || "DSS02_DAEMON_START_FAILED"; this.started = true;
      return this.status();
    }
  }

  bootstrap({ secret, descriptorProvenance, administratorPublicKey, expectedDaemonRevision = DAEMON_REVISION, protocolRevision = this.protocolRevision } = {}) {
    if (!this.store.db || !this.generation) dss02Fail("DSS02_DAEMON_NOT_STARTED");
    const result = bootstrap.authorizeBootstrap({ profileRoot: this.profileRoot, installationRoot: this.installationRoot, profileRef: this.profileRef, secret, descriptorProvenance, daemonRevision: expectedDaemonRevision, protocolRevision, now: this.clock() });
    // A denied attempt is terminal, but its ceremony remains durable so a
    // restart reports the exact blocked reason.
    if (!result.authorized) this.store.transaction((tx) => {
      tx.run("INSERT INTO bootstrap_commitments(commitment_ref,profile_ref,payload_json,commitment_digest,state,created_at,expires_at,maximum_attempts,attempt_count) VALUES(?,?,?,?,?,?,?,?,?)", result.commitment.commitmentRef, result.commitment.profileRef, JSON.stringify(result.commitment), result.commitment.commitmentDigest, "BLOCKED", result.commitment.createdAt, result.commitment.expiresAt, result.commitment.maximumAttempts, 1);
      tx.run("INSERT INTO bootstrap_attempts(attempt_ref,commitment_ref,payload_json,attempt_digest,state,claimed_at,outcome_code) VALUES(?,?,?,?,?,?,?)", result.attempt.attemptRef, result.attempt.commitmentRef, JSON.stringify(result.attempt), result.attempt.attemptDigest, result.attempt.state, result.attempt.claimedAt, result.attempt.outcomeCode || null);
      tx.run("INSERT INTO bootstrap_authorizations(authorization_ref,commitment_ref,attempt_ref,payload_json,authorization_digest,state,authorized_at) VALUES(?,?,?,?,?,?,?)", result.authorization.authorizationRef, result.authorization.commitmentRef, result.authorization.attemptRef, JSON.stringify(result.authorization), result.authorization.authorizationDigest, result.authorization.decision, result.authorization.authorizedAt);
    });
    if (!result.authorized) { this.blockedReason = result.reason; return result; }
    const authority = this.authority.bootstrapDaemonAuthority({ bootstrapAuthorization: result.authorization, bootstrapCommitment: result.commitment, bootstrapAttempt: result.attempt, administratorPublicKey, attemptReceiptDigest: result.attempt.attemptDigest, keyring: this.keyring });
    this.ready = false;
    return { ...result, authority };
  }

  observeTransportPeer({ connectionRef = randomRef("connection"), socket = undefined } = {}) {
    const hostUserId = typeof process.getuid === "function" ? `uid-${process.getuid()}` : "local-user";
    const hostGroupId = typeof process.getgid === "function" ? `gid-${process.getgid()}` : "local-group";
    const observation = { schema: "direct_semantic_transport_peer_observation@1", status: "OBSERVED", connectionRef, transport: "unix_socket", hostUserId, hostGroupId, processId: process.pid, socketInode: socket?._handle?.fd ?? null, observationNonce: randomRef("peer"), observedAt: this.clock() };
    this.connections.set(connectionRef, observation);
    return Object.freeze(observation);
  }

  disconnectTransport(connectionRef) {
    this.connections.delete(connectionRef);
    const error = new Error("DSS02 semantic transport connection closed before wait completed");
    error.code = "DSS02_CONNECTION_CLOSED";
    for (const waiter of [...this.waiters.values()]) if (waiter.connectionRef === connectionRef) this.settleWaiter(waiter, { error, reason: "CONNECTION_CLOSED" });
  }

  validateAuthorizationReceipt(receipt, { operation, requestDigest = undefined } = {}) {
    if (!receipt || receipt.decision !== "AUTHORIZED") dss02Fail("DSS02_AUTHORIZATION_DENIED");
    const row = receipt.receiptRef ? this.store.get("SELECT r.*, c.daemon_generation AS challenge_generation FROM authorization_receipts r JOIN authorization_challenges c ON c.challenge_ref=r.challenge_ref WHERE r.receipt_ref=?", receipt.receiptRef) : null;
    const generation = this.store.currentGeneration();
    if (!row || !generation || row.challenge_generation !== generation.generation_ref || row.decision !== "AUTHORIZED" || row.operation !== operation || row.principal_ref !== receipt.principalRef || row.verifier_ref !== receipt.verifierRef || (requestDigest && row.request_digest !== requestDigest)) dss02Fail("DSS02_AUTHORIZATION_RECEIPT_INVALID");
    this.authority.assertCurrentVerifier(receipt.verifierRef, { operation });
    return receipt;
  }

  resolveProtocolAuthorization({ connectionRef, transport, params, operation, request, requestDigestOverride = undefined, objectScopeDigest = "sha256:" + "0".repeat(64) }) {
    if (!params.challengeRef || !params.proof) dss02Fail("DSS02_AUTHORIZATION_PROOF_REQUIRED");
    const requestDigest = requestDigestOverride || digestObject("DirectSemanticService.SemanticRequestBoundary.v1", request || params);
    return this.authority.resolveDaemonCredential({ connectionRef, transportObservation: transport, challengeRef: params.challengeRef, proof: params.proof, requestDigest, operation, purposeScopes: params.purposeScopes || [], objectScopeDigest, registryRevisionSet: params.registryRevisionSet || [], now: this.clock() });
  }

  issueChallenge(connectionRef) {
    const transport = this.connections.get(connectionRef); if (!transport) dss02Fail("DSS02_TRANSPORT_UNKNOWN");
    return this.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport });
  }

  submit({ request, authorizationReceipt, transportObservation = undefined } = {}) {
    const requestDigest = digestObject("DirectSemanticService.SemanticJobRequest.v1", request);
    this.validateAuthorizationReceipt(authorizationReceipt, { operation: "submit", requestDigest });
    if (!this.ready) dss02Fail("DSS02_SERVICE_NOT_READY");
    return this.admission.admit({ request, authorizationReceipt, transportObservation });
  }

  inspect({ jobRef, authorizationReceipt, projectionRef = "projection-safe@1", afterSequence = 0 } = {}) { this.validateAuthorizationReceipt(authorizationReceipt, { operation: "inspect" }); return this.delivery.projectAuthorizedJobView({ jobRef, authorizationReceipt, operation: "inspect", projectionRef, afterSequence }); }
  results({ jobRef, authorizationReceipt, projectionRef = "projection-safe@1", afterSequence = 0 } = {}) { this.validateAuthorizationReceipt(authorizationReceipt, { operation: "results" }); return this.delivery.projectAuthorizedJobView({ jobRef, authorizationReceipt, operation: "results", projectionRef, afterSequence }); }
  subscribe({ jobRef, authorizationReceipt, returnProjectionRef = "projection-safe@1", eventTypeFilter = [], startingCursor = 0, deliveryAdapterRef = "cli_poll" } = {}) { this.validateAuthorizationReceipt(authorizationReceipt, { operation: "subscribe" }); return this.delivery.createSubscription({ jobRef, authorizationReceipt, returnProjectionRef, eventTypeFilter, startingCursor, deliveryAdapterRef }); }
  offer({ subscriptionRef, authorizationReceipt, deadlineMs = 30_000 } = {}) { this.validateAuthorizationReceipt(authorizationReceipt, { operation: "subscribe" }); return this.delivery.offer({ subscriptionRef, authorizationReceipt, deadlineMs }); }
  ack({ deliveryAttemptRef, authorizationReceipt, projectionDigest, subscriberPrincipalRef, jobRef = undefined } = {}) { this.validateAuthorizationReceipt(authorizationReceipt, { operation: "acknowledge" }); return this.delivery.acknowledge({ deliveryAttemptRef, authorizationReceipt, projectionDigest, subscriberPrincipalRef, jobRef }); }
  cancel({ jobRef, request, authorizationReceipt, signalRequestedRunningAttemptRefs = [], projectRef = undefined } = {}) { this.validateAuthorizationReceipt(authorizationReceipt, { operation: "cancel" }); return this.cancellation.decide({ jobRef, request, authorizationReceipt, signalRequestedRunningAttemptRefs, projectRef }); }
  handoff(options) { this.validateAuthorizationReceipt(options.authorizationReceipt, { operation: "handoff" }); return this.dispatch.handoff(options); }

  settleWaiter(waiter, { result = undefined, error = undefined, reason = "RESPONSE" } = {}) {
    if (!waiter || waiter.settled || !this.waiters.has(waiter.reservationToken)) return false;
    waiter.settled = true;
    this.waiters.delete(waiter.reservationToken);
    clearTimeout(waiter.timer);
    this.waiterGate.release({ reservationToken: waiter.reservationToken, reason });
    if (error) waiter.reject(error);
    else waiter.resolve(result);
    return true;
  }

  tryDeliverWaiter(waiter) {
    if (!waiter || waiter.settled) return false;
    const candidate = this.delivery.hasEventsAfter({
      jobRef: waiter.jobRef,
      subscriptionRef: waiter.subscriptionRef,
      authorizationReceipt: waiter.authorizationReceipt,
      afterSequence: waiter.afterSequence,
    });
    if (!candidate.qualifies) return false;
    const result = this.delivery.offer({
      subscriptionRef: candidate.row.subscription_ref,
      authorizationReceipt: waiter.authorizationReceipt,
    });
    if (!result || result.status === "NO_NEW_EVENTS") return false;
    return this.settleWaiter(waiter, { result, reason: "RESPONSE" });
  }

  notifyWaiters(event = {}) {
    const jobRef = event.jobRef;
    const sequence = Number(event.jobSequence);
    if (!jobRef || !Number.isSafeInteger(sequence)) return;
    for (const waiter of [...this.waiters.values()]) {
      if (waiter.jobRef !== jobRef || sequence <= waiter.afterSequence) continue;
      try {
        this.tryDeliverWaiter(waiter);
      } catch (error) {
        this.settleWaiter(waiter, { error, reason: "RESPONSE" });
      }
    }
  }

  wait({ jobRef, subscriptionRef = undefined, authorizationReceipt, afterSequence = 0, timeoutMs = 0, connectionRef = randomRef("connection"), waitRequestRef = randomRef("wait") } = {}) {
    this.validateAuthorizationReceipt(authorizationReceipt, { operation: "subscribe" });
    const activeSubscription = this.delivery.activeSubscription({ jobRef, subscriptionRef, authorizationReceipt });
    const boundedTimeoutMs = Math.max(0, Math.min(Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 0, 30_000));
    const deadline = new Date(Date.now() + boundedTimeoutMs).toISOString();
    const reservation = this.waiterGate.reserve({ connectionRef, waitRequestRef, deadline });
    if (reservation.status !== "RESERVED") dss02Fail(`DSS02_WAITER_${reservation.status}`);
    const reservationToken = reservation.token.reservationToken;
    if (boundedTimeoutMs <= 0) {
      let immediate;
      try {
        const candidate = this.delivery.hasEventsAfter({ jobRef, subscriptionRef: activeSubscription.subscription_ref, authorizationReceipt, afterSequence });
        immediate = candidate.qualifies
          ? this.delivery.offer({ subscriptionRef: activeSubscription.subscription_ref, authorizationReceipt })
          : this.delivery.noNewEvents({ jobRef, subscriptionRef: activeSubscription.subscription_ref, authorizationReceipt, afterSequence });
      } catch (error) {
        this.waiterGate.release({ reservationToken, reason: "RESPONSE" });
        throw error;
      }
      this.waiterGate.release({ reservationToken, reason: "RESPONSE" });
      return immediate;
    }

    let resolveWait;
    let rejectWait;
    const waiter = {
      reservationToken,
      connectionRef,
      jobRef,
      subscriptionRef: activeSubscription.subscription_ref,
      afterSequence: Number(afterSequence) || 0,
      authorizationReceipt,
      resolve: (result) => resolveWait(result),
      reject: (error) => rejectWait(error),
      settled: false,
      timer: null,
    };
    const waitPromise = new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    // Keep synchronous delivery-qualification failures from creating an
    // unhandled rejection when this method throws before returning its promise.
    waitPromise.catch(() => {});
    // Register the waiter and its deadline before the first qualification
    // read.  This makes an event appended during that read observable to the
    // ledger notification microtask and closes the registration race.
    this.waiters.set(reservationToken, waiter);
    waiter.timer = setTimeout(() => {
      try {
        if (this.tryDeliverWaiter(waiter)) return;
        const result = this.delivery.noNewEvents({
          jobRef: waiter.jobRef,
          subscriptionRef: waiter.subscriptionRef,
          authorizationReceipt: waiter.authorizationReceipt,
          afterSequence: waiter.afterSequence,
        });
        this.settleWaiter(waiter, { result, reason: "TIMEOUT" });
      } catch (error) {
        this.settleWaiter(waiter, { error, reason: "TIMEOUT" });
      }
    }, boundedTimeoutMs);

    try {
      if (this.tryDeliverWaiter(waiter)) return waitPromise;
    } catch (error) {
      this.settleWaiter(waiter, { error, reason: "RESPONSE" });
      throw error;
    }
    return waitPromise;
  }

  handleProtocolRequest({ connectionRef, transport, request: envelope }) {
    const params = envelope.params;
    switch (envelope.method) {
      case "challenge": return this.issueChallenge(connectionRef);
      case "service status": return this.status();
      case "submit": {
        const request = params.request || params;
        const auth = this.resolveProtocolAuthorization({ connectionRef, transport, params, operation: "submit", request, requestDigestOverride: digestObject("DirectSemanticService.SemanticJobRequest.v1", request), objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: request.projectRef }) });
        return this.submit({ request, authorizationReceipt: { ...auth.receipt, principalRef: auth.principal?.principalRef, verifierRef: auth.verifier?.verifierRef, operation: "submit", decision: auth.receipt.decision }, transportObservation: transport });
      }
      case "inspect": case "results": {
        const request = params.request || params;
        const operation = envelope.method;
        const auth = this.resolveProtocolAuthorization({ connectionRef, transport, params, operation, request, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: params.jobRef }) });
        const receipt = { ...auth.receipt, principalRef: auth.principal?.principalRef, verifierRef: auth.verifier?.verifierRef, operation, decision: auth.receipt.decision };
        return operation === "inspect" ? this.inspect({ jobRef: params.jobRef, authorizationReceipt: receipt, projectionRef: params.projectionRef, afterSequence: params.afterSequence || 0 }) : this.results({ jobRef: params.jobRef, authorizationReceipt: receipt, projectionRef: params.projectionRef, afterSequence: params.afterSequence || 0 });
      }
      case "subscribe": {
        const auth = this.resolveProtocolAuthorization({ connectionRef, transport, params, operation: "subscribe", request: params.request || params, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: params.jobRef }) });
        return this.subscribe({ jobRef: params.jobRef, authorizationReceipt: { ...auth.receipt, principalRef: auth.principal?.principalRef, verifierRef: auth.verifier?.verifierRef, operation: "subscribe", decision: auth.receipt.decision }, returnProjectionRef: params.projectionRef || "projection-safe@1", eventTypeFilter: params.eventTypeFilter, startingCursor: params.startingCursor });
      }
      case "ack": {
        const auth = this.resolveProtocolAuthorization({ connectionRef, transport, params, operation: "acknowledge", request: params.request || params, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { deliveryAttemptRef: params.deliveryAttemptRef }) });
        return this.ack({ deliveryAttemptRef: params.deliveryAttemptRef, jobRef: params.jobRef, projectionDigest: params.digest, authorizationReceipt: { ...auth.receipt, principalRef: auth.principal?.principalRef, verifierRef: auth.verifier?.verifierRef, operation: "acknowledge", decision: auth.receipt.decision } });
      }
      case "cancel": {
        const request = params.request || params;
        const auth = this.resolveProtocolAuthorization({ connectionRef, transport, params, operation: "cancel", request, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: request.jobRef }) });
        return this.cancel({ jobRef: request.jobRef, request, authorizationReceipt: { ...auth.receipt, principalRef: auth.principal?.principalRef, verifierRef: auth.verifier?.verifierRef, operation: "cancel", decision: auth.receipt.decision } });
      }
      case "wait": {
        const auth = this.resolveProtocolAuthorization({ connectionRef, transport, params, operation: "subscribe", request: params.request || params, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: params.jobRef }) });
        return this.wait({ jobRef: params.jobRef, subscriptionRef: params.subscriptionRef, afterSequence: params.afterSequence ?? 0, timeoutMs: params.timeoutMs ?? 0, connectionRef, authorizationReceipt: { ...auth.receipt, principalRef: auth.principal?.principalRef, verifierRef: auth.verifier?.verifierRef, operation: "subscribe", decision: auth.receipt.decision } });
      }
      default: dss02Fail("DSS02_PROTOCOL_UNKNOWN_METHOD");
    }
  }

  status() {
    const recovery = this.recovery?.latest();
    const status = { schema: "direct_semantic_service_status@1", profileRef: this.profileRef, daemonGeneration: this.generation?.generationRef || null, protocolRevision: this.protocolRevision, ready: Boolean(this.ready && this.store.ready), blockedReason: this.blockedReason, recoveryState: recovery?.state || (this.ready ? "READY" : "BLOCKED"), capacity: this.capacity ? this.capacity.current({ waiterCount: this.waiterGate?.active?.size || 0 }) : null };
    assertNoExecutionClaim(status, "status");
    return safeJson(status);
  }

  async close() {
    const error = new Error("DSS02 semantic daemon closed before wait completed");
    error.code = "DSS02_CONNECTION_CLOSED";
    for (const waiter of [...this.waiters.values()]) this.settleWaiter(waiter, { error, reason: "CONNECTION_CLOSED" });
    this.unsubscribeLedgerEvents?.();
    this.unsubscribeLedgerEvents = null;
    if (this.protocol) { await this.protocol.stop(); this.protocol = null; }
    this.store.close(); this.started = false; this.ready = false;
  }
}

function createDss02Daemon(options) { return new DirectSemanticDaemon(options); }

module.exports = { DAEMON_REVISION, DirectSemanticDaemon, Dss02Daemon: DirectSemanticDaemon, createDss02Daemon };
