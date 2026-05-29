import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  blockedMessage,
  historyEntryId,
  isLoopbackHost,
  navigationDecision,
} = require("../src/main/external-navigation-policy.js");

assert.equal(isLoopbackHost("localhost"), true);
assert.equal(isLoopbackHost("127.0.0.1"), true);
assert.equal(isLoopbackHost("example.com"), false);

const github = navigationDecision("https://github.com/LexLattice/codex-review-shell/pull/108?token=secret#discussion");
assert.equal(github.action, "allow");
assert.equal(github.normalizedUrl, "https://github.com/LexLattice/codex-review-shell/pull/108?token=secret#discussion");
assert.equal(github.displayUrl, "https://github.com/LexLattice/codex-review-shell/pull/108?...#...");
assert.equal(github.historyId, historyEntryId("https://github.com/LexLattice/codex-review-shell/pull/108"));

assert.deepEqual(navigationDecision("https://user:pass@example.com/"), {
  action: "block",
  reason: "embedded_credentials",
});
assert.deepEqual(navigationDecision("http://example.com/"), {
  action: "block",
  reason: "insecure_http",
});
assert.deepEqual(navigationDecision("file:///tmp/secret.txt"), {
  action: "block",
  reason: "unsupported_protocol",
});
assert.equal(navigationDecision("http://127.0.0.1:1234/readyz").action, "allow");
assert.equal(blockedMessage("embedded_credentials"), "Blocked: URL contains embedded credentials");

console.log("Navigation policy smoke passed.");
