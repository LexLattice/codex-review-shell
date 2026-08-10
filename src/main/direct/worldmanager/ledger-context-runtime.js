"use strict";

const {
  canonicalJson,
  sha256,
} = require("../meta-session/digest");
const {
  buildAgentWakeEvent,
  buildTypedContinuationPacket,
  validateAgentSuspensionState,
  validateAgentWakeEvent,
  validateTypedContinuationPacket,
} = require("../worldmodel/wakeup-continuation");
const {
  DIRECT_LEDGER_DELIVERY_ENVELOPE_SCHEMA,
  validateLedgerDeliveryEnvelope,
} = require("./ledger-subscription-broker");

const DIRECT_LEDGER_CONTEXT_HYDRATION_REQUEST_SCHEMA =
  "direct_ledger_context_hydration_request@1";
const DIRECT_LEDGER_CONTEXT_ADMISSION_ENVELOPE_SCHEMA =
  "direct_ledger_context_admission_envelope@1";
const DIRECT_CONTEXT_INVALIDATION_NOTICE_SCHEMA =
  "direct_context_invalidation_notice@1";
const DIRECT_CONTEXT_INVALIDATION_ACK_SCHEMA =
  "direct_context_invalidation_ack@1";
const DIRECT_LEDGER_SAFE_BOUNDARY_INJECTION_SCHEMA =
  "direct_ledger_safe_boundary_injection@1";
const DIRECT_LEDGER_CONTEXT_DISPATCH_SCHEMA =
  "direct_ledger_context_dispatch@1";

const HYDRATION_POSTURES = Object.freeze([
  "pending",
  "imported",
  "partially_imported",
  "blocked",
  "failed",
]);
const INVALIDATION_POSTURES = Object.freeze([
  "active",
  "acknowledged",
  "revised",
  "remanded",
  "justified_continue",
  "superseded",
]);
const RUN_POSTURES = Object.freeze([
  "active_generating",
  "suspended",
  "idle_role_resident",
  "terminal",
]);
const DIGEST_KEYS = new Set([
  "digest",
  "requestDigest",
  "admissionDigest",
  "noticeDigest",
  "ackDigest",
  "injectionDigest",
  "dispatchDigest",
  "wakeEventDigest",
  "packetDigest",
  "suspensionDigest",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_KEYS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function stableId(prefix, value) {
  return `${prefix}_${digestFor(prefix, value).slice(0, 24)}`;
}

function exactRef(value, label = "ledgerContext.ref", options = {}) {
  if (!isPlainObject(value)) fail("ledger_context_ref_invalid", label);
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id || value.refId, ""),
    digest: text(value.digest, ""),
    ...(text(value.label, "") ? { label: text(value.label, "") } : {}),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!ref.kind || !ref.id || (!ref.digest && options.requireDigest !== false)) {
    fail("ledger_context_ref_invalid", label);
  }
  if (value.rawTextIncluded || value.rawPathIncluded || value.rawSecretIncluded) {
    fail("ledger_context_raw_ref_exposure", label);
  }
  return ref;
}

function uniqueRefs(values = [], label = "refs", options = {}) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value, index) => exactRef(value, `${label}.${index}`, options))
    .filter((ref) => {
      const key = `${ref.kind}:${ref.id}:${ref.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.kind}:${left.id}:${left.digest}`.localeCompare(`${right.kind}:${right.id}:${right.digest}`));
}

function sameIdentity(left, right) {
  return Boolean(left && right && text(left.kind, "") === text(right.kind, "") && text(left.id, "") === text(right.id, ""));
}

function objectRefFrom(value, kind, idField, digestField, label) {
  if (!value) return null;
  return exactRef({
    kind,
    id: value[idField],
    digest: value[digestField] || value.digest,
    label,
  });
}

function deliveryRef(delivery) {
  validateLedgerDeliveryEnvelope(delivery);
  return exactRef({
    kind: "ledger_delivery",
    id: delivery.deliveryId,
    digest: delivery.deliveryDigest,
    label: "Ledger delivery",
  });
}

