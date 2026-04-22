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
const connection = payload.codexConnection || null;

const state = {
  threadId: "",
  turnId: "",
  itemMap: new Map(),
  connected: false,
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

function ensureMessage(id, role, title = "") {
  if (state.itemMap.has(id)) return state.itemMap.get(id);
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `<div class="role"></div><div class="bubble"></div>`;
  article.querySelector(".role").textContent = title || (role === "assistant" ? "Codex" : role === "user" ? "You" : "System");
  els.transcript.appendChild(article);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  state.itemMap.set(id, article);
  return article;
}

function setMessageText(id, role, text, title = "") {
  const node = ensureMessage(id, role, title);
  node.querySelector(".bubble").textContent = text || "";
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function appendMessageText(id, role, delta, title = "") {
  const node = ensureMessage(id, role, title);
  node.querySelector(".bubble").textContent += delta || "";
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function addSystemMessage(text) {
  setMessageText(`system_${Date.now()}_${Math.random().toString(16).slice(2)}`, "system", text, "System");
}

function rpc(method, params = {}) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  return bridge.request(method, params);
}

function respond(id, result) {
  if (!bridge) return Promise.reject(new Error("Codex surface bridge is unavailable."));
  return bridge.respond(id, result);
}

async function loadExistingThreadOrStartNew() {
  setNotice("Preparing Codex session…", "Starting a fresh Codex thread for this workspace.", { showNewThread: true });
  await startNewThread();
}

function bindThread(thread, modelName = "") {
  state.threadId = thread?.id || "";
  setBadge(els.modelBadge, modelName || project?.codex?.model || "default model", "subtle");
  setNotice(
    "Codex session ready",
    thread?.preview ? `Resumed thread: ${thread.preview}` : "Managed local Codex app-server is connected.",
    { success: true, showNewThread: true },
  );
}

function renderItem(item) {
  if (!item || !item.id) return;
  if (item.type === "userMessage") {
    const text = (item.content || []).map((entry) => entry.text || "").filter(Boolean).join("\n\n");
    setMessageText(item.id, "user", text, "You");
    return;
  }
  if (item.type === "agentMessage") {
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
    const text = [item.command, item.aggregatedOutput].filter(Boolean).join("\n\n");
    setMessageText(item.id, "system", text || "Command execution", "Command");
  }
}

function renderThreadHistory(thread) {
  els.transcript.innerHTML = "";
  state.itemMap.clear();
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) renderItem(item);
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
  bindThread(result.thread, result.model);
}

async function sendPrompt(text) {
  if (!state.threadId) await startNewThread();
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

function handleNotification(method, params) {
  if (method === "item/agentMessage/delta") {
    appendMessageText(params.itemId, "assistant", params.delta || "", "Codex");
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    renderItem(params.item);
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
  }
}

function handleBridgeEvent(event) {
  if (!event) return;
  if (event.type === "connection-status") {
    if (event.status === "connected") {
      state.connected = true;
      setBadge(els.connectionBadge, connection?.runtime || "connected", "success");
      return;
    }
    if (event.status === "connecting") {
      state.connected = false;
      setBadge(els.connectionBadge, "connecting", "warning");
      return;
    }
    if (event.status === "error") {
      state.connected = false;
      setBadge(els.connectionBadge, "error", "warning");
      if (event.error) addSystemMessage(`Codex connection failed: ${event.error}`);
      return;
    }
    if (event.status === "disconnected") {
      state.connected = false;
      setBadge(els.connectionBadge, "offline", "warning");
      if (event.error) addSystemMessage(`Codex disconnected: ${event.error}`);
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
    els.sendButton.disabled = true;
    return;
  }

  setBadge(els.connectionBadge, "connecting", "warning");
  await bridge.connect(connection);
  try {
    await rpc("initialize", {
      clientInfo: { name: "codex-review-shell", title: "Codex Review Shell", version: "0.4.0" },
      capabilities: { experimentalApi: true },
    });
    await bridge.notify("initialized", {});
    await loadAccountState();
    await loadExistingThreadOrStartNew();
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
