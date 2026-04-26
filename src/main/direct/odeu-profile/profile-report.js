"use strict";

const { loadDirectCodexProfile } = require("./profile-loader");

function sectionList(items, fallback = "- none") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join("\n");
}

function topEntries(entries, limit = 12) {
  return entries
    .slice(0, limit)
    .map((entry) => `- ${entry.id} (${entry.bucket}${entry.authorityLayer ? `, ${entry.authorityLayer}` : ""})`);
}

function buildDirectCodexProfileReport(input = {}) {
  const profileDoc = input.profileDoc || loadDirectCodexProfile(input);
  const { profile, capabilityIndex, summary } = profileDoc;
  const fixtureSummaries = Array.isArray(input.fixtureSummaries) ? input.fixtureSummaries : [];
  const deltas = Array.isArray(input.profileDeltas) ? input.profileDeltas : [];
  const probeResults = Array.isArray(input.probeResults) ? input.probeResults : [];
  const accepted = capabilityIndex.listByStatus("accepted").sort((a, b) => a.id.localeCompare(b.id));
  const unstable = capabilityIndex.listByStatus("unstable").sort((a, b) => a.id.localeCompare(b.id));
  const rejected = capabilityIndex.listByStatus("rejected").sort((a, b) => a.id.localeCompare(b.id));

  const lines = [
    "# Direct Codex ODEU Baseline Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Profile: ${summary.profileId}`,
    `Profile source: ${summary.source}`,
    `Observed at: ${summary.observedAt}`,
    `Backend contract: ${summary.backendContractVersion}`,
    "",
    "## Baseline Posture",
    "",
    "This report is generated from the imported GPTPro conceptual baseline. It does not prove live OAuth, account headers, model availability, or direct backend behavior.",
    "",
    "## Capability Counts",
    "",
    `- accepted: ${summary.counts.accepted}`,
    `- observed: ${summary.counts.observed}`,
    `- probed: ${summary.counts.probed}`,
    `- unstable: ${summary.counts.unstable}`,
    `- rejected: ${summary.counts.rejected}`,
    `- unknown: ${summary.counts.unknown}`,
    "",
    "## Accepted Capabilities",
    "",
    ...topEntries(accepted),
    "",
    "## Unstable Capabilities",
    "",
    ...topEntries(unstable),
    "",
    "## Rejected Capabilities",
    "",
    ...topEntries(rejected),
    "",
    "## Unknowns",
    "",
    sectionList(profile.epistemics?.unknowns || []).trim(),
    "",
    "## Drift Watch",
    "",
    sectionList(profile.epistemics?.driftWatch || []).trim(),
    "",
    "## Fixture Evidence",
    "",
  ];

  if (fixtureSummaries.length === 0) {
    lines.push("- no committed direct Codex fixtures loaded");
  } else {
    for (const fixture of fixtureSummaries) {
      lines.push(`- ${fixture.id}: ${fixture.recordCount} records, redaction=${fixture.redactionStatus}`);
    }
  }

  lines.push("", "## Probe Results", "");
  if (probeResults.length === 0) {
    lines.push("- no fixture-backed probes executed");
  } else {
    for (const probe of probeResults) {
      const eventTypes = Object.keys(probe.normalizedEventCounts || {}).sort().join(", ") || "none";
      const operation = probe.authOperation ? `; operation=${probe.authOperation}` : "";
      lines.push(`- ${probe.id}: ${probe.status}; acceptance=${probe.acceptance}; events=${eventTypes}${operation}`);
      if (probe.fixtureIds) {
        const fixtureIds = [
          probe.fixtureIds.raw,
          probe.fixtureIds.normalized,
          probe.fixtureIds.profileDelta,
          probe.fixtureIds.auth,
        ].filter(Boolean);
        lines.push(`  fixtures: ${fixtureIds.join(", ")}`);
      }
      if (probe.status === "failed" && probe.errorMessage) {
        lines.push(`  error: ${probe.errorMessage}`);
      }
    }
  }

  const blockedLiveGates = [
    ...new Set(probeResults.flatMap((probe) => Array.isArray(probe.blockedLiveGates) ? probe.blockedLiveGates : [])),
  ].sort();
  lines.push("", "## Blocked Live Gates", "");
  if (blockedLiveGates.length === 0) {
    lines.push("- no live gates recorded by fixture-backed probes");
  } else {
    lines.push(sectionList(blockedLiveGates));
  }

  lines.push("", "## Profile Deltas", "");
  if (deltas.length === 0) {
    lines.push("- no fixture profile deltas generated");
  } else {
    for (const delta of deltas) {
      const eventTypes = Object.keys(delta.normalizedEventCounts || {}).sort().join(", ") || "none";
      lines.push(`- ${delta.fixtureId}: ${delta.acceptance}; events=${eventTypes}`);
    }
  }

  lines.push("", "## Next Probe Gates", "");
  lines.push(sectionList([
    "Live OAuth login and token exchange.",
    "Private credential store, refresh lock, logout, and renderer-safe auth status.",
    "Plain text SSE turn.",
    "Reasoning-summary SSE turn.",
    "Tool-call request shape.",
    "Tool-result continuation shape.",
    "Abort behavior.",
    "Direct quota/auth/error taxonomy.",
  ]));

  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildDirectCodexProfileReport,
};
