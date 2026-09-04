#!/usr/bin/env node
/* Focus + acceptance regression for the frozen DSS-0.6 generation-1 slice. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dss = require("../src/main/direct/semantic-service/dss06.js");
const bootstrapProvisioning = require("../src/main/direct/semantic-service/bootstrap-provisioning.js");
const { DSS02_PROTOCOL, digestObject } = require("../src/main/direct/semantic-service/dss02-common.js");
const { createAuthorizationProof } = require("../src/main/direct/semantic-service/authority-store.js");
const frozenModule = JSON.parse(fs.readFileSync(new URL("../src/main/direct/semantic-service/resources/dss06-module.v0.json", import.meta.url), "utf8"));
const frozenManifest = JSON.parse(fs.readFileSync(new URL("../test/fixtures/direct-semantic-service/dss06-generation-1/candidate_manifest.v1.json", import.meta.url), "utf8"));
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const shaBytes = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const sha = (value) => `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex")}`;
const now = "2026-09-01T00:00:00.000Z";

assert.equal(dss.DSS06_CARRIERS.length, 17);
assert.equal(dss.DSS06_OPERATIONS.length, 17);
assert.equal(dss.DSS06_QUALIFIED_TRANSITIONS.length, 66);
assert.equal(new Set(dss.DSS06_QUALIFIED_TRANSITIONS).size, 66);
assert.equal(frozenModule.module_id, dss.DSS06_MODULE_ID);
assert.equal(shaBytes(fs.readFileSync(new URL("../src/main/direct/semantic-service/resources/dss06-module.v0.json", import.meta.url))), dss.DSS06_MODULE_DIGEST);
assert.equal(frozenManifest.semanticModuleDigest, dss.DSS06_MODULE_DIGEST);
assert.equal(frozenManifest.combinedFreezeDigest, dss.DSS06_COMBINED_FREEZE_DIGEST);
assert.deepEqual(dss.DSS06_CARRIERS, frozenModule.carriers.map((carrier) => carrier.id));
assert.deepEqual(dss.DSS06_OPERATIONS, frozenModule.operations.map((operation) => operation.id));
assert.deepEqual(dss.DSS06_QUALIFIED_TRANSITIONS, frozenModule.qualified_transitions.map((transition) => transition.transitionId));

function offlineAuthority() {
  const root = fs.mkdtempSync(`${os.tmpdir()}/direct-dss06-`);
  const installationRoot = path.join(root, "owner-installation");
  const authorityProfileRoot = path.join(root, "authority-profile");
  const authorityProfileRef = "dss06-test-authority";
  const descriptorPolicy = { kind: "dss06-authority", revision: "generation-1" };
  bootstrapProvisioning.installOwnerBootstrapTrustRoot({ installationRoot, configurationRevision: "direct-dss06-test-installation@1" });
  const provisioned = bootstrapProvisioning.provisionBootstrapCommitment({
    installationRoot, profileRoot: authorityProfileRoot, profileRef: authorityProfileRef,
    expectedDaemonRevision: "direct-semantic-dss06-authority@1", protocolRevision: DSS02_PROTOCOL, descriptorPolicy,
  });
  const authorized = bootstrapProvisioning.authorizeBootstrap({
    installationRoot, profileRoot: authorityProfileRoot, profileRef: authorityProfileRef, secret: provisioned.secret,
    descriptorProvenance: descriptorPolicy, daemonRevision: "direct-semantic-dss06-authority@1", protocolRevision: DSS02_PROTOCOL, now,
  });
  assert.equal(authorized.authorized, true);
  return { root, installationRoot, authorityProfileRoot, authorityProfileRef, provisioned, authorized };
}
function fresh() {
  const { root, installationRoot, authorityProfileRoot, authorityProfileRef, provisioned, authorized } = offlineAuthority();
  const service = dss.createDss06Service({ root, installationRoot, authorityProfileRoot, authorityProfileRef, now });
  const boot = service.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
    bootstrapCommitment: provisioned.commitment, bootstrapAttempt: authorized.attempt, bootstrapAuthorization: authorized.authorization,
  } });
  assert.equal(boot.status, "BOOTSTRAPPED");
  return { service, refs: boot.references, root, installationRoot, authorityProfileRoot, authorityProfileRef, provisioned, authorized };
}
function bindAll(service, refs) {
  assert.equal(service.bindSubmitCapability({ capabilityRef: refs.submitCapabilityRef }).status, "CURRENT");
  assert.equal(service.bindReadCapability({ capabilityRef: refs.readCapabilityRef }).status, "CURRENT");
  assert.equal(service.bindSubscribeAckCapability({ capabilityRef: refs.subscribeAckCapabilityRef }).status, "CURRENT");
  assert.equal(service.bindWakeupCapability({ capabilityRef: refs.wakeupCapabilityRef }).status, "CURRENT");
}
function packageInput(refs, key = "idempotency-1") {
  return {
    ...refs,
    idempotencyKey: key,
    packageSchemaRevision: "direct-semantic-dss06-audit-package@1",
  };
}
function adminReceipt(fixture, action, targetRef) {
  const connectionRef = `admin-${action.toLowerCase()}-${targetRef}`;
  const transportObservation = { status: "OBSERVED", adapter: "focused-regression" };
  const challengeResult = fixture.service.issueAuthorityChallenge({ connectionRef, transportObservation });
  assert.equal(challengeResult.status, "ISSUED");
  const verifierResult = fixture.service.authorityVerifierRecord();
  assert.equal(verifierResult.status, "CURRENT");
  const requestDigest = digestObject("Dss06.AuthorityCommand", { action, targetRef });
  const objectScopeDigest = digestObject("Dss06.AuthorityScope.v1", { moduleId: dss.DSS06_MODULE_ID });
  const privateKey = crypto.createPrivateKey({ key: fs.readFileSync(path.join(fixture.installationRoot, "owner-bootstrap-root.private.der")), type: "pkcs8", format: "der" });
  const proof = createAuthorizationProof({
    challenge: challengeResult.challenge, requestDigest, operation: "service-administration", purposeScopes: [], objectScopeDigest,
    verifier: verifierResult.verifier, privateKey,
  });
  const resolved = fixture.service.resolveAuthorityAuthorization({
    connectionRef, transportObservation, challengeRef: challengeResult.challenge.challengeRef, proof,
    requestDigest, operation: "service-administration", purposeScopes: [], objectScopeDigest,
  });
  assert.equal(resolved.status, "AUTHORIZED");
  return resolved.authorizationReceipt;
}

const noAuthorityRoot = fs.mkdtempSync(`${os.tmpdir()}/direct-dss06-no-authority-`);
const noAuthority = dss.createDss06Service({ root: noAuthorityRoot, now });
const noAuthorityCounts = noAuthority.status().counts;
assert.equal(noAuthority.bootstrapOwnerIssuedRecords({ bootstrapToken: { owner: "caller", root: true, authorized: true } }).status, "AUTHORITY_BOOTSTRAP_REQUIRED");
assert.equal(noAuthority.observeDaemonHealth({ readCapabilityRef: "sha256:" + "0".repeat(64), state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
assert.deepEqual(noAuthority.status().counts, noAuthorityCounts);
noAuthority.close();

const foreignCeremony = offlineAuthority();
const localCeremony = offlineAuthority();
const foreignService = dss.createDss06Service({ root: localCeremony.root, installationRoot: localCeremony.installationRoot, authorityProfileRoot: localCeremony.authorityProfileRoot, authorityProfileRef: localCeremony.authorityProfileRef, now });
const foreignBefore = foreignService.status().counts;
const foreignArtifacts = JSON.parse(JSON.stringify({
  bootstrapCommitment: foreignCeremony.provisioned.commitment,
  bootstrapAttempt: foreignCeremony.authorized.attempt,
  bootstrapAuthorization: foreignCeremony.authorized.authorization,
}));
assert.equal(foreignService.bootstrapOwnerIssuedRecords({ authorityBootstrap: foreignArtifacts }).status, "AUTHORITY_BOOTSTRAP_INVALID");
assert.deepEqual(foreignService.status().counts, foreignBefore);
foreignService.close();

const preflightCeremony = offlineAuthority();
const preflightService = dss.createDss06Service({ root: preflightCeremony.root, installationRoot: preflightCeremony.installationRoot, authorityProfileRoot: preflightCeremony.authorityProfileRoot, authorityProfileRef: preflightCeremony.authorityProfileRef, now });
assert.equal(preflightService.bootstrapOwnerIssuedRecords({
  authorityBootstrap: { bootstrapCommitment: preflightCeremony.provisioned.commitment, bootstrapAttempt: preflightCeremony.authorized.attempt, bootstrapAuthorization: preflightCeremony.authorized.authorization },
  records: { principal: { authorization: { forged: true } } },
}).status, "UNAUTHORIZED");
assert.equal(preflightService._authorityStatus.status, "UNPROVISIONED");
assert.equal(preflightService.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: preflightCeremony.provisioned.commitment, bootstrapAttempt: preflightCeremony.authorized.attempt, bootstrapAuthorization: preflightCeremony.authorized.authorization,
} }).status, "BOOTSTRAPPED");
preflightService.close();

/* Bootstrap custody fault phases: the PREPARED plan is the durable handoff
 * point, so no authority can be consumed before it and no partial population
 * can be exposed after it. */
