"use strict";

const {
  dss02Fail,
  immutableId,
  isoNow,
  randomRef,
  digestObject,
  checkedInteger,
} = require("./dss02-common");

class Dss02WaiterGate {
  constructor({ profileRef = "direct-profile", generationRef, limit = 100, now = undefined } = {}) {
    if (!generationRef) dss02Fail("DSS02_WAITER_GENERATION_REQUIRED");
    checkedInteger(limit, "waiter limit");
    this.profileRef = profileRef;
    this.generationRef = generationRef;
    this.limit = limit;
    this.now = now;
    this.populationRevision = 0;
    this.active = new Map();
    this.releases = new Map();
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  observation() {
    const tokens = [...this.active.keys()].sort();
    return Object.freeze({ schema: "direct_semantic_waiter_population_observation@1", daemonGeneration: this.generationRef, populationRevision: this.populationRevision, activeCount: tokens.length, activeTokenDigest: digestObject("DirectSemanticService.WaiterPopulation.v1", tokens), waiterLimit: this.limit });
  }

  reserve({ connectionRef, waitRequestRef, deadline, expectedPopulationRevision = this.populationRevision } = {}) {
    if (expectedPopulationRevision !== this.populationRevision) return { status: "STALE_POPULATION", observation: this.observation() };
    if (this.active.size >= this.limit) return { status: "AT_LIMIT", observation: this.observation() };
    const token = randomRef("waiter-token");
    const record = Object.freeze({ schema: "direct_semantic_waiter_token@1", reservationToken: token, profileRef: this.profileRef, daemonGeneration: this.generationRef, connectionRef: immutableId(connectionRef, "connectionRef"), waitRequestRef: immutableId(waitRequestRef, "waitRequestRef"), deadline: deadline || this.clock(), reservedAt: this.clock(), populationRevision: this.populationRevision + 1, state: "ACTIVE" });
    this.active.set(token, record);
    this.populationRevision += 1;
    return { status: "RESERVED", token: record, observation: this.observation() };
  }

  release({ reservationToken, reason = "RESPONSE", generationRef = this.generationRef } = {}) {
    if (generationRef !== this.generationRef) return { status: "RESTART_INVALIDATED", observation: this.observation() };
    if (!this.active.has(reservationToken)) {
      if (this.releases.has(reservationToken)) return { status: "EXACT_REPLAY", release: this.releases.get(reservationToken), observation: this.observation() };
      return { status: "FOREIGN_TOKEN", observation: this.observation() };
    }
    const token = this.active.get(reservationToken);
    this.active.delete(reservationToken);
    this.populationRevision += 1;
    const release = Object.freeze({ schema: "direct_semantic_waiter_release@1", reservationToken, daemonGeneration: this.generationRef, reason, releasedAt: this.clock(), populationRevision: this.populationRevision });
    this.releases.set(reservationToken, release);
    return { status: "RELEASED", release, observation: this.observation() };
  }

  invalidateRestart(newGenerationRef) {
    if (!newGenerationRef) dss02Fail("DSS02_WAITER_GENERATION_REQUIRED");
    const oldTokens = [...this.active.keys()];
    for (const token of oldTokens) this.releases.set(token, Object.freeze({ schema: "direct_semantic_waiter_release@1", reservationToken: token, daemonGeneration: this.generationRef, reason: "RESTART_INVALIDATED", releasedAt: this.clock(), populationRevision: this.populationRevision + 1 }));
    this.active.clear();
    this.generationRef = newGenerationRef;
    this.populationRevision += 1;
    return this.observation();
  }
}

function createDss02WaiterGate(options) { return new Dss02WaiterGate(options); }

module.exports = { Dss02WaiterGate, WaiterGate: Dss02WaiterGate, createDss02WaiterGate };
