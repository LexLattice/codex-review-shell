"use strict";

const fs = require("node:fs");
const str = (v, max = 512) => typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v;
const exact = (v, fields) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("\0") === [...fields].sort().join("\0");
function response(attemptRef, pageRef, status, reasonCode, evidenceRefs) { return { schema: "direct_commissioning_chain_response@1", attemptRef, pageRef, status, reasonCode, evidenceRefs: [...new Set(evidenceRefs)], authorityEffect: "none" }; }
function evaluate(input) {
  if (!exact(input, ["attemptRef", "page"]) || !str(input.attemptRef) || !input.page || input.page.schema !== "direct_commissioning_chain_page@1") throw new Error("INPUT_MALFORMED");
  const p = input.page; if (!str(p.pageRef) || !p.evidence || !Array.isArray(p.evidence.nodes)) throw new Error("INPUT_MALFORMED");
  const e = p.evidence; const refs = e.nodes.map((n) => n.bindingRef); if (!e.complete || !e.lineageAvailable) return response(input.attemptRef, p.pageRef, "REMANDS", "INCOMPLETE_OR_MISSING_LINEAGE", refs);
  if (e.currentRevision !== e.snapshotRevision) return response(input.attemptRef, p.pageRef, "REMANDS", "STALE_SNAPSHOT", refs);
  if (e.alternatives.length) return response(input.attemptRef, p.pageRef, "INCONCLUSIVE", "ALTERNATIVE_CHAIN_PRESENT", refs);
  const nodes = e.nodes; const unique = new Set(refs).size === refs.length; const afterRefs = nodes.map((n) => n.afterRef); const beforeRefs = nodes.map((n) => n.beforeRef); const owners = new Set(nodes.map((n) => n.entityRef)); let broken = !nodes.length || !unique || new Set(afterRefs).size !== afterRefs.length || new Set(beforeRefs).size !== beforeRefs.length || owners.size !== 1 || nodes[0].predecessorRef !== null || nodes[0].beforeRef !== e.genesisRef; const visitedOccurrences = new Set([e.genesisRef]);
  for (let i = 0; i < nodes.length; i += 1) { const n = nodes[i]; if (n.entityRef !== e.entityRef || n.ordinal !== i || visitedOccurrences.has(n.afterRef) || n.beforeRef === n.afterRef) broken = true; visitedOccurrences.add(n.afterRef); if (i > 0 && (n.predecessorRef !== nodes[i - 1].bindingRef || n.beforeRef !== nodes[i - 1].afterRef)) broken = true; }
  return response(input.attemptRef, p.pageRef, broken ? "REFUTES" : "SUPPORTS", broken ? "CHAIN_TOPOLOGY_INVALID" : "FINITE_CHAIN_CONTIGUOUS", refs);
}
try {
  const environmentNames = Object.keys(process.env).sort(); const namespace = (name) => { try { return fs.readlinkSync(`/proc/self/ns/${name}`); } catch (_) { return "unavailable"; } };
  const probe = { environmentNames, homeAbsent: !fs.existsSync("/home"), runAbsent: !fs.existsSync("/run"), rootAbsent: !fs.existsSync("/root"), netNamespace: namespace("net"), pidNamespace: namespace("pid"), mountNamespace: namespace("mnt"), workWritable: (() => { try { fs.writeFileSync("/work/.probe-write", "x"); return true; } catch (_) { return false; } })() };
  process.stderr.write(`COMMISSIONING_PROBE:${JSON.stringify(probe)}\n`);
  const input = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(JSON.stringify(evaluate(input)));
} catch (error) { process.stderr.write(String(error.message || "WORKER_FAILED")); process.exitCode = 2; }