const beforePreparedCeremony = offlineAuthority();
const beforePreparedService = dss.createDss06Service({ root: beforePreparedCeremony.root, installationRoot: beforePreparedCeremony.installationRoot, authorityProfileRoot: beforePreparedCeremony.authorityProfileRoot, authorityProfileRef: beforePreparedCeremony.authorityProfileRef, now, bootstrapFaultPhase: "before-prepared" });
const beforePreparedCounts = beforePreparedService.status().counts;
const beforePrepared = beforePreparedService.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: beforePreparedCeremony.provisioned.commitment, bootstrapAttempt: beforePreparedCeremony.authorized.attempt, bootstrapAuthorization: beforePreparedCeremony.authorized.authorization,
} });
assert.equal(beforePrepared.status, "STALE_CURRENTNESS");
assert.equal(beforePrepared.phase, "BEFORE_PREPARED");
assert.equal(beforePreparedService._authorityStatus.status, "UNPROVISIONED");
assert.equal(beforePreparedService.state.bootstrapIntent, undefined);
assert.deepEqual(beforePreparedService.status().counts, beforePreparedCounts);
beforePreparedService.close();
const beforePreparedRetry = dss.createDss06Service({ root: beforePreparedCeremony.root, installationRoot: beforePreparedCeremony.installationRoot, authorityProfileRoot: beforePreparedCeremony.authorityProfileRoot, authorityProfileRef: beforePreparedCeremony.authorityProfileRef, now });
assert.equal(beforePreparedRetry.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: beforePreparedCeremony.provisioned.commitment, bootstrapAttempt: beforePreparedCeremony.authorized.attempt, bootstrapAuthorization: beforePreparedCeremony.authorized.authorization,
} }).status, "BOOTSTRAPPED");
beforePreparedRetry.close();