function buildLedgerContextHydrationRequest(input = {}, options = {}) {
  const delivery = input.delivery;
  if (!delivery || delivery.schema !== DIRECT_LEDGER_DELIVERY_ENVELOPE_SCHEMA) {
    fail("ledger_context_delivery_missing");
  }
  validateLedgerDeliveryEnvelope(delivery);
  const projection = delivery.boundedProjection || {};
  const requestedObjectRefs = uniqueRefs(
    input.requestedObjectRefs || projection.visibleObjectRefs,
    "hydrationRequest.requestedObjectRefs",
  );
  const requestedEvidenceRefs = uniqueRefs(
    input.requestedEvidenceRefs || projection.visibleEvidenceRefs,
    "hydrationRequest.requestedEvidenceRefs",
  );
  const request = {
    schema: DIRECT_LEDGER_CONTEXT_HYDRATION_REQUEST_SCHEMA,
    hydrationRequestId: text(input.hydrationRequestId, "") || stableId("ledger_context_hydration", {
      deliveryRef: deliveryRef(delivery),
      requestedObjectRefs,
      requestedEvidenceRefs,
    }),
    deliveryRef: deliveryRef(delivery),
    subscriptionRef: delivery.subscriptionRef,
    recipientRoleRef: delivery.recipientRoleRef,
    recipientAgentRunRef: delivery.recipientAgentRunRef || null,
    eventRefs: uniqueRefs(delivery.eventRefs, "hydrationRequest.eventRefs"),
    requestedObjectRefs,
    requestedEvidenceRefs,
    visibilityPolicyRef: exactRef(
      input.visibilityPolicyRef,
      "hydrationRequest.visibilityPolicyRef",
    ),
    purpose: "ledger_delivery",
    requestReason: text(input.requestReason, "Import the bounded semantic delta selected by notification standing."),
    maxInputTokens: Number.isInteger(input.maxInputTokens) && input.maxInputTokens > 0
      ? input.maxInputTokens : 4_096,
    requiredOmissionWitness: true,
    importOperation: "IMPORT_CONTEXT",
    deliveryPayloadIsAuthority: false,
    worldEffect: "none",
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(options.now)),
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  request.requestDigest = digestFor("direct-ledger-context-hydration-request@1", request);
  validateLedgerContextHydrationRequest(request);
  return request;
}

function validateLedgerContextHydrationRequest(request) {
  if (!isPlainObject(request) || request.schema !== DIRECT_LEDGER_CONTEXT_HYDRATION_REQUEST_SCHEMA) {
    fail("ledger_context_hydration_request_invalid");
  }
  if (!text(request.hydrationRequestId, "") || request.purpose !== "ledger_delivery" || request.importOperation !== "IMPORT_CONTEXT") {
    fail("ledger_context_hydration_request_invalid", "identity_or_operation");
  }
  exactRef(request.deliveryRef, "hydrationRequest.deliveryRef");
  exactRef(request.subscriptionRef, "hydrationRequest.subscriptionRef");
  exactRef(request.recipientRoleRef, "hydrationRequest.recipientRoleRef");
  if (request.recipientAgentRunRef) exactRef(request.recipientAgentRunRef, "hydrationRequest.recipientAgentRunRef");
  exactRef(request.visibilityPolicyRef, "hydrationRequest.visibilityPolicyRef");
  for (const key of ["eventRefs", "requestedObjectRefs", "requestedEvidenceRefs"]) {
    if (!Array.isArray(request[key])) fail("ledger_context_hydration_request_invalid", key);
    request[key].forEach((ref, index) => exactRef(ref, `hydrationRequest.${key}.${index}`));
  }
  if (request.requiredOmissionWitness !== true || request.deliveryPayloadIsAuthority !== false || request.worldEffect !== "none" || request.grantsAuthority !== false) {
    fail("ledger_context_authority_leak", request.hydrationRequestId);
  }
  if (request.rawPayloadIncluded || request.rawTextIncluded || request.rawPathIncluded || request.rawSecretIncluded) {
    fail("ledger_context_raw_exposure", request.hydrationRequestId);
  }
  if (request.requestDigest !== digestFor("direct-ledger-context-hydration-request@1", request)) {
    fail("ledger_context_hydration_request_digest_mismatch", request.hydrationRequestId);
  }
  return true;
}

function normalizeImportResult(result = {}) {
  const bundle = result.bundle || result.contextBundle || null;
  const manifest = result.operationalManifest || result.manifest || null;
  const witness = result.selectionWitness || result.omissionWitness || null;
  const selectedObjectRefs = uniqueRefs([
    ...(result.selectedObjectRefs || []),
    ...(bundle?.content?.semanticObjects || []).map((item) => item.objectRef).filter(Boolean),
  ], "importResult.selectedObjectRefs");
  const selectedEvidenceRefs = uniqueRefs([
    ...(result.selectedEvidenceRefs || []),
    ...(bundle?.content?.evidenceRefs || []),
  ], "importResult.selectedEvidenceRefs");
  const omittedRefs = uniqueRefs([
    ...(result.omittedRefs || []),
    ...(witness?.excludedRefs || []),
    ...(witness?.crossScopeExclusions || []),
  ], "importResult.omittedRefs");
  return {
    bundleRef: result.bundleRef || objectRefFrom(bundle, "semantic_context_bundle", "contextBundleId", "digest", "Imported semantic context"),
    operationalManifestRef: result.operationalManifestRef || objectRefFrom(manifest, "operational_meta_context_manifest", "operationalMetaContextId", "digest", "Operational meta-context"),
    selectionWitnessRef: result.selectionWitnessRef || objectRefFrom(witness, "semantic_context_selection_witness", "selectionWitnessId", "digest", "Context selection witness"),
    selectedObjectRefs,
    selectedEvidenceRefs,
    omittedRefs,
    omittedCounts: isPlainObject(result.omittedCounts)
      ? result.omittedCounts
      : (isPlainObject(witness?.excludedCounts) ? witness.excludedCounts : {}),
    freshness: text(result.freshness || bundle?.freshness, "fresh"),
    errorCode: text(result.errorCode, ""),
  };
}

