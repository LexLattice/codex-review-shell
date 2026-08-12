"use strict";

const path = require("node:path");

function normalizeNativePathForIdentity(value, platform = process.platform) {
  const source = String(value || "");
  if (!source) return "";
  const implementation = platform === "win32" ? path.win32 : path.posix;
  const resolved = implementation.resolve(source).replace(/[\\/]+$/g, "");
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameNativePath(left, right, platform = process.platform) {
  const normalizedLeft = normalizeNativePathForIdentity(left, platform);
  const normalizedRight = normalizeNativePathForIdentity(right, platform);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
}

module.exports = {
  normalizeNativePathForIdentity,
  sameNativePath,
};
