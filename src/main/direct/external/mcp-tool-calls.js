"use strict";

// Configured MCP server tools offered to the model as functions, as Codex
// does: one function per tool (`mcp__<server>__<tool>`), the server's input
// schema cut down to what the Responses API accepts, Codex's rule for when a
// call needs the owner's approval, and the call result turned into the
// function output the model sees.

const crypto = require("node:crypto");

const MCP_TOOL_PREFIX = "mcp__";
const MCP_TOOL_DELIMITER = "__";
// Responses API function names: [A-Za-z0-9_-], at most 64 characters.
const MAX_FUNCTION_NAME_CHARS = 64;
const MAX_MCP_TOOLS_PER_TURN = 128;
const MAX_TOOL_DESCRIPTION_CHARS = 1_024;
const MAX_TOOL_OUTPUT_CHARS = 64_000;
const MAX_TOOL_IMAGES = 4;
const MAX_IMAGE_BASE64_CHARS = 2_000_000;
const MAX_SCHEMA_BYTES = 16 * 1024;
// Codex keeps only these keywords when it hands an MCP schema to the model.
const KEPT_SCHEMA_KEYWORDS = new Set([
  "$ref", "type", "description", "enum", "items", "minItems", "properties", "required",
  "additionalProperties", "anyOf", "oneOf", "allOf", "$defs", "definitions",
]);
const MCP_TOOL_APPROVAL_KIND = "mcp_tool_call";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sanitizeNamePart(value) {
  const text = String(value ?? "").replace(/[^A-Za-z0-9_]/g, "_");
  return text || "_";
}

function isMcpToolFunctionName(name) {
  return typeof name === "string" && name.startsWith(MCP_TOOL_PREFIX);
}

// Keeps only the schema keywords Codex keeps, with object roots that always
// have `properties`. Boolean schemas become strings and `const` becomes an
// enum, as Codex does; past the size limit, descriptions go first.
function sanitizeMcpToolSchema(inputSchema) {
  const visit = (node, depth) => {
    if (node === true || node === false) return { type: "string" };
    if (!isPlainObject(node) || depth > 12) return {};
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "const") {
        out.enum = [value];
        continue;
      }
      if (!KEPT_SCHEMA_KEYWORDS.has(key)) continue;
      if (key === "properties" || key === "$defs" || key === "definitions") {
        if (!isPlainObject(value)) continue;
        out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child, depth + 1)]));
      } else if (key === "items") {
        out.items = Array.isArray(value) ? visit(value[0], depth + 1) : visit(value, depth + 1);
      } else if (key === "anyOf" || key === "oneOf" || key === "allOf") {
        if (Array.isArray(value)) out[key] = value.map((child) => visit(child, depth + 1));
      } else if (key === "additionalProperties") {
        out.additionalProperties = typeof value === "boolean" ? value : visit(value, depth + 1);
      } else if (key === "required") {
        if (Array.isArray(value)) out.required = value.filter((entry) => typeof entry === "string");
      } else if (key === "enum") {
        if (Array.isArray(value)) out.enum = value;
      } else {
        out[key] = value;
      }
    }
    if (!out.type && !out.$ref && !out.anyOf && !out.oneOf && !out.allOf && !out.enum) {
      if (out.properties) out.type = "object";
      else if (out.items) out.type = "array";
    }
    if (out.type === "object" && !isPlainObject(out.properties)) out.properties = {};
    if (out.type === "array" && !out.items) out.items = { type: "string" };
    return out;
  };
  let schema = visit(isPlainObject(inputSchema) ? inputSchema : { type: "object" }, 0);
  if (schema.type !== "object") schema = { type: "object", properties: {} };
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > MAX_SCHEMA_BYTES) {
    const strip = (node) => {
      if (Array.isArray(node)) return node.map(strip);
      if (!isPlainObject(node)) return node;
      return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "description").map(([key, value]) => [key, strip(value)]));
    };
    schema = strip(schema);
    if (Buffer.byteLength(JSON.stringify(schema), "utf8") > MAX_SCHEMA_BYTES) return null;
  }
  return schema;
}

function annotationsOf(tool = {}) {
  const source = isPlainObject(tool.annotations) ? tool.annotations : {};
  const flag = (key) => (typeof source[key] === "boolean" ? source[key] : undefined);
  return {
    readOnlyHint: flag("readOnlyHint"),
    destructiveHint: flag("destructiveHint"),
    openWorldHint: flag("openWorldHint"),
    title: normalizeString(source.title, ""),
  };
}

