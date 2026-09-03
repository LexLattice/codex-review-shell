import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stagePaths, removeDraft, readStagedAttachmentPayload, buildAttachmentReferenceBlock } = require("../src/main/attachment-staging-store.js");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-review-shell-attachments-"));
const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-review-shell-attachments-ext-"));
const project = { id: "project_smoke", workspace: { kind: "local", localPath: root }, repoPath: root };

async function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const workspaceFile = path.join(root, "notes.md");
  await fs.writeFile(workspaceFile, "# notes\n", "utf8");
  const workspaceResult = await stagePaths(project, [workspaceFile], "file_picker");
  await assert(workspaceResult.attachments.length === 1, "workspace file should produce one draft");
  await assert(workspaceResult.attachments[0].workspaceRelPath === "notes.md", "workspace file should stay a workspace reference");
  await assert(!workspaceResult.attachments[0].sourcePath, "raw source path must not be projected");
  await assert(buildAttachmentReferenceBlock(workspaceResult.attachments).includes("notes.md"), "reference block should include workspace file");

  const externalFile = path.join(externalRoot, "image.png");
  await fs.writeFile(externalFile, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from("png")]));
  const externalResult = await stagePaths(project, [externalFile], "drag_drop");
  const externalDraft = externalResult.attachments[0];
  await assert(externalDraft.kind === "image", "png should be classified as image");
  await assert(Boolean(externalDraft.stagedRelPath), "external file should be staged");
  await assert(!externalDraft.sourcePath, "external raw source path must not be projected");
  const stagedPayload = await readStagedAttachmentPayload(project, externalDraft);
  await assert(stagedPayload?.buffer.equals(await fs.readFile(externalFile)), "valid staged payload should be read through the bounded handle");
  const stagedPath = path.join(root, externalDraft.stagedRelPath);
  await fs.rm(stagedPath);
  await fs.symlink(externalFile, stagedPath);
  const symlinkPayload = await readStagedAttachmentPayload(project, externalDraft);
  await assert(symlinkPayload === null, "a staged symlink replacement must fail closed without reading its target");
  await fs.rm(stagedPath);
  await fs.writeFile(stagedPath, await fs.readFile(externalFile));
  const oversizedBytes = 26 * 1024 * 1024;
  await fs.truncate(stagedPath, oversizedBytes);
  const oversizedPayload = await readStagedAttachmentPayload(project, externalDraft);
  await assert(oversizedPayload === null, "oversized staged payload must fail closed before allocation");
  await assert((await fs.stat(stagedPath)).size === oversizedBytes, "oversized staged payload rejection must preserve the staged file");
  await removeDraft(project, externalDraft.id);

  const dirPath = path.join(externalRoot, "dir");
  await fs.mkdir(dirPath);
  let rejectedDirectory = false;
  try {
    await stagePaths(project, [dirPath], "drag_drop");
  } catch {
    rejectedDirectory = true;
  }
  await assert(rejectedDirectory, "directory drops should be rejected");

  console.log("Attachment staging smoke passed.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(externalRoot, { recursive: true, force: true });
}
