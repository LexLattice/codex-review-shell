(function registerTypedMarkdownProjection(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CodexTypedMarkdownProjection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTypedMarkdownProjection() {
  function normalizeSlashes(value) {
    return String(value || "").replace(/\\/g, "/");
  }

  function stripTokenPunctuation(value) {
    return String(value || "").replace(/[),.;!?]+$/g, "");
  }

  function safeProjectionContext(context) {
    return context && typeof context === "object" ? context : {};
  }

  function hasStrongFilePathEvidence(filePath) {
    const normalized = normalizeSlashes(stripTokenPunctuation(filePath).trim()).replace(/^\.\/+/, "");
    if (!normalized || normalized.includes("\0") || /\s/.test(normalized)) return false;
    if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return false;
    if (!normalized.includes("/")) return false;
    const tail = normalized.split("/").pop() || "";
    return /^[^./][^/]*\.[A-Za-z0-9]{1,12}$/.test(tail);
  }

  function workspaceRoots(context = {}) {
    const safeContext = safeProjectionContext(context);
    if (typeof safeContext.workspaceRoots === "function") return safeContext.workspaceRoots();
    if (Array.isArray(safeContext.workspaceRoots)) return safeContext.workspaceRoots;
    return [];
  }

  function relativePathWithinRoot(filePath, context = {}) {
    const safeContext = safeProjectionContext(context);
    const raw = stripTokenPunctuation(filePath).trim();
    if (!raw || raw.includes("\0")) return "";
    const normalized = normalizeSlashes(raw);
    if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return "";
    if (/\s/.test(normalized)) return "";

    for (const root of workspaceRoots(safeContext)) {
      const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
      if (!normalizedRoot) continue;
      const lowerPath = normalized.toLowerCase();
      const lowerRoot = normalizedRoot.toLowerCase();
      if (lowerPath === lowerRoot) return "";
      if (lowerPath.startsWith(`${lowerRoot}/`)) {
        const relPath = normalized.slice(normalizedRoot.length + 1);
        return hasStrongFilePathEvidence(relPath) ? relPath : "";
      }
    }

    const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
    if (isAbsolute) return "";
    const relPath = normalized.replace(/^\.\/+/, "");
    return hasStrongFilePathEvidence(relPath) ? relPath : "";
  }

  function splitLineRef(value) {
    const text = stripTokenPunctuation(value).trim();
    const match = text.match(/^(.*?)(?::(\d+)(?::(\d+))?)$/);
    if (!match) return { path: text, line: null, column: null };
    if (/^[A-Za-z]$/.test(match[1])) return { path: text, line: null, column: null };
    return {
      path: match[1],
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : null,
    };
  }

  function fileRefFromTextCandidate(value, context = {}) {
    const safeContext = safeProjectionContext(context);
    const lineRef = splitLineRef(value);
    const relPath = relativePathWithinRoot(lineRef.path, safeContext);
    if (!relPath) return null;
    return {
      path: relPath,
      line: lineRef.line,
      column: lineRef.column,
    };
  }

  function extractFileRefsFromText(value, context = {}) {
    const safeContext = safeProjectionContext(context);
    const source = String(value || "");
    const refs = [];
    const filePattern = /(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/)?[A-Za-z0-9._@+-][A-Za-z0-9._@+:/\\-]*\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?/g;
    for (const match of source.matchAll(filePattern)) {
      const ref = fileRefFromTextCandidate(match[0], safeContext);
      if (ref) refs.push(ref);
    }
    return refs;
  }

  function shouldRenderAmbiguousPathSymbol(value, context = {}) {
    const safeContext = safeProjectionContext(context);
    const raw = stripTokenPunctuation(value).trim();
    if (!raw || /^https?:\/\//i.test(raw) || raw.includes("://") || /\s/.test(raw)) return false;
    const lineRef = splitLineRef(raw);
    if (relativePathWithinRoot(lineRef.path, safeContext)) return false;
    const normalized = normalizeSlashes(lineRef.path).replace(/^\.\/+/, "");
    if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) return false;
    const hasSlash = normalized.includes("/");
    const hasDot = /(?:^|[A-Za-z0-9_-])\.[A-Za-z0-9_-]+/.test(normalized);
    return hasSlash || hasDot;
  }

  function normalizeFileAliasToken(value) {
    return stripTokenPunctuation(value).trim().toLowerCase();
  }

  function isBareVersionToken(value) {
    return /^v\d+(?:\.\d+)+$/i.test(normalizeFileAliasToken(value));
  }

  function fileAliasForToken(value, context = {}) {
    const safeContext = safeProjectionContext(context);
    const key = normalizeFileAliasToken(value);
    if (!key) return null;
    const aliases = safeContext.fileAliases;
    if (aliases instanceof Map) return aliases.get(key) || null;
    if (aliases && typeof aliases === "object") return aliases[key] || null;
    return null;
  }

  function fileFallbackForToken(value, context = {}) {
    const safeContext = safeProjectionContext(context);
    const lineRef = splitLineRef(value);
    const primary = fileRefFromTextCandidate(value, safeContext);
    const candidates = Array.isArray(safeContext.fileEvidenceRefs) ? safeContext.fileEvidenceRefs : [];
    const normalizedPrimary = normalizeSlashes(primary?.path || lineRef.path || "").replace(/^\.\/+/, "");
    if (!normalizedPrimary || isBareVersionToken(normalizedPrimary)) return null;
    if (!normalizedPrimary.includes("/") && !/^[^./][^/]*\.[A-Za-z0-9]{1,12}$/.test(normalizedPrimary)) return null;
    const matches = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const candidatePath = normalizeSlashes(candidate?.path || "").replace(/^\.\/+/, "");
      if (!candidatePath || candidatePath === normalizedPrimary || seen.has(candidatePath)) continue;
      if (candidatePath.endsWith(`/${normalizedPrimary}`)) {
        matches.push(candidatePath);
        seen.add(candidatePath);
      }
    }
    if (matches.length !== 1) return null;
    return {
      path: matches[0],
      line: primary?.line ?? lineRef.line,
      column: primary?.column ?? lineRef.column,
    };
  }

  function addFileAlias(aliases, alias, fileRef) {
    const key = normalizeFileAliasToken(alias);
    if (!key || !fileRef?.path || aliases.has(key)) return;
    aliases.set(key, { ...fileRef });
  }

  function addVersionAliasesForFile(aliases, label, fileRef) {
    const parts = [
      String(label || ""),
      String(fileRef?.path || "").split("/").pop() || "",
    ];
    for (const part of parts) {
      const withoutExtension = part.replace(/\.[A-Za-z0-9]{1,12}$/i, "");
      const versionMatch = withoutExtension.match(/(?:^|[._-])(v\d+(?:[._-]\d+)+)(?:$|[._-])/i);
      if (!versionMatch) continue;
      const version = versionMatch[1];
      addFileAlias(aliases, version, fileRef);
      addFileAlias(aliases, version.replace(/[._-]/g, "."), fileRef);
    }
  }

  function markdownLocalHref(rawHref, context = {}) {
    const safeContext = safeProjectionContext(context);
    const original = String(rawHref || "").trim();
    if (!original || original.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/i.test(original)) return null;
    const lineHash = original.match(/^(.*)#L(\d+)$/i);
    const withoutHash = lineHash ? lineHash[1] : original.replace(/#.*$/, "");
    const lineRef = splitLineRef(lineHash ? `${withoutHash}:${lineHash[2]}` : withoutHash);
    const relPath = relativePathWithinRoot(lineRef.path, safeContext);
    if (!relPath) return fileFallbackForToken(lineRef.path, safeContext);
    const fallbackRef = fileFallbackForToken(lineRef.path, safeContext);
    return {
      path: relPath,
      line: lineRef.line,
      column: lineRef.column,
      fallbackPath: fallbackRef?.path || "",
    };
  }

  function buildMarkdownFileAliasMap(text, context = {}) {
    const safeContext = safeProjectionContext(context);
    const aliases = new Map();
    const source = String(text || "");
    const pattern = /\[([^\]\n]{1,240})\]\(([^) \n]{1,1000})\)/g;
    for (const match of source.matchAll(pattern)) {
      const fileRef = markdownLocalHref(match[2], safeContext);
      if (fileRef) addVersionAliasesForFile(aliases, match[1], fileRef);
    }
    return aliases;
  }

  function addTokenCandidate(candidates, start, end, token) {
    if (start < 0 || end <= start) return;
    candidates.push({ start, end, token });
  }

  function chooseTokenCandidates(candidates) {
    const sorted = candidates
      .filter((candidate) => candidate?.token?.text)
      .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const result = [];
    let cursor = 0;
    for (const candidate of sorted) {
      if (candidate.start < cursor) continue;
      result.push(candidate);
      cursor = candidate.end;
    }
    return result;
  }

  function fileTokenFromRef(text, fileRef) {
    return {
      type: fileRef.line ? "line_ref" : "file_path",
      text,
      path: fileRef.path,
      line: fileRef.line,
      column: fileRef.column,
      fallbackPath: fileRef.fallbackPath || "",
    };
  }

  function tokenizeTypedContent(text, context = {}) {
    const safeContext = safeProjectionContext(context);
    const source = String(text || "");
    if (!source) return [{ type: "text", text: "" }];
    const candidates = [];

    const urlPattern = /https?:\/\/[^\s<>"'`)\]]+/g;
    for (const match of source.matchAll(urlPattern)) {
      const raw = stripTokenPunctuation(match[0]);
      addTokenCandidate(candidates, match.index, match.index + raw.length, { type: "url", text: raw, href: raw });
    }

    const backtickPattern = /`([^`\n]{1,240})`/g;
    for (const match of source.matchAll(backtickPattern)) {
      const raw = match[1] || "";
      const aliasRef = fileAliasForToken(raw, safeContext);
      if (aliasRef) {
        addTokenCandidate(candidates, match.index, match.index + match[0].length, fileTokenFromRef(match[0], aliasRef));
        continue;
      }
      const lineRef = splitLineRef(raw);
      const relPath = relativePathWithinRoot(lineRef.path, safeContext);
      if (relPath && !isBareVersionToken(raw)) {
        const fallbackRef = fileFallbackForToken(raw, safeContext);
        addTokenCandidate(candidates, match.index, match.index + match[0].length, fileTokenFromRef(match[0], {
          path: relPath,
          line: lineRef.line,
          column: lineRef.column,
          fallbackPath: fallbackRef?.path || "",
        }));
        continue;
      }
      const fallbackRef = fileFallbackForToken(raw, safeContext);
      if (fallbackRef) {
        addTokenCandidate(candidates, match.index, match.index + match[0].length, fileTokenFromRef(match[0], fallbackRef));
        continue;
      }
      const type = /\s|^(npm|pnpm|yarn|node|git|gh|cargo|python|pytest|uv|make|bash|sh)\b/.test(raw.trim())
        ? "command"
        : "symbol";
      addTokenCandidate(candidates, match.index, match.index + match[0].length, { type, text: match[0], value: raw });
    }

    const filePattern = /(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/)?[A-Za-z0-9._@+-][A-Za-z0-9._@+:/\\-]*\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?/g;
    for (const match of source.matchAll(filePattern)) {
      const raw = stripTokenPunctuation(match[0]);
      if (!raw || /^https?:\/\//i.test(raw)) continue;
      const aliasRef = fileAliasForToken(raw, safeContext);
      if (aliasRef) {
        addTokenCandidate(candidates, match.index, match.index + raw.length, fileTokenFromRef(raw, aliasRef));
        continue;
      }
      const lineRef = splitLineRef(raw);
      const relPath = relativePathWithinRoot(lineRef.path, safeContext);
      if (!relPath) {
        const fallbackRef = fileFallbackForToken(raw, safeContext);
        if (fallbackRef) {
          addTokenCandidate(candidates, match.index, match.index + raw.length, fileTokenFromRef(raw, fallbackRef));
          continue;
        }
        if (shouldRenderAmbiguousPathSymbol(raw, safeContext)) {
          addTokenCandidate(candidates, match.index, match.index + raw.length, { type: "symbol", text: raw, value: raw });
        }
        continue;
      }
      const fallbackRef = fileFallbackForToken(raw, safeContext);
      addTokenCandidate(candidates, match.index, match.index + raw.length, fileTokenFromRef(raw, {
        path: relPath,
        line: lineRef.line,
        column: lineRef.column,
        fallbackPath: fallbackRef?.path || "",
      }));
    }

    const slashSymbolPattern = /[A-Za-z0-9._@+-]+(?:[\\/][A-Za-z0-9._@+-]+)+(?::\d+(?::\d+)?)?/g;
    for (const match of source.matchAll(slashSymbolPattern)) {
      const raw = stripTokenPunctuation(match[0]);
      if (!shouldRenderAmbiguousPathSymbol(raw, safeContext)) continue;
      addTokenCandidate(candidates, match.index, match.index + raw.length, { type: "symbol", text: raw, value: raw });
    }

    const chosen = chooseTokenCandidates(candidates);
    const tokens = [];
    let cursor = 0;
    for (const candidate of chosen) {
      if (candidate.start > cursor) tokens.push({ type: "text", text: source.slice(cursor, candidate.start) });
      tokens.push(candidate.token);
      cursor = candidate.end;
    }
    if (cursor < source.length) tokens.push({ type: "text", text: source.slice(cursor) });
    return tokens.length ? tokens : [{ type: "text", text: source }];
  }

  function safeMarkdownHref(rawHref) {
    try {
      const parsed = new URL(String(rawHref || ""));
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch {
      return "";
    }
  }

  function appendFileToken(parent, label, fileRef, context = {}) {
    const safeContext = safeProjectionContext(context);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `typed-token ${fileRef.line ? "typed-token-line-ref" : "typed-token-file"}${safeContext.markdownLink ? " assistant-md-link" : ""}`;
    button.textContent = label || fileRef.path;
    button.title = fileRef.line ? `Open ${fileRef.path}:${fileRef.line} in Files` : `Open ${fileRef.path} in Files`;
    if (safeContext.includeContextDataset) {
      button.dataset.contextTarget = "file_ref";
      button.dataset.contextFile = fileRef.path;
      if (fileRef.fallbackPath) button.dataset.contextFallbackFile = fileRef.fallbackPath;
    }
    button.addEventListener("click", () => safeContext.onOpenFile?.(fileRef.path, { fallbackPath: fileRef.fallbackPath || "", fileRef, context: safeContext }));
    parent.appendChild(button);
  }

  function appendUrlToken(parent, label, href, context = {}) {
    const safeContext = safeProjectionContext(context);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `typed-token typed-token-url${safeContext.markdownLink ? " assistant-md-link" : ""}`;
    button.textContent = label || href;
    button.title = safeContext.urlTitle || `Open ${href}`;
    if (safeContext.includeContextDataset) {
      button.dataset.contextTarget = "url";
      button.dataset.contextHref = href;
    }
    button.addEventListener("click", () => safeContext.onOpenUrl?.(href, safeContext));
    parent.appendChild(button);
  }

  function appendUnsupportedMarkdownLink(parent, label, reason) {
    const span = document.createElement("span");
    span.className = "assistant-md-link-blocked";
    span.textContent = label;
    span.title = reason || "Unsupported or unsafe link";
    parent.appendChild(span);
  }

  function renderTypedContent(container, text, context = {}) {
    const safeContext = safeProjectionContext(context);
    container.textContent = "";
    const tokens = tokenizeTypedContent(text, safeContext);
    for (const token of tokens) {
      if (!token || token.type === "text") {
        container.appendChild(document.createTextNode(token?.text || ""));
        continue;
      }
      if (token.type === "url") {
        appendUrlToken(container, token.text, token.href, {
          ...safeContext,
          urlTitle: safeContext.urlTokenTitle || safeContext.urlTitle || "Open link",
        });
        continue;
      }
      if (token.type === "file_path" || token.type === "line_ref") {
        appendFileToken(container, token.text, token, { ...safeContext, markdownLink: false });
        continue;
      }
      const span = document.createElement("span");
      span.className = `typed-token typed-token-${token.type.replace(/_/g, "-")}`;
      span.textContent = token.text;
      container.appendChild(span);
    }
  }

  function appendTypedText(parent, text, context = {}) {
    const safeContext = safeProjectionContext(context);
    if (!text) return;
    const span = document.createElement("span");
    renderTypedContent(span, text, safeContext);
    parent.appendChild(span);
  }

  function appendInlineCode(parent, raw, context = {}) {
    const safeContext = safeProjectionContext(context);
    const code = document.createElement("code");
    code.className = "assistant-md-inline-code";
    const source = String(raw || "");
    const fileRef = fileAliasForToken(source, safeContext) || markdownLocalHref(source, safeContext) || (() => {
      if (isBareVersionToken(source)) return null;
      const lineRef = splitLineRef(source);
      const relPath = relativePathWithinRoot(lineRef.path, safeContext);
      if (!relPath) return fileFallbackForToken(source, safeContext);
      const fallbackRef = fileFallbackForToken(source, safeContext);
      return {
        path: relPath,
        line: lineRef.line,
        column: lineRef.column,
        fallbackPath: fallbackRef?.path || "",
      };
    })();
    if (fileRef) {
      appendFileToken(code, source, fileRef, { ...safeContext, markdownLink: true });
    } else {
      const href = safeMarkdownHref(source);
      if (href) appendUrlToken(code, source, href, { ...safeContext, markdownLink: true });
      else {
        const span = document.createElement("span");
        const trimmed = source.trim();
        const tokenType = /^[a-f0-9]{7,40}$/i.test(trimmed)
          ? "commit"
          : /\s|^(npm|pnpm|yarn|node|git|gh|cargo|python|pytest|uv|make|bash|sh)\b/.test(trimmed)
            ? "command"
            : "symbol";
        span.className = `typed-token typed-token-${tokenType}`;
        span.textContent = source;
        code.appendChild(span);
      }
    }
    parent.appendChild(code);
  }

  function appendInlineMarkdown(parent, text, context = {}) {
    const safeContext = safeProjectionContext(context);
    const source = String(text || "");
    const pattern = /(\[[^\]\n]{1,240}\]\([^) \n]{1,1000}\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(->|=>))/g;
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
      if (match.index > cursor) appendTypedText(parent, source.slice(cursor, match.index), safeContext);
      const token = match[0];
      const linkMatch = token.match(/^\[([^\]\n]+)\]\(([^) \n]+)\)$/);
      if (linkMatch) {
        const href = safeMarkdownHref(linkMatch[2]);
        const fileRef = markdownLocalHref(linkMatch[2], safeContext);
        if (href) appendUrlToken(parent, linkMatch[1], href, { ...safeContext, markdownLink: true });
        else if (fileRef) appendFileToken(parent, linkMatch[1], fileRef, { ...safeContext, markdownLink: true });
        else appendUnsupportedMarkdownLink(parent, linkMatch[1], "Unsupported, unsafe, or unresolved link target");
      } else if (token.startsWith("`")) {
        appendInlineCode(parent, token.slice(1, -1), safeContext);
      } else if (token.startsWith("**")) {
        const strong = document.createElement("strong");
        strong.className = "assistant-md-strong";
        appendTypedText(strong, token.slice(2, -2), safeContext);
        parent.appendChild(strong);
      } else if (token.startsWith("*")) {
        const em = document.createElement("em");
        em.className = "assistant-md-emphasis";
        appendTypedText(em, token.slice(1, -1), safeContext);
        parent.appendChild(em);
      } else {
        const arrow = document.createElement("span");
        arrow.className = "assistant-md-arrow";
        arrow.textContent = token;
        parent.appendChild(arrow);
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) appendTypedText(parent, source.slice(cursor), safeContext);
  }

  function createMarkdownLineBlock(tagName, className, text, context = {}) {
    const safeContext = safeProjectionContext(context);
    const block = document.createElement(tagName);
    block.className = className;
    appendInlineMarkdown(block, text, safeContext);
    return block;
  }

  function createMarkdownCodeBlock(codeLines, language = "") {
    const block = document.createElement("div");
    block.className = "assistant-md-codeblock";
    const normalizedLanguage = String(language || "").trim();
    if (normalizedLanguage && normalizedLanguage.toLowerCase() !== "text") {
      const caption = document.createElement("div");
      caption.className = "assistant-md-codeblock-label";
      caption.textContent = normalizedLanguage;
      block.appendChild(caption);
    }
    const body = document.createElement("div");
    body.className = "assistant-md-codeblock-body";
    body.textContent = codeLines.join("\n");
    block.appendChild(body);
    return block;
  }

  function markdownFenceStart(line) {
    const trimmed = String(line || "").trim();
    const match = trimmed.match(/^(```|~~~)\s*([A-Za-z0-9_-]+)?(?:\s+.*)?$/);
    if (!match) return null;
    return {
      marker: match[1],
      language: match[2] || "",
    };
  }

  function markdownFenceClose(line, marker) {
    return String(line || "").trim() === marker;
  }

  function isIndentedMarkdownCodeLine(line) {
    return /^( {4}|\t)/.test(String(line || ""));
  }

  function stripIndentedMarkdownCodeLine(line) {
    const source = String(line || "");
    return source.startsWith("\t") ? source.slice(1) : source.replace(/^ {4}/, "");
  }

  function splitMarkdownTableRow(line) {
    let source = String(line || "").trim();
    if (!source.includes("|")) return null;
    if (source.startsWith("|")) source = source.slice(1);
    if (source.endsWith("|")) source = source.slice(0, -1);
    const cells = [];
    let current = "";
    let escaped = false;
    for (const char of source) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "|") {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells.length >= 2 ? cells : null;
  }

  function isMarkdownTableDivider(line) {
    const cells = splitMarkdownTableRow(line);
    return Boolean(cells?.length) && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
  }

  function markdownTableStart(lines, index) {
    if (!Array.isArray(lines) || index < 0 || index + 1 >= lines.length) return null;
    const header = splitMarkdownTableRow(lines[index]);
    if (!header || !isMarkdownTableDivider(lines[index + 1])) return null;
    return { header };
  }

  function appendMarkdownTable(container, tableLines, context = {}) {
    const safeContext = safeProjectionContext(context);
    const header = splitMarkdownTableRow(tableLines[0]) || [];
    const bodyRows = tableLines.slice(2).map(splitMarkdownTableRow).filter(Boolean);
    const wrapper = document.createElement("div");
    wrapper.className = "assistant-md-table-wrap";
    const table = document.createElement("table");
    table.className = "assistant-md-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const cellText of header) {
      const cell = document.createElement("th");
      appendInlineMarkdown(cell, cellText, safeContext);
      headRow.appendChild(cell);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const rowCells of bodyRows) {
      const row = document.createElement("tr");
      for (let cellIndex = 0; cellIndex < header.length; cellIndex += 1) {
        const cell = document.createElement("td");
        appendInlineMarkdown(cell, rowCells[cellIndex] || "", safeContext);
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
  }

  function isMarkdownBlockStart(line, lines = null, index = -1) {
    const trimmed = String(line || "").trim();
    return Boolean(
      !trimmed ||
      markdownFenceStart(line) ||
      isIndentedMarkdownCodeLine(line) ||
      markdownTableStart(lines, index) ||
      /^#{1,4}\s+/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^---+$/.test(trimmed) ||
      /^[-*]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      /^(->|=>)\s+/.test(trimmed)
    );
  }

  function appendMarkdownList(container, lines, ordered, context = {}) {
    const safeContext = safeProjectionContext(context);
    const list = document.createElement(ordered ? "ol" : "ul");
    list.className = "assistant-md-list";
    for (const line of lines) {
      const raw = ordered
        ? String(line || "").replace(/^\s*\d+\.\s+/, "")
        : String(line || "").replace(/^\s*[-*]\s+/, "");
      const taskMatch = raw.match(/^\[(x|X| )\]\s+([\s\S]*)$/);
      const item = document.createElement("li");
      const appendListText = (target, value) => {
        const fragments = String(value || "").split("\n");
        fragments.forEach((fragment, index) => {
          if (index) target.appendChild(document.createElement("br"));
          appendInlineMarkdown(target, fragment, safeContext);
        });
      };
      if (taskMatch) {
        const marker = document.createElement("span");
        marker.className = `assistant-md-task-marker${taskMatch[1].trim() ? " done" : ""}`;
        marker.textContent = taskMatch[1].trim() ? "\u2713" : "\u25a1";
        item.appendChild(marker);
        appendListText(item, taskMatch[2]);
      } else {
        appendListText(item, raw);
      }
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  function renderAssistantMarkdown(container, text, context = {}) {
    const safeContext = safeProjectionContext(context);
    container.textContent = "";
    container.classList.add("assistant-markdown");
    const source = String(text || "").replace(/\r\n/g, "\n");
    if (!source.trim()) return;
    const renderContext = { ...safeContext, fileAliases: buildMarkdownFileAliasMap(source, safeContext) };
    const lines = source.split("\n");
    for (let index = 0; index < lines.length;) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }

      const fence = markdownFenceStart(line);
      if (fence) {
        const codeLines = [];
        index += 1;
        while (index < lines.length && !markdownFenceClose(lines[index], fence.marker)) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        container.appendChild(createMarkdownCodeBlock(codeLines, fence.language));
        continue;
      }

      if (isIndentedMarkdownCodeLine(line)) {
        const codeLines = [];
        while (index < lines.length) {
          const nextLine = lines[index];
          if (isIndentedMarkdownCodeLine(nextLine)) {
            codeLines.push(stripIndentedMarkdownCodeLine(nextLine));
            index += 1;
            continue;
          }
          if (!nextLine.trim() && codeLines.length) {
            codeLines.push("");
            index += 1;
            continue;
          }
          break;
        }
        container.appendChild(createMarkdownCodeBlock(codeLines));
        continue;
      }

      if (markdownTableStart(lines, index)) {
        const tableLines = [lines[index], lines[index + 1]];
        index += 2;
        while (index < lines.length && splitMarkdownTableRow(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        appendMarkdownTable(container, tableLines, renderContext);
        continue;
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = Math.min(4, heading[1].length);
        container.appendChild(createMarkdownLineBlock(`h${level}`, `assistant-md-heading level-${level}`, heading[2], renderContext));
        index += 1;
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        const divider = document.createElement("hr");
        divider.className = "assistant-md-divider";
        container.appendChild(divider);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
          index += 1;
        }
        container.appendChild(createMarkdownLineBlock("blockquote", "assistant-md-quote", quoteLines.join("\n"), renderContext));
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed)) {
        const ordered = /^\d+\.\s+/.test(trimmed);
        const listLines = [];
        while (index < lines.length) {
          const nextLine = lines[index];
          const nextTrimmed = lines[index].trim();
          const isNextItem = ordered ? /^\d+\.\s+/.test(nextTrimmed) : /^[-*]\s+/.test(nextTrimmed);
          if (isNextItem) {
            listLines.push(nextLine);
            index += 1;
            continue;
          }
          if (listLines.length && /^\s{2,}\S/.test(nextLine)) {
            listLines[listLines.length - 1] = `${listLines[listLines.length - 1]}\n${nextLine.trim()}`;
            index += 1;
            continue;
          }
          if (!nextTrimmed) {
            index += 1;
            break;
          }
          break;
        }
        if (!listLines.length) index += 1;
        appendMarkdownList(container, listLines, ordered, renderContext);
        continue;
      }

      const chain = trimmed.match(/^(->|=>)\s*(.*)$/);
      if (chain) {
        const block = document.createElement("p");
        block.className = "assistant-md-chain";
        const arrow = document.createElement("span");
        arrow.className = "assistant-md-arrow";
        arrow.textContent = chain[1];
        block.append(arrow, document.createTextNode(" "));
        appendInlineMarkdown(block, chain[2], renderContext);
        container.appendChild(block);
        index += 1;
        continue;
      }

      const paragraphLines = [line];
      index += 1;
      while (index < lines.length && !isMarkdownBlockStart(lines[index], lines, index)) {
        paragraphLines.push(lines[index]);
        index += 1;
      }
      container.appendChild(createMarkdownLineBlock("p", "assistant-md-paragraph", paragraphLines.join("\n"), renderContext));
    }
  }

  return {
    buildMarkdownFileAliasMap,
    extractFileRefsFromText,
    fileFallbackForToken,
    fileRefFromTextCandidate,
    hasStrongFilePathEvidence,
    isBareVersionToken,
    markdownLocalHref,
    normalizeSlashes,
    relativePathWithinRoot,
    renderAssistantMarkdown,
    renderTypedContent,
    shouldRenderAmbiguousPathSymbol,
    splitLineRef,
    stripTokenPunctuation,
    tokenizeTypedContent,
  };
});
