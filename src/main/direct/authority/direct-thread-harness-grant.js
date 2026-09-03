"use strict";

// A DirectThreadHarnessGrant is deliberately a small, durable authority
// record.  It is issued by the main-process grant store and is never compiled
// from a provider request, renderer projection, or user prompt.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIRECT_THREAD_HARNESS_GRANT_SCHEMA = "direct_thread_harness_grant@1";
const DIRECT_THREAD_HARNESS_GRANT_INDEX_SCHEMA = "direct_thread_harness_grant_index@1";
const DIRECT_OWNER_FULL_ACCESS_ACT_SCHEMA = "direct_owner_full_access_act@1";
const DIRECT_HARNESS_GRANT_INHERITANCE_SCHEMA = "direct_harness_grant_inheritance@1";
const OWNER_ACT_MARKER = new WeakSet();

const FULL_ACCESS_APPROVAL_POLICY = "never";
const FULL_ACCESS_SANDBOX_MODE = "danger-full-access";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function nowIso(nowMs) {
  const value = Number(nowMs);
  return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
}

function stableValue(value, omitDigests = true) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, omitDigests));
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (omitDigests && ["grantDigest", "actDigest", "populationDigest", "scopeDigest", "inheritanceDigest"].includes(key)) continue;
    if (value[key] !== undefined) result[key] = stableValue(value[key], omitDigests);
  }
  return result;
}

