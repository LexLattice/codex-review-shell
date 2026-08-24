# Direct Semantic Service v0 Constitution

Status: design frozen for implementation. No live daemon, compiler adapter, or
model-backed semantic cell is claimed by this document.

Review posture: DSS-R001 through DSS-R007 and the associated schema-freeze
tightening were incorporated on 2026-08-24.

This constitution defines the first persistent Direct service for running
bounded semantic verification cells compiled by the standalone semantic
compiler. The first implementation must prove the institution with a
deterministic fake worker before any Spark, Daybreak, or other model backend is
enabled.

Related documents:

- [Direct worker artifact/audit substrate](./direct-worker-artifact-audit-substrate.md)
- [Direct ArcAGI3 Epistemic Orchestration Pilot](./DIRECT_ARCAGI3_EPISTEMIC_ORCHESTRATION_PILOT_SPEC.md)
- [Direct Headless Bridge Daemon Spec](./DIRECT_HEADLESS_BRIDGE_DAEMON_SPEC.md)
- [Direct Recovery And Replay Safety Spec](./DIRECT_RECOVERY_AND_REPLAY_SAFETY_SPEC.md)
- [Direct Native Multi-Agent Pool](./DIRECT_NATIVE_MULTI_AGENT_POOL_SPEC.md)

The external semantic compiler currently lives at:

```text
/home/rose/work/semantic-compiler
```

That locator is operator configuration, not portable semantic identity.

## 1. Constitutional decision

```text
semantic-compiler repository
  -> versioned semantic law and compilation

Direct repository
  -> daemon, identities, registry, materialization, scheduling,
     isolation, storage, admission, accounting, and delivery

CLI / Electron / Codex / future surfaces
  -> replaceable clients of the same durable service
```

`direct-semanticd` belongs inside the Direct repository and runs independently
of Electron. Process separation is required; a third repository is not.

The compiler is not a repository crawler, provider host, queue, or authority
store. Direct is not the source of semantic law. Direct imports one exact,
verified compiler build and records its identity in every derived job.

The service implements an institutional handoff:

```text
project work task
  -> submit typed semantic job
  -> receive durable job receipt
  -> task may rest or terminate
  -> Direct executes independently
  -> durable advisory results become readable
  -> authorized subscribers receive bounded projections
```

The requesting task never owns the worker processes, retry loop, campaign
state, or result durability.

## 2. Purpose and v0 boundary

The service exists to execute many independent, bounded semantic operations
under one frozen transformation law:

```text
Y_i = Execute(model/backend_a, KernelRevision_j, EvidenceMaterialization_i)
```

For one kernel and many evidence pages, this is a semantic SIMD cohort. The
agent is an execution core, not the orchestration primitive.

v0 must provide:

- authenticated local submission and read capabilities;
- immutable project and compiler registry revisions;
- append-only job events and derived lifecycle state;
- deterministic compilation and closed evidence-page materialization;
- pre-execution assurance;
- a bounded worker scheduler and explicit attempt policy;
- separate raw-result quarantine and canonical-result admission;
- content-addressed artifacts with durable SQLite references;
- restart/replay classification without silent retry;
- cursor-based delivery subscriptions;
- usage and attempt accounting;
- a CLI usable from WSL and, through `wsl.exe`, Windows;
- a deterministic fake worker proving every lifecycle branch.

v0 does not provide:

- canonical project or WorldManager truth admission;
- autonomous repair, patching, or workspace mutation;
- worker-selected repository exploration;
- model consensus as truth;
- worker-issued authority, policy, evidence scope, or retries;
- arbitrary client-supplied filesystem paths;
- remote network ingress;
- Electron as a required process;
- a general replacement for the Direct information bridge;
- a claim that the current semantic-compiler advisory results are trusted.

All v0 `MicroResult` objects remain advisory. A later authority bridge may
consume an evaluated disposition, but that bridge is outside this service.

### 2.1 Relation to existing Direct organs

This service composes with existing Direct work without collapsing their
authority or storage boundaries:

- the worker artifact/audit substrate remains the general typed lifecycle and
  subscription institution; a later bridge may register a sealed
  `AuditDisposition` there, but v0 does not share its SQLite store or admit its
  artifact;
- the ArcAGI3 epistemic store supplies versioned repository ports and
  cartography identities through admitted registry references; the semantic
  service does not rewrite E revisions;
- the native multi-agent pool or external provider adapters may later realize
  an execution backend, but their child-session success is not itself a
  semantic verdict;
- the general headless information bridge may reuse daemon, custody, and
  delivery primitives, but semantic-cell compilation and admission remain a
  narrower protocol;
- WorldManager and project WorkThreads may submit or receive artifacts only
  through separately issued capabilities. The service does not import their
  canonical databases or infer their authority from a shared process.

There is no cross-database atomicity claim. A future publication into another
Direct ledger is a new idempotent, receipt-bearing transition after semantic
job completion.

## 3. Non-collapsible distinctions

The implementation must preserve these independent predicates:

```text
request structurally valid
!= requester authorized
!= compiler pin valid
!= evidence route valid
!= evidence page closed
!= evidence sufficient
!= capsule executable
!= process started
!= raw output captured
!= raw output structurally admitted
!= result supported
!= verification edge satisfied
!= audit package ratified
!= project change authorized
!= project truth admitted
```

In particular:

```text
model says "schema-valid"
!= Direct admitted a MicroResult

Direct admitted a MicroResult
!= the semantic claim is true

edge result evaluated
!= the project must change
```

## 4. Owners and trust boundaries

| Object or transition | Sole owner in v0 |
| --- | --- |
| semantic pattern, obligation, kernel, and abstract evidence route law | pinned semantic compiler |
| host process identity | local transport boundary |
| semantic requester identity and scope | Direct capability issuer |
| project locator and admissible target revisions | immutable Direct `ProjectRegistryRevision` |
| exact evidence bytes and completeness receipts | Direct materializer |
| capsule and attempt allocation | Direct scheduler |
| backend invocation and process observations | Direct runtime adapter |
| raw-output custody | Direct quarantine store |
| structural and binding admission | Direct admission engine |
| epistemic attestation/evaluation | separately constituted evaluator cells or deterministic evaluators |
| result delivery | Direct subscription/outbox layer |
| project/world truth admission | outside v0 |

Workers receive no ledger write capability, project authority, policy mutation,
retry choice, evidence widening, or direct client-delivery channel. They return
one raw candidate output to their execution adapter.

## 5. Principals and capabilities

### 5.1 Two identities, not one

On Unix, `SO_PEERCRED` proves the host uid/gid/pid at the socket boundary. It
does not prove which Codex task, role, project, or institutional department is
speaking, because multiple clients may run as the same user.

The service therefore derives two identities:

```ts
type TransportPrincipal = {
  schema: "direct_semantic_transport_principal@1";
  transport: "unix_socket" | "windows_wsl_stdio" | "internal";
  hostUserId: string;
  hostGroupId?: string;
  processId?: number;
  observedAt: string;
};

type SemanticPrincipal = {
  schema: "direct_semantic_principal@1";
  principalId: string;
  issuerRevision: string;
  principalClass:
    | "local_user_experimental"
    | "direct_workthread"
    | "direct_service"
    | "operator";
  subjectRef: string;
  projectScopes: string[];
  purposeScopes: string[];
};
```

The `TransportPrincipal` is derived, never supplied. A `SemanticPrincipal` is
resolved from a Direct-issued opaque capability or authenticated integration
session. Caller-provided `requester_ref` is descriptive provenance only and
has no authority effect.

Before task/session capability issuance exists, the external CLI may resolve to
`local_user:<uid>`, but that principal may submit only experimental,
advisory-only jobs under allowlisted project and kernel revisions.

### 5.2 Capability separation

Submission and observation are different rights:

