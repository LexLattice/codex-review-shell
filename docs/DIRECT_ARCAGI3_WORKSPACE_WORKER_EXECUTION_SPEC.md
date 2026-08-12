# Direct ArcAGI3 workspace-worker execution (EXEC2)

Status: implemented provider-visible isolated-worktree execution slice

## Outcome

Direct Workbench can launch several provider-backed workers against one Git
repository without sharing a mutable checkout. A workspace-backed child is an
opt-in alternative to the existing reasoning-only child route.

Each workspace child receives:

- one immutable project/work-thread binding;
- one harness-created Git worktree and local `codex/worker/*` branch;
- one role-, parent-, repository-, and substrate-compiled tool constitution;
- one explicit context-admission record;
- one bounded provider/tool loop; and
- one typed terminal capture that can be observed by the parent through the
  existing agent status surface.

The first field pilot targets the WSL ArcAGI3 repository. The worktree
provisioning operation lives in the resident workspace backend so the same
contract can later be realized by native Windows and local backends without
changing the agent semantics.

## Constitutional boundary

The existing child path remains the default:

```text
spawn_agent(workspace_mode omitted)
  -> reasoning-only provider child
  -> no child tools
  -> no workspace mutation
```

Workspace execution must be requested explicitly:

```text
spawn_agent(
  workspace_mode = isolated_worktree,
  tool_profile = implementation_worker | read_only_worker
)
```

`workspace_mode` and `tool_profile` are requests for a constitution. They are
not direct authority. The harness validates the request and compiles the actual
capability set as the intersection of the requested role, inherited parent
authority, pinned repository policy, and resident-substrate capability.
`tool_profile` is retained as advisory provenance; it cannot widen any of the
other three boundaries.

The compiler accepts only an explicit, harness-owned parent-authority packet.
The packet is immutably branded inside the harness process and requires an
explicit boundary id, upstream policy id, and canonical upstream tool set. It
binds that policy by digest and cannot be reconstructed from provider JSON or
widened by `tool_profile`; omission of the upstream set never defaults to all
tools.

The live launcher obtains that packet through a separate process-owned
delegation-policy registry, not from provider arguments and not from the set of
tools declared on the current parent turn. Each admitted registry source is
keyed by an exact project/work-thread pair and carries explicit source and
policy revisions, validity times, allowed worker profiles, canonical tools, and
negative authority flags. Its source digest and the resulting short-lived
policy digest are bound into the launch, worker contract, execution projection,
and parent status evidence. Missing, stale, wrong-scope, reconstructed, or
profile-widening policies block before pool launch. Direct compilation without
a packet still grants zero tools and records a typed parent-boundary omission.

Main starts with an empty registry. A deployment that wants provider-visible
workspace delegation must seed the process-owned registry through
`CODEX_DIRECT_WORKSPACE_WORKER_DELEGATION_SOURCES`, a JSON array of explicit
`direct_workspace_worker_delegation_source@1` inputs. Selecting the Direct
implementation lane alone grants nothing. Invalid source configuration is
rejected and leaves the registry empty. The headless acceptance fixture seeds
the same registry type directly as a harness-owned source; no provider payload
can mint or serialize its in-process capability brand.

The first-slice constitutions are:

| Requested profile | Inspect/list/match/search/read | Patch | Test | Recursive spawn | Remote mutation |
| --- | --- | --- | --- | --- | --- |
| `read_only_worker` | candidate, then intersected | no | no | no | no |
| `implementation_worker` | candidate, then intersected | candidate, then intersected | only when a compiled test profile survives intersection | no | no |

No workspace worker receives arbitrary shell, network, Git push, inter-agent
messaging, follow-up, interrupt, or child-spawn capabilities.

## Canonical objects

### Workspace worker contract

`direct_workspace_worker_contract@1` binds:

```text
identity
  project id
  work-thread id
  parent thread id
  child agent id

realization
  isolated-worktree mode
  substrate kind
  worktree binding id/digest
  local branch label
  pinned base commit

epistemic input
  context-admission decision
  exact admitted message count
  admitted-context digest

authority
  requested advisory tool profile
  harness delegation-source id/digest
  short-lived delegation-policy id/digest
  parent-authority boundary digest
  pinned repository-policy profile/digest
  substrate-capability profile/digest
  explicit omitted-tool ledger
  exact declared tool names
  detected test-profile digest, when present
  explicit denials
```

