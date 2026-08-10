"use strict";

const crypto = require("node:crypto");
const {
  buildResidentEpistemicContextItem,
  buildResidentEpistemicSnapshot,
  validateResidentEpistemicSnapshot,
} = require("./resident-epistemic-snapshot");

const RESIDENT_EPISTEMIC_CONTEXT_POLICY_SCHEMA = "resident_epistemic_context_policy@1";
const RESIDENT_EPISTEMIC_CONTEXT_BUNDLE_SCHEMA = "resident_epistemic_context_bundle@1";
const RESIDENT_EPISTEMIC_SETTINGS_PROJECTION_SCHEMA = "resident_epistemic_settings_projection@1";
const RESIDENT_EPISTEMIC_SELF_REPORT_DIAGNOSTIC_SCHEMA = "resident_epistemic_self_report_diagnostic@1";

const STALE_BEHAVIORS = new Set(["include_with_warning", "omit_row", "summarize_as_stale", "block_context_injection"]);
const CLAIM_FIELDS = new Set(["status", "callableInCurrentRequest", "declaredAsProviderTool", "controlState"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 420) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && key !== "policyDigest" && key !== "bundleDigest" && key !== "projectionDigest" && key !== "diagnosticDigest")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeStaleBehavior(value, fallback = "include_with_warning") {
  const text = normalizeString(value, fallback);
  return STALE_BEHAVIORS.has(text) ? text : fallback;
}

function normalizeClassPolicies(values = []) {
  const rows = Array.isArray(values) ? values : [];
  return rows
    .filter(isPlainObject)
    .map((entry) => ({
      key: normalizeString(entry.key || entry.subjectKind || entry.family, ""),
      subjectKind: normalizeString(entry.subjectKind, ""),
      family: normalizeString(entry.family, ""),
      include: entry.include !== false,
      staleBehavior: normalizeStaleBehavior(entry.staleBehavior),
      maxRows: Math.max(0, finiteNumber(entry.maxRows, 0)),
      priorityFloor: normalizeString(entry.priorityFloor, ""),
    }))
    .filter((entry) => entry.key || entry.subjectKind || entry.family)
    .sort((a, b) => `${a.subjectKind}:${a.family}:${a.key}`.localeCompare(`${b.subjectKind}:${b.family}:${b.key}`));
}

function buildResidentEpistemicContextPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectionBudget = isPlainObject(source.projectionBudget) ? source.projectionBudget : {};
  const policy = {
    schema: RESIDENT_EPISTEMIC_CONTEXT_POLICY_SCHEMA,
    policyId: normalizeString(source.policyId, "resident_epistemic_context_policy_default"),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    includeSubjectKinds: normalizeStringList(source.includeSubjectKinds),
    excludeSubjectKinds: normalizeStringList(source.excludeSubjectKinds),
    includeFamilies: normalizeStringList(source.includeFamilies),
    excludeFamilies: normalizeStringList(source.excludeFamilies),
    includeAccountActionsWhenQuotaPressure: source.includeAccountActionsWhenQuotaPressure === true,
    quotaPressure: source.quotaPressure === true,
    defaultStaleBehavior: normalizeStaleBehavior(source.defaultStaleBehavior, "include_with_warning"),
    classPolicies: normalizeClassPolicies(source.classPolicies),
    projectionBudget: {
      maxRows: Math.max(1, finiteNumber(projectionBudget.maxRows ?? source.maxRows, 12)),
      maxChars: Math.max(200, finiteNumber(projectionBudget.maxChars ?? source.maxChars, 2400)),
      truncationPolicy: normalizeString(projectionBudget.truncationPolicy || source.truncationPolicy, "priority_then_summary"),
    },
    contextInjectionEnabled: source.contextInjectionEnabled !== false,
    manualRawRowEditingAllowed: false,
    arbitraryPromptInjectionAllowed: false,
    disabledCapabilityPromotionAllowed: false,
  };
  policy.policyDigest = digestFor("resident-epistemic-context-policy@1", policy);
  return policy;
}

function rowKey(row = {}) {
  return `${normalizeString(row.subjectKind, "unknown")}:${normalizeString(row.subjectId, "")}`;
}

function classPolicyFor(row = {}, policy = {}) {
  const policies = Array.isArray(policy.classPolicies) ? policy.classPolicies : [];
  return policies.find((entry) => entry.subjectKind && entry.subjectKind === row.subjectKind)
    || policies.find((entry) => entry.family && entry.family === row.family)
    || policies.find((entry) => entry.key && (entry.key === row.subjectKind || entry.key === row.family || entry.key === rowKey(row)))
    || null;
}

