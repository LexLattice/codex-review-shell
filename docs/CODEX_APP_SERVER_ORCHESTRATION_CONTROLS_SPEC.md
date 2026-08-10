# Codex App-Server Orchestration Controls

Status: implemented, project-scoped stable-145 activation with a release-144 safe
fallback.

Scope:

```text
Direct review shell managed Codex app-server lane only
```

This spec does not change the official Codex desktop app, the upstream Codex
binary, URL-bound external app servers, or the Direct OpenAI harness.

Related documents:

```text
docs/CODEX_APP_SERVER_ONTOLOGY.md
docs/OAI_CODEX_UPSTREAM_ODEU_PROFILE.md
docs/ODEU_ROLE_LANE_MULTI_AGENT_ARCHITECTURE_SPEC.md
docs/DIRECT_WAVE23_WORLDMODEL_MANAGER_AUTHORIZATION_SPEC.md
docs/DIRECT_WAVE24_ENVIRONMENT_AND_ASYNC_WORK_SPEC.md
```

## Outcome

The shell supports the useful part of current vanilla orchestration through
two explicit managed-runtime profiles without inventing a client-side
collaboration schema:

```text
root effort = ultra
  -> proactive V2 orchestration posture

collaboration.spawn_agent
  -> canonical hosted-V2 provider schema

release-144 compatibility profile
  -> task_name, message, fork_turns
  -> child model/effort remain provider-managed
  -> narrow exposure explicitly false

0.145 split-schema profile
  -> task_name, message, fork_turns, model, reasoning_effort
  -> agent_type and service_tier remain hidden

worker activity
  -> visible and inspectable
  -> parent-mediated
  -> no direct user chat

fresh or bounded child context
  -> root may select model/effort inside the active multi-agent backend

full-history child context
  -> inherits parent model/effort; overrides are rejected
```

Root model/effort controls and child model/effort controls are different
objects. The shell selects Ultra for the root independently. The project-level
split-schema control records an intent to expose canonical child controls; it
does not by itself prove that the active binary, model, and provider accepted
that contract.

## Active Runtime Topology

The Review Shell process is a Windows Electron application, but the active
project is WSL-native. Its managed route is:

```text
Windows Review Shell
  -> wsl.exe -d Ubuntu
  -> bash -lc
  -> /home/rose/.nvm/versions/node/v24.14.0/bin/codex app-server
  -> CODEX_HOME: /home/rose/.codex (logged-in WSL home)
```

The WSL npm installation is pinned to:

```text
@openai/codex@0.145.0
```

The active Review Shell project profile requests:

```text
root model = gpt-5.6-sol
root reasoning effort = ultra
bounded worker profile = enabled
bounded worker default intent = fork_turns none, effort low, model inherited
```

That release contains both required upstream commits:

```text
ea15456284  Expose model overrides for multi-agent v2 spawns (#32749)
92938d880e  Restrict spawned-agent models to the active backend (#32751)
```

The Windows PATH Codex and the vanilla desktop's bundled WSL Codex are
separate installations and were not upgraded by this activation. When the
split profile is enabled, the Review Shell preserves the configured WSL
`codex` command even if a resumed task's recorded source home is the vanilla
desktop home. The task may keep using that home for auth/history, but it cannot
silently substitute the older desktop-bundled binary. The disabled fallback
profile retains the former home-bundle selection behavior.

Both Review Shell launchers now default WSL tasks to `/home/rose/.codex` rather
than the repo-local `.codex-home`, because the latter has no ChatGPT login. This
keeps authentication and the model catalog aligned with the WSL CLI that was
actually upgraded. Project scope continues to come from the Review Shell
project binding and workspace root; `CODEX_HOME` is runtime/account state, not
the project ontology.

## Incident And Corrective Law

The first implementation launched app-server with:

```text
features.multi_agent_v2.hide_spawn_agent_metadata=false
```

On release `0.144.4`, that switch changes the provider-reserved
`collaboration.spawn_agent` contract. It adds these inputs:

```text
agent_type
model
reasoning_effort
service_tier
```