```ts
type DirectSemanticCapability = {
  schema: "direct_semantic_capability@1";
  capabilityId: string;
  principalId: string;
  operation:
    | "prepare_snapshot"
    | "submit_job"
    | "inspect_job"
    | "read_results"
    | "subscribe_results"
    | "request_cancel"
    | "administer_service";
  jobRefs: string[];
  projectRegistryRevisionRefs: string[];
  allowedTargetORevisions: string[];
  targetSnapshotReceiptRefs: string[];
  compilerPinRefs: string[];
  kernelRevisionRefs: string[];
  executionProfileRevisionRefs: string[];
  providerProfileRevisionRefs: string[];
  allowedModels: string[];
  allowedReasoningEfforts: string[];
  attemptPolicyRevisionRefs: string[];
  purposeScopes: string[];
  returnProjectionRefs: string[];
  maximumJobs: number;
  maximumCellsPerJob: number;
  maximumReplicatesPerCell: number;
  maximumInputTokensPerJob: number;
  maximumOutputTokensPerJob: number;
  maximumCostMicrounitsPerJob: number | null;
  issuedAt: string;
  expiresAt?: string;
  nonce: string;
};
```

Capabilities are opaque, unforgeable, least-scope, separately revocable, and
stored only as protected verifiers. Possessing `submit_job` must not imply the
ability to read results. A delivery subscriber may receive a bounded result
projection without receiving the evidence page or quarantined raw output.

Administrative service access never implies project truth authority.

Every array in a capability is a closed set of immutable admitted revisions,
not a mutable namespace, prefix, tag, project name, or "current/latest"
selector. A capability never inherits project, compiler, kernel, runtime,
provider, model, attempt-policy, or projection revisions admitted after it was
issued. An issuer that wants to authorize a new revision issues a new
capability.

Operation-specific validation is fail closed. A `prepare_snapshot` capability
binds exact project-registry and target-O revisions and does not authorize job
submission. A `submit_job` capability binds the resulting exact snapshot
receipt as well as its O revision. Inspect, read, subscribe, and cancel
capabilities bind exact existing `jobRefs`; they do not inherit jobs submitted
later under the same project. Empty or irrelevant scope arrays confer no
wildcard authority.

Authorization is the intersection, never the union, of:

```text
transport/session eligibility
intersect capability operation and immutable bounds
intersect ProjectRegistryRevision authority policy
intersect compiler/kernel/execution-profile policy
intersect canonical request values and computed resource estimate
```

An empty intersection rejects the request. Budget counters are consumed under
service-owned compare-and-swap; concurrent submissions cannot each spend the
same remaining grant. The authorization receipt records every exact revision
and numeric bound used in the decision.

## 6. Immutable registries

Mutable names resolve to immutable revisions. Jobs bind revision identities,
never "latest."

### 6.1 Compiler build pin

```ts
type CompilerBuildPin = {
  schema: "direct_semantic_compiler_build_pin@1";
  compilerPinRef: string;
  repositoryIdentity: string;
  gitCommit: string;
  gitTree: string;
  sourceArtifactDigest: string;
  executableArtifactDigest: string;
  interpreterToolchainDigest: string;
  dependencyLockDigest: string;
  installedDependencyEnvironmentDigest: string;
  invocationContractDigest: string;
  canonicalSchemaDigests: string[];
  patternLibraryDigests: string[];
  evidenceCatalogDigests: string[];
  compilerGateReceiptDigest: string;
  adapterRevision: string;
  admittedAt: string;
};
```

Direct must verify the checked-out tree and all declared artifacts before use.
It must not import whichever compiler happens to be current at the configured
path. A changed compiler requires a new `CompilerBuildPin`; existing jobs
continue to name their original pin.

Source and lockfile identity are insufficient. Direct executes only the pinned
compiler artifact with the pinned interpreter/toolchain and installed
dependency environment. Before every compiler invocation, preflight reproduces
their digests and the closed invocation contract. A locally rebuilt executable
or changed virtual environment creates a new pin even when the Git tree is
unchanged.

The Direct database stores the pin and its validation receipts, not an editable
copy of the semantic laws. The standalone repository remains authoritative.

### 6.2 Project registry revision

```ts
type ProjectRegistryRevision = {
  schema: "direct_semantic_project_registry_revision@1";
  registryRevisionRef: string;
  projectRef: string;
  priorRevisionRef?: string;
  substrateBinding: "wsl" | "windows";
  repositoryIdentity: string;
  privateRepositoryLocatorRef: string;
  targetRevisionPolicy: {
    kind: "exact_git_commit_allowlist";
    allowedCommits: string[];
    cleanTreeRequired: boolean;
  };
  projectEvidenceRuntimeRevisionRef: string;
  evidenceCartographyRevisionRef: string;
  authorityPolicyRef: string;
  admittedByCapabilityRef: string;
  admittedAt: string;
};
```

Clients submit `projectRef` plus an exact target revision. They do not submit
repository paths. Private locators are resolved only inside Direct and never
appear in renderer-safe or ordinary CLI result projections.

Porting a project creates a new registry revision. It does not rewrite jobs or
artifacts bound to the prior substrate.

### 6.3 Project evidence runtime and frozen target

The runtime that observes the project is distinct from the runtime that
executes a semantic worker:

```ts
type ProjectEvidenceRuntimeRevision = {
  schema: "direct_semantic_project_evidence_runtime_revision@1";
  projectEvidenceRuntimeRevisionRef: string;
  projectRef: string;
  substrateBinding: "wsl" | "windows";
  operatingSystemRevision: string;
  interpreterExecutableDigest: string;
  toolchainArtifactDigests: string[];
  installedDependencyEnvironmentDigest: string;
  deterministicCheckRegistryDigest: string;
  admittedEnvironmentInputDigest: string;
  runtimePolicyDigest: string;
};

type TargetSnapshotReceipt = {
  schema: "direct_semantic_target_snapshot_receipt@1";
  targetSnapshotReceiptRef: string;
  projectRegistryRevisionRef: string;
  repositoryIdentity: string;
  targetORevision: string;
  gitCommit: string;
  gitTree: string;
  submoduleClosureDigest: string;
  lfsObjectClosureDigest: string;
  admittedGeneratedInputDigest: string;
  evidenceCartographyRevisionRef: string;
  projectEvidenceRuntimeRevisionRef: string;
  projectRuntimeInputDigest: string;
  sourceStatusDigest: string;
  snapshotArtifactRef: string;
  snapshotMaterializationMode: "isolated_read_only_snapshot";
  preObservationReceiptRef: string;
  postObservationReceiptRef: string;
  snapshotDigest: string;
  capturedAt: string;
};
```

A Git commit alone is not the materialization target. The snapshot receipt binds
the repository tree, submodule commits and trees, required LFS objects,
admitted generated inputs, cartography revision, project evidence runtime, and
runtime-relevant inputs. Missing closure is a pre-execution failure, not an
omitted detail.

Snapshot preparation captures an isolated, read-only artifact and reproduces
the complete source observation before and after capture. The receipt is
admitted only when those observations agree and the artifact digest verifies.
All later materialization reads the immutable artifact, never the originating
worktree. If Direct cannot freeze a project-specific source this way, v0 rejects
snapshot preparation. An earlier clean-worktree observation never authorizes
later reads from a mutable worktree.

## 7. Semantic computation objects

The complete cell lineage is:

```text
CompiledObligationSet
  -> ExecutionPlan
  -> TargetSnapshotReceipt
  -> EdgeOccurrence
  -> EvidenceRoute
  -> EvidenceMaterialization
  -> ExecutionCapsule
  -> PreExecutionAssuranceRecord
  -> ExecutionAttempt
  -> RawResult
  -> MicroResultAdmissionRecord
  -> MicroResult
  -> Attestation
  -> Evaluation
  -> AdvisoryDisposition
```

### 7.1 Compiler-owned semantic law

