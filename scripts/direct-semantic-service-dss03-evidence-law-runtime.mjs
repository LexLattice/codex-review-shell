import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => Array.isArray(value)
  ? value.map(normalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
    : value;
export const digestObject = (value) => sha(JSON.stringify(normalize(value)));
const clone = (value) => structuredClone(value);
const nonemptyString = (value) => typeof value === "string" && value.length > 0;
const nonemptyArray = (value) => Array.isArray(value) && value.length > 0;
const unique = (values) => Array.isArray(values) && new Set(values).size === values.length;
const transitionFieldsClosed = (transition) => nonemptyString(transition.transitionId)
  && nonemptyString(transition.carrierId)
  && nonemptyString(transition.operationId)
  && nonemptyString(transition.event)
  && nonemptyArray(transition.fromStates)
  && nonemptyArray(transition.toStates)
  && nonemptyArray(transition.outcomeCases)
  && ["OPERATION_INPUT", "CARRIER_INITIAL_STATE", "CREATED_EARLIER_IN_SAME_ATOMIC_OPERATION"].includes(transition.priorStateSource);
const standingValue = (value) => ["POSITIVE", "NEGATIVE"].includes(value);
const stateStandingFor = (proof, transition, state) => proof.stateStanding?.[transition.carrierId]?.[state];
const outcomeStandingFor = (proof, transition, outcome) => proof.operationOutcomeStanding?.[transition.operationId]?.[outcome]
  ?? proof.outcomeStanding?.[outcome];
const transitionStandingClosed = (proof, transition) => [...transition.fromStates, ...transition.toStates].every((state) => standingValue(stateStandingFor(proof, transition, state)))
  && transition.outcomeCases.every((outcome) => standingValue(outcomeStandingFor(proof, transition, outcome)));
const negativeToPositive = (proof, transition) => transition.toStates.some((state) => stateStandingFor(proof, transition, state) === "NEGATIVE")
  && transition.outcomeCases.some((outcome) => outcomeStandingFor(proof, transition, outcome) === "POSITIVE");
const negativeTransition = (proof, transition) => transition.toStates.some((state) => stateStandingFor(proof, transition, state) === "NEGATIVE");
const exactDigestEqual = (left, right) => digestObject(left) === digestObject(right);
const allNonemptyStrings = (values) => nonemptyArray(values) && values.every(nonemptyString);
const rootsFor = (proof) => [proof.authority?.root, ...(proof.inputAuthorities ?? []).map((item) => item.authority?.root)].filter(Boolean);
const scopesFor = (proof) => proof.scope ? [proof.scope] : (proof.inputs ?? []).map((item) => item.scope).filter(Boolean);
const timesFor = (proof) => proof.time ? [proof.time] : (proof.inputTimes ?? []).map((item) => item.time).filter(Boolean);
const identitiesFor = (proof) => proof.identity ? [proof.identity] : (proof.inputIdentities ?? []).map((item) => item.identity).filter(Boolean);
const persistenceFor = (proof) => proof.persistenceProof ? [proof.persistenceProof] : (proof.outputPersistence ?? []);
const surfaceIdsFor = (proof) => (proof.projectSurface ?? []).map((item) => item.id);
const exactKeys = (value, keys) => value && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const rootsRegistered = (proof) => nonemptyArray(rootsFor(proof)) && rootsFor(proof).every((root) => (proof.rootRegistry ?? []).filter((item) => item.rootId === root && item.standing === "PINNED").length === 1);
const ownersRegistered = (proof) => {
  const owners = [proof.owner, proof.authority?.owner, ...(proof.inputAuthorities ?? []).map((item) => item.authority?.owner)].filter(Boolean);
  return nonemptyArray(owners) && owners.every((owner) => (proof.ownerRegistry ?? []).filter((item) => item === owner).length === 1);
};
const timeOrderClosed = (time) => nonemptyArray(time?.order_edges) && time.order_edges.some((edge) => edge.left === "observation" && edge.relation === "BEFORE_OR_EQUAL" && edge.right === "recording") && !time.order_edges.some((edge) => edge.left === "recording" && edge.relation === "BEFORE" && edge.right === "observation");
const exactNamedLawPredicates = {
  "canonical-construct-register": ({ proof }) => ({ canonicalConstructRegisterClosed: nonemptyArray(proof.projectSurface) && proof.projectSurface.every((item) => nonemptyString(item.id) && nonemptyString(item.kind) && nonemptyString(item.provenance)) }),
  "executable-root-and-language-enumeration": ({ proof }) => ({ executableRootsAndLanguagesExplicit: nonemptyArray(proof.projectSurface) && proof.projectSurface.every((item) => nonemptyString(item.provenance)) }),
  "frozen-project-file-inventory": ({ proof }) => ({ projectInventoryFrozenAndUnique: nonemptyArray(proof.projectSurface) && unique(surfaceIdsFor(proof)) }),
  "sealed-project-surface": ({ proof }) => ({ projectSurfaceSealed: unique(surfaceIdsFor(proof)) && proof.partitionProof?.mechanicallyChecked === true }),
  "contact-to-occurrence-reverse-map": ({ proof }) => ({ everySurfaceHasOccurrenceProvenance: nonemptyArray(proof.projectSurface) && proof.projectSurface.every((item) => nonemptyString(item.provenance)) }),
  "declaration-to-surface-map": ({ proof }) => ({ declarationSurfaceMapTotal: nonemptyArray(proof.projectSurface) && proof.projectSurface.every((item) => nonemptyString(item.id) && nonemptyString(item.kind)) }),
  "discovery-independence-graph": ({ proof }) => ({ discoverySourcesNotRegistryOnly: nonemptyArray(proof.projectSurface) && proof.projectSurface.every((item) => item.discovery_source === "CONTRACT_OCCURRENCE") }),
  "effect-derived-call-and-launch-graph": ({ proof }) => ({ effectGraphProvenancePresent: nonemptyArray(proof.projectSurface) && proof.projectSurface.every((item) => nonemptyString(item.provenance)) }),
  "exclusion-counterexample-search": ({ proof }) => ({ exclusionCounterexamplesClosed: nonemptyArray(proof.exclusions) && proof.exclusions.every((item) => nonemptyString(item.theorem)) }),
  "mapping-or-exclusion-receipt": ({ proof }) => ({ everySurfaceMappedOrExcluded: proof.partitionProof?.uncoveredCount === 0 && proof.partitionProof?.outsideUniverseCount === 0 }),
  "occurrence-level-disjoint-partition": ({ proof }) => ({ occurrencePartitionDisjoint: proof.partitionProof?.intersectionCount === 0 && proof.partitionProof?.pCount === proof.partitionProof?.mCount + proof.partitionProof?.xCount }),
  "owner-ratified-exclusion-theorems": ({ proof }) => ({ exclusionsCarryOwnerTheorems: nonemptyArray(proof.exclusions) && proof.exclusions.every((item) => nonemptyString(item.theorem) && item.ratification === "OWNER_RATIFIED" && item.executable === false) }),
  "content-seal": ({ proof }) => ({ contentSealSurfacePresent: nonemptyArray(proof.contentSealSurfaces), contentSealSurfaceTyped: (proof.contentSealSurfaces ?? []).every((item) => item.kind === "PERSISTED_OBJECT") }),
  "identity-seal": ({ proof }) => ({ distinctSemanticInputsCannotAlias: identitiesFor(proof).every((identity) => exactKeys(identity, ["stable_fields", "generation_fields", "equality_basis", "changed_input_posture", "rebinding_posture"]) && identity.equality_basis === "EXACT_STABLE_AND_GENERATION_TUPLE") }),
  "source-seal": ({ proof }) => ({ identitySourceFieldsSealed: identitiesFor(proof).every((identity) => allNonemptyStrings(identity.stable_fields) && allNonemptyStrings(identity.generation_fields)) }),
  "changed-content-negative-basis": ({ proof }) => ({ changedContentChangesIdentity: identitiesFor(proof).every((identity) => allNonemptyStrings(identity.stable_fields) && identity.changed_input_posture === "DISTINCT_IDENTITY") }),
  "identity-sensitivity-mutations": ({ proof }) => ({ outcomeRelevantIdentitySensitive: identitiesFor(proof).every((identity) => allNonemptyStrings(identity.stable_fields) && allNonemptyStrings(identity.generation_fields) && identity.changed_input_posture === "DISTINCT_IDENTITY") }),
  "key-value-rebinding-proof": ({ proof }) => ({ keyValueRebindingRejected: identitiesFor(proof).every((identity) => identity.rebinding_posture === "REJECT") }),
  "semantic-input-field-inventory": ({ proof }) => ({ semanticInputInventoryComplete: nonemptyArray(identitiesFor(proof)) && identitiesFor(proof).every((identity) => allNonemptyStrings(identity.stable_fields) && allNonemptyStrings(identity.generation_fields)) }),
  "closed-root-population": ({ proof }) => ({ rootPopulationClosed: rootsRegistered(proof) && unique(rootsFor(proof)) }),
  "exact-root-resolution-trace": ({ proof }) => ({ exactlyOneResolvedRootPerAuthority: rootsRegistered(proof) && [proof.authority, ...(proof.inputAuthorities ?? []).map((item) => item.authority)].filter(Boolean).every((authority) => authority.root_cardinality === "EXACTLY_ONE") }),
  "external-root-installation-receipt": ({ proof }) => ({ rootExternallyInstalled: rootsRegistered(proof) && [proof.authority, ...(proof.inputAuthorities ?? []).map((item) => item.authority)].filter(Boolean).every((authority) => authority.root_provenance === "EXTERNAL_INSTALLATION_OR_RATIFIED_PREDECESSOR") }),
  "owner-genesis-trace": ({ proof }) => ({ ownerGenesisRootBound: rootsRegistered(proof) && ownersRegistered(proof) }),
  "owner-root": ({ proof, moduleDeclaration, projection }) => { const root = rootsFor(proof)[0]; return { externallyConstitutedRoot: rootsRegistered(proof) && proof.authority?.self_constitution === "FORBIDDEN", rootMatchesCandidateOwner: root === moduleDeclaration.carriers.find((item) => item.id === projection.subject.id)?.authority?.root }; },
  "root-state-event-outcome-table": ({ proof }) => ({ rootLifecycleOutcomesExplicit: nonemptyArray(rootsFor(proof)) && proof.grant && allNonemptyStrings(proof.grant.allowed_postures) }),
  "root-substitution-negative-basis": ({ proof }) => ({ substitutedRootRejected: rootsRegistered(proof) && [proof.authority, ...(proof.inputAuthorities ?? []).map((item) => item.authority)].filter(Boolean).every((authority) => authority.self_constitution === "FORBIDDEN") }),
  "authority-meet": ({ proof }) => ({ authorityMeetNonempty: proof.grant ? allNonemptyStrings(proof.grant.allowed_postures) : (proof.inputAuthorities ?? []).every((item) => allNonemptyStrings(item.grant?.allowed_postures)) }),
  "authority-meet-proof": ({ proof }) => ({ weakestInputAuthorityBoundsOutput: nonemptyArray(proof.inputAuthorities) && proof.inputAuthorities.every((item) => nonemptyString(item.authority?.owner) && allNonemptyStrings(item.grant?.allowed_postures)) }),
  "current-authority-dependencies": ({ proof }) => ({ authorityDependenciesCurrentAndClosed: Array.isArray(proof.authorityDependencies) && unique(proof.authorityDependencies) && proof.dependencyPolicy?.currentness_posture === "REVERIFY" }),
  "grant-contract": ({ proof }) => ({ grantContractTyped: proof.grant ? allNonemptyStrings(proof.grant.allowed_lanes) && allNonemptyStrings(proof.grant.allowed_postures) : (proof.inputAuthorities ?? []).every((item) => allNonemptyStrings(item.grant?.allowed_lanes) && allNonemptyStrings(item.grant?.allowed_postures)) }),
  "caller-nonconstitution-proof": ({ proof }) => ({ callerCannotConstituteAuthority: [proof.authority, ...(proof.inputAuthorities ?? []).map((item) => item.authority)].filter(Boolean).every((authority) => authority.self_constitution === "FORBIDDEN") }),
  "zero-authority-conflict-proof": ({ proof }) => ({ conflictingAuthorityCannotProceed: nonemptyArray(proof.inputAuthorities) && proof.authorityPolicy?.conflict_posture === "REJECT" }),
  "zero-descendant-proof": ({ proof }) => ({ deniedAuthorityCreatesNoDescendants: ownersRegistered(proof) && proof.authorityPolicy?.denied_descendants === "NONE" }),
  "exclusive-operation-owner": ({ proof }) => ({ oneIndivisibleOwner: ownersRegistered(proof) && (proof.ownerCardinality ?? 1) === 1 }),
  "positive-owner-trace": ({ proof }) => ({ positiveOwnerTraceBound: nonemptyString(proof.owner) && nonemptyArray(proof.inputAuthorities) }),
  "separate-decision-owner": ({ proof }) => ({ evidenceDoesNotMintDecisionAuthority: proof.authority?.decision_owner === "DECLARED_OWNER_ONLY" }),
  "disjoint-impact-proof": ({ proof }) => ({ impactSetsDisjoint: scopesFor(proof).every((scope) => exactKeys(scope, ["closure_kind", "membership_domain", "population_owner", "issuer", "impact_relation", "new_member_posture"]) && scope.impact_relation === "DISJOINT_OR_EXPLICIT_JOIN") }),
  "owner-issued-scope-proof": ({ proof }) => ({ scopeIssuedByOwner: scopesFor(proof).every((scope) => nonemptyString(scope.population_owner) && scope.issuer === scope.population_owner) }),
  "scope-entitlement-index": ({ proof }) => ({ scopeEntitlementPopulationClosed: nonemptyArray(scopesFor(proof)) && scopesFor(proof).every((scope) => scope.membership_domain?.kind === "DECLARED_CARRIER_POPULATION" && nonemptyString(scope.membership_domain?.carrier_id) && nonemptyString(scope.population_owner)) }),
  "scope-impact-index": ({ proof }) => ({ scopeImpactIndexClosed: nonemptyArray(scopesFor(proof)) && scopesFor(proof).every((scope) => scope.closure_kind === "HISTORICAL_MEMBERSHIP" && scope.new_member_posture === "RECOMPUTE_CLOSURE") }),
  "scope-proof": ({ proof }) => ({ boundedMembership: nonemptyArray(scopesFor(proof)) && scopesFor(proof).every((scope) => scope.membership_domain?.kind === "DECLARED_CARRIER_POPULATION" && nonemptyString(scope.membership_domain?.carrier_id)), exactPopulationOwners: scopesFor(proof).every((scope) => nonemptyString(scope.population_owner)), outputsBounded: nonemptyArray(proof.outputs) }),
  "boundary-heads": ({ proof }) => ({ exactBoundaryHeadsPresent: nonemptyArray(timesFor(proof)) && timesFor(proof).every((time) => time.roles.includes("observation") && time.roles.includes("recording")) }),
  "clock-partial-order": ({ proof }) => ({ clockOrderAcyclic: timesFor(proof).every(timeOrderClosed) }),
  "declared-boundary-relation": ({ proof }) => ({ boundaryRelationDeclared: timesFor(proof).every((time) => time.mode === "BOUNDARY" && nonemptyArray(time.order_edges)) }),
  "effective-time-proof": ({ proof }) => ({ effectiveTimeDerivedAtBoundary: timesFor(proof).every((time) => time.mode === "BOUNDARY" && time.roles.includes("observation")) }),
  "no-backdating-proof": ({ proof }) => ({ observationNeverBackdated: timesFor(proof).every(timeOrderClosed) }),
  "sequence-generation": ({ proof }) => ({ sequenceGenerationBound: allNonemptyStrings(proof.generationFields ?? proof.inputTimes?.flatMap((item) => item.generationFields)) }),
  "current-dependencies": ({ proof }) => ({ temporalDependenciesCurrent: allNonemptyStrings(proof.generationFields ?? proof.inputTimes?.flatMap((item) => item.generationFields)) && timesFor(proof).every((time) => time.currentness_posture === "REQUIRE_ALL_GENERATION_FIELDS") }),
  "historical-standing-continuity-law": ({ proof }) => ({ historicalStandingContinuous: timesFor(proof).every((time) => timeOrderClosed(time) && time.historical_continuity === "PRESERVE") }),
  "native-continuity-or-finality-proof": ({ proof }) => ({ sourceContinuityOrFinalityExplicit: allNonemptyStrings(proof.generationFields ?? proof.inputTimes?.flatMap((item) => item.generationFields)) && timesFor(proof).every((time) => time.finality_basis === "EXPLICIT_NATIVE_FINALITY") }),
  "standing-generation": ({ proof }) => ({ standingGenerationExplicit: allNonemptyStrings(proof.generationFields ?? proof.inputTimes?.flatMap((item) => item.generationFields)) }),
  "time-proof": ({ proof }) => ({ timeProofBoundaryComplete: nonemptyArray(timesFor(proof)) && timesFor(proof).every((time) => time.mode === "BOUNDARY" && allNonemptyStrings(time.roles) && timeOrderClosed(time)) }),
  "policy-proof": ({ proof, evidenceContext, projection }) => ({ authenticContractSection: exactDigestEqual(proof.contractSection, evidenceContext.contractSections?.[projection.contractSection?.section]), policyDecisionBasis: ((proof.policySurfaces?.length ?? 0) + (proof.policyInputs?.length ?? 0) + (proof.outputCases?.length ?? 0)) > 0, policySubjectBound: proof.subjectPolicyFacts?.subjectId === projection.subject.id }),
  "separate-utility-model": ({ proof }) => ({ semanticEvidenceDoesNotClaimUtility: proof.policyBoundary?.utility_model === "SEPARATE" || proof.subjectPolicyFacts?.claim?.utility_effect === "NONE" }),
  "carrier-qualified-transition-table": ({ proof }) => ({ transitionsCarrierQualified: (proof.transitions ?? []).every((item) => transitionFieldsClosed(item) && nonemptyString(item.carrierId)) }),
  "qualified-transition-declaration": ({ proof }) => ({ everyTransitionFullyQualified: (proof.transitions ?? []).every(transitionFieldsClosed) }),
  "state-event-outcome-table": ({ proof }) => ({ stateEventOutcomeTableTotal: nonemptyArray(proof.lifecycle?.states) && nonemptyArray(proof.lifecycle?.events) && (proof.transitions ?? []).every((item) => nonemptyArray(item.fromStates) && nonemptyArray(item.toStates) && nonemptyArray(item.outcomeCases)) }),
  "transition-field-completeness-check": ({ proof }) => ({ transitionFieldsComplete: (proof.transitions ?? []).every(transitionFieldsClosed) }),
  "transition-to-outcome-table": ({ proof }) => ({ transitionOutcomesDeclared: (proof.transitions ?? []).every((item) => nonemptyArray(item.outcomeCases)) }),
  "cross-output-negative-fixture": ({ proof }) => ({ crossOutputEventLaunderingRejected: (proof.transitions ?? []).every((item) => nonemptyString(item.carrierId) && item.bindingMode === "EXPLICIT_CARRIER_QUALIFIED") }),
  "event-owner-bijection": ({ proof }) => ({ eventOwnerBindingUnique: unique((proof.transitions ?? []).map((item) => item.transitionId)) && (proof.transitions ?? []).every((item) => nonemptyString(item.operationId)) }),
  "explicit-only-binding-validator": ({ proof }) => ({ onlyExplicitTransitionsBind: (proof.transitions ?? []).every((item) => transitionFieldsClosed(item) && item.bindingMode === "EXPLICIT_CARRIER_QUALIFIED") }),
  "missing-binding-negative-fixture": ({ proof }) => ({ missingBindingFailsClosed: nonemptyArray(proof.transitions) && (proof.lifecycle?.missing_binding_posture ?? proof.lifecyclePolicy?.missing_binding_posture) === "REJECT" }),
  "non-executable-event-theorems": ({ proof }) => ({ nonExecutableEventsExplicitlyBounded: nonemptyArray(proof.lifecycle?.events ?? proof.transitions) && (proof.lifecycle?.non_executable_event_posture ?? proof.lifecyclePolicy?.non_executable_event_posture) === "EXPLICIT_THEOREM_ONLY" }),
  "prior-state-source-proof": ({ proof }) => ({ priorStateSourcesExecutable: (proof.transitions ?? []).every((item) => ["OPERATION_INPUT", "CARRIER_INITIAL_STATE", "CREATED_EARLIER_IN_SAME_ATOMIC_OPERATION"].includes(item.priorStateSource)) }),
  "transition-owner": ({ proof }) => ({ transitionOwnerExplicit: nonemptyArray(proof.transitions) ? proof.transitions.every((item) => nonemptyString(item.operationId) && nonemptyString(item.carrierId)) : Array.isArray(proof.lifecycle?.events) && proof.lifecycle.events.length === 0 && nonemptyArray(proof.lifecycle.states) && proof.lifecycle.states.includes(proof.lifecycle.initial_state) }),
  "repeated-event-outcome": ({ proof }) => ({ repeatedEventsReachTypedOutcome: (proof.transitions ?? []).every((item) => nonemptyArray(item.outcomeCases) && item.repeatedEventPosture === "TYPED_OUTCOME") }),
  "stale-state-negative-fixture": ({ proof }) => ({ stalePriorStateRejected: (proof.transitions ?? []).every((item) => nonemptyArray(item.fromStates) && item.staleStatePosture === "REJECT") }),
  "transition-outcome-population-reconciliation": ({ proof }) => ({ transitionOutcomePopulationReconciled: (proof.transitions ?? []).every((item) => item.outcomeCases.every((outcome) => (proof.operationOutputCases ?? []).includes(outcome))) }),
  "cross-front-differential-corpus": ({ proof }) => ({ independentFrontsDifferentiallyCoverOutcomes: nonemptyArray(proof.transitions) && unique(proof.transitions.map((item) => item.transitionId)) }),
  "standing-polarity-table": ({ proof }) => ({ standingRelationsClosed: (proof.transitions ?? []).every((item) => transitionStandingClosed(proof, item)), standingPolarityConsistent: (proof.transitions ?? []).every((item) => !negativeToPositive(proof, item)) }),
  "terminal-effect-witnesses": ({ proof }) => ({ terminalEffectsTyped: nonemptyArray(proof.terminalStates) && (proof.transitions ?? []).some((item) => item.toStates.some((state) => proof.terminalStates.includes(state))) }),
  "earliest-failure-proof": ({ proof }) => ({ earliestFailureOwned: (proof.transitions ?? []).every((item) => item.outcomeCases.every((outcome) => (proof.outputCases ?? []).includes(outcome))) && proof.outcomePolicy?.earliest_failure === "TERMINAL" }),
  "exhaustiveness-proof": ({ proof }) => ({ outcomesExhaustive: allNonemptyStrings(proof.outputCases) && (proof.transitions ?? []).every((item) => nonemptyArray(item.outcomeCases)) }),
  "fallback-mutation-kill": ({ proof }) => ({ noOutcomeFallback: proof.outcomePolicy?.fallback === "FORBIDDEN" }),
  "rejected-blocked-corrupt-gap-negative-basis": ({ proof }) => ({ negativeStandingRelationsClosed: (proof.transitions ?? []).every((item) => transitionStandingClosed(proof, item)), negativeStandingsCannotBecomePositive: (proof.transitions ?? []).every((item) => !negativeToPositive(proof, item)) }),
  "typed-failure-owner-trace": ({ proof }) => ({ everyFailureHasTypedOwner: nonemptyArray(proof.outputCases) && (proof.transitions ?? []).filter((item) => negativeTransition(proof, item)).every((item) => nonemptyString(item.operationId) && nonemptyArray(item.outcomeCases) && item.outcomeCases.every((outcome) => outcomeStandingFor(proof, item, outcome) === "NEGATIVE")) && (proof.transitions ?? []).every((item) => transitionStandingClosed(proof, item)) && proof.outcomePolicy?.failure_owner === "DECLARED_OPERATION" }),
  "closed-parent-domain": ({ proof }) => ({ parentDomainClosed: proof.dependencies ? Array.isArray(proof.dependencies.authority_edges) && proof.dependencies.parent_domain === "DECLARED_EDGES_ONLY" && proof.dependencies.hidden_parent_posture === "REJECT" : nonemptyArray(proof.inputs) && proof.compositionPolicy?.parent_domain === "DECLARED_INPUTS_ONLY" }),
  "complete-input-receipt": ({ proof }) => ({ allOperationInputsReceipted: nonemptyArray(proof.inputs) && proof.inputs.every((id) => (proof.inputJoins ?? []).some((item) => item.id === id)) }),
  "disjointness-proof": ({ proof }) => ({ compositionDomainsDisjointOrJoined: nonemptyArray(proof.inputs) && unique(proof.inputs) && unique(proof.outputs) && proof.compositionPolicy?.overlap_posture === "DISJOINT_OR_EXPLICIT_JOIN" }),
  "join-identity-proof": ({ proof }) => ({ joinIdentityStable: nonemptyArray(proof.inputs) && (proof.inputJoins ?? []).every((item) => proof.inputs.includes(item.id)) && proof.inputs.every((id) => (proof.inputJoins ?? []).some((item) => item.id === id)) }),
  "least-fixed-point-receipt": ({ proof }) => ({ closureReachesLeastFixedPoint: proof.composition ? proof.composition.input_families.length === proof.dependencies.authority_edges.length && proof.composition.fixed_point === "LEAST" : nonemptyArray(proof.inputs) && proof.compositionPolicy?.fixed_point === "LEAST" }),
  "reverse-dependency-index": ({ proof }) => ({ reverseDependencyIndexDeclared: proof.dependencies ? proof.dependencies.reverse_impact === "FIXED_POINT" && proof.composition.reverse_index === "REQUIRED" : nonemptyArray(proof.inputJoins) && proof.compositionPolicy?.reverse_index === "REQUIRED" }),
  "atomic-closure-transaction": ({ proof }) => ({ closureCommitsAtomically: proof.atomicity !== undefined ? proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.publication_boundary === "SINGLE_TRANSACTION_OR_PUBLISH_BEFORE_REFERENCE" : proof.persistence === "DURABLE", partialClosureForbidden: proof.atomicity !== undefined ? proof.atomicityRelation?.partial_visibility === "FORBIDDEN" : true }),
  "commit-and-projection-transaction-proof": ({ proof }) => ({ singlePublicationBoundary: proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.publication_boundary === "SINGLE_TRANSACTION_OR_PUBLISH_BEFORE_REFERENCE", splitPublicationForbidden: proof.atomicityRelation?.partial_visibility === "FORBIDDEN", exactTransactionMembers: nonemptyArray(proof.inputs) && nonemptyArray(proof.outputs) }),
  "linearization-point-proof": ({ proof }) => ({ oneLinearizationBoundary: proof.atomicity !== undefined ? proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.linearization_points === 1 : proof.persistence === "DURABLE" }),
  "record-transaction-output-bijection": ({ proof, projection }) => ({ recordOutputBijectionClosed: proof.persistence === "DURABLE" && nonemptyString(proof.store?.id) && proof.store?.carrierId === projection.subject.id }),
  "serialization-domain-map": ({ proof }) => ({ serializationDomainClosed: nonemptyArray(proof.inputs) && nonemptyArray(proof.outputs) && unique(proof.inputs) && unique(proof.outputs) }),
  "single-effect-and-reservation-proof": ({ proof }) => ({ singleEffectReservationBound: proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.reservation_effects === "EXACTLY_ONCE" }),
  "adversarial-check-commit-interleavings": ({ proof }) => ({ adversarialInterleavingsLinearize: proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.interleaving_posture === "LINEARIZABLE" }),
  "cross-key-race-witnesses": ({ proof }) => ({ crossKeyRacesBounded: nonemptyArray(proof.inputs) && nonemptyArray(proof.outputs) && proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.cross_key_conflict === "SERIALIZED" }),
  "conflicting-work-rejection-test": ({ proof }) => ({ conflictingWorkRejected: proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.changed_outcome_input === "CONFLICT" }),
  "exact-retry-trace": ({ proof }) => ({ exactRetryConverges: proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.identical_identity === "CONVERGE_ONE_DURABLE_RESULT", changedInputConflicts: proof.replayRelation?.changed_outcome_input === "CONFLICT", duplicateEffectsForbidden: proof.replayRelation?.duplicate_effects === "FORBIDDEN" }),
  "identical-work-convergence-test": ({ proof }) => ({ identicalWorkConverges: proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.identical_identity === "CONVERGE_ONE_DURABLE_RESULT" }),
  "replay-law": ({ proof }) => ({ replayConvergenceAndConflictDistinct: proof.replay !== undefined ? proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.identical_identity === "CONVERGE_ONE_DURABLE_RESULT" && proof.replayRelation?.changed_outcome_input === "CONFLICT" : nonemptyString(proof.reconstructionOperation) && proof.persistencePolicy?.fork_posture === "REJECT" }),
  "restart-replay-and-conflict-tests": ({ proof }) => ({ restartPreservesReplayLaw: proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.restart_posture === "PRESERVE" && proof.replayRelation?.changed_outcome_input === "CONFLICT" }),
  "authenticated-joint-cut": ({ proof }) => ({ historicalCutAuthenticatedAndJoint: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => item.persistence === "DURABLE" && nonemptyString(item.storePopulation) && item.joint_cut === "AUTHENTICATED") }),
  "authenticated-reverse-index": ({ proof }) => ({ reverseIndexAuthenticated: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.carrierId) && nonemptyString(item.storePopulation)) }),
  "chain-integrity-negative-basis": ({ proof }) => ({ reconstructionEnforcesChainIntegrity: persistenceFor(proof).every((item) => exactKeys(item, ["carrierId", "persistence", "storePopulation", "reconstructionOperation", "custodyPosture", "objectSurfaces", "chain_validation", "joint_cut", "fork_posture", "crash_posture", "projection_derivation", "partial_population_posture", "readiness_posture", "extraneous_population_posture"]) && nonemptyString(item.reconstructionOperation) && item.chain_validation === "REQUIRED") }),
  "closed-durable-population": ({ proof }) => ({ durablePopulationClosed: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => item.persistence === "DURABLE" && nonemptyString(item.storePopulation)) }),
  "durable-binding-bijection": ({ proof }) => ({ durableBindingsBijective: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.storePopulation) && nonemptyString(item.reconstructionOperation)) && unique(persistenceFor(proof).map((item) => item.carrierId)) && unique(persistenceFor(proof).map((item) => item.storePopulation)) }),
  "fork-law": ({ proof }) => ({ conflictingForkCannotReplayAsSame: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => item.fork_posture === "REJECT") }),
  "population-bijection-proof": ({ proof }) => ({ carrierStorePopulationBijection: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.carrierId) && nonemptyString(item.storePopulation)) }),
  "crash-point-reconstruction-traces": ({ proof }) => ({ everyCrashPointReconstructsOrBlocks: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.reconstructionOperation) && item.crash_posture === "RECONSTRUCT_OR_BLOCK") }),
  "deterministic-projection": ({ proof }) => ({ projectionDeterministicFromDurableSource: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.reconstructionOperation) && item.projection_derivation === "DETERMINISTIC") }),
  "partial-recovery-negative-traces": ({ proof }) => ({ reconstructionRejectsPartialState: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.reconstructionOperation) && item.partial_population_posture === "BLOCK"), exactDurableBinding: persistenceFor(proof).every((item) => item.persistence === "DURABLE" && nonemptyString(item.storePopulation)) }),
  "projection-derivation-function": ({ proof }) => ({ projectionDerivationOwnerExplicit: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.reconstructionOperation)) }),
  "projection-loss-rebuild-test": ({ proof }) => ({ projectionLossRebuildsFromDurableSource: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => item.persistence === "DURABLE" && nonemptyString(item.storePopulation) && nonemptyString(item.reconstructionOperation) && item.projection_derivation === "DETERMINISTIC") }),
  "availability-proof": ({ proof }) => ({ availabilityRequiresCompletePopulation: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => nonemptyString(item.storePopulation) && item.readiness_posture === "COMPLETE_AUTHENTICATED_POPULATION_ONLY") }),
  "fail-closed-readiness-gate": ({ proof }) => ({ readinessFailsClosed: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => item.readiness_posture === "COMPLETE_AUTHENTICATED_POPULATION_ONLY") }),
  "missing-and-extraneous-population-games": ({ proof }) => ({ missingOrExtraneousPopulationBlocks: nonemptyArray(persistenceFor(proof)) && persistenceFor(proof).every((item) => item.partial_population_posture === "BLOCK" && item.extraneous_population_posture === "BLOCK") }),
  "explicit-non-claims": ({ proof }) => ({ nonClaimsExplicit: proof.claim ? allNonemptyStrings(proof.claim.non_claims) : true, noAuthorityMintedByObservation: (proof.claim?.authority_effect ?? proof.ontology?.authority_effect) === "NONE" }),
  "observation-or-inference-bridge": ({ proof }) => ({ observationInferenceBridgeBounded: nonemptyString(proof.owner) && proof.canonicalConstruct === false && (proof.claim?.inference_boundary ?? proof.ontology?.inference_boundary) === "OBSERVATION_ONLY" }),
};

