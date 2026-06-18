#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  LIVE_OPT_IN_ENV_VAR,
  buildBlockedReport,
  buildFixturePassingReport,
  createFixtureWorkspace,
  providerBlockFromEvents,
  reportAssertions,
  reportPassed,
} from "./direct-headless-live-implementation-thread.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const harnessPath = path.join(__dirname, "direct-headless-live-implementation-thread.mjs");

function parseJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (error) {
    assert.fail(`Expected JSON output, got: ${String(text || "").slice(0, 500)} (${error.message})`);
  }
}

function withoutLiveOptIn(env) {
  const next = { ...env };
  delete next[LIVE_OPT_IN_ENV_VAR];
  return next;
}

function run() {
  const passing = buildFixturePassingReport();
  assert.equal(reportPassed(passing), true, "fixture passing report should satisfy the live harness assertions");

  const assertions = reportAssertions(passing);
  assert.equal(assertions.declaredReadPatchCommand, true);
  assert.equal(assertions.patchApplied, true);
  assert.equal(assertions.commandPassed, true);
  assert.equal(assertions.finalTestPassed, true);
  assert.equal(assertions.calcFixed, true);
  assert.equal(assertions.subAgentUnavailableTruthful, true);
  assert.equal(assertions.rawPromptIncluded, false);
  assert.equal(assertions.rawProviderPayloadIncluded, false);
  assert.equal(assertions.rawAuthTokensIncluded, false);
  assert.ok(assertions.readCount >= 2, "fixture report should include multiple read_file calls");

  const rawPromptLeak = { ...passing, rawPromptIncluded: true };
  assert.equal(reportPassed(rawPromptLeak), false, "raw prompt exposure must fail the report gate");

  const missingCommand = {
    ...passing,
    actionLog: passing.actionLog.filter((action) => action.tool !== "run_command"),
  };
  assert.equal(reportPassed(missingCommand), false, "missing command execution must fail the report gate");

  const blocked = buildBlockedReport("live_provider_call_opt_in_missing", "Live provider call not enabled for regression.");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasonCode, "live_provider_call_opt_in_missing");
  assert.equal(blocked.providerStarted, false);
  assert.equal(blocked.rawPromptIncluded, false);
  assert.equal(blocked.rawProviderPayloadIncluded, false);
  assert.equal(blocked.rawAuthTokensIncluded, false);

  const quotaBlock = providerBlockFromEvents([{ type: "quota_error", code: "http_429" }]);
  assert.equal(quotaBlock.reasonCode, "provider_quota_error");
  assert.equal(quotaBlock.providerErrorCode, "http_429");

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-live-impl-fixture-"));
  createFixtureWorkspace(workspaceRoot);
  assert.match(fs.readFileSync(path.join(workspaceRoot, "src", "calc.js"), "utf8"), /return a - b/);
  assert.match(fs.readFileSync(path.join(workspaceRoot, "test.js"), "utf8"), /add\(2, 3\)/);

  const noOptIn = spawnSync(process.execPath, [harnessPath, "--report-json"], {
    cwd: path.resolve(__dirname, ".."),
    env: withoutLiveOptIn(process.env),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(noOptIn.status, 2, `expected opt-in blocker exit 2; stderr=${noOptIn.stderr}`);
  const noOptInReport = parseJson(noOptIn.stdout);
  assert.equal(noOptInReport.status, "blocked");
  assert.equal(noOptInReport.reasonCode, "live_provider_call_opt_in_missing");
  assert.equal(noOptInReport.providerStarted, false);
  assert.equal(noOptInReport.rawPromptIncluded, false);
  assert.equal(noOptInReport.rawProviderPayloadIncluded, false);
  assert.equal(noOptInReport.rawAuthTokensIncluded, false);

  const fixtureMode = spawnSync(process.execPath, [harnessPath, "--fixture-report", "--report-json"], {
    cwd: path.resolve(__dirname, ".."),
    env: withoutLiveOptIn(process.env),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(fixtureMode.status, 0, `expected fixture report success; stderr=${fixtureMode.stderr}`);
  const fixtureReport = parseJson(fixtureMode.stdout);
  assert.equal(reportPassed(fixtureReport), true, "CLI fixture report should pass");

  console.log(
    JSON.stringify(
      {
        ok: true,
        script: "direct-headless-live-implementation-thread-regression",
        checked: [
          "fixture_report_passes",
          "raw_exposure_gate",
          "missing_command_gate",
          "fixture_workspace_shape",
          "live_opt_in_blocker",
          "provider_quota_blocker",
          "fixture_cli_mode",
        ],
      },
      null,
      2,
    ),
  );
}

run();