```ts
type KernelRevision = {
  schema: "semantic_kernel_revision@1";
  kernelRef: string;
  semanticIsaRevision: string;
  edgeFamily: string;
  transformationLawDigest: string;
  evidenceSemanticsDigest: string;
  remandLawDigest: string;
  authorityPosture: "advisory_only";
  outputSchemaDigest: string;
  ratificationEvidenceRefs: string[];
};

type EvidenceRoute = {
  schema: "semantic_evidence_route@1";
  routeRef: string;
  edgeOccurrenceRef: string;
  targetORevision: string;
  evidenceProfileRef: string;
  requiredCells: EvidenceCellRequirement[];
  forbiddenEvidenceClasses: string[];
  negativeSearchUniverses: string[];
  routeCompilerRevision: string;
};
```

JSON Schema is the ABI: it proves an output belongs to a structural type. The
kernel contract supplies the instruction semantics: what transformation the
worker must perform, which evidence supports it, what may not be inferred, and
when remand is required.

The compiler decides what kind of evidence would settle an edge. Direct maps
that abstract address to exact bytes in the registered frozen target.

### 7.2 Execution plan and expected-set closure

```ts
type ExecutionPlan = {
  schema: "direct_semantic_execution_plan@1";
  executionPlanRef: string;
  jobRef: string;
  compilerPinRef: string;
  projectRegistryRevisionRef: string;
  targetSnapshotReceiptRef: string;
  requestedCompilationRef: string;
  executionProfileRevisionRef: string;
  selectionMode: "partial_selection" | "exhaustive_compilation";
  compiledObligationSetDigest: string;
  compiledEdgeOccurrenceRefs: string[];
  selectedEdgeOccurrenceRefs: string[];
  excludedEdgeOccurrenceRefs: string[];
  expectedCells: ExpectedExecutionCell[];
  attemptPolicyRef: string;
  planDigest: string;
};

type ExpectedExecutionCell = {
  cellRef: string;
  edgeOccurrenceRef: string;
  kernelRevisionRef: string;
  replicateSlot: number;
};

type TerminalCoverageReceipt = {
  schema: "direct_semantic_terminal_coverage_receipt@1";
  terminalCoverageReceiptRef: string;
  executionPlanRef: string;
  expectedCellRefs: string[];
  admittedResultCellRefs: string[];
  explicitRemandCellRefs: string[];
  terminalFailureCellRefs: string[];
  authorizedCancellationCellRefs: string[];
  unclassifiedCellRefs: string[];
  duplicateTerminalCellRefs: string[];
  exhaustiveCompilationReconciliation:
    | "not_claimed"
    | "exact_compiled_obligation_set";
  verdict: "closed" | "open" | "invalid";
  receiptDigest: string;
};
```

Every expected cell is one edge occurrence and one predeclared replicate slot.
Retries are attempts within that slot; they do not create or erase expected
cells. Completion requires the mechanically reproduced partition:

```text
ExpectedCells
  = AdmittedResults
    dot-union ExplicitRemands
    dot-union TerminalFailures
    dot-union AuthorizedCancellations

UnclassifiedCells = empty
DuplicateTerminalCells = empty
```

`partial_selection` binds an exact selected subset and records every excluded
compiled occurrence. It may report only partial coverage. An
`exhaustive_compilation` plan is eligible to claim exhaustive audit coverage
only when `compiledEdgeOccurrenceRefs` reproduces the pinned compiler's exact
obligation set and the selected and compiled sets are equal.

The scheduler consumes `ExecutionPlan.expectedCells`; it may not infer work
from queue contents or stop after a convenient subset has returned. A terminal
coverage receipt is required before results can be sealed.

### 7.3 Closed evidence page

```ts
type EvidenceMaterialization = {
  schema: "direct_semantic_evidence_materialization@1";
  materializationRef: string;
  routeRef: string;
  projectRegistryRevisionRef: string;
  targetSnapshotReceiptRef: string;
  targetORevision: string;
  projectEvidenceRuntimeRevisionRef: string;
  materializerRevision: string;
  includedCells: MaterializedEvidenceCell[];
  explicitlyUnavailableCells: UnavailableEvidenceCell[];
  requiredCellSetDigest: string;
  coverageClosure: "closed";
  evidenceSufficiency: "unknown" | "candidate_sufficient" | "insufficient";
  sufficiencyEligibilityReceiptRef: string;
  artifactDigest: string;
  materializedAt: string;
};

type SufficiencyEligibilityReceipt = {
  schema: "direct_semantic_sufficiency_eligibility_receipt@1";
  sufficiencyEligibilityReceiptRef: string;
  materializationRef: string;
  kernelRevisionRef: string;
  evidenceSufficiency: "unknown" | "candidate_sufficient" | "insufficient";
  kernelSufficiencyPolicyRef: string;
  executable: boolean;
  deterministicDisposition:
    | "eligible_for_preflight"
    | "remand_known_insufficient"
    | "reject_policy_mismatch";
  receiptDigest: string;
};
```

Closure is mechanically derived:

```text
RequiredCells = Included dot-union ExplicitlyUnavailable
UnclassifiedRequiredCells = empty
```

`coverageClosure=closed` means every required cell is accounted for. It does
not mean the page contains sufficient evidence. An unavailable cell closes the
accounting partition but does not manufacture evidence.

A page contains exact source slices and digests, dependency/provenance closure,
deterministic check output, declared negative-search universes and completeness
receipts, runtime observations, unavailable/forbidden evidence, and exact
materializer/target revisions.

The page is bound to the complete `TargetSnapshotReceipt` and the exact
`ProjectEvidenceRuntimeRevision` that produced source and deterministic-check
evidence. A different project interpreter, dependency environment, generated
input set, or target snapshot requires a new materialization.

A known `insufficient` page is deterministically remanded before capsule
execution and spends no model compute. `unknown` or `candidate_sufficient` may
be executable only when the kernel's sufficiency policy permits that posture.
The materializer emits a `SufficiencyEligibilityReceipt` recording the page
posture, kernel policy, decision, and deterministic remand code; preflight must
verify that receipt.

When one materialization is known insufficient, every expected replicate slot
for its edge receives an exact deterministic remand reference in the terminal
coverage partition. Direct does not launch redundant replicas against a page
already known to be ineligible.

Closed-page workers receive the page, not the repository. They never widen
their own repository, tool, file, or network jurisdiction.

Page-fault standing is explicit:

```text
mechanical EvidencePageFaultRecord:
  target stale
  digest mismatch
  required cell unclassified
  forbidden cell included

worker EvidencePageFaultCandidate:
  route scope insufficient
  relevant evidence omitted
  counterexample outside route
```

```ts
type EvidencePageFaultCandidate = {
  schema: "direct_semantic_evidence_page_fault_candidate@1";
  candidateRef: string;
  materializationRef: string;
  attemptRef: string;
  candidateKind:
    | "route_scope_insufficient"
    | "relevant_evidence_may_be_omitted"
    | "counterexample_may_exist_outside_route";
  boundedRationale: string;
  authorityEffect: "none";
};

type EvidencePageFaultRecord = {
  schema: "direct_semantic_evidence_page_fault_record@1";
  faultRecordRef: string;
  materializationRef: string;
  faultClass: "mechanical" | "semantic_validated";
  faultCode: string;
  validationReceiptRefs: string[];
  validatingAuthorityRef: string;
  disposition: "rematerialize" | "recompile_route" | "frontier_review";
};
```

Direct/materializer checks may establish mechanical records. A page-confined
worker can only emit a semantic candidate because it cannot observe outside
the page. Only an authorized closure-challenge or frontier-audit lane with
independent evidence access may promote that candidate to a
`semantic_validated` fault record. Broad repo exploration is never an implicit
fallback from a closed-page cell.

### 7.4 Execution capsule, worker runtime, and attempt policy

