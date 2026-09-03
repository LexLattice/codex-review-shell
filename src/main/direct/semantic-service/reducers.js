"use strict";

const { dss02Fail, digestObject } = require("./dss02-common");

class Dss02Reducers {
  constructor({ ledger } = {}) { if (!ledger) dss02Fail("DSS02_REDUCER_LEDGER_REQUIRED"); this.ledger = ledger; }
  rebuild(jobRef) {
    const events = this.ledger.eventsForJob(jobRef);
    let state = "UNSEEN";
    for (const event of events) {
      if (event.eventType.includes("admitted")) state = "ADMITTED";
      else if (event.eventType.includes("cancelled")) state = "CANCELLED_BEFORE_DISPATCH";
      else if (event.eventType.includes("handoff")) state = "HANDOFF_COMMITTED";
      else if (event.eventType.includes("recovery") || event.eventType.includes("blocked")) state = "RECOVERY_BLOCKED";
    }
    return Object.freeze({ schema: "direct_semantic_job_derived_head@1", jobRef, state, eventSequence: events.length, eventDigest: events.at(-1)?.eventDigest || null, projectionDigest: digestObject("DirectSemanticService.JobHead.v1", { jobRef, state, eventSequence: events.length, eventDigest: events.at(-1)?.eventDigest || null }) });
  }
  assertCurrent() { return this.ledger.assertHeads(); }
}

module.exports = { Dss02Reducers, Reducers: Dss02Reducers };
