(() => {
  "use strict";

  // The Workbench sidebar: every project, in a fixed order, with its threads
  // nested under it. One line per thread: a state mark, its title, and the
  // time or what it needs. The project in front is highlighted where it is;
  // nothing moves when it changes. Threads are ordered by when the owner
  // last opened or created them (main's overview), and the order is frozen
  // while the pointer is over the list, so a row never moves under it.
  // Collapsed, the sidebar is a column of project tiles; below 720 px it is
  // a drawer.

  const bridge = window.codexSurfaceBridge;
  const shell = document.getElementById("codexShell");
  const sidebar = document.querySelector(".wb-sidebar");
  const tree = document.getElementById("wbProjectTree");
  const search = document.getElementById("wbThreadSearch");
  const newThreadButton = document.getElementById("wbNewThread");
  const collapseButton = document.getElementById("t3SidebarToggle");
  const drawerToggle = document.getElementById("wbDrawerToggle");
  const accountLabel = document.getElementById("wbAccountLabel");
  const accountAvatar = document.getElementById("wbAccountAvatar");
  const quotaLabel = document.getElementById("wbQuota");
  const settingsButton = document.getElementById("wbSettings");
  const environmentModel = window.DirectEnvironmentUxModel || null;
  if (!sidebar || !tree || typeof bridge?.readDirectWorkbenchThreadOverview !== "function") return;

  const RECENT_PER_PROJECT = 5;
  const COLLAPSED_KEY = "direct.workbench.sidebar.collapsedProjects";
  const WIDTH_KEY = "direct.workbench.sidebar.width";
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 420;

  const view = {
    overview: null,
    query: "",
    collapsed: new Set(readStored(COLLAPSED_KEY, [])),
    showAll: new Set(),
    renaming: "",
    menu: null,
    flyoutProjectId: "",
    pointerInside: false,
    frozenOrder: new Map(),
    error: "",
    busy: "",
  };

  function readStored(key, fallback) {
    try {
      const raw = window.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try {
      window.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      // Layout preferences are optional.
    }
  }

  function el(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function surface() {
    return window.DirectWorkbenchSurface || null;
  }

  // This surface's own project is the one in front whenever the owner can
  // touch it; an overview that arrived while it was in the background may
  // still name another.
  function isFront(row) {
    const own = String(surface()?.projectId?.() || "");
    return own ? row.projectId === own : row.selected === true;
  }

  function currentThreadId() {
    return String(surface()?.currentThreadId?.() || "");
  }

  function timeLabel(value) {
    const parsed = Date.parse(String(value || ""));
    if (!Number.isFinite(parsed)) return "";
    const minutes = Math.round((Date.now() - parsed) / 60000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
  }

  function environmentBadge(row) {
    const workspace = { kind: row.workspaceKind, distro: row.distro };
    return environmentModel?.environmentBadge
      ? environmentModel.environmentBadge(workspace)
      : { kind: row.workspaceKind, text: row.workspaceKind === "wsl" ? `WSL${row.distro ? ` · ${row.distro}` : ""}` : row.workspaceKind === "windows" ? "Windows" : "Local", title: "" };
  }

  function environmentChip(row) {
    const badge = environmentBadge(row);
    const chip = el("span", "wb-env", badge.text);
    chip.dataset.environmentKind = badge.kind;
    if (badge.title) chip.title = badge.title;
    return chip;
  }

  function initials(name) {
    const words = String(name || "?").split(/[\s_\-./]+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2);
    return letters.toUpperCase();
  }

  function pill(kind, text) {
    const node = el("span", `wb-pill ${kind}`, text);
    node.dataset.state = kind;
    return node;
  }

  function mark(state) {
    const node = el("span", `wb-mark ${state}`);
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  // Threads to show for a project: the recent ones plus anything that needs
  // attention, in the overview's order (frozen while the pointer is over
  // the list).
  // An Appserver project's threads come from the surface's own thread list
  // while the project is in front; null when it isn't (nothing lists them
  // then).
  function appServerThreads(row) {
    if (!isFront(row)) return null;
    const waiting = row.waitingThreads || {};
    return (surface()?.threadRows?.() || []).map((thread) => {
      const needsYou = Number(waiting[thread.threadId] || 0);
      return {
        threadId: String(thread.threadId || ""),
        title: String(thread.title || "Untitled thread"),
        updatedAt: String(thread.updatedAt || ""),
        state: needsYou ? "needs_you" : thread.running ? "running" : "idle",
        running: thread.running === true,
        unread: false,
        needsYouCount: needsYou,
        renamable: false,
      };
    }).filter((thread) => thread.threadId);
  }

  function rowThreads(row) {
    if (row.threadSource === "app-server") return appServerThreads(row);
    return Array.isArray(row.threads) ? row.threads : [];
  }

  function visibleThreads(row) {
    const listed = rowThreads(row);
    if (!listed) return { threads: [], hidden: 0, unlisted: true };
    let threads = listed.slice();
    const frozen = view.frozenOrder.get(row.projectId);
    if (view.pointerInside && frozen) {
      const position = new Map(frozen.map((id, index) => [id, index]));
      threads.sort((left, right) => (position.get(left.threadId) ?? -1) - (position.get(right.threadId) ?? -1));
    }
    if (view.query) {
      const query = view.query.toLowerCase();
      return { threads: threads.filter((thread) => thread.title.toLowerCase().includes(query)), hidden: 0 };
    }
    if (view.showAll.has(row.projectId)) return { threads, hidden: 0 };
    const shown = threads.filter((thread, index) => index < RECENT_PER_PROJECT || thread.state !== "idle");
    return { threads: shown, hidden: threads.length - shown.length + Number(row.moreThreadCount || 0) };
  }

  function threadRow(row, thread) {
    const selected = isFront(row) && thread.threadId === currentThreadId();
    const button = el("button", `wb-thread${selected ? " selected" : ""}${thread.state !== "idle" ? ` ${thread.state.replace("_", "-")}` : ""}`);
    button.type = "button";
    button.dataset.threadId = thread.threadId;
    button.dataset.projectId = row.projectId;
    button.dataset.state = thread.state;
    if (thread.renamable === false) button.dataset.renamable = "false";
    button.title = thread.title;
    if (selected) button.setAttribute("aria-current", "true");
    button.append(mark(thread.state));
    if (view.renaming === thread.threadId) {
      const input = el("input", "wb-rename");
      input.value = thread.title;
      input.setAttribute("aria-label", "Thread name");
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") commitRename(thread, input.value);
        if (event.key === "Escape") cancelRename();
      });
      input.addEventListener("blur", () => commitRename(thread, input.value));
      button.append(input);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    } else {
      button.append(el("span", "wb-thread-title", thread.title));
    }
    const meta = el("span", "wb-thread-meta");
    if (thread.state === "needs_you") meta.append(pill("needs-you", thread.needsYouCount > 1 ? `needs you · ${thread.needsYouCount}` : "needs you"));
    else if (thread.state === "running") meta.append(pill("running", "running"));
    else meta.append(el("span", "wb-time", timeLabel(thread.updatedAt)));
    button.append(meta);
    button.addEventListener("click", () => openThread(row, thread));
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (thread.renamable !== false) startRename(thread.threadId);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(event.clientX, event.clientY, threadMenuItems(row, thread));
    });
    return button;
  }

  function projectGroup(row) {
    const { threads, hidden, unlisted } = visibleThreads(row);
    if (view.query && !threads.length) return null;
    const collapsed = !view.query && view.collapsed.has(row.projectId);
    const group = el("section", `wb-project${isFront(row) ? " front" : ""}`);
    group.dataset.projectId = row.projectId;
    const header = el("div", "wb-project-header");
    const toggle = el("button", "wb-project-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed ? `Show ${row.displayName}'s threads` : `Hide ${row.displayName}'s threads`;
    toggle.append(el("span", "wb-chevron", collapsed ? "▸" : "▾"), el("span", "wb-project-name", row.displayName));
    toggle.addEventListener("click", () => toggleProject(row.projectId));
    header.append(toggle);
    const badges = el("span", "wb-project-badges");
    if (collapsed && row.needsYouCount) badges.append(pill("needs-you", row.needsYouCount > 1 ? `${row.needsYouCount} need you` : "needs you"));
    if (collapsed && row.runningCount) badges.append(pill("running", `${row.runningCount} running`));
    badges.append(environmentChip(row));
    header.append(badges);
    const more = el("button", "wb-project-more", "⋯");
    more.type = "button";
    more.setAttribute("aria-label", `Actions for ${row.displayName}`);
    more.title = "Project actions";
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const box = more.getBoundingClientRect();
      openMenu(box.right - 4, box.bottom + 2, projectMenuItems(row));
    });
    header.append(more);
    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(event.clientX, event.clientY, projectMenuItems(row));
    });
    group.append(header);
    if (!collapsed) {
      const list = el("div", "wb-threads");
      for (const thread of threads) list.append(threadRow(row, thread));
      if (unlisted) {
        // An Appserver project's threads are listed once it is open.
        const open = el("button", "wb-empty-start", row.needsYouCount ? "Waiting for you · Open to see its threads" : "Open to see its threads");
        open.type = "button";
        open.addEventListener("click", () => run("open", () => bridge.openDirectWorkbenchThread({ projectId: row.projectId, threadId: "" })));
        list.append(open);
      } else if (!threads.length) {
        const start = el("button", "wb-empty-start", "No threads yet · Start one");
        start.type = "button";
        start.addEventListener("click", () => newThread(row));
        list.append(start);
      }
      if (hidden > 0) {
        const expand = el("button", "wb-show-more", `Show ${hidden} more`);
        expand.type = "button";
        expand.addEventListener("click", () => {
          view.showAll.add(row.projectId);
          render();
          // Main sends only the recent threads until a list is expanded.
          if (Number(row.moreThreadCount || 0) > 0) refresh();
        });
        list.append(expand);
      } else if (view.showAll.has(row.projectId) && !view.query) {
        const less = el("button", "wb-show-more", "Show less");
        less.type = "button";
        less.addEventListener("click", () => {
          view.showAll.delete(row.projectId);
          render();
          refresh();
        });
        list.append(less);
      }
      group.append(list);
    }
    return group;
  }

  function projectTile(row) {
    const tile = el("button", `wb-tile${isFront(row) ? " front" : ""}`, initials(row.displayName));
    tile.type = "button";
    tile.dataset.projectId = row.projectId;
    tile.dataset.environmentKind = environmentBadge(row).kind;
    tile.title = `${row.displayName} · ${environmentBadge(row).text}`;
    if (row.needsYouCount) tile.append(el("span", "wb-tile-dot needs-you"));
    else if (row.runningCount) tile.append(el("span", "wb-tile-dot running"));
    tile.addEventListener("mouseenter", () => showFlyout(row.projectId));
    tile.addEventListener("focus", () => showFlyout(row.projectId));
    tile.addEventListener("click", () => showFlyout(row.projectId, true));
    return tile;
  }

  function renderFlyout() {
    sidebar.querySelector(".wb-flyout")?.remove();
    const row = (view.overview?.projects || []).find((entry) => entry.projectId === view.flyoutProjectId);
    if (!row || !isCollapsed()) return;
    const tile = tree.querySelector(`.wb-tile[data-project-id="${CSS.escape(row.projectId)}"]`);
    const flyout = el("div", "wb-flyout");
    flyout.setAttribute("role", "dialog");
    flyout.setAttribute("aria-label", `${row.displayName} threads`);
    const head = el("div", "wb-flyout-head");
    head.append(el("span", "wb-project-name", row.displayName), environmentChip(row));
    flyout.append(head);
    const { threads, unlisted } = visibleThreads(row);
    for (const thread of threads) flyout.append(threadRow(row, thread));
    const start = el("button", "wb-empty-start", threads.length || unlisted ? "New thread here" : "No threads yet · Start one");
    start.type = "button";
    start.addEventListener("click", () => newThread(row));
    flyout.append(start);
    flyout.style.top = `${Math.max(8, (tile?.offsetTop || 60) - 6)}px`;
    flyout.addEventListener("mouseleave", () => hideFlyoutSoon());
    flyout.addEventListener("mouseenter", () => clearTimeout(view.flyoutTimer));
    sidebar.append(flyout);
  }

  function showFlyout(projectId, pinned = false) {
    clearTimeout(view.flyoutTimer);
    view.flyoutProjectId = projectId;
    view.flyoutPinned = pinned;
    renderFlyout();
  }

  function hideFlyoutSoon() {
    if (view.flyoutPinned) return;
    clearTimeout(view.flyoutTimer);
    view.flyoutTimer = setTimeout(() => {
      view.flyoutProjectId = "";
      renderFlyout();
    }, 250);
  }

  function isCollapsed() {
    return shell?.dataset?.t3Sidebar === "collapsed" && !window.matchMedia?.("(max-width: 720px)")?.matches;
  }

  function render() {
    const rows = Array.isArray(view.overview?.projects) ? view.overview.projects : [];
    tree.replaceChildren();
    if (isCollapsed()) {
      tree.classList.add("tiles");
      for (const row of rows) tree.append(projectTile(row));
      renderFlyout();
      return;
    }
    tree.classList.remove("tiles");
    sidebar.querySelector(".wb-flyout")?.remove();
    let shown = 0;
    for (const row of rows) {
      const group = projectGroup(row);
      if (group) {
        tree.append(group);
        shown += 1;
      }
    }
    if (view.query && !shown) tree.append(el("p", "wb-note", `No thread titles match "${view.query}".`));
    if (!rows.length && !view.overview) tree.append(el("p", "wb-note", "Loading projects…"));
    if (!view.query) {
      const add = el("button", "wb-new-project", "＋ New project");
      add.type = "button";
      add.addEventListener("click", () => window.DirectProjectDirectory?.createProject?.());
      tree.append(add);
    }
    if (view.error) tree.append(el("p", "wb-note warning", errorLabel(view.error)));
  }

  function errorLabel(code) {
    const labels = {
      thread_not_in_project: "That thread moved or was removed.",
      project_activation_in_progress: "Another project is opening; try again in a moment.",
      project_binding_mutation_in_progress: "A project is being saved; try again in a moment.",
      project_activation_source_stale: "Projects changed; try again.",
      project_catalog_revision_stale: "Projects changed; try again.",
      project_binding_archived: "That project is archived.",
      folder_not_reachable_from_this_host: "That folder isn't reachable from this machine.",
      thread_title_required: "A thread needs a name.",
    };
    return labels[code] || code || "That didn't work. Try again.";
  }

  // Electron passes a main-process error's message, not its code: "Error
  // invoking remote method '…': Error: <message>".
  function reasonFrom(error) {
    if (error?.code) return error.code;
    const message = String(error?.message || "").split(/Error: /).pop().trim();
    return /^[a-z][a-z0-9_]+$/.test(message) ? message : message || "failed";
  }

  async function run(label, action) {
    view.error = "";
    try {
      const result = await action();
      if (result?.ok === false) throw Object.assign(new Error(result.reason || "failed"), { code: result.reason });
    } catch (error) {
      view.error = reasonFrom(error);
      render();
    }
  }

  function closeDrawer() {
    if (shell?.dataset?.wbDrawer === "open") shell.dataset.wbDrawer = "closed";
  }

  function openThread(row, thread) {
    closeDrawer();
    if (view.flyoutProjectId) {
      view.flyoutProjectId = "";
      renderFlyout();
    }
    if (isFront(row)) {
      if (thread.threadId === currentThreadId()) return;
      return run("open", () => surface()?.openThread?.(thread.threadId));
    }
    return run("open", () => bridge.openDirectWorkbenchThread({ projectId: row.projectId, threadId: thread.threadId }));
  }

  function newThread(row = null) {
    closeDrawer();
    const target = row || (view.overview?.projects || []).find((entry) => isFront(entry));
    if (!target || isFront(target)) {
      return run("new", async () => {
        await surface()?.newThread?.();
        surface()?.focusComposer?.();
      });
    }
    return run("new", () => bridge.newDirectWorkbenchThread({ projectId: target.projectId }));
  }

  function toggleProject(projectId) {
    if (view.collapsed.has(projectId)) view.collapsed.delete(projectId);
    else view.collapsed.add(projectId);
    writeStored(COLLAPSED_KEY, [...view.collapsed]);
    render();
  }

  function startRename(threadId) {
    view.renaming = threadId;
    render();
  }

  // Ending a rename lets through the overviews held back while it was open.
  function afterRename() {
    signature = "";
    if (view.overview) apply(view.overview);
    else render();
  }

  function cancelRename() {
    view.renaming = "";
    afterRename();
  }

  function commitRename(thread, value) {
    if (view.renaming !== thread.threadId) return;
    view.renaming = "";
    const title = String(value || "").trim();
    if (!title || title === thread.title) {
      afterRename();
      return;
    }
    thread.title = title;
    afterRename();
    run("rename", async () => {
      const result = await bridge.renameDirectWorkbenchThread({ threadId: thread.threadId, title });
      // Main's overview, with the saved name, replaces the local edit.
      signature = "";
      await refresh();
      return result;
    });
  }

  function projectMenuItems(row) {
    return [
      { label: "New thread here", action: () => newThread(row) },
      { label: "Open folder", action: () => run("folder", () => bridge.openDirectWorkbenchProjectFolder({ projectId: row.projectId })) },
      { label: "Edit project…", action: () => window.DirectProjectDirectory?.editProject?.(row.projectId) },
      { label: view.collapsed.has(row.projectId) ? "Show threads" : "Hide threads", action: () => toggleProject(row.projectId) },
      { separator: true },
      isFront(row)
        ? { label: "Archive project…", disabled: true, title: "Switch to another project to archive this one." }
        : { label: "Archive project…", danger: true, action: () => window.DirectProjectDirectory?.openLifecycle?.(row.projectId) },
    ];
  }

  function threadMenuItems(row, thread) {
    return [
      { label: "Open", action: () => openThread(row, thread) },
      thread.renamable === false
        ? { label: "Rename…", disabled: true, title: "Appserver threads keep the Appserver's names." }
        : { label: "Rename…", action: () => startRename(thread.threadId) },
    ];
  }

  function closeMenu() {
    view.menu?.remove();
    view.menu = null;
  }

  function openMenu(x, y, items) {
    closeMenu();
    const menu = el("div", "wb-menu");
    menu.setAttribute("role", "menu");
    for (const item of items) {
      if (item.separator) {
        menu.append(el("div", "wb-menu-separator"));
        continue;
      }
      const entry = el("button", `wb-menu-item${item.danger ? " danger" : ""}`, item.label);
      entry.type = "button";
      entry.setAttribute("role", "menuitem");
      entry.disabled = item.disabled === true;
      if (item.title) entry.title = item.title;
      entry.addEventListener("click", () => {
        closeMenu();
        item.action?.();
      });
      menu.append(entry);
    }
    document.body.append(menu);
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    view.menu = menu;
    menu.querySelector(".wb-menu-item:not(:disabled)")?.focus();
  }

  function renderFooter() {
    const account = surface()?.account?.() || {};
    if (accountLabel) accountLabel.textContent = account.label || "Signed in";
    if (accountAvatar) {
      const initial = String(account.initial || "").replace("·", "").slice(0, 1).toUpperCase();
      accountAvatar.textContent = initial;
      accountAvatar.hidden = !initial;
    }
    if (quotaLabel) quotaLabel.textContent = account.quota || "";
  }

  // Publishes what the surface's own thread list asks about (kept for code
  // that still reads it).
  let waiting = new Map();
  window.DirectWorkbenchOverview = Object.freeze({
    needsYouCount: (threadId) => waiting.get(String(threadId || "")) || 0,
  });

  let signature = "";
  function apply(overview) {
    if (overview?.schema !== "direct_workbench_thread_overview@1") return;
    view.overview = overview;
    const front = (overview.projects || []).find((row) => isFront(row));
    waiting = new Map((rowThreads(front || {}) || []).filter((thread) => thread.state === "needs_you").map((thread) => [thread.threadId, thread.needsYouCount]));
    if (!view.pointerInside) {
      view.frozenOrder = new Map((overview.projects || []).map((row) => [row.projectId, (rowThreads(row) || []).map((thread) => thread.threadId)]));
    }
    // Only a real change redraws (overviews arrive every few seconds while
    // work runs); the selected thread and an Appserver project's list are
    // part of it.
    const next = JSON.stringify([overview.projects, currentThreadId(), front?.threadSource === "app-server" ? rowThreads(front) : null]);
    if (next !== signature && !view.renaming) {
      signature = next;
      render();
    }
    renderFooter();
  }

  // Main sends each project's recent threads; an expanded list, or a search,
  // asks it for all of them.
  async function refresh() {
    try {
      apply(await bridge.readDirectWorkbenchThreadOverview({
        expandedProjectIds: [...view.showAll],
        allThreads: Boolean(view.query),
      }));
    } catch {
      // The last overview stays; the next event refreshes it.
    }
  }

  // Keyboard: move through the visible rows with the arrows, Enter opens,
  // F2 renames the focused thread.
  tree.addEventListener("keydown", (event) => {
    const rows = [...tree.querySelectorAll(".wb-thread, .wb-project-toggle")];
    const index = rows.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      next?.focus();
    } else if (event.key === "F2" && document.activeElement?.classList?.contains("wb-thread") && document.activeElement.dataset.renamable !== "false") {
      event.preventDefault();
      startRename(document.activeElement.dataset.threadId);
    }
  });
  tree.addEventListener("mouseenter", () => { view.pointerInside = true; });
  tree.addEventListener("mouseleave", () => {
    view.pointerInside = false;
    hideFlyoutSoon();
    if (view.overview) {
      signature = "";
      apply(view.overview);
    }
  });

  search?.addEventListener("input", () => {
    const wasSearching = Boolean(view.query);
    view.query = search.value.trim();
    render();
    if (wasSearching !== Boolean(view.query)) refresh();
  });
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const wasSearching = Boolean(view.query);
      search.value = "";
      view.query = "";
      render();
      if (wasSearching) refresh();
      search.blur();
    } else if (event.key === "Enter") {
      tree.querySelector(".wb-thread")?.click();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      tree.querySelector(".wb-thread")?.focus();
    }
  });

  newThreadButton?.addEventListener("click", () => newThread());
  settingsButton?.addEventListener("click", () => document.getElementById("morphicSettingsButton")?.click());
  drawerToggle?.addEventListener("click", () => {
    if (!shell) return;
    shell.dataset.wbDrawer = shell.dataset.wbDrawer === "open" ? "closed" : "open";
  });
  // t3-direct-surface.js owns the collapse toggle; the tree redraws for it.
  collapseButton?.addEventListener("click", () => setTimeout(() => {
    signature = "";
    if (view.overview) apply(view.overview);
    else render();
  }, 0));
  document.querySelector('.t3-utility-rail [data-t3-action="threads"]')?.addEventListener("click", () => setTimeout(render, 0));

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k") {
      event.preventDefault();
      if (shell?.dataset?.t3Sidebar === "collapsed") collapseButton?.click();
      if (window.matchMedia?.("(max-width: 720px)")?.matches && shell) shell.dataset.wbDrawer = "open";
      setTimeout(() => search?.focus(), 0);
    } else if (key === "n" && !event.shiftKey) {
      event.preventDefault();
      newThread();
    } else if (key === "b") {
      event.preventDefault();
      collapseButton?.click();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (view.menu && !view.menu.contains(event.target)) closeMenu();
    if (view.flyoutPinned && !event.target.closest?.(".wb-flyout, .wb-tile")) {
      view.flyoutPinned = false;
      view.flyoutProjectId = "";
      renderFlyout();
    }
    if (shell?.dataset?.wbDrawer === "open" && !event.target.closest?.(".wb-sidebar, #wbDrawerToggle")) closeDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  // Width: drag the sidebar's edge (remembered).
  const handle = el("div", "wb-resize");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.title = "Drag to resize";
  sidebar.append(handle);
  const applyWidth = (width) => {
    const value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
    shell?.style.setProperty("--t3-sidebar-width", `${value}px`);
    return value;
  };
  const storedWidth = Number(readStored(WIDTH_KEY, 0));
  if (storedWidth) applyWidth(storedWidth);
  handle.addEventListener("pointerdown", (event) => {
    if (isCollapsed()) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const left = sidebar.getBoundingClientRect().left;
    const move = (moveEvent) => applyWidth(moveEvent.clientX - left);
    const up = (upEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      writeStored(WIDTH_KEY, applyWidth(upEvent.clientX - left));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("dblclick", () => {
    shell?.style.removeProperty("--t3-sidebar-width");
    writeStored(WIDTH_KEY, 0);
  });

  bridge.onDirectWorkbenchThreadOverviewEvent?.(apply);
  // The thread on screen changes without an overview (opening one in this
  // project): redraw the selection.
  window.addEventListener("direct-workbench-thread-shown", () => {
    signature = "";
    if (view.overview) apply(view.overview);
  });
  // An Appserver project's thread list is the surface's; apply redraws only
  // when it actually changed.
  window.addEventListener("direct-workbench-surface-threads-changed", () => {
    if (view.overview) apply(view.overview);
  });
  setInterval(() => {
    renderFooter();
    // Relative times age.
    if (!view.pointerInside && !view.renaming && view.overview && !isCollapsed()) render();
  }, 60_000);
  render();
  refresh();
})();
