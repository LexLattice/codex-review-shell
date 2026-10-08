"use strict";

const { DirectSemanticDaemon } = require("./daemon");
const { Dss02ProtocolServer } = require("./protocol");
const { digestObject } = require("./dss02-common");
const { CommissioningCoordinator } = require("./commissioning-coordinator");
const { snapshotForRequest, fail } = require("./commissioning-compiler");

class CommissioningDaemon extends DirectSemanticDaemon {
  constructor({ pack, ...options }) {
    super(options);
    this.pack = pack;
    this.coordinator = null;
    this.commissioningWaiters = new Map();
  }

  async start({ listen = this.listenByDefault, ...options } = {}) {
    if (this.started && this.coordinator) return this.status();
    const base = await super.start({ ...options, listen: false });
    if (!base.ready) return base;
    try {
      this.coordinator = new CommissioningCoordinator({ daemon: this, pack: this.pack }).open();
      this.coordinator.on("blocked", (reason) => { this.ready = false; this.blockedReason = reason; });
      if (listen) { this.protocol = new Dss02ProtocolServer({ daemon: this }); await this.protocol.start(); }
      this.coordinator.schedule();
      return this.status();
    } catch (error) {
      this.ready = false;
      this.blockedReason = error.code || "COMMISSIONING_OPEN_FAILED";
      return this.status();
    }
  }

  status() {
    const base = super.status();
    return { ...base, schema: "direct_commissioning_service_status@1", commissioningRevision: "commissioning-v1", packDigest: this.pack?.packDigest || null, advisoryOnly: true };
  }

  submit(options) {
    const { request, authorizationReceipt } = options;
    this.validateAuthorizationReceipt(authorizationReceipt, { operation: "submit", requestDigest: digestObject("DirectSemanticService.SemanticJobRequest.v1", request) });
    if (!this.ready || !this.coordinator) fail("COMMISSIONING_NOT_READY");
    snapshotForRequest(this.pack, request);
    const prior = this.idempotency.find(authorizationReceipt.principalRef, "submit", request.idempotencyKey);
    if (!prior && this.store.get("SELECT COUNT(*) AS count FROM commissioning_heads").count >= 64) fail("COMMISSIONING_JOB_CAPACITY");
    const receipt = super.submit(options);
    this.coordinator.ensureJob(receipt.jobRef);
    this.coordinator.schedule();
    return receipt;
  }

  authorizedState(jobRef, authorizationReceipt, operation) {
    this.validateAuthorizationReceipt(authorizationReceipt, { operation });
    if (!this.ready || !this.coordinator || this.coordinator.blockedReason) fail("COMMISSIONING_NOT_READY");
    const state = this.coordinator.state(jobRef);
    if (!state || state.principalRef !== authorizationReceipt.principalRef) fail("COMMISSIONING_READ_SCOPE");
    return state;
  }

  inspect({ jobRef, authorizationReceipt, projectionRef, ...options }) {
    if (projectionRef === "projection-safe@1" || projectionRef === "projection-custody-v1") {
      this.authorizedState(jobRef, authorizationReceipt, "inspect");
      return super.inspect({ jobRef, authorizationReceipt, projectionRef: "projection-safe@1", ...options });
    }
    if (projectionRef !== undefined && projectionRef !== "commissioning-projection-v1") fail("COMMISSIONING_PROJECTION_UNKNOWN");
    return this.coordinator.view(this.authorizedState(jobRef, authorizationReceipt, "inspect"));
  }

  results({ jobRef, authorizationReceipt, projectionRef }) {
    if (projectionRef === "projection-safe@1" || projectionRef === "projection-custody-v1") {
      this.authorizedState(jobRef, authorizationReceipt, "results");
      return super.results({ jobRef, authorizationReceipt, projectionRef: "projection-safe@1" });
    }
    if (projectionRef !== undefined && projectionRef !== "commissioning-projection-v1") fail("COMMISSIONING_PROJECTION_UNKNOWN");
    return this.coordinator.view(this.authorizedState(jobRef, authorizationReceipt, "results"));
  }

