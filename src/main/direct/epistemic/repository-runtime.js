"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const profile = require("./profiles/arcagi3-odeu-local.v1.json");
const {
  buildERevision,
  buildEpistemicRecord,
  buildORevision,
  buildSemanticPort,
  buildSubject,
  digestFor,
  exactRef,
  text,
} = require("./kernel");

const ARCAGI3_PROFILE_ID = "arcagi3-odeu-local";
const DIRECT_EPISTEMIC_REPOSITORY_OBSERVATION_SCHEMA = "direct_epistemic_repository_observation@1";
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
const DEFAULT_OBSERVATION_ATTEMPTS = 2;
const RESIDENT_OBSERVATION_MAX_BYTES = 16 * 1024 * 1024;
const RESIDENT_PROFILE_ENTRY_LIMIT = 64;
const RESIDENT_UNTRACKED_FILE_LIMIT = 2000;
const RESIDENT_UNTRACKED_FILE_BYTES = 16 * 1024 * 1024;
const RESIDENT_UNTRACKED_TOTAL_BYTES = 128 * 1024 * 1024;
const RESIDENT_PROFILE_SOURCE_BYTES = 8 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function observationError(code) {
  return codedError(`direct_epistemic_repository_observation_${code}`);
}

function observationAssert(condition, code) {
  if (!condition) throw observationError(code);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownKeys(value, allowed, code) {
  observationAssert(plainObject(value), code);
  for (const key of Object.keys(value)) observationAssert(allowed.has(key), `${code}_field_unknown`);
}

function boundedObservationString(value, code, maxLength = 4096, allowEmpty = false) {
  observationAssert(typeof value === "string", code);
  observationAssert(value.length <= maxLength && (allowEmpty || value.length > 0), code);
  observationAssert(!/[\0\r\n]/.test(value), code);
  return value;
}

function observationInteger(value, code, max = Number.MAX_SAFE_INTEGER) {
  observationAssert(Number.isSafeInteger(value) && value >= 0 && value <= max, code);
  return value;
}

function observationDigest(value, code) {
  observationAssert(typeof value === "string" && SHA256_HEX.test(value), code);
  return value;
}

function reportedRelativePath(value, code) {
  const relativePath = boundedObservationString(value, code, 4096);
  observationAssert(!relativePath.startsWith("/") && !relativePath.includes("\\"), code);
  const parts = relativePath.split("/");
  observationAssert(parts.every((part) => part && part !== "." && part !== ".."), code);
  return relativePath;
}

function sortedUniqueObservationStrings(value, code) {
  observationAssert(Array.isArray(value) && value.length <= 4096, code);
  const normalized = value.map((entry) => {
    const normalizedEntry = boundedObservationString(entry, code, 4096);
    observationAssert(!/(?:^|[\s'"])\//.test(normalizedEntry), `${code}_unsafe_path`);
    observationAssert(!/(?:^|[^A-Za-z0-9_])[A-Za-z]:[\\/]/.test(normalizedEntry), `${code}_unsafe_path`);
    observationAssert(!normalizedEntry.includes("\\\\"), `${code}_unsafe_path`);
    return normalizedEntry;
  });
  const canonical = [...new Set(normalized)].sort();
  observationAssert(JSON.stringify(normalized) === JSON.stringify(canonical), `${code}_not_canonical`);
  return normalized;
}

function sameExactRef(left, right) {
  return Boolean(left && right) &&
    left.kind === right.kind &&
    left.id === right.id &&
    left.digest === right.digest;
}

function git(rootDir, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: options.encoding === null ? null : "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error) throw codedError("direct_epistemic_git_unavailable");
  if (result.status !== 0) {
    throw codedError(`direct_epistemic_git_failed:${text(args?.[0], "command")}`);
  }
  return result.stdout || (options.encoding === null ? Buffer.alloc(0) : "");
}

function digestBytes(value) {
  return crypto.createHash("sha256").update(Buffer.from(value || Buffer.alloc(0))).digest("hex");
}

function sameFileStat(left, right) {
  return Boolean(left && right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function hashFile(filePath, expectedStat = null) {
  const hash = crypto.createHash("sha256");
  const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw codedError("direct_epistemic_evidence_file_open_rejected");
  }
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || (expectedStat && !sameFileStat(before, expectedStat))) {
      throw codedError("direct_epistemic_evidence_file_changed");
    }
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    const after = fs.fstatSync(descriptor);
    if (!sameFileStat(before, after)) throw codedError("direct_epistemic_evidence_file_changed");
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function workspaceRoot(project = {}) {
  return text(
    project.workspace?.linuxPath ||
      project.workspace?.localPath ||
      project.repoPath ||
      project.workspace?.windowsPath,
  );
}

function isContained(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function physicalPath(value) {
  const resolved = typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(value)
    : fs.realpathSync(value);
  return path.resolve(resolved);
}

function validateRepositoryRoot(rootDir) {
  const supplied = text(rootDir);
  if (!supplied) throw codedError("direct_epistemic_repository_root_required");
  const resolvedRoot = path.resolve(supplied);
  let stat;
  try {
    stat = fs.lstatSync(resolvedRoot);
  } catch {
    throw codedError("direct_epistemic_repository_root_unavailable");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw codedError("direct_epistemic_repository_root_rejected");
  }
  let realRoot;
  try {
    realRoot = physicalPath(resolvedRoot);
  } catch {
    throw codedError("direct_epistemic_repository_root_rejected");
  }
  if (realRoot !== resolvedRoot) throw codedError("direct_epistemic_repository_root_rejected");
  return resolvedRoot;
}

function repositoryEntry(rootDir, relativePath, expectedKind = "file") {
  const normalized = text(relativePath);
  if (!normalized || path.isAbsolute(normalized)) return { ok: false, reason: "path_invalid" };
  const absolutePath = path.resolve(rootDir, normalized);
  if (!isContained(rootDir, absolutePath)) return { ok: false, reason: "path_outside_repository" };
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    return { ok: false, reason: "path_missing" };
  }
  if (stat.isSymbolicLink()) return { ok: false, reason: "symlink_rejected" };
  if (expectedKind === "file" && !stat.isFile()) return { ok: false, reason: "not_a_file" };
  if (expectedKind === "directory" && !stat.isDirectory()) return { ok: false, reason: "not_a_directory" };
  let realPath;
  try {
    realPath = physicalPath(absolutePath);
  } catch {
    return { ok: false, reason: "physical_path_unavailable" };
  }
  if (!isContained(rootDir, realPath)) return { ok: false, reason: "physical_path_outside_repository" };
  if (realPath !== absolutePath) return { ok: false, reason: "physical_path_uses_symlink" };
  return { ok: true, absolutePath, stat };
}

function markerStatus(rootDir, repositoryProfile = profile) {
  let resolvedRoot;
  try {
    resolvedRoot = validateRepositoryRoot(rootDir);
  } catch (error) {
    return (Array.isArray(repositoryProfile.markers) ? repositoryProfile.markers : []).map((marker) => ({
      marker,
      present: false,
      validationCode: text(error?.code, "direct_epistemic_repository_root_rejected"),
    }));
  }
  return (Array.isArray(repositoryProfile.markers) ? repositoryProfile.markers : []).map((marker) => {
    const entry = repositoryEntry(resolvedRoot, marker, "any");
    return {
      marker,
      present: entry.ok,
      validationCode: entry.ok ? "exact" : entry.reason,
    };
  });
}

function captureGitState(rootDir, gitRunner) {
  const gitHead = String(gitRunner(rootDir, ["rev-parse", "HEAD"])).trim();
  const branch = String(gitRunner(rootDir, ["branch", "--show-current"])).trim();
  const statusBuffer = Buffer.from(gitRunner(
    rootDir,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { encoding: null },
  ));
  const trackedDiff = Buffer.from(gitRunner(
    rootDir,
    ["diff", "--no-ext-diff", "--binary", "HEAD"],
    { encoding: null },
  ));
  const untrackedBuffer = Buffer.from(gitRunner(
    rootDir,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: null },
  ));
  const statusDigest = digestBytes(statusBuffer);
  const trackedDiffDigest = digestBytes(trackedDiff);
  const untrackedSetDigest = digestBytes(untrackedBuffer);
  const witnessDigest = digestFor({
    gitHead,
    branch,
    statusDigest,
    trackedDiffDigest,
    untrackedSetDigest,
  });
  return {
    gitHead,
    branch,
    statusBuffer,
    trackedDiff,
    untrackedBuffer,
    statusDigest,
    trackedDiffDigest,
    untrackedSetDigest,
    witnessDigest,
  };
}

function collectEvidence(rootDir, repositoryProfile, untrackedBuffer) {
  const validationOmissions = [];
  const substrateOmissions = [];
  const profileValidationOmissions = [];
  let untrackedReadStable = true;
  let sourceReadStable = true;
  const untrackedPaths = Buffer.from(untrackedBuffer)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  const untrackedFiles = [];
  for (const relativePath of untrackedPaths) {
    const entry = repositoryEntry(rootDir, relativePath, "file");
    if (!entry.ok) {
      validationOmissions.push(`untracked_path_rejected:${digestFor(relativePath).slice(0, 16)}:${entry.reason}`);
      substrateOmissions.push(`untracked_path_rejected:${digestFor(relativePath).slice(0, 16)}:${entry.reason}`);
      continue;
    }
    try {
      untrackedFiles.push({
        relativePath,
        sizeBytes: entry.stat.size,
        contentDigest: hashFile(entry.absolutePath, entry.stat),
      });
    } catch {
      untrackedReadStable = false;
      const omission = `untracked_file_unstable:${digestFor(relativePath).slice(0, 16)}`;
      validationOmissions.push(omission);
      substrateOmissions.push(omission);
    }
  }

  const sources = [];
  for (const source of Array.isArray(repositoryProfile.sources) ? repositoryProfile.sources : []) {
    const sourceId = text(source?.id);
    const expectedContentDigest = text(source?.contentDigest).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedContentDigest)) {
      const omission = `profile_source_digest_unpinned:${sourceId || "unknown"}`;
      validationOmissions.push(omission);
      profileValidationOmissions.push(omission);
      continue;
    }
    const entry = repositoryEntry(rootDir, source?.path, "file");
    if (!entry.ok) {
      const omission = `profile_source_rejected:${sourceId || "unknown"}:${entry.reason}`;
      validationOmissions.push(omission);
      profileValidationOmissions.push(omission);
      continue;
    }
    let contentDigest;
    try {
      contentDigest = hashFile(entry.absolutePath, entry.stat);
    } catch {
      sourceReadStable = false;
      const omission = `profile_source_unstable:${sourceId || "unknown"}`;
      validationOmissions.push(omission);
      profileValidationOmissions.push(omission);
      continue;
    }
    const validationPosture = contentDigest === expectedContentDigest ? "exact" : "digest_mismatch";
    sources.push({
      id: sourceId,
      relativePath: source.path,
      facet: source.facet,
      sizeBytes: entry.stat.size,
      expectedContentDigest,
      contentDigest,
      validationPosture,
    });
    if (validationPosture !== "exact") {
      const omission = `profile_source_digest_mismatch:${sourceId || "unknown"}`;
      validationOmissions.push(omission);
      profileValidationOmissions.push(omission);
    }
  }

  return {
    untrackedFiles,
    sources,
    validationOmissions: [...new Set(validationOmissions)].sort(),
    substrateOmissions: [...new Set(substrateOmissions)].sort(),
    profileValidationOmissions: [...new Set(profileValidationOmissions)].sort(),
    readStable: untrackedReadStable && sourceReadStable,
    untrackedReadStable,
    sourceReadStable,
    untrackedDigest: digestFor(untrackedFiles),
    sourceSetDigest: digestFor(sources),
  };
}

function evidenceMatches(left, right) {
  return Boolean(left?.readStable && right?.readStable) &&
    left.untrackedDigest === right.untrackedDigest &&
    left.sourceSetDigest === right.sourceSetDigest &&
    digestFor(left.validationOmissions) === digestFor(right.validationOmissions);
}

function substrateEvidenceMatches(left, right) {
  return Boolean(left?.untrackedReadStable && right?.untrackedReadStable) &&
    left.untrackedDigest === right.untrackedDigest &&
    digestFor(left.substrateOmissions) === digestFor(right.substrateOmissions);
}

function profileEvidenceMatches(left, right) {
  return Boolean(left?.sourceReadStable && right?.sourceReadStable) &&
    left.sourceSetDigest === right.sourceSetDigest &&
    digestFor(left.profileValidationOmissions) === digestFor(right.profileValidationOmissions);
}

function inspectArcagi3Repository(rootDir, options = {}) {
  const repositoryProfile = options.profile || profile;
  const resolvedRoot = validateRepositoryRoot(rootDir);
  const markers = markerStatus(resolvedRoot, repositoryProfile);
  if (markers.some((marker) => !marker.present)) {
    throw codedError("direct_epistemic_arcagi3_profile_not_matched");
  }
  const gitRunner = typeof options.gitRunner === "function" ? options.gitRunner : git;
  const gitRoot = String(gitRunner(resolvedRoot, ["rev-parse", "--show-toplevel"])).trim();
  let physicalGitRoot;
  try {
    physicalGitRoot = physicalPath(gitRoot);
  } catch {
    throw codedError("direct_epistemic_repository_root_mismatch");
  }
  if (path.resolve(gitRoot) !== resolvedRoot || physicalGitRoot !== resolvedRoot) {
    throw codedError("direct_epistemic_repository_root_mismatch");
  }

  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxObservationAttempts || DEFAULT_OBSERVATION_ATTEMPTS)));
  let capture = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = captureGitState(resolvedRoot, gitRunner);
    const evidenceBefore = collectEvidence(resolvedRoot, repositoryProfile, before.untrackedBuffer);
    if (typeof options.afterEvidenceCapture === "function") {
      options.afterEvidenceCapture({ attempt, rootDir: resolvedRoot });
    }
    const after = captureGitState(resolvedRoot, gitRunner);
    const evidenceAfter = collectEvidence(resolvedRoot, repositoryProfile, after.untrackedBuffer);
    const gitCoherent = before.witnessDigest === after.witnessDigest;
    const substrateCoherent = gitCoherent && substrateEvidenceMatches(evidenceBefore, evidenceAfter);
    const profileCoherent = gitCoherent && profileEvidenceMatches(evidenceBefore, evidenceAfter);
    const coherent = substrateCoherent && profileCoherent && evidenceMatches(evidenceBefore, evidenceAfter);
    capture = { attempt, before, after, evidence: evidenceAfter, coherent, substrateCoherent, profileCoherent };
    if (coherent) break;
  }

  const witness = capture.after;
  const evidence = capture.evidence;
  const substrateOmissions = [...evidence.substrateOmissions];
  if (!capture.substrateCoherent) substrateOmissions.push("repository_changed_during_observation");
  const profileValidationOmissions = [...evidence.profileValidationOmissions];
  if (!capture.profileCoherent) profileValidationOmissions.push("profile_sources_changed_during_observation");
  const validationOmissions = [...evidence.validationOmissions, ...substrateOmissions, ...profileValidationOmissions];
  if (!capture.coherent) validationOmissions.push("repository_changed_during_observation");
  const omissions = [...new Set(validationOmissions)].sort();
  const normalizedSubstrateOmissions = [...new Set(substrateOmissions)].sort();
  const normalizedProfileOmissions = [...new Set(profileValidationOmissions)].sort();
  const substrateObservationComplete = capture.substrateCoherent &&
    evidence.untrackedReadStable && normalizedSubstrateOmissions.length === 0;
  const profileValidationComplete = capture.profileCoherent &&
    evidence.sourceReadStable && normalizedProfileOmissions.length === 0;
  const observationComplete = substrateObservationComplete && profileValidationComplete;
  const statusText = witness.statusBuffer.toString("utf8");
  const statusEntries = statusText.split("\0").filter(Boolean);
  const worktreeDigest = digestFor({
    gitHead: witness.gitHead,
    branch: witness.branch,
    trackedDiffDigest: witness.trackedDiffDigest,
    untrackedDigest: evidence.untrackedDigest,
    statusDigest: witness.statusDigest,
    untrackedSetDigest: witness.untrackedSetDigest,
    substrateCoherent: capture.substrateCoherent,
    substrateOmissionsDigest: digestFor(normalizedSubstrateOmissions),
  });
  return {
    profile: repositoryProfile,
    rootDir: resolvedRoot,
    gitHead: witness.gitHead,
    branch: witness.branch,
    dirty: statusEntries.length > 0,
    statusEntryCount: statusEntries.length,
    trackedDiffBytes: witness.trackedDiff.length,
    untrackedFileCount: evidence.untrackedFiles.length,
    untrackedFiles: evidence.untrackedFiles,
    trackedDiffDigest: witness.trackedDiffDigest,
    untrackedDigest: evidence.untrackedDigest,
    statusDigest: witness.statusDigest,
    sourceSetDigest: evidence.sourceSetDigest,
    worktreeDigest,
    sources: evidence.sources,
    omissions,
    validationOmissions: omissions,
    substrateOmissions: normalizedSubstrateOmissions,
    profileValidationOmissions: normalizedProfileOmissions,
    observationComplete,
    substrateObservationComplete,
    profileValidationComplete,
    captureCoherent: capture.coherent,
    substrateCoherent: capture.substrateCoherent,
    profileCoherent: capture.profileCoherent,
    captureAttempts: capture.attempt,
    gitWitnessBeforeDigest: capture.before.witnessDigest,
    gitWitnessAfterDigest: capture.after.witnessDigest,
  };
}

