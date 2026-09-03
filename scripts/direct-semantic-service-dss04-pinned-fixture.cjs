"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\n${canonical(value)}`).digest("hex")}`;
}

if (process.env.DSS04_REQUEST !== undefined) process.exitCode = 91;
const envelope = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const request = envelope.request;
const pin = envelope.compilerPin;
const compilerIdentity = digest("DirectSemanticService.Dss04.CompilerIdentity.v1", Object.fromEntries([
  "repository_commit", "source_tree_digest", "entrypoint_digest", "interpreter_digest", "dependency_lock_digest",
  "installed_environment_digest", "invocation_contract_digest", "pattern_library_digest", "learning_extension_digest",
  "focus_library_digest"
].map((field) => [field, pin[field]])));
const empty = (name) => digest(`DirectSemanticService.Dss04.${name}.v1`, []);
const oversized = request.request_id === "compile-overbudget";
const factId = oversized ? "fact-" + "x".repeat(70000) : "fact-1";
const unavailable = request.request_id === "compile-unavailable";
const route = { route_id: "route-1", occurrence_id: "occurrence-1", owner: "dss04-route-owner", authority_owner: "dss04-route-owner", authority_root: "dss04-route-custody-root", authority_standing: "PINNED", project_id: request.project_id || "project-1", request_scope_digest: request.requested_route_scope_digest, snapshot_receipt_digest: request.target_snapshot_receipt_digest, input_fact_refs: [factId] };
const routes = [route];
const contacts = [{ route_id: route.route_id, occurrence_id: route.occurrence_id }];
const inputFacts = [{ fact_id: factId, source_ref: request.target_snapshot_receipt_digest }];
const evidenceDemands = unavailable ? [{ evidence_demand_id: "demand-1", route_id: route.route_id }] : [];
const population = (name, value) => digest(`DirectSemanticService.Dss04.${name}.v1`, value);
const output = {
  service_generation: envelope.generation,
  semantic_input_digest: request.semanticInputDigest,
  dss03_result_seal_digest: request.dss03_result_seal_digest,
  project_registry_revision_digest: request.project_registry_revision_digest,
  target_snapshot_receipt_digest: request.target_snapshot_receipt_digest,
  project_evidence_runtime_revision_digest: request.project_evidence_runtime_revision_digest,
  compiler_build_pin_digest: request.compiler_build_pin_digest,
  compiler_invocation_contract_digest: request.compiler_invocation_contract_digest,
  materialization_policy_digest: request.materialization_policy_digest,
  compiler_identity_digest: compilerIdentity,
  compiler_identity: Object.fromEntries([
    "repository_commit", "source_tree_digest", "entrypoint_digest", "interpreter_digest", "dependency_lock_digest",
    "installed_environment_digest", "invocation_contract_digest", "pattern_library_digest", "learning_extension_digest",
    "focus_library_digest"
  ].map((field) => [field, pin[field]])),
  obligations: [],
  routes,
  evidence_demands: evidenceDemands,
  exclusions: [],
  static_remands: [],
  obligation_count: 0,
  route_count: routes.length,
  evidence_demand_count: evidenceDemands.length,
  exclusion_count: 0,
  static_remand_count: 0,
  obligation_population_digest: empty("ObligationPopulation"),
  route_population_digest: population("RoutePopulation", routes),
  evidence_demand_population_digest: population("EvidenceDemandPopulation", evidenceDemands),
  exclusion_population_digest: empty("ExclusionPopulation"),
  static_remand_population_digest: empty("StaticRemandPopulation"),
  contacts,
  contact_occurrence_reconciliation_digest: population("ContactOccurrenceReconciliation", contacts),
  input_facts: inputFacts,
  input_facts_digest: population("InputFactPopulation", inputFacts),
  exclusion_theorem_digest: empty("ExclusionTheorem")
};
process.stdout.write(canonical(output));