function shouldIncludeRow(row = {}, policy = {}) {
  const classPolicy = classPolicyFor(row, policy);
  if (classPolicy?.include === false) return false;
  if (Array.isArray(policy.excludeSubjectKinds) && policy.excludeSubjectKinds.includes(row.subjectKind)) return false;
  if (row.family && Array.isArray(policy.excludeFamilies) && policy.excludeFamilies.includes(row.family)) return false;
  if (Array.isArray(policy.includeSubjectKinds) && policy.includeSubjectKinds.length && !policy.includeSubjectKinds.includes(row.subjectKind)) return false;
  if (Array.isArray(policy.includeFamilies) && policy.includeFamilies.length && (!row.family || !policy.includeFamilies.includes(row.family))) return false;
  if (row.subjectKind === "account_action" && !(policy.includeAccountActionsWhenQuotaPressure && policy.quotaPressure)) return false;
  return row.residentVisible !== false;
}

function staleBehaviorFor(row = {}, policy = {}) {
  const classPolicy = classPolicyFor(row, policy);
  return normalizeStaleBehavior(classPolicy?.staleBehavior, policy.defaultStaleBehavior);
}

function projectRowForPolicy(row = {}, policy = {}) {
  const staleBehavior = staleBehaviorFor(row, policy);
  if (row.freshness !== "stale") return { row, omitted: false, staleBehavior };
  if (staleBehavior === "omit_row") {
    return { row, omitted: true, staleBehavior, omissionReason: "stale_row_omitted_by_policy" };
  }
  if (staleBehavior === "summarize_as_stale") {
    return {
      row: {
        ...row,
        compactText: boundedString(`Stale ${row.displayLabel}: ${row.status}; use only as warning, not fresh capability evidence.`, 500),
        channels: {
          ...row.channels,
          epistemic: {
            ...row.channels?.epistemic,
            visibility: "summary_only",
          },
        },
        blockerCodes: normalizeStringList([...(Array.isArray(row.blockerCodes) ? row.blockerCodes : []), "stale_summarized_by_policy"]),
      },
      omitted: false,
      staleBehavior,
    };
  }
  return { row, omitted: false, staleBehavior };
}

function summarizeCounts(rows = []) {
  const counts = {};
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const key = normalizeString(row.subjectKind, "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function mergeCounts(...countMaps) {
  const merged = {};
  for (const counts of countMaps) {
    if (!isPlainObject(counts)) continue;
    for (const [key, value] of Object.entries(counts)) {
      merged[key] = Number(merged[key] || 0) + Math.max(0, Number(value) || 0);
    }
  }
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b)));
}

