function decodePayload() {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(atob(normalized), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    return JSON.parse(json);
  } catch (error) {
    console.error("Unable to decode Codex surface payload", error);
    return null;
  }
}

const bridge = window.codexSurfaceBridge;
const payload = decodePayload() || {};
const project = payload.project || null;
let connection = payload.codexConnection || null;

const USER_MESSAGE_PAGE_SIZE = 10;
const USER_MESSAGE_PREVIEW_LINES = 10;
const MAX_COMMAND_OUTPUT_CHARS = 1200;
const EMPTY_TURN_AUTO_RETRY_LIMIT = 1;
const THOUGHT_ITEM_TYPES = new Set([
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageGeneration",
  "collabAgentToolCall",
]);
const TOOL_LIKE_THOUGHT_TYPES = new Set([
  "commandExecution",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "collabAgentToolCall",
]);
const THOUGHT_ASSISTANT_PHASES = new Set([
  // Canonical Codex phase for interim assistant preamble/progress text.
  "commentary",
]);

const state = {
  threadId: "",
  threadTitle: "",
  turnId: "",
  itemMap: new Map(),
  codexItemMap: new Map(),
  thoughtItemMap: new Map(),
  thoughtTurnByItemId: new Map(),
  pendingThoughtRenderMap: new Map(),
  finalMessageByTurnKey: new Map(),
  turnActivityMap: new Map(),
  turnPromptMap: new Map(),
  turnRetryCountMap: new Map(),
  emptyTurnRetrying: new Set(),
  serverRequests: new Map(),
  connected: false,
  readyForThreadOpen: false,
  pendingOpenThreadEvent: null,
  liveAttached: false,
  sourceHome: "",
  sessionFilePath: "",
  openRequestId: 0,
  historyKind: "",
  historyKey: "",
  historyData: null,
  loadedUserMessagePages: 1,
  isBulkRendering: false,
  removeBridgeListener: null,
};

function capabilityArea(area) {
  return connection?.capabilities?.[area] || {};
}

function hasCapability(area, name) {
  const capabilities = capabilityArea(area);
  if (!Object.keys(capabilities).length) return true;
  return capabilities[name] !== false;
}

async function reportThreadState(status, details = {}) {
  if (!bridge?.reportThreadState) return;
  try {
    await bridge.reportThreadState({
      projectId: project?.id || payload.codexConnection?.projectId || "",
      threadId: String(details.threadId || state.threadId || ""),
      sourceHome: String(details.sourceHome ?? state.sourceHome ?? ""),
      sessionFilePath: String(details.sessionFilePath ?? state.sessionFilePath ?? ""),
      title: String(details.title || state.threadTitle || ""),
      status,
      activationEpoch: Number(payload.activationEpoch) || 0,
      evidence: String(details.evidence || ""),
      errorDescription: String(details.errorDescription || ""),
    });
  } catch {
    // Thread-state reporting must never block transcript rendering.
  }
}

const els = {
  projectName: document.getElementById("projectName"),
  repoPath: document.getElementById("repoPath"),
  connectionBadge: document.getElementById("connectionBadge"),
  accountBadge: document.getElementById("accountBadge"),
  modelBadge: document.getElementById("modelBadge"),
  transcript: document.getElementById("transcript"),
  composerForm: document.getElementById("composerForm"),
  composerInput: document.getElementById("composerInput"),
  sendButton: document.getElementById("sendButton"),
};

function workspaceText() {
  if (!project) return "No project bound";
  if (project.workspace?.kind === "wsl") return `WSL ${project.workspace.distro || "default"}:${project.workspace.linuxPath}`;
  return `Local ${project.workspace?.localPath || project.repoPath}`;
}

function updateSurfaceHeader(title = "", detail = "") {
  const cleanTitle = String(title || "").trim();
  state.threadTitle = cleanTitle || state.threadTitle || "";
  els.projectName.textContent = state.threadTitle || project?.name || "Codex session";
  els.projectName.title = state.threadTitle || project?.name || "";
  els.repoPath.textContent = detail || workspaceText();
  els.repoPath.title = detail || workspaceText();
}

function setBadge(element, text, className = "") {
  element.textContent = text;
  element.className = `badge${className ? ` ${className}` : ""}`;
}

function setNotice() {}

function setComposerEnabled(enabled, placeholder = "") {
  const nextEnabled = Boolean(enabled);
  els.composerInput.disabled = !nextEnabled;
  els.sendButton.disabled = !nextEnabled;
  if (nextEnabled) {
    els.composerInput.placeholder = "Ask Codex to inspect, change, or explain the project…";
  } else if (placeholder) {
    els.composerInput.placeholder = placeholder;
  }
}

