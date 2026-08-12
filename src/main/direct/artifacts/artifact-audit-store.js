"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  AUDIT_VERDICTS,
  assertArtifactAuditBindingPinned,
  assertAuthorized,
  assertNoRawExposure,
  buildEvent,
  buildPolicySnapshot,
  canonicalJson,
  compileArtifactRoutingPlan,
  deepFreeze,
  digestFor,
  fail,
  normalizeEvidenceRefs,
  normalizeAuditAssignment,
  normalizeScope,
  safeTransitionProjection,
  validateArtifactAuditPrincipalAuthority,
  validateArtifactAuditEvidenceReceiptAuthority,
  validateEvent,
  validateEvidenceRecord,
  validatePolicySnapshot,
  verifyArtifactAuditEvidenceReceipt,
  verifyArtifactAuditPrincipal,
} = require("./artifact-audit-kernel");

const STORE_SCHEMA = "direct_artifact_audit_store@3";
const EVENT_TYPES = Object.freeze([
  "artifact_requested", "production_started", "candidate_recorded", "audit_started",
  "audit_verdict_recorded", "artifact_admitted", "artifact_rejected", "artifact_remanded",
]);
const EVENT_OPERATION = Object.freeze({
  artifact_requested: "request",
  production_started: "begin_production",
  candidate_recorded: "submit_candidate",
  audit_started: "begin_audit",
  audit_verdict_recorded: "record_audit_verdict",
  artifact_admitted: "decide_artifact",
  artifact_rejected: "decide_artifact",
  artifact_remanded: "decide_artifact",
});
const DB_OBJECTS = Object.freeze([
  "index:direct_artifact_audit_event_scope_idx",
  "table:direct_artifact_audit_audits",
  "table:direct_artifact_audit_evidence",
  "table:direct_artifact_audit_events",
  "table:direct_artifact_audit_heads",
  "table:direct_artifact_audit_meta",
  "table:direct_artifact_audit_policies",
  "table:direct_artifact_audit_subscriptions",
  "trigger:direct_artifact_audit_audits_no_delete",
  "trigger:direct_artifact_audit_audits_no_update",
  "trigger:direct_artifact_audit_evidence_no_delete",
  "trigger:direct_artifact_audit_evidence_no_update",
  "trigger:direct_artifact_audit_events_no_delete",
  "trigger:direct_artifact_audit_events_no_update",
  "trigger:direct_artifact_audit_meta_no_delete",
  "trigger:direct_artifact_audit_meta_no_update",
  "trigger:direct_artifact_audit_policies_no_delete",
  "trigger:direct_artifact_audit_policies_no_update",
  "trigger:direct_artifact_audit_subscriptions_no_delete",
  "trigger:direct_artifact_audit_subscriptions_no_update",
]);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const AUTH_TAG = /^hmac-sha256:[a-f0-9]{64}$/;

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    fail("artifact_audit_persisted_json_invalid", label);
  }
}

function nowIso(now) {
  const result = new Date(now()).toISOString();
  if (!Number.isFinite(Date.parse(result))) fail("artifact_audit_time_invalid");
  return result;
}

function key(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail("artifact_audit_id_invalid", label);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("artifact_audit_digest_invalid", label);
  return value;
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  if (canonicalJson(actual) !== canonicalJson([...fields].sort())) fail(code);
  return value;
}

function actorFromPrincipal(record) {
  return deepFreeze({ actorId: record.actorId, roleId: record.roleId });
}

function scopeKey(scope) {
  return `${scope.projectId}\u0000${scope.workThreadId}\u0000${scope.artifactId}`;
}

function sameScalar(actual, expected, code = "artifact_audit_store_integrity_failed") {
  if (actual !== expected) fail(code);
}

function assertNoSymlinkComponents(targetPath, code = "artifact_audit_store_path_unsafe") {
  const absolute = path.resolve(targetPath);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail(code);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function assertContained(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  if (!relative || relative === ".") return;
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("artifact_audit_store_path_escape");
  }
}