```ts
type ExecutionCapsule = {
  schema: "direct_semantic_execution_capsule@1";
  capsuleRef: string;
  semanticIsaRevision: string;
  kernelRef: string;
  edgeOccurrenceRef: string;
  evidenceRouteRef: string;
  evidenceMaterializationRef: string;
  executionProfileRevisionRef: string;
  backendAdapterRevision: string;
  providerProfileRevisionRef: string;
  model: string;
  reasoningEffort: string;
  workerExecutionRuntimeRevisionRef: string;
  executionPolicyRef: string;
  outputSchemaDigest: string;
  compilerPinRef: string;
  capsuleDigest: string;
};

type WorkerExecutionRuntimeRevision = {
  schema: "direct_semantic_worker_execution_runtime_revision@1";
  workerExecutionRuntimeRevisionRef: string;
  substrateBinding: "wsl" | "windows" | "remote_api";
  backendAdapterRevision: string;
  processLauncherDigest: string;
  sandboxPolicyDigest: string;
  scratchPolicyDigest: string;
  environmentAllowlistDigest: string;
  credentialExclusionPolicyDigest: string;
  outputCapturePolicyDigest: string;
  runtimeArtifactDigest: string;
};

type ExecutionProfileRevision = {
  schema: "direct_semantic_execution_profile_revision@1";
  executionProfileRevisionRef: string;
  providerProfileRevisionRef: string;
  allowedModels: string[];
  allowedReasoningEfforts: string[];
  workerExecutionRuntimeRevisionRef: string;
  attemptPolicyRevisionRefs: string[];
  maximumConcurrentAttempts: number;
  maximumInputTokensPerAttempt: number;
  maximumOutputTokensPerAttempt: number;
  maximumCostMicrounitsPerAttempt: number | null;
  executionPolicyDigest: string;
};

type RetryableAttemptFailureClass =
  | "transport_unavailable_before_dispatch"
  | "transport_interrupted_before_raw_capture"
  | "runtime_failed_before_raw_capture"
  | "raw_result_structural_rejection";

type AttemptSelectionRule =
  | "all_results_independent"
  | "unanimity_reports_agreement_only"
  | "fixed_majority_reports_agreement_only";

type AttemptPolicy = {
  schema: "direct_semantic_attempt_policy@1";
  attemptPolicyRef: string;
  retryableFailureClasses: RetryableAttemptFailureClass[];
  maximumAttemptsPerReplicateSlot: number;
  replicateCountPerCell: number;
  selectionRule: AttemptSelectionRule;
  timeoutMs: number;
  outputByteLimit: number;
  fixedBeforeExecution: true;
};
```

An attempt policy is frozen before the first attempt. It prevents outcome
laundering:

- transport failure or malformed raw output may be retryable if predeclared;
- an admitted `INCONCLUSIVE`, `REMANDS`, `SUPPORTS`, or `REFUTES` result cannot
  be silently retried until a preferred answer appears;
- every attempt and replicate remains visible to evaluation;
- selection and aggregation rules cannot change after results are observed.

`maximumAttemptsPerReplicateSlot` applies independently to each expected cell's
replicate slot. `replicateCountPerCell` determines how many such slots enter the
immutable execution plan. The closed selection rules may summarize agreement,
but every replicate and dissent remains input to evaluation; none of them
converts agreement into truth.

The `ProjectEvidenceRuntimeRevision` is never reused as a
`WorkerExecutionRuntimeRevision`. The former determines how project evidence
was produced; the latter determines how a sealed page was processed. Their
separate identities allow each project to use its admitted native environment
while semantic execution uses an isolated, replaceable backend.

Changing model, backend, kernel, route, page, ISA, runtime, or output schema
creates a different capsule or experiment arm. A new process invocation under
the same frozen capsule receives a new `attemptRef`.

### 7.5 Pre-execution assurance

```ts
type PreExecutionAssuranceRecord = {
  schema: "direct_semantic_preexecution_assurance@1";
  assuranceRef: string;
  capsuleRef: string;
  attemptRef: string;
  compilerPinValid: boolean;
  targetRevisionValid: boolean;
  pageClosureValid: boolean;
  pageDigestValid: boolean;
  sufficiencyEligibilityReceiptValid: boolean;
  evidenceSufficiencyEligible: boolean;
  runtimeIsolationRealized: boolean;
  credentialsExcluded: boolean;
  outputBoundaryRealized: boolean;
  verdict: "eligible" | "preflight_rejected";
  rejectionCodes: string[];
};
```

No model compute is spent before this record is durably admitted as eligible.
The service must reject a capsule if the declared isolation policy cannot be
realized by the chosen backend. A known-insufficient page yields a deterministic
`evidence_insufficient_preexecution` remand and never becomes an attempt. The
assurance record is eligible only when closure, digest, sufficiency policy,
runtime separation, isolation, credential exclusion, and output boundary all
hold.

### 7.6 Execution and output admission

```ts
type ExecutionAttempt = {
  schema: "direct_semantic_execution_attempt@1";
  attemptRef: string;
  jobRef: string;
  capsuleRef: string;
  ordinal: number;
  backendProcessRef?: string;
  allocatedAt: string;
};

type RawResult = {
  schema: "direct_semantic_raw_result@1";
  rawResultRef: string;
  capsuleRef: string;
  attemptRef: string;
  backendProcessRef: string;
  providerTerminalKind:
    | "completed"
    | "failed"
    | "interrupted"
    | "timeout"
    | "unknown";
  mediaType: string;
  rawResultDigest: string;
  rawByteCount: number;
  quarantineObjectRef: string;
  capturedAt: string;
};

type MicroResultAdmissionRecord = {
  schema: "direct_semantic_microresult_admission@1";
  capsuleRef: string;
  attemptRef: string;
  rawResultDigest: string;
  structuralValidationReceiptRefs: string[];
  bindingValidationReceiptRefs: string[];
  admissionStatus: "admitted" | "rejected";
  rejectionCodes: string[];
  admittedMicroResultRef: string | null;
  authorityEffect: "none";
};

type MicroResult = {
  schema: "direct_semantic_microresult@1";
  microResultRef: string;
  kernelRef: string;
  capsuleRef: string;
  attemptRef: string;
  edgeOccurrenceRef: string;
  evidenceMaterializationRef: string;
  evidenceMaterializationDigest: string;
  resultStatus: "supports" | "refutes" | "inconclusive" | "remands";
  typedClaims: TypedAdvisoryClaim[];
  evidenceRefs: string[];
  evidencePageFaultCandidateRefs: string[];
  novelEdgeCandidateRefs: string[];
  authorityEffect: "none";
};
```

Raw output always enters quarantine first. Only its digest and bounded
diagnostics enter the ordinary event ledger. Successful structural and binding
validation creates a canonical `MicroResult` in CAS. The raw provider payload
does not become an ordinary artifact merely because it was admitted.

An admitted result carries, at minimum:

```text
kernel_ref
capsule_ref
attempt_ref
edge_occurrence_ref
input/materialization_digest
result_status
typed claims
evidence references
page-fault or novel-edge candidates
authority_effect = none
```

The quarantine object reference is private to the admission engine. Ordinary
inspection exposes only the digest, size, terminal kind, and bounded rejection
diagnostics permitted by policy.

`NOVEL_EDGE_CANDIDATE` is a report to the compiler/auditor department. The
worker may discover novelty; it may not legislate a new edge or expand its
kernel.

### 7.7 Attestation, evaluation, and disposition