function compactValue(value, maxLength = 240) {
  if (value == null) return "";
  if (typeof value === "string") return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  try {
    const json = JSON.stringify(value);
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function userInputToText(entry) {
  if (!entry) return "";
  if (typeof entry.text === "string" && entry.text.trim()) return entry.text.trim();
  if (entry.type === "input_image" || entry.type === "image") {
    const imageRef = String(entry.image_url || entry.path || "").trim();
    return imageRef ? `[image] ${imageRef}` : "[image]";
  }
  return compactValue(entry, 140);
}

function normalizePhase(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isThoughtAssistantPhase(phase) {
  const normalized = normalizePhase(phase);
  // Keep this conservative: only explicit commentary is treated as thought.
  // Final answer (`final_answer`) and unknown/missing phases render as regular assistant output.
  return Boolean(normalized) && THOUGHT_ASSISTANT_PHASES.has(normalized);
}

function isThoughtAssistantMessageItem(item) {
  if (!item || item.type !== "agentMessage") return false;
  return isThoughtAssistantPhase(item.phase);
}

function isStoredThoughtAssistantEntry(entry) {
  if (!entry || entry.role !== "assistant") return false;
  return isThoughtAssistantPhase(entry.phase);
}

function rememberThoughtAssistantItem(item, turnKey = "") {
  const itemId = String(item?.id || "").trim();
  if (!itemId) return;
  const key = String(turnKey || item?.turnId || state.turnId || `live_${Date.now()}`);
  const phase = normalizePhase(item?.phase || "");
  state.thoughtTurnByItemId.set(itemId, { turnKey: key, phase });
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function stripTokenPunctuation(value) {
  return String(value || "").replace(/[),.;!?]+$/g, "");
}

function knownWorkspaceRoots() {
  const roots = [
    connection?.workspaceRoot,
    project?.workspace?.linuxPath,
    project?.workspace?.localPath,
    project?.repoPath,
  ];
  const repoText = String(project?.repoPath || "");
  const wslMatch = repoText.match(/^wsl:[^:]+:(\/.*)$/i);
  if (wslMatch) roots.push(wslMatch[1]);
  return Array.from(new Set(roots.map((root) => normalizeSlashes(root).replace(/\/+$/, "")).filter(Boolean)));
}

function relativePathWithinRoot(filePath) {
  const raw = stripTokenPunctuation(filePath).trim();
  if (!raw || raw.includes("\0")) return "";
  const normalized = normalizeSlashes(raw);
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return "";
  if (/\s/.test(normalized)) return "";

  for (const root of knownWorkspaceRoots()) {
    const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
    if (!normalizedRoot) continue;
    const lowerPath = normalized.toLowerCase();
    const lowerRoot = normalizedRoot.toLowerCase();
    if (lowerPath === lowerRoot) return "";
    if (lowerPath.startsWith(`${lowerRoot}/`)) return normalized.slice(normalizedRoot.length + 1);
  }

  const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  if (isAbsolute) return "";
  if (!normalized.includes("/") && !/\.[A-Za-z0-9]{1,12}$/.test(normalized)) return "";
  return normalized.replace(/^\.\/+/, "");
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

function tokenizeTypedContent(text) {
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
    const lineRef = splitLineRef(raw);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (relPath) {
      addTokenCandidate(candidates, match.index, match.index + match[0].length, {
        type: lineRef.line ? "line_ref" : "file_path",
        text: match[0],
        path: relPath,
        line: lineRef.line,
        column: lineRef.column,
      });
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
    const lineRef = splitLineRef(raw);
    const relPath = relativePathWithinRoot(lineRef.path);
    if (!relPath) continue;
    addTokenCandidate(candidates, match.index, match.index + raw.length, {
      type: lineRef.line ? "line_ref" : "file_path",
      text: raw,
      path: relPath,
      line: lineRef.line,
      column: lineRef.column,
    });
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

async function openTypedUrl(url) {
  if (!bridge?.openExternalUrl) {
    addSystemMessage("External URL opening is unavailable in this Codex surface.");
    return;
  }
  const result = await bridge.openExternalUrl(url);
  if (!result?.ok) addSystemMessage(`URL open blocked: ${result?.error || "unknown error"}`);
}

async function revealTypedFile(relPath) {
  if (!bridge?.revealProjectFile || !project?.id) {
    addSystemMessage("Project file reveal is unavailable in this Codex surface.");
    return;
  }
  try {
    const result = await bridge.revealProjectFile(project.id, relPath);
    if (!result?.opened && result?.method) addSystemMessage(`File path copied: ${result.absolutePath || relPath}`);
  } catch (error) {
    addSystemMessage(`File reveal failed: ${error.message}`);
  }
}

function renderTypedContent(container, text) {
  container.textContent = "";
  const tokens = tokenizeTypedContent(text);
  for (const token of tokens) {
    if (!token || token.type === "text") {
      container.appendChild(document.createTextNode(token?.text || ""));
      continue;
    }
    if (token.type === "url") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "typed-token typed-token-url";
      button.textContent = token.text;
      button.title = "Open link in browser";
      button.addEventListener("click", () => openTypedUrl(token.href));
      container.appendChild(button);
      continue;
    }
    if (token.type === "file_path" || token.type === "line_ref") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `typed-token ${token.type === "line_ref" ? "typed-token-line-ref" : "typed-token-file"}`;
      button.textContent = token.text;
      button.title = token.line ? `Reveal ${token.path}:${token.line}` : `Reveal ${token.path}`;
      button.addEventListener("click", () => revealTypedFile(token.path));
      container.appendChild(button);
      continue;
    }
    const span = document.createElement("span");
    span.className = `typed-token typed-token-${token.type.replace(/_/g, "-")}`;
    span.textContent = token.text;
    container.appendChild(span);
  }
}

function ensureMessage(id, role, title = "") {
  if (state.itemMap.has(id)) return state.itemMap.get(id);
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `<div class="role"></div><div class="bubble"></div>`;
  article.querySelector(".role").textContent = title || (role === "assistant" ? "Codex" : role === "user" ? "You" : "System");
  els.transcript.appendChild(article);
  maybeAutoScrollBottom();
  state.itemMap.set(id, article);
  return article;
}

function setMessageText(id, role, text, title = "") {
  const node = ensureMessage(id, role, title);
  const bubble = node.querySelector(".bubble");
  bubble.dataset.rawText = text || "";
  bubble.dataset.typedRendered = "true";
  bubble.dataset.streamingPlain = "false";
  renderTypedContent(bubble, text || "");
  configureUserMessagePreview(node, role);
  maybeAutoScrollBottom();
}

function appendMessageText(id, role, delta, title = "") {
  const node = ensureMessage(id, role, title);
  const bubble = node.querySelector(".bubble");
  const textDelta = String(delta || "");
  const previous = bubble.dataset.rawText || bubble.textContent || "";
  const next = `${previous}${textDelta}`;
  bubble.dataset.rawText = next;
  bubble.dataset.typedRendered = "false";
  if (bubble.dataset.streamingPlain !== "true") {
    bubble.textContent = previous;
    bubble.dataset.streamingPlain = "true";
  }
  if (textDelta) bubble.appendChild(document.createTextNode(textDelta));
  configureUserMessagePreview(node, role);
  maybeAutoScrollBottom();
}

function finalizeMessageTypedContent(id) {
  const node = state.itemMap.get(String(id || ""));
  const bubble = node?.querySelector(".bubble");
  if (!bubble || bubble.dataset.typedRendered === "true") return;
  const text = bubble.dataset.rawText || bubble.textContent || "";
  bubble.dataset.rawText = text;
  bubble.dataset.typedRendered = "true";
  bubble.dataset.streamingPlain = "false";
  renderTypedContent(bubble, text);
  configureUserMessagePreview(node, node.classList.contains("user") ? "user" : node.classList.contains("assistant") ? "assistant" : "system");
}

function addSystemMessage(text) {
  setMessageText(`system_${Date.now()}_${Math.random().toString(16).slice(2)}`, "system", text, "System");
}

function clearRenderedThreadState() {
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  state.codexItemMap.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
  for (const pending of state.pendingThoughtRenderMap.values()) {
    if (pending?.frameId) cancelAnimationFrame(pending.frameId);
  }
  state.pendingThoughtRenderMap.clear();
  state.finalMessageByTurnKey.clear();
  state.turnActivityMap.clear();
  state.turnPromptMap.clear();
  state.turnRetryCountMap.clear();
  state.emptyTurnRetrying.clear();
}

function openThreadFromEvent(event) {
  if (!event?.threadId) return;
  if (!state.readyForThreadOpen) {
    state.pendingOpenThreadEvent = event;
    return;
  }
  if (String(event.threadId) === String(state.threadId) && (state.liveAttached || state.historyData)) return;
  reportThreadState("dispatched", {
    threadId: event.threadId,
    sourceHome: event.sourceHome || "",
    sessionFilePath: event.sessionFilePath || "",
    title: event.title || "",
    evidence: "open-thread-request",
  });
  openThreadHybrid(event.threadId, event.sourceHome || "", event.sessionFilePath || "", event.title || "").catch((error) => {
    reportThreadState("failed", {
      threadId: event.threadId,
      sourceHome: event.sourceHome || "",
      sessionFilePath: event.sessionFilePath || "",
      title: event.title || "",
      evidence: "open-thread-request",
      errorDescription: error.message,
    });
    addSystemMessage(`Unable to open Codex thread ${event.threadId || ""}: ${error.message}`);
  });
}

function turnIdFromNotification(params) {
  return String(params?.turn?.id || params?.turnId || "");
}

function ensureTurnActivity(turnId) {
  const id = String(turnId || "").trim();
  if (!id) return null;
  const existing = state.turnActivityMap.get(id);
  if (existing) return existing;
  const next = {
    id,
    startedAt: null,
    completedAt: null,
    status: "",
    hasCodexOutput: false,
    errorShown: false,
    emptyCompletionWarned: false,
  };
  state.turnActivityMap.set(id, next);
  return next;
}

function markTurnCodexOutput(turnId) {
  const activity = ensureTurnActivity(turnId);
  if (activity) activity.hasCodexOutput = true;
}

function rememberPromptTurn(turnId, text, retryCount = 0) {
  const id = String(turnId || "").trim();
  if (!id || !text) return;
  state.turnPromptMap.set(id, text);
  state.turnRetryCountMap.set(id, Math.max(0, Number(retryCount) || 0));
}

async function retryEmptyTurn(turnId) {
  const id = String(turnId || "").trim();
  if (!id || state.emptyTurnRetrying.has(id)) return;
  const prompt = state.turnPromptMap.get(id);
  const retryCount = state.turnRetryCountMap.get(id) || 0;
  if (!prompt || retryCount >= EMPTY_TURN_AUTO_RETRY_LIMIT) return;

  state.emptyTurnRetrying.add(id);
  try {
    setComposerEnabled(false, "Retrying empty Codex turn…");
    addSystemMessage("Rolling back the empty Codex turn and retrying the prompt once.");
    const rollback = await rpc("thread/rollback", { threadId: state.threadId, numTurns: 1 });
    if (!rollback?.thread) throw new Error("Rollback failed to return updated thread state.");
    renderThreadHistory(rollback.thread);
    bindThread(rollback.thread, project?.codex?.model || "", { liveAttached: true });
    setComposerEnabled(false, "Retrying empty Codex turn…");
    await startCodexTurn(prompt, { retryCount: retryCount + 1 });
  } catch (error) {
    addSystemMessage(`Automatic retry failed: ${error.message}`);
    setComposerEnabled(state.liveAttached, state.liveAttached ? "" : "Read-only mode");
  } finally {
    state.emptyTurnRetrying.delete(id);
  }
}

function renderTurnCompletionNotice(turnId, turn) {
  const id = String(turnId || turn?.id || "").trim();
  if (!id) return;
  const activity = ensureTurnActivity(id);
  if (!activity || activity.emptyCompletionWarned) return;

  if (turn?.status === "failed" && turn?.error) {
    if (activity.errorShown) return;
    activity.errorShown = true;
    activity.emptyCompletionWarned = true;
    const details = [
      turn.error.message || "Codex turn failed.",
      turn.error.additionalDetails || "",
    ].filter(Boolean).join("\n");
    addSystemMessage(details);
    return;
  }

  if (activity.hasCodexOutput) return;
  activity.emptyCompletionWarned = true;
  const status = String(turn?.status || "completed");
  const duration = Number.isFinite(turn?.durationMs) ? ` in ${Math.max(0, Math.round(turn.durationMs))}ms` : "";
  if (status !== "completed") {
    addSystemMessage(`Codex turn ended as ${status}${duration} without assistant, tool, or reasoning output.`);
    return;
  }
  const prompt = state.turnPromptMap.get(id);
  const retryCount = state.turnRetryCountMap.get(id) || 0;
  if (prompt && retryCount < EMPTY_TURN_AUTO_RETRY_LIMIT && state.threadId && state.connected) {
    addSystemMessage(
      `Codex accepted the prompt but completed${duration} without assistant, tool, or reasoning output. This empty turn will be rolled back and retried once.`,
    );
    retryEmptyTurn(id);
    return;
  }
  addSystemMessage(
    `Codex accepted the prompt but completed${duration} without assistant, tool, or reasoning output. The prompt was recorded in the thread; this usually means the app-server/core turn stopped before model output was produced.`,
  );
}

function removeUserMessagePreviewToggle(node) {
  if (!node) return;
  const existing = node.querySelector(".user-message-preview-toggle");
  if (existing) existing.remove();
}

function setUserMessagePreviewState(node, expanded) {
  const bubble = node?.querySelector(".bubble");
  const toggle = node?.querySelector(".user-message-preview-toggle");
  if (!bubble || !toggle) return;
  const isExpanded = Boolean(expanded);
  bubble.classList.toggle("is-user-preview-collapsed", !isExpanded);
  bubble.classList.toggle("is-user-preview-expanded", isExpanded);
  toggle.textContent = isExpanded ? "▴ Collapse" : "▾ Expand";
  toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
}

function configureUserMessagePreview(node, role) {
  if (!node) return;
  const bubble = node.querySelector(".bubble");
  if (!bubble) return;

  removeUserMessagePreviewToggle(node);
  bubble.classList.remove("is-user-preview-collapsed", "is-user-preview-expanded", "is-user-preview-eligible");
  bubble.style.removeProperty("--user-preview-lines");

  if (role !== "user") return;

  bubble.style.setProperty("--user-preview-lines", String(USER_MESSAGE_PREVIEW_LINES));
  bubble.classList.add("is-user-preview-collapsed");

  const previewVersion = (Number(node.dataset.previewVersion || "0") || 0) + 1;
  node.dataset.previewVersion = String(previewVersion);
  const explicitLineCount = String(bubble.textContent || "").split(/\r?\n/).length;

  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    if (node.dataset.previewVersion !== String(previewVersion)) return;

    const renderedOverflow = bubble.scrollHeight > bubble.clientHeight + 1;
    const shouldClamp = explicitLineCount > USER_MESSAGE_PREVIEW_LINES || renderedOverflow;

    if (!shouldClamp) {
      bubble.classList.remove("is-user-preview-collapsed", "is-user-preview-expanded", "is-user-preview-eligible");
      bubble.style.removeProperty("--user-preview-lines");
      removeUserMessagePreviewToggle(node);
      return;
    }

    bubble.classList.add("is-user-preview-eligible");
    bubble.classList.remove("is-user-preview-expanded");
    bubble.classList.add("is-user-preview-collapsed");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary user-message-preview-toggle";
    toggle.addEventListener("click", () => {
      const expanded = bubble.classList.contains("is-user-preview-collapsed");
      setUserMessagePreviewState(node, expanded);
    });
    node.appendChild(toggle);
    setUserMessagePreviewState(node, false);
  });
}

function rpc(method, params = {}) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  return bridge.request(method, params);
}

function maybeAutoScrollBottom() {
  if (state.isBulkRendering) return;
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function rerenderCurrentHistory(options = {}) {
  if (state.historyKind === "thread" && state.historyData) {
    renderThreadHistory(state.historyData, { ...options, keepPagination: true });
    return;
  }
  if (state.historyKind === "stored" && state.historyData?.snapshot && state.historyData?.threadId) {
    renderStoredTranscript(state.historyData.snapshot, state.historyData.threadId, { ...options, keepPagination: true });
  }
}

function renderLoadMoreControl(hiddenUserMessageCount) {
  if (!Number.isFinite(hiddenUserMessageCount) || hiddenUserMessageCount <= 0) return;
  const loadCount = Math.min(USER_MESSAGE_PAGE_SIZE, hiddenUserMessageCount);
  const wrapper = document.createElement("div");
  wrapper.className = "transcript-load-more";
  const label = document.createElement("span");
  label.className = "transcript-load-more-label";
  label.textContent = `${hiddenUserMessageCount} older user message${hiddenUserMessageCount === 1 ? "" : "s"} hidden`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary transcript-load-more-button";
  button.textContent = `Load ${loadCount} more`;
  button.addEventListener("click", () => {
    state.loadedUserMessagePages += 1;
    rerenderCurrentHistory({ preserveViewport: true });
  });
  wrapper.append(label, button);
  els.transcript.appendChild(wrapper);
}

function respond(id, result) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  return bridge.respond(id, result);
}

function respondRequest(key, result) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  if (typeof bridge.respondRequest === "function") return bridge.respondRequest(key, result);
  return bridge.respond(key, result);
}

