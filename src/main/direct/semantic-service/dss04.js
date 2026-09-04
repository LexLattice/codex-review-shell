"use strict";

/* DSS-0.4 foundation.  Later compilation/materialization reducers are kept
 * out of this file so the initial authority boundary stays auditable. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { spawnSync } = require("node:child_process");
const { Dss04SqliteStore } = require("./dss04-sqlite");
const { Dss02Error, canonicalJson, digestObject, deepFreeze, atomicWrite } = require("./dss02-common");

const DSS04_SCHEMA = "direct_semantic_service_dss04@1";
const DSS04_TRANCHE_REVISION = "direct-semantic-service-dss04@0.4";
const CONTRACT_REVISION = "sha256:dc4824ef63a2b1e52b5f2d4ae792c6d61eec14abc9a10ff865ca7cc8df9777c3";
const IMPLEMENTATION_COMMIT = "e57e4009312ffe21b22d18d996ff461ad5018388";
const SEMANTIC_CANDIDATE = "04c6437522779c060c2c3f3e3050a42ca0b77a1f";
const RESULT_SCHEMA = "direct-semantic-service-dss03-result.v1";
const SERVICE_GENERATION = "sha256:f3f7d115b7d8d3f39665c8afddedaa38d3ae1ba4fe91c294270806867594b019";
const COMPILER_BUILD_PIN_DIGEST = "sha256:ed78b1c91c7ba8eeae0dfb7cf950dcf432c422ecc96e693008fb10ae03016127";
const COMPILER_INVOCATION_DIGEST = "sha256:60a316a77777d94973cd07436c95d1891fb24011a8b46299e2e7828bfbc078f6";
const COMPILER_ENVIRONMENT_DIGEST = "sha256:359e0ff20a700d592a75cd55f1b470327959adb31611e0d755fd66eb4f105ab5";
const PROJECT_ROOT_DIGEST = "sha256:649e72b2836f0244587cf44873a07c894378ae2230ace60b7023f946d3d91981";
const MATERIALIZER_REVISION = "direct.dss04.closed-page-materializer.v1";
const MATERIALIZATION_POLICY_DIGEST = "sha256:51fd8244d5272442e2e7923da46edcceaffebfcc33ccd32a13664a0594cb0f8f";
const SERIALIZATION_REVISION = "direct.canonical-json.v1";
const STORE_SCHEMA_REVISION = "direct.dss04.sqlite.v1";
const CUSTODY_KEY_REVISION = "owner-installed-dss04-custody-key.v1";
const SANDBOX_EXECUTABLE_DIGEST = "sha256:52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712";
const SANDBOX_PROFILE = Object.freeze({ network: "unshared", environment: "cleared", filesystem: "usr-runtime-plus-work-only", credentials: "none", inheritedFileDescriptors: "none", userConfiguration: "none", cache: "none" });
const SANDBOX_PROFILE_DIGEST = digestObject("DirectSemanticService.Dss04.SandboxProfile.v1", SANDBOX_PROFILE);
const PINNED_RUNTIME_DEPENDENCIES = Object.freeze([
  ["/usr/bin/node", "sha256:f3f93db342d5ac5bb61656d0599a603a73779e98befd9342171e550002725f4d"],
  ["/lib/x86_64-linux-gnu/libnode.so.109", "sha256:ce7cb9cd408c412090c86dada332aaa82650679ed1b32527768c8dbd8c4028d0"],
  ["/lib/x86_64-linux-gnu/libc.so.6", "sha256:8db37cf3f2169f59a0f07ef1fea308c35656668c64c8ff294e1860f4121eb161"],
  ["/lib/x86_64-linux-gnu/libz.so.1", "sha256:86200da370f20476a2507e9097a789b5ef97269b4ca8d5e164ad82dab9d99892"],
  ["/lib/x86_64-linux-gnu/libuv.so.1", "sha256:11933a4a53d7cc817afb01610242b59a0e2e1b2bd64589a2203c1f84bbf7083f"],
  ["/lib/x86_64-linux-gnu/libbrotlidec.so.1", "sha256:64d8a5019d4c294b89fde1193343ea324bbd8603652554e5545f0a01595fa2c5"],
  ["/lib/x86_64-linux-gnu/libbrotlienc.so.1", "sha256:6e59301f6c3a05815ecc6cd8c56714280367da1f6737e9f077f5847d86c509f2"],
  ["/lib/x86_64-linux-gnu/libcares.so.2", "sha256:75f2826fc310a770ec0ecc2299b60f79acb8ea27f30a197b3729c087a9220ca5"],
  ["/lib/x86_64-linux-gnu/libnghttp2.so.14", "sha256:46764ab5b6ca7e353a322054f0bee45d9158a27f3e6a82a2fa4447f2ba9ba268"],
  ["/lib/x86_64-linux-gnu/libcrypto.so.3", "sha256:6a66c3ba6b3749aacc9497973fff00f6ba61c703ba7015d0d7ab3fd9510974b6"],
  ["/lib/x86_64-linux-gnu/libssl.so.3", "sha256:8e49cebd373d90b55f3626da71dd97fe8e95c68dc4c064d8962b27907690736e"],
  ["/lib/x86_64-linux-gnu/libicui18n.so.74", "sha256:3550b194eb2cf2e6f798f033eb9ca279d498c21296b4a18790ce158d2023e47b"],
  ["/lib/x86_64-linux-gnu/libicuuc.so.74", "sha256:7560aadde38e5f4237a47a1ddd5891f9b36768a77a60faae30beee003ac01901"],
  ["/lib/x86_64-linux-gnu/libstdc++.so.6", "sha256:1fd75fe70354a416d75aef22bcae68c47bd25d20e2d0568c30b1a9838cf62f11"],
  ["/lib/x86_64-linux-gnu/libm.so.6", "sha256:e9c4b28d340e415b8137480ec442662f981e1399386c5931dae0e886e3639e91"],
  ["/lib/x86_64-linux-gnu/libgcc_s.so.1", "sha256:d93224d2b0dab4247598be683adca02f5cf00586f99c187579cd7e92058fb7cb"],
  ["/lib64/ld-linux-x86-64.so.2", "sha256:cd4df4f3c7b83673d61189bf2eaebd33ca4f2853ab9772b8a25e025ef99b1e81"],
  ["/lib/x86_64-linux-gnu/libbrotlicommon.so.1", "sha256:a91ead095d2c80520c55a89057bbe10b031a075340442e63f44b310f93883a1b"],
  ["/lib/x86_64-linux-gnu/libicudata.so.74", "sha256:ddbb3718b8bd9cbd780e5ab08b4503c30a6c4fa0706ebe5d074ed6b596c1714e"]
  , ["/usr/share/nodejs/cjs-module-lexer/lexer.js", "sha256:0abd984d16d53a59af9978283f9fddaee1342edc6ccb7810e443d6ee0ff26fff"],
  ["/usr/share/nodejs/cjs-module-lexer/dist/lexer.js", "sha256:bfcd3684f197fffc2b9b3d05ba95818d69fe3a4e6c54463f000bcd0dbd97fd2d"]
  , ["/etc/ld.so.cache", "sha256:4ae53bf857b2d7626182c1bc77b8d323e4ab601f4052835f1cde5f5190c96c2e"],
  ["/usr/lib/ssl/openssl.cnf", "sha256:529815b0dd4bd6608bafeeb3d410b0683374e61aef792b3e3f38b3767d26f747"],
  ["/usr/share/nodejs/undici/undici-fetch.js", "sha256:398ed64aebf6ee3b216049e5ff4df8297e4ad968a531aff0022bfaf9741266b4"],
  ["/usr/share/nodejs/acorn/dist/acorn.js", "sha256:cb3b2d439857d6e4514d23a1219f6354c23498f5fa81fdf2691a5a9e53de43c0"],
  ["/usr/share/nodejs/acorn-walk/dist/walk.js", "sha256:2bf2dbb2b7f0e4877eeffed1a9b51cec8cb341539c769da5e3ec83f5a8772672"]
]);
const PINNED_RUNTIME_DEPENDENCY_DIGEST = digestObject("DirectSemanticService.Dss04.RuntimeDependencyManifest.v1", PINNED_RUNTIME_DEPENDENCIES);
const LEASE_TTL_MS = 25000;
const PAGE_BYTE_BUDGET = 65536;
const PAGE_TOKEN_BUDGET = 16384;
const EVIDENCE_BYTE_BUDGET = 131072;
const ROOT_OWNER = "dss04-installation-owner";
const ROOT_AUTHORITY = "owner-protected-installation-root";
const ANCHOR_OWNER = "direct-project-owner";
const ANCHOR_ROOT = "owner-installed-dss04-contract-authority-root";
const ANCHOR_COMMIT = "619031aa763c5de5ea67338467f7c628b9a389b5";
const ANCHOR_ARCHAEOLOGY_PATH = "docs/audits/direct-semantic-service-dss04-owner-contract-anchor-v3/contract_authority_anchor.v3.json";
const ANCHOR_PATH = "src/main/direct/semantic-service/resources/dss04-contract-authority-anchor.v3.json";
const CONTRACT_ASSET_PATH = "src/main/direct/semantic-service/resources/dss04-implementation-contract.md";
const ANCHOR_SHA256 = "sha256:63d1948d8616b64e5636ba2d65d4cd3e2dd406676fd77c95a36775e2e74230d8";
const ANCHOR_PAYLOAD_DIGEST = "sha256:787de21adb9e9d5e53840f68f1090601e001d8bccad2ffe9f7803a14582123fc";
const ANCHOR_CUSTODY_POINTER_PATH = "src/main/direct/semantic-service/resources/dss04-ck-custody-pointer.v1.json";
const ANCHOR_CUSTODY_POINTER_SHA256 = "sha256:9c1561d90179922af37c170b683cf849cdd63802192d1daa4bfe9caf8be64095";
const ANCHOR_CUSTODY_RECEIPT_DIGEST = "sha256:746213e02ea9520388fbd76fee63a34a2ef99b54722e929226ba5e711c3225f7";
const ANCHOR_CUSTODY_BUNDLE_SHA256 = "d0e7a06994b895b39dd19f9385c9a97e7b3b7c552a80edc7a7b7676ec2075b5e";
const ANCHOR_GIT_BLOB_ID = "639808c1349c25c7135c3841eed4efd484cd5743";
const GIT_EXECUTABLE = "/usr/bin/git";
const GIT_EXECUTABLE_DIGEST = "sha256:2a8c18fbf43da9f692d75474c72bea9dfd796c260b0f3dfe456376abc3bbd668";
const PINNED_COMPILER_SOURCE_PATH = "scripts/dev/compile_semantic_contract_learning_v1.py";
const PINNED_COMPILER_SOURCE_DIGEST = "sha256:27ba7748a05a3dff57c7c3f2113623aa5561345cdadf62afe81fe1b8bcbd9c32";
const PINNED_COMPILER_COMMIT = "2dec60ee75178b98b9ae517a576002519e1f0f81";
const PINNED_COMPILER_MODULE_PATH = "docs/audits/direct-semantic-service-dss04-generation-8/module.v0.json";
const PINNED_COMPILER_MODULE_ASSET_PATH = "src/main/direct/semantic-service/resources/dss04-module.v0.json";
const PINNED_COMPILER_PATTERN_PATH = "meta/semantic_compiler/pattern_library.v0.json";
const PINNED_COMPILER_EXTENSION_PATH = "meta/semantic_compiler/audit_learning_patterns.v1.json";
const PINNED_COMPILER_SOURCE_TREE_DIGEST = "sha256:160b124ee04c5965070ea6d0c69ad001e022ed97e08e1f14d8315ed0f790f2c8";
const PINNED_COMPILER_ARTIFACTS = Object.freeze([
  ["scripts/dev/compile_semantic_contract.py", "sha256:71ae1f0b98914b198bf9e933f36fb78fd3940fec10412adbcdb0d3522248f0f5"],
  ["scripts/dev/compile_semantic_contract_learning_v1.py", PINNED_COMPILER_SOURCE_DIGEST],
  ["src/semantic_compiler/__init__.py", "sha256:d0f0c4f19052e15c789c195989cfd79e4d6e72cfa7f788117d57c2ff40f27dd8"],
  ["src/semantic_compiler/model.py", "sha256:5f30ed3ff34afca4a396efc892d69c6c5570b066ccc799696eb79fc121850aac"],
  ["src/semantic_compiler/compiler.py", "sha256:9cfaffccefa3c4aff84a90902153cca46539451b7c204fc99bc24d2b3ccf220b"],
  ["src/semantic_compiler/learning_v1.py", "sha256:4ec6e08653c495a1e55415b0b36d61a7940e6af5c19460bd454fefb58a405a31"],
  ["src/semantic_compiler/audit_focus_v1.py", "sha256:f5608eb64ddfa9a5b2df32ebae1c89377dc4d363b7a5a6ffd574238321abf78c"],
  [PINNED_COMPILER_PATTERN_PATH, "sha256:9364aa6ff0aa6e0e0fc87f7c5311cc8dd06b05dc3d2676b4e943345c9ac653c9"],
  [PINNED_COMPILER_EXTENSION_PATH, "sha256:b5dd1ca30da90244a7ec36358bd73d5f7fb8330700d04074b11be0b86bee7cf4"],
  ["meta/semantic_compiler/audit_learning_ledger.v1.json", "sha256:eab004568e2269e45f80e204c89fbab076f7b63cf785de99ee397c84d444d1d4"],
  ["meta/semantic_compiler/audit_focus_patterns.v1.json", "sha256:f3a58f5a3d0a605cacfa7608eb6c9312f72c853c942cc9fff8e337e003399b34"],
  ["meta/semantic_compiler/audit_focus_patterns.v2.json", "sha256:dce3d0305c882668660c3c9fb1300dc65c1e7bcea1cd6ac74cbb1aabcf7ad482"],
  ["meta/semantic_compiler/semantic_predicate_soundness_admission_gate_receipt.v1.json", "sha256:5bb515c72b714e06d52b0b234363975dc074094c6f6f1144632c357f45cef6c0"],
  ["meta/semantic_compiler/audit_learning_gate_receipt.v1.json", "sha256:7316824673880f205cb93347852456520fe160ffaa0979b8746e5f9b49d91c98"]
]);
const NORMALIZATION_REVISION = "direct.dss04.compiler-receipt-normalization.v2";
const SEMANTIC_MODULE_DIGEST = "sha256:5420171d0a6a1baf4118e2e5f07bba745eb878e8811b8c96cb72976d2d73852f";
const SEMANTIC_MODULE_BYTES_DIGEST = "sha256:6dc234befba25cee2c643b3293281f4b928a8c3b6eb1b1c2ec335aba647e0292";
const PINNED_PATTERN_LIBRARY_DIGEST = "009c10460282f6b58b8158519af8d74c6c9a43d7ef63b5e147ba2f8a8d1ec9e2";
const ROUTE_AUTHORITY_OWNER = "dss04-route-owner";
const ROUTE_AUTHORITY_ROOT = "dss04-route-custody-root";
const PREDECESSOR_OWNER = "dss03-sealing-owner";
const PREDECESSOR_ROOT = "ratified-dss03-result-root";
const PREDECESSOR_IMPLEMENTATION = "e57e4009312ffe21b22d18d996ff461ad5018388";
const PREDECESSOR_SEMANTIC = "45ca7736afbb6701d60abcdb6b0dc9888d2741b6";
const PIN_FIELDS = ["repository_commit", "source_tree_digest", "entrypoint_digest", "interpreter_digest", "dependency_lock_digest", "installed_environment_digest", "invocation_contract_digest", "pattern_library_digest", "learning_extension_digest", "focus_library_digest"];
const PINNED_COMPILER_COMMITMENTS = Object.freeze({
  repository_commit: PINNED_COMPILER_COMMIT,
  source_tree_digest: PINNED_COMPILER_SOURCE_TREE_DIGEST,
  entrypoint_digest: PINNED_COMPILER_SOURCE_DIGEST,
  interpreter_digest: "sha256:1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
  dependency_lock_digest: "sha256:94c6649f92d33287123fd6551f8a38c89a0b1d8cbdb5537f98cc05ee90ed56e0",
  installed_environment_digest: COMPILER_ENVIRONMENT_DIGEST,
  invocation_contract_digest: COMPILER_INVOCATION_DIGEST,
  pattern_library_digest: "sha256:9364aa6ff0aa6e0e0fc87f7c5311cc8dd06b05dc3d2676b4e943345c9ac653c9",
  learning_extension_digest: "sha256:b5dd1ca30da90244a7ec36358bd73d5f7fb8330700d04074b11be0b86bee7cf4",
  focus_library_digest: "sha256:dce3d0305c882668660c3c9fb1300dc65c1e7bcea1cd6ac74cbb1aabcf7ad482"
});
const REGISTRY_FIELDS = ["project_id", "registry_revision", "predecessor_digest", "registry_root_digest", "project_policy_digest", "allowed_target_kinds_digest", "allowed_compiler_profiles_digest", "allowed_evidence_runtime_profiles_digest", "signature_digest"];
const SNAPSHOT_FIELDS = ["project_id", "project_registry_revision_digest", "target_revision", "snapshot_root_digest", "file_inventory_digest", "executable_root_inventory_digest", "language_inventory_digest", "submodule_inventory_digest", "lfs_inventory_digest", "generated_input_inventory_digest", "cartography_digest", "snapshot_policy_digest", "capture_tool_revision", "capture_environment_digest", "captured_at"];
const RUNTIME_FIELDS = ["project_id", "project_registry_revision_digest", "target_snapshot_receipt_digest", "runtime_revision", "evidence_source_catalog_digest", "evidence_toolchain_digest", "evidence_policy_digest", "availability_snapshot_digest", "isolation_profile_digest", "environment_digest"];
const PREDECESSOR_FIELDS = ["dss03_service_generation", "dss03_implementation_commit", "dss03_semantic_candidate", "dss03_result_schema_revision", "dss03_job_id", "result_seal_digest", "result_population_coverage_digest", "terminal_result_event_head", "seal_receipt_digest", "sealing_owner_revision", "source_standing"];
const SNAPSHOT_FAMILIES = Object.freeze(["file_inventory", "executable_root_inventory", "language_inventory", "submodule_inventory", "lfs_inventory", "generated_input_inventory", "cartography"]);
const DSS04_CARRIER_FIELD_MAP = Object.freeze({
  "d.compilation-request": Object.freeze({ stable: Object.freeze(["request_id", "dss03_result_seal_digest", "project_registry_revision_digest", "target_snapshot_receipt_digest", "semantic_contract_module_digest", "project_evidence_runtime_revision_digest", "compiler_build_pin_digest", "compiler_invocation_contract_digest", "compiler_receipt_normalization_revision", "compilation_profile_digest", "requested_route_scope_digest", "materialization_policy_digest"]), generation: "service_generation" }),
  "d.compilation-idempotency-binding": Object.freeze({ stable: Object.freeze(["request_id", "semantic_input_digest", "result_identity_digest"]), generation: "service_generation" }),
  "d.dss04-allocation": Object.freeze({ stable: Object.freeze(["request_id", "work_kind", "work_identity", "reservation_digest"]), generation: "service_generation" }),
  "d.dss04-lease": Object.freeze({ stable: Object.freeze(["work_identity", "lease_owner", "fencing_token", "expires_at"]), generation: "service_generation" }),
  "e.compiler-process-observation": Object.freeze({ stable: Object.freeze(["end_monotonic_time", "exit_status", "input_custody_digest", "isolation_observation", "output_custody_digest", "process_identity", "request_id", "resource_accounting_digest", "start_monotonic_time", "stderr_byte_count", "stderr_seal", "stdout_byte_count", "stdout_seal"]), generation: "service_generation" }),
  "d.raw-compiler-output": Object.freeze({ stable: Object.freeze(["request_id", "process_observation_digest", "byte_length", "content_seal", "custody_tag"]), generation: "service_generation" }),
  "d.compiler-output-bundle": Object.freeze({ stable: Object.freeze(["request_id", "semantic_input_digest", "compiler_identity_digest", "source_receipt_digest", "normalization_revision", "obligation_population_digest", "route_population_digest", "input_fact_population_digest", "contact_occurrence_reconciliation_digest", "evidence_demand_population_digest", "exclusion_population_digest", "static_remand_population_digest", "content_seal"]), generation: "service_generation" }),
  "d.compiled-route-set": Object.freeze({ stable: Object.freeze(["compiler_output_bundle_digest", "ordered_route_population_digest", "occurrence_population_digest", "contact_occurrence_reconciliation_digest", "exclusion_theorem_digest", "normalization_receipt_digest"]), generation: "service_generation" })
  , "d.materialization-plan": Object.freeze({ stable: Object.freeze(["compiler_output_bundle_digest", "compiled_route_set_digest", "ordered_route_population_digest", "ordered_page_identity_population_digest", "route_to_page_partition_digest", "materialization_policy_digest", "page_byte_budget", "page_token_budget", "evidence_byte_budget"]), generation: "service_generation" })
  , "d.closed-evidence-page": Object.freeze({ stable: Object.freeze(["page_identity", "route_population_digest", "project_fact_population_digest", "source_fragment_population_digest", "evidence_object_population_digest", "unavailable_marker_population_digest", "policy_excerpt_population_digest", "authority_context_digest", "byte_length", "token_count", "content_seal"]), generation: "service_generation" })
  , "d.page-completeness-receipt": Object.freeze({ stable: Object.freeze(["page_identity", "required_route_population_digest", "materialized_route_population_digest", "remanded_route_population_digest", "required_evidence_population_digest", "evidence_reconciliation_digest", "reverse_map_digest"]), generation: "service_generation" })
  , "d.page-sufficiency-receipt": Object.freeze({ stable: Object.freeze(["page_identity", "worker_task_contract_digest", "completeness_receipt_digest", "availability_state_digest", "policy_state_digest", "budget_state_digest", "standing"]), generation: "service_generation" })
  , "d.known-insufficiency-remand": Object.freeze({ stable: Object.freeze(["page_identity", "failed_demand_population_digest", "failed_policy_population_digest", "route_occurrence_population_digest", "evidence_state_digest", "remand_code"]), generation: "service_generation" })
  , "e.page-fault-candidate": Object.freeze({ stable: Object.freeze(["worker_runtime_revision", "task_id", "attempt_id", "page_identity", "route_identity", "claimed_missing_fact_digest", "bounded_rationale_digest", "source_locator_digest"]), generation: "service_generation" })
  , "e.novel-edge-candidate": Object.freeze({ stable: Object.freeze(["worker_runtime_revision", "task_id", "attempt_id", "page_identity", "route_identity", "claimed_edge_digest", "bounded_rationale_digest", "source_locator_digest"]), generation: "service_generation" })
  , "d.candidate-validation-record": Object.freeze({ stable: Object.freeze(["candidate_digest", "validator_revision", "project_registry_revision_digest", "target_snapshot_receipt_digest", "project_evidence_runtime_revision_digest", "compiler_build_pin_digest", "classification", "evidence_digest"]), generation: "service_generation" })
  , "d.validator-revision": Object.freeze({ stable: Object.freeze(["validator_revision", "validator_build_digest", "validator_policy_digest", "validator_schema_digest", "issued_at"]), generation: "service_generation" })
  , "d.dss04-accounting": Object.freeze({ stable: Object.freeze(["request_id", "attempt_population_digest", "raw_bytes", "admitted_bytes", "page_bytes", "page_tokens", "evidence_bytes", "quarantine_bytes", "reservation_digest"]), generation: "service_generation" })
  , "d.materialization-batch-seal": Object.freeze({ stable: Object.freeze(["materialization_plan_digest", "planned_page_population_digest", "terminal_coverage_digest", "page_event_heads_digest", "receipt_population_digest", "remand_population_digest", "candidate_validation_heads_digest", "accounting_digest", "content_seal"]), generation: "service_generation" })
  , "d.dss04-recovery-disposition": Object.freeze({ stable: Object.freeze(["service_generation", "durable_population_digest", "event_population_digest", "projection_digest", "idempotency_population_digest", "route_page_partition_digest", "terminal_coverage_digest", "lease_population_digest", "seal_population_digest", "standing"]), generation: "service_generation" })
});

const RECOVERY_COLLECTIONS = Object.freeze([
  ["sealedResults", "e.dss03-sealed-result"], ["generations", "d.dss04-service-generation"],
  ["pins", "d.compiler-build-pin"], ["pins", "d.project-registry-root-pin"], ["registryRevisions", "d.project-registry-revision"],
  ["snapshotReceipts", "d.target-snapshot-receipt"], ["snapshotArtifacts", "d.target-snapshot-artifact"],
  ["evidenceRuntimes", "d.project-evidence-runtime-revision"], ["compilationRequests", "d.compilation-request"],
  ["idempotencyBindings", "d.compilation-idempotency-binding"], ["allocations", "d.dss04-allocation"],
  ["leases", "d.dss04-lease"], ["observations", "e.compiler-process-observation"],
  ["rawCompilerOutputs", "d.raw-compiler-output"], ["outputBundles", "d.compiler-output-bundle"],
  ["routeSets", "d.compiled-route-set"], ["materializationPlans", "d.materialization-plan"],
  ["closedEvidencePages", "d.closed-evidence-page"], ["pageCompletenessReceipts", "d.page-completeness-receipt"],
  ["pageSufficiencyReceipts", "d.page-sufficiency-receipt"], ["knownInsufficiencyRemands", "d.known-insufficiency-remand"],
  ["pageFaultCandidates", "e.page-fault-candidate"], ["novelEdgeCandidates", "e.novel-edge-candidate"],
  ["candidateValidationRecords", "d.candidate-validation-record"], ["materializationBatchSeals", "d.materialization-batch-seal"],
  ["events", "e.dss04-event-ledger"], ["derivedHeads", "d.dss04-derived-heads"], ["accounting", "d.dss04-accounting"],
  ["recoveryDispositions", "d.dss04-recovery-disposition"], ["validatorRevisions", "d.validator-revision"]
]);
const RECOVERY_REQUIRED_COLLECTIONS = Object.freeze([...new Set(RECOVERY_COLLECTIONS.map(([name]) => name))]);
const RECOVERY_OPERATION_INPUTS = Object.freeze([
  "sealedResults", "generations", "compilerBuildPin", "projectRegistryRootPin", "registryRevisions", "snapshotReceipts", "snapshotArtifacts", "evidenceRuntimes", "compilationRequests", "idempotencyBindings", "allocations", "leases", "observations", "rawCompilerOutputs", "outputBundles", "routeSets", "materializationPlans", "closedEvidencePages", "pageCompletenessReceipts", "pageSufficiencyReceipts", "knownInsufficiencyRemands", "pageFaultCandidates", "novelEdgeCandidates", "candidateValidationRecords", "materializationBatchSeals", "events", "derivedHeads", "accounting", "validatorRevisions"
]);

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function result(status, extra = {}) { return deepFreeze({ schema: DSS04_SCHEMA, status, authorityEffect: "none", ...extra }); }
function fail(code, message = code) { throw new Dss02Error(code, message); }
function requiredString(value, name) { if (typeof value !== "string" || !value || value.trim() !== value) fail("DSS04_FIELD_INVALID", name); return value; }
function exactFields(value, fields, name) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("DSS04_FIELD_INVALID", name); for (const field of fields) requiredString(value[field], `${name}.${field}`); return value; }
function noExtras(value, fields, name) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("DSS04_EXTRA_FIELD", `${name}.${key}`); }
function safeDigest(value, name) { if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) fail("DSS04_DIGEST_INVALID", name); return value; }
function stable(value) { return Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value); }
function anchorDigest(value) { return `sha256:${crypto.createHash("sha256").update(Buffer.from(`Dss04.OwnerContractAuthorityAnchor.v1\n${stable(value)}`, "utf8")).digest("hex")}`; }
function normalizedCompilerDigest(value) { return crypto.createHash("sha256").update(Buffer.from(stable(value), "utf8")).digest("hex"); }
function normalizationDomain(domain, value) { return `sha256:${crypto.createHash("sha256").update(Buffer.from(`${domain}\n${stable(value)}`, "utf8")).digest("hex")}`; }
const NORMALIZATION_TOP_FIELDS = Object.freeze(["compiler", "module_digest", "module_id", "obligation_count", "obligations", "pattern_library_digest", "reconciliation", "schema", "static_remands", "verdict"]);
const NORMALIZATION_OBLIGATION_FIELDS = Object.freeze(["id", "origin", "proof_kind", "region_path", "required_evidence", "status", "subject", "summary"]);
const NORMALIZATION_ORIGIN_FIELDS = Object.freeze(["pattern_id", "pattern_version", "surface_refs", "template_id"]);
const NORMALIZATION_SUBJECT_FIELDS = Object.freeze(["id", "kind"]);
const NORMALIZATION_RECONCILIATION_FIELDS = Object.freeze(["excluded_surface_ids", "mapped_surface_ids", "project_surface_count", "unclassified_surface_ids"]);
const NORMALIZATION_FORBIDDEN_FIELDS = Object.freeze(["routes", "contacts", "contact_occurrences", "input_facts", "evidence_demands", "route_population_digest", "input_facts_digest", "contact_occurrence_reconciliation_digest", "evidence_demand_population_digest", "normalization_receipt_digest"]);
function exactObjectKeys(value, fields) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...fields].sort().join("\0")); }
function sortedUniqueStrings(value) { return Array.isArray(value) && value.every((item) => typeof item === "string" && item) && value.join("\0") === [...new Set(value)].sort().join("\0"); }
function normalizeCompilerReceipt(receipt, module, request, generation) {
  if (!exactObjectKeys(receipt, NORMALIZATION_TOP_FIELDS)) return { status: "OUTPUT_REJECTED", reason: "receipt-field-population", authorityEffect: "NONE" };
  if (NORMALIZATION_FORBIDDEN_FIELDS.some((field) => Object.hasOwn(receipt, field))) return { status: "OUTPUT_REJECTED", reason: "caller-or-compiler-derived-population", authorityEffect: "NONE" };
  if (receipt.schema !== "semantic-compilation-receipt.v0" || stable(receipt.compiler) !== stable({ id: "openai.semantic-obligation-compiler", version: "0.1.0" }) || receipt.pattern_library_digest !== PINNED_PATTERN_LIBRARY_DIGEST) return { status: "OUTPUT_REJECTED", reason: "compiler-schema-or-identity", authorityEffect: "NONE" };
  if (receipt.module_id !== module.module_id || receipt.module_digest !== normalizedCompilerDigest(module)) return { status: "POPULATION_MISMATCH", reason: "semantic-module", authorityEffect: "NONE" };
  if ((request.semantic_contract_module_digest !== receipt.module_digest && request.semantic_contract_module_digest !== `sha256:${receipt.module_digest}`) || request.compiler_receipt_normalization_revision !== NORMALIZATION_REVISION || request.service_generation !== generation) return { status: "POPULATION_MISMATCH", reason: "request-normalization-binding", authorityEffect: "NONE" };
  if (!Array.isArray(receipt.obligations) || !Array.isArray(receipt.static_remands) || !exactObjectKeys(receipt.reconciliation, NORMALIZATION_RECONCILIATION_FIELDS) || receipt.obligation_count !== receipt.obligations.length) return { status: "POPULATION_MISMATCH", reason: "receipt-population", authorityEffect: "NONE" };
  if (!sortedUniqueStrings(receipt.reconciliation.mapped_surface_ids) || !sortedUniqueStrings(receipt.reconciliation.excluded_surface_ids) || !Array.isArray(receipt.reconciliation.unclassified_surface_ids) || receipt.reconciliation.unclassified_surface_ids.length !== 0 || receipt.reconciliation.project_surface_count !== (module.project_surface || []).length) return { status: "POPULATION_MISMATCH", reason: "reconciliation-population", authorityEffect: "NONE" };
  if (!["OBLIGATIONS_EMITTED", "REMAND_STATIC"].includes(receipt.verdict) || ((receipt.verdict === "OBLIGATIONS_EMITTED") !== (receipt.static_remands.length === 0))) return { status: "POPULATION_MISMATCH", reason: "static-remand-polarity", authorityEffect: "NONE" };
  const ids = [];
  for (const row of receipt.obligations) {
    if (!exactObjectKeys(row, NORMALIZATION_OBLIGATION_FIELDS) || !exactObjectKeys(row.origin, NORMALIZATION_ORIGIN_FIELDS) || !exactObjectKeys(row.subject, NORMALIZATION_SUBJECT_FIELDS) || typeof row.id !== "string" || !sortedUniqueStrings(row.origin.surface_refs) || !["carrier", "operation", "module"].includes(row.subject.kind) || typeof row.subject.id !== "string" || !sortedUniqueStrings(row.required_evidence) || !Array.isArray(row.region_path) || row.region_path.some((x) => typeof x !== "string" || !x) || typeof row.proof_kind !== "string" || typeof row.status !== "string" || typeof row.summary !== "string") return { status: "POPULATION_MISMATCH", reason: "obligation-shape", authorityEffect: "NONE" };
    ids.push(row.id);
  }
  if (ids.join("\0") !== [...new Set(ids)].sort().join("\0")) return { status: "POPULATION_MISMATCH", reason: "obligation-order-or-identity", authorityEffect: "NONE" };
  const sourceReceiptDigest = normalizationDomain("Dss04.PinnedCompilerReceipt.v1", receipt);
  const obligations = receipt.obligations.map(({ id, ...rest }) => ({ obligation_id: id, ...clone(rest) }));
  const routes = [], contacts = [], inputFacts = [], evidenceDemands = [];
  for (const obligation of obligations) {
    const routeId = normalizationDomain("Dss04.CompilerObligationRoute.v1", { sourceReceiptDigest, obligation });
    const occurrenceId = normalizationDomain("Dss04.CompilerObligationOccurrence.v1", { moduleDigest: receipt.module_digest, obligationId: obligation.obligation_id, subject: obligation.subject, patternId: obligation.origin.pattern_id, patternVersion: obligation.origin.pattern_version, templateId: obligation.origin.template_id, surfaceRefs: obligation.origin.surface_refs });
    const factId = normalizationDomain("Dss04.CompilerObligationInputFact.v1", { moduleDigest: receipt.module_digest, obligationId: obligation.obligation_id, subject: obligation.subject });
    const demands = obligation.required_evidence.map((kind) => ({ evidence_demand_id: normalizationDomain("Dss04.CompilerEvidenceDemand.v1", { routeId, evidenceKind: kind }), route_id: routeId, occurrence_id: occurrenceId, evidence_kind: kind, resolution: "UNRESOLVED_AT_ADMISSION" }));
    routes.push({ route_id: routeId, occurrence_id: occurrenceId, obligation_id: obligation.obligation_id, owner: ROUTE_AUTHORITY_OWNER, authority_owner: ROUTE_AUTHORITY_OWNER, authority_root: ROUTE_AUTHORITY_ROOT, authority_standing: "PINNED", project_id: request.project_id, request_scope_digest: request.requested_route_scope_digest, snapshot_receipt_digest: request.target_snapshot_receipt_digest, semantic_contract_module_digest: receipt.module_digest, input_fact_refs: [factId], evidence_demand_ids: demands.map((d) => d.evidence_demand_id) });
    contacts.push({ route_id: routeId, occurrence_id: occurrenceId }); inputFacts.push({ fact_id: factId, obligation_id: obligation.obligation_id, subject: clone(obligation.subject), semantic_contract_module_digest: receipt.module_digest, source_ref: request.target_snapshot_receipt_digest }); evidenceDemands.push(...demands);
  }
  const moduleExclusions = new Map((module.exclusions || []).map((row) => [row.surface_id, row])); const exclusions = []; let exclusionMismatch = false;
  for (const surfaceId of receipt.reconciliation.excluded_surface_ids) { const row = moduleExclusions.get(surfaceId); if (!row || typeof row.id !== "string" || typeof row.owner !== "string" || typeof row.theorem !== "string") { exclusionMismatch = true; continue; } exclusions.push({ exclusion_id: row.id, surface_id: surfaceId, owner: row.owner, theorem: row.theorem, theorem_digest: normalizationDomain("Dss04.OwnerRatifiedExclusionTheorem.v1", { surfaceId, owner: row.owner, theorem: row.theorem }) }); }
  if (moduleExclusions.size !== exclusions.length) exclusionMismatch = true;
  const digests = { obligation_population_digest: normalizationDomain("Dss04.ObligationPopulation.v1", obligations), route_population_digest: normalizationDomain("Dss04.RoutePopulation.v1", routes), occurrence_population_digest: normalizationDomain("Dss04.OccurrencePopulation.v1", routes.map((r) => r.occurrence_id)), input_fact_population_digest: normalizationDomain("Dss04.InputFactPopulation.v1", inputFacts), contact_occurrence_reconciliation_digest: normalizationDomain("Dss04.ContactOccurrenceReconciliation.v1", contacts), evidence_demand_population_digest: normalizationDomain("Dss04.EvidenceDemandPopulation.v1", evidenceDemands), exclusion_population_digest: normalizationDomain("Dss04.ExclusionPopulation.v1", exclusions), static_remand_population_digest: normalizationDomain("Dss04.StaticRemandPopulation.v1", receipt.static_remands) };
  const normalizationReceipt = { source_receipt_digest: sourceReceiptDigest, normalization_revision: NORMALIZATION_REVISION, service_generation: generation, compiler_build_pin_digest: request.compiler_build_pin_digest, semantic_contract_module_digest: receipt.module_digest, target_snapshot_receipt_digest: request.target_snapshot_receipt_digest, obligation_count: obligations.length, route_count: routes.length, occurrence_count: contacts.length, input_fact_count: inputFacts.length, evidence_demand_count: evidenceDemands.length, exclusion_count: exclusions.length, static_remand_count: receipt.static_remands.length, ...digests };
  const receiptWithDigest = { ...normalizationReceipt, normalization_receipt_digest: normalizationDomain("Dss04.CompilerReceiptNormalizationReceipt.v1", normalizationReceipt) }; const remanded = receipt.static_remands.length > 0 || exclusionMismatch;
  return { status: remanded ? "REMANDED" : "ADMITTED", reason: exclusionMismatch ? "exclusion-theorem-join" : receipt.static_remands.length ? "compiler-static-remand" : null, sourceReceiptDigest, normalizationReceipt: receiptWithDigest, obligations, routes, contacts, inputFacts, evidenceDemands, exclusions, staticRemands: clone(receipt.static_remands), authorityEffect: remanded ? "TYPED_REMAND_ONLY" : "NORMALIZED_POPULATIONS_ADMITTED" };
}

const GENERATION_IDENTITY = Object.freeze({ service_generation: SERVICE_GENERATION, dss03_implementation_commit: IMPLEMENTATION_COMMIT, dss03_semantic_candidate: SEMANTIC_CANDIDATE, dss03_result_schema_revision: RESULT_SCHEMA, dss04_contract_revision: CONTRACT_REVISION, compiler_build_pin_digest: COMPILER_BUILD_PIN_DIGEST, compiler_invocation_contract_digest: COMPILER_INVOCATION_DIGEST, compiler_environment_digest: COMPILER_ENVIRONMENT_DIGEST, project_registry_root_digest: PROJECT_ROOT_DIGEST, materializer_revision: MATERIALIZER_REVISION, materialization_policy_digest: MATERIALIZATION_POLICY_DIGEST, canonical_serialization_revision: SERIALIZATION_REVISION, store_schema_revision: STORE_SCHEMA_REVISION, custody_key_revision: CUSTODY_KEY_REVISION, compiler_receipt_normalization_revision: NORMALIZATION_REVISION });
const MATERIALIZATION_SEED_CACHE = new Map();

class Dss04Service {
  constructor({ root, store, now, ownerAuthority = {}, protectedCommitments = {}, verifiers = {}, anchorPath, compilerRuntime = null } = {}) {
    if (!root && !store) fail("DSS04_ROOT_REQUIRED");
    this.now = now; this.ownerAuthority = Object.freeze({ owner: ROOT_OWNER, root: ROOT_AUTHORITY }); this.protectedCommitments = Object.freeze({ compiler: protectedCommitments.compiler || null, registry: protectedCommitments.registry || null, exclusionTheorems: protectedCommitments.exclusionTheorems || Object.freeze({}) }); this.verifiers = Object.freeze({ registry: verifiers.registry || null, runtime: verifiers.runtime || null, authorization: verifiers.authorization || null, projection: verifiers.projection || null }); this.compilerRuntime = compilerRuntime ? Object.freeze(clone(compilerRuntime)) : null;
    this.authorityBroken = false; this.anchor = null; this._loadAuthorityAnchor(anchorPath);
    this.store = store || new Dss04SqliteStore({ root, now });
    const persistedState = this.store.read();
    this.state = persistedState || { schema: "direct_semantic_service_dss04_state@1", pins: {}, generations: {}, registryRevisions: {}, snapshotReceipts: {}, snapshotArtifacts: {}, evidenceRuntimes: {}, sealedResults: {}, compilationRequests: {}, idempotencyBindings: {}, allocations: {}, leases: {}, observations: {}, rawCompilerOutputs: {}, outputBundles: {}, routeSets: {}, materializationPlans: {}, closedEvidencePages: {}, pageCompletenessReceipts: {}, pageSufficiencyReceipts: {}, knownInsufficiencyRemands: {}, pageFaultCandidates: {}, novelEdgeCandidates: {}, candidateValidationRecords: {}, materializationBatchSeals: {}, derivedHeads: {}, accounting: {}, recoveryDispositions: {}, validatorRevisions: {}, events: [], operationInputs: {} };
    // Only a new database receives default empty populations.  A loaded
    // state with an omitted carrier is an incomplete durable cut and must be
    // surfaced to recovery rather than normalized into existence.
    if (!persistedState) for (const kind of RECOVERY_REQUIRED_COLLECTIONS) this.state[kind] = kind === "events" ? [] : {};
    if (!persistedState) this.state.operationInputs = {};
    this.stateMissingCollections = persistedState ? RECOVERY_REQUIRED_COLLECTIONS.filter((name) => !Object.prototype.hasOwnProperty.call(this.state, name)) : [];
    // Authenticated SQLite state may still contain a semantically damaged
    // event chain.  Keep it available to the recovery reducer so it can
    // return the declared BROKEN standing instead of silently treating the
    // damaged history as a fresh generation.
    this.stateVerificationError = null;
    try { this._verifyState(); } catch (error) { this.stateVerificationError = error; }
  }
  _loadAuthorityAnchor(requestedPath) {
    try {
      const repoRoot = path.resolve(__dirname, "../../../.."); const relative = requestedPath || ANCHOR_PATH; if (relative !== ANCHOR_PATH) fail("DSS04_ANCHOR_INVALID");
      const fullPath = path.resolve(repoRoot, relative); if (!fullPath.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(fullPath)) fail("DSS04_ANCHOR_INVALID");
      const bytes = fs.readFileSync(fullPath); const sha = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (sha !== ANCHOR_SHA256 || bytes.length !== 209013) fail("DSS04_ANCHOR_INVALID", "bytes");
      const custodyPointerPath = path.join(repoRoot, ANCHOR_CUSTODY_POINTER_PATH); const custodyPointerBytes = fs.readFileSync(custodyPointerPath); const custodyPointerSha = `sha256:${crypto.createHash("sha256").update(custodyPointerBytes).digest("hex")}`; if (custodyPointerSha !== ANCHOR_CUSTODY_POINTER_SHA256) fail("DSS04_ANCHOR_INVALID", "custody-pointer");
      const custodyPointer = JSON.parse(custodyPointerBytes); const anchorBinding = custodyPointer.archaeologicalBindings?.dss04OwnerContractAuthorityAnchor;
      if (custodyPointer.schema !== "direct.ck-evidence-vault-pointer.v1" || custodyPointer.rawCustody?.status !== "RAW_CUSTODY_ACCEPTED" || custodyPointer.rawCustody?.receiptDigest !== ANCHOR_CUSTODY_RECEIPT_DIGEST || custodyPointer.rawCustody?.bundleSha256 !== ANCHOR_CUSTODY_BUNDLE_SHA256 || anchorBinding?.commit !== ANCHOR_COMMIT || anchorBinding?.path !== ANCHOR_ARCHAEOLOGY_PATH || anchorBinding?.gitBlobId !== ANCHOR_GIT_BLOB_ID || anchorBinding?.byteLength !== bytes.length || `sha256:${anchorBinding?.sha256}` !== ANCHOR_SHA256 || anchorBinding?.ancestryRelation !== "ANCESTOR_OF_SOURCE_SUBJECT" || anchorBinding?.reconstruction !== "VERIFY_IN_ACCEPTED_ARCHAEOLOGY_BUNDLE") fail("DSS04_ANCHOR_INVALID", "archaeological-custody");
      const anchor = JSON.parse(bytes); if (anchor.authority?.owner !== ANCHOR_OWNER || anchor.authority?.root !== ANCHOR_ROOT || anchor.authority?.standing !== "PINNED" || anchor.payloadDigest !== ANCHOR_PAYLOAD_DIGEST || anchor.payloadDigest !== `sha256:${crypto.createHash("sha256").update(Buffer.from(`Dss04.OwnerContractAuthorityAnchor.v3\n${stable(anchor.payload)}`, "utf8")).digest("hex")}`) fail("DSS04_ANCHOR_INVALID", "authority");
      const contractBytes = fs.readFileSync(path.join(repoRoot, CONTRACT_ASSET_PATH)); const contractSha = `sha256:${crypto.createHash("sha256").update(contractBytes).digest("hex")}`; if (anchor.payload.contract.path !== "docs/DIRECT_SEMANTIC_SERVICE_DSS04_IMPLEMENTATION_CONTRACT.md" || contractSha !== anchor.payload.contract.sha256 || anchor.source?.purpose !== "generation-8 external authority for the bounded recovery-disposition equality repair") fail("DSS04_ANCHOR_INVALID", "contract/source");
      const generationDigest = `sha256:${crypto.createHash("sha256").update(Buffer.from(`Dss04.ServiceGeneration.v8\n${stable(anchor.payload.serviceGeneration.identityValues)}`, "utf8")).digest("hex")}`; if (generationDigest !== anchor.payload.serviceGeneration.digest || anchor.payload.serviceGeneration.identity.service_generation !== generationDigest) fail("DSS04_ANCHOR_INVALID", "generation derivation");
      const modulePath = path.join(repoRoot, PINNED_COMPILER_MODULE_ASSET_PATH); const module = JSON.parse(fs.readFileSync(modulePath)); const payload = anchor.payload;
      const operationInputs = Object.fromEntries(module.operations.map((operation) => [operation.id, operation.inputs])); const operationOutcomes = Object.fromEntries(module.operations.map((operation) => [operation.id, { outputCases: [...new Set(operation.output_cases || [])].sort(), effectDeclaration: module.effect_declarations[operation.id], outcomeBindings: operation.outcome_bindings }]));
      const relations = [...module.qualified_transitions].sort((a, b) => a.transitionId.localeCompare(b.transitionId)).map((row) => ({ transitionId: row.transitionId, carrierId: row.carrierId, event: row.event, operationId: row.operationId, owner: row.owner, priorStateSource: row.priorStateSource, fromStates: row.fromStates, toState: row.toState, outcomeCases: [...row.outcomeCases].sort() }));
      const lifecycleEvents = [...new Set(module.carriers.flatMap((carrier) => carrier.lifecycle.events.map((event) => `${carrier.id}:${event}`)))].sort(); const transitionEvents = [...new Set(relations.map((row) => `${row.carrierId}:${row.event}`))].sort(); const transitionIds = relations.map((row) => row.transitionId).sort();
      if (stable(payload.operationInputs) !== stable(operationInputs) || stable(payload.operationOutcomes) !== stable(operationOutcomes) || stable(payload.transitionRelations) !== stable(relations) || stable(payload.lifecycleEvents) !== stable(lifecycleEvents) || stable(payload.transitionEvents) !== stable(transitionEvents) || stable(payload.transitionIds) !== stable(transitionIds)) fail("DSS04_ANCHOR_POPULATION_MISMATCH");
      this.anchor = Object.freeze({ anchor, repoRoot, relative, bytesLength: bytes.length });
    } catch (_) { this.authorityBroken = true; }
  }
  clock() { const value = typeof this.now === "function" ? this.now() : this.now; return (value ? new Date(value) : new Date()).toISOString(); }
  _verifyState() {
    if (this.state.schema !== "direct_semantic_service_dss04_state@1") fail("DSS04_STATE_SCHEMA_INVALID");
    for (const event of this.state.events) { const unsigned = Object.fromEntries(Object.entries(event).filter(([key]) => key !== "eventDigest")); if (!event.eventDigest || event.eventDigest !== digestObject("DirectSemanticService.Dss04.Event.v1", unsigned)) fail("DSS04_EVENT_CHAIN_INVALID"); }
    for (let i = 0; i < this.state.events.length; i++) if ((this.state.events[i].priorDigest || null) !== (i ? this.state.events[i - 1].eventDigest : null)) fail("DSS04_EVENT_CHAIN_INVALID");
  }
  _persist() { this.store.write(this.state); }
  _event(type, payload, transition = {}) { const supplied = clone(transition); let qualified = supplied; if (supplied.operationId && supplied.carrierId && supplied.event) { const row = this._transitionRecord(supplied.operationId, supplied.carrierId, supplied.event); qualified = { transitionId: row.transitionId, carrierId: row.carrierId, event: row.event, operationId: row.operationId, owner: row.owner, priorStateSource: row.priorStateSource, fromStates: clone(row.fromStates), fromState: supplied.fromState || row.fromStates[0], toState: supplied.toState || row.toState, outcomeCases: clone(row.outcomeCases), outcome: supplied.outcome || row.outcomeCases[0] }; } const priorDigest = this.state.events.length ? this.state.events[this.state.events.length - 1].eventDigest : null; const event = { sequence: this.state.events.length + 1, priorDigest, type, payload: clone(payload), ...qualified }; event.eventDigest = digestObject("DirectSemanticService.Dss04.Event.v1", event); this.state.events.push(event); return event; }
  _transitionRecord(operationId, carrierId, event) { const row = this.anchor?.anchor?.payload?.transitionRelations?.find((candidate) => candidate.operationId === operationId && candidate.carrierId === carrierId && candidate.event === event); if (!row) fail("DSS04_ANCHOR_POPULATION_MISMATCH"); return row; }
  _transitionEvent(operationId, carrierId, event, payload, outcome) { const row = this._transitionRecord(operationId, carrierId, event); return this._event(operationId, payload, { transitionId: row.transitionId, carrierId: row.carrierId, event: row.event, operationId: row.operationId, owner: row.owner, priorStateSource: row.priorStateSource, fromStates: clone(row.fromStates), fromState: row.fromStates[0], toState: row.toState, outcomeCases: clone(row.outcomeCases), outcome: outcome || row.outcomeCases[0] }); }
  _authority(input) { if (this.authorityBroken) fail("DSS04_ANCHOR_INVALID"); if (this.stateVerificationError || this.stateMissingCollections.length) fail("DSS04_STATE_CORRUPT"); const auth = input?.authorization || input?.ownerAuthorization || input?.protectedDescriptor; if (!auth || auth.owner !== this.ownerAuthority.owner || auth.root !== this.ownerAuthority.root || auth.authorized !== true) fail("DSS04_UNAUTHORIZED"); return auth; }
  _protected(kind) { const value = this.protectedCommitments[kind]; if (!value || typeof value !== "object" || typeof value.digest !== "string" || !value.value) fail("DSS04_PIN_MISMATCH"); return value; }
  _verifier(kind, owner, root) { const verifier = this.verifiers[kind]; if (!verifier || verifier.owner !== owner || verifier.root !== root || typeof verifier.verify !== "function" || typeof verifier.revision !== "string") fail("DSS04_VERIFIER_UNAVAILABLE"); return verifier; }
  _rejectTransition(carrierId, event, operationId, owner, fromState, toState, outcome, details = {}) {
    if (outcome === "STALE_PREDECESSOR") return result(outcome, details);
    const row = this._transitionRecord(operationId, carrierId, event);
    this._event(operationId, details, { transitionId: row.transitionId, carrierId: row.carrierId, event: row.event, operationId: row.operationId, owner: row.owner, priorStateSource: row.priorStateSource, fromStates: clone(row.fromStates), fromState, toState: row.toState, outcomeCases: clone(row.outcomeCases), outcome });
    this._persist();
    return result(outcome, details);
  }
  _existing(kind, ref) { return this.state[kind]?.[ref]; }
  _save(kind, ref, value) { this.state[kind][ref] = clone(value); }
  _operationKey(operation, input) { return digestObject(`DirectSemanticService.Dss04.Operation.${operation}.v1`, input); }
  _ready(input = {}) {
    if (this.stateVerificationError || this.stateMissingCollections?.length) return null;
    const generation = this._generation();
    if (!generation || generation.state !== "READY") return null;
    const supplied = input.generation || input.serviceGeneration;
    if (supplied && (typeof supplied === "string" ? supplied : supplied.generationRef || supplied.service_generation) !== generation.generationRef) return null;
    return generation;
  }
  _digestFields(value, fields, name) {
    exactFields(value, fields, name);
    for (const field of fields) if (field.endsWith("_digest")) safeDigest(value[field], `${name}.${field}`);
    return Object.fromEntries(fields.map((field) => [field, value[field]]));
  }
  _assertCarrierFields(carrierId, value) {
    const spec = DSS04_CARRIER_FIELD_MAP[carrierId]; if (!spec || !value || typeof value !== "object") fail("DSS04_CARRIER_IDENTITY_INVALID", carrierId);
    if (["d.compiler-output-bundle", "d.compiled-route-set"].includes(carrierId) && this._admissionMaterializationInputs) {
      Object.assign(value, this._admissionMaterializationInputs);
    }
    for (const field of [...spec.stable, spec.generation]) if (value[field] === undefined) fail("DSS04_CARRIER_IDENTITY_INVALID", `${carrierId}.${field}`);
    for (const field of spec.stable) if (value[field] !== null && (field.endsWith("_digest") || field.endsWith("_seal") || field === "content_seal" || field === "custody_tag" || field === "page_identity")) safeDigest(value[field], `${carrierId}.${field}`);
    if (carrierId === "d.compiler-output-bundle" && this.state.pins.compilerBuild && value.compiler_identity_digest !== this._expectedCompilerIdentity(this.state.pins.compilerBuild)) fail("DSS04_PIN_MISMATCH", "compiler-output-bundle.compiler_identity_digest");
    return value;
  }
  _refFor(kind, value) { return digestObject(`DirectSemanticService.Dss04.${kind}.v1`, value); }
  _recordTransition(operationId, carrierId, event, payload, outcome, metadata = {}) {
    const row = this._transitionRecord(operationId, carrierId, event);
    return this._event(operationId, payload, { transitionId: row.transitionId, carrierId, event, operationId, owner: row.owner, priorStateSource: row.priorStateSource, fromStates: clone(row.fromStates), fromState: row.fromStates[0], toState: row.toState, outcomeCases: clone(row.outcomeCases), outcome, ...metadata });
  }
  _replay(operation, key, kind, ref) { const prior = this.state.operationInputs[operation]; if (!prior) return null; if (prior.inputDigest !== key) return result("IDEMPOTENCY_CONFLICT"); return result("REPLAYED", { [kind]: clone(this.state[kind][ref]) }); }

  _recoverySourceState() {
    const source = {};
    for (const name of RECOVERY_OPERATION_INPUTS) {
      if (["events", "derivedHeads", "recoveryDispositions"].includes(name)) continue;
      source[name] = name === "compilerBuildPin" ? clone(this.state.pins?.compilerBuild) : name === "projectRegistryRootPin" ? clone(this.state.pins?.projectRegistryRoot) : clone(this.state[name]);
      // Readiness/recovery mutates only the lifecycle head.  The replay key
      // is the durable identity population, not the derived OPENING/READY
      // projection state or its wall-clock observation.
      if (name === "generations" && source[name]?.current) {
        delete source[name].current.state;
        delete source[name].current.openedAt;
      }
    }
    return source;
  }

  _recoveryPopulationDigest() {
    return digestObject("DirectSemanticService.Dss04.RecoveryDurablePopulation.v1", this._recoverySourceState());
  }

  _recoveryProjectionDigest() {
    const projection = {};
    for (const name of ["sealedResults", "generations", "pins", "registryRevisions", "snapshotReceipts", "snapshotArtifacts", "evidenceRuntimes", "compilationRequests", "idempotencyBindings", "allocations", "leases", "observations", "rawCompilerOutputs", "outputBundles", "routeSets", "materializationPlans", "closedEvidencePages", "pageCompletenessReceipts", "pageSufficiencyReceipts", "knownInsufficiencyRemands", "pageFaultCandidates", "novelEdgeCandidates", "candidateValidationRecords", "materializationBatchSeals", "accounting", "validatorRevisions"]) projection[name] = clone(this.state[name]);
    return digestObject("DirectSemanticService.Dss04.RecoveryProjection.v1", projection);
  }

  _recoveryDigest(name, value) { return digestObject(`DirectSemanticService.Dss04.Recovery.${name}.v1`, value); }

  _materializationReferences(routeSet) {
    const request = this.state.compilationRequests[routeSet.request_id];
    if (!request || request.service_generation !== SERVICE_GENERATION || routeSet.service_generation !== SERVICE_GENERATION) return null;
    const bundle = Object.values(this.state.outputBundles).find((candidate) => candidate.bundleRef === routeSet.compiler_output_bundle_digest);
    if (!bundle || !["ADMITTED", "REMANDED"].includes(bundle.state) || !Array.isArray(routeSet.input_facts) || !Array.isArray(routeSet.evidence_demands) || routeSet.input_facts_digest !== normalizationDomain("Dss04.InputFactPopulation.v1", routeSet.input_facts) || routeSet.evidence_demand_population_digest !== normalizationDomain("Dss04.EvidenceDemandPopulation.v1", routeSet.evidence_demands) || !Array.isArray(bundle.input_facts) || !Array.isArray(bundle.evidence_demands) || canonicalJson(bundle.input_facts) !== canonicalJson(routeSet.input_facts) || canonicalJson(bundle.evidence_demands) !== canonicalJson(routeSet.evidence_demands)) return null;
    const registry = this.state.registryRevisions[request.project_registry_revision_digest];
    const snapshot = this.state.snapshotReceipts[request.target_snapshot_receipt_digest];
    const runtime = this.state.evidenceRuntimes[request.project_evidence_runtime_revision_digest];
    if (!registry || registry.state !== "ADMITTED" || !snapshot || snapshot.state !== "ADMITTED" || !runtime || runtime.state !== "ADMITTED" || runtime.target_snapshot_receipt_digest !== snapshot.receiptRef || runtime.project_registry_revision_digest !== request.project_registry_revision_digest) return null;
    const inputFacts = clone(routeSet.input_facts);
    const evidenceDemands = clone(routeSet.evidence_demands);
    return { request, registry, snapshot, runtime: { ...runtime, service_generation: request.service_generation }, compilerOutputBundleDigest: routeSet.compiler_output_bundle_digest, inputFacts, evidenceDemands, inputFactById: new Map(inputFacts.map((fact) => [fact.fact_id, fact])), evidenceDemandById: new Map(evidenceDemands.map((demand) => [demand.evidence_demand_id, demand])) };
  }

  _materializationSeedCacheKey(routeSet, refs, policy) {
    const artifactDigests = (refs.snapshot.artifactRefs || []).map((ref) => this.state.snapshotArtifacts[ref]?.content_digest || null);
    return canonicalJson({ routeSet: routeSet.routeSetRef, policy, routes: routeSet.ordered_route_population_digest, facts: routeSet.input_facts_digest, demands: routeSet.evidence_demand_population_digest, artifacts: artifactDigests });
  }

  _materializationDescriptorContent(plan, descriptor, refs) {
    const routeSet = this.state.routeSets[plan.request_id];
    const occurrenceId = descriptor?.routePopulation?.[0]?.occurrence_id;
    const route = routeSet?.routes?.find((candidate) => (candidate.occurrence_id || candidate.route_id) === occurrenceId);
    return route && refs ? this._materializationPageSeed(route, refs, plan.materialization_policy_digest).canonicalContent : null;
  }

  _materializationRouteIsCurrent(route, refs) {
    return Boolean(route && route.owner === ROUTE_AUTHORITY_OWNER && route.authority_owner === ROUTE_AUTHORITY_OWNER && route.authority_root === ROUTE_AUTHORITY_ROOT && route.authority_standing === "PINNED" && route.project_id === refs.registry.project_id && route.request_scope_digest === refs.request.requested_route_scope_digest && route.snapshot_receipt_digest === refs.snapshot.receiptRef);
  }

  _workerTaskContract(refs, policy) {
    return {
      schema: "direct_semantic_service_dss04_worker_task_contract@1",
      service_generation: refs.request.service_generation,
      project_id: refs.registry.project_id,
      requested_route_scope_digest: refs.request.requested_route_scope_digest,
      compilation_profile_digest: refs.request.compilation_profile_digest,
      materialization_policy_digest: policy,
      target_snapshot_receipt_digest: refs.snapshot.receiptRef,
      evidence_runtime_ref: refs.runtime.runtimeRef,
      evidence_policy_digest: refs.runtime.evidence_policy_digest,
      availability_snapshot_digest: refs.runtime.availability_snapshot_digest,
      isolation_profile_digest: refs.runtime.isolation_profile_digest,
      page_byte_budget: PAGE_BYTE_BUDGET,
      page_token_budget: PAGE_TOKEN_BUDGET,
      evidence_byte_budget: EVIDENCE_BYTE_BUDGET
    };
  }

  _materializationPageSeed(route, refs, policy) {
    if (!this._materializationRouteIsCurrent(route, refs)) fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "route-currentness");
    const occurrenceId = route.occurrence_id || route.route_id;
    const routePopulation = [{ route_id: route.route_id, occurrence_id: occurrenceId }];
    const routePopulationDigest = this._refFor("PageRoutePopulation", routePopulation);
    const factIds = Array.isArray(route.input_fact_refs) ? route.input_fact_refs : [];
    const projectFacts = factIds.map((factId) => refs.inputFactById?.get(factId) || refs.inputFacts.find((fact) => fact.fact_id === factId));
    if (projectFacts.length !== factIds.length || new Set(factIds).size !== factIds.length || projectFacts.some((fact) => !fact)) fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "facts");
    const projectFactPopulationDigest = this._refFor("PageProjectFactPopulation", projectFacts);
    const sourceFragments = [];
    for (const fact of projectFacts) {
      const artifactRefs = fact.artifact_ref || fact.snapshot_artifact_ref ? [fact.artifact_ref || fact.snapshot_artifact_ref] : fact.source_ref === refs.snapshot.receiptRef ? refs.snapshot.artifactRefs : [];
      if (fact.source_ref === refs.snapshot.receiptRef && artifactRefs.length === 0) fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "source-fragment");
      for (const artifactRef of artifactRefs) {
        const artifact = this.state.snapshotArtifacts[artifactRef]; if (!artifact || fact.source_ref !== refs.snapshot.receiptRef || typeof artifact.canonical_relative_path !== "string" || !/^sha256:[0-9a-f]{64}$/.test(artifact.content_digest) || !Number.isSafeInteger(artifact.byte_length) || typeof artifact.bytesBase64 !== "string") fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "source-fragment");
        const bytes = Buffer.from(artifact.bytesBase64, "base64"); if (bytes.length !== artifact.byte_length || `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` !== artifact.content_digest) fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "source-fragment-seal");
        sourceFragments.push({ artifact_ref: artifactRef, bounded_locator: artifact.canonical_relative_path, content_seal: artifact.content_digest, byte_length: artifact.byte_length, bytesBase64: artifact.bytesBase64 });
      }
    }
    const sourceFragmentPopulationDigest = this._refFor("PageSourceFragmentPopulation", sourceFragments);
    const demandIds = Array.isArray(route.evidence_demand_ids) ? route.evidence_demand_ids : Array.isArray(route.evidenceDemandIds) ? route.evidenceDemandIds : refs.evidenceDemands.filter((demand) => demand.route_id === route.route_id || demand.occurrence_id === occurrenceId || demand.route_occurrence_id === occurrenceId).map((demand) => demand.evidence_demand_id);
    const evidenceDemands = demandIds.map((demandId) => refs.evidenceDemandById?.get(demandId) || refs.evidenceDemands.find((demand) => demand.evidence_demand_id === demandId));
    if (evidenceDemands.length !== demandIds.length || new Set(demandIds).size !== demandIds.length || evidenceDemands.some((demand) => !demand || ![undefined, route.route_id].includes(demand.route_id) || ![undefined, occurrenceId].includes(demand.occurrence_id) || ![undefined, occurrenceId].includes(demand.route_occurrence_id))) fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "evidence-demands");
    const evidenceObjects = evidenceDemands.filter((demand) => demand.evidence_object || demand.evidenceObject).map((demand) => ({ evidence_demand_id: demand.evidence_demand_id, object: clone(demand.evidence_object || demand.evidenceObject) }));
    const unavailableMarkers = evidenceDemands.filter((demand) => !(demand.evidence_object || demand.evidenceObject)).map((demand) => ({ evidence_demand_id: demand.evidence_demand_id, marker: "UNAVAILABLE", reason: demand.unavailable_reason || "NO_ADMITTED_EVIDENCE_OBJECT" }));
    const reverseMap = evidenceDemands.map((demand) => ({ evidence_demand_id: demand.evidence_demand_id, member_kind: evidenceObjects.some((member) => member.evidence_demand_id === demand.evidence_demand_id) ? "EVIDENCE_OBJECT" : "UNAVAILABLE_MARKER" }));
    if (new Set(reverseMap.map((entry) => entry.evidence_demand_id)).size !== evidenceDemands.length || reverseMap.some((entry) => !evidenceObjects.some((member) => member.evidence_demand_id === entry.evidence_demand_id) && !unavailableMarkers.some((marker) => marker.evidence_demand_id === entry.evidence_demand_id))) fail("DSS04_MATERIALIZATION_POPULATION_MISMATCH", "evidence-reverse-map");
    const evidenceObjectPopulationDigest = this._refFor("PageEvidenceObjectPopulation", evidenceObjects);
    const unavailableMarkerPopulationDigest = this._refFor("PageUnavailableMarkerPopulation", unavailableMarkers);
    const policyExcerpt = { materialization_policy_digest: policy, revision: MATERIALIZER_REVISION };
    const policyExcerptPopulationDigest = this._refFor("PagePolicyExcerptPopulation", policyExcerpt);
    const authorityContext = { authority_owner: route.authority_owner, authority_root: route.authority_root, route_scope: refs.request.requested_route_scope_digest };
    const authorityContextDigest = this._refFor("PageAuthorityContext", authorityContext);
    const workerTaskContract = this._workerTaskContract(refs, policy);
    const workerTaskContractDigest = this._refFor("WorkerTaskContract", workerTaskContract);
    const semanticInput = { service_generation: refs.request.service_generation, route_population_digest: routePopulationDigest, project_fact_population_digest: projectFactPopulationDigest, source_fragment_population_digest: sourceFragmentPopulationDigest, evidence_object_population_digest: evidenceObjectPopulationDigest, unavailable_marker_population_digest: unavailableMarkerPopulationDigest, policy_excerpt_population_digest: policyExcerptPopulationDigest, authority_context_digest: authorityContextDigest, page_byte_budget: PAGE_BYTE_BUDGET, page_token_budget: PAGE_TOKEN_BUDGET, evidence_byte_budget: EVIDENCE_BYTE_BUDGET };
    const canonicalContent = { schema: "direct_semantic_service_dss04_closed_evidence_page@1", service_generation: refs.request.service_generation, route_population: routePopulation, route_facts: [clone(route)], project_facts: projectFacts, source_fragments: sourceFragments, evidence_demands: evidenceDemands, evidence_objects: evidenceObjects, unavailable_markers: unavailableMarkers, evidence_reverse_map: reverseMap, policy_excerpt: policyExcerpt, worker_task_contract: workerTaskContract, worker_task_contract_digest: workerTaskContractDigest, predecessor_receipts: { compiler_output_bundle: refs.compilerOutputBundleDigest, snapshot_receipt: refs.snapshot.receiptRef, evidence_runtime: refs.runtime.runtimeRef }, authority_context: authorityContext };
    const canonicalContentBytes = Buffer.from(canonicalJson(canonicalContent), "utf8"); const canonicalContentSeal = `sha256:${crypto.createHash("sha256").update(canonicalContentBytes).digest("hex")}`;
    const identityInput = { ...semanticInput, canonical_content_seal: canonicalContentSeal };
    return { ...identityInput, page_identity: this._refFor("ClosedEvidencePageIdentity", identityInput), routePopulation, canonicalContent, canonicalContentLength: canonicalContentBytes.length, evidenceByteLength: Buffer.byteLength(canonicalJson({ evidence_demands: evidenceDemands, evidence_objects: evidenceObjects, unavailable_markers: unavailableMarkers }), "utf8") };
  }

  instantiateMaterializationPlan(input = {}) {
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR");
      const raw = clone(input.plan || input);
      const routeSetRef = raw.compiled_route_set_digest || raw.route_set_ref || raw.routeSetRef || raw.routeSet?.routeSetRef;
      if (Object.keys(raw).some((key) => ["plan_ref", "planRef", "route_to_page_partition_digest", "ordered_page_identity_population_digest", "page_identities", "partition", "pages"].includes(key))) return result("IDEMPOTENCY_CONFLICT");
      if (typeof routeSetRef !== "string") return result("STALE_PREDECESSOR");
      const routeSet = Object.values(this.state.routeSets).find((candidate) => candidate.routeSetRef === routeSetRef);
      const refs = routeSet && this._materializationReferences(routeSet);
      if (!routeSet || !refs || routeSet.service_generation !== generation.generationRef) return result("STALE_PREDECESSOR");
      const policy = refs.request.materialization_policy_digest;
      if (policy !== MATERIALIZATION_POLICY_DIGEST || (raw.materialization_policy_digest !== undefined && raw.materialization_policy_digest !== policy)) return result("IDEMPOTENCY_CONFLICT");
      const operation = `instantiate-materialization-plan:${routeSetRef}`;
      const operationInput = { compiled_route_set: routeSet.routeSetRef, runtime: refs.runtime.runtimeRef, generation: generation.generationRef, policy };
      const key = this._operationKey("instantiate-materialization-plan", operationInput);
      const previousInput = this.state.operationInputs[operation];
      if (previousInput) return previousInput.inputDigest === key ? result("REPLAYED", { plan: clone(this.state.materializationPlans[previousInput.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const routes = Array.isArray(routeSet.routes) ? routeSet.routes : null;
      const unique = routes && routes.every((route) => route && typeof route.route_id === "string" && route.route_id && typeof (route.occurrence_id || route.route_id) === "string") && new Set(routes.map((route) => route.route_id)).size === routes.length && new Set(routes.map((route) => route.occurrence_id || route.route_id)).size === routes.length;
      let populationMismatch = !unique; let pageSeeds = [];
      try {
        if (unique && routeSet.state === "ADMITTED") {
          if (routes.some((route) => !this._materializationRouteIsCurrent(route, refs))) populationMismatch = true;
          const routeById = new Map(routes.map((route) => [route.route_id, route]));
          const routeByOccurrence = new Map(routes.map((route) => [route.occurrence_id || route.route_id, route]));
          const routesByDemand = new Map();
          for (const route of routes) for (const demandId of Array.isArray(route.evidence_demand_ids) ? new Set(route.evidence_demand_ids) : []) routesByDemand.set(demandId, route);
          const assignments = refs.evidenceDemands.map((demand) => {
            const matches = new Set();
            const direct = routesByDemand.get(demand.evidence_demand_id); if (direct) matches.add(direct.route_id);
            const byRoute = routeById.get(demand.route_id); if (byRoute) matches.add(byRoute.route_id);
            const byOccurrence = routeByOccurrence.get(demand.occurrence_id || demand.route_occurrence_id); if (byOccurrence) matches.add(byOccurrence.route_id);
            return matches.size;
          });
          if (assignments.some((count) => count !== 1)) populationMismatch = true;
          else {
            const cacheKey = this._materializationSeedCacheKey(routeSet, refs, policy);
            const cached = MATERIALIZATION_SEED_CACHE.get(cacheKey);
            if (cached) pageSeeds = cached;
            else {
              for (const route of routes) {
                const page = this._materializationPageSeed(route, refs, policy);
                pageSeeds.push(page);
                if (page.canonicalContentLength > PAGE_BYTE_BUDGET || page.evidenceByteLength > EVIDENCE_BYTE_BUDGET) break;
              }
              MATERIALIZATION_SEED_CACHE.set(cacheKey, pageSeeds);
            }
          }
        }
      } catch (error) { if (error.code === "DSS04_MATERIALIZATION_POPULATION_MISMATCH") populationMismatch = true; else throw error; }
          const overBudget = pageSeeds.some((page) => page.canonicalContentLength > PAGE_BYTE_BUDGET || page.evidenceByteLength > EVIDENCE_BYTE_BUDGET);
      const remandReason = populationMismatch ? "POPULATION_MISMATCH" : overBudget ? "OVER_BUDGET" : routeSet.state === "REMANDED" ? "UPSTREAM_REMANDED" : null;
      const pageEntries = remandReason ? [] : pageSeeds.map((page) => ({ occurrence_id: page.routePopulation[0].occurrence_id, disposition: "PAGE", page_identity: page.page_identity }));
      const remandEntries = remandReason ? (routes || []).map((route) => ({ occurrence_id: route.occurrence_id || route.route_id, disposition: "REMAND", reason: remandReason })) : [];
      const partition = [...pageEntries, ...remandEntries];
      const planState = populationMismatch ? "REJECTED" : overBudget || routeSet.state === "REMANDED" ? "REMANDED" : unique && routeSet.state === "ADMITTED" ? "INSTANTIATED" : "REJECTED";
      const planIdentity = { compiler_output_bundle_digest: routeSet.compiler_output_bundle_digest, compiled_route_set_digest: routeSet.routeSetRef, ordered_route_population_digest: routeSet.ordered_route_population_digest, ordered_page_identity_population_digest: this._refFor("OrderedPageIdentityPopulation", pageEntries.map((entry) => entry.page_identity)), route_to_page_partition_digest: this._refFor("RouteToPagePartition", partition), materialization_policy_digest: policy, page_byte_budget: PAGE_BYTE_BUDGET, page_token_budget: PAGE_TOKEN_BUDGET, evidence_byte_budget: EVIDENCE_BYTE_BUDGET, service_generation: generation.generationRef };
      const planPages = remandReason ? [] : pageSeeds.map((page) => { const { canonicalContent, ...descriptor } = page; return clone(descriptor); });
      const plan = { ...planIdentity, planRef: this._refFor("MaterializationPlan", planIdentity), state: planState, request_id: routeSet.request_id, routeSetRef: routeSet.routeSetRef, runtimeRef: refs.runtime.runtimeRef, snapshotRef: refs.snapshot.receiptRef, pages: planPages, partition, instantiatedAt: this.clock() };
      this._assertCarrierFields("d.materialization-plan", plan);
      const outcome = plan.state === "INSTANTIATED" ? "ACCEPTED" : plan.state === "REMANDED" ? (overBudget ? "OVER_BUDGET" : "REMANDED") : "POPULATION_MISMATCH";
      const event = outcome === "ACCEPTED" ? "INSTANTIATE" : ["REMANDED", "OVER_BUDGET"].includes(outcome) ? "REMAND" : "REJECT";
      this._save("materializationPlans", plan.planRef, plan); this.state.operationInputs[operation] = { inputDigest: key, ref: plan.planRef, operationInput: operationInput };
      this._recordTransition("instantiate-materialization-plan", "d.materialization-plan", event, plan, outcome); this._persist(); return result(outcome, { plan });
    } catch (error) { if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); if (error.code === "DSS04_DIGEST_INVALID") return result("POPULATION_MISMATCH"); throw error; }
  }

  _materializationLease(input, request, generation) {
    const leaseId = input.lease_id || input.leaseId || input.lease?.leaseRef || input.lease?.leaseId;
    const lease = Object.values(this.state.leases).find((candidate) => candidate.leaseRef === leaseId || candidate.leaseId === leaseId);
    if (!lease || lease.state !== "HELD" || lease.service_generation !== generation.generationRef || new Date(lease.expires_at).getTime() <= new Date(this.clock()).getTime()) return null;
    const allocation = Object.values(this.state.allocations).find((candidate) => candidate.allocationRef === lease.allocationRef);
    if (!allocation || allocation.work_kind !== "PAGE" || lease.lease_owner !== "dss04-materializer-owner" || allocation.request_id !== request.request_id || allocation.service_generation !== generation.generationRef) return null;
    return lease;
  }

  _publishPageCas(contentSeal, bytes) {
    const casRoot = path.join(this.store.root, "dss04-page-cas"); fs.mkdirSync(casRoot, { recursive: true, mode: 0o700 });
    const filename = `${contentSeal.slice(7)}.page`; const fullPath = path.join(casRoot, filename);
    let publish = true;
    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath); publish = !existing.equals(bytes);
      if (publish && Object.values(this.state.closedEvidencePages).some((page) => page.state === "MATERIALIZED" && page.casPath === path.relative(this.store.root, fullPath))) fail("DSS04_PAGE_CAS_INVALID", "referenced-mismatch");
    }
    if (publish) {
      atomicWrite(fullPath, bytes, 0o600);
    }
    const verified = fs.readFileSync(fullPath); const actual = `sha256:${crypto.createHash("sha256").update(verified).digest("hex")}`;
    if (actual !== contentSeal || verified.length !== bytes.length || !verified.equals(bytes)) fail("DSS04_PAGE_CAS_INVALID");
    return { casPath: path.relative(this.store.root, fullPath), byteLength: verified.length };
  }

  materializeClosedPage(input = {}) {
    let before;
    try {
      before = clone(this.state); const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR");
      const raw = clone(input.page || input); const planRef = raw.materialization_plan_digest || raw.plan_ref || raw.planRef || raw.materializationPlan?.planRef; const pageIdentity = raw.page_identity || raw.pageIdentity;
      if (typeof planRef !== "string" || typeof pageIdentity !== "string") return result("STALE_PREDECESSOR");
      const plan = Object.values(this.state.materializationPlans).find((candidate) => candidate.planRef === planRef); if (!plan || plan.service_generation !== generation.generationRef || plan.state !== "INSTANTIATED") return result("STALE_PREDECESSOR");
      const descriptor = plan.pages.find((page) => page.page_identity === pageIdentity); if (!descriptor) return result("IDEMPOTENCY_CONFLICT");
      const refs = this._materializationReferences(this.state.routeSets[plan.request_id]); if (!refs || refs.snapshot.receiptRef !== plan.snapshotRef || refs.runtime.runtimeRef !== plan.runtimeRef) return result("STALE_PREDECESSOR");
      const lease = this._materializationLease(input, refs.request, generation); if (!lease) return result("STALE_PREDECESSOR");
      const pageAllocation = Object.values(this.state.allocations).find((candidate) => candidate.allocationRef === lease.allocationRef); if (!pageAllocation || canonicalJson(pageAllocation.pageScope || null) !== canonicalJson({ plan_ref: plan.planRef, page_identity: pageIdentity })) return result("STALE_PREDECESSOR");
      const artifactRefs = Array.isArray(refs.snapshot.artifactRefs) ? refs.snapshot.artifactRefs : []; if (!artifactRefs.length || artifactRefs.some((ref) => !this.state.snapshotArtifacts[ref])) return result("STALE_PREDECESSOR");
      for (const [field, expected] of [["target_snapshot_receipt_digest", refs.snapshot.receiptRef], ["project_evidence_runtime_revision_digest", refs.runtime.runtimeRef], ["service_generation", generation.generationRef], ["materialization_plan_digest", plan.planRef]]) if (raw[field] !== undefined && raw[field] !== expected) return result("IDEMPOTENCY_CONFLICT");
      const operationInput = { plan: plan.planRef, page: pageIdentity, snapshot: refs.snapshot.receiptRef, artifacts: artifactRefs, runtime: refs.runtime.runtimeRef, lease: lease.leaseRef, generation: generation.generationRef }; const key = this._operationKey("materialize-closed-page", operationInput); const operation = `materialize-closed-page:${pageIdentity}`; const previousInput = this.state.operationInputs[operation];
      if (previousInput) return previousInput.inputDigest === key ? result("REPLAYED", { page: clone(this.state.closedEvidencePages[previousInput.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const routeSet = this.state.routeSets[plan.request_id]; const route = routeSet.routes.find((candidate) => (candidate.occurrence_id || candidate.route_id) === descriptor.routePopulation[0].occurrence_id); if (!route) return result("STALE_PREDECESSOR");
      const plannedPage = this._materializationPageSeed(route, refs, plan.materialization_policy_digest); if (plannedPage.page_identity !== pageIdentity) return result("IDEMPOTENCY_CONFLICT");
      const canonicalContent = plannedPage.canonicalContent; const canonicalContentSeal = `sha256:${crypto.createHash("sha256").update(Buffer.from(canonicalJson(canonicalContent), "utf8")).digest("hex")}`; if (descriptor.canonical_content_seal !== canonicalContentSeal) return result("IDEMPOTENCY_CONFLICT");
      // The planned canonical content is the exact CAS object.  Page and plan
      // references live in the authenticated SQLite reference, avoiding a
      // circular identity while still binding page identity to final bytes.
      const document = canonicalContent;
      const bytes = Buffer.from(canonicalJson(document), "utf8"); const tokenCount = Math.ceil(bytes.toString("utf8").length / 4); if (bytes.length > plan.page_byte_budget || tokenCount > plan.page_token_budget) {
        const rejectedIdentity = { ...descriptor, byte_length: 0, token_count: 0, content_seal: this._refFor("RejectedClosedEvidencePage", { page: pageIdentity, reason: "OVER_BUDGET" }) }; const rejected = { ...rejectedIdentity, pageRef: this._refFor("ClosedEvidencePage", rejectedIdentity), state: "REJECTED", rejectionReason: "OVER_BUDGET", request_id: refs.request.request_id, planRef: plan.planRef, snapshotRef: refs.snapshot.receiptRef, runtimeRef: refs.runtime.runtimeRef, leaseRef: lease.leaseRef, service_generation: generation.generationRef, rejectedAt: this.clock() }; this._assertCarrierFields("d.closed-evidence-page", rejected); this._save("closedEvidencePages", pageIdentity, rejected); this.state.operationInputs[operation] = { inputDigest: key, ref: pageIdentity, operationInput }; this._recordTransition("materialize-closed-page", "d.closed-evidence-page", "REJECT", rejected, "OVER_BUDGET"); this._persist(); return result("OVER_BUDGET", { page: rejected });
      }
      const contentSeal = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; const cas = this._publishPageCas(contentSeal, bytes); const pageIdentityFields = { page_identity: pageIdentity, route_population_digest: descriptor.route_population_digest, project_fact_population_digest: descriptor.project_fact_population_digest, source_fragment_population_digest: descriptor.source_fragment_population_digest, evidence_object_population_digest: descriptor.evidence_object_population_digest, unavailable_marker_population_digest: descriptor.unavailable_marker_population_digest, policy_excerpt_population_digest: descriptor.policy_excerpt_population_digest, authority_context_digest: descriptor.authority_context_digest, byte_length: bytes.length, token_count: tokenCount, content_seal: contentSeal, service_generation: generation.generationRef }; const page = { ...pageIdentityFields, pageRef: this._refFor("ClosedEvidencePage", pageIdentityFields), state: "MATERIALIZED", planRef: plan.planRef, request_id: refs.request.request_id, snapshotRef: refs.snapshot.receiptRef, runtimeRef: refs.runtime.runtimeRef, leaseRef: lease.leaseRef, casPath: cas.casPath, materializedAt: this.clock() }; this._assertCarrierFields("d.closed-evidence-page", page); this._save("closedEvidencePages", pageIdentity, page); this.state.operationInputs[operation] = { inputDigest: key, ref: pageIdentity, operationInput }; this._recordTransition("materialize-closed-page", "d.closed-evidence-page", "MATERIALIZE", page, "MATERIALIZED"); this._persist(); return result("MATERIALIZED", { page });
    } catch (error) { if (error.code === "DSS04_SQLITE_INJECTED_FAILURE") { if (before) this.state = before; return result("STALE_PREDECESSOR", { errorCode: error.code }); } if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT", "DSS04_PAGE_CAS_INVALID"].includes(error.code)) { if (before) this.state = before; return result("STALE_PREDECESSOR", { errorCode: error.code }); } throw error; }
  }

  _pageForEvaluation(input = {}, requirePlan = true) {
    const raw = clone(input.page || input); const pageIdentity = raw.page_identity || raw.pageIdentity; const planCarrier = input.plan || input.materializationPlan; const requestedPlanRef = requirePlan ? planCarrier?.planRef || planCarrier?.plan_ref || raw.materialization_plan_digest || raw.plan_ref || raw.planRef || raw.materializationPlan?.planRef : input.page ? undefined : raw.materialization_plan_digest || raw.plan_ref || raw.planRef || raw.materializationPlan?.planRef;
    if (typeof pageIdentity !== "string") return null;
    const page = this.state.closedEvidencePages[pageIdentity]; const planRef = requestedPlanRef || page?.planRef;
    if (requirePlan && typeof requestedPlanRef !== "string") return null;
    if (!requirePlan && requestedPlanRef !== undefined) return null;
    if (typeof planRef !== "string") return null;
    const plan = Object.values(this.state.materializationPlans).find((candidate) => candidate.planRef === planRef); const descriptor = plan?.pages?.find((candidate) => candidate.page_identity === pageIdentity);
    if (!plan || !page || !descriptor || plan.service_generation !== SERVICE_GENERATION || page.service_generation !== SERVICE_GENERATION || page.planRef !== plan.planRef || page.page_identity !== pageIdentity) return null;
    const refs = this._materializationReferences(this.state.routeSets[plan.request_id]);
    return refs ? { raw, pageIdentity, plan, page, descriptor, refs } : null;
  }

  _pageCasDocument(page, expectedDocument = null) {
    const casPath = typeof page.casPath === "string" ? path.resolve(this.store.root, page.casPath) : null;
    if (!casPath || !casPath.startsWith(`${this.store.root}${path.sep}`) || !fs.existsSync(casPath)) return { status: "STALE_PREDECESSOR" };
    const bytes = fs.readFileSync(casPath); const seal = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    if (seal !== page.content_seal || bytes.length !== page.byte_length) return { status: "OUTPUT_REJECTED" };
    let document; try { document = JSON.parse(bytes.toString("utf8")); } catch (_) { return { status: "OUTPUT_REJECTED" }; }
    if (expectedDocument && canonicalJson(document) !== canonicalJson(expectedDocument)) return { status: "OUTPUT_REJECTED" };
    return { status: "OK", bytes, document };
  }

  _pageEvidenceReconciliation(document) {
    const demands = Array.isArray(document.evidence_demands) ? document.evidence_demands : null; const objects = Array.isArray(document.evidence_objects) ? document.evidence_objects : null; const markers = Array.isArray(document.unavailable_markers) ? document.unavailable_markers : null; const reverse = Array.isArray(document.evidence_reverse_map) ? document.evidence_reverse_map : null;
    if (!demands || !objects || !markers || !reverse) return null;
    const ids = demands.map((demand) => demand?.evidence_demand_id); const demandIds = new Set(ids); if (ids.some((id) => typeof id !== "string" || !id) || demandIds.size !== ids.length) return null;
    const memberIds = [...objects.map((member) => member?.evidence_demand_id), ...markers.map((marker) => marker?.evidence_demand_id)]; if (memberIds.some((id) => !demandIds.has(id)) || new Set(memberIds).size !== memberIds.length || memberIds.length !== ids.length) return null;
    if (reverse.length !== ids.length || reverse.some((entry) => !demandIds.has(entry?.evidence_demand_id) || !["EVIDENCE_OBJECT", "UNAVAILABLE_MARKER"].includes(entry.member_kind)) || new Set(reverse.map((entry) => entry.evidence_demand_id)).size !== ids.length) return null;
    const expectedReverse = ids.map((id) => ({ evidence_demand_id: id, member_kind: objects.some((member) => member.evidence_demand_id === id) ? "EVIDENCE_OBJECT" : "UNAVAILABLE_MARKER" })); if (canonicalJson(reverse) !== canonicalJson(expectedReverse)) return null;
    return { demands, objects, markers, reverse };
  }

  _recoveryPageEvaluation(pageIdentity) {
    const page = this.state.closedEvidencePages[pageIdentity];
    if (!page) return { kind: "gap", reason: `page.${pageIdentity}` };
    const plan = this.state.materializationPlans[page.planRef];
    if (!plan) return { kind: "gap", reason: `page-plan.${pageIdentity}` };
    const descriptor = plan.pages?.find((candidate) => candidate.page_identity === pageIdentity);
    if (!descriptor) return { kind: "corrupt", reason: `page-plan-descriptor.${pageIdentity}` };
    const routeSet = this.state.routeSets[plan.request_id];
    const refs = routeSet && this._materializationReferences(routeSet);
    if (!refs) return { kind: "gap", reason: `page-predecessors.${pageIdentity}` };
    const expectedContent = this._materializationDescriptorContent(plan, descriptor, refs);
    const cas = this._pageCasDocument(page, expectedContent);
    if (cas.status !== "OK") return { kind: cas.status === "STALE_PREDECESSOR" ? "gap" : "corrupt", reason: `page-cas-${cas.status === "STALE_PREDECESSOR" ? "missing" : "mismatch"}.${pageIdentity}` };
    const document = cas.document;
    const partition = Array.isArray(plan.partition) ? plan.partition : [];
    const requiredRoutes = partition.map((entry) => ({ occurrence_id: entry.occurrence_id, disposition: entry.disposition, ...(entry.page_identity ? { page_identity: entry.page_identity } : {}), ...(entry.reason ? { reason: entry.reason } : {}) }));
    const materializedRoutes = partition.filter((entry) => entry.disposition === "PAGE" && entry.page_identity === pageIdentity);
    const remandedRoutes = partition.filter((entry) => entry.disposition === "REMAND");
    const pageRoutes = Array.isArray(document.route_population) ? document.route_population : [];
    const partitionDigestValid = plan.route_to_page_partition_digest === this._refFor("RouteToPagePartition", partition) && plan.ordered_page_identity_population_digest === this._refFor("OrderedPageIdentityPopulation", partition.filter((entry) => entry.disposition === "PAGE").map((entry) => entry.page_identity));
    const routeMismatch = !routeSet || !partitionDigestValid || materializedRoutes.length !== 1 || pageRoutes.length !== 1 || pageRoutes[0].occurrence_id !== materializedRoutes[0]?.occurrence_id || new Set(partition.map((entry) => entry.occurrence_id)).size !== partition.length || canonicalJson(partition.map((entry) => entry.occurrence_id)) !== canonicalJson((routeSet.routes || []).map((route) => route.occurrence_id || route.route_id));
    const evidence = this._pageEvidenceReconciliation(document);
    const route = routeSet?.routes?.find((candidate) => (candidate.occurrence_id || candidate.route_id) === pageRoutes[0]?.occurrence_id);
    const expectedDemands = route ? refs.evidenceDemands.filter((demand) => (Array.isArray(route.evidence_demand_ids) && route.evidence_demand_ids.includes(demand.evidence_demand_id)) || demand.route_id === route.route_id || demand.occurrence_id === (route.occurrence_id || route.route_id) || demand.route_occurrence_id === (route.occurrence_id || route.route_id)) : [];
    const expectedById = new Map(expectedDemands.map((demand) => [demand.evidence_demand_id, demand]));
    const evidenceMembersValid = evidence?.objects.every((member) => { const demand = expectedById.get(member.evidence_demand_id); return demand && (demand.evidence_object || demand.evidenceObject) && canonicalJson(member.object) === canonicalJson(demand.evidence_object || demand.evidenceObject); }) && evidence?.markers.every((marker) => { const demand = expectedById.get(marker.evidence_demand_id); return demand && !(demand.evidence_object || demand.evidenceObject) && ["UNAVAILABLE", "POLICY_FORBIDDEN"].includes(marker.marker) && marker.reason === (demand.unavailable_reason || "NO_ADMITTED_EVIDENCE_OBJECT"); });
    const evidenceMismatch = !evidence || canonicalJson(evidence.demands) !== canonicalJson(expectedDemands) || !evidenceMembersValid;
    const completenessIdentity = { page_identity: pageIdentity, required_route_population_digest: this._refFor("CompletenessRequiredRoutePopulation", requiredRoutes), materialized_route_population_digest: this._refFor("CompletenessMaterializedRoutePopulation", materializedRoutes), remanded_route_population_digest: this._refFor("CompletenessRemandedRoutePopulation", remandedRoutes), required_evidence_population_digest: this._refFor("CompletenessRequiredEvidencePopulation", evidence?.demands || []), evidence_reconciliation_digest: this._refFor("CompletenessEvidenceReconciliation", evidence || {}), reverse_map_digest: this._refFor("CompletenessReverseMap", evidence?.reverse || []), service_generation: SERVICE_GENERATION };
    const completenessState = routeMismatch || evidenceMismatch ? "REJECTED" : "COMPLETE";
    const completeness = { ...completenessIdentity, receiptRef: this._refFor("PageCompletenessReceipt", completenessIdentity), state: completenessState, planRef: plan.planRef, pageRef: page.pageRef, request_id: refs.request.request_id, evidenceUnavailable: evidence?.markers?.length || 0 };
    const runtime = this.state.evidenceRuntimes[page.runtimeRef];
    if (!runtime || runtime.state !== "ADMITTED" || runtime.runtimeRef !== refs.runtime.runtimeRef) return { kind: "gap", reason: `page-runtime.${pageIdentity}`, page, plan, descriptor, refs, document, completeness };
    const workerContract = document.worker_task_contract;
    const workerTaskContractDigest = document.worker_task_contract_digest;
    const expectedWorkerContract = this._workerTaskContract(refs, plan.materialization_policy_digest);
    const contractValid = Boolean(workerContract && canonicalJson(workerContract) === canonicalJson(expectedWorkerContract) && workerTaskContractDigest === this._refFor("WorkerTaskContract", workerContract));
    const unavailable = Boolean(evidence?.markers?.length);
    const evidenceBytes = Buffer.byteLength(canonicalJson({ evidence_demands: evidence?.demands || [], evidence_objects: evidence?.objects || [], unavailable_markers: evidence?.markers || [] }), "utf8");
    const budgetsValid = page.byte_length <= PAGE_BYTE_BUDGET && page.token_count <= PAGE_TOKEN_BUDGET && evidenceBytes <= EVIDENCE_BYTE_BUDGET;
    const contradictions = Array.isArray(document.contradictions) && document.contradictions.length > 0;
    const sufficiencyState = !contractValid || !evidence ? "REJECTED" : budgetsValid && !contradictions && !unavailable ? "SUFFICIENT" : "KNOWN_INSUFFICIENT";
    const availabilityStateDigest = this._refFor("PageAvailabilityState", { runtime: runtime.runtimeRef, state: runtime.state, availability: runtime.availability_snapshot_digest });
    const policyStateDigest = this._refFor("PagePolicyState", { policy: document.policy_excerpt || null, runtime_policy: runtime.evidence_policy_digest });
    const budgetStateDigest = this._refFor("PageBudgetState", { byte_length: page.byte_length, token_count: page.token_count, evidence_bytes: evidenceBytes, page_byte_budget: PAGE_BYTE_BUDGET, page_token_budget: PAGE_TOKEN_BUDGET, evidence_byte_budget: EVIDENCE_BYTE_BUDGET });
    const sufficiencyIdentity = { page_identity: pageIdentity, worker_task_contract_digest: contractValid ? workerTaskContractDigest : this._refFor("InvalidWorkerTaskContract", pageIdentity), completeness_receipt_digest: completeness.receiptRef, availability_state_digest: availabilityStateDigest, policy_state_digest: policyStateDigest, budget_state_digest: budgetStateDigest, standing: sufficiencyState, service_generation: SERVICE_GENERATION };
    const sufficiency = { ...sufficiencyIdentity, receiptRef: this._refFor("PageSufficiencyReceipt", sufficiencyIdentity), state: sufficiencyState, planRef: plan.planRef, pageRef: page.pageRef, runtimeRef: runtime.runtimeRef, request_id: refs.request.request_id, failedDemandIds: unavailable ? evidence.markers.map((marker) => marker.evidence_demand_id) : [] };
    const failedDemands = evidence?.markers?.map((marker) => marker.evidence_demand_id) || [];
    const failedPolicies = evidence?.markers?.map((marker) => ({ evidence_demand_id: marker.evidence_demand_id, reason: marker.reason })) || [];
    const routeOccurrences = Array.isArray(document.route_population) ? document.route_population : [];
    const evidenceState = evidence ? { demands: evidence.demands, objects: evidence.objects, unavailable_markers: evidence.markers, reverse_map: evidence.reverse } : {};
    const remandIdentity = { page_identity: pageIdentity, failed_demand_population_digest: this._refFor("FailedDemandPopulation", failedDemands), failed_policy_population_digest: this._refFor("FailedPolicyPopulation", failedPolicies), route_occurrence_population_digest: this._refFor("RemandRouteOccurrencePopulation", routeOccurrences), evidence_state_digest: this._refFor("RemandEvidenceState", evidenceState), remand_code: "KNOWN_INSUFFICIENT", service_generation: SERVICE_GENERATION };
    const remand = { ...remandIdentity, remandRef: this._refFor("KnownInsufficiencyRemand", remandIdentity), state: "ISSUED", sufficiencyRef: sufficiency.receiptRef, completenessRef: completeness.receiptRef, failedDemandIds: failedDemands, noWorkerCompute: true };
    return { kind: null, page, plan, descriptor, refs, document, completeness, sufficiency, remand };
  }

  evaluatePageCompleteness(input = {}) {
    let before;
    try {
      before = clone(this.state); const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR"); const selected = this._pageForEvaluation(input); if (!selected || selected.plan.state !== "INSTANTIATED" || selected.page.state !== "MATERIALIZED") return result("STALE_PREDECESSOR");
      const { raw, pageIdentity, plan, page, descriptor, refs } = selected; const operation = `evaluate-page-completeness:${pageIdentity}`; const operationInput = { page: page.pageRef, plan: plan.planRef }; const key = this._operationKey("evaluate-page-completeness", operationInput); const previous = this.state.operationInputs[operation]; if (previous) return previous.inputDigest === key ? result("REPLAYED", { receipt: clone(this.state.pageCompletenessReceipts[previous.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const cas = this._pageCasDocument(page, this._materializationDescriptorContent(plan, descriptor, refs)); if (cas.status !== "OK") return result(cas.status === "STALE_PREDECESSOR" ? "STALE_PREDECESSOR" : "POPULATION_MISMATCH");
      const document = cas.document; const partition = Array.isArray(plan.partition) ? plan.partition : []; const routeSet = this.state.routeSets[plan.request_id]; const requiredRoutes = partition.map((entry) => ({ occurrence_id: entry.occurrence_id, disposition: entry.disposition, ...(entry.page_identity ? { page_identity: entry.page_identity } : {}), ...(entry.reason ? { reason: entry.reason } : {}) })); const materializedRoutes = partition.filter((entry) => entry.disposition === "PAGE" && entry.page_identity === pageIdentity); const remandedRoutes = partition.filter((entry) => entry.disposition === "REMAND"); const pageRoutes = Array.isArray(document.route_population) ? document.route_population : [];
      const partitionDigestValid = plan.route_to_page_partition_digest === this._refFor("RouteToPagePartition", partition) && plan.ordered_page_identity_population_digest === this._refFor("OrderedPageIdentityPopulation", partition.filter((entry) => entry.disposition === "PAGE").map((entry) => entry.page_identity)); const routeMismatch = !routeSet || !partitionDigestValid || materializedRoutes.length !== 1 || pageRoutes.length !== 1 || pageRoutes[0].occurrence_id !== materializedRoutes[0]?.occurrence_id || new Set(partition.map((entry) => entry.occurrence_id)).size !== partition.length || canonicalJson(partition.map((entry) => entry.occurrence_id)) !== canonicalJson((routeSet.routes || []).map((route) => route.occurrence_id || route.route_id));
      const evidence = this._pageEvidenceReconciliation(document); const route = routeSet?.routes?.find((candidate) => (candidate.occurrence_id || candidate.route_id) === pageRoutes[0]?.occurrence_id); const expectedDemands = route ? refs.evidenceDemands.filter((demand) => (Array.isArray(route.evidence_demand_ids) && route.evidence_demand_ids.includes(demand.evidence_demand_id)) || demand.route_id === route.route_id || demand.occurrence_id === (route.occurrence_id || route.route_id) || demand.route_occurrence_id === (route.occurrence_id || route.route_id)) : []; const expectedById = new Map(expectedDemands.map((demand) => [demand.evidence_demand_id, demand])); const evidenceMembersValid = evidence?.objects.every((member) => { const demand = expectedById.get(member.evidence_demand_id); return demand && (demand.evidence_object || demand.evidenceObject) && canonicalJson(member.object) === canonicalJson(demand.evidence_object || demand.evidenceObject); }) && evidence?.markers.every((marker) => { const demand = expectedById.get(marker.evidence_demand_id); return demand && !(demand.evidence_object || demand.evidenceObject) && ["UNAVAILABLE", "POLICY_FORBIDDEN"].includes(marker.marker) && marker.reason === (demand.unavailable_reason || "NO_ADMITTED_EVIDENCE_OBJECT"); }); const evidenceMismatch = !evidence || canonicalJson(evidence.demands) !== canonicalJson(expectedDemands) || !evidenceMembersValid; const mismatch = routeMismatch || evidenceMismatch;
      const requiredRoutePopulationDigest = this._refFor("CompletenessRequiredRoutePopulation", requiredRoutes); const materializedRoutePopulationDigest = this._refFor("CompletenessMaterializedRoutePopulation", materializedRoutes); const remandedRoutePopulationDigest = this._refFor("CompletenessRemandedRoutePopulation", remandedRoutes); const requiredEvidencePopulationDigest = this._refFor("CompletenessRequiredEvidencePopulation", evidence?.demands || []); const evidenceReconciliationDigest = this._refFor("CompletenessEvidenceReconciliation", evidence || {}); const reverseMapDigest = this._refFor("CompletenessReverseMap", evidence?.reverse || []); const identity = { page_identity: pageIdentity, required_route_population_digest: requiredRoutePopulationDigest, materialized_route_population_digest: materializedRoutePopulationDigest, remanded_route_population_digest: remandedRoutePopulationDigest, required_evidence_population_digest: requiredEvidencePopulationDigest, evidence_reconciliation_digest: evidenceReconciliationDigest, reverse_map_digest: reverseMapDigest, service_generation: generation.generationRef }; const receipt = { ...identity, receiptRef: this._refFor("PageCompletenessReceipt", identity), state: mismatch ? "REJECTED" : "COMPLETE", planRef: plan.planRef, pageRef: page.pageRef, request_id: refs.request.request_id, evidenceUnavailable: evidence?.markers?.length || 0, recordedAt: this.clock() }; this._assertCarrierFields("d.page-completeness-receipt", receipt); this._save("pageCompletenessReceipts", pageIdentity, receipt); this.state.operationInputs[operation] = { inputDigest: key, ref: pageIdentity, operationInput }; this._recordTransition("evaluate-page-completeness", "d.page-completeness-receipt", mismatch ? "REJECT" : "COMPLETE", receipt, mismatch ? "POPULATION_MISMATCH" : "COMPLETE"); this._persist(); return result(mismatch ? "POPULATION_MISMATCH" : "COMPLETE", { receipt });
    } catch (error) { if (error.code === "DSS04_SQLITE_INJECTED_FAILURE") { if (before) this.state = before; return result("STALE_PREDECESSOR", { errorCode: error.code }); } if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  evaluatePageSufficiency(input = {}) {
    let before;
    try {
      before = clone(this.state); const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR"); const selected = this._pageForEvaluation(input, false); const completenessRef = input.completeness_receipt_digest || input.completenessReceipt?.receiptRef || input.completeness_receipt_ref; if (!selected || typeof completenessRef !== "string") return result("STALE_PREDECESSOR"); const completeness = Object.values(this.state.pageCompletenessReceipts).find((receipt) => receipt.receiptRef === completenessRef); if (!completeness || completeness.page_identity !== selected.pageIdentity || completeness.planRef !== selected.plan.planRef || completeness.state !== "COMPLETE") return result("OUTPUT_REJECTED");
      const runtimeRef = input.project_evidence_runtime_revision_digest || input.runtime_ref || selected.page.runtimeRef; const runtime = this.state.evidenceRuntimes[runtimeRef]; if (!runtime || runtime.runtimeRef !== selected.page.runtimeRef || runtime.state !== "ADMITTED" || selected.refs.request.service_generation !== generation.generationRef) return result("STALE_PREDECESSOR"); const operation = `evaluate-page-sufficiency:${selected.pageIdentity}`; const operationInput = { page: selected.page.pageRef, completeness: completeness.receiptRef, runtime: runtime.runtimeRef }; const key = this._operationKey("evaluate-page-sufficiency", operationInput); const previous = this.state.operationInputs[operation]; if (previous) return previous.inputDigest === key ? result("REPLAYED", { receipt: clone(this.state.pageSufficiencyReceipts[previous.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const cas = this._pageCasDocument(selected.page, this._materializationDescriptorContent(selected.plan, selected.descriptor, selected.refs)); if (cas.status !== "OK") return result(cas.status === "STALE_PREDECESSOR" ? "STALE_PREDECESSOR" : "OUTPUT_REJECTED"); const document = cas.document; const workerContract = document.worker_task_contract; const workerTaskContractDigest = document.worker_task_contract_digest; const expectedWorkerContract = this._workerTaskContract(selected.refs, selected.plan.materialization_policy_digest); const contractValid = workerContract && canonicalJson(workerContract) === canonicalJson(expectedWorkerContract) && workerTaskContractDigest === this._refFor("WorkerTaskContract", workerContract); const evidence = this._pageEvidenceReconciliation(document); const unavailable = evidence?.markers?.length > 0; const evidenceBytes = Buffer.byteLength(canonicalJson({ evidence_demands: evidence?.demands || [], evidence_objects: evidence?.objects || [], unavailable_markers: evidence?.markers || [] }), "utf8"); const budgetsValid = selected.page.byte_length <= PAGE_BYTE_BUDGET && selected.page.token_count <= PAGE_TOKEN_BUDGET && evidenceBytes <= EVIDENCE_BYTE_BUDGET; const contradictions = Array.isArray(document.contradictions) && document.contradictions.length > 0; const invalidEvidence = !evidence; const rejected = !contractValid || invalidEvidence; const standing = rejected ? "REJECTED" : budgetsValid && !contradictions && !unavailable ? "SUFFICIENT" : "KNOWN_INSUFFICIENT";
      const availabilityStateDigest = this._refFor("PageAvailabilityState", { runtime: runtime.runtimeRef, state: runtime.state, availability: runtime.availability_snapshot_digest }); const policyStateDigest = this._refFor("PagePolicyState", { policy: document.policy_excerpt || null, runtime_policy: runtime.evidence_policy_digest }); const budgetStateDigest = this._refFor("PageBudgetState", { byte_length: selected.page.byte_length, token_count: selected.page.token_count, evidence_bytes: evidenceBytes, page_byte_budget: PAGE_BYTE_BUDGET, page_token_budget: PAGE_TOKEN_BUDGET, evidence_byte_budget: EVIDENCE_BYTE_BUDGET }); const identity = { page_identity: selected.pageIdentity, worker_task_contract_digest: contractValid ? workerTaskContractDigest : this._refFor("InvalidWorkerTaskContract", selected.pageIdentity), completeness_receipt_digest: completeness.receiptRef, availability_state_digest: availabilityStateDigest, policy_state_digest: policyStateDigest, budget_state_digest: budgetStateDigest, standing, service_generation: generation.generationRef }; const receipt = { ...identity, receiptRef: this._refFor("PageSufficiencyReceipt", identity), state: standing, planRef: selected.plan.planRef, pageRef: selected.page.pageRef, runtimeRef: runtime.runtimeRef, request_id: selected.refs.request.request_id, failedDemandIds: unavailable ? evidence.markers.map((marker) => marker.evidence_demand_id) : [], recordedAt: this.clock() }; this._assertCarrierFields("d.page-sufficiency-receipt", receipt); this._save("pageSufficiencyReceipts", selected.pageIdentity, receipt); this.state.operationInputs[operation] = { inputDigest: key, ref: selected.pageIdentity, operationInput }; const event = standing === "SUFFICIENT" ? "MARK_SUFFICIENT" : standing === "KNOWN_INSUFFICIENT" ? "MARK_INSUFFICIENT" : "REJECT"; const outcome = standing === "REJECTED" ? "OUTPUT_REJECTED" : standing; this._recordTransition("evaluate-page-sufficiency", "d.page-sufficiency-receipt", event, receipt, outcome); this._persist(); return result(outcome, { receipt });
    } catch (error) { if (error.code === "DSS04_SQLITE_INJECTED_FAILURE") { if (before) this.state = before; return result("STALE_PREDECESSOR", { errorCode: error.code }); } if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  issueKnownInsufficiencyRemand(input = {}) {
    let before;
    try {
      before = clone(this.state); const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR");
      const sufficiencyRef = input.sufficiency_receipt_digest || input.sufficiencyReceipt?.receiptRef || input.sufficiency_receipt_ref; const completenessRef = input.completeness_receipt_digest || input.completenessReceipt?.receiptRef || input.completeness_receipt_ref;
      const sufficiency = Object.values(this.state.pageSufficiencyReceipts).find((receipt) => receipt.receiptRef === sufficiencyRef); const completeness = Object.values(this.state.pageCompletenessReceipts).find((receipt) => receipt.receiptRef === completenessRef);
      if (!sufficiency || !completeness) return result("STALE_PREDECESSOR");
      if (sufficiency.completeness_receipt_digest !== completeness.receiptRef || sufficiency.state !== "KNOWN_INSUFFICIENT") return result("OUTPUT_REJECTED");
      const page = this.state.closedEvidencePages[sufficiency.page_identity]; const plan = page && this.state.materializationPlans[page.planRef]; const descriptor = plan?.pages?.find((candidate) => candidate.page_identity === page.page_identity); const pageRefs = plan && this._materializationReferences(this.state.routeSets[plan.request_id]); const cas = page && descriptor && pageRefs && this._pageCasDocument(page, this._materializationDescriptorContent(plan, descriptor, pageRefs)); const document = cas?.status === "OK" ? cas.document : null; const evidence = document && this._pageEvidenceReconciliation(document); if (!page || !evidence) return result("STALE_PREDECESSOR");
      const operation = `issue-known-insufficiency-remand:${sufficiency.page_identity}`; const operationInput = { sufficiency: sufficiency.receiptRef, completeness: completeness.receiptRef }; const key = this._operationKey("issue-known-insufficiency-remand", operationInput); const previous = this.state.operationInputs[operation]; if (previous) return previous.inputDigest === key ? result("REPLAYED", { remand: clone(this.state.knownInsufficiencyRemands[previous.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const failedDemands = evidence.markers.map((marker) => marker.evidence_demand_id); const failedPolicies = evidence.markers.map((marker) => ({ evidence_demand_id: marker.evidence_demand_id, reason: marker.reason })); const routeOccurrences = Array.isArray(document.route_population) ? document.route_population : []; const evidenceState = { demands: evidence.demands, objects: evidence.objects, unavailable_markers: evidence.markers, reverse_map: evidence.reverse }; const identity = { page_identity: sufficiency.page_identity, failed_demand_population_digest: this._refFor("FailedDemandPopulation", failedDemands), failed_policy_population_digest: this._refFor("FailedPolicyPopulation", failedPolicies), route_occurrence_population_digest: this._refFor("RemandRouteOccurrencePopulation", routeOccurrences), evidence_state_digest: this._refFor("RemandEvidenceState", evidenceState), remand_code: "KNOWN_INSUFFICIENT", service_generation: generation.generationRef }; const remand = { ...identity, remandRef: this._refFor("KnownInsufficiencyRemand", identity), state: "ISSUED", sufficiencyRef: sufficiency.receiptRef, completenessRef: completeness.receiptRef, failedDemandIds: failedDemands, noWorkerCompute: true, issuedAt: this.clock() }; this._assertCarrierFields("d.known-insufficiency-remand", remand); this._save("knownInsufficiencyRemands", sufficiency.page_identity, remand); this.state.operationInputs[operation] = { inputDigest: key, ref: sufficiency.page_identity, operationInput }; this._recordTransition("issue-known-insufficiency-remand", "d.known-insufficiency-remand", "ISSUE", remand, "REMANDED"); this._persist(); return result("REMANDED", { remand });
    } catch (error) { if (error.code === "DSS04_SQLITE_INJECTED_FAILURE") { if (before) this.state = before; return result("STALE_PREDECESSOR", { errorCode: error.code }); } if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  _validatorRevisionSpec() {
    const spec = this.anchor?.anchor?.payload?.validator;
    if (!spec || typeof spec !== "object") fail("DSS04_ANCHOR_INVALID");
    const values = spec.revisionIdentityValues || spec.revision_identity_values;
    const identityDigest = spec.revisionIdentityDigest || spec.revision_identity_digest;
    const lifecycleHead = spec.lifecycleHead || spec.lifecycle_head;
    if (!values || !identityDigest || !lifecycleHead) fail("DSS04_ANCHOR_INVALID");
    return { values: clone(values), identityDigest, lifecycleHead: clone(lifecycleHead) };
  }

  _validatorAuthority(input = {}) {
    const auth = input.grant || input.authorization || input.ownerAuthorization;
    return Boolean(auth && auth.owner === "dss04-validator-revision-owner" && auth.root === "dss04-validator-revision-root" && auth.authorized === true);
  }

  _candidateValidationAuthority(input = {}) {
    const auth = input.validationGrant || input.candidateValidationGrant || input.grant || input.authorization;
    return Boolean(auth && auth.owner === "dss04-candidate-validation-owner" && auth.root === "independent-candidate-validator-root" && auth.authorized === true);
  }

  _candidateIdentity(kind, candidate) {
    const fields = kind === "PAGE_FAULT" ? DSS04_CARRIER_FIELD_MAP["e.page-fault-candidate"].stable : DSS04_CARRIER_FIELD_MAP["e.novel-edge-candidate"].stable;
    const identity = Object.fromEntries(fields.concat(["service_generation"]).map((field) => [field, candidate[field]]));
    return this._refFor(kind === "PAGE_FAULT" ? "PageFaultCandidate" : "NovelEdgeCandidate", identity);
  }

  _candidatePageContext(candidate) {
    const page = this.state.closedEvidencePages[candidate.page_identity];
    if (!page || page.state !== "MATERIALIZED") return { status: "REJECTED", reason: "PAGE_NOT_MATERIALIZED" };
    const plan = this.state.materializationPlans[page.planRef];
    const routeSet = plan && this.state.routeSets[plan.request_id];
    const refs = routeSet && this._materializationReferences(routeSet);
    if (!plan || plan.state !== "INSTANTIATED" || !refs) return { status: "REJECTED", reason: "PAGE_PREDECESSOR" };
    const descriptor = plan.pages?.find((entry) => entry.page_identity === page.page_identity);
    const cas = descriptor && this._pageCasDocument(page, this._materializationDescriptorContent(plan, descriptor, refs));
    if (!descriptor || !cas || cas.status !== "OK") return { status: cas?.status === "STALE_PREDECESSOR" ? "REJECTED" : "REJECTED", reason: "PAGE_CUSTODY" };
    const occurrence = cas.document.route_population?.[0]?.occurrence_id;
    const route = routeSet.routes?.find((entry) => (entry.occurrence_id || entry.route_id) === occurrence);
    if (!route || !occurrence) return { status: "REJECTED", reason: "ROUTE_NOT_FOUND" };
    const routeIdentity = this._refFor("CandidateRouteIdentity", { route_id: route.route_id, occurrence_id: occurrence });
    return { status: "OK", page, plan, routeSet, refs, descriptor, document: cas.document, route, occurrence, routeIdentity };
  }

  _candidateRaw(input, kind) {
    const raw = clone(input.candidate || input);
    const stableFields = kind === "PAGE_FAULT" ? ["worker_runtime_revision", "task_id", "attempt_id", "page_identity", "route_identity", "claimed_missing_fact_digest", "bounded_rationale_digest", "source_locator_digest"] : ["worker_runtime_revision", "task_id", "attempt_id", "page_identity", "route_identity", "claimed_edge_digest", "bounded_rationale_digest", "source_locator_digest"];
    const extras = Object.keys(raw).filter((key) => ![...stableFields, "service_generation", "observed_at", "recorded_at", "claim", "evidence", "candidate_kind"].includes(key));
    if (extras.length) raw.__invalidExtras = extras;
    exactFields(raw, stableFields, "candidate");
    for (const field of stableFields) if (field.endsWith("_digest") || field.endsWith("_identity")) safeDigest(raw[field], `candidate.${field}`);
    requiredString(raw.service_generation, "candidate.service_generation");
    requiredString(raw.observed_at, "candidate.observed_at"); requiredString(raw.recorded_at, "candidate.recorded_at");
    const observed = Date.parse(raw.observed_at); const recorded = Date.parse(raw.recorded_at); const now = Date.parse(this.clock());
    if (!Number.isFinite(observed) || !Number.isFinite(recorded) || observed > recorded || recorded > now) fail("DSS04_CANDIDATE_TIME_INVALID");
    if (raw.candidate_kind !== undefined && raw.candidate_kind !== kind) raw.__invalidReason = "kind";
    return raw;
  }

  _submitCandidate(input, kind) {
    const operationId = kind === "PAGE_FAULT" ? "submit-page-fault-candidate" : "submit-novel-edge-candidate";
    const carrierId = kind === "PAGE_FAULT" ? "e.page-fault-candidate" : "e.novel-edge-candidate";
    let candidate;
    try {
      const generation = this._ready(input);
      if (!generation) return result("STALE_PREDECESSOR");
      candidate = this._candidateRaw(input, kind);
      if (candidate.service_generation !== generation.generationRef) return result("STALE_PREDECESSOR");
      const candidateRef = this._candidateIdentity(kind, candidate);
      const operation = `${operationId}:${candidate.task_id}:${candidate.attempt_id}`;
      const observationBinding = this._refFor("CandidateObservation", { observed_at: candidate.observed_at, recorded_at: candidate.recorded_at, claim: candidate.claim || null, evidence: candidate.evidence || null });
      const operationInput = { candidate: candidateRef, page: candidate.page_identity, generation: generation.generationRef, observation: observationBinding };
      const key = this._operationKey(operationId, operationInput);
      const priorBinding = this.state.operationInputs[operation];
      if (priorBinding) return priorBinding.inputDigest === key ? result("REPLAYED", { candidate: clone(this.state[kind === "PAGE_FAULT" ? "pageFaultCandidates" : "novelEdgeCandidates"][priorBinding.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const context = this._candidatePageContext(candidate);
      const rejection = candidate.__invalidExtras?.length ? "EXTRA_FIELD" : candidate.__invalidReason || (context.status !== "OK" ? context.reason : candidate.worker_runtime_revision !== context.refs.runtime.runtimeRef || candidate.route_identity !== context.routeIdentity ? "PAGE_OR_ROUTE_BINDING" : null);
      const value = { ...candidate, candidateRef, candidate_kind: kind, state: rejection ? "REJECTED" : "SUBMITTED", generation: generation.generationRef, submittedAt: this.clock(), ...(rejection ? { rejectionReason: rejection } : {}), ...(context.status === "OK" ? { pageRef: context.page.pageRef, planRef: context.plan.planRef, runtimeRef: context.refs.runtime.runtimeRef, snapshotRef: context.refs.snapshot.receiptRef, request_id: context.refs.request.request_id, occurrence_id: context.occurrence } : {}) };
      this._assertCarrierFields(carrierId, value);
      const collection = kind === "PAGE_FAULT" ? "pageFaultCandidates" : "novelEdgeCandidates";
      const existingCandidate = this.state[collection][candidateRef];
      if (existingCandidate) return canonicalJson(existingCandidate) === canonicalJson({ ...candidate, candidateRef, candidate_kind: kind }) ? result("REPLAYED", { candidate: clone(existingCandidate) }) : result("IDEMPOTENCY_CONFLICT");
      this._save(collection, candidateRef, value);
      this.state.operationInputs[operation] = { inputDigest: key, ref: candidateRef, operationInput };
      this._recordTransition(operationId, carrierId, rejection ? "REJECT" : "SUBMIT", value, rejection ? "REJECTED" : "ACCEPTED");
      this._persist();
      return result(rejection ? "REJECTED" : "ACCEPTED", { candidate: value });
    } catch (error) {
      if (error.code === "DSS04_CANDIDATE_TIME_INVALID" || error.code === "DSS04_CANDIDATE_INVALID" || error.code === "DSS04_EXTRA_FIELD" || error.code === "DSS04_DIGEST_INVALID" || error.code === "DSS04_FIELD_INVALID") return result("REJECTED");
      if (error.code === "DSS04_STATE_CORRUPT") return result("STALE_PREDECESSOR");
      throw error;
    }
  }

  submitPageFaultCandidate(input = {}) { return this._submitCandidate(input, "PAGE_FAULT"); }
  submitNovelEdgeCandidate(input = {}) { return this._submitCandidate(input, "NOVEL_EDGE"); }

  issueValidatorRevision(input = {}) {
    try {
      if (!this._validatorAuthority(input)) return result("UNAUTHORIZED");
      const generation = this._ready(input); if (!generation) return result("STALE_GENERATION");
      const spec = this._validatorRevisionSpec();
      const supplied = clone(input.validator_revision || input.validatorRevision || {});
      if (Object.keys(supplied).length && canonicalJson(Object.fromEntries(Object.keys(spec.values).map((key) => [key, supplied[key]]))) !== canonicalJson(spec.values)) return result("IDEMPOTENCY_CONFLICT");
      const operationInput = { generation: generation.generationRef }; const key = this._operationKey("issue-validator-revision", operationInput); const priorBinding = this.state.operationInputs["issue-validator-revision"];
      const ref = spec.identityDigest; const collection = this.state.validatorRevisions; const existing = collection[ref];
      if (priorBinding) return priorBinding.inputDigest === key && existing?.state === "ISSUED" ? result("REPLAYED", { validatorRevision: clone(existing) }) : result("IDEMPOTENCY_CONFLICT");
      if (existing) return existing.state === "REVOKED" ? result("STALE_PREDECESSOR") : result("IDEMPOTENCY_CONFLICT");
      const value = { ...clone(spec.values), revisionRef: ref, state: "ISSUED", service_generation: generation.generationRef, owner: "dss04-validator-revision-owner", root: "dss04-validator-revision-root", lifecycleHead: clone(spec.lifecycleHead), issuedAt: this.clock() };
      this._assertCarrierFields("d.validator-revision", value); this._save("validatorRevisions", ref, value); this.state.operationInputs["issue-validator-revision"] = { inputDigest: key, ref, operationInput };
      this._recordTransition("issue-validator-revision", "d.validator-revision", "ISSUE", value, "VALIDATED"); this._persist(); return result("VALIDATED", { validatorRevision: value });
    } catch (error) { if (["DSS04_ANCHOR_INVALID", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  revokeValidatorRevision(input = {}) {
    try {
      if (!this._validatorAuthority(input)) return result("UNAUTHORIZED");
      const generation = this._ready(input); if (!generation) return result("STALE_GENERATION");
      const spec = this._validatorRevisionSpec(); const value = this.state.validatorRevisions[spec.identityDigest]; if (!value || value.state !== "ISSUED") return result("STALE_PREDECESSOR");
      const operation = "issue-validator-revision:revoke"; const operationInput = { generation: generation.generationRef }; const key = this._operationKey("issue-validator-revision", operationInput); const prior = this.state.operationInputs[operation]; if (prior) return prior.inputDigest === key ? result("REPLAYED", { validatorRevision: clone(value) }) : result("IDEMPOTENCY_CONFLICT");
      const headIdentity = { event: "REVOKE", predecessorStanding: "ISSUED", standing: "REVOKED", validatorRevision: value.validator_revision, validatorRevisionIdentityDigest: value.revisionRef, serviceGeneration: generation.generationRef, authenticated: true, owner: "dss04-validator-revision-owner" };
      const headPreimage = Object.fromEntries(["event", "predecessorStanding", "standing", "validatorRevision", "validatorRevisionIdentityDigest", "serviceGeneration", "owner"].map((key) => [key, headIdentity[key]])); const headDigest = `sha256:${crypto.createHash("sha256").update(Buffer.from(`Dss04.ValidatorLifecycleHead.v1\n${stable(headPreimage)}`, "utf8")).digest("hex")}`;
      const revoked = { ...value, state: "REVOKED", lifecycleHead: { ...headIdentity, headDigest }, revokedAt: this.clock() };
      this._save("validatorRevisions", spec.identityDigest, revoked); this.state.operationInputs[operation] = { inputDigest: key, ref: spec.identityDigest, operationInput }; this._recordTransition("issue-validator-revision", "d.validator-revision", "REVOKE", revoked, "STALE_GENERATION"); this._persist(); return result("STALE_GENERATION", { validatorRevision: revoked });
    } catch (error) { if (["DSS04_ANCHOR_INVALID", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  _candidateEvidenceDecision(candidate, context, kind) {
    if (!candidate.claim || typeof candidate.claim !== "object" || Array.isArray(candidate.claim)) return { outcome: "OUTPUT_REJECTED", state: "OUT_OF_SCOPE", event: "MARK_OUT_OF_SCOPE" };
    const claimDigest = this._refFor(kind === "PAGE_FAULT" ? "CandidateMissingFact" : "CandidateEdge", candidate.claim);
    const suppliedDigest = kind === "PAGE_FAULT" ? candidate.claimed_missing_fact_digest : candidate.claimed_edge_digest;
    if (claimDigest !== suppliedDigest) return { outcome: "OUTPUT_REJECTED", state: "OUT_OF_SCOPE", event: "MARK_OUT_OF_SCOPE" };
    const locator = candidate.claim.source_locator;
    if (typeof locator !== "string" || !locator || locator.length > 512 || locator.startsWith("/") || locator.split("/").includes("..")) return { outcome: "OUTPUT_REJECTED", state: "OUT_OF_SCOPE", event: "MARK_OUT_OF_SCOPE" };
    if (candidate.source_locator_digest !== this._refFor("CandidateSourceLocator", { locator })) return { outcome: "OUTPUT_REJECTED", state: "OUT_OF_SCOPE", event: "MARK_OUT_OF_SCOPE" };
    // Candidate.evidence is deliberately not read here.  The independent
    // validator reconstructs its observation only from admitted snapshot
    // bytes and the current evidence-runtime policy/toolchain.
    const artifacts = (context.refs.snapshot.artifactRefs || []).map((ref) => this.state.snapshotArtifacts[ref]).filter(Boolean);
    const observedArtifacts = artifacts.map((artifact) => ({ locator: artifact.canonical_relative_path, content_seal: artifact.content_digest, byte_length: artifact.byte_length }));
    const artifact = artifacts.find((entry) => entry.canonical_relative_path === locator);
    const independentEvidence = { snapshot: context.refs.snapshot.receiptRef, runtime: context.refs.runtime.runtimeRef, compiler: this.state.pins.compilerBuild?.digest, policy: context.refs.runtime.evidence_policy_digest, toolchain: context.refs.runtime.evidence_toolchain_digest, artifacts: observedArtifacts, claim: clone(candidate.claim) };
    const finish = (outcome, state, event) => ({ outcome, state, event, independentEvidence });
    if (kind === "PAGE_FAULT") {
      if (candidate.claim.route_identity !== undefined && candidate.claim.route_identity !== context.routeIdentity) return finish("OUTPUT_REJECTED", "OUT_OF_SCOPE", "MARK_OUT_OF_SCOPE");
      if (artifact) {
        let parsed = null; try { parsed = JSON.parse(Buffer.from(artifact.bytesBase64, "base64").toString("utf8")); } catch (_) {}
        if (parsed && parsed.ambiguous === true) return finish("INCONCLUSIVE", "INCONCLUSIVE", "MARK_INCONCLUSIVE");
        return finish("REFUTED", "REFUTED", "REFUTE");
      }
      return finish("VALIDATED", "VALIDATED", "VALIDATE");
    }
    const from = candidate.claim.from_route_id; const to = candidate.claim.to_route_id;
    if (typeof from !== "string" || typeof to !== "string" || from !== context.route.route_id || to !== context.route.route_id) return finish("OUTPUT_REJECTED", "OUT_OF_SCOPE", "MARK_OUT_OF_SCOPE");
    if (artifact) {
      let parsed = null; try { parsed = JSON.parse(Buffer.from(artifact.bytesBase64, "base64").toString("utf8")); } catch (_) {}
      if (parsed && parsed.ambiguous === true) return finish("INCONCLUSIVE", "INCONCLUSIVE", "MARK_INCONCLUSIVE");
      if (parsed && canonicalJson(parsed) === canonicalJson(candidate.claim)) return finish("REFUTED", "REFUTED", "REFUTE");
    }
    return finish("VALIDATED", "VALIDATED", "VALIDATE");
  }

  validateCandidateIndependently(input = {}) {
    let before;
    try {
      before = clone(this.state); const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR");
      if (!this._candidateValidationAuthority(input)) return result("STALE_PREDECESSOR");
      const suppliedCandidates = [input.page_fault_candidate || input.pageFaultCandidate, input.novel_edge_candidate || input.novelEdgeCandidate, input.candidate].filter(Boolean);
      if (suppliedCandidates.length !== 1) return result("STALE_PREDECESSOR");
      const supplied = suppliedCandidates[0]; const candidateRef = typeof supplied === "string" ? supplied : supplied.candidateRef || supplied.candidate_digest || input.candidate_digest;
      if (typeof candidateRef !== "string") return result("STALE_PREDECESSOR");
      const pageCandidate = this.state.pageFaultCandidates[candidateRef]; const edgeCandidate = this.state.novelEdgeCandidates[candidateRef]; const candidate = pageCandidate || edgeCandidate; const kind = pageCandidate ? "PAGE_FAULT" : edgeCandidate ? "NOVEL_EDGE" : null;
      if (!candidate || !kind || candidate.state !== "SUBMITTED") return result("STALE_PREDECESSOR");
      const validatorInput = input.validator_revision || input.validatorRevision || input.validator_revision_ref; const validatorRef = typeof validatorInput === "string" ? validatorInput : validatorInput?.revisionRef || validatorInput?.revision_identity_digest;
      const validator = validatorRef && (this.state.validatorRevisions[validatorRef] || Object.values(this.state.validatorRevisions).find((revision) => revision.validator_revision === validatorRef)); if (!validator || validator.state !== "ISSUED" || validator.service_generation !== generation.generationRef) return result("STALE_PREDECESSOR");
      const context = this._candidatePageContext(candidate); if (context.status !== "OK") return result("STALE_PREDECESSOR");
      const refs = { registry: input.project_registry_revision_digest || input.registry_revision_digest || input.projectRegistryRevision?.revisionRef, snapshot: input.target_snapshot_receipt_digest || input.snapshot_receipt_digest || input.targetSnapshotReceipt?.receiptRef, runtime: input.project_evidence_runtime_revision_digest || input.evidence_runtime_revision_digest || input.projectEvidenceRuntimeRevision?.runtimeRef, compiler: input.compiler_build_pin_digest || input.compilerBuildPin?.digest };
      if (refs.registry !== context.refs.registry.revisionRef || refs.snapshot !== context.refs.snapshot.receiptRef || refs.runtime !== context.refs.runtime.runtimeRef || refs.compiler !== this.state.pins.compilerBuild?.digest) return result("STALE_PREDECESSOR");
      const operation = `validate-candidate-independently:${candidateRef}`; const operationInput = { candidate: candidateRef, validator: validator.revisionRef, registry: refs.registry, snapshot: refs.snapshot, runtime: refs.runtime, compiler: refs.compiler, generation: generation.generationRef }; const key = this._operationKey("validate-candidate-independently", operationInput); const prior = this.state.operationInputs[operation]; if (prior) return prior.inputDigest === key ? result("REPLAYED", { validation: clone(this.state.candidateValidationRecords[prior.ref]) }) : result("IDEMPOTENCY_CONFLICT");
      const decision = candidate.service_generation !== generation.generationRef ? { outcome: "STALE_GENERATION", state: "STALE", event: "MARK_STALE" } : this._candidateEvidenceDecision(candidate, context, kind);
      const evidenceDigest = this._refFor("CandidateValidationEvidence", { candidate: candidateRef, independentEvidence: decision.independentEvidence || null, decision: decision.state, page: candidate.page_identity, generation: generation.generationRef });
      const identity = { candidate_digest: candidateRef, validator_revision: validator.validator_revision, project_registry_revision_digest: refs.registry, target_snapshot_receipt_digest: refs.snapshot, project_evidence_runtime_revision_digest: refs.runtime, compiler_build_pin_digest: refs.compiler, classification: decision.state, evidence_digest: evidenceDigest, service_generation: generation.generationRef };
      const record = { ...identity, validationRef: this._refFor("CandidateValidationRecord", identity), state: decision.state, candidate_kind: kind, candidateRef, page_identity: candidate.page_identity, validatorRevisionRef: validator.revisionRef, planRef: context.plan.planRef, pageRef: context.page.pageRef, runtimeRef: context.refs.runtime.runtimeRef, request_id: context.refs.request.request_id, outcome: decision.outcome, recordedAt: this.clock() };
      this._assertCarrierFields("d.candidate-validation-record", record); this._save("candidateValidationRecords", record.validationRef, record); this.state.operationInputs[operation] = { inputDigest: key, ref: record.validationRef, operationInput }; this._recordTransition("validate-candidate-independently", "d.candidate-validation-record", decision.event, record, decision.outcome); this._persist(); return result(decision.outcome, { validation: record });
    } catch (error) { if (error.code === "DSS04_SQLITE_INJECTED_FAILURE") { if (before) this.state = before; return result("STALE_PREDECESSOR", { errorCode: error.code }); } if (["DSS04_STATE_CORRUPT", "DSS04_ANCHOR_INVALID"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  _requestForOperation(input = {}) {
    const raw = input.request || input.compilationRequest || input;
    const requestId = raw.request_id || raw.requestId;
    return this.state.compilationRequests[requestId] || Object.values(this.state.compilationRequests).find((request) => request.requestRef === requestId);
  }

  _cancellationAuthorized(input, request, generation) {
    const grant = input.grant || input.authorization;
    if (!grant || grant.owner !== "dss03-authority-owner" || grant.root !== "ratified-dss03-result-root" || grant.authorized !== true) return false;
    let verifier; try { verifier = this._verifier("authorization", "dss03-authority-owner", "ratified-dss03-result-root"); } catch (_) { return false; }
    if (verifier.revision !== "dss03-grant-verifier-v1") return false;
    const observation = Object.values(this.state.observations).find((candidate) => candidate.request_id === request.request_id); const scope = this._refFor("CancellationGrantScope", { generation: generation.generationRef, request: request.requestRef, observation: observation?.observationRef || input.observation?.observationRef || input.observation_ref || null, observationState: observation?.state || input.observation?.state || "UNSEEN" });
    return grant.scopeDigest === scope && verifier.verify({ grantScope: scope, request: request.requestRef, generation: generation.generationRef }, grant);
  }

  _accountingEvidenceBytes(pages) {
    return pages.reduce((sum, page) => {
      const plan = this.state.materializationPlans[page.planRef];
      const descriptor = plan?.pages?.find((candidate) => candidate.page_identity === page.page_identity);
      const refs = plan && this._materializationReferences(this.state.routeSets[plan.request_id]);
      const cas = descriptor && refs && this._pageCasDocument(page, this._materializationDescriptorContent(plan, descriptor, refs));
      if (!cas || cas.status !== "OK") return sum;
      return sum + Buffer.byteLength(canonicalJson({ evidence_demands: cas.document.evidence_demands || [], evidence_objects: cas.document.evidence_objects || [], unavailable_markers: cas.document.unavailable_markers || [] }), "utf8");
    }, 0);
  }

  _accountingPageTerminal(pages) {
    return pages.length > 0 && pages.every((page) => {
      const completeness = this.state.pageCompletenessReceipts[page.page_identity];
      const sufficiency = this.state.pageSufficiencyReceipts[page.page_identity];
      return completeness?.state === "COMPLETE" && ["SUFFICIENT", "KNOWN_INSUFFICIENT"].includes(sufficiency?.state) && (sufficiency.state === "SUFFICIENT" || this.state.knownInsufficiencyRemands[page.page_identity]?.state === "ISSUED");
    });
  }

  recordDss04Accounting(input = {}) {
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR");
      const request = this._requestForOperation(input); const observationInput = input.observation || input.processObservation || {}; const observationRef = observationInput.observationRef || observationInput.observation_ref || input.observation_ref;
      const observation = Object.values(this.state.observations).find((candidate) => candidate.observationRef === observationRef || candidate.request_id === request?.request_id);
      if (!request || !observation || observation.request_id !== request.request_id) return result("STALE_PREDECESSOR");
      const pages = Object.values(this.state.closedEvidencePages).filter((page) => page.request_id === request.request_id && page.state === "MATERIALIZED");
      const suppliedPages = input.closedEvidencePages || input.pages;
      if (suppliedPages !== undefined && (!Array.isArray(suppliedPages) || canonicalJson(suppliedPages.map((page) => page.pageRef || page.page_ref || page).sort()) !== canonicalJson(pages.map((page) => page.pageRef).sort()))) return result("POPULATION_MISMATCH");
      const terminal = ["TERMINATED", "INTERRUPTED", "ISOLATION_FAILED"].includes(observation.state); const pageTerminal = this._accountingPageTerminal(pages); const existing = this.state.accounting[request.request_id]; const pageRefs = pages.map((page) => page.pageRef).sort(); const phase = existing?.state === "FINAL" ? "FINALIZE" : existing?.state === "RECORDED" && terminal && pageTerminal && (existing.observationRef !== observation.observationRef || canonicalJson(existing.pageRefs || []) !== canonicalJson(pageRefs)) ? "FINALIZE" : "RECORD"; const operation = `record-dss04-accounting:${request.request_id}:${phase}`; const operationInput = { request: request.requestRef, observation: observation.observationRef, pages: pageRefs, generation: generation.generationRef, phase }; const key = this._operationKey("record-dss04-accounting", operationInput); const prior = this.state.operationInputs[operation];
      if (prior) {
        if (prior.inputDigest !== key) return result("IDEMPOTENCY_CONFLICT");
        const existingAccounting = this.state.accounting[prior.ref];
        return result("REPLAYED", { accounting: clone(existingAccounting) });
      }
      const rawRows = Object.values(this.state.rawCompilerOutputs).filter((raw) => raw.request_id === request.request_id); const bundles = Object.values(this.state.outputBundles).filter((bundle) => bundle.request_id === request.request_id); const admittedBytes = rawRows.filter((raw) => bundles.some((bundle) => bundle.rawRef === raw.rawRef && bundle.state !== "REJECTED")).reduce((sum, raw) => sum + (raw.byte_length || 0), 0); const pageBytes = pages.reduce((sum, page) => sum + (page.byte_length || 0), 0); const pageTokens = pages.reduce((sum, page) => sum + (page.token_count || 0), 0); const evidenceBytes = this._accountingEvidenceBytes(pages); const reservations = Object.values(this.state.allocations).filter((allocation) => allocation.request_id === request.request_id).map((allocation) => ({ work_identity: allocation.work_identity, reservation_digest: allocation.reservation_digest, state: allocation.state })).sort((a, b) => a.work_identity.localeCompare(b.work_identity));
      const identity = { request_id: request.request_id, attempt_population_digest: this._refFor("AccountingAttemptPopulation", Object.values(this.state.observations).filter((candidate) => candidate.request_id === request.request_id).map((candidate) => candidate.observationRef).sort()), raw_bytes: rawRows.reduce((sum, raw) => sum + (raw.byte_length || 0), 0), admitted_bytes: admittedBytes, page_bytes: pageBytes, page_tokens: pageTokens, evidence_bytes: evidenceBytes, quarantine_bytes: rawRows.reduce((sum, raw) => sum + (raw.byte_length || 0), 0), reservation_digest: this._refFor("AccountingReservations", reservations), service_generation: generation.generationRef };
      const accounting = { ...identity, accountingRef: this._refFor("Dss04Accounting", identity), state: phase === "FINALIZE" ? "FINAL" : "RECORDED", requestRef: request.requestRef, observationRef: observation.observationRef, pageRefs: pages.map((page) => page.pageRef).sort(), recordedAt: this.clock() }; this._assertCarrierFields("d.dss04-accounting", accounting); this._save("accounting", request.request_id, accounting); this.state.operationInputs[operation] = { inputDigest: key, ref: request.request_id, operationInput }; this._recordTransition("record-dss04-accounting", "d.dss04-accounting", phase === "FINALIZE" ? "FINALIZE" : "RECORD", accounting, phase === "FINALIZE" ? "COMPLETE" : "ACCEPTED"); this._persist(); return result(phase === "FINALIZE" ? "COMPLETE" : "ACCEPTED", { accounting });
    } catch (error) { if (["DSS04_STATE_CORRUPT", "DSS04_FIELD_INVALID", "DSS04_DIGEST_INVALID"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  requestDss04Cancellation(input = {}) {
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR"); const request = this._requestForOperation(input); if (!request || request.service_generation !== generation.generationRef) return result("STALE_PREDECESSOR"); if (!this._cancellationAuthorized(input, request, generation)) return result("UNAUTHORIZED");
      const observationInput = input.observation || input.processObservation || {}; const observationRef = observationInput.observationRef || observationInput.observation_ref || input.observation_ref; const observation = Object.values(this.state.observations).find((candidate) => candidate.observationRef === observationRef || candidate.request_id === request.request_id) || null; const observationState = observation?.state || observationInput.state || "UNSEEN"; const operation = `request-dss04-cancellation:${request.request_id}`; const operationInput = { request: request.requestRef, generation: generation.generationRef, observation: observation?.observationRef || observationRef || null }; const key = this._operationKey("request-dss04-cancellation", operationInput); const prior = this.state.operationInputs[operation]; if (prior) return prior.inputDigest === key ? result("REPLAYED", { request: clone(this.state.compilationRequests[request.request_id]) }) : result("IDEMPOTENCY_CONFLICT");
      if (request.state !== "SUBMITTED" && request.state !== "CANCEL_REQUESTED") return result("CANCELLATION_LOST_RACE");
      if (observationState !== "UNSEEN") {
        if (request.state === "SUBMITTED" && observationState === "RUNNING") { const requested = { ...request, state: "CANCEL_REQUESTED", cancellationRequestedAt: this.clock(), cancellationObservationRef: observation?.observationRef || null }; this._save("compilationRequests", request.request_id, requested); this.state.operationInputs[operation] = { inputDigest: key, ref: request.request_id, operationInput }; this._recordTransition("request-dss04-cancellation", "d.compilation-request", "REQUEST_CANCEL", requested, "CANCELLATION_REQUESTED"); this._persist(); return result("CANCELLATION_REQUESTED", { request: requested }); }
        return result("CANCELLATION_LOST_RACE");
      }
      const cancelled = { ...request, state: "CANCELLED", cancellationRequestedAt: this.clock(), cancelledAt: this.clock(), cancellationObservationRef: observation?.observationRef || null }; this._save("compilationRequests", request.request_id, cancelled); this.state.operationInputs[operation] = { inputDigest: key, ref: request.request_id, operationInput }; this._recordTransition("request-dss04-cancellation", "d.compilation-request", "CANCEL", cancelled, "CANCELLED_PRESTART"); this._persist(); return result("CANCELLED_PRESTART", { request: cancelled });
    } catch (error) { if (error.code === "DSS04_STATE_CORRUPT") return result("STALE_PREDECESSOR"); throw error; }
  }

  adjudicateDss04Cancellation(input = {}) {
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR"); const request = this._requestForOperation(input); const observationInput = input.observation || input.processObservation || {}; const observationRef = observationInput.observationRef || observationInput.observation_ref || input.observation_ref; const observation = Object.values(this.state.observations).find((candidate) => candidate.observationRef === observationRef || candidate.request_id === request?.request_id); if (!request || !observation || observation.request_id !== request.request_id) return result("STALE_PREDECESSOR"); const operation = `adjudicate-dss04-cancellation:${request.request_id}`; const operationInput = { request: request.requestRef, observation: observation.observationRef }; const key = this._operationKey("adjudicate-dss04-cancellation", operationInput); const prior = this.state.operationInputs[operation]; if (prior) return prior.inputDigest === key ? result("REPLAYED", { request: clone(this.state.compilationRequests[request.request_id]) }) : result("IDEMPOTENCY_CONFLICT"); if (!["SUBMITTED", "CANCEL_REQUESTED"].includes(request.state)) return result("STALE_PREDECESSOR"); const complete = observation.state === "TERMINATED" && observation.exit_status === 0; const outcome = complete ? "COMPLETE" : "CANCELLATION_LOST_RACE"; const terminal = { ...request, state: "TERMINAL", terminalOutcome: outcome, terminalObservationRef: observation.observationRef, terminalizedAt: this.clock() }; this._save("compilationRequests", request.request_id, terminal); this.state.operationInputs[operation] = { inputDigest: key, ref: request.request_id, operationInput }; this._recordTransition("adjudicate-dss04-cancellation", "d.compilation-request", "TERMINALIZE", terminal, outcome); this._persist(); return result(outcome, { request: terminal });
    } catch (error) { if (error.code === "DSS04_STATE_CORRUPT") return result("STALE_PREDECESSOR"); throw error; }
  }

  releaseDss04Lease(input = {}) {
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR"); const raw = input.lease || input; const leaseRef = raw.lease_ref || raw.leaseRef || raw.lease_id || raw.leaseId; const lease = Object.values(this.state.leases).find((candidate) => candidate.leaseRef === leaseRef || candidate.leaseId === leaseRef); const allocation = lease && Object.values(this.state.allocations).find((candidate) => candidate.allocationRef === lease.allocationRef); const token = raw.fencing_token || raw.fencingToken; if (!lease || !allocation) return result("STALE_PREDECESSOR"); const operation = `release-dss04-lease:${leaseRef}`; const operationInput = { lease: lease.leaseRef, allocation: allocation.allocationRef, fencing_token: token || null, generation: generation.generationRef }; const key = this._operationKey("release-dss04-lease", operationInput); const prior = this.state.operationInputs[operation]; if (prior) return prior.inputDigest === key ? result("REPLAYED", { lease: clone(this.state.leases[allocation.work_identity]), allocation: clone(this.state.allocations[allocation.work_identity]) }) : result("IDEMPOTENCY_CONFLICT"); if (!token || token !== lease.fencing_token || lease.service_generation !== generation.generationRef || !["HELD", "EXPIRED"].includes(lease.state) || allocation.state !== "ALLOCATED") return result("STALE_PREDECESSOR"); const releasedLease = { ...lease, state: "RELEASED", releasedAt: this.clock() }; const releasedAllocation = { ...allocation, state: "RELEASED", releasedAt: this.clock() }; this._save("leases", allocation.work_identity, releasedLease); this._save("allocations", allocation.work_identity, releasedAllocation); this.state.operationInputs[operation] = { inputDigest: key, ref: allocation.work_identity, operationInput }; this._recordTransition("release-dss04-lease", "d.dss04-lease", "RELEASE", releasedLease, "ACCEPTED"); this._recordTransition("release-dss04-lease", "d.dss04-allocation", "RELEASE", releasedAllocation, "ACCEPTED"); this._persist(); return result("ACCEPTED", { lease: releasedLease, allocation: releasedAllocation });
    } catch (error) { if (["DSS04_STATE_CORRUPT", "DSS04_FIELD_INVALID", "DSS04_DIGEST_INVALID"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }

  _validateRecoveryEventChain() {
    if (!Array.isArray(this.state.events)) return "event-ledger-not-array";
    for (let index = 0; index < this.state.events.length; index += 1) {
      const event = this.state.events[index];
      if (!event || typeof event !== "object" || event.sequence !== index + 1) return "event-sequence";
      const unsigned = Object.fromEntries(Object.entries(event).filter(([key]) => key !== "eventDigest"));
      if (event.eventDigest !== digestObject("DirectSemanticService.Dss04.Event.v1", unsigned)) return "event-digest";
      if ((event.priorDigest || null) !== (index ? this.state.events[index - 1].eventDigest : null)) return "event-predecessor";
      if (event.operationId && event.carrierId && event.event) {
        let row;
        try { row = this._transitionRecord(event.operationId, event.carrierId, event.event); } catch (_) { return "event-transition-unknown"; }
        if (event.transitionId !== row.transitionId || event.owner !== row.owner || event.priorStateSource !== row.priorStateSource || !row.outcomeCases.includes(event.outcome)) return "event-transition-mismatch";
      }
    }
    return null;
  }

  _validateRecoveryRows() {
    const generation = this.state.generations.current;
    const problems = [];
    if (!generation || generation.generationRef !== SERVICE_GENERATION || canonicalJson(generation.identity || {}) !== canonicalJson(GENERATION_IDENTITY)) problems.push({ kind: "generation", reason: "identity" });
    const compilerPin = this.state.pins?.compilerBuild;
    const registryPin = this.state.pins?.projectRegistryRoot;
    if (!compilerPin || compilerPin.state !== "PINNED" || compilerPin.digest !== COMPILER_BUILD_PIN_DIGEST || compilerPin.owner !== ROOT_OWNER || compilerPin.root !== ROOT_AUTHORITY) problems.push({ kind: "trust", reason: "compiler-pin" });
    if (!registryPin || registryPin.state !== "PINNED" || registryPin.digest !== PROJECT_ROOT_DIGEST || registryPin.owner !== ROOT_OWNER || registryPin.root !== ROOT_AUTHORITY) problems.push({ kind: "trust", reason: "registry-root-pin" });
    const expectedCollections = new Set(RECOVERY_REQUIRED_COLLECTIONS.concat(["schema", "operationInputs"]));
    for (const key of Object.keys(this.state)) if (!expectedCollections.has(key)) problems.push({ kind: "unknown", reason: key });
    for (const name of RECOVERY_REQUIRED_COLLECTIONS) {
      const collection = this.state[name];
      if (name === "events") { if (!Array.isArray(collection)) problems.push({ kind: "corrupt", reason: `${name}-shape` }); continue; }
      if (!collection || typeof collection !== "object" || Array.isArray(collection)) { problems.push({ kind: "corrupt", reason: `${name}-shape` }); continue; }
      if (["derivedHeads", "recoveryDispositions"].includes(name)) continue;
      for (const [ref, value] of Object.entries(collection)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) { problems.push({ kind: "corrupt", reason: `${name}.${ref}-row` }); continue; }
        if (name !== "generations" && name !== "pins" && name !== "recoveryDispositions" && name !== "derivedHeads" && value.service_generation && value.service_generation !== SERVICE_GENERATION) problems.push({ kind: "corrupt", reason: `${name}.${ref}-generation` });
      }
    }
    for (const [ref, registry] of Object.entries(this.state.registryRevisions)) if (registry.revisionRef !== ref || registry.state !== "ADMITTED") problems.push({ kind: "corrupt", reason: `registry.${ref}` });
    for (const [ref, receipt] of Object.entries(this.state.snapshotReceipts)) {
      if (receipt.receiptRef !== ref || receipt.state !== "ADMITTED" || !Array.isArray(receipt.artifactRefs)) problems.push({ kind: "corrupt", reason: `snapshot.${ref}` });
      else for (const artifactRef of receipt.artifactRefs) if (!this.state.snapshotArtifacts[artifactRef] || this.state.snapshotArtifacts[artifactRef].snapshotRootDigest !== receipt.snapshot_root_digest) problems.push({ kind: "gap", reason: `snapshot-artifact.${artifactRef}` });
    }
    for (const [ref, runtime] of Object.entries(this.state.evidenceRuntimes)) if (runtime.runtimeRef !== ref || !this.state.registryRevisions[runtime.project_registry_revision_digest] || !this.state.snapshotReceipts[runtime.target_snapshot_receipt_digest]) problems.push({ kind: "gap", reason: `runtime.${ref}` });
    for (const [requestId, request] of Object.entries(this.state.compilationRequests)) {
      if (request.request_id !== requestId || request.requestRef === undefined || request.service_generation !== SERVICE_GENERATION) problems.push({ kind: "corrupt", reason: `request.${requestId}` });
      if (!Object.values(this.state.sealedResults).some((sealed) => sealed.state === "ACCEPTED" && sealed.envelope?.result_seal_digest === request.dss03_result_seal_digest) || !this.state.registryRevisions[request.project_registry_revision_digest] || !this.state.snapshotReceipts[request.target_snapshot_receipt_digest] || !this.state.evidenceRuntimes[request.project_evidence_runtime_revision_digest]) problems.push({ kind: "gap", reason: `request-predecessors.${requestId}` });
      const binding = this.state.idempotencyBindings[requestId];
      if (!binding || binding.request_id !== requestId || binding.requestRef !== request.requestRef || binding.semantic_input_digest !== request.semanticInputDigest) problems.push({ kind: "gap", reason: `idempotency.${requestId}` });
    }
    for (const [requestId, binding] of Object.entries(this.state.idempotencyBindings)) if (!this.state.compilationRequests[requestId] || binding.request_id !== requestId) problems.push({ kind: "corrupt", reason: `orphan-idempotency.${requestId}` });
    for (const [operation, binding] of Object.entries(this.state.operationInputs || {})) {
      if (!operation.startsWith("instantiate-materialization-plan:") && !operation.startsWith("materialize-closed-page:") && !operation.startsWith("evaluate-page-completeness:") && !operation.startsWith("evaluate-page-sufficiency:") && !operation.startsWith("issue-known-insufficiency-remand:") && !operation.startsWith("submit-page-fault-candidate:") && !operation.startsWith("submit-novel-edge-candidate:") && !operation.startsWith("validate-candidate-independently:") && !operation.startsWith("record-dss04-accounting:") && !operation.startsWith("request-dss04-cancellation:") && !operation.startsWith("adjudicate-dss04-cancellation:") && !operation.startsWith("release-dss04-lease:") && !operation.startsWith("seal-materialization-batch:") && operation !== "issue-validator-revision" && operation !== "issue-validator-revision:revoke") continue;
      const collection = operation.startsWith("instantiate-materialization-plan:") ? this.state.materializationPlans : operation.startsWith("materialize-closed-page:") ? this.state.closedEvidencePages : operation.startsWith("evaluate-page-completeness:") ? this.state.pageCompletenessReceipts : operation.startsWith("evaluate-page-sufficiency:") ? this.state.pageSufficiencyReceipts : operation.startsWith("issue-known-insufficiency-remand:") ? this.state.knownInsufficiencyRemands : operation.startsWith("submit-page-fault-candidate:") ? this.state.pageFaultCandidates : operation.startsWith("submit-novel-edge-candidate:") ? this.state.novelEdgeCandidates : operation.startsWith("validate-candidate-independently:") ? this.state.candidateValidationRecords : operation.startsWith("record-dss04-accounting:") ? this.state.accounting : operation.startsWith("request-dss04-cancellation:") || operation.startsWith("adjudicate-dss04-cancellation:") ? this.state.compilationRequests : operation.startsWith("release-dss04-lease:") ? this.state.leases : operation.startsWith("seal-materialization-batch:") ? this.state.materializationBatchSeals : this.state.validatorRevisions;
      if (!binding || typeof binding.inputDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(binding.inputDigest) || !binding.ref || !collection[binding.ref]) problems.push({ kind: "gap", reason: `materialization-idempotency.${operation}` });
    }
    for (const [planRef, plan] of Object.entries(this.state.materializationPlans)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `instantiate-materialization-plan:${planRef === plan.planRef ? this.state.routeSets[plan.request_id]?.routeSetRef : ""}` && binding?.ref === planRef)) problems.push({ kind: "gap", reason: `materialization-plan-idempotency.${planRef}` });
    for (const [pageIdentity, page] of Object.entries(this.state.closedEvidencePages)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `materialize-closed-page:${pageIdentity}` && binding?.ref === pageIdentity)) problems.push({ kind: "gap", reason: `closed-page-idempotency.${pageIdentity}` });
    for (const [pageIdentity, receipt] of Object.entries(this.state.pageCompletenessReceipts)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `evaluate-page-completeness:${pageIdentity}` && binding?.ref === pageIdentity)) problems.push({ kind: "gap", reason: `page-completeness-idempotency.${pageIdentity}` });
    for (const [pageIdentity, receipt] of Object.entries(this.state.pageSufficiencyReceipts)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `evaluate-page-sufficiency:${pageIdentity}` && binding?.ref === pageIdentity)) problems.push({ kind: "gap", reason: `page-sufficiency-idempotency.${pageIdentity}` });
    for (const [pageIdentity, remand] of Object.entries(this.state.knownInsufficiencyRemands)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `issue-known-insufficiency-remand:${pageIdentity}` && binding?.ref === pageIdentity)) problems.push({ kind: "gap", reason: `known-insufficiency-remand-idempotency.${pageIdentity}` });
    for (const [candidateRef, candidate] of Object.entries(this.state.pageFaultCandidates)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation.startsWith("submit-page-fault-candidate:") && binding?.ref === candidateRef)) problems.push({ kind: "gap", reason: `page-fault-candidate-idempotency.${candidateRef}` });
    for (const [candidateRef, candidate] of Object.entries(this.state.novelEdgeCandidates)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation.startsWith("submit-novel-edge-candidate:") && binding?.ref === candidateRef)) problems.push({ kind: "gap", reason: `novel-edge-candidate-idempotency.${candidateRef}` });
    for (const [validationRef, validation] of Object.entries(this.state.candidateValidationRecords)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `validate-candidate-independently:${validation.candidate_digest}` && binding?.ref === validationRef)) problems.push({ kind: "gap", reason: `candidate-validation-idempotency.${validationRef}` });
    for (const [revisionRef, revision] of Object.entries(this.state.validatorRevisions)) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => (operation === "issue-validator-revision" || operation === "issue-validator-revision:revoke") && binding?.ref === revisionRef)) problems.push({ kind: "gap", reason: `validator-revision-idempotency.${revisionRef}` });
    for (const [sealRef, seal] of Object.entries(this.state.materializationBatchSeals || {})) if (!Object.entries(this.state.operationInputs || {}).some(([operation, binding]) => operation === `seal-materialization-batch:${seal.planRef}` && binding?.ref === sealRef)) problems.push({ kind: "gap", reason: `seal-idempotency.${sealRef}` });
    for (const [allocationId, allocation] of Object.entries(this.state.allocations)) {
      if (!allocation.work_identity || allocation.allocationRef === undefined || !this.state.compilationRequests[allocation.request_id]) problems.push({ kind: "gap", reason: `allocation.${allocationId}` });
      if (allocation.state === "ALLOCATED" && allocation.work_kind === "COMPILATION" && !Object.values(this.state.observations).some((observation) => observation.request_id === allocation.request_id)) problems.push({ kind: "gap", reason: `unstarted-allocation.${allocationId}` });
    }
    for (const [allocationId, lease] of Object.entries(this.state.leases)) {
      const allocation = Object.values(this.state.allocations).find((candidate) => candidate.allocationRef === lease.allocationRef);
      if (!allocation || lease.service_generation !== SERVICE_GENERATION || !lease.leaseRef || !["HELD", "EXPIRED", "RELEASED"].includes(lease.state)) problems.push({ kind: "corrupt", reason: `lease.${allocationId}` });
    }
    for (const [requestId, observation] of Object.entries(this.state.observations)) {
      if (observation.request_id !== requestId || !this.state.compilationRequests[requestId] || !["RUNNING", "TERMINATED", "INTERRUPTED", "ISOLATION_FAILED"].includes(observation.state)) problems.push({ kind: "corrupt", reason: `observation.${requestId}` });
      if (observation.state === "RUNNING") problems.push({ kind: "gap", reason: `running.${requestId}` });
      if (observation.state === "TERMINATED" && !this.state.rawCompilerOutputs[requestId]) problems.push({ kind: "gap", reason: `raw-capture-pending.${requestId}` });
    }
    for (const [requestId, raw] of Object.entries(this.state.rawCompilerOutputs)) {
      if (raw.request_id !== requestId || !this.state.observations[requestId] || !["CAPTURED", "QUARANTINED", "CORRUPT"].includes(raw.state)) problems.push({ kind: "corrupt", reason: `raw.${requestId}` });
      if (raw.state === "QUARANTINED") {
        const quarantinePath = typeof raw.quarantinePath === "string" ? path.resolve(this.store.root, raw.quarantinePath) : null;
        if (!quarantinePath || !quarantinePath.startsWith(`${this.store.root}${path.sep}`) || !fs.existsSync(quarantinePath)) problems.push({ kind: "corrupt", reason: `raw-custody-missing.${requestId}` });
        else {
          const bytes = fs.readFileSync(quarantinePath);
          const seal = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
          if (bytes.length !== raw.byte_length || seal !== raw.content_seal) problems.push({ kind: "corrupt", reason: `raw-custody-seal.${requestId}` });
          else if (!this.state.outputBundles[requestId] || !["ADMITTED", "REMANDED", "REJECTED"].includes(this.state.outputBundles[requestId].state)) problems.push({ kind: "gap", reason: `admission-pending.${requestId}` });
        }
      }
    }
    for (const [requestId, bundle] of Object.entries(this.state.outputBundles)) {
      if (bundle.request_id !== requestId || !this.state.routeSets[requestId] || !["ADMITTED", "REMANDED", "REJECTED", "UNPARSED"].includes(bundle.state)) problems.push({ kind: "gap", reason: `bundle.${requestId}` });
      if (bundle.state === "UNPARSED") problems.push({ kind: "gap", reason: `unparsed-bundle.${requestId}` });
      if (["ADMITTED", "REMANDED"].includes(bundle.state)) {
        const request = this.state.compilationRequests[requestId]; const raw = Object.values(this.state.rawCompilerOutputs).find((row) => row.request_id === requestId); const routeSet = this.state.routeSets[requestId];
        let recomputed = null; let recomputeError = null;
        try { const file = raw?.quarantinePath && path.resolve(this.store.root, raw.quarantinePath); const receipt = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; const modulePath = path.resolve(__dirname, "../../../..", PINNED_COMPILER_MODULE_ASSET_PATH); const registry = request && this.state.registryRevisions[request.project_registry_revision_digest]; if (receipt && request && registry && fs.existsSync(modulePath)) recomputed = normalizeCompilerReceipt(receipt, { ...JSON.parse(fs.readFileSync(modulePath, "utf8")) }, { ...request, project_id: registry.project_id }, SERVICE_GENERATION); else recomputeError = !raw ? "raw-missing" : !file ? "quarantine-path-missing" : !receipt ? "receipt-missing" : !request ? "request-missing" : !registry ? "registry-missing" : !fs.existsSync(modulePath) ? "module-missing" : "recompute-skipped"; } catch (error) { recomputed = null; recomputeError = error.code || error.message; }
        const route = routeSet && { ...routeSet.normalizationReceipt, status: routeSet.status || routeSet.state, reason: routeSet.reason, sourceReceiptDigest: routeSet.sourceReceiptDigest, authorityEffect: routeSet.authorityEffect, normalizationReceipt: routeSet.normalizationReceipt, routes: routeSet.routes, contacts: routeSet.contacts, input_facts: routeSet.input_facts, evidence_demands: routeSet.evidence_demands, exclusions: routeSet.exclusions, static_remands: routeSet.static_remands, staticRemands: routeSet.static_remands }; const equal = recomputed && recomputed.status === bundle.state && bundle.reason === recomputed.reason && bundle.sourceReceiptDigest === recomputed.sourceReceiptDigest && bundle.authorityEffect === recomputed.authorityEffect && route && route.status === recomputed.status && route.reason === recomputed.reason && route.sourceReceiptDigest === recomputed.sourceReceiptDigest && route.authorityEffect === recomputed.authorityEffect && canonicalJson(bundle.normalizationReceipt) === canonicalJson(recomputed.normalizationReceipt) && canonicalJson(bundle.obligations || []) === canonicalJson(recomputed.obligations) && canonicalJson(bundle.input_facts || []) === canonicalJson(recomputed.inputFacts) && canonicalJson(bundle.evidence_demands || []) === canonicalJson(recomputed.evidenceDemands) && canonicalJson(bundle.exclusions || []) === canonicalJson(recomputed.exclusions) && canonicalJson(bundle.static_remands || []) === canonicalJson(recomputed.staticRemands) && canonicalJson(route.normalizationReceipt) === canonicalJson(recomputed.normalizationReceipt) && canonicalJson(route.routes || []) === canonicalJson(recomputed.routes) && canonicalJson(route.contacts || []) === canonicalJson(recomputed.contacts) && canonicalJson(route.input_facts || []) === canonicalJson(recomputed.inputFacts) && canonicalJson(route.evidence_demands || []) === canonicalJson(recomputed.evidenceDemands) && canonicalJson(route.exclusions || []) === canonicalJson(recomputed.exclusions) && canonicalJson(route.staticRemands || []) === canonicalJson(recomputed.staticRemands);
        if (!equal) problems.push({ kind: "gap", reason: `normalization-recomputation.${requestId}` });
      }
    }
    for (const [requestId, routeSet] of Object.entries(this.state.routeSets)) {
      if (routeSet.request_id !== requestId || !this.state.outputBundles[requestId]) problems.push({ kind: "corrupt", reason: `route-set.${requestId}` });
      const bundle = this.state.outputBundles[requestId]; if (routeSet.state === "ADMITTED" && (!Array.isArray(routeSet.input_facts) || !Array.isArray(routeSet.evidence_demands) || routeSet.input_facts_digest !== normalizationDomain("Dss04.InputFactPopulation.v1", routeSet.input_facts) || routeSet.evidence_demand_population_digest !== normalizationDomain("Dss04.EvidenceDemandPopulation.v1", routeSet.evidence_demands) || !bundle || !Array.isArray(bundle.input_facts) || !Array.isArray(bundle.evidence_demands) || canonicalJson(bundle.input_facts) !== canonicalJson(routeSet.input_facts) || canonicalJson(bundle.evidence_demands) !== canonicalJson(routeSet.evidence_demands))) problems.push({ kind: "gap", reason: `route-set-materialization-inputs.${requestId}` });
    }
    for (const [planRef, plan] of Object.entries(this.state.materializationPlans)) {
      if (plan.planRef !== planRef || plan.service_generation !== SERVICE_GENERATION || !this.state.routeSets[plan.request_id] || !["INSTANTIATED", "REMANDED", "REJECTED"].includes(plan.state)) problems.push({ kind: "corrupt", reason: `materialization-plan.${planRef}` });
      if (["INSTANTIATED", "REMANDED", "REJECTED"].includes(plan.state)) {
        const routeSet = this.state.routeSets[plan.request_id]; const routes = Array.isArray(routeSet?.routes) ? routeSet.routes : []; const refs = routeSet && this._materializationReferences(routeSet); const pages = Array.isArray(plan.pages) ? plan.pages : [];
        let expectedPartition = null; let expectedPageSeeds = [];
        try {
          if (!refs || routeSet.service_generation !== SERVICE_GENERATION) throw Object.assign(new Error("materialization-predecessor"), { code: "gap" });
          const unique = routes.every((route) => route && typeof route.route_id === "string" && route.route_id && typeof (route.occurrence_id || route.route_id) === "string") && new Set(routes.map((route) => route.route_id)).size === routes.length && new Set(routes.map((route) => route.occurrence_id || route.route_id)).size === routes.length;
          if (!unique || routes.some((route) => !this._materializationRouteIsCurrent(route, refs))) throw Object.assign(new Error("materialization-route"), { code: "corrupt" });
          const assignments = refs.evidenceDemands.map((demand) => routes.filter((route) => (Array.isArray(route.evidence_demand_ids) && route.evidence_demand_ids.includes(demand.evidence_demand_id)) || demand.route_id === route.route_id || demand.occurrence_id === (route.occurrence_id || route.route_id) || demand.route_occurrence_id === (route.occurrence_id || route.route_id)).length);
          const populationMismatch = assignments.some((count) => count !== 1);
          if (!populationMismatch && routeSet.state === "ADMITTED") {
            const cacheKey = this._materializationSeedCacheKey(routeSet, refs, plan.materialization_policy_digest);
            const cached = MATERIALIZATION_SEED_CACHE.get(cacheKey);
            if (cached) expectedPageSeeds = cached;
            else {
              for (const route of routes) {
                const page = this._materializationPageSeed(route, refs, plan.materialization_policy_digest);
                expectedPageSeeds.push(page);
                if (page.canonicalContentLength > PAGE_BYTE_BUDGET || page.evidenceByteLength > EVIDENCE_BYTE_BUDGET) break;
              }
              MATERIALIZATION_SEED_CACHE.set(cacheKey, expectedPageSeeds);
            }
          }
          const overBudget = expectedPageSeeds.some((page) => page.canonicalContentLength > PAGE_BYTE_BUDGET || page.evidenceByteLength > EVIDENCE_BYTE_BUDGET);
          const reason = populationMismatch ? "POPULATION_MISMATCH" : overBudget ? "OVER_BUDGET" : routeSet.state === "REMANDED" ? "UPSTREAM_REMANDED" : null;
          const expectedPages = reason ? [] : expectedPageSeeds;
          expectedPartition = reason ? routes.map((route) => ({ occurrence_id: route.occurrence_id || route.route_id, disposition: "REMAND", reason })) : expectedPageSeeds.map((page) => ({ occurrence_id: page.routePopulation[0].occurrence_id, disposition: "PAGE", page_identity: page.page_identity }));
          if (plan.state === "INSTANTIATED" && reason || plan.state === "REMANDED" && !["OVER_BUDGET", "UPSTREAM_REMANDED"].includes(reason) || plan.state === "REJECTED" && reason !== "POPULATION_MISMATCH") problems.push({ kind: "corrupt", reason: `materialization-plan-state.${planRef}` });
          if (canonicalJson(pages.map((page) => page.page_identity)) !== canonicalJson(expectedPages.map((page) => page.page_identity))) problems.push({ kind: "gap", reason: `materialization-plan-pages.${planRef}` });
        } catch (error) {
          problems.push({ kind: error.code === "corrupt" ? "corrupt" : "gap", reason: `materialization-plan-partition.${planRef}` });
        }
        if (!Array.isArray(plan.partition) || canonicalJson(plan.partition) !== canonicalJson(expectedPartition || []) || plan.route_to_page_partition_digest !== this._refFor("RouteToPagePartition", plan.partition)) problems.push({ kind: "corrupt", reason: `materialization-plan-partition.${planRef}` });
        if (["REMANDED", "REJECTED"].includes(plan.state) && pages.length !== 0) problems.push({ kind: "corrupt", reason: `materialization-plan-remanded-pages.${planRef}` });
      }
    }
    for (const [pageIdentity, page] of Object.entries(this.state.closedEvidencePages)) {
      if (page.page_identity !== pageIdentity || !/^sha256:[0-9a-f]{64}$/.test(pageIdentity) || page.service_generation !== SERVICE_GENERATION || !["MATERIALIZED", "REJECTED", "CANCELLED"].includes(page.state)) problems.push({ kind: "corrupt", reason: `closed-page.${pageIdentity}` });
      if (page.state === "MATERIALIZED") {
        const casPath = typeof page.casPath === "string" ? path.resolve(this.store.root, page.casPath) : null;
        if (!casPath || !casPath.startsWith(`${this.store.root}${path.sep}`) || !fs.existsSync(casPath)) problems.push({ kind: "gap", reason: `closed-page-cas-missing.${pageIdentity}` });
        else { const bytes = fs.readFileSync(casPath); const seal = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (seal !== page.content_seal || bytes.length !== page.byte_length) problems.push({ kind: "corrupt", reason: `closed-page-cas-mismatch.${pageIdentity}` }); }
      }
    }
    for (const [pageIdentity, receipt] of Object.entries(this.state.pageCompletenessReceipts)) {
      if (receipt.page_identity !== pageIdentity || !["COMPLETE", "INCOMPLETE", "REJECTED"].includes(receipt.state) || receipt.service_generation !== SERVICE_GENERATION || !this.state.closedEvidencePages[pageIdentity]) problems.push({ kind: "corrupt", reason: `page-completeness.${pageIdentity}` });
      const identity = receipt && Object.fromEntries(["page_identity", "required_route_population_digest", "materialized_route_population_digest", "remanded_route_population_digest", "required_evidence_population_digest", "evidence_reconciliation_digest", "reverse_map_digest", "service_generation"].map((field) => [field, receipt[field]]));
      if (receipt && receipt.receiptRef !== this._refFor("PageCompletenessReceipt", identity)) problems.push({ kind: "corrupt", reason: `page-completeness-identity.${pageIdentity}` });
    }
    for (const [pageIdentity, receipt] of Object.entries(this.state.pageSufficiencyReceipts)) {
      if (receipt.page_identity !== pageIdentity || !["SUFFICIENT", "KNOWN_INSUFFICIENT", "REJECTED"].includes(receipt.state) || receipt.service_generation !== SERVICE_GENERATION || !this.state.closedEvidencePages[pageIdentity]) problems.push({ kind: "corrupt", reason: `page-sufficiency.${pageIdentity}` });
      const identity = receipt && Object.fromEntries(["page_identity", "worker_task_contract_digest", "completeness_receipt_digest", "availability_state_digest", "policy_state_digest", "budget_state_digest", "standing", "service_generation"].map((field) => [field, receipt[field]]));
      if (receipt && receipt.receiptRef !== this._refFor("PageSufficiencyReceipt", identity)) problems.push({ kind: "corrupt", reason: `page-sufficiency-identity.${pageIdentity}` });
    }
    for (const [pageIdentity, remand] of Object.entries(this.state.knownInsufficiencyRemands)) {
      if (remand.page_identity !== pageIdentity || remand.state !== "ISSUED" || remand.service_generation !== SERVICE_GENERATION || !this.state.pageSufficiencyReceipts[pageIdentity] || this.state.pageSufficiencyReceipts[pageIdentity].state !== "KNOWN_INSUFFICIENT") problems.push({ kind: !this.state.pageSufficiencyReceipts[pageIdentity] ? "gap" : "corrupt", reason: `known-insufficiency-remand.${pageIdentity}` });
      const identity = remand && Object.fromEntries(["page_identity", "failed_demand_population_digest", "failed_policy_population_digest", "route_occurrence_population_digest", "evidence_state_digest", "remand_code", "service_generation"].map((field) => [field, remand[field]]));
      if (remand && remand.remandRef !== this._refFor("KnownInsufficiencyRemand", identity)) problems.push({ kind: "corrupt", reason: `known-insufficiency-remand-identity.${pageIdentity}` });
    }
    const candidateCollections = [["pageFaultCandidates", "PAGE_FAULT", "e.page-fault-candidate"], ["novelEdgeCandidates", "NOVEL_EDGE", "e.novel-edge-candidate"]];
    for (const [collectionName, kind, carrierId] of candidateCollections) {
      for (const [candidateRef, candidate] of Object.entries(this.state[collectionName] || {})) {
        let valid = true;
        try { this._assertCarrierFields(carrierId, candidate); } catch (_) { valid = false; }
        if (candidate.candidateRef !== candidateRef || candidate.candidate_kind !== kind || !["SUBMITTED", "REJECTED"].includes(candidate.state) || candidate.service_generation !== SERVICE_GENERATION || !valid || candidateRef !== this._candidateIdentity(kind, candidate)) problems.push({ kind: "corrupt", reason: `candidate-identity.${candidateRef}` });
        const observed = Date.parse(candidate.observed_at); const recorded = Date.parse(candidate.recorded_at); if (!Number.isFinite(observed) || !Number.isFinite(recorded) || observed > recorded) problems.push({ kind: "corrupt", reason: `candidate-time.${candidateRef}` });
        const operation = Object.entries(this.state.operationInputs || {}).find(([name, binding]) => name.startsWith(`${kind === "PAGE_FAULT" ? "submit-page-fault-candidate" : "submit-novel-edge-candidate"}:`) && binding?.ref === candidateRef);
        if (!operation) problems.push({ kind: "gap", reason: `candidate-idempotency.${candidateRef}` });
        if (candidate.state === "SUBMITTED") {
          const context = this._candidatePageContext(candidate);
          if (context.status !== "OK" || candidate.pageRef !== context.page.pageRef || candidate.planRef !== context.plan.planRef || candidate.runtimeRef !== context.refs.runtime.runtimeRef || candidate.snapshotRef !== context.refs.snapshot.receiptRef || candidate.route_identity !== context.routeIdentity) problems.push({ kind: "gap", reason: `candidate-predecessor.${candidateRef}` });
        }
      }
    }
    const validatorSpec = (() => { try { return this._validatorRevisionSpec(); } catch (_) { return null; } })();
    for (const [revisionRef, revision] of Object.entries(this.state.validatorRevisions || {})) {
      const values = validatorSpec?.values; const expectedRef = validatorSpec?.identityDigest;
      if (!values || revisionRef !== expectedRef || revision.revisionRef !== expectedRef || revision.service_generation !== SERVICE_GENERATION || canonicalJson(Object.fromEntries(Object.keys(values).map((key) => [key, revision[key]]))) !== canonicalJson(values) || !["ISSUED", "REVOKED"].includes(revision.state) || revision.owner !== "dss04-validator-revision-owner" || revision.root !== "dss04-validator-revision-root") problems.push({ kind: "corrupt", reason: `validator-revision.${revisionRef}` });
      const head = revision.lifecycleHead; const headPreimage = head && Object.fromEntries(["event", "predecessorStanding", "standing", "validatorRevision", "validatorRevisionIdentityDigest", "serviceGeneration", "owner"].map((key) => [key, head[key]])); const expectedHeadDigest = headPreimage && `sha256:${crypto.createHash("sha256").update(Buffer.from(`Dss04.ValidatorLifecycleHead.v1\n${stable(headPreimage)}`, "utf8")).digest("hex")}`; if (!head || head.validatorRevisionIdentityDigest !== revisionRef || head.serviceGeneration !== SERVICE_GENERATION || head.authenticated !== true || head.owner !== "dss04-validator-revision-owner" || !["ISSUE", "REVOKE"].includes(head.event) || head.standing !== (revision.state === "ISSUED" ? "ISSUED" : "REVOKED") || head.headDigest !== expectedHeadDigest) problems.push({ kind: "corrupt", reason: `validator-lifecycle.${revisionRef}` });
      if (revision.state === "ISSUED" && canonicalJson(head) !== canonicalJson(validatorSpec?.lifecycleHead)) problems.push({ kind: "corrupt", reason: `validator-issue-head.${revisionRef}` });
    }
    for (const [requestId, accounting] of Object.entries(this.state.accounting || {})) {
      const request = this.state.compilationRequests[requestId]; const observation = request && this.state.observations[requestId];
      if (!request || !observation || accounting.request_id !== requestId || !["RECORDED", "FINAL"].includes(accounting.state) || accounting.service_generation !== SERVICE_GENERATION) { problems.push({ kind: "gap", reason: `accounting.${requestId}` }); continue; }
      const pages = Object.values(this.state.closedEvidencePages).filter((page) => page.request_id === requestId && page.state === "MATERIALIZED"); const rawRows = Object.values(this.state.rawCompilerOutputs).filter((raw) => raw.request_id === requestId); const bundles = Object.values(this.state.outputBundles).filter((bundle) => bundle.request_id === requestId); const reservations = Object.values(this.state.allocations).filter((allocation) => allocation.request_id === requestId).map((allocation) => ({ work_identity: allocation.work_identity, reservation_digest: allocation.reservation_digest, state: allocation.state })).sort((a, b) => a.work_identity.localeCompare(b.work_identity)); const pageCasComplete = pages.every((page) => { const plan = this.state.materializationPlans[page.planRef]; const routeSet = plan && this.state.routeSets[plan.request_id]; const refs = routeSet && this._materializationReferences(routeSet); const descriptor = plan?.pages?.find((candidate) => candidate.page_identity === page.page_identity); const cas = descriptor && refs && this._pageCasDocument(page, this._materializationDescriptorContent(plan, descriptor, refs)); return cas?.status === "OK"; }); const identity = { request_id: requestId, attempt_population_digest: this._refFor("AccountingAttemptPopulation", Object.values(this.state.observations).filter((candidate) => candidate.request_id === requestId).map((candidate) => candidate.observationRef).sort()), raw_bytes: rawRows.reduce((sum, raw) => sum + (raw.byte_length || 0), 0), admitted_bytes: rawRows.filter((raw) => bundles.some((bundle) => bundle.rawRef === raw.rawRef && bundle.state !== "REJECTED")).reduce((sum, raw) => sum + (raw.byte_length || 0), 0), page_bytes: pages.reduce((sum, page) => sum + (page.byte_length || 0), 0), page_tokens: pages.reduce((sum, page) => sum + (page.token_count || 0), 0), evidence_bytes: this._accountingEvidenceBytes(pages), quarantine_bytes: rawRows.reduce((sum, raw) => sum + (raw.byte_length || 0), 0), reservation_digest: this._refFor("AccountingReservations", reservations), service_generation: SERVICE_GENERATION }; const expected = { ...identity, accountingRef: this._refFor("Dss04Accounting", identity) }; for (const field of Object.keys(expected)) if ((field !== "evidence_bytes" && field !== "accountingRef") || pageCasComplete) if (canonicalJson(accounting[field]) !== canonicalJson(expected[field])) problems.push({ kind: "trust", reason: `accounting-content.${requestId}` }); if (accounting.requestRef !== request.requestRef || accounting.observationRef !== observation.observationRef || canonicalJson(accounting.pageRefs || []) !== canonicalJson(pages.map((page) => page.pageRef).sort())) problems.push({ kind: "trust", reason: `accounting-head.${requestId}` }); const terminal = ["TERMINATED", "INTERRUPTED", "ISOLATION_FAILED"].includes(observation.state); const pageTerminal = this._accountingPageTerminal(pages); const expectedStanding = terminal && pageTerminal ? "FINAL" : "RECORDED"; if (accounting.state !== expectedStanding) { const recoverableCoverageGap = accounting.state === "FINAL" && terminal && pages.length > 0 && !pageTerminal; problems.push({ kind: accounting.state === "RECORDED" && expectedStanding === "FINAL" || recoverableCoverageGap ? "gap" : "trust", reason: accounting.state === "RECORDED" && expectedStanding === "FINAL" || recoverableCoverageGap ? `accounting-pending.${requestId}` : `accounting-standing.${requestId}` }); }
    }
    for (const [requestId, request] of Object.entries(this.state.compilationRequests || {})) {
      if (!["SUBMITTED", "CANCEL_REQUESTED", "CANCELLED", "TERMINAL", "COMPLETED"].includes(request.state)) { problems.push({ kind: request.state === undefined ? "gap" : "corrupt", reason: `cancellation-state.${requestId}` }); continue; }
      const observation = Object.values(this.state.observations).find((candidate) => candidate.request_id === requestId);
      const requestCancel = this.state.events.some((event) => event.operationId === "request-dss04-cancellation" && event.event === "REQUEST_CANCEL" && event.payload?.request_id === requestId && event.payload?.state === "CANCEL_REQUESTED");
      const cancel = this.state.events.some((event) => event.operationId === "request-dss04-cancellation" && event.event === "CANCEL" && event.payload?.request_id === requestId && event.payload?.state === "CANCELLED");
      const terminalize = this.state.events.some((event) => event.operationId === "adjudicate-dss04-cancellation" && event.event === "TERMINALIZE" && event.payload?.request_id === requestId && event.payload?.state === "TERMINAL");
      if (request.state === "CANCEL_REQUESTED" && (!requestCancel || !observation || observation.state !== "RUNNING" || request.cancellationObservationRef !== observation.observationRef)) problems.push({ kind: requestCancel ? "trust" : "gap", reason: `cancellation-request-head.${requestId}` });
      if (request.state === "CANCELLED" && (!cancel || observation && observation.state !== "UNSEEN")) problems.push({ kind: cancel ? "trust" : "gap", reason: `cancellation-cancel-head.${requestId}` });
      if (["TERMINAL", "COMPLETED"].includes(request.state) && (!terminalize || !observation || !["TERMINATED", "INTERRUPTED", "ISOLATION_FAILED"].includes(observation.state) || request.terminalObservationRef !== observation.observationRef)) problems.push({ kind: terminalize ? "trust" : "gap", reason: `cancellation-terminal-head.${requestId}` });
    }
    for (const [allocationId, lease] of Object.entries(this.state.leases || {})) {
      const allocation = Object.values(this.state.allocations).find((candidate) => candidate.allocationRef === lease.allocationRef);
      if (!allocation) { problems.push({ kind: "gap", reason: `lease-allocation.${allocationId}` }); continue; }
      const allocationIdentity = { service_generation: allocation.service_generation, request_id: allocation.request_id, work_kind: allocation.work_kind, work_identity: allocation.work_identity, reservation_digest: allocation.reservation_digest };
      const leaseIdentity = { service_generation: lease.service_generation, work_identity: lease.work_identity, lease_owner: lease.lease_owner, fencing_token: lease.fencing_token, expires_at: lease.expires_at };
      if (allocation.allocationRef !== this._refFor("Dss04Allocation", allocationIdentity) || lease.leaseRef !== this._refFor("Dss04Lease", leaseIdentity) || lease.leaseId !== lease.leaseRef || lease.allocationRef !== allocation.allocationRef || lease.work_identity !== allocation.work_identity || lease.requestId !== allocation.request_id || lease.service_generation !== SERVICE_GENERATION || allocation.service_generation !== SERVICE_GENERATION || !["HELD", "EXPIRED", "RELEASED"].includes(lease.state) || !["ALLOCATED", "RELEASED"].includes(allocation.state)) problems.push({ kind: "trust", reason: `lease-identity.${allocationId}` });
      if (lease.state === "RELEASED" && allocation.state !== "RELEASED") problems.push({ kind: "trust", reason: `lease-release-head.${allocationId}` });
      if (allocation.state === "RELEASED" && lease.state !== "RELEASED") problems.push({ kind: "trust", reason: `allocation-release-head.${allocationId}` });
      if (lease.state === "RELEASED" && !this.state.events.some((event) => event.operationId === "release-dss04-lease" && event.carrierId === "d.dss04-lease" && event.event === "RELEASE" && event.payload?.leaseRef === lease.leaseRef)) problems.push({ kind: "gap", reason: `lease-release-event.${allocationId}` });
    }
    for (const [validationRef, validation] of Object.entries(this.state.candidateValidationRecords || {})) {
      const candidate = this.state.pageFaultCandidates[validation.candidate_digest] || this.state.novelEdgeCandidates[validation.candidate_digest];
      const validator = this.state.validatorRevisions[validation.validator_revision] || Object.values(this.state.validatorRevisions).find((revision) => revision.validator_revision === validation.validator_revision);
      const identity = validation && Object.fromEntries(["candidate_digest", "validator_revision", "project_registry_revision_digest", "target_snapshot_receipt_digest", "project_evidence_runtime_revision_digest", "compiler_build_pin_digest", "classification", "evidence_digest", "service_generation"].map((field) => [field, validation[field]]));
      if (!candidate) problems.push({ kind: "gap", reason: `candidate-validation-candidate-missing.${validationRef}` });
      else if (!validator) problems.push({ kind: "gap", reason: `candidate-validation-validator-missing.${validationRef}` });
      else if (validation.validationRef !== validationRef || validationRef !== this._refFor("CandidateValidationRecord", identity) || candidate.state !== "SUBMITTED" || !["ISSUED", "REVOKED"].includes(validator.state) || validation.service_generation !== SERVICE_GENERATION || !["VALIDATED", "REFUTED", "STALE", "OUT_OF_SCOPE", "INCONCLUSIVE"].includes(validation.state)) problems.push({ kind: "corrupt", reason: `candidate-validation.${validationRef}` });
      const operation = Object.entries(this.state.operationInputs || {}).find(([name, binding]) => name === `validate-candidate-independently:${validation.candidate_digest}` && binding?.ref === validationRef);
      if (!operation) problems.push({ kind: "gap", reason: `candidate-validation-idempotency.${validationRef}` });
      if (candidate) {
        const context = this._candidatePageContext(candidate);
        if (context.status !== "OK" || validation.page_identity !== candidate.page_identity || validation.pageRef !== context.page.pageRef || validation.planRef !== context.plan.planRef || validation.runtimeRef !== context.refs.runtime.runtimeRef || validation.request_id !== context.refs.request.request_id) problems.push({ kind: "gap", reason: `candidate-validation-predecessor.${validationRef}` });
        else {
          let decision;
          try { decision = candidate.service_generation !== SERVICE_GENERATION ? { outcome: "STALE_GENERATION", state: "STALE" } : this._candidateEvidenceDecision(candidate, context, candidate.candidate_kind); } catch (_) { decision = null; }
          const expectedEvidenceDigest = decision && this._refFor("CandidateValidationEvidence", { candidate: candidate.candidateRef, independentEvidence: decision.independentEvidence || null, decision: decision.state, page: candidate.page_identity, generation: SERVICE_GENERATION });
          if (!decision || validation.state !== decision.state || validation.outcome !== decision.outcome || validation.evidence_digest !== expectedEvidenceDigest) problems.push({ kind: "trust", reason: `candidate-validation-content.${validationRef}` });
        }
      }
    }
    const compareRecoveryFields = (actual, expected, fields, reason) => { for (const field of fields) if (canonicalJson(actual?.[field]) !== canonicalJson(expected?.[field])) { problems.push({ kind: "gap", reason }); return false; } return true; };
    for (const [pageIdentity, page] of Object.entries(this.state.closedEvidencePages)) {
      if (page.state !== "MATERIALIZED") continue;
      const completeness = this.state.pageCompletenessReceipts[pageIdentity];
      if (!completeness) { problems.push({ kind: "gap", reason: `page-completeness-missing.${pageIdentity}` }); continue; }
      const evaluation = this._recoveryPageEvaluation(pageIdentity);
      if (evaluation.kind) { problems.push({ kind: evaluation.kind, reason: evaluation.reason }); continue; }
      const completenessFields = ["page_identity", "required_route_population_digest", "materialized_route_population_digest", "remanded_route_population_digest", "required_evidence_population_digest", "evidence_reconciliation_digest", "reverse_map_digest", "service_generation", "receiptRef", "state", "planRef", "pageRef", "request_id", "evidenceUnavailable"];
      compareRecoveryFields(completeness, evaluation.completeness, completenessFields, `page-completeness-content.${pageIdentity}`);
      if (evaluation.completeness.state !== "COMPLETE") continue;
      const sufficiency = this.state.pageSufficiencyReceipts[pageIdentity];
      if (!sufficiency) { problems.push({ kind: "gap", reason: `page-sufficiency-missing.${pageIdentity}` }); continue; }
      const sufficiencyFields = ["page_identity", "worker_task_contract_digest", "completeness_receipt_digest", "availability_state_digest", "policy_state_digest", "budget_state_digest", "standing", "service_generation", "receiptRef", "state", "planRef", "pageRef", "runtimeRef", "request_id", "failedDemandIds"];
      compareRecoveryFields(sufficiency, evaluation.sufficiency, sufficiencyFields, `page-sufficiency-content.${pageIdentity}`);
      if (evaluation.sufficiency.state !== "KNOWN_INSUFFICIENT") continue;
      const remand = this.state.knownInsufficiencyRemands[pageIdentity];
      if (!remand) { problems.push({ kind: "gap", reason: `known-insufficiency-remand-missing.${pageIdentity}` }); continue; }
      compareRecoveryFields(remand, evaluation.remand, ["page_identity", "failed_demand_population_digest", "failed_policy_population_digest", "route_occurrence_population_digest", "evidence_state_digest", "remand_code", "service_generation", "remandRef", "state", "sufficiencyRef", "completenessRef", "failedDemandIds", "noWorkerCompute"], `known-insufficiency-remand-content.${pageIdentity}`);
    }
    for (const [ref, seal] of Object.entries(this.state.materializationBatchSeals || {})) {
      if (seal.sealRef !== ref || !["PREPARED", "SEALED", "BLOCKED"].includes(seal.state) || seal.service_generation !== SERVICE_GENERATION) { problems.push({ kind: "corrupt", reason: `seal.${ref}` }); continue; }
      const context = this._batchSealContext(seal.planRef);
      if (!context || !context.identity) { problems.push({ kind: "gap", reason: `seal-population.${ref}` }); continue; }
      if (context.errors.length || !context.valid) { problems.push({ kind: "gap", reason: `seal-population.${ref}` }); continue; }
      if (seal.sealRef !== this._refFor("MaterializationBatchSeal", context.identity)) { problems.push({ kind: "corrupt", reason: `seal-identity.${ref}` }); continue; }
      const identityFields = ["materialization_plan_digest", "planned_page_population_digest", "terminal_coverage_digest", "page_event_heads_digest", "receipt_population_digest", "remand_population_digest", "candidate_validation_heads_digest", "accounting_digest", "content_seal", "service_generation"];
      if (identityFields.some((field) => canonicalJson(seal[field]) !== canonicalJson(context.identity[field]))) { problems.push({ kind: "corrupt", reason: `seal-content.${ref}` }); continue; }
      const sealPath = typeof seal.sealPath === "string" ? path.resolve(this.store.root, seal.sealPath) : null;
      if (!sealPath || !sealPath.startsWith(`${this.store.root}${path.sep}`) || !fs.existsSync(sealPath)) problems.push({ kind: "gap", reason: `seal-cas-missing.${ref}` });
      else { try { const bytes = fs.readFileSync(sealPath); const actual = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; const document = JSON.parse(bytes.toString("utf8")); if (actual !== seal.content_seal || canonicalJson(document) !== canonicalJson(context.contentDocument)) problems.push({ kind: "corrupt", reason: `seal-cas-mismatch.${ref}` }); } catch (_) { problems.push({ kind: "corrupt", reason: `seal-cas-mismatch.${ref}` }); } }
      if (seal.state === "BLOCKED") problems.push({ kind: "gap", reason: `seal-blocked.${ref}` });
    }
    return problems;
  }

  _rebuildRecoveryProjection() {
    const populationDigest = this._recoveryPopulationDigest();
    const headMap = {};
    for (const [name, carrierId] of RECOVERY_COLLECTIONS) {
      // Event history is bound separately and neither the reconstructed
      // projection nor the disposition may recursively contribute to the
      // source head map that they attest.
      if (["events", "derivedHeads", "recoveryDispositions"].includes(name)) continue;
      const values = name === "generations" ? Object.values(this.state.generations) : name === "pins" && carrierId === "d.compiler-build-pin" ? [this.state.pins.compilerBuild].filter(Boolean) : name === "pins" ? [this.state.pins.projectRegistryRoot].filter(Boolean) : Object.values(this.state[name] || {});
      headMap[carrierId] = values.length ? this._recoveryDigest("Head", values.map((value) => this._recoveryDigest("CanonicalRow", value)).sort()) : null;
    }
    const headMapDigest = this._recoveryDigest("HeadMap", headMap);
    this.state.derivedHeads = { population_digest: populationDigest, head_map_digest: headMapDigest, reducer_revision: "direct.dss04.recovery-projection.v1", service_generation: SERVICE_GENERATION, state: "CURRENT", rebuiltAt: this.clock() };
    return { populationDigest, headMapDigest };
  }

  recoverDss04Generation(input = {}) {
    const generation = this.state.generations?.current;
    if (this.authorityBroken) return result("BROKEN", { reason: "ROOT_BROKEN" });
    if (!generation) return result("BLOCKED", { reason: "DSS04_GENERATION_OR_POPULATION_MISSING" });
    const missingCollections = RECOVERY_REQUIRED_COLLECTIONS.filter((name) => !Object.prototype.hasOwnProperty.call(this.state, name));
    if (missingCollections.length) return result("BLOCKED", { reason: "DSS04_DURABLE_POPULATION_INCOMPLETE", missingCollections });
    const suppliedGeneration = input.generation || input.serviceGeneration;
    if (suppliedGeneration && (typeof suppliedGeneration === "string" ? suppliedGeneration : suppliedGeneration.generationRef || suppliedGeneration.service_generation) !== SERVICE_GENERATION) return result("STALE_PREDECESSOR");
    const eventChainError = this.stateVerificationError ? (this.stateVerificationError.code || "state-verification") : this._validateRecoveryEventChain();
    const sourceDigest = this._recoveryPopulationDigest();
    // Validate external custody (including referenced page CAS objects) before
    // replaying a prior disposition.  CAS is deliberately not part of the
    // SQLite population digest: a repaired object must therefore re-enter the
    // reducer instead of replaying a previously BLOCKED cut forever.
    const problems = this._validateRecoveryRows();
    const prior = Object.values(this.state.recoveryDispositions || {}).at(-1);
    const currentEventHead = this.state.events.at(-1)?.eventDigest || null;
    const currentDerivedHeadsDigest = this._recoveryDigest("DerivedHeads", this.state.derivedHeads);
    const priorStandingMatches = prior?.standing === "READY" ? generation.state === "READY" : prior?.standing === "BLOCKED" ? generation.state === "RECOVERING" : prior?.standing === "BROKEN" ? generation.state === "BROKEN" : false;
    if (!eventChainError && !problems.length && prior && prior.durable_population_digest === sourceDigest && prior.service_generation === SERVICE_GENERATION && priorStandingMatches && prior.standing === "READY" && prior.recovery_event_head === currentEventHead && prior.derived_heads_digest === currentDerivedHeadsDigest) return result("REPLAYED", { disposition: clone(prior), generation: clone(generation) });
    if (eventChainError) {
      // A broken chain cannot safely receive another event: preserving the
      // authenticated damaged history is preferable to laundering it with a
      // new recovery event.
      generation.state = "BROKEN";
      this.state.recoveryDispositions[`broken-${this.state.events.length}`] = { service_generation: SERVICE_GENERATION, durable_population_digest: sourceDigest, event_population_digest: this._recoveryDigest("EventPopulation", this.state.events.map((event) => event.eventDigest)), projection_digest: this._recoveryProjectionDigest(), idempotency_population_digest: this._recoveryDigest("IdempotencyPopulation", this.state.idempotencyBindings), route_page_partition_digest: this._recoveryDigest("RoutePagePartition", { routes: this.state.routeSets, pages: this.state.closedEvidencePages }), terminal_coverage_digest: this._recoveryDigest("TerminalCoverage", {}), lease_population_digest: this._recoveryDigest("LeasePopulation", this.state.leases), seal_population_digest: this._recoveryDigest("SealPopulation", this.state.materializationBatchSeals), standing: "BROKEN", reason: eventChainError, recordedAt: this.clock() };
      try { this._persist(); } catch (_) {}
      return result("BROKEN", { reason: eventChainError, generation: clone(generation) });
    }
    const trustBroken = problems.some((problem) => problem.kind === "trust" || problem.kind === "corrupt" || problem.kind === "unknown" || problem.kind === "generation");
    const blocked = problems.filter((problem) => problem.kind === "gap");
    const now = new Date(this.clock()).getTime();
    const expired = [];
    for (const [allocationId, lease] of Object.entries(this.state.leases)) if (lease.state === "HELD" && new Date(lease.expires_at).getTime() <= now) expired.push([allocationId, lease]);
    // Recovery is the only owner of lease expiry.  It is a durable state
    // change, never an inferred readiness signal.
    if (expired.length && !problems.length) {
      for (const [allocationId, lease] of expired) { lease.state = "EXPIRED"; lease.expiredAt = this.clock(); this._recordTransition("recover-dss04-generation", "d.dss04-lease", "EXPIRE", lease, "RECOVERY_EVENTS_APPENDED", { fromState: "HELD", toState: "EXPIRED" }); }
      this._persist();
      return result("RECOVERY_EVENTS_APPENDED", { generation: clone(this.state.generations.current), expiredLeases: expired.map(([allocationId]) => allocationId) });
    }
    if (!problems.length) {
      const prepared = Object.values(this.state.materializationBatchSeals || {}).filter((seal) => seal.state === "PREPARED");
      if (prepared.length) {
        for (const seal of prepared) {
          const context = this._batchSealContext(seal.planRef);
          if (!context || !context.valid || canonicalJson(Object.fromEntries(Object.keys(context.identity).map((key) => [key, seal[key]]))) !== canonicalJson(context.identity)) { problems.push({ kind: "gap", reason: `prepared-seal.${seal.sealRef}` }); continue; }
          seal.state = "SEALED"; seal.sealedAt = this.clock(); this._recordTransition("seal-materialization-batch", "d.materialization-batch-seal", "SEAL", seal, "COMPLETE", { fromState: "PREPARED", toState: "SEALED" });
        }
        if (!problems.length) { this._persist(); return result("RECOVERY_EVENTS_APPENDED", { generation: clone(this.state.generations.current), sealedBatches: prepared.map((seal) => seal.sealRef) }); }
      }
    }
    const priorGenerationState = generation.state;
    const dispositionKey = `${sourceDigest.slice(7, 23)}-${this.state.events.length + 1}`;
    const projection = this._rebuildRecoveryProjection();
    const standing = trustBroken ? "BROKEN" : blocked.length || problems.length ? "BLOCKED" : "READY";
    const disposition = { service_generation: SERVICE_GENERATION, durable_population_digest: sourceDigest, event_population_digest: this._recoveryDigest("EventPopulation", this.state.events.map((event) => event.eventDigest)), projection_digest: this._recoveryProjectionDigest(), idempotency_population_digest: this._recoveryDigest("IdempotencyPopulation", this.state.idempotencyBindings), route_page_partition_digest: this._recoveryDigest("RoutePagePartition", { routes: this.state.routeSets, plans: this.state.materializationPlans, pages: this.state.closedEvidencePages }), terminal_coverage_digest: this._recoveryDigest("TerminalCoverage", { completeness: this.state.pageCompletenessReceipts, sufficiency: this.state.pageSufficiencyReceipts, seals: this.state.materializationBatchSeals }), lease_population_digest: this._recoveryDigest("LeasePopulation", this.state.leases), seal_population_digest: this._recoveryDigest("SealPopulation", this.state.materializationBatchSeals), standing, classification: problems.concat(expired.map(([allocationId]) => ({ kind: "lease", reason: "expired", allocationId }))), projectionHead: projection.headMapDigest, recordedAt: this.clock() };
    this.state.generations.current.state = "RECOVERING";
    if (this.state.events.length && ["OPENING", "READY"].includes(priorGenerationState)) this._recordTransition("recover-dss04-generation", "d.dss04-service-generation", "BEGIN_RECOVERY", generation, standing, { fromState: priorGenerationState, toState: "RECOVERING" });
    this._assertCarrierFields("d.dss04-recovery-disposition", disposition);
    this.state.recoveryDispositions[dispositionKey] = disposition;
    this._recordTransition("recover-dss04-generation", "d.dss04-recovery-disposition", "CLASSIFY", disposition, standing, { fromState: "ABSENT", toState: "CLASSIFIED" });
    if (standing === "READY") {
      disposition.state = "READY";
      this._recordTransition("recover-dss04-generation", "d.dss04-recovery-disposition", "READY", disposition, "READY", { fromState: "CLASSIFIED", toState: "READY" });
      this.state.generations.current.state = "READY";
      this._recordTransition("recover-dss04-generation", "d.dss04-service-generation", "READY", this.state.generations.current, "READY", { fromState: "RECOVERING", toState: "READY" });
    } else if (standing === "BLOCKED") {
      disposition.state = "BLOCKED";
      this._recordTransition("recover-dss04-generation", "d.dss04-recovery-disposition", "BLOCK", disposition, "BLOCKED", { fromState: "CLASSIFIED", toState: "BLOCKED" });
    } else {
      disposition.state = "BROKEN";
      this.state.generations.current.state = "BROKEN";
      if (this.state.pins.compilerBuild?.state === "PINNED") { this.state.pins.compilerBuild.state = "BROKEN"; this._recordTransition("recover-dss04-generation", "d.compiler-build-pin", "BREAK", this.state.pins.compilerBuild, "BROKEN", { fromState: "PINNED", toState: "BROKEN" }); }
      if (this.state.pins.projectRegistryRoot?.state === "PINNED") { this.state.pins.projectRegistryRoot.state = "BROKEN"; this._recordTransition("recover-dss04-generation", "d.project-registry-root-pin", "BREAK", this.state.pins.projectRegistryRoot, "BROKEN", { fromState: "PINNED", toState: "BROKEN" }); }
      this._recordTransition("recover-dss04-generation", "d.dss04-recovery-disposition", "BREAK", disposition, "BROKEN", { fromState: "CLASSIFIED", toState: "BROKEN" });
      this._recordTransition("recover-dss04-generation", "d.dss04-service-generation", "BREAK", this.state.generations.current, "BROKEN", { fromState: "RECOVERING", toState: "BROKEN" });
    }
    // Rebuild projections after the lifecycle transitions so the persisted
    // projection digest describes the final reconciled cut.  Event digesting
    // remains the pre-operation immutable history, avoiding a self-reference
    // through the disposition payload and its CLASSIFY event.
    const finalProjection = this._rebuildRecoveryProjection();
    disposition.projection_digest = this._recoveryProjectionDigest();
    disposition.projectionHead = finalProjection.headMapDigest;
    disposition.recovery_event_head = this.state.events.at(-1)?.eventDigest || null;
    disposition.recovery_event_sequence = this.state.events.length;
    disposition.derived_heads_digest = this._recoveryDigest("DerivedHeads", this.state.derivedHeads);
    this._persist();
    if (standing === "READY") return result(expired.length ? "RECOVERY_EVENTS_APPENDED" : "READY", { disposition: clone(disposition), generation: clone(this.state.generations.current), classifications: disposition.classification });
    return result(standing, { disposition: clone(disposition), generation: clone(this.state.generations.current), classifications: disposition.classification });
  }
    installCompilerBuildPin(input = {}) {
    try { this._authority(input); const pin = clone(input.pin || input); const protectedPin = this._protected("compiler"); noExtras(pin, [...PIN_FIELDS, "pinDigest", "installationCommitmentDigest", "installation_commitment_digest"], "compilerBuildPin"); exactFields(pin, PIN_FIELDS, "compilerBuildPin"); for (const field of PIN_FIELDS) if (field.endsWith("_digest")) safeDigest(pin[field], `compilerBuildPin.${field}`); if (COMPILER_BUILD_PIN_DIGEST !== protectedPin.digest || (input.pinDigest || pin.pinDigest) !== COMPILER_BUILD_PIN_DIGEST || canonicalJson(Object.fromEntries(PIN_FIELDS.map((field) => [field, pin[field]]))) !== canonicalJson(Object.fromEntries(PIN_FIELDS.map((field) => [field, protectedPin.value[field]]))) || PIN_FIELDS.some((field) => pin[field] !== PINNED_COMPILER_COMMITMENTS[field])) fail("DSS04_PIN_MISMATCH"); const commitment = input.installationCommitmentDigest || pin.installationCommitmentDigest || pin.installation_commitment_digest; if (commitment !== COMPILER_BUILD_PIN_DIGEST) fail("DSS04_PIN_MISMATCH"); const digest = COMPILER_BUILD_PIN_DIGEST; const prior = this.state.pins.compilerBuild; if (prior) { if (canonicalJson(prior) !== canonicalJson({ ...pin, digest, compiler_build_pin_digest: digest, state: "PINNED", owner: this.ownerAuthority.owner, root: this.ownerAuthority.root, installationCommitmentDigest: commitment, installation_commitment_digest: commitment })) return result("IDEMPOTENCY_CONFLICT"); return result("REPLAYED", { pin: clone(prior) }); } const value = { ...pin, digest, compiler_build_pin_digest: digest, state: "PINNED", owner: this.ownerAuthority.owner, root: this.ownerAuthority.root, installationCommitmentDigest: commitment, installation_commitment_digest: commitment }; this._save("pins", "compilerBuild", value); this._event("install-compiler-build-pin", value, { carrierId: "d.compiler-build-pin", event: "INSTALL", operationId: "install-compiler-build-pin", owner: ROOT_OWNER, fromState: "ABSENT", toState: "PINNED", outcome: "PINNED" }); this.state.operationInputs["install-compiler-build-pin"] = { inputDigest: this._operationKey("install-compiler-build-pin", { pin: value.digest, commitment }), ref: "compilerBuild" }; this._persist(); return result("PINNED", { pin: value }); } catch (error) { if (error.code === "DSS04_UNAUTHORIZED") return result("UNAUTHORIZED"); if (error.code === "DSS04_PIN_MISMATCH") return result("PIN_MISMATCH"); if (error.code === "DSS04_ANCHOR_INVALID") return result("ROOT_BROKEN"); throw error; }
  }
  installProjectRegistryRootPin(input = {}) {
    try { this._authority(input); const pin = clone(input.pin || input); const protectedPin = this._protected("registry"); noExtras(pin, ["root_digest", "namespace", "signer_population_digest", "revision_schema_digest", "installationCommitmentDigest", "installation_commitment_digest"], "projectRegistryRoot"); for (const field of ["root_digest", "namespace", "signer_population_digest", "revision_schema_digest"]) requiredString(pin[field], `projectRegistryRoot.${field}`); safeDigest(pin.root_digest, "projectRegistryRoot.root_digest"); if (protectedPin.digest !== PROJECT_ROOT_DIGEST || canonicalJson(pin) !== canonicalJson(protectedPin.value)) fail("DSS04_PIN_MISMATCH"); const commitment = input.installationCommitmentDigest || pin.installationCommitmentDigest || pin.installation_commitment_digest; if (commitment !== protectedPin.digest) fail("DSS04_PIN_MISMATCH"); const digest = protectedPin.digest; const prior = this.state.pins.projectRegistryRoot; if (prior) return canonicalJson(prior) === canonicalJson({ ...pin, digest, project_registry_root_digest: digest, state: "PINNED", owner: this.ownerAuthority.owner, root: this.ownerAuthority.root, installationCommitmentDigest: commitment, installation_commitment_digest: commitment }) ? result("REPLAYED", { pin: clone(prior) }) : result("IDEMPOTENCY_CONFLICT"); const value = { ...pin, digest, project_registry_root_digest: digest, state: "PINNED", owner: this.ownerAuthority.owner, root: this.ownerAuthority.root, installationCommitmentDigest: commitment, installation_commitment_digest: commitment }; this._save("pins", "projectRegistryRoot", value); this._event("install-project-registry-root-pin", value, { carrierId: "d.project-registry-root-pin", event: "INSTALL", operationId: "install-project-registry-root-pin", owner: ROOT_OWNER, fromState: "ABSENT", toState: "PINNED", outcome: "PINNED" }); this._persist(); return result("PINNED", { pin: value }); } catch (error) { if (error.code === "DSS04_UNAUTHORIZED") return result("UNAUTHORIZED"); if (error.code === "DSS04_PIN_MISMATCH") return result("PIN_MISMATCH"); if (error.code === "DSS04_ANCHOR_INVALID") return result("ROOT_BROKEN"); throw error; }
  }
  openDss04Generation(input = {}) {
    if (this.stateVerificationError) return result("ROOT_BROKEN");
    try { if (this.authorityBroken) return result("ROOT_BROKEN"); const supplied = input.identity || input.generation || GENERATION_IDENTITY; if (Object.keys(supplied).join("\0") !== Object.keys(GENERATION_IDENTITY).join("\0")) return this.state.generations.current ? result("IDEMPOTENCY_CONFLICT") : result("STALE_PREDECESSOR"); for (const [key, value] of Object.entries(GENERATION_IDENTITY)) if (supplied[key] !== value) return this.state.generations.current ? result("IDEMPOTENCY_CONFLICT") : result("STALE_PREDECESSOR"); if (this.state.pins.compilerBuild?.state !== "PINNED" || this.state.pins.compilerBuild.digest !== COMPILER_BUILD_PIN_DIGEST || this.state.pins.compilerBuild.compiler_build_pin_digest !== COMPILER_BUILD_PIN_DIGEST || this.state.pins.projectRegistryRoot?.state !== "PINNED") return result("PIN_MISMATCH"); if (this.state.generations.current) return result("REPLAYED", { generation: clone(this.state.generations.current) }); const generation = { identity: clone(GENERATION_IDENTITY), generationRef: SERVICE_GENERATION, state: "OPENING", openedAt: this.clock(), owner: ROOT_OWNER }; this.state.generations.current = generation; this._event("open-dss04-generation", generation, { carrierId: "d.dss04-service-generation", event: "OPEN", operationId: "open-dss04-generation", owner: "dss04-store-owner", fromState: "ABSENT", toState: "OPENING", outcome: "ACCEPTED" }); this._persist(); return result("ACCEPTED", { generation: clone(generation) }); } catch (error) { throw error; }
  }
  _generation() { if (this.authorityBroken) return null; if (this.stateVerificationError) fail("DSS04_STATE_CORRUPT"); const generation = this.state.generations.current; if (!generation) fail("DSS04_GENERATION_REQUIRED"); if (generation.state === "BROKEN") return null; return generation; }
  admitProjectRegistryRevision(input = {}) {
    try { const generation = this._generation(); if (!generation) return result("ROOT_BROKEN"); const revision = clone(input.revision || input); exactFields(revision, REGISTRY_FIELDS, "registryRevision"); for (const field of REGISTRY_FIELDS.slice(3)) safeDigest(revision[field], `registryRevision.${field}`); if (revision.registry_root_digest !== PROJECT_ROOT_DIGEST) return this._rejectTransition("d.project-registry-revision", "REJECT", "admit-project-registry-revision", "dss04-project-registry-owner", "UNSEEN", "REJECTED", "STALE_PREDECESSOR"); const proof = input.signatureProof || input.signature; const verifier = this._verifier("registry", "dss04-project-registry-owner", "owner-project-registry-root"); const signedFields = REGISTRY_FIELDS.filter((field) => field !== "signature_digest"); const payloadDigest = digestObject("DirectSemanticService.Dss04.ProjectRegistryRevision.v1", Object.fromEntries(signedFields.map((field) => [field, revision[field]]))); if (!verifier.verify({ revision: clone(revision), payloadDigest, rootPin: clone(this.state.pins.projectRegistryRoot) }, proof)) return this._rejectTransition("d.project-registry-revision", "REJECT", "admit-project-registry-revision", verifier.owner, "UNSEEN", "REJECTED", "REJECTED"); if (revision.signature_digest !== digestObject("DirectSemanticService.Dss04.RegistrySignature.v1", proof)) return this._rejectTransition("d.project-registry-revision", "REJECT", "admit-project-registry-revision", verifier.owner, "UNSEEN", "REJECTED", "REJECTED"); const ref = digestObject("DirectSemanticService.Dss04.ProjectRegistryRevision.v1", Object.fromEntries(REGISTRY_FIELDS.map((field) => [field, revision[field]]))); const existing = this.state.registryRevisions[ref]; if (existing) return canonicalJson(existing) === canonicalJson({ ...revision, revisionRef: ref, state: "ADMITTED", generation: generation.generationRef }) ? result("REPLAYED", { revision: clone(existing) }) : result("IDEMPOTENCY_CONFLICT"); const value = { ...revision, revisionRef: ref, state: "ADMITTED", generation: generation.generationRef }; this._save("registryRevisions", ref, value); this._event("admit-project-registry-revision", value, { carrierId: "d.project-registry-revision", event: "ADMIT", operationId: "admit-project-registry-revision", owner: "dss04-project-registry-owner", fromState: "UNSEEN", toState: "ADMITTED", outcome: "ADMITTED" }); this._persist(); return result("ADMITTED", { revision: value }); } catch (error) { if (error.code === "DSS04_GENERATION_REQUIRED") return result("STALE_PREDECESSOR"); if (error.code === "DSS04_VERIFIER_UNAVAILABLE") return result("REJECTED"); throw error; }
  }
  _validatePath(relative) { requiredString(relative, "artifact.canonical_relative_path"); if (relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..") || relative.split("/").includes(".")) fail("DSS04_SNAPSHOT_INVALID", "path"); }
  _verifySnapshotClosure(receipt, materialized, input) {
    const inventories = input.inventoryMaterializations || input.inventories;
    if (!inventories || typeof inventories !== "object" || Array.isArray(inventories)) fail("DSS04_SNAPSHOT_INVALID", "inventory-materializations");
    const expectedFile = materialized.map(({ bytes, contentBase64, bytesBase64, ...artifact }) => artifact).sort((a, b) => a.canonical_relative_path.localeCompare(b.canonical_relative_path));
    const expected = { file_inventory: expectedFile };
    for (const family of SNAPSHOT_FAMILIES.slice(1)) {
      if (!Array.isArray(inventories[family])) fail("DSS04_SNAPSHOT_INVALID", `${family}-materialization`);
      expected[family] = clone(inventories[family]);
    }
    if (!Array.isArray(inventories.file_inventory) || canonicalJson(inventories.file_inventory) !== canonicalJson(expectedFile)) fail("DSS04_SNAPSHOT_INVALID", "file-inventory-materialization");
    const digestFields = { file_inventory: "file_inventory_digest", executable_root_inventory: "executable_root_inventory_digest", language_inventory: "language_inventory_digest", submodule_inventory: "submodule_inventory_digest", lfs_inventory: "lfs_inventory_digest", generated_input_inventory: "generated_input_inventory_digest", cartography: "cartography_digest" };
    for (const family of SNAPSHOT_FAMILIES) {
      const value = inventories[family];
      if (!Array.isArray(value) || digestObject(`DirectSemanticService.Dss04.TargetSnapshot.${family.replaceAll("_", " ").replace(/(?:^| )([a-z])/g, (_, c) => c.toUpperCase()).replaceAll(" ", "")}.v1`, value) !== receipt[digestFields[family]]) fail("DSS04_SNAPSHOT_INVALID", `${family}-digest`);
    }
    const rootPayload = { project_id: receipt.project_id, project_registry_revision_digest: receipt.project_registry_revision_digest, target_revision: receipt.target_revision, inventories: Object.fromEntries(SNAPSHOT_FAMILIES.map((family) => [family, inventories[family]])), snapshot_policy_digest: receipt.snapshot_policy_digest, capture_tool_revision: receipt.capture_tool_revision, capture_environment_digest: receipt.capture_environment_digest };
    if (digestObject("DirectSemanticService.Dss04.TargetSnapshot.Root.v1", rootPayload) !== receipt.snapshot_root_digest) fail("DSS04_SNAPSHOT_INVALID", "snapshot-root");
  }
  _admitTargetSnapshot(input = {}) {
    try { const generation = this._generation(); const receipt = clone(input.receipt || input); exactFields(receipt, SNAPSHOT_FIELDS, "snapshotReceipt"); const digestFields = ["project_registry_revision_digest", "snapshot_root_digest", "file_inventory_digest", "executable_root_inventory_digest", "language_inventory_digest", "submodule_inventory_digest", "lfs_inventory_digest", "generated_input_inventory_digest", "cartography_digest", "snapshot_policy_digest", "capture_environment_digest"]; for (const field of digestFields) safeDigest(receipt[field], `snapshotReceipt.${field}`); const registry = this.state.registryRevisions[receipt.project_registry_revision_digest]; if (!registry) return result("STALE_PREDECESSOR"); const artifacts = clone(input.artifacts || receipt.artifacts || []); if (!Array.isArray(artifacts)) fail("DSS04_SNAPSHOT_INVALID", "artifacts"); const seen = new Set(); const materialized = []; for (const artifact of artifacts) { if (!artifact || typeof artifact !== "object" || ["canonical_relative_path", "object_kind", "mode", "provenance", "root_membership"].some((field) => artifact[field] === undefined) || (!Number.isSafeInteger(artifact.byte_length) && artifact.contentBase64 === undefined && artifact.bytes === undefined)) fail("DSS04_SNAPSHOT_INVALID", "artifact-fields"); this._validatePath(artifact.canonical_relative_path); const normalizedPath = artifact.canonical_relative_path.normalize("NFC").toLocaleLowerCase("en-US"); if (artifact.object_kind === "SYMLINK" || seen.has(artifact.canonical_relative_path) || [...seen].some((value) => value === normalizedPath || value.normalize("NFC").toLocaleLowerCase("en-US") === normalizedPath)) fail("DSS04_SNAPSHOT_INVALID", "alias-or-symlink"); const bytes = artifact.bytes !== undefined ? Buffer.from(artifact.bytes) : Buffer.from(artifact.contentBase64 || "", "base64"); const contentDigest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; const byteLength = bytes.length; if (artifact.content_digest !== contentDigest || artifact.byte_length !== byteLength) fail("DSS04_SNAPSHOT_INVALID", "artifact-seal"); seen.add(artifact.canonical_relative_path); materialized.push({ ...artifact, bytesBase64: bytes.toString("base64"), bytes: undefined, contentBase64: undefined, byte_length: byteLength, content_digest: contentDigest }); } this._verifySnapshotClosure(receipt, materialized, input); const inventory = digestObject("DirectSemanticService.Dss04.TargetSnapshot.FileInventory.v1", materialized.map(({ bytes, contentBase64, bytesBase64, ...artifact }) => artifact).sort((a, b) => a.canonical_relative_path.localeCompare(b.canonical_relative_path))); if (receipt.file_inventory_digest !== inventory) fail("DSS04_SNAPSHOT_INVALID", "inventory"); const receiptRef = digestObject("DirectSemanticService.Dss04.TargetSnapshotReceipt.v1", Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, receipt[field]]))); const existing = this.state.snapshotReceipts[receiptRef]; if (existing) return canonicalJson(existing) === canonicalJson({ ...receipt, receiptRef, state: "ADMITTED", generation: generation.generationRef, artifactRefs: existing.artifactRefs }) ? result("REPLAYED", { receipt: clone(existing) }) : result("IDEMPOTENCY_CONFLICT"); const value = { ...receipt, receiptRef, state: "ADMITTED", generation: generation.generationRef, artifactRefs: [] }; for (const artifact of materialized) { const { bytes, contentBase64, bytesBase64, ...stored } = artifact; const artifactRef = digestObject("DirectSemanticService.Dss04.TargetSnapshotArtifact.v1", stored); this._save("snapshotArtifacts", artifactRef, { ...stored, artifactRef, snapshotRootDigest: receipt.snapshot_root_digest, state: "VERIFIED", bytesBase64, bytesDigest: stored.content_digest }); value.artifactRefs.push(artifactRef); } this._save("snapshotReceipts", receiptRef, value); return result("ADMITTED", { receipt: value, artifacts: value.artifactRefs.map((ref) => clone(this.state.snapshotArtifacts[ref])) }); } catch (error) { if (error.code === "DSS04_SNAPSHOT_INVALID") return result("SNAPSHOT_INVALID"); throw error; }
  }
  _admitProjectEvidenceRuntime(input = {}) {
    try { const generation = this._generation(); if (!generation) return result("ROOT_BROKEN"); const runtime = clone(input.runtime || input); exactFields(runtime, RUNTIME_FIELDS, "evidenceRuntime"); const digestFields = ["project_registry_revision_digest", "target_snapshot_receipt_digest", "evidence_source_catalog_digest", "evidence_toolchain_digest", "evidence_policy_digest", "availability_snapshot_digest", "isolation_profile_digest", "environment_digest"]; for (const field of digestFields) safeDigest(runtime[field], `evidenceRuntime.${field}`); const registry = this.state.registryRevisions[runtime.project_registry_revision_digest]; const snapshot = this.state.snapshotReceipts[runtime.target_snapshot_receipt_digest]; if (!registry || !snapshot) return result("STALE_PREDECESSOR"); const verifier = this._verifier("runtime", "dss04-evidence-runtime-owner", "project-evidence-runtime-root"); const proof = input.runtimeProof || input.proof; const runtimeDigest = digestObject("DirectSemanticService.Dss04.ProjectEvidenceRuntimeRevision.v1", Object.fromEntries(RUNTIME_FIELDS.map((field) => [field, runtime[field]]))); if (!verifier.verify({ runtime: clone(runtime), runtimeDigest, registry: clone(registry), snapshot: clone(snapshot) }, proof)) return result("EVIDENCE_RUNTIME_INVALID"); const ref = runtimeDigest; const existing = this.state.evidenceRuntimes[ref]; if (existing) return canonicalJson(existing) === canonicalJson({ ...runtime, runtimeRef: ref, state: "ADMITTED", generation: generation.generationRef }) ? result("REPLAYED", { runtime: clone(existing) }) : result("IDEMPOTENCY_CONFLICT"); const value = { ...runtime, runtimeRef: ref, state: "ADMITTED", generation: generation.generationRef }; this._save("evidenceRuntimes", ref, value); return result("ADMITTED", { runtime: value }); } catch (error) { if (error.code === "DSS04_FIELD_INVALID" || error.code === "DSS04_DIGEST_INVALID") return result("EVIDENCE_RUNTIME_INVALID"); if (error.code === "DSS04_VERIFIER_UNAVAILABLE") return result("EVIDENCE_RUNTIME_INVALID"); throw error; }
  }
  _predecessorParts(input) { const envelope = clone(input.envelope || input.result || input); const receipt = clone(input.receipt || input.ownerReceipt || {}); const head = clone(input.sourceLifecycleHead || input.lifecycleHead || {}); exactFields(envelope, PREDECESSOR_FIELDS, "dss03Envelope"); if (envelope.dss03_implementation_commit !== PREDECESSOR_IMPLEMENTATION || envelope.dss03_semantic_candidate !== PREDECESSOR_SEMANTIC || envelope.dss03_result_schema_revision !== RESULT_SCHEMA || envelope.source_standing !== "SEALED") fail("DSS04_PREDECESSOR_INVALID"); for (const field of ["dss03_service_generation", "result_seal_digest", "result_population_coverage_digest", "terminal_result_event_head", "seal_receipt_digest"]) safeDigest(envelope[field], `dss03Envelope.${field}`); exactFields(receipt, PREDECESSOR_FIELDS, "dss03OwnerReceipt"); for (const field of PREDECESSOR_FIELDS) if (receipt[field] !== envelope[field]) fail("DSS04_PREDECESSOR_INVALID", `receipt.${field}`); const event = head.event || head.eventType; const envelopeDigest = digestObject("DirectSemanticService.Dss04.Dss03Envelope.v1", envelope); const receiptDigest = digestObject("DirectSemanticService.Dss04.Dss03OwnerReceipt.v1", receipt); if (event !== "SEAL" || head.standing !== "SEALED" || head.authenticated !== true || head.authorityOwner !== PREDECESSOR_OWNER || head.authorityRoot !== PREDECESSOR_ROOT || head.serviceGeneration !== envelope.dss03_service_generation || head.envelopeIdentityDigest !== envelopeDigest || head.receiptDigest !== receiptDigest) fail("DSS04_PREDECESSOR_INVALID", "source head"); const expectedHead = digestObject("DirectSemanticService.Dss04.Dss03LifecycleHead.v1", { event, standing: head.standing, authenticated: head.authenticated, authorityOwner: head.authorityOwner, authorityRoot: head.authorityRoot, serviceGeneration: head.serviceGeneration, envelopeIdentityDigest: envelopeDigest, receiptDigest }); if (head.headDigest !== expectedHead) fail("DSS04_PREDECESSOR_INVALID", "head digest"); return { envelope, receipt, head }; }
  _acceptDss03SealedResult(input = {}) {
    try { const generation = this._generation(); const { envelope, receipt, head } = this._predecessorParts(input); const ref = envelope.dss03_job_id; const existing = this.state.sealedResults[ref]; if (existing) return canonicalJson(existing.envelope) === canonicalJson(envelope) ? result("REPLAYED", { sealedResult: clone(existing) }) : result("IDEMPOTENCY_CONFLICT"); const value = { envelope, receipt, sourceLifecycleHead: head, resultRef: ref, state: "ACCEPTED", generation: generation.generationRef }; this._save("sealedResults", ref, value); return result("ACCEPTED", { sealedResult: value }); } catch (error) { if (error.code === "DSS04_PREDECESSOR_INVALID") return result("REJECTED"); throw error; }
  }
  admitTargetSnapshot(input = {}) {
    const before = this.state.events.length;
    const candidateReceipt = clone(input.receipt || input);
    const admittedRegistry = this.state.registryRevisions[candidateReceipt.project_registry_revision_digest];
    if (admittedRegistry && admittedRegistry.project_id !== candidateReceipt.project_id) {
      this._transitionEvent("admit-target-snapshot", "d.target-snapshot-artifact", "REJECT", { reason: "project-binding" }, "SNAPSHOT_INVALID");
      this._transitionEvent("admit-target-snapshot", "d.target-snapshot-receipt", "REJECT", { reason: "project-binding" }, "SNAPSHOT_INVALID");
      this._persist(); return result("SNAPSHOT_INVALID");
    }
    const observed = this._admitTargetSnapshot(input);
    if (observed.status === "ADMITTED") {
      const refs = observed.receipt.artifactRefs || [];
      for (const artifactRef of refs) { this._transitionEvent("admit-target-snapshot", "d.target-snapshot-artifact", "PUBLISH", { artifactRef }, "ADMITTED"); this._transitionEvent("admit-target-snapshot", "d.target-snapshot-artifact", "VERIFY", { artifactRef }, "ADMITTED"); }
      this._transitionEvent("admit-target-snapshot", "d.target-snapshot-receipt", "ADMIT", { receipt: observed.receipt, artifactRefs: refs }, "ADMITTED");
      this._persist();
    } else if (observed.status === "SNAPSHOT_INVALID" && this.state.events.length === before) {
      this._transitionEvent("admit-target-snapshot", "d.target-snapshot-artifact", "REJECT", { reason: "SNAPSHOT_INVALID" }, "SNAPSHOT_INVALID");
      this._transitionEvent("admit-target-snapshot", "d.target-snapshot-receipt", "REJECT", { reason: "SNAPSHOT_INVALID" }, "SNAPSHOT_INVALID");
      this._persist();
    }
    return observed;
  }
  admitProjectEvidenceRuntime(input = {}) {
    const before = this.state.events.length;
    const observed = this._admitProjectEvidenceRuntime(input);
    if (observed.status === "ADMITTED") this._transitionEvent("admit-project-evidence-runtime", "d.project-evidence-runtime-revision", "ADMIT", observed.runtime, "ADMITTED");
    else if (observed.status === "EVIDENCE_RUNTIME_INVALID") this._transitionEvent("admit-project-evidence-runtime", "d.project-evidence-runtime-revision", "REJECT", { reason: "EVIDENCE_RUNTIME_INVALID" }, "EVIDENCE_RUNTIME_INVALID");
    if (observed.status === "ADMITTED" || observed.status === "EVIDENCE_RUNTIME_INVALID") this._persist();
    return observed;
  }
  acceptDss03SealedResult(input = {}) {
    const before = this.state.events.length;
    const observed = this._acceptDss03SealedResult(input);
    if (observed.status === "ACCEPTED") this._transitionEvent("accept-dss03-sealed-result", "e.dss03-sealed-result", "ACCEPT", observed.sealedResult, "ACCEPTED");
    else if (observed.status === "REJECTED") this._transitionEvent("accept-dss03-sealed-result", "e.dss03-sealed-result", "REJECT", { reason: "REJECTED" }, "REJECTED");
    if (observed.status === "ACCEPTED" || observed.status === "REJECTED") this._persist();
    return observed;
  }
  submitCompilationRequest(input = {}) {
    const request = clone(input.request || input);
    const fields = ["service_generation", "request_id", "dss03_result_seal_digest", "project_registry_revision_digest", "target_snapshot_receipt_digest", "semantic_contract_module_digest", "project_evidence_runtime_revision_digest", "compiler_build_pin_digest", "compiler_invocation_contract_digest", "compiler_receipt_normalization_revision", "compilation_profile_digest", "requested_route_scope_digest", "materialization_policy_digest"];
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_GENERATION");
      const grant = input.grant; if (!grant || grant.owner !== "dss03-authority-owner" || grant.root !== "ratified-dss03-result-root" || grant.authorized !== true || !/^sha256:[0-9a-f]{64}$/.test(grant.proofDigest || "")) return result("UNAUTHORIZED");
      const identity = this._digestFields(request, fields, "compilationRequest");
      if (identity.service_generation !== generation.generationRef || identity.compiler_build_pin_digest !== this.state.pins.compilerBuild?.digest || identity.compiler_invocation_contract_digest !== COMPILER_INVOCATION_DIGEST || identity.compiler_receipt_normalization_revision !== NORMALIZATION_REVISION || identity.semantic_contract_module_digest !== SEMANTIC_MODULE_DIGEST || identity.materialization_policy_digest !== MATERIALIZATION_POLICY_DIGEST) return result("STALE_GENERATION");
      const sealed = Object.values(this.state.sealedResults).find((value) => value.envelope?.result_seal_digest === identity.dss03_result_seal_digest);
      const registry = this.state.registryRevisions[identity.project_registry_revision_digest];
      const snapshot = this.state.snapshotReceipts[identity.target_snapshot_receipt_digest];
      const runtime = this.state.evidenceRuntimes[identity.project_evidence_runtime_revision_digest];
      if (!sealed || sealed.state !== "ACCEPTED" || !registry || !snapshot || !runtime || runtime.project_registry_revision_digest !== identity.project_registry_revision_digest || runtime.target_snapshot_receipt_digest !== identity.target_snapshot_receipt_digest) return result("STALE_PREDECESSOR"); const verifier = this._verifier("authorization", "dss03-authority-owner", "ratified-dss03-result-root"); const grantScope = this._refFor("CompilationRequestGrantScope", { generation: generation.generationRef, request: identity, sealedResult: sealed.resultRef, registry: registry.revisionRef, snapshot: snapshot.receiptRef, runtime: runtime.runtimeRef }); if (grant.scopeDigest !== grantScope) return result("UNAUTHORIZED");
      if (verifier.revision !== "dss03-grant-verifier-v1" || !verifier.verify({ grantScope, request: identity, generation: generation.generationRef }, grant)) return result("UNAUTHORIZED");
      const requestRef = this._refFor("CompilationRequest", identity); const semanticInputDigest = this._refFor("CompilationSemanticInput", identity); const resultIdentityDigest = this._refFor("CompilationResultIdentity", { requestRef, generation: generation.generationRef }); const prior = this.state.compilationRequests[identity.request_id];
      if (prior) {
        if (prior.requestRef !== requestRef) { this._recordTransition("submit-compilation-request", "d.compilation-request", "CONFLICT", { requestId: identity.request_id }, "IDEMPOTENCY_CONFLICT"); this._recordTransition("submit-compilation-request", "d.compilation-idempotency-binding", "CONFLICT", { requestId: identity.request_id }, "IDEMPOTENCY_CONFLICT"); this._persist(); return result("IDEMPOTENCY_CONFLICT"); }
        this._recordTransition("submit-compilation-request", "d.compilation-idempotency-binding", "REPLAY", { requestId: identity.request_id, requestRef }, "REPLAYED"); this._persist(); return result("REPLAYED", { request: clone(prior) });
      }
      const value = { ...identity, requestRef, semanticInputDigest, resultIdentityDigest, state: "SUBMITTED", generation: generation.generationRef, submittedAt: this.clock(), sourceRefs: { sealedResult: sealed.resultRef, registry: registry.revisionRef, snapshot: snapshot.receiptRef, runtime: runtime.runtimeRef } };
      this._assertCarrierFields("d.compilation-request", value); this._save("compilationRequests", identity.request_id, value); const binding = { request_id: identity.request_id, semantic_input_digest: semanticInputDigest, result_identity_digest: resultIdentityDigest, service_generation: generation.generationRef, requestRef, state: "BOUND" }; this._assertCarrierFields("d.compilation-idempotency-binding", binding); this._save("idempotencyBindings", identity.request_id, binding);
      this._recordTransition("submit-compilation-request", "d.compilation-request", "SUBMIT", value, "ACCEPTED"); this._recordTransition("submit-compilation-request", "d.compilation-idempotency-binding", "BIND", value, "ACCEPTED"); this._persist(); return result("ACCEPTED", { request: value });
    } catch (error) { if (error.code === "DSS04_GENERATION_REQUIRED") return result("STALE_PREDECESSOR"); if (error.code === "DSS04_FIELD_INVALID" || error.code === "DSS04_DIGEST_INVALID") return result("STALE_PREDECESSOR"); throw error; }
  }
  allocateDss04Work(input = {}) {
    const raw = clone(input.allocation || input); const requestId = raw.request_id || raw.requestId; const generationRef = raw.service_generation || raw.serviceGeneration;
    try {
      const generation = this._ready(input); if (!generation || (generationRef && generationRef !== generation.generationRef)) return result("STALE_PREDECESSOR");
      requiredString(requestId, "allocation.request_id"); const request = this.state.compilationRequests[requestId]; if (!request || request.state !== "SUBMITTED") return result("STALE_PREDECESSOR");
      const workKind = raw.work_kind === "PAGE" ? "PAGE" : "COMPILATION"; const pageScope = workKind === "PAGE" ? { plan_ref: raw.plan_ref || raw.planRef, page_identity: raw.page_identity || raw.pageIdentity } : null; if (workKind === "PAGE" && (!pageScope.plan_ref || !pageScope.page_identity)) return Object.values(this.state.allocations).some((candidate) => candidate.request_id === requestId && candidate.work_kind === "COMPILATION") ? result("IDEMPOTENCY_CONFLICT") : result("STALE_PREDECESSOR"); if (workKind === "PAGE") { const plan = Object.values(this.state.materializationPlans).find((candidate) => candidate.planRef === pageScope.plan_ref); if (!plan || plan.service_generation !== generation.generationRef || plan.state !== "INSTANTIATED" || !plan.pages.some((page) => page.page_identity === pageScope.page_identity)) return result("STALE_PREDECESSOR"); } const scope = workKind === "PAGE" ? this._refFor("PageWorkScope", pageScope) : request.requested_route_scope_digest; const workIdentity = this._refFor("Dss04WorkIdentity", { requestRef: request.requestRef, scope, kind: workKind }); const reservation = this._refFor("Dss04ResourceReservation", { requestRef: request.requestRef, scope, policy: workKind === "PAGE" ? "DSS04_FIXED_PAGE_RESERVATION_V1" : "DSS04_FIXED_COMPILATION_RESERVATION_V1" }); const allocationId = workIdentity;
      for (const [name, supplied, expected] of [["work_kind", raw.work_kind, workKind], ["work_identity", raw.work_identity, workIdentity], ["reservation_digest", raw.reservation_digest || raw.resource_reservation_digest, reservation]]) if (supplied !== undefined && supplied !== expected) return result("IDEMPOTENCY_CONFLICT");
      const identity = { service_generation: generation.generationRef, request_id: requestId, work_kind: workKind, work_identity: workIdentity, reservation_digest: reservation }; const ref = this._refFor("Dss04Allocation", identity); const prior = this.state.allocations[allocationId];
      if (prior) return prior.allocationRef === ref ? result("REPLAYED", { allocation: clone(prior) }) : result("IDEMPOTENCY_CONFLICT");
      const limit = 1; const used = Object.values(this.state.allocations).filter((a) => a.state === "ALLOCATED" && a.work_kind === workKind).length; if (used >= limit) return result("OVER_BUDGET");
      const value = { ...identity, pageScope, allocationRef: ref, state: "ALLOCATED", generation: generation.generationRef, requestRef: request.requestRef, allocatedAt: this.clock() }; this._assertCarrierFields("d.dss04-allocation", value); this._save("allocations", allocationId, value); this._recordTransition("allocate-dss04-work", "d.dss04-allocation", "ALLOCATE", value, "ACCEPTED"); this._persist(); return result("ACCEPTED", { allocation: value });
    } catch (error) { if (["DSS04_FIELD_INVALID", "DSS04_DIGEST_INVALID"].includes(error.code)) return result("STALE_PREDECESSOR"); if (error.code === "DSS04_GENERATION_REQUIRED") return result("STALE_PREDECESSOR"); throw error; }
  }
  acquireDss04Lease(input = {}) {
    const raw = clone(input.lease || input); const allocationId = raw.allocation_id || raw.allocationId; const generationRef = raw.service_generation || raw.serviceGeneration;
    try {
      const generation = this._ready(input); if (!generation || (generationRef && generationRef !== generation.generationRef)) return result("STALE_GENERATION"); requiredString(allocationId, "lease.allocation_id"); const allocation = this.state.allocations[allocationId]; if (!allocation || allocation.state !== "ALLOCATED") return result("STALE_PREDECESSOR");
      const owner = allocation.work_kind === "PAGE" ? "dss04-materializer-owner" : "dss04-compiler-runtime-owner"; const now = this.clock(); const expiresAt = new Date(new Date(now).getTime() + LEASE_TTL_MS).toISOString(); if (raw.lease_owner !== undefined && raw.lease_owner !== owner) return result("IDEMPOTENCY_CONFLICT"); if (raw.ttl_ms !== undefined || raw.ttlMs !== undefined) return result("IDEMPOTENCY_CONFLICT"); if (raw.expires_at !== undefined && raw.expires_at !== expiresAt || raw.expiresAt !== undefined && raw.expiresAt !== expiresAt) return result("IDEMPOTENCY_CONFLICT"); const previous = this.state.leases[allocationId]; const nextFence = (previous?.fenceSequence || 0) + 1; const fencingToken = digestObject("DirectSemanticService.Dss04.FencingToken.v1", { generation: generation.generationRef, workIdentity: allocation.work_identity, sequence: nextFence }); if (raw.fencing_token !== undefined && raw.fencing_token !== fencingToken) return result("IDEMPOTENCY_CONFLICT"); const identity = { service_generation: generation.generationRef, work_identity: allocation.work_identity, lease_owner: owner, fencing_token: fencingToken, expires_at: expiresAt }; const ref = this._refFor("Dss04Lease", identity); const existing = previous;
      if (existing && existing.state === "HELD" && new Date(existing.expires_at).getTime() > new Date(now).getTime()) return existing.leaseRef === ref ? result("REPLAYED", { lease: clone(existing) }) : result("LEASE_CONFLICT");
      if (existing && existing.state === "HELD" && new Date(existing.expires_at).getTime() <= new Date(now).getTime()) return result("STALE_PREDECESSOR");
      const value = { ...identity, leaseRef: ref, leaseId: ref, state: "HELD", generation: generation.generationRef, allocationRef: allocation.allocationRef, requestId: allocation.request_id, fenceSequence: nextFence, acquiredAt: now }; this._assertCarrierFields("d.dss04-lease", value); this._save("leases", allocationId, value); this._recordTransition("acquire-dss04-lease", "d.dss04-lease", "ACQUIRE", value, "ACCEPTED"); this._persist(); return result("ACCEPTED", { lease: value });
    } catch (error) { if (["DSS04_FIELD_INVALID", "DSS04_DIGEST_INVALID"].includes(error.code)) return result("LEASE_CONFLICT"); if (error.code === "DSS04_GENERATION_REQUIRED") return result("STALE_GENERATION"); throw error; }
  }
  _executionInputs(input) {
    const requestId = input.request_id || input.requestId || input.request?.request_id; const leaseId = input.lease_id || input.leaseId || input.lease?.lease_id || input.lease?.leaseId; const request = this.state.compilationRequests[requestId] || Object.values(this.state.compilationRequests).find((item) => item.request_id === requestId); const lease = Object.values(this.state.leases).find((item) => item.lease_id === leaseId || item.leaseId === leaseId || item.leaseRef === leaseId);
    const allocation = lease && Object.values(this.state.allocations).find((item) => item.allocationRef === lease.allocationRef); if (!request || !lease || !allocation || lease.state !== "HELD") return null;
    const snapshot = this.state.snapshotReceipts[request.target_snapshot_receipt_digest]; const runtime = this.state.evidenceRuntimes[request.project_evidence_runtime_revision_digest]; const registry = this.state.registryRevisions[request.project_registry_revision_digest]; const pin = this.state.pins.compilerBuild;
    if (!snapshot || !runtime || !registry || !pin || pin.digest !== request.compiler_build_pin_digest || request.service_generation !== lease.service_generation || allocation.service_generation !== request.service_generation || allocation.request_id !== request.request_id || snapshot.project_id !== registry.project_id || snapshot.project_registry_revision_digest !== registry.revisionRef || runtime.project_id !== registry.project_id || runtime.project_registry_revision_digest !== registry.revisionRef || runtime.target_snapshot_receipt_digest !== snapshot.receiptRef) return null;
    if (!Array.isArray(snapshot.artifactRefs) || snapshot.artifactRefs.length === 0 || snapshot.artifactRefs.some((ref) => !this.state.snapshotArtifacts[ref])) return null;
    const artifacts = snapshot.artifactRefs.map((ref) => clone(this.state.snapshotArtifacts[ref])); return { request, lease, snapshot, runtime, registry, pin, artifacts };
  }
  _secureCaptureCompilerOutput(input = {}) {
    let capturedObservation = null;
    try {
      const observationId = input.observation_id || input.observationId || input.observation?.observationRef; const observation = Object.values(this.state.observations).find((value) => value.observationRef === observationId || value.request_id === observationId || value.requestId === observationId); capturedObservation = observation || null; const leaseId = input.lease_id || input.leaseId || input.lease?.leaseRef || input.lease?.lease_id || input.lease?.leaseId; const lease = Object.values(this.state.leases).find((value) => value.leaseRef === leaseId || value.leaseId === leaseId || value.lease_id === leaseId); if (!observation || !lease || observation.leaseRef !== lease.leaseRef || observation.state !== "TERMINATED") return result("STALE_PREDECESSOR"); if (new Date(lease.expires_at).getTime() <= new Date(this.clock()).getTime()) return result("STALE_PREDECESSOR");
      const existing = this.state.rawCompilerOutputs[observation.request_id] || this.state.rawCompilerOutputs[observation.requestId]; if (existing) return result("REPLAYED", { rawOutput: clone(existing) }); const custodyRoot = path.join(this.store.root, "dss04-process-custody"); const stdoutFile = path.join(custodyRoot, `${observation.observationRef.slice(7)}.stdout`); if (!fs.existsSync(stdoutFile)) return this._captureCorrupt(observation, "missing-process-custody"); const bytes = fs.readFileSync(stdoutFile); const contentSeal = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (bytes.length !== observation.stdout_byte_count || contentSeal !== observation.stdout_seal) return this._captureCorrupt(observation, "process-custody-seal"); const custodyTag = digestObject("DirectSemanticService.Dss04.RawCompilerCustody.v1", { request_id: observation.request_id, process_observation_digest: observation.observationRef, byte_length: bytes.length, content_seal: contentSeal }); const raw = { request_id: observation.request_id, process_observation_digest: observation.observationRef, byte_length: bytes.length, content_seal: contentSeal, custody_tag: custodyTag, service_generation: observation.service_generation, rawRef: this._refFor("RawCompilerOutput", { request_id: observation.request_id, process_observation_digest: observation.observationRef, byte_length: bytes.length, content_seal: contentSeal, custody_tag: custodyTag, service_generation: observation.service_generation }), quarantineRef: `dss04-${observation.observationRef.slice(7)}`, quarantinePath: path.relative(this.store.root, stdoutFile), observationRef: observation.observationRef, leaseRef: lease.leaseRef, state: "QUARANTINED", capturedAt: this.clock() }; this._assertCarrierFields("d.raw-compiler-output", raw); this._save("rawCompilerOutputs", observation.request_id, raw); this._recordTransition("capture-compiler-output", "d.raw-compiler-output", "CAPTURE", raw, "ACCEPTED"); this._recordTransition("capture-compiler-output", "d.raw-compiler-output", "QUARANTINE", raw, "ACCEPTED"); this._persist(); return result("ACCEPTED", { rawOutput: raw });
    } catch (error) { if (capturedObservation) return this._captureCorrupt(capturedObservation, error.code || "capture-failure"); return result("CORRUPT", { errorCode: error.code || "CORRUPT" }); }
  }
  _captureCorrupt(observation, reason) { const raw = { request_id: observation.request_id, process_observation_digest: observation.observationRef, byte_length: 0, content_seal: `sha256:${crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`, custody_tag: this._refFor("CorruptRawOutput", { observation: observation.observationRef, reason }), service_generation: observation.service_generation, rawRef: this._refFor("RawCompilerOutput", { observation: observation.observationRef, reason }), state: "CORRUPT", reason, capturedAt: this.clock() }; this._assertCarrierFields("d.raw-compiler-output", raw); this._save("rawCompilerOutputs", observation.request_id, raw); this._recordTransition("capture-compiler-output", "d.raw-compiler-output", "CORRUPT", raw, "CORRUPT"); this._persist(); return result("CORRUPT", { reason, rawOutput: raw }); }
  _validateCompilerOutputPayload(input = {}) {
    const rawId = input.raw_output_id || input.rawOutputId || input.rawOutput?.rawRef;
    const raw = Object.values(this.state.rawCompilerOutputs).find((value) => value.rawRef === rawId || value.request_id === rawId || value.requestId === rawId);
    if (!raw || !raw.quarantinePath) return null;
    const request = this.state.compilationRequests[raw.request_id] || this.state.compilationRequests[raw.requestId];
    const file = request && path.join(this.store.root, raw.quarantinePath);
    if (!file || !fs.existsSync(file)) return null;
    let output;
    try { output = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return "json"; }
    if (!output || typeof output !== "object" || Array.isArray(output)) return "schema";
    // Generation 8 custody carries only the exact pinned compiler receipt;
    // all derived populations are produced by this normalization boundary.
    // Keep the legacy probe useful by validating that receipt directly.
    if (!Object.hasOwn(output, "compiler_identity_digest")) {
      const modulePath = path.resolve(__dirname, "../../../..", PINNED_COMPILER_MODULE_ASSET_PATH);
      const registry = this.state.registryRevisions[request.project_registry_revision_digest];
      if (!fs.existsSync(modulePath) || !registry) return "semantic-module";
      const normalized = normalizeCompilerReceipt(output, JSON.parse(fs.readFileSync(modulePath, "utf8")), { ...request, project_id: registry.project_id }, SERVICE_GENERATION);
      return ["ADMITTED", "REMANDED"].includes(normalized.status) ? null : normalized.reason;
    }
    const outputFields = new Set(["service_generation", "semantic_input_digest", "dss03_result_seal_digest", "project_registry_revision_digest", "target_snapshot_receipt_digest", "project_evidence_runtime_revision_digest", "compiler_build_pin_digest", "compiler_invocation_contract_digest", "materialization_policy_digest", "compiler_identity_digest", "compiler_identity", "obligations", "routes", "evidence_demands", "exclusions", "static_remands", "obligation_count", "route_count", "evidence_demand_count", "exclusion_count", "static_remand_count", "obligation_population_digest", "route_population_digest", "evidence_demand_population_digest", "exclusion_population_digest", "static_remand_population_digest", "contacts", "contact_occurrence_reconciliation_digest", "input_facts", "input_facts_digest", "exclusion_theorem_digest"]);
    if (Object.keys(output).some((field) => !outputFields.has(field))) return "schema-extra";
    const pin = this.state.pins.compilerBuild;
    const expectedIdentity = pin && this._expectedCompilerIdentity(pin);
    if (output.compiler_identity_digest !== expectedIdentity) return "compiler-identity";
    for (const field of ["service_generation", "semantic_input_digest", "dss03_result_seal_digest", "project_registry_revision_digest", "target_snapshot_receipt_digest", "project_evidence_runtime_revision_digest", "compiler_build_pin_digest", "compiler_invocation_contract_digest", "materialization_policy_digest"]) {
      const expected = field === "service_generation" ? request.service_generation : field === "semantic_input_digest" ? request.semanticInputDigest : request[field];
      if (output[field] !== expected) return "input-identity";
    }
    const identityFields = Object.fromEntries(PIN_FIELDS.map((field) => [field, pin?.[field]]));
    if (canonicalJson(output.compiler_identity || {}) !== canonicalJson(identityFields)) return "compiler-identity-fields";
    const arrays = ["obligations", "routes", "evidence_demands", "exclusions", "static_remands"];
    const digestLabels = { obligations: "ObligationPopulation", routes: "RoutePopulation", evidence_demands: "EvidenceDemandPopulation", exclusions: "ExclusionPopulation", static_remands: "StaticRemandPopulation" };
    for (const field of arrays) {
      if (!Array.isArray(output[field])) return "population-missing";
      const countField = `${field.replaceAll("_", "_")}__count`;
      const conventionalCount = `${field.replace(/s$/, "")}_count`;
      if (output[conventionalCount] !== output[field].length && output[`${field}_count`] !== output[field].length) return "population-count";
      const digestField = { obligations: "obligation_population_digest", routes: "route_population_digest", evidence_demands: "evidence_demand_population_digest", exclusions: "exclusion_population_digest", static_remands: "static_remand_population_digest" }[field];
      const expected = digestObject(`DirectSemanticService.Dss04.${digestLabels[field]}.v1`, output[field]);
      if (output[digestField] !== expected) return "population-digest";
    }
    const stableIds = { obligations: "obligation_id", routes: "route_id", evidence_demands: "evidence_demand_id", exclusions: "exclusion_id" };
    for (const [field, id] of Object.entries(stableIds)) if (!output[field].every((item) => item && typeof item[id] === "string" && item[id] && new Set(output[field].map((value) => value[id])).size === output[field].length)) return "population-identity";
    const exactItemFields = (items, fields) => items.every((item) => item && canonicalJson(Object.keys(item).sort()) === canonicalJson([...fields].sort()));
    if (!exactItemFields(output.routes, ["route_id", "occurrence_id", "owner", "authority_owner", "authority_root", "authority_standing", "project_id", "request_scope_digest", "snapshot_receipt_digest", "input_fact_refs"], "route-provenance")) return "route-provenance";
    if (!exactItemFields(output.contacts || output.contact_occurrences, ["route_id", "occurrence_id"], "contact-reconciliation")) return "contact-reconciliation";
    if (!exactItemFields(output.input_facts || [], ["fact_id", "source_ref"], "input-closure")) return "input-closure";
    const remandFields = ["page_identity", "failed_demand_population_digest", "failed_policy_population_digest", "route_occurrence_population_digest", "evidence_state_digest", "remand_code", "service_generation", "owner", "root", "scope_digest", "standing"];
    if (!exactItemFields(output.static_remands, remandFields, "static-remand")) return "static-remand";
    const remandIdentities = new Set();
    if (output.static_remands.some((remand) => remand.owner !== "dss04-remand-owner" || remand.root !== "dss04-remand-root" || remand.service_generation !== output.service_generation || remand.scope_digest !== request.requested_route_scope_digest || remand.standing !== "KNOWN_INSUFFICIENT" || !remand.remand_code || !/^sha256:[0-9a-f]{64}$/.test(remand.page_identity) || !/^sha256:[0-9a-f]{64}$/.test(remand.failed_demand_population_digest) || !/^sha256:[0-9a-f]{64}$/.test(remand.failed_policy_population_digest) || !/^sha256:[0-9a-f]{64}$/.test(remand.route_occurrence_population_digest) || !/^sha256:[0-9a-f]{64}$/.test(remand.evidence_state_digest))) return "static-remand";
    for (const remand of output.static_remands) { const identity = digestObject("DirectSemanticService.Dss04.KnownInsufficiencyRemand.v1", Object.fromEntries(remandFields.map((field) => [field, remand[field]]))); if (remandIdentities.has(identity)) return "static-remand"; remandIdentities.add(identity); }
    const registry = this.state.registryRevisions[request.project_registry_revision_digest];
    const routeFields = new Set(["route_id", "occurrence_id", "owner", "authority_owner", "authority_root", "authority_standing", "project_id", "request_scope_digest", "snapshot_receipt_digest", "input_fact_refs"]);
    if (output.routes.some((route) => !route || Object.keys(route).some((field) => !routeFields.has(field)) || route.owner !== ROUTE_AUTHORITY_OWNER || route.authority_owner !== ROUTE_AUTHORITY_OWNER || route.authority_root !== ROUTE_AUTHORITY_ROOT || route.authority_standing !== "PINNED" || route.project_id !== registry?.project_id || route.request_scope_digest !== request.requested_route_scope_digest || route.snapshot_receipt_digest !== request.target_snapshot_receipt_digest)) return "route-provenance";
    const demandAssignments = output.evidence_demands.map((demand) => output.routes.filter((route) => demand.route_id === route.route_id || demand.occurrence_id === route.occurrence_id || demand.route_occurrence_id === route.occurrence_id).length);
    if (demandAssignments.some((count) => count !== 1)) return "evidence-demand-closure";
    const contacts = output.contacts || output.contact_occurrences;
    if (!Array.isArray(contacts)) return "contact-population";
    if (output.routes.some((route) => typeof route.occurrence_id !== "string" || !route.occurrence_id || Array.isArray(route.occurrence_ids)) || new Set(output.routes.map((route) => route.occurrence_id)).size !== output.routes.length) return "contact-reconciliation";
    const contactFields = new Set(["route_id", "occurrence_id"]);
    if (contacts.length !== output.routes.length || contacts.some((contact) => !contact || Object.keys(contact).some((field) => !contactFields.has(field)) || typeof contact.route_id !== "string" || typeof contact.occurrence_id !== "string")) return "contact-reconciliation";
    const routeOccurrences = output.routes.map((route) => ({ route_id: route.route_id, occurrence_id: route.occurrence_id }));
    const contactOccurrences = contacts.map((contact) => ({ route_id: contact.route_id, occurrence_id: contact.occurrence_id }));
    if (canonicalJson(routeOccurrences) !== canonicalJson(contactOccurrences)) return "contact-reconciliation";
    if (output.contact_occurrence_reconciliation_digest !== digestObject("DirectSemanticService.Dss04.ContactOccurrenceReconciliation.v1", contacts)) return "contact-digest";
    // Compiler output is untrusted.  An inline evidence object is not an
    // admitted evidence-runtime artifact and cannot become page custody by
    // merely being copied into an evidence demand.  The frozen lane has no
    // inline-evidence admission transition, so reject this output before it
    // can create a bundle or route set.
    if (output.evidence_demands.some((demand) => demand && (Object.prototype.hasOwnProperty.call(demand, "evidence_object") || Object.prototype.hasOwnProperty.call(demand, "evidenceObject")))) return "evidence-demand-closure";
    if (!Array.isArray(output.input_facts) || output.input_facts.some((fact) => !fact || typeof fact.fact_id !== "string" || !fact.fact_id || typeof fact.source_ref !== "string" || ![request.requestRef, request.dss03_result_seal_digest, request.project_registry_revision_digest, request.target_snapshot_receipt_digest, request.project_evidence_runtime_revision_digest, request.compiler_build_pin_digest].includes(fact.source_ref))) return "input-closure";
    const factIds = new Set(output.input_facts.map((fact) => fact.fact_id));
    if (factIds.size !== output.input_facts.length) return "input-closure";
    if (output.routes.some((route) => !Array.isArray(route.input_fact_refs) || route.input_fact_refs.length === 0 || route.input_fact_refs.some((ref) => !factIds.has(ref)))) return "input-closure";
    if (output.input_facts_digest !== digestObject("DirectSemanticService.Dss04.InputFactPopulation.v1", output.input_facts)) return "input-closure-digest";
    if (!exactItemFields(output.exclusions, ["exclusion_id", "theorem"])) return "exclusion-theorem";
    if (output.exclusions.some((exclusion) => !exclusion || !exclusion.theorem || exclusion.theorem.owner !== "direct-project-owner" || exclusion.theorem.root !== "owner-installed-dss04-contract-authority-root" || !["NON_REACHABILITY", "SEMANTIC_IRRELEVANCE"].includes(exclusion.theorem.kind) || exclusion.theorem.verified !== true || !exclusion.theorem.reference || exclusion.theorem.reference.generation !== output.service_generation || exclusion.theorem.reference.snapshot !== request.target_snapshot_receipt_digest || exclusion.theorem.reference.scope !== request.requested_route_scope_digest || !/^sha256:[0-9a-f]{64}$/.test(exclusion.theorem.reference.ownerReceiptDigest || "") || canonicalJson(this.protectedCommitments.exclusionTheorems[exclusion.exclusion_id] || null) !== canonicalJson(exclusion.theorem))) return "exclusion-theorem";
    if (output.exclusion_theorem_digest !== digestObject("DirectSemanticService.Dss04.ExclusionTheorem.v1", output.exclusions)) return "exclusion-theorem";
    return null;
  }
  _secureAdmitCompilerOutputV3(input = {}) {
    try {
      const rawId = input.raw_output_id || input.rawOutputId || input.rawOutput?.rawRef;
      const raw = Object.values(this.state.rawCompilerOutputs).find((value) => value.rawRef === rawId || value.request_id === rawId || value.requestId === rawId);
      if (!raw || !raw.quarantinePath) return result("STALE_PREDECESSOR");
      const request = this.state.compilationRequests[raw.request_id]; const observation = request && this.state.observations[request.request_id];
      if (!request || !observation || raw.process_observation_digest !== observation.observationRef) return result("STALE_PREDECESSOR");
      const file = path.join(this.store.root, raw.quarantinePath); if (!fs.existsSync(file)) return this._admitOutputReject(raw, "missing-quarantine", "OUTPUT_REJECTED");
      let receipt; try { receipt = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return this._admitOutputReject(raw, "json", "OUTPUT_REJECTED"); }
      const generation = this._ready(input); if (!generation) return this._admitOutputReject(raw, "service-generation", "POPULATION_MISMATCH");
      const modulePath = path.resolve(__dirname, "../../../..", PINNED_COMPILER_MODULE_ASSET_PATH);
      if (!fs.existsSync(modulePath)) return this._admitOutputReject(raw, "semantic-module", "POPULATION_MISMATCH");
      const semanticModule = JSON.parse(fs.readFileSync(modulePath, "utf8"));
      const registry = this.state.registryRevisions[request.project_registry_revision_digest];
      if (!registry) return this._admitOutputReject(raw, "project-registry", "POPULATION_MISMATCH");
      const normalized = normalizeCompilerReceipt(receipt, semanticModule, { ...request, project_id: registry.project_id }, generation.generationRef);
      if (!["ADMITTED", "REMANDED"].includes(normalized.status)) return this._admitOutputReject(raw, normalized.reason, normalized.status === "POPULATION_MISMATCH" ? "POPULATION_MISMATCH" : "OUTPUT_REJECTED");
      const identity = { request_id: request.request_id, semantic_input_digest: request.semanticInputDigest, compiler_identity_digest: this._expectedCompilerIdentity(this.state.pins.compilerBuild), source_receipt_digest: normalized.sourceReceiptDigest, normalization_revision: NORMALIZATION_REVISION, obligation_population_digest: normalized.normalizationReceipt.obligation_population_digest, route_population_digest: normalized.normalizationReceipt.route_population_digest, input_fact_population_digest: normalized.normalizationReceipt.input_fact_population_digest, contact_occurrence_reconciliation_digest: normalized.normalizationReceipt.contact_occurrence_reconciliation_digest, evidence_demand_population_digest: normalized.normalizationReceipt.evidence_demand_population_digest, exclusion_population_digest: normalized.normalizationReceipt.exclusion_population_digest, static_remand_population_digest: normalized.normalizationReceipt.static_remand_population_digest, content_seal: raw.content_seal, service_generation: generation.generationRef };
      const disposition = { status: normalized.status, reason: normalized.reason, sourceReceiptDigest: normalized.sourceReceiptDigest, authorityEffect: normalized.authorityEffect };
      const bundle = { ...identity, ...disposition, state: normalized.status, bundleRef: this._refFor("CompilerOutputBundle", identity), rawRef: raw.rawRef, sourceReceipt: clone(receipt), normalizationReceipt: clone(normalized.normalizationReceipt), obligations: clone(normalized.obligations), input_facts: clone(normalized.inputFacts), evidence_demands: clone(normalized.evidenceDemands), exclusions: clone(normalized.exclusions), static_remands: clone(normalized.staticRemands), admittedAt: this.clock() };
      const routeIdentity = { compiler_output_bundle_digest: bundle.bundleRef, ordered_route_population_digest: identity.route_population_digest, occurrence_population_digest: normalized.normalizationReceipt.occurrence_population_digest, contact_occurrence_reconciliation_digest: identity.contact_occurrence_reconciliation_digest, exclusion_theorem_digest: identity.exclusion_population_digest, normalization_receipt_digest: normalized.normalizationReceipt.normalization_receipt_digest, service_generation: generation.generationRef };
      const routeSet = { ...routeIdentity, ...disposition, routeSetRef: this._refFor("CompiledRouteSet", routeIdentity), state: normalized.status, routes: clone(normalized.routes), contacts: clone(normalized.contacts), input_facts: clone(normalized.inputFacts), input_facts_digest: identity.input_fact_population_digest, evidence_demands: clone(normalized.evidenceDemands), evidence_demand_population_digest: identity.evidence_demand_population_digest, exclusions: clone(normalized.exclusions), static_remands: clone(normalized.staticRemands), request_id: request.request_id, normalizationReceipt: clone(normalized.normalizationReceipt), admittedAt: this.clock() };
      this._assertCarrierFields("d.compiler-output-bundle", bundle); this._assertCarrierFields("d.compiled-route-set", routeSet);
      const prior = this.state.outputBundles[request.request_id]; if (prior) return prior.bundleRef === bundle.bundleRef ? result("REPLAYED", { bundle: clone(prior), routeSet: clone(this.state.routeSets[request.request_id]) }) : result("IDEMPOTENCY_CONFLICT");
      this._save("outputBundles", request.request_id, bundle); this._save("routeSets", request.request_id, routeSet); const event = normalized.status === "REMANDED" ? "REMAND" : "ADMIT"; this._recordTransition("admit-compiler-output", "d.compiler-output-bundle", event, bundle, normalized.status); this._recordTransition("admit-compiler-output", "d.compiled-route-set", event, routeSet, normalized.status); this._persist(); return result(normalized.status, { bundle, routeSet, normalization: normalized });
    } catch (error) { return result(error.code === "DSS04_SQLITE_INJECTED_FAILURE" ? "STALE_PREDECESSOR" : "OUTPUT_REJECTED", { errorCode: error.code || "OUTPUT_REJECTED" }); }
  }
  _secureAdmitCompilerOutput(input = {}) {
    if (SERVICE_GENERATION === "sha256:f3f7d115b7d8d3f39665c8afddedaa38d3ae1ba4fe91c294270806867594b019") return this._secureAdmitCompilerOutputV3(input);
    const violation = this._validateCompilerOutputPayload(input);
    if (violation) {
      const rawId = input.raw_output_id || input.rawOutputId || input.rawOutput?.rawRef;
      const raw = Object.values(this.state.rawCompilerOutputs).find((value) => value.rawRef === rawId || value.request_id === rawId || value.requestId === rawId);
      const populationFailure = new Set(["population-missing", "population-count", "population-digest", "population-identity", "contact-population", "contact-reconciliation", "contact-digest", "evidence-demand-closure"]);
      return raw ? this._admitOutputReject(raw, violation, populationFailure.has(violation) ? "POPULATION_MISMATCH" : "OUTPUT_REJECTED") : result("STALE_PREDECESSOR");
    }
    const rawId = input.raw_output_id || input.rawOutputId || input.rawOutput?.rawRef;
    const raw = Object.values(this.state.rawCompilerOutputs).find((value) => value.rawRef === rawId || value.request_id === rawId || value.requestId === rawId);
    let admissionInputs = null;
    if (raw?.quarantinePath) {
      try {
        const output = JSON.parse(fs.readFileSync(path.join(this.store.root, raw.quarantinePath), "utf8"));
        const facts = output?.input_facts;
        const demands = output?.evidence_demands;
        if (Array.isArray(facts) && Array.isArray(demands) && output.input_facts_digest === digestObject("DirectSemanticService.Dss04.InputFactPopulation.v1", facts) && output.evidence_demand_population_digest === digestObject("DirectSemanticService.Dss04.EvidenceDemandPopulation.v1", demands)) {
          admissionInputs = { input_facts: clone(facts), evidence_demands: clone(demands), input_facts_digest: output.input_facts_digest, evidence_demand_population_digest: output.evidence_demand_population_digest };
        }
      } catch (_) { /* V2 owns canonical/quarantine rejection. */ }
    }
    this._admissionMaterializationInputs = admissionInputs;
    try { return this._secureAdmitCompilerOutputV2(input); } finally { this._admissionMaterializationInputs = null; }
  }
  _secureAdmitCompilerOutputV2(input = {}) {
    try {
      const rawId = input.raw_output_id || input.rawOutputId || input.rawOutput?.rawRef; const raw = Object.values(this.state.rawCompilerOutputs).find((value) => value.rawRef === rawId || value.rawRef === input.rawOutputId || value.request_id === rawId || value.requestId === rawId); if (!raw) return result("STALE_PREDECESSOR"); const request = this.state.compilationRequests[raw.request_id] || this.state.compilationRequests[raw.requestId]; const observation = request && (this.state.observations[request.request_id] || this.state.observations[request.requestId]); if (!request || !observation || raw.process_observation_digest !== observation.observationRef) return result("STALE_PREDECESSOR"); const file = path.join(this.store.root, raw.quarantinePath); if (!fs.existsSync(file)) return this._admitOutputReject(raw, "missing-quarantine", "OUTPUT_REJECTED"); const bytes = fs.readFileSync(file); if (`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` !== raw.content_seal || bytes.length !== raw.byte_length) return this._admitOutputReject(raw, "quarantine-seal", "OUTPUT_REJECTED"); let output; try { output = JSON.parse(bytes.toString("utf8")); } catch (_) { return this._admitOutputReject(raw, "json", "OUTPUT_REJECTED"); } if (!output || typeof output !== "object" || Array.isArray(output) || canonicalJson(output) !== bytes.toString("utf8")) return this._admitOutputReject(raw, "canonical-schema", "OUTPUT_REJECTED"); const generation = this._ready(input); if (!generation || output.service_generation !== request.service_generation || output.semantic_input_digest !== request.semanticInputDigest || output.compiler_build_pin_digest !== request.compiler_build_pin_digest) return this._admitOutputReject(raw, "identity", "OUTPUT_REJECTED"); const arrays = ["obligations", "routes", "evidence_demands", "exclusions", "static_remands"]; if (arrays.some((field) => !Array.isArray(output[field]))) return this._admitOutputReject(raw, "population-missing", "POPULATION_MISMATCH"); const unique = (items, key) => items.every((item) => item && typeof item[key] === "string" && item[key]) && new Set(items.map((item) => item[key])).size === items.length; if (!unique(output.routes, "route_id") || !unique(output.obligations, "obligation_id") || !unique(output.evidence_demands, "evidence_demand_id") || !unique(output.exclusions, "exclusion_id")) return this._admitOutputReject(raw, "population-identity", "POPULATION_MISMATCH"); const dig = (label, value) => digestObject(`DirectSemanticService.Dss04.${label}.v1`, value); const declared = { obligation_population_digest: dig("ObligationPopulation", output.obligations), route_population_digest: dig("RoutePopulation", output.routes), evidence_demand_population_digest: dig("EvidenceDemandPopulation", output.evidence_demands), exclusion_population_digest: dig("ExclusionPopulation", output.exclusions), static_remand_population_digest: dig("StaticRemandPopulation", output.static_remands) }; for (const [field, expected] of Object.entries(declared)) if (output[field] !== expected) return this._admitOutputReject(raw, "population-digest", "POPULATION_MISMATCH"); const compilerIdentity = output.compiler_identity_digest; if (typeof compilerIdentity !== "string" || !/^sha256:[0-9a-f]{64}$/.test(compilerIdentity)) return this._admitOutputReject(raw, "compiler-identity", "OUTPUT_REJECTED"); const routeOccurrenceDigest = dig("OrderedRoutePopulation", output.routes); const occurrenceDigest = dig("OccurrencePopulation", output.routes.map((route) => route.occurrence_id || route.route_id)); const contacts = Array.isArray(output.contacts) ? output.contacts : []; const contactDigest = dig("ContactOccurrenceReconciliation", contacts); const exclusionDigest = dig("ExclusionTheorem", output.exclusions); const bundleIdentity = { request_id: request.request_id, semantic_input_digest: request.semanticInputDigest, compiler_identity_digest: compilerIdentity, ...declared, content_seal: raw.content_seal, service_generation: generation.generationRef }; const bundle = { ...bundleIdentity, bundleRef: this._refFor("CompilerOutputBundle", bundleIdentity), state: output.static_remands.length ? "REMANDED" : "ADMITTED", rawRef: raw.rawRef, admittedAt: this.clock() }; const routeIdentity = { compiler_output_bundle_digest: bundle.bundleRef, ordered_route_population_digest: routeOccurrenceDigest, occurrence_population_digest: occurrenceDigest, contact_occurrence_reconciliation_digest: contactDigest, exclusion_theorem_digest: exclusionDigest, service_generation: generation.generationRef }; const routeSet = { ...routeIdentity, routeSetRef: this._refFor("CompiledRouteSet", routeIdentity), state: bundle.state, routes: clone(output.routes), request_id: request.request_id, admittedAt: this.clock() }; this._assertCarrierFields("d.compiler-output-bundle", bundle); this._assertCarrierFields("d.compiled-route-set", routeSet); const prior = this.state.outputBundles[request.request_id]; if (prior) return prior.bundleRef === bundle.bundleRef ? result("REPLAYED", { bundle: clone(prior), routeSet: clone(this.state.routeSets[request.request_id]) }) : result("IDEMPOTENCY_CONFLICT"); this._save("outputBundles", request.request_id, bundle); this._save("routeSets", request.request_id, routeSet); const outcome = bundle.state === "REMANDED" ? "REMANDED" : "ADMITTED"; const event = bundle.state === "REMANDED" ? "REMAND" : "ADMIT"; this._recordTransition("admit-compiler-output", "d.compiler-output-bundle", event, bundle, outcome); this._recordTransition("admit-compiler-output", "d.compiled-route-set", event, routeSet, outcome); this._persist(); return result(outcome, { bundle, routeSet });
    } catch (error) { return result("OUTPUT_REJECTED", { errorCode: error.code || "OUTPUT_REJECTED" }); }
  }
  _admitOutputReject(raw, reason, outcome) { const requestId = raw.request_id || raw.requestId; const request = this.state.compilationRequests[requestId]; const generation = this._generation(); const identity = { request_id: request?.request_id || requestId, semantic_input_digest: request?.semanticInputDigest || null, compiler_identity_digest: null, obligation_population_digest: null, route_population_digest: null, evidence_demand_population_digest: null, exclusion_population_digest: null, static_remand_population_digest: null, content_seal: raw.content_seal || null, service_generation: request?.service_generation || generation?.generationRef || null }; const bundle = { ...identity, bundleRef: this._refFor("RejectedCompilerOutputBundle", { rawRef: raw.rawRef, reason, identity }), rawRef: raw.rawRef, state: "REJECTED", rejectionReason: reason, rejectedAt: this.clock() }; const routeIdentity = { compiler_output_bundle_digest: bundle.bundleRef, ordered_route_population_digest: null, occurrence_population_digest: null, contact_occurrence_reconciliation_digest: null, exclusion_theorem_digest: null, service_generation: identity.service_generation }; const routeSet = { ...routeIdentity, routeSetRef: this._refFor("RejectedCompiledRouteSet", { rawRef: raw.rawRef, reason, identity: routeIdentity }), state: "REJECTED", rejectionReason: reason, rejectedAt: this.clock() }; this._assertCarrierFields("d.compiler-output-bundle", bundle); this._assertCarrierFields("d.compiled-route-set", routeSet); const prior = this.state.outputBundles[requestId]; if (prior && prior.state === "REJECTED" && prior.rejectionReason === reason) return result("REPLAYED", { bundle: clone(prior), routeSet: clone(this.state.routeSets[requestId]) }); this._save("outputBundles", requestId, bundle); this._save("routeSets", requestId, routeSet); this._recordTransition("admit-compiler-output", "d.compiler-output-bundle", "REJECT", bundle, outcome); this._recordTransition("admit-compiler-output", "d.compiled-route-set", "REJECT", routeSet, outcome); this._persist(); return result(outcome, { reason, bundle, routeSet }); }
  _assertPinnedRuntime(runtime, pin) {
    if (!runtime || runtime.owner !== "dss04-compiler-runtime-owner" || runtime.root !== "pinned-compiler-runtime-root" || runtime.compilerCommit !== PINNED_COMPILER_COMMIT || typeof runtime.compilerRoot !== "string" || typeof runtime.executable !== "string" || typeof runtime.executableDigest !== "string" || typeof runtime.interpreterPath !== "string" || typeof runtime.sandboxExecutable !== "string" || typeof runtime.sandboxExecutableDigest !== "string" || runtime.sandboxExecutableDigest !== SANDBOX_EXECUTABLE_DIGEST || runtime.sandboxProfileDigest !== SANDBOX_PROFILE_DIGEST || runtime.dependencyManifestDigest !== PINNED_RUNTIME_DEPENDENCY_DIGEST) fail("DSS04_RUNTIME_INVALID");
    const absoluteDirectory = (candidate, label) => {
      if (!path.isAbsolute(candidate)) fail("DSS04_RUNTIME_INVALID", `${label}.absolute`);
      let resolved;
      try {
        resolved = fs.realpathSync(candidate);
        if (!fs.statSync(resolved).isDirectory() || path.resolve(candidate) !== resolved) fail("DSS04_RUNTIME_INVALID", `${label}.root`);
      } catch (error) {
        if (error?.code?.startsWith("DSS04_")) throw error;
        fail("DSS04_RUNTIME_INVALID", `${label}.missing`);
      }
      return resolved;
    };
    const compilerRoot = absoluteDirectory(runtime.compilerRoot, "runtime.compilerRoot");
    const fileWithin = (candidate, root, label) => {
      if (!path.isAbsolute(candidate)) fail("DSS04_RUNTIME_INVALID", `${label}.absolute`);
      let resolved;
      try {
        resolved = fs.realpathSync(candidate);
        if (!fs.statSync(resolved).isFile()) fail("DSS04_RUNTIME_INVALID", `${label}.file`);
      } catch (error) {
        if (error?.code?.startsWith("DSS04_")) throw error;
        fail("DSS04_RUNTIME_INVALID", `${label}.missing`);
      }
      if (root) {
        const relative = path.relative(root, resolved);
        if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) fail("DSS04_PIN_MISMATCH", `${label}.outside-root`);
      }
      return resolved;
    };
    const executablePath = fileWithin(runtime.executable, compilerRoot, "runtime.executable");
    const executableDigest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(executablePath)).digest("hex")}`;
    if (runtime.executableDigest !== executableDigest || runtime.executableDigest !== pin.entrypoint_digest || runtime.executableDigest !== PINNED_COMPILER_SOURCE_DIGEST) fail("DSS04_PIN_MISMATCH", "runtime.executable");
    const interpreterPath = fileWithin(runtime.interpreterPath, null, "runtime.interpreter");
    const interpreterDigest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(interpreterPath)).digest("hex")}`;
    if (runtime.interpreterRuntimeDigest !== interpreterDigest || runtime.interpreterDigest !== pin.interpreter_digest) fail("DSS04_PIN_MISMATCH", "runtime.interpreter");
    const sandboxPath = fileWithin(runtime.sandboxExecutable, null, "runtime.sandbox");
    const sandboxDigest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(sandboxPath)).digest("hex")}`;
    if (runtime.sandboxExecutableDigest !== sandboxDigest) fail("DSS04_PIN_MISMATCH", "runtime.sandbox");
    if (!Array.isArray(runtime.dependencyManifest) || canonicalJson(runtime.dependencyManifest) !== canonicalJson(PINNED_RUNTIME_DEPENDENCIES)) fail("DSS04_RUNTIME_INVALID", "runtime.dependencies");
    for (const [dependencyPath, dependencyDigest] of runtime.dependencyManifest) {
      if (!path.isAbsolute(dependencyPath) || !fs.existsSync(dependencyPath) || !fs.statSync(dependencyPath).isFile()) fail("DSS04_RUNTIME_INVALID", dependencyPath);
      const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(dependencyPath)).digest("hex")}`;
      if (actual !== dependencyDigest) fail("DSS04_PIN_MISMATCH", dependencyPath);
    }
    const pairs = [["executableDigest", pin.entrypoint_digest], ["interpreterDigest", pin.interpreter_digest], ["dependencyLockDigest", pin.dependency_lock_digest], ["environmentDigest", pin.installed_environment_digest], ["invocationContractDigest", pin.invocation_contract_digest], ["patternLibraryDigest", pin.pattern_library_digest], ["learningExtensionDigest", pin.learning_extension_digest], ["focusLibraryDigest", pin.focus_library_digest]];
    for (const [field, expected] of pairs) if (runtime[field] !== expected) fail("DSS04_PIN_MISMATCH", `runtime.${field}`);
    if (runtime.interpreter && typeof runtime.interpreter !== "string") fail("DSS04_RUNTIME_INVALID");
    return { compilerRoot, executablePath, interpreterPath, sandboxPath };
  }
  _expectedCompilerIdentity(pin) {
    return this._refFor("CompilerIdentity", Object.fromEntries(PIN_FIELDS.map((field) => [field, pin[field]])));
  }
  _runPinnedCompiler(envelope, runtime) {
    const pin = envelope.compilerPin; const provisioned = this._assertPinnedRuntime(runtime, pin); if (!fs.existsSync(provisioned.executablePath) || !fs.statSync(provisioned.executablePath).isFile()) fail("DSS04_COMPILER_FAILED");
    const work = fs.mkdtempSync(path.join(this.store.root, "dss04-compiler-")); const inputPath = path.join(work, "request.json"); fs.writeFileSync(inputPath, canonicalJson(envelope), { mode: 0o600 });
    for (const artifact of envelope.artifacts || []) { if (!artifact.canonical_relative_path || artifact.canonical_relative_path.startsWith("/") || artifact.canonical_relative_path.includes("..") || artifact.bytesBase64 === undefined) fail("DSS04_ISOLATION_FAILED"); const target = path.join(work, artifact.canonical_relative_path); if (!target.startsWith(`${work}${path.sep}`)) fail("DSS04_ISOLATION_FAILED"); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, Buffer.from(artifact.bytesBase64, "base64"), { mode: 0o600 }); }
    // The target snapshot is an input population, never the executable
    // compiler.  Stage only the exact external compiler files from its pinned
    // commit; no caller/compiler-derived populations are accepted as inputs.
    let compilerStatus;
    let compilerHead;
    try {
      compilerStatus = execFileSync(GIT_EXECUTABLE, ["-C", provisioned.compilerRoot, "status", "--porcelain", "--untracked-files=no"], { env: {} }).toString();
      compilerHead = execFileSync(GIT_EXECUTABLE, ["-C", provisioned.compilerRoot, "rev-parse", "HEAD"], { env: {} }).toString().trim();
    } catch (_) {
      fail("DSS04_PIN_MISMATCH", "compiler-custody");
    }
    if (compilerHead !== PINNED_COMPILER_COMMIT || compilerStatus) fail("DSS04_PIN_MISMATCH", "compiler-custody");
    const compilerFile = (relative, label) => {
      const candidate = path.join(provisioned.compilerRoot, relative);
      if (!fs.existsSync(candidate)) fail("DSS04_PIN_MISMATCH", `${label}.missing`);
      let source;
      try {
        source = fs.realpathSync(candidate);
        if (!fs.statSync(source).isFile()) fail("DSS04_PIN_MISMATCH", `${label}.file`);
      } catch (error) {
        if (error?.code?.startsWith("DSS04_")) throw error;
        fail("DSS04_PIN_MISMATCH", `${label}.missing`);
      }
      const relativeSource = path.relative(provisioned.compilerRoot, source);
      if (relativeSource.startsWith(`..${path.sep}`) || relativeSource === ".." || path.isAbsolute(relativeSource)) fail("DSS04_PIN_MISMATCH", `${label}.outside-root`);
      return source;
    };
    const sourcePath = compilerFile(PINNED_COMPILER_SOURCE_PATH, "compiler.source-image");
    const sourceRelative = path.relative(provisioned.compilerRoot, sourcePath);
    if (sourceRelative.startsWith(`..${path.sep}`) || sourceRelative === ".." || path.isAbsolute(sourceRelative) || `sha256:${crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex")}` !== PINNED_COMPILER_SOURCE_DIGEST) fail("DSS04_PIN_MISMATCH", "compiler.source-image");
    const modulePath = path.resolve(__dirname, "../../../..", PINNED_COMPILER_MODULE_ASSET_PATH);
    const sourceFiles = PINNED_COMPILER_ARTIFACTS.map(([relative]) => [compilerFile(relative, `compiler-artifact:${relative}`), relative]);
    sourceFiles.push([modulePath, PINNED_COMPILER_MODULE_PATH]);
    for (const [source, targetName] of sourceFiles) { if (!fs.existsSync(source)) fail("DSS04_PIN_MISMATCH", `compiler-artifact:${targetName}`); const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")}`; const expected = targetName === PINNED_COMPILER_MODULE_PATH ? SEMANTIC_MODULE_BYTES_DIGEST : PINNED_COMPILER_ARTIFACTS.find(([relative]) => relative === targetName)?.[1]; if (expected && actual !== expected) fail("DSS04_PIN_MISMATCH", `compiler-artifact:${targetName}`); const target = path.join(work, targetName); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.copyFileSync(source, target); }
    const interpreterInWork = path.join(work, "runtime", "interpreter");
    fs.mkdirSync(path.dirname(interpreterInWork), { recursive: true, mode: 0o700 });
    fs.copyFileSync(provisioned.interpreterPath, interpreterInWork);
    const command = ["/work/runtime/interpreter", "/work/scripts/dev/compile_semantic_contract_learning_v1.py", "/work/docs/audits/direct-semantic-service-dss04-generation-8/module.v0.json", "--patterns", "/work/meta/semantic_compiler/pattern_library.v0.json", "--pattern-extension", "/work/meta/semantic_compiler/audit_learning_patterns.v1.json"];
    const args = ["--die-with-parent", "--unshare-net", "--clearenv", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--bind", work, "/work", "--chdir", "/work"];
    const launchReceipt = { sandboxExecutable: runtime.sandboxExecutable, sandboxExecutableDigest: SANDBOX_EXECUTABLE_DIGEST, sandboxProfile: SANDBOX_PROFILE, sandboxProfileDigest: SANDBOX_PROFILE_DIGEST, dependencyManifestDigest: PINNED_RUNTIME_DEPENDENCY_DIGEST, command: [runtime.sandboxExecutable, ...args, ...command], environment: {} };
    const child = spawnSync(runtime.sandboxExecutable, [...args, ...command], { env: {}, stdio: ["ignore", "pipe", "pipe"], shell: false, timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
    if (child.error) { const error = new Error(child.error.message); error.code = "DSS04_COMPILER_FAILED"; throw error; } return { exitCode: child.status === null ? 1 : child.status, signal: child.signal, stdout: child.stdout || Buffer.alloc(0), stderr: child.stderr || Buffer.alloc(0), processId: `spawn:${runtime.executableDigest}:${child.status === null ? "unknown" : child.status}`, resource: { timedOut: child.error?.code === "ETIMEDOUT" }, isolation: { ...SANDBOX_PROFILE, launchReceiptDigest: digestObject("DirectSemanticService.Dss04.LaunchReceipt.v1", launchReceipt), dependencyManifestDigest: PINNED_RUNTIME_DEPENDENCY_DIGEST }, launchReceipt };
  }
  _recordIsolationFailureObservation(input, generation, error) {
    const requestId = input.request_id || input.requestId || input.request?.request_id;
    const request = this.state.compilationRequests[requestId] || Object.values(this.state.compilationRequests).find((candidate) => candidate.request_id === requestId);
    const leaseId = input.lease_id || input.leaseId || input.lease?.leaseRef || input.lease?.lease_id || input.lease?.leaseId;
    const lease = Object.values(this.state.leases).find((candidate) => candidate.leaseRef === leaseId || candidate.leaseId === leaseId);
    if (!request || !lease || lease.requestId !== request.request_id || lease.state !== "HELD") return null;
    const prior = this.state.observations[request.request_id];
    if (prior) return prior.state === "ISOLATION_FAILED" ? prior : null;
    const registry = this.state.registryRevisions[request.project_registry_revision_digest];
    const snapshot = this.state.snapshotReceipts[request.target_snapshot_receipt_digest];
    const runtime = this.state.evidenceRuntimes[request.project_evidence_runtime_revision_digest];
    const inputCustodyDigest = this._refFor("CompilerInputPopulation", { request: request.requestRef, registry: registry?.revisionRef || request.project_registry_revision_digest, snapshot: snapshot?.receiptRef || request.target_snapshot_receipt_digest, runtime: runtime?.runtimeRef || request.project_evidence_runtime_revision_digest, artifactRefs: snapshot?.artifactRefs || [] });
    const emptySeal = `sha256:${crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`;
    const observation = { schema: "direct_semantic_service_dss04_compiler_process_observation@1", request_id: request.request_id, service_generation: generation.generationRef, process_identity: `isolation-failed:${request.request_id}:${lease.fencing_token}`, start_monotonic_time: process.hrtime.bigint().toString(), end_monotonic_time: process.hrtime.bigint().toString(), exit_status: null, stdout_byte_count: 0, stdout_seal: emptySeal, stderr_byte_count: 0, stderr_seal: emptySeal, resource_accounting_digest: this._refFor("CompilerResourceAccounting", {}), isolation_observation: { ...SANDBOX_PROFILE, failure: error.code || "DSS04_RUNTIME_INVALID" }, input_custody_digest: inputCustodyDigest, output_custody_digest: emptySeal, observationRef: null, requestRef: request.requestRef, leaseRef: lease.leaseRef, state: "ISOLATION_FAILED", startedAt: this.clock(), endedAt: this.clock(), failureCode: error.code || "DSS04_RUNTIME_INVALID" };
    observation.observationRef = this._refFor("CompilerProcessObservation", Object.fromEntries([...DSS04_CARRIER_FIELD_MAP["e.compiler-process-observation"].stable, DSS04_CARRIER_FIELD_MAP["e.compiler-process-observation"].generation].map((key) => [key, observation[key]])));
    this._assertCarrierFields("e.compiler-process-observation", observation);
    this._save("observations", request.request_id, observation);
    this._recordTransition("execute-pinned-compilation", "e.compiler-process-observation", "FAIL_ISOLATION", observation, "ISOLATION_FAILED");
    this._persist();
    return observation;
  }
  executePinnedCompilation(input = {}) {
    try {
      const generation = this._ready(input); if (!generation) return result("STALE_GENERATION"); const refs = this._executionInputs(input); if (!refs) return result("STALE_PREDECESSOR"); const { request, lease, snapshot, runtime, registry, pin, artifacts } = refs; if (new Date(lease.expires_at).getTime() <= new Date(this.clock()).getTime()) return result("STALE_PREDECESSOR"); this._assertPinnedRuntime(this.compilerRuntime, pin);
      const prior = this.state.observations[request.request_id]; if (prior && prior.state === "TERMINATED") return result("REPLAYED", { observation: clone(prior) }); if (prior && prior.state === "RUNNING") return result("REPLAYED", { observation: clone(prior) });
      const inputCustodyDigest = this._refFor("CompilerInputPopulation", { request: request.requestRef, registry: registry.revisionRef, snapshot: snapshot.receiptRef, runtime: runtime.runtimeRef, artifactRefs: snapshot.artifactRefs }); const emptySeal = `sha256:${crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`; const running = { schema: "direct_semantic_service_dss04_compiler_process_observation@1", request_id: request.request_id, service_generation: generation.generationRef, process_identity: `pending:${request.request_id}:${lease.fencing_token}`, start_monotonic_time: process.hrtime.bigint().toString(), end_monotonic_time: null, exit_status: null, stdout_byte_count: 0, stdout_seal: emptySeal, stderr_byte_count: 0, stderr_seal: emptySeal, resource_accounting_digest: this._refFor("CompilerResourceAccounting", {}), isolation_observation: { network: false, credentials: false, checkout: false, inheritedEnvironment: false, inheritedFileDescriptors: false, cache: false, userConfiguration: false }, input_custody_digest: inputCustodyDigest, output_custody_digest: emptySeal, observationRef: null, requestRef: request.requestRef, leaseRef: lease.leaseRef, state: "RUNNING", startedAt: this.clock() }; running.observationRef = this._refFor("CompilerProcessObservation", Object.fromEntries([...DSS04_CARRIER_FIELD_MAP["e.compiler-process-observation"].stable, DSS04_CARRIER_FIELD_MAP["e.compiler-process-observation"].generation].map((key) => [key, running[key]]))); this._assertCarrierFields("e.compiler-process-observation", running);
      // The START cut is durable before the child process is invoked.  The
      // generation-8 transition population has no provisional START outcome;
      // COMPLETE is the declared reservation outcome and is followed by the
      // terminal TERMINATE/INTERRUPT outcome after observation.
      this.state.observations[request.request_id] = running;
      this._recordTransition("execute-pinned-compilation", "e.compiler-process-observation", "START", running, "COMPLETE");
      this._persist();
      if (request.state === "CANCEL_REQUESTED") { running.state = "INTERRUPTED"; running.end_monotonic_time = process.hrtime.bigint().toString(); this.state.observations[request.request_id] = running; this._recordTransition("execute-pinned-compilation", "e.compiler-process-observation", "INTERRUPT", running, "CANCELLATION_REQUESTED"); this._persist(); return result("CANCELLATION_REQUESTED", { observation: running }); }
      let observed; try { observed = this._runPinnedCompiler(deepFreeze({ schema: "direct_semantic_service_dss04_compiler_input@1", generation: generation.generationRef, request: clone(request), compilerPin: clone(pin), registry: clone(registry), snapshot: clone(snapshot), runtime: clone(runtime), artifacts: artifacts.map((artifact) => ({ ...artifact, bytesBase64: artifact.bytesBase64 })) }), this.compilerRuntime); } catch (error) { if (error.code === "DSS04_EXECUTION_CRASH_AFTER_START") return result("BLOCKED", { observation: clone(running) }); observed = { exitCode: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from(error.message || "compiler failed"), processId: `spawn-failed:${this.compilerRuntime.executableDigest}`, resource: {}, isolation: { network: false, credentials: false, checkout: false, inheritedEnvironment: false, inheritedFileDescriptors: false, cache: false, userConfiguration: false } }; }
      const stdout = Buffer.isBuffer(observed.stdout) ? observed.stdout : Buffer.from(observed.stdout || ""); const stderr = Buffer.isBuffer(observed.stderr) ? observed.stderr : Buffer.from(observed.stderr || ""); const stdoutSeal = `sha256:${crypto.createHash("sha256").update(stdout).digest("hex")}`; const stderrSeal = `sha256:${crypto.createHash("sha256").update(stderr).digest("hex")}`; const outputCustodyDigest = this._refFor("CompilerOutputCustody", { stdoutSeal, stderrSeal, stdoutByteCount: stdout.length, stderrByteCount: stderr.length }); const isolation = observed.isolation || {}; const isolationFailure = Object.values(isolation).some((value) => value === true && ["network", "credentials", "checkout", "inheritedEnvironment", "inheritedFileDescriptors", "cache", "userConfiguration"].includes(Object.keys(isolation).find((key) => isolation[key] === value))); const outcome = isolationFailure ? "ISOLATION_FAILED" : observed.signal === "SIGTERM" ? "CANCELLATION_REQUESTED" : observed.exitCode === 0 ? "COMPLETE" : "COMPILER_FAILED"; const processIdentity = observed.processId || `spawn:${this.compilerRuntime.executableDigest}:${observed.exitCode}`; const terminal = { ...running, process_identity: processIdentity, end_monotonic_time: process.hrtime.bigint().toString(), exit_status: observed.exitCode, stdout_byte_count: stdout.length, stdout_seal: stdoutSeal, stderr_byte_count: stderr.length, stderr_seal: stderrSeal, resource_accounting_digest: this._refFor("CompilerResourceAccounting", observed.resource || {}), isolation_observation: clone(isolation), output_custody_digest: outputCustodyDigest, state: outcome === "CANCELLATION_REQUESTED" ? "INTERRUPTED" : outcome === "ISOLATION_FAILED" ? "ISOLATION_FAILED" : "TERMINATED", endedAt: this.clock() }; terminal.observationRef = this._refFor("CompilerProcessObservation", Object.fromEntries([...DSS04_CARRIER_FIELD_MAP["e.compiler-process-observation"].stable, DSS04_CARRIER_FIELD_MAP["e.compiler-process-observation"].generation].map((key) => [key, terminal[key]]))); this.state.observations[request.request_id] = terminal; const quarantineRoot = path.join(this.store.root, "dss04-process-custody"); fs.mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(quarantineRoot, `${terminal.observationRef.slice(7)}.stdout`), stdout, { mode: 0o600 }); fs.writeFileSync(path.join(quarantineRoot, `${terminal.observationRef.slice(7)}.stderr`), stderr, { mode: 0o600 }); if (outcome === "ISOLATION_FAILED") this._recordTransition("execute-pinned-compilation", "e.compiler-process-observation", "FAIL_ISOLATION", terminal, outcome); else this._recordTransition("execute-pinned-compilation", "e.compiler-process-observation", outcome === "CANCELLATION_REQUESTED" ? "INTERRUPT" : "TERMINATE", terminal, outcome); this._persist(); return result(outcome, { observation: terminal });
    } catch (error) { if (error.code === "DSS04_GENERATION_REQUIRED") return result("STALE_GENERATION"); if (error.code === "DSS04_PIN_MISMATCH" || error.code === "DSS04_RUNTIME_INVALID" || error.code === "DSS04_ISOLATION_FAILED") { const generation = this.state.generations.current; const observation = generation && this._recordIsolationFailureObservation(input, generation, error); return observation ? result("ISOLATION_FAILED", { observation: clone(observation) }) : result("ISOLATION_FAILED"); } return result("COMPILER_FAILED", { errorCode: error.code || "COMPILER_FAILED" }); }
  }
  captureCompilerOutput(input = {}) { return this._secureCaptureCompilerOutput(input); }
  admitCompilerOutput(input = {}) { return this._secureAdmitCompilerOutput(input); }
  _publishSealCas(contentSeal, bytes) {
    const root = path.join(this.store.root, "dss04-seal-cas");
    const file = path.join(root, `${contentSeal.slice(7)}.seal`);
    if (!fs.existsSync(file)) atomicWrite(file, bytes, 0o600);
    const actual = fs.readFileSync(file);
    const seal = `sha256:${crypto.createHash("sha256").update(actual).digest("hex")}`;
    if (seal !== contentSeal || !actual.equals(bytes)) fail("DSS04_SEAL_CAS_INVALID");
    return path.relative(this.store.root, file);
  }
  _batchSealContext(planRef) {
    const plan = Object.values(this.state.materializationPlans).find((row) => row.planRef === planRef);
    if (!plan || plan.service_generation !== SERVICE_GENERATION) return null;
    const routeSet = this.state.routeSets[plan.request_id]; const refs = routeSet && this._materializationReferences(routeSet);
    if (!routeSet || !refs || plan.state !== "INSTANTIATED") return { plan, blocked: "plan-predecessor" };
    const pages = Array.isArray(plan.pages) ? plan.pages : []; const pageRows = []; const completenessRefs = []; const sufficiencyRefs = []; const remandRefs = []; const candidateRefs = []; const errors = [];
    for (const descriptor of pages) {
      const page = this.state.closedEvidencePages[descriptor.page_identity];
      if (!page) { errors.push("page"); continue; }
      if (["REJECTED", "CANCELLED"].includes(page.state)) {
        pageRows.push({ page_identity: descriptor.page_identity, page_ref: page.pageRef, content_seal: page.content_seal || null, event_head: this._recoveryDigest("PageEventHead", this.state.events.filter((event) => event.payload?.page_identity === descriptor.page_identity || event.payload?.pageRef === page.pageRef).map((event) => event.eventDigest)), terminal: page.state === "CANCELLED" ? "CANCELLED_PRESTART" : "REJECTED" });
        continue;
      }
      if (page.state !== "MATERIALIZED") { errors.push("page"); continue; }
      const expectedContent = this._materializationDescriptorContent(plan, descriptor, refs);
      const cas = this._pageCasDocument(page, expectedContent);
      if (cas.status !== "OK") { errors.push(cas.status === "STALE_PREDECESSOR" ? "page-cas-missing" : "page-cas-mismatch"); continue; }
      const completeness = this.state.pageCompletenessReceipts[descriptor.page_identity];
      if (!completeness || completeness.state !== "COMPLETE") { errors.push("completeness"); continue; }
      const sufficiency = this.state.pageSufficiencyReceipts[descriptor.page_identity];
      if (!sufficiency || !["SUFFICIENT", "KNOWN_INSUFFICIENT"].includes(sufficiency.state)) { errors.push("sufficiency"); continue; }
      const evaluation = this._recoveryPageEvaluation(descriptor.page_identity);
      const receiptFields = ["page_identity", "required_route_population_digest", "materialized_route_population_digest", "remanded_route_population_digest", "required_evidence_population_digest", "evidence_reconciliation_digest", "reverse_map_digest", "worker_task_contract_digest", "completeness_receipt_digest", "availability_state_digest", "policy_state_digest", "budget_state_digest", "standing", "service_generation", "receiptRef", "state", "planRef", "pageRef", "runtimeRef", "request_id"];
      const receiptMismatch = (actual, expected) => !expected || receiptFields.some((field) => (field in actual || field in expected) && canonicalJson(actual?.[field]) !== canonicalJson(expected?.[field]));
      if (evaluation.kind || receiptMismatch(completeness, evaluation.completeness) || receiptMismatch(sufficiency, evaluation.sufficiency)) { errors.push("receipt"); continue; }
      completenessRefs.push(completeness.receiptRef); sufficiencyRefs.push(sufficiency.receiptRef);
      if (sufficiency.state === "KNOWN_INSUFFICIENT") {
        const remand = this.state.knownInsufficiencyRemands[descriptor.page_identity];
        if (!remand || remand.state !== "ISSUED" || remand.sufficiencyRef !== sufficiency.receiptRef) { errors.push("remand"); continue; }
        remandRefs.push(remand.remandRef);
      }
      for (const validation of Object.values(this.state.candidateValidationRecords)) if (validation.page_identity === descriptor.page_identity) candidateRefs.push(validation.validationRef);
      pageRows.push({ page_identity: descriptor.page_identity, page_ref: page.pageRef, content_seal: page.content_seal, event_head: this._recoveryDigest("PageEventHead", this.state.events.filter((event) => event.payload?.page_identity === descriptor.page_identity || event.payload?.pageRef === page.pageRef).map((event) => event.eventDigest)), terminal: sufficiency.state === "SUFFICIENT" ? "SUFFICIENT" : "KNOWN_INSUFFICIENT" });
    }
    const accounting = this.state.accounting[plan.request_id];
    if (!accounting || accounting.state !== "FINAL") errors.push("accounting");
    const terminalPartition = plan.partition?.map((entry) => {
      const row = pageRows.find((page) => page.page_identity === entry.page_identity);
      return row ? { occurrence_id: entry.occurrence_id, terminal: row.terminal, page_identity: row.page_identity } : { occurrence_id: entry.occurrence_id, terminal: "REJECTED", reason: entry.reason || "NO_PAGE" };
    }) || [];
    const identity = { materialization_plan_digest: plan.planRef, planned_page_population_digest: this._refFor("BatchPlannedPagePopulation", pageRows.map((row) => row.page_identity)), terminal_coverage_digest: this._refFor("BatchTerminalCoverage", terminalPartition), page_event_heads_digest: this._refFor("BatchPageEventHeads", pageRows.map((row) => ({ page_identity: row.page_identity, event_head: row.event_head }))), receipt_population_digest: this._refFor("BatchReceiptPopulation", { completeness: completenessRefs, sufficiency: sufficiencyRefs }), remand_population_digest: this._refFor("BatchRemandPopulation", remandRefs), candidate_validation_heads_digest: this._refFor("BatchCandidateValidationHeads", candidateRefs.sort()), accounting_digest: accounting ? accounting.accountingRef : this._refFor("MissingAccounting", plan.request_id), service_generation: SERVICE_GENERATION };
    const contentDocument = { schema: "direct_semantic_service_dss04_materialization_batch_seal@1", identity: clone(identity), pages: pageRows, terminal_partition: terminalPartition };
    const contentBytes = Buffer.from(canonicalJson(contentDocument), "utf8");
    identity.content_seal = `sha256:${crypto.createHash("sha256").update(contentBytes).digest("hex")}`;
    return { plan, refs, identity, contentDocument, pageRows, terminalPartition, contentBytes, errors, valid: errors.length === 0 && pageRows.length === pages.length && pages.length > 0 };
  }
  sealMaterializationBatch(input = {}) {
    let before;
    try {
      before = clone(this.state); const generation = this._ready(input); if (!generation) return result("STALE_PREDECESSOR");
      const raw = clone(input.plan || input); const planRef = raw.materialization_plan_digest || raw.plan_ref || raw.planRef || raw.materializationPlan?.planRef; if (typeof planRef !== "string") return result("STALE_PREDECESSOR");
      const context = this._batchSealContext(planRef); if (!context) return result("STALE_PREDECESSOR"); if (context.blocked) return result("BLOCKED");
      const suppliedPages = raw.page_refs || raw.pageRefs; if (suppliedPages !== undefined && canonicalJson(suppliedPages) !== canonicalJson(context.pageRows.map((row) => row.page_ref))) return result("POPULATION_MISMATCH");
      const operation = `seal-materialization-batch:${planRef}`; const operationInput = { plan: planRef, pages: context.pageRows.map((row) => row.page_ref), completeness: context.identity.receipt_population_digest, remands: context.identity.remand_population_digest, candidates: context.identity.candidate_validation_heads_digest, accounting: context.identity.accounting_digest, generation: generation.generationRef }; const key = this._operationKey("seal-materialization-batch", operationInput); const previous = this.state.operationInputs[operation];
      if (previous) {
        const seal = this.state.materializationBatchSeals[previous.ref]; if (previous.inputDigest !== key) return result("IDEMPOTENCY_CONFLICT");
        if (seal?.state === "SEALED" || seal?.state === "BLOCKED") return result("REPLAYED", { seal: clone(seal) });
        if (seal?.state === "PREPARED" && context.valid && canonicalJson(Object.fromEntries(Object.keys(context.identity).map((key) => [key, seal[key]]))) === canonicalJson(context.identity)) {
          const sealed = { ...seal, state: "SEALED", sealedAt: this.clock() }; this._save("materializationBatchSeals", seal.sealRef, sealed); this._recordTransition("seal-materialization-batch", "d.materialization-batch-seal", "SEAL", sealed, "COMPLETE"); this._persist(); return result("COMPLETE", { seal: sealed });
        }
        return result("IDEMPOTENCY_CONFLICT");
      }
      const state = context.valid ? "PREPARED" : "BLOCKED"; const sealIdentity = { ...context.identity, sealRef: this._refFor("MaterializationBatchSeal", context.identity), state, planRef, pageRefs: context.pageRows.map((row) => row.page_ref), terminalPartition: context.terminalPartition, sealPath: this._publishSealCas(context.identity.content_seal, context.contentBytes), preparedAt: this.clock() }; this._assertCarrierFields("d.materialization-batch-seal", sealIdentity); this._save("materializationBatchSeals", sealIdentity.sealRef, sealIdentity); this.state.operationInputs[operation] = { inputDigest: key, ref: sealIdentity.sealRef, operationInput }; const outcome = context.valid ? "ACCEPTED" : "BLOCKED"; this._recordTransition("seal-materialization-batch", "d.materialization-batch-seal", context.valid ? "PREPARE" : "BLOCK", sealIdentity, outcome); this._persist(); return result(outcome, { seal: sealIdentity, reason: context.errors });
    } catch (error) { if (before) this.state = before; if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }
  projectClosedPage(input = {}) {
    try {
      const raw = input.page ? { ...clone(input), ...clone(input.page) } : clone(input); const suppliedGeneration = raw.generation || raw.serviceGeneration; const suppliedGenerationRef = typeof suppliedGeneration === "string" ? suppliedGeneration : suppliedGeneration?.generationRef || suppliedGeneration?.service_generation; const generation = this._generation(); if (!suppliedGenerationRef || !generation || suppliedGenerationRef !== SERVICE_GENERATION) return result("STALE_GENERATION");
      const pageIdentity = raw.page_identity || raw.pageIdentity; const page = this.state.closedEvidencePages[pageIdentity]; const completenessRef = raw.completeness_receipt_digest || raw.completeness_receipt_ref || raw.completenessReceipt?.receiptRef; const sufficiencyRef = raw.sufficiency_receipt_digest || raw.sufficiency_receipt_ref || raw.sufficiencyReceipt?.receiptRef; const completeness = page && this.state.pageCompletenessReceipts[pageIdentity]; const sufficiency = page && this.state.pageSufficiencyReceipts[pageIdentity]; const sealRef = raw.materialization_batch_seal || raw.batch_seal_ref || raw.batchSeal?.sealRef || raw.sealRef; const seal = Object.values(this.state.materializationBatchSeals).find((candidate) => candidate.sealRef === sealRef);
      if (!page || !completeness || !sufficiency || !seal || seal.state !== "SEALED" || page.service_generation !== SERVICE_GENERATION || seal.service_generation !== SERVICE_GENERATION || seal.planRef !== page.planRef) return result("STALE_PREDECESSOR");
      if (completenessRef !== completeness.receiptRef || sufficiencyRef !== sufficiency.receiptRef) return result("STALE_PREDECESSOR");
      let verifier; try { verifier = this._verifier("projection", "dss04-projection-owner", "dss04-projection-root"); } catch (_) { return result("UNAUTHORIZED"); }
      const grant = raw.projectionGrant || raw.projection_grant || raw.grant || raw.authorization; const grantScope = this._refFor("ClosedPageProjectionGrantScope", { generation: generation.generationRef, page: page.pageRef, seal: seal.sealRef, completeness: completeness.receiptRef, sufficiency: sufficiency.receiptRef });
      if (!grant || grant.scopeDigest !== grantScope || !verifier.verify({ grantScope, page: page.pageRef, seal: seal.sealRef, generation: generation.generationRef }, grant)) return result("UNAUTHORIZED");
      if (sufficiency.state === "KNOWN_INSUFFICIENT") return result("KNOWN_INSUFFICIENT");
      if (sufficiency.state !== "SUFFICIENT" || completeness.state !== "COMPLETE") return result("STALE_PREDECESSOR");
      const context = this._batchSealContext(page.planRef); if (!context || !context.valid || !context.pageRows.some((row) => row.page_identity === pageIdentity) || context.identity.content_seal !== seal.content_seal) return result("STALE_PREDECESSOR");
      const projectionPlan = this.state.materializationPlans[page.planRef]; const projectionRouteSet = projectionPlan && this.state.routeSets[projectionPlan.request_id]; const projectionRefs = projectionRouteSet && this._materializationReferences(projectionRouteSet); const projectionDescriptor = projectionPlan?.pages?.find((descriptor) => descriptor.page_identity === pageIdentity); const cas = this._pageCasDocument(page, projectionPlan && projectionDescriptor && projectionRefs ? this._materializationDescriptorContent(projectionPlan, projectionDescriptor, projectionRefs) : null); if (cas.status !== "OK") return result("STALE_PREDECESSOR");
      return result("ACCEPTED", { page: { page_identity: page.page_identity, content_seal: page.content_seal, byte_length: page.byte_length, token_count: page.token_count, bytes: cas.bytes.toString("base64") } });
    } catch (error) { if (["DSS04_GENERATION_REQUIRED", "DSS04_STATE_CORRUPT"].includes(error.code)) return result("STALE_PREDECESSOR"); throw error; }
  }
  status() { return deepFreeze({ schema: "direct_semantic_service_dss04_status@1", trancheRevision: DSS04_TRANCHE_REVISION, generation: clone(this.state.generations.current), counts: { compilerPins: Object.keys(this.state.pins).length, registryRevisions: Object.keys(this.state.registryRevisions).length, snapshotReceipts: Object.keys(this.state.snapshotReceipts).length, snapshotArtifacts: Object.keys(this.state.snapshotArtifacts).length, evidenceRuntimes: Object.keys(this.state.evidenceRuntimes).length, sealedResults: Object.keys(this.state.sealedResults).length, compilationRequests: Object.keys(this.state.compilationRequests).length, allocations: Object.keys(this.state.allocations).length, leases: Object.keys(this.state.leases).length, observations: Object.keys(this.state.observations).length, rawCompilerOutputs: Object.keys(this.state.rawCompilerOutputs).length, outputBundles: Object.keys(this.state.outputBundles).length, routeSets: Object.keys(this.state.routeSets).length, materializationPlans: Object.keys(this.state.materializationPlans).length, closedEvidencePages: Object.keys(this.state.closedEvidencePages).length, pageCompletenessReceipts: Object.keys(this.state.pageCompletenessReceipts).length, pageSufficiencyReceipts: Object.keys(this.state.pageSufficiencyReceipts).length, knownInsufficiencyRemands: Object.keys(this.state.knownInsufficiencyRemands).length, pageFaultCandidates: Object.keys(this.state.pageFaultCandidates).length, novelEdgeCandidates: Object.keys(this.state.novelEdgeCandidates).length, candidateValidationRecords: Object.keys(this.state.candidateValidationRecords).length, materializationBatchSeals: Object.keys(this.state.materializationBatchSeals).length, accounting: Object.keys(this.state.accounting).length, validatorRevisions: Object.keys(this.state.validatorRevisions).length, events: this.state.events.length } }); }
  close() { this._persist(); this.store.close(); }
}

function createDss04Service(options) { return new Dss04Service(options); }
module.exports = { DSS04_SCHEMA, DSS04_TRANCHE_REVISION, Dss04Error: Dss02Error, Dss04Service, DirectSemanticServiceDss04: Dss04Service, Dss04SqliteStore, createDss04Service, DSS04_GENERATION_IDENTITY: GENERATION_IDENTITY, DSS04_CARRIER_FIELD_MAP, normalizeDss04CompilerReceipt: normalizeCompilerReceipt };
