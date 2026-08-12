"use strict";

const {
  scanToolResultTextForSecrets,
} = require("../tools/read-only-authority");

const MAX_REPOSITORY_TOOL_OUTPUT_CHARS = 48 * 1024;
const MAX_REPOSITORY_READ_BYTES = 48 * 1024;
const MAX_REPOSITORY_LIST_ENTRIES = 200;
const MAX_REPOSITORY_MATCH_PATTERNS = 8;
const MAX_REPOSITORY_SEARCH_RESULTS = 120;
const SENSITIVE_REPOSITORY_PATH_PATTERNS = Object.freeze([
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)(?:\.npmrc|\.pypirc|\.netrc)$/i,
  /(?:^|\/)(?:secrets?|credentials?)(?:\.[^/]*)?$/i,
  /(?:^|\/)(?:id_rsa|id_ed25519)$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /(?:^|\/)\.ssh(?:\/|$)/i,
]);

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedText(value, limit = MAX_REPOSITORY_TOOL_OUTPUT_CHARS) {
  const text = typeof value === "string" ? value : "";
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeRepositoryRelativePath(value, options = {}) {
  const text = normalizeString(value, options.allowEmpty ? "" : "").replace(/\\/g, "/");
  if ((!text && !options.allowEmpty) || text.startsWith("/") || /^[A-Za-z]:\//.test(text) || text.includes("://")) {
    throw codedError("direct_workspace_worker_path_invalid", "Workspace worker tools require a contained project-relative path.");
  }
  const relativePath = text.replace(/^\.\/+/, "").replace(/\/+$/, "");
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".") || /[\0-\x1f\x7f]/.test(relativePath)) {
    throw codedError("direct_workspace_worker_path_invalid", "Workspace worker path traversal or control characters are forbidden.");
  }
  if (parts.some((part) => part.toLowerCase() === ".git")) {
    throw codedError("direct_workspace_worker_git_metadata_forbidden", "Workspace worker tools cannot address private Git realization metadata.");
  }
  if (SENSITIVE_REPOSITORY_PATH_PATTERNS.some((pattern) => pattern.test(parts.join("/")))) {
    throw codedError("direct_workspace_worker_sensitive_path_forbidden", "Workspace worker tools cannot address sensitive repository paths.");
  }
  return parts.join("/");
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function repositoryToolSchemas() {
  return {
    inspect_repository: {
      type: "function",
      name: "inspect_repository",
      description: "Inspect the bounded Git-canonical repository manifest and inherited repository policy without exposing a native root.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    list_files: {
      type: "function",
      name: "list_files",
      description: "List tracked or non-ignored untracked files from the Git-canonical manifest under an optional project-relative prefix.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional project-relative directory prefix." },
          limit: { type: "number", description: `Maximum entries, capped at ${MAX_REPOSITORY_LIST_ENTRIES}.` },
        },
        additionalProperties: false,
      },
    },
    match_files: {
      type: "function",
      name: "match_files",
      description: "Match bounded glob patterns only against the Git-canonical repository manifest.",
      parameters: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            items: { type: "string" },
            description: `One through ${MAX_REPOSITORY_MATCH_PATTERNS} bounded project-relative glob patterns.`,
          },
          limit: { type: "number", description: `Maximum entries, capped at ${MAX_REPOSITORY_LIST_ENTRIES}.` },
        },
        required: ["patterns"],
        additionalProperties: false,
      },
    },
    search_text: {
      type: "function",
      name: "search_text",
      description: "Search for one literal text string in bounded UTF-8 files from the Git-canonical manifest. Regular expressions are not accepted.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Literal text, 1 through 256 characters." },
          path: { type: "string", description: "Optional project-relative directory or file prefix." },
          case_sensitive: { type: "boolean" },
          max_results: { type: "number", description: `Maximum matches, capped at ${MAX_REPOSITORY_SEARCH_RESULTS}.` },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    read_file: {
      type: "function",
      name: "read_file",
      description: "Read one bounded UTF-8 file admitted by the Git-canonical manifest, by project-relative path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path inside this worker's bound repository." },
          max_bytes: { type: "number", description: `Maximum bytes, capped at ${MAX_REPOSITORY_READ_BYTES}.` },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  };
}

