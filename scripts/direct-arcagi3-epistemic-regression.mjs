#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectEpistemicService } = require("../src/main/direct/epistemic/service");
const {
  DIRECT_EPISTEMIC_STORE_FILE,
  DirectEpistemicStore,
} = require("../src/main/direct/epistemic/store");
const {
  nativeChildTurnId,
  persistNativeChildProviderTurn,
} = require("../src/main/direct/epistemic/native-child-capture");
const {
  buildContextResult,
  buildERevision,
  buildEpistemicRecord,
  buildORevision,
  buildSemanticPort,
} = require("../src/main/direct/epistemic/kernel");
const {
  LUNA_RESIDUE_LIMITS,
  LUNA_TRANSCRIPTION_EFFORT,
  LUNA_TRANSCRIPTION_MODEL,
  buildBoundedLinguisticResidue,
  buildLunaTranscriptionRequest,
} = require("../src/main/direct/epistemic/thread-transcriber");
const {
  buildArcagi3RepositoryProjection,
  git,
  inspectArcagi3Repository,
  profile,
} = require("../src/main/direct/epistemic/repository-runtime");

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function fileDigest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function makeProfileRepository(rootDir) {
  for (const marker of profile.markers) {
    const target = path.join(rootDir, marker);
    if (path.extname(marker)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `profile marker ${marker}\n`);
    } else {
      fs.mkdirSync(target, { recursive: true });
    }
  }
  for (const source of profile.sources) {
    const target = path.join(rootDir, source.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${source.id}: canonical fixture evidence\n`);
  }
  run(rootDir, "git", ["init", "-q"]);
  run(rootDir, "git", ["config", "user.email", "epistemic@example.invalid"]);
  run(rootDir, "git", ["config", "user.name", "Epistemic Fixture"]);
  run(rootDir, "git", ["add", "."]);
  run(rootDir, "git", ["commit", "-qm", "fixture"]);
  return {
    ...profile,
    sources: profile.sources.map((source) => ({
      ...source,
      contentDigest: fileDigest(path.join(rootDir, source.path)),
    })),
  };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-epistemic-regression-"));
const repoRoot = path.join(tempRoot, "arcagi3");
const stateRoot = path.join(tempRoot, "state");
fs.mkdirSync(repoRoot, { recursive: true });
const fixtureProfile = makeProfileRepository(repoRoot);

const firstObservation = inspectArcagi3Repository(repoRoot, { profile: fixtureProfile });
const secondObservation = inspectArcagi3Repository(repoRoot, { profile: fixtureProfile });
assert.equal(firstObservation.worktreeDigest, secondObservation.worktreeDigest, "same O evidence must be idempotent");
assert.equal(firstObservation.observationComplete, true);
assert.equal(firstObservation.captureCoherent, true);
assert.equal(firstObservation.captureAttempts, 1);
assert.equal(firstObservation.omissions.length, 0);
assert.equal(firstObservation.sources.every((source) => source.validationPosture === "exact"), true);

const firstProjection = buildArcagi3RepositoryProjection({ projectId: "project_arcagi3", observation: firstObservation });
const secondProjection = buildArcagi3RepositoryProjection({ projectId: "project_arcagi3", observation: secondObservation });
assert.equal(firstProjection.oRevision.oRevisionId, secondProjection.oRevision.oRevisionId);
assert.equal(firstProjection.eRevision.eRevisionId, secondProjection.eRevision.eRevisionId);
assert.equal(firstProjection.eRevision.standing, "admitted");
assert.equal(firstProjection.records.every((record) => record.standing === "admitted"), true);
assert.equal(firstProjection.records.every((record) => record.validation?.posture === "exact_pinned_sources"), true);

const revisedProfile = { ...fixtureProfile, revision: fixtureProfile.revision + 1 };
const revisedProfileObservation = inspectArcagi3Repository(repoRoot, { profile: revisedProfile });
const revisedProfileProjection = buildArcagi3RepositoryProjection({
  projectId: "project_arcagi3",
  observation: revisedProfileObservation,
});
assert.equal(
  revisedProfileProjection.oRevision.oRevisionId,
  firstProjection.oRevision.oRevisionId,
  "changing only the epistemic profile must not fabricate a new repository O",
);
assert.notEqual(
  revisedProfileProjection.eRevision.eRevisionId,
  firstProjection.eRevision.eRevisionId,
  "a profile revision belongs to E identity",
);

const pinnedSource = fixtureProfile.sources.find((source) => source.id === "aro_contracts");
const pinnedSourcePath = path.join(repoRoot, pinnedSource.path);
const pinnedSourceContent = fs.readFileSync(pinnedSourcePath);
fs.appendFileSync(pinnedSourcePath, "pin mismatch\n");
const pinMismatchObservation = inspectArcagi3Repository(repoRoot, { profile: fixtureProfile });
const pinMismatchProjection = buildArcagi3RepositoryProjection({
  projectId: "project_arcagi3",
  observation: pinMismatchObservation,
});
assert.equal(pinMismatchObservation.observationComplete, false);
assert.ok(pinMismatchObservation.validationOmissions.includes("profile_source_digest_mismatch:aro_contracts"));
assert.equal(pinMismatchProjection.eRevision.standing, "candidate");
assert.equal(pinMismatchProjection.records.some((record) => record.standing === "admitted"), false);
assert.equal(
  pinMismatchProjection.records.some((record) => record.evidenceRefs.some((ref) => ref.id === "aro_contracts")),
  false,
  "a digest-mismatched source must not support a typed record",
);
fs.writeFileSync(pinnedSourcePath, pinnedSourceContent);

const missingSource = fixtureProfile.sources.find((source) => source.id === "recursive_audit");
const missingSourcePath = path.join(repoRoot, missingSource.path);
const missingSourceContent = fs.readFileSync(missingSourcePath);
fs.rmSync(missingSourcePath);
const missingSourceObservation = inspectArcagi3Repository(repoRoot, { profile: fixtureProfile });
const missingSourceProjection = buildArcagi3RepositoryProjection({
  projectId: "project_arcagi3",
  observation: missingSourceObservation,
});
assert.equal(missingSourceObservation.observationComplete, false);
assert.ok(missingSourceObservation.validationOmissions.includes("profile_source_rejected:recursive_audit:path_missing"));
assert.equal(
  missingSourceProjection.records.some((record) => record.semanticKey === "arcagi3.earliest_invalid_odeu_boundary"),
  false,
  "all declared sources are required before a record can be materialized",
);
assert.ok(missingSourceProjection.eRevision.coverage.validationOmissions.some((value) =>
  value.startsWith("record_sources_unavailable:arcagi3.earliest_invalid_odeu_boundary:")));
fs.writeFileSync(missingSourcePath, missingSourceContent);

const externalWitness = path.join(tempRoot, "external-witness.txt");
const unsafeLink = path.join(repoRoot, "unsafe-untracked-link.txt");
fs.writeFileSync(externalWitness, "outside repository evidence\n");
fs.symlinkSync(externalWitness, unsafeLink);
const symlinkObservation = inspectArcagi3Repository(repoRoot, { profile: fixtureProfile });
assert.equal(symlinkObservation.observationComplete, false);
assert.ok(symlinkObservation.validationOmissions.some((value) =>
  value.startsWith("untracked_path_rejected:") && value.endsWith(":symlink_rejected")));
fs.rmSync(unsafeLink);

const raceWitnessPath = path.join(repoRoot, "observation-race-witness.txt");
fs.writeFileSync(raceWitnessPath, "race generation 0\n");
const retriedObservation = inspectArcagi3Repository(repoRoot, {
  profile: fixtureProfile,
  maxObservationAttempts: 2,
  afterEvidenceCapture: ({ attempt }) => {
    if (attempt === 1) fs.writeFileSync(raceWitnessPath, "race generation 1\n");
  },
});
assert.equal(retriedObservation.observationComplete, true);
assert.equal(retriedObservation.captureCoherent, true);
assert.equal(retriedObservation.captureAttempts, 2);

const incompleteObservation = inspectArcagi3Repository(repoRoot, {
  profile: fixtureProfile,
  maxObservationAttempts: 2,
  afterEvidenceCapture: ({ attempt }) => {
    fs.writeFileSync(raceWitnessPath, `perpetual race generation ${attempt}\n`);
  },
});
assert.equal(incompleteObservation.observationComplete, false);
assert.equal(incompleteObservation.captureCoherent, false);
assert.ok(incompleteObservation.validationOmissions.includes("repository_changed_during_observation"));
fs.rmSync(raceWitnessPath);

assert.throws(
  () => git(repoRoot, ["not-a-direct-epistemic-git-command"]),
  (error) => error?.message === "direct_epistemic_git_failed:not-a-direct-epistemic-git-command" &&
    !error.message.includes(repoRoot),
  "Git failures exposed to callers must contain only renderer-safe codes",
);
const alternatePostureORevision = buildORevision({
  subject: firstProjection.subject,
  substrateKind: firstProjection.oRevision.substrateKind,
  substrateIdentity: firstProjection.oRevision.substrateIdentity,
  posture: "candidate_observation",
  observedAt: firstProjection.oRevision.observedAt,
});
assert.notEqual(
  firstProjection.oRevision.oRevisionId,
  alternatePostureORevision.oRevisionId,
  "O posture must participate in identity",
);
const alternateObservationTimeORevision = buildORevision({
  subject: firstProjection.subject,
  substrateKind: firstProjection.oRevision.substrateKind,
  substrateIdentity: firstProjection.oRevision.substrateIdentity,
  posture: firstProjection.oRevision.posture,
  observedAt: "2099-01-01T00:00:00.000Z",
});
assert.equal(
  firstProjection.oRevision.oRevisionId,
  alternateObservationTimeORevision.oRevisionId,
  "O observation time must not participate in identity",
);

const candidateRevision = buildERevision({
  subject: firstProjection.subject,
  oRevision: firstProjection.oRevision,
  revisionClass: "integrity_fixture",
  basis: { source: "fixture" },
  standing: "candidate",
  coverage: { posture: "partial" },
});
const admittedRevision = buildERevision({
  subject: firstProjection.subject,
  oRevision: firstProjection.oRevision,
  revisionClass: "integrity_fixture",
  basis: { source: "fixture" },
  standing: "admitted",
  coverage: { posture: "partial" },
});
const widerCoverageRevision = buildERevision({
  subject: firstProjection.subject,
  oRevision: firstProjection.oRevision,
  revisionClass: "integrity_fixture",
  basis: { source: "fixture" },
  standing: "candidate",
  coverage: { posture: "complete" },
});
assert.notEqual(candidateRevision.eRevisionId, admittedRevision.eRevisionId, "E standing must participate in identity");
assert.notEqual(candidateRevision.eRevisionId, widerCoverageRevision.eRevisionId, "E coverage must participate in identity");

const nonPromotedRecord = buildEpistemicRecord({
  subject: firstProjection.subject,
  oRevision: firstProjection.oRevision,
  eRevision: candidateRevision,
  recordType: "IntegrityFixture",
  semanticKey: "integrity.fixture",
  standing: "candidate",
  epistemicPromotion: false,
});
const promotedRecord = buildEpistemicRecord({
  subject: firstProjection.subject,
  oRevision: firstProjection.oRevision,
  eRevision: candidateRevision,
  recordType: "IntegrityFixture",
  semanticKey: "integrity.fixture",
  standing: "candidate",
  epistemicPromotion: true,
});
assert.notEqual(nonPromotedRecord.recordId, promotedRecord.recordId, "promotion posture must participate in record identity");

const basePortInput = {
  subject: firstProjection.subject,
  name: "repo.integrity_fixture",
  facets: ["architecture"],
  standings: ["candidate"],
  purpose: "inspect integrity",
  traversal: ["architecture"],
  omissionPolicy: "omit_unselected_facets",
};
const integrityPort = buildSemanticPort(basePortInput);
assert.notEqual(
  integrityPort.portId,
  buildSemanticPort({ ...basePortInput, purpose: "mutate architecture" }).portId,
  "port purpose must participate in identity",
);
assert.notEqual(
  integrityPort.portId,
  buildSemanticPort({ ...basePortInput, traversal: ["architecture", "validation"] }).portId,
  "port traversal must participate in identity",
);
assert.notEqual(
  integrityPort.portId,
  buildSemanticPort({ ...basePortInput, omissionPolicy: "report_all_omissions" }).portId,
  "port omission policy must participate in identity",
);

const contextFixture = {
  subjectRef: firstProjection.subject.ref,
  oRevisionRef: firstProjection.oRevision.ref,
  eRevisionRef: candidateRevision.ref,
  portRef: integrityPort.ref,
  purpose: "inspect integrity",
  facets: ["architecture"],
  records: [nonPromotedRecord],
  omissions: [],
  freshness: "exact",
  requestConstraints: { detailDepth: "summary", sinceRevision: "" },
};
const exactContext = buildContextResult(contextFixture);
assert.equal(Object.isFrozen(candidateRevision.coverage), true, "E coverage must be deeply immutable");
assert.equal(Object.isFrozen(nonPromotedRecord.payload), true, "record payload must be deeply immutable");
assert.equal(Object.isFrozen(nonPromotedRecord.attribution), true, "record attribution must be deeply immutable");
assert.equal(Object.isFrozen(integrityPort.selector), true, "port selectors must be deeply immutable");
assert.equal(Object.isFrozen(exactContext.records[0].payload), true, "context record bodies must be deeply immutable");
assert.notEqual(exactContext.records[0], nonPromotedRecord, "context construction must copy caller-owned record bodies");
assert.notEqual(
  exactContext.importId,
  buildContextResult({ ...contextFixture, omissions: ["validation_unavailable"] }).importId,
  "context omissions must participate in identity",
);
assert.notEqual(
  exactContext.importId,
  buildContextResult({ ...contextFixture, freshness: "stale" }).importId,
  "context freshness must participate in identity",
);
assert.notEqual(
  exactContext.importId,
  buildContextResult({ ...contextFixture, requestConstraints: { detailDepth: "full", sinceRevision: "" } }).importId,
  "context request constraints must participate in identity",
);
for (const [field, value] of [
  ["purposeId", "repo.integrity_fixture"],
  ["requestIntent", "audit the fixture"],
  ["detailDepth", "full"],
  ["sinceRevision", "ep_e_previous"],
  ["rawEvidencePolicy", "none"],
  ["tokenBudget", 2048],
]) {
  assert.notEqual(
    exactContext.importId,
    buildContextResult({ ...contextFixture, [field]: value }).importId,
    `context ${field} must participate in identity`,
  );
}

const sessionStore = new DirectSessionStore({ rootDir: path.join(stateRoot, "sessions") });
sessionStore.ensure();
const session = sessionStore.createSession({
  sessionId: "direct_session_arcagi3",
  projectId: "project_arcagi3",
  title: "ArcAGI3 diagnostic",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  agentId: "arc_worker_1",
  agentRole: "diagnostic_worker",
});
const turn = sessionStore.createTurn(session.sessionId, {
  turnId: "direct_turn_arcagi3",
  state: "streaming",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
});
sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
  { type: "session_started", sequence: 0, responseId: "response_fixture", model: "gpt-5.6-sol" },
  { type: "tool_call_started", sequence: 1, itemId: "tool_1", callId: "call_1", name: "run_command", namespace: "functions", toolType: "function_call" },
  { type: "tool_call_completed", sequence: 2, itemId: "tool_1", callId: "call_1", name: "run_command", namespace: "functions", toolType: "function_call", argumentsJson: "{\"command\":\"make test-focus\"}" },
  { type: "message_delta", sequence: 3, itemId: "message_1", text: "I interpreted the focused test output as evidence that the earliest invalid boundary is structural." },
  { type: "usage_delta", sequence: 4, usage: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 12, reasoningTokens: 3, totalTokens: 32 } },
  { type: "response_completed", sequence: 5, responseId: "response_fixture", stopReason: "completed" },
]);
const persistedFixtureEvents = sessionStore.readNormalizedEvents(session.sessionId, turn.turnId);
assert.equal(persistedFixtureEvents.every((event) => /^[a-f0-9]{64}$/.test(event.sourceEnvelopeDigest)), true);
assert.equal(persistedFixtureEvents.every((event) => Boolean(event.persistedAt)), true);

const invalidEnvelopeSession = sessionStore.createSession({
  sessionId: "direct_session_invalid_envelope",
  projectId: "project_invalid_envelope",
  title: "Invalid envelope fixture",
});
const invalidEnvelopeTurn = sessionStore.createTurn(invalidEnvelopeSession.sessionId, {
  turnId: "direct_turn_invalid_envelope",
});
fs.mkdirSync(
  path.dirname(sessionStore.eventPath(invalidEnvelopeSession.sessionId, invalidEnvelopeTurn.turnId)),
  { recursive: true },
);
fs.appendFileSync(
  sessionStore.eventPath(invalidEnvelopeSession.sessionId, invalidEnvelopeTurn.turnId),
  `${JSON.stringify({ at: new Date().toISOString(), sourceEnvelopeDigest: "missing-event" })}\n`,
);
assert.throws(
  () => sessionStore.readNormalizedEvents(invalidEnvelopeSession.sessionId, invalidEnvelopeTurn.turnId),
  (error) => error?.code === "direct_normalized_event_envelope_invalid",
  "syntactically valid JSONL without an event object must be rejected",
);

const latestTurn = sessionStore.createTurn(session.sessionId, {
  turnId: "direct_turn_arcagi3_latest",
  state: "completed",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
});
sessionStore.appendNormalizedEvents(session.sessionId, latestTurn.turnId, [
  { type: "message_delta", sequence: 0, itemId: "latest_message", text: "This later turn establishes the selected-turn coverage boundary." },
  { type: "response_completed", sequence: 1, responseId: "response_latest", stopReason: "completed" },
]);

const boundedResidueInput = {
  session,
  turn,
  events: [
    { type: "message_delta", sequence: 0, persistedIndex: 0, itemId: "spacing", text: "left " },
    { type: "message_delta", sequence: 1, persistedIndex: 1, itemId: "spacing", text: " right" },
    {
      type: "message_delta",
      sequence: 2,
      persistedIndex: 2,
      itemId: "long_item",
      text: "x".repeat(LUNA_RESIDUE_LIMITS.maxCharsPerItem + 5),
    },
    ...Array.from({ length: LUNA_RESIDUE_LIMITS.maxItems }, (_, index) => ({
      type: "message_delta",
      sequence: index + 3,
      persistedIndex: index + 3,
      itemId: `bounded_item_${index}`,
      text: `item-${index}`,
    })),
  ],
};
const boundedResidue = buildBoundedLinguisticResidue(boundedResidueInput);
assert.equal(boundedResidue.residue[0].text, "left  right", "message-delta whitespace must remain source-faithful");
assert.equal(boundedResidue.residue.length, LUNA_RESIDUE_LIMITS.maxItems);
assert.equal(boundedResidue.residue[1].text.length, LUNA_RESIDUE_LIMITS.maxCharsPerItem);
assert.equal(boundedResidue.residue[0].attribution.actorId, "arc_worker_1");
assert.equal(boundedResidue.residue[0].attribution.primaryThreadId, session.sessionId);
assert.ok(boundedResidue.omissions.some((entry) => entry.code === "residue_item_character_limit_reached"));
assert.ok(boundedResidue.omissions.some((entry) => entry.code === "residue_item_limit_reached"));
assert.deepEqual(
  boundedResidue,
  buildBoundedLinguisticResidue(boundedResidueInput),
  "bounded residue and omission witnesses must be deterministic",
);
const pinnedLunaRequest = buildLunaTranscriptionRequest({
  ...boundedResidueInput,
  model: "gpt-5.6-sol",
  reasoningEffort: "max",
});
assert.equal(pinnedLunaRequest.model, LUNA_TRANSCRIPTION_MODEL, "Luna model selection must remain fixed");
assert.equal(pinnedLunaRequest.reasoningEffort, LUNA_TRANSCRIPTION_EFFORT, "Luna effort must remain fixed");
assert.deepEqual(pinnedLunaRequest.omissions, boundedResidue.omissions);

const epistemicStore = new DirectEpistemicStore({ rootDir: stateRoot });
let induceStaleTranscription = false;
let transcriberInvocationCount = 0;
const service = new DirectEpistemicService({
  store: epistemicStore,
  sessionStore,
  repositoryInspector: (rootDir) => inspectArcagi3Repository(rootDir, { profile: fixtureProfile }),
  transcriber: async (request) => {
    transcriberInvocationCount += 1;
    if (induceStaleTranscription) {
      sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [{
        type: "message_delta",
        sequence: 0,
        itemId: "message_after_transcription_started",
        text: "This event makes the in-flight transcription source stale.",
      }]);
      await Promise.resolve();
    }
    return { descriptions: [{
      kind: "AgentInterpretation",
      statement: "The worker interpreted focused-test output as evidence of a structural earliest-invalid boundary.",
      evidence_refs: [request.residue[0].evidence_ref],
    }] };
  },
});

service.initializeRepository({
  id: "project_arcagi3",
  workspace: { kind: "wsl", linuxPath: repoRoot },
});
const deterministicThread = service.syncThread(session.sessionId);
assert.ok(deterministicThread.recordCounts.ToolInvocation >= 1);
assert.equal(deterministicThread.recordCounts.AgentInterpretation, undefined);
const deterministicRecords = epistemicStore.recordsForRevision(deterministicThread.eRevision.eRevisionId);
const deterministicUtterance = deterministicRecords.find((record) =>
  record.recordType === "AgentUtteranceFragment" && record.sourceRefs[0]?.id.includes(`:${turn.turnId}:`));
const usageObservation = deterministicRecords.find((record) => record.recordType === "UsageObservation");
assert.equal(deterministicUtterance.attribution.actorId, "arc_worker_1");
assert.equal(deterministicUtterance.occurrenceSource.producer, "direct_provider_transport");
assert.equal(
  deterministicUtterance.sourceRefs[0].digest,
  persistedFixtureEvents.find((event) => event.type === "message_delta").sourceEnvelopeDigest,
  "typed event refs must carry the verified persisted source-envelope digest",
);
assert.equal(usageObservation.attribution.actorId, "arc_worker_1");
assert.equal(usageObservation.occurrenceSource.eventType, "usage_delta");

const architectureImport = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "repository",
  portName: "repo.architecture_mutation",
  purpose: "prepare architecture edit",
});
const architectureImportAlternatePurpose = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "repository",
  portName: "repo.architecture_mutation",
  purpose: "audit architecture edit",
});
assert.notEqual(
  architectureImport.importId,
  architectureImportAlternatePurpose.importId,
  "purpose must participate in context-import identity",
);
assert.ok(architectureImport.records.some((record) => record.recordType === "ArchitectureInvariant"));
assert.deepEqual(
  service.importContext({
    projectId: "project_arcagi3",
    subjectKind: "repository",
    portName: "repo.architecture_mutation",
    purpose: "prepare architecture edit",
  }),
  architectureImport,
  "idempotent context materialization must return the persisted immutable receipt",
);

const atomicHeadBefore = epistemicStore.readHead(firstProjection.subject.subjectId);
const abortedRevision = buildERevision({
  subject: atomicHeadBefore.subject,
  oRevision: atomicHeadBefore.oRevision,
  parentERevisionId: atomicHeadBefore.eRevision.eRevisionId,
  revisionClass: "atomicity_failure_fixture",
  basis: { fixture: "invalid_record_after_revision" },
  standing: "candidate",
  coverage: { posture: "test_only" },
});
assert.throws(() => epistemicStore.admitProjection({
  subject: atomicHeadBefore.subject,
  oRevision: atomicHeadBefore.oRevision,
  eRevision: abortedRevision,
  records: [{ schema: "invalid_record" }],
  ports: [],
  expectedHead: {
    oRevisionId: atomicHeadBefore.oRevision.oRevisionId,
    eRevisionId: atomicHeadBefore.eRevision.eRevisionId,
  },
}), /direct_epistemic_record_invalid/);
const atomicHeadAfter = epistemicStore.readHead(firstProjection.subject.subjectId);
assert.equal(atomicHeadAfter.eRevision.eRevisionId, atomicHeadBefore.eRevision.eRevisionId);
assert.equal(epistemicStore.readERevision(abortedRevision.eRevisionId), null, "failed admission must roll back its E row");

const alternateORevision = buildORevision({
  subject: atomicHeadBefore.subject,
  substrateKind: atomicHeadBefore.oRevision.substrateKind,
  substrateIdentity: { ...atomicHeadBefore.oRevision.substrateIdentity, lineageFixture: "alternate_o" },
  posture: atomicHeadBefore.oRevision.posture,
});
epistemicStore.putORevision(alternateORevision);
const crossORevision = buildERevision({
  subject: atomicHeadBefore.subject,
  oRevision: alternateORevision,
  parentERevisionId: atomicHeadBefore.eRevision.eRevisionId,
  revisionClass: "cross_o_lineage_fixture",
  basis: { fixture: "cross_o_parent" },
  standing: "candidate",
  coverage: { posture: "test_only" },
});
assert.throws(
  () => epistemicStore.putERevision(crossORevision),
  (error) => error?.code === "direct_epistemic_e_revision_parent_invalid",
  "an E parent must belong to the same subject and O revision",
);
assert.throws(
  () => epistemicStore.setHead(
    atomicHeadBefore.subject.subjectId,
    alternateORevision.oRevisionId,
    atomicHeadBefore.eRevision.eRevisionId,
  ),
  (error) => error?.code === "direct_epistemic_head_lineage_invalid",
  "a head may not pair an O revision with an E revision from another O",
);

const tamperedRecord = JSON.parse(JSON.stringify(firstProjection.records[0]));
tamperedRecord.payload.writeBoundaryTamper = true;
assert.throws(
  () => epistemicStore.appendRecords([tamperedRecord]),
  (error) => error?.code === "direct_epistemic_record_canonical_invalid",
  "write boundaries must rebuild and reject bodies that do not match their identity",
);

const executionImport = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "thread",
  sessionId: session.sessionId,
  portName: "thread.execution_outcomes",
  purpose: "inspect terminal status",
});
assert.equal(
  executionImport.records.some((record) => record.recordType === "ToolInvocation"),
  false,
  "tool activity must be omitted from non-tool ports",
);
const toolImport = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "thread",
  sessionId: session.sessionId,
  portName: "thread.tool_activity",
  purpose: "inspect tool activity",
});
assert.ok(toolImport.records.some((record) => record.recordType === "ToolInvocation"));

const oBeforeLuna = deterministicThread.oRevision.oRevisionId;
const eBeforeLuna = deterministicThread.eRevision.eRevisionId;
const transcribedThread = await service.transcribeThread({ sessionId: session.sessionId, turnId: turn.turnId });
assert.equal(transcribedThread.oRevision.oRevisionId, oBeforeLuna, "E may revise without changing O");
assert.notEqual(transcribedThread.eRevision.eRevisionId, eBeforeLuna);
assert.equal(transcribedThread.eRevision.coverage.posture, "selected_turn_linguistic_residue");
assert.equal(transcribedThread.eRevision.coverage.selectedTurnId, turn.turnId);
assert.equal(transcribedThread.eRevision.coverage.selectedTurnWasLatest, false);
assert.equal(transcribedThread.eRevision.coverage.selectedTurnSourceDigest.length, 64);
const idempotentTranscription = await service.transcribeThread({ sessionId: session.sessionId, turnId: turn.turnId });
assert.equal(idempotentTranscription.eRevision.eRevisionId, transcribedThread.eRevision.eRevisionId);
assert.equal(transcriberInvocationCount, 1, "a completed current Luna job must not be invoked or admitted twice");
const interpretationImport = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "thread",
  sessionId: session.sessionId,
  portName: "thread.agent_interpretations",
  purpose: "inspect attributed worker interpretations",
});
assert.equal(interpretationImport.records.length, 1);
assert.equal(interpretationImport.records[0].standing, "attributed");
assert.equal(interpretationImport.records[0].epistemicPromotion, false);
assert.equal(interpretationImport.records[0].attribution.actorId, "arc_worker_1");
assert.equal(interpretationImport.records[0].occurrenceSource.producer, LUNA_TRANSCRIPTION_MODEL);
const interpretationDelta = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "thread",
  sessionId: session.sessionId,
  portName: "thread.agent_interpretations",
  purpose: "inspect newly attributed interpretations",
  sinceRevision: eBeforeLuna,
});
assert.equal(interpretationDelta.records.length, 1, "since_revision must select semantic deltas on the active E lineage");
const emptyInterpretationDelta = service.importContext({
  projectId: "project_arcagi3",
  subjectKind: "thread",
  sessionId: session.sessionId,
  portName: "thread.agent_interpretations",
  purpose: "confirm no later attributed interpretations",
  sinceRevision: transcribedThread.eRevision.eRevisionId,
});
assert.equal(emptyInterpretationDelta.records.length, 0);
assert.ok(emptyInterpretationDelta.omissions.includes("no_selected_changes_since_revision"));

sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [{
  type: "message_delta",
  sequence: 6,
  itemId: "message_before_stale_transcription",
  text: "This creates a new transcription job before exercising the in-flight stale-source guard.",
}]);
induceStaleTranscription = true;
await assert.rejects(
  service.transcribeThread({ sessionId: session.sessionId, turnId: turn.turnId }),
  (error) => error?.code === "direct_epistemic_transcription_source_stale",
  "a Luna result must not move the head back after its source O/E changes",
);
induceStaleTranscription = false;

const childCaptureInput = {
  projectId: "project_arcagi3",
  workThreadId: "arcagi3_parallel_workspace",
  primaryThreadId: session.sessionId,
  agent: {
    agentThreadId: "arcagi3_native_child_1",
    displayLabel: "Native child boundary auditor",
    role: "boundary_auditor",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  },
  requestBody: { model: "gpt-5.6-sol", reasoning: { effort: "high" } },
  promptDigest: "sha256:child_prompt_only",
  contextDigest: "sha256:child_context_only",
  contextMessageCount: 2,
};
const childCaptureResult = {
  terminal: { state: "completed" },
  responseId: "arcagi3_child_response_1",
  normalizedEvents: [
    { type: "session_started", sequence: 0, responseId: "arcagi3_child_response_1", model: "gpt-5.6-sol" },
    { type: "message_delta", sequence: 1, itemId: "child_message", text: "The child attributed the failure to the structural boundary." },
    { type: "response_completed", sequence: 2, responseId: "arcagi3_child_response_1", stopReason: "completed" },
  ],
};
const childCapture = persistNativeChildProviderTurn(sessionStore, childCaptureInput, childCaptureResult);
assert.equal(childCapture.rawPromptPersisted, false);
assert.equal(childCapture.state, "completed");
assert.equal(
  persistNativeChildProviderTurn(sessionStore, childCaptureInput, childCaptureResult).duplicate,
  true,
  "native child provider capture must be idempotent",
);
sessionStore.updateTurnState(childCapture.sessionId, childCapture.turnId, "failed", {
  responseStatus: 503,
  responseContentType: "text/plain",
  error: { code: "restart_fixture", messageDigest: "stale", rawMessagePersisted: false },
});
const repairedChildCapture = persistNativeChildProviderTurn(sessionStore, childCaptureInput, childCaptureResult);
const repairedChildTurn = sessionStore.readTurn(childCapture.sessionId, childCapture.turnId);
assert.equal(repairedChildCapture.repaired, true, "full-event replay must repair stale terminal state after restart");
assert.equal(repairedChildTurn.state, "completed");
assert.equal(repairedChildTurn.responseStatus, 0);
assert.equal(repairedChildTurn.error, null);
assert.equal(repairedChildTurn.failedAt, "");
assert.equal(repairedChildTurn.captureRecovered, true);
assert.throws(
  () => persistNativeChildProviderTurn(sessionStore, childCaptureInput, {
    ...childCaptureResult,
    normalizedEvents: [...childCaptureResult.normalizedEvents, {
      type: "message_delta",
      sequence: 3,
      itemId: "conflicting_child_message",
      text: "Conflicting replay content.",
    }],
  }),
  (error) => error?.code === "direct_epistemic_native_child_duplicate_conflict",
  "a replay with divergent capture content must not be treated as an idempotent duplicate",
);
assert.throws(
  () => persistNativeChildProviderTurn(sessionStore, childCaptureInput, {
    ...childCaptureResult,
    http: { status: 204, contentType: "application/json" },
  }),
  (error) => error?.code === "direct_epistemic_native_child_duplicate_conflict",
  "terminal HTTP/error evidence must participate in native capture identity",
);
assert.notEqual(
  nativeChildTurnId({ ...childCaptureInput, attemptId: "attempt-a" }, { normalizedEvents: [], terminal: { state: "failed" } }),
  nativeChildTurnId({ ...childCaptureInput, attemptId: "attempt-b" }, { normalizedEvents: [], terminal: { state: "failed" } }),
  "pre-response retries require distinct attempt identities",
);
const childProjection = service.syncThread(childCapture.sessionId);
assert.equal(childProjection.subject.label, "Native child boundary auditor");
assert.equal(childProjection.recordCounts.TurnOutcome, 1);
const childRecords = epistemicStore.recordsForRevision(childProjection.eRevision.eRevisionId);
const childUtterance = childRecords.find((record) => record.recordType === "AgentUtteranceFragment");
assert.equal(childUtterance.attribution.actorId, "arcagi3_native_child_1");
assert.equal(childUtterance.attribution.actorKind, "native_sub_agent");
assert.equal(childUtterance.attribution.parentThreadId, session.sessionId);

const snapshot = service.snapshot({
  id: "project_arcagi3",
  workspace: { kind: "wsl", linuxPath: repoRoot },
});
const serializedSnapshot = JSON.stringify(snapshot);
assert.equal(serializedSnapshot.includes(repoRoot), false, "renderer projection must omit private workspace roots");
assert.equal(serializedSnapshot.includes("make test-focus"), false, "renderer projection must omit raw tool arguments");
assert.equal(snapshot.repository.subject.kind, "repository");
assert.equal(snapshot.thread.subject.kind, "thread");
assert.ok(snapshot.threads.some((entry) => entry.subject.label === "Native child boundary auditor"));

fs.writeFileSync(path.join(repoRoot, "untracked-o-revision-witness.txt"), "new O evidence\n");
const changedObservation = inspectArcagi3Repository(repoRoot, { profile: fixtureProfile });
assert.notEqual(changedObservation.worktreeDigest, firstObservation.worktreeDigest);
const changedProjection = buildArcagi3RepositoryProjection({ projectId: "project_arcagi3", observation: changedObservation });
assert.notEqual(changedProjection.oRevision.oRevisionId, firstProjection.oRevision.oRevisionId);

let observedAbortSignal;
const abortDuringTranscriptionService = new DirectEpistemicService({
  store: epistemicStore,
  sessionStore,
  transcriber: (_request, { signal }) => new Promise((_resolve, reject) => {
    observedAbortSignal = signal;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }),
});
const callerAbortController = new AbortController();
const abortedTranscription = abortDuringTranscriptionService.transcribeThread({
  sessionId: session.sessionId,
  turnId: turn.turnId,
  signal: callerAbortController.signal,
});
await Promise.resolve();
assert.notEqual(observedAbortSignal, callerAbortController.signal, "the service must own the provider-facing signal");
callerAbortController.abort();
await assert.rejects(
  abortedTranscription,
  (error) => error?.code === "direct_epistemic_transcription_aborted",
  "caller AbortSignal cancellation must reach the transcriber and persist as an explicit failure",
);
assert.equal(
  epistemicStore.latestTranscriptionJob(deterministicThread.subject.subjectId).errorCode,
  "direct_epistemic_transcription_aborted",
);
abortDuringTranscriptionService.close();

let observedCloseSignal;
const closeDuringTranscriptionService = new DirectEpistemicService({
  store: epistemicStore,
  sessionStore,
  transcriber: (_request, { signal }) => new Promise((_resolve, reject) => {
    observedCloseSignal = signal;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }),
});
const closingTranscription = closeDuringTranscriptionService.transcribeThread({
  sessionId: session.sessionId,
  turnId: turn.turnId,
});
await Promise.resolve();
assert.equal(observedCloseSignal?.aborted, false);
closeDuringTranscriptionService.close();
assert.equal(observedCloseSignal.aborted, true, "service close must abort provider work");
await assert.rejects(
  closingTranscription,
  (error) => error?.code === "direct_epistemic_transcription_service_closed",
  "closing the service during provider work must prevent post-close SQLite admission",
);
assert.equal(
  epistemicStore.latestTranscriptionJob(deterministicThread.subject.subjectId).errorCode,
  "direct_epistemic_transcription_service_closed",
  "service close must persist a terminal receipt before an owned store can close",
);

service.close();
epistemicStore.close();
const reopenedStore = new DirectEpistemicStore({ rootDir: stateRoot });
const reopenedRepository = reopenedStore.findSubject("repository", "project_arcagi3");
assert.ok(reopenedRepository, "repository subject must survive restart");
assert.ok(reopenedStore.subjectSummary(reopenedRepository.subjectId).recordCount >= 12);
const reopenedThreadSubject = reopenedStore.findSubject("thread", session.sessionId);
assert.equal(
  reopenedStore.latestTranscriptionJob(reopenedThreadSubject.subjectId).errorCode,
  "direct_epistemic_transcription_service_closed",
  "restart must retain the close-time terminal failure receipt",
);
const restartedService = new DirectEpistemicService({
  store: reopenedStore,
  sessionStore,
  transcriber: async () => ({ descriptions: [] }),
});
assert.throws(
  () => restartedService.importContext({
    projectId: "project_arcagi3",
    subjectKind: "repository",
    portName: "repo.architecture_mutation",
  }),
  (error) => error?.code === "direct_epistemic_repository_refresh_required",
  "a persisted repository head without a current process observation must not be labeled exact",
);
restartedService.close();
reopenedStore.close();

const tamperedStateRoot = path.join(tempRoot, "tampered-context-state");
fs.mkdirSync(tamperedStateRoot, { recursive: true });
const tamperedDatabasePath = path.join(tamperedStateRoot, DIRECT_EPISTEMIC_STORE_FILE);
fs.copyFileSync(path.join(stateRoot, DIRECT_EPISTEMIC_STORE_FILE), tamperedDatabasePath);
const tamperDatabase = new DatabaseSync(tamperedDatabasePath);
const persistedContextRow = tamperDatabase.prepare(`select import_id, result_json
  from direct_epistemic_context_imports
  where result_json like '%ArchitectureInvariant%' limit 1`).get();
assert.ok(persistedContextRow, "context integrity fixture requires an imported record body");
const tamperedContext = JSON.parse(persistedContextRow.result_json);
tamperedContext.records[0].payload = {
  ...tamperedContext.records[0].payload,
  injectedWithoutRecordDigest: true,
};
tamperDatabase.prepare(`update direct_epistemic_context_imports set result_json = ?
  where import_id = ?`).run(JSON.stringify(tamperedContext), persistedContextRow.import_id);
tamperDatabase.close();
assert.throws(
  () => new DirectEpistemicStore({ rootDir: tamperedStateRoot }),
  (error) => error?.code === "direct_epistemic_context_import_integrity_failed",
  "restart validation must compare embedded context bodies with their canonical record rows",
);
const cleanupProbe = new DatabaseSync(tamperedDatabasePath);
assert.equal(cleanupProbe.prepare("pragma quick_check").get().quick_check, "ok", "failed construction must release its owned database");
cleanupProbe.close();
fs.rmSync(tempRoot, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  repositoryPorts: firstProjection.ports.length,
  repositoryRecords: firstProjection.records.length,
  deterministicThreadRecords: deterministicThread.recordCount,
  transcribedThreadRecords: transcribedThread.recordCount,
  purposeSensitiveImports: true,
  lunaPromotionPrevented: true,
  nativeChildProviderTurnCaptured: true,
}));
