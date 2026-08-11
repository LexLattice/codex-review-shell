#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  buildArcagi3RepositoryProjection,
  inspectArcagi3Repository,
  profile,
  validateResidentRepositoryObservation,
} = require("../src/main/direct/epistemic/repository-runtime");
const { digestFor } = require("../src/main/direct/epistemic/kernel");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(
  process.env.ARCAGI3_REPOSITORY_ROOT || "/home/rose/work/arcagi3-odeu-local",
);
const before = inspectArcagi3Repository(repositoryRoot);
const child = spawn(process.execPath, [
  path.join(shellRoot, "src/backend/wsl-agent.js"),
  "--root",
  repositoryRoot,
  "--workspace-kind",
  "wsl",
  "--project-id",
  "arcagi3",
], {
  cwd: shellRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let settled = false;
const timeout = setTimeout(() => {
  if (!settled) child.kill("SIGKILL");
}, 180_000);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

const resultPromise = new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (!settled) reject(new Error(`resident backend exited before response: ${code}:${signal}:${stderr}`));
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      newline = stdout.indexOf("\n");
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== "epistemic-resident-smoke") continue;
      if (message.error) reject(new Error(message.error.message || "resident observation failed"));
      else resolve(message.result);
    }
  });
});

child.stdin.write(`${JSON.stringify({
  id: "epistemic-resident-smoke",
  method: "directEpistemicRepositoryObservation",
  params: {
    profile: {
      profileId: profile.profileId,
      revision: profile.revision,
      markers: profile.markers,
      sources: profile.sources,
    },
  },
})}\n`);

try {
  const residentResult = await resultPromise;
  settled = true;
  const localProjection = buildArcagi3RepositoryProjection({ projectId: "arcagi3", observation: before });
  const validationOptions = {
    profile,
    projectId: "arcagi3",
    expectedObservation: before,
    expectedORevisionRef: localProjection.oRevision.ref,
    expectedERevisionRef: localProjection.eRevision.ref,
  };
  const resident = validateResidentRepositoryObservation(residentResult, validationOptions);
  assert.equal(resident.schema, "direct_epistemic_repository_observation@1");
  assert.equal(resident.observationComplete, true);
  assert.equal(resident.captureCoherent, true);
  assert.equal(resident.rawWorkspacePathIncluded, false);
  assert.equal(resident.rawFileContentIncluded, false);
  assert.equal(resident.sources.length, profile.sources.length);
  assert.deepEqual(resident.validationOmissions, []);
  assert.equal(resident.sourceSetDigest, before.sourceSetDigest);
  assert.deepEqual(resident.untrackedFiles, before.untrackedFiles);
  assert.equal(resident.untrackedDigest, before.untrackedDigest);
  assert.equal(resident.trackedDiffDigest, before.trackedDiffDigest);
  assert.equal(resident.statusDigest, before.statusDigest);
  assert.equal(resident.gitWitnessAfterDigest, before.gitWitnessAfterDigest);
  assert.equal(resident.worktreeDigest, before.worktreeDigest);
  const residentProjection = buildArcagi3RepositoryProjection({
    projectId: "arcagi3",
    observation: resident,
  });
  assert.equal(residentProjection.oRevision.oRevisionId, localProjection.oRevision.oRevisionId);
  assert.equal(residentProjection.eRevision.eRevisionId, localProjection.eRevision.eRevisionId);
  assert.equal(JSON.stringify(residentResult).includes(repositoryRoot), false);

  const cloneResident = () => JSON.parse(JSON.stringify(residentResult));
  const schemaMismatch = cloneResident();
  schemaMismatch.schema = "direct_epistemic_repository_observation@0";
  assert.throws(
    () => validateResidentRepositoryObservation(schemaMismatch, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_schema_mismatch",
  );
  const profileMismatch = cloneResident();
  profileMismatch.profile.revision += 1;
  assert.throws(
    () => validateResidentRepositoryObservation(profileMismatch, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_profile_revision_mismatch",
  );
  const rawPathInjection = cloneResident();
  rawPathInjection.rootDir = repositoryRoot;
  assert.throws(
    () => validateResidentRepositoryObservation(rawPathInjection, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_shape_invalid_field_unknown",
  );
  const rawPathOmission = cloneResident();
  rawPathOmission.substrateOmissions = ["untracked_unavailable:file:ENOENT '/home/private/workspace/file'"];
  rawPathOmission.validationOmissions = [...rawPathOmission.substrateOmissions];
  rawPathOmission.omissions = [...rawPathOmission.substrateOmissions];
  assert.throws(
    () => validateResidentRepositoryObservation(rawPathOmission, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_omissions_invalid_unsafe_path",
  );
  const countMismatch = cloneResident();
  countMismatch.untrackedFileCount += 1;
  assert.throws(
    () => validateResidentRepositoryObservation(countMismatch, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_untracked_file_count_mismatch",
  );
  const sourceDigestMismatch = cloneResident();
  sourceDigestMismatch.sources[0].contentDigest = "0".repeat(64);
  assert.throws(
    () => validateResidentRepositoryObservation(sourceDigestMismatch, validationOptions),
    (error) => [
      "direct_epistemic_repository_observation_source_validation_posture_mismatch",
      "direct_epistemic_repository_observation_source_set_digest_mismatch",
    ].includes(error?.code),
  );
  const incompleteSourceSet = cloneResident();
  incompleteSourceSet.sources.pop();
  incompleteSourceSet.sourceSetDigest = digestFor(incompleteSourceSet.sources);
  assert.throws(
    () => validateResidentRepositoryObservation(incompleteSourceSet, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_missing_source_omission_missing",
  );
  const completenessMismatch = cloneResident();
  completenessMismatch.observationComplete = false;
  assert.throws(
    () => validateResidentRepositoryObservation(completenessMismatch, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_observation_completeness_mismatch",
  );
  const coherenceMismatch = cloneResident();
  coherenceMismatch.captureCoherent = false;
  assert.throws(
    () => validateResidentRepositoryObservation(coherenceMismatch, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_capture_coherence_mismatch",
  );
  const worktreeIdentityMismatch = cloneResident();
  worktreeIdentityMismatch.worktreeDigest = "0".repeat(64);
  assert.throws(
    () => validateResidentRepositoryObservation(worktreeIdentityMismatch, validationOptions),
    (error) => error?.code === "direct_epistemic_repository_observation_worktree_identity_mismatch",
  );
  assert.throws(
    () => validateResidentRepositoryObservation(residentResult, {
      ...validationOptions,
      expectedORevisionRef: { ...localProjection.oRevision.ref, digest: "0".repeat(64) },
    }),
    (error) => error?.code === "direct_epistemic_repository_observation_expected_o_identity_mismatch",
  );
  const after = inspectArcagi3Repository(repositoryRoot);
  assert.equal(after.worktreeDigest, before.worktreeDigest);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    transport: "resident-workspace-backend",
    repositoryO: residentProjection.oRevision.oRevisionId,
    repositoryE: residentProjection.eRevision.eRevisionId,
    validatedPinnedSources: resident.sources.length,
    repositoryMutated: false,
  }, null, 2)}\n`);
} finally {
  settled = true;
  clearTimeout(timeout);
  child.stdin.end();
  child.kill("SIGTERM");
}