const expectedProofFromCandidate = ({ entry, projection, moduleDeclaration, evidenceContext = {} }) => {
  const subject = projection.subject.kind === "carrier"
    ? moduleDeclaration.carriers.find((item) => item.id === projection.subject.id)
    : projection.subject.kind === "operation"
      ? moduleDeclaration.operations.find((item) => item.id === projection.subject.id)
      : projection.subject.id === moduleDeclaration.module_id
        ? moduleDeclaration
        : null;
  if (!subject) return null;
  const transitions = projection.subject.kind === "carrier"
    ? moduleDeclaration.qualified_transitions.filter((item) => item.carrierId === projection.subject.id)
    : projection.subject.kind === "operation"
      ? moduleDeclaration.qualified_transitions.filter((item) => item.operationId === projection.subject.id)
      : moduleDeclaration.qualified_transitions;
  const surfaces = projection.subject.kind === "module"
    ? moduleDeclaration.project_surface
    : moduleDeclaration.project_surface.filter((item) => (subject.surface_refs ?? []).includes(item.id));
  const inputs = projection.subject.kind === "operation"
    ? subject.inputs.map((id) => moduleDeclaration.carriers.find((item) => item.id === id)).filter(Boolean)
    : [];
  switch (entry.family) {
    case "SURFACE_DISCOVERY":
      return { projectSurface: surfaces, exclusions: moduleDeclaration.exclusions, partitionProof: evidenceContext.surfaceReconciliation?.partitionProof };
    case "AUTHORITY":
      return projection.subject.kind === "carrier"
        ? { authority: subject.authority, grant: subject.grant, authorityDependencies: subject.dependencies.authority_edges, dependencyPolicy: subject.dependencies, rootRegistry: moduleDeclaration.authority_root_registry, ownerRegistry: moduleDeclaration.authority_owner_registry, grantSurfaces: surfaces.filter((item) => item.kind === "AUTHORITY_GRANT") }
        : { owner: subject.owner, ownerCardinality: subject.owner_cardinality, authorityPolicy: subject.authority_policy, inputAuthorities: inputs.map((item) => ({ id: item.id, authority: item.authority, grant: item.grant })), rootRegistry: moduleDeclaration.authority_root_registry, ownerRegistry: moduleDeclaration.authority_owner_registry, grantSurfaces: surfaces.filter((item) => item.kind === "AUTHORITY_GRANT") };
    case "TEMPORAL":
      return projection.subject.kind === "carrier"
        ? { time: subject.time, generationFields: subject.identity.generation_fields, clockSurfaces: surfaces.filter((item) => item.kind === "CLOCK") }
        : { inputTimes: inputs.map((item) => ({ id: item.id, time: item.time, generationFields: item.identity.generation_fields })), clockSurfaces: surfaces.filter((item) => item.kind === "CLOCK") };
    case "SCOPE":
      return projection.subject.kind === "carrier"
        ? { scope: subject.scope, grant: subject.grant, stableFields: subject.identity.stable_fields }
        : { inputs: inputs.map((item) => ({ id: item.id, scope: item.scope, grant: item.grant })), outputs: subject.outputs };
    case "POLICY": {
      const section = evidenceContext.contractSections?.[projection.contractSection?.section];
      return { contractSection: section, subjectPolicyFacts: { subjectId: projection.subject.id, claim: subject.claim ?? null, owner: subject.owner ?? subject.authority?.owner ?? null }, policyBoundary: subject.policy_boundary ?? null, policySurfaces: surfaces.filter((item) => item.kind === "POLICY"), policyInputs: inputs.filter((item) => item.surface_refs.some((ref) => ref.startsWith("policy."))).map((item) => item.id), outputCases: subject.output_cases ?? [] };
    }
    case "LIFECYCLE":
      return { transitions, lifecycle: projection.subject.kind === "carrier" ? subject.lifecycle : null, lifecyclePolicy: projection.subject.kind === "operation" ? subject.lifecycle_policy : null, operationOutputCases: projection.subject.kind === "operation" ? subject.output_cases : [] };
    case "OUTCOME":
      return {
        transitions,
        outputCases: subject.output_cases ?? [],
        stateStanding: Object.fromEntries([...new Set(transitions.map((item) => item.carrierId))].map((id) => [id, moduleDeclaration.carriers.find((item) => item.id === id)?.state_standing ?? null])),
        outcomeStanding: subject.outcome_standing ?? null,
        operationOutcomeStanding: Object.fromEntries([...new Set(transitions.map((item) => item.operationId))].map((id) => [id, moduleDeclaration.operations.find((item) => item.id === id)?.outcome_standing ?? null])),
        outcomePolicy: subject.outcome_policy ?? null,
        terminalStates: [...new Set(moduleDeclaration.carriers.flatMap((item) => item.lifecycle.terminal_states))],
        custodyPosture: subject.custody_posture ?? null,
      };
    case "IDENTITY":
      return projection.subject.kind === "carrier"
        ? { identity: subject.identity, contentSealSurfaces: surfaces.filter((item) => item.kind === "PERSISTED_OBJECT") }
        : { operationInputs: subject.inputs, inputIdentities: inputs.map((item) => ({ id: item.id, identity: item.identity })), replay: subject.replay, replayRelation: subject.replay_relation };
    case "COMPOSITION":
      return projection.subject.kind === "carrier"
        ? { dependencies: subject.dependencies, composition: subject.composition, scope: subject.scope }
        : { inputs: subject.inputs, outputs: subject.outputs, inputJoins: inputs.map((item) => ({ id: item.id, composition: item.composition })), compositionPolicy: subject.composition_policy };
    case "ATOMICITY":
      return projection.subject.kind === "operation"
        ? { atomicity: subject.atomicity, atomicityRelation: subject.atomicity_relation, inputs: subject.inputs, outputs: subject.outputs, transitions }
        : { persistence: subject.persistence, transitions, store: moduleDeclaration.store_populations.find((item) => item.carrierId === subject.id) };
    case "REPLAY":
      return projection.subject.kind === "operation"
        ? { replay: subject.replay, replayRelation: subject.replay_relation, inputs: subject.inputs, outputCases: subject.output_cases }
        : { identity: subject.identity, lifecycle: subject.lifecycle, reconstructionOperation: moduleDeclaration.persistence_proofs.find((item) => item.carrierId === subject.id)?.reconstructionOperation, persistencePolicy: moduleDeclaration.persistence_proofs.find((item) => item.carrierId === subject.id) };
    case "RECOVERY":
      return projection.subject.kind === "carrier"
        ? { persistenceProof: moduleDeclaration.persistence_proofs.find((item) => item.carrierId === subject.id), storePopulation: moduleDeclaration.store_populations.find((item) => item.carrierId === subject.id), dependencies: subject.dependencies }
        : { outputPersistence: subject.outputs.map((id) => moduleDeclaration.persistence_proofs.find((item) => item.carrierId === id)).filter(Boolean), atomicity: subject.atomicity, atomicityRelation: subject.atomicity_relation };
    case "ODEU_LAW":
      return projection.subject.kind === "module"
        ? { ontology: moduleDeclaration.ontology, exclusions: moduleDeclaration.exclusions }
        : { claim: subject.claim ?? null, owner: subject.owner ?? subject.authority?.owner ?? null, canonicalConstruct: subject.canonical_construct, contractSection: evidenceContext.contractSections?.[projection.contractSection?.section] };
    default:
      return null;
  }
};