function applyResidentEpistemicContextPolicy({ snapshot, policy } = {}) {
  if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error("resident_epistemic_policy_snapshot_required");
  const contextPolicy = policy?.schema === RESIDENT_EPISTEMIC_CONTEXT_POLICY_SCHEMA
    ? policy
    : buildResidentEpistemicContextPolicy(policy || {});
  const includedRows = [];
  const omittedRows = [];
  const staleWarnings = [];
  let contextInjectionBlocked = contextPolicy.contextInjectionEnabled === false;
  for (const row of snapshot.rows) {
    if (!isPlainObject(row)) continue;
    if (!shouldIncludeRow(row, contextPolicy)) {
      omittedRows.push({ row, reason: "class_or_visibility_policy" });
      continue;
    }
    const projected = projectRowForPolicy(row, contextPolicy);
    if (projected.omitted) {
      omittedRows.push({ row, reason: projected.omissionReason || "stale_policy" });
      continue;
    }
    if (row.freshness === "stale") {
      staleWarnings.push({
        rowId: row.rowId,
        subjectKind: row.subjectKind,
        subjectId: row.subjectId,
        staleBehavior: projected.staleBehavior,
      });
      if (projected.staleBehavior === "block_context_injection") contextInjectionBlocked = true;
    }
    includedRows.push(projected.row);
  }
  const snapshotInput = {
    workThreadId: snapshot.workThreadId,
    codexThreadId: snapshot.codexThreadId,
    runtimeFamily: snapshot.runtimeFamily,
    generatedAt: snapshot.generatedAt,
    freshnessMs: snapshot.freshnessMs,
    declarationDigest: snapshot.declarationDigest,
    sourceDigests: [snapshot.snapshotDigest, contextPolicy.policyDigest, ...(Array.isArray(snapshot.sourceDigests) ? snapshot.sourceDigests : [])],
    projectionBudget: contextPolicy.projectionBudget,
    rows: includedRows,
  };
  const provisionalSnapshot = buildResidentEpistemicSnapshot(snapshotInput);
  const omittedClassCounts = mergeCounts(
    summarizeCounts(omittedRows.map((entry) => entry.row)),
    provisionalSnapshot.omittedClassCounts,
  );
  const policySnapshot = buildResidentEpistemicSnapshot({
    ...snapshotInput,
    omittedClassCounts,
    snapshotCompleteness: Object.keys(omittedClassCounts).length || staleWarnings.length ? "budgeted_with_omissions" : "complete",
  });
  const contextItem = contextInjectionBlocked
    ? null
    : buildResidentEpistemicContextItem(policySnapshot, { includedRowIds: policySnapshot.compactTextSourceRowIds });
  const bundle = {
    schema: RESIDENT_EPISTEMIC_CONTEXT_BUNDLE_SCHEMA,
    bundleId: `resident_epistemic_context_bundle_${digestFor("resident-epistemic-context-bundle-id@1", {
      snapshotDigest: snapshot.snapshotDigest,
      policyDigest: contextPolicy.policyDigest,
    }).slice(7, 31)}`,
    generatedAt: nowIso(),
    sourceSnapshotId: snapshot.snapshotId,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    policy: contextPolicy,
    policySnapshot,
    contextItem,
    contextInjectionBlocked,
    staleWarnings,
    omittedClassCounts: policySnapshot.omittedClassCounts,
    includedRowIds: contextItem ? contextItem.includedRowIds : [],
    compactTextDigest: policySnapshot.compactTextDigest,
    grantsAuthority: false,
    manualRawRowEditingAllowed: false,
    arbitraryPromptInjectionAllowed: false,
    disabledCapabilityPromotionAllowed: false,
    rawSecretsExposed: false,
    rawPayloadExposed: false,
  };
  bundle.bundleDigest = digestFor("resident-epistemic-context-bundle@1", bundle);
  return bundle;
}

function buildResidentEpistemicSettingsProjection(bundle = {}) {
  const source = isPlainObject(bundle) ? bundle : {};
  const rows = Array.isArray(source.policySnapshot?.rows) ? source.policySnapshot.rows : [];
  const projection = {
    schema: RESIDENT_EPISTEMIC_SETTINGS_PROJECTION_SCHEMA,
    projectionId: `resident_epistemic_settings_${digestFor("resident-epistemic-settings-projection-id@1", {
      bundleDigest: source.bundleDigest,
    }).slice(7, 31)}`,
    bundleId: normalizeString(source.bundleId, ""),
    sourceSnapshotId: normalizeString(source.sourceSnapshotId, ""),
    sourceSnapshotDigest: normalizeString(source.sourceSnapshotDigest, ""),
    policyDigest: normalizeString(source.policy?.policyDigest, ""),
    rowCount: rows.length,
    bySubjectKind: summarizeCounts(rows),
    staleWarningCount: Array.isArray(source.staleWarnings) ? source.staleWarnings.length : 0,
    contextInjectionBlocked: source.contextInjectionBlocked === true,
    compactInjectedText: boundedString(source.policySnapshot?.compactResidentText, 2400),
    compactTextDigest: normalizeString(source.compactTextDigest, ""),
    omittedClassCounts: isPlainObject(source.omittedClassCounts) ? source.omittedClassCounts : {},
    rows: rows.map((row) => ({
      rowId: row.rowId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      displayLabel: row.displayLabel,
      status: row.status,
      freshness: row.freshness,
      callableInCurrentRequest: row.callableInCurrentRequest,
      declaredAsProviderTool: row.declaredAsProviderTool,
      controlState: row.controlState,
      blockerCodes: row.blockerCodes,
    })),
    grantsAuthority: false,
    rawSecretsExposed: false,
    rawPayloadExposed: false,
  };
  projection.projectionDigest = digestFor("resident-epistemic-settings-projection@1", projection);
  return projection;
}