const storageBeforePreparedCeremony = offlineAuthority();
const storageBeforePreparedService = dss.createDss06Service({ root: storageBeforePreparedCeremony.root, installationRoot: storageBeforePreparedCeremony.installationRoot, authorityProfileRoot: storageBeforePreparedCeremony.authorityProfileRoot, authorityProfileRef: storageBeforePreparedCeremony.authorityProfileRef, now });
storageBeforePreparedService.store.failBeforeCommit = true;
const storageBeforePreparedCounts = storageBeforePreparedService.status().counts;
assert.equal(storageBeforePreparedService.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: storageBeforePreparedCeremony.provisioned.commitment, bootstrapAttempt: storageBeforePreparedCeremony.authorized.attempt, bootstrapAuthorization: storageBeforePreparedCeremony.authorized.authorization,
} }).status, "STALE_CURRENTNESS");
assert.equal(storageBeforePreparedService._authorityStatus.status, "UNPROVISIONED");
assert.equal(storageBeforePreparedService.state.bootstrapIntent, undefined);
assert.deepEqual(storageBeforePreparedService.status().counts, storageBeforePreparedCounts);
storageBeforePreparedService.close();

const afterPreparedCeremony = offlineAuthority();
const afterPreparedService = dss.createDss06Service({ root: afterPreparedCeremony.root, installationRoot: afterPreparedCeremony.installationRoot, authorityProfileRoot: afterPreparedCeremony.authorityProfileRoot, authorityProfileRef: afterPreparedCeremony.authorityProfileRef, now, bootstrapFaultPhase: "after-prepared" });
const afterPrepared = afterPreparedService.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: afterPreparedCeremony.provisioned.commitment, bootstrapAttempt: afterPreparedCeremony.authorized.attempt, bootstrapAuthorization: afterPreparedCeremony.authorized.authorization,
} });
assert.equal(afterPrepared.status, "STALE_CURRENTNESS");
assert.equal(afterPrepared.phase, "AFTER_PREPARED");
assert.equal(afterPreparedService._authorityStatus.status, "UNPROVISIONED");
assert.equal(afterPreparedService.state.bootstrapIntent.state, "PREPARED");
assert.equal(Object.keys(afterPreparedService.state.registries.principals).length, 0);
afterPreparedService.close();
const afterPreparedRestart = dss.createDss06Service({ root: afterPreparedCeremony.root, installationRoot: afterPreparedCeremony.installationRoot, authorityProfileRoot: afterPreparedCeremony.authorityProfileRoot, authorityProfileRef: afterPreparedCeremony.authorityProfileRef, now });
assert.equal(afterPreparedRestart._authorityStatus.status, "UNPROVISIONED");
assert.equal(afterPreparedRestart.recoverDss06Lineage().status, "BLOCKED");
assert.equal(Object.keys(afterPreparedRestart.state.registries.principals).length, 0);
assert.equal(afterPreparedRestart.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: afterPreparedCeremony.provisioned.commitment, bootstrapAttempt: afterPreparedCeremony.authorized.attempt, bootstrapAuthorization: afterPreparedCeremony.authorized.authorization,
} }).status, "BOOTSTRAPPED");
assert.equal(afterPreparedRestart.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: afterPreparedCeremony.provisioned.commitment, bootstrapAttempt: afterPreparedCeremony.authorized.attempt, bootstrapAuthorization: afterPreparedCeremony.authorized.authorization,
} }).status, "REPLAYED");
assert.equal(Object.keys(afterPreparedRestart.state.registries.principals).length, 1);
afterPreparedRestart.close();

