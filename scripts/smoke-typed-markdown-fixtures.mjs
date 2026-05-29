import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(repoRoot, "fixtures", "typed-markdown-brl", "cases.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class TestNode {
  constructor(tagName = "#text", text = "") {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = tagName === "#text" ? 3 : 1;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.title = "";
    this.type = "";
    this.href = "";
    this._ownText = String(text || "");
    this._classSet = new Set();
    this.classList = {
      add: (...names) => {
        for (const name of names.flatMap((entry) => String(entry || "").split(/\s+/)).filter(Boolean)) {
          this._classSet.add(name);
        }
      },
      remove: (...names) => {
        for (const name of names.flatMap((entry) => String(entry || "").split(/\s+/)).filter(Boolean)) {
          this._classSet.delete(name);
        }
      },
      toggle: (name, force) => {
        const normalized = String(name || "").trim();
        if (!normalized) return false;
        const shouldAdd = force === undefined ? !this._classSet.has(normalized) : Boolean(force);
        if (shouldAdd) this._classSet.add(normalized);
        else this._classSet.delete(normalized);
        return shouldAdd;
      },
      contains: (name) => this._classSet.has(String(name || "").trim()),
    };
  }

  get className() {
    return Array.from(this._classSet).join(" ");
  }

  set className(value) {
    this._classSet = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this._ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._ownText = String(value || "");
    this.children = [];
  }

  appendChild(child) {
    const node = typeof child === "string" ? new TestNode("#text", child) : child;
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes[name] = stringValue;
    if (name === "class") this.className = stringValue;
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

const documentStub = {
  createElement: (tagName) => new TestNode(tagName),
  createTextNode: (text) => new TestNode("#text", text),
};

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function nodesByClass(root, className) {
  const nodes = [];
  walk(root, (node) => {
    if (node.classList?.contains?.(className)) nodes.push(node);
  });
  return nodes;
}

function nodesByTag(root, tagName) {
  const expected = tagName.toUpperCase();
  const nodes = [];
  walk(root, (node) => {
    if (node.tagName === expected) nodes.push(node);
  });
  return nodes;
}

function rendererSlice(sourcePath, startMarker, endMarker, exportNames, sandboxExtras = {}) {
  const fullPath = path.join(repoRoot, sourcePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0, `Missing start marker ${startMarker} in ${sourcePath}`);
  assert(end > start, `Missing end marker ${endMarker} in ${sourcePath}`);
  const exportBlock = `\nthis.__exports = { ${exportNames.join(", ")} };\n`;
  const sandbox = {
    console,
    URL,
    document: documentStub,
    setTimeout: () => 0,
    navigator: { clipboard: { writeText: async () => undefined } },
    ...sandboxExtras,
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + exportBlock, sandbox, { filename: sourcePath });
  return sandbox.__exports;
}

const workspaceProject = {
  id: "fixture-project",
  repoPath: fixture.workspaceRoot,
  workspace: {
    linuxPath: fixture.workspaceRoot,
    localPath: fixture.workspaceRoot,
  },
};
const renderContext = { fileEvidenceRefs: fixture.fileEvidenceRefs };

const codexSurface = rendererSlice(
  "src/renderer/codex-surface.js",
  "function normalizeSlashes",
  "\nfunction messageCopyText",
  ["tokenizeTypedContent", "renderFinalAssistantContent"],
  {
    project: workspaceProject,
    state: { threadId: "thread_fixture", threadTitle: "Fixture" },
    bridge: {},
    addSystemMessage: () => undefined,
  },
);

const appSurface = rendererSlice(
  "src/renderer/app.js",
  "function normalizeSlashes",
  "\nfunction subAgentMessagePreviewKey",
  ["tokenizeTypedContent", "renderMiddleFileMarkdown", "renderSubAgentMessageBody"],
  {
    activeProject: () => workspaceProject,
    bridge: {},
    state: {
      openedCodexThreadId: "thread_fixture",
      openedCodexThreadTitle: "Fixture",
      subAgentGraph: { primaryThreadId: "thread_fixture" },
    },
    setLastEvent: () => undefined,
    renderSubAgentProcessBody: () => undefined,
  },
);

function fileTokens(tokens) {
  return tokens.filter((token) => token?.type === "file_path" || token?.type === "line_ref");
}

function assertTypedTokenBehavior(label, surface) {
  const tokens = surface.tokenizeTypedContent(fixture.codexFinalMessage, renderContext);
  const files = fileTokens(tokens);
  assert(!files.some((token) => String(token.text).includes("v1.1")), `${label}: bare version token became a file`);
  assert(
    files.some((token) => token.path === "docs/support/general_program_ontology_derived_v1_1.md"),
    `${label}: evidence-backed basename did not resolve to its full file ref`,
  );
  assert(
    files.some((token) => token.text === "phase_outputs/p63_struct_tag_extended_tail_closeout.md" && token.fallbackPath),
    `${label}: short path did not retain evidence fallback path`,
  );
  for (const expected of ["`implementation_src`", "`x/net/html`", "`cascadia`"]) {
    assert(
      tokens.some((token) => token.type === "symbol" && token.text === expected),
      `${label}: ${expected} should remain a symbol, not a file`,
    );
  }
}

assertTypedTokenBehavior("codex final renderer", codexSurface);
assertTypedTokenBehavior("middle/sub-agent renderer", appSurface);

const codexContainer = documentStub.createElement("div");
codexSurface.renderFinalAssistantContent(codexContainer, fixture.codexFinalMessage, renderContext);
assert(nodesByClass(codexContainer, "assistant-md-link-blocked").length === 1, "codex final renderer did not render unsafe link as blocked");
assert(
  nodesByClass(codexContainer, "typed-token-file").some((node) => node.textContent === "general_program_ontology_derived_v1_1.md"),
  "codex final renderer did not render evidence-backed basename as a file token",
);

const middleContainer = documentStub.createElement("div");
appSurface.renderMiddleFileMarkdown(middleContainer, fixture.middleFileMarkdown, renderContext);
const middleCodeBlocks = nodesByClass(middleContainer, "assistant-md-codeblock-body");
assert(
  middleCodeBlocks.some((node) => node.textContent.includes("SOURCE_RULE_CATALOG_TAIL_BATCH")),
  "middle file markdown dropped the indented block after a colon",
);
assert(
  middleCodeBlocks.some((node) => node.textContent.includes("No implementation handoff")),
  "middle file markdown dropped the later indented guard block",
);
assert(nodesByTag(middleContainer, "table").length === 1, "middle file markdown did not render a markdown table");
assert(middleContainer.textContent.includes("XDG/HOME config discovery"), "middle file table content was not preserved");

const subAgentContainer = documentStub.createElement("div");
appSurface.renderSubAgentMessageBody(
  subAgentContainer,
  { role: "child", text: fixture.subAgentChildMessage },
  renderContext,
);
assert(nodesByClass(subAgentContainer, "assistant-md-codeblock-body").length === 1, "sub-agent child markdown did not render code fence");
assert(nodesByTag(subAgentContainer, "table").length === 1, "sub-agent child markdown did not render table");
assert(
  nodesByClass(subAgentContainer, "typed-token-file").some((node) =>
    node.textContent.includes("phase_outputs/p63_struct_tag_extended_tail_closeout.md"),
  ),
  "sub-agent child markdown did not preserve typed file token rendering",
);

console.log("typed markdown BRL smoke passed");
