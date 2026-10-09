"use strict";

// A small TOML reader for Codex's config.toml: tables, arrays of tables,
// dotted and quoted keys, basic/literal/multi-line strings, integers,
// floats, booleans, dates (kept as strings), arrays, and inline tables.
// It reads; it never writes the owner's file.

class TomlError extends Error {
  constructor(message, line) {
    super(`config.toml line ${line}: ${message}`);
    this.code = "direct_toml_invalid";
    this.line = line;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseToml(source) {
  const text = String(source ?? "").replace(/^\uFEFF/, "");
  let pos = 0;
  let line = 1;
  const root = {};
  let current = root;
  // Tables defined by a [header] (not implicitly), to reject duplicates.
  const defined = new Set();

  const fail = (message) => { throw new TomlError(message, line); };
  const peek = (offset = 0) => text[pos + offset];
  const startsWith = (value) => text.startsWith(value, pos);
  const advance = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      if (text[pos] === "\n") line += 1;
      pos += 1;
    }
  };
  const skipInlineSpace = () => {
    while (peek() === " " || peek() === "\t") advance();
  };
  const skipComment = () => {
    if (peek() === "#") while (pos < text.length && peek() !== "\n") advance();
  };
  // Whitespace, newlines, and comments (inside arrays).
  const skipAll = () => {
    for (;;) {
      skipInlineSpace();
      if (peek() === "#") skipComment();
      else if (peek() === "\n" || (peek() === "\r" && peek(1) === "\n")) advance(peek() === "\r" ? 2 : 1);
      else return;
    }
  };
  const expectLineEnd = () => {
    skipInlineSpace();
    skipComment();
    if (peek() === "\r" && peek(1) === "\n") return advance(2);
    if (peek() === "\n") return advance();
    if (pos < text.length) fail(`unexpected "${peek()}"`);
  };

  const parseEscape = () => {
    advance(); // backslash
    const ch = peek();
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\", e: "\u001b" };
    if (Object.hasOwn(simple, ch)) {
      advance();
      return simple[ch];
    }
    if (ch === "u" || ch === "U") {
      const length = ch === "u" ? 4 : 8;
      const hex = text.slice(pos + 1, pos + 1 + length);
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== length) fail("invalid unicode escape");
      advance(1 + length);
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    fail(`invalid escape "\\${ch}"`);
    return "";
  };

  const parseBasicString = () => {
    if (startsWith('"""')) {
      advance(3);
      if (peek() === "\r" && peek(1) === "\n") advance(2);
      else if (peek() === "\n") advance();
      let out = "";
      for (;;) {
        if (pos >= text.length) fail("unterminated multi-line string");
        if (startsWith('"""')) {
          // Up to two quotes may end the content right before the closer.
          let extra = 0;
          while (text[pos + 3 + extra] === '"' && extra < 2) extra += 1;
          out += '"'.repeat(extra);
          advance(3 + extra);
          return out;
        }
        if (peek() === "\\") {
          // A backslash at line end trims the newline and leading space.
          const rest = text.slice(pos + 1).match(/^[ \t]*\r?\n/);
          if (rest) {
            advance(1);
            while (/[ \t\r\n]/.test(peek() || "")) advance();
            continue;
          }
          out += parseEscape();
          continue;
        }
        out += peek();
        advance();
      }
    }
    advance();
    let out = "";
    for (;;) {
      const ch = peek();
      if (ch === undefined || ch === "\n") fail("unterminated string");
      if (ch === '"') {
        advance();
        return out;
      }
      if (ch === "\\") {
        out += parseEscape();
        continue;
      }
      out += ch;
      advance();
    }
  };

  const parseLiteralString = () => {
    if (startsWith("'''")) {
      advance(3);
      if (peek() === "\r" && peek(1) === "\n") advance(2);
      else if (peek() === "\n") advance();
      const end = text.indexOf("'''", pos);
      if (end < 0) fail("unterminated multi-line literal string");
      let stop = end;
      while (text[stop + 3] === "'" && stop - end < 2) stop += 1;
      const out = text.slice(pos, stop);
      advance(stop + 3 - pos);
      return out;
    }
    advance();
    const end = text.indexOf("'", pos);
    const newline = text.indexOf("\n", pos);
    if (end < 0 || (newline >= 0 && newline < end)) fail("unterminated literal string");
    const out = text.slice(pos, end);
    advance(end + 1 - pos);
    return out;
  };

  const parseKeyPart = () => {
    if (peek() === '"') return parseBasicString();
    if (peek() === "'") return parseLiteralString();
    const match = text.slice(pos).match(/^[A-Za-z0-9_-]+/);
    if (!match) fail("expected a key");
    advance(match[0].length);
    return match[0];
  };

  const parseKey = () => {
    const parts = [];
    for (;;) {
      skipInlineSpace();
      parts.push(parseKeyPart());
      skipInlineSpace();
      if (peek() !== ".") return parts;
      advance();
    }
  };

