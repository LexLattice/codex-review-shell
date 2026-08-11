# Direct ArcAGI3 workspace-worker execution (EXEC1)

Status: implemented first slice

## Outcome

Direct Workbench can launch several provider-backed workers against one Git
repository without sharing a mutable checkout. A workspace-backed child is an
opt-in alternative to the existing reasoning-only child route.

Each workspace child receives:

- one immutable project/work-thread binding;
- one harness-created Git worktree and local `codex/worker/*` branch;
- one role-compiled tool profile;
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
capability set from project and substrate evidence.

The first-slice constitutions are:

| Profile | Read | Patch | Test | Recursive spawn | Remote mutation |
| --- | --- | --- | --- | --- | --- |
| `read_only_worker` | yes | no | no | no | no |
| `implementation_worker` | yes | yes | only when a local test profile is detected | no | no |

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
  named tool profile
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

## Test authority

The provider sees `run_test`, not `run_command`.

The resident backend deterministically detects a bounded local test profile
from repository markers. The first profiles are:

- Python/pytest: `python3 -m pytest` (or `python -m pytest` on Windows);
- Node package test: `npm test` when `package.json` declares a test script; and
- Make: `make test` when a literal `test` target exists.

At execution time the backend re-detects the profile and requires the compiled
profile digest to match. The model cannot supply an executable or replace the
base arguments. Optional Python test targets must be contained relative paths;
flags, absolute paths, traversal, URLs, and shell syntax are rejected.

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

The EXEC1 regression creates a temporary local clone derived from the committed
ArcAGI3 repository, then launches two workspace workers from the same pinned
commit. It must prove:

1. distinct branch and worktree bindings;
2. parallel child execution beyond a shared-checkout model;
3. each patch appears only in its worker's worktree;
4. one worker cannot address the other's native root through any tool argument;
5. the seed checkout remains unchanged;
6. only compiled read/patch/test tools are provider-visible;
7. recursive spawn, general shell, and remote Git are absent;
8. terminal capture contains typed tool results and binding evidence; and
9. public pool/status projections contain no native workspace paths; and
10. a dirty parent is rejected rather than represented as its stale `HEAD`.

The regression uses fixture provider responses and does not consume live model
quota. A live ArcAGI3 field run is a later, explicit operation.

## Deferred

- recursive child spawning;
- higher-level workspace assignment UI;
- automatic merge/admission of worker branches;
- dirty-parent snapshot compilation and admission;
- remote branch publication;
- worktree garbage-collection policy;
- container-backed workspace realization;
- WorldManager artifact lifecycle integration; and
- semantic auditor synthesis over the typed worker trace.
