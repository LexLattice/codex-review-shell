"use strict";

// Writes a planned patch's files from inside the Workspace sandbox
// (bubblewrap on Linux, the Low-integrity job runner on Windows), the way
// Codex runs apply_patch. The host plans and verifies; this process only
// writes, and the sandbox decides what it can reach, so a workspace path
// swapped for a symlink mid-apply can't redirect the write outside.
//
// stdin:  {"root": "<abs>", "files": [{"target": "<abs>", "operation":
//          "write"|"delete", "contentBase64": "..."}]}
// stdout: {"ok": true, "files": n} or {"ok": false, "code", "message",
//          "completed": n}

const fs = require("node:fs");
const path = require("node:path");

function fail(code, message, completed) {
  process.stdout.write(JSON.stringify({ ok: false, code, message, completed }));
  process.exitCode = 1;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function run(payload) {
  const root = path.resolve(String(payload?.root || ""));
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (!payload?.root || !files.length) return fail("sandboxed_write_payload_invalid", "Nothing to write.", 0);
  let completed = 0;
  for (const file of files) {
    const target = path.resolve(String(file?.target || ""));
    if (!inside(root, target) || target === root) {
      return fail("sandboxed_write_target_outside", "A patch target is outside the project folder.", completed);
    }
    try {
      if (file.operation === "delete") {
        fs.unlinkSync(target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temp = `${target}.codex-direct-patch-${process.pid}-${Date.now()}.tmp`;
        fs.writeFileSync(temp, Buffer.from(String(file.contentBase64 || ""), "base64"));
        fs.renameSync(temp, target);
      }
    } catch (error) {
      return fail("sandboxed_write_failed", `Writing a patch target failed (${error?.code || "error"}).`, completed);
    }
    completed += 1;
  }
  process.stdout.write(JSON.stringify({ ok: true, files: completed }));
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    fail("sandboxed_write_payload_invalid", "The write payload isn't valid JSON.", 0);
    return;
  }
  run(payload);
});
