# Direct Constitutional Meta-Role Specification

Status: implemented foundation with `semantic_router` as the first production
member.

## Purpose

Some synthetic reasoning functions belong to the constitutional machinery of
the harness rather than to the user's roster of task agents. They are invoked
because a typed event or predicate requires an institutional judgment, not
because the user selected an agent to own work.

The reusable class is:

```text
constitutional_meta_role
```

Expected members include semantic routing, automatic permission review,
policy resolution, context compilation, compaction governance, and epistemic
transcription. A member is an institutional office. Its current model is a
replaceable realization of that office, not its identity.

## Base Class Constitution

Every member inherits these invariants:

```text
owner                         harness
instantiation authority       harness only
activation                    typed event or predicate
input                          compiled typed projection
output                         typed constitutional artifact
user task ownership            false
visible speaker                false
ordinary role-picker display   false
chat runtime inheritance       false
project-worker inheritance     false
default effect authority       deny
provenance                     required
```

The class default does not prevent a member from receiving narrow explicit
authority. It requires such authority to be declared in that member's typed
authority envelope. A permission reviewer may therefore authorize an operation
inside a compiled jurisdiction, while a semantic router may only classify and
propose routing.

Member declaration alone does not activate authority. An invocation gains that
standing only when its compiler binds an exact harness-issued authority-grant
reference. A grant supplied to a member whose constitution declares no such
authority is rejected.

## Canonical Objects

```text
direct_constitutional_meta_role_class@1
direct_constitutional_meta_role_member@1
direct_constitutional_meta_role_realization_policy@1
direct_constitutional_meta_role_invocation@1
direct_constitutional_meta_role_registry_projection@1
```

The division of responsibility is:

```text
class
  inherited institutional invariants

member
  constitutional function, trigger, typed inputs/outputs,
  capabilities, authority, lifecycle, and failure postures

realization policy
  provider/model/effort candidates and fallback posture

invocation
  one immutable event-bound compiled instance

artifact
  what that invocation lawfully established
```

Adding a member uses the same registry path:

```text
define realization policy
-> define member differentia
-> validate inherited class invariants
-> register member and policy
-> compile event-bound invocation
-> resolve realization independently
-> persist typed output and provenance
```

The default registry contains only implemented production members. Tests may
register a candidate member such as `auto_review` to prove extensibility, but a
test registration does not claim that member is wired into production.

## Semantic Router Member

`semantic_router` is the first active member:

```text
activation:
  admitted WorldManager semantic ingress or semantic child event

input:
  bounded semantic-ingress projection

output:
  SemanticDischarge / SemanticRoutingWitness

capabilities:
  wm_discharge_world_conversation
  wm_discharge_world_introspection
  wm_discharge_project_ecology_concern
  wm_discharge_decision_concern
  wm_discharge_project_concern
  wm_discharge_project_genesis
  wm_discharge_clarification
  wm_discharge_split

permitted acts:
  classify ingress
  propose route
  request clarification
  split a compound semantic contract

forbidden effects:
  canonical admission
  policy mutation
  worker start
  workspace, remote, or external mutation
```

The semantic router never formulates the visible answer. Its typed discharge
is validated and mechanically adapted into the existing WorldManager task
settlement and routing decision. The selected WorldManager or Project Manager
then owns natural-language formulation.

Each run persists the exact meta-role invocation, member/policy references,
model telemetry, and routing artifact lineage. Raw provider payload and private
reasoning remain excluded.

Before transport, the Direct runner re-resolves the member and realization
policy from its own canonical registry. A structurally valid but unknown member,
or a substituted policy with a different identity/digest, is rejected.

## Independent Realization Policy

The semantic router's harness-owned preferred realization is:

```text
provider:          chatgpt_direct
model:             gpt-5.3-codex-spark
reasoning effort:  high
scope:             semantic_router only
user selectable:   false
```

If Spark is absent from the observed catalog, the selector uses the current
provider default, then the bundled default. If no catalog evidence exists, the
preferred policy is attempted with an explicit unverified posture and the
normal Direct readiness boundary remains authoritative.

The ordinary Manager runtime preference applies only to visible WorldManager
and Project Manager provider calls. It cannot override a constitutional
meta-role, and project or worker model settings are likewise irrelevant to the
router.

Current implementation provides selection-time fallback. The class declares
bounded retry, configured fallback, constitutional escalation, and visible
remand as lawful failure postures, but automatic post-failure retry and
stronger-model escalation are not yet executed. Current provider failure
terminates in the existing visible semantic-ingress remand.

## Projection And UX Boundary

The production WorldManager projection includes a renderer-safe registry
projection. It exposes member identity, constitutional function, capabilities,
authority envelope, and realization policy without placing the member in the
ordinary agent/model selector.

A later constitutional-services inspector may render this projection as an
optional observation surface. It must remain separate from the user's task-role
picker and from the visible conversation speaker list.

## Verification

```text
npm run direct:constitutional-meta-role
npm run direct:world-manager-semantic-ingress
npm run direct:world-manager-semantic-split
npm run direct:world-manager-runtime-settings
```

The focused regression proves class invariants, immutable invocation lineage,
Spark preference, provider fallback, ordinary-picker exclusion, semantic
ingress integration, duplicate-member rejection, and registration of a second
fixture member through the same generic path.