function stableStringify(value, omitDigests = true) {
  return JSON.stringify(stableValue(value, omitDigests));
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function safeId(value, label) {
  const id = normalizeString(value, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(id)) {
    throw grantError("direct_thread_harness_grant_invalid", `${label} must be a bounded identity.`);
  }
  return id;
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function grantError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeEnvironment(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const environmentId = safeId(source.environmentId || source.id || source.name, "execution environment");
  const kind = normalizeString(source.kind, "local");
  const bindingDigest = normalizeString(source.bindingDigest || source.environmentBindingDigest, "");
  const workspaceDigest = normalizeString(source.workspaceDigest || source.workspaceRootDigest, "");
  if (!bindingDigest && !workspaceDigest) {
    throw grantError("direct_thread_harness_grant_environment_unbound", "Execution environment requires an exact binding digest.");
  }
  return {
    environmentId,
    kind,
    bindingDigest,
    workspaceDigest,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function environmentDigest(environment = {}) {
  return digestFor("direct-thread-harness-execution-environment@1", environment);
}

function normalizeCapabilityPopulation(input) {
  const source = Array.isArray(input)
    ? input
    : isPlainObject(input) && Array.isArray(input.capabilities)
      ? input.capabilities
      : isPlainObject(input) && Array.isArray(input.names)
        ? input.names
        : [];
  const rows = source.map((entry) => {
    const object = isPlainObject(entry) ? entry : { name: entry };
    const name = normalizeString(object.name || object.toolName || object.capabilityName, "");
    if (!name) throw grantError("direct_thread_harness_grant_capability_invalid", "Capability population contains an unnamed capability.");
    return {
      name,
      capabilityId: normalizeString(object.capabilityId || object.id, `direct.${name}`),
      admittedState: "runtime_admitted",
      sourceRef: normalizeString(object.sourceRef || object.sourceId, "direct_runtime_capability_projection"),
      rawProviderPayloadIncluded: false,
      rawSecretIncluded: false,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.name)) throw grantError("direct_thread_harness_grant_capability_duplicate", `Capability population duplicates ${row.name}.`);
    seen.add(row.name);
    unique.push(row);
  }
  if (!unique.length) throw grantError("direct_thread_harness_grant_capability_empty", "Full-access grant requires an explicit admitted capability population.");
  const base = { schema: "direct_runtime_capability_population@1", capabilities: unique };
  return {
    ...base,
    populationDigest: digestFor("direct-runtime-capability-population@1", base),
  };
}

function ownerActFor(input = {}, nowMs) {
  const taskId = safeId(input.taskId || input.threadId, "task");
  const threadId = safeId(input.threadId || input.taskId, "thread");
  const projectId = safeId(input.projectId, "project");
  const executionEnvironment = normalizeEnvironment(input.executionEnvironment || input.environment);
  const act = {
    schema: DIRECT_OWNER_FULL_ACCESS_ACT_SCHEMA,
    actId: normalizeString(input.actId, `owner_full_access_act_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`),
    actor: "direct_harness_owner",
    action: "select_full_access_task_profile",
    taskId,
    threadId,
    projectId,
    executionEnvironment,
    selectedProfile: "full_access",
    selectedAt: nowIso(nowMs),
    rendererInputAccepted: false,
    modelInputAccepted: false,
    promptInputAccepted: false,
    rawSecretIncluded: false,
  };
  act.actDigest = digestFor("direct-owner-full-access-act@1", act);
  OWNER_ACT_MARKER.add(act);
  return Object.freeze(act);
}

function grantBase(input = {}, options = {}) {
  const ownerAct = input.ownerAct;
  if (!isPlainObject(ownerAct) || !OWNER_ACT_MARKER.has(ownerAct)) {
    throw grantError("direct_thread_harness_grant_owner_act_required", "Full-access authority must be issued from the main-process owner act.");
  }
  const taskId = safeId(input.taskId || ownerAct.taskId, "task");
  const threadId = safeId(input.threadId || ownerAct.threadId, "thread");
  const projectId = safeId(input.projectId || ownerAct.projectId, "project");
  const executionEnvironment = normalizeEnvironment(input.executionEnvironment || ownerAct.executionEnvironment);
  if (taskId !== ownerAct.taskId || threadId !== ownerAct.threadId || projectId !== ownerAct.projectId || environmentDigest(executionEnvironment) !== environmentDigest(ownerAct.executionEnvironment)) {
    throw grantError("direct_thread_harness_grant_owner_act_scope_mismatch", "Grant scope must match the exact owner act.");
  }
  const capabilityPopulation = normalizeCapabilityPopulation(input.capabilityPopulation || input.capabilities);
  const issuedAt = nowIso(options.nowMs);
  const grantRevision = Number.isInteger(Number(input.grantRevision)) && Number(input.grantRevision) > 0 ? Number(input.grantRevision) : 1;
  const parentGrantId = normalizeString(input.parentGrantId, "");
  const inheritancePolicy = {
    schema: DIRECT_HARNESS_GRANT_INHERITANCE_SCHEMA,
    mode: parentGrantId ? "bounded_parent_inheritance" : "parent_may_delegate_subset",
    parentGrantId,
    maxCapabilityRule: "child_capabilities_must_be_subset",
    projectRule: "child_project_must_equal_parent_project",
    environmentRule: "child_environment_must_equal_parent_environment",
    approvalPolicyRule: "child_approval_policy_must_equal_parent_approval_policy",
    sandboxModeRule: "child_sandbox_mode_must_equal_parent_sandbox_mode",
    childMayWiden: false,
    childMayRetarget: false,
    childMayRevive: false,
  };
  const base = {
    schema: DIRECT_THREAD_HARNESS_GRANT_SCHEMA,
    grantId: normalizeString(input.grantId, `direct_harness_grant_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`),
    grantRevision,
    ownerAct,
    taskId,
    threadId,
    projectId,
    executionEnvironment,
    executionEnvironmentDigest: environmentDigest(executionEnvironment),
    capabilityPopulation,
    approvalPolicy: FULL_ACCESS_APPROVAL_POLICY,
    sandboxMode: FULL_ACCESS_SANDBOX_MODE,
    inheritancePolicy,
    currentness: {
      state: "current",
      issuedAt,
      validFrom: issuedAt,
      validUntil: normalizeString(input.validUntil, ""),
      supersedesGrantId: normalizeString(input.supersedesGrantId, ""),
      reconstructedFromDurableRecord: false,
    },
    revocation: {
      state: "active",
      revocationRevision: 0,
      revokedAt: "",
      reason: "",
    },
    restartReconstruction: {
      state: "durable_record",
      source: "direct_harness_grant_store",
      reconstructionRequired: true,
      validatedAt: "",
      rawRecordIncluded: false,
    },
    authorityProvenance: "main_process_owner_issued_direct_task_profile",
    rendererMayMint: false,
    modelMayMint: false,
    promptMayMint: false,
    requestMayReplace: false,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    parentGrantId,
  };
  base.scopeDigest = digestFor("direct-thread-harness-grant-scope@1", {
    taskId,
    threadId,
    projectId,
    executionEnvironmentDigest: base.executionEnvironmentDigest,
  });
  base.grantDigest = digestFor("direct-thread-harness-grant@1", base);
  return Object.freeze(base);
}

function validateDirectThreadHarnessGrant(grant = {}, expected = {}) {
  const errors = [];
  if (!isPlainObject(grant) || grant.schema !== DIRECT_THREAD_HARNESS_GRANT_SCHEMA) errors.push("schema_mismatch");
  for (const field of ["grantId", "taskId", "threadId", "projectId", "grantDigest", "scopeDigest", "executionEnvironmentDigest"]) {
    if (!normalizeString(grant[field], "")) errors.push(`missing_${field}`);
  }
  if (grant.approvalPolicy !== FULL_ACCESS_APPROVAL_POLICY) errors.push("approval_policy_not_never");
  if (grant.sandboxMode !== FULL_ACCESS_SANDBOX_MODE) errors.push("sandbox_mode_not_danger_full_access");
  if (!isPlainObject(grant.ownerAct) || grant.ownerAct.schema !== DIRECT_OWNER_FULL_ACCESS_ACT_SCHEMA) errors.push("owner_act_invalid");
  if (grant.ownerAct?.action !== "select_full_access_task_profile") errors.push("owner_act_action_invalid");
  if (grant.ownerAct?.taskId !== grant.taskId || grant.ownerAct?.threadId !== grant.threadId || grant.ownerAct?.projectId !== grant.projectId) errors.push("owner_act_scope_mismatch");
  if (!isPlainObject(grant.executionEnvironment)) errors.push("execution_environment_invalid");
  if (grant.executionEnvironmentDigest && environmentDigest(grant.executionEnvironment) !== grant.executionEnvironmentDigest) errors.push("execution_environment_digest_invalid");
  if (!isPlainObject(grant.capabilityPopulation) || !Array.isArray(grant.capabilityPopulation.capabilities) || !normalizeString(grant.capabilityPopulation.populationDigest, "")) errors.push("capability_population_invalid");
  if (isPlainObject(grant.capabilityPopulation) && grant.capabilityPopulation.populationDigest && digestFor("direct-runtime-capability-population@1", {
    schema: "direct_runtime_capability_population@1",
    capabilities: grant.capabilityPopulation.capabilities,
  }) !== grant.capabilityPopulation.populationDigest) errors.push("capability_population_digest_invalid");
  if (!isPlainObject(grant.inheritancePolicy) || grant.inheritancePolicy.childMayWiden !== false || grant.inheritancePolicy.childMayRetarget !== false || grant.inheritancePolicy.childMayRevive !== false) errors.push("inheritance_policy_invalid");
  if (!isPlainObject(grant.currentness) || !["current", "revoked", "superseded"].includes(grant.currentness.state)) errors.push("currentness_invalid");
  if (!isPlainObject(grant.revocation) || !["active", "revoked"].includes(grant.revocation.state)) errors.push("revocation_invalid");
  if (!isPlainObject(grant.restartReconstruction) || grant.restartReconstruction.state !== "durable_record") errors.push("restart_reconstruction_invalid");
  if (grant.rendererMayMint !== false || grant.modelMayMint !== false || grant.promptMayMint !== false || grant.requestMayReplace !== false) errors.push("authority_provenance_invalid");
  if (normalizeString(grant.grantDigest, "") && digestFor("direct-thread-harness-grant@1", grant) !== grant.grantDigest) errors.push("grant_digest_invalid");
  const expectedValues = {
    grantId: normalizeString(expected.grantId, ""),
    taskId: normalizeString(expected.taskId || expected.threadId, ""),
    threadId: normalizeString(expected.threadId || expected.taskId, ""),
    projectId: normalizeString(expected.projectId, ""),
    executionEnvironmentDigest: normalizeString(expected.executionEnvironmentDigest, ""),
  };
  for (const [key, value] of Object.entries(expectedValues)) {
    if (value && grant[key] !== value) errors.push(`scope_mismatch_${key}`);
  }
  if (expected.grantRevision !== undefined && Number(grant.grantRevision) !== Number(expected.grantRevision)) errors.push("grant_revision_stale");
  if (expected.requireCurrent === true && (grant.revocation.state !== "active" || grant.currentness.state !== "current")) errors.push("grant_not_current");
  const nowMs = Number(expected.nowMs);
  const validUntil = Date.parse(normalizeString(grant.currentness?.validUntil, ""));
  if (Number.isFinite(nowMs) && Number.isFinite(validUntil) && nowMs >= validUntil) errors.push("grant_expired");
  return errors;
}

function assertDirectThreadHarnessGrant(grant, expected = {}) {
  const errors = validateDirectThreadHarnessGrant(grant, expected);
  if (errors.length) throw grantError("direct_thread_harness_grant_invalid", `Direct thread harness grant rejected: ${errors.join(", ")}.`);
  return grant;
}

function capabilityNames(grant = {}) {
  return (grant.capabilityPopulation?.capabilities || []).map((entry) => normalizeString(entry?.name, "")).filter(Boolean);
}

function authorizeDirectThreadHarnessCapability(grant, toolName, expected = {}) {
  const errors = validateDirectThreadHarnessGrant(grant, { ...expected, requireCurrent: true });
  if (errors.length) return { authorized: false, reason: errors[0], grantId: normalizeString(grant?.grantId, "") };
  const name = normalizeString(toolName, "");
  if (!name || !capabilityNames(grant).includes(name)) return { authorized: false, reason: "capability_not_in_grant_population", grantId: grant.grantId };
  const runtimeNames = Array.isArray(expected.runtimeAdmittedCapabilityNames)
    ? expected.runtimeAdmittedCapabilityNames.map((entry) => normalizeString(entry, "")).filter(Boolean)
    : null;
  if (runtimeNames && !runtimeNames.includes(name)) return { authorized: false, reason: "capability_not_runtime_admitted", grantId: grant.grantId };
  return {
    authorized: true,
    grantId: grant.grantId,
    grantRevision: Number(grant.grantRevision),
    approvalPolicy: grant.approvalPolicy,
    sandboxMode: grant.sandboxMode,
    authorityMode: "durable_task_grant",
  };
}

function inheritDirectThreadHarnessGrant(parentGrant, input = {}) {
  assertDirectThreadHarnessGrant(parentGrant, { requireCurrent: true });
  const childTaskId = safeId(input.taskId || input.threadId, "child task");
  const childThreadId = safeId(input.threadId || input.taskId, "child thread");
  if (normalizeString(input.projectId, parentGrant.projectId) !== parentGrant.projectId) throw grantError("direct_thread_harness_grant_child_project_mismatch", "Child grant cannot change project scope.");
  const childEnvironment = normalizeEnvironment(input.executionEnvironment || parentGrant.executionEnvironment);
  if (environmentDigest(childEnvironment) !== parentGrant.executionEnvironmentDigest) throw grantError("direct_thread_harness_grant_child_environment_mismatch", "Child grant cannot change execution environment scope.");
  const requested = input.capabilityPopulation || input.capabilities || capabilityNames(parentGrant);
  const requestedNames = (Array.isArray(requested) ? requested : requested.capabilities || requested.names || []).map((entry) => normalizeString(isPlainObject(entry) ? entry.name || entry.toolName : entry, "")).filter(Boolean);
  const parentNames = new Set(capabilityNames(parentGrant));
  if (requestedNames.some((name) => !parentNames.has(name))) throw grantError("direct_thread_harness_grant_child_capability_escalation", "Child grant capability population must be a subset of the parent.");
  const ownerAct = ownerActFor({
    taskId: childTaskId,
    threadId: childThreadId,
    projectId: parentGrant.projectId,
    executionEnvironment: parentGrant.executionEnvironment,
  }, input.nowMs);
  const child = grantBase({
    ownerAct,
    grantId: input.grantId,
    grantRevision: 1,
    taskId: childTaskId,
    threadId: childThreadId,
    projectId: parentGrant.projectId,
    executionEnvironment: parentGrant.executionEnvironment,
    capabilityPopulation: requestedNames,
    parentGrantId: parentGrant.grantId,
  }, { nowMs: input.nowMs });
  return child;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

class DirectThreadHarnessGrantStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw grantError("direct_thread_harness_grant_store_root_required", "DirectThreadHarnessGrantStore requires an explicit rootDir.");
    this.rootDir = path.resolve(rootDir);
    this.grantsDir = path.join(this.rootDir, "authority", "grants");
    this.indexFile = path.join(this.rootDir, "authority", "index.json");
  }

  ensure() {
    ensureDirectory(this.grantsDir);
    const current = readJson(this.indexFile);
    if (!current || current.schema !== DIRECT_THREAD_HARNESS_GRANT_INDEX_SCHEMA || !Array.isArray(current.grantIds)) {
      writeJsonAtomic(this.indexFile, {
        schema: DIRECT_THREAD_HARNESS_GRANT_INDEX_SCHEMA,
        version: 1,
        grantIds: [],
        heads: {},
        updatedAt: nowIso(),
      });
    }
    return readJson(this.indexFile);
  }

  readIndex() {
    this.ensure();
    return readJson(this.indexFile) || {
      schema: DIRECT_THREAD_HARNESS_GRANT_INDEX_SCHEMA,
      version: 1,
      grantIds: [],
      heads: {},
    };
  }

  pathFor(grantId) {
    const id = safeId(grantId, "grant");
    return path.join(this.grantsDir, `${id}.json`);
  }

  write(grant, options = {}) {
    assertDirectThreadHarnessGrant(grant);
    this.ensure();
    writeJsonAtomic(this.pathFor(grant.grantId), grant);
    const index = this.readIndex();
    const grantIds = [...new Set([...index.grantIds, grant.grantId])].sort();
    const heads = isPlainObject(index.heads) ? { ...index.heads } : {};
    if (options.head !== false) {
      heads[grant.scopeDigest] = {
        grantId: grant.grantId,
        grantRevision: Number(grant.grantRevision),
      };
    }
    writeJsonAtomic(this.indexFile, { ...index, grantIds, heads, updatedAt: nowIso() });
    return grant;
  }

  issueFullAccess(input = {}) {
    const ownerAct = ownerActFor(input, input.nowMs);
    const candidate = grantBase({
      ...input,
      ownerAct,
    }, { nowMs: input.nowMs });
    const expected = {
      taskId: candidate.taskId,
      threadId: candidate.threadId,
      projectId: candidate.projectId,
      executionEnvironmentDigest: candidate.executionEnvironmentDigest,
    };
    const index = this.readIndex();
    const head = isPlainObject(index.heads) ? index.heads[candidate.scopeDigest] : null;
    let prior = this.currentForScope(expected);
    if (!prior && isPlainObject(head) && normalizeString(head.grantId, "")) {
      try {
        const headedGrant = this.read(head.grantId);
        if (headedGrant && headedGrant.scopeDigest === candidate.scopeDigest) prior = headedGrant;
      } catch {
        // A corrupt head cannot authorize.  The new owner act may establish a
        // fresh valid head below, with a strictly later revision when known.
      }
    }
    const requestedRevision = Number(candidate.grantRevision);
    const priorRevision = Number(prior?.grantRevision || head?.grantRevision || 0);
    const grantRevision = Math.max(requestedRevision, priorRevision + (priorRevision > 0 ? 1 : 0));
    const grant = grantBase({
      ...input,
      grantId: input.grantId && input.grantId !== prior?.grantId ? input.grantId : undefined,
      ownerAct,
      grantRevision,
      supersedesGrantId: prior?.grantId || "",
    }, { nowMs: input.nowMs });
    this.write(grant, { head: true });
    if (prior && prior.grantId !== grant.grantId) {
      const superseded = {
        ...prior,
        currentness: {
          ...prior.currentness,
          state: "superseded",
          supersededByGrantId: grant.grantId,
        },
        revocation: {
          state: "revoked",
          revocationRevision: Number(prior.revocation?.revocationRevision || 0) + 1,
          revokedAt: nowIso(input.nowMs),
          reason: "superseded_by_reissue",
        },
      };
      superseded.grantDigest = digestFor("direct-thread-harness-grant@1", superseded);
      this.write(superseded, { head: false });
    }
    return grant;
  }

  issue(input = {}) {
    return this.write(grantBase(input, { nowMs: input.nowMs }));
  }

  read(grantId) {
    const grant = readJson(this.pathFor(grantId));
    if (!grant) return null;
    assertDirectThreadHarnessGrant(grant);
    return grant;
  }

  headForGrant(grant) {
    const index = this.readIndex();
    const head = isPlainObject(index.heads) ? index.heads[grant?.scopeDigest] : null;
    return isPlainObject(head) ? head : null;
  }

  assertAuthoritativeHead(grant) {
    const head = this.headForGrant(grant);
    if (!head) return grant;
    if (head.grantId !== grant.grantId || Number(head.grantRevision) !== Number(grant.grantRevision)) {
      throw grantError("direct_thread_harness_grant_superseded", "Direct thread harness grant is no longer the authoritative current head.");
    }
    return grant;
  }

  currentForScope(expected = {}) {
    const index = this.readIndex();
    const heads = isPlainObject(index.heads) ? index.heads : {};
    const entries = index.grantIds.map((id) => {
      try { return this.read(id); } catch { return null; }
    }).filter(Boolean).filter((grant) => {
      if (grant.revocation.state !== "active" || grant.currentness.state !== "current") return false;
      const head = heads[grant.scopeDigest];
      return !head || (head.grantId === grant.grantId && Number(head.grantRevision) === Number(grant.grantRevision));
    });
    const matching = entries.filter((grant) => validateDirectThreadHarnessGrant(grant, expected).filter((error) => !["grant_not_current"].includes(error)).length === 0);
    return matching.sort((left, right) => Number(right.grantRevision) - Number(left.grantRevision) || String(right.currentness.issuedAt).localeCompare(String(left.currentness.issuedAt)))[0] || null;
  }

  reconstruct(grantId, expected = {}) {
    const grant = this.read(grantId);
    if (!grant) throw grantError("direct_thread_harness_grant_missing", "Direct thread harness grant is not durable.");
    this.assertAuthoritativeHead(grant);
    assertDirectThreadHarnessGrant(grant, expected);
    // Keep the durable record byte-for-byte stable.  Reconstruction is an
    // observation made by the store, not a mutation of the authority record;
    // changing the nested status would invalidate its owner-issued digest.
    return Object.freeze({ ...grant });
  }

  revoke(grantId, reason = "owner_revoked") {
    const grant = this.read(grantId);
    if (!grant) throw grantError("direct_thread_harness_grant_missing", "Cannot revoke a missing Direct thread harness grant.");
    this.assertAuthoritativeHead(grant);
    const revoked = {
      ...grant,
      currentness: { ...grant.currentness, state: "revoked" },
      revocation: { state: "revoked", revocationRevision: Number(grant.revocation.revocationRevision || 0) + 1, revokedAt: nowIso(), reason: normalizeString(reason, "owner_revoked") },
    };
    revoked.grantDigest = digestFor("direct-thread-harness-grant@1", revoked);
    return this.write(revoked);
  }

  authorize(grantId, toolName, expected = {}) {
    try {
      const grant = this.reconstruct(grantId, expected);
      return authorizeDirectThreadHarnessCapability(grant, toolName, expected);
    } catch (error) {
      return {
        authorized: false,
        reason: normalizeString(error?.code, "direct_thread_harness_grant_invalid"),
        grantId: normalizeString(grantId, ""),
      };
    }
  }
}

class DirectThreadHarnessGrant {
  static issue(input = {}) {
    return grantBase({ ...input, ownerAct: ownerActFor(input, input.nowMs) }, { nowMs: input.nowMs });
  }

  static validate(grant, expected = {}) {
    return validateDirectThreadHarnessGrant(grant, expected);
  }

  static authorize(grant, toolName, expected = {}) {
    return authorizeDirectThreadHarnessCapability(grant, toolName, expected);
  }

  static inherit(parentGrant, input = {}) {
    return inheritDirectThreadHarnessGrant(parentGrant, input);
  }
}

module.exports = {
  DIRECT_HARNESS_GRANT_INHERITANCE_SCHEMA,
  DIRECT_OWNER_FULL_ACCESS_ACT_SCHEMA,
  DIRECT_THREAD_HARNESS_GRANT_INDEX_SCHEMA,
  DIRECT_THREAD_HARNESS_GRANT_SCHEMA,
  DirectThreadHarnessGrant,
  DirectThreadHarnessGrantStore,
  FULL_ACCESS_APPROVAL_POLICY,
  FULL_ACCESS_SANDBOX_MODE,
  authorizeDirectThreadHarnessCapability,
  capabilityNames,
  environmentDigest,
  inheritDirectThreadHarnessGrant,
  issueDirectThreadHarnessGrant: (input = {}) => DirectThreadHarnessGrant.issue(input),
  validateDirectThreadHarnessGrant,
  assertDirectThreadHarnessGrant,
};
