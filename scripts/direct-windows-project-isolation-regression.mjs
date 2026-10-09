#!/usr/bin/env node
// Windows Workspace commands are isolated per project. Every Workspace
// folder gets the same persistent Low label, so before, a Workspace command
// in one project could write into any other project that had run one. Now
// each project's commands are also write-restricted to the project's own
// SID, which only that project's folder grants: a command writes its project
// and its private TEMP, not another project. Windows only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

if (process.platform !== "win32") {
  console.log("SKIPPED: Windows-only (run with Windows Node).");
  process.exit(77);
}
const require = createRequire(import.meta.url);
const { WindowsJobSandbox, projectSidFor } = require("../src/main/direct/tools/windows-job-runner.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-project-isolation-"));
const projectA = path.join(root, "project-a");
const projectB = path.join(root, "project-b");
fs.mkdirSync(projectA);
fs.mkdirSync(projectB);
const sandbox = new WindowsJobSandbox();

// Writes `target`; exit 0 if it worked, 3 if refused.
// `@TEMP` means the command's own TEMP folder.
const WRITER = "const t=process.argv[1]===`@TEMP`?require(`path`).join(process.env.TEMP,`t.txt`):process.argv[1];try{require(`fs`).writeFileSync(t,`x`);process.exit(0)}catch(e){console.error(e.code);process.exit(3)}";
function write(sandboxMode, projectRoot, target) {
  const plan = sandbox.wrap({ sandboxMode, root: projectRoot, cwd: projectRoot, command: process.execPath, args: ["-e", WRITER, target] });
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, { cwd: projectRoot, env: { ...process.env, ...plan.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });
}

try {
  assert.match(projectSidFor(projectA), /^S-1-5-21(-\d+){4}$/);
  assert.equal(projectSidFor(projectA), projectSidFor(`${projectA.toUpperCase()}\\`), "the same folder, the same SID");
  assert.notEqual(projectSidFor(projectA), projectSidFor(projectB));

  const own = await write("workspace-write", projectB, path.join(projectB, "own.txt"));
  assert.equal(own.code, 0, `B writes its own folder: ${JSON.stringify(own)}`);
  assert.equal((await write("workspace-write", projectA, path.join(projectA, "own.txt"))).code, 0, "A writes its own folder");
  const sub = path.join(projectA, "nested", "deeper");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal((await write("workspace-write", projectA, path.join(sub, "file.txt"))).code, 0, "and folders inside it, made later");
  assert.equal((await write("workspace-write", projectA, "@TEMP")).code, 0, "and its private TEMP");

  // Both folders now carry the shared Low label: the project SID is what
  // keeps A out of B.
  const crossed = await write("workspace-write", projectA, path.join(projectB, "from-a.txt"));
  assert.notEqual(crossed.code, 0, `A must not write into B: ${JSON.stringify(crossed)}`);
  assert.equal(fs.existsSync(path.join(projectB, "from-a.txt")), false);
  assert.equal((await write("workspace-write", projectB, path.join(projectA, "from-b.txt"))).code !== 0, true, "nor B into A");

  // Unchanged: Read only writes nowhere in the project; Full access anywhere.
  assert.notEqual((await write("read-only", projectA, path.join(projectA, "ro.txt"))).code, 0);
  assert.equal((await write("danger-full-access", projectA, path.join(projectB, "full.txt"))).code, 0);
  console.log(JSON.stringify({ ok: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
