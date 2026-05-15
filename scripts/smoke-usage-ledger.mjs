import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { UsageLedgerStore } = require("../src/main/usage-ledger-store.js");

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-ledger-smoke-"));
const ledgerPath = path.join(dir, "ledger.jsonl");
const store = new UsageLedgerStore({
  ledgerId: "smoke_ledger",
  ledgerPath,
  rawPathPolicy: "excluded",
});

await store.initialize({
  projectId: "project_smoke",
  workspaceRootEvidenceKey: "workspaceRoot:abc",
  providerKind: "codex_executable",
  appServerSchemaRef: {
    schemaSource: "manual-static",
    experimentalApiEnabled: true,
  },
  capturePosture: "codex_app_server_event",
  privacyMode: "metadata_only",
  rawPathPolicy: "excluded",
});

await store.append({
  rowKind: "turn_started",
  sourceKind: "codex_app_server_event",
  confidence: "runtime_exact",
  connectionId: "conn_1",
  threadId: "thread_1",
  turnId: "turn_1",
  evidenceRefs: [],
});

await store.append({
  rowKind: "tool_call_started",
  sourceKind: "codex_app_server_event",
  confidence: "runtime_exact",
  connectionId: "conn_1",
  threadId: "thread_1",
  turnId: "turn_1",
  commandPreview: "/home/rose/secret/path should be redaction-blocked",
  evidenceRefs: [],
});

await store.close("completed");

const rows = (await fs.readFile(ledgerPath, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

if (rows.length !== 3) throw new Error(`Expected 3 rows, got ${rows.length}`);
if (rows[0].rowKind !== "ledger_header") throw new Error("First row is not ledger_header.");
if (!rows.every((row, index) => row.seq === index + 1)) throw new Error("Rows are not monotonic by seq.");
if (!rows.every((row) => row.rowDigest)) throw new Error("A row is missing rowDigest.");
if (rows[2].rowKind !== "usage_unavailable") throw new Error("Redaction scanner did not block raw local path row.");

const manifest = JSON.parse(await fs.readFile(`${ledgerPath}.manifest.json`, "utf8"));
if (manifest.rowCount !== rows.length) throw new Error("Manifest row count does not match ledger rows.");
if (manifest.lastRowDigest !== rows.at(-1).rowDigest) throw new Error("Manifest last digest does not match ledger.");

console.log("Usage ledger smoke passed.");