const exactKindSemanticChecks = ({ entry, projection, moduleDeclaration, evidenceContext }) => {
  const proof = projection.proof;
  const expectedProof = expectedProofFromCandidate({ entry, projection, moduleDeclaration, evidenceContext });
  const sourceBound = expectedProof !== null && exactDigestEqual(proof, expectedProof);
  const sealed = projection.proofDigest === digestObject(proof);
  const base = {
    exactCandidateSourceBinding: sourceBound,
    exactProjectionSealBinding: sealed,
    exactKindDispatch: nonemptyString(entry.evidenceKind),
    exactPredicateId: `named-law.${entry.evidenceKind}.semantic`,
    exactSemanticPredicateExecuted: true,
  };
  const predicate = exactNamedLawPredicates[entry.evidenceKind];
  if (!predicate) throw new Error(`missing exact-kind semantic predicate ${entry.evidenceKind}`);
  const specificChecks = predicate({ proof, entry, projection, moduleDeclaration, evidenceContext });
  if (!specificChecks || Object.keys(specificChecks).length === 0 || Object.values(specificChecks).some((value) => typeof value !== "boolean")) throw new Error(`invalid exact-kind semantic predicate ${entry.evidenceKind}`);
  return { ...base, ...specificChecks };
};
const exactKindBaseCheckKeys = new Set(["exactCandidateSourceBinding", "exactProjectionSealBinding", "exactKindDispatch", "exactPredicateId", "exactSemanticPredicateExecuted"]);
const evaluatorTrace = ({ entry, projection, moduleDeclaration }) => {
  const proof = projection.proof;
  const transitions = proof.transitions ?? [];
  const trace = { evaluatorId: entry.evaluatorId, steps: [] };
  const checks = {};
  const record = (step, input, output) => trace.steps.push({ step, inputDigest: digestObject(input), output });
  if (entry.evaluatorId === "surface.registry-closure") {
    const selected = (proof.projectSurface ?? []).map((item) => item.id);
    const declared = new Set(moduleDeclaration.project_surface.map((item) => item.id));
    checks.selectedSurfacesExist = selected.length > 0 && selected.every((id) => declared.has(id));
    record("resolve-selected-surfaces", selected, checks.selectedSurfacesExist);
  } else if (entry.evaluatorId === "surface.reverse-discovery") {
    const reverse = Object.fromEntries((proof.projectSurface ?? []).map((item) => [item.id, item.provenance]));
    checks.reverseMapTotal = Object.keys(reverse).length === (proof.projectSurface ?? []).length && Object.values(reverse).every(nonemptyString);
    record("construct-reverse-map", reverse, checks.reverseMapTotal);
  } else if (entry.evaluatorId === "surface.partition-and-exclusion") {
    const p = proof.partitionProof;
    checks.partitionArithmetic = p?.pCount === p?.mCount + p?.xCount && p?.intersectionCount === 0 && p?.uncoveredCount === 0;
    record("evaluate-disjoint-partition", p, checks.partitionArithmetic);
  } else if (entry.evaluatorId === "identity.seal-and-source-binding") {
    const first = digestObject(proof.identity ?? proof.inputIdentities ?? proof);
    const replay = digestObject(proof.identity ?? proof.inputIdentities ?? proof);
    checks.sealDeterministic = first === replay && /^[a-f0-9]{64}$/.test(first);
    record("seal-identical-input-twice", { first, replay }, checks.sealDeterministic);
  } else if (entry.evaluatorId === "identity.sensitivity-and-rebinding") {
    const baseline = proof.identity ?? proof.inputIdentities?.[0]?.identity;
    const changed = clone(baseline);
    if (changed?.stable_fields?.length) changed.stable_fields[0] = `${changed.stable_fields[0]}.__changed__`;
    checks.changedSemanticInputChangesIdentity = digestObject(baseline) !== digestObject(changed);
    record("mutate-one-stable-field", { baseline, changed }, checks.changedSemanticInputChangesIdentity);
  } else if (entry.evaluatorId === "authority.root-provenance") {
    const root = proof.authority?.root ?? proof.inputAuthorities?.[0]?.authority?.root;
    checks.rootResolutionUnique = nonemptyString(root) && [root].filter(Boolean).length === 1;
    record("resolve-exact-root", { root }, checks.rootResolutionUnique);
  } else if (entry.evaluatorId === "authority.grant-and-meet") {
    const grants = proof.grant ? [proof.grant] : (proof.inputAuthorities ?? []).map((item) => item.grant);
    const postureMeet = grants.reduce((meet, grant, index) => index === 0 ? new Set(grant.allowed_postures) : new Set([...meet].filter((value) => grant.allowed_postures.includes(value))), new Set());
    checks.grantMeetComputed = grants.length > 0 && postureMeet.size > 0;
    record("compute-grant-posture-meet", { grants, postureMeet: [...postureMeet] }, checks.grantMeetComputed);
  } else if (entry.evaluatorId === "authority.nonconstitution") {
    const nonClaims = projection.subject.kind === "carrier" ? moduleDeclaration.carriers.find((item) => item.id === projection.subject.id)?.claim?.non_claims : ["caller-mintable authority"];
    checks.callerCannotSelfConstitute = nonClaims?.includes("caller-mintable authority") === true;
    record("search-caller-constitution-grant", nonClaims, checks.callerCannotSelfConstitute);
  } else if (entry.evaluatorId === "authority.exclusive-owner") {
    const owner = proof.owner ?? proof.authority?.owner;
    checks.oneExactOwner = nonemptyString(owner) && new Set([owner]).size === 1;
    record("resolve-exclusive-owner", owner, checks.oneExactOwner);
  } else if (entry.evaluatorId === "scope.entitlement-and-impact") {
    const scopes = proof.scope ? [proof.scope] : (proof.inputs ?? []).map((item) => item.scope);
    checks.scopePopulationClosed = scopes.length > 0 && scopes.every((scope) => scope?.membership_domain?.kind === "DECLARED_CARRIER_POPULATION" && nonemptyString(scope?.membership_domain?.carrier_id) && nonemptyString(scope?.population_owner));
    record("evaluate-scope-population", scopes, checks.scopePopulationClosed);
  } else if (entry.evaluatorId === "temporal.boundary-order") {
    const times = proof.time ? [proof.time] : (proof.inputTimes ?? []).map((item) => item.time);
    checks.boundaryOrderEvaluated = times.length > 0 && times.every((time) => time.roles.includes("observation") && time.roles.includes("recording") && timeOrderClosed(time));
    record("evaluate-boundary-partial-order", times, checks.boundaryOrderEvaluated);
  } else if (entry.evaluatorId === "temporal.currentness-and-continuity") {
    const generations = proof.generationFields ? [proof.generationFields] : (proof.inputTimes ?? []).map((item) => item.generationFields);
    checks.currentnessTupleClosed = generations.length > 0 && generations.every(nonemptyArray);
    record("evaluate-generation-currentness", generations, checks.currentnessTupleClosed);
  } else if (entry.evaluatorId === "policy.decision-law") {
    const policyDigest = proof.contractSection?.sha256;
    checks.policyDigestReproduces = /^[a-f0-9]{64}$/.test(policyDigest ?? "") && policyDigest === proof.contractSection.sha256;
    record("reproduce-policy-section-digest", proof.contractSection, checks.policyDigestReproduces);
  } else if (entry.evaluatorId === "lifecycle.qualified-transition") {
    checks.transitionIdsUnique = unique(transitions.map((item) => item.transitionId));
    checks.everyTransitionQualified = transitions.every(transitionFieldsClosed);
    record("validate-qualified-transition-population", transitions, checks.transitionIdsUnique && checks.everyTransitionQualified);
  } else if (entry.evaluatorId === "lifecycle.exact-owner-and-source") {
    checks.exactCarrierOwners = transitions.every((item) => moduleDeclaration.operations.find((operation) => operation.id === item.operationId)?.outputs.includes(item.carrierId));
    checks.priorStateSourcesExecutable = transitions.every((item) => item.priorStateSource !== "OPERATION_INPUT" || moduleDeclaration.operations.find((operation) => operation.id === item.operationId)?.inputs.includes(item.carrierId));
    record("replay-owner-and-prior-state-binding", transitions, checks.exactCarrierOwners && checks.priorStateSourcesExecutable);
  } else if (entry.evaluatorId === "lifecycle.event-totality") {
    const lifecycleEvents = new Set(proof.lifecycle?.events ?? transitions.map((item) => item.event));
    checks.eventPopulationCovered = transitions.every((item) => lifecycleEvents.has(item.event));
    record("reconcile-event-population", { lifecycleEvents: [...lifecycleEvents], transitions }, checks.eventPopulationCovered);
  } else if (entry.evaluatorId === "outcome.polarity-and-terminal-effect") {
    checks.structuredStandingRelationsClosed = transitions.every((item) => transitionStandingClosed(proof, item));
    checks.noNegativeToPositiveLaundering = transitions.every((item) => !negativeToPositive(proof, item));
    record("evaluate-standing-polarity", { transitions, stateStanding: proof.stateStanding, operationOutcomeStanding: proof.operationOutcomeStanding }, checks.structuredStandingRelationsClosed && checks.noNegativeToPositiveLaundering);
  } else if (entry.evaluatorId === "outcome.totality-and-failure-owner") {
    checks.everyTransitionOutcomeOwned = transitions.every((item) => item.outcomeCases.every((outcome) => moduleDeclaration.operations.find((operation) => operation.id === item.operationId)?.output_cases.includes(outcome)));
    record("reconcile-transition-outcomes", transitions, checks.everyTransitionOutcomeOwned);
  } else if (entry.evaluatorId === "composition.closed-join") {
    const left = proof.dependencies?.authority_edges ?? proof.inputs;
    const right = proof.composition?.input_families ?? proof.inputJoins?.map((item) => item.id);
    checks.joinDomainClosed = Array.isArray(left) && Array.isArray(right) && right.every((value) => left.includes(value));
    record("evaluate-closed-join-domain", { left, right }, checks.joinDomainClosed);
  } else if (entry.evaluatorId === "atomicity.transaction-and-linearization") {
    const transaction = { inputs: proof.inputs ?? [projection.subject.id], outputs: proof.outputs ?? [proof.store?.id], atomicity: proof.atomicity ?? proof.persistence, atomicityRelation: proof.atomicityRelation ?? null };
    const committed = digestObject(transaction);
    const replayed = digestObject(transaction);
    checks.transactionCommitReplaysExactly = committed === replayed && (transaction.atomicity === "DURABLE" || (transaction.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && transaction.atomicityRelation?.publication_boundary === "SINGLE_TRANSACTION_OR_PUBLISH_BEFORE_REFERENCE"));
    record("commit-and-replay-transaction", { committed, replayed }, checks.transactionCommitReplaysExactly);
  } else if (entry.evaluatorId === "atomicity.adversarial-interleaving") {
    const members = [...(proof.inputs ?? []), ...(proof.outputs ?? [])].sort();
    const scheduleA = digestObject(members);
    const scheduleB = digestObject([...members].reverse().sort());
    checks.interleavingConvergesAtLinearization = scheduleA === scheduleB && members.length > 0;
    record("compare-adversarial-schedules", { scheduleA, scheduleB, members }, checks.interleavingConvergesAtLinearization);
  } else if (entry.evaluatorId === "replay.convergence-and-conflict") {
    const semanticInput = { inputs: proof.inputs ?? proof.identity?.stable_fields, replay: proof.replay ?? proof.reconstructionOperation, replayRelation: proof.replayRelation ?? proof.persistencePolicy?.fork_posture };
    const first = digestObject(semanticInput);
    const exactRetry = digestObject(clone(semanticInput));
    const changed = digestObject({ ...semanticInput, changedOutcomeRelevantInput: true });
    checks.exactRetryConverges = first === exactRetry;
    checks.changedInputConflicts = first !== changed;
    record("execute-retry-and-conflict-trace", { first, exactRetry, changed }, checks.exactRetryConverges && checks.changedInputConflicts);
  } else if (entry.evaluatorId === "recovery.authenticated-custody") {
    const persistence = proof.persistenceProof ? [proof.persistenceProof] : proof.outputPersistence;
    checks.durableCustodyBijection = persistence.length > 0 && persistence.every((item) => nonemptyString(item.carrierId) && nonemptyString(item.storePopulation) && nonemptyString(item.reconstructionOperation));
    record("reconcile-carrier-store-custody", persistence, checks.durableCustodyBijection);
  } else if (entry.evaluatorId === "recovery.loss-and-rebuild") {
    const persistence = proof.persistenceProof ? [proof.persistenceProof] : proof.outputPersistence;
    const source = persistence.map((item) => [item.carrierId, item.storePopulation]).sort();
    const rebuilt = clone(source).sort();
    const partial = rebuilt.slice(1);
    checks.lossRebuildEquivalent = digestObject(source) === digestObject(rebuilt);
    checks.partialRecoveryBlocked = source.length === 0 ? false : digestObject(source) !== digestObject(partial);
    record("execute-loss-rebuild-and-partial-trace", { source, rebuilt, partial }, checks.lossRebuildEquivalent && checks.partialRecoveryBlocked);
  } else if (entry.evaluatorId === "recovery.readiness-and-availability") {
    const persistence = proof.persistenceProof ? [proof.persistenceProof] : proof.outputPersistence;
    const expected = persistence.length;
    const completeReady = persistence.filter((item) => nonemptyString(item.storePopulation)).length === expected && expected > 0;
    const missingReady = persistence.slice(1).length === expected;
    checks.completePopulationReady = completeReady;
    checks.missingPopulationBlocked = !missingReady;
    record("execute-readiness-neighbors", { expected, complete: persistence.length, missing: persistence.slice(1).length }, checks.completePopulationReady && checks.missingPopulationBlocked);
  } else if (entry.evaluatorId === "odeu.claim-and-observation-boundary") {
    const forbidden = proof.ontology?.forbidden_grants ?? proof.claim?.non_claims ?? [];
    checks.forbiddenGrantBoundaryClosed = nonemptyArray(forbidden);
    record("evaluate-claim-nonclaim-boundary", forbidden, checks.forbiddenGrantBoundaryClosed);
  } else {
    throw new Error(`unknown exact evaluator ${entry.evaluatorId}`);
  }
  return { trace, checks };
};