  subscribe({ jobRef, authorizationReceipt, returnProjectionRef }) {
    if (returnProjectionRef === "projection-safe@1") {
      this.authorizedState(jobRef, authorizationReceipt, "subscribe");
      return super.subscribe({ jobRef, authorizationReceipt, returnProjectionRef });
    }
    if (returnProjectionRef !== undefined && returnProjectionRef !== "commissioning-projection-v1") fail("COMMISSIONING_PROJECTION_UNKNOWN");
    const state = this.coordinator.subscribe(this.authorizedState(jobRef, authorizationReceipt, "subscribe"));
    return { schema: "direct_commissioning_subscription@1", jobRef, subscriptionRef: state.subscription.subscriptionRef, currentCursor: state.revision, authorityEffect: "none" };
  }

  wait({ jobRef, subscriptionRef, authorizationReceipt, afterSequence = 0, timeoutMs = 0, ...options }) {
    const state = this.authorizedState(jobRef, authorizationReceipt, "subscribe");
    if (!state.subscription || (subscriptionRef && !subscriptionRef.startsWith("commissioning-subscription:"))) return super.wait({ jobRef, subscriptionRef, authorizationReceipt, afterSequence, timeoutMs, ...options });
    if (!state.subscription || (subscriptionRef && subscriptionRef !== state.subscription.subscriptionRef)) fail("COMMISSIONING_SUBSCRIPTION_REQUIRED");
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) fail("COMMISSIONING_WAIT_BOUNDS");
    if (state.revision > afterSequence) return this.coordinator.view(state);
    const noEvents = () => ({ schema: "direct_commissioning_wait@1", jobRef, status: "NO_NEW_EVENTS", currentCursor: this.coordinator.state(jobRef).revision, authorityEffect: "none" });
    if (timeoutMs === 0) return noEvents();
    if (this.commissioningWaiters.size >= 64) fail("COMMISSIONING_WAITER_CAPACITY");
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.coordinator.removeListener("change", changed);
        this.commissioningWaiters.delete(abandon);
        if (error) reject(error); else resolve(value);
      };
      const changed = (changedJob) => {
        if (changedJob !== jobRef) return;
        try {
          const current = this.authorizedState(jobRef, authorizationReceipt, "subscribe");
          if (current.revision > afterSequence) finish(null, this.coordinator.view(current));
        } catch (error) { finish(error); }
      };
      const abandon = () => { const error = new Error("COMMISSIONING_HOST_CLOSED"); error.code = "COMMISSIONING_HOST_CLOSED"; finish(error); };
      const timer = setTimeout(() => { try { this.authorizedState(jobRef, authorizationReceipt, "subscribe"); finish(null, noEvents()); } catch (error) { finish(error); } }, timeoutMs);
      this.commissioningWaiters.set(abandon, options.connectionRef);
      this.coordinator.on("change", changed);
      changed(jobRef);
    });
  }

  ack({ deliveryAttemptRef, authorizationReceipt, projectionDigest }) {
    if (typeof deliveryAttemptRef === "string" && !deliveryAttemptRef.startsWith("commissioning-delivery:")) return super.ack({ deliveryAttemptRef, authorizationReceipt, projectionDigest });
    this.validateAuthorizationReceipt(authorizationReceipt, { operation: "acknowledge" });
    if (!this.ready || !this.coordinator) fail("COMMISSIONING_NOT_READY");
    return this.coordinator.acknowledge({ deliveryAttemptRef, principalRef: authorizationReceipt.principalRef, projectionDigest });
  }

  cancel(options) {
    const result = super.cancel(options);
    const state = this.coordinator.state(options.jobRef);
    if (state?.status === "QUEUED") this.coordinator.finish(state, { admission: "NOT_ATTEMPTED", disposition: "REMANDS", reasonCode: "CANCELLED_BEFORE_DISPATCH", evidenceRefs: [], proofStatus: "UNPROVEN", authorityEffect: "none" });
    return result;
  }

  disconnectTransport(connectionRef) {
    for (const [abandon, owner] of [...this.commissioningWaiters]) if (owner === connectionRef) abandon();
    super.disconnectTransport(connectionRef);
  }

  async close() {
    for (const abandon of [...this.commissioningWaiters.keys()]) abandon();
    await this.coordinator?.close();
    await super.close();
  }
}

module.exports = { CommissioningDaemon };