function codexItemKey(threadId, turnId, itemId) {
  return [threadId, turnId, itemId].map((value) => String(value || "")).join(":");
}

function rememberCodexItem(context, item) {
  if (!item?.id) return;
  const threadId = String(context?.threadId || state.threadId || "");
  const turnId = String(context?.turnId || item.turnId || state.turnId || "");
  const itemId = String(context?.itemId || item.id || "");
  const enriched = { ...item, threadId, turnId, id: itemId };
  state.codexItemMap.set(codexItemKey(threadId, turnId, itemId), enriched);
  state.codexItemMap.set(`item:${itemId}`, enriched);
}

function itemForRequest(request) {
  const params = request?.params || {};
  const threadId = String(request?.threadId || params.threadId || state.threadId || "");
  const turnId = String(request?.turnId || params.turnId || state.turnId || "");
  const itemId = String(request?.itemId || params.itemId || params.callId || "");
  return state.codexItemMap.get(codexItemKey(threadId, turnId, itemId)) || state.codexItemMap.get(`item:${itemId}`) || null;
}

function requestMessageId(request) {
  return `server_request_${String(request?.key || request?.requestId || Date.now())}`;
}

function requestStatusLabel(status) {
  if (status === "pending") return "waiting";
  if (status === "responding") return "sent";
  if (status === "resolved") return "resolved";
  if (status === "declined") return "declined";
  if (status === "canceled") return "canceled";
  if (status === "timed-out") return "timed out";
  if (status === "connection-closed") return "connection closed";
  return status || "unknown";
}

function decisionAllowed(params, decision) {
  const available = Array.isArray(params?.availableDecisions) ? params.availableDecisions : null;
  if (!available || !available.length) return true;
  return available.some((entry) => {
    if (typeof entry === "string") return entry === decision;
    return Boolean(entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, decision));
  });
}

function appendRequestLine(parent, label, value, options = {}) {
  const text = typeof value === "string" ? value : compactValue(value, options.maxLength || 1600);
  if (!text) return;
  const row = document.createElement("div");
  row.className = "codex-request-line";
  const key = document.createElement("span");
  key.className = "codex-request-line-key";
  key.textContent = label;
  const body = document.createElement(options.pre ? "pre" : "span");
  body.className = options.mono ? "mono codex-request-line-value" : "codex-request-line-value";
  renderTypedContent(body, text);
  row.append(key, body);
  parent.appendChild(row);
}

function createRequestButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "secondary";
  button.textContent = label;
  if (typeof onClick === "function") button.addEventListener("click", onClick);
  return button;
}

async function submitRequestResponse(request, result, button) {
  const key = String(request?.key || "");
  if (!key) return;
  if (button) button.disabled = true;
  try {
    const response = await respondRequest(key, result);
    if (response?.request) updateServerRequest(response.request);
  } catch (error) {
    addSystemMessage(`Codex request response failed: ${error.message}`);
    if (button) button.disabled = false;
  }
}

function commandText(params) {
  if (Array.isArray(params?.command)) return params.command.join(" ");
  return String(params?.command || "");
}

function fileChangeTextForRequest(request) {
  const params = request?.params || {};
  if (params.fileChanges && typeof params.fileChanges === "object") {
    return Object.entries(params.fileChanges)
      .map(([filePath, change]) => `${filePath}\n${compactValue(change, 1200)}`)
      .join("\n\n");
  }
  const item = itemForRequest(request);
  if (item?.type === "fileChange") return thoughtItemBody(item);
  if (params.grantRoot) return `Requested write grant root: ${params.grantRoot}`;
  return "";
}

function renderCommandRequestDetails(request, details, actions) {
  const params = request.params || {};
  const network = params.networkApprovalContext || null;
  if (network) {
    appendRequestLine(details, "Network", `${network.protocol || "network"}://${network.host || "unknown host"}`, { mono: true });
  }
  appendRequestLine(details, "cwd", params.cwd || "", { mono: true });
  appendRequestLine(details, "command", commandText(params), { mono: true, pre: true });
  appendRequestLine(details, "reason", params.reason || "");
  appendRequestLine(details, "permissions", params.additionalPermissions || "", { pre: true });

  const decisions = [
    ["Approve once", "accept", { decision: "accept" }, ""],
    ["Approve for session", "acceptForSession", { decision: "acceptForSession" }, ""],
    ["Decline", "decline", { decision: "decline" }, "secondary"],
    ["Cancel", "cancel", { decision: "cancel" }, "secondary"],
  ];
  for (const [label, decision, result, className] of decisions) {
    if (!decisionAllowed(params, decision)) continue;
    actions.appendChild(createRequestButton(label, className, (event) => submitRequestResponse(request, result, event.currentTarget)));
  }
}

function renderLegacyCommandRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "cwd", params.cwd || "", { mono: true });
  appendRequestLine(details, "command", commandText(params), { mono: true, pre: true });
  appendRequestLine(details, "reason", params.reason || "");
  actions.appendChild(createRequestButton("Approve once", "", (event) => submitRequestResponse(request, { decision: "approved" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Approve for session", "", (event) => submitRequestResponse(request, { decision: "approved_for_session" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Deny", "secondary", (event) => submitRequestResponse(request, { decision: "denied" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Abort", "secondary", (event) => submitRequestResponse(request, { decision: "abort" }, event.currentTarget)));
}

function renderFileChangeRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "reason", params.reason || "");
  appendRequestLine(details, "grant root", params.grantRoot || "", { mono: true });
  const diffText = fileChangeTextForRequest(request);
  appendRequestLine(details, diffText ? "changes" : "changes unavailable", diffText || "Diff unavailable. Open details, decline, or cancel.", {
    mono: true,
    pre: true,
  });
  if (!diffText && request.method === "item/fileChange/requestApproval") {
    actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, { decision: "decline" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, { decision: "cancel" }, event.currentTarget)));
    return;
  }
  actions.appendChild(createRequestButton("Approve once", "", (event) => submitRequestResponse(request, { decision: request.method === "applyPatchApproval" ? "approved" : "accept" }, event.currentTarget)));
  if (request.method === "item/fileChange/requestApproval") {
    actions.appendChild(createRequestButton("Approve for session", "", (event) => submitRequestResponse(request, { decision: "acceptForSession" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, { decision: "decline" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Cancel turn", "secondary", (event) => submitRequestResponse(request, { decision: "cancel" }, event.currentTarget)));
  } else {
    actions.appendChild(createRequestButton("Deny", "secondary", (event) => submitRequestResponse(request, { decision: "denied" }, event.currentTarget)));
    actions.appendChild(createRequestButton("Abort", "secondary", (event) => submitRequestResponse(request, { decision: "abort" }, event.currentTarget)));
  }
}

function renderUserInputRequestDetails(request, details, actions) {
  const questions = Array.isArray(request.params?.questions) ? request.params.questions : [];
  const form = document.createElement("form");
  form.className = "codex-request-form";
  for (const question of questions) {
    const field = document.createElement("label");
    field.className = "codex-request-field";
    const title = document.createElement("span");
    title.textContent = question.header || question.question || question.id || "Question";
    const prompt = document.createElement("small");
    prompt.textContent = question.question || "";
    field.append(title, prompt);
    if (Array.isArray(question.options) && question.options.length) {
      const select = document.createElement("select");
      select.dataset.questionId = question.id || "";
      for (const option of question.options) {
        const opt = document.createElement("option");
        opt.value = option.id || option.label || "";
        opt.textContent = option.description ? `${option.label} - ${option.description}` : option.label || "Option";
        select.appendChild(opt);
      }
      field.appendChild(select);
    } else {
      const input = document.createElement(question.isSecret ? "input" : "textarea");
      input.dataset.questionId = question.id || "";
      if (question.isSecret) input.type = "password";
      input.placeholder = question.isOther ? "Other answer" : "Answer";
      field.appendChild(input);
    }
    form.appendChild(field);
  }
  const submit = createRequestButton("Submit answers", "", null);
  submit.addEventListener("click", (event) => {
    event.preventDefault();
    const answers = {};
    for (const input of form.querySelectorAll("[data-question-id]")) {
      const id = input.dataset.questionId;
      if (!id) continue;
      answers[id] = { answers: [String(input.value || "")] };
    }
    submitRequestResponse(request, { answers }, submit);
  });
  actions.appendChild(submit);
  details.appendChild(form);
}

function renderMcpRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "server", params.serverName || "");
  appendRequestLine(details, "message", params.message || "");
  if (params.mode === "url") {
    appendRequestLine(details, "url", params.url || "", { mono: true });
    actions.appendChild(createRequestButton("Open URL", "secondary", () => {
      openTypedUrl(String(params.url || ""));
    }));
  } else {
    appendRequestLine(details, "schema", params.requestedSchema || "", { mono: true, pre: true });
  }
  actions.appendChild(createRequestButton("Accept", "", (event) => submitRequestResponse(request, { action: "accept", content: params.mode === "form" ? {} : null, _meta: null }, event.currentTarget)));
  actions.appendChild(createRequestButton("Decline", "secondary", (event) => submitRequestResponse(request, { action: "decline", content: null, _meta: null }, event.currentTarget)));
  actions.appendChild(createRequestButton("Cancel", "secondary", (event) => submitRequestResponse(request, { action: "cancel", content: null, _meta: null }, event.currentTarget)));
}

function renderPermissionRequestDetails(request, details, actions) {
  const params = request.params || {};
  appendRequestLine(details, "cwd", params.cwd || "", { mono: true });
  appendRequestLine(details, "reason", params.reason || "");
  appendRequestLine(details, "permissions", params.permissions || "", { mono: true, pre: true });
  actions.appendChild(createRequestButton("Grant for turn", "", (event) => submitRequestResponse(request, { permissions: params.permissions || {}, scope: "turn" }, event.currentTarget)));
  actions.appendChild(createRequestButton("Deny", "secondary", (event) => submitRequestResponse(request, { permissions: {}, scope: "turn" }, event.currentTarget)));
}

function renderGenericRequestDetails(request, details) {
  appendRequestLine(details, "method", request.method || "", { mono: true });
  appendRequestLine(details, "params", request.params || "", { mono: true, pre: true });
  if (request.errorSummary) appendRequestLine(details, "error", request.errorSummary);
}

function renderServerRequest(request) {
  if (!request?.key) return;
  state.serverRequests.set(request.key, request);
  const node = ensureMessage(requestMessageId(request), "system", request.title || "Codex request");
  node.dataset.requestKey = request.key;
  const bubble = node.querySelector(".bubble");
  bubble.innerHTML = "";

  const card = document.createElement("section");
  card.className = `codex-request-card ${request.riskCategory || "unknown"} ${request.status || "pending"}`;
  const header = document.createElement("div");
  header.className = "codex-request-header";
  const title = document.createElement("strong");
  title.textContent = request.title || request.method || "Codex request";
  const status = document.createElement("span");
  status.className = "codex-request-status";
  status.textContent = requestStatusLabel(request.status);
  header.append(title, status);
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "codex-request-meta";
  meta.textContent = [request.riskCategory, request.summary].filter(Boolean).join(" · ");
  card.appendChild(meta);

  const details = document.createElement("div");
  details.className = "codex-request-details";
  const actions = document.createElement("div");
  actions.className = "codex-request-actions";
  const isPending = request.status === "pending";

  if (request.method === "item/commandExecution/requestApproval") renderCommandRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "execCommandApproval") renderLegacyCommandRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "item/fileChange/requestApproval" || request.method === "applyPatchApproval") renderFileChangeRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "item/tool/requestUserInput") renderUserInputRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "mcpServer/elicitation/request") renderMcpRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else if (request.method === "item/permissions/requestApproval") renderPermissionRequestDetails(request, details, isPending ? actions : document.createElement("div"));
  else renderGenericRequestDetails(request, details);

  if (!isPending) {
    appendRequestLine(details, "response", request.responseSummary || request.errorSummary || requestStatusLabel(request.status));
  }

  card.appendChild(details);
  if (isPending && actions.childElementCount) card.appendChild(actions);
  bubble.appendChild(card);
  maybeAutoScrollBottom();
}

function updateServerRequest(request) {
  if (!request?.key) return;
  const previous = state.serverRequests.get(request.key) || {};
  const next = { ...previous, ...request };
  state.serverRequests.set(request.key, next);
  renderServerRequest(next);
}

function focusServerRequest(key) {
  const node = els.transcript.querySelector(`[data-request-key="${CSS.escape(String(key || ""))}"]`);
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("request-focus-pulse");
  setTimeout(() => node.classList.remove("request-focus-pulse"), 900);
}

async function readStoredThreadTranscript(threadId, sourceHome = "", sessionFilePath = "") {
  if (!bridge?.readStoredThreadTranscript || !project?.id || !threadId) return null;
  return bridge.readStoredThreadTranscript(project.id, threadId, sourceHome, sessionFilePath);
}