function normalizeClaims(selfReport = {}) {
  const source = isPlainObject(selfReport) ? selfReport : {};
  return (Array.isArray(source.claims) ? source.claims : [])
    .filter(isPlainObject)
    .map((claim) => ({
      subjectKind: normalizeString(claim.subjectKind, ""),
      subjectId: normalizeString(claim.subjectId || claim.id, ""),
      field: normalizeString(claim.field, "status"),
      value: claim.value,
      text: boundedString(claim.text || claim.claim, 320),
    }))
    .filter((claim) => claim.subjectKind && claim.subjectId && CLAIM_FIELDS.has(claim.field));
}

function buildResidentSelfReportDiagnostics({ snapshot, selfReport } = {}) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const rowByKey = new Map(rows.filter(isPlainObject).map((row) => [rowKey(row), row]));
  const findings = normalizeClaims(selfReport).map((claim) => {
    const row = rowByKey.get(`${claim.subjectKind}:${claim.subjectId}`);
    if (!row) {
      return {
        claim,
        status: "unknown_subject",
        expectedValue: undefined,
        actualValue: claim.value,
        severity: "warning",
      };
    }
    const expectedValue = row[claim.field];
    return {
      claim,
      status: expectedValue === claim.value ? "matched" : "mismatch",
      expectedValue,
      actualValue: claim.value,
      severity: expectedValue === claim.value ? "info" : "warning",
    };
  });
  const diagnostic = {
    schema: RESIDENT_EPISTEMIC_SELF_REPORT_DIAGNOSTIC_SCHEMA,
    diagnosticId: `resident_epistemic_self_report_${digestFor("resident-epistemic-self-report-diagnostic-id@1", {
      snapshotDigest: snapshot?.snapshotDigest,
      findings,
    }).slice(7, 31)}`,
    snapshotId: normalizeString(snapshot?.snapshotId, ""),
    snapshotDigest: normalizeString(snapshot?.snapshotDigest, ""),
    findingCount: findings.length,
    mismatchCount: findings.filter((finding) => finding.status === "mismatch").length,
    unknownSubjectCount: findings.filter((finding) => finding.status === "unknown_subject").length,
    findings,
    grantsAuthority: false,
  };
  diagnostic.diagnosticDigest = digestFor("resident-epistemic-self-report-diagnostic@1", diagnostic);
  return diagnostic;
}

function validateResidentEpistemicContextBundle(bundle = {}) {
  const errors = [];
  if (!isPlainObject(bundle) || bundle.schema !== RESIDENT_EPISTEMIC_CONTEXT_BUNDLE_SCHEMA) return ["resident_epistemic_context_bundle_schema_mismatch"];
  try {
    validateResidentEpistemicSnapshot(bundle.policySnapshot);
  } catch (error) {
    errors.push(`policy_snapshot:${error.message}`);
  }
  if (bundle.contextItem) {
    if (bundle.contextItem.schema !== "resident_epistemic_context_item@1") errors.push("resident_epistemic_context_item_schema_mismatch");
    if (bundle.contextItem.grantsAuthority !== false) errors.push("resident_epistemic_context_item_grants_authority");
    if (bundle.contextItem.snapshotDigest !== bundle.policySnapshot?.snapshotDigest) errors.push("resident_epistemic_context_item_snapshot_mismatch");
  }
  for (const flag of [
    "grantsAuthority",
    "manualRawRowEditingAllowed",
    "arbitraryPromptInjectionAllowed",
    "disabledCapabilityPromotionAllowed",
    "rawSecretsExposed",
    "rawPayloadExposed",
  ]) {
    if (bundle[flag] !== false) errors.push(`resident_epistemic_context_authority_or_raw_leak:${flag}`);
  }
  if (bundle.bundleDigest !== digestFor("resident-epistemic-context-bundle@1", bundle)) errors.push("resident_epistemic_context_bundle_digest_mismatch");
  return errors;
}

module.exports = {
  RESIDENT_EPISTEMIC_CONTEXT_BUNDLE_SCHEMA,
  RESIDENT_EPISTEMIC_CONTEXT_POLICY_SCHEMA,
  RESIDENT_EPISTEMIC_SELF_REPORT_DIAGNOSTIC_SCHEMA,
  RESIDENT_EPISTEMIC_SETTINGS_PROJECTION_SCHEMA,
  applyResidentEpistemicContextPolicy,
  buildResidentEpistemicContextPolicy,
  buildResidentEpistemicSettingsProjection,
  buildResidentSelfReportDiagnostics,
  validateResidentEpistemicContextBundle,
};
