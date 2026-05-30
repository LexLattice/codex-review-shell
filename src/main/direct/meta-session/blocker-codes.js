"use strict";

const DIRECT_META_SESSION_BLOCKER_CODES = Object.freeze([
  "session_missing",
  "session_pointer_stale",
  "contract_missing",
  "contract_digest_mismatch",
  "contract_epoch_stale",
  "context_missing",
  "context_digest_mismatch",
  "context_jurisdiction_ambiguous",
  "route_stale",
  "transition_not_allowed",
  "required_evidence_missing",
  "worker_authority_missing",
  "amendment_required",
  "human_approval_required",
  "raw_exposure_blocked",
  "schema_invalid",
  "ledger_corrupt",
  "enforce_mode_unavailable",
  "sub_agent_choreography_unavailable",
  "upstream_discriminator_missing",
  "ipc_contract_missing",
  "status_projection_only",
]);

function isMetaSessionBlockerCode(value) {
  return DIRECT_META_SESSION_BLOCKER_CODES.includes(value);
}

module.exports = {
  DIRECT_META_SESSION_BLOCKER_CODES,
  isMetaSessionBlockerCode,
};