function renderStoredTranscript(snapshot, threadId, options = {}) {
  const historyKey = `stored:${threadId}`;
  if (!options.keepPagination && state.historyKey !== historyKey) {
    state.loadedUserMessagePages = 1;
  }
  state.historyKind = "stored";
  state.historyKey = historyKey;
  state.historyData = { snapshot, threadId };

  const previousScrollTop = options.preserveViewport ? els.transcript.scrollTop : 0;
  const previousScrollHeight = options.preserveViewport ? els.transcript.scrollHeight : 0;

  state.isBulkRendering = true;
  clearRenderedThreadState();
  state.threadId = threadId;
  state.liveAttached = false;
  const title = String(snapshot?.title || "Stored transcript");
  addSystemMessage(`Loaded ${title} from local Codex session logs. Live attach is running in background.`);
  const allEntries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const userEntryIndices = [];
  for (let index = 0; index < allEntries.length; index += 1) {
    if (allEntries[index]?.role === "user") userEntryIndices.push(index);
  }
  const totalUserMessages = userEntryIndices.length;
  const visibleUserMessages = totalUserMessages
    ? Math.min(totalUserMessages, Math.max(1, state.loadedUserMessagePages) * USER_MESSAGE_PAGE_SIZE)
    : 0;
  const hiddenUserMessages = Math.max(0, totalUserMessages - visibleUserMessages);
  const startEntryIndex = totalUserMessages && hiddenUserMessages > 0
    ? userEntryIndices[Math.max(0, totalUserMessages - visibleUserMessages)] ?? 0
    : 0;
  const entries = allEntries.slice(startEntryIndex);

  renderLoadMoreControl(hiddenUserMessages);

  let thoughtBuffer = [];
  let thoughtBlockIndex = 0;
  function flushThoughtBuffer() {
    if (!thoughtBuffer.length) return;
    thoughtBlockIndex += 1;
    upsertThoughtProcess(`stored_${thoughtBlockIndex}`, thoughtBuffer, { merge: false });
    thoughtBuffer = [];
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const absoluteIndex = startEntryIndex + index;
    if (isStoredThoughtAssistantEntry(entry)) {
      thoughtBuffer.push({
        id: String(entry.id || `stored_thought_${absoluteIndex + 1}`),
        type: "agentMessage",
        phase: normalizePhase(entry.phase || "commentary"),
        text: String(entry.text || ""),
      });
      continue;
    }
    flushThoughtBuffer();
    const role = entry.role === "assistant" || entry.role === "user" ? entry.role : "system";
    const roleTitle = role === "assistant" ? "Codex" : role === "user" ? "You" : "System";
    setMessageText(String(entry.id || `stored_${absoluteIndex + 1}`), role, entry.text || "", roleTitle);
  }
  flushThoughtBuffer();
  setComposerEnabled(false, "Read-only transcript while connecting this thread to live Codex…");
  state.isBulkRendering = false;
  if (options.preserveViewport) {
    const nextScrollHeight = els.transcript.scrollHeight;
    const delta = Math.max(0, nextScrollHeight - previousScrollHeight);
    els.transcript.scrollTop = Math.max(0, previousScrollTop + delta);
  } else {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }
}

async function loadExistingThreadOrStartNew() {
  setNotice("Preparing Codex session…", "Starting a fresh Codex thread for this workspace.", { showNewThread: true });
  await startNewThread();
}

function normalizeThreadReadResult(result, requestedThreadId) {
  if (!result || typeof result !== "object") return null;
  const candidate = typeof result.thread === "object" && result.thread ? result.thread : result;
  const threadId = String(candidate.id || "");
  if (!threadId) return null;
  if (requestedThreadId && threadId !== requestedThreadId) {
    const candidateAlt = String(candidate.threadId || "");
    if (!candidateAlt || candidateAlt !== requestedThreadId) return null;
  }
  return {
    thread: candidate,
    model: String(result.model || ""),
  };
}

