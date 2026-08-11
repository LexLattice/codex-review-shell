#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const profileName = "world-manager-launch-routing";
const projectId = "project_world_manager_launch_routing";
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "world-manager-launch-routing-"),
);

function writeConfig() {
  const profileRoot = path.join(tempRoot, profileName);
  fs.mkdirSync(profileRoot, { recursive: true });
  fs.writeFileSync(
    path.join(profileRoot, "workspace-config.json"),
    `${JSON.stringify({
      version: 5,
      selectedProjectId: projectId,
      projects: [{
        id: projectId,
        name: "WorldManager launch routing fixture",
        repoPath: repoRoot,
        workspace: {
          kind: "local",
          localPath: repoRoot,
          label: "Local fixture checkout",
        },
        surfaceBinding: {
          codex: {
            mode: "managed",
            bindingProvider: "codex-compatible",
            runtimeMode: "direct-experimental",
            directTransport: "fixture",
            directTier: "text-only",
            runtime: "auto",
            target: "codex://local-workspace",
            binaryPath: "codex",
            label: "Fixture Direct lane",
          },
          chatgpt: {
            reviewThreadUrl: "",
            reduceChrome: true,
          },
        },
        chatThreads: [],
        promptTemplates: {},
        flowProfile: {},
      }],
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function decodeSurfacePayload(url) {
  const raw = new URL(url).hash.slice(1);
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}

async function launchProductionSurface() {
  const env = {
    ...process.env,
    CODEX_EXPERIENCE: "world-manager-studio",
    CODEX_REVIEW_SHELL_PROFILE: profileName,
    CODEX_REVIEW_SHELL_USER_DATA_ROOT: tempRoot,
    CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
  };
  delete env.CODEX_WORLD_MANAGER;
  delete env.CODEX_WORLD_MANAGER_MOCKUP;
  const app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env,
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector("#worldRevision", { timeout: 20_000 });
    await window.waitForFunction(
      () => document.querySelector("#worldRevision")?.textContent
        ?.includes("WM-K6-GENESIS"),
      null,
      { timeout: 20_000 },
    );
    return {
      payload: decodeSurfacePayload(window.url()),
      title: await window.title(),
      revision: await window.locator("#worldRevision").innerText(),
      composerDisabled: await window.locator("#composerInput").isDisabled(),
    };
  } finally {
    await app.close();
  }
}

writeConfig();
try {
  const result = await launchProductionSurface();
  assert.equal(result.title, "WorldManager Studio");
  assert.deepEqual(result.payload.appExperience, {
    id: "world-manager-studio",
    label: "WorldManager Studio",
    controlPlane: "worldmanager-semantic",
    interactionLaw: "semantic-settlement-and-admission",
    rendererDocument: "world-manager-surface.html",
    variant: "production",
  });
  assert.deepEqual(result.payload.worldManager, {
    mode: "production",
    pipelineStage: "wm_k6_genesis",
  });
  assert.equal(result.payload.semanticMockup, null);
  assert.match(result.revision, /WM-K6-GENESIS keyboard pipeline/);
  assert.equal(result.composerDisabled, false);

  console.log(JSON.stringify({
    ok: true,
    regression: "direct-world-manager-launch-routing",
    explicitProductionEnvelope: true,
    semanticFallbackAbsent: true,
    rendererSelectedK6Genesis: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