```ts
type Attestation = {
  schema: "direct_semantic_attestation@1";
  attestationRef: string;
  microResultRefs: string[];
  attestationClass:
    | "evidence_binding"
    | "independent_execution"
    | "independent_materialization"
    | "counterkernel"
    | "frontier_closure_challenge";
  attestorPrincipalRef: string;
  attestorConstitutionDigest: string;
  evidenceRefs: string[];
  independenceAssessmentRef: string | null;
  verdict: "supported" | "contradicted" | "inconclusive" | "remand";
  authorityEffect: "none";
};

type Evaluation = {
  schema: "direct_semantic_evaluation@1";
  evaluationRef: string;
  executionPlanRef: string;
  cellRef: string;
  microResultRefs: string[];
  attestationRefs: string[];
  evaluationPolicyRef: string;
  disposition:
    | "advisory_support"
    | "advisory_refutation"
    | "advisory_inconclusive"
    | "advisory_remand";
  dissentRefs: string[];
  unmetAssuranceRefs: string[];
  authorityEffect: "none";
};

type AdvisoryDisposition = {
  schema: "direct_semantic_advisory_disposition@1";
  advisoryDispositionRef: string;
  jobRef: string;
  executionPlanRef: string;
  terminalCoverageReceiptRef: string;
  evaluationRefs: string[];
  selectionMode: "partial_selection" | "exhaustive_compilation";
  coveragePosture: "partial" | "exhaustive";
  disposition:
    | "advisory_results"
    | "advisory_remands"
    | "advisory_terminal_failures"
    | "advisory_cancelled";
  openCellRefs: string[];
  authorityEffect: "none";
};
```

Attestation checks entitlement, evidence, or independence; evaluation applies a
frozen policy to the complete visible attempt/result set for one expected cell;
the job disposition summarizes only after terminal coverage closes. None of
these objects mutates a project, kernel, route, or WorldManager graph.

### 7.8 Independence and experiments

Independence is calculated from authenticated lineage, never declared by a
worker identity.

```ts
type IndependenceAssessment = {
  schema: "direct_semantic_independence_assessment@1";
  assessmentRef: string;
  comparedResultRefs: string[];
  requiredDifferentDimensions: string[];
  observedDifferentDimensions: string[];
  sharedLineageDimensions: string[];
  verdict: "satisfies" | "does_not_satisfy" | "unknown";
  lineageGraphDigest: string;
};
```

Relevant dimensions include principal, model implementation, provider,
kernel lineage, route compiler, materializer, evidence page/data, runtime,
oracle, and authority/control root.

Different experiments diagnose different layers:

```text
same page + different model/backend
  -> execution disagreement

independently rematerialized page
  -> materializer/MMU disagreement

different route compiler
  -> evidence-routing disagreement

counterkernel / independent kernel lineage
  -> legislative disagreement

frontier auditor outside constituted closure
  -> closure challenge
```

For benchmarking, an `ExperimentCohortKey` freezes every lineage dimension
except the declared experimental variable. Model consensus remains evidence,
not a truth or admission rule.

## 8. Job API

### 8.1 Daemon deployment and custody

`direct-semanticd` is one long-lived, single-writer service per configured
profile. Electron, CLI invocations, Codex tasks, and Windows launchers are
clients; none opens or mutates the service database directly.

The initial WSL deployment uses an owner-only Unix socket under a
service-derived runtime directory. State, CAS, and quarantine roots are derived
from one Direct-owned profile root and are never client parameters. A
`systemd --user` unit with optional socket activation is the preferred operator
lifecycle, but service correctness cannot depend on systemd being present.

Windows v0 clients call the WSL CLI through `wsl.exe`. Capabilities and secrets
must travel through protected stdin or an inherited protected channel, never a
command-line argument, environment dump, renderer payload, or process title.
No TCP listener exists in v0.

The initial local client is:

```sh
direct-semantic submit request.json
direct-semantic snapshot prepare <project-ref> --target <exact-o-revision>
direct-semantic inspect <job-ref>
direct-semantic wait <job-ref> --after <cursor> --timeout 60
direct-semantic ack <delivery-ref> --digest <projection-digest>
direct-semantic results <job-ref>
direct-semantic subscribe <job-ref> --projection advisory-summary
```

`submit --wait --format json` may compose calls for convenience, but submission
is asynchronous underneath and returns a durable receipt before work begins.
After receipt, the composed command performs a separate issuer step for the new
exact `jobRef` and may continue only if a job-read/subscribe capability is
independently issued or presented. The receipt never upgrades a submit
capability into a read capability.
`snapshot prepare` requires a separately authorized registry/snapshot
capability and resolves the repository only through the immutable project
registry; it never accepts a path.

### 8.2 Submission

```ts
type SemanticJobRequest = {
  schema: "direct_semantic_job_request@1";
  requestId: string;
  requesterRef?: string;
  projectRef: string;
  projectRegistryRevisionRef: string;
  targetORevision: string;
  targetSnapshotReceiptRef: string;
  compilerPinRef: string;
  requestedCompilationRef: string;
  selectionMode: "partial_selection" | "exhaustive_compilation";
  edgeOccurrenceRefs: string[];
  attemptPolicyRef: string;
  executionProfileRevisionRef: string;
  deliveryProjectionRef: string;
  idempotencyKey: string;
};

type SemanticJobReceipt = {
  schema: "direct_semantic_job_receipt@1";
  jobRef: string;
  requestDigest: string;
  admittedPrincipalRef: string;
  admittedCapabilityRef: string;
  projectRegistryRevisionRef: string;
  targetSnapshotReceiptRef: string;
  compilerPinRef: string;
  acceptedAt: string;
  eventCursor: number;
};
```

Request identity is scoped to admitted principal, operation, and idempotency
key. Reuse with a different canonical request digest is rejected.

The normal API accepts existing compiler artifacts or a declared compilation
entrypoint from an allowlisted pinned compiler build. It does not accept
caller-authored kernel bodies, route bodies, provider prompts, filesystem
locators, or authority claims.

An optional future `ad_hoc_capsule_candidate` endpoint may exist only under an
explicit experimental principal and can never feed a canonical audit package.

For `partial_selection`, `edgeOccurrenceRefs` is a non-empty exact subset of
the pinned compilation result. For `exhaustive_compilation`, it must equal the
complete compiler-produced occurrence set; a client cannot obtain exhaustive
standing merely by labeling a subset exhaustive. Direct rebuilds and seals the
`ExecutionPlan` after compilation.

The `TargetSnapshotReceipt` already exists and is capability-authorized before
submission. Job admission re-verifies it against the project registry,
requested O revision, and current snapshot custody; the job never substitutes a
fresh mutable-worktree observation.

Cancellation is a separate authorized operation:

```ts
type SemanticJobCancellationRequest = {
  schema: "direct_semantic_job_cancellation_request@1";
  cancellationRequestRef: string;
  jobRef: string;
  requestedCellRefs: string[];
  boundedReason: string;
  idempotencyKey: string;
};

type SemanticJobCancellationDecision = {
  schema: "direct_semantic_job_cancellation_decision@1";
  cancellationDecisionRef: string;
  cancellationRequestRef: string;
  cancelCapabilityRef: string;
  authorizedPendingCellRefs: string[];
  signalRequestedRunningAttemptRefs: string[];
  ineligibleTerminalCellRefs: string[];
  decision: "authorized" | "partially_authorized" | "rejected";
};
```

A cancellation is prospective. It cannot erase an attempt, raw result,
MicroResult, or evaluation already recorded.

### 8.3 Inspection and results

Job inspection exposes derived state, counts, bounded blockers, safe artifact
references, compiler/runtime revisions, and usage. It excludes private paths,
credentials, prompts, raw provider payloads, and quarantined output.

`results` returns admitted MicroResults, evaluations, dispositions, and their
lineage according to the caller's read capability and selected projection.
Rejected attempts remain visible as bounded admission/recovery records.

## 9. Append-only lifecycle

Job truth is the ordered event history:

```sql
job_events(
  job_ref,
  sequence,
  global_sequence,
  event_type,
  artifact_ref,
  safe_payload_json,
  prior_event_digest,
  event_digest,
  prior_global_custody_digest,
  global_custody_digest,
  custody_key_revision_ref,
  custody_tag,
  recorded_at
)

service_events(
  global_sequence,
  event_type,
  artifact_ref,
  safe_payload_json,
  prior_global_custody_digest,
  global_custody_digest,
  custody_key_revision_ref,
  custody_tag,
  recorded_at
)
```