and changes the result shape to include `nickname`. Hosted GPT-5.6 validates
the reserved tool against its configured schema and rejects the modified tool
before inference:

```text
Invalid Value: 'tools'. Function 'collaboration.spawn_agent' is reserved for
use by this model and must match the configured schema.
```

The corrective law is:

```text
local handler support != provider-authorized reserved tool schema
```

Every managed launch therefore explicitly preserves:

```text
features.multi_agent_v2.hide_spawn_agent_metadata=true
```

Because the 145-family runtime defaults the narrow exposure on, the disabled profile also
declares:

```text
features.multi_agent_v2.expose_spawn_agent_model_overrides=false
```

The enabled split profile replaces that value with:

```text
features.multi_agent_v2.expose_spawn_agent_model_overrides=true
```

This combination exposes `model` and `reasoning_effort` without exposing
`agent_type`, `service_tier`, or `nickname`. It also overrides a stale user
setting that could otherwise recreate the original broad-schema failure. A
versioned managed-runtime descriptor forces a changed project profile to
replace the previous app-server process.

## Canonical Hosted-V2 Contract

For the enabled stable project profile, the shell treats this as the exact
visible input surface:

```text
task_name
message
fork_turns
model
reasoning_effort
```

These remain hidden and must not be inserted by this client:

```text
agent_type
service_tier
```

The result contains `task_name`; the split form does not add `nickname`. This
is an upstream/provider-reserved schema, not a client extension. Model and
effort later reported on collaboration items remain the authoritative runtime
evidence that a particular child actually used the requested profile.

When the project control is disabled, the safe fallback surface remains:

```text
task_name
message
fork_turns
```

and child model/effort are provider-managed.

## Multi-Agent Version Selection

Current model metadata selects Multi-Agent V2. The shell does not force V2
when model metadata selects another contract or disables collaboration.

Multi-agent version is sticky per task:

```text
fresh task
  -> resolves its collaboration version from current model/runtime truth

resumed task or fork
  -> retains the recorded collaboration version
```

A task may therefore need to be recreated to adopt a newer V2 contract, but a
fresh task alone cannot repair a malformed process-wide tool schema. After this
incident the shell process/app-server must first be restarted.

## Root Orchestration Posture

Vanilla derives V2 orchestration posture from the root reasoning effort:

```text
V2 + ultra
  -> proactive orchestration

V2 + other effort
  -> explicit-request delegation
```

The shell preserves `max` and `ultra` across project settings, task runtime
preferences, thread start, turn start, and model-supported effort menus. A new
app-server thread carries its sticky effort through:

```text
config.model_reasoning_effort
```

Turns continue to send the selected effective `effort`. The deprecated
`multiAgentMode` input is not used.

## Fork And Worker-Profile Law

`fork_turns` remains available in the canonical schema:

```text
fork_turns = all or omitted
  -> full-history child
  -> inherits parent model, effort, and role
  -> model/effort overrides are invalid

fork_turns = none or positive integer string
  -> fresh/bounded child context
  -> split-schema profile may apply model/effort overrides
```

The split profile still hides `agent_type`, so the root cannot choose a named
role. Codex resolves omitted `agent_type` to the configured/default worker role
for a non-full-history spawn. A managed named worker profile can therefore be
mapped to `agents.default.config_file` without modifying the reserved schema.

That profile must:

```text
live in a shell-owned path
never overwrite ~/.codex/agents/default.toml
be selected through explicit global/project profile state
be applied only to none/bounded forks
be shown separately from the root runtime profile
remain inside the parent's authority boundary
```

For the current provider, the safest lower-cost worker intent is even narrower:

```text
fork_turns = none
reasoning_effort = low
model = omitted
```

Omitting `model` preserves the active backend's compatible default while
lowering worker effort. An explicit model must come from the selectable set
advertised for the active multi-agent backend; an arbitrary root model name is
not lawful.