// Codex's "auto" approval mode for an MCP tool: a destructive tool always
// asks, a read-only one never does, and a tool that says nothing is treated
// as destructive and open-world.
function mcpToolNeedsApproval(annotations = {}, mode = "auto") {
  // Codex's per-tool approval_mode (default_tools_approval_mode otherwise).
  if (mode === "prompt") return true;
  if (mode === "approve") return false;
  if (mode === "writes") return annotations.readOnlyHint !== true;
  if (annotations.destructiveHint === true) return true;
  if (annotations.readOnlyHint === true) return false;
  return (annotations.destructiveHint ?? true) || (annotations.openWorldHint ?? true);
}

// One function per (server, tool). Names are sanitized; a name that collides
// or runs past 64 characters gets a short hash of its raw identity instead
// of its tail, so the same tool keeps the same name.
function buildMcpToolCatalog(servers = []) {
  const candidates = [];
  const seenRaw = new Set();
  for (const server of Array.isArray(servers) ? servers : []) {
    const serverIdentityId = normalizeString(server?.serverIdentityId, "");
    if (!serverIdentityId) continue;
    const serverName = normalizeString(server.serverName || server.displayName, serverIdentityId);
    for (const tool of Array.isArray(server.tools) ? server.tools : []) {
      const toolName = normalizeString(tool?.name, "");
      const raw = `${serverIdentityId}\u0000${toolName}`;
      if (!toolName || seenRaw.has(raw)) continue;
      seenRaw.add(raw);
      const parameters = sanitizeMcpToolSchema(tool.inputSchema);
      if (!parameters) continue;
      const modes = isPlainObject(server.toolApprovalModes) ? server.toolApprovalModes : {};
      candidates.push({
        raw,
        base: `${MCP_TOOL_PREFIX}${sanitizeNamePart(serverName)}${MCP_TOOL_DELIMITER}${sanitizeNamePart(toolName)}`,
        serverIdentityId,
        serverName,
        toolName,
        description: normalizeString(tool.description, "").slice(0, MAX_TOOL_DESCRIPTION_CHARS),
        parameters,
        annotations: annotationsOf(tool),
        approvalMode: normalizeString(modes[toolName], normalizeString(server.defaultToolsApprovalMode, "auto")),
        serverParallel: server.supportsParallelToolCalls === true,
      });
    }
  }
  candidates.sort((a, b) => a.raw.localeCompare(b.raw));
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.base, (counts.get(candidate.base) || 0) + 1);
  const used = new Set();
  const entries = [];
  for (const candidate of candidates.slice(0, MAX_MCP_TOOLS_PER_TURN)) {
    let name = candidate.base;
    if (counts.get(name) > 1 || name.length > MAX_FUNCTION_NAME_CHARS || used.has(name)) {
      const suffix = `_${sha1(candidate.raw).slice(0, 12)}`;
      name = `${candidate.base.slice(0, MAX_FUNCTION_NAME_CHARS - suffix.length)}${suffix}`;
    }
    if (used.has(name)) continue;
    used.add(name);
    const { raw, base, serverParallel, ...entry } = candidate;
    entries.push({
      functionName: name,
      ...entry,
      readOnly: entry.annotations.readOnlyHint === true,
      // As in Codex: read-only tools, or every tool of a server that says
      // it handles parallel calls.
      parallel: entry.annotations.readOnlyHint === true || serverParallel,
      needsApproval: mcpToolNeedsApproval(entry.annotations, entry.approvalMode),
      schemaDigest: sha256(JSON.stringify(entry.parameters)).slice(0, 32),
    });
  }
  return { schema: "direct_mcp_tool_catalog@1", entries };
}

function mcpToolDeclaration(entry = {}) {
  const title = entry.annotations?.title ? `${entry.annotations.title}. ` : "";
  return {
    type: "function",
    name: entry.functionName,
    description: `${title}${entry.description || `Tool "${entry.toolName}" from the ${entry.serverName} MCP server.`}`.slice(0, MAX_TOOL_DESCRIPTION_CHARS),
    strict: false,
    parameters: entry.parameters,
  };
}

function contentItemText(item = {}) {
  if (item.type === "text" && typeof item.text === "string") return item.text;
  return JSON.stringify(item);
}

