(() => {
  "use strict";

  const shell = document.getElementById("codexShell");
  const sidebarToggle = document.getElementById("t3SidebarToggle");
  const sidebarNewThread = document.getElementById("t3SidebarNewThread");
  const runtimeDrawer = document.getElementById("runtimeDrawer");
  const runtimeDrawerClose = document.getElementById("runtimeDrawerClose");
  const analyticsPanel = document.getElementById("threadAnalyticsPanel");
  const analyticsClose = document.getElementById("threadAnalyticsPanelClose");
  const intakePanel = document.getElementById("directThreadIntakePanel");
  const coreNewThread = document.getElementById("morphicNewThreadButton");
  const coreAnalytics = document.getElementById("morphicAnalyticsButton");
  const railList = document.getElementById("morphicThreadRailList");
  const utilityRuntimeButtons = Array.from(document.querySelectorAll(".t3-utility-rail [data-runtime-tab]"));
  const utilityAnalyticsButton = document.querySelector('.t3-utility-rail [data-t3-action="analytics"]');
  const utilityIntakeButton = document.querySelector('.t3-utility-rail [data-t3-action="intake"]');
  const experienceWitness = document.getElementById("t3ExperienceWitness");
  const SIDEBAR_KEY = "direct.t3Alternate.sidebar";

  const experience = payload?.appExperience || {};
  const hasExperienceWitness = Boolean(experience.id || experience.controlPlane);
  const experienceValid =
    !hasExperienceWitness ||
    (experience.id === "direct-workbench" &&
      experience.controlPlane === "direct-thread");
  document.body.dataset.experienceState = experienceValid
    ? hasExperienceWitness ? "verified" : "compatibility"
    : "invalid";
  if (experienceWitness) {
    experienceWitness.textContent = experienceValid
      ? "Direct thread control plane"
      : "Control-plane mismatch · interaction disabled";
  }
  if (!experienceValid) {
    const composerInput = document.getElementById("composerInput");
    const sendButton = document.getElementById("sendButton");
    if (composerInput) composerInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
  }

  function storageGet(key, fallback) {
    try {
      return window.localStorage?.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage?.setItem(key, String(value));
    } catch {
      // Layout persistence is optional and has no runtime authority.
    }
  }

  function sidebarExpanded() {
    return shell?.dataset?.t3Sidebar !== "collapsed";
  }

  function setSidebarExpanded(expanded) {
    if (!shell) return;
    shell.dataset.t3Sidebar = expanded ? "expanded" : "collapsed";
    sidebarToggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
    sidebarToggle?.setAttribute("aria-label", expanded ? "Collapse thread sidebar" : "Expand thread sidebar");
    if (sidebarToggle) sidebarToggle.textContent = expanded ? "‹" : "›";
    storageSet(SIDEBAR_KEY, expanded ? "expanded" : "collapsed");
  }

  function syncInspectorState() {
    const runtimeOpen = Boolean(runtimeDrawer && !runtimeDrawer.hidden);
    const analyticsOpen = Boolean(analyticsPanel && !analyticsPanel.hidden);
    const intakeOpen = Boolean(intakePanel && !intakePanel.hidden);
    shell?.toggleAttribute("data-t3-runtime-open", runtimeOpen);
    shell?.toggleAttribute("data-t3-analytics-open", analyticsOpen);
    shell?.toggleAttribute("data-t3-intake-open", intakeOpen);
    for (const button of utilityRuntimeButtons) {
      button.setAttribute("aria-pressed", runtimeOpen ? "true" : "false");
    }
    utilityAnalyticsButton?.setAttribute("aria-pressed", analyticsOpen ? "true" : "false");
    utilityIntakeButton?.setAttribute("aria-pressed", intakeOpen ? "true" : "false");
  }

  setSidebarExpanded(storageGet(SIDEBAR_KEY, "expanded") !== "collapsed");
  syncInspectorState();

  sidebarToggle?.addEventListener("click", () => setSidebarExpanded(!sidebarExpanded()));
  sidebarNewThread?.addEventListener("click", () => coreNewThread?.click());

  document.querySelector('.t3-utility-rail [data-t3-action="threads"]')?.addEventListener("click", () => {
    setSidebarExpanded(true);
    railList?.focus?.({ preventScroll: true });
    railList?.scrollTo?.({ top: 0, behavior: "smooth" });
  });

  utilityAnalyticsButton?.addEventListener("click", () => coreAnalytics?.click());

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-runtime-tab]") && analyticsPanel && !analyticsPanel.hidden) {
      analyticsClose?.click();
    }
    if (target.closest("[data-runtime-tab]") && intakePanel && !intakePanel.hidden) {
      intakePanel.hidden = true;
    }
    if (
      (target.closest('[data-t3-action="analytics"]') || target.closest("#morphicAnalyticsButton")) &&
      runtimeDrawer &&
      !runtimeDrawer.hidden
    ) {
      runtimeDrawerClose?.click();
    }
    if (
      (target.closest('[data-t3-action="analytics"]') || target.closest("#morphicAnalyticsButton")) &&
      intakePanel &&
      !intakePanel.hidden
    ) {
      intakePanel.hidden = true;
    }
  }, true);

  const inspectorObserver = new MutationObserver(syncInspectorState);
  if (runtimeDrawer) inspectorObserver.observe(runtimeDrawer, { attributes: true, attributeFilter: ["hidden"] });
  if (analyticsPanel) inspectorObserver.observe(analyticsPanel, { attributes: true, attributeFilter: ["hidden", "class"] });
  if (intakePanel) inspectorObserver.observe(intakePanel, { attributes: true, attributeFilter: ["hidden"] });
})();