async function resumeThreadById(threadId) {
  const attempts = [
    { method: "thread/resume", params: { threadId } },
    { method: "thread/resume", params: { threadId, cwd: connection?.workspaceRoot || project?.repoPath || null } },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const result = await rpc(attempt.method, attempt.params);
      const normalized = normalizeThreadReadResult(result, threadId);
      if (normalized?.thread?.id) return normalized;
      lastError = new Error(`Unexpected response from ${attempt.method}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to resume Codex thread.");
}

async function readThreadById(threadId) {
  const attempts = [
    { method: "thread/read", params: { threadId, includeTurns: true } },
    { method: "thread/read", params: { threadId } },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const result = await rpc(attempt.method, attempt.params);
      const normalized = normalizeThreadReadResult(result, threadId);
      if (normalized?.thread?.id) return normalized;
      lastError = new Error(`Unexpected response from ${attempt.method}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to read Codex thread.");
}

async function attachLiveThread(threadId) {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing Codex thread id.");
  if (!state.connected) throw new Error("Codex surface is not connected yet.");
  if (!hasCapability("threads", "canResume") && !hasCapability("threads", "canRead")) {
    throw new Error("Active Codex runtime does not expose live thread read/resume capability.");
  }
  let result = null;
  try {
    result = await resumeThreadById(requestedThreadId);
  } catch {
    result = await readThreadById(requestedThreadId);
  }
  return result;
}

function applyLiveThreadResult(result) {
  if (!result?.thread) return;
  renderThreadHistory(result.thread);
  bindThread(result.thread, result.model, { liveAttached: true });
}

async function openThreadHybrid(threadId, sourceHome = "", sessionFilePath = "", titleHint = "") {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing Codex thread id.");
  const openRequestId = state.openRequestId + 1;
  state.openRequestId = openRequestId;
  state.threadId = requestedThreadId;
  state.sourceHome = String(sourceHome || "");
  state.sessionFilePath = String(sessionFilePath || "");
  state.liveAttached = false;
  clearRenderedThreadState();
  const payloadTitle = requestedThreadId === String(payload.initialThreadId || "") ? payload.initialThreadTitle : "";
  updateSurfaceHeader(titleHint || payloadTitle || requestedThreadId, workspaceText());
  await reportThreadState("requested", {
    threadId: requestedThreadId,
    sourceHome: state.sourceHome,
    sessionFilePath: state.sessionFilePath,
    title: titleHint || payloadTitle || requestedThreadId,
    evidence: "openThreadHybrid",
  });
  addSystemMessage(`Loading thread ${requestedThreadId}…`);
  setComposerEnabled(false, "Loading stored transcript and attaching live Codex session…");
  let renderedStored = false;
  try {
    const snapshot = await readStoredThreadTranscript(requestedThreadId, state.sourceHome, sessionFilePath);
    if (openRequestId !== state.openRequestId) return;
    if (snapshot?.entries?.length) {
      updateSurfaceHeader(snapshot.title || titleHint || payloadTitle || requestedThreadId, workspaceText());
      renderStoredTranscript(snapshot, requestedThreadId);
      renderedStored = true;
      await reportThreadState("rendered_stored", {
        threadId: requestedThreadId,
        sourceHome: state.sourceHome,
        sessionFilePath: state.sessionFilePath,
        title: snapshot.title || titleHint || payloadTitle || requestedThreadId,
        evidence: "stored-transcript",
      });
    }
  } catch (error) {
    if (openRequestId !== state.openRequestId) return;
    addSystemMessage(`Stored transcript read failed: ${error.message}`);
  }

  try {
    const liveResult = await attachLiveThread(requestedThreadId);
    if (openRequestId !== state.openRequestId) return;
    applyLiveThreadResult(liveResult);
    await reportThreadState("attached_live", {
      threadId: requestedThreadId,
      sourceHome: state.sourceHome,
      sessionFilePath: state.sessionFilePath,
      title: liveResult?.thread?.title || liveResult?.thread?.name || state.threadTitle || requestedThreadId,
      evidence: "app-server-thread-attach",
    });
  } catch (error) {
    if (openRequestId !== state.openRequestId) return;
    const message = String(error?.message || "");
    if (message.toLowerCase().includes("not connected yet")) {
      setComposerEnabled(false, "Connecting live Codex session for this thread…");
      return;
    }
    if (!renderedStored) {
      await reportThreadState("failed", {
        threadId: requestedThreadId,
        sourceHome: state.sourceHome,
        sessionFilePath: state.sessionFilePath,
        title: titleHint || payloadTitle || requestedThreadId,
        evidence: "app-server-thread-attach",
        errorDescription: message,
      });
      throw error;
    }
    addSystemMessage(`Live attach failed for ${requestedThreadId}: ${message}`);
    await reportThreadState("failed", {
      threadId: requestedThreadId,
      sourceHome: state.sourceHome,
      sessionFilePath: state.sessionFilePath,
      title: state.threadTitle || titleHint || payloadTitle || requestedThreadId,
      evidence: "live-attach-after-stored-render",
      errorDescription: message,
    });
    setComposerEnabled(false, "Live Codex attach failed for this thread. Select another thread or retry.");
  }
}

function bindThread(thread, modelName = "", options = {}) {
  state.threadId = thread?.id || "";
  state.liveAttached = options.liveAttached !== false;
  const title = thread?.title || thread?.name || thread?.preview || state.threadTitle || payload.initialThreadTitle || state.threadId;
  updateSurfaceHeader(title, workspaceText());
  setBadge(els.modelBadge, modelName || project?.codex?.model || "default model", "subtle");
  setComposerEnabled(state.liveAttached, state.liveAttached ? "" : "Read-only mode");
  setNotice(
    "Codex session ready",
    thread?.preview ? `Resumed thread: ${thread.preview}` : "Managed local Codex app-server is connected.",
    { success: true, showNewThread: true },
  );
}

function isThoughtItem(item) {
  return Boolean(item?.type && THOUGHT_ITEM_TYPES.has(item.type));
}

function isToolLikeThoughtItem(item) {
  return Boolean(item?.type && TOOL_LIKE_THOUGHT_TYPES.has(item.type));
}

function formatCommandExecutionText(item) {
  const output = String(item?.aggregatedOutput || "");
  const preview = output.length > MAX_COMMAND_OUTPUT_CHARS
    ? `${output.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n… [${output.length - MAX_COMMAND_OUTPUT_CHARS} chars omitted]`
    : output;
  const status = [
    String(item?.status || ""),
    Number.isFinite(item?.exitCode) ? `exit ${item.exitCode}` : "",
    Number.isFinite(item?.durationMs) ? `${Math.max(0, Math.round(item.durationMs))}ms` : "",
  ].filter(Boolean).join(" · ");
  return [String(item?.command || ""), status, preview].filter(Boolean).join("\n");
}

function thoughtItemLabel(item) {
  if (!item) return "Thought";
  if (item.type === "reasoning") return "Reasoning";
  if (item.type === "agentMessage") return `Codex · ${normalizePhase(item.phase || "thought") || "thought"}`;
  if (item.type === "commandExecution") return `Shell · ${compactValue(item.command || "command", 88)}`;
  if (item.type === "mcpToolCall") return `Tool · ${item.server || "mcp"}:${item.tool || "tool"}`;
  if (item.type === "dynamicToolCall") return `Dynamic tool · ${item.tool || "tool"}`;
  if (item.type === "webSearch") return `Web search · ${compactValue(item.query || "query", 88)}`;
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    return `Patch · ${changes} file change${changes === 1 ? "" : "s"}`;
  }
  if (item.type === "imageGeneration") return "Image generation";
  if (item.type === "collabAgentToolCall") return `Sub-agent tool · ${item.tool || "call"}`;
  return String(item.type || "Thought");
}

function thoughtItemBody(item) {
  if (!item) return "";
  if (item.type === "agentMessage") {
    return String(item.text || item.message || "").trim();
  }
  if (item.type === "reasoning") {
    return [...(item.summary || []), ...(item.content || [])].filter(Boolean).join("\n").trim();
  }
  if (item.type === "commandExecution") {
    return formatCommandExecutionText(item).trim();
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    if (!changes.length) return `${item.status || "completed"} · no file changes listed`;
    const lines = changes.slice(0, 40).map((change) => {
      const kind = String(change?.kind || change?.type || "change");
      const relPath = String(change?.path || change?.relativePath || change?.file || "").trim();
      return `- ${kind}${relPath ? ` ${relPath}` : ""}`;
    });
    if (changes.length > lines.length) lines.push(`… ${changes.length - lines.length} more change entries`);
    return lines.join("\n");
  }
  if (item.type === "mcpToolCall") {
    const header = `${item.server || "mcp"} · ${item.tool || "tool"} · ${item.status || "unknown"}`;
    const result = item.result ? `\nResult: ${compactValue(item.result, 1400)}` : "";
    const error = item.error ? `\nError: ${compactValue(item.error, 1400)}` : "";
    return `${header}${result}${error}`.trim();
  }
  if (item.type === "dynamicToolCall") {
    const header = `${item.tool || "tool"} · ${item.status || "unknown"}`;
    const body = item.contentItems ? `\nOutput: ${compactValue(item.contentItems, 1400)}` : "";
    return `${header}${body}`.trim();
  }
  if (item.type === "webSearch") {
    return `Query: ${item.query || ""}`.trim();
  }
  if (item.type === "imageGeneration") {
    return [item.revisedPrompt, item.result, item.savedPath].filter(Boolean).join("\n").trim();
  }
  if (item.type === "collabAgentToolCall") {
    const base = `${item.tool || "call"} · ${item.status || "unknown"}`;
    const prompt = item.prompt ? `\nPrompt: ${compactValue(item.prompt, 1200)}` : "";
    const targets = Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length
      ? `\nTargets: ${item.receiverThreadIds.join(", ")}`
      : "";
    return `${base}${prompt}${targets}`.trim();
  }
  return compactValue(item, 1800);
}

function thoughtMessageId(turnKey) {
  return `thought_${String(turnKey || "live")}`;
}

function rememberFinalMessageItem(itemId, turnKey = "") {
  const id = String(itemId || "").trim();
  const key = String(turnKey || state.turnId || "").trim();
  if (!id || !key) return;
  state.finalMessageByTurnKey.set(key, id);
  const thoughtNode = state.itemMap.get(thoughtMessageId(key));
  const finalNode = state.itemMap.get(id);
  if (thoughtNode && finalNode && finalNode.parentNode === els.transcript) {
    els.transcript.insertBefore(thoughtNode, finalNode);
  }
}

function positionThoughtProcessNode(turnKey, node) {
  const key = String(turnKey || "").trim();
  const finalId = state.finalMessageByTurnKey.get(key);
  const finalNode = finalId ? state.itemMap.get(finalId) : null;
  if (node && finalNode && finalNode.parentNode === els.transcript) {
    els.transcript.insertBefore(node, finalNode);
  }
}

function renderThoughtProcess(turnKey, thoughtItems, options = {}) {
  if (!Array.isArray(thoughtItems) || !thoughtItems.length) return;
  const messageId = thoughtMessageId(turnKey);
  const node = ensureMessage(messageId, "system", "Thought process");
  positionThoughtProcessNode(turnKey, node);
  const bubble = node.querySelector(".bubble");
  bubble.innerHTML = "";

  const root = document.createElement("details");
  root.className = "thought-process";
  if (options.open) root.open = true;
  const summary = document.createElement("summary");
  summary.textContent = `Thought process (${thoughtItems.length})`;
  root.appendChild(summary);

  const body = document.createElement("div");
  body.className = "thought-body";

  const reasoningItems = thoughtItems.filter((item) => item?.type === "reasoning" || isThoughtAssistantMessageItem(item));
  const toolItems = thoughtItems.filter(isToolLikeThoughtItem);
  const otherItems = thoughtItems.filter((item) =>
    item?.type !== "reasoning" && !isThoughtAssistantMessageItem(item) && !isToolLikeThoughtItem(item));

  for (const item of reasoningItems) {
    const block = document.createElement("div");
    block.className = "thought-reasoning";
    renderTypedContent(block, thoughtItemBody(item) || "No reasoning text.");
    body.appendChild(block);
  }

  if (toolItems.length) {
    const toolsRoot = document.createElement("details");
    toolsRoot.className = "thought-tools";
    const toolsSummary = document.createElement("summary");
    toolsSummary.textContent = `Shell / tool calls (${toolItems.length})`;
    toolsRoot.appendChild(toolsSummary);
    const toolsList = document.createElement("div");
    toolsList.className = "thought-tools-list";
    for (const item of toolItems) {
      const toolDetail = document.createElement("details");
      toolDetail.className = "thought-tool";
      const toolSummary = document.createElement("summary");
      toolSummary.textContent = thoughtItemLabel(item);
      const toolBody = document.createElement("pre");
      toolBody.className = "thought-content";
      renderTypedContent(toolBody, thoughtItemBody(item) || "No details.");
      toolDetail.append(toolSummary, toolBody);
      toolsList.appendChild(toolDetail);
    }
    toolsRoot.appendChild(toolsList);
    body.appendChild(toolsRoot);
  }

  for (const item of otherItems) {
    const detail = document.createElement("details");
    detail.className = "thought-tool";
    const title = document.createElement("summary");
    title.textContent = thoughtItemLabel(item);
    const content = document.createElement("pre");
    content.className = "thought-content";
    renderTypedContent(content, thoughtItemBody(item) || "No details.");
    detail.append(title, content);
    body.appendChild(detail);
  }

  root.appendChild(body);
  bubble.appendChild(root);
}

function mergeThoughtItems(existingItems, incomingItems) {
  const base = Array.isArray(existingItems) ? existingItems : [];
  const next = Array.isArray(incomingItems) ? incomingItems : [];
  const merged = [];
  const indexById = new Map();

  function pushItem(item) {
    if (!item) return;
    const key = typeof item.id === "string" && item.id ? item.id : "";
    if (key && indexById.has(key)) {
      const index = indexById.get(key);
      merged[index] = { ...merged[index], ...item };
      return;
    }
    const index = merged.push(item) - 1;
    if (key) indexById.set(key, index);
  }

  for (const item of base) pushItem(item);
  for (const item of next) pushItem(item);
  return merged;
}

function upsertThoughtProcess(turnKey, items, options = {}) {
  const key = String(turnKey || "live");
  const shouldMerge = options.merge !== false;
  const existing = shouldMerge ? state.thoughtItemMap.get(key) || [] : [];
  const merged = shouldMerge ? mergeThoughtItems(existing, items) : [...(items || [])];
  state.thoughtItemMap.set(key, merged);
  if (options.defer) {
    scheduleThoughtProcessRender(key, { open: Boolean(options.open) });
    return;
  }
  renderThoughtProcess(key, merged, { open: Boolean(options.open) });
}

function scheduleThoughtProcessRender(turnKey, options = {}) {
  const key = String(turnKey || "live");
  const existing = state.pendingThoughtRenderMap.get(key);
  if (existing) {
    existing.open = existing.open || Boolean(options.open);
    return;
  }
  const pending = { open: Boolean(options.open), frameId: 0 };
  pending.frameId = requestAnimationFrame(() => {
    state.pendingThoughtRenderMap.delete(key);
    const items = state.thoughtItemMap.get(key);
    if (!items?.length) return;
    renderThoughtProcess(key, items, { open: pending.open });
  });
  state.pendingThoughtRenderMap.set(key, pending);
}

function cancelPendingThoughtRender(turnKey) {
  const key = String(turnKey || "").trim();
  const pending = state.pendingThoughtRenderMap.get(key);
  if (!pending) return;
  if (pending.frameId) cancelAnimationFrame(pending.frameId);
  state.pendingThoughtRenderMap.delete(key);
}

function collapseThoughtProcess(turnKey) {
  const key = String(turnKey || "").trim();
  if (!key) return;
  cancelPendingThoughtRender(key);
  const items = state.thoughtItemMap.get(key);
  if (!items?.length) return;
  renderThoughtProcess(key, items, { open: false });
}

function finalizeTurnMessages(turnKey) {
  const key = String(turnKey || "").trim();
  if (!key) return;
  finalizeMessageTypedContent(state.finalMessageByTurnKey.get(key));
}

function appendThoughtAssistantDelta(itemId, delta, phaseHint = "") {
  const id = String(itemId || "").trim();
  if (!id) return false;
  const textDelta = String(delta || "");
  if (!textDelta) return false;

  const hintPhase = normalizePhase(phaseHint);
  const existingMeta = state.thoughtTurnByItemId.get(id);
  if (!existingMeta && !isThoughtAssistantPhase(hintPhase)) return false;

  const turnKey = String(existingMeta?.turnKey || state.turnId || `live_${Date.now()}`);
  const phase = hintPhase || existingMeta?.phase || "commentary";
  if (!existingMeta) {
    state.thoughtTurnByItemId.set(id, { turnKey, phase });
  } else if (phase && phase !== existingMeta.phase) {
    state.thoughtTurnByItemId.set(id, { ...existingMeta, phase });
  }

  const currentItems = state.thoughtItemMap.get(turnKey) || [];
  const currentItem = currentItems.find((entry) => entry?.id === id);
  const currentText = typeof currentItem?.text === "string" ? currentItem.text : "";
  upsertThoughtProcess(
    turnKey,
    [{ id, type: "agentMessage", phase, text: `${currentText}${textDelta}` }],
    { merge: true, open: true, defer: true },
  );
  return true;
}

function renderItem(item) {
  if (!item || !item.id) return;
  rememberCodexItem({ threadId: state.threadId, turnId: item.turnId || state.turnId, itemId: item.id }, item);
  if (item.type === "userMessage") {
    const text = (item.content || []).map(userInputToText).filter(Boolean).join("\n\n");
    setMessageText(item.id, "user", text, "You");
    return;
  }
  if (item.type === "agentMessage") {
    if (isThoughtAssistantMessageItem(item)) {
      const turnKey = String(item.turnId || state.turnId || `live_${Date.now()}`);
      rememberThoughtAssistantItem(item, turnKey);
      upsertThoughtProcess(turnKey, [item], { merge: true, open: !state.isBulkRendering });
      return;
    }
    rememberFinalMessageItem(item.id, item.turnId || state.turnId || "");
    setMessageText(item.id, "assistant", item.text || "", "Codex");
    return;
  }
  if (item.type === "plan") {
    setMessageText(item.id, "system", item.text || "", "Plan");
    return;
  }
  if (item.type === "reasoning") {
    const text = [...(item.summary || []), ...(item.content || [])].filter(Boolean).join("\n");
    setMessageText(item.id, "system", text, "Reasoning");
    return;
  }
  if (item.type === "commandExecution") {
    const text = formatCommandExecutionText(item);
    setMessageText(item.id, "system", text || "Command execution", "Command");
    return;
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    setMessageText(
      item.id,
      "system",
      `${item.status || "completed"} · ${changes} file change${changes === 1 ? "" : "s"}`,
      "Patch",
    );
    return;
  }
  if (item.type === "contextCompaction") {
    setMessageText(item.id, "system", "Context compacted for this thread.", "System");
    return;
  }
  if (item.type === "mcpToolCall") {
    const body = `${item.server || "mcp"} · ${item.tool || "tool"} · ${item.status || "unknown"}`;
    setMessageText(item.id, "system", body, "MCP");
    return;
  }
  if (item.type === "dynamicToolCall") {
    const body = `${item.tool || "dynamic tool"} · ${item.status || "unknown"}`;
    setMessageText(item.id, "system", body, "Tool");
    return;
  }
  if (item.type === "webSearch") {
    setMessageText(item.id, "system", item.query ? `Query: ${item.query}` : "Web search", "Web");
    return;
  }
  if (item.type === "imageGeneration") {
    setMessageText(item.id, "system", item.revisedPrompt || item.result || "Image generation", "Image");
    return;
  }
  setMessageText(item.id, "system", compactValue(item, 320) || `[${item.type}]`, "Event");
}

function renderThreadHistory(thread, options = {}) {
  const historyKey = `thread:${thread?.id || state.threadId || ""}`;
  if (!options.keepPagination && state.historyKey !== historyKey) {
    state.loadedUserMessagePages = 1;
  }
  state.historyKind = "thread";
  state.historyKey = historyKey;
  state.historyData = thread;

  const previousScrollTop = options.preserveViewport ? els.transcript.scrollTop : 0;
  const previousScrollHeight = options.preserveViewport ? els.transcript.scrollHeight : 0;

  state.isBulkRendering = true;
  clearRenderedThreadState();
  const allTurns = Array.isArray(thread?.turns) ? thread.turns : [];
  const userMessageTurnIndices = [];
  for (let index = 0; index < allTurns.length; index += 1) {
    for (const item of allTurns[index]?.items || []) {
      if (item?.type === "userMessage") userMessageTurnIndices.push(index);
    }
  }
  const totalUserMessages = userMessageTurnIndices.length;
  const visibleUserMessages = totalUserMessages
    ? Math.min(totalUserMessages, Math.max(1, state.loadedUserMessagePages) * USER_MESSAGE_PAGE_SIZE)
    : 0;
  const hiddenUserMessages = Math.max(0, totalUserMessages - visibleUserMessages);
  const startTurnIndex = totalUserMessages && hiddenUserMessages > 0
    ? userMessageTurnIndices[Math.max(0, totalUserMessages - visibleUserMessages)] ?? 0
    : 0;
  const visibleTurns = allTurns.slice(startTurnIndex);

  renderLoadMoreControl(hiddenUserMessages);

  for (let index = 0; index < visibleTurns.length; index += 1) {
    const turn = visibleTurns[index];
    const absoluteTurnIndex = startTurnIndex + index;
    const turnKey = String(turn?.id || `${absoluteTurnIndex + 1}`);
    const userItems = [];
    const regularItems = [];
    const thoughtItems = [];
    for (const item of turn.items || []) {
      if (item?.id) rememberCodexItem({ threadId: thread?.id || state.threadId, turnId: turnKey, itemId: item.id }, item);
      if (isThoughtItem(item) || isThoughtAssistantMessageItem(item)) thoughtItems.push(item);
      else if (item?.type === "userMessage") userItems.push(item);
      else regularItems.push(item);
    }
    for (const item of userItems) renderItem(item);
    if (thoughtItems.length) {
      for (const item of thoughtItems) {
        if (isThoughtAssistantMessageItem(item)) rememberThoughtAssistantItem(item, turnKey);
      }
      upsertThoughtProcess(turnKey, thoughtItems, { merge: false });
    }
    for (const item of regularItems) renderItem(item);
  }
  state.isBulkRendering = false;
  if (options.preserveViewport) {
    const nextScrollHeight = els.transcript.scrollHeight;
    const delta = Math.max(0, nextScrollHeight - previousScrollHeight);
    els.transcript.scrollTop = Math.max(0, previousScrollTop + delta);
  } else {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }
}

async function startNewThread() {
  if (!hasCapability("threads", "canStart")) {
    throw new Error("Active Codex runtime does not expose thread/start capability.");
  }
  const cwd = connection?.workspaceRoot || project?.workspace?.linuxPath || project?.workspace?.localPath || project?.repoPath || "";
  const params = {
    cwd,
    model: project?.codex?.model || null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  };
  const result = await rpc("thread/start", params);
  clearRenderedThreadState();
  bindThread(result.thread, result.model);
}

async function startCodexTurn(text, options = {}) {
  if (!hasCapability("turns", "canStart")) {
    throw new Error("Active Codex runtime does not expose turn/start capability.");
  }
  const result = await rpc("turn/start", {
    threadId: state.threadId,
    input: [{ type: "text", text, text_elements: [] }],
    model: project?.codex?.model || null,
    effort: project?.codex?.reasoningEffort || null,
  });
  const turnId = String(result?.turn?.id || "");
  if (turnId) rememberPromptTurn(turnId, text, options.retryCount || 0);
  return result;
}

async function sendPrompt(text) {
  if (!state.threadId) await startNewThread();
  if (!state.liveAttached && state.threadId) {
    const liveResult = await attachLiveThread(state.threadId);
    applyLiveThreadResult(liveResult);
  }
  els.sendButton.disabled = true;
  try {
    await startCodexTurn(text);
    els.composerInput.value = "";
  } finally {
    els.sendButton.disabled = false;
  }
}

async function initializeBridgeSession() {
  await rpc("initialize", {
    clientInfo: { name: "codex-review-shell", title: "Codex Review Shell", version: "0.4.0" },
    capabilities: { experimentalApi: true },
  });
  await bridge.notify("initialized", {});
  await loadAccountState();
}

function handleNotification(method, params) {
  if (method === "error") {
    const turnId = String(params?.turnId || state.turnId || "");
    const activity = ensureTurnActivity(turnId);
    if (activity) {
      activity.hasCodexOutput = true;
      activity.errorShown = true;
    }
    const error = params?.error || {};
    const message = [
      params?.willRetry ? "Codex stream error; retrying." : "Codex error.",
      error.message || "",
      error.additionalDetails || "",
    ].filter(Boolean).join("\n");
    addSystemMessage(message);
    return;
  }
  if (method === "warning") {
    if (!params?.threadId || String(params.threadId) === String(state.threadId || "")) {
      addSystemMessage(`Codex warning: ${params?.message || "Unknown warning."}`);
    }
    return;
  }
  if (method === "serverRequest/resolved") {
    const requestId = String(params?.requestId || "");
    for (const request of state.serverRequests.values()) {
      if (String(request.requestId) === requestId && request.status !== "resolved") {
        updateServerRequest({ ...request, status: "resolved", resolvedAt: new Date().toISOString() });
      }
    }
    return;
  }
  if (method === "item/agentMessage/delta") {
    const turnKey = String(params?.turnId || state.turnId || "");
    markTurnCodexOutput(turnKey);
    if (appendThoughtAssistantDelta(params?.itemId, params?.delta || "", params?.phase || "")) return;
    rememberFinalMessageItem(params?.itemId, turnKey);
    appendMessageText(params?.itemId, "assistant", params?.delta || "", "Codex");
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    if (params?.item?.type && params.item.type !== "userMessage") {
      markTurnCodexOutput(params?.turnId || params.item.turnId || state.turnId);
    }
    if (params?.item?.id) {
      rememberCodexItem(
        { threadId: params.threadId || state.threadId, turnId: params.turnId || params.item.turnId || state.turnId, itemId: params.item.id },
        params.item,
      );
    }
    if (isThoughtItem(params?.item) || isThoughtAssistantMessageItem(params?.item)) {
      const turnKey = String(params?.turnId || params?.item?.turnId || state.turnId || `live_${Date.now()}`);
      if (isThoughtAssistantMessageItem(params?.item)) rememberThoughtAssistantItem(params.item, turnKey);
      upsertThoughtProcess(turnKey, [params.item], { merge: true, open: true });
    } else {
      renderItem(params?.item);
    }
    return;
  }
  if (method === "account/updated") {
    return;
  }
  if (method === "account/login/completed") {
    if (params.success) {
      setNotice("Codex account ready", "Authentication completed. Refreshing account state…", { success: true, showNewThread: true });
      loadAccountState().catch((error) => addSystemMessage(`Failed to refresh account state: ${error.message}`));
    } else {
      setNotice("Login failed", params.error || "Codex account login failed.", { error: true, showLogin: true });
    }
    return;
  }
  if (method === "turn/completed") {
    els.sendButton.disabled = false;
    const completedTurnId = turnIdFromNotification(params);
    if (completedTurnId) {
      state.turnId = completedTurnId;
      const activity = ensureTurnActivity(completedTurnId);
      if (activity) {
        activity.status = String(params?.turn?.status || "completed");
        activity.completedAt = params?.turn?.completedAt || Date.now() / 1000;
      }
      collapseThoughtProcess(completedTurnId);
      finalizeTurnMessages(completedTurnId);
      renderTurnCompletionNotice(completedTurnId, params?.turn || {});
    }
    return;
  }
  if (method === "turn/started") {
    const startedTurnId = turnIdFromNotification(params);
    if (startedTurnId) {
      state.turnId = startedTurnId;
      const activity = ensureTurnActivity(startedTurnId);
      if (activity) {
        activity.status = String(params?.turn?.status || "inProgress");
        activity.startedAt = params?.turn?.startedAt || Date.now() / 1000;
      }
    }
  }
}

function handleBridgeEvent(event) {
  if (!event) return;
  if (event.type === "open-thread-request") {
    openThreadFromEvent(event);
    return;
  }
  if (event.type === "connection-status") {
    if (event.status === "connected") {
      state.connected = true;
      setBadge(els.connectionBadge, connection?.runtime || "connected", "success");
      if (state.threadId && !state.liveAttached) {
        const expectedThreadId = state.threadId;
        const expectedSourceHome = state.sourceHome;
        const expectedSessionFilePath = state.sessionFilePath;
        attachLiveThread(expectedThreadId)
          .then((result) => {
            if (state.threadId !== expectedThreadId) return;
            applyLiveThreadResult(result);
            reportThreadState("attached_live", {
              threadId: expectedThreadId,
              sourceHome: expectedSourceHome,
              sessionFilePath: expectedSessionFilePath,
              title: result?.thread?.title || result?.thread?.name || state.threadTitle || expectedThreadId,
              evidence: "delayed-connection-live-attach",
            });
          })
          .catch(() => {});
      }
      return;
    }
    if (event.status === "connecting") {
      state.connected = false;
      setComposerEnabled(false, "Connecting Codex app-server…");
      setBadge(els.connectionBadge, "connecting", "warning");
      return;
    }
    if (event.status === "error") {
      state.connected = false;
      state.liveAttached = false;
      setComposerEnabled(false, "Codex connection error.");
      setBadge(els.connectionBadge, "error", "warning");
      if (event.error) addSystemMessage(`Codex connection failed: ${event.error}`);
      return;
    }
    if (event.status === "disconnected") {
      state.connected = false;
      state.liveAttached = false;
      setComposerEnabled(false, "Codex disconnected.");
      setBadge(els.connectionBadge, "offline", "warning");
      if (event.error && !String(event.error).toLowerCase().includes("renderer requested disconnect")) {
        addSystemMessage(`Codex disconnected: ${event.error}`);
      }
      return;
    }
  }
  if (event.type === "rpc-request") {
    renderServerRequest(event.request || event);
    return;
  }
  if (event.type === "rpc-request-updated") {
    updateServerRequest(event.request || event);
    return;
  }
  if (event.type === "focus-server-request") {
    focusServerRequest(event.key);
    return;
  }
  if (event.type === "rpc-notification") {
    handleNotification(event.method, event.params || {});
    return;
  }
  if (event.type === "protocol-error") {
    addSystemMessage(`Codex protocol error: ${event.error}`);
  }
}

async function loadAccountState() {
  const account = await rpc("account/read", { refreshToken: false });
  if (account?.account?.type === "chatgpt") {
    setBadge(els.accountBadge, `${account.account.planType} · ${account.account.email}`, "subtle");
  } else if (account?.requiresOpenaiAuth) {
    setBadge(els.accountBadge, "login required", "warning");
    addSystemMessage("Codex requires login in the control plane.");
  } else {
    setBadge(els.accountBadge, "account unavailable", "warning");
  }
}

async function login() {
  const response = await rpc("account/login/start", { type: "chatgpt" });
  if (response?.authUrl) {
    window.open(response.authUrl, "_blank");
    addSystemMessage("Complete the Codex login flow in your external browser.");
  }
}

async function connect() {
  if (!bridge) {
    addSystemMessage("Codex bridge unavailable in this surface.");
    return;
  }
  if (!project) {
    addSystemMessage("This Codex surface was loaded without a project payload.");
    return;
  }
  state.removeBridgeListener?.();
  state.removeBridgeListener = bridge.onEvent(handleBridgeEvent);
  updateSurfaceHeader(payload.initialThreadTitle || project.name, workspaceText());

  if (!connection?.wsUrl) {
    setBadge(els.connectionBadge, "fallback", "warning");
    addSystemMessage(payload.error || "Codex fallback surface loaded. The managed app-server is not connected.");
    setComposerEnabled(false, "Read-only transcript mode (Codex app-server unavailable).");
    state.readyForThreadOpen = true;
    if (payload.initialThreadId) {
      try {
        await openThreadHybrid(
          payload.initialThreadId,
          payload.initialThreadSourceHome || "",
          payload.initialThreadSessionFilePath || "",
        );
      } catch (error) {
        addSystemMessage(`Unable to open fallback thread ${payload.initialThreadId}: ${error.message}`);
      }
    }
    return;
  }

  setComposerEnabled(false, "Connecting Codex app-server…");
  setBadge(els.connectionBadge, "connecting", "warning");
  await bridge.connect(connection);
  state.connected = true;
  try {
    await initializeBridgeSession();
    state.readyForThreadOpen = true;
    const queuedOpen = state.pendingOpenThreadEvent;
    state.pendingOpenThreadEvent = null;
    if (queuedOpen?.threadId) {
      openThreadFromEvent(queuedOpen);
    } else if (payload.initialThreadId) {
      try {
        await openThreadHybrid(
          payload.initialThreadId,
          payload.initialThreadSourceHome || "",
          payload.initialThreadSessionFilePath || "",
        );
      } catch (error) {
        addSystemMessage(`Unable to open startup thread ${payload.initialThreadId}: ${error.message}`);
        await loadExistingThreadOrStartNew();
      }
    } else {
      await loadExistingThreadOrStartNew();
    }
  } catch (error) {
    addSystemMessage(`Codex initialization failed: ${error.message}`);
  }
}

els.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.composerInput.value.trim();
  if (!text) return;
  sendPrompt(text).catch((error) => addSystemMessage(`Turn failed: ${error.message}`));
});

connect().catch((error) => {
  addSystemMessage(`Codex setup failed: ${error.message}`);
});