// Codex's conversion of a CallToolResult: structuredContent (as JSON) when
// present, otherwise the content blocks; images go back as input_image items
// and audio is left out (the model takes no audio input here). The text
// starts with the wall time, as Codex's output does.
function mcpToolResultOutput(result = {}, options = {}) {
  const seconds = (Math.max(0, Number(options.durationMs) || 0) / 1000).toFixed(1);
  const header = `Wall time: ${seconds} seconds\nOutput:\n`;
  const clip = (text) => (text.length > MAX_TOOL_OUTPUT_CHARS
    ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[… ${text.length - MAX_TOOL_OUTPUT_CHARS} more characters truncated]`
    : text);
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    const text = clip(JSON.stringify(result.structuredContent));
    return { text: `${header}${text}`, contentItems: null, isError: result.isError === true };
  }
  const blocks = Array.isArray(result.content) ? result.content : [];
  const texts = [];
  const images = [];
  for (const block of blocks) {
    if (!isPlainObject(block)) continue;
    if (block.type === "image" && typeof block.data === "string" && images.length < MAX_TOOL_IMAGES &&
        block.data.length <= MAX_IMAGE_BASE64_CHARS && /^image\/[A-Za-z0-9.+-]+$/.test(String(block.mimeType || ""))) {
      images.push({ type: "input_image", image_url: `data:${block.mimeType};base64,${block.data}`, detail: "high" });
      continue;
    }
    if (block.type === "image") {
      texts.push("[image omitted: unsupported or too large]");
      continue;
    }
    if (block.type === "audio") {
      texts.push("[audio omitted: this model does not take audio input]");
      continue;
    }
    texts.push(contentItemText(block));
  }
  const text = `${header}${clip(texts.join("\n"))}`;
  return {
    text,
    contentItems: images.length ? [{ type: "input_text", text }, ...images] : null,
    isError: result.isError === true,
  };
}

// The owner's answer to a server's form, checked against its schema the way
// Codex's typed form schema does: known fields only, the right types
// (numbers and booleans coerced from form strings), required fields present.
function validateElicitationContent(requestedSchema = {}, content = {}) {
  const properties = isPlainObject(requestedSchema?.properties) ? requestedSchema.properties : {};
  const required = Array.isArray(requestedSchema?.required) ? requestedSchema.required : [];
  const source = isPlainObject(content) ? content : {};
  const out = {};
  for (const [name, value] of Object.entries(source)) {
    const field = properties[name];
    if (!isPlainObject(field)) return { ok: false, error: `Unknown field "${name}".` };
    if (value === undefined || value === null || value === "") continue;
    const type = field.type || (Array.isArray(field.enum) || Array.isArray(field.oneOf) ? "string" : "string");
    if (type === "boolean") {
      if (typeof value === "boolean") out[name] = value;
      else if (value === "true" || value === "false") out[name] = value === "true";
      else return { ok: false, error: `"${name}" must be true or false.` };
    } else if (type === "number" || type === "integer") {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number) || (type === "integer" && !Number.isInteger(number))) {
        return { ok: false, error: `"${name}" must be ${type === "integer" ? "a whole number" : "a number"}.` };
      }
      if (typeof field.minimum === "number" && number < field.minimum) return { ok: false, error: `"${name}" must be at least ${field.minimum}.` };
      if (typeof field.maximum === "number" && number > field.maximum) return { ok: false, error: `"${name}" must be at most ${field.maximum}.` };
      out[name] = number;
    } else if (type === "array") {
      const list = Array.isArray(value) ? value.map(String) : [String(value)];
      const allowed = enumValues(field.items);
      if (allowed.length && list.some((entry) => !allowed.includes(entry))) return { ok: false, error: `"${name}" has a value that isn't offered.` };
      if (typeof field.minItems === "number" && list.length < field.minItems) return { ok: false, error: `"${name}" needs at least ${field.minItems} choices.` };
      if (typeof field.maxItems === "number" && list.length > field.maxItems) return { ok: false, error: `"${name}" takes at most ${field.maxItems} choices.` };
      out[name] = list;
    } else {
      const text = String(value);
      const allowed = enumValues(field);
      if (allowed.length && !allowed.includes(text)) return { ok: false, error: `"${name}" must be one of the offered values.` };
      if (typeof field.minLength === "number" && text.length < field.minLength) return { ok: false, error: `"${name}" is too short.` };
      if (typeof field.maxLength === "number" && text.length > field.maxLength) return { ok: false, error: `"${name}" is too long.` };
      out[name] = text;
    }
  }
  for (const name of required) {
    if (!Object.hasOwn(out, name)) return { ok: false, error: `"${name}" is required.` };
  }
  return { ok: true, content: out };
}

function enumValues(field = {}) {
  if (!isPlainObject(field)) return [];
  if (Array.isArray(field.enum)) return field.enum.map(String);
  if (Array.isArray(field.oneOf)) return field.oneOf.map((entry) => entry?.const).filter((value) => value !== undefined).map(String);
  if (Array.isArray(field.anyOf)) return field.anyOf.map((entry) => entry?.const).filter((value) => value !== undefined).map(String);
  return [];
}

function elicitationHasFields(requestedSchema = {}) {
  return isPlainObject(requestedSchema?.properties) && Object.keys(requestedSchema.properties).length > 0;
}

module.exports = {
  MCP_TOOL_APPROVAL_KIND,
  MCP_TOOL_PREFIX,
  buildMcpToolCatalog,
  elicitationHasFields,
  isMcpToolFunctionName,
  mcpToolDeclaration,
  mcpToolNeedsApproval,
  mcpToolResultOutput,
  sanitizeMcpToolSchema,
  validateElicitationContent,
};