function sourceRef(source) {
  return {
    ...exactRef("repository_source", source.id, source.contentDigest),
    label: source.relativePath,
  };
}

function buildArcagi3RepositoryProjection(input = {}) {
  const observation = input.observation || inspectArcagi3Repository(input.rootDir);
  const repositoryProfile = observation.profile || profile;
  const projectId = text(input.projectId, "arcagi3");
  const subject = buildSubject({
    kind: "repository",
    externalId: projectId,
    projectId,
    label: repositoryProfile.label,
    profileId: `${repositoryProfile.profileId}@${repositoryProfile.revision}`,
  });
  const oRevision = buildORevision({
    subject,
    substrateKind: "git_worktree",
    substrateIdentity: {
      gitHead: observation.gitHead,
      branch: observation.branch,
      worktreeDigest: observation.worktreeDigest,
      trackedDiffDigest: observation.trackedDiffDigest,
      untrackedDigest: observation.untrackedDigest,
      statusDigest: observation.statusDigest,
      dirty: observation.dirty,
      statusEntryCount: observation.statusEntryCount,
      untrackedFileCount: observation.untrackedFileCount,
      observationComplete: observation.substrateObservationComplete === true,
      captureCoherent: observation.substrateCoherent === true,
      observationOmissionsDigest: digestFor(observation.substrateOmissions || []),
    },
    posture: observation.substrateObservationComplete
      ? (observation.dirty ? "observed_dirty_worktree" : "observed_clean_worktree")
      : "observed_incomplete_worktree",
  });

  const validatedSources = new Map(
    (Array.isArray(observation.sources) ? observation.sources : [])
      .filter((source) => source.validationPosture === "exact")
      .map((source) => [source.id, source]),
  );
  const recordPlans = (Array.isArray(repositoryProfile.records) ? repositoryProfile.records : []).map((definition) => {
    const sourceIds = [...new Set((Array.isArray(definition.sourceIds) ? definition.sourceIds : []).map((value) => text(value)).filter(Boolean))];
    const missingSourceIds = sourceIds.filter((sourceId) => !validatedSources.has(sourceId));
    return {
      definition,
      sourceIds,
      missingSourceIds,
      sources: sourceIds.map((sourceId) => validatedSources.get(sourceId)).filter(Boolean),
    };
  });
  const recordValidationOmissions = recordPlans.flatMap((plan) => {
    if (!plan.sourceIds.length) return [`record_sources_required:${text(plan.definition.semanticKey, "unknown")}`];
    if (!plan.missingSourceIds.length) return [];
    return [`record_sources_unavailable:${text(plan.definition.semanticKey, "unknown")}:${plan.missingSourceIds.join(",")}`];
  });
  const validationOmissions = [...new Set([
    ...(Array.isArray(observation.validationOmissions) ? observation.validationOmissions : []),
    ...recordValidationOmissions,
  ])].sort();
  const projectionComplete = observation.observationComplete === true && validationOmissions.length === 0;
  const basis = {
    profileId: repositoryProfile.profileId,
    profileRevision: repositoryProfile.revision,
    sourceDefinitionsDigest: digestFor(repositoryProfile.sources),
    sourceSetDigest: observation.sourceSetDigest,
    recordDefinitionsDigest: digestFor(repositoryProfile.records),
    portDefinitionsDigest: digestFor(repositoryProfile.ports),
    validationOmissionsDigest: digestFor(validationOmissions),
  };
  const eRevision = buildERevision({
    subject,
    oRevision,
    revisionClass: "repository_profile_seed",
    basis,
    standing: projectionComplete ? "admitted" : "candidate",
    coverage: {
      posture: projectionComplete ? "bounded_seed" : "incomplete_seed",
      pinnedSourceCount: validatedSources.size,
      observedSourceCount: Array.isArray(observation.sources) ? observation.sources.length : 0,
      expectedSourceCount: repositoryProfile.sources.length,
      omissions: validationOmissions,
      validationOmissions,
      observationComplete: observation.observationComplete === true,
      completeRepositoryOntology: false,
    },
  });
  const records = [];
  for (const plan of recordPlans) {
    if (!plan.sourceIds.length || plan.missingSourceIds.length) continue;
    const definition = plan.definition;
    records.push(buildEpistemicRecord({
      subject,
      oRevision,
      eRevision,
      recordType: definition.recordType,
      semanticKey: definition.semanticKey,
      facet: definition.facet,
      predicate: definition.semanticKey,
      scope: {
        kind: "repository_profile_scope",
        label: text(definition.payload?.scope, "project_wide"),
      },
      quantification: {
        kind: "profile_bounded",
        profileId: repositoryProfile.profileId,
        profileRevision: repositoryProfile.revision,
      },
      actor: `profile:${repositoryProfile.profileId}@${repositoryProfile.revision}`,
      standing: projectionComplete ? "admitted" : "candidate",
      payload: definition.payload,
      evidenceRefs: plan.sources.map(sourceRef),
      sourceRefs: plan.sources.map(sourceRef),
      validation: {
        posture: projectionComplete ? "exact_pinned_sources" : "observation_incomplete",
        requiredSourceCount: plan.sourceIds.length,
        validatedSourceCount: plan.sources.length,
      },
      epistemicPromotion: projectionComplete,
    }));
  }
  const ports = (Array.isArray(repositoryProfile.ports) ? repositoryProfile.ports : []).map((definition) =>
    buildSemanticPort({
      subject,
      name: definition.name,
      label: definition.label,
      purpose: definition.purpose,
      version: repositoryProfile.revision,
      facets: definition.facets,
      standings: ["admitted", "validated"],
      traversal: definition.traversal,
      omissionPolicy: "report_missing_profile_sources_and_unselected_facets",
    }));
  return { subject, oRevision, eRevision, records, ports, observation };
}

