"use strict";

const crypto = require("node:crypto");

const DIRECT_EPISTEMIC_SUBJECT_SCHEMA = "direct_epistemic_subject@1";
const DIRECT_EPISTEMIC_O_REVISION_SCHEMA = "direct_epistemic_o_revision@1";
const DIRECT_EPISTEMIC_E_REVISION_SCHEMA = "direct_epistemic_e_revision@1";
const DIRECT_EPISTEMIC_RECORD_SCHEMA = "direct_epistemic_record@1";
const DIRECT_EPISTEMIC_PORT_SCHEMA = "direct_epistemic_port@1";
const DIRECT_EPISTEMIC_CONTEXT_RESULT_SCHEMA = "direct_epistemic_context_result@1";

const SUBJECT_KINDS = new Set(["repository", "thread"]);
const RECORD_STANDINGS = new Set([
  "mechanically_observed",
  "attributed",
  "candidate",
  "admitted",
  "validated",
  "retracted",
]);

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? sorted(value) : {};
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(sorted(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestFor(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function shortId(prefix, value) {
  return `${prefix}_${digestFor(value).slice(0, 24)}`;
}

function exactRef(kind, id, digest) {
  return deepFreeze({
    kind: text(kind),
    id: text(id),
    digest: text(digest),
  });
}

function assert(condition, code) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  throw error;
}

function buildSubject(input = {}) {
  const kind = text(input.kind);
  const externalId = text(input.externalId || input.id);
  assert(SUBJECT_KINDS.has(kind), "direct_epistemic_subject_kind_invalid");
  assert(externalId, "direct_epistemic_subject_external_id_required");
  const identity = { kind, externalId };
  const subjectDigest = digestFor(identity);
  const subjectId = shortId(`ep_${kind}`, identity);
  return deepFreeze({
    schema: DIRECT_EPISTEMIC_SUBJECT_SCHEMA,
    subjectId,
    kind,
    externalId,
    projectId: text(input.projectId),
    label: text(input.label, kind === "repository" ? "Repository" : "Direct thread"),
    profileId: text(input.profileId),
    subjectDigest,
    ref: exactRef("direct_epistemic_subject", subjectId, subjectDigest),
  });
}

function buildORevision(input = {}) {
  const subject = object(input.subject);
  assert(subject.schema === DIRECT_EPISTEMIC_SUBJECT_SCHEMA, "direct_epistemic_o_subject_invalid");
  const posture = text(input.posture, "observed");
  const identity = {
    subjectId: subject.subjectId,
    substrateKind: text(input.substrateKind),
    substrateIdentity: object(input.substrateIdentity),
    posture,
  };
  assert(identity.substrateKind, "direct_epistemic_o_substrate_kind_required");
  const revisionDigest = digestFor(identity);
  const oRevisionId = shortId("ep_o", identity);
  return deepFreeze({
    schema: DIRECT_EPISTEMIC_O_REVISION_SCHEMA,
    oRevisionId,
    subjectId: subject.subjectId,
    substrateKind: identity.substrateKind,
    substrateIdentity: identity.substrateIdentity,
    posture,
    observedAt: text(input.observedAt, new Date().toISOString()),
    revisionDigest,
    ref: exactRef("direct_epistemic_o_revision", oRevisionId, revisionDigest),
  });
}

function buildERevision(input = {}) {
  const subject = object(input.subject);
  const oRevision = object(input.oRevision);
  assert(subject.schema === DIRECT_EPISTEMIC_SUBJECT_SCHEMA, "direct_epistemic_e_subject_invalid");
  assert(oRevision.schema === DIRECT_EPISTEMIC_O_REVISION_SCHEMA, "direct_epistemic_e_o_revision_invalid");
  assert(oRevision.subjectId === subject.subjectId, "direct_epistemic_e_subject_mismatch");
  const standing = text(input.standing, "admitted");
  const coverage = object(input.coverage);
  const identity = {
    subjectId: subject.subjectId,
    oRevisionId: oRevision.oRevisionId,
    parentERevisionId: text(input.parentERevisionId),
    revisionClass: text(input.revisionClass, "deterministic_projection"),
    basisDigest: text(input.basisDigest || digestFor(input.basis || {})),
    standing,
    coverage,
  };
  const revisionDigest = digestFor(identity);
  const eRevisionId = shortId("ep_e", identity);
  return deepFreeze({
    schema: DIRECT_EPISTEMIC_E_REVISION_SCHEMA,
    eRevisionId,
    subjectId: subject.subjectId,
    oRevisionId: oRevision.oRevisionId,
    parentERevisionId: identity.parentERevisionId,
    revisionClass: identity.revisionClass,
    basisDigest: identity.basisDigest,
    standing,
    coverage,
    createdAt: text(input.createdAt, new Date().toISOString()),
    revisionDigest,
    ref: exactRef("direct_epistemic_e_revision", eRevisionId, revisionDigest),
  });
}

function normalizeRefs(refs) {
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => ({
      kind: text(ref?.kind),
      id: text(ref?.id),
      digest: text(ref?.digest),
      label: text(ref?.label),
    }))
    .filter((ref) => ref.kind && ref.id && ref.digest);
}

function buildEpistemicRecord(input = {}) {
  const subject = object(input.subject);
  const oRevision = object(input.oRevision);
  const eRevision = object(input.eRevision);
  assert(subject.schema === DIRECT_EPISTEMIC_SUBJECT_SCHEMA, "direct_epistemic_record_subject_invalid");
  assert(oRevision.subjectId === subject.subjectId, "direct_epistemic_record_o_subject_mismatch");
  assert(eRevision.subjectId === subject.subjectId, "direct_epistemic_record_e_subject_mismatch");
  assert(eRevision.oRevisionId === oRevision.oRevisionId, "direct_epistemic_record_revision_mismatch");
  const recordType = text(input.recordType);
  const semanticKey = text(input.semanticKey);
  const standing = text(input.standing, "candidate");
  assert(recordType, "direct_epistemic_record_type_required");
  assert(semanticKey, "direct_epistemic_record_semantic_key_required");
  assert(RECORD_STANDINGS.has(standing), "direct_epistemic_record_standing_invalid");
  const payload = object(input.payload);
  const evidenceRefs = normalizeRefs(input.evidenceRefs);
  const sourceRefs = normalizeRefs(input.sourceRefs);
  const dependencyRefs = normalizeRefs(input.dependencyRefs);
  const occurrenceSource = object(input.occurrenceSource);
  const attribution = object(input.attribution);
  const epistemicPromotion = input.epistemicPromotion === true;
  const identity = {
    subjectId: subject.subjectId,
    oRevisionId: oRevision.oRevisionId,
    eRevisionId: eRevision.eRevisionId,
    recordType,
    semanticKey,
    facet: text(input.facet),
    actor: text(input.actor),
    standing,
    predicate: text(input.predicate, recordType),
    scope: object(input.scope),
    quantification: object(input.quantification),
    payload,
    evidenceRefs,
    sourceRefs,
    dependencyRefs,
    validation: object(input.validation),
    occurrenceSource,
    attribution,
    epistemicPromotion,
  };
  const recordDigest = digestFor(identity);
  const recordId = shortId("ep_record", identity);
  return deepFreeze({
    schema: DIRECT_EPISTEMIC_RECORD_SCHEMA,
    recordId,
    subjectId: subject.subjectId,
    oRevisionId: oRevision.oRevisionId,
    eRevisionId: eRevision.eRevisionId,
    recordType,
    semanticKey,
    facet: identity.facet,
    actor: identity.actor,
    standing,
    predicate: identity.predicate,
    scope: identity.scope,
    quantification: identity.quantification,
    payload,
    evidenceRefs,
    sourceRefs,
    dependencyRefs,
    validation: identity.validation,
    occurrenceSource,
    attribution,
    epistemicPromotion,
    createdAt: text(input.createdAt, new Date().toISOString()),
    recordDigest,
    ref: exactRef("direct_epistemic_record", recordId, recordDigest),
  });
}

function buildSemanticPort(input = {}) {
  const subject = object(input.subject);
  assert(subject.schema === DIRECT_EPISTEMIC_SUBJECT_SCHEMA, "direct_epistemic_port_subject_invalid");
  const name = text(input.name);
  assert(name, "direct_epistemic_port_name_required");
  const persistedSelector = object(input.selector);
  const selector = {
    recordTypes: [...new Set((Array.isArray(input.recordTypes) ? input.recordTypes : persistedSelector.recordTypes || []).map((value) => text(value)).filter(Boolean))],
    facets: [...new Set((Array.isArray(input.facets) ? input.facets : persistedSelector.facets || []).map((value) => text(value)).filter(Boolean))],
    standings: [...new Set((Array.isArray(input.standings) ? input.standings : persistedSelector.standings || []).map((value) => text(value)).filter(Boolean))],
    semanticKeys: [...new Set((Array.isArray(input.semanticKeys) ? input.semanticKeys : persistedSelector.semanticKeys || []).map((value) => text(value)).filter(Boolean))],
  };
  const purpose = text(input.purpose);
  const traversal = Array.isArray(input.traversal) ? input.traversal.map((value) => text(value)).filter(Boolean) : [];
  const omissionPolicy = text(input.omissionPolicy, "omit_unselected_facets");
  const identity = {
    subjectId: subject.subjectId,
    name,
    selector,
    version: Number(input.version || 1),
    purpose,
    traversal,
    omissionPolicy,
  };
  const portDigest = digestFor(identity);
  const portId = shortId("ep_port", identity);
  return deepFreeze({
    schema: DIRECT_EPISTEMIC_PORT_SCHEMA,
    portId,
    subjectId: subject.subjectId,
    name,
    label: text(input.label, name.replace(/[._-]+/g, " ")),
    purpose,
    version: identity.version,
    selector,
    traversal,
    omissionPolicy,
    portDigest,
    ref: exactRef("direct_epistemic_port", portId, portDigest),
  });
}

function buildContextResult(input = {}) {
  const records = Array.isArray(input.records) ? input.records.map((record) => sorted(record)) : [];
  const omissions = Array.isArray(input.omissions) ? input.omissions.map((value) => text(value)).filter(Boolean) : [];
  const omissionWitnesses = (Array.isArray(input.omissionWitnesses) ? input.omissionWitnesses : [])
    .filter((value) => value && typeof value === "object" && !Array.isArray(value))
    .map((value) => sorted(value));
  const freshness = text(input.freshness, "exact");
  const requestConstraints = object(input.requestConstraints || input.constraints);
  const purposeId = text(input.purposeId);
  const requestIntent = text(input.requestIntent);
  const detailDepth = text(input.detailDepth);
  const sinceRevision = text(input.sinceRevision);
  const rawEvidencePolicy = text(input.rawEvidencePolicy);
  const tokenBudget = Number.isFinite(Number(input.tokenBudget)) ? Math.max(0, Number(input.tokenBudget)) : 0;
  const identity = {
    subjectRef: object(input.subjectRef),
    oRevisionRef: object(input.oRevisionRef),
    eRevisionRef: object(input.eRevisionRef),
    portRef: object(input.portRef),
    purpose: text(input.purpose),
    purposeId,
    requestIntent,
    facets: Array.isArray(input.facets) ? input.facets.map((value) => text(value)).filter(Boolean) : [],
    recordRefs: records.map((record) => record.ref),
    omissions,
    omissionWitnesses,
    freshness,
    detailDepth,
    sinceRevision,
    rawEvidencePolicy,
    tokenBudget,
    requestConstraints,
  };
  const importDigest = digestFor(identity);
  return deepFreeze({
    schema: DIRECT_EPISTEMIC_CONTEXT_RESULT_SCHEMA,
    importId: shortId("ep_import", identity),
    ...identity,
    records,
    omissions,
    omissionWitnesses,
    freshness,
    requestConstraints,
    createdAt: text(input.createdAt, new Date().toISOString()),
    importDigest,
  });
}

module.exports = {
  DIRECT_EPISTEMIC_CONTEXT_RESULT_SCHEMA,
  DIRECT_EPISTEMIC_E_REVISION_SCHEMA,
  DIRECT_EPISTEMIC_O_REVISION_SCHEMA,
  DIRECT_EPISTEMIC_PORT_SCHEMA,
  DIRECT_EPISTEMIC_RECORD_SCHEMA,
  DIRECT_EPISTEMIC_SUBJECT_SCHEMA,
  RECORD_STANDINGS,
  buildContextResult,
  buildERevision,
  buildEpistemicRecord,
  buildORevision,
  buildSemanticPort,
  buildSubject,
  canonicalJson,
  deepFreeze,
  digestFor,
  exactRef,
  normalizeRefs,
  text,
};
