# Direct Containerized Semantic UI Acceptance Stack

Status: implemented fixture-safe v1  
Executor: Docker + Xvfb + Playwright Electron  
Default authority posture: disposable test world only

## Purpose

The stack gives Direct agents independent graphical test environments without
requiring one shared desktop, one shared simulator, or one shared application
profile.

It closes a gap between the existing proof tiers:

```text
backend headless proof
  -> containerized semantic UI acceptance
  -> manual human UX/feel proof
```

The middle tier launches the production WorldManager Electron surface, performs
high-level semantic UI actions, captures visual evidence, and then inspects the
isolated control-plane database. It is intended for feature-flow verification.
It does not replace human evaluation of feel, information density, or the
quality of a prolonged end-to-end interaction.

## Semantic scenario, substrate executor

The test definition does not carry raw selectors. It declares semantic actions:

```text
launch the production WorldManager surface
focus the ARO semantic region
assert that the focused ARO registry is empty
capture the final surface
```

The scenario contract identifies:

- the disposable test world;
- allowed substrate executors;
- provider, network, mutation, time, CPU, and memory budgets;
- semantic target references;
- required evidence and expected effects.

The executor owns the current translation from semantic target references to
renderer locators. A frontend refactor therefore changes the executor mapping,
not the meaning of the acceptance scenario.

The typed objects are:

- `direct_semantic_acceptance_scenario@1`;
- `direct_semantic_acceptance_report@1`;
- `direct_container_ui_parallel_isolation_report@1`.

The contract supports the executor vocabulary `backend_headless`,
`local_xvfb`, `docker_xvfb`, and `windows_host`. Only the fixture-safe
`docker_xvfb` path is implemented by this slice.

## Implemented architecture

```text
scenario fixture
  -> host launcher validates fixture authority and budgets
  -> unique Docker Compose project
  -> non-root, read-only container
  -> private Xvfb + D-Bus session
  -> production Electron WorldManager
  -> Playwright semantic action adapter
  -> screenshot + renderer evidence
  -> isolated SQLite/trust-store inspection
  -> typed acceptance report
  -> container and volume teardown
```

The implementation lives in:

- `src/main/direct/headless/semantic-acceptance-contract.js`;
- `scripts/fixtures/container-ui-test-world-manager-empty.json`;
- `scripts/direct-container-ui-test-runner.mjs`;
- `scripts/direct-container-ui-test-stack.mjs`;
- `scripts/direct-container-ui-test-stack-regression.mjs`;
- `docker/ui-test.Dockerfile`;
- `docker/ui-test-entrypoint.sh`;
- `docker/compose.ui-test.yaml`.

The image includes runtime source, scripts, and the checked-in ODEU provider
profile required by production WorldManager bootstrap. It does not copy the
whole documentation tree.

## Fixture-world safety boundary

The v1 launcher rejects scenarios outside this boundary:

```text
disposable test world = required
test-world-only authority = required
live application profile mount = forbidden
writable host workspace mount = forbidden
provider transport = forbidden
provider-call budget = 0
network = none
workspace mutation = forbidden
production authority grant = false
raw prompt/provider payload retention = false
```

The Compose realization adds:

- a read-only root filesystem;
- a writable in-memory `/tmp`;
- one writable bind mount for evidence only;
- no auth or live profile mounts;
- a non-root UID/GID;
- all Linux capabilities dropped;
- `no-new-privileges`;
- bounded CPU, memory, PIDs, shared memory, and tmpfs;
- a unique Compose project and container identity for every run.

The empty-world fixture needs one ordinary workspace-config project as an
Electron launch anchor. That anchor is not an admitted
`wm_project_constitution`: the acceptance report still requires zero canonical
project constitutions and zero canonical AROs.

Production normally schedules provider-backed ARO reconstruction for configured
projects during `ready()`. Fixture runs set
`CODEX_WORLD_MANAGER_AUTOMATIC_ARO_RECONSTRUCTION=0`, which disables only that
automatic scheduling. The ARO capability remains compiled and inspectable, and
normal application launches retain the default automatic behavior.

## Commands

Prerequisite:

```bash
docker info
```

Build the reusable image:

```bash
npm run direct:container-ui-test:build
```

Build and run one isolated acceptance stack:

```bash
npm run direct:container-ui-test
```

Reuse an already-built image:

```bash
npm run direct:container-ui-test -- --no-build
```

Run two independent stacks concurrently and prove isolation:

```bash
npm run direct:container-ui-test:parallel
```

Validate the test-stack JavaScript:

```bash
npm run check:container-ui-test-syntax
```

The launcher also accepts explicit `--run-id`, `--evidence-dir`,
`--memory-limit`, `--cpu-limit`, `--pids-limit`, `--shm-size`,
`--tmpfs-limit`, `--screen`, and `--image` values. `--keep` is available for
diagnosis; normal runs always tear down their Compose resources.

## Evidence

Each run writes under:

```text
.cache/direct-container-ui-tests/<run-id>/
```

The normal evidence set is:

- `acceptance-report.json`;
- `surface-evidence.json`;
- `world-manager-final.png`;
- `stack.log`.

If the renderer fails before the final capture, the runner also attempts to
write `world-manager-failure.png` and bounded page/toast diagnostics.

The report proves:

- every semantic step reached its expected state;
- renderer error count;
- provider-backed role/reconstruction count;
- admitted project-constitution count;
- canonical ARO count;
- workspace-mutation count;
- creation of an isolated WorldManager authority identity;
- absence of live-profile and writable-workspace mounts;
- required artifact presence.

Provider-backed work accounting includes WorldManager role runs, ARO
reconstruction runs, target-definition runs, mutation-contract compilation
runs, realization-mapping runs, and worker-handoff runs. Counting even an
uncertain interrupted handoff is intentionally conservative. This keeps the
fixture-safe `providerCallCount = 0` assertion current through `WM-SC8.4`;
read-only execution-evidence acquisition is local observation and is not
counted as a model-provider call.

The parallel regression additionally requires two different container IDs and
two different authority-identity digests. Matching screenshots are acceptable;
matching authorities are not.

## Accepted v1 proof

The implemented smoke scenario passed against the production
`WM-K6-GENESIS` surface:

```text
launch surface                 passed
focus ARO semantic region      passed
assert empty ARO registry      passed
capture final surface          passed
provider calls                 0
canonical project effects      0
canonical ARO effects          0
workspace mutations            0
```

The two-stack regression passed concurrently with distinct executor instances
and distinct authority identities.

## Explicit exclusions and next executors

This slice does not yet provide:

- live-provider UI scenarios;
- writable disposable repository/worktree scenarios;
- native Windows UI automation;
- macOS UI automation;
- browser-plugin or host-application control;
- noVNC/VNC observation during a run;
- unlimited resource allocation;
- a claim that container isolation is a production security boundary.

Those should be added as separate executor classes with separate authority and
evidence contracts. In particular:

```text
fixture Docker-Xvfb executor
  != opt-in live-provider executor
  != disposable-worktree mutation executor
  != native Windows host executor
```

The semantic scenario should remain portable across those substrates. What
changes is the executor constitution: available host capabilities, mounted
world realization, effect authority, budgets, and required closure evidence.