function validateResidentRepositoryObservation(observation, options = {}) {
  const expectedProfile = options.profile || profile;
  observationAssert(plainObject(expectedProfile), "profile_expected_invalid");
  observationAssert(Array.isArray(expectedProfile.markers) && expectedProfile.markers.length <= RESIDENT_PROFILE_ENTRY_LIMIT,
    "profile_marker_count_invalid");
  observationAssert(Array.isArray(expectedProfile.sources) && expectedProfile.sources.length <= RESIDENT_PROFILE_ENTRY_LIMIT,
    "profile_source_count_invalid");
  let serialized;
  try {
    serialized = JSON.stringify(observation);
  } catch {
    throw observationError("serialization_invalid");
  }
  observationAssert(Buffer.byteLength(serialized || "", "utf8") <= RESIDENT_OBSERVATION_MAX_BYTES,
    "payload_too_large");

  assertKnownKeys(observation, new Set([
    "schema",
    "profile",
    "gitHead",
    "branch",
    "dirty",
    "statusEntryCount",
    "trackedDiffBytes",
    "untrackedFileCount",
    "untrackedFiles",
    "trackedDiffDigest",
    "untrackedDigest",
    "statusDigest",
    "sourceSetDigest",
    "worktreeDigest",
    "sources",
    "omissions",
    "validationOmissions",
    "substrateOmissions",
    "profileValidationOmissions",
    "observationComplete",
    "substrateObservationComplete",
    "profileValidationComplete",
    "captureCoherent",
    "substrateCoherent",
    "profileCoherent",
    "captureAttempts",
    "gitWitnessBeforeDigest",
    "gitWitnessAfterDigest",
    "rawWorkspacePathIncluded",
    "rawFileContentIncluded",
    "attempt",
  ]), "shape_invalid");
  observationAssert(observation.schema === DIRECT_EPISTEMIC_REPOSITORY_OBSERVATION_SCHEMA, "schema_mismatch");
  observationAssert(observation.rawWorkspacePathIncluded === false, "raw_workspace_path_exposed");
  observationAssert(observation.rawFileContentIncluded === false, "raw_file_content_exposed");

  assertKnownKeys(observation.profile, new Set(["profileId", "revision"]), "profile_invalid");
  observationAssert(observation.profile.profileId === expectedProfile.profileId, "profile_id_mismatch");
  observationAssert(observation.profile.revision === expectedProfile.revision, "profile_revision_mismatch");

  const gitHead = boundedObservationString(observation.gitHead, "git_head_invalid", 64);
  observationAssert(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(gitHead), "git_head_invalid");
  boundedObservationString(observation.branch, "branch_invalid", 1024, true);
  observationAssert(typeof observation.dirty === "boolean", "dirty_invalid");
  const statusEntryCount = observationInteger(observation.statusEntryCount, "status_entry_count_invalid");
  observationAssert(observation.dirty === (statusEntryCount > 0), "dirty_status_count_mismatch");
  observationInteger(observation.trackedDiffBytes, "tracked_diff_bytes_invalid");
  observationDigest(observation.trackedDiffDigest, "tracked_diff_digest_invalid");
  observationDigest(observation.untrackedDigest, "untracked_digest_invalid");
  observationDigest(observation.statusDigest, "status_digest_invalid");
  observationDigest(observation.sourceSetDigest, "source_set_digest_invalid");
  observationDigest(observation.worktreeDigest, "worktree_digest_invalid");
  observationDigest(observation.gitWitnessBeforeDigest, "git_witness_before_invalid");
  observationDigest(observation.gitWitnessAfterDigest, "git_witness_after_invalid");

  observationAssert(Array.isArray(observation.untrackedFiles) &&
    observation.untrackedFiles.length <= RESIDENT_UNTRACKED_FILE_LIMIT, "untracked_files_invalid");
  observationInteger(observation.untrackedFileCount, "untracked_file_count_invalid", RESIDENT_UNTRACKED_FILE_LIMIT);
  observationAssert(observation.untrackedFileCount === observation.untrackedFiles.length,
    "untracked_file_count_mismatch");
  const normalizedUntracked = [];
  let untrackedTotalBytes = 0;
  let priorUntrackedPath = "";
  for (const entry of observation.untrackedFiles) {
    assertKnownKeys(entry, new Set(["relativePath", "sizeBytes", "contentDigest"]), "untracked_entry_invalid");
    const relativePath = reportedRelativePath(entry.relativePath, "untracked_path_invalid");
    observationAssert(!priorUntrackedPath || priorUntrackedPath < relativePath, "untracked_path_order_invalid");
    priorUntrackedPath = relativePath;
    const sizeBytes = observationInteger(entry.sizeBytes, "untracked_size_invalid", RESIDENT_UNTRACKED_FILE_BYTES);
    untrackedTotalBytes += sizeBytes;
    observationAssert(untrackedTotalBytes <= RESIDENT_UNTRACKED_TOTAL_BYTES, "untracked_total_bytes_exceeded");
    const contentDigest = observationDigest(entry.contentDigest, "untracked_content_digest_invalid");
    normalizedUntracked.push({ relativePath, sizeBytes, contentDigest });
  }
  observationAssert(observation.untrackedDigest === digestFor(normalizedUntracked), "untracked_digest_mismatch");

  const expectedSources = Array.isArray(expectedProfile.sources) ? expectedProfile.sources : [];
  const expectedSourcesById = new Map();
  for (const source of expectedSources) {
    const sourceId = boundedObservationString(source?.id, "profile_source_id_invalid", 256);
    observationAssert(!expectedSourcesById.has(sourceId), "profile_source_id_duplicate");
    const sourcePath = reportedRelativePath(source?.path, "profile_source_path_invalid");
    const facet = boundedObservationString(source?.facet, "profile_source_facet_invalid", 256);
    const contentDigest = observationDigest(source?.contentDigest, "profile_source_pin_invalid");
    expectedSourcesById.set(sourceId, { sourceId, sourcePath, facet, contentDigest });
  }
  observationAssert(Array.isArray(observation.sources) && observation.sources.length <= expectedSources.length,
    "source_count_invalid");
  const normalizedSources = [];
  const observedSourceIds = new Set();
  let priorSourceIndex = -1;
  for (const source of observation.sources) {
    assertKnownKeys(source, new Set([
      "id",
      "relativePath",
      "facet",
      "sizeBytes",
      "expectedContentDigest",
      "contentDigest",
      "validationPosture",
    ]), "source_invalid");
    const sourceId = boundedObservationString(source.id, "source_id_invalid", 256);
    observationAssert(!observedSourceIds.has(sourceId), "source_id_duplicate");
    const expected = expectedSourcesById.get(sourceId);
    observationAssert(Boolean(expected), "source_unexpected");
    const expectedIndex = expectedSources.findIndex((entry) => entry.id === sourceId);
    observationAssert(expectedIndex > priorSourceIndex, "source_order_invalid");
    priorSourceIndex = expectedIndex;
    observedSourceIds.add(sourceId);
    const relativePath = reportedRelativePath(source.relativePath, "source_path_invalid");
    observationAssert(relativePath === expected.sourcePath, "source_path_mismatch");
    observationAssert(source.facet === expected.facet, "source_facet_mismatch");
    observationAssert(source.expectedContentDigest === expected.contentDigest, "source_pin_mismatch");
    const sizeBytes = observationInteger(source.sizeBytes, "source_size_invalid", RESIDENT_PROFILE_SOURCE_BYTES);
    const contentDigest = observationDigest(source.contentDigest, "source_content_digest_invalid");
    observationAssert(["exact", "digest_mismatch"].includes(source.validationPosture), "source_validation_posture_invalid");
    observationAssert((source.validationPosture === "exact") === (contentDigest === expected.contentDigest),
      "source_validation_posture_mismatch");
    normalizedSources.push({
      id: sourceId,
      relativePath,
      facet: source.facet,
      sizeBytes,
      contentDigest,
      expectedContentDigest: source.expectedContentDigest,
      validationPosture: source.validationPosture,
    });
  }
  observationAssert(observation.sourceSetDigest === digestFor(normalizedSources), "source_set_digest_mismatch");

  const omissions = sortedUniqueObservationStrings(observation.omissions, "omissions_invalid");
  const validationOmissions = sortedUniqueObservationStrings(observation.validationOmissions,
    "validation_omissions_invalid");
  const substrateOmissions = sortedUniqueObservationStrings(observation.substrateOmissions,
    "substrate_omissions_invalid");
  const profileValidationOmissions = sortedUniqueObservationStrings(observation.profileValidationOmissions,
    "profile_validation_omissions_invalid");
  const expectedValidationOmissions = [...new Set([...substrateOmissions, ...profileValidationOmissions])].sort();
  observationAssert(JSON.stringify(validationOmissions) === JSON.stringify(expectedValidationOmissions),
    "validation_omission_partition_mismatch");
  observationAssert(JSON.stringify(omissions) === JSON.stringify(validationOmissions), "omission_alias_mismatch");

  for (const source of normalizedSources) {
    if (source.validationPosture === "digest_mismatch") {
      observationAssert(profileValidationOmissions.includes(`profile_source_digest_mismatch:${source.id}`),
        "source_mismatch_omission_missing");
    }
  }
  for (const expected of expectedSourcesById.values()) {
    if (observedSourceIds.has(expected.sourceId)) continue;
    observationAssert(profileValidationOmissions.some((omission) =>
      omission.startsWith(`profile_source_unavailable:${expected.sourceId}:`) ||
      omission === `profile_source_digest_unpinned:${expected.sourceId}` ||
      omission.startsWith(`profile_source_rejected:${expected.sourceId}:`)),
    "missing_source_omission_missing");
  }

  for (const field of [
    "observationComplete",
    "substrateObservationComplete",
    "profileValidationComplete",
    "captureCoherent",
    "substrateCoherent",
    "profileCoherent",
  ]) observationAssert(typeof observation[field] === "boolean", `${field}_invalid`);
  observationAssert(observation.captureCoherent ===
    (observation.substrateCoherent && observation.profileCoherent), "capture_coherence_mismatch");
  observationAssert(observation.substrateObservationComplete ===
    (observation.substrateCoherent && substrateOmissions.length === 0), "substrate_completeness_mismatch");
  observationAssert(observation.profileValidationComplete ===
    (observation.profileCoherent && profileValidationOmissions.length === 0), "profile_completeness_mismatch");
  observationAssert(observation.observationComplete ===
    (observation.substrateObservationComplete && observation.profileValidationComplete),
  "observation_completeness_mismatch");
  if (observation.profileValidationComplete) {
    observationAssert(normalizedSources.length === expectedSources.length, "complete_source_set_missing");
    observationAssert(normalizedSources.every((source) => source.validationPosture === "exact"),
      "complete_source_set_not_exact");
  }
  if (!observation.substrateCoherent) {
    observationAssert(substrateOmissions.includes("repository_changed_during_observation"),
      "substrate_incoherence_omission_missing");
  }
  if (!observation.profileCoherent) {
    observationAssert(profileValidationOmissions.includes("profile_sources_changed_during_observation"),
      "profile_incoherence_omission_missing");
  }

  const captureAttempts = observationInteger(observation.captureAttempts, "capture_attempts_invalid", 2);
  observationAssert(captureAttempts >= 1, "capture_attempts_invalid");
  observationAssert(observation.attempt === captureAttempts, "capture_attempt_alias_mismatch");
  if (!observation.captureCoherent) observationAssert(captureAttempts === 2, "incoherent_capture_not_exhausted");
  if (observation.substrateCoherent) {
    observationAssert(observation.gitWitnessBeforeDigest === observation.gitWitnessAfterDigest,
      "coherent_git_witness_mismatch");
  }

  if (observation.substrateObservationComplete) {
    const untrackedSetBytes = normalizedUntracked.length
      ? Buffer.from(`${normalizedUntracked.map((entry) => entry.relativePath).join("\0")}\0`, "utf8")
      : Buffer.alloc(0);
    const untrackedSetDigest = digestBytes(untrackedSetBytes);
    const expectedGitWitnessDigest = digestFor({
      gitHead: observation.gitHead,
      branch: observation.branch,
      statusDigest: observation.statusDigest,
      trackedDiffDigest: observation.trackedDiffDigest,
      untrackedSetDigest,
    });
    observationAssert(observation.gitWitnessBeforeDigest === expectedGitWitnessDigest,
      "git_witness_identity_mismatch");
    observationAssert(observation.gitWitnessAfterDigest === expectedGitWitnessDigest,
      "git_witness_identity_mismatch");
    const expectedWorktreeDigest = digestFor({
      gitHead: observation.gitHead,
      branch: observation.branch,
      trackedDiffDigest: observation.trackedDiffDigest,
      untrackedDigest: observation.untrackedDigest,
      statusDigest: observation.statusDigest,
      untrackedSetDigest,
      substrateCoherent: observation.substrateCoherent,
      substrateOmissionsDigest: digestFor(substrateOmissions),
    });
    observationAssert(observation.worktreeDigest === expectedWorktreeDigest, "worktree_identity_mismatch");
  }

  const normalizedObservation = Object.freeze({ ...observation, profile: expectedProfile });
  const projectId = text(options.projectId, "arcagi3");
  const projection = buildArcagi3RepositoryProjection({ projectId, observation: normalizedObservation });
  const expectedORevisionDigest = digestFor({
    subjectId: projection.subject.subjectId,
    substrateKind: projection.oRevision.substrateKind,
    substrateIdentity: projection.oRevision.substrateIdentity,
    posture: projection.oRevision.posture,
  });
  observationAssert(projection.oRevision.revisionDigest === expectedORevisionDigest,
    "o_revision_digest_mismatch");
  observationAssert(projection.oRevision.oRevisionId === `ep_o_${expectedORevisionDigest.slice(0, 24)}`,
    "o_revision_id_mismatch");
  if (options.expectedObservation) {
    const expectedProjection = buildArcagi3RepositoryProjection({
      projectId,
      observation: { ...options.expectedObservation, profile: expectedProfile },
    });
    observationAssert(sameExactRef(projection.oRevision.ref, expectedProjection.oRevision.ref),
      "local_resident_o_identity_mismatch");
    observationAssert(sameExactRef(projection.eRevision.ref, expectedProjection.eRevision.ref),
      "local_resident_e_identity_mismatch");
  }
  if (options.expectedORevisionRef) {
    observationAssert(sameExactRef(projection.oRevision.ref, options.expectedORevisionRef),
      "expected_o_identity_mismatch");
  }
  if (options.expectedERevisionRef) {
    observationAssert(sameExactRef(projection.eRevision.ref, options.expectedERevisionRef),
      "expected_e_identity_mismatch");
  }
  return normalizedObservation;
}