Sequence is contiguous per job. `global_sequence` and the global custody digest
belong to one store-wide contiguous chain shared with service events such as
key rotation. Events are immutable, chained both within their job and across
service custody, and authenticated under the named custody-key revision.
Materialized job, cell, attempt, and subscription heads are derived projections
that must reproduce on restart.

The store allocates `global_sequence` under the same immediate SQLite
transaction that commits an event. Job and service events draw from one counter;
neither table owns an independent sequence range.

The minimum successful path is:

```text
job_admitted
compiler_pin_verified
compilation_started
compilation_completed
target_snapshot_verified
execution_plan_admitted
route_admitted
materialization_started
materialization_admitted
capsule_admitted
attempt_allocated
preexecution_assurance_admitted
attempt_started
raw_result_captured
raw_result_admission_recorded
microresult_admitted
evaluation_recorded
terminal_coverage_receipt_admitted
job_results_sealed
job_completed
```

Failure/remand paths include:

```text
job_rejected
compilation_failed
route_rejected
materialization_failed
evidence_page_fault_candidate_recorded
evidence_page_fault_validated
known_insufficient_page_remanded
capsule_rejected
attempt_preflight_rejected
attempt_transport_failed
attempt_runtime_failed
raw_result_rejected
attempt_interrupted_unknown
evaluation_remanded
cancellation_requested
cancellation_authorized
running_attempt_cancel_signal_requested
running_attempt_cancel_acknowledged
running_attempt_cancel_race_lost
expected_cell_cancelled
job_failed
job_remanded
```

State is never a caller-writeable enum. A reducer derives it from legal event
transitions and rejects impossible histories.

Completion has a strict commit point:

```text
closed TerminalCoverageReceipt over the immutable ExecutionPlan
  -> all required result/evaluation/disposition blobs durably published in CAS
  -> SQLite transaction records their references
  -> terminal_coverage_receipt_admitted event
  -> job_results_sealed event
  -> job_completed event
  -> transaction commits
```

No UI, process exit, provider terminal marker, or uncommitted file implies
completion.

### 9.1 Cancellation and running-attempt races

An authorized cancellation immediately terminalizes only expected cells that
have no committed `attempt_started` event. Such cells enter the
`AuthorizedCancellations` coverage partition with an exact decision receipt.

For a running attempt, authorization emits a cancel-signal request but does not
yet terminalize the cell:

```text
runtime proves cancellation terminal, process/operation reaped,
all result streams closed, no buffered raw capture, and no prior terminal event
  -> attempt cancelled
  -> expected cell may become AuthorizedCancellation

raw or terminal provider event wins the compare-and-swap race
  -> cancellation loses
  -> observed attempt/result follows its normal admission path

daemon loses contact without acknowledgment or terminal evidence
  -> attempt_interrupted_unknown
  -> never relabel as cancelled
```

Retries after a cancellation race remain governed by the frozen attempt policy.
Cancellation of one replicate slot does not cancel sibling slots unless each is
named and authorized. A completed job rejects new cancellation requests.

## 10. Storage and transaction laws

### 10.1 Storage separation

```text
SQLite
  identities and capability verifiers
  immutable registry revisions
  jobs and append-only events
  artifact references and projections
  attempts, leases, recovery, usage, subscriptions, cursors

content-addressed store
  compiler validation receipts
  routes and materializations
  capsules and assurance records
  admitted MicroResults
  attestations, evaluations, dispositions

quarantine
  raw model/backend outputs
  malformed structured output
  bounded rejection diagnostics
```

The service uses a dedicated database, CAS, quarantine root, and external
custody key. It accepts neither a caller-owned database handle nor an arbitrary
database filename. It never opens a WorldManager, epistemic, WorkThread, or
worker-artifact database as its own store.

Custody is revisioned:

```ts
type CustodyKeyRevision = {
  schema: "direct_semantic_custody_key_revision@1";
  custodyKeyRevisionRef: string;
  keyFingerprint: string;
  predecessorRevisionRef: string | null;
  effectiveAfterGlobalSequence: number;
  admittedByCapabilityRef: string;
  admittedAt: string;
};

type CustodyKeyRotationRecord = {
  schema: "direct_semantic_custody_key_rotation@1";
  rotationRef: string;
  priorKeyRevisionRef: string;
  nextKeyRevisionRef: string;
  lastPriorKeyGlobalCustodyDigest: string;
  priorKeyCustodyTag: string;
  nextKeyCustodyTag: string;
  effectiveAfterGlobalSequence: number;
};
```

Key bytes never enter SQLite. The owner-only service keyring retains every key
revision needed to verify historical events. Rotation is authorized separately
and produces a boundary record authenticated by both the outgoing and incoming
keys. Old events are never re-tagged. Each event names the key revision that
authenticated it; missing historical key custody, an invalid rotation bridge,
or overlapping effective ranges fails closed. Key retirement may remove a key
from future signing only after all required historical verification custody is
preserved according to retention policy.

Quarantine has separate owner-only custody, retention, and access policy. Raw
content never appears in normal event payloads or renderer-safe projections.

### 10.2 Publish-before-reference

CAS publication must complete before SQLite can reference an artifact:

```text
render canonical bytes
  -> write same-filesystem temporary file
  -> fsync file
  -> verify digest
  -> atomic rename to digest path
  -> fsync containing directory
  -> begin SQLite transaction
  -> insert artifact reference and event
  -> commit
```

An orphan CAS blob is safe and garbage-collectable. A committed SQLite
reference to a missing or partial blob is forbidden.

The service verifies artifact digests on read, validates containment, rejects
symlink path redirection, and keeps database/CAS/quarantine custody identities
explicit.

### 10.3 Leases and concurrency

Workers operate under durable leases. A lease binds one attempt, capsule,
backend slot, daemon generation, and expiry. A process may not publish against
another lease or a stale generation.

One logical task does not imply one unbounded process. The scheduler runs a
configured window over the cohort, applies per-provider concurrency and usage
limits, and records queue/backpressure state without changing semantic order or
selection rules.

## 11. Worker isolation profiles

### 11.1 Deterministic fake worker

The first backend consumes a capsule fixture and deterministically emits:

- structurally valid support/refute/inconclusive/remand results;
- malformed output;
- delayed output;
- transport failure;
- runtime failure;
- partial output followed by interruption;
- page fault and novel-edge candidates.

It performs no model call. Its purpose is to prove the institution.

### 11.2 Closed-page model worker

The preferred real backend uses a model API over one sealed evidence page. It
receives no shell, repository, patch, network-discovery, Direct database,
provider credentials, or arbitrary file tools.

If a subscription-backed model must initially run through `codex exec`, the
adapter must approximate the same boundary with:

```text
disposable empty HOME
scrubbed environment
no project path in writable or readable roots
sealed page supplied through stdin or an isolated input mount
one isolated writable scratch/result directory
read-only sandbox elsewhere
no inherited Direct or provider credential files
```

If the runtime cannot realize the capsule policy, preflight rejects it. The
service must not weaken isolation to make the call work.

Spark is a candidate execution backend because the operation is bounded typed
compression/reasoning. It is not a constitutional dependency and its usage
pool must be measured from observed provider evidence rather than assumed.

### 11.3 Frontier auditor

A repo-browsing worker is a separate artifact class, policy, kernel, and
capability envelope. It may search outside a closed page to challenge route
closure, but it cannot be reached automatically by a page worker. Escalation
requires an explicit lifecycle transition and authority.

## 12. Restart and recovery

Every daemon start opens a new service generation and emits recovery events.
Restart must never silently retry an attempt, reuse a process, reinterpret a
raw output, or infer completion.

