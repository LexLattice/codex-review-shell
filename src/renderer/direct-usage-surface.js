(() => {
  "use strict";

  const page = document.getElementById("directUsagePage");
  const body = document.getElementById("directUsageBody");
  const status = document.getElementById("directUsageStatus");
  const subtitle = document.getElementById("directUsageSubtitle");
  const refreshButton = document.getElementById("directUsageRefresh");
  const closeButton = document.getElementById("directUsageClose");
  const openButton = document.querySelector('.t3-utility-rail [data-t3-action="usage"]');
  const windowButtons = Array.from(document.querySelectorAll("[data-usage-window]"));
  if (!page || !body || !status || !openButton) return;

  const surfaceState = {
    windowDays: 30,
    requestId: 0,
    snapshot: null,
  };

  const providerPalette = ["#4aa8e8", "#e58a45", "#9b8cff", "#5ec7a1", "#df6f9f", "#d8b85a"];
  const knownProviders = Object.freeze({
    codex: Object.freeze({ label: "Codex", color: providerPalette[0] }),
    claude: Object.freeze({ label: "Claude", color: providerPalette[1] }),
  });

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function compact(value) {
    const amount = number(value);
    if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
    if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
    if (amount >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
    return Math.round(amount).toLocaleString("en-US");
  }

  function usd(value) {
    const amount = number(value);
    return amount >= 1000
      ? `$${Math.round(amount).toLocaleString("en-US")}`
      : `$${amount.toFixed(amount < 10 ? 2 : 0)}`;
  }

  function percent(numerator, denominator) {
    const total = number(denominator);
    return total <= 0 ? "0%" : `${((number(numerator) / total) * 100).toFixed(1)}%`;
  }

  function normalizedProviderId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function inferredProviderLabel(provider) {
    return provider
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
      .join(" ") || "Unknown provider";
  }

  function providerColor(provider) {
    if (knownProviders[provider]?.color) return knownProviders[provider].color;
    let hash = 0;
    for (const character of provider) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return providerPalette[Math.abs(hash) % providerPalette.length];
  }

  function detectedProviders(snapshot) {
    const explicit = Array.isArray(snapshot?.providers) ? snapshot.providers : null;
    const candidates = explicit || (snapshot?.sources || [])
      .filter((source) => source?.available === true)
      .map((source) => ({ provider: source.provider, detected: true }));
    const seen = new Set();
    return candidates.flatMap((candidate) => {
      if (candidate?.detected !== true) return [];
      const provider = normalizedProviderId(candidate.provider);
      if (!provider || seen.has(provider)) return [];
      seen.add(provider);
      return [{
        provider,
        label: String(candidate.label || knownProviders[provider]?.label || inferredProviderLabel(provider)),
        color: providerColor(provider),
        threadCount: number(candidate.threadCount),
      }];
    });
  }

  function totalHistoricalTokens(snapshot) {
    const tokens = snapshot?.tokens || {};
    return number(tokens.inputTokens) + number(tokens.outputTokens) +
      number(tokens.cacheReadTokens) + number(tokens.cacheWriteTokens);
  }

  function section(title, detail = "", className = "") {
    const root = element("section", `direct-usage-section ${className}`.trim());
    const header = element("header", "direct-usage-section-header");
    header.append(element("h3", "", title));
    if (detail) header.append(element("span", "", detail));
    root.append(header);
    return root;
  }

  function renderStats(snapshot) {
    const grid = element("section", "direct-usage-stat-grid");
    const tokens = snapshot.tokens || {};
    const activity = snapshot.direct?.projectActivity || {};
    const agent = snapshot.direct?.agentUsage || {};
    const agentTotals = agent.totals || {};
    const billableInput = number(tokens.inputTokens) + number(tokens.cacheReadTokens) + number(tokens.cacheWriteTokens);
    const rate = snapshot.rateLimits?.[0] || activity.rateLimits?.primary || null;
    const toolTotal = number(activity.tools?.total);
    const partial = snapshot.evidencePosture?.scanCompleteness === "partial_lower_bound";
    const stats = [
      [partial ? "Lower-bound spend" : "Estimated spend", usd(snapshot.costUsd), `${snapshot.firstDate || "no data"} to ${snapshot.lastDate || "now"}`],
      ["Local log tokens", compact(totalHistoricalTokens(snapshot)), `${compact(snapshot.messages)} usage deltas`],
      ["Cache hit", percent(tokens.cacheReadTokens, billableInput), `${compact(tokens.cacheReadTokens)} reused`],
      ["Direct turns", compact(agentTotals.turnCount), `${compact(agent.rowCount)} attributed rows`],
      ["Tool success", percent(toolTotal - number(activity.tools?.failed), toolTotal), `${compact(toolTotal)} project calls`],
      rate
        ? ["Current limit", `${Math.round(number(rate.usedPercent))}%`, `${rate.planType || activity.rateLimits?.planType || "plan"} · observed evidence`]
        : ["Missing usage", compact(agentTotals.missingUsageRowCount), "missing provider rows are not zero"],
    ];
    for (const [label, value, detail] of stats) {
      const tile = element("div", "direct-usage-stat");
      tile.append(
        element("div", "direct-usage-stat-label", label),
        element("div", "direct-usage-stat-value", value),
        element("div", "direct-usage-stat-detail", detail),
      );
      grid.append(tile);
    }
    return grid;
  }

  function filledDays(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return Array.isArray(rows) ? rows : [];
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const first = Date.parse(`${rows[0].date}T00:00:00.000Z`);
    const last = Date.parse(`${rows.at(-1).date}T00:00:00.000Z`);
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return rows;
    const length = Math.min(400, Math.round((last - first) / 86_400_000) + 1);
    return Array.from({ length }, (_, index) => {
      const date = new Date(first + index * 86_400_000).toISOString().slice(0, 10);
      return byDate.get(date) || { date, costUsd: 0, totalTokens: 0, byProvider: [] };
    });
  }

  function renderChart(snapshot) {
    const root = section("Estimated spend per day", "local session logs");
    const rows = filledDays(snapshot.daily);
    if (!rows.length) {
      root.append(element("p", "direct-usage-empty", "No local provider usage was recorded in this window."));
      return root;
    }
    const providers = detectedProviders(snapshot);
    const max = Math.max(0.01, ...rows.map((row) => number(row.costUsd)));
    const chart = element("div", "direct-usage-chart");
    for (const row of rows) {
      const day = element("div", "direct-usage-day");
      const breakdown = providers.map((provider) => ({
        ...provider,
        costUsd: number(row.byProvider?.find((entry) => entry.provider === provider.provider)?.costUsd),
      }));
      day.title = `${row.date}: ${usd(row.costUsd)}${breakdown.length ? ` (${breakdown.map((entry) => `${entry.label} ${usd(entry.costUsd)}`).join(", ")})` : ""}`;
      for (const provider of breakdown) {
        const bar = element("span", "direct-usage-provider-segment");
        bar.dataset.provider = provider.provider;
        bar.style.backgroundColor = provider.color;
        bar.style.height = `${Math.max(provider.costUsd > 0 ? 1 : 0, (provider.costUsd / max) * 100)}%`;
        day.append(bar);
      }
      chart.append(day);
    }
    const legend = element("div", "direct-usage-chart-legend");
    const keys = element("span", "direct-usage-chart-legend-key");
    for (const provider of providers) {
      const key = element("span", "direct-usage-provider-swatch", provider.label);
      key.dataset.provider = provider.provider;
      key.style.setProperty("--provider-color", provider.color);
      keys.append(key);
    }
    legend.append(element("span", "", rows[0].date), keys, element("span", "", rows.at(-1).date));
    root.append(chart, legend);
    return root;
  }

  function table(headers, rows) {
    const wrap = element("div", "direct-usage-table-wrap");
    const tableNode = element("table", "direct-usage-table");
    const head = element("thead");
    const headRow = element("tr");
    for (const header of headers) headRow.append(element("th", "", header));
    head.append(headRow);
    const tableBody = element("tbody");
    for (const cells of rows) {
      const row = element("tr");
      for (const cell of cells) {
        const td = element("td", cell.className || "");
        if (cell.node) td.append(cell.node);
        else td.textContent = cell.text;
        if (cell.title) td.title = cell.title;
        row.append(td);
      }
      tableBody.append(row);
    }
    tableNode.append(head, tableBody);
    wrap.append(tableNode);
    return wrap;
  }

  function renderModels(snapshot) {
    const providers = detectedProviders(snapshot);
    const providerById = new Map(providers.map((provider) => [provider.provider, provider]));
    const models = (snapshot.models || []).filter((model) => providerById.has(normalizedProviderId(model.provider)));
    const root = section("Models", `${models.length} observed`, "full");
    const rows = models.map((model) => {
      const provider = providerById.get(normalizedProviderId(model.provider));
      const label = element("span");
      const mark = element("span", "direct-usage-provider-mark");
      mark.style.setProperty("--provider-color", provider.color);
      mark.title = provider.label;
      label.append(mark);
      label.append(document.createTextNode(model.model));
      const modelTokens = Object.values(model.tokens || {}).reduce((sum, value) => sum + number(value), 0);
      return [
        { node: label },
        { text: compact(modelTokens) },
        { text: compact(model.messages) },
        model.pricingKnown
          ? { text: `${usd(model.costUsd)} · ${percent(model.costUsd, snapshot.costUsd)}` }
          : { text: "unpriced", className: "direct-usage-unpriced", title: "No pricing entry matched this model." },
      ];
    });
    root.append(rows.length
      ? table(["Model", "Tokens", "Deltas", "Estimated cost"], rows)
      : element("p", "direct-usage-empty", "No models were recorded."));
    return root;
  }

  function renderSources(snapshot) {
    const root = section("Sources", "read-only scan");
    const providers = detectedProviders(snapshot);
    const providerById = new Map(providers.map((provider) => [provider.provider, provider]));
    const rows = (snapshot.sources || [])
      .filter((source) => providerById.has(normalizedProviderId(source.provider)))
      .map((source) => [
      { text: source.provider },
      { text: compact(source.rootsScanned) },
      { text: compact(source.filesScanned) },
      { text: compact(source.recordsRead) },
      { text: source.truncated ? "partial" : source.available ? "available" : "empty" },
    ]);
    root.append(rows.length
      ? table(["Provider", "Roots", "Sessions", "Records", "State"], rows)
      : element("p", "direct-usage-empty", "No provider thread sources were detected."));
    return root;
  }

  function renderProjects(snapshot) {
    const root = section("Historical projects", "inferred from cwd", "full");
    const rows = (snapshot.projects || []).slice(0, 10).map((entry) => [
      { text: entry.project },
      { text: compact(entry.totalTokens) },
      { text: compact(entry.messages) },
      { text: usd(entry.costUsd) },
    ]);
    root.append(rows.length
      ? table(["Project label", "Tokens", "Deltas", "Estimated cost"], rows)
      : element("p", "direct-usage-empty", "No project labels were recovered from local logs."));
    return root;
  }

  function barList(items, valueFor, options = {}) {
    if (!items.length) return element("p", "direct-usage-empty", options.empty || "No evidence recorded.");
    const values = items.map(valueFor);
    const max = Math.max(1, ...values);
    const list = element("div", `direct-usage-bars ${options.accent || ""}`.trim());
    items.slice(0, 8).forEach((item, index) => {
      const row = element("div", "direct-usage-bar-row");
      const track = element("span", "direct-usage-bar-track");
      const fill = element("span", "direct-usage-bar-fill");
      fill.style.width = `${Math.max(2, (values[index] / max) * 100)}%`;
      track.append(fill);
      row.append(
        element("span", "direct-usage-bar-label", options.labelFor(item)),
        track,
        element("span", "direct-usage-bar-value", compact(values[index])),
      );
      list.append(row);
    });
    return list;
  }

  function renderDirectEvidence(snapshot) {
    const activity = snapshot.direct?.projectActivity || {};
    const agent = snapshot.direct?.agentUsage || {};
    const tools = (activity.tools?.byKind || []).map((item) => ({ label: item.xValue, value: number(item.yValue) }));
    const agents = Array.isArray(agent.byAgent) ? agent.byAgent : [];
    const workThreads = Array.isArray(agent.byWorkThread) ? agent.byWorkThread : [];
    const grid = element("div", "direct-usage-section-grid equal");
    const toolsSection = section("Direct tools", activity.confidence || "evidence unavailable");
    toolsSection.append(barList(tools, (item) => item.value, {
      labelFor: (item) => item.label,
      empty: "No project-scoped tool evidence is available.",
    }));
    const agentsSection = section("Direct agents", "provider-attributed tokens");
    agentsSection.append(barList(agents, (item) => number(item.totals?.totalTokensKnown), {
      labelFor: (item) => item.label || item.key,
      accent: "violet",
      empty: "No Direct agent usage rows are available.",
    }));
    grid.append(toolsSection, agentsSection);

    const work = section("Direct workthreads", "exact where provider reported", "full");
    work.append(barList(workThreads, (item) => number(item.totals?.totalTokensKnown), {
      labelFor: (item) => item.label || item.key,
      accent: "green",
      empty: "No workthread-attributed usage rows are available.",
    }));
    return [grid, work];
  }

  function render(snapshot) {
    body.replaceChildren();
    const note = element(
      "p",
      "direct-usage-evidence-note",
      `Estimated spend is reconstructed from local session logs with static pricing revision ${snapshot.evidencePosture?.pricingRevision || "unknown"}. It is not billing-grade.${snapshot.evidencePosture?.scanCompleteness === "partial_lower_bound" ? " The bounded scan reached its read budget, so displayed historical totals are lower bounds." : ""} Direct project rows below preserve exact provider attribution and explicitly count missing usage as unknown, not zero.`,
    );
    body.append(note, renderStats(snapshot));
    const firstGrid = element("div", "direct-usage-section-grid");
    firstGrid.append(renderChart(snapshot), renderSources(snapshot));
    body.append(firstGrid, renderModels(snapshot), renderProjects(snapshot));
    for (const node of renderDirectEvidence(snapshot)) body.append(node);
    subtitle.textContent = `${snapshot.scope?.projectLabel || "Selected project"} · ${snapshot.scope?.windowDays || surfaceState.windowDays} day window`;
  }

  function setLoading(loading) {
    refreshButton.disabled = loading;
    for (const button of windowButtons) button.disabled = loading;
    if (loading) {
      status.dataset.state = "loading";
      status.textContent = "Scanning local provider logs and reading Direct usage evidence…";
    }
  }

  async function load(options = {}) {
    const requestId = ++surfaceState.requestId;
    setLoading(true);
    try {
      const snapshot = await bridge.getDirectUsageOverview(project?.id || "", {
        windowDays: surfaceState.windowDays,
        refresh: options.refresh === true,
      });
      if (requestId !== surfaceState.requestId) return;
      surfaceState.snapshot = snapshot;
      render(snapshot);
      status.dataset.state = "ready";
      status.textContent = `Updated ${snapshot.generatedAt || "now"} · local historical scope + selected-project Direct evidence`;
    } catch (error) {
      if (requestId !== surfaceState.requestId) return;
      status.dataset.state = "error";
      status.textContent = error?.message || "Usage evidence could not be loaded.";
      body.replaceChildren(element("p", "direct-usage-empty", "The usage page remains read-only. Retry when its local evidence sources are available."));
    } finally {
      if (requestId === surfaceState.requestId) setLoading(false);
    }
  }

  function setOpen(open) {
    page.hidden = !open;
    openButton.setAttribute("aria-pressed", open ? "true" : "false");
    document.getElementById("codexShell")?.toggleAttribute("data-t3-usage-open", open);
    if (open) {
      document.getElementById("runtimeDrawerClose")?.click();
      document.getElementById("threadAnalyticsPanelClose")?.click();
      document.getElementById("directThreadIntakeClose")?.click();
      document.getElementById("directProjectBindingEditorClose")?.click();
      document.getElementById("directProjectLifecycleClose")?.click();
      if (!surfaceState.snapshot) void load();
    }
  }

  openButton.addEventListener("click", () => setOpen(page.hidden));
  closeButton?.addEventListener("click", () => setOpen(false));
  refreshButton?.addEventListener("click", () => void load({ refresh: true }));
  for (const button of windowButtons) {
    button.addEventListener("click", () => {
      surfaceState.windowDays = Number(button.dataset.usageWindow) || 30;
      for (const candidate of windowButtons) {
        candidate.setAttribute("aria-pressed", candidate === button ? "true" : "false");
      }
      void load();
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || page.hidden || target.closest('[data-t3-action="usage"]')) return;
    if (target.closest("[data-runtime-tab], [data-t3-action=analytics], [data-t3-action=intake], [data-t3-action=projects]")) {
      setOpen(false);
    }
  }, true);
})();