  const parseValue = () => {
    const ch = peek();
    if (ch === '"') return parseBasicString();
    if (ch === "'") return parseLiteralString();
    if (ch === "[") return parseArray();
    if (ch === "{") return parseInlineTable();
    if (startsWith("true") && !/[A-Za-z0-9_]/.test(text[pos + 4] || "")) {
      advance(4);
      return true;
    }
    if (startsWith("false") && !/[A-Za-z0-9_]/.test(text[pos + 5] || "")) {
      advance(5);
      return false;
    }
    const token = (text.slice(pos).match(/^[^\s,\]}#]+/) || [""])[0];
    if (!token) fail("expected a value");
    advance(token.length);
    // Dates and times stay text.
    if (/^\d{4}-\d{2}-\d{2}/.test(token) || /^\d{2}:\d{2}/.test(token)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(token) && /^ \d{2}:\d{2}/.test(text.slice(pos))) {
        const time = text.slice(pos + 1).match(/^[^\s,\]}#]+/)[0];
        advance(1 + time.length);
        return `${token} ${time}`;
      }
      return token;
    }
    const clean = token.replace(/_/g, "");
    if (/^[+-]?(inf|nan)$/.test(clean)) return clean.includes("nan") ? Number.NaN : (clean.startsWith("-") ? -Infinity : Infinity);
    if (/^0x[0-9A-Fa-f]+$/.test(clean)) return Number.parseInt(clean.slice(2), 16);
    if (/^0o[0-7]+$/.test(clean)) return Number.parseInt(clean.slice(2), 8);
    if (/^0b[01]+$/.test(clean)) return Number.parseInt(clean.slice(2), 2);
    if (/^[+-]?\d+$/.test(clean)) return Number.parseInt(clean, 10);
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(clean)) return Number.parseFloat(clean);
    fail(`invalid value "${token}"`);
    return null;
  };

  const parseArray = () => {
    advance();
    const out = [];
    for (;;) {
      skipAll();
      if (peek() === "]") {
        advance();
        return out;
      }
      out.push(parseValue());
      skipAll();
      if (peek() === ",") {
        advance();
        continue;
      }
      if (peek() === "]") {
        advance();
        return out;
      }
      fail("expected , or ] in array");
    }
  };

  const parseInlineTable = () => {
    advance();
    const out = {};
    skipInlineSpace();
    if (peek() === "}") {
      advance();
      return out;
    }
    for (;;) {
      const key = parseKey();
      skipInlineSpace();
      if (peek() !== "=") fail("expected = in inline table");
      advance();
      skipInlineSpace();
      assignPath(out, key, parseValue());
      skipInlineSpace();
      if (peek() === ",") {
        advance();
        skipInlineSpace();
        continue;
      }
      if (peek() === "}") {
        advance();
        return out;
      }
      fail("expected , or } in inline table");
    }
  };

  function assignPath(target, parts, value) {
    let node = target;
    for (const part of parts.slice(0, -1)) {
      if (node[part] === undefined) node[part] = {};
      else if (!isPlainObject(node[part])) fail(`key "${part}" is not a table`);
      node = node[part];
    }
    const last = parts[parts.length - 1];
    if (Object.hasOwn(node, last)) fail(`duplicate key "${parts.join(".")}"`);
    node[last] = value;
  }

  const tableAt = (parts, arrayOfTables) => {
    let node = root;
    parts.forEach((part, index) => {
      const lastPart = index === parts.length - 1;
      if (lastPart && arrayOfTables) {
        if (node[part] === undefined) node[part] = [];
        if (!Array.isArray(node[part])) fail(`"${parts.join(".")}" is not an array of tables`);
        const entry = {};
        node[part].push(entry);
        node = entry;
        return;
      }
      if (node[part] === undefined) node[part] = {};
      const next = node[part];
      if (Array.isArray(next)) node = next[next.length - 1];
      else if (isPlainObject(next)) node = next;
      else fail(`key "${part}" is not a table`);
    });
    return node;
  };

  while (pos < text.length) {
    skipAll();
    if (pos >= text.length) break;
    if (peek() === "[") {
      const arrayOfTables = peek(1) === "[";
      advance(arrayOfTables ? 2 : 1);
      const parts = parseKey();
      if (arrayOfTables ? !startsWith("]]") : peek() !== "]") fail("unterminated table header");
      advance(arrayOfTables ? 2 : 1);
      const id = JSON.stringify(parts);
      if (!arrayOfTables) {
        if (defined.has(id)) fail(`table [${parts.join(".")}] defined twice`);
        defined.add(id);
      }
      current = tableAt(parts, arrayOfTables);
      expectLineEnd();
      continue;
    }
    const key = parseKey();
    skipInlineSpace();
    if (peek() !== "=") fail("expected =");
    advance();
    skipInlineSpace();
    assignPath(current, key, parseValue());
    expectLineEnd();
  }
  return root;
}

module.exports = { TomlError, parseToml };