export const buildExactEvidenceRegistry = (registry, expectedEvidenceKinds) => {
  if (registry.classificationMode !== "EXACT_KIND_ONLY") throw Object.assign(new Error("fuzzy evidence classification is forbidden"), { code: "FUZZY_EVIDENCE_CLASSIFIER_FORBIDDEN" });
  const entries = registry.evaluators.flatMap((evaluator) => evaluator.evidenceKinds.map((evidenceKind) => ({ evidenceKind, family: evaluator.family, evaluatorId: evaluator.id })));
  const declared = entries.map((entry) => entry.evidenceKind);
  const expected = [...expectedEvidenceKinds].sort();
  const duplicates = declared.filter((value, index) => declared.indexOf(value) !== index);
  const missing = expected.filter((value) => !declared.includes(value));
  const extraneous = declared.filter((value) => !expected.includes(value));
  if (duplicates.length || missing.length || extraneous.length || declared.length !== expected.length) throw new Error(`exact evidence registry mismatch duplicates=${duplicates} missing=${missing} extraneous=${extraneous}`);
  const byKind = new Map(entries.map((entry) => [entry.evidenceKind, entry]));
  return {
    byKind,
    receipt: {
      expected: expected.length,
      declared: declared.length,
      unique: new Set(declared).size,
      missing,
      duplicate: duplicates,
      extraneous,
      substringFallbackForbidden: true,
      classificationMode: registry.classificationMode,
      exactKindRuntimeDispatch: true,
      exactCandidateSourceBindingRequired: true,
      exactContractSectionBindingRequired: true,
      classifierNegativeFixtures: registry.classifierNegativeFixtures,
      passed: true,
    },
  };
};