const afterAuthorityCeremony = offlineAuthority();
const afterAuthorityService = dss.createDss06Service({ root: afterAuthorityCeremony.root, installationRoot: afterAuthorityCeremony.installationRoot, authorityProfileRoot: afterAuthorityCeremony.authorityProfileRoot, authorityProfileRef: afterAuthorityCeremony.authorityProfileRef, now, bootstrapFaultPhase: "after-authority" });
const afterAuthority = afterAuthorityService.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: afterAuthorityCeremony.provisioned.commitment, bootstrapAttempt: afterAuthorityCeremony.authorized.attempt, bootstrapAuthorization: afterAuthorityCeremony.authorized.authorization,
} });
assert.equal(afterAuthority.status, "STALE_CURRENTNESS");
assert.equal(afterAuthority.phase, "AFTER_AUTHORITY");
assert.equal(afterAuthorityService._authorityStatus.status, "CURRENT");
assert.equal(afterAuthorityService.state.bootstrapIntent.state, "PREPARED");
assert.equal(Object.keys(afterAuthorityService.state.registries.principals).length, 0);
const afterAuthorityRoot = afterAuthorityCeremony.root;
afterAuthorityService.close();
const afterAuthorityRestart = dss.createDss06Service({ root: afterAuthorityRoot, installationRoot: afterAuthorityCeremony.installationRoot, authorityProfileRoot: afterAuthorityCeremony.authorityProfileRoot, authorityProfileRef: afterAuthorityCeremony.authorityProfileRef, now });
assert.equal(afterAuthorityRestart._authorityStatus.status, "CURRENT");
assert.equal(afterAuthorityRestart.state.bootstrapIntent.state, "COMPLETE");
assert.equal(afterAuthorityRestart.state.bootstrap.state, "COMPLETE");
assert.equal(Object.keys(afterAuthorityRestart.state.registries.principals).length, 1);
assert.equal(afterAuthorityRestart.recoverDss06Lineage().status, "READY");
assert.equal(afterAuthorityRestart.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: afterAuthorityCeremony.provisioned.commitment, bootstrapAttempt: afterAuthorityCeremony.authorized.attempt, bootstrapAuthorization: afterAuthorityCeremony.authorized.authorization,
} }).status, "REPLAYED");
assert.equal(Object.keys(afterAuthorityRestart.state.registries.principals).length, 1);
afterAuthorityRestart.close();

const corruptPreparedCeremony = offlineAuthority();
const corruptPreparedService = dss.createDss06Service({ root: corruptPreparedCeremony.root, installationRoot: corruptPreparedCeremony.installationRoot, authorityProfileRoot: corruptPreparedCeremony.authorityProfileRoot, authorityProfileRef: corruptPreparedCeremony.authorityProfileRef, now, bootstrapFaultPhase: "after-prepared" });
assert.equal(corruptPreparedService.bootstrapOwnerIssuedRecords({ authorityBootstrap: {
  bootstrapCommitment: corruptPreparedCeremony.provisioned.commitment, bootstrapAttempt: corruptPreparedCeremony.authorized.attempt, bootstrapAuthorization: corruptPreparedCeremony.authorized.authorization,
} }).status, "STALE_CURRENTNESS");
corruptPreparedService.state.bootstrapIntent.plan.semantic.taskRef = "relabelled-task-ref";
corruptPreparedService._persist();
const corruptPreparedRoot = corruptPreparedCeremony.root;
corruptPreparedService.close();
const corruptPreparedRestart = dss.createDss06Service({ root: corruptPreparedRoot, installationRoot: corruptPreparedCeremony.installationRoot, authorityProfileRoot: corruptPreparedCeremony.authorityProfileRoot, authorityProfileRef: corruptPreparedCeremony.authorityProfileRef, now });
assert.equal(corruptPreparedRestart.recoverDss06Lineage().status, "BROKEN");
assert.equal(Object.keys(corruptPreparedRestart.state.registries.principals).length, 0);
corruptPreparedRestart.close();

