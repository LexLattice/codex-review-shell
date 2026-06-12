#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDirectInformationBridgeAudit } from "../src/main/direct/bridge/information-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function gitBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function sourceFileStatus(sourceFiles = []) {
  return sourceFiles.map((file) => ({
    file,
    exists: fs.existsSync(path.join(repoRoot, file)),
  }));
}

function withFileStatus(audit) {
  const rows = audit.rows.map((row) => ({
    ...row,
    sourceFileStatus: sourceFileStatus(row.sourceFiles),
  }));
  const missingSourceRows = rows
    .map((row) => ({
      id: row.id,
      missing: row.sourceFileStatus.filter((entry) => !entry.exists).map((entry) => entry.file),
    }))
    .filter((entry) => entry.missing.length);
  return {
    ...audit,
    summary: {
      ...audit.summary,
      missingSourceRowCount: missingSourceRows.length,
      missingSourceFileCount: missingSourceRows.reduce((sum, row) => sum + row.missing.length, 0),
      valid: audit.summary.valid && missingSourceRows.length === 0,
    },
    rows,
    missingSourceRows,
  };
}

function markdownTable(rows) {
  const lines = [
    "| ID | Role | State | Direct posture | Source files |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const sourceCount = row.sourceFiles.length;
    const missingCount = row.sourceFileStatus.filter((entry) => !entry.exists).length;
    const sourceLabel = sourceCount ? `${sourceCount}${missingCount ? ` (${missingCount} missing)` : ""}` : "none";
    lines.push(`| ${[
      row.id,
      row.role,
      row.implementationState,
      row.directPathPosture,
      sourceLabel,
    ].map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`);
  }
  return lines.join("\n");
}

function printMarkdown(audit) {
  console.log("# Direct Information Bridge Implementation Audit");
  console.log("");
  console.log(`Schema: \`${audit.schema}\``);
  console.log(`Branch: \`${audit.branch || "unknown"}\``);
  console.log(`Generated: \`${audit.generatedAt}\``);
  console.log("");
  console.log(audit.posture);
  console.log("");
  console.log("## Summary");
  console.log("");
  console.log(`- Rows: ${audit.summary.totalRows}`);
  console.log(`- Valid: ${audit.summary.valid ? "yes" : "no"}`);
  console.log(`- Missing source files: ${audit.summary.missingSourceFileCount}`);
  console.log(`- By state: ${Object.entries(audit.summary.byImplementationState).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  console.log(`- By role: ${Object.entries(audit.summary.byRole).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  console.log("");
  console.log("## Rows");
  console.log("");
  console.log(markdownTable(audit.rows));
  if (audit.rowErrors.length || audit.missingSourceRows.length) {
    console.log("");
    console.log("## Problems");
    for (const row of audit.rowErrors) console.log(`- ${row.id}: ${row.errors.join(", ")}`);
    for (const row of audit.missingSourceRows) console.log(`- ${row.id}: missing ${row.missing.join(", ")}`);
  }
}

const audit = withFileStatus(buildDirectInformationBridgeAudit({ branch: gitBranch() }));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  printMarkdown(audit);
}

if (!audit.summary.valid) process.exitCode = 1;