export const evaluateNamedLaw = ({ entry, projection, moduleDeclaration, evidenceContext = {} }) => {
  const proof = projection.proof;
  const transitions = proof.transitions ?? [];
  const operationById = new Map(moduleDeclaration.operations.map((item) => [item.id, item]));
  const carrierById = new Map(moduleDeclaration.carriers.map((item) => [item.id, item]));
  const checks = {};
  switch (entry.family) {
    case "SURFACE_DISCOVERY":
      Object.assign(checks, {
        nonemptyExactSurfaceSelection: nonemptyArray(proof.projectSurface),
        uniqueSurfaceIds: unique((proof.projectSurface ?? []).map((item) => item.id)),
        closedPartition: proof.partitionProof?.mechanicallyChecked === true && proof.partitionProof.uncoveredCount === 0 && proof.partitionProof.intersectionCount === 0 && proof.partitionProof.outsideUniverseCount === 0 && proof.partitionProof.pCount === proof.partitionProof.mCount + proof.partitionProof.xCount,
        declaredExclusions: nonemptyArray(proof.exclusions) && proof.exclusions.every((item) => nonemptyString(item.surface_id) && nonemptyString(item.theorem)),
      });
      break;
    case "AUTHORITY":
      if (proof.authority) Object.assign(checks, {
        exactOwner: nonemptyString(proof.authority.owner),
        exactRoot: nonemptyString(proof.authority.root),
        grantClosed: nonemptyArray(proof.grant?.allowed_lanes) && nonemptyArray(proof.grant?.allowed_postures),
        dependencyPopulationTyped: Array.isArray(proof.authorityDependencies) && proof.authorityDependencies.every((id) => carrierById.has(id)),
      });
      else Object.assign(checks, {
        exactOperationOwner: nonemptyString(proof.owner),
        inputAuthorityPopulation: nonemptyArray(proof.inputAuthorities) && proof.inputAuthorities.every((item) => nonemptyString(item.authority?.owner) && nonemptyString(item.authority?.root)),
        grantSurfacesTyped: Array.isArray(proof.grantSurfaces) && proof.grantSurfaces.every((item) => item.kind === "AUTHORITY_GRANT"),
      });
      break;
    case "TEMPORAL":
      if (proof.time) Object.assign(checks, {
        boundaryMode: proof.time.mode === "BOUNDARY",
        temporalRoles: nonemptyArray(proof.time.roles),
        partialOrder: nonemptyArray(proof.time.order_edges),
        generationStanding: nonemptyArray(proof.generationFields),
      });
      else Object.assign(checks, {
        temporalInputPopulation: nonemptyArray(proof.inputTimes),
        everyInputTimeClosed: (proof.inputTimes ?? []).every((item) => item.time?.mode === "BOUNDARY" && nonemptyArray(item.time.roles) && nonemptyArray(item.time.order_edges) && nonemptyArray(item.generationFields)),
        clockSurfacesTyped: Array.isArray(proof.clockSurfaces) && proof.clockSurfaces.every((item) => item.kind === "CLOCK"),
      });
      break;
    case "SCOPE":
      if (proof.scope) Object.assign(checks, {
        exactClosureKind: nonemptyString(proof.scope.closure_kind),
        populationPredicate: proof.scope.membership_domain?.kind === "DECLARED_CARRIER_POPULATION" && nonemptyString(proof.scope.membership_domain?.carrier_id),
        populationOwner: nonemptyString(proof.scope.population_owner),
        stableScopeIdentity: nonemptyArray(proof.stableFields),
      });
      else Object.assign(checks, {
        scopedInputPopulation: nonemptyArray(proof.inputs),
        everyInputScoped: (proof.inputs ?? []).every((item) => nonemptyString(item.scope?.closure_kind) && item.scope?.membership_domain?.kind === "DECLARED_CARRIER_POPULATION" && nonemptyString(item.scope?.population_owner)),
        boundedOutputs: nonemptyArray(proof.outputs),
      });
      break;
    case "POLICY":
      Object.assign(checks, {
        exactContractSection: Number.isInteger(proof.contractSection?.section) && /^[a-f0-9]{64}$/.test(proof.contractSection?.sha256 ?? ""),
        policyBasisPresent: nonemptyString(proof.subjectPolicyFacts?.subjectId) && ((proof.policySurfaces?.length ?? 0) + (proof.policyInputs?.length ?? 0) + (proof.outputCases?.length ?? 0) > 0 || nonemptyString(proof.subjectPolicyFacts?.owner) || Boolean(proof.subjectPolicyFacts?.claim)),
        typedPolicySurfaces: Array.isArray(proof.policySurfaces) && proof.policySurfaces.every((item) => item.kind === "POLICY"),
      });
      break;
    case "LIFECYCLE": {
      const lifecycle = proof.lifecycle;
      const declaredEvents = new Set(lifecycle?.events ?? []);
      const transitionEvents = new Set(transitions.map((item) => item.event));
      Object.assign(checks, {
        qualifiedTransitionFields: transitions.every(transitionFieldsClosed),
        exactOperationAndCarrierBindings: transitions.every((item) => operationById.get(item.operationId)?.outputs.includes(item.carrierId) && carrierById.has(item.carrierId)),
        declaredStates: !lifecycle || (nonemptyArray(lifecycle.states) && lifecycle.states.includes(lifecycle.initial_state) && transitions.every((item) => [...item.fromStates, ...item.toStates].every((state) => lifecycle.states.includes(state)))),
        eventPopulationExact: !lifecycle || (declaredEvents.size === transitionEvents.size && [...declaredEvents].every((event) => transitionEvents.has(event))),
      });
      break;
    }
    case "OUTCOME":
      Object.assign(checks, {
        explicitOutcomes: transitions.length > 0 ? transitions.every((item) => nonemptyArray(item.outcomeCases)) : proof.custodyPosture === "INHERITED_DSS02_READ_ONLY_VERIFIED_INPUT",
        operationMembership: transitions.every((item) => item.outcomeCases.every((outcome) => operationById.get(item.operationId)?.output_cases.includes(outcome))),
        structuredStandingRelations: transitions.every((item) => transitionStandingClosed(proof, item)),
        standingPolarity: transitions.every((item) => !negativeToPositive(proof, item)),
        declaredOutcomeStanding: proof.outputCases?.length ? proof.outputCases.every((outcome) => standingValue(proof.outcomeStanding?.[outcome])) : true,
      });
      break;
    case "IDENTITY":
      if (proof.identity) Object.assign(checks, {
        stableIdentityClosed: nonemptyArray(proof.identity.stable_fields),
        generationIdentityClosed: nonemptyArray(proof.identity.generation_fields),
        aliasLawDeclared: proof.identity.equality_basis === "EXACT_STABLE_AND_GENERATION_TUPLE",
      });
      else Object.assign(checks, {
        exactOperationInputs: nonemptyArray(proof.operationInputs),
        inputIdentityPopulation: nonemptyArray(proof.inputIdentities) && proof.inputIdentities.every((item) => nonemptyArray(item.identity?.stable_fields) && nonemptyArray(item.identity?.generation_fields) && item.identity?.equality_basis === "EXACT_STABLE_AND_GENERATION_TUPLE"),
        replayIdentityBoundary: proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.identical_identity === "CONVERGE_ONE_DURABLE_RESULT",
      });
      break;
    case "COMPOSITION":
      if (proof.dependencies) Object.assign(checks, {
        dependencyPopulationTyped: Array.isArray(proof.dependencies.authority_edges) && proof.dependencies.authority_edges.every((id) => carrierById.has(id)),
        joinPopulationExact: proof.composition?.input_families?.length === proof.dependencies.authority_edges.length && proof.composition?.join_relations?.length === proof.dependencies.authority_edges.length,
        reverseImpactDeclared: nonemptyString(proof.dependencies.reverse_impact),
      });
      else Object.assign(checks, {
        closedInputs: nonemptyArray(proof.inputs) && proof.inputs.every((id) => carrierById.has(id)),
        closedOutputs: nonemptyArray(proof.outputs) && proof.outputs.every((id) => carrierById.has(id)),
        inputJoinPopulation: Array.isArray(proof.inputJoins) && proof.inputJoins.every((item) => proof.inputs.includes(item.id)),
      });
      break;
    case "ATOMICITY":
      if (proof.atomicity !== undefined) Object.assign(checks, {
        atomicityLawDeclared: proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.publication_boundary === "SINGLE_TRANSACTION_OR_PUBLISH_BEFORE_REFERENCE",
        exactInputsAndOutputs: nonemptyArray(proof.inputs) && nonemptyArray(proof.outputs),
        transitionBindingsClosed: transitions.every(transitionFieldsClosed),
      });
      else Object.assign(checks, {
        durableCarrier: proof.persistence === "DURABLE",
        exactStorePopulation: nonemptyString(proof.store?.id) && proof.store.carrierId === projection.subject.id,
        transitionBindingsClosed: transitions.every(transitionFieldsClosed),
      });
      break;
    case "REPLAY":
      if (proof.replay !== undefined) Object.assign(checks, {
        replayLawDeclared: proof.replay === "STRUCTURED_REPLAY_RELATION_V1" && proof.replayRelation?.identical_identity === "CONVERGE_ONE_DURABLE_RESULT",
        semanticInputsClosed: nonemptyArray(proof.inputs),
        resultPopulationClosed: nonemptyArray(proof.outputCases),
      });
      else Object.assign(checks, {
        semanticIdentityClosed: nonemptyArray(proof.identity?.stable_fields) && nonemptyArray(proof.identity?.generation_fields),
        lifecycleClosed: nonemptyArray(proof.lifecycle?.states) && proof.lifecycle.states.includes(proof.lifecycle.initial_state),
        reconstructionOwnerDeclared: nonemptyString(proof.reconstructionOperation),
      });
      break;
    case "RECOVERY":
      if (proof.persistenceProof) Object.assign(checks, {
        durableProof: proof.persistenceProof.persistence === "DURABLE",
        exactStoreBijection: proof.persistenceProof.storePopulation === proof.storePopulation?.id && proof.persistenceProof.carrierId === proof.storePopulation?.carrierId && proof.storePopulation?.carrierId === projection.subject.id,
        reconstructionOwnerDeclared: nonemptyString(proof.persistenceProof.reconstructionOperation),
        dependencyPopulationTyped: Array.isArray(proof.dependencies?.authority_edges),
      });
      else Object.assign(checks, {
        outputPersistenceClosed: nonemptyArray(proof.outputPersistence) && proof.outputPersistence.every((item) => item.persistence === "DURABLE" && nonemptyString(item.storePopulation) && nonemptyString(item.reconstructionOperation)),
        atomicRecoveryBoundary: proof.atomicity === "STRUCTURED_ATOMICITY_RELATION_V1" && proof.atomicityRelation?.publication_boundary === "SINGLE_TRANSACTION_OR_PUBLISH_BEFORE_REFERENCE",
      });
      break;
    case "ODEU_LAW":
      if (proof.ontology) Object.assign(checks, {
        ontologyObjects: nonemptyArray(proof.ontology.o_declarations),
        observationBridges: nonemptyArray(proof.ontology.e_observation_bridges),
        forbiddenGrants: nonemptyArray(proof.ontology.forbidden_grants),
        exclusionsDeclared: nonemptyArray(proof.exclusions),
      });
      else Object.assign(checks, {
        explicitNonClaims: proof.claim ? nonemptyArray(proof.claim.non_claims) : true,
        declaredOwnerBoundary: nonemptyString(proof.owner),
        canonicalBoundaryExplicit: proof.canonicalConstruct === false,
        exactContractSection: Number.isInteger(proof.contractSection?.section) && /^[a-f0-9]{64}$/.test(proof.contractSection?.sha256 ?? ""),
      });
      break;
    default:
      throw new Error(`unknown evidence family ${entry.family}`);
  }
  const exactKindChecks = exactKindSemanticChecks({ entry, projection, moduleDeclaration, evidenceContext });
  const exactPredicateKeys = Object.keys(exactKindChecks).filter((key) => !exactKindBaseCheckKeys.has(key));
  const executable = evaluatorTrace({ entry, projection, moduleDeclaration });
  Object.assign(checks, executable.checks);
  Object.assign(checks, exactKindChecks);
  const passed = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean);
  return {
    evaluatorId: entry.evaluatorId,
    predicateId: `named-law.${entry.evidenceKind}`,
    evidenceKind: entry.evidenceKind,
    family: entry.family,
    inputDigest: digestObject({ evaluatorId: entry.evaluatorId, evidenceKind: entry.evidenceKind, subject: projection.subject, proof: projection.proof }),
    checks,
    exactPredicateKeys,
    trace: executable.trace,
    observedResult: passed,
    passed,
  };
};

