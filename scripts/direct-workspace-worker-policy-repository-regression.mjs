#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WorkspaceBackendManager } = require("../src/main/workspace-backend");
const {
  compileWorkspaceWorkerContract,
  workspaceWorkerToolSchemas,
} = require("../src/main/direct/agents/workspace-worker-contract");
const {
  executeWorkspaceTool,
} = require("../src/main/direct/agents/workspace-worker-runtime");

const shellRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-worker-policy-repository-"));
let manager;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

try {
  run("git", ["init", "-q"], tempRoot);
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "ignored"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".gitignore"), "ignored/\n", "utf8");
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
  fs.writeFileSync(path.join(tempRoot, "ignored", "hidden.txt"), "ignored literal\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  fs.symlinkSync(path.join(tempRoot, "src", "alpha.js"), path.join(tempRoot, "linked-alpha.js"));
  run("git", ["add", ".gitignore", "package.json", "src/alpha.js", "binary.dat", "linked-alpha.js"], tempRoot);
  run("git", ["add", "-f", ".env"], tempRoot);
  run("git", ["-c", "user.name=Direct Test", "-c", "user.email=direct@invalid.example", "commit", "-qm", "fixture"], tempRoot);
  fs.writeFileSync(path.join(tempRoot, "notes.txt"), "untracked literal evidence\n", "utf8");

  manager = new WorkspaceBackendManager({
    agentPath: path.join(shellRoot, "src/backend/wsl-agent.js"),
    fallbackRoot: shellRoot,
  });
  const project = {
    id: "project_worker_policy_repository_fixture",
    name: "worker policy repository fixture",
    repoPath: tempRoot,
    workspace: { kind: "local", localPath: tempRoot },
  };
  const session = await manager.ensureForProject(project, { workspaceHygiene: false });
  const bindingDigest = `sha256:${"1".repeat(64)}`;
  const inspect = await session.request("inspectWorkspaceRepository", { bindingDigest }, 30_000);
  assert.equal(inspect.gitCanonical, true);
  assert.equal(inspect.workspaceBindingDigest, bindingDigest);
  assert.equal(inspect.repositoryPolicy.profileId, "unprofiled_git_repository");
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
  assert.equal(JSON.stringify(listed).includes(tempRoot), false);

  const matched = await session.request("matchWorkspaceRepositoryFiles", {
    bindingDigest,
    patterns: ["src/**/*.js", "*.txt"],
    limit: 20,
  }, 30_000);
  assert.deepEqual(matched.entries.map((entry) => entry.path), ["notes.txt", "src/alpha.js"]);

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

  const read = await session.request("readWorkspaceRepositoryFile", {
    bindingDigest,
    relPath: "src/alpha.js",
    maxBytes: 32,
  }, 30_000);
  assert.equal(read.truncated, true);
  assert.match(read.text, /value\.\*literal/);
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
    () => session.request("listWorkspaceRepositoryFiles", { bindingDigest, prefix: ".git", limit: 10 }, 30_000),
    (error) => error?.code === "workspace_worker_repository_prefix_denied",
  );
  await assert.rejects(
    () => session.request("inspectWorkspaceRepository", { bindingDigest: "not-a-binding" }, 30_000),
    (error) => error?.code === "workspace_worker_repository_binding_missing",
  );

  const detectedTestProfile = await session.request("directTestProfile", {}, 30_000);
  assert.equal(detectedTestProfile.profileId, "node_package_test");
  assert.deepEqual(detectedTestProfile.actionsAllowed, ["test"]);
  assert.equal(detectedTestProfile.repositoryPolicy.profileId, "unprofiled_git_repository");
  const contractInput = {
    projectId: project.id,
    childAgentId: "worker-policy-fixture",
    workspaceMode: "isolated_worktree",
    toolProfile: "implementation_worker",
    binding: {
      bindingId: "binding_fixture",
      bindingDigest,
      projectId: project.id,
      workerKey: "worker-policy-fixture",
      workspaceKind: "local",
      branch: "codex/worker/worker-policy-fixture",
      baseCommit: run("git", ["rev-parse", "HEAD"], tempRoot),
      rootEvidenceDigest: `sha256:${"2".repeat(64)}`,
      retainedAfterCompletion: true,
    },
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
  assert.equal(fullContract.policyCompilation.parentAuthorityExplicit, false);
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

  const narrowedContract = compileWorkspaceWorkerContract({
    ...contractInput,
    parentAuthority: { allowedTools: ["inspect_repository", "list_files", "read_file", "apply_patch"] },
    substrateCapabilities: { availableTools: ["inspect_repository", "read_file", "apply_patch", "run_test"] },
    repositoryPolicy: {
      ...detectedTestProfile.repositoryPolicy,
      allowedTools: ["inspect_repository", "list_files", "match_files", "search_text", "read_file"],
    },
  }).contract;
  assert.deepEqual(narrowedContract.authority.declaredTools, ["inspect_repository", "read_file"]);
  assert.deepEqual(workspaceWorkerToolSchemas(narrowedContract).map((tool) => tool.name), ["inspect_repository", "read_file"]);
  assert.equal(narrowedContract.policyCompilation.omittedTools.some((entry) => entry.toolName === "apply_patch" && entry.deniedBy.includes("repository_policy")), true);
  assert.equal(narrowedContract.policyCompilation.omittedTools.some((entry) => entry.toolName === "run_test" && entry.deniedBy.includes("parent_authority")), true);

  const forgedPinnedContract = compileWorkspaceWorkerContract({
    ...contractInput,
    testProfile: {
      ...detectedTestProfile,
      profileId: "arcagi3_pinned_make_actions",
      repositoryPolicy: {
        profileId: "arcagi3-odeu-local",
        profileDigest: `sha256:${"9".repeat(64)}`,
        validationPosture: "exact",
        allowedTools: detectedTestProfile.repositoryPolicy.allowedTools,
        sourceRefs: [],
      },
    },
  }).contract;
  assert.equal(forgedPinnedContract.repositoryPolicy.validationPosture, "profile_evidence_mismatch");
  assert.equal(forgedPinnedContract.authority.declaredTools.includes("run_test"), false);
  assert.equal(forgedPinnedContract.testProfile, null);

  console.log(JSON.stringify({
    ok: true,
    canonicalFileCount: inspect.fileCount,
    trackedAndUntrackedEnumeration: true,
    sensitiveAndSymlinkReadsDenied: true,
    literalSearch: true,
    requestedProfileAdvisory: true,
    fourWayIntersection: true,
    forgedPinnedPolicyRejected: true,
    bottomUpMessagingAllowed: false,
  }, null, 2));
} finally {
  manager?.disposeAll();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