const { service, refs } = fresh();
assert.equal(dss.Dss06OwnerBootstrap, undefined);
assert.equal(dss.Dss06AuthorityToken, undefined);
assert.equal(dss.createDss06OwnerBootstrap, undefined);
assert.equal(typeof service.getBootstrapToken, "undefined");
assert.equal(typeof service.getAuthorityToken, "undefined");
const beforeCrossUse = service.status().counts;
assert.equal(service.submitAuditPackage({ ...packageInput(refs), submitCapability: { owner: "caller", authorized: true } }).status, "UNAUTHORIZED");
assert.deepEqual(service.status().counts, beforeCrossUse);
assert.equal(service.observeDaemonHealth({ readCapability: JSON.parse(JSON.stringify(service.state.capabilities[refs.readCapabilityRef])), principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
assert.deepEqual(service.status().counts, beforeCrossUse);
assert.equal(service.bootstrapOwnerIssuedRecords({ bootstrapToken: { owner: "caller", authorized: true } }).status, "REPLAYED");
bindAll(service, refs);
assert.equal(service.observeDaemonHealth({ readCapabilityRef: refs.submitCapabilityRef, principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
assert.equal(service.observeDaemonHealth({ readCapabilityRef: refs.readCapabilityRef, principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, state: "HEALTHY" }).status, "HEALTHY");
assert.equal(service.observeDaemonHealth({ readCapabilityRef: refs.readCapabilityRef, principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, state: "DEGRADED" }).status, "DEGRADED");
assert.equal(service.observeDaemonHealth({ readCapabilityRef: refs.readCapabilityRef, principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, state: "HEALTHY" }).status, "HEALTHY");
const deniedObservation = service.inspectAuditSurfaces({ readCapabilityRef: refs.submitCapabilityRef, principalRef: refs.principalRef });
assert.equal(deniedObservation.status, "OBSERVATION_AUTHORITY_INVALID");
assert.equal(Object.keys(deniedObservation).some((key) => ["jobs", "attempts", "decisions", "dispositions", "subscriptions"].includes(key)), false);

const admission = service.submitAuditPackage(packageInput(refs));
assert.equal(admission.status, "BOUND");
assert.equal(admission.package.state, "BOUND");
assert.equal(admission.job.state, "ADMITTED");
assert.equal(admission.lineage.state, "BOUND");
assert.equal(service.submitAuditPackage(packageInput(refs)).status, "REPLAYED");
assert.equal(service.submitAuditPackage({ ...packageInput(refs), extraMeaning: "changed-bytes" }).status, "IDEMPOTENCY_CONFLICT");
assert.equal(Object.keys(service.state.jobs).length, 1);

const inspected = service.inspectAuditSurfaces({ readCapabilityRef: refs.readCapabilityRef, principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, jobRef: admission.job.jobRef });
assert.equal(inspected.status, "AUTHORIZED");
assert.equal(inspected.jobs.length, 1);
assert.equal(Object.values(inspected.jobs[0]).some((value) => typeof value === "string" && /prompt|credential|token/i.test(value)), false);

const started = service.startAuditAttempt({ packageRef: admission.package.packageRef, jobRef: admission.job.jobRef });
assert.equal(started.status, "STARTED");
const decision = service.recordAuditDecision({ attemptRef: started.attempt.attemptRef, decisionKind: "RECORDED", dss05DispositionDigest: admission.lineage.dss05DispositionDigest });
assert.equal(decision.status, "RECORDED");
assert.equal(service.sealAuditDisposition({ jobRef: admission.job.jobRef }).status, "SEALED");
assert.equal(service.sealAuditDisposition({ jobRef: admission.job.jobRef }).status, "REPLAYED");

const subscription = service.createDispositionSubscription({ jobRef: admission.job.jobRef, principalRef: refs.principalRef, readCapabilityRef: refs.readCapabilityRef, subscribeAckCapabilityRef: refs.subscribeAckCapabilityRef, deliveryAdapter: "electron" });
assert.equal(subscription.status, "ACTIVE");
const offered = service.offerDispositionDelivery({ subscriptionRef: subscription.subscription.subscriptionRef, readCapabilityRef: refs.readCapabilityRef });
assert.equal(offered.status, "OFFERED");
assert.equal(offered.cursor.offeredSequence, 1);
assert.equal(offered.cursor.acknowledgedSequence, 0);
assert.equal(service.expireDeliveryOffer({ offerRef: offered.offer.offerRef }).status, "EXPIRED_UNACKNOWLEDGED");
const replayedOffer = service.offerDispositionDelivery({ subscriptionRef: subscription.subscription.subscriptionRef, readCapabilityRef: refs.readCapabilityRef });
assert.equal(replayedOffer.status, "OFFERED");
assert.notEqual(replayedOffer.offer.offerRef, offered.offer.offerRef);
assert.equal(replayedOffer.cursor.acknowledgedSequence, 0);
assert.equal(service.acknowledgeDispositionDelivery({ offerRef: replayedOffer.offer.offerRef, subscribeAckCapabilityRef: refs.subscribeAckCapabilityRef, projectionDigest: replayedOffer.offer.projectionDigest, sequence: 2 }).status, "NONCONTIGUOUS");
assert.equal(service.acknowledgeDispositionDelivery({ offerRef: replayedOffer.offer.offerRef, subscribeAckCapabilityRef: refs.subscribeAckCapabilityRef, projectionDigest: "sha256:" + "f".repeat(64), sequence: 1 }).status, "DIGEST_MISMATCH");
assert.equal(service.state.cursors[subscription.cursor.cursorRef].acknowledgedSequence, 0);
const wakeBefore = service.state.cursors[subscription.cursor.cursorRef].acknowledgedSequence;
const wake = service.wakeAuditTask({ offerRef: replayedOffer.offer.offerRef, wakeupCapabilityRef: refs.wakeupCapabilityRef, continuationRef: refs.continuationRef });
assert.equal(wake.status, "DELIVERED");
assert.equal(service.state.cursors[subscription.cursor.cursorRef].acknowledgedSequence, wakeBefore);
assert.equal(service.wakeAuditTask({ offerRef: replayedOffer.offer.offerRef, wakeupCapabilityRef: refs.wakeupCapabilityRef, continuationRef: refs.continuationRef }).status, "REPLAYED");
const acknowledged = service.acknowledgeDispositionDelivery({ offerRef: replayedOffer.offer.offerRef, subscribeAckCapabilityRef: refs.subscribeAckCapabilityRef, projectionDigest: replayedOffer.offer.projectionDigest, sequence: 1 });
assert.equal(acknowledged.status, "ACKNOWLEDGED");
assert.equal(acknowledged.cursor.acknowledgedSequence, 1);
assert.equal(service.acknowledgeDispositionDelivery({ offerRef: replayedOffer.offer.offerRef, subscribeAckCapabilityRef: refs.subscribeAckCapabilityRef, projectionDigest: replayedOffer.offer.projectionDigest, sequence: 1 }).status, "EXACT_REPLAY");

const recovery = service.recoverDss06Lineage();
assert.equal(recovery.status, "READY");
assert.equal(service.recoverDss06Lineage().status, "REPLAYED");
const root = service.store.root;
const authoritySnapshot = { status: service._authorityStatus.status, verifierRef: service._authorityStatus.verifierRef, verifierRevision: service._authorityStatus.verifierRevision, sourceDigest: service._authorityStatus.sourceDigest };
service.close();
const restarted = dss.createDss06Service({ root, installationRoot: service.authorityInstallationRoot, authorityProfileRoot: service.authorityProfileRoot, authorityProfileRef: service.authorityProfileRef, now });
assert.equal(restarted._authorityStatus.status, "CURRENT");
assert.equal(restarted._authorityStatus.verifierRef, authoritySnapshot.verifierRef);
assert.equal(restarted._authorityStatus.verifierRevision, authoritySnapshot.verifierRevision);
assert.equal(restarted._authorityStatus.sourceDigest, authoritySnapshot.sourceDigest);
assert.equal(restarted.bindReadCapability({ capabilityRef: refs.readCapabilityRef }).status, "REPLAYED");
assert.equal(restarted.observeDaemonHealth({ readCapabilityRef: refs.readCapabilityRef, principalRef: refs.principalRef, projectRef: refs.projectRef, taskRef: refs.taskRef, state: "HEALTHY" }).status, "REPLAYED");
const restartedRecovery = restarted.recoverDss06Lineage();
assert.equal(restartedRecovery.status, "READY");
restarted.close();

const revokeCase = fresh(); bindAll(revokeCase.service, revokeCase.refs);
const revokeReceipt = adminReceipt(revokeCase, "REVOKE", revokeCase.refs.readCapabilityRef);
assert.equal(revokeCase.service.expireRevokeAuthority({ authorizationReceipt: revokeReceipt, capabilityRef: revokeCase.refs.readCapabilityRef, action: "REVOKE" }).status, "REVOKED");
const crossTargetCounts = revokeCase.service.status().counts;
assert.equal(revokeCase.service.expireRevokeAuthority({ authorizationReceipt: revokeReceipt, capabilityRef: revokeCase.refs.submitCapabilityRef, action: "REVOKE" }).status, "UNAUTHORIZED");
assert.deepEqual(revokeCase.service.status().counts, crossTargetCounts);
assert.equal(revokeCase.service.observeDaemonHealth({ readCapabilityRef: revokeCase.refs.readCapabilityRef, principalRef: revokeCase.refs.principalRef, projectRef: revokeCase.refs.projectRef, taskRef: revokeCase.refs.taskRef, state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
const revokeRoot = revokeCase.root;
const revokeInstallationRoot = revokeCase.installationRoot;
const revokeAuthorityProfileRoot = revokeCase.authorityProfileRoot;
const revokeAuthorityProfileRef = revokeCase.authorityProfileRef;
revokeCase.service.close();
const revokedRestart = dss.createDss06Service({ root: revokeRoot, installationRoot: revokeInstallationRoot, authorityProfileRoot: revokeAuthorityProfileRoot, authorityProfileRef: revokeAuthorityProfileRef, now });
assert.equal(revokedRestart._authorityStatus.status, "CURRENT");
assert.equal(revokedRestart.observeDaemonHealth({ readCapabilityRef: revokeCase.refs.readCapabilityRef, principalRef: revokeCase.refs.principalRef, projectRef: revokeCase.refs.projectRef, taskRef: revokeCase.refs.taskRef, state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
revokedRestart.close();

const expireCase = fresh(); bindAll(expireCase.service, expireCase.refs);
assert.equal(expireCase.service.expireRevokeAuthority({ authorizationReceipt: adminReceipt(expireCase, "EXPIRE", expireCase.refs.readCapabilityRef), capabilityRef: expireCase.refs.readCapabilityRef, action: "EXPIRE" }).status, "EXPIRED");
assert.equal(expireCase.service.observeDaemonHealth({ readCapabilityRef: expireCase.refs.readCapabilityRef, principalRef: expireCase.refs.principalRef, projectRef: expireCase.refs.projectRef, taskRef: expireCase.refs.taskRef, state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
expireCase.service.close();

const corruptAuthority = fresh();
const corruptRoot = corruptAuthority.root;
const corruptInstallationRoot = corruptAuthority.installationRoot;
const corruptAuthorityProfileRoot = corruptAuthority.authorityProfileRoot;
const corruptAuthorityProfileRef = corruptAuthority.authorityProfileRef;
const corruptCounts = corruptAuthority.service.status().counts;
corruptAuthority.service.close();
fs.writeFileSync(path.join(corruptInstallationRoot, "owner-bootstrap-root-pin.json"), "{}", { mode: 0o600 });
const corruptRestart = dss.createDss06Service({ root: corruptRoot, installationRoot: corruptInstallationRoot, authorityProfileRoot: corruptAuthorityProfileRoot, authorityProfileRef: corruptAuthorityProfileRef, now });
assert.equal(corruptRestart._authorityStatus.status, "BROKEN");
assert.equal(corruptRestart.observeDaemonHealth({ readCapabilityRef: corruptAuthority.refs.readCapabilityRef, principalRef: corruptAuthority.refs.principalRef, projectRef: corruptAuthority.refs.projectRef, taskRef: corruptAuthority.refs.taskRef, state: "HEALTHY" }).status, "OBSERVATION_AUTHORITY_INVALID");
assert.deepEqual(corruptRestart.status().counts, corruptCounts);
assert.equal(corruptRestart.recoverDss06Lineage().status, "BROKEN");
corruptRestart.close();

const missingAuthority = fresh();
const missingRoot = missingAuthority.root;
const missingInstallationRoot = missingAuthority.installationRoot;
const missingAuthorityProfileRoot = missingAuthority.authorityProfileRoot;
const missingAuthorityProfileRef = missingAuthority.authorityProfileRef;
missingAuthority.service.close();
fs.unlinkSync(path.join(missingInstallationRoot, "owner-bootstrap-root-pin.json"));
const missingRestart = dss.createDss06Service({ root: missingRoot, installationRoot: missingInstallationRoot, authorityProfileRoot: missingAuthorityProfileRoot, authorityProfileRef: missingAuthorityProfileRef, now });
assert.equal(missingRestart._authorityStatus.status, "BROKEN");
assert.equal(missingRestart.bootstrapOwnerIssuedRecords({ bootstrapToken: { owner: "caller" } }).status, "AUTHORITY_CUSTODY_BROKEN");
missingRestart.close();

const unknownCase = fresh(); bindAll(unknownCase.service, unknownCase.refs);
const unknownAdmission = unknownCase.service.submitAuditPackage(packageInput(unknownCase.refs, "unknown-idempotency"));
const unknownStart = unknownCase.service.startAuditAttempt({ packageRef: unknownAdmission.package.packageRef, jobRef: unknownAdmission.job.jobRef });
assert.equal(unknownCase.service.recordAuditDecision({ attemptRef: unknownStart.attempt.attemptRef, decisionKind: "UNKNOWN" }).status, "UNKNOWN");
assert.equal(unknownCase.service.sealAuditDisposition({ jobRef: unknownAdmission.job.jobRef }).status, "FAILED");
unknownCase.service.close();

const fault = fresh();
fault.service.store.failBeforeCommit = true;
assert.equal(fault.service.bindSubmitCapability({ capabilityRef: fault.refs.submitCapabilityRef }).status, "STALE_CURRENTNESS");
assert.equal(fault.service.state.capabilities[fault.refs.submitCapabilityRef].state, "ABSENT");
fault.service.close();

const transitionProbe = fresh();
const row = dss.DSS06_TRANSITION_MAP.get("start-audit-attempt:d.audit-attempt:ALLOCATE");
const lawful = transitionProbe.service._transition("start-audit-attempt", "d.audit-attempt", "ALLOCATE", { attemptRef: "lawful-transition" }, row.outcomeCases[0], row.fromStates[0], row.toState);
assert.equal(lawful.transitionId, row.transitionId);
assert.equal(lawful.owner, row.owner);
assert.equal(lawful.outputCarrierId, row.outputCarrierId);
assert.deepEqual(lawful.fromStates, row.fromStates);
assert.equal(lawful.toState, row.toState);
assert.throws(() => transitionProbe.service._transition("start-audit-attempt", "d.audit-attempt", "ALLOCATE", {}, "WRONG", row.fromStates[0], row.toState), (error) => error.code === "DSS06_TRANSITION_OUTCOME_INVALID");
assert.throws(() => transitionProbe.service._transition("start-audit-attempt", "d.audit-attempt", "ALLOCATE", {}, row.outcomeCases[0], row.fromStates[0], "WRONG"), (error) => error.code === "DSS06_TRANSITION_DESTINATION_INVALID");
transitionProbe.service._verifyStateEnvelope();
transitionProbe.service.close();

const envelopeMutation = fresh();
bindAll(envelopeMutation.service, envelopeMutation.refs);
const envelopeAdmission = envelopeMutation.service.submitAuditPackage(packageInput(envelopeMutation.refs, "envelope-mutation"));
assert.equal(envelopeAdmission.status, "BOUND");
const envelopeEvent = envelopeMutation.service.state.events.at(-1);
envelopeEvent.owner = "forged-owner";
assert.throws(() => envelopeMutation.service._verifyStateEnvelope(), (error) => error.code === "DSS06_EVENT_DIGEST_INVALID");
envelopeMutation.service.close();

const tamper = fresh(); bindAll(tamper.service, tamper.refs); const tamperAdmission = tamper.service.submitAuditPackage(packageInput(tamper.refs)); tamper.service.state.packages[tamperAdmission.package.packageRef].state = "REJECTED"; tamper.service._persist(); const tamperRoot = tamper.service.store.root; tamper.service.close(); const tamperedRestart = dss.createDss06Service({ root: tamperRoot, now }); const tamperedRecovery = tamperedRestart.recoverDss06Lineage(); assert.equal(tamperedRecovery.status, "BROKEN"); tamperedRestart.close();

const regressionSourceDigest = shaBytes(fs.readFileSync(new URL(import.meta.url)));
const mutationResults = {
  selfConstituted: "UNAUTHORIZED", foreignAndCrossFamily: "OBSERVATION_AUTHORITY_INVALID", changedPackageBytes: "IDEMPOTENCY_CONFLICT",
  noDisclosureObservation: "VERIFIED", offeredCursorWithoutAck: "VERIFIED", noncontiguousAck: "NONCONTIGUOUS", digestMismatchAck: "DIGEST_MISMATCH",
  wakeDoesNotAck: "VERIFIED", revokedCapability: "OBSERVATION_AUTHORITY_INVALID", expiredCapability: "OBSERVATION_AUTHORITY_INVALID", unknownAttempt: "FAILED", faultBeforeCommit: "STALE_CURRENTNESS", relabelledRecovery: "BROKEN",
  bootstrapBeforePrepared: "STALE_CURRENTNESS_NO_AUTHORITY", bootstrapAfterPrepared: "BLOCKED_THEN_BOOTSTRAPPED", bootstrapAfterAuthority: "RESTART_COMPLETED_NO_DUPLICATE", corruptPreparedPlan: "BROKEN",
};
const receiptBody = { moduleId: dss.DSS06_MODULE_ID, moduleDigest: dss.DSS06_MODULE_DIGEST, serviceGeneration: dss.DSS06_SERVICE_GENERATION, regressionSourceDigest, status: "PASS", expected: { carriers: 17, operations: 17, qualifiedTransitions: 66, mutations: mutationResults }, observed: { terminalDisposition: "SEALED", recovery: "READY", authorityEffect: "NONE", mutations: mutationResults } };
console.log(JSON.stringify({ status: "PASS", moduleId: dss.DSS06_MODULE_ID, implementationCommit: process.env.DSS06_IMPLEMENTATION_COMMIT || "WORKTREE", carriers: 17, operations: 17, qualifiedTransitions: 66, terminalDisposition: "SEALED", recovery: "READY", authorityEffect: "NONE", receiptDigest: sha(receiptBody), root }, null, 2));