const semanticMutationValues = (evidenceKind, path, value) => {
  const joined = path.join(".");
  if (/alias_law$/.test(joined)) return ["different semantic inputs may share one identity", ""];
  if (/membership_predicate$/.test(joined)) return [evidenceKind === "disjoint-impact-proof" ? "overlapping impact sets are permitted" : "all callers and all generations are members", ""];
  if (/reconstructionOwner$/.test(joined)) {
    const violation = {
      "chain-integrity-negative-basis": "rebuild while ignoring chain integrity",
      "fail-closed-readiness-gate": "ready with missing population",
      "availability-proof": "available when missing population",
      "missing-and-extraneous-population-games": "ignore missing and extraneous population",
      "deterministic-projection": "nondeterministic projection with random rebuild",
      "crash-point-reconstruction-traces": "crash point ignored and partial ready",
      "fork-law": "conflicting fork accepted as replay",
    }[evidenceKind] ?? "accept partial state without readiness validation";
    return [violation, ""];
  }
  if (/\.root$/.test(`.${joined}`)) {
    if (evidenceKind === "exact-root-resolution-trace") return ["root-a and root-b", ""];
    if (evidenceKind === "closed-root-population") return ["any root wildcard", ""];
    if (evidenceKind === "caller-nonconstitution-proof" || evidenceKind === "external-root-installation-receipt") return ["caller-self-constituted-root", ""];
    return ["attacker-installed-root", ""];
  }
  if (/atomicity$/.test(joined)) return ["durable record and projection may commit separately without reconstruction", ""];
  if (/replay$/.test(joined)) return ["exact retry creates a fresh result; changed input may converge; conflict accepted", ""];
  if (/reverse_impact$/.test(joined)) return [evidenceKind === "closed-parent-domain" ? "hidden parent and unbounded parent permitted" : "missing reverse impact; ignore impact", ""];
  if (/relations$/.test(joined) && Array.isArray(value)) return [[...value, "recording<observation"], []];
  if (/non_claims$/.test(joined) && Array.isArray(value)) return [[], ["observation grants authority"]];
  if (/theorem$/.test(joined)) return ["unratified placeholder", ""];
  if (/provenance$/.test(joined)) return ["registry-only", ""];
  if (/event$/.test(joined) && evidenceKind === "cross-output-negative-fixture") return ["bind any output; cross-output allowed", ""];
  if (Array.isArray(value)) return [[], value.length ? [value[0], value[0]] : ["__LAW_VIOLATION__"]];
  if (typeof value === "string") return ["", `__${evidenceKind.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_VIOLATION__`];
  if (typeof value === "boolean") return [!value];
  if (typeof value === "number") return [value + 1];
  return [];
};
const enumerateSemanticMutations = (value, evidenceKind, path = [], output = []) => {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) value.forEach((item, index) => enumerateSemanticMutations(item, evidenceKind, [...path, index], output));
  else if (typeof value === "object") Object.entries(value).forEach(([key, item]) => enumerateSemanticMutations(item, evidenceKind, [...path, key], output));
  for (const replacement of semanticMutationValues(evidenceKind, path, value)) output.push({ path, replacement });
  return output;
};
const setAtPath = (value, path, replacement) => {
  let cursor = value;
  for (const part of path.slice(0, -1)) cursor = cursor[part];
  cursor[path.at(-1)] = clone(replacement);
};
const applyKnownExactCounterexample = (proof, evidenceKind) => {
  switch (evidenceKind) {
    case "commit-and-projection-transaction-proof": proof.atomicityRelation.partial_visibility = "ALLOW"; return { path: "proof.atomicityRelation.partial_visibility", operator: "ALLOW_SPLIT_PUBLICATION" };
    case "exact-retry-trace": proof.replayRelation.duplicate_effects = "ALLOW"; return { path: "proof.replayRelation.duplicate_effects", operator: "ALLOW_DUPLICATE_RETRY_EFFECT" };
    case "policy-proof": proof.policySurfaces = []; proof.policyInputs = []; proof.outputCases = []; return { path: "proof.policySurfaces+policyInputs+outputCases", operator: "REMOVE_POLICY_DECISION_BASIS" };
    case "separate-utility-model": if (proof.policyBoundary) proof.policyBoundary.utility_model = "CONFLATED"; else proof.subjectPolicyFacts.claim.utility_effect = "GRANT"; return { path: "proof.policyBoundary.utility_model", operator: "ADD_UTILITY_CLAIM" };
    case "owner-root": proof.authority.root = "unregistered-caller-root"; return { path: "proof.authority.root", operator: "INSTALL_CALLER_ROOT" };
    case "scope-proof": (proof.scope ?? proof.inputs[0].scope).membership_domain.kind = "UNBOUNDED_CALLER_GENERATION"; return { path: "proof.scope.membership_domain.kind", operator: "WIDEN_SCOPE_UNIVERSALLY" };
    case "partial-recovery-negative-traces": (proof.persistenceProof ?? proof.outputPersistence[0]).partial_population_posture = "ALLOW"; return { path: "proof.persistenceProof.partial_population_posture", operator: "ACCEPT_PARTIAL_RECOVERY" };
    case "content-seal": proof.contentSealSurfaces = []; return { path: "proof.contentSealSurfaces", operator: "REMOVE_CONTENT_SEAL_SURFACE" };
    case "no-backdating-proof": (proof.time ?? proof.inputTimes[0].time).order_edges.push({ left: "recording", relation: "BEFORE", right: "observation" }); return { path: "proof.time.order_edges", operator: "ALLOW_BACKDATING" };
    case "exclusive-operation-owner": if (proof.authority) proof.authority.owner = "owner-a and owner-b jointly"; else proof.owner = "owner-a and owner-b jointly"; return { path: "proof.authority.owner", operator: "ASSIGN_JOINT_OWNERS" };
    case "root-substitution-negative-basis": proof.authority.root = "attacker-installed-root"; return { path: "proof.authority.root", operator: "SUBSTITUTE_ATTACKER_ROOT" };
    case "identity-seal": proof.identity.alias_law = "unequal semantic tuples resolve to a common identifier"; return { path: "proof.identity.alias_law", operator: "ALLOW_CROSS_INPUT_ALIAS_LEXICALLY_NOVEL" };
    case "disjoint-impact-proof": proof.scope.membership_predicate = "the two impact domains have a shared member"; return { path: "proof.scope.membership_predicate", operator: "ALLOW_OVERLAPPING_IMPACT_LEXICALLY_NOVEL" };
    case "chain-integrity-negative-basis": proof.persistenceProof.reconstructionOwner = "rebuild succeeds without validating predecessor linkage"; return { path: "proof.persistenceProof.reconstructionOwner", operator: "IGNORE_CHAIN_INTEGRITY_LEXICALLY_NOVEL" };
    case "exact-root-resolution-trace": proof.authority.root = "two roots: root-a root-b"; return { path: "proof.authority.root", operator: "RESOLVE_TWO_ROOTS_LEXICALLY_NOVEL" };
    case "zero-authority-conflict-proof": proof.authorityPolicy.conflict_posture = "ALLOW"; return { path: "proof.authorityPolicy.conflict_posture", operator: "PERMIT_AUTHORITY_CONFLICT" };
    case "current-authority-dependencies": proof.dependencyPolicy.currentness_posture = "IGNORE"; return { path: "proof.dependencyPolicy.currentness_posture", operator: "ACCEPT_STALE_AUTHORITY" };
    default: return null;
  }
};

