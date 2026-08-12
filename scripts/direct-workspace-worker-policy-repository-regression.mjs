#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { TextDecoder } from "node:util";

const require = createRequire(import.meta.url);
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");
const {
  compileWorkspaceWorkerContract,
  workspaceWorkerToolSchemas,
} = require("../src/main/direct/agents/workspace-worker-contract");
const {
  compileWorkspaceWorkerPolicy,
  createWorkspaceParentAuthorityPacket,
  validateWorkspaceParentAuthorityPacket,
} = require("../src/main/direct/agents/workspace-worker-policy-profile");
const {
  sameNativePath,
} = require("../src/shared/native-path-identity");
const {
  pinnedWorkspaceMarkerIsExact,
  searchBoundedWorkspaceRepositoryText,
} = require("../src/shared/workspace-repository-boundary");
const {
  executeWorkspaceTool,
} = require("../src/main/direct/agents/workspace-worker-runtime");

const shellRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-worker-policy-repository-"));
const backendRaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-worker-binding-race-"));
let manager;
let backendRaceManager;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

try {
  run("git", ["init", "-q"], tempRoot);
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "ignored"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".gitignore"), "ignored/\ndir/payload\n/leading.txt\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, ".env"), "TOKEN=must-not-escape\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({
    private: true,
    scripts: { test: "node --test" },
  }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "alpha.js"), [
    "const message = 'value.*literal';",
    "module.exports = message;",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(tempRoot, "src", "unicode.txt"), "A€B\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "dir\\payload"), "tracked literal backslash\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, " leading.txt"), "tracked leading whitespace\n", "utf8");
  fs.mkdirSync(path.join(tempRoot, "dir"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "dir", "payload"), "ignored alias must not be admitted\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "leading.txt"), "ignored trimmed alias must not be admitted\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "ignored", "hidden.txt"), "ignored literal\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(tempRoot, "late-binary.dat"), Buffer.concat([
    Buffer.alloc(9_000, 0x61),
    Buffer.from([0, 0x62]),
  ]));
  fs.writeFileSync(path.join(tempRoot, "invalid-utf8.txt"), Buffer.concat([
    Buffer.from("invalid-search-target\n", "utf8"),
    Buffer.from([0xc3, 0x28]),
  ]));
  fs.writeFileSync(path.join(tempRoot, "oversized.log"), Buffer.concat([
    Buffer.alloc((1024 * 1024) + 1, 0x61),
    Buffer.from("oversized-search-target\n", "utf8"),
  ]));
  fs.symlinkSync(path.join(tempRoot, "src", "alpha.js"), path.join(tempRoot, "linked-alpha.js"));
  run("git", ["add", ".gitignore", "package.json", "src/alpha.js", "src/unicode.txt", "binary.dat", "late-binary.dat", "invalid-utf8.txt", "oversized.log", "linked-alpha.js", "dir\\payload", " leading.txt"], tempRoot);
  run("git", ["add", "-f", ".env"], tempRoot);
  run("git", ["-c", "user.name=Direct Test", "-c", "user.email=direct@invalid.example", "commit", "-qm", "fixture"], tempRoot);
  run("git", ["checkout", "-qb", "codex/worker/worker-policy-fixture"], tempRoot);
  fs.writeFileSync(path.join(tempRoot, "notes.txt"), "untracked literal evidence\n", "utf8");

  manager = new WorkspaceBackendManager({
    agentPath: path.join(shellRoot, "src/backend/wsl-agent.js"),
    fallbackRoot: shellRoot,
  });
  const publicBackendPayloads = [];
  manager.on("status", (payload) => publicBackendPayloads.push(payload));
  manager.on("agent-event", (payload) => publicBackendPayloads.push(payload));
  const parentProjectId = "project_worker_policy_repository_fixture";
  const project = {
    id: `${parentProjectId}__worker-policy-fixture`,
    name: "worker policy repository fixture",
    repoPath: tempRoot,
    workspace: { kind: "local", localPath: tempRoot },
  };
  const bindingBase = {
    schema: "direct_workspace_worker_binding@1",
    projectId: parentProjectId,
    workerKey: "worker-policy-fixture",
    workspaceKind: "local",
    branch: "codex/worker/worker-policy-fixture",
    baseCommit: run("git", ["rev-parse", "HEAD"], tempRoot),
    rootEvidenceDigest: digest(fs.realpathSync(tempRoot)),
    sourceRepositoryDigest: digest(fs.realpathSync(tempRoot)),
    retainedAfterCompletion: true,
    rawWorkspacePathIncluded: false,
  };
  const bindingDigest = digest(canonicalJson(bindingBase));
  const binding = {
    ...bindingBase,
    bindingId: `workspace_worker_binding_${bindingDigest.slice(7, 31)}`,
    bindingDigest,
  };
  const conflictingBindingBase = { ...bindingBase, retainedAfterCompletion: false };
  const conflictingBindingDigest = digest(canonicalJson(conflictingBindingBase));
  const conflictingBinding = {
    ...conflictingBindingBase,
    bindingId: `workspace_worker_binding_${conflictingBindingDigest.slice(7, 31)}`,
    bindingDigest: conflictingBindingDigest,
  };
  const session = await manager.ensureForProject(project, {
    workspaceHygiene: false,
  });
  const bindingRace = await Promise.allSettled([
    manager.ensureForProject(project, { workspaceWorkerBinding: binding }),
    manager.ensureForProject(project, { workspaceWorkerBinding: conflictingBinding }),
  ]);
  assert.equal(bindingRace[0].status, "fulfilled");
  assert.equal(bindingRace[1].status, "rejected");
  assert.equal(bindingRace[1].reason?.code, "workspace_worker_binding_already_initialized");
  assert.equal(session.workspaceWorkerBinding.bindingDigest, bindingDigest);
  const publicBackendJson = JSON.stringify([
    ...publicBackendPayloads,
    manager.statusForProject(project),
  ]);
  for (const nativePath of [tempRoot, tempRoot.replace(/\\/g, "/"), tempRoot.replace(/\//g, "\\")]) {
    assert.equal(publicBackendJson.toLowerCase().includes(nativePath.toLowerCase()), false);
  }
  assert.equal(publicBackendPayloads.some((payload) => payload.session?.workspace), false);
  assert.equal(publicBackendPayloads.some((payload) => payload.session?.hello?.root || payload.session?.hello?.cwd), false);

  run("git", ["init", "-q"], backendRaceRoot);
  fs.writeFileSync(path.join(backendRaceRoot, "race.txt"), "binding race\n", "utf8");
  run("git", ["add", "race.txt"], backendRaceRoot);
  run("git", ["-c", "user.name=Direct Test", "-c", "user.email=direct@invalid.example", "commit", "-qm", "fixture"], backendRaceRoot);
  run("git", ["checkout", "-qb", "codex/worker/backend-binding-race"], backendRaceRoot);
  const backendRaceParentId = "project_backend_binding_race_fixture";
  const backendRaceProject = {
    id: `${backendRaceParentId}__backend-binding-race`,
    name: "backend binding race fixture",
    repoPath: backendRaceRoot,
    workspace: { kind: "local", localPath: backendRaceRoot },
  };
  const backendRaceBase = {
    schema: "direct_workspace_worker_binding@1",
    projectId: backendRaceParentId,
    workerKey: "backend-binding-race",
    workspaceKind: "local",
    branch: "codex/worker/backend-binding-race",
    baseCommit: run("git", ["rev-parse", "HEAD"], backendRaceRoot),
    rootEvidenceDigest: digest(fs.realpathSync(backendRaceRoot)),
    sourceRepositoryDigest: digest(fs.realpathSync(backendRaceRoot)),
    retainedAfterCompletion: true,
    rawWorkspacePathIncluded: false,
  };
  const backendRaceDigestA = digest(canonicalJson(backendRaceBase));
  const backendRaceBindingA = {
    ...backendRaceBase,
    bindingId: `workspace_worker_binding_${backendRaceDigestA.slice(7, 31)}`,
    bindingDigest: backendRaceDigestA,
  };
  const backendRaceBaseB = { ...backendRaceBase, retainedAfterCompletion: false };
  const backendRaceDigestB = digest(canonicalJson(backendRaceBaseB));
  const backendRaceBindingB = {
    ...backendRaceBaseB,
    bindingId: `workspace_worker_binding_${backendRaceDigestB.slice(7, 31)}`,
    bindingDigest: backendRaceDigestB,
  };
  backendRaceManager = new WorkspaceBackendManager({
    agentPath: path.join(shellRoot, "src/backend/wsl-agent.js"),
    fallbackRoot: shellRoot,
  });
  const backendRaceSession = await backendRaceManager.ensureForProject(backendRaceProject, {
    workspaceHygiene: false,
  });
  const backendSettlements = await Promise.allSettled([
    backendRaceSession.transport.request("initializeWorkspaceWorkerBinding", { binding: backendRaceBindingA }, 30_000),
    backendRaceSession.transport.request("initializeWorkspaceWorkerBinding", { binding: backendRaceBindingB }, 30_000),
  ]);
  assert.equal(backendSettlements.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(backendSettlements.filter((entry) =>
    entry.status === "rejected" && entry.reason?.code === "workspace_worker_binding_already_initialized").length, 1);
  const inspect = await session.request("inspectWorkspaceRepository", { bindingDigest }, 30_000);
  assert.equal(inspect.gitCanonical, true);
  assert.equal(inspect.workspaceBindingDigest, bindingDigest);
  assert.equal(inspect.repositoryPolicy.profileId, "unprofiled_git_repository");
  assert.equal(inspect.repositoryPolicy.validationPosture, "builtin_generic");
  assert.equal(inspect.rawWorkspacePathIncluded, false);

  const listed = await session.request("listWorkspaceRepositoryFiles", {
    bindingDigest,
    prefix: "",
    limit: 200,
  }, 30_000);
  const listedPaths = listed.entries.map((entry) => entry.path);
  assert.equal(listedPaths.includes("src/alpha.js"), true);
  assert.equal(listedPaths.includes("notes.txt"), true, "non-ignored untracked files belong to the canonical manifest");
  assert.equal(listedPaths.includes("ignored/hidden.txt"), false);
  assert.equal(listedPaths.includes(".env"), false);
  assert.equal(listedPaths.includes("linked-alpha.js"), false);
  assert.equal(listedPaths.includes("dir/payload"), false,
    "lossy Git backslash normalization must not alias an ignored path into the manifest");
  assert.equal(listedPaths.includes("leading.txt"), false,
    "lossy Git whitespace normalization must not alias an ignored path into the manifest");
  assert.equal(listedPaths.includes("dir\\payload"), false);
  assert.equal(listedPaths.includes(" leading.txt"), false);
  assert.equal(inspect.excludedEntryCount >= 4, true,
    "the manifest must disclose paths excluded for sensitivity, symlinks, or lossy identity");
  assert.equal(JSON.stringify(listed).includes(tempRoot), false);

  const matched = await session.request("matchWorkspaceRepositoryFiles", {
    bindingDigest,
    patterns: ["src/**/*.js", "*.txt"],
    limit: 20,
  }, 30_000);
  assert.deepEqual(matched.entries.map((entry) => entry.path), ["invalid-utf8.txt", "notes.txt", "src/alpha.js"]);

  const searched = await session.request("searchWorkspaceRepositoryText", {
    bindingDigest,
    query: "value.*literal",
    prefix: "src",
    caseSensitive: true,
    maxResults: 10,
  }, 30_000);
  assert.equal(searched.matches.length, 1, "search query must be interpreted literally, not as a regex");
  assert.equal(searched.matches[0].path, "src/alpha.js");
  assert.equal(searched.matches[0].line, 1);
  const invalidUtf8Search = await session.request("searchWorkspaceRepositoryText", {
    bindingDigest,
    query: "invalid-search-target",
    prefix: "",
    caseSensitive: true,
    maxResults: 10,
  }, 30_000);
  assert.equal(invalidUtf8Search.matches.length, 0, "search must not expose a partly decoded invalid UTF-8 file");
  assert.equal(invalidUtf8Search.incomplete, true);
  assert.equal(invalidUtf8Search.truncated, true);
  assert.equal(invalidUtf8Search.omissionCounts.invalidUtf8 >= 1, true);
  assert.equal(invalidUtf8Search.bytesScanned >= Buffer.byteLength("invalid-search-target\n") + 2, true,
    "invalid UTF-8 and binary reads must still consume the aggregate byte budget");
  const oversizedSearch = await session.request("searchWorkspaceRepositoryText", {
    bindingDigest,
    query: "oversized-search-target",
    prefix: "",
    caseSensitive: true,
    maxResults: 10,
  }, 30_000);
  assert.equal(oversizedSearch.matches.length, 0);
  assert.equal(oversizedSearch.truncated, true, "search must disclose size-filtered omissions");
  assert.equal(oversizedSearch.incomplete, true);
  assert.equal(oversizedSearch.omissionCounts.fileSizeLimit >= 1, true);

  const strictUtf8 = (buffer) => ({
    text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
  });
  const binaryClassifier = (buffer) => buffer.includes(0);
  const boundedClassificationSearch = await searchBoundedWorkspaceRepositoryText({
    entries: [
      { path: "binary.dat", size: 4 },
      { path: "invalid.txt", size: 4 },
      { path: "target.txt", size: 6 },
    ],
    query: "needle",
    caseSensitive: true,
    maxResults: 10,
    fileLimit: 10,
    fileByteLimit: 8,
    totalByteLimit: 8,
    readEntry: async (entry) => {
      const buffers = {
        "binary.dat": Buffer.from([0, 0x61, 0x61, 0x61]),
        "invalid.txt": Buffer.from([0xc3, 0x28, 0x61, 0x61]),
        "target.txt": Buffer.from("needle", "utf8"),
      };
      return { buffer: buffers[entry.path], size: entry.size, truncated: false };
    },
    looksBinary: binaryClassifier,
    decodeUtf8: strictUtf8,
  });
  assert.equal(boundedClassificationSearch.bytesScanned, 8);
  assert.equal(boundedClassificationSearch.filesAttempted, 2);
  assert.equal(boundedClassificationSearch.binaryFileCount, 1);
  assert.equal(boundedClassificationSearch.omissionCounts.invalidUtf8, 1);
  assert.equal(boundedClassificationSearch.omissionCounts.aggregateByteLimit, 1);
  assert.equal(boundedClassificationSearch.matches.length, 0,
    "binary and invalid UTF-8 reads must exhaust the same aggregate budget as decoded text");

  const unicodeFoldSearch = await searchBoundedWorkspaceRepositoryText({
    entries: [{ path: "unicode-fold.txt", size: Buffer.byteLength("İx\n") }],
    query: "x",
    caseSensitive: false,
    maxResults: 10,
    fileLimit: 10,
    fileByteLimit: 64,
    totalByteLimit: 64,
    readEntry: async () => ({
      buffer: Buffer.from("İx\n", "utf8"),
      size: Buffer.byteLength("İx\n"),
      truncated: false,
    }),
    looksBinary: binaryClassifier,
    decodeUtf8: strictUtf8,
  });
  assert.equal(unicodeFoldSearch.matches.length, 1);
  assert.equal(unicodeFoldSearch.matches[0].column, 2,
    "case folding expansions must map match offsets back to original UTF-16 columns");
  const localeStableSearch = await searchBoundedWorkspaceRepositoryText({
    entries: [{ path: "locale-stable.txt", size: 2 }],
    query: "i",
    caseSensitive: false,
    maxResults: 10,
    fileLimit: 10,
    fileByteLimit: 64,
    totalByteLimit: 64,
    readEntry: async () => ({ buffer: Buffer.from("I\n"), size: 2, truncated: false }),
    looksBinary: binaryClassifier,
    decodeUtf8: strictUtf8,
  });
  assert.equal(localeStableSearch.matches.length, 1,
    "case-insensitive repository search must not depend on the host locale");
  const contextualFoldSearch = await searchBoundedWorkspaceRepositoryText({
    entries: [{ path: "contextual-fold.txt", size: Buffer.byteLength("ΟΣ\n") }],
    query: "ος",
    caseSensitive: false,
    maxResults: 10,
    fileLimit: 10,
    fileByteLimit: 64,
    totalByteLimit: 64,
    readEntry: async () => ({
      buffer: Buffer.from("ΟΣ\n", "utf8"),
      size: Buffer.byteLength("ΟΣ\n"),
      truncated: false,
    }),
    looksBinary: binaryClassifier,
    decodeUtf8: strictUtf8,
  });
  assert.equal(contextualFoldSearch.matches.length, 1,
    "case-insensitive repository search must fold complete strings for contextual casing");

  const failedNativePath = path.join(tempRoot, "must-not-leak.txt");
  const boundedFailureSearch = await searchBoundedWorkspaceRepositoryText({
    entries: [
      { path: "read-failure.txt", size: 3 },
      { path: "revalidation-failure.txt", size: 4 },
      { path: "target.txt", size: 6 },
    ],
    query: "needle",
    caseSensitive: true,
    maxResults: 10,
    fileLimit: 10,
    fileByteLimit: 8,
    totalByteLimit: 20,
    readEntry: async (entry) => {
      if (entry.path === "read-failure.txt") {
        const error = new Error("fixture read failure");
        error.workspaceWorkerBytesRead = 3;
        error.nativePath = failedNativePath;
        throw error;
      }
      if (entry.path === "revalidation-failure.txt") {
        return { buffer: Buffer.from("safe", "utf8"), size: 5, truncated: false };
      }
      return { buffer: Buffer.from("needle", "utf8"), size: 6, truncated: false };
    },
    looksBinary: binaryClassifier,
    decodeUtf8: strictUtf8,
  });
  assert.equal(boundedFailureSearch.matches.length, 1);
  assert.equal(boundedFailureSearch.bytesScanned, 13);
  assert.equal(boundedFailureSearch.omissionCounts.readOrRevalidationFailure, 2);
  assert.equal(boundedFailureSearch.omittedFileCount, 2);
  assert.equal(boundedFailureSearch.incomplete, true);
  assert.equal(boundedFailureSearch.truncated, true);
  assert.equal(JSON.stringify(boundedFailureSearch).includes(failedNativePath), false);

  const read = await session.request("readWorkspaceRepositoryFile", {
    bindingDigest,
    relPath: "src/alpha.js",
    maxBytes: 32,
  }, 30_000);
  assert.equal(read.truncated, true);
  assert.match(read.text, /value\.\*literal/);
  const unicodeRead = await session.request("readWorkspaceRepositoryFile", {
    bindingDigest,
    relPath: "src/unicode.txt",
    maxBytes: 2,
  }, 30_000);
  assert.equal(unicodeRead.truncated, true);
  assert.equal(unicodeRead.text, "A", "bounded reads must stop before an incomplete UTF-8 sequence");
  assert.equal(unicodeRead.text.includes("\ufffd"), false);
  assert.equal(unicodeRead.textByteCount, 1);
  assert.equal(unicodeRead.utf8BoundaryAdjustedBytes, 1);
  await assert.rejects(
    () => session.request("readWorkspaceRepositoryFile", { bindingDigest, relPath: ".env" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_read_path_denied",
  );
  await assert.rejects(
    () => session.request("readWorkspaceRepositoryFile", { bindingDigest, relPath: "linked-alpha.js" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_read_not_canonical",
  );
  await assert.rejects(
    () => session.request("readWorkspaceRepositoryFile", { bindingDigest, relPath: "binary.dat" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_binary_denied",
  );
  await assert.rejects(
    () => session.request("readWorkspaceRepositoryFile", { bindingDigest, relPath: "late-binary.dat" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_binary_denied",
  );
  await assert.rejects(
    () => session.request("readWorkspaceRepositoryFile", { bindingDigest, relPath: "invalid-utf8.txt" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_utf8_invalid",
  );
  const sensitivePatch = [
    "diff --git a/.npmrc b/.npmrc",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/.npmrc",
    "@@ -0,0 +1,1 @@",
    "+token=must-not-be-written",
    "",
  ].join("\n");
  for (const mode of ["dryRun", "apply"]) {
    await assert.rejects(
      () => session.request("applyWorkspaceWorkerPatch", { bindingDigest, mode, patch: sensitivePatch }, 30_000),
      (error) => error?.code === "workspace_worker_repository_patch_path_denied",
      `workspace worker ${mode} must reject sensitive patch targets`,
    );
  }
  assert.equal(fs.existsSync(path.join(tempRoot, ".npmrc")), false,
    "sensitive patch rejection must occur before any workspace mutation");
  await assert.rejects(
    () => session.request("listWorkspaceRepositoryFiles", { bindingDigest, prefix: ".git", limit: 10 }, 30_000),
    (error) => error?.code === "workspace_worker_repository_prefix_denied",
  );
  await assert.rejects(
    () => session.request("inspectWorkspaceRepository", { bindingDigest: "not-a-binding" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_binding_missing",
  );
  await assert.rejects(
    () => session.request("inspectWorkspaceRepository", { bindingDigest: `sha256:${"9".repeat(64)}` }, 30_000),
    (error) => error?.code === "workspace_worker_binding_mismatch",
  );

  const detectedTestProfile = await session.request("directTestProfile", {}, 30_000);
  assert.equal(detectedTestProfile.profileId, "node_package_test");
  assert.deepEqual(detectedTestProfile.actionsAllowed, ["test"]);
  assert.equal(detectedTestProfile.repositoryPolicy.profileId, "unprofiled_git_repository");
  assert.equal(detectedTestProfile.repositoryPolicy.validationPosture, "builtin_generic");
  const harnessAuthorityPacket = createWorkspaceParentAuthorityPacket({
    boundaryId: "parent_worker_policy_fixture",
    upstreamPolicyId: "worker_policy_repository_harness_tools",
    upstreamAllowedTools: detectedTestProfile.repositoryPolicy.allowedTools,
    allowedTools: detectedTestProfile.repositoryPolicy.allowedTools,
  });
  assert.throws(
    () => createWorkspaceParentAuthorityPacket({
      boundaryId: "missing_upstream_tools",
      upstreamPolicyId: "missing_upstream_tools_policy",
    }),
    (error) => error?.code === "direct_workspace_parent_authority_invalid",
  );
  const explicitEmptyUpstreamPacket = createWorkspaceParentAuthorityPacket({
    boundaryId: "explicit_empty_upstream_tools",
    upstreamPolicyId: "explicit_empty_upstream_tools_policy",
    upstreamAllowedTools: [],
  });
  assert.deepEqual(explicitEmptyUpstreamPacket.allowedTools, []);
  assert.equal(validateWorkspaceParentAuthorityPacket(explicitEmptyUpstreamPacket), explicitEmptyUpstreamPacket);
  assert.throws(
    () => validateWorkspaceParentAuthorityPacket({ ...harnessAuthorityPacket }),
    (error) => error?.code === "direct_workspace_parent_authority_invalid",
  );
  const upstreamNarrowedPacket = createWorkspaceParentAuthorityPacket({
    boundaryId: "parent_worker_policy_upstream_narrowed",
    upstreamPolicyId: "worker_policy_repository_read_only_upstream",
    upstreamAllowedTools: ["inspect_repository", "read_file"],
    allowedTools: ["inspect_repository", "read_file", "apply_patch"],
  });
  assert.deepEqual(upstreamNarrowedPacket.allowedTools, ["inspect_repository", "read_file"]);
  const contractInput = {
    projectId: parentProjectId,
    childAgentId: "worker-policy-fixture",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    binding,
    parentAuthorityPacket: harnessAuthorityPacket,
    testProfile: detectedTestProfile,
  };
  const fullContract = compileWorkspaceWorkerContract(contractInput).contract;
  assert.deepEqual(fullContract.authority.declaredTools, [
    "inspect_repository",
    "list_files",
    "match_files",
    "search_text",
    "read_file",
    "apply_patch",
    "run_test",
  ]);
  assert.equal(fullContract.authority.requestedToolProfileAdvisory, true);
  assert.equal(fullContract.policyCompilation.parentAuthorityExplicit, true);
  assert.equal(fullContract.policyCompilation.substrateCapabilityExplicit, true);
  assert.equal(fullContract.policyCompilation.wideningPerformed, false);
  assert.deepEqual(fullContract.policyCompilation.wideningSources, []);
  assert.equal(fullContract.authority.bottomUpMessagingAllowed, false);
  assert.equal(fullContract.repositoryPolicy.rawPolicyTextIncluded, false);
  await assert.rejects(
    () => executeWorkspaceTool({
      obligation: {
        name: "read_file",
        callId: "call_wrong_binding",
        argumentsText: JSON.stringify({ path: "src/alpha.js" }),
      },
      contract: fullContract,
      provisioned: {
        workspaceRequest: async () => ({
          workspaceBindingDigest: `sha256:${"8".repeat(64)}`,
          relPath: "src/alpha.js",
          text: "not admitted",
        }),
      },
      stepOrdinal: 1,
    }),
    (error) => error?.code === "direct_workspace_worker_repository_binding_drift",
  );
  let sensitiveBackendCalled = false;
  await assert.rejects(
    () => executeWorkspaceTool({
      obligation: {
        name: "read_file",
        callId: "call_sensitive_path",
        argumentsText: JSON.stringify({ path: ".env" }),
      },
      contract: fullContract,
      provisioned: {
        workspaceRequest: async () => {
          sensitiveBackendCalled = true;
          return {};
        },
      },
      stepOrdinal: 1,
    }),
    (error) => error?.code === "direct_workspace_worker_sensitive_path_forbidden",
  );
  assert.equal(sensitiveBackendCalled, false, "sensitive paths must be denied before resident dispatch");

  const missingParent = compileWorkspaceWorkerPolicy({
    requestedProfileId: "implementation_worker",
    repositoryPolicy: detectedTestProfile.repositoryPolicy,
    substrateCapabilities: detectedTestProfile.substrateCapabilities,
    testProfile: detectedTestProfile,
  });
  assert.deepEqual(missingParent.declaredTools, []);
  assert.equal(missingParent.compilation.parentAuthorityExplicit, false);
  assert.equal(missingParent.compilation.boundaryOmissions[0].boundary, "parent_authority");
  const missingParentContract = compileWorkspaceWorkerContract({
    ...contractInput,
    parentAuthorityPacket: undefined,
  }).contract;
  assert.deepEqual(missingParentContract.authority.declaredTools, []);
  assert.equal(missingParentContract.policyCompilation.boundaryOmissions[0].boundary, "parent_authority");
  assert.deepEqual(workspaceWorkerToolSchemas(missingParentContract), []);
  const missingSubstrate = compileWorkspaceWorkerPolicy({
    requestedProfileId: "implementation_worker",
    repositoryPolicy: detectedTestProfile.repositoryPolicy,
    parentAuthority: { allowedTools: harnessAuthorityPacket.allowedTools },
    testProfile: detectedTestProfile,
  });
  assert.deepEqual(missingSubstrate.declaredTools, []);
  assert.equal(missingSubstrate.compilation.substrateCapabilityExplicit, false);

  const narrowedContract = compileWorkspaceWorkerContract({
    ...contractInput,
    parentAuthorityPacket: createWorkspaceParentAuthorityPacket({
      boundaryId: "parent_worker_policy_narrowed",
      upstreamPolicyId: "worker_policy_repository_narrowed_tools",
      upstreamAllowedTools: detectedTestProfile.repositoryPolicy.allowedTools,
      allowedTools: ["inspect_repository", "list_files", "read_file"],
    }),
    substrateCapabilities: { availableTools: ["inspect_repository", "read_file", "apply_patch", "run_test"] },
    repositoryPolicy: {
      ...detectedTestProfile.repositoryPolicy,
      allowedTools: ["apply_patch"],
    },
  }).contract;
  assert.deepEqual(narrowedContract.authority.declaredTools, ["inspect_repository", "read_file"]);
  assert.deepEqual(workspaceWorkerToolSchemas(narrowedContract).map((tool) => tool.name), ["inspect_repository", "read_file"]);
  assert.equal(narrowedContract.policyCompilation.omittedTools.some((entry) => entry.toolName === "apply_patch" && entry.deniedBy.includes("parent_authority")), true);
  assert.equal(narrowedContract.policyCompilation.omittedTools.some((entry) => entry.toolName === "run_test" && entry.deniedBy.includes("parent_authority")), true);

  const forgedRepositoryPolicy = {
    profileId: "arcagi3-odeu-local",
    profileDigest: `sha256:${"9".repeat(64)}`,
    validationPosture: "exact",
    allowedTools: detectedTestProfile.repositoryPolicy.allowedTools,
    sourceRefs: [],
  };
  const forgedPinnedPolicy = compileWorkspaceWorkerPolicy({
    requestedProfileId: "implementation_worker",
    parentAuthority: { allowedTools: harnessAuthorityPacket.allowedTools },
    substrateCapabilities: detectedTestProfile.substrateCapabilities,
    repositoryPolicy: forgedRepositoryPolicy,
    testProfile: {
      ...detectedTestProfile,
      profileId: "arcagi3_pinned_make_actions",
      repositoryPolicy: forgedRepositoryPolicy,
    },
  });
  assert.equal(forgedPinnedPolicy.repositoryPolicy.validationPosture, "profile_evidence_mismatch");
  assert.deepEqual(forgedPinnedPolicy.repositoryPolicy.allowedTools, []);
  assert.deepEqual(forgedPinnedPolicy.declaredTools, []);
  assert.equal(sameNativePath("C:\\Users\\Rose\\Repo", "c:/users/rose/repo/", "win32"), true);
  assert.equal(sameNativePath("/home/rose/repo/", "/home/rose/repo", "linux"), true);
  assert.equal(sameNativePath("/home/rose/Repo", "/home/rose/repo", "linux"), false);
  assert.equal(sameNativePath("/mnt/c/Users/Rose/Repo", "/mnt/c/Users/Rose/Repo/", "linux"), true);
  assert.equal(pinnedWorkspaceMarkerIsExact({
    requestedFullPath: "C:\\Users\\Rose\\Repo\\AGENTS.md",
    resolvedFullPath: "c:/users/rose/repo/agents.md",
    isSymbolicLink: false,
  }, "win32"), true, "pinned marker validation must use platform-aware native-path identity");
  assert.equal(pinnedWorkspaceMarkerIsExact({
    requestedFullPath: "C:\\Users\\Rose\\Repo\\AGENTS.md",
    resolvedFullPath: "c:/users/rose/repo/agents.md",
    isSymbolicLink: true,
  }, "win32"), false);
  assert.equal(pinnedWorkspaceMarkerIsExact({
    requestedFullPath: "/home/rose/Repo/AGENTS.md",
    resolvedFullPath: "/home/rose/repo/AGENTS.md",
    isSymbolicLink: false,
  }, "linux"), false);

  const largeSearch = await executeWorkspaceTool({
    obligation: {
      name: "search_text",
      callId: "call_large_search",
      argumentsText: JSON.stringify({ query: "needle", max_results: 120 }),
    },
    contract: fullContract,
    provisioned: {
      workspaceRequest: async () => ({
        workspaceBindingDigest: bindingDigest,
        matches: Array.from({ length: 120 }, (_, index) => ({
          path: `tests/${String(index).padStart(3, "0")}-${"a".repeat(220)}.js`,
          line: index + 1,
          column: 1,
          text: "needle ".repeat(70),
        })),
        filesScanned: 120,
        bytesScanned: 60_000,
        truncated: false,
        manifestDigest: inspect.manifestDigest,
      }),
    },
    stepOrdinal: 2,
  });
  const parsedLargeSearch = JSON.parse(largeSearch.providerOutputText);
  assert.equal(parsedLargeSearch.evidenceTruncated, true);
  assert.equal(parsedLargeSearch.truncated, true);
  assert.ok(parsedLargeSearch.returned < 120);

  const incompleteSearch = await executeWorkspaceTool({
    obligation: {
      name: "search_text",
      callId: "call_incomplete_search",
      argumentsText: JSON.stringify({ query: "needle", max_results: 10 }),
    },
    contract: fullContract,
    provisioned: {
      workspaceRequest: async () => ({
        workspaceBindingDigest: bindingDigest,
        matches: [],
        filesAttempted: 2,
        filesScanned: 1,
        bytesScanned: 64,
        binaryFileCount: 0,
        omittedFileCount: 1,
        omissionCounts: {
          readOrRevalidationFailure: 1,
        },
        incomplete: true,
        truncated: true,
        failedNativePath: failedNativePath,
        manifestDigest: inspect.manifestDigest,
      }),
    },
    stepOrdinal: 3,
  });
  const parsedIncompleteSearch = JSON.parse(incompleteSearch.providerOutputText);
  assert.equal(parsedIncompleteSearch.incomplete, true);
  assert.equal(parsedIncompleteSearch.truncated, true);
  assert.equal(parsedIncompleteSearch.omissionCounts.readOrRevalidationFailure, 1);
  assert.equal(parsedIncompleteSearch.omittedFileCount, 1);
  assert.equal(JSON.stringify(parsedIncompleteSearch).includes(failedNativePath), false);

  console.log(JSON.stringify({
    ok: true,
    canonicalFileCount: inspect.fileCount,
    trackedAndUntrackedEnumeration: true,
    sensitiveAndSymlinkReadsDenied: true,
    literalSearch: true,
    boundedSearchClassificationAccounting: true,
    failedSearchCoverageVisible: true,
    requestedProfileAdvisory: true,
    harnessOwnedParentAuthority: true,
    concurrentBindingInitializationSerialized: true,
    rendererStatusPathsRedacted: true,
    platformAwareNativePathIdentity: true,
    fourWayIntersection: true,
    forgedPinnedPolicyRejected: true,
    bottomUpMessagingAllowed: false,
  }, null, 2));
} finally {
  manager?.disposeAll();
  backendRaceManager?.disposeAll();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(backendRaceRoot, { recursive: true, force: true });
}
