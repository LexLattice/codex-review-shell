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
  turnId: "",
  itemMap: new Map(),
  thoughtItemMap: new Map(),
  thoughtTurnByItemId: new Map(),
  connected: false,
  liveAttached: false,
  sourceHome: "",
  openRequestId: 0,
  historyKind: "",
  historyKey: "",
  historyData: null,
  loadedUserMessagePages: 1,
  isBulkRendering: false,
  removeBridgeListener: null,
};

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
  bubble.textContent = text || "";
  configureUserMessagePreview(node, role);
  maybeAutoScrollBottom();
}

function appendMessageText(id, role, delta, title = "") {
  const node = ensureMessage(id, role, title);
  const bubble = node.querySelector(".bubble");
  bubble.textContent += delta || "";
  configureUserMessagePreview(node, role);
  maybeAutoScrollBottom();
}

function addSystemMessage(text) {
  setMessageText(`system_${Date.now()}_${Math.random().toString(16).slice(2)}`, "system", text, "System");
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
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
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

async function openThreadHybrid(threadId, sourceHome = "", sessionFilePath = "") {
  const requestedThreadId = String(threadId || "").trim();
  if (!requestedThreadId) throw new Error("Missing Codex thread id.");
  const openRequestId = state.openRequestId + 1;
  state.openRequestId = openRequestId;
  state.threadId = requestedThreadId;
  state.sourceHome = String(sourceHome || "");
  state.liveAttached = false;
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
  addSystemMessage(`Loading thread ${requestedThreadId}…`);
  setComposerEnabled(false, "Loading stored transcript and attaching live Codex session…");
  let renderedStored = false;
  try {
    const snapshot = await readStoredThreadTranscript(requestedThreadId, state.sourceHome, sessionFilePath);
    if (openRequestId !== state.openRequestId) return;
    if (snapshot?.entries?.length) {
      renderStoredTranscript(snapshot, requestedThreadId);
      renderedStored = true;
    }
  } catch (error) {
    if (openRequestId !== state.openRequestId) return;
    addSystemMessage(`Stored transcript read failed: ${error.message}`);
  }

  try {
    const liveResult = await attachLiveThread(requestedThreadId);
    if (openRequestId !== state.openRequestId) return;
    applyLiveThreadResult(liveResult);
  } catch (error) {
    if (openRequestId !== state.openRequestId) return;
    if (!renderedStored) throw error;
    const message = String(error?.message || "");
    if (message.toLowerCase().includes("not connected yet")) {
      setComposerEnabled(false, "Connecting live Codex session for this thread…");
      return;
    }
    addSystemMessage(`Live attach failed for ${requestedThreadId}: ${message}`);
    setComposerEnabled(false, "Live Codex attach failed for this thread. Select another thread or retry.");
  }
}

function bindThread(thread, modelName = "", options = {}) {
  state.threadId = thread?.id || "";
  state.liveAttached = options.liveAttached !== false;
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

function renderThoughtProcess(turnKey, thoughtItems) {
  if (!Array.isArray(thoughtItems) || !thoughtItems.length) return;
  const messageId = `thought_${turnKey}`;
  const node = ensureMessage(messageId, "system", "Thought process");
  const bubble = node.querySelector(".bubble");
  bubble.innerHTML = "";

  const root = document.createElement("details");
  root.className = "thought-process";
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
    block.textContent = thoughtItemBody(item) || "No reasoning text.";
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
      toolBody.textContent = thoughtItemBody(item) || "No details.";
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
    content.textContent = thoughtItemBody(item) || "No details.";
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
  renderThoughtProcess(key, merged);
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
    { merge: true },
  );
  return true;
}

function renderItem(item) {
  if (!item || !item.id) return;
  if (item.type === "userMessage") {
    const text = (item.content || []).map(userInputToText).filter(Boolean).join("\n\n");
    setMessageText(item.id, "user", text, "You");
    return;
  }
  if (item.type === "agentMessage") {
    if (isThoughtAssistantMessageItem(item)) {
      const turnKey = String(item.turnId || state.turnId || `live_${Date.now()}`);
      rememberThoughtAssistantItem(item, turnKey);
      upsertThoughtProcess(turnKey, [item], { merge: true });
      return;
    }
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
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
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
    const regularItems = [];
    const thoughtItems = [];
    for (const item of turn.items || []) {
      if (isThoughtItem(item) || isThoughtAssistantMessageItem(item)) thoughtItems.push(item);
      else regularItems.push(item);
    }
    for (const item of regularItems) renderItem(item);
    if (thoughtItems.length) {
      for (const item of thoughtItems) {
        if (isThoughtAssistantMessageItem(item)) rememberThoughtAssistantItem(item, turnKey);
      }
      upsertThoughtProcess(turnKey, thoughtItems, { merge: false });
    }
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
  const cwd = connection?.workspaceRoot || project?.workspace?.linuxPath || project?.workspace?.localPath || project?.repoPath || "";
  const params = {
    cwd,
    model: project?.codex?.model || null,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  };
  const result = await rpc("thread/start", params);
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  state.thoughtItemMap.clear();
  state.thoughtTurnByItemId.clear();
  bindThread(result.thread, result.model);
}

async function sendPrompt(text) {
  if (!state.threadId) await startNewThread();
  if (!state.liveAttached && state.threadId) {
    const liveResult = await attachLiveThread(state.threadId);
    applyLiveThreadResult(liveResult);
  }
  els.sendButton.disabled = true;
  try {
    await rpc("turn/start", {
      threadId: state.threadId,
      input: [{ type: "text", text, text_elements: [] }],
      model: project?.codex?.model || null,
      effort: project?.codex?.reasoningEffort || null,
    });
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
  if (method === "item/agentMessage/delta") {
    if (appendThoughtAssistantDelta(params?.itemId, params?.delta || "", params?.phase || "")) return;
    appendMessageText(params?.itemId, "assistant", params?.delta || "", "Codex");
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    if (isThoughtItem(params?.item) || isThoughtAssistantMessageItem(params?.item)) {
      const turnKey = String(params?.turnId || params?.item?.turnId || state.turnId || `live_${Date.now()}`);
      if (isThoughtAssistantMessageItem(params?.item)) rememberThoughtAssistantItem(params.item, turnKey);
      upsertThoughtProcess(turnKey, [params.item], { merge: true });
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
    if (params?.turnId) state.turnId = String(params.turnId);
    return;
  }
  if (method === "turn/started") {
    if (params?.turnId) state.turnId = String(params.turnId);
  }
}

function handleBridgeEvent(event) {
  if (!event) return;
  if (event.type === "open-thread-request") {
    openThreadHybrid(event.threadId, event.sourceHome || "", event.sessionFilePath || "").catch((error) => {
      addSystemMessage(`Unable to open Codex thread ${event.threadId || ""}: ${error.message}`);
    });
    return;
  }
  if (event.type === "connection-status") {
    if (event.status === "connected") {
      state.connected = true;
      setBadge(els.connectionBadge, connection?.runtime || "connected", "success");
      if (state.threadId && !state.liveAttached) {
        const expectedThreadId = state.threadId;
        attachLiveThread(expectedThreadId)
          .then((result) => {
            if (state.threadId !== expectedThreadId) return;
            applyLiveThreadResult(result);
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
  els.projectName.textContent = project.name;
  els.repoPath.textContent = workspaceText();

  if (!connection?.wsUrl) {
    setBadge(els.connectionBadge, "fallback", "warning");
    addSystemMessage(payload.error || "Codex fallback surface loaded. The managed app-server is not connected.");
    setComposerEnabled(false, "Read-only transcript mode (Codex app-server unavailable).");
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
    if (payload.initialThreadId) {
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