export const falsifyNamedLaw = ({ entry, projection, moduleDeclaration, evidenceContext = {} }) => {
  const mutated = clone(projection);
  const proof = mutated.proof;
  const exactPredicate = exactNamedLawPredicates[entry.evidenceKind];
  if (!exactPredicate) throw new Error(`missing exact named-law falsifier target ${entry.evidenceKind}`);
  const baselineChecks = exactPredicate({ proof, entry, projection, moduleDeclaration, evidenceContext });
  let mutation = applyKnownExactCounterexample(proof, entry.evidenceKind);
  for (const candidate of mutation ? [] : enumerateSemanticMutations(proof, entry.evidenceKind)) {
    if (candidate.path.length === 0) continue;
    const leaf = String(candidate.path.at(-1));
    if (leaf === "transitions" && proof.transitions?.length === 0) continue;
    if (["id", "transitionId", "subjectId"].includes(leaf)) continue;
    if (leaf === "carrierId" && projection.subject.kind === "carrier") continue;
    if (leaf === "operationId" && projection.subject.kind === "operation") continue;
    const candidateProof = clone(proof);
    setAtPath(candidateProof, candidate.path, candidate.replacement);
    const checks = exactPredicate({ proof: candidateProof, entry, projection: { ...projection, proof: candidateProof }, moduleDeclaration, evidenceContext });
    if (Object.keys(baselineChecks).some((key) => baselineChecks[key] === true && checks[key] === false)) {
      setAtPath(proof, candidate.path, candidate.replacement);
      mutation = { path: `proof.${candidate.path.join(".")}`, operator: "FALSIFY_EXACT_NAMED_LAW", replacementDigest: digestObject(candidate.replacement), failedExactPredicateKeys: Object.keys(baselineChecks).filter((key) => baselineChecks[key] === true && checks[key] === false) };
      break;
    }
  }
  if (!mutation) throw new Error(`no distinctive coherent falsification found for ${entry.evidenceKind}`);
  if (!moduleDeclaration) throw new Error("coherent law falsification requires the exact candidate module");
  const mutatedCandidate = clone(moduleDeclaration);
  const mutatedEvidenceContext = clone(evidenceContext);
  const carrier = mutatedCandidate.carriers.find((item) => item.id === projection.subject.id);
  const operation = mutatedCandidate.operations.find((item) => item.id === projection.subject.id);
  switch (entry.family) {
    case "SURFACE_DISCOVERY":
      mutatedCandidate.project_surface = clone(proof.projectSurface);
      mutatedCandidate.exclusions = clone(proof.exclusions);
      mutatedEvidenceContext.surfaceReconciliation.partitionProof = clone(proof.partitionProof);
      break;
    case "AUTHORITY":
      mutatedCandidate.authority_root_registry = clone(proof.rootRegistry);
      mutatedCandidate.authority_owner_registry = clone(proof.ownerRegistry);
      if (carrier) { carrier.authority = clone(proof.authority); carrier.grant = clone(proof.grant); carrier.dependencies = clone(proof.dependencyPolicy); }
      else { operation.owner = proof.owner; operation.owner_cardinality = proof.ownerCardinality; operation.authority_policy = clone(proof.authorityPolicy); for (const input of proof.inputAuthorities ?? []) { const target = mutatedCandidate.carriers.find((item) => item.id === input.id); target.authority = clone(input.authority); target.grant = clone(input.grant); } }
      break;
    case "TEMPORAL":
      if (carrier) { carrier.time = clone(proof.time); carrier.identity.generation_fields = clone(proof.generationFields); }
      else for (const input of proof.inputTimes ?? []) { const target = mutatedCandidate.carriers.find((item) => item.id === input.id); target.time = clone(input.time); target.identity.generation_fields = clone(input.generationFields); }
      break;
    case "SCOPE":
      if (carrier) { carrier.scope = clone(proof.scope); carrier.grant = clone(proof.grant); carrier.identity.stable_fields = clone(proof.stableFields); }
      else for (const input of proof.inputs ?? []) { const target = mutatedCandidate.carriers.find((item) => item.id === input.id); target.scope = clone(input.scope); target.grant = clone(input.grant); }
      break;
    case "POLICY":
      mutatedEvidenceContext.contractSections[projection.contractSection.section] = clone(proof.contractSection);
      if (carrier) {
        const policySurfaceIds = new Set(mutatedCandidate.project_surface.filter((item) => item.kind === "POLICY").map((item) => item.id));
        carrier.claim = clone(proof.subjectPolicyFacts.claim);
        carrier.authority.owner = proof.subjectPolicyFacts.owner;
        carrier.surface_refs = carrier.surface_refs.filter((ref) => !policySurfaceIds.has(ref) || proof.policySurfaces.some((item) => item.id === ref));
      }
      if (operation) {
        const policySurfaceIds = new Set(mutatedCandidate.project_surface.filter((item) => item.kind === "POLICY").map((item) => item.id));
        const policyInputIds = new Set(mutatedCandidate.carriers.filter((item) => item.surface_refs.some((ref) => ref.startsWith("policy."))).map((item) => item.id));
        operation.surface_refs = operation.surface_refs.filter((ref) => !policySurfaceIds.has(ref) || proof.policySurfaces.some((item) => item.id === ref));
        operation.inputs = operation.inputs.filter((id) => !policyInputIds.has(id) || proof.policyInputs.includes(id));
        operation.output_cases = clone(proof.outputCases);
        operation.policy_boundary = clone(proof.policyBoundary);
      }
      break;
    case "LIFECYCLE":
      mutatedCandidate.qualified_transitions = mutatedCandidate.qualified_transitions.filter((item) => projection.subject.kind === "carrier" ? item.carrierId !== projection.subject.id : projection.subject.kind === "operation" ? item.operationId !== projection.subject.id : false).concat(clone(proof.transitions));
      if (carrier) carrier.lifecycle = clone(proof.lifecycle);
      if (operation) { operation.lifecycle_policy = clone(proof.lifecyclePolicy); operation.output_cases = clone(proof.operationOutputCases); }
      break;
    case "OUTCOME":
      mutatedCandidate.qualified_transitions = mutatedCandidate.qualified_transitions.filter((item) => projection.subject.kind === "carrier" ? item.carrierId !== projection.subject.id : projection.subject.kind === "operation" ? item.operationId !== projection.subject.id : false).concat(clone(proof.transitions));
      for (const [carrierId, standing] of Object.entries(proof.stateStanding ?? {})) mutatedCandidate.carriers.find((item) => item.id === carrierId).state_standing = clone(standing);
      for (const [operationId, standing] of Object.entries(proof.operationOutcomeStanding ?? {})) mutatedCandidate.operations.find((item) => item.id === operationId).outcome_standing = clone(standing);
      if (operation) { operation.output_cases = clone(proof.outputCases); operation.outcome_standing = clone(proof.outcomeStanding); operation.outcome_policy = clone(proof.outcomePolicy); }
      break;
    case "IDENTITY":
      if (carrier) {
        const persistedSurfaceIds = new Set(mutatedCandidate.project_surface.filter((item) => item.kind === "PERSISTED_OBJECT").map((item) => item.id));
        carrier.identity = clone(proof.identity);
        carrier.surface_refs = carrier.surface_refs.filter((ref) => !persistedSurfaceIds.has(ref) || proof.contentSealSurfaces.some((item) => item.id === ref));
      }
      else { operation.inputs = clone(proof.operationInputs); operation.replay = proof.replay; for (const input of proof.inputIdentities ?? []) mutatedCandidate.carriers.find((item) => item.id === input.id).identity = clone(input.identity); }
      break;
    case "COMPOSITION":
      if (carrier) { carrier.dependencies = clone(proof.dependencies); carrier.composition = clone(proof.composition); carrier.scope = clone(proof.scope); }
      else { operation.inputs = clone(proof.inputs); operation.outputs = clone(proof.outputs); operation.composition_policy = clone(proof.compositionPolicy); }
      break;
    case "ATOMICITY":
      if (operation) { operation.atomicity = proof.atomicity; operation.atomicity_relation = clone(proof.atomicityRelation); operation.inputs = clone(proof.inputs); operation.outputs = clone(proof.outputs); }
      else { carrier.persistence = proof.persistence; const storeIndex = mutatedCandidate.store_populations.findIndex((item) => item.carrierId === carrier.id); mutatedCandidate.store_populations[storeIndex] = clone(proof.store); }
      break;
    case "REPLAY":
      if (operation) { operation.replay = proof.replay; operation.replay_relation = clone(proof.replayRelation); operation.inputs = clone(proof.inputs); operation.output_cases = clone(proof.outputCases); }
      else {
        carrier.identity = clone(proof.identity);
        carrier.lifecycle = clone(proof.lifecycle);
        const index = mutatedCandidate.persistence_proofs.findIndex((item) => item.carrierId === carrier.id);
        mutatedCandidate.persistence_proofs[index] = { ...clone(proof.persistencePolicy), reconstructionOperation: proof.reconstructionOperation };
      }
      break;
    case "RECOVERY":
      if (carrier) { const proofIndex = mutatedCandidate.persistence_proofs.findIndex((item) => item.carrierId === carrier.id); const storeIndex = mutatedCandidate.store_populations.findIndex((item) => item.carrierId === carrier.id); mutatedCandidate.persistence_proofs[proofIndex] = clone(proof.persistenceProof); mutatedCandidate.store_populations[storeIndex] = clone(proof.storePopulation); carrier.dependencies = clone(proof.dependencies); }
      else { operation.atomicity = proof.atomicity; operation.atomicity_relation = clone(proof.atomicityRelation); for (const persistence of proof.outputPersistence ?? []) { const index = mutatedCandidate.persistence_proofs.findIndex((item) => item.carrierId === persistence.carrierId); mutatedCandidate.persistence_proofs[index] = clone(persistence); } }
      break;
    case "ODEU_LAW":
      if (projection.subject.kind === "module") { mutatedCandidate.ontology = clone(proof.ontology); mutatedCandidate.exclusions = clone(proof.exclusions); }
      else { carrier.claim = clone(proof.claim); carrier.authority.owner = proof.owner; carrier.canonical_construct = proof.canonicalConstruct; mutatedEvidenceContext.contractSections[projection.contractSection.section] = clone(proof.contractSection); }
      break;
    default:
      throw new Error(`unknown evidence family ${entry.family}`);
  }
  const regeneratedProof = expectedProofFromCandidate({ entry, projection: mutated, moduleDeclaration: mutatedCandidate, evidenceContext: mutatedEvidenceContext });
  mutated.proof = regeneratedProof;
  mutated.proofDigest = digestObject(regeneratedProof);
  const coherentChecks = exactPredicate({ proof: regeneratedProof, entry, projection: mutated, moduleDeclaration: mutatedCandidate, evidenceContext: mutatedEvidenceContext });
  mutation.failedExactPredicateKeys = Object.keys(baselineChecks).filter((key) => baselineChecks[key] === true && coherentChecks[key] === false);
  if (mutation.failedExactPredicateKeys.length === 0) throw new Error(`candidate-coherent mutation did not falsify the exact named law ${entry.evidenceKind}: ${JSON.stringify({ mutation, baselineChecks, coherentChecks, regeneratedProof })}`);
  return {
    mutatedProjection: mutated,
    mutatedCandidate,
    mutatedEvidenceContext,
    mutation: {
      mutationId: `falsify.${entry.evidenceKind}`,
      ...mutation,
      retainsEvidenceInstance: true,
      retainsProjectionObject: true,
      retainsUnrelatedFacts: true,
    },
  };
};