function assertBinding(raw, contract) {
  if (normalizeString(raw?.workspaceBindingDigest, "") !== contract.binding.bindingDigest) {
    throw codedError(
      "direct_workspace_worker_repository_binding_drift",
      "Repository tool evidence is not bound to the frozen workspace constitution.",
    );
  }
}

function safeEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice(0, MAX_REPOSITORY_LIST_ENTRIES).map((entry) => ({
    path: safeRepositoryRelativePath(entry?.path || entry?.relPath),
    size: Math.max(0, Number(entry?.size || 0) || 0),
    tracked: entry?.tracked === true,
  }));
}

function boundedProviderEvidenceJson(value, options = {}) {
  const limit = Math.max(1024, Number(options.limit || MAX_REPOSITORY_TOOL_OUTPUT_CHARS) || MAX_REPOSITORY_TOOL_OUTPUT_CHARS);
  const candidate = JSON.parse(JSON.stringify(value));
  let text = JSON.stringify(candidate);
  if (text.length > limit) {
    candidate.evidenceTruncated = true;
    candidate.truncationReason = "provider_output_char_limit";
    if (Object.prototype.hasOwnProperty.call(candidate, "truncated")) candidate.truncated = true;
    let omittedRows = 0;
    for (const key of ["matches", "entries", "topLevelEntries", "files"]) {
      if (!Array.isArray(candidate[key])) continue;
      while (candidate[key].length && JSON.stringify(candidate).length > limit) {
        candidate[key].pop();
        omittedRows += 1;
      }
      if (key === "matches" || key === "entries") candidate.returned = candidate[key].length;
    }
    if (omittedRows) candidate.evidenceOmittedRows = omittedRows;
    text = JSON.stringify(candidate);
    for (const key of ["text", "stdout", "stderr"]) {
      if (text.length <= limit || typeof candidate[key] !== "string") continue;
      const originalText = candidate[key];
      let low = 0;
      let high = originalText.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        candidate[key] = `${originalText.slice(0, middle)}${middle < originalText.length ? "…" : ""}`;
        candidate[`${key}Truncated`] = middle < originalText.length;
        if (JSON.stringify(candidate).length <= limit) low = middle;
        else high = middle - 1;
      }
      candidate[key] = `${originalText.slice(0, low)}${low < originalText.length ? "…" : ""}`;
      candidate[`${key}Truncated`] = low < originalText.length;
      if (Object.prototype.hasOwnProperty.call(candidate, "truncated")) candidate.truncated = true;
      text = JSON.stringify(candidate);
    }
    if (text.length > limit) {
      text = JSON.stringify({
        kind: normalizeString(candidate.kind, "workspace_tool_result"),
        evidenceTruncated: true,
        truncated: true,
        truncationReason: "provider_output_char_limit",
        rawWorkspacePathIncluded: false,
      });
    }
  }
  const scan = scanToolResultTextForSecrets(text);
  if (scan.status === "blocked") {
    throw codedError(
      normalizeString(options.redactionErrorCode, "direct_workspace_worker_repository_result_redaction_failed"),
      normalizeString(options.redactionMessage, "Workspace tool evidence contained auth-like material and was withheld."),
    );
  }
  return text;
}

