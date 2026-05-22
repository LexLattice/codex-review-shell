"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const STAGING_ROOT_REL = ".codex/review-shell/attachments";
const MAX_ATTACHMENT_COUNT = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;

const MIME_BY_EXT = new Map([
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".json", "application/json"],
  [".jsonl", "application/x-ndjson"],
  [".csv", "text/csv"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
  [".html", "text/html"],
  [".htm", "text/html"],
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function newDraftId() {
  return `att_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function evidenceKey(prefix, value) {
  const text = cleanString(value, "");
  if (!text) return "";
  return `${prefix}:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function contentEvidenceKey(draftId, buffer) {
  return `content:${crypto.createHmac("sha256", draftId).update(buffer).digest("hex").slice(0, 16)}`;
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function workspaceRoot(project) {
  const workspace = isPlainObject(project?.workspace) ? project.workspace : {};
  if (workspace.kind === "wsl") return cleanString(workspace.linuxPath, cleanString(project?.repoPath, ""));
  return cleanString(workspace.localPath, cleanString(project?.repoPath, ""));
}

function workspaceKind(project) {
  const kind = cleanString(project?.workspace?.kind, "local");
  return kind === "wsl" ? "wsl" : "local";
}

function relativeWithin(root, target) {
  const normalizedRoot = normalizeSlashes(path.resolve(root)).replace(/\/+$/, "");
  const normalizedTarget = normalizeSlashes(path.resolve(target));
  const lowerRoot = normalizedRoot.toLowerCase();
  const lowerTarget = normalizedTarget.toLowerCase();
  if (lowerTarget === lowerRoot) return "";
  if (!lowerTarget.startsWith(`${lowerRoot}/`)) return null;
  return normalizedTarget.slice(normalizedRoot.length + 1);
}

function safeFileName(value, fallback = "attachment") {
  const base = path.basename(String(value || fallback)).replace(/[\0<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[^\w.-]+/g, "_").trim();
  const compact = base.replace(/\s+/g, "_").slice(0, 96);
  return compact || fallback;
}

function sniffMime(buffer, fileName = "", browserMime = "") {
  const ext = path.extname(fileName).toLowerCase();
  const extensionMime = MIME_BY_EXT.get(ext) || "";
  let sniffedMime = "";
  if (buffer?.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) sniffedMime = "image/png";
  else if (buffer?.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) sniffedMime = "image/jpeg";
  else if (buffer?.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) sniffedMime = "image/gif";
  else if (buffer?.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") sniffedMime = "image/webp";
  else {
    const head = buffer?.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart().toLowerCase() || "";
    if (head.startsWith("<svg") || head.includes("<svg")) sniffedMime = "image/svg+xml";
    else if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<script")) sniffedMime = "text/html";
  }
  const finalMime = sniffedMime || cleanString(browserMime, "") || extensionMime || "application/octet-stream";
  const mismatch = Boolean(extensionMime && sniffedMime && extensionMime !== sniffedMime);
  const active = ["image/svg+xml", "text/html"].includes(finalMime);
  const image = finalMime.startsWith("image/") && finalMime !== "image/svg+xml";
  return {
    extensionMime,
    browserMime: cleanString(browserMime, ""),
    sniffedMime,
    finalMime,
    mismatch,
    risk: active ? "active_content" : mismatch ? "extension_mismatch" : finalMime === "application/octet-stream" ? "binary_unknown" : "normal",
    kind: image ? "image" : "file",
  };
}

function dispositionForDraft(typeEvidence, staged) {
  if (typeEvidence.risk === "active_content") {
    return {
      disposition: staged ? "staged_file_reference" : "workspace_file_reference",
      reason: "security_policy_blocked",
      capabilityEvidenceState: "profile_declared",
      unsupportedReason: "Active content is staged as a file reference only.",
    };
  }
  return {
    disposition: staged ? "staged_file_reference" : "workspace_file_reference",
    reason: staged ? "staged_reference_supported" : "workspace_reference_supported",
    capabilityEvidenceState: "profile_declared",
  };
}

function draftBase(project, draftId, source, fileName, sizeBytes, typeEvidence) {
  const provider = dispositionForDraft(typeEvidence, true);
  return {
    schemaVersion: 1,
    id: draftId,
    projectId: cleanString(project?.id, ""),
    surfaceId: "codex",
    source,
    kind: typeEvidence.kind,
    originalName: fileName,
    displayName: fileName,
    mimeType: typeEvidence.finalMime,
    sizeBytes,
    createdAt: nowIso(),
    status: "ready",
    preview: { canPreview: false },
    provider,
    typeEvidence,
    workspaceEvidenceKey: evidenceKey("workspace", `${workspaceKind(project)}:${workspaceRoot(project)}`),
    workspaceKind: workspaceKind(project),
    uiProjectionGeneration: 1,
  };
}

function localStagingPaths(root, draftId, fileName) {
  const rootPath = path.join(root, STAGING_ROOT_REL);
  const draftDir = path.join(rootPath, draftId);
  return {
    rootPath,
    draftDir,
    filePath: path.join(draftDir, fileName),
    manifestPath: path.join(draftDir, "manifest.json"),
    stagedRelPath: normalizeSlashes(path.join(STAGING_ROOT_REL, draftId, fileName)),
  };
}

async function ensureLocalStagingRoot(root) {
  const base = path.join(root, ".codex", "review-shell");
  await fs.mkdir(base, { recursive: true });
  const ignorePath = path.join(base, ".gitignore");
  try {
    await fs.writeFile(ignorePath, "attachments/\n", { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

function manifestForDraft(draft, sourcePath, contentKey) {
  return {
    schema: "composer_attachment_draft_manifest@1",
    draftId: draft.id,
    projectId: draft.projectId,
    workspaceEvidenceKey: draft.workspaceEvidenceKey,
    workspaceKind: draft.workspaceKind,
    createdAt: draft.createdAt,
    sourceKind: draft.source,
    stagedRelPath: draft.stagedRelPath || "",
    stagedPathEvidenceKey: draft.stagedPathEvidenceKey || "",
    sourcePathEvidenceKey: sourcePath ? evidenceKey("source-path", sourcePath) : "",
    displayName: draft.displayName,
    mimeType: draft.mimeType,
    sizeBytes: draft.sizeBytes,
    contentEvidenceKey: contentKey,
    previewEvidenceKey: "",
    cleanupState: "active",
    rawExternalPathStored: false,
  };
}

async function writeLocalStagedDraft(project, draft, buffer, sourcePath = "") {
  const root = workspaceRoot(project);
  if (!root) throw new Error("Project workspace root is unavailable.");
  const paths = localStagingPaths(root, draft.id, draft.displayName);
  if (!relativeWithin(root, paths.filePath)) throw new Error("Attachment staging path escaped the workspace root.");
  await ensureLocalStagingRoot(root);
  await fs.mkdir(paths.draftDir, { recursive: true });
  await fs.writeFile(paths.filePath, buffer, { flag: "wx" });
  const contentKey = contentEvidenceKey(draft.id, buffer);
  const stagedDraft = {
    ...draft,
    stagedRelPath: paths.stagedRelPath,
    stagedPathEvidenceKey: evidenceKey("staged-path", paths.stagedRelPath),
    sourcePathEvidenceKey: sourcePath ? evidenceKey("source-path", sourcePath) : "",
    provider: dispositionForDraft(draft.typeEvidence, true),
  };
  await fs.writeFile(paths.manifestPath, `${JSON.stringify(manifestForDraft(stagedDraft, sourcePath, contentKey), null, 2)}\n`, { flag: "wx" });
  return stagedDraft;
}

async function writeBackendStagedDraft(project, draft, buffer, sourcePath, requestWorkspace) {
  if (typeof requestWorkspace !== "function") throw new Error("Workspace backend staging is unavailable.");
  const contentKey = contentEvidenceKey(draft.id, buffer);
  const stagedRelPath = normalizeSlashes(path.join(STAGING_ROOT_REL, draft.id, draft.displayName));
  const stagedDraft = {
    ...draft,
    stagedRelPath,
    stagedPathEvidenceKey: evidenceKey("staged-path", stagedRelPath),
    sourcePathEvidenceKey: sourcePath ? evidenceKey("source-path", sourcePath) : "",
    provider: dispositionForDraft(draft.typeEvidence, true),
  };
  const manifest = manifestForDraft(stagedDraft, sourcePath, contentKey);
  const result = await requestWorkspace(project, "stageAttachment", {
    draftId: stagedDraft.id,
    fileName: stagedDraft.displayName,
    contentBase64: buffer.toString("base64"),
    manifest,
  }, 45_000);
  return {
    ...stagedDraft,
    stagedRelPath: normalizeSlashes(result?.stagedRelPath || stagedDraft.stagedRelPath),
    stagedPathEvidenceKey: evidenceKey("staged-path", result?.stagedRelPath || stagedDraft.stagedRelPath),
  };
}

function workspaceReferenceDraft(project, source, sourcePath, stat, typeEvidence) {
  const root = workspaceRoot(project);
  const rel = relativeWithin(root, sourcePath);
  const draftId = newDraftId();
  const fileName = safeFileName(sourcePath);
  const draft = {
    ...draftBase(project, draftId, source, fileName, stat.size, typeEvidence),
    workspaceRelPath: rel,
    sourcePathEvidenceKey: evidenceKey("source-path", sourcePath),
    provider: dispositionForDraft(typeEvidence, false),
  };
  return draft;
}

async function stageBuffer(project, source, fileName, buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error("Attachment content is unavailable.");
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`Attachment exceeds ${MAX_FILE_BYTES} bytes.`);
  const typeEvidence = sniffMime(buffer.subarray(0, Math.min(buffer.length, 4096)), fileName, options.mimeType || "");
  if (typeEvidence.finalMime === "image/svg+xml") typeEvidence.kind = "file";
  const draftId = newDraftId();
  const draft = draftBase(project, draftId, source, safeFileName(fileName, "attachment"), buffer.length, typeEvidence);
  if (workspaceKind(project) === "wsl") {
    return writeBackendStagedDraft(project, draft, buffer, options.sourcePath || "", options.requestWorkspace);
  }
  return writeLocalStagedDraft(project, draft, buffer, options.sourcePath || "");
}

async function stagePath(project, sourcePath, source, requestWorkspace) {
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) throw new Error("Directory attachments are unsupported in v0.");
  if (!stat.isFile()) throw new Error("Only files can be attached.");
  if (stat.size > MAX_FILE_BYTES) throw new Error(`Attachment exceeds ${MAX_FILE_BYTES} bytes.`);
  const root = workspaceRoot(project);
  const workspaceRel = root && relativeWithin(root, sourcePath);
  const head = await readHead(sourcePath);
  const typeEvidence = sniffMime(head, sourcePath, "");
  if (workspaceRel != null && workspaceKind(project) !== "wsl") {
    return workspaceReferenceDraft(project, source, sourcePath, stat, typeEvidence);
  }
  const buffer = await fs.readFile(sourcePath);
  return stageBuffer(project, source, sourcePath, buffer, { sourcePath, requestWorkspace });
}

async function readHead(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function stagePaths(project, sourcePaths, source, requestWorkspace) {
  const paths = Array.from(new Set((Array.isArray(sourcePaths) ? sourcePaths : []).map((item) => cleanString(item, "")).filter(Boolean)));
  if (paths.length > MAX_ATTACHMENT_COUNT) throw new Error(`At most ${MAX_ATTACHMENT_COUNT} attachments can be staged at once.`);
  let total = 0;
  const stats = [];
  for (const filePath of paths) {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) throw new Error(paths.length > 1 ? "Mixed file/directory drops are unsupported in v0." : "Directory attachments are unsupported in v0.");
    total += stat.size;
    if (total > MAX_TOTAL_BYTES) throw new Error(`Attachment selection exceeds ${MAX_TOTAL_BYTES} bytes.`);
    stats.push({ filePath, stat });
  }
  const attachments = [];
  const diagnostics = [];
  for (const { filePath } of stats) {
    try {
      attachments.push(await stagePath(project, filePath, source, requestWorkspace));
    } catch (error) {
      diagnostics.push({ pathEvidenceKey: evidenceKey("source-path", filePath), error: error.message });
    }
  }
  return { ok: true, attachments, diagnostics };
}

async function stageClipboardImage(project, imageBuffer, size, requestWorkspace) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) throw new Error("Clipboard does not contain an image.");
  const width = Number(size?.width || 0);
  const height = Number(size?.height || 0);
  if (width > 0 && height > 0 && width * height > MAX_IMAGE_PIXELS) {
    throw new Error("Clipboard image exceeds decoded pixel limits.");
  }
  const draft = await stageBuffer(project, "clipboard_image", `clipboard-image-${Date.now()}.png`, imageBuffer, {
    mimeType: "image/png",
    requestWorkspace,
  });
  return {
    ok: true,
    attachments: [{
      ...draft,
      kind: "image",
      preview: { canPreview: false, width, height },
    }],
    diagnostics: [],
  };
}

async function removeDraft(project, draftId, requestWorkspace) {
  const cleanDraftId = cleanString(draftId, "");
  if (!/^att_[a-z0-9]+$/i.test(cleanDraftId)) throw new Error("Invalid attachment draft id.");
  if (workspaceKind(project) === "wsl") {
    if (typeof requestWorkspace !== "function") throw new Error("Workspace backend cleanup is unavailable.");
    await requestWorkspace(project, "removeAttachmentDraft", { draftId: cleanDraftId }, 10_000);
    return { ok: true, draftId: cleanDraftId };
  }
  const root = workspaceRoot(project);
  const draftDir = path.join(root, STAGING_ROOT_REL, cleanDraftId);
  if (!relativeWithin(root, draftDir)) throw new Error("Attachment cleanup path escaped the workspace root.");
  await fs.rm(draftDir, { recursive: true, force: true });
  return { ok: true, draftId: cleanDraftId };
}

function attachmentReferenceLines(attachments = []) {
  const lines = [];
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (!attachment || attachment.status !== "ready") continue;
    const rel = cleanString(attachment.workspaceRelPath || attachment.stagedRelPath, "");
    if (!rel) continue;
    const disposition = cleanString(attachment.provider?.disposition, "staged_file_reference");
    lines.push(`- ${attachment.displayName} (${attachment.mimeType || "application/octet-stream"}, ${attachment.sizeBytes || 0} bytes): ${rel} [${disposition}]`);
  }
  return lines;
}

function buildAttachmentReferenceBlock(attachments = []) {
  const lines = attachmentReferenceLines(attachments);
  if (!lines.length) return "";
  return ["", "Attachments staged as workspace references:", ...lines].join("\n");
}

module.exports = {
  STAGING_ROOT_REL,
  stagePaths,
  stageClipboardImage,
  removeDraft,
  buildAttachmentReferenceBlock,
};