function loadSecureKeyFile(keyFilePath) {
  if (typeof keyFilePath !== "string" || !path.isAbsolute(keyFilePath)) {
    fail("artifact_audit_store_key_file_required");
  }
  assertNoSymlinkComponents(keyFilePath, "artifact_audit_store_key_file_unsafe");
  if (!fs.existsSync(keyFilePath)) fail("artifact_audit_store_key_file_required");
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let fd;
  try {
    fd = fs.openSync(keyFilePath, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 32 || stat.size > 4096) {
      fail("artifact_audit_store_key_file_unsafe");
    }
    if (process.platform !== "win32") {
      if ((stat.mode & 0o077) !== 0) fail("artifact_audit_store_key_file_permissions_unsafe");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        fail("artifact_audit_store_key_file_owner_unsafe");
      }
    }
    return Buffer.from(fs.readFileSync(fd));
  } catch (error) {
    if (["ELOOP", "EMLINK"].includes(error?.code)) fail("artifact_audit_store_key_file_unsafe");
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function timingSafeStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class DirectArtifactAuditStore {
  #db = null;
  #dbPath;
  #authority;
  #evidenceReceiptAuthority;
  #evidenceAuthorityIdentity;
  #authKey;
  #now;
  #transactionDepth = 0;
  #storeId;
  #storeIdentity;

  constructor(options = {}) {
    const allowed = ["rootDir", "storeId", "authority", "evidenceReceiptAuthority", "keyFilePath", "now"];
    if (!options || typeof options !== "object" || Array.isArray(options) ||
        Object.keys(options).some((entry) => !allowed.includes(entry))) {
      fail("artifact_audit_store_options_invalid");
    }
    if (typeof options.rootDir !== "string" || !path.isAbsolute(options.rootDir)) {
      fail("artifact_audit_store_root_required");
    }
    this.#storeId = key(options.storeId, "storeId");
    this.#authority = options.authority;
    const authorityIdentity = validateArtifactAuditPrincipalAuthority(this.#authority);
    this.#evidenceReceiptAuthority = options.evidenceReceiptAuthority;
    this.#evidenceAuthorityIdentity = validateArtifactAuditEvidenceReceiptAuthority(this.#evidenceReceiptAuthority);
    this.#authKey = loadSecureKeyFile(options.keyFilePath);
    const keyId = `sha256:${crypto.createHash("sha256").update(this.#authKey).digest("hex")}`;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    const requestedRoot = path.resolve(options.rootDir);
    assertNoSymlinkComponents(requestedRoot);
    fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    assertNoSymlinkComponents(requestedRoot);
    const realRoot = fs.realpathSync(requestedRoot);
    const storeDir = path.join(realRoot, "direct-artifact-audit");
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
    assertNoSymlinkComponents(storeDir);
    const realStoreDir = fs.realpathSync(storeDir);
    assertContained(realRoot, realStoreDir);
    this.#dbPath = path.join(realStoreDir, `${this.#storeId}.sqlite`);
    assertNoSymlinkComponents(this.#dbPath);
    const databaseExisted = fs.existsSync(this.#dbPath);
    if (databaseExisted) {
      const stat = fs.lstatSync(this.#dbPath);
      if (stat.isSymbolicLink() || !stat.isFile()) fail("artifact_audit_store_path_unsafe");
      if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
        fail("artifact_audit_store_file_permissions_unsafe");
      }
    }
    this.#storeIdentity = deepFreeze({
      schema: STORE_SCHEMA,
      storeId: this.#storeId,
      pathDigest: digestFor("direct_artifact_audit_store_path@1", { dbPath: this.#dbPath }),
      keyId,
      authorityId: authorityIdentity.authorityId,
      authorityDigest: authorityIdentity.authorityDigest,
      evidenceAuthorityId: this.#evidenceAuthorityIdentity.authorityId,
      evidenceAuthorityDigest: this.#evidenceAuthorityIdentity.authorityDigest,
    });
    try {
      this.#db = new DatabaseSync(this.#dbPath);
      if (!databaseExisted && process.platform !== "win32") fs.chmodSync(this.#dbPath, 0o600);
      const existing = this.#assertPreDdlCustody();
      this.#ensurePragmas();
      if (!existing) this.#ensureSchema();
      this.#verifyStore();
    } catch (error) {
      try { this.#db?.close(); } catch {}
      this.#db = null;
      this.#authKey?.fill(0);
      throw error;
    }
  }

  #ensureOpen() {
    if (!this.#db) fail("artifact_audit_store_closed");
  }

  #authTag(domain, value) {
    return `hmac-sha256:${crypto.createHmac("sha256", this.#authKey)
      .update(`${domain}\n${canonicalJson(value)}`).digest("hex")}`;
  }

  #assertAuthTag(domain, value, actual, code) {
    if (!AUTH_TAG.test(String(actual || "")) || !timingSafeStringEqual(this.#authTag(domain, value), actual)) {
      fail(code);
    }
  }

  #databaseObjects() {
    return this.#db.prepare(`select type, name from sqlite_master
      where name not like 'sqlite_%' order by type, name`).all()
      .map((row) => `${row.type}:${row.name}`).sort();
  }

  #schemaDigest() {
    const definitions = this.#db.prepare(`select type, name, sql from sqlite_master
      where name not like 'sqlite_%' order by type, name`).all().map((row) => ({
      type: row.type, name: row.name, sql: String(row.sql || "").replace(/\s+/g, " ").trim(),
    }));
    return digestFor("direct_artifact_audit_sqlite_schema@1", definitions);
  }

  #assertPreDdlCustody() {
    const objects = this.#databaseObjects();
    if (!objects.length) return false;
    if (!objects.includes("table:direct_artifact_audit_meta")) fail("artifact_audit_foreign_store");
    if (canonicalJson(objects) !== canonicalJson([...DB_OBJECTS].sort())) fail("artifact_audit_store_schema_tampered");
    let meta;
    try {
      meta = Object.fromEntries(this.#db.prepare("select key, value from direct_artifact_audit_meta order by key").all()
        .map((row) => [row.key, row.value]));
    } catch {
      fail("artifact_audit_store_identity_conflict");
    }
    this.#assertMeta(meta);
    return true;
  }

  #ensurePragmas() {
    this.#db.exec("pragma journal_mode = WAL");
    this.#db.exec("pragma foreign_keys = ON");
    this.#db.exec("pragma synchronous = FULL");
    this.#db.exec("pragma busy_timeout = 5000");
  }

  #ensureSchema() {
    this.#db.exec(`
      create table direct_artifact_audit_meta (
        key text primary key,
        value text not null
      );
      create table direct_artifact_audit_policies (
        project_id text not null,
        artifact_class_id text not null,
        policy_revision integer not null,
        policy_digest text not null unique,
        policy_json text not null,
        declared_by text not null,
        declared_role_id text not null,
        declared_at text not null,
        declaration_digest text not null unique,
        declaration_auth_tag text not null unique,
        primary key (project_id, artifact_class_id)
      );
      create table direct_artifact_audit_evidence (
        evidence_id text primary key,
        evidence_digest text not null unique,
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_class_id text not null,
        artifact_revision integer not null,
        policy_digest text not null,
        registered_by text not null,
        registered_role_id text not null,
        evidence_json text not null,
        registered_at text not null,
        registration_digest text not null unique,
        registration_auth_tag text not null unique,
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create table direct_artifact_audit_heads (
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_class_id text not null,
        policy_digest text not null,
        artifact_revision integer not null,
        state text not null,
        head_version integer not null,
        producer_actor_id text not null default '',
        head_event_id text not null,
        updated_at text not null,
        primary key (project_id, work_thread_id, artifact_id),
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create table direct_artifact_audit_events (
        sequence integer primary key,
        event_id text not null unique,
        previous_event_digest text not null,
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_class_id text not null,
        artifact_revision integer not null,
        policy_digest text not null,
        operation text not null,
        event_type text not null,
        actor_id text not null,
        actor_role_id text not null,
        idempotency_key text not null,
        input_digest text not null,
        input_json text not null,
        state_from text,
        state_to text not null,
        event_digest text not null unique,
        event_json text not null,
        event_auth_tag text not null unique,
        occurred_at text not null,
        unique (actor_id, operation, idempotency_key),
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create index direct_artifact_audit_event_scope_idx
        on direct_artifact_audit_events(project_id, work_thread_id, artifact_id, sequence);
      create table direct_artifact_audit_audits (
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_revision integer not null,
        requirement_id text not null,
        auditor_actor_id text not null,
        auditor_role_id text not null,
        verdict text not null,
        event_id text not null unique,
        evidence_json text not null,
        primary key (project_id, work_thread_id, artifact_id, artifact_revision, requirement_id),
        unique (project_id, work_thread_id, artifact_id, artifact_revision, auditor_actor_id),
        foreign key (event_id) references direct_artifact_audit_events(event_id)
      );
      create table direct_artifact_audit_subscriptions (
        subscription_id text primary key,
        project_id text not null,
        work_thread_id text not null default '',
        artifact_id text not null default '',
        artifact_class_id text not null,
        policy_digest text not null,
        subscriber_actor_id text not null,
        subscriber_role_id text not null,
        event_types_json text not null,
        subscription_digest text not null unique,
        subscription_auth_tag text not null unique,
        created_at text not null,
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create trigger direct_artifact_audit_meta_no_update before update on direct_artifact_audit_meta
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_meta_no_delete before delete on direct_artifact_audit_meta
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_policies_no_update before update on direct_artifact_audit_policies
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_policies_no_delete before delete on direct_artifact_audit_policies
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_evidence_no_update before update on direct_artifact_audit_evidence
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_evidence_no_delete before delete on direct_artifact_audit_evidence
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_events_no_update before update on direct_artifact_audit_events
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_events_no_delete before delete on direct_artifact_audit_events
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_audits_no_update before update on direct_artifact_audit_audits
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_audits_no_delete before delete on direct_artifact_audit_audits
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_subscriptions_no_update before update on direct_artifact_audit_subscriptions
        begin select raise(abort, 'artifact_audit_append_only'); end;
      create trigger direct_artifact_audit_subscriptions_no_delete before delete on direct_artifact_audit_subscriptions
        begin select raise(abort, 'artifact_audit_append_only'); end;
    `);
    const genesis = digestFor("direct_artifact_audit_event_genesis@1", this.#storeIdentity);
    const rows = {
      store_schema: STORE_SCHEMA,
      store_id: this.#storeIdentity.storeId,
      path_digest: this.#storeIdentity.pathDigest,
      key_id: this.#storeIdentity.keyId,
      authority_id: this.#storeIdentity.authorityId,
      authority_digest: this.#storeIdentity.authorityDigest,
      evidence_authority_id: this.#storeIdentity.evidenceAuthorityId,
      evidence_authority_digest: this.#storeIdentity.evidenceAuthorityDigest,
      genesis_digest: genesis,
      schema_digest: this.#schemaDigest(),
    };
    rows.custody_auth_tag = this.#authTag("direct_artifact_audit_store_custody@1", rows);
    const insert = this.#db.prepare("insert into direct_artifact_audit_meta(key, value) values (?, ?)");
    for (const [metaKey, value] of Object.entries(rows)) insert.run(metaKey, value);
  }

  #assertMeta(meta) {
    const expected = {
      store_schema: STORE_SCHEMA,
      store_id: this.#storeIdentity.storeId,
      path_digest: this.#storeIdentity.pathDigest,
      key_id: this.#storeIdentity.keyId,
      authority_id: this.#storeIdentity.authorityId,
      authority_digest: this.#storeIdentity.authorityDigest,
      evidence_authority_id: this.#storeIdentity.evidenceAuthorityId,
      evidence_authority_digest: this.#storeIdentity.evidenceAuthorityDigest,
      genesis_digest: digestFor("direct_artifact_audit_event_genesis@1", this.#storeIdentity),
      schema_digest: this.#schemaDigest(),
    };
    const actualAuthTag = meta.custody_auth_tag;
    const actual = { ...meta };
    delete actual.custody_auth_tag;
    if (canonicalJson(actual) !== canonicalJson(expected)) fail("artifact_audit_store_identity_conflict");
    this.#assertAuthTag("direct_artifact_audit_store_custody@1", expected, actualAuthTag,
      "artifact_audit_store_custody_authentication_failed");
  }

  close() {
    if (!this.#db) return;
    this.#db.close();
    this.#db = null;
    this.#authKey?.fill(0);
  }

  #transaction(action) {
    this.#ensureOpen();
    if (this.#transactionDepth > 0) fail("artifact_audit_reentrant_transaction_denied");
    if (this.#db.isTransaction === true) fail("artifact_audit_external_transaction_denied");
    this.#db.exec("begin immediate");
    this.#transactionDepth += 1;
    try {
      const result = action();
      this.#db.exec("commit");
      return result;
    } catch (error) {
      try { this.#db.exec("rollback"); } catch {}
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  #principal(input, purpose, projectId, artifactClassId, policyDigest) {
    const record = verifyArtifactAuditPrincipal(this.#authority, input, {
      purpose, projectId, artifactClassId, policyDigest,
    });
    return actorFromPrincipal(record);
  }

  declareArtifactClass(input = {}) {
    assertNoRawExposure(input, "declaration");
    exactObject(input, ["policy", "principal"], "artifact_audit_declaration_invalid");
    const policy = buildPolicySnapshot(input.policy);
    compileArtifactRoutingPlan(policy, {
      projectId: policy.projectId, workThreadId: "policy-validation", artifactId: "policy-validation",
      artifactClassId: policy.artifactClassId,
    });
    const actor = this.#principal(input.principal, "declare", policy.projectId,
      policy.artifactClassId, policy.policyDigest);
    return this.#transaction(() => {
      const existing = this.#db.prepare(`select policy_json from direct_artifact_audit_policies
        where project_id = ? and artifact_class_id = ?`).get(policy.projectId, policy.artifactClassId);
      if (existing) {
        const persisted = validatePolicySnapshot(parseJson(existing.policy_json, "policy"));
        if (persisted.policyDigest !== policy.policyDigest) fail("artifact_audit_policy_substitution");
        return deepFreeze({ policy: persisted, changed: false });
      }
      const declaredAt = nowIso(this.#now);
      const declarationDigest = digestFor("direct_artifact_audit_declaration@1", {
        policyDigest: policy.policyDigest, actor, declaredAt,
      });
      const declarationAuthTag = this.#authTag("direct_artifact_audit_declaration_auth@1", {
        policy, actor, declaredAt, declarationDigest,
      });
      this.#db.prepare(`insert into direct_artifact_audit_policies(
        project_id, artifact_class_id, policy_revision, policy_digest, policy_json,
        declared_by, declared_role_id, declared_at, declaration_digest, declaration_auth_tag
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        policy.projectId, policy.artifactClassId, policy.revision, policy.policyDigest,
        canonicalJson(policy), actor.actorId, actor.roleId, declaredAt, declarationDigest, declarationAuthTag,
      );
      return deepFreeze({ policy, changed: true });
    });
  }

  #getPolicy(projectId, artifactClassId) {
    this.#ensureOpen();
    const row = this.#db.prepare(`select * from direct_artifact_audit_policies
      where project_id = ? and artifact_class_id = ?`).get(key(projectId, "projectId"), key(artifactClassId, "artifactClassId"));
    return row ? this.#policyFromRow(row) : null;
  }

  #policyFromRow(row) {
    const policy = validatePolicySnapshot(parseJson(row.policy_json, "policy"));
    sameScalar(row.project_id, policy.projectId);
    sameScalar(row.artifact_class_id, policy.artifactClassId);
    sameScalar(Number(row.policy_revision), policy.revision);
    sameScalar(row.policy_digest, policy.policyDigest);
    if (canonicalJson(policy) !== row.policy_json) fail("artifact_audit_policy_integrity_failed");
    const actor = { actorId: row.declared_by, roleId: row.declared_role_id };
    if (!Number.isFinite(Date.parse(row.declared_at)) || row.declaration_digest !==
        digestFor("direct_artifact_audit_declaration@1", {
          policyDigest: policy.policyDigest,
          actor,
          declaredAt: row.declared_at,
        })) fail("artifact_audit_policy_integrity_failed");
    this.#assertAuthTag("direct_artifact_audit_declaration_auth@1", {
      policy, actor, declaredAt: row.declared_at, declarationDigest: row.declaration_digest,
    }, row.declaration_auth_tag, "artifact_audit_policy_authentication_failed");
    return policy;
  }

  #policyFor(scope, policyDigest) {
    const policy = this.#getPolicy(scope.projectId, scope.artifactClassId);
    if (!policy) fail("artifact_audit_policy_missing");
    if (policy.policyDigest !== policyDigest) fail("artifact_audit_policy_substitution");
    return policy;
  }

  compileRoutingPlan(input = {}) {
    assertNoRawExposure(input, "routing");
    exactObject(input, ["scope", "policyDigest", "principal"], "artifact_audit_routing_invalid");
    const scope = normalizeScope(input.scope);
    const policy = this.#policyFor(scope, input.policyDigest);
    const actor = this.#principal(input.principal, "act", scope.projectId,
      scope.artifactClassId, input.policyDigest);
    assertAuthorized(policy, actor, "read", [policy.managerRoleId]);
    return compileArtifactRoutingPlan(policy, scope);
  }

  registerEvidence(input = {}) {
    assertNoRawExposure(input, "evidence-registration");
    exactObject(input, ["receipt", "principal"], "artifact_audit_evidence_registration_invalid");
    const evidence = verifyArtifactAuditEvidenceReceipt(this.#evidenceReceiptAuthority, input.receipt);
    const actor = this.#principal(input.principal, "register_evidence", evidence.projectId,
      evidence.artifactClassId, evidence.policyDigest);
    const policy = this.#policyFor(evidence, evidence.policyDigest);
    this.#assertEvidenceRegistrar(actor);
    return this.#transaction(() => {
      const existing = this.#db.prepare("select * from direct_artifact_audit_evidence where evidence_id = ?")
        .get(evidence.evidenceId);
      if (existing) {
        const persisted = this.#evidenceFromRow(existing);
        if (persisted.evidenceDigest !== evidence.evidenceDigest) fail("artifact_audit_evidence_conflict");
        return deepFreeze({ evidence: persisted, ref: this.#evidencePointer(persisted), changed: false });
      }
      const registeredAt = nowIso(this.#now);
      const registrationDigest = digestFor("direct_artifact_audit_evidence_registration@1", {
        evidenceDigest: evidence.evidenceDigest, actor, registeredAt,
      });
      const registrationAuthTag = this.#authTag("direct_artifact_audit_evidence_registration_auth@1", {
        evidence, actor, registeredAt, registrationDigest,
      });
      this.#db.prepare(`insert into direct_artifact_audit_evidence(
        evidence_id, evidence_digest, project_id, work_thread_id, artifact_id, artifact_class_id,
        artifact_revision, policy_digest, registered_by, registered_role_id, evidence_json, registered_at,
        registration_digest, registration_auth_tag
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        evidence.evidenceId, evidence.evidenceDigest, evidence.projectId, evidence.workThreadId,
        evidence.artifactId, evidence.artifactClassId, evidence.revision, evidence.policyDigest,
        actor.actorId, actor.roleId, canonicalJson(evidence), registeredAt, registrationDigest,
        registrationAuthTag,
      );
      return deepFreeze({ evidence, ref: this.#evidencePointer(evidence), changed: true });
    });
  }

  #assertEvidenceRegistrar(actor) {
    if (canonicalJson(actor) !== canonicalJson(this.#evidenceAuthorityIdentity.adapter)) {
      fail("artifact_audit_evidence_registration_denied");
    }
  }

  #evidencePointer(evidence) {
    return deepFreeze({ evidenceId: evidence.evidenceId, evidenceDigest: evidence.evidenceDigest });
  }

  #evidenceFromRow(row) {
    const evidence = validateEvidenceRecord(parseJson(row.evidence_json, "evidence"));
    const bindings = {
      evidence_id: evidence.evidenceId, evidence_digest: evidence.evidenceDigest,
      project_id: evidence.projectId, work_thread_id: evidence.workThreadId,
      artifact_id: evidence.artifactId, artifact_class_id: evidence.artifactClassId,
      artifact_revision: evidence.revision, policy_digest: evidence.policyDigest,
    };
    for (const [field, expected] of Object.entries(bindings)) sameScalar(field === "artifact_revision" ? Number(row[field]) : row[field], expected);
    if (row.evidence_json !== canonicalJson(evidence)) fail("artifact_audit_evidence_integrity_failed");
    const actor = { actorId: row.registered_by, roleId: row.registered_role_id };
    if (!Number.isFinite(Date.parse(row.registered_at)) || row.registration_digest !==
        digestFor("direct_artifact_audit_evidence_registration@1", {
          evidenceDigest: evidence.evidenceDigest,
          actor,
          registeredAt: row.registered_at,
        })) fail("artifact_audit_evidence_integrity_failed");
    this.#assertAuthTag("direct_artifact_audit_evidence_registration_auth@1", {
      evidence, actor, registeredAt: row.registered_at, registrationDigest: row.registration_digest,
    }, row.registration_auth_tag, "artifact_audit_evidence_authentication_failed");
    return evidence;
  }

  #resolveEvidenceRefs(values, expectedScope, policyDigest, allowedKinds) {
    if (!Array.isArray(values) || !values.length) fail("artifact_audit_evidence_missing");
    const evidence = values.map((pointer) => {
      exactObject(pointer, ["evidenceId", "evidenceDigest"], "artifact_audit_evidence_pointer_invalid");
      const evidenceId = key(pointer.evidenceId, "evidenceId");
      const expectedDigest = digest(pointer.evidenceDigest, "evidenceDigest");
      const row = this.#db.prepare("select * from direct_artifact_audit_evidence where evidence_id = ?").get(evidenceId);
      if (!row) fail("artifact_audit_evidence_unregistered");
      const record = this.#evidenceFromRow(row);
      if (record.evidenceDigest !== expectedDigest) fail("artifact_audit_evidence_digest_mismatch");
      return record;
    });
    return normalizeEvidenceRefs(evidence, expectedScope, policyDigest, allowedKinds);
  }

  #head(scope) {
    return this.#db.prepare(`select * from direct_artifact_audit_heads
      where project_id = ? and work_thread_id = ? and artifact_id = ?`).get(
        scope.projectId, scope.workThreadId, scope.artifactId,
      ) || null;
  }

  #boundAuditAssignment(scope, revision) {
    const row = this.#db.prepare(`select * from direct_artifact_audit_events
      where project_id = ? and work_thread_id = ? and artifact_id = ?
        and artifact_revision = ? and operation = 'begin_audit'`).get(
      scope.projectId, scope.workThreadId, scope.artifactId, revision,
    );
    if (!row) fail("artifact_audit_assignment_missing");
    const event = validateEvent(parseJson(row.event_json, "audit-assignment"));
    this.#verifyEventRow(row, event);
    return normalizeAuditAssignment(event.assignment);
  }

  #inputBinding(operation, input, actor) {
    const bound = { ...input, actor };
    delete bound.idempotencyKey;
    delete bound.principal;
    assertNoRawExposure(bound, `${operation}-input-final`);
    return deepFreeze({
      inputDigest: digestFor(`direct_artifact_audit_${operation}_input@2`, bound),
      inputJson: canonicalJson(bound),
    });
  }

  #replay(actor, operation, idempotencyKey, inputDigest) {
    const row = this.#db.prepare(`select * from direct_artifact_audit_events
      where actor_id = ? and operation = ? and idempotency_key = ?`).get(actor.actorId, operation, idempotencyKey);
    if (!row) return null;
    if (row.input_digest !== inputDigest) fail("artifact_audit_idempotency_input_conflict");
    const event = validateEvent(parseJson(row.event_json, "event-replay"));
    this.#verifyEventRow(row, event);
    return event;
  }

  #assertExpected(head, input) {
    if (!head) fail("artifact_audit_head_missing");
    if (head.policy_digest !== input.policyDigest) fail("artifact_audit_policy_substitution");
    if (head.artifact_revision !== input.expectedRevision) fail("artifact_audit_stale_revision");
    if (head.state !== input.expectedState) fail("artifact_audit_stale_state");
  }

  #chainTip() {
    const row = this.#db.prepare("select * from direct_artifact_audit_events order by sequence desc limit 1").get();
    if (row) {
      const event = validateEvent(parseJson(row.event_json, "event-chain-tip"));
      this.#verifyEventRow(row, event);
      return { sequence: Number(row.sequence) + 1, previousEventDigest: row.event_digest };
    }
    const genesis = this.#db.prepare("select value from direct_artifact_audit_meta where key = 'genesis_digest'").get();
    return { sequence: 1, previousEventDigest: genesis.value };
  }

  #appendEvent({ operation, eventType, actor, scope, policy, idempotencyKey, inputDigest,
    inputJson, revision, stateFrom, stateTo, evidenceRefs = [], audit, decision, assignment }) {
    assertAuthorizedForOperation(policy, actor, operation, audit?.requirementId, scope);
    const { sequence, previousEventDigest } = this.#chainTip();
    const eventId = `dae_${digestFor("direct_artifact_audit_event_id@2", {
      operation, actor, scope, idempotencyKey, inputDigest,
    }).slice(7, 31)}`;
    const event = buildEvent({
      eventId, sequence, previousEventDigest, eventType, scope: { ...scope, revision },
      policyRef: { id: policy.artifactClassId, digest: policy.policyDigest }, actor,
      stateFrom, stateTo, evidenceRefs, occurredAt: nowIso(this.#now),
      ...(audit === undefined ? {} : { audit }), ...(decision === undefined ? {} : { decision }),
      ...(assignment === undefined ? {} : { assignment }),
    });
    assertNoRawExposure(event, "event-final");
    const eventAuthTag = this.#authTag("direct_artifact_audit_event_auth@1", {
      event, operation, idempotencyKey, inputDigest, inputJson,
    });
    this.#db.prepare(`insert into direct_artifact_audit_events(
      sequence, event_id, previous_event_digest, project_id, work_thread_id, artifact_id,
      artifact_class_id, artifact_revision, policy_digest, operation, actor_id, actor_role_id,
      event_type, idempotency_key, input_digest, input_json, state_from, state_to, event_digest, event_json,
      event_auth_tag, occurred_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sequence, event.eventId, previousEventDigest, scope.projectId, scope.workThreadId, scope.artifactId,
      scope.artifactClassId, revision, policy.policyDigest, operation, actor.actorId, actor.roleId,
      eventType, idempotencyKey, inputDigest, inputJson, stateFrom, stateTo,
      event.eventDigest, canonicalJson(event), eventAuthTag, event.occurredAt,
    );
    return event;
  }

  requestArtifact(input = {}) {
    assertNoRawExposure(input, "request");
    exactObject(input, ["scope", "policyDigest", "principal", "idempotencyKey"], "artifact_audit_request_invalid");
    const scope = normalizeScope(input.scope);
    const actor = this.#principal(input.principal, "act", scope.projectId,
      scope.artifactClassId, input.policyDigest);
    const idempotencyKey = key(input.idempotencyKey, "idempotencyKey");
    const { inputDigest, inputJson } = this.#inputBinding("request", input, actor);
    return this.#transaction(() => {
      const replay = this.#replay(actor, "request", idempotencyKey, inputDigest);
      if (replay) return replay;
      const policy = this.#policyFor(scope, input.policyDigest);
      assertAuthorized(policy, actor, "propose", [policy.managerRoleId]);
      if (this.#head(scope)) fail("artifact_audit_artifact_exists");
      const event = this.#appendEvent({ operation: "request", eventType: "artifact_requested", actor, scope,
        policy, idempotencyKey, inputDigest, inputJson, revision: 1, stateFrom: null, stateTo: "requested" });
      this.#db.prepare(`insert into direct_artifact_audit_heads(
        project_id, work_thread_id, artifact_id, artifact_class_id, policy_digest,
        artifact_revision, state, head_version, head_event_id, updated_at
      ) values (?, ?, ?, ?, ?, 1, 'requested', 1, ?, ?)`).run(
        scope.projectId, scope.workThreadId, scope.artifactId, scope.artifactClassId,
        policy.policyDigest, event.eventId, event.occurredAt,
      );
      return event;
    });
  }

  #transition(input, config) {
    assertNoRawExposure(input, config.operation);
    const fields = ["scope", "policyDigest", "principal", "idempotencyKey", "expectedRevision", "expectedState", ...config.fields];
    exactObject(input, fields, "artifact_audit_transition_input_invalid");
    const scope = normalizeScope(input.scope);
    const actor = this.#principal(input.principal, "act", scope.projectId,
      scope.artifactClassId, input.policyDigest);
    const idempotencyKey = key(input.idempotencyKey, "idempotencyKey");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail("artifact_audit_revision_invalid");
    key(input.expectedState, "expectedState");
    const { inputDigest, inputJson } = this.#inputBinding(config.operation, input, actor);
    return this.#transaction(() => {
      const replay = this.#replay(actor, config.operation, idempotencyKey, inputDigest);
      if (replay) return replay;
      const policy = this.#policyFor(scope, input.policyDigest);
      const head = this.#head(scope);
      this.#assertExpected(head, input);
      const prepared = config.prepare({ input, policy, head, actor, scope });
      const revision = prepared.revision || head.artifact_revision;
      const event = this.#appendEvent({
        operation: config.operation, eventType: config.eventType(input), actor, scope, policy,
        idempotencyKey, inputDigest, inputJson, revision, stateFrom: head.state, stateTo: prepared.stateTo,
        evidenceRefs: prepared.evidenceRefs, audit: prepared.audit, decision: prepared.decision,
        assignment: prepared.assignment,
      });
      if (prepared.beforeHeadCas) prepared.beforeHeadCas(event);
      const result = this.#db.prepare(`update direct_artifact_audit_heads set
        artifact_revision = ?, state = ?, head_version = head_version + 1,
        producer_actor_id = ?, head_event_id = ?, updated_at = ?
        where project_id = ? and work_thread_id = ? and artifact_id = ?
          and artifact_revision = ? and state = ? and head_version = ?`).run(
        revision, prepared.stateTo, prepared.producerActorId ?? head.producer_actor_id,
        event.eventId, event.occurredAt, scope.projectId, scope.workThreadId, scope.artifactId,
        head.artifact_revision, head.state, head.head_version,
      );
      if (Number(result.changes) !== 1) fail("artifact_audit_head_compare_and_swap_failed");
      return event;
    });
  }

  beginProduction(input = {}) {
    return this.#transition(input, {
      operation: "begin_production", fields: [], eventType: () => "production_started",
      prepare: ({ policy, head, actor }) => {
        assertAuthorized(policy, actor, "propose", policy.producerRoleIds);
        if (!["requested", "remanded"].includes(head.state)) fail("artifact_audit_transition_denied");
        return { stateTo: "under_production", revision: head.state === "remanded" ? head.artifact_revision + 1 : head.artifact_revision,
          producerActorId: actor.actorId };
      },
    });
  }

  submitCandidate(input = {}) {
    return this.#transition(input, {
      operation: "submit_candidate", fields: ["evidenceRefs"], eventType: () => "candidate_recorded",
      prepare: ({ input: value, policy, head, actor, scope }) => {
        assertAuthorized(policy, actor, "propose", policy.producerRoleIds);
        if (head.state !== "under_production" || head.producer_actor_id !== actor.actorId) fail("artifact_audit_producer_mismatch");
        const evidenceRefs = this.#resolveEvidenceRefs(value.evidenceRefs,
          { ...scope, revision: head.artifact_revision }, policy.policyDigest, policy.allowedEvidenceKinds);
        return { stateTo: "candidate", evidenceRefs };
      },
    });
  }

  beginAudit(input = {}) {
    return this.#transition(input, {
      operation: "begin_audit", fields: [], eventType: () => "audit_started",
      prepare: ({ policy, head, actor, scope }) => {
        const eligible = [...new Set(policy.auditRequirements.flatMap((entry) => entry.auditorRoleIds))];
        assertAuthorized(policy, actor, "challenge", eligible);
        if (head.state !== "candidate") fail("artifact_audit_transition_denied");
        if (policy.auditRequirements.some((entry) => entry.separationRequired) && head.producer_actor_id === actor.actorId) {
          fail("artifact_audit_self_audit_denied");
        }
        const route = compileArtifactRoutingPlan(policy, scope);
        const witness = route.feasibleAssignments.find((entry) => entry.producer.actorId === head.producer_actor_id);
        if (!witness) fail("artifact_audit_assignment_missing");
        const assignment = normalizeAuditAssignment(witness.audits);
        if (!assignment.some((entry) => entry.actorId === actor.actorId && entry.roleId === actor.roleId)) {
          fail("artifact_audit_assignment_actor_ineligible");
        }
        return { stateTo: "under_audit", assignment };
      },
    });
  }

  recordAuditVerdict(input = {}) {
    return this.#transition(input, {
      operation: "record_audit_verdict", fields: ["requirementId", "verdict", "evidenceRefs"],
      eventType: () => "audit_verdict_recorded",
      prepare: ({ input: value, policy, head, actor, scope }) => {
        if (head.state !== "under_audit") fail("artifact_audit_transition_denied");
        const requirement = policy.auditRequirements.find((entry) => entry.requirementId === value.requirementId);
        if (!requirement) fail("artifact_audit_requirement_unknown");
        assertAuthorized(policy, actor, "challenge", requirement.auditorRoleIds);
        const assignment = this.#boundAuditAssignment(scope, head.artifact_revision);
        const assigned = assignment.find((entry) => entry.requirementId === value.requirementId);
        if (!assigned || assigned.actorId !== actor.actorId || assigned.roleId !== actor.roleId) {
          fail("artifact_audit_assignment_actor_mismatch");
        }
        if (requirement.separationRequired && head.producer_actor_id === actor.actorId) fail("artifact_audit_self_audit_denied");
        if (!AUDIT_VERDICTS.includes(value.verdict)) fail("artifact_audit_verdict_invalid");
        const evidenceRefs = this.#resolveEvidenceRefs(value.evidenceRefs,
          { ...scope, revision: head.artifact_revision }, policy.policyDigest, requirement.evidenceKinds);
        const existingRequirement = this.#db.prepare(`select 1 from direct_artifact_audit_audits
          where project_id = ? and work_thread_id = ? and artifact_id = ?
            and artifact_revision = ? and requirement_id = ?`).get(
          scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision, value.requirementId,
        );
        const existingActor = this.#db.prepare(`select 1 from direct_artifact_audit_audits
          where project_id = ? and work_thread_id = ? and artifact_id = ?
            and artifact_revision = ? and auditor_actor_id = ?`).get(
          scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision, actor.actorId,
        );
        if (existingRequirement || existingActor) fail("artifact_audit_duplicate_audit_identity");
        const prior = this.#db.prepare(`select requirement_id, verdict from direct_artifact_audit_audits
          where project_id = ? and work_thread_id = ? and artifact_id = ? and artifact_revision = ?`).all(
          scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision,
        );
        const all = [...prior, { requirement_id: value.requirementId, verdict: value.verdict }];
        const complete = policy.auditRequirements.every((entry) => all.some((audit) => audit.requirement_id === entry.requirementId));
        const stateTo = !complete ? "under_audit"
          : all.some((audit) => audit.verdict === "contradicted") ? "contradicted"
            : all.some((audit) => audit.verdict === "requires_revision") ? "requires_revision" : "supported";
        return {
          stateTo, evidenceRefs, audit: { requirementId: value.requirementId, verdict: value.verdict },
          beforeHeadCas: (event) => {
            this.#db.prepare(`insert into direct_artifact_audit_audits(
              project_id, work_thread_id, artifact_id, artifact_revision, requirement_id,
              auditor_actor_id, auditor_role_id, verdict, event_id, evidence_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision,
              value.requirementId, actor.actorId, actor.roleId, value.verdict, event.eventId,
              canonicalJson(evidenceRefs),
            );
          },
        };
      },
    });
  }

  decideArtifact(input = {}) {
    return this.#transition(input, {
      operation: "decide_artifact", fields: ["decision"],
      eventType: (value) => value.decision === "admitted" ? "artifact_admitted"
        : value.decision === "rejected" ? "artifact_rejected" : "artifact_remanded",
      prepare: ({ input: value, policy, head, actor }) => {
        assertAuthorized(policy, actor, "admit", [policy.admissionRoleId]);
        if (!["admitted", "rejected", "remanded"].includes(value.decision)) fail("artifact_audit_decision_invalid");
        if (value.decision === "admitted" && head.state !== "supported") fail("artifact_audit_admission_incomplete");
        if (value.decision === "remanded" && !["requires_revision", "contradicted"].includes(head.state)) fail("artifact_audit_remand_invalid");
        if (value.decision === "rejected" && !["supported", "requires_revision", "contradicted"].includes(head.state)) {
          fail("artifact_audit_rejection_invalid");
        }
        return { stateTo: value.decision, decision: { disposition: value.decision } };
      },
    });
  }

  subscribe(input = {}) {
    assertNoRawExposure(input, "subscription");
    exactObject(input, [
      "subscriptionId", "projectId", "workThreadId", "artifactId", "artifactClassId",
      "policyDigest", "principal", "eventTypes",
    ], "artifact_audit_subscription_invalid");
    const projectId = key(input.projectId, "projectId");
    const artifactClassId = key(input.artifactClassId, "artifactClassId");
    const actor = this.#principal(input.principal, "act", projectId, artifactClassId, input.policyDigest);
    const policy = this.#policyFor({ projectId, artifactClassId }, input.policyDigest);
    assertAuthorized(policy, actor, "subscribe");
    assertAuthorized(policy, actor, "read");
    const eventTypes = Array.isArray(input.eventTypes) ? [...new Set(input.eventTypes)].sort() : [];
    if (!eventTypes.length || eventTypes.some((value) => !EVENT_TYPES.includes(value))) fail("artifact_audit_subscription_event_invalid");
    const subscriptionId = key(input.subscriptionId, "subscriptionId");
    const workThreadId = input.workThreadId ? key(input.workThreadId, "workThreadId") : "";
    const artifactId = input.artifactId ? key(input.artifactId, "artifactId") : "";
    return this.#transaction(() => {
      const priorRow = this.#db.prepare("select * from direct_artifact_audit_subscriptions where subscription_id = ?")
        .get(subscriptionId);
      if (priorRow) {
        const prior = this.#subscriptionFromRow(priorRow);
        if (prior.projectId !== projectId || prior.workThreadId !== workThreadId ||
            prior.artifactId !== artifactId || prior.artifactClassId !== artifactClassId ||
            prior.policyDigest !== policy.policyDigest || canonicalJson(prior.actor) !== canonicalJson(actor) ||
            canonicalJson(prior.eventTypes) !== canonicalJson(eventTypes)) {
          fail("artifact_audit_subscription_conflict");
        }
        return prior;
      }
      const subscription = {
        subscriptionId, projectId, workThreadId, artifactId, artifactClassId,
        policyDigest: policy.policyDigest, actor, eventTypes, createdAt: nowIso(this.#now),
      };
      subscription.subscriptionDigest = subscriptionDigest(subscription);
      const subscriptionAuthTag = this.#authTag("direct_artifact_audit_subscription_auth@1", subscription);
      this.#db.prepare(`insert into direct_artifact_audit_subscriptions(
        subscription_id, project_id, work_thread_id, artifact_id, artifact_class_id,
        policy_digest, subscriber_actor_id, subscriber_role_id, event_types_json,
        subscription_digest, subscription_auth_tag, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        subscription.subscriptionId, projectId, subscription.workThreadId, subscription.artifactId,
        artifactClassId, policy.policyDigest, actor.actorId, actor.roleId,
        canonicalJson(eventTypes), subscription.subscriptionDigest, subscriptionAuthTag, subscription.createdAt,
      );
      return deepFreeze(subscription);
    });
  }

  #subscriptionFromRow(row) {
    const subscription = {
      subscriptionId: row.subscription_id, projectId: row.project_id, workThreadId: row.work_thread_id,
      artifactId: row.artifact_id, artifactClassId: row.artifact_class_id, policyDigest: row.policy_digest,
      actor: { actorId: row.subscriber_actor_id, roleId: row.subscriber_role_id },
      eventTypes: parseJson(row.event_types_json, "subscription-events"), createdAt: row.created_at,
      subscriptionDigest: row.subscription_digest,
    };
    if (canonicalJson(subscription.eventTypes) !== row.event_types_json ||
        !Number.isFinite(Date.parse(subscription.createdAt)) ||
        subscriptionDigest(subscription) !== subscription.subscriptionDigest) {
      fail("artifact_audit_subscription_integrity_failed");
    }
    this.#assertAuthTag("direct_artifact_audit_subscription_auth@1", subscription,
      row.subscription_auth_tag, "artifact_audit_subscription_authentication_failed");
    return deepFreeze(subscription);
  }

  pollSubscription(input = {}) {
    assertNoRawExposure(input, "poll");
    exactObject(input, ["subscriptionId", "principal", "afterSequence", "limit"], "artifact_audit_poll_invalid");
    const id = key(input.subscriptionId, "subscriptionId");
    const row = this.#db.prepare("select * from direct_artifact_audit_subscriptions where subscription_id = ?").get(id);
    if (!row) fail("artifact_audit_subscription_missing");
    const subscription = this.#subscriptionFromRow(row);
    const actor = this.#principal(input.principal, "act", subscription.projectId,
      subscription.artifactClassId, subscription.policyDigest);
    if (canonicalJson(actor) !== canonicalJson(subscription.actor)) fail("artifact_audit_subscription_actor_mismatch");
    const policy = this.#policyFor(subscription, subscription.policyDigest);
    assertAuthorized(policy, actor, "subscribe");
    assertAuthorized(policy, actor, "read");
    const afterSequence = Number(input.afterSequence);
    const limit = Number(input.limit);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      fail("artifact_audit_projection_bounds_invalid");
    }
    const eventPlaceholders = subscription.eventTypes.map(() => "?").join(", ");
    const scopeClauses = ["sequence > ?", "project_id = ?", "artifact_class_id = ?", `event_type in (${eventPlaceholders})`];
    const parameters = [afterSequence, subscription.projectId, subscription.artifactClassId, ...subscription.eventTypes];
    if (subscription.workThreadId) { scopeClauses.push("work_thread_id = ?"); parameters.push(subscription.workThreadId); }
    if (subscription.artifactId) { scopeClauses.push("artifact_id = ?"); parameters.push(subscription.artifactId); }
    parameters.push(limit + 1);
    const events = this.#db.prepare(`select * from direct_artifact_audit_events
      where ${scopeClauses.join(" and ")} order by sequence limit ?`).all(...parameters)
      .map((entry) => {
        const event = validateEvent(parseJson(entry.event_json, "event-projection"));
        this.#verifyEventRow(entry, event);
        return event;
      });
    return safeTransitionProjection({ ...subscription, afterSequence, limit }, events);
  }

  inspectHead(input = {}) {
    assertNoRawExposure(input, "inspect");
    exactObject(input, ["scope", "policyDigest", "principal", "subscriptionId"], "artifact_audit_inspect_invalid");
    const scope = normalizeScope(input.scope);
    const policy = this.#policyFor(scope, input.policyDigest);
    const actor = this.#principal(input.principal, "act", scope.projectId,
      scope.artifactClassId, input.policyDigest);
    const subscriptionRow = this.#db.prepare(`select * from direct_artifact_audit_subscriptions
      where subscription_id = ?`).get(key(input.subscriptionId, "subscriptionId"));
    if (!subscriptionRow) fail("artifact_audit_subscription_missing");
    const subscription = this.#subscriptionFromRow(subscriptionRow);
    if (subscription.projectId !== scope.projectId || subscription.artifactClassId !== scope.artifactClassId ||
        subscription.policyDigest !== input.policyDigest ||
        (subscription.workThreadId && subscription.workThreadId !== scope.workThreadId) ||
        (subscription.artifactId && subscription.artifactId !== scope.artifactId) ||
        canonicalJson(subscription.actor) !== canonicalJson(actor)) {
      fail("artifact_audit_subscription_scope_mismatch");
    }
    assertAuthorized(policy, actor, "subscribe");
    assertAuthorized(policy, actor, "read");
    return this.#headProjection(scope, policy);
  }

  inspectHeadAdministrative(input = {}) {
    assertNoRawExposure(input, "administrative-inspect");
    exactObject(input, ["scope", "policyDigest", "principal"], "artifact_audit_inspect_invalid");
    const scope = normalizeScope(input.scope);
    const policy = this.#policyFor(scope, input.policyDigest);
    const actor = this.#principal(input.principal, "admin_read", scope.projectId,
      scope.artifactClassId, input.policyDigest);
    assertAuthorized(policy, actor, "read", [policy.managerRoleId]);
    return this.#headProjection(scope, policy);
  }

  #headProjection(scope, policy) {
    const head = this.#head(scope);
    if (!head) return null;
    return deepFreeze({
      scope: { ...scope, revision: head.artifact_revision },
      policyRef: { id: policy.artifactClassId, digest: policy.policyDigest },
      state: head.state, headVersion: head.head_version, headEventId: head.head_event_id,
    });
  }

  diagnostics(input = {}) {
    this.#ensureOpen();
    assertNoRawExposure(input, "diagnostics");
    exactObject(input, ["projectId", "artifactClassId", "policyDigest", "principal"],
      "artifact_audit_diagnostics_invalid");
    const projectId = key(input.projectId, "projectId");
    const artifactClassId = key(input.artifactClassId, "artifactClassId");
    const policy = this.#policyFor({ projectId, artifactClassId }, input.policyDigest);
    const actor = this.#principal(input.principal, "act", projectId, artifactClassId, input.policyDigest);
    assertAuthorized(policy, actor, "read", [policy.managerRoleId]);
    const journal = this.#db.prepare("pragma journal_mode").get();
    const counts = {};
    for (const table of ["policies", "evidence", "events", "audits", "heads", "subscriptions"]) {
      const actual = table === "audits" ? "direct_artifact_audit_audits" : `direct_artifact_audit_${table}`;
      counts[table] = Number(this.#db.prepare(`select count(*) as count from ${actual} where project_id = ?`)
        .get(projectId).count);
    }
    return deepFreeze({
      schema: "direct_artifact_audit_diagnostics@1", storeId: this.#storeId,
      journalMode: String(journal.journal_mode).toLowerCase(), counts, integrityVerified: true,
    });
  }

  #verifyStore() {
    if (canonicalJson(this.#databaseObjects()) !== canonicalJson([...DB_OBJECTS].sort())) fail("artifact_audit_store_schema_tampered");
    const meta = Object.fromEntries(this.#db.prepare("select key, value from direct_artifact_audit_meta order by key").all()
      .map((row) => [row.key, row.value]));
    this.#assertMeta(meta);
    const integrity = this.#db.prepare("pragma integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") fail("artifact_audit_store_integrity_failed");
    if (this.#db.prepare("pragma foreign_key_check").all().length) fail("artifact_audit_foreign_key_integrity_failed");

    const policies = new Map();
    for (const row of this.#db.prepare("select * from direct_artifact_audit_policies order by project_id, artifact_class_id").all()) {
      const policy = this.#policyFromRow(row);
      compileArtifactRoutingPlan(policy, {
        projectId: policy.projectId, workThreadId: "policy-validation", artifactId: "policy-validation",
        artifactClassId: policy.artifactClassId,
      });
      assertArtifactAuditBindingPinned(this.#authority, {
        projectId: policy.projectId, artifactClassId: policy.artifactClassId, policyDigest: policy.policyDigest,
        actorId: row.declared_by, roleId: row.declared_role_id, purpose: "declare",
      });
      policies.set(`${policy.projectId}\u0000${policy.artifactClassId}`, policy);
    }
    const policyFor = (scope, policyDigest) => {
      const policy = policies.get(`${scope.projectId}\u0000${scope.artifactClassId}`);
      if (!policy || policy.policyDigest !== policyDigest) fail("artifact_audit_policy_integrity_failed");
      return policy;
    };

    const evidenceRegistry = new Map();
    for (const row of this.#db.prepare("select * from direct_artifact_audit_evidence order by evidence_id").all()) {
      const evidence = this.#evidenceFromRow(row);
      const policy = policyFor(evidence, evidence.policyDigest);
      assertArtifactAuditBindingPinned(this.#authority, {
        projectId: evidence.projectId, artifactClassId: evidence.artifactClassId,
        policyDigest: evidence.policyDigest, actorId: row.registered_by,
        roleId: row.registered_role_id, purpose: "register_evidence",
      });
      this.#assertEvidenceRegistrar({ actorId: row.registered_by, roleId: row.registered_role_id });
      evidenceRegistry.set(evidence.evidenceId, evidence);
    }

    const reconstructedHeads = new Map();
    const reconstructedAudits = new Map();
    let expectedSequence = 1;
    let previousEventDigest = meta.genesis_digest;
    for (const row of this.#db.prepare("select * from direct_artifact_audit_events order by sequence").all()) {
      const event = validateEvent(parseJson(row.event_json, "event"));
      if (event.sequence !== expectedSequence || event.previousEventDigest !== previousEventDigest) {
        fail("artifact_audit_event_chain_invalid");
      }
      this.#verifyEventRow(row, event);
      const policy = policyFor(event.scope, event.policyRef.digest);
      if (event.policyRef.id !== policy.artifactClassId) fail("artifact_audit_event_integrity_failed");
      assertArtifactAuditBindingPinned(this.#authority, {
        projectId: event.scope.projectId, artifactClassId: event.scope.artifactClassId,
        policyDigest: event.policyRef.digest, actorId: event.actor.actorId,
        roleId: event.actor.roleId, purpose: "act",
      });
      assertAuthorizedForOperation(policy, event.actor, row.operation, event.audit?.requirementId, event.scope);
      for (const ref of event.evidenceRefs) {
        const registered = evidenceRegistry.get(ref.evidenceId);
        if (!registered || canonicalJson(registered) !== canonicalJson(ref)) fail("artifact_audit_evidence_integrity_failed");
      }
      this.#replayEvent(event, row.operation, policy, reconstructedHeads, reconstructedAudits);
      previousEventDigest = event.eventDigest;
      expectedSequence += 1;
    }
    this.#verifyHeads(reconstructedHeads);
    this.#verifyAudits(reconstructedAudits);
    this.#verifySubscriptions(policyFor);
  }

  #verifyEventRow(row, event) {
    const bindings = {
      sequence: event.sequence, event_id: event.eventId, previous_event_digest: event.previousEventDigest,
      project_id: event.scope.projectId, work_thread_id: event.scope.workThreadId,
      artifact_id: event.scope.artifactId, artifact_class_id: event.scope.artifactClassId,
      artifact_revision: event.scope.revision, policy_digest: event.policyRef.digest,
      event_type: event.eventType, actor_id: event.actor.actorId, actor_role_id: event.actor.roleId,
      state_from: event.stateFrom, state_to: event.stateTo, event_digest: event.eventDigest,
      occurred_at: event.occurredAt,
    };
    for (const [field, expected] of Object.entries(bindings)) {
      sameScalar(["sequence", "artifact_revision"].includes(field) ? Number(row[field]) : row[field], expected);
    }
    const input = parseJson(row.input_json, "event-input");
    assertNoRawExposure(input, "persisted-event-input");
    const inputScope = normalizeScope(input.scope);
    const eventScope = {
      projectId: event.scope.projectId, workThreadId: event.scope.workThreadId,
      artifactId: event.scope.artifactId, artifactClassId: event.scope.artifactClassId,
    };
    if (row.input_json !== canonicalJson(input) || canonicalJson(input.actor) !== canonicalJson(event.actor) ||
        canonicalJson(inputScope) !== canonicalJson(eventScope) || input.policyDigest !== event.policyRef.digest ||
        Object.hasOwn(input, "principal") || Object.hasOwn(input, "idempotencyKey") ||
        row.input_digest !== digestFor(`direct_artifact_audit_${row.operation}_input@2`, input)) {
      fail("artifact_audit_event_input_integrity_failed");
    }
    if (row.event_json !== canonicalJson(event) || EVENT_OPERATION[event.eventType] !== row.operation ||
        !DIGEST.test(row.input_digest) || !ID.test(row.idempotency_key)) fail("artifact_audit_event_integrity_failed");
    this.#assertAuthTag("direct_artifact_audit_event_auth@1", {
      event, operation: row.operation, idempotencyKey: row.idempotency_key,
      inputDigest: row.input_digest, inputJson: row.input_json,
    }, row.event_auth_tag, "artifact_audit_event_authentication_failed");
    const expectedId = `dae_${digestFor("direct_artifact_audit_event_id@2", {
      operation: row.operation, actor: event.actor,
      scope: { projectId: event.scope.projectId, workThreadId: event.scope.workThreadId,
        artifactId: event.scope.artifactId, artifactClassId: event.scope.artifactClassId },
      idempotencyKey: row.idempotency_key, inputDigest: row.input_digest,
    }).slice(7, 31)}`;
    if (expectedId !== event.eventId) fail("artifact_audit_event_integrity_failed");
  }

  #replayEvent(event, operation, policy, heads, audits) {
    const keyValue = scopeKey(event.scope);
    const prior = heads.get(keyValue) || null;
    let producerActorId = prior?.producerActorId || "";
    let assignment = prior?.assignment || [];
    let expectedState;
    let expectedRevision;
    if (operation === "record_audit_verdict") {
      if (!event.audit || event.decision || event.assignment || !event.evidenceRefs.length) fail("artifact_audit_history_invalid");
    } else if (operation === "decide_artifact") {
      if (!event.decision || event.audit || event.assignment || event.evidenceRefs.length) fail("artifact_audit_history_invalid");
    } else if (operation === "submit_candidate") {
      if (event.audit || event.decision || event.assignment || !event.evidenceRefs.length) fail("artifact_audit_history_invalid");
    } else if (operation === "begin_audit") {
      if (event.audit || event.decision || !event.assignment || event.evidenceRefs.length) fail("artifact_audit_history_invalid");
    } else if (event.audit || event.decision || event.assignment || event.evidenceRefs.length) {
      fail("artifact_audit_history_invalid");
    }
    if (operation === "request") {
      if (prior || event.stateFrom !== null) fail("artifact_audit_history_invalid");
      expectedState = "requested";
      expectedRevision = 1;
    } else {
      if (!prior || event.stateFrom !== prior.state) fail("artifact_audit_history_invalid");
      expectedRevision = prior.revision;
      if (operation === "begin_production") {
        if (!["requested", "remanded"].includes(prior.state)) fail("artifact_audit_history_invalid");
        expectedRevision = prior.state === "remanded" ? prior.revision + 1 : prior.revision;
        producerActorId = event.actor.actorId;
        assignment = [];
        expectedState = "under_production";
      } else if (operation === "submit_candidate") {
        if (prior.state !== "under_production" || producerActorId !== event.actor.actorId || !event.evidenceRefs.length) {
          fail("artifact_audit_history_invalid");
        }
        normalizeEvidenceRefs(event.evidenceRefs, event.scope, policy.policyDigest, policy.allowedEvidenceKinds);
        expectedState = "candidate";
      } else if (operation === "begin_audit") {
        if (prior.state !== "candidate" || (policy.auditRequirements.some((entry) => entry.separationRequired) &&
            producerActorId === event.actor.actorId)) fail("artifact_audit_history_invalid");
        const route = compileArtifactRoutingPlan(policy, {
          projectId: event.scope.projectId, workThreadId: event.scope.workThreadId,
          artifactId: event.scope.artifactId, artifactClassId: event.scope.artifactClassId,
        });
        const witness = route.feasibleAssignments.find((entry) => entry.producer.actorId === producerActorId);
        const expectedAssignment = witness ? normalizeAuditAssignment(witness.audits) : null;
        if (!expectedAssignment || canonicalJson(expectedAssignment) !== canonicalJson(event.assignment) ||
            !expectedAssignment.some((entry) => entry.actorId === event.actor.actorId && entry.roleId === event.actor.roleId)) {
          fail("artifact_audit_history_invalid");
        }
        assignment = expectedAssignment;
        expectedState = "under_audit";
      } else if (operation === "record_audit_verdict") {
        if (prior.state !== "under_audit" || !event.audit) fail("artifact_audit_history_invalid");
        const requirement = policy.auditRequirements.find((entry) => entry.requirementId === event.audit.requirementId);
        if (!requirement || (requirement.separationRequired && producerActorId === event.actor.actorId)) {
          fail("artifact_audit_history_invalid");
        }
        const assigned = assignment.find((entry) => entry.requirementId === event.audit.requirementId);
        if (!assigned || assigned.actorId !== event.actor.actorId || assigned.roleId !== event.actor.roleId) {
          fail("artifact_audit_history_invalid");
        }
        normalizeEvidenceRefs(event.evidenceRefs, event.scope, policy.policyDigest, requirement.evidenceKinds);
        const revisionKey = `${keyValue}\u0000${event.scope.revision}`;
        const priorAudits = audits.get(revisionKey) || [];
        if (priorAudits.some((entry) => entry.requirementId === event.audit.requirementId ||
            entry.actor.actorId === event.actor.actorId)) fail("artifact_audit_history_invalid");
        priorAudits.push({
          requirementId: event.audit.requirementId, verdict: event.audit.verdict, actor: event.actor,
          eventId: event.eventId, evidenceRefs: event.evidenceRefs,
        });
        audits.set(revisionKey, priorAudits);
        const complete = policy.auditRequirements.every((entry) => priorAudits.some((audit) => audit.requirementId === entry.requirementId));
        expectedState = !complete ? "under_audit"
          : priorAudits.some((audit) => audit.verdict === "contradicted") ? "contradicted"
            : priorAudits.some((audit) => audit.verdict === "requires_revision") ? "requires_revision" : "supported";
      } else if (operation === "decide_artifact") {
        const disposition = event.decision?.disposition;
        if (disposition === "admitted" && prior.state !== "supported") fail("artifact_audit_history_invalid");
        if (disposition === "remanded" && !["requires_revision", "contradicted"].includes(prior.state)) fail("artifact_audit_history_invalid");
        if (disposition === "rejected" && !["supported", "requires_revision", "contradicted"].includes(prior.state)) {
          fail("artifact_audit_history_invalid");
        }
        expectedState = disposition;
      } else {
        fail("artifact_audit_history_invalid");
      }
    }
    if (event.scope.revision !== expectedRevision || event.stateTo !== expectedState) fail("artifact_audit_history_invalid");
    heads.set(keyValue, {
      scope: { projectId: event.scope.projectId, workThreadId: event.scope.workThreadId,
        artifactId: event.scope.artifactId, artifactClassId: event.scope.artifactClassId },
      policyDigest: event.policyRef.digest, revision: expectedRevision, state: expectedState,
      headVersion: (prior?.headVersion || 0) + 1, producerActorId, headEventId: event.eventId,
      updatedAt: event.occurredAt, assignment,
    });
  }

  #verifyHeads(reconstructed) {
    const rows = this.#db.prepare("select * from direct_artifact_audit_heads order by project_id, work_thread_id, artifact_id").all();
    if (rows.length !== reconstructed.size) fail("artifact_audit_head_integrity_failed");
    for (const row of rows) {
      const expected = reconstructed.get(`${row.project_id}\u0000${row.work_thread_id}\u0000${row.artifact_id}`);
      if (!expected || row.artifact_class_id !== expected.scope.artifactClassId ||
          row.policy_digest !== expected.policyDigest || Number(row.artifact_revision) !== expected.revision ||
          row.state !== expected.state || Number(row.head_version) !== expected.headVersion ||
          row.producer_actor_id !== expected.producerActorId || row.head_event_id !== expected.headEventId ||
          row.updated_at !== expected.updatedAt) fail("artifact_audit_head_integrity_failed");
    }
  }

  #verifyAudits(reconstructed) {
    const expected = [...reconstructed.entries()].flatMap(([revisionKey, audits]) => audits.map((audit) => ({ revisionKey, ...audit })));
    const rows = this.#db.prepare(`select * from direct_artifact_audit_audits
      order by project_id, work_thread_id, artifact_id, artifact_revision, requirement_id`).all();
    if (rows.length !== expected.length) fail("artifact_audit_audit_integrity_failed");
    const byEvent = new Map(expected.map((entry) => [entry.eventId, entry]));
    for (const row of rows) {
      const entry = byEvent.get(row.event_id);
      const revisionKey = `${row.project_id}\u0000${row.work_thread_id}\u0000${row.artifact_id}\u0000${row.artifact_revision}`;
      if (!entry || entry.revisionKey !== revisionKey || row.requirement_id !== entry.requirementId ||
          row.auditor_actor_id !== entry.actor.actorId || row.auditor_role_id !== entry.actor.roleId ||
          row.verdict !== entry.verdict || row.evidence_json !== canonicalJson(entry.evidenceRefs)) {
        fail("artifact_audit_audit_integrity_failed");
      }
    }
  }

  #verifySubscriptions(policyFor) {
    for (const row of this.#db.prepare("select * from direct_artifact_audit_subscriptions order by subscription_id").all()) {
      const subscription = this.#subscriptionFromRow(row);
      if (!subscription.eventTypes.length || subscription.eventTypes.some((entry) => !EVENT_TYPES.includes(entry))) {
        fail("artifact_audit_subscription_integrity_failed");
      }
      assertArtifactAuditBindingPinned(this.#authority, {
        projectId: subscription.projectId, artifactClassId: subscription.artifactClassId,
        policyDigest: subscription.policyDigest, actorId: subscription.actor.actorId,
        roleId: subscription.actor.roleId, purpose: "act",
      });
      const policy = policyFor(subscription, subscription.policyDigest);
      assertAuthorized(policy, subscription.actor, "subscribe");
      assertAuthorized(policy, subscription.actor, "read");
    }
  }
}

function assertAuthorizedForOperation(policy, actor, operation, requirementId, scope) {
  if (operation === "request") return assertAuthorized(policy, actor, "propose", [policy.managerRoleId]);
  if (["begin_production", "submit_candidate"].includes(operation)) {
    assertAuthorized(policy, actor, "propose", policy.producerRoleIds);
    const route = compileArtifactRoutingPlan(policy, {
      projectId: scope.projectId, workThreadId: scope.workThreadId,
      artifactId: scope.artifactId, artifactClassId: scope.artifactClassId,
    });
    if (!route.producer.eligibleActors.some((entry) => canonicalJson(entry) === canonicalJson(actor))) {
      fail("artifact_audit_producer_route_unfillable");
    }
    return actor;
  }
  if (operation === "begin_audit") {
    return assertAuthorized(policy, actor, "challenge",
      [...new Set(policy.auditRequirements.flatMap((entry) => entry.auditorRoleIds))]);
  }
  if (operation === "record_audit_verdict") {
    const requirement = policy.auditRequirements.find((entry) => entry.requirementId === requirementId);
    if (!requirement) fail("artifact_audit_requirement_unknown");
    return assertAuthorized(policy, actor, "challenge", requirement.auditorRoleIds);
  }
  if (operation === "decide_artifact") return assertAuthorized(policy, actor, "admit", [policy.admissionRoleId]);
  fail("artifact_audit_operation_invalid");
}

function subscriptionDigest(subscription) {
  return digestFor("direct_artifact_audit_subscription@2", {
    subscriptionId: subscription.subscriptionId, projectId: subscription.projectId,
    workThreadId: subscription.workThreadId, artifactId: subscription.artifactId,
    artifactClassId: subscription.artifactClassId, policyDigest: subscription.policyDigest,
    actor: subscription.actor, eventTypes: subscription.eventTypes, createdAt: subscription.createdAt,
  });
}

function createDirectArtifactAuditStore(options) {
  return new DirectArtifactAuditStore(options);
}

module.exports = {
  DirectArtifactAuditStore,
  EVENT_TYPES,
  STORE_SCHEMA,
  createDirectArtifactAuditStore,
};
