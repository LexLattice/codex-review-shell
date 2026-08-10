"use strict";

const crypto = require("node:crypto");

const EPISTEMIC_FABRIC_STATE_STORE_SCHEMA =
  "direct_epistemic_fabric_state_store@1";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (typeof value[key] !== "undefined") {
        result[key] = stableValue(value[key]);
      }
      return result;
    }, {});
}

function digestFor(domain, value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value))}`)
    .digest("hex")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class DirectEpistemicFabricStateStore {
  constructor(options = {}) {
    if (!options.db) {
      fail("epistemic_fabric_state_database_required");
    }
    this.db = options.db;
    this.now =
      typeof options.now === "function"
        ? options.now
        : Date.now;
    this.ensureSchema();
  }

  ensureSchema() {
    this.db.exec(`
      create table if not exists wm_epistemic_component_states (
        component_id text primary key,
        revision integer not null,
        state_digest text not null,
        state_json text not null,
        updated_at text not null
      );

      create table if not exists wm_epistemic_component_state_history (
        component_id text not null,
        revision integer not null,
        state_digest text not null,
        state_json text not null,
        updated_at text not null,
        primary key (component_id, revision)
      );
    `);
  }

  read(componentId) {
    const id = text(componentId, "");
    if (!id) fail("epistemic_fabric_component_id_required");
    const row = this.db
      .prepare(`
        select component_id, revision, state_digest, state_json, updated_at
        from wm_epistemic_component_states
        where component_id = ?
      `)
      .get(id);
    if (!row) return null;
    let state;
    try {
      state = JSON.parse(row.state_json);
    } catch {
      fail("epistemic_fabric_component_state_json_invalid", id);
    }
    const expected = digestFor(
      "direct-epistemic-fabric-component-state@1",
      state,
    );
    if (expected !== row.state_digest) {
      fail("epistemic_fabric_component_state_digest_mismatch", id);
    }
    return {
      schema: EPISTEMIC_FABRIC_STATE_STORE_SCHEMA,
      componentId: row.component_id,
      revision: Number(row.revision),
      stateDigest: row.state_digest,
      state,
      updatedAt: row.updated_at,
      canonicalWorldstateEffect: false,
      grantsAuthority: false,
    };
  }

  write(componentId, state, options = {}) {
    const id = text(componentId, "");
    if (!id) fail("epistemic_fabric_component_id_required");
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      fail("epistemic_fabric_component_state_invalid", id);
    }
    const prior = this.read(id);
    if (
      Number.isInteger(options.expectedRevision) &&
      Number(options.expectedRevision) !== Number(prior?.revision || 0)
    ) {
      fail("epistemic_fabric_component_state_stale_revision", id);
    }
    const storedState = clone(state);
    const stateDigest = digestFor(
      "direct-epistemic-fabric-component-state@1",
      storedState,
    );
    if (prior?.stateDigest === stateDigest) {
      return { ...prior, writeState: "idempotent_replay" };
    }
    const revision = Number(prior?.revision || 0) + 1;
    const updatedAt = new Date(Number(this.now())).toISOString();
    const stateJson = JSON.stringify(storedState);
    this.db.exec("begin immediate");
    try {
      this.db
        .prepare(`
          insert into wm_epistemic_component_state_history (
            component_id, revision, state_digest, state_json, updated_at
          ) values (?, ?, ?, ?, ?)
        `)
        .run(id, revision, stateDigest, stateJson, updatedAt);
      this.db
        .prepare(`
          insert into wm_epistemic_component_states (
            component_id, revision, state_digest, state_json, updated_at
          ) values (?, ?, ?, ?, ?)
          on conflict(component_id) do update set
            revision = excluded.revision,
            state_digest = excluded.state_digest,
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `)
        .run(id, revision, stateDigest, stateJson, updatedAt);
      this.db.exec("commit");
    } catch (error) {
      try {
        this.db.exec("rollback");
      } catch {
        // Preserve the original persistence failure.
      }
      throw error;
    }
    return {
      schema: EPISTEMIC_FABRIC_STATE_STORE_SCHEMA,
      componentId: id,
      revision,
      stateDigest,
      state: storedState,
      updatedAt,
      writeState: "written",
      canonicalWorldstateEffect: false,
      grantsAuthority: false,
    };
  }

  descriptor() {
    const rows = this.db
      .prepare(`
        select component_id, revision, state_digest, updated_at
        from wm_epistemic_component_states
        order by component_id asc
      `)
      .all();
    return {
      schema: EPISTEMIC_FABRIC_STATE_STORE_SCHEMA,
      persistence: "same_control_plane_sqlite",
      components: rows.map((row) => ({
        componentId: row.component_id,
        revision: Number(row.revision),
        stateDigest: row.state_digest,
        updatedAt: row.updated_at,
      })),
      canonicalWorldstateWriter: false,
      grantsAuthority: false,
    };
  }
}

module.exports = {
  DirectEpistemicFabricStateStore,
  EPISTEMIC_FABRIC_STATE_STORE_SCHEMA,
};