The enabled project control also projects this standing intent into new
managed app-server tasks through `developerInstructions`. It tells the root to
prefer a fresh Low-effort, model-inheriting child for bounded specialist work,
to avoid overrides on full-history forks, and to preserve the parent's action
authority boundary. This makes the control operational rather than merely
making two schema fields visible. Existing tasks do not retroactively acquire
the new thread-start instruction.

The default-role compatibility path remains useful for richer role
instructions:

```toml
name = "default"
description = "Bounded lower-effort worker selected by Codex Review Shell."
developer_instructions = """
Perform the delegated bounded task and return concise evidence.
"""
model_reasoning_effort = "low"
```

This default-profile mechanism is not materialized by the present stable
activation.

## Upstream Upgrade Adoption

Upstream after release `0.144.4` introduced the provider-compatible split:

```text
ea15456284  Expose model overrides for multi-agent v2 spawns (#32749)
92938d880e  Restrict spawned-agent models to the active backend (#32751)
```

The first introduces:

```text
features.multi_agent_v2.expose_spawn_agent_model_overrides
```

so `model` and `reasoning_effort` can be exposed while `agent_type` and
`service_tier` remain hidden. The second restricts selectable child models to
the active multi-agent backend.

The active WSL stable `0.145.0` contains both changes; the earliest normal alpha
containing both was `0.145.0-alpha.7`. The shell exposes the split only
when the project-scoped intent is enabled. It never restores the old broad
metadata switch.

The project control is a requested capability exposure. Runtime readiness and
canonical collaboration items remain separate witnesses. If a project is
routed through an older or different Codex installation, the configured intent
must not be confused with provider acceptance.

For the enabled WSL profile, binary selection is also constitutional input:
the descriptor reports `configured_binary_required` and does not substitute a
desktop-home bundled WSL binary. This closes the resume-path ambiguity that
previously let identical project settings execute through a different release.

## Interaction And Observability Contract

```text
user <-> root agent / manager

root agent
  -> spawn_agent
  -> send_message / followup_task / interrupt_agent
  -> worker result admitted into parent reasoning

user
  -> reads worker status, activity, transcript, runtime evidence, and result
  -X-> does not chat directly in the worker task
```

The Sub-agents panel remains read-only and non-conversational. The renderer
does not gain a client-side spawn RPC. Missing worker model/effort evidence
remains unknown/inherited; it is not copied from the current root UI setting.

## Managed Launch Contract

All host, Linux, and WSL managed app-server routes use the base guard:

```text
codex app-server \
  -c features.multi_agent_v2.hide_spawn_agent_metadata=true \
  -c features.multi_agent_v2.expose_spawn_agent_model_overrides=false \
  --listen <managed-websocket-url>
```

When the project requests canonical model/effort controls, the route uses:

```text
codex app-server \
  -c features.multi_agent_v2.hide_spawn_agent_metadata=true \
  -c features.multi_agent_v2.expose_spawn_agent_model_overrides=true \
  --listen <managed-websocket-url>
```

The shell does not set generic process-wide V2 usage-hint text because that
same setting can reach V1's different spawn contract. URL-bound external app
servers are not rewritten. The Direct provider descriptor receives no
app-server orchestration profile. Changing the project control changes the
versioned descriptor key and therefore restarts the managed app-server.

## Runtime Truth

The enabled split app-server capability profile reports:

```text
reservedProviderToolSchema = true
providerContract = v2_split_model_overrides
spawnContractStatus = configured_unverified
spawnProviderAcceptanceStatus = unverified
minimumCodexVersion = 0.145.0-alpha.7
visibleInputFields = task_name, message, fork_turns, model, reasoning_effort
hiddenInputFields = agent_type, service_tier
modelVisibleSpawnControlsConfigured = true
spawnModelOverrideConfigured = true
spawnReasoningEffortOverrideConfigured = true
fullHistoryForkInheritsParentProfile = true
fullHistoryOverrideAllowed = false
perSpawnOverrideForkTurns = none, positive_integer
compatibleModelSet = active_multi_agent_backend
perSpawnRuntimeSelection = root_selectable_within_active_backend
effectiveModelVisibleSpawnControls = unknown
clientSchemaExtensionAllowed = false
```

