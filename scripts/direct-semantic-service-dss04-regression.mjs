#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createDss04Service, Dss04SqliteStore, digestObject, canonicalJson, DSS04_GENERATION_IDENTITY } = require("../src/main/direct/semantic-service");

const root = fs.mkdtempSync(`${os.tmpdir()}/dss04-regression-`);
const faultRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-fault-`);
const faultStore = new Dss04SqliteStore({ root: faultRoot, failBeforeCommit: true });
assert.throws(() => faultStore.write({ schema: "direct_semantic_service_dss04_state@1", pins: {}, generations: {}, registryRevisions: {}, snapshotReceipts: {}, snapshotArtifacts: {}, evidenceRuntimes: {}, sealedResults: {}, events: [], operationInputs: {} }), (error) => error.code === "DSS04_SQLITE_INJECTED_FAILURE");
assert.equal(faultStore.read(), null);
faultStore.close();
const authorization = { owner: "dss04-installation-owner", root: "owner-protected-installation-root", authorized: true };
const pin = { repository_commit: "2dec60ee75178b98b9ae517a576002519e1f0f81", source_tree_digest: "sha256:160b124ee04c5965070ea6d0c69ad001e022ed97e08e1f14d8315ed0f790f2c8", entrypoint_digest: "sha256:27ba7748a05a3dff57c7c3f2113623aa5561345cdadf62afe81fe1b8bcbd9c32", interpreter_digest: "sha256:1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118", dependency_lock_digest: "sha256:94c6649f92d33287123fd6551f8a38c89a0b1d8cbdb5537f98cc05ee90ed56e0", installed_environment_digest: "sha256:359e0ff20a700d592a75cd55f1b470327959adb31611e0d755fd66eb4f105ab5", invocation_contract_digest: "sha256:60a316a77777d94973cd07436c95d1891fb24011a8b46299e2e7828bfbc078f6", pattern_library_digest: "sha256:9364aa6ff0aa6e0e0fc87f7c5311cc8dd06b05dc3d2676b4e943345c9ac653c9", learning_extension_digest: "sha256:b5dd1ca30da90244a7ec36358bd73d5f7fb8330700d04074b11be0b86bee7cf4", focus_library_digest: "sha256:dce3d0305c882668660c3c9fb1300dc65c1e7bcea1cd6ac74cbb1aabcf7ad482" };
const pinCommitment = DSS04_GENERATION_IDENTITY.compiler_build_pin_digest;
const rootPin = { root_digest: DSS04_GENERATION_IDENTITY.project_registry_root_digest, namespace: "direct-projects", signer_population_digest: "sha256:" + "a".repeat(64), revision_schema_digest: "sha256:" + "b".repeat(64) };
const rootCommitment = DSS04_GENERATION_IDENTITY.project_registry_root_digest;
pin.pinDigest = DSS04_GENERATION_IDENTITY.compiler_build_pin_digest;
const runtimeDependencies = [["/usr/bin/node", "sha256:f3f93db342d5ac5bb61656d0599a603a73779e98befd9342171e550002725f4d"], ["/lib/x86_64-linux-gnu/libnode.so.109", "sha256:ce7cb9cd408c412090c86dada332aaa82650679ed1b32527768c8dbd8c4028d0"], ["/lib/x86_64-linux-gnu/libc.so.6", "sha256:8db37cf3f2169f59a0f07ef1fea308c35656668c64c8ff294e1860f4121eb161"], ["/lib/x86_64-linux-gnu/libz.so.1", "sha256:86200da370f20476a2507e9097a789b5ef97269b4ca8d5e164ad82dab9d99892"], ["/lib/x86_64-linux-gnu/libuv.so.1", "sha256:11933a4a53d7cc817afb01610242b59a0e2e1b2bd64589a2203c1f84bbf7083f"], ["/lib/x86_64-linux-gnu/libbrotlidec.so.1", "sha256:64d8a5019d4c294b89fde1193343ea324bbd8603652554e5545f0a01595fa2c5"], ["/lib/x86_64-linux-gnu/libbrotlienc.so.1", "sha256:6e59301f6c3a05815ecc6cd8c56714280367da1f6737e9f077f5847d86c509f2"], ["/lib/x86_64-linux-gnu/libcares.so.2", "sha256:75f2826fc310a770ec0ecc2299b60f79acb8ea27f30a197b3729c087a9220ca5"], ["/lib/x86_64-linux-gnu/libnghttp2.so.14", "sha256:46764ab5b6ca7e353a322054f0bee45d9158a27f3e6a82a2fa4447f2ba9ba268"], ["/lib/x86_64-linux-gnu/libcrypto.so.3", "sha256:6a66c3ba6b3749aacc9497973fff00f6ba61c703ba7015d0d7ab3fd9510974b6"], ["/lib/x86_64-linux-gnu/libssl.so.3", "sha256:8e49cebd373d90b55f3626da71dd97fe8e95c68dc4c064d8962b27907690736e"], ["/lib/x86_64-linux-gnu/libicui18n.so.74", "sha256:3550b194eb2cf2e6f798f033eb9ca279d498c21296b4a18790ce158d2023e47b"], ["/lib/x86_64-linux-gnu/libicuuc.so.74", "sha256:7560aadde38e5f4237a47a1ddd5891f9b36768a77a60faae30beee003ac01901"], ["/lib/x86_64-linux-gnu/libstdc++.so.6", "sha256:1fd75fe70354a416d75aef22bcae68c47bd25d20e2d0568c30b1a9838cf62f11"], ["/lib/x86_64-linux-gnu/libm.so.6", "sha256:e9c4b28d340e415b8137480ec442662f981e1399386c5931dae0e886e3639e91"], ["/lib/x86_64-linux-gnu/libgcc_s.so.1", "sha256:d93224d2b0dab4247598be683adca02f5cf00586f99c187579cd7e92058fb7cb"], ["/lib64/ld-linux-x86-64.so.2", "sha256:cd4df4f3c7b83673d61189bf2eaebd33ca4f2853ab9772b8a25e025ef99b1e81"], ["/lib/x86_64-linux-gnu/libbrotlicommon.so.1", "sha256:a91ead095d2c80520c55a89057bbe10b031a075340442e63f44b310f93883a1b"], ["/lib/x86_64-linux-gnu/libicudata.so.74", "sha256:ddbb3718b8bd9cbd780e5ab08b4503c30a6c4fa0706ebe5d074ed6b596c1714e"], ["/usr/share/nodejs/cjs-module-lexer/lexer.js", "sha256:0abd984d16d53a59af9978283f9fddaee1342edc6ccb7810e443d6ee0ff26fff"]];
runtimeDependencies.push(["/usr/share/nodejs/cjs-module-lexer/dist/lexer.js", "sha256:bfcd3684f197fffc2b9b3d05ba95818d69fe3a4e6c54463f000bcd0dbd97fd2d"]);
runtimeDependencies.push(["/etc/ld.so.cache", "sha256:4ae53bf857b2d7626182c1bc77b8d323e4ab601f4052835f1cde5f5190c96c2e"], ["/usr/lib/ssl/openssl.cnf", "sha256:529815b0dd4bd6608bafeeb3d410b0683374e61aef792b3e3f38b3767d26f747"], ["/usr/share/nodejs/undici/undici-fetch.js", "sha256:398ed64aebf6ee3b216049e5ff4df8297e4ad968a531aff0022bfaf9741266b4"], ["/usr/share/nodejs/acorn/dist/acorn.js", "sha256:cb3b2d439857d6e4514d23a1219f6354c23498f5fa81fdf2691a5a9e53de43c0"], ["/usr/share/nodejs/acorn-walk/dist/walk.js", "sha256:2bf2dbb2b7f0e4877eeffed1a9b51cec8cb341539c769da5e3ec83f5a8772672"]);
const runtimeDependencyDigest = digestObject("DirectSemanticService.Dss04.RuntimeDependencyManifest.v1", runtimeDependencies);
let serviceNow = new Date("2026-08-28T12:00:00.000Z");
const compilerSourceRoot = process.env.DSS04_COMPILER_ROOT;
if (!compilerSourceRoot || !path.isAbsolute(compilerSourceRoot) || !fs.existsSync(path.join(compilerSourceRoot, ".git"))) {
  throw new Error(`DSS04 compiler fixture unavailable; set DSS04_COMPILER_ROOT to the owner-provisioned checkout at ${pin.repository_commit}.`);
}
const relocatedCompilerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dss04-owner-compiler-"));
execFileSync("git", ["clone", "--quiet", "--no-local", compilerSourceRoot, relocatedCompilerRoot], { stdio: "ignore" });
const serviceOptions = { root, compilerRuntime: { owner: "dss04-compiler-runtime-owner", root: "pinned-compiler-runtime-root", compilerRoot: relocatedCompilerRoot, compilerCommit: pin.repository_commit, executable: path.join(relocatedCompilerRoot, "scripts/dev/compile_semantic_contract_learning_v1.py"), executableDigest: pin.entrypoint_digest, interpreterPath: process.env.DSS04_INTERPRETER_PATH || "/usr/bin/python3", interpreterRuntimeDigest: pin.interpreter_digest, dependencyManifest: runtimeDependencies, dependencyManifestDigest: runtimeDependencyDigest, sandboxExecutable: process.env.DSS04_SANDBOX_EXECUTABLE || "/usr/bin/bwrap", sandboxExecutableDigest: "sha256:52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712", sandboxProfileDigest: "sha256:379441892b7be3ffa56c2ba4fdd52abd0a1fb8d3ecd62f62e6df80fe4c233651", interpreterDigest: pin.interpreter_digest, dependencyLockDigest: pin.dependency_lock_digest, environmentDigest: pin.installed_environment_digest, invocationContractDigest: pin.invocation_contract_digest, patternLibraryDigest: pin.pattern_library_digest, learningExtensionDigest: pin.learning_extension_digest, focusLibraryDigest: pin.focus_library_digest, args: [] }, protectedCommitments: { compiler: { digest: pinCommitment, value: pin }, registry: { digest: rootCommitment, value: rootPin } }, verifiers: { registry: { revision: "registry-verifier-1", owner: "dss04-project-registry-owner", root: "owner-project-registry-root", verify: ({ payloadDigest, rootPin: installed }, proof) => Boolean(proof && proof.owner === "dss04-project-registry-owner" && proof.root === "owner-project-registry-root" && proof.payloadDigest === payloadDigest && proof.signerPopulationDigest === installed.signer_population_digest) }, authorization: { revision: "dss03-grant-verifier-v1", owner: "dss03-authority-owner", root: "ratified-dss03-result-root", verify: ({ grantScope }, proof) => Boolean(proof && proof.proofDigest === digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", grantScope) && proof.scopeDigest === grantScope) }, projection: { revision: "dss04-projection-grant-verifier-v1", owner: "dss04-projection-owner", root: "dss04-projection-root", verify: ({ grantScope }, proof) => Boolean(proof && proof.owner === "dss04-projection-owner" && proof.root === "dss04-projection-root" && proof.proofDigest === digestObject("DirectSemanticService.Dss04.ProjectionGrant.v1", grantScope) && proof.scopeDigest === grantScope) }, runtime: { revision: "runtime-verifier-1", owner: "dss04-evidence-runtime-owner", root: "project-evidence-runtime-root", verify: ({ runtimeDigest, runtime: supplied, registry: admittedRegistry, snapshot: admittedSnapshot }, proof) => Boolean(proof && proof.runtimeDigest === runtimeDigest && proof.projectPolicyDigest === admittedRegistry.project_policy_digest && proof.snapshotReceiptDigest === admittedSnapshot.receiptRef && proof.availabilityDigest === supplied.availability_snapshot_digest && proof.isolationDigest === supplied.isolation_profile_digest) } } };
serviceOptions.now = () => serviceNow.toISOString();
// A protected commitment that advertises a foreign compiler generation must
// not be able to install or open merely because its fields are self-consistent.
const foreignPinRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-foreign-pin-`);
const foreignPinDigest = "sha256:" + "b".repeat(64);
const foreignPinService = createDss04Service({ ...serviceOptions, root: foreignPinRoot, protectedCommitments: { ...serviceOptions.protectedCommitments, compiler: { digest: foreignPinDigest, value: pin } } });
assert.equal(foreignPinService.installCompilerBuildPin({ pin, pinDigest: foreignPinDigest, installationCommitmentDigest: foreignPinDigest, authorization }).status, "PIN_MISMATCH");
foreignPinService.close();
// Anchor custody must use the absolute, digest-pinned Git executable even if
// a caller-controlled PATH places a wrapper first.
const gitWrapperRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-git-wrapper-`);
const gitWrapperMarker = path.join(gitWrapperRoot, "invoked");
fs.writeFileSync(path.join(gitWrapperRoot, "git"), `#!/bin/sh\nprintf invoked > ${JSON.stringify(gitWrapperMarker)}\nexec /usr/bin/git "$@"\n`, { mode: 0o700 });
const previousPath = process.env.PATH;
process.env.PATH = `${gitWrapperRoot}:${previousPath}`;
const wrappedAnchorService = createDss04Service({ ...serviceOptions, root: fs.mkdtempSync(`${os.tmpdir()}/dss04-git-service-`) });
process.env.PATH = previousPath;
assert.equal(fs.existsSync(gitWrapperMarker), false);
assert.equal(wrappedAnchorService.authorityBroken, false);
wrappedAnchorService.close();
let service = createDss04Service(serviceOptions);
function mutateDurableFixture(mutator) {
  service.close();
  const store = new Dss04SqliteStore({ root, now: serviceOptions.now });
  const state = store.read();
  mutator(state);
  store.write(state);
  store.close();
  service = createDss04Service(serviceOptions);
}
function mutateSpecificDurableFixture(targetService, targetRoot, targetOptions, mutator) {
  targetService.close();
  const store = new Dss04SqliteStore({ root: targetRoot, now: targetOptions.now });
  const state = store.read();
  mutator(state);
  store.write(state);
  store.close();
  return createDss04Service(targetOptions);
}
assert.equal(service.installCompilerBuildPin({ pin, installationCommitmentDigest: pinCommitment, authorization }).status, "PINNED");
assert.equal(service.installProjectRegistryRootPin({ pin: rootPin, installationCommitmentDigest: rootCommitment, authorization }).status, "PINNED");
assert.equal(service.openDss04Generation().status, "ACCEPTED");
const registry = { project_id: "project-1", registry_revision: "r1", predecessor_digest: "sha256:" + "c".repeat(64), registry_root_digest: rootPin.root_digest, project_policy_digest: "sha256:" + "d".repeat(64), allowed_target_kinds_digest: "sha256:" + "e".repeat(64), allowed_compiler_profiles_digest: "sha256:" + "f".repeat(64), allowed_evidence_runtime_profiles_digest: "sha256:" + "0".repeat(64), signature_digest: "sha256:" + "1".repeat(64) };
const signedRegistryFields = ["project_id", "registry_revision", "predecessor_digest", "registry_root_digest", "project_policy_digest", "allowed_target_kinds_digest", "allowed_compiler_profiles_digest", "allowed_evidence_runtime_profiles_digest"];
const registryProof = { valid: true, owner: "dss04-project-registry-owner", root: "owner-project-registry-root", payloadDigest: digestObject("DirectSemanticService.Dss04.ProjectRegistryRevision.v1", Object.fromEntries(signedRegistryFields.map((field) => [field, registry[field]]))), signerPopulationDigest: rootPin.signer_population_digest };
registry.signature_digest = digestObject("DirectSemanticService.Dss04.RegistrySignature.v1", registryProof);
const registryRef = digestObject("DirectSemanticService.Dss04.ProjectRegistryRevision.v1", registry);
assert.equal(service.admitProjectRegistryRevision({ revision: registry, signatureProof: registryProof }).status, "ADMITTED");
const receipt = { project_id: "project-1", project_registry_revision_digest: registryRef, target_revision: "commit-1", snapshot_root_digest: "sha256:" + "2".repeat(64), file_inventory_digest: "sha256:" + "3".repeat(64), executable_root_inventory_digest: "sha256:" + "4".repeat(64), language_inventory_digest: "sha256:" + "5".repeat(64), submodule_inventory_digest: "sha256:" + "6".repeat(64), lfs_inventory_digest: "sha256:" + "7".repeat(64), generated_input_inventory_digest: "sha256:" + "8".repeat(64), cartography_digest: "sha256:" + "9".repeat(64), snapshot_policy_digest: "sha256:" + "a".repeat(64), capture_tool_revision: "capture-1", capture_environment_digest: "sha256:" + "b".repeat(64), captured_at: "2026-08-28T00:00:00.000Z" };
const fileBytes = fs.readFileSync(new URL("./direct-semantic-service-dss04-pinned-fixture.cjs", import.meta.url));
const fileArtifact = { canonical_relative_path: "pinned-fixture.cjs", object_kind: "FILE", mode: "0644", byte_length: fileBytes.length, content_digest: `sha256:${crypto.createHash("sha256").update(fileBytes).digest("hex")}`, provenance: "owner-capture", root_membership: "source", contentBase64: fileBytes.toString("base64") };
receipt.file_inventory_digest = digestObject("DirectSemanticService.Dss04.TargetSnapshot.FileInventory.v1", [{ canonical_relative_path: fileArtifact.canonical_relative_path, object_kind: fileArtifact.object_kind, mode: fileArtifact.mode, byte_length: fileArtifact.byte_length, content_digest: fileArtifact.content_digest, provenance: fileArtifact.provenance, root_membership: fileArtifact.root_membership }]);
const inventories = { file_inventory: [{ canonical_relative_path: fileArtifact.canonical_relative_path, object_kind: fileArtifact.object_kind, mode: fileArtifact.mode, byte_length: fileArtifact.byte_length, content_digest: fileArtifact.content_digest, provenance: fileArtifact.provenance, root_membership: fileArtifact.root_membership }], executable_root_inventory: [], language_inventory: [], submodule_inventory: [], lfs_inventory: [], generated_input_inventory: [], cartography: [] };
const familyName = (family) => family.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
for (const family of Object.keys(inventories)) receipt[`${family}_digest`] = digestObject(`DirectSemanticService.Dss04.TargetSnapshot.${familyName(family)}.v1`, inventories[family]);
receipt.snapshot_root_digest = digestObject("DirectSemanticService.Dss04.TargetSnapshot.Root.v1", { project_id: receipt.project_id, project_registry_revision_digest: receipt.project_registry_revision_digest, target_revision: receipt.target_revision, inventories, snapshot_policy_digest: receipt.snapshot_policy_digest, capture_tool_revision: receipt.capture_tool_revision, capture_environment_digest: receipt.capture_environment_digest });
const receiptResult = service.admitTargetSnapshot({ receipt, artifacts: [fileArtifact], inventories });
assert.equal(receiptResult.status, "ADMITTED");
assert.equal(service.state.events.at(-1).carrierId, "d.target-snapshot-receipt");
const runtime = { project_id: "project-1", project_registry_revision_digest: registryRef, target_snapshot_receipt_digest: receiptResult.receipt.receiptRef, runtime_revision: "runtime-1", evidence_source_catalog_digest: "sha256:" + "d".repeat(64), evidence_toolchain_digest: "sha256:" + "e".repeat(64), evidence_policy_digest: "sha256:" + "f".repeat(64), availability_snapshot_digest: "sha256:" + "0".repeat(64), isolation_profile_digest: "sha256:" + "1".repeat(64), environment_digest: "sha256:" + "2".repeat(64) };
const runtimeDigest = digestObject("DirectSemanticService.Dss04.ProjectEvidenceRuntimeRevision.v1", runtime);
assert.equal(service.admitProjectEvidenceRuntime({ runtime, runtimeProof: { valid: true, runtimeDigest, projectPolicyDigest: registry.project_policy_digest, snapshotReceiptDigest: receiptResult.receipt.receiptRef, availabilityDigest: runtime.availability_snapshot_digest, isolationDigest: runtime.isolation_profile_digest } }).status, "ADMITTED");
const envelope = { dss03_service_generation: "sha256:" + "3".repeat(64), dss03_implementation_commit: "e57e4009312ffe21b22d18d996ff461ad5018388", dss03_semantic_candidate: "45ca7736afbb6701d60abcdb6b0dc9888d2741b6", dss03_result_schema_revision: "direct-semantic-service-dss03-result.v1", dss03_job_id: "job-1", result_seal_digest: "sha256:" + "4".repeat(64), result_population_coverage_digest: "sha256:" + "5".repeat(64), terminal_result_event_head: "sha256:" + "6".repeat(64), seal_receipt_digest: "sha256:" + "7".repeat(64), sealing_owner_revision: "owner-rev-1", source_standing: "SEALED" };
const envelopeIdentityDigest = digestObject("DirectSemanticService.Dss04.Dss03Envelope.v1", envelope);
const receiptIdentityDigest = digestObject("DirectSemanticService.Dss04.Dss03OwnerReceipt.v1", envelope);
const sourceHead = { event: "SEAL", standing: "SEALED", authenticated: true, authorityOwner: "dss03-sealing-owner", authorityRoot: "ratified-dss03-result-root", serviceGeneration: envelope.dss03_service_generation, envelopeIdentityDigest, receiptDigest: receiptIdentityDigest };
sourceHead.headDigest = digestObject("DirectSemanticService.Dss04.Dss03LifecycleHead.v1", sourceHead);
assert.equal(service.acceptDss03SealedResult({ envelope, receipt: envelope, sourceLifecycleHead: sourceHead }).status, "ACCEPTED");
assert.equal(service.acceptDss03SealedResult({ envelope, receipt: envelope, sourceLifecycleHead: sourceHead }).status, "REPLAYED");
assert.equal(service.state.events.at(-1).carrierId, "e.dss03-sealed-result");
const before = service.status().counts;
assert.equal(service.installCompilerBuildPin({ pin: { ...pin, repository_commit: "foreign" }, installationCommitmentDigest: pinCommitment, authorization }).status, "PIN_MISMATCH");
assert.deepEqual(service.status().counts, before);
assert.equal(service.installCompilerBuildPin({ pin: { ...pin, source_tree_digest: "sha256:" + "f".repeat(64) }, installationCommitmentDigest: pinCommitment, authorization }).status, "PIN_MISMATCH");
assert.deepEqual(service.status().counts, before);
assert.equal(service.installCompilerBuildPin({ pin, installationCommitmentDigest: pinCommitment, authorization: { ...authorization, root: "foreign-root" } }).status, "UNAUTHORIZED");
assert.deepEqual(service.status().counts, before);
assert.equal(service.admitProjectRegistryRevision({ revision: registry, signatureProof: { ...registryProof, payloadDigest: "sha256:" + "f".repeat(64) } }).status, "REJECTED");
assert.equal(service.status().counts.events, before.events + 1);
assert.equal(service.admitTargetSnapshot({ receipt, artifacts: [{ ...fileArtifact, contentBase64: Buffer.from("tampered").toString("base64") }] }).status, "SNAPSHOT_INVALID");
assert.equal(service.status().counts.events, before.events + 3);
assert.equal(service.admitProjectEvidenceRuntime({ runtime, runtimeProof: { valid: true } }).status, "EVIDENCE_RUNTIME_INVALID");
assert.equal(service.status().counts.events, before.events + 4);
const second = createDss04Service;
assert.throws(() => second({ root, protectedCommitments: { compiler: pinCommitment, registry: rootCommitment } }), (error) => error.code === "DSS04_SQLITE_WRITER_LOCKED");
service.close();
service = createDss04Service(serviceOptions);
assert.equal(service.status().counts.events, 13);
assert.equal(service.status().counts.snapshotArtifacts, 1);
// Compilation/execution/materialization unit: lawful durable recovery/readiness, exact request
// replay/conflict, fenced allocation/lease, isolated pinned execution, private
// capture, and complete output admission.  Readiness is produced by the
// recovery reducer from the complete enumerated durable cut; tests do not
// mutate the private generation state.
const recovery = service.recoverDss04Generation();
assert.equal(recovery.status, "READY");
assert.equal(recovery.generation.state, "READY");
const recoveryReplay = service.recoverDss04Generation();
assert.equal(recoveryReplay.status, "REPLAYED");
// Restart reconstruction is a read of the same authenticated durable cut;
// it must replay the disposition without publishing another readiness path.
service.close();
service = createDss04Service(serviceOptions);
assert.equal(service.recoverDss04Generation().status, "REPLAYED");
// A missing idempotency binding is a recoverable partial cut.  This negative
// fixture uses the durable store boundary and never grants readiness.
mutateDurableFixture((state) => { state.compilationRequests["partial-recovery"] = { service_generation: state.generations.current.generationRef, request_id: "partial-recovery", requestRef: "partial-request-ref", semanticInputDigest: "sha256:" + "a".repeat(64) }; });
assert.equal(service.recoverDss04Generation().status, "BLOCKED");
mutateDurableFixture((state) => { delete state.compilationRequests["partial-recovery"]; });
assert.equal(service.recoverDss04Generation().status, "READY");
const compilationRequest = {
  service_generation: service.state.generations.current.generationRef,
  request_id: "compile-1",
  dss03_result_seal_digest: envelope.result_seal_digest,
  project_registry_revision_digest: registryRef,
  target_snapshot_receipt_digest: receiptResult.receipt.receiptRef,
  semantic_contract_module_digest: "sha256:5420171d0a6a1baf4118e2e5f07bba745eb878e8811b8c96cb72976d2d73852f",
  compiler_receipt_normalization_revision: "direct.dss04.compiler-receipt-normalization.v2",
  project_evidence_runtime_revision_digest: runtimeDigest,
  compiler_build_pin_digest: pinCommitment,
  compiler_invocation_contract_digest: DSS04_GENERATION_IDENTITY.compiler_invocation_contract_digest,
  compilation_profile_digest: "sha256:" + "c".repeat(64),
  requested_route_scope_digest: "sha256:" + "d".repeat(64),
  materialization_policy_digest: DSS04_GENERATION_IDENTITY.materialization_policy_digest
};
const compilationGrantScope = digestObject("DirectSemanticService.Dss04.CompilationRequestGrantScope.v1", { generation: service.state.generations.current.generationRef, request: compilationRequest, sealedResult: "job-1", registry: registryRef, snapshot: receiptResult.receipt.receiptRef, runtime: runtimeDigest });
const compilationGrant = { owner: "dss03-authority-owner", root: "ratified-dss03-result-root", authorized: true, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", compilationGrantScope), scopeDigest: compilationGrantScope };
assert.equal(service.submitCompilationRequest({ request: compilationRequest, grant: compilationGrant }).status, "ACCEPTED");
const changedCompilationRequest = { ...compilationRequest, compilation_profile_digest: "sha256:" + "e".repeat(64) };
const changedCompilationScope = digestObject("DirectSemanticService.Dss04.CompilationRequestGrantScope.v1", { generation: service.state.generations.current.generationRef, request: changedCompilationRequest, sealedResult: "job-1", registry: registryRef, snapshot: receiptResult.receipt.receiptRef, runtime: runtimeDigest });
const changedCompilationGrant = { ...compilationGrant, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", changedCompilationScope), scopeDigest: changedCompilationScope };
assert.equal(service.submitCompilationRequest({ request: changedCompilationRequest, grant: changedCompilationGrant }).status, "IDEMPOTENCY_CONFLICT");
assert.equal(service.submitCompilationRequest({ request: compilationRequest, grant: { owner: "dss03-authority-owner", root: "ratified-dss03-result-root", authorized: true } }).status, "UNAUTHORIZED");
// The owner-provisioned checkout is deliberately relocated into a temporary
// root.  A changed pinned artifact and a symlinked executable outside that
// root must both fail the runtime latch before any child is started.
assert.equal(path.resolve(service.compilerRuntime.compilerRoot), path.resolve(relocatedCompilerRoot));
const tamperedCompilerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dss04-tampered-compiler-"));
fs.rmSync(tamperedCompilerRoot, { recursive: true, force: true });
fs.cpSync(relocatedCompilerRoot, tamperedCompilerRoot, { recursive: true });
const tamperedExecutable = path.join(tamperedCompilerRoot, "scripts/dev/compile_semantic_contract_learning_v1.py");
fs.appendFileSync(tamperedExecutable, "\n# owner-runtime-tamper\n");
assert.throws(
  () => service._assertPinnedRuntime({
    ...service.compilerRuntime,
    compilerRoot: tamperedCompilerRoot,
    executable: tamperedExecutable,
  }, pin),
  (error) => error.code === "DSS04_PIN_MISMATCH",
);
const escapedExecutable = path.join(relocatedCompilerRoot, "escaped-compiler.py");
fs.symlinkSync("/usr/bin/python3", escapedExecutable);
assert.throws(
  () => service._assertPinnedRuntime({ ...service.compilerRuntime, executable: escapedExecutable }, pin),
  (error) => error.code === "DSS04_PIN_MISMATCH",
);
fs.unlinkSync(escapedExecutable);
// The admitted target snapshot may contain a file named like the fixture,
// but that input must never replace the separately pinned compiler source
// image.  Mutate only the isolated admitted artifact, execute it, and require
// the pinned fixture output rather than the target marker.
const compilerInputRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-compiler-input-`);
fs.cpSync(root, compilerInputRoot, { recursive: true });
const compilerInputService = createDss04Service({ ...serviceOptions, root: compilerInputRoot });
const compilerInputArtifactRef = compilerInputService.state.snapshotReceipts[receiptResult.receipt.receiptRef].artifactRefs[0];
const compilerInputArtifact = compilerInputService.state.snapshotArtifacts[compilerInputArtifactRef];
const targetMarkerBytes = Buffer.from("process.stdout.write('TARGET_SNAPSHOT_EXECUTED')\n", "utf8");
compilerInputArtifact.bytesBase64 = targetMarkerBytes.toString("base64");
compilerInputArtifact.byte_length = targetMarkerBytes.length;
compilerInputArtifact.content_digest = `sha256:${crypto.createHash("sha256").update(targetMarkerBytes).digest("hex")}`;
const compilerInputAllocation = compilerInputService.allocateDss04Work({ request_id: compilationRequest.request_id });
assert.equal(compilerInputAllocation.status, "ACCEPTED");
const compilerInputLease = compilerInputService.acquireDss04Lease({ allocation_id: compilerInputAllocation.allocation.work_identity });
assert.equal(compilerInputLease.status, "ACCEPTED");
const compilerInputExecution = compilerInputService.executePinnedCompilation({ request_id: compilationRequest.request_id, lease_id: compilerInputLease.lease.leaseRef });
assert.equal(compilerInputExecution.status, "COMPLETE");
const compilerInputStdout = fs.readFileSync(path.join(compilerInputRoot, "dss04-process-custody", `${compilerInputExecution.observation.observationRef.slice(7)}.stdout`));
assert.notEqual(compilerInputExecution.observation.stdout_seal, `sha256:${crypto.createHash("sha256").update(targetMarkerBytes).digest("hex")}`);
assert.equal(compilerInputStdout.toString("utf8").includes("TARGET_SNAPSHOT_EXECUTED"), false);
compilerInputService.close();
// A persisted compiler pin mutation must also prevent a generation reopen.
const pinTamperRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-pin-tamper-`);
fs.cpSync(root, pinTamperRoot, { recursive: true });
let pinTamperService = createDss04Service({ ...serviceOptions, root: pinTamperRoot });
pinTamperService.state.pins.compilerBuild.digest = "sha256:" + "c".repeat(64);
pinTamperService.state.pins.compilerBuild.compiler_build_pin_digest = "sha256:" + "c".repeat(64);
pinTamperService._persist();
pinTamperService.close();
pinTamperService = createDss04Service({ ...serviceOptions, root: pinTamperRoot });
const pinTamperOpen = pinTamperService.openDss04Generation();
assert.equal(pinTamperOpen.status, "PIN_MISMATCH");
pinTamperService.close();
assert.equal(service.submitCompilationRequest({ request: compilationRequest, grant: { ...compilationGrant, proofDigest: "sha256:" + "f".repeat(64) } }).status, "UNAUTHORIZED");
assert.equal(service.submitCompilationRequest({ request: { ...compilationRequest, requested_route_scope_digest: "sha256:" + "e".repeat(64) }, grant: compilationGrant }).status, "UNAUTHORIZED");
// Exercise a lawful oversized admitted input through the public compiler path
// in an isolated copy of the fully provisioned durable cut.  The pinned
// the pinned external compiler emits its exact receipt population; no private
// route, generation, or READY state is fabricated.
const overBudgetRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-overbudget-`);
service.close();
fs.cpSync(root, overBudgetRoot, { recursive: true });
const overBudgetService = createDss04Service({ ...serviceOptions, root: overBudgetRoot });
const overBudgetRequest = { ...compilationRequest, request_id: "compile-overbudget" };
const overBudgetScope = digestObject("DirectSemanticService.Dss04.CompilationRequestGrantScope.v1", { generation: overBudgetService.state.generations.current.generationRef, request: overBudgetRequest, sealedResult: "job-1", registry: registryRef, snapshot: receiptResult.receipt.receiptRef, runtime: runtimeDigest });
const overBudgetGrant = { ...compilationGrant, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", overBudgetScope), scopeDigest: overBudgetScope };
assert.equal(overBudgetService.submitCompilationRequest({ request: overBudgetRequest, grant: overBudgetGrant }).status, "ACCEPTED");
const overBudgetAllocation = overBudgetService.allocateDss04Work({ request_id: "compile-overbudget" });
assert.equal(overBudgetAllocation.status, "ACCEPTED");
const overBudgetLease = overBudgetService.acquireDss04Lease({ allocation_id: overBudgetAllocation.allocation.work_identity });
assert.equal(overBudgetLease.status, "ACCEPTED");
const overBudgetExecution = overBudgetService.executePinnedCompilation({ request_id: "compile-overbudget", lease_id: overBudgetLease.lease.leaseRef });
assert.equal(overBudgetExecution.status, "COMPLETE");
const overBudgetCapture = overBudgetService.captureCompilerOutput({ observation_id: overBudgetExecution.observation.observationRef, lease_id: overBudgetLease.lease.leaseRef });
assert.equal(overBudgetCapture.status, "ACCEPTED");
const overBudgetAdmission = overBudgetService.admitCompilerOutput({ raw_output_id: overBudgetCapture.rawOutput.rawRef });
assert.equal(overBudgetAdmission.status, "ADMITTED");
// Keep the compiler receipt exact while making this isolated materialization
// fixture genuinely oversized: the admitted source artifact is enlarged only
// after compiler admission, so no caller-supplied route population is used.
const overBudgetArtifactRef = overBudgetService.state.snapshotReceipts[receiptResult.receipt.receiptRef].artifactRefs[0];
const overBudgetArtifact = overBudgetService.state.snapshotArtifacts[overBudgetArtifactRef];
const overBudgetBytes = Buffer.alloc(70 * 1024, 0x78);
overBudgetArtifact.bytesBase64 = overBudgetBytes.toString("base64");
overBudgetArtifact.byte_length = overBudgetBytes.length;
overBudgetArtifact.content_digest = `sha256:${crypto.createHash("sha256").update(overBudgetBytes).digest("hex")}`;
overBudgetService._persist();
const overBudgetPlan = overBudgetService.instantiateMaterializationPlan({ compiled_route_set_digest: overBudgetAdmission.routeSet.routeSetRef });
assert.equal(overBudgetPlan.status, "OVER_BUDGET");
assert.equal(overBudgetPlan.plan.state, "REMANDED");
assert.equal(overBudgetPlan.plan.pages.length, 0);
assert.equal(overBudgetPlan.plan.partition.length, overBudgetAdmission.routeSet.routes.length);
assert.ok(overBudgetPlan.plan.partition.every((entry) => entry.disposition === "REMAND" && entry.reason === "OVER_BUDGET"));
assert.equal(overBudgetService.allocateDss04Work({ request_id: "compile-overbudget", work_kind: "PAGE", plan_ref: overBudgetPlan.plan.planRef, page_identity: "sha256:" + "0".repeat(64) }).status, "STALE_PREDECESSOR");
overBudgetService.close();
const unavailableRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-unavailable-`);
fs.cpSync(root, unavailableRoot, { recursive: true });
let unavailableService = createDss04Service({ ...serviceOptions, root: unavailableRoot });
// The source root contains the main request before its worker starts.  Remove
// that intentionally unstarted request from this independent unavailable-page
// fixture so recovery covers only the fully executed unavailable route.
delete unavailableService.state.compilationRequests[compilationRequest.request_id];
delete unavailableService.state.idempotencyBindings[compilationRequest.request_id];
unavailableService._persist();
const unavailableRequest = { ...compilationRequest, request_id: "compile-unavailable" };
const unavailableScope = digestObject("DirectSemanticService.Dss04.CompilationRequestGrantScope.v1", { generation: unavailableService.state.generations.current.generationRef, request: unavailableRequest, sealedResult: "job-1", registry: registryRef, snapshot: receiptResult.receipt.receiptRef, runtime: runtimeDigest });
const unavailableGrant = { ...compilationGrant, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", unavailableScope), scopeDigest: unavailableScope };
assert.equal(unavailableService.submitCompilationRequest({ request: unavailableRequest, grant: unavailableGrant }).status, "ACCEPTED");
const unavailableAllocation = unavailableService.allocateDss04Work({ request_id: "compile-unavailable" });
assert.equal(unavailableAllocation.status, "ACCEPTED");
const unavailableLease = unavailableService.acquireDss04Lease({ allocation_id: unavailableAllocation.allocation.work_identity });
assert.equal(unavailableLease.status, "ACCEPTED");
const unavailableExecution = unavailableService.executePinnedCompilation({ request_id: "compile-unavailable", lease_id: unavailableLease.lease.leaseRef });
assert.equal(unavailableExecution.status, "COMPLETE");
const unavailableCapture = unavailableService.captureCompilerOutput({ observation_id: unavailableExecution.observation.observationRef, lease_id: unavailableLease.lease.leaseRef });
assert.equal(unavailableCapture.status, "ACCEPTED");
const unavailableAdmission = unavailableService.admitCompilerOutput({ raw_output_id: unavailableCapture.rawOutput.rawRef });
assert.equal(unavailableAdmission.status, "ADMITTED");
const unavailablePlan = unavailableService.instantiateMaterializationPlan({ compiled_route_set_digest: unavailableAdmission.routeSet.routeSetRef });
assert.equal(unavailablePlan.status, "ACCEPTED");
assert.equal(unavailablePlan.plan.pages.length, unavailableAdmission.routeSet.routes.length);
const unavailablePageDescriptor = unavailablePlan.plan.pages[0];
const unavailableRoute = unavailableAdmission.routeSet.routes[0];
const unavailablePageAllocation = unavailableService.allocateDss04Work({ request_id: "compile-unavailable", work_kind: "PAGE", plan_ref: unavailablePlan.plan.planRef, page_identity: unavailablePageDescriptor.page_identity });
assert.equal(unavailablePageAllocation.status, "ACCEPTED");
const unavailablePageLease = unavailableService.acquireDss04Lease({ allocation_id: unavailablePageAllocation.allocation.work_identity, lease_owner: "dss04-materializer-owner" });
assert.equal(unavailablePageLease.status, "ACCEPTED");
const unavailableMaterialization = unavailableService.materializeClosedPage({ materialization_plan_digest: unavailablePlan.plan.planRef, page_identity: unavailablePageDescriptor.page_identity, lease_id: unavailablePageLease.lease.leaseRef });
assert.equal(unavailableMaterialization.status, "MATERIALIZED");
const unavailablePageDocument = JSON.parse(fs.readFileSync(path.join(unavailableRoot, unavailableMaterialization.page.casPath), "utf8"));
const unavailableDemands = unavailableRoute.evidence_demand_ids.map((demandId) => unavailableAdmission.routeSet.evidence_demands.find((demand) => demand.evidence_demand_id === demandId));
assert.deepEqual(unavailablePageDocument.route_population, [{ route_id: unavailableRoute.route_id, occurrence_id: unavailableRoute.occurrence_id }]);
assert.deepEqual(unavailablePageDocument.project_facts, unavailableRoute.input_fact_refs.map((factId) => unavailableAdmission.routeSet.input_facts.find((fact) => fact.fact_id === factId)));
assert.deepEqual(unavailablePageDocument.evidence_demands, unavailableDemands);
assert.deepEqual(unavailablePageDocument.evidence_reverse_map, unavailableDemands.map((demand) => ({ evidence_demand_id: demand.evidence_demand_id, member_kind: "UNAVAILABLE_MARKER" })));
const unavailableCompleteness = unavailableService.evaluatePageCompleteness({ materialization_plan_digest: unavailablePlan.plan.planRef, page_identity: unavailablePageDescriptor.page_identity });
assert.equal(unavailableCompleteness.status, "COMPLETE", JSON.stringify(unavailableCompleteness));
const unavailableSufficiency = unavailableService.evaluatePageSufficiency({ page_identity: unavailablePageDescriptor.page_identity, completeness_receipt_digest: unavailableCompleteness.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest });
assert.equal(unavailableSufficiency.status, "KNOWN_INSUFFICIENT");
assert.equal(unavailableSufficiency.receipt.state, "KNOWN_INSUFFICIENT");
const unavailableRemand = unavailableService.issueKnownInsufficiencyRemand({ sufficiency_receipt_digest: unavailableSufficiency.receipt.receiptRef, completeness_receipt_digest: unavailableCompleteness.receipt.receiptRef });
assert.equal(unavailableRemand.status, "REMANDED");
assert.equal(unavailableRemand.remand.state, "ISSUED");
assert.equal(unavailableService.issueKnownInsufficiencyRemand({ sufficiency_receipt_digest: unavailableSufficiency.receipt.receiptRef, completeness_receipt_digest: unavailableCompleteness.receipt.receiptRef }).status, "REPLAYED");
const unavailableOptions = { ...serviceOptions, root: unavailableRoot };
const unavailableRemandCopy = structuredClone(unavailableRemand.remand);
unavailableService = mutateSpecificDurableFixture(unavailableService, unavailableRoot, unavailableOptions, (state) => { delete state.knownInsufficiencyRemands[unavailablePageDescriptor.page_identity]; });
const unavailableRemandGap = unavailableService.recoverDss04Generation();
assert.equal(unavailableRemandGap.status, "BLOCKED");
assert.ok(unavailableRemandGap.classifications.some((classification) => classification.reason === `known-insufficiency-remand-missing.${unavailablePageDescriptor.page_identity}`));
unavailableService = mutateSpecificDurableFixture(unavailableService, unavailableRoot, unavailableOptions, (state) => { state.knownInsufficiencyRemands[unavailablePageDescriptor.page_identity] = unavailableRemandCopy; });
const unavailableRemandRestored = unavailableService.recoverDss04Generation();
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(unavailableRemandRestored.status), JSON.stringify(unavailableRemandRestored));
unavailableService.close();
service = createDss04Service(serviceOptions);
const allocationResult = service.allocateDss04Work({ request_id: "compile-1" });
assert.equal(allocationResult.status, "ACCEPTED");
assert.equal(service.allocateDss04Work({ request_id: "compile-1" }).status, "REPLAYED");
assert.equal(service.allocateDss04Work({ request_id: "compile-1", work_kind: "PAGE" }).status, "IDEMPOTENCY_CONFLICT");
const leaseResult = service.acquireDss04Lease({ allocation_id: allocationResult.allocation.work_identity });
assert.equal(leaseResult.status, "ACCEPTED");
assert.equal(service.acquireDss04Lease({ allocation_id: allocationResult.allocation.work_identity, lease_owner: "foreign" }).status, "IDEMPOTENCY_CONFLICT");
assert.equal(service.acquireDss04Lease({ allocation_id: allocationResult.allocation.work_identity, ttl_ms: 1000 }).status, "IDEMPOTENCY_CONFLICT");
assert.equal(service.acquireDss04Lease({ allocation_id: allocationResult.allocation.work_identity, expires_at: new Date(Date.now() + 29000).toISOString() }).status, "IDEMPOTENCY_CONFLICT");
const leaseAcquireEventCount = service.state.events.filter((event) => event.operationId === "acquire-dss04-lease").length;
serviceNow = new Date("2026-08-28T12:00:30.000Z");
const expiredReacquire = service.acquireDss04Lease({ allocation_id: allocationResult.allocation.work_identity });
assert.equal(expiredReacquire.status, "STALE_PREDECESSOR");
assert.equal(service.state.events.filter((event) => event.operationId === "acquire-dss04-lease").length, leaseAcquireEventCount);
serviceNow = new Date("2026-08-28T12:00:00.000Z");
const executionResult = service.executePinnedCompilation({ request_id: "compile-1", lease_id: leaseResult.lease.leaseRef });
assert.equal(executionResult.status, "COMPLETE");
const observation = executionResult.observation;
const executionEvents = service.state.events.filter((event) => event.operationId === "execute-pinned-compilation");
assert.deepEqual(executionEvents.map((event) => event.event), ["START", "TERMINATE"]);
assert.deepEqual(executionEvents.map((event) => event.outcome), ["COMPLETE", "COMPLETE"]);
assert.equal(executionEvents[0].payload.state, "RUNNING");
const captureResult = service.captureCompilerOutput({ observation_id: observation.observationRef, lease_id: leaseResult.lease.leaseRef, bytes: Buffer.from("forged caller bytes") });
assert.equal(captureResult.status, "ACCEPTED");
const capturedBytes = fs.readFileSync(path.join(root, "dss04-process-custody", `${observation.observationRef.slice(7)}.stdout`));
assert.ok(capturedBytes.length > 0);
assert.notEqual(capturedBytes.toString("utf8"), "forged caller bytes");
const admittedOutput = service.admitCompilerOutput({ raw_output_id: captureResult.rawOutput.rawRef });
assert.equal(admittedOutput.status, "ADMITTED");
assert.equal(admittedOutput.bundle.state, "ADMITTED");
assert.equal(admittedOutput.routeSet.state, "ADMITTED");
const accountingRecord = service.recordDss04Accounting({ request_id: "compile-1", observation: observation.observationRef, pages: [] });
assert.equal(accountingRecord.status, "ACCEPTED");
assert.equal(accountingRecord.accounting.state, "RECORDED");
assert.equal(service.recordDss04Accounting({ request_id: "compile-1", observation: observation.observationRef, pages: [] }).status, "REPLAYED");
assert.equal(service.status().counts.accounting, 1);
assert.deepEqual(service.state.routeSets["compile-1"].input_facts, admittedOutput.routeSet.input_facts);
assert.deepEqual(service.state.routeSets["compile-1"].evidence_demands, admittedOutput.routeSet.evidence_demands);
const retainedRouteFacts = structuredClone(service.state.routeSets["compile-1"].input_facts);
mutateDurableFixture((state) => { delete state.routeSets["compile-1"].input_facts; });
assert.equal(service.recoverDss04Generation().status, "BLOCKED");
mutateDurableFixture((state) => { state.routeSets["compile-1"].input_facts = retainedRouteFacts; state.routeSets["compile-1"].input_facts_digest = digestObject("Dss04.InputFactPopulation.v1", retainedRouteFacts); });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED"].includes(service.recoverDss04Generation().status));
mutateDurableFixture((state) => { state.routeSets["compile-1"].evidence_demands = [{ evidence_demand_id: "laundered-demand", route_id: "route-1" }]; state.routeSets["compile-1"].evidence_demand_population_digest = digestObject("DirectSemanticService.Dss04.EvidenceDemandPopulation.v1", state.routeSets["compile-1"].evidence_demands); });
assert.equal(service.recoverDss04Generation().status, "BLOCKED");
mutateDurableFixture((state) => { state.routeSets["compile-1"].evidence_demands = admittedOutput.routeSet.evidence_demands; state.routeSets["compile-1"].evidence_demand_population_digest = digestObject("Dss04.EvidenceDemandPopulation.v1", admittedOutput.routeSet.evidence_demands); });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED"].includes(service.recoverDss04Generation().status));
const planResult = service.instantiateMaterializationPlan({ compiled_route_set_digest: admittedOutput.routeSet.routeSetRef });
assert.equal(planResult.status, "ACCEPTED");
assert.equal(planResult.plan.state, "INSTANTIATED");
assert.equal(planResult.plan.pages.length, admittedOutput.routeSet.routes.length);
assert.equal(planResult.plan.partition.length, admittedOutput.routeSet.routes.length);
assert.deepEqual(planResult.plan.partition[0], { occurrence_id: admittedOutput.routeSet.routes[0].occurrence_id, disposition: "PAGE", page_identity: planResult.plan.pages[0].page_identity });
assert.equal(service.instantiateMaterializationPlan({ compiled_route_set_digest: admittedOutput.routeSet.routeSetRef }).status, "REPLAYED");
assert.equal(service.instantiateMaterializationPlan({ compiled_route_set_digest: admittedOutput.routeSet.routeSetRef, materialization_policy_digest: "sha256:" + "f".repeat(64) }).status, "IDEMPOTENCY_CONFLICT");
assert.equal(service.instantiateMaterializationPlan({ compiled_route_set_digest: admittedOutput.routeSet.routeSetRef, partition: [] }).status, "IDEMPOTENCY_CONFLICT");
const pageDescriptor = planResult.plan.pages[0];
const pageRoute = admittedOutput.routeSet.routes[0];
const pageFacts = pageRoute.input_fact_refs.map((factId) => admittedOutput.routeSet.input_facts.find((fact) => fact.fact_id === factId));
const pageDemands = pageRoute.evidence_demand_ids.map((demandId) => admittedOutput.routeSet.evidence_demands.find((demand) => demand.evidence_demand_id === demandId));
const pageAllocationResult = service.allocateDss04Work({ request_id: "compile-1", work_kind: "PAGE", plan_ref: planResult.plan.planRef, page_identity: pageDescriptor.page_identity });
assert.equal(pageAllocationResult.status, "ACCEPTED");
const pageLeaseResult = service.acquireDss04Lease({ allocation_id: pageAllocationResult.allocation.work_identity, lease_owner: "dss04-materializer-owner" });
assert.equal(pageLeaseResult.status, "ACCEPTED");
assert.equal(service.materializeClosedPage({ materialization_plan_digest: planResult.plan.planRef, page_identity: pageDescriptor.page_identity, lease_id: leaseResult.lease.leaseRef }).status, "STALE_PREDECESSOR");
const orphanCasPath = path.join(root, "dss04-page-cas", `${pageDescriptor.canonical_content_seal.slice(7)}.page`);
fs.mkdirSync(path.dirname(orphanCasPath), { recursive: true });
fs.writeFileSync(orphanCasPath, Buffer.from("orphan partial CAS bytes"));
const pageResult = service.materializeClosedPage({ materialization_plan_digest: planResult.plan.planRef, page_identity: pageDescriptor.page_identity, target_snapshot_receipt_digest: receiptResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest, lease_id: pageLeaseResult.lease.leaseRef });
assert.equal(pageResult.status, "MATERIALIZED");
assert.equal(pageResult.page.state, "MATERIALIZED");
assert.equal(service.materializeClosedPage({ materialization_plan_digest: planResult.plan.planRef, page_identity: pageDescriptor.page_identity, lease_id: pageLeaseResult.lease.leaseRef }).status, "REPLAYED");
assert.equal(service.materializeClosedPage({ materialization_plan_digest: planResult.plan.planRef, page_identity: pageDescriptor.page_identity, target_snapshot_receipt_digest: "sha256:" + "f".repeat(64), lease_id: pageLeaseResult.lease.leaseRef }).status, "IDEMPOTENCY_CONFLICT");
const pageCasFile = path.join(root, pageResult.page.casPath);
const pageCasBytes = fs.readFileSync(pageCasFile);
assert.equal(`sha256:${crypto.createHash("sha256").update(pageCasBytes).digest("hex")}`, pageResult.page.content_seal);
assert.equal(pageCasBytes.length, pageResult.page.byte_length);
const pageDocument = JSON.parse(pageCasBytes.toString("utf8"));
assert.deepEqual(pageDocument.project_facts, pageFacts);
assert.deepEqual(pageDocument.evidence_demands, pageDemands);
assert.deepEqual(pageDocument.evidence_reverse_map, pageDemands.map((demand) => ({ evidence_demand_id: demand.evidence_demand_id, member_kind: "UNAVAILABLE_MARKER" })));
assert.equal(pageDocument.source_fragments.length, receiptResult.receipt.artifactRefs.length);
assert.equal(pageDocument.source_fragments[0].artifact_ref, receiptResult.receipt.artifactRefs[0]);
assert.equal(pageDocument.source_fragments[0].bounded_locator, fileArtifact.canonical_relative_path);
assert.equal(pageDocument.source_fragments[0].content_seal, fileArtifact.content_digest);
assert.equal(pageDocument.source_fragments[0].byte_length, fileArtifact.byte_length);
assert.equal(Buffer.from(pageDocument.source_fragments[0].bytesBase64, "base64").toString(), fileBytes.toString());
const releasedPageLease = service.releaseDss04Lease({ lease_id: pageLeaseResult.lease.leaseRef, fencing_token: pageLeaseResult.lease.fencing_token });
assert.equal(releasedPageLease.status, "ACCEPTED");
assert.equal(service.releaseDss04Lease({ lease_id: pageLeaseResult.lease.leaseRef, fencing_token: pageLeaseResult.lease.fencing_token }).status, "REPLAYED");
assert.equal(service.releaseDss04Lease({ lease_id: pageLeaseResult.lease.leaseRef, fencing_token: "stale-token" }).status, "IDEMPOTENCY_CONFLICT");
const leaseCorruptRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-lease-corrupt-`);
fs.cpSync(root, leaseCorruptRoot, { recursive: true });
let leaseCorruptService = createDss04Service({ ...serviceOptions, root: leaseCorruptRoot });
leaseCorruptService.close();
const leaseCorruptStore = new Dss04SqliteStore({ root: leaseCorruptRoot, now: serviceOptions.now });
const leaseCorruptState = leaseCorruptStore.read();
const releasedAllocationId = pageAllocationResult.allocation.work_identity;
leaseCorruptState.allocations[releasedAllocationId].reservation_digest = "sha256:" + "f".repeat(64);
leaseCorruptStore.write(leaseCorruptState);
leaseCorruptStore.close();
leaseCorruptService = createDss04Service({ ...serviceOptions, root: leaseCorruptRoot });
assert.equal(leaseCorruptService.recoverDss04Generation().status, "BROKEN");
leaseCorruptService.close();
const completenessResult = service.evaluatePageCompleteness({ materialization_plan_digest: planResult.plan.planRef, page_identity: pageDescriptor.page_identity });
assert.equal(completenessResult.status, "COMPLETE");
assert.equal(completenessResult.receipt.state, "COMPLETE");
assert.equal(service.state.events.at(-1).event, "COMPLETE");
assert.equal(service.evaluatePageCompleteness({ materialization_plan_digest: planResult.plan.planRef, page_identity: pageDescriptor.page_identity }).status, "REPLAYED");
const sufficiencyResult = service.evaluatePageSufficiency({ page_identity: pageDescriptor.page_identity, completeness_receipt_digest: completenessResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest });
assert.equal(sufficiencyResult.status, "KNOWN_INSUFFICIENT");
assert.equal(sufficiencyResult.receipt.state, "KNOWN_INSUFFICIENT");
assert.equal(service.evaluatePageSufficiency({ page_identity: pageDescriptor.page_identity, completeness_receipt_digest: completenessResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest }).status, "REPLAYED");
const evaluationBeforeRefusals = { counts: service.status().counts, eventHead: service.state.events.at(-1)?.eventDigest || null };
assert.equal(service.evaluatePageSufficiency({ page_identity: pageDescriptor.page_identity, materialization_plan_digest: planResult.plan.planRef, completeness_receipt_digest: completenessResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest }).status, "STALE_PREDECESSOR");
assert.equal(service.evaluatePageSufficiency({ page_identity: pageDescriptor.page_identity, completeness_receipt_digest: completenessResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest, generation: "sha256:" + "f".repeat(64) }).status, "STALE_PREDECESSOR");
assert.deepEqual(service.status().counts, evaluationBeforeRefusals.counts);
assert.equal(service.state.events.at(-1)?.eventDigest || null, evaluationBeforeRefusals.eventHead);
const countsBeforeSufficientRemand = { counts: service.status().counts, eventHead: service.state.events.at(-1)?.eventDigest || null };
const sufficientRemand = service.issueKnownInsufficiencyRemand({ sufficiency_receipt_digest: sufficiencyResult.receipt.receiptRef, completeness_receipt_digest: completenessResult.receipt.receiptRef });
assert.equal(sufficientRemand.status, "REMANDED");
assert.equal(sufficientRemand.remand.state, "ISSUED");
assert.notDeepEqual(service.status().counts, countsBeforeSufficientRemand.counts);
const accountingComplete = service.recordDss04Accounting({ request_id: "compile-1", observation: observation.observationRef, pages: [pageResult.page] });
assert.equal(accountingComplete.status, "COMPLETE");
assert.equal(accountingComplete.accounting.state, "FINAL");
assert.equal(service.recordDss04Accounting({ request_id: "compile-1", observation: observation.observationRef, pages: [pageResult.page] }).status, "REPLAYED");
const accountingCorruptRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-accounting-corrupt-`);
fs.cpSync(root, accountingCorruptRoot, { recursive: true });
let accountingCorruptService = createDss04Service({ ...serviceOptions, root: accountingCorruptRoot });
accountingCorruptService.close();
const accountingCorruptStore = new Dss04SqliteStore({ root: accountingCorruptRoot, now: serviceOptions.now });
const accountingCorruptState = accountingCorruptStore.read();
accountingCorruptState.accounting["compile-1"].raw_bytes += 1;
accountingCorruptStore.write(accountingCorruptState);
accountingCorruptStore.close();
accountingCorruptService = createDss04Service({ ...serviceOptions, root: accountingCorruptRoot });
assert.equal(accountingCorruptService.recoverDss04Generation().status, "BROKEN");
accountingCorruptService.close();
const lateCancellationScope = service._refFor("CancellationGrantScope", { generation: service.state.generations.current.generationRef, request: service.state.compilationRequests["compile-1"].requestRef, observation: observation.observationRef, observationState: observation.state });
const lateCancellationGrant = { owner: "dss03-authority-owner", root: "ratified-dss03-result-root", authorized: true, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", lateCancellationScope), scopeDigest: lateCancellationScope };
const cancellationBefore = { counts: service.status().counts, eventHead: service.state.events.at(-1)?.eventDigest || null };
assert.equal(service.requestDss04Cancellation({ request_id: "compile-1", observation: observation.observationRef, grant: { owner: "dss03-authority-owner", root: "ratified-dss03-result-root", authorized: true } }).status, "UNAUTHORIZED");
assert.deepEqual(service.status().counts, cancellationBefore.counts);
assert.equal(service.state.events.at(-1)?.eventDigest || null, cancellationBefore.eventHead);
assert.equal(service.requestDss04Cancellation({ request_id: "compile-1", observation: observation.observationRef, grant: lateCancellationGrant }).status, "CANCELLATION_LOST_RACE");
assert.equal(service.adjudicateDss04Cancellation({ request_id: "compile-1", observation: observation.observationRef }).status, "COMPLETE");
assert.equal(service.adjudicateDss04Cancellation({ request_id: "compile-1", observation: observation.observationRef }).status, "REPLAYED");
// Candidate intake remains an untrusted E-lane observation.  Independent
// validation ignores persuasive candidate evidence and reads only the exact
// admitted snapshot/runtime/compiler inputs at the issued validator boundary.
const candidateAuth = { owner: "dss04-validator-revision-owner", root: "dss04-validator-revision-root", authorized: true };
const validationAuth = { owner: "dss04-candidate-validation-owner", root: "independent-candidate-validator-root", authorized: true };
const validatorIssue = service.issueValidatorRevision({ generation: service.state.generations.current.generationRef, grant: candidateAuth });
assert.equal(validatorIssue.status, "VALIDATED");
assert.equal(service.issueValidatorRevision({ generation: service.state.generations.current.generationRef, grant: candidateAuth }).status, "REPLAYED");
const candidateRoute = service.state.routeSets["compile-1"].routes[0];
const candidateRouteIdentity = service._refFor("CandidateRouteIdentity", { route_id: candidateRoute.route_id, occurrence_id: candidateRoute.occurrence_id });
const candidateClaim = { fact_id: "fact-not-present", source_locator: "missing-fact.txt", route_identity: candidateRouteIdentity };
const candidateBase = { worker_runtime_revision: runtimeDigest, task_id: "candidate-task-1", attempt_id: "attempt-1", page_identity: pageDescriptor.page_identity, route_identity: candidateRouteIdentity, claimed_missing_fact_digest: service._refFor("CandidateMissingFact", candidateClaim), bounded_rationale_digest: "sha256:" + "1".repeat(64), source_locator_digest: service._refFor("CandidateSourceLocator", { locator: candidateClaim.source_locator }), service_generation: service.state.generations.current.generationRef, observed_at: serviceNow.toISOString(), recorded_at: serviceNow.toISOString(), claim: candidateClaim, evidence: { schema: "forged", classification: "REFUTED", observations: [{ forged: true }] } };
const submittedFault = service.submitPageFaultCandidate({ candidate: candidateBase });
assert.equal(submittedFault.status, "ACCEPTED");
assert.equal(service.submitPageFaultCandidate({ candidate: candidateBase }).status, "REPLAYED");
const candidateCounts = service.status().counts;
const validatedFault = service.validateCandidateIndependently({ page_fault_candidate: submittedFault.candidate, generation: service.state.generations.current.generationRef, project_registry_revision_digest: registryRef, target_snapshot_receipt_digest: receiptResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest, compiler_build_pin_digest: pinCommitment, validator_revision: validatorIssue.validatorRevision, validationGrant: validationAuth, classification: "REFUTED" });
assert.equal(validatedFault.status, "VALIDATED");
assert.equal(validatedFault.validation.state, "VALIDATED");
assert.equal(service.status().counts.pageFaultCandidates, candidateCounts.pageFaultCandidates);
const edgeClaim = { from_route_id: candidateRoute.route_id, to_route_id: candidateRoute.route_id, relation: "unobserved-edge", source_locator: "missing-edge.txt" };
const edgeCandidate = { ...candidateBase, task_id: "candidate-task-2", attempt_id: "attempt-1", claimed_missing_fact_digest: undefined, claimed_edge_digest: service._refFor("CandidateEdge", edgeClaim), source_locator_digest: service._refFor("CandidateSourceLocator", { locator: edgeClaim.source_locator }), claim: edgeClaim, evidence: { schema: "forged", classification: "REFUTED", observations: [{ forged: true }] } };
delete edgeCandidate.claimed_missing_fact_digest;
const submittedEdge = service.submitNovelEdgeCandidate({ candidate: edgeCandidate });
assert.equal(submittedEdge.status, "ACCEPTED");
assert.equal(service.validateCandidateIndependently({ novel_edge_candidate: submittedEdge.candidate, generation: service.state.generations.current.generationRef, project_registry_revision_digest: registryRef, target_snapshot_receipt_digest: receiptResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest, compiler_build_pin_digest: pinCommitment, validator_revision: validatorIssue.validatorRevision, validationGrant: validationAuth }).status, "VALIDATED");
// The exact compiler population has one page per route.  This bounded tail
// intentionally materializes one selected page, so a batch seal must remain
// BLOCKED until the other 1,517 pages reach terminal coverage.  Exercise the
// seal lifecycle in an isolated durable copy so the main recovery matrix can
// continue to test the unsealed cut.
const batchRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-batch-bounded-`);
fs.cpSync(root, batchRoot, { recursive: true });
const batchService = createDss04Service({ ...serviceOptions, root: batchRoot });
const batchPrepare = batchService.sealMaterializationBatch({ materialization_plan_digest: planResult.plan.planRef });
assert.equal(batchPrepare.status, "BLOCKED", JSON.stringify(batchPrepare));
assert.equal(batchPrepare.seal.state, "BLOCKED");
assert.equal(batchService.sealMaterializationBatch({ materialization_plan_digest: planResult.plan.planRef }).status, "REPLAYED");
batchService.close();
service.close();
service = createDss04Service(serviceOptions);
const preparedRecovery = service.recoverDss04Generation();
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(preparedRecovery.status), JSON.stringify(preparedRecovery));
const boundedSealRef = batchPrepare.seal.sealRef;
const projectionScope = service._refFor("ClosedPageProjectionGrantScope", { generation: service.state.generations.current.generationRef, page: pageResult.page.pageRef, seal: boundedSealRef, completeness: completenessResult.receipt.receiptRef, sufficiency: sufficiencyResult.receipt.receiptRef });
const projectionGrant = { owner: "dss04-projection-owner", root: "dss04-projection-root", scopeDigest: projectionScope, proofDigest: service._refFor("ProjectionGrant", projectionScope) };
const projectionInput = { generation: service.state.generations.current.generationRef, page_identity: pageResult.page.page_identity, materialization_batch_seal: boundedSealRef, completeness_receipt_digest: completenessResult.receipt.receiptRef, sufficiency_receipt_digest: sufficiencyResult.receipt.receiptRef, projectionGrant };
const beforeProjection = { counts: service.status().counts, eventHead: service.state.events.at(-1)?.eventDigest || null };
const projected = service.projectClosedPage(projectionInput);
assert.equal(projected.status, "STALE_PREDECESSOR");
assert.deepEqual({ counts: service.status().counts, eventHead: service.state.events.at(-1)?.eventDigest || null }, beforeProjection);
const missingProjectionReceipt = { ...projectionInput }; delete missingProjectionReceipt.completeness_receipt_digest;
assert.equal(service.projectClosedPage(missingProjectionReceipt).status, "STALE_PREDECESSOR");
assert.equal(service.projectClosedPage({ ...projectionInput, projectionGrant: { ...projectionGrant, proofDigest: "sha256:" + "f".repeat(64) } }).status, "STALE_PREDECESSOR");
assert.equal(service.projectClosedPage({ ...projectionInput, generation: "sha256:" + "e".repeat(64) }).status, "STALE_GENERATION");
assert.equal(service.submitPageFaultCandidate({ candidate: { ...candidateBase, task_id: "candidate-cross-page", page_identity: "sha256:" + "f".repeat(64) } }).status, "REJECTED");
assert.equal(service.validateCandidateIndependently({ page_fault_candidate: submittedFault.candidate, generation: service.state.generations.current.generationRef, project_registry_revision_digest: registryRef, target_snapshot_receipt_digest: receiptResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest, compiler_build_pin_digest: pinCommitment, validator_revision: validatorIssue.validatorRevision }).status, "STALE_PREDECESSOR");
assert.equal(service.revokeValidatorRevision({ generation: service.state.generations.current.generationRef, grant: candidateAuth }).status, "STALE_GENERATION");
assert.equal(service.validateCandidateIndependently({ novel_edge_candidate: submittedEdge.candidate, generation: service.state.generations.current.generationRef, project_registry_revision_digest: registryRef, target_snapshot_receipt_digest: receiptResult.receipt.receiptRef, project_evidence_runtime_revision_digest: runtimeDigest, compiler_build_pin_digest: pinCommitment, validator_revision: validatorIssue.validatorRevision, validationGrant: validationAuth }).status, "STALE_PREDECESSOR");
const candidateCopy = structuredClone(submittedFault.candidate);
mutateDurableFixture((state) => { delete state.pageFaultCandidates[candidateCopy.candidateRef]; });
const missingCandidateRecovery = service.recoverDss04Generation();
assert.equal(missingCandidateRecovery.status, "BLOCKED", JSON.stringify(missingCandidateRecovery));
mutateDurableFixture((state) => { state.pageFaultCandidates[candidateCopy.candidateRef] = candidateCopy; });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(service.recoverDss04Generation().status));
const candidateCorruptRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-candidate-corrupt-`);
fs.cpSync(root, candidateCorruptRoot, { recursive: true });
let candidateCorruptService = createDss04Service({ ...serviceOptions, root: candidateCorruptRoot });
candidateCorruptService.close();
const candidateCorruptStore = new Dss04SqliteStore({ root: candidateCorruptRoot, now: serviceOptions.now });
const candidateCorruptState = candidateCorruptStore.read();
candidateCorruptState.pageFaultCandidates[candidateCopy.candidateRef].task_id = "tampered-candidate";
candidateCorruptStore.write(candidateCorruptState);
candidateCorruptStore.close();
candidateCorruptService = createDss04Service({ ...serviceOptions, root: candidateCorruptRoot });
assert.equal(candidateCorruptService.recoverDss04Generation().status, "BROKEN");
candidateCorruptService.close();
const completenessCopy = structuredClone(completenessResult.receipt);
const corruptCompleteness = structuredClone(completenessCopy);
corruptCompleteness.required_route_population_digest = "sha256:" + "f".repeat(64);
corruptCompleteness.receiptRef = digestObject("DirectSemanticService.Dss04.PageCompletenessReceipt.v1", Object.fromEntries(["page_identity", "required_route_population_digest", "materialized_route_population_digest", "remanded_route_population_digest", "required_evidence_population_digest", "evidence_reconciliation_digest", "reverse_map_digest", "service_generation"].map((field) => [field, corruptCompleteness[field]])));
mutateDurableFixture((state) => { state.pageCompletenessReceipts[pageDescriptor.page_identity] = corruptCompleteness; });
const corruptCompletenessRecovery = service.recoverDss04Generation();
assert.equal(corruptCompletenessRecovery.status, "BLOCKED");
assert.ok(corruptCompletenessRecovery.classifications.some((classification) => classification.reason === `page-completeness-content.${pageDescriptor.page_identity}`));
mutateDurableFixture((state) => { state.pageCompletenessReceipts[pageDescriptor.page_identity] = completenessCopy; });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(service.recoverDss04Generation().status));
mutateDurableFixture((state) => { delete state.pageCompletenessReceipts[pageDescriptor.page_identity]; });
const missingCompletenessRecovery = service.recoverDss04Generation();
assert.equal(missingCompletenessRecovery.status, "BLOCKED");
assert.ok(missingCompletenessRecovery.classifications.some((classification) => classification.reason === `page-completeness-missing.${pageDescriptor.page_identity}`));
mutateDurableFixture((state) => { state.pageCompletenessReceipts[pageDescriptor.page_identity] = completenessCopy; });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(service.recoverDss04Generation().status));
fs.unlinkSync(pageCasFile);
service.close();
service = createDss04Service(serviceOptions);
const tamperedPageRecovery = service.recoverDss04Generation();
assert.equal(tamperedPageRecovery.status, "BLOCKED");
assert.ok(tamperedPageRecovery.classifications.some((classification) => classification.reason === `closed-page-cas-missing.${pageResult.page.page_identity}`));
fs.writeFileSync(pageCasFile, pageCasBytes);
service.close();
service = createDss04Service(serviceOptions);
const restoredPageRecovery = service.recoverDss04Generation();
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(restoredPageRecovery.status), restoredPageRecovery);
const sufficiencyCopy = structuredClone(sufficiencyResult.receipt);
mutateDurableFixture((state) => { delete state.pageSufficiencyReceipts[pageDescriptor.page_identity]; });
const missingSufficiencyRecovery = service.recoverDss04Generation();
assert.equal(missingSufficiencyRecovery.status, "BLOCKED");
assert.ok(missingSufficiencyRecovery.classifications.some((classification) => classification.reason === `page-sufficiency-missing.${pageDescriptor.page_identity}`));
mutateDurableFixture((state) => { state.pageSufficiencyReceipts[pageDescriptor.page_identity] = sufficiencyCopy; });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(service.recoverDss04Generation().status));
const corruptSufficiency = structuredClone(sufficiencyCopy);
corruptSufficiency.worker_task_contract_digest = "sha256:" + "f".repeat(64);
corruptSufficiency.receiptRef = digestObject("DirectSemanticService.Dss04.PageSufficiencyReceipt.v1", Object.fromEntries(["page_identity", "worker_task_contract_digest", "completeness_receipt_digest", "availability_state_digest", "policy_state_digest", "budget_state_digest", "standing", "service_generation"].map((field) => [field, corruptSufficiency[field]])));
mutateDurableFixture((state) => { state.pageSufficiencyReceipts[pageDescriptor.page_identity] = corruptSufficiency; });
const corruptSufficiencyRecovery = service.recoverDss04Generation();
assert.equal(corruptSufficiencyRecovery.status, "BLOCKED");
assert.ok(corruptSufficiencyRecovery.classifications.some((classification) => classification.reason === `page-sufficiency-content.${pageDescriptor.page_identity}`));
mutateDurableFixture((state) => { state.pageSufficiencyReceipts[pageDescriptor.page_identity] = sufficiencyCopy; });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED", "REPLAYED"].includes(service.recoverDss04Generation().status));
const planOperationName = `instantiate-materialization-plan:${admittedOutput.routeSet.routeSetRef}`;
const planOperationBinding = structuredClone(service.state.operationInputs[planOperationName]);
mutateDurableFixture((state) => { delete state.operationInputs[planOperationName]; });
assert.equal(service.recoverDss04Generation().status, "BLOCKED");
mutateDurableFixture((state) => { state.operationInputs[planOperationName] = planOperationBinding; });
assert.ok(["READY", "RECOVERY_EVENTS_APPENDED"].includes(service.recoverDss04Generation().status));
// Execute the output-admission mutation matrix against the real quarantined
// artifact. Restore the admitted bytes after every case.
const custodyFile = path.join(root, "dss04-process-custody", `${observation.observationRef.slice(7)}.stdout`);
const admittedBytes = fs.readFileSync(custodyFile);
const outputAttackResults = [];
const resealOutput = (output) => {
  output.obligation_population_digest = digestObject("DirectSemanticService.Dss04.ObligationPopulation.v1", output.obligations);
  output.route_population_digest = digestObject("DirectSemanticService.Dss04.RoutePopulation.v1", output.routes);
  output.evidence_demand_population_digest = digestObject("DirectSemanticService.Dss04.EvidenceDemandPopulation.v1", output.evidence_demands);
  output.exclusion_population_digest = digestObject("DirectSemanticService.Dss04.ExclusionPopulation.v1", output.exclusions);
  output.static_remand_population_digest = digestObject("DirectSemanticService.Dss04.StaticRemandPopulation.v1", output.static_remands);
  output.contact_occurrence_reconciliation_digest = digestObject("DirectSemanticService.Dss04.ContactOccurrenceReconciliation.v1", output.contacts);
  output.input_facts_digest = digestObject("DirectSemanticService.Dss04.InputFactPopulation.v1", output.input_facts);
  output.exclusion_theorem_digest = digestObject("DirectSemanticService.Dss04.ExclusionTheorem.v1", output.exclusions);
};
const runOutputAttack = (attackId, mutate, expected, reseal = true) => {
  const candidate = JSON.parse(admittedBytes.toString("utf8"));
  mutate(candidate);
  if (reseal && Object.hasOwn(candidate, "compiler_identity_digest")) resealOutput(candidate);
  fs.writeFileSync(custodyFile, canonicalJson(candidate));
  const actual = service._validateCompilerOutputPayload({ raw_output_id: captureResult.rawOutput.rawRef });
  assert.equal(actual, expected, attackId);
  outputAttackResults.push({ attackId, expected, actual });
  fs.writeFileSync(custodyFile, admittedBytes);
};
runOutputAttack("missing-occurrence", (output) => { delete output.obligations[0].summary; }, "obligation-shape");
runOutputAttack("extra-contact", (output) => { output.contacts = []; }, "receipt-field-population");
runOutputAttack("reordered-contact", (output) => { output.reconciliation.mapped_surface_ids.reverse(); }, "reconciliation-population");
runOutputAttack("arbitrary-route-owner-root", (output) => { output.routes = []; }, "receipt-field-population");
runOutputAttack("missing-fact", (output) => { output.input_facts = []; }, "receipt-field-population");
runOutputAttack("duplicate-fact", (output) => { output.input_facts = []; }, "receipt-field-population");
runOutputAttack("unbound-evidence-demand", (output) => { output.evidence_demands = []; }, "receipt-field-population");
runOutputAttack("inline-evidence-laundering", (output) => { output.evidence_demands = [{ evidence_demand_id: "inline-demand", evidence_object: { asserted_fact: "not-admitted" } }]; }, "receipt-field-population");
runOutputAttack("wrong-count", (output) => { output.obligation_count += 1; }, "receipt-population");
runOutputAttack("wrong-digest", (output) => { output.route_population_digest = "sha256:" + "f".repeat(64); }, "receipt-field-population");
runOutputAttack("extra-authority-field", (output) => { output.authority_proof = "forged"; }, "receipt-field-population");
runOutputAttack("self-ratified-exclusion", (output) => { output.reconciliation.unclassified_surface_ids = ["attacker-surface"]; }, "reconciliation-population");
const lawfulRemand = { page_identity: "sha256:" + "1".repeat(64), failed_demand_population_digest: "sha256:" + "2".repeat(64), failed_policy_population_digest: "sha256:" + "3".repeat(64), route_occurrence_population_digest: "sha256:" + "4".repeat(64), evidence_state_digest: "sha256:" + "5".repeat(64), remand_code: "KNOWN_INSUFFICIENT", service_generation: compilationRequest.service_generation, owner: "dss04-remand-owner", root: "dss04-remand-root", scope_digest: compilationRequest.requested_route_scope_digest, standing: "KNOWN_INSUFFICIENT" };
runOutputAttack("junk-remand", (output) => { output.static_remands = [{}]; output.verdict = "OBLIGATIONS_EMITTED"; }, "static-remand-polarity");
runOutputAttack("lawful-typed-remand", (output) => { output.static_remands = [lawfulRemand]; output.verdict = "REMAND_STATIC"; }, null);
assert.equal(fs.readFileSync(custodyFile).equals(admittedBytes), true);
const outputReplayAfterPageRecovery = service.admitCompilerOutput({ raw_output_id: captureResult.rawOutput.rawRef });
assert.equal(outputReplayAfterPageRecovery.status, "REPLAYED", outputReplayAfterPageRecovery);
const countsBeforeIsolation = service.status().counts;
assert.equal(service.executePinnedCompilation({ request_id: "compile-1", lease_id: leaseResult.lease.leaseRef, networkEnabled: true }).status, "REPLAYED");
assert.deepEqual(service.status().counts, countsBeforeIsolation);
const qualified = JSON.parse(fs.readFileSync(new URL("../src/main/direct/semantic-service/resources/dss04-module.v0.json", import.meta.url)));
const transitions = new Map(qualified.qualified_transitions.map((row) => [row.transitionId, row]));
for (const event of service.state.events) {
  assert.ok(event.transitionId, `unqualified event ${event.sequence}`);
  const row = transitions.get(event.transitionId);
  assert.ok(row, `unknown transition ${event.transitionId}`);
  assert.equal(event.operationId, row.operationId);
  assert.equal(event.carrierId, row.carrierId);
  assert.equal(event.event, row.event);
  assert.equal(event.owner, row.owner);
  assert.deepEqual(event.fromStates, row.fromStates);
  assert.equal(event.toState, row.toState);
  assert.ok(row.outcomeCases.includes(event.outcome));
}
// Corrupting the process-owned custody bytes must create a durable CORRUPT
// carrier rather than accepting caller-provided replacement bytes.
const retainedRawOutput = structuredClone(service.state.rawCompilerOutputs[observation.request_id]);
delete service.state.rawCompilerOutputs[observation.request_id];
fs.writeFileSync(custodyFile, Buffer.from("corrupted-process-custody"));
const corruptCapture = service.captureCompilerOutput({ observation_id: observation.observationRef, lease_id: leaseResult.lease.leaseRef });
assert.equal(corruptCapture.status, "CORRUPT");
assert.equal(service.state.rawCompilerOutputs[observation.request_id].state, "CORRUPT");
mutateDurableFixture((state) => { state.rawCompilerOutputs[observation.request_id] = retainedRawOutput; });
fs.writeFileSync(custodyFile, admittedBytes);
// Recovery owns EXPIRE: an elapsed HELD lease is terminalized with the
// carrier-qualified recovery event, never treated as a fresh lease or as a
// caller-authorized mutation.
serviceNow = new Date(serviceNow.getTime() + 30000);
const expiredRecovery = service.recoverDss04Generation();
assert.equal(expiredRecovery.status, "RECOVERY_EVENTS_APPENDED");
assert.equal(service.state.leases[allocationResult.allocation.work_identity].state, "EXPIRED");
assert.equal(service.state.events.filter((event) => event.event === "EXPIRE").at(-1).event, "EXPIRE");
// An executable-latch isolation failure must publish the declared observation
// carrier atomically, even though no child process was started.
const isolationRoot = fs.mkdtempSync(`${os.tmpdir()}/dss04-isolation-failure-`);
service.close();
fs.cpSync(root, isolationRoot, { recursive: true });
service = createDss04Service({ ...serviceOptions, root: root });
const isolationService = createDss04Service({ ...serviceOptions, root: isolationRoot });
assert.equal(isolationService.releaseDss04Lease({ lease_id: leaseResult.lease.leaseRef, fencing_token: leaseResult.lease.fencing_token }).status, "ACCEPTED");
const isolationRequest = { ...compilationRequest, request_id: "isolation-failure" };
const isolationScope = digestObject("DirectSemanticService.Dss04.CompilationRequestGrantScope.v1", { generation: isolationService.state.generations.current.generationRef, request: isolationRequest, sealedResult: "job-1", registry: registryRef, snapshot: receiptResult.receipt.receiptRef, runtime: runtimeDigest });
const isolationGrant = { ...compilationGrant, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", isolationScope), scopeDigest: isolationScope };
assert.equal(isolationService.submitCompilationRequest({ request: isolationRequest, grant: isolationGrant }).status, "ACCEPTED");
const isolationAllocation = isolationService.allocateDss04Work({ request_id: isolationRequest.request_id });
assert.equal(isolationAllocation.status, "ACCEPTED");
const isolationLease = isolationService.acquireDss04Lease({ allocation_id: isolationAllocation.allocation.work_identity });
assert.equal(isolationLease.status, "ACCEPTED");
const runtimeBeforeIsolation = isolationService.compilerRuntime;
isolationService.compilerRuntime = Object.freeze({ ...runtimeBeforeIsolation, sandboxProfileDigest: "sha256:" + "f".repeat(64) });
const isolationFailure = isolationService.executePinnedCompilation({ request_id: isolationRequest.request_id, lease_id: isolationLease.lease.leaseRef });
assert.equal(isolationFailure.status, "ISOLATION_FAILED");
assert.equal(isolationFailure.observation.state, "ISOLATION_FAILED");
assert.equal(isolationService.state.observations[isolationRequest.request_id].observationRef, isolationFailure.observation.observationRef);
assert.equal(isolationService.state.events.at(-1).event, "FAIL_ISOLATION");
isolationService.compilerRuntime = runtimeBeforeIsolation;
assert.equal(isolationService.releaseDss04Lease({ lease_id: isolationLease.lease.leaseRef, fencing_token: isolationLease.lease.fencing_token }).status, "ACCEPTED");
isolationService.close();
const prestartRequest = { ...compilationRequest, request_id: "cancel-prestart" };
const prestartScope = digestObject("DirectSemanticService.Dss04.CompilationRequestGrantScope.v1", { generation: service.state.generations.current.generationRef, request: prestartRequest, sealedResult: "job-1", registry: registryRef, snapshot: receiptResult.receipt.receiptRef, runtime: runtimeDigest });
const prestartGrant = { ...compilationGrant, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", prestartScope), scopeDigest: prestartScope };
assert.equal(service.submitCompilationRequest({ request: prestartRequest, grant: prestartGrant }).status, "ACCEPTED");
const prestartCancellationScope = service._refFor("CancellationGrantScope", { generation: service.state.generations.current.generationRef, request: service.state.compilationRequests["cancel-prestart"].requestRef, observation: null, observationState: "UNSEEN" });
const prestartCancellationGrant = { owner: "dss03-authority-owner", root: "ratified-dss03-result-root", authorized: true, proofDigest: digestObject("DirectSemanticService.Dss04.AuthorizationProof.v1", prestartCancellationScope), scopeDigest: prestartCancellationScope };
const prestartCancellation = service.requestDss04Cancellation({ request_id: "cancel-prestart", grant: prestartCancellationGrant });
assert.equal(prestartCancellation.status, "CANCELLED_PRESTART");
assert.equal(prestartCancellation.request.state, "CANCELLED");
assert.equal(service.requestDss04Cancellation({ request_id: "cancel-prestart", grant: prestartCancellationGrant }).status, "REPLAYED");
assert.ok(["READY", "REPLAYED"].includes(service.recoverDss04Generation().status));
// A present but mismatched referenced object is invalid custody, not an
// ordinary missing-artifact receipt gap.
fs.writeFileSync(pageCasFile, Buffer.from("mismatched-page-custody"));
service.close();
service = createDss04Service(serviceOptions);
const mismatchedPageRecovery = service.recoverDss04Generation();
assert.equal(mismatchedPageRecovery.status, "BROKEN");
assert.ok(mismatchedPageRecovery.classifications.some((classification) => classification.reason === `closed-page-cas-mismatch.${pageResult.page.page_identity}`));
assert.equal(createDss04Service({ root: fs.mkdtempSync(`${os.tmpdir()}/dss04-broken-`), anchorPath: "missing-anchor.json" }).openDss04Generation().status, "ROOT_BROKEN");
service.close();
fs.rmSync(tamperedCompilerRoot, { recursive: true, force: true });
fs.rmSync(relocatedCompilerRoot, { recursive: true, force: true });
console.log(JSON.stringify({ suite: "direct-semantic-service-dss04-compilation", status: "passed", operations: ["install-compiler-build-pin", "install-project-registry-root-pin", "open-dss04-generation", "admit-project-registry-revision", "admit-target-snapshot", "admit-project-evidence-runtime", "accept-dss03-sealed-result", "recover-dss04-generation", "submit-compilation-request", "allocate-dss04-work", "acquire-dss04-lease", "execute-pinned-compilation", "capture-compiler-output", "admit-compiler-output", "instantiate-materialization-plan", "materialize-closed-page", "evaluate-page-completeness", "evaluate-page-sufficiency", "issue-known-insufficiency-remand", "record-dss04-accounting", "request-dss04-cancellation", "adjudicate-dss04-cancellation", "release-dss04-lease", "submit-page-fault-candidate", "submit-novel-edge-candidate", "issue-validator-revision", "validate-candidate-independently", "seal-materialization-batch", "project-closed-page"], attackCoverage: { count: outputAttackResults.length + 11, attacks: [...outputAttackResults, { attackId: "forged-authorization-proof", expected: "UNAUTHORIZED", actual: "UNAUTHORIZED" }, { attackId: "process-custody-corruption", expected: "CORRUPT", actual: corruptCapture.status }, { attackId: "oversized-admitted-fact", expected: "OVER_BUDGET", actual: overBudgetPlan.status }, { attackId: "projection-forged-grant", expected: "UNAUTHORIZED", actual: "UNAUTHORIZED" }, { attackId: "projection-stale-generation", expected: "STALE_GENERATION", actual: "STALE_GENERATION" }, { attackId: "batch-seal-restart", expected: "BLOCKED", actual: batchPrepare.status }, { attackId: "foreign-compiler-pin", expected: "PIN_MISMATCH", actual: "PIN_MISMATCH" }, { attackId: "persisted-pin-tamper-open", expected: "PIN_MISMATCH", actual: pinTamperOpen.status }, { attackId: "target-snapshot-cannot-execute", expected: "COMPLETE_WITHOUT_TARGET_MARKER", actual: compilerInputExecution.status + (compilerInputStdout.toString("utf8").includes("TARGET_SNAPSHOT_EXECUTED") ? "_WITH_TARGET_MARKER" : "_WITHOUT_TARGET_MARKER") }, { attackId: "expired-lease-reacquire", expected: "STALE_PREDECESSOR", actual: expiredReacquire.status }, { attackId: "isolation-failure-carrier", expected: "ISOLATION_FAILED_WITH_OBSERVATION", actual: isolationFailure.status + (isolationFailure.observation?.state === "ISOLATION_FAILED" ? "_WITH_OBSERVATION" : "_WITHOUT_OBSERVATION") }] }, readinessMode: "LAWFUL_RECOVERY", authorityEffect: "none" }));
