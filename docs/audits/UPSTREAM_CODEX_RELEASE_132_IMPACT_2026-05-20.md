# Upstream Codex Release 132 Impact Audit

Date: 2026-05-20

Evidence:
- Codex fork: `/home/rose/work/codex/fork`
- Local release branch: `upstream-latest-release`
- Official upstream tag: `rust-v0.132.0`
- Commit: `13595c36e218fcbd13df118eeadf00d4eb0e6d31`
- Prior local release baseline before update: `rust-v0.130.0`

## Branch Update

The local Codex fork release branch was reset to official `rust-v0.132.0`.

The fork remote rejected a push to `origin/upstream-latest-release` through a
repository hook:

```text
Refusing push of read-only inspection branch 'upstream-latest-release'.
```

So the local inspection branch is current, while the remote branch remains
protected.

## Significant Upstream Changes

Release 132 changes several surfaces that matter to our app-server and Direct
ontologies:

- App-server image inputs now preserve requested fidelity through optional
  `detail` on `image` and `localImage` user input items.
- The generated `ImageDetail` enum is now `high | original`; older `auto | low`
  values are no longer in the app-server schema.
- App-server permission-profile exports moved away from full generated
  `PermissionProfile` objects. Runtime permission provenance is now
  `activePermissionProfile`, while legacy sandbox and approval fields remain.
- App-server thread list paging now includes `backwardsCursor`.
- App-server protocol adds request/schema surfaces for attestation and plugin
  install/share checkout flows.
- Remote compaction v2 now sends `compaction_trigger` and expects encrypted
  `compaction` output, while app-server still renders compaction activity as a
  `contextCompaction` thread item.
- Remote compaction v2 now runs pre-compact and post-compact hooks, so
  compaction may be stopped by hook policy.
- Tool plumbing changed substantially: legacy function-style `shell` and
  JSON-style `apply_patch` paths were removed from the main tool-spec surface;
  `shell_command`, `unified_exec`, and freeform `apply_patch` are the current
  direction.
- Multi-agent v2 remains active upstream and has configurable model-visible
  namespace/tool behavior.
- Python SDK app-server package paths changed substantially; this does not
  affect the Electron shell unless we start consuming that SDK as a dependency.

## Impact On Our App-Server Path

No immediate breaking code change is required in the shell bridge:

- Unknown server requests still fail visible and closed.
- The shell does not depend on the removed generated `PermissionProfile` type.
- The shell already treats app-server as the default baseline and keeps request
  approvals in the main-process bridge.

Follow-up candidates:

- Capture and render image `detail` when projecting app-server user inputs that
  include images.
- Extend app-server capability/status projection to mention
  `activePermissionProfile` provenance instead of implying full permission
  profile export.
- Add `backwardsCursor` to any future deep thread-list pagination adapter.
- Decide whether attestation server requests should be explicitly supported,
  explicitly auto-denied, or left as unknown/unsupported.

## Impact On Our Direct Path

The release does not invalidate the Direct harness law. It mostly reinforces
existing boundaries:

- Direct compaction should remain gated. Release 132 gives a more precise live
  primitive shape (`compaction_trigger` -> encrypted `compaction`), but it does
  not promote our Direct `A12` provider-compaction row without exact live proof.
- Direct tool authority remains harness-owned. Upstream removal of legacy
  `shell`/JSON-patch paths supports our choice to keep Direct command and patch
  tools as explicit implementation-lane authorities with scoped evidence.
- Sub-agent observability remains display-only in our current scope. Upstream
  multi-agent v2 model-visible tools are evidence that choreography exists
  upstream, not permission for Direct spawn/wait/inspect authority.
- Direct model/profile evidence should keep tracking exact request-shape scope,
  especially image fidelity, tool exposure, compaction, and quota/model controls.

## Ontology Updates Made

- Updated `CODEX_APP_SERVER_ONTOLOGY.md` to release-132 evidence, image detail
  values, compaction display/runtime split, and active permission profile law.
- Updated `OAI_CODEX_UPSTREAM_ODEU_PROFILE.md` to release-132 evidence, image
  detail values, remote compaction v2 shape, and compact-hook interruption law.

## Bottom Line

Release 132 changes some schema details and adds useful evidence, but it does
not require changing the major architecture we have built so far:

```text
app-server remains the vanilla/default path
Direct remains explicit and evidence-gated
provider compaction remains live-gated/unproved
sub-agent choreography remains out of Direct scope
tool execution remains harness authority, not provider or app-server authority
```
