"use strict";

const {
  sameNativePath,
} = require("./native-path-identity");

const SEARCH_OMISSION_KEYS = Object.freeze([
  "fileSizeLimit",
  "fileCountLimit",
  "aggregateByteLimit",
  "readOrRevalidationFailure",
  "invalidUtf8",
  "resultLimit",
]);

function boundedCount(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Math.floor(number), maximum);
}

function pinnedWorkspaceMarkerIsExact(input = {}, platform = process.platform) {
  return input.isSymbolicLink !== true &&
    sameNativePath(input.requestedFullPath, input.resolvedFullPath, platform);
}

function emptyOmissionCounts() {
  return Object.fromEntries(SEARCH_OMISSION_KEYS.map((key) => [key, 0]));
}

function searchOmittedFileCount(counts) {
  return counts.fileSizeLimit + counts.fileCountLimit + counts.aggregateByteLimit +
    counts.readOrRevalidationFailure + counts.invalidUtf8;
}

function stableCaseFoldWithOffsets(value) {
  let folded = "";
  const originalOffsets = [];
  let originalOffset = 0;
  for (const symbol of String(value || "")) {
    const foldedSymbol = symbol.toLowerCase();
    folded += foldedSymbol;
    for (let index = 0; index < foldedSymbol.length; index += 1) {
      originalOffsets.push(originalOffset);
    }
    originalOffset += symbol.length;
  }
  return { folded, originalOffsets };
}

async function searchBoundedWorkspaceRepositoryText(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const query = String(input.query || "");
  const caseSensitive = input.caseSensitive === true;
  const needle = caseSensitive ? query : stableCaseFoldWithOffsets(query).folded;
  const maxResults = Math.max(1, boundedCount(input.maxResults, Number.MAX_SAFE_INTEGER));
  const fileLimit = Math.max(1, boundedCount(input.fileLimit, Number.MAX_SAFE_INTEGER));
  const fileByteLimit = Math.max(1, boundedCount(input.fileByteLimit, Number.MAX_SAFE_INTEGER));
  const totalByteLimit = Math.max(1, boundedCount(input.totalByteLimit, Number.MAX_SAFE_INTEGER));
  if (!query || typeof input.readEntry !== "function" || typeof input.looksBinary !== "function" ||
      typeof input.decodeUtf8 !== "function") {
    throw new TypeError("workspace_repository_search_boundary_invalid");
  }

  const omissionCounts = emptyOmissionCounts();
  const sizeEligible = [];
  for (const entry of entries) {
    if (boundedCount(entry?.size) > fileByteLimit) omissionCounts.fileSizeLimit += 1;
    else sizeEligible.push(entry);
  }
  if (sizeEligible.length > fileLimit) omissionCounts.fileCountLimit = sizeEligible.length - fileLimit;
  const candidates = sizeEligible.slice(0, fileLimit);
  const matches = [];
  let filesAttempted = 0;
  let filesScanned = 0;
  let bytesScanned = 0;
  let binaryFileCount = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index];
    const remainingBytes = totalByteLimit - bytesScanned;
    const expectedBytes = boundedCount(entry?.size, fileByteLimit);
    if (remainingBytes <= 0 || expectedBytes > remainingBytes) {
      omissionCounts.aggregateByteLimit += candidates.length - index;
      break;
    }

    filesAttempted += 1;
    let read;
    try {
      read = await input.readEntry(entry, Math.min(fileByteLimit, remainingBytes));
    } catch (error) {
      bytesScanned += boundedCount(error?.workspaceWorkerBytesRead, remainingBytes);
      omissionCounts.readOrRevalidationFailure += 1;
      continue;
    }

    if (!Buffer.isBuffer(read?.buffer)) {
      omissionCounts.readOrRevalidationFailure += 1;
      continue;
    }
    if (read.buffer.length > remainingBytes) {
      bytesScanned = totalByteLimit;
      omissionCounts.aggregateByteLimit += candidates.length - index;
      break;
    }
    bytesScanned += read.buffer.length;
    if (read.truncated === true || boundedCount(read.size) !== expectedBytes) {
      omissionCounts.readOrRevalidationFailure += 1;
      continue;
    }
    if (input.looksBinary(read.buffer, { scanEntireBuffer: true })) {
      binaryFileCount += 1;
      continue;
    }

    let decoded;
    try {
      decoded = input.decodeUtf8(read.buffer, { truncated: false });
    } catch {
      omissionCounts.invalidUtf8 += 1;
      continue;
    }
    filesScanned += 1;
    const lines = String(decoded?.text || "").split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const foldedLine = caseSensitive
        ? { folded: lines[lineIndex], originalOffsets: null }
        : stableCaseFoldWithOffsets(lines[lineIndex]);
      const haystack = foldedLine.folded;
      const column = haystack.indexOf(needle);
      if (column < 0) continue;
      const originalColumn = caseSensitive
        ? column
        : foldedLine.originalOffsets[column] ?? lines[lineIndex].length;
      matches.push({
        path: entry.path,
        line: lineIndex + 1,
        column: originalColumn + 1,
        text: lines[lineIndex].slice(0, 500),
      });
      if (matches.length >= maxResults) {
        omissionCounts.resultLimit = 1;
        break;
      }
    }
    if (matches.length >= maxResults) break;
  }

  const incomplete = SEARCH_OMISSION_KEYS.some((key) => omissionCounts[key] > 0);
  return {
    matches,
    filesAttempted,
    filesScanned,
    bytesScanned,
    binaryFileCount,
    omittedFileCount: searchOmittedFileCount(omissionCounts),
    omissionCounts,
    incomplete,
    truncated: incomplete,
  };
}

module.exports = {
  SEARCH_OMISSION_KEYS,
  pinnedWorkspaceMarkerIsExact,
  searchBoundedWorkspaceRepositoryText,
};