function buildLedgerContextAdmissionEnvelope(input = {}, options = {}) {
  const request = input.request;
  validateLedgerContextHydrationRequest(request);
  const normalized = normalizeImportResult(input.importResult || {});
  const posture = HYDRATION_POSTURES.includes(input.hydrationPosture)
    ? input.hydrationPosture
    : normalized.errorCode ? "failed"
      : normalized.omittedRefs.length ? "partially_imported"
        : normalized.bundleRef ? "imported" : "pending";
  const admission = {
    schema: DIRECT_LEDGER_CONTEXT_ADMISSION_ENVELOPE_SCHEMA,
    contextAdmissionId: text(input.contextAdmissionId, "") || stableId("ledger_context_admission", {
      requestRef: { id: request.hydrationRequestId, digest: request.requestDigest },
      posture,
      normalized,
    }),
    hydrationRequestRef: exactRef({
      kind: "ledger_context_hydration_request",
      id: request.hydrationRequestId,
      digest: request.requestDigest,
      label: "Ledger context hydration request",
    }),
    deliveryRef: request.deliveryRef,
    recipientRoleRef: request.recipientRoleRef,
    recipientAgentRunRef: request.recipientAgentRunRef,
    hydrationPosture: posture,
    semanticContextBundleRef: normalized.bundleRef
      ? exactRef(normalized.bundleRef, "contextAdmission.semanticContextBundleRef") : null,
    operationalMetaContextRef: normalized.operationalManifestRef
      ? exactRef(normalized.operationalManifestRef, "contextAdmission.operationalMetaContextRef") : null,
    selectionWitnessRef: normalized.selectionWitnessRef
      ? exactRef(normalized.selectionWitnessRef, "contextAdmission.selectionWitnessRef") : null,
    importedObjectRefs: normalized.selectedObjectRefs,
    importedEvidenceRefs: normalized.selectedEvidenceRefs,
    omittedRefs: normalized.omittedRefs,
    omittedCounts: normalized.omittedCounts,
    freshness: normalized.freshness,
    errorCode: normalized.errorCode,
    safeForPromptProjection: ["imported", "partially_imported"].includes(posture),
    canonicalEffect: false,
    worldEffect: "none",
    grantsAuthority: false,
    importedAt: ["imported", "partially_imported"].includes(posture)
      ? text(input.importedAt, nowIso(options.now)) : "",
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  admission.admissionDigest = digestFor("direct-ledger-context-admission-envelope@1", admission);
  validateLedgerContextAdmissionEnvelope(admission);
  return admission;
}

function validateLedgerContextAdmissionEnvelope(admission) {
  if (!isPlainObject(admission) || admission.schema !== DIRECT_LEDGER_CONTEXT_ADMISSION_ENVELOPE_SCHEMA || !HYDRATION_POSTURES.includes(admission.hydrationPosture)) {
    fail("ledger_context_admission_invalid");
  }
  exactRef(admission.hydrationRequestRef, "contextAdmission.hydrationRequestRef");
  exactRef(admission.deliveryRef, "contextAdmission.deliveryRef");
  exactRef(admission.recipientRoleRef, "contextAdmission.recipientRoleRef");
  if (admission.recipientAgentRunRef) exactRef(admission.recipientAgentRunRef, "contextAdmission.recipientAgentRunRef");
  if (admission.semanticContextBundleRef) exactRef(admission.semanticContextBundleRef, "contextAdmission.semanticContextBundleRef");
  if (admission.operationalMetaContextRef) exactRef(admission.operationalMetaContextRef, "contextAdmission.operationalMetaContextRef");
  if (admission.selectionWitnessRef) exactRef(admission.selectionWitnessRef, "contextAdmission.selectionWitnessRef");
  if (admission.canonicalEffect !== false || admission.worldEffect !== "none" || admission.grantsAuthority !== false) {
    fail("ledger_context_authority_leak", admission.contextAdmissionId);
  }
  if (admission.safeForPromptProjection && !["imported", "partially_imported"].includes(admission.hydrationPosture)) {
    fail("ledger_context_admission_invalid", "unsafe_projection");
  }
  if (admission.rawPayloadIncluded || admission.rawTextIncluded || admission.rawPathIncluded || admission.rawSecretIncluded) {
    fail("ledger_context_raw_exposure", admission.contextAdmissionId);
  }
  if (admission.admissionDigest !== digestFor("direct-ledger-context-admission-envelope@1", admission)) {
    fail("ledger_context_admission_digest_mismatch", admission.contextAdmissionId);
  }
  return true;
}

function hydrateLedgerDelivery(input = {}, options = {}) {
  const request = input.request || buildLedgerContextHydrationRequest(input, options);
  validateLedgerContextHydrationRequest(request);
  if (typeof input.importContext !== "function") {
    return buildLedgerContextAdmissionEnvelope({
      request,
      hydrationPosture: "pending",
      importResult: {},
    }, options);
  }
  try {
    const result = input.importContext({
      schema: "direct_ledger_import_context_adapter_request@1",
      hydrationRequest: request,
      delivery: input.delivery,
      recipientContext: input.recipientContext || {},
      operation: "IMPORT_CONTEXT",
      rawPayloadIncluded: false,
      grantsAuthority: false,
    });
    if (result && typeof result.then === "function") {
      fail("ledger_context_async_adapter_requires_hydrate_async");
    }
    return buildLedgerContextAdmissionEnvelope({ request, importResult: result }, options);
  } catch (error) {
    if (error?.code === "ledger_context_async_adapter_requires_hydrate_async") throw error;
    return buildLedgerContextAdmissionEnvelope({
      request,
      hydrationPosture: "failed",
      importResult: { errorCode: text(error?.code, "context_import_failed") },
    }, options);
  }
}

async function hydrateLedgerDeliveryAsync(input = {}, options = {}) {
  const request = input.request || buildLedgerContextHydrationRequest(input, options);
  validateLedgerContextHydrationRequest(request);
  if (typeof input.importContext !== "function") {
    return buildLedgerContextAdmissionEnvelope({ request, hydrationPosture: "pending", importResult: {} }, options);
  }
  try {
    const result = await input.importContext({
      schema: "direct_ledger_import_context_adapter_request@1",
      hydrationRequest: request,
      delivery: input.delivery,
      recipientContext: input.recipientContext || {},
      operation: "IMPORT_CONTEXT",
      rawPayloadIncluded: false,
      grantsAuthority: false,
    });
    return buildLedgerContextAdmissionEnvelope({ request, importResult: result }, options);
  } catch (error) {
    return buildLedgerContextAdmissionEnvelope({
      request,
      hydrationPosture: "failed",
      importResult: { errorCode: text(error?.code, "context_import_failed") },
    }, options);
  }
}

function manifestIdentity(manifest) {
  return {
    kind: "operational_meta_context_manifest",
    id: text(manifest.operationalMetaContextId || manifest.manifestId, ""),
    digest: text(manifest.digest || manifest.manifestDigest || manifest.dependencyDigest, ""),
    label: "Affected operational meta-context",
  };
}

function manifestDependencyRefs(manifest = {}) {
  return uniqueRefs([
    ...(manifest.sourceRevisionRefs || []),
    ...(manifest.pinnedPremiseRefs || []),
    ...(manifest.dependencyRefs || []),
    ...(manifest.contextBinding?.sourceRevisionRefs || []),
    ...(manifest.contextBinding?.dependencyRefs || []),
  ], "manifest.dependencies");
}

function eventInvalidationRefs(event = {}) {
  const challengesDependencies =
    event.actClass === "challenge" ||
    ["challenged", "contradicted", "superseded", "stale"].includes(
      text(event.epistemicPosture, ""),
    );
  return uniqueRefs([
    ...(event.contradictsRefs || []),
    ...(event.supersedesRefs || []),
    ...(event.invalidatesRefs || []),
    ...(event.typedPayload?.contradictsRefs || []),
    ...(event.typedPayload?.supersedesRefs || []),
    ...(event.typedPayload?.invalidatesRefs || []),
    // Ledger challenge operations already carry the challenged dependency set
    // in affectsRefs.  Treat those refs as invalidating only for an explicit
    // challenge/stale posture; ordinary observations may affect an object
    // without making every context that depends on it stale.
    ...(challengesDependencies ? event.affectsRefs || [] : []),
    ...(challengesDependencies ? event.typedPayload?.affectsRefs || [] : []),
  ], "event.invalidationRefs");
}

function buildContextInvalidationNotice(input = {}, options = {}) {
  const affectedManifestRef = exactRef(input.affectedManifestRef, "invalidation.affectedManifestRef");
  const triggerEventRef = exactRef(input.triggerEventRef, "invalidation.triggerEventRef");
  const invalidatedDependencyRefs = uniqueRefs(input.invalidatedDependencyRefs, "invalidation.invalidatedDependencyRefs");
  if (!invalidatedDependencyRefs.length) fail("ledger_context_invalidation_dependency_missing");
  const notice = {
    schema: DIRECT_CONTEXT_INVALIDATION_NOTICE_SCHEMA,
    invalidationNoticeId: text(input.invalidationNoticeId, "") || stableId("context_invalidation", {
      affectedManifestRef,
      triggerEventRef,
      invalidatedDependencyRefs,
    }),
    affectedManifestRef,
    affectedAgentRef: input.affectedAgentRef ? exactRef(input.affectedAgentRef, "invalidation.affectedAgentRef") : null,
    affectedAgentRunRef: input.affectedAgentRunRef ? exactRef(input.affectedAgentRunRef, "invalidation.affectedAgentRunRef") : null,
    triggerEventRef,
    invalidatedDependencyRefs,
    visibleEvidenceRefs: uniqueRefs(input.visibleEvidenceRefs, "invalidation.visibleEvidenceRefs"),
    withheldEvidenceCount: Number.isInteger(input.withheldEvidenceCount) && input.withheldEvidenceCount > 0
      ? input.withheldEvidenceCount : 0,
    protectedNoticeOnly: input.protectedNoticeOnly === true,
    blockedActionClasses: [...new Set((input.blockedActionClasses || ["mutating_effect"])
      .map((entry) => text(entry, "")).filter(Boolean))].sort(),
    requiredResolutionActions: ["acknowledge", "revise", "remand", "justify_continue"],
    invalidationPosture: "active",
    contextBindingStale: true,
    unrelatedContextsAffected: false,
    worldEffect: "none",
    grantsAuthority: false,
    createdAt: text(input.createdAt, nowIso(options.now)),
    resolvedAt: "",
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  notice.noticeDigest = digestFor("direct-context-invalidation-notice@1", notice);
  validateContextInvalidationNotice(notice);
  return notice;
}

function validateContextInvalidationNotice(notice) {
  if (!isPlainObject(notice) || notice.schema !== DIRECT_CONTEXT_INVALIDATION_NOTICE_SCHEMA || !INVALIDATION_POSTURES.includes(notice.invalidationPosture)) {
    fail("ledger_context_invalidation_notice_invalid");
  }
  exactRef(notice.affectedManifestRef, "invalidation.affectedManifestRef");
  exactRef(notice.triggerEventRef, "invalidation.triggerEventRef");
  if (notice.affectedAgentRef) exactRef(notice.affectedAgentRef, "invalidation.affectedAgentRef");
  if (notice.affectedAgentRunRef) exactRef(notice.affectedAgentRunRef, "invalidation.affectedAgentRunRef");
  if (!notice.invalidatedDependencyRefs.length || notice.unrelatedContextsAffected !== false || notice.worldEffect !== "none" || notice.grantsAuthority !== false) {
    fail("ledger_context_invalidation_notice_invalid", "dependency_or_authority");
  }
  if (notice.rawPayloadIncluded || notice.rawTextIncluded || notice.rawPathIncluded || notice.rawSecretIncluded) {
    fail("ledger_context_raw_exposure", notice.invalidationNoticeId);
  }
  if (notice.noticeDigest !== digestFor("direct-context-invalidation-notice@1", notice)) {
    fail("ledger_context_invalidation_digest_mismatch", notice.invalidationNoticeId);
  }
  return true;
}

function deriveContextInvalidationNotices(input = {}, options = {}) {
  const event = input.event || {};
  const triggerEventRef = exactRef({
    kind: "epistemic_ledger_event",
    id: event.ledgerEventId || event.eventId,
    digest: event.ledgerEventDigest || event.eventDigest || event.digest,
    label: text(event.rendererSafeSummary, "Epistemic context invalidation"),
  });
  const invalidationRefs = eventInvalidationRefs(event);
  if (!invalidationRefs.length) return [];
  const visibilityResolver = typeof input.visibilityResolver === "function"
    ? input.visibilityResolver : () => ({ visibleEvidenceRefs: [], withheldEvidenceCount: 0 });
  const notices = [];
  for (const manifest of input.manifests || []) {
    const dependencies = manifestDependencyRefs(manifest);
    const invalidated = dependencies.filter((dependency) =>
      invalidationRefs.some((ref) => sameIdentity(dependency, ref)));
    if (!invalidated.length) continue;
    const visibility = visibilityResolver({ event, manifest, invalidatedDependencyRefs: invalidated }) || {};
    notices.push(buildContextInvalidationNotice({
      affectedManifestRef: manifestIdentity(manifest),
      affectedAgentRef: manifest.agentInstantiationRef || manifest.agentRef,
      affectedAgentRunRef: manifest.agentRunRef,
      triggerEventRef,
      invalidatedDependencyRefs: invalidated,
      visibleEvidenceRefs: visibility.visibleEvidenceRefs,
      withheldEvidenceCount: visibility.withheldEvidenceCount,
      protectedNoticeOnly: visibility.protectedNoticeOnly,
      blockedActionClasses: manifest.governedActionClasses || input.blockedActionClasses,
      // A notice is a deterministic projection of this ledger event. Rebuilds
      // after restart must not mint a new timestamp/digest for the same fact.
      createdAt: event.createdAt,
    }, options));
  }
  return notices;
}

function acknowledgeContextInvalidation(notice, input = {}, options = {}) {
  validateContextInvalidationNotice(notice);
  const resolution = text(input.resolution, "acknowledge");
  const posture = {
    acknowledge: "acknowledged",
    revise: "revised",
    remand: "remanded",
    justify_continue: "justified_continue",
  }[resolution];
  if (!posture) fail("ledger_context_invalidation_resolution_invalid", resolution);
  if (resolution === "justify_continue" && !input.justificationRef) {
    fail("ledger_context_invalidation_justification_required");
  }
  const noticeRef = exactRef({
    kind: "context_invalidation_notice",
    id: notice.invalidationNoticeId,
    digest: notice.noticeDigest,
    label: "Context invalidation notice",
  });
  const ack = {
    schema: DIRECT_CONTEXT_INVALIDATION_ACK_SCHEMA,
    invalidationAckId: stableId("context_invalidation_ack", {
      noticeRef,
      resolution,
      actorRef: input.actorRef,
    }),
    invalidationNoticeRef: noticeRef,
    actorRef: exactRef(input.actorRef, "invalidationAck.actorRef"),
    resolution,
    resultingPosture: posture,
    justificationRef: input.justificationRef
      ? exactRef(input.justificationRef, "invalidationAck.justificationRef") : null,
    grantsAuthority: false,
    worldEffect: "none",
    acknowledgedAt: text(input.acknowledgedAt, nowIso(options.now)),
    rawPayloadIncluded: false,
  };
  ack.ackDigest = digestFor("direct-context-invalidation-ack@1", ack);
  return {
    acknowledgement: ack,
    notice: {
      ...notice,
      invalidationPosture: posture,
      contextBindingStale: !["revised", "remanded"].includes(posture),
      resolvedAt: ack.acknowledgedAt,
      noticeDigest: digestFor("direct-context-invalidation-notice@1", {
        ...notice,
        invalidationPosture: posture,
        contextBindingStale: !["revised", "remanded"].includes(posture),
        resolvedAt: ack.acknowledgedAt,
      }),
    },
  };
}

function buildSafeBoundaryInjection(input = {}, options = {}) {
  const admission = input.contextAdmission;
  validateLedgerContextAdmissionEnvelope(admission);
  if (!admission.safeForPromptProjection) fail("ledger_context_not_admitted_for_injection");
  const injection = {
    schema: DIRECT_LEDGER_SAFE_BOUNDARY_INJECTION_SCHEMA,
    injectionId: stableId("ledger_safe_boundary_injection", {
      deliveryRef: admission.deliveryRef,
      contextAdmissionId: admission.contextAdmissionId,
      targetAgentRunRef: input.targetAgentRunRef,
    }),
    deliveryRef: admission.deliveryRef,
    contextAdmissionRef: exactRef({
      kind: "ledger_context_admission",
      id: admission.contextAdmissionId,
      digest: admission.admissionDigest,
      label: "Admitted ledger context delta",
    }),
    targetAgentRunRef: exactRef(input.targetAgentRunRef, "injection.targetAgentRunRef"),
    injectionBoundary: "next_supported_continuation_boundary",
    midTokenPreemptionAttempted: false,
    pollingRequired: false,
    providerCallStarted: false,
    status: "queued",
    createdAt: text(input.createdAt, nowIso(options.now)),
    rawPayloadIncluded: false,
  };
  injection.injectionDigest = digestFor("direct-ledger-safe-boundary-injection@1", injection);
  return injection;
}

function adaptLedgerDeliveryToContinuation(input = {}, options = {}) {
  const delivery = input.delivery;
  const contextAdmission = input.contextAdmission;
  validateLedgerDeliveryEnvelope(delivery);
  validateLedgerContextAdmissionEnvelope(contextAdmission);
  if (contextAdmission.deliveryRef.id !== delivery.deliveryId) {
    fail("ledger_context_delivery_admission_mismatch");
  }
  const runPosture = RUN_POSTURES.includes(input.runPosture)
    ? input.runPosture : "idle_role_resident";
  const targetAgentRef = input.targetAgentRef || delivery.recipientAgentRef;
  const targetAgentRunRef = input.targetAgentRunRef || delivery.recipientAgentRunRef;
  if (!targetAgentRef) fail("ledger_context_target_agent_missing");
  if (!targetAgentRunRef && runPosture !== "idle_role_resident") {
    fail("ledger_context_target_run_missing");
  }
  let disposition = "semantic_inbox_only";
  let safeBoundaryInjection = null;
  let wakeEvent = null;
  let continuationPacket = null;
  let wakeSuppressionReason = "wake_policy_not_satisfied";
  if (runPosture === "active_generating") {
    safeBoundaryInjection = buildSafeBoundaryInjection({
      contextAdmission,
      targetAgentRunRef,
    }, options);
    disposition = "safe_boundary_queued";
    wakeSuppressionReason = "active_generation_not_preempted";
  } else {
    const suspendedEligible = runPosture === "suspended" && ["if_suspended", "if_material", "always_new_run"].includes(delivery.wakePolicy);
    const newRunEligible = ["idle_role_resident", "terminal"].includes(runPosture) &&
      ((delivery.wakePolicy === "always_new_run") ||
        (delivery.wakePolicy === "if_material" && delivery.wakeEligible && input.newRunAuthorized === true));
    if (delivery.wakeEligible && (suspendedEligible || newRunEligible)) {
      const suspension = input.suspension || null;
      if (suspension) validateAgentSuspensionState(suspension, options);
      const runRef = newRunEligible
        ? input.allocatedAgentRunRef
        : targetAgentRunRef;
      if (!runRef) fail("ledger_context_new_run_allocation_missing");
      if (newRunEligible && targetAgentRunRef && sameIdentity(runRef, targetAgentRunRef)) {
        fail("ledger_context_terminal_run_resurrection");
      }
      wakeEvent = buildAgentWakeEvent({
        wakeEventId: stableId("ledger_agent_wake", {
          deliveryId: delivery.deliveryId,
          targetRunId: runRef.id,
        }),
        idempotencyKey: `ledger:${delivery.deliveryId}:${runRef.id}`,
        targetAgentId: targetAgentRef.id,
        targetAgentRunId: runRef.id,
        sourceSuspensionId: suspension?.suspensionId || "",
        reason: "external_event",
        payloadRef: {
          kind: "ledger_context_admission",
          id: contextAdmission.contextAdmissionId,
          digest: contextAdmission.admissionDigest,
          label: "Hydrated ledger delivery",
        },
        wakePolicyRef: input.wakePolicyRef || {
          kind: "ledger_wake_policy",
          id: `${delivery.subscriptionRef.id}:${delivery.wakePolicy}`,
          digest: digestFor("ledger-wake-policy-ref@1", {
            subscriptionRef: delivery.subscriptionRef,
            wakePolicy: delivery.wakePolicy,
          }),
          label: delivery.wakePolicy,
        },
        consumptionMode: "at_least_once_with_dedupe",
        status: "queued",
      }, options);
      validateAgentWakeEvent(wakeEvent, options);
      continuationPacket = buildTypedContinuationPacket({
        packetId: stableId("ledger_continuation", {
          deliveryId: delivery.deliveryId,
          wakeEventId: wakeEvent.wakeEventId,
        }),
        targetAgentId: targetAgentRef.id,
        targetAgentRunId: runRef.id,
        suspension,
        wakeEvent,
        resumeReason: "external_event",
        sourceWorkIds: suspension?.awaitingWorkIds || [],
        evidenceRefs: [
          ...contextAdmission.importedObjectRefs,
          ...contextAdmission.importedEvidenceRefs,
          contextAdmission.deliveryRef,
        ],
        continuationSummary: "Resume with the exact bounded epistemic delta imported from the ledger delivery.",
      }, options);
      validateTypedContinuationPacket(continuationPacket, options);
      disposition = suspendedEligible ? "continuation_ready" : "new_run_requested";
      wakeSuppressionReason = "";
    } else if (runPosture === "terminal") {
      wakeSuppressionReason = "terminal_run_not_resurrected";
    } else if (runPosture === "idle_role_resident") {
      wakeSuppressionReason = "semantic_inbox_updated_without_authorized_new_run";
    }
  }
  const dispatch = {
    schema: DIRECT_LEDGER_CONTEXT_DISPATCH_SCHEMA,
    dispatchId: stableId("ledger_context_dispatch", {
      deliveryId: delivery.deliveryId,
      contextAdmissionId: contextAdmission.contextAdmissionId,
      targetAgentRef,
      targetAgentRunRef,
      runPosture,
      disposition,
    }),
    deliveryRef: contextAdmission.deliveryRef,
    contextAdmissionRef: exactRef({
      kind: "ledger_context_admission",
      id: contextAdmission.contextAdmissionId,
      digest: contextAdmission.admissionDigest,
      label: "Ledger context admission",
    }),
    targetAgentRef: exactRef(targetAgentRef, "dispatch.targetAgentRef"),
    targetAgentRunRef: targetAgentRunRef ? exactRef(targetAgentRunRef, "dispatch.targetAgentRunRef") : null,
    runPosture,
    disposition,
    safeBoundaryInjection,
    wakeEvent,
    continuationPacket,
    wakeSuppressionReason,
    pollingRequired: false,
    midTokenPreemptionAttempted: false,
    providerCallStarted: false,
    hiddenProviderSpendAllowed: false,
    grantsAuthority: false,
    createdAt: nowIso(options.now),
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  dispatch.dispatchDigest = digestFor("direct-ledger-context-dispatch@1", dispatch);
  validateLedgerContextDispatch(dispatch, options);
  return dispatch;
}

function validateLedgerContextDispatch(dispatch, options = {}) {
  if (!isPlainObject(dispatch) || dispatch.schema !== DIRECT_LEDGER_CONTEXT_DISPATCH_SCHEMA || !RUN_POSTURES.includes(dispatch.runPosture)) {
    fail("ledger_context_dispatch_invalid");
  }
  exactRef(dispatch.deliveryRef, "dispatch.deliveryRef");
  exactRef(dispatch.contextAdmissionRef, "dispatch.contextAdmissionRef");
  exactRef(dispatch.targetAgentRef, "dispatch.targetAgentRef");
  if (dispatch.targetAgentRunRef) exactRef(dispatch.targetAgentRunRef, "dispatch.targetAgentRunRef");
  if (dispatch.wakeEvent) validateAgentWakeEvent(dispatch.wakeEvent, options);
  if (dispatch.continuationPacket) validateTypedContinuationPacket(dispatch.continuationPacket, options);
  if (dispatch.pollingRequired !== false || dispatch.midTokenPreemptionAttempted !== false || dispatch.providerCallStarted !== false || dispatch.hiddenProviderSpendAllowed !== false || dispatch.grantsAuthority !== false) {
    fail("ledger_context_authority_leak", dispatch.dispatchId);
  }
  if (dispatch.runPosture === "terminal" && dispatch.disposition === "continuation_ready") {
    fail("ledger_context_terminal_run_resurrection");
  }
  if (dispatch.rawPayloadIncluded || dispatch.rawTextIncluded || dispatch.rawPathIncluded || dispatch.rawSecretIncluded) {
    fail("ledger_context_raw_exposure", dispatch.dispatchId);
  }
  if (dispatch.dispatchDigest !== digestFor("direct-ledger-context-dispatch@1", dispatch)) {
    fail("ledger_context_dispatch_digest_mismatch", dispatch.dispatchId);
  }
  return true;
}

module.exports = {
  DIRECT_CONTEXT_INVALIDATION_ACK_SCHEMA,
  DIRECT_CONTEXT_INVALIDATION_NOTICE_SCHEMA,
  DIRECT_LEDGER_CONTEXT_ADMISSION_ENVELOPE_SCHEMA,
  DIRECT_LEDGER_CONTEXT_DISPATCH_SCHEMA,
  DIRECT_LEDGER_CONTEXT_HYDRATION_REQUEST_SCHEMA,
  DIRECT_LEDGER_SAFE_BOUNDARY_INJECTION_SCHEMA,
  HYDRATION_POSTURES,
  INVALIDATION_POSTURES,
  RUN_POSTURES,
  acknowledgeContextInvalidation,
  adaptLedgerDeliveryToContinuation,
  buildContextInvalidationNotice,
  buildLedgerContextAdmissionEnvelope,
  buildLedgerContextHydrationRequest,
  buildSafeBoundaryInjection,
  deriveContextInvalidationNotices,
  hydrateLedgerDelivery,
  hydrateLedgerDeliveryAsync,
  validateContextInvalidationNotice,
  validateLedgerContextAdmissionEnvelope,
  validateLedgerContextDispatch,
  validateLedgerContextHydrationRequest,
};