The disabled fallback profile reports the release-144 three-field surface and
`provider_managed`, with `spawnContractStatus=disabled`. These are
configuration and runtime-route claims. A live
spawn result is still needed to prove the provider accepted a concrete child
model/effort request.

## Verification Evidence

On 2026-07-15 the WSL runtime produced these witnesses:

```text
command -v codex
  -> /home/rose/.nvm/versions/node/v24.14.0/bin/codex

codex --version
  -> codex-cli 0.145.0-alpha.11

managed app-server startup with both schema flags
  -> listener became ready

gpt-5.6-sol + ultra + both schema flags
  -> app-server model/list advertised low..ultra effort support
  -> thread/start reported model gpt-5.6-sol and reasoningEffort ultra
  -> provider returned ALPHA_NO_TOOL_OK
  -> no reserved-tools 400

fresh child request with reasoning_effort=low and model omitted
  -> provider accepted the request schema
  -> app-server emitted childActivity for /root/alpha_low_child_smoke
  -> collaboration wait completed
  -> root returned ROOT_SPAWN_OK
```

The captured child activity did not include an authoritative effective runtime
profile for that ephemeral child. Therefore this witness proves provider
schema acceptance and the child lifecycle path, but it does not yet prove the
effective child effort. A canonical child runtime item remains the required
witness for that last claim.

On 2026-07-22 both the configured absolute binary and PATH command reported
`codex-cli 0.145.0`. A stable authenticated root turn initialized, streamed the
exact response `stable-145-ready.`, and completed without tools. This promotes
the root app-server path to a stable-runtime witness. The 2026-07-15 alpha
spawn evidence above remains the latest child-spawn witness until a stable
child run reports its effective model and effort.

## Acceptance Checks

```text
- Every managed launch route carries hide_spawn_agent_metadata=true.
- No managed route carries hide_spawn_agent_metadata=false.
- The disabled route explicitly carries expose_spawn_agent_model_overrides=false.
- The enabled route carries expose_spawn_agent_model_overrides=true, never both values.
- The fallback schema contains exactly task_name, message, fork_turns.
- The enabled split schema additionally contains model and reasoning_effort.
- agent_type and service_tier are absent from both profiles.
- The hidden result schema contains task_name and not nickname.
- The managed descriptor key changes from the broken launch profile.
- Enabling or disabling the split profile changes the descriptor key.
- A new enabled task receives the bounded Low-effort worker intent through developerInstructions.
- Full-history forks reject model/effort overrides.
- Fresh and bounded forks may use model/effort from the active backend only.
- Ultra and max survive configuration normalization.
- thread/start uses config.model_reasoning_effort.
- turn/start sends the effective effort.
- Worker items remain observable and non-chatable.
- Model/effort output is displayed only when runtime evidence reports it.
- No Direct-provider or external-app-server behavior is changed.
```

The strongest future regression is a local Responses mock that captures the
serialized `tools` request and compares the full reserved tool object to a
checked-in provider-compatible fixture before any paid/provider call.

## Non-Goals

This corrective slice does not:

```text
force Multi-Agent V2
expose agent_type or service_tier
claim split controls on stock 0.144.4 or an unverified external app server
materialize a shell-managed default worker profile
backport release-145 commits into the release-tracking source branch
add user-to-worker chat
add client-side spawn authority
implement cross-environment Windows/WSL worker placement
broaden worker tool or mutation authority
modify the official Codex desktop application
```

## Completion Law

The correction is complete when:

```text
1. The malformed broad reserved schema cannot be launched by the managed shell.
2. The project-scoped split intent launches both narrow schema flags.
3. Ultra root orchestration and worker observability remain intact.
4. Runtime truth distinguishes configured exposure from observed child runtime.
5. The shell/app-server has been restarted under the new descriptor.
```

Exact WSL rollback is:

```bash
npm install --global @openai/codex@0.144.4
hash -r
codex --version
```

After rollback, disable the project split-schema control and fully restart the
Review Shell so the managed app-server returns to the safe fallback profile.
