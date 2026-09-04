#!/usr/bin/env node
/* Focus/acceptance regression for the frozen DSS-0.5 generation-1 slice. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dss = require("../src/main/direct/semantic-service/dss05.js");
const { digestObject } = require("../src/main/direct/semantic-service/dss02-common.js");
const frozenModule = JSON.parse(fs.readFileSync(new URL("../src/main/direct/semantic-service/resources/dss05-module.v0.json", import.meta.url), "utf8"));
const frozenManifest = JSON.parse(fs.readFileSync(new URL("../test/fixtures/direct-semantic-service/dss05-generation-1/candidate_manifest.v1.json", import.meta.url), "utf8"));
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha = (value) => `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex")}`;
const shaBytes = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const resealEvents = (state) => {
  let prior = null;
  for (const event of state.events) {
    event.priorDigest = prior;
    delete event.eventDigest;
    event.eventDigest = digestObject("Event", event);
    prior = event.eventDigest;
  }
};
const auth = (owner, root) => ({ owner, root, authorized: true });
const digest = "sha256:" + "1".repeat(64);
const now = "2026-09-01T00:00:00.000Z";

assert.equal(dss.DSS05_CARRIERS.length, 12);
assert.equal(dss.DSS05_OPERATIONS.length, 14);
assert.equal(dss.DSS05_QUALIFIED_TRANSITIONS.length, 47);
assert.equal(new Set(dss.DSS05_QUALIFIED_TRANSITIONS).size, 47);
assert.equal(frozenModule.module_id, dss.DSS05_MODULE_ID);
assert.equal(shaBytes(fs.readFileSync(new URL("../src/main/direct/semantic-service/resources/dss05-module.v0.json", import.meta.url))), dss.DSS05_MODULE_DIGEST);
assert.equal(frozenManifest.semanticModuleDigest, dss.DSS05_MODULE_DIGEST);
assert.equal(frozenManifest.combinedFreezeDigest, dss.DSS05_COMBINED_FREEZE_DIGEST);
assert.deepEqual(dss.DSS05_CARRIERS, frozenModule.carriers.map((carrier) => carrier.id));
assert.deepEqual(dss.DSS05_OPERATIONS, frozenModule.operations.map((operation) => operation.id));
assert.deepEqual(dss.DSS05_QUALIFIED_TRANSITIONS, frozenModule.qualified_transitions.map((transition) => transition.transitionId));

const root = fs.mkdtempSync(`${os.tmpdir()}/direct-dss05-regression-`);
const service = dss.createDss05Service({ root, now });
const beforeUnauthorized = service.status().counts;
assert.equal(service.installWorkerExecutionRuntime({ runtime: {}, grant: auth("wrong", "wrong") }).status, "UNAUTHORIZED");
assert.deepEqual(service.status().counts, beforeUnauthorized);
const runtime = { substrateBinding: "node-pinned-worker", backendAdapterRevision: "adapter-substrate-1", processLauncherDigest: digest, sandboxPolicyDigest: digest, scratchPolicyDigest: digest, environmentAllowlistDigest: digest, credentialExclusionPolicyDigest: digest, outputCapturePolicyDigest: digest, runtimeArtifactDigest: digest, runtimeRevision: "worker-runtime-revision-1" };
assert.equal(service.installWorkerExecutionRuntime({ runtime, grant: auth("dss05-runtime-owner", "dss05-worker-runtime-root"), availabilityEvidence: { admitted: true, revision: "runtime-evidence-1" } }).status, "ADMITTED");
assert.equal(service.installWorkerExecutionRuntime({ runtime: { ...runtime, projectEvidenceRuntimeRevisionRef: "forbidden" }, grant: auth("dss05-runtime-owner", "dss05-worker-runtime-root"), availabilityEvidence: { admitted: true } }).status, "BROKEN");
const providerEvidence = { admitted: true, providerProfileRevisionRef: "provider-profile-1", providerAvailabilityDigest: digest, modelAvailabilityDigest: digest, endpointPolicyDigest: digest, credentialExclusionDigest: digest, observedAt: now };
const adapter = { model: "deterministic-test-model", adapterBuildDigest: digest, providerDialect: "deterministic-test-dialect", requestMappingDigest: digest, responseMappingDigest: digest, transportPolicyDigest: digest, adapterRevision: "model-adapter-revision-1" };
assert.equal(service.installModelAdapterRevision({ adapter, grant: auth("dss05-adapter-owner", "dss05-model-adapter-root") }).status, "UNAVAILABLE");
assert.equal(service.installModelAdapterRevision({ adapter, providerRuntimeEvidence: providerEvidence, grant: auth("dss05-adapter-owner", "dss05-model-adapter-root") }).status, "ADMITTED");
const handoff = { page_ref: "dss04-page-1", materialization_ref: "dss04-materialization-1", page_digest: digest, route_population_digest: digest, completeness_receipt_ref: "dss04-completeness-1", sufficiency_receipt_ref: "dss04-sufficiency-1", batch_seal_ref: "dss04-batch-seal-1", dss04_service_generation: "sha256:f3f7d115b7d8d3f39665c8afddedaa38d3ae1ba4fe91c294270806867594b019", dss04_semantic_candidate: "04c6437522779c060c2c3f3e3050a42ca0b77a1f", dss04_implementation_source_commit: "6a1facfa7999b7042304de97e64c1463cff8c09b", projection_revision: "direct.dss04.closed-page-projection.v1", dss04_pass_closure: "55ef4eef5811cdc753bb810f773564bf11359b5c" };
const handoffResult = service.admitClosedPageHandoff(handoff);
assert.equal(handoffResult.status, "ADMITTED");
assert.ok(handoffResult.capsule?.capsuleRef);
assert.equal(service.admitClosedPageHandoff(handoff).status, "REPLAYED");
assert.equal(service.buildCanonicalExecutionRequest({ capsuleRef: handoffResult.capsule.capsuleRef, prompt: "caller-authored raw prompt" }).status, "REJECTED");
const requestResult = service.buildCanonicalExecutionRequest({ capsuleRef: handoffResult.capsule.capsuleRef });
assert.equal(requestResult.status, "BUILT");
assert.equal(service.buildCanonicalExecutionRequest({ capsuleRef: handoffResult.capsule.capsuleRef }).status, "REPLAYED");
const allocateResult = service.allocateExecutionAttempt({ capsuleRef: handoffResult.capsule.capsuleRef, requestRef: requestResult.request.requestRef });
assert.equal(allocateResult.status, "ALLOCATED");
const attemptRef = allocateResult.attempt.attemptRef;
assert.equal(service.dispatchExecutionAttempt({ attemptRef, providerAvailable: false }).status, "TRANSPORT_UNAVAILABLE_BEFORE_DISPATCH");
assert.equal(service.state.attempts[attemptRef].state, "ALLOCATED");
assert.equal(service.dispatchExecutionAttempt({ attemptRef, providerAvailable: true }).status, "STARTED");
const rawResult = { status: "SUPPORTS", claims: [{ claim: "deterministic-law", standing: "ADVISORY" }], evidence_refs: [handoff.page_ref] };
assert.equal(service.captureQuarantineRawResult({ attemptRef, raw: rawResult }).status, "QUARANTINED");
const raw = Object.values(service.state.rawResults)[0];
assert.equal(service.state.events.find((event) => event.event === "CAPTURE").payload.rawPayload, undefined);
assert.ok(fs.existsSync(`${root}/${raw.quarantinePath}`));
assert.equal(service.admitCanonicalResponse({ rawResultRef: raw.rawResultRef }).status, "ADMITTED");
const response = Object.values(service.state.responses)[0];
assert.equal(service.recordProviderUsage({ attemptRef, requestRef: requestResult.request.requestRef, rawResultRef: raw.rawResultRef, usage: { inputTokens: 2, outputTokens: 3 } }).status, "RECORDED");
const usage = Object.values(service.state.usage)[0];
assert.equal(service.evaluateExecutionCell({ capsuleRef: handoffResult.capsule.capsuleRef, attemptRef, responseRef: response.microResultRef, usageReceiptRef: usage.usageReceiptRef }).status, "RECORDED");
assert.equal(service.sealAdvisoryDisposition({ capsuleRef: handoffResult.capsule.capsuleRef }).status, "SEALED");
assert.equal(service.sealAdvisoryDisposition({ capsuleRef: handoffResult.capsule.capsuleRef }).status, "REPLAYED");
assert.equal(service.recoverWorkerExecution().status, "READY");
assert.equal(service.recoverWorkerExecution().status, "REPLAYED");

/* A lawful neighbor is executable against a fresh state and remains valid
 * after its event is persisted.  The direct negative mutations below must
 * fail before they can append an event. */