Recovery rules:

| Persisted boundary | Recovery disposition |
| --- | --- |
| job admitted, no compilation event | emit recovery classification; resume deterministic compilation explicitly |
| execution plan admitted, expected cell has no terminal partition | preserve it as open; resume only its next deterministic stage |
| attempt allocated, no durable start witness | mark pre-execution abandonment; allocate a new attempt only under policy |
| attempt started, no terminal/raw capture | emit `attempt_interrupted_unknown`; never assume no provider execution |
| running cancel signal requested, no acknowledgment or terminal event | classify the attempt interrupted/unknown; never promote it to authorized cancellation |
| raw quarantine object exists, no committed reference | treat as orphan/quarantine residue; never attach by guess |
| raw-result reference committed, admission absent | emit post-execution recovery-resume event; admission may continue without re-execution |
| canonical CAS object exists, no committed reference | treat as orphan; deterministic stage may republish/reference only through an explicit recovery transition |
| delivery offered, acknowledgment absent | revalidate authority and replay from the acknowledged cursor |
| terminal coverage receipt open or invalid | do not seal or complete; preserve exact unclassified/duplicate cells |
| results sealed, completion absent | verify every artifact and reducer invariant, then emit explicit completion-recovery event in a new transaction |
| completion event committed | terminal; never rerun |

Retryability is evaluated against the frozen `AttemptPolicy`. A retry always
creates a new attempt identity and records the causal failure reference. An
admitted semantic disposition is not a retryable transport failure.

On startup the service must:

1. authenticate store custody, custody-key rotation lineage, and registry revisions;
2. run SQLite integrity and foreign-key checks;
3. verify event chains and contiguous sequences;
4. verify every referenced CAS object;
5. rebuild all projections from events and compare persisted heads;
6. reproduce every ExecutionPlan and TerminalCoverageReceipt partition;
7. classify expired leases, incomplete attempts, cancellation races, and
   unacknowledged deliveries;
8. append explicit recovery events;
9. resume only stages allowed by exact persisted boundaries and policy.

Any ambiguous authority, identity, target, artifact, or event history fails
closed and remains inspectable.

## 13. Delivery subscriptions

```ts
type DeliverySubscription = {
  schema: "direct_semantic_delivery_subscription@1";
  subscriptionRef: string;
  jobRef: string;
  subscriberPrincipalRef: string;
  readCapabilityRef: string;
  eventTypeFilter: string[];
  returnProjectionRef: string;
  startingCursor: number;
  deliveryAdapterRef: "cli_poll" | "electron" | "direct_task_wakeup";
  createdAt: string;
};

type DeliveryAttempt = {
  schema: "direct_semantic_delivery_attempt@1";
  deliveryAttemptRef: string;
  subscriptionRef: string;
  capabilityValidationReceiptRef: string;
  firstEventSequence: number;
  lastEventSequence: number;
  projectionDigest: string;
  offeredAt: string;
  acknowledgmentDeadline: string;
};

type DeliveryAcknowledgment = {
  schema: "direct_semantic_delivery_acknowledgment@1";
  acknowledgmentRef: string;
  deliveryAttemptRef: string;
  subscriberPrincipalRef: string;
  projectionDigest: string;
  acknowledgedAt: string;
};
```

`wait --after <cursor>` blocks only for a bounded timeout and returns the next
authorized projection plus its `deliveryAttemptRef`. Offering a projection may
advance a derived offered cursor, but never the acknowledged cursor. Only a
valid acknowledgment over the exact delivery and projection digest advances
the contiguous acknowledged cursor.

An unacknowledged or expired offer is replayed from the acknowledged cursor.
Delivery is therefore at-least-once; consumers deduplicate using
`(jobRef, sequence)`. Acknowledgment changes delivery state only. It does not
delete, admit, or change the standing of the underlying result.

Offered, acknowledged, and expired-unacknowledged are derived states from the
immutable attempt, acknowledgment events, and current time; the delivery
attempt row is never updated in place to manufacture a new history.

Before every offer or replay, Direct revalidates the subscription's
`readCapabilityRef`, expiry/revocation state, job scope, event filter, and
return projection. Invalid authority emits a bounded `subscription_paused`
event and discloses no new payload. Resumption requires a newly authorized
subscription revision; it never silently substitutes a new capability into the
old subscription. Revocation cannot recall payload already acknowledged, but
it prevents further disclosure.

Initially, external Codex tasks poll through the CLI. Later, Electron or a
Direct task-wakeup adapter may consume the same durable outbox. Delivery does
not require the original requester to remain alive.

## 14. Accounting and observability

The daemon records per job, cell, capsule, attempt, provider, model, and backend:

- queue and execution time;
- transport/runtime/admission outcomes;
- input/output byte and token evidence;
- observed provider usage class/quota pool when available;
- retry and replicate counts;
- page size and evidence-cell coverage;
- cache/materialization reuse;
- isolation and preflight posture.

Metrics never change semantic standing. A cheaper/faster model may be selected
only by the frozen execution profile or a new job/capsule revision, not by
mid-flight scheduler improvisation.

Higher-level clients inspect typed status projections rather than scavenging
process logs. Raw logs remain evidence references for diagnostics.

## 15. Kernel ratification and common-mode risk

Independent workers do not protect against a shared bad kernel:

```text
bad K * 100 independent X_i -> 100 consistently wrong Y_i
```

Kernel ratification therefore precedes mass execution and carries a stronger
burden than an individual cell:

- known positive and negative fixtures;
- known counterexamples killed;
- metamorphic invariants preserved;
- mutation operators rejected;
- transfer to unrelated domains;
- independent counterkernel comparison;
- authority and noninterference checks;
- exact compiler and evidence-lineage receipts.

Direct verifies ratification references and policy eligibility. The compiler
department owns the semantic adequacy of the kernel and its revision.

## 16. First industrial experiment

After fake-worker acceptance, the first live experiment should use one S14
family with 8-12 pre-adjudicated occurrences and mixed cases:

- known support;
- known refutation;
- genuinely missing evidence;
- stale page;
- insufficient route;
- malformed model output;
- counterexample outside the initial route.

Suggested matrix:

```text
one ratified kernel candidate
deterministic route compilation
closed materialized pages
Spark and Blue repeated execution arms
independent rematerialization of a subset
strict admission
one counterkernel review
evaluation against repository witnesses, not model consensus
```

The experiment succeeds when every failure is attributable to one of:

```text
kernel
route
materialization
runtime/isolation
execution/transport
raw-result admission
attestation/evaluation
```

without allowing a worker to widen its own jurisdiction.

## 17. Implementation sequence

### DSS-0.1 — Contracts and registry

- freeze JSON schemas for principals, capabilities, requests, receipts,
  compiler pins, project registry revisions, project/worker runtime revisions,
  target snapshots, execution plans, jobs, events, cancellations,
  subscriptions/deliveries, terminal coverage, and every computation/result
  object named in this constitution;
- define canonical JSON/digest rules, closed failure/selection enums, and
  per-replicate attempt limits;
- implement immutable registry revision admission and exact pin verification;
- add fixtures for forged requester metadata, stale executable/toolchain/
  environment pins, mutable aliases, later-revision capability expansion,
  forbidden paths, numeric-budget races, and capability cross-use.

Gate: no scheduler or worker exists; all identity and registry games pass.

Implementation status (2026-08-24): complete as an in-process foundation.
Direct now exposes the frozen contract/schema ABI, canonical digest rules,
opaque transport and semantic principals, operation-specific capabilities,
atomic bounded authorization, immutable registry admission, exact compiler /
target / runtime pin verification, and one composition root. The focused gate
is `npm run direct:semantic-service-dss01`. This status does not claim daemon,
durable storage, scheduling, model execution, or restart recovery; those begin
at DSS-0.2.

### DSS-0.2 — Durable job kernel

