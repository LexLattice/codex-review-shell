"use strict";

const crypto = require("node:crypto");

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function newId(prefix = "meta") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function normalizeId(value, fallbackPrefix = "meta") {
  const text = normalizeString(value, "");
  if (SAFE_ID_PATTERN.test(text)) return text;
  return newId(fallbackPrefix);
}

function isSafeId(value) {
  return SAFE_ID_PATTERN.test(normalizeString(value, ""));
}

function requireSafeId(value, label = "value") {
  const text = normalizeString(value, "");
  if (isSafeId(text)) return text;
  throw new Error(`Invalid ${label} id.`);
}

function safeSlotPart(value, fallback = "artifact") {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  SAFE_ID_PATTERN,
  asArray,
  isPlainObject,
  isSafeId,
  newId,
  normalizeId,
  normalizeString,
  nowIso,
  requireSafeId,
  safeSlotPart,
};
