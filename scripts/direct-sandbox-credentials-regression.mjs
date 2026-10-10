#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BubblewrapExecSandbox, discoverCredentialStoreFiles, sandboxedReadRefusal } = require("../src/main/direct/tools/exec-sandbox");
const { LocalFilePort } = require("../src/main/direct/tools/full-access-local-environment");
const refusal = "direct_access_profile_credential_store_hidden";
const report = { ok: true, hostPlatform: process.platform, checks: [] };

// Windows paths compare without case; Linux paths do not.
const windowsCredential = "C:\\Users\\fixture\\custom-home\\auth.json";
const windowsFs = {
  statSync: (target) => {
    if (target.toLowerCase() === windowsCredential.toLowerCase()) return { isFile: () => true };
    throw new Error("missing");
  },
  realpathSync: (target) => target,
  readdirSync: () => [],
};
assert.equal(sandboxedReadRefusal("c:/USERS/FIXTURE/CUSTOM-HOME/AUTH.JSON", {
  platform: "win32", homedir: "C:\\Users\\fixture", env: { CODEX_HOME: "C:\\Users\\fixture\\custom-home" }, fs: windowsFs,
}), refusal);
const linuxCredential = "/home/fixture/custom-home/auth.json";
const linuxFs = {
  statSync: (target) => {
    if (target === linuxCredential) return { isFile: () => true };
    throw new Error("missing");
  },
  realpathSync: (target) => target,
  readdirSync: () => [],
};
const linuxOptions = { platform: "linux", homedir: "/home/fixture", env: { CODEX_HOME: "/home/fixture/custom-home" }, fs: linuxFs };
assert.equal(sandboxedReadRefusal(linuxCredential, linuxOptions), refusal);
assert.equal(sandboxedReadRefusal("/home/fixture/Custom-home/auth.json", linuxOptions), "");
assert.equal(sandboxedReadRefusal(linuxCredential, { ...linuxOptions, env: {}, codexHome: "/home/fixture/custom-home" }), refusal);
report.checks.push("configured_path_case");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-sandbox-credentials-"));
const envNames = ["CODEX_HOME", "CODEX_AUTH_FILE", "CODEX_DIRECT_CODEX_AUTH_FILE", "HOME", "USERPROFILE", "APPDATA"];
const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const writeFixture = (relative, value = "DUMMY_CREDENTIAL_TEXT") => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
  return target;
};
let skipReason = "";
try {
  const codexAuth = writeFixture(".codex/auth.json");
  const customAuth = writeFixture("credential-data/auth.json");
  const directAuth = writeFixture(".codex-review-shell/direct-auth/auth.json");
  const configRoot = path.join(root, ".config");
  const profileAuth = writeFixture(".config/fixture-app/profile/direct-auth/auth.json");
  const explicitAuth = writeFixture("explicit-store/cli-token.json");
  const directCliAuth = writeFixture("explicit-store/direct-cli-token.json");
  const normal = writeFixture("normal.txt", "normal workspace text");
  writeFixture(".codex/normal.txt", "normal workspace text");
  writeFixture("credential-data/normal.txt", "normal workspace text");
  const customHome = path.join(root, ".codex-home");
  const alternateHome = path.join(root, "credential-alias");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(path.dirname(customAuth), customHome, linkType);
  fs.symlinkSync(path.dirname(customAuth), alternateHome, linkType);
  process.env.CODEX_HOME = customHome;
  process.env.CODEX_AUTH_FILE = explicitAuth;
  process.env.CODEX_DIRECT_CODEX_AUTH_FILE = directCliAuth;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.APPDATA = configRoot;

  const credentials = [codexAuth, customAuth, directAuth, profileAuth, explicitAuth, directCliAuth];
  const readTargets = [...credentials, path.join(customHome, "auth.json"), path.join(alternateHome, "auth.json")];
  if (process.platform === "linux") {
    const linkedAuth = writeFixture("linked-store/token.json");
    const linkedHome = path.join(root, ".config", "linked-app", "direct-auth");
    fs.mkdirSync(linkedHome, { recursive: true });
    fs.symlinkSync(linkedAuth, path.join(linkedHome, "auth.json"));
    credentials.push(linkedAuth);
    readTargets.push(linkedAuth);
  }
  const discovered = discoverCredentialStoreFiles();
  assert(discovered.includes(path.join(customHome, "auth.json")));
  assert(discovered.includes(directAuth));
  assert(discovered.includes(profileAuth));
  assert(discovered.includes(explicitAuth));
  assert(discovered.includes(directCliAuth));
  const port = new LocalFilePort({ workspaceRootResolver: () => root });
  for (const sandboxMode of ["read-only", "workspace-write"]) {
    const grant = { sandboxMode };
    for (const target of readTargets) {
      assert.equal(sandboxedReadRefusal(target, { workspaceRoot: root }), refusal, target);
      const resolved = port.resolveTarget({}, grant, target);
      assert.throws(() => port.assertReadable(grant, resolved), (error) => error.code === refusal, target);
      // The post-open check must enforce the same policy, even without a precheck.
      await assert.rejects(() => port.readFile(resolved, undefined, {}, grant), (error) => error.code === refusal, target);
    }
    const resolved = port.resolveTarget({}, grant, "normal.txt");
    port.assertReadable(grant, resolved);
    assert.equal((await port.readFile(resolved, undefined, {}, grant)).bytes.toString(), "normal workspace text");
  }
  const full = { sandboxMode: "danger-full-access" };
  for (const target of readTargets) {
    const resolved = port.resolveTarget({}, full, target);
    port.assertReadable(full, resolved);
    assert.equal((await port.readFile(resolved, undefined, {}, full)).bytes.toString(), "DUMMY_CREDENTIAL_TEXT");
  }
  report.checks.push("local_file_precheck_and_post_open", "symlink_credential_paths", "full_access_reads");

  if (process.platform !== "linux") {
    skipReason = "Credential file checks passed; real bubblewrap checks require Linux.";
  } else {
    const sandbox = new BubblewrapExecSandbox({ homedir: root });
    const probe = sandbox.available()
      ? spawnSync(sandbox.resolveExecutable(), ["--ro-bind", "/", "/", "--unshare-net", "--", "/bin/true"], { timeout: 5000, encoding: "utf8" })
      : null;
    if (!probe || probe.status !== 0) {
      skipReason = "Credential file checks passed; real bubblewrap checks need a working unprivileged sandbox.";
    } else {
      const run = (workspaceRoot, sandboxMode, command, args) => {
        const plan = sandbox.wrap({ root: workspaceRoot, cwd: workspaceRoot, sandboxMode, command, args });
        const mounts = plan.args.slice(0, plan.args.indexOf("--chdir"));
        const firstMask = mounts.indexOf("/dev/null");
        assert(firstMask > mounts.lastIndexOf(workspaceRoot), "credential masks follow the workspace mount");
        assert(firstMask > mounts.lastIndexOf("/tmp"), "credential masks follow the temporary directory mount");
        return spawnSync(plan.command, plan.args, { timeout: 5000, encoding: "utf8" });
      };
      for (const workspaceRoot of [root, path.dirname(codexAuth), path.dirname(customAuth)]) {
        for (const sandboxMode of ["read-only", "workspace-write"]) {
          for (const target of readTargets) {
            const result = run(workspaceRoot, sandboxMode, "/bin/cat", [target]);
            assert([0, 1].includes(result.status), `${sandboxMode}: ${target}: ${result.stderr}`);
            assert.doesNotMatch(result.stderr, /^bwrap:/m, "the sandbox must launch successfully");
            assert.equal(result.stdout, "", `${sandboxMode} must not expose ${target}`);
          }
          const ordinary = path.join(workspaceRoot, "normal.txt");
          const read = run(workspaceRoot, sandboxMode, "/bin/cat", [ordinary]);
          assert.equal(read.status, 0, read.stderr);
          assert.equal(read.stdout, "normal workspace text");
          const write = run(workspaceRoot, sandboxMode, "/bin/sh", ["-c", 'printf changed > "$1"', "writer", ordinary]);
          if (sandboxMode === "workspace-write") {
            assert.equal(write.status, 0, write.stderr);
            assert.equal(fs.readFileSync(ordinary, "utf8"), "changed");
            fs.writeFileSync(ordinary, "normal workspace text");
          } else {
            assert.notEqual(write.status, 0, "Read only must not write ordinary workspace files");
            assert.equal(fs.readFileSync(ordinary, "utf8"), "normal workspace text");
          }
        }
      }
      for (const target of credentials) {
        const write = run(root, "workspace-write", "/bin/sh", ["-c", 'printf changed > "$1"', "writer", target]);
        assert.notEqual(write.status, 0, `the credential mask must be read-only: ${target}`);
        assert.equal(fs.readFileSync(target, "utf8"), "DUMMY_CREDENTIAL_TEXT");
      }
      assert.equal(fs.readFileSync(normal, "utf8"), "normal workspace text");
      report.checks.push("real_bubblewrap_mount_order", "workspace_read_write_profiles", "read_only_credential_masks");
    }
  }
} finally {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
if (skipReason) {
  console.log(`SKIPPED: ${skipReason}`);
  process.exitCode = 77;
}