The public object never contains the worktree path, raw prompt, raw context, or
provider payload. The resident backend and Main process retain the native path
only as private realization data.

### Workspace binding

`direct_workspace_worker_binding@1` proves that one child is bound to one
worktree. Its public projection contains a binding id, evidence digest,
substrate kind, branch label, base commit, and retention state. It contains a
digest of the native root, never the native root itself.

The binding is frozen for the child lifetime. A worker cannot select another
child's binding or provide a filesystem root in a tool call.

### Repository policy and selective inheritance

Repository instruction files are evidence, not automatically active worker
prompts. A pinned repository profile identifies exact marker and policy-source
digests. Marker realization equality uses the same platform-aware native-path
identity law as repository reads, while still rejecting symlinks. When the
markers and digests validate, the worker contract contains only selected,
role-relevant constraints, source references, and an omission ledger. Raw
`AGENTS.md` text is not injected. A profile mismatch falls back to an explicitly
unprofiled Git-repository posture; it never silently claims the pinned policy.

The ArcAGI3 profile admits the local-only/edit-scope laws and the pinned Make
test actions. Solver-domain architecture guidance remains omitted unless a
separate semantic port compiles it for the delegated task.

### Tool result

Every tool transition produces `direct_workspace_worker_tool_result@1` with:

```text
step ordinal
tool name
call id
obligation id
status
evidence digest
side-effect flag
bounded provider projection
public summary
```

Tool results are captured in the child Direct turn. Provider-facing file and
test evidence can be richer than the parent-facing status projection, but it
remains bounded and is never promoted automatically into the parent transcript.

## Worktree realization

The parent repository's resident backend owns these operations:

```text
provisionGitWorktree(worker key, branch label, base ref)
removeGitWorktree(worker key, branch label)  # explicit cleanup/testing only
```

Provisioning must:

1. verify that the configured workspace root is the Git top level;
2. fail closed when the parent checkout is dirty, because EXEC1 has no admitted
   dirty-state snapshot contract and must not silently omit uncommitted work;
3. resolve the requested base ref to one exact commit;
4. derive the worktree location under a sibling `.codex-worktrees` root;
5. require a harness-safe worker key and a `codex/worker/*` local branch;
6. reject collisions instead of adopting an existing directory or branch;
7. create the branch and worktree with shell execution disabled; and
8. return a public binding plus private native-path realization data.

Normal completion retains the worktree and branch for human or higher-layer
inspection. Cleanup is a separate constitutional operation.

## Canonical repository perception

Workspace workers receive five bounded read-only tools:

- `inspect_repository`: Git-manifest and compiled-policy summary;
- `list_files`: prefix listing over the canonical manifest;
- `match_files`: bounded glob matching over that same manifest;
- `search_text`: literal-only bounded UTF-8 content search; and
- `read_file`: bounded UTF-8 read of one admitted manifest entry.

The resident backend derives the manifest with `git ls-files --cached --others
--exclude-standard`. Ignored paths are therefore absent, while tracked and
non-ignored untracked paths are represented. Before admission, every entry is
resolved beneath the exact Git top level. Private `.git` paths, sensitive-path
classes, symlinks or symlink-mediated paths, non-files, and unstable
realizations are excluded. Reads reject binary content. Search is literal, not
regular-expression or shell search, and is bounded by file count, per-file
bytes, aggregate bytes, result count, and provider-result size. Every attempted
read consumes the aggregate budget before content classification, including
binary and invalid UTF-8 files. Read/revalidation failures and invalid UTF-8
omissions set both `incomplete` and `truncated` and expose only fixed aggregate
counts; failed native paths and exception text are never projected.

Every repository-tool request carries the frozen public workspace-binding
digest, and every result must echo it exactly. Provider-facing projections are
rebuilt from allowlisted fields and never forward resident `root` or absolute
path fields.

## Test authority

The provider sees `run_test`, not `run_command`.