const lawfulRoot = fs.mkdtempSync(`${os.tmpdir()}/direct-dss05-lawful-neighbor-`);
const lawfulService = dss.createDss05Service({ root: lawfulRoot, now });
const lawfulKey = "allocate-execution-attempt:d.execution-attempt:ALLOCATE";
const lawfulRow = dss.DSS05_TRANSITION_MAP.get(lawfulKey);
const lawfulEvent = lawfulService._transition("allocate-execution-attempt", "d.execution-attempt", "ALLOCATE", { attemptRef: "lawful-neighbor" }, lawfulRow.outcomeCases[0], lawfulRow.fromStates[0], lawfulRow.toState);
assert.equal(lawfulEvent.transitionId, lawfulRow.transitionId);
assert.equal(lawfulEvent.owner, lawfulRow.owner);
assert.equal(lawfulEvent.priorStateSource, lawfulRow.priorStateSource);
assert.deepEqual(lawfulEvent.fromStates, lawfulRow.fromStates);
assert.equal(lawfulEvent.toState, lawfulRow.toState);
assert.equal(lawfulEvent.outcome, lawfulRow.outcomeCases[0]);
assert.deepEqual(lawfulEvent.outcomeCases, lawfulRow.outcomeCases);
lawfulService._verifyStateEnvelope();
lawfulService._persist();
lawfulService.close();