- implement SQLite custody, append-only authenticated events, reducers, CAS,
  quarantine, custody-key revisions/rotation, leases, and
  publish-before-reference transactions;
- implement submit/inspect/wait/ack/results CLI over a Unix socket;
- add idempotency, backpressure, offered/acknowledged delivery cursors,
  per-delivery capability revalidation, and bounded safe projections.

Gate: kill/restart and corruption games prove no dangling references, false
completion, duplicate jobs, or unauthorized reads.

### DSS-0.3 — Fake execution backend

- implement deterministic capsule fixtures and every terminal/failure mode;
- implement immutable ExecutionPlans, per-slot attempt policy, cancellation
  races, raw capture, quarantine, structural admission, typed result/
  attestation/evaluation/disposition objects, TerminalCoverageReceipts, result
  sealing, and recovery;
- prove that admitted remands/inconclusives cannot be outcome-laundered.

Gate: the complete service passes without credentials, network, or model use.

### DSS-0.4 — Compiler adapter and materializer

- invoke only the exact pinned compiler build;
- bind compiled routes to immutable project registry revisions;
- admit complete TargetSnapshotReceipts and distinct
  ProjectEvidenceRuntimeRevisions;
- materialize closed pages and completeness/sufficiency receipts only from
  immutable snapshot artifacts;
- deterministically remand known-insufficient pages without model compute;
- separate worker page-fault candidates from independently validated records;
- reject stale target revisions, submodule/LFS/generated-input drift, route
  drift, page faults, and compiler output that fails canonical Direct admission.

Gate: repeated compilation/materialization is digest-stable; independent
rematerialization and stale-target games pass.

### DSS-0.5 — Real closed-page backend

- add one isolated model adapter, initially Spark if runtime evidence supports
  it;
- bind it to a distinct WorkerExecutionRuntimeRevision;
- map provider structured-output dialects at the adapter boundary, then
  validate canonical Direct/compiler contracts;
- record usage, transport interruptions, raw rejection, and exact attempt
  lineage.

Gate: live results remain advisory, target repositories remain clean, workers
cannot observe unrelated paths/credentials, and no interruption causes a
silent retry or false completion.

### DSS-0.6 — Direct/Electron and institutional handoff

- expose daemon health, jobs, attempts, decisions, and delivery subscriptions
  as optional observation surfaces;
- allow WorkThreads to submit an `AuditPackage`, terminate/rest, and later
  receive a bounded `AuditDisposition`;
- preserve separate submit/read/wakeup capabilities.

Gate: Electron can be closed throughout execution; restart and delayed
subscriber delivery preserve the same job identity and artifacts.

## 18. Acceptance games

The v0 fake-worker gate must include at least:

1. same idempotency key/same request returns the original receipt;
2. same key/different request is rejected;
3. copied `requester_ref` grants nothing;
4. Unix peer identity cannot substitute for a missing semantic capability;
5. submit capability cannot read results;
6. read capability cannot submit or cancel;
7. mutable project/compiler alias cannot enter a job;
8. compiler source, executable, interpreter/toolchain, installed-environment,
   or invocation-contract drift rejects before compilation;
9. client-supplied path is rejected;
10. stale/dirty target or submodule, LFS, generated-input, cartography, or
    project-runtime drift rejects before materialization;
11. incomplete page cannot become a capsule;
12. unavailable evidence closes accounting but not sufficiency;
13. isolation failure rejects before worker compute;
14. malformed raw result remains quarantined and receives no MicroResult;
15. admitted inconclusive cannot be silently rerun;
16. retryable transport failure creates a new visible attempt;
17. crash before CAS rename creates no reference;
18. crash after CAS publication creates at most an orphan blob;
19. crash after raw capture resumes admission without worker re-execution;
20. running attempt at daemon death becomes interrupted/unknown;
21. restart emits explicit recovery events;
22. event-chain, HMAC, projection, or artifact corruption fails closed;
23. completion never precedes a closed expected-cell partition and durable
    result references;
24. an offered but unacknowledged delivery replays, while only an exact
    acknowledgment advances the contiguous acknowledged cursor;
25. Electron absence does not affect the job;
26. worker cannot widen evidence or access the registered repository;
27. novel edge is reported without becoming law;
28. independence fails when only worker names differ;
29. benchmarking freezes every non-experimental lineage dimension;
30. no admitted result mutates project or WorldManager truth;
31. a capability cannot authorize registry, target, compiler, kernel, runtime,
    provider, model, attempt-policy, or projection revisions admitted later;
32. request authority is the intersection of capability, registry policy,
    execution policy, exact request values, and atomically consumed budgets;
33. an ExecutionPlan cannot omit a selected edge or replicate slot and still
    produce a closed TerminalCoverageReceipt;
34. a partial selection cannot claim exhaustive compilation coverage;
35. an exhaustive plan fails when it does not reproduce the exact compiled
    obligation set;
36. mutable-worktree change during snapshot capture rejects the receipt, and
    later worktree change cannot affect materialization from the admitted
    immutable artifact;
37. project evidence runtime and worker execution runtime cannot substitute for
    one another;
38. a known-insufficient page creates deterministic remands and launches zero
    model attempts;
39. a page-confined worker can create only an EvidencePageFaultCandidate, not a
    validated semantic fault;
40. a revoked or expired read capability pauses delivery before any new payload
    disclosure;
41. an unacknowledged running-attempt cancellation never enters the authorized
    cancellation coverage partition;
42. a raw-result/cancellation race preserves whichever terminal event wins the
    exact compare-and-swap and erases neither history;
43. custody-key rotation requires a dual-authenticated boundary and preserves
    historical verification under the named key revisions;
44. missing RawResult, MicroResult, Attestation, Evaluation, or
    AdvisoryDisposition bindings prevent sealing;
45. retry failure classes and selection rules reject values outside their
    closed enums;
46. attempt exhaustion is calculated per expected replicate slot, while every
    sibling slot remains independently accountable.

## 19. Review closure map

| Review item | Constitutional discharge |
| --- | --- |
| DSS-R001 | immutable `ExecutionPlan`, exact partial/exhaustive posture, replicate-slot expected set, and `TerminalCoverageReceipt` required for sealing |
| DSS-R002 | complete `TargetSnapshotReceipt` over an immutable read-only snapshot artifact with exact capture verification |
| DSS-R003 | closed immutable capability revision sets, resource bounds, atomic budget use, and intersection authorization |
| DSS-R004 | durable delivery attempts, separate offered/acknowledged cursors, explicit acknowledgments, and per-offer reauthorization |
| DSS-R005 | separate `ProjectEvidenceRuntimeRevision` and `WorkerExecutionRuntimeRevision` bindings |
| DSS-R006 | `SufficiencyEligibilityReceipt` and deterministic pre-execution remand for known insufficiency |
| DSS-R007 | advisory `EvidencePageFaultCandidate` separated from authority-validated `EvidencePageFaultRecord` |

The schema-freeze tightening is discharged by executable/interpreter/
environment compiler pins, explicit cancellation/race objects, closed result
and disposition schemas, revisioned custody-key rotation, and closed
per-replicate attempt-policy enums.

## 20. Promotion law

Maturity must remain explicit:

```text
specified
  -> schema-frozen
  -> fake-worker regression-proven
  -> restart/custody-proven
  -> compiler-integrated
  -> closed-page live-proven
  -> operator-usable
  -> eligible for a separately governed authority bridge
```

No stage implies the next. In particular, a successful Spark experiment does
not make the service authoritative, and a polished Electron surface does not
prove daemon recovery or evidence closure.

The compact constitutional law is:

> Expensive cognition ratifies reusable semantic legislation. Direct applies
> that exact legislation to sealed evidence pages through replaceable,
> low-authority execution cores, admits only well-bound outputs, preserves
> every attempt, and wakes higher authority only when durable semantic standing
> changes.
