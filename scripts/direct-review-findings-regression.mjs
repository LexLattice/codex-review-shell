#!/usr/bin/env node
// Fixes for the three Codex review findings on PR #313:
// 1. A delegated subfolder is checked on its resolved path: a symlink inside
//    the accepting project can't point the child outside it.
// 2. A parent-bound Linux launch is refused without a trusted setpriv
//    instead of silently losing its die-with-parent guarantee.
// 3. Workspace file operations are symlink-race safe: reads re-check that
//    the opened file is the one the path names and is allowed; writes run
//    inside the sandbox, so a path swapped for a link to outside the project
//    can't redirect them. Runs on Linux and under Windows Node.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { LocalFilePort } = require("../src/main/direct/tools/full-access-local-environment.js");
const { canonicalFolderWithinRoot } = require("../src/main/direct/agents/cross-environment-delegation.js");
const isWindows = process.platform === "win32";
const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");
const link = (target, at) => fs.symlinkSync(target, at, isWindows ? "junction" : "dir");
// Removes a symlink or junction itself, never its target.
const unlink = (at) => { try { fs.unlinkSync(at); } catch { fs.rmdirSync(at); } };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "direct-review-findings-"));
// Outside both the project and /tmp (which Workspace commands may write).
const outside = fs.mkdtempSync(path.join(isWindows ? os.tmpdir() : path.join(os.homedir(), ".cache"), "direct-review-outside-"));
const root = path.join(scratch, "project");
fs.mkdirSync(path.join(root, "sub"), { recursive: true });
const checks = [];

try {
  // 1. fs/list reports the resolved folder; containment uses it.
  {
    link(outside, path.join(root, "escape"));
    const agent = spawn(process.execPath, [path.join(repoRoot, "src/backend/wsl-agent.js"), "--root", root, "--workspace-kind", isWindows ? "windows" : "local", "--project-id", "findings"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    const responses = new Map();
    agent.stdout.setEncoding("utf8");
    agent.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (!message.event) responses.set(message.id, message);
      }
    });
    for (const [id, target] of [["root", root], ["escape", path.join(root, "escape")], ["sub", path.join(root, "sub")]]) {
      agent.stdin.write(`${JSON.stringify({ id, method: "fs/list", params: { path: target, limit: 1 } })}\n`);
    }
    agent.stdin.end();
    await once(agent, "exit");
    const real = (id) => responses.get(id)?.result?.realPath;
    const kind = isWindows ? "windows" : "local";
    assert.equal(real("escape"), fs.realpathSync(outside), "fs/list resolves the symlink");
    assert.equal(canonicalFolderWithinRoot(kind, real("root"), real("escape")), false, "a link to outside the project is refused");
    assert.equal(canonicalFolderWithinRoot(kind, real("root"), real("sub")), true, "a real subfolder is accepted");
    assert.equal(canonicalFolderWithinRoot(kind, real("root"), real("root")), true);
    unlink(path.join(root, "escape"));
    checks.push("delegated folder canonicalized");
  }

  // 2. dieWithParent without a trusted setpriv is refused (Linux only).
  if (process.platform === "linux") {
    const realStat = fs.statSync;
    fs.statSync = (target, ...rest) => {
      if (target === "/usr/bin/setpriv") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return realStat(target, ...rest);
    };
    try {
      const { spawnInLinuxPidNamespace } = require("../src/shared/linux-pid-namespace.js");
      assert.throws(
        () => spawnInLinuxPidNamespace("/bin/true", [], { dieWithParent: true, env: {} }),
        { code: "workspace_linux_pid_namespace_parent_death_unavailable" },
      );
    } finally {
      fs.statSync = realStat;
    }
    checks.push("parent-bound launch refused without setpriv");
  }

  const grant = { sandboxMode: "workspace-write" };
  const port = new LocalFilePort({ workspaceRootResolver: () => root });
  const resolve = (rel) => port.resolveTarget({}, grant, rel, "patch target");
  const plan = (rel, before, after) => ({ operation: "update", beforeExists: true, beforeDigest: sha256(before), _resolved: resolve(rel), _afterText: after });

  // 3a. A Workspace write goes through the sandboxed writer and lands.
  {
    fs.writeFileSync(path.join(root, "sub", "a.txt"), "alpha\n");
    await port.commit(grant, [plan("sub/a.txt", "alpha\n", "alpha2\n")]);
    assert.equal(fs.readFileSync(path.join(root, "sub", "a.txt"), "utf8"), "alpha2\n");
    checks.push("workspace write through the sandbox");
  }

  // 3b. The parent folder is swapped for a link to outside after the host's
  // checks: the sandboxed write can't reach outside.
  {
    fs.writeFileSync(path.join(outside, "a.txt"), "alpha2\n");
    const realWriter = port.sandboxedWriter;
    port.sandboxedWriter = async (request) => {
      fs.renameSync(path.join(root, "sub"), path.join(root, "sub-moved"));
      link(outside, path.join(root, "sub"));
      return realWriter(request);
    };
    await assert.rejects(port.commit(grant, [plan("sub/a.txt", "alpha2\n", "pwned\n")]), "the redirected write fails");
    port.sandboxedWriter = realWriter;
    assert.equal(fs.readFileSync(path.join(outside, "a.txt"), "utf8"), "alpha2\n", "the outside file is untouched");
    assert.deepEqual(fs.readdirSync(outside).sort(), ["a.txt"], "nothing was created outside");
    unlink(path.join(root, "sub"));
    fs.renameSync(path.join(root, "sub-moved"), path.join(root, "sub"));
    checks.push("swapped parent can't redirect the write");
  }

  // 3c. A read whose path is swapped after opening is refused.
  {
    fs.writeFileSync(path.join(root, "sub", "r.txt"), "inside\n");
    fs.writeFileSync(path.join(outside, "r.txt"), "outside secret\n");
    const resolved = port.resolveTarget({}, grant, "sub/r.txt", "read_file path");
    const handle = await fs.promises.open(resolved.target, "r");
    let swapped = false;
    try {
      try {
        fs.renameSync(path.join(root, "sub"), path.join(root, "sub-moved"));
        swapped = true;
      } catch (error) {
        // Windows won't move a folder while a file in it is open, so this
        // race can't happen there; Linux allows it.
        if (!isWindows) throw error;
      }
      if (swapped) {
        link(outside, path.join(root, "sub"));
        await assert.rejects(port.assertOpenedFileAllowed(grant, resolved, handle, "read"), { code: "direct_access_profile_path_changed" });
      }
    } finally {
      await handle.close();
      if (swapped) {
        unlink(path.join(root, "sub"));
        fs.renameSync(path.join(root, "sub-moved"), path.join(root, "sub"));
      }
    }
    // And a clean read still works.
    const read = await port.readFile(resolved, 1024, {}, grant);
    assert.equal(read.bytes.toString("utf8"), "inside\n");
    checks.push("swapped read refused");
  }

  // 3d. A patch target that resolves outside the project is refused at open.
  {
    link(outside, path.join(root, "out"));
    const resolved = port.resolveTarget({}, grant, "out/r.txt", "patch target");
    await assert.rejects(port.readPatchTarget(resolved, "update", {}, grant), { code: "direct_access_profile_path_outside_workspace" });
    unlink(path.join(root, "out"));
    checks.push("patch read outside refused");
  }

  console.log(JSON.stringify({ ok: true, platform: process.platform, checks }));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