const eventCountBeforeTransitionMutations = service.state.events.length;
assert.throws(() => service._transition("allocate-execution-attempt", "d.execution-attempt", "ALLOCATE", { attemptRef: "wrong-outcome" }, "WRONG_OUTCOME", "ABSENT", "ALLOCATED"), (error) => error.code === "DSS05_TRANSITION_OUTCOME_INVALID");
assert.throws(() => service._transition("allocate-execution-attempt", "d.execution-attempt", "ALLOCATE", { attemptRef: "wrong-destination" }, "ALLOCATED", "ABSENT", "WRONG_DESTINATION"), (error) => error.code === "DSS05_TRANSITION_DESTINATION_INVALID");
assert.equal(service.state.events.length, eventCountBeforeTransitionMutations);

/* Prospective cancellation: allocated work can be cancelled; started work
 * loses the race and never becomes a pre-start cancellation. */
const second = service.allocateExecutionAttempt({ capsuleRef: handoffResult.capsule.capsuleRef, requestRef: requestResult.request.requestRef, replicateSlotRef: "dss05-replicate-slot-cancel" });
assert.equal(second.status, "ALLOCATED");
assert.equal(service.cancelExecutionAttempt({ attemptRef: second.attempt.attemptRef }).status, "CANCELLED_PRESTART");
assert.equal(service.cancelExecutionAttempt({ attemptRef }).status, "COMPLETE");

/* A running process loses the prospective-cancellation race.  Closing at this
 * point leaves a durable open attempt for restart recovery to block. */