async function executeWorkspaceRepositoryTool(input = {}) {
  const { toolName, args = {}, contract, provisioned } = input;
  const bindingDigest = contract.binding.bindingDigest;
  if (toolName === "inspect_repository") {
    const raw = await provisioned.workspaceRequest("inspectWorkspaceRepository", { bindingDigest }, 30_000);
    assertBinding(raw, contract);
    const providerOutput = {
      kind: "inspect_repository_result",
      gitCanonical: raw?.gitCanonical === true,
      manifestDigest: normalizeString(raw?.manifestDigest, ""),
      fileCount: Math.max(0, Number(raw?.fileCount || 0) || 0),
      trackedFileCount: Math.max(0, Number(raw?.trackedFileCount || 0) || 0),
      untrackedFileCount: Math.max(0, Number(raw?.untrackedFileCount || 0) || 0),
      topLevelEntries: (Array.isArray(raw?.topLevelEntries) ? raw.topLevelEntries : []).slice(0, 80).map(String),
      repositoryPolicy: {
        profileId: normalizeString(raw?.repositoryPolicy?.profileId, "unprofiled_repository"),
        validationPosture: normalizeString(raw?.repositoryPolicy?.validationPosture, "unprofiled"),
        selectedConstraints: (Array.isArray(raw?.repositoryPolicy?.selectedConstraints)
          ? raw.repositoryPolicy.selectedConstraints : []).slice(0, 16).map(String),
      },
      manifestTruncated: raw?.manifestTruncated === true,
      rawWorkspacePathIncluded: false,
    };
    return {
      summary: `${providerOutput.fileCount} canonical files · ${providerOutput.repositoryPolicy.profileId}`,
      providerOutputText: boundedProviderEvidenceJson(providerOutput),
    };
  }
  if (toolName === "list_files") {
    const prefix = safeRepositoryRelativePath(args.path || args.prefix || "", { allowEmpty: true });
    const limit = boundedInteger(args.limit, 100, 1, MAX_REPOSITORY_LIST_ENTRIES);
    const raw = await provisioned.workspaceRequest("listWorkspaceRepositoryFiles", { bindingDigest, prefix, limit }, 30_000);
    assertBinding(raw, contract);
    const entries = safeEntries(raw?.entries);
    const providerOutput = {
      kind: "list_files_result",
      prefix,
      entries,
      returned: entries.length,
      totalMatches: Math.max(entries.length, Number(raw?.totalMatches || 0) || 0),
      truncated: raw?.truncated === true,
      manifestDigest: normalizeString(raw?.manifestDigest, ""),
      rawWorkspacePathIncluded: false,
    };
    return {
      summary: `${entries.length} file${entries.length === 1 ? "" : "s"}${providerOutput.truncated ? " · truncated" : ""}`,
      providerOutputText: boundedProviderEvidenceJson(providerOutput),
    };
  }
  if (toolName === "match_files") {
    const patterns = (Array.isArray(args.patterns) ? args.patterns : []).map((entry) => normalizeString(entry, ""));
    if (!patterns.length || patterns.length > MAX_REPOSITORY_MATCH_PATTERNS || patterns.some((entry) => !entry || entry.length > 256)) {
      throw codedError("direct_workspace_worker_match_patterns_invalid", "Workspace worker match patterns exceed the bounded grammar.");
    }
    for (const pattern of patterns) safeRepositoryRelativePath(pattern.replace(/[?*]+/g, "x"));
    const limit = boundedInteger(args.limit, 100, 1, MAX_REPOSITORY_LIST_ENTRIES);
    const raw = await provisioned.workspaceRequest("matchWorkspaceRepositoryFiles", { bindingDigest, patterns, limit }, 30_000);
    assertBinding(raw, contract);
    const entries = safeEntries(raw?.entries);
    const providerOutput = {
      kind: "match_files_result",
      patterns,
      entries,
      returned: entries.length,
      totalMatches: Math.max(entries.length, Number(raw?.totalMatches || 0) || 0),
      truncated: raw?.truncated === true,
      manifestDigest: normalizeString(raw?.manifestDigest, ""),
      rawWorkspacePathIncluded: false,
    };
    return {
      summary: `${entries.length} matching file${entries.length === 1 ? "" : "s"}${providerOutput.truncated ? " · truncated" : ""}`,
      providerOutputText: boundedProviderEvidenceJson(providerOutput),
    };
  }
  if (toolName === "search_text") {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query || query.length > 256 || /[\0\r\n]/.test(query)) {
      throw codedError("direct_workspace_worker_search_query_invalid", "Workspace worker search requires one bounded single-line literal query.");
    }
    const prefix = safeRepositoryRelativePath(args.path || args.prefix || "", { allowEmpty: true });
    const maxResults = boundedInteger(args.max_results || args.maxResults, 60, 1, MAX_REPOSITORY_SEARCH_RESULTS);
    const raw = await provisioned.workspaceRequest("searchWorkspaceRepositoryText", {
      bindingDigest,
      query,
      prefix,
      caseSensitive: args.case_sensitive === true || args.caseSensitive === true,
      maxResults,
    }, 45_000);
    assertBinding(raw, contract);
    const matches = (Array.isArray(raw?.matches) ? raw.matches : []).slice(0, MAX_REPOSITORY_SEARCH_RESULTS).map((match) => ({
      path: safeRepositoryRelativePath(match?.path || match?.relPath),
      line: Math.max(1, Number(match?.line || 1) || 1),
      column: Math.max(1, Number(match?.column || 1) || 1),
      text: boundedText(String(match?.text || ""), 500),
    }));
    const providerOutput = {
      kind: "search_text_result",
      query,
      prefix,
      caseSensitive: args.case_sensitive === true || args.caseSensitive === true,
      matches,
      returned: matches.length,
      filesScanned: Math.max(0, Number(raw?.filesScanned || 0) || 0),
      bytesScanned: Math.max(0, Number(raw?.bytesScanned || 0) || 0),
      truncated: raw?.truncated === true,
      manifestDigest: normalizeString(raw?.manifestDigest, ""),
      rawWorkspacePathIncluded: false,
    };
    return {
      summary: `${matches.length} literal match${matches.length === 1 ? "" : "es"}${providerOutput.truncated ? " · truncated" : ""}`,
      providerOutputText: boundedProviderEvidenceJson(providerOutput),
    };
  }
  if (toolName === "read_file") {
    const relPath = safeRepositoryRelativePath(args.path || args.relPath);
    const maxBytes = boundedInteger(args.max_bytes || args.maxBytes, MAX_REPOSITORY_READ_BYTES, 1, MAX_REPOSITORY_READ_BYTES);
    const raw = await provisioned.workspaceRequest("readWorkspaceRepositoryFile", {
      bindingDigest,
      relPath,
      maxBytes,
    }, 30_000);
    assertBinding(raw, contract);
    const providerOutput = {
      kind: "read_file_result",
      path: safeRepositoryRelativePath(raw?.relPath || relPath),
      text: boundedText(raw?.text, MAX_REPOSITORY_TOOL_OUTPUT_CHARS),
      size: Math.max(0, Number(raw?.size || 0) || 0),
      truncated: raw?.truncated === true,
      binary: false,
      manifestDigest: normalizeString(raw?.manifestDigest, ""),
      rawWorkspacePathIncluded: false,
    };
    return {
      summary: `${providerOutput.path} · ${providerOutput.size} bytes${providerOutput.truncated ? " · truncated" : ""}`,
      providerOutputText: boundedProviderEvidenceJson(providerOutput),
    };
  }
  return null;
}

module.exports = {
  MAX_REPOSITORY_LIST_ENTRIES,
  MAX_REPOSITORY_MATCH_PATTERNS,
  MAX_REPOSITORY_READ_BYTES,
  MAX_REPOSITORY_SEARCH_RESULTS,
  boundedProviderEvidenceJson,
  executeWorkspaceRepositoryTool,
  repositoryToolSchemas,
  safeRepositoryRelativePath,
};
