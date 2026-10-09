import assert from "node:assert/strict";
import { runClosedPage, pageBytes, sha256 } from "../src/main/direct/semantic-service/commissioning-process.js";

// The closed page runs in Linux namespaces (no network, no credentials,
// read-only work); elsewhere it fails closed as UNAVAILABLE by design.
if (process.platform !== "linux") {
  const unavailable = await runClosedPage({ attemptRef: "attempt:s14-non-linux", page: { schema: "direct_commissioning_chain_page@1" } });
  assert.notEqual(unavailable.status, "CAPTURED", "no unisolated capture off Linux");
  console.log("SKIPPED: the commissioning page's isolation is Linux-only (it fails closed here, as checked).");
  process.exit(77);
}

const base = (overrides = {}) => ({ schema: "direct_commissioning_chain_page@1", pageRef: "page:s14-1", compilationDigest: "sha256:" + "1".repeat(64), obligationIds: ["obl:s14-1"], law: { family: "s14-m2-chain-contiguity", revision: "commissioning@1", predicate: "finite complete unique chain" }, evidence: { entityRef: "entity:s14-1", genesisRef: "genesis:s14-1", currentRevision: "rev:s14-2", snapshotRevision: "rev:s14-2", complete: true, lineageAvailable: true, nodes: [{ bindingRef: "bind:1", entityRef: "entity:s14-1", predecessorRef: null, beforeRef: "genesis:s14-1", afterRef: "occ:1", ordinal: 0 }, { bindingRef: "bind:2", entityRef: "entity:s14-1", predecessorRef: "bind:1", beforeRef: "occ:1", afterRef: "occ:2", ordinal: 1 }], alternatives: [] }, ...overrides });

const supported = await runClosedPage({ attemptRef: "attempt:s14-supported", page: base() });
assert.equal(supported.status, "CAPTURED"); assert.equal(supported.isolation.network, "OBSERVED_UNSHARED"); assert.equal(supported.isolation.credentials, "OBSERVED_ABSENT"); assert.equal(supported.isolation.work, "OBSERVED_READ_ONLY");
const decoded = JSON.parse(Buffer.from(supported.stdoutBase64, "base64").toString("utf8")); assert.equal(decoded.status, "SUPPORTS"); assert.deepEqual(decoded.evidenceRefs, ["bind:1", "bind:2"]); assert.equal(decoded.authorityEffect, "none");
assert.equal(supported.pageDigest, sha256(pageBytes(base()))); assert.match(supported.workerDigest, /^sha256:/);
const broken = await runClosedPage({ attemptRef: "attempt:s14-broken", page: base({ evidence: { ...base().evidence, nodes: [{ ...base().evidence.nodes[1], predecessorRef: "bind:wrong" }, base().evidence.nodes[0]] } }) });
assert.equal(broken.status, "CAPTURED"); assert.equal(JSON.parse(Buffer.from(broken.stdoutBase64, "base64")).status, "REFUTES");
const repeatedAfter = await runClosedPage({ attemptRef: "attempt:s14-repeated-after", page: base({ evidence: { ...base().evidence, nodes: [{ ...base().evidence.nodes[0], afterRef: "rev:same" }, { ...base().evidence.nodes[1], beforeRef: "rev:same", afterRef: "rev:same" }] } }) });
assert.equal(JSON.parse(Buffer.from(repeatedAfter.stdoutBase64, "base64")).status, "REFUTES");
const cycle = await runClosedPage({ attemptRef: "attempt:s14-cycle", page: base({ evidence: { ...base().evidence, nodes: [{ ...base().evidence.nodes[0], afterRef: "occ:1" }, { ...base().evidence.nodes[1], beforeRef: "occ:1", afterRef: "genesis:s14-1" }] } }) });
assert.equal(JSON.parse(Buffer.from(cycle.stdoutBase64, "base64")).status, "REFUTES");
const typedSameSpelling = await runClosedPage({ attemptRef: "attempt:s14-typed-spelling", page: base({ evidence: { ...base().evidence, nodes: [{ ...base().evidence.nodes[0], bindingRef: "occ:1", afterRef: "shared" }, { ...base().evidence.nodes[1], predecessorRef: "occ:1", beforeRef: "shared", afterRef: "occ:2" }] } }) });
assert.equal(JSON.parse(Buffer.from(typedSameSpelling.stdoutBase64, "base64")).status, "SUPPORTS");
for (const [name, page] of [["missing", base({ evidence: { ...base().evidence, lineageAvailable: false } })], ["stale", base({ evidence: { ...base().evidence, currentRevision: "rev:old" } })], ["ambiguous", base({ evidence: { ...base().evidence, alternatives: ["alt:1"] } })]]) {
  const observed = await runClosedPage({ attemptRef: `attempt:s14-${name}`, page }); const answer = JSON.parse(Buffer.from(observed.stdoutBase64, "base64")); assert.equal(observed.status, "CAPTURED"); assert.equal(answer.status, name === "ambiguous" ? "INCONCLUSIVE" : "REMANDS");
}
const malformed = await runClosedPage({ attemptRef: "attempt:s14-malformed", page: { schema: "wrong" } }); assert.equal(malformed.status, "FAILED"); assert.equal(malformed.reasonCode, "INPUT_MALFORMED");
const over = await runClosedPage({ attemptRef: "attempt:s14-over", page: base(), maximumOutputBytes: 1 }); assert.ok(["FAILED", "UNAVAILABLE"].includes(over.status));
const alreadyAborted = new AbortController(); alreadyAborted.abort(); const aborted = await runClosedPage({ attemptRef: "attempt:s14-aborted", page: base(), signal: alreadyAborted.signal }); assert.equal(aborted.status, "UNAVAILABLE"); assert.equal(aborted.reasonCode, "ABORTED");
const noRevisionJoin = await runClosedPage({ attemptRef: "attempt:s14-occurrence-refs", page: base({ evidence: { ...base().evidence, currentRevision: "semantic-revision-new", snapshotRevision: "semantic-revision-new" } }) }); assert.equal(JSON.parse(Buffer.from(noRevisionJoin.stdoutBase64, "base64")).status, "SUPPORTS");
console.log(JSON.stringify({ suite: "direct-semantic-service-commissioning-process", status: "PASS", cases: 12, advisoryOnly: true, authorityEffect: "none" }));