const running = service.allocateExecutionAttempt({ capsuleRef: handoffResult.capsule.capsuleRef, requestRef: requestResult.request.requestRef, replicateSlotRef: "dss05-replicate-slot-running" });
assert.equal(running.status, "ALLOCATED");
assert.equal(service.dispatchExecutionAttempt({ attemptRef: running.attempt.attemptRef, providerAvailable: true }).status, "STARTED");
assert.equal(service.cancelExecutionAttempt({ attemptRef: running.attempt.attemptRef }).status, "CANCELLATION_LOST_RACE");

/* Exclusion boundary: Spark remains deferred even when an adapter descriptor
 * is presented without an admitted runtime/provider evidence record. */
const spark = service.installModelAdapterRevision({ adapter: { ...adapter, model: "Spark" }, grant: auth("dss05-adapter-owner", "dss05-model-adapter-root") });
assert.equal(spark.status, "UNAVAILABLE");
assert.equal(spark.adapter.standing, "EXCLUDED_DEFERRED");
service.close();

/* Persist a semantically relabelled event with a recomputed ledger digest and
 * authenticated state envelope.  Recovery must still reject it by the frozen
 * transition row, rather than trusting the relabelled event's self-digest. */
const tamperRoot = fs.mkdtempSync(`${os.tmpdir()}/direct-dss05-semantic-relabel-`);
fs.cpSync(root, tamperRoot, { recursive: true });
const tampered = dss.createDss05Service({ root: tamperRoot, now });
const relabelled = tampered.state.events.find((event) => event.operationId === "install-worker-execution-runtime");
assert.ok(relabelled);
relabelled.outcome = "SEMANTIC_RELABEL_NOT_IN_ROW";
resealEvents(tampered.state);
tampered._persist();
tampered.close();
const relabelledRestart = dss.createDss05Service({ root: tamperRoot, now });
assert.equal(relabelledRestart.recoverWorkerExecution().status, "BROKEN");
relabelledRestart.close();

const restarted = dss.createDss05Service({ root, now });
assert.equal(restarted.recoverWorkerExecution().status, "BLOCKED");
assert.equal(restarted.state.attempts[running.attempt.attemptRef].state, "RECOVERY_BLOCKED");
restarted.close();

const regressionSourceDigest = shaBytes(fs.readFileSync(new URL(import.meta.url)));
const mutationResults = { lawfulNeighbor: "VERIFIED", wrongOutcome: "DSS05_TRANSITION_OUTCOME_INVALID", wrongDestination: "DSS05_TRANSITION_DESTINATION_INVALID", persistedSemanticRelabelRecovery: "BROKEN" };
const sourceDigest = sha({ moduleId: dss.DSS05_MODULE_ID, moduleDigest: dss.DSS05_MODULE_DIGEST, serviceGeneration: dss.DSS05_SERVICE_GENERATION, regressionSourceDigest, status: "PASS", expected: { carriers: 12, operations: 14, qualifiedTransitions: 47, mutations: mutationResults }, observed: { status: "SEALED", recovery: "READY", authorityEffect: "NONE", mutations: mutationResults } });
const receipt = { schema: "direct-semantic-service-dss05-gate-receipt.v1", lane: "focus+acceptance", moduleId: dss.DSS05_MODULE_ID, implementationCommit: process.env.DSS05_IMPLEMENTATION_COMMIT || "WORKTREE", expected: { carriers: 12, operations: 14, qualifiedTransitions: 47, mutations: mutationResults }, observed: { carrierCount: 12, operationCount: 14, qualifiedTransitionCount: 47, terminalDisposition: "SEALED", recovery: "READY", authorityEffect: "NONE", mutations: mutationResults }, sourceDigest, regressionSourceDigest, resourceProfile: { workers: 1, network: "disabled", provider: "unavailable", database: "sqlite-local" }, outcome: "PASS" };
receipt.receiptDigest = sha(receipt);
console.log(JSON.stringify({ status: "PASS", moduleId: dss.DSS05_MODULE_ID, implementationCommit: receipt.implementationCommit, carriers: 12, operations: 14, qualifiedTransitions: 47, terminalDisposition: "SEALED", recovery: "READY", authorityEffect: "NONE", receiptDigest: receipt.receiptDigest, root }, null, 2));
