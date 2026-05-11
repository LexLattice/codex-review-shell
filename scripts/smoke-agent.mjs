import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const agentPath = path.join(appRoot, "src", "backend", "wsl-agent.js");

async function runAgentBatch(root, requests) {
  const batchChild = spawn(process.execPath, [agentPath, "--root", root, "--workspace-kind", "local", "--project-id", "smoke"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let batchBuffer = "";
  const batchResponses = new Map();
  const batchEvents = [];
  batchChild.stdout.setEncoding("utf8");
  batchChild.stdout.on("data", (chunk) => {
    batchBuffer += chunk;
    let index = batchBuffer.indexOf("\n");
    while (index >= 0) {
      const line = batchBuffer.slice(0, index);
      batchBuffer = batchBuffer.slice(index + 1);
      index = batchBuffer.indexOf("\n");
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.event) batchEvents.push(message);
      else batchResponses.set(message.id, message);
    }
  });
  batchChild.stderr.setEncoding("utf8");
  batchChild.stderr.on("data", (chunk) => process.stderr.write(chunk));
  for (const request of requests) {
    batchChild.stdin.write(`${JSON.stringify(request)}\n`);
  }
  batchChild.stdin.end();
  const batchTimeout = setTimeout(() => batchChild.kill(), 6000);
  await once(batchChild, "exit");
  clearTimeout(batchTimeout);
  return { responses: batchResponses, events: batchEvents };
}

const child = spawn(process.execPath, [agentPath, "--root", appRoot, "--workspace-kind", "local", "--project-id", "smoke"], {
  cwd: appRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const responses = new Map();
const events = [];
let failed = false;

function handleLine(line) {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.event) {
    events.push(message);
    return;
  }
  responses.set(message.id, message);
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    handleLine(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

function send(id, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
}

send("hello", "hello");
send("tree", "listTree", { relPath: "src" });
send("readme", "readFile", { relPath: "README.md" });
send("matches", "listMatchingFiles", { patterns: ["README.md", "src/**/*.js"], ignoredRelPaths: [] });
send("resolve", "resolvePath", { relPath: "README.md" });
child.stdin.end();

const timeout = setTimeout(() => {
  failed = true;
  child.kill();
}, 6000);

await once(child, "exit");
clearTimeout(timeout);

for (const required of ["hello", "tree", "readme", "matches", "resolve"]) {
  const response = responses.get(required);
  if (!response || response.error) {
    failed = true;
    console.error(`Missing or failed response: ${required}`, response?.error || "no response");
  }
}

if (!events.some((event) => event.event === "ready")) {
  failed = true;
  console.error("Agent did not emit ready event.");
}

const matches = responses.get("matches")?.result?.entries || [];
if (!matches.some((entry) => entry.relPath === "README.md")) {
  failed = true;
  console.error("Matching-file smoke did not find README.md through the backend.");
}

const patchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-agent-patch-"));
try {
  fs.writeFileSync(path.join(patchRoot, "space name.txt"), "old line\n", "utf8");
  const patchText = [
    'diff --git "a/space name.txt" "b/space name.txt"',
    '--- "a/space name.txt"',
    '+++ "b/space name.txt"',
    "@@ -1 +1 @@",
    "-old line",
    "+new line",
    'diff --git "a/no newline.txt" "b/no newline.txt"',
    "new file mode 100644",
    "--- /dev/null",
    '+++ "b/no newline.txt"',
    "@@ -0,0 +1 @@",
    "+hello",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  const patchBatch = await runAgentBatch(patchRoot, [
    { id: "patchDryRun", method: "applyPatch", params: { mode: "dryRun", patch: patchText } },
    { id: "patchApply", method: "applyPatch", params: { mode: "apply", patch: patchText } },
  ]);
  const dryRun = patchBatch.responses.get("patchDryRun");
  const applied = patchBatch.responses.get("patchApply");
  if (!dryRun || dryRun.error || !applied || applied.error) {
    failed = true;
    console.error("Patch apply smoke failed.", dryRun?.error || applied?.error || "missing response");
  } else {
    const dryFiles = dryRun.result.files || [];
    const spacePlan = dryFiles.find((file) => file.displayPath === "space name.txt");
    const newlinePlan = dryFiles.find((file) => file.displayPath === "no newline.txt");
    if (!spacePlan || !newlinePlan) {
      failed = true;
      console.error("Patch apply smoke did not preserve quoted paths with spaces.");
    }
    if (spacePlan?.previewText === newlinePlan?.previewText) {
      failed = true;
      console.error("Patch apply smoke expected per-file patch previews.");
    }
    if (fs.readFileSync(path.join(patchRoot, "space name.txt"), "utf8") !== "new line\n") {
      failed = true;
      console.error("Patch apply smoke did not update quoted path file.");
    }
    if (fs.readFileSync(path.join(patchRoot, "no newline.txt"), "utf8") !== "hello") {
      failed = true;
      console.error("Patch apply smoke did not preserve no-newline marker.");
    }
  }
} finally {
  fs.rmSync(patchRoot, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("Workspace backend agent smoke passed.");