The resident backend deterministically detects a bounded local test profile
from repository markers and pinned policy evidence. Profiles include:

- ArcAGI3 pinned Make actions: `test_focus`, `check`, and `test`, mapped by the
  harness to the exact Make targets after the pinned `AGENTS.md` and `Makefile`
  digests validate;
- generic Python/pytest for unprofiled repositories;
- generic Node package test when `package.json` declares a test script; and
- generic Make test when a literal `test` target exists.

At execution time the backend re-detects the profile and requires the compiled
profile digest to match. The model cannot supply an executable or replace the
base arguments. For ArcAGI3, only `test_focus` accepts targets and transports
them through the fixed `TESTS=` Make variable. Test targets must be contained
relative paths; flags, absolute paths, traversal, URLs, and shell syntax are
rejected.

This slice does not claim process-level sandboxing for repository test code.
Tests run with the resident backend's existing OS identity, and the backend
currently reports network isolation as unsupported. The compiled surface
prevents the model from selecting an arbitrary executable, command, native
path, or remote-Git operation; container/process isolation is a separate future
realization layer.

## Provider loop

The workspace runtime permits one tool call per step and a bounded number of
steps. Each step is:

```text
provider requests declared tool
  -> harness validates call against frozen contract
  -> resident backend performs the typed operation
  -> harness records typed result
  -> bounded result evidence is admitted to a fresh continuation
```

The loop fails closed on multiple calls, undeclared tools, malformed arguments,
contract/binding drift, test-profile drift, step exhaustion, or raw-path
exposure. It never delegates tool execution back to the provider.

## Communication topology

Active communication remains top-down. Workspace workers see only their task,
admitted context, compiled tools, and resulting environment constraints. They
cannot message the parent, request another worker, or alter their constitution.

The parent observes terminal summaries and typed status through `wait_agent`,
`list_agents`, and `inspect_agent`. It does not need to ingest a flattened child
transcript.

## Acceptance witness

Run `npm run direct:provider-workspace-workers`. This non-recursive aggregate
executes the provider-policy negatives, the real headless parent-provider loop,
and `direct:arcagi3-workspace-workers` (the generic policy/repository regression
plus ArcAGI3 end-to-end runtime witness after their shared syntax gate).

The headless witness creates a disposable committed Node repository, seeds one
exact project/work-thread delegation source, accepts a root-provider
`spawn_agent` call, provisions the resident isolated-worktree runner, executes
bounded read/patch/test tools, persists typed child capture, returns it through
`wait_agent`, and completes the parent provider continuation. It also verifies
that the durable lifecycle session owns provisioning, the canonical source-
repository digest, binding, lease release, terminal settlement, and ordered
pool drain. The dirty child worktree remains retained for inspection. Parent,
provider, and status projections contain neither native roots nor private
binding fields, and the source checkout stays unchanged.

The EXEC1 regression creates a temporary local clone derived from the committed
ArcAGI3 repository, then launches two workspace workers from the same pinned
commit. It must prove:

1. distinct branch and worktree bindings;
2. parallel child execution beyond a shared-checkout model;
3. each patch appears only in its worker's worktree;
4. one worker cannot address the other's native root through any tool argument;
5. the seed checkout remains unchanged;
6. only intersected repository-perception/patch/test tools are provider-visible;
7. recursive spawn, general shell, and remote Git are absent;
8. terminal capture contains typed tool results and binding evidence; and
9. public pool/status projections contain no native workspace paths; and
10. a dirty parent is rejected rather than represented as its stale `HEAD`;
11. Arc policy sources validate by pinned digest without reading dirty live
    checkout content into the worker realization; and
12. the Arc test route is a pinned Make action, never heuristic raw pytest.

The regression uses fixture provider responses and does not consume live model
quota. A live ArcAGI3 field run is a later, explicit operation.

## Deferred

- recursive child spawning;
- follow-up, resume, and per-child interrupt;
- higher-level workspace assignment UI;
- automatic merge/admission of worker branches;
- dirty-parent snapshot compilation and admission;
- remote branch publication;
- worktree garbage-collection policy;
- container-backed workspace realization;
- WorldManager artifact lifecycle integration; and
- semantic auditor synthesis over the typed worker trace.
