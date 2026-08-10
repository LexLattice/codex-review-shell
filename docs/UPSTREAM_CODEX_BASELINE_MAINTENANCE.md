# Upstream Codex Baseline Maintenance

Purpose: keep three different bodies of implementation truth comparable without
collapsing them into one moving branch.

```text
current official vanilla release
  -> exact-tag inspection baseline

our Codex fork main
  -> fork-only module lineage and integration experiment

Direct review shell
  -> current direct-native ODEU implementation
```

## Repositories And Branch Roles

| World | Location | Canonical ref | Role |
| --- | --- | --- | --- |
| Vanilla release evidence | `/home/rose/work/codex/fork` | `origin/upstream-latest-release` | Exact remote pointer to the latest official stable `openai/codex` tag. It is a fetched inspection baseline, not a local development branch. |
| Fork implementation | `/home/rose/work/codex/fork` | `origin/main` | Current shared fork lineage containing our custom Codex modules. Audit this ref even when local `main` is behind. |
| Direct implementation | `/home/rose/work/LexLattice/codex-review-shell` | `origin/main` plus the active reviewed branch | Current direct-native harness and its executable information registry. |

The scheduled fork workflow advances `origin/upstream-latest-release` to the
exact official stable tag. It is not merged with fork `main`, and updating it
does not claim that fork `main` or Direct acquired any upstream capability.
Local inspection uses the fetched remote-tracking ref directly; no local branch
is required.

## Operational Runtime Overlay

A pinned pre-release binary may be used for a bounded runtime experiment
without redefining the stable inspection baseline:

```text
origin/upstream-latest-release
  -> latest official stable source/tag truth

pinned alpha CLI
  -> explicitly scoped operational capability overlay
  -> not merged into the stable baseline branch
```

There is currently no pre-release overlay: the Review Shell managed WSL route
uses npm-global `@openai/codex@0.147.0`, matching the stable source family. The
former `0.145.0-alpha.11` overlay remains recorded in the release-145 audit as
historical split-schema evidence. The managed binary still does not redefine
fork `origin/main`, Windows PATH Codex, or the vanilla desktop's bundled WSL
binary.

Every overlay must record its exact version, scope, required feature flags,
runtime/provider witness, rollback command, and which stable source claims
remain unchanged. Moving npm tags such as `alpha` are discovery inputs, not
reproducible runtime identities.

## Update Procedure

For every stable upstream refresh:

1. Fetch official upstream tags and the fork remote.
2. Verify the latest stable release from the official GitHub release record;
   do not select an alpha/pre-release as the stable baseline.
3. Verify that the scheduled workflow advanced
   `origin/upstream-latest-release` to that exact tag; fetch `origin` locally.
4. Compare the prior official tag with the new tag at the provider/API, Codex
   core, app-server protocol, persistence, tool, environment, and multi-agent
   boundaries.
5. Update:
   - `OAI_CODEX_UPSTREAM_ODEU_PROFILE.md` for provider/backend primitives and
     Codex-core implementation choices;
   - `CODEX_APP_SERVER_ONTOLOGY.md` for app-server methods, items,
     notifications, persistence, and compatibility rules;
   - a dated `docs/audits/UPSTREAM_CODEX_RELEASE_*_IMPACT_*.md` evidence record.
6. Separately compare fork `origin/main` with the new vanilla tag. Group the
   differences by conceptual module rather than by changed file or commit.
7. For every fork-only concept, inspect the Direct source and executable
   registry and record both current coverage and the conceptual disposition.

## Required Comparison Matrix

Every fork audit must distinguish:

| Dimension | Values |
| --- | --- |
| Vanilla coverage | `none`, `adjacent`, `partial`, `substantive`, `supersedes` |
| Direct coverage | `none`, `modeled`, `partial`, `implemented`, `live-proven` |
| Conceptual disposition | `retire fork delta`, `retain fork delta`, `adopt vanilla adapter`, `finish Direct implementation`, `reframe`, `defer` |

The judgment is semantic, not nominal. Two modules with similar names are not
equivalent unless they preserve the same objects, evidence states, transition
laws, authority boundary, and utility role.

## Maintenance Laws

```text
upstream source existence != provider capability
upstream implementation != fork integration
fork implementation != Direct implementation
modeled Direct row != promoted/live Direct capability
similar UI behavior != equivalent transition law
new vanilla coverage may retire code without retiring the concept
```

In particular:

- Backend/provider primitives require served descriptors or safe runtime
  evidence before Direct enables them.
- Codex core `WorldState`, tool routing, compaction, and collaboration are
  vanilla implementation evidence, not OAI backend law.
- App-server methods remain compatibility-surface evidence. Direct may expose
  the same semantic capability through a different contract.
- A fork module should be retired only when vanilla covers its actual invariant,
  not merely because vanilla gained a nearby feature.
- A concept can remain valuable while its old fork implementation becomes too
  expensive to rebase; Direct may be the correct future home.

## Current Bounded Baseline

As of 2026-08-09:

- official stable tag: `rust-v0.147.0`;
- official release-tracking commit: `be6e8eac029b183056b7e4402879f15d2c85f61b`;
- prior agent-runtime comparison tag: `rust-v0.146.0`;
- fork audit ref: `origin/main` at `923840b357e15195e66f7e82ac81ee0f39fc7050`;
- Direct canonical branch: `origin/main`;
- managed runtime: WSL npm-global `@openai/codex@0.147.0`;
- bounded 0.147 audit coverage: multi-agent and exec-server runtime changes,
  not a claim of full release-surface adoption.

The dated impact audit is the evidence-bearing snapshot. This document defines
the standing procedure and should change only when the maintenance architecture
changes.

Current evidence snapshot:

- [`Upstream Codex Release 147 Agent-Runtime Impact Audit`](./audits/UPSTREAM_CODEX_RELEASE_147_DIRECT_AGENT_IMPACT_2026-08-09.md)
- [`Upstream Codex Release 145 Impact Audit`](./audits/UPSTREAM_CODEX_RELEASE_145_IMPACT_2026-07-22.md)
- [`Upstream Codex Release 144 Impact Audit`](./audits/UPSTREAM_CODEX_RELEASE_144_IMPACT_2026-07-14.md)