function rendererSafeObservation(observation = {}) {
  const sources = Array.isArray(observation.sources) ? observation.sources : [];
  const validatedSourceCount = sources.filter((source) => source.validationPosture === "exact").length;
  return {
    profileId: observation.profile?.profileId || ARCAGI3_PROFILE_ID,
    profileRevision: Number(observation.profile?.revision || 1),
    gitHead: text(observation.gitHead),
    branch: text(observation.branch),
    dirty: observation.dirty === true,
    statusEntryCount: Number(observation.statusEntryCount || 0),
    trackedDiffBytes: Number(observation.trackedDiffBytes || 0),
    untrackedFileCount: Number(observation.untrackedFileCount || 0),
    worktreeDigest: text(observation.worktreeDigest),
    sourceSetDigest: text(observation.sourceSetDigest),
    pinnedSourceCount: validatedSourceCount,
    validatedSourceCount,
    expectedSourceCount: Array.isArray(observation.profile?.sources) ? observation.profile.sources.length : 0,
    omissions: Array.isArray(observation.omissions) ? observation.omissions : [],
    validationOmissions: Array.isArray(observation.validationOmissions) ? observation.validationOmissions : [],
    substrateOmissions: Array.isArray(observation.substrateOmissions) ? observation.substrateOmissions : [],
    profileValidationOmissions: Array.isArray(observation.profileValidationOmissions) ? observation.profileValidationOmissions : [],
    observationComplete: observation.observationComplete === true,
    substrateObservationComplete: observation.substrateObservationComplete === true,
    profileValidationComplete: observation.profileValidationComplete === true,
    captureCoherent: observation.captureCoherent === true,
    captureAttempts: Number(observation.captureAttempts || 0),
    rawWorkspacePathIncluded: false,
  };
}

module.exports = {
  ARCAGI3_PROFILE_ID,
  DIRECT_EPISTEMIC_REPOSITORY_OBSERVATION_SCHEMA,
  buildArcagi3RepositoryProjection,
  git,
  hashFile,
  inspectArcagi3Repository,
  markerStatus,
  profile,
  rendererSafeObservation,
  repositoryEntry,
  validateResidentRepositoryObservation,
  workspaceRoot,
};
