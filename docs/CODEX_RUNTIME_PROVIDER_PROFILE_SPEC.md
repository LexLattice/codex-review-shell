# Codex Runtime Provider Profile Spec

## Purpose

`codex-review-shell` needs one root switch for how the Codex lane is powered.
Executable flavor is not the root abstraction. The root abstraction is the
runtime provider:

```text
CodexRuntimeProvider
  ├─ direct_oai
  └─ codex_executable
       ├─ vanilla
       ├─ lex_fork
       └─ unknown_custom
```

This is a Morphic support artifact. It defines which runtime truth source is
allowed to exist before the header/drawer projects that truth. It must fail
closed and carry structured evidence.

The renderer consumes a normalized provider profile and settings projection. It
must not hardcode affordances from a binary path, stale config flag, provider
label, or configured executable flavor.

## Surface Mode Versus Provider

Existing project config has a Codex lane mode. Provider is a separate axis:

```ts
surfaceBinding.codex = {
  surfaceMode: "managed" | "url" | "fallback"; // legacy field: mode
  provider: CodexRuntimeProviderConfig;
  defaults: {
    model?: string;
    reasoningEffort?: string;
  };
};
```

Meaning:

- `surfaceMode` controls how the lane is rendered or attached.
- `provider` controls who owns runtime capabilities and settings.
- `managed + codex_executable` is the current main-branch default.
- `managed + direct_oai` is the future local backend path.
- `url` is externally embedded and may be opaque.
- `fallback` is local degraded rendering with no live provider.

Provider kind must not erase `url` or `fallback` behavior.

## Provider Categories

### `codex_executable`

Current main-branch default.

This provider launches `codex app-server` and derives capabilities from:

- app-server startup evidence
- initialize/schema/protocol behavior
- managed requirements from `configRequirements/read`
- safe runtime probes such as `model/list`
- safe account probes such as allowlisted quota reads
- bundled fallback knowledge only when explicitly marked as fallback

Executable flavor has two identities:

```ts
type ExecutableFlavorEvidence = {
  configuredFlavor: "vanilla" | "lex_fork" | "unknown_custom";
  provenFlavor: "vanilla" | "lex_fork" | "unknown_custom" | "unproven";
  compatibility: "vanilla_compatible" | "fork_extended" | "incompatible" | "unknown";
  evidenceRefs: EvidenceRef[];
};
```

Rules:

- Configured flavor is project/operator config.
- Proven flavor is runtime evidence.
- Configured `lex_fork` shows fork diagnostics and probe affordances.
- Proven `lex_fork` may enable fork-backed controls only when the capability
  profile also exposes those controls.
- `unknown_custom` becomes vanilla-compatible only after app-server protocol
  compatibility is observed.

### `direct_oai`

Long-term parallel implementation path.

This provider connects through our ODEUI harness backend instead of a Codex CLI
executable. The backend serves its own authoritative capability and settings
profile.

Rules:

- The shell must not derive direct-provider capabilities from Codex CLI schema.
- The backend owns available model/reasoning/access/tool descriptors.
- The renderer still consumes the same normalized settings projection.
- Until a local backend serves a real provider profile, `direct_oai` is disabled
  or unavailable, not silently routed through `codex_executable`.

## Evidence Model

Reuse the runtime header evidence model: `EvidenceRef`, `RuntimeTruth`, and
`RuntimeStateStatus`.

Capability sources are plural:

```ts
type ProviderCapabilitySource = {
  source:
    | "served_by_provider"
    | "app_server_probe"
    | "app_server_schema"
    | "runtime_probe"
    | "account_probe"
    | "bundled_profile"
    | "project_config"
    | "inferred_fallback";
  status: "fresh" | "stale" | "failed" | "unavailable";
  enablesMutation: boolean;
  evidenceRef: EvidenceRef;
};
```

Rules:

- `project_config`, `bundled_profile`, and `inferred_fallback` may explain labels
  but must not enable mutation by themselves.
- Method support that enables mutation must come from runtime/provider evidence.
- Renderer code must not infer capabilities from labels or command paths.

## Normalized Profiles

```ts
type CodexRuntimeProviderProfile = {
  schemaVersion: 1;
  profileId: string;
  projectId: string;
  kind: "direct_oai" | "codex_executable";
  label: string;
  status: RuntimeStateStatus;
  truth: RuntimeTruth;
  selectedBy: "project_config" | "migration_default" | "operator_action" | "runtime_discovery";
  selectedAt?: string;
  capabilitySources: ProviderCapabilitySource[];
  evidenceRefs: EvidenceRef[];
  settingsProjection: RuntimeSettingsProjection;
  updatedAt: string;
};

type CodexExecutableProviderProfile = CodexRuntimeProviderProfile & {
  kind: "codex_executable";
  flavor: "vanilla" | "lex_fork" | "unknown_custom"; // configured flavor, compatibility only
  executable: {
    requestedRuntime: "auto" | "host" | "wsl";
    resolvedRuntime: "host" | "wsl" | "unknown";
    command: string;
    resolvedCommand?: string;
    codexHome?: string;
    workspaceRoot?: string;
    appServer: {
      status: RuntimeStateStatus;
      readyUrl?: string;
      transport: "websocket" | "unknown";
      schemaSource:
        | "app_server_probe"
        | "app_server_schema"
        | "runtime_probe"
        | "bundled_profile"
        | "unknown";
      evidenceRefs: EvidenceRef[];
    };
    flavor: ExecutableFlavorEvidence;
  };
};

type DirectOaiProviderProfile = CodexRuntimeProviderProfile & {
  kind: "direct_oai";
  direct: {
    backendStatus: "not_implemented" | "available" | "unavailable" | "failed" | "unknown";
    profileSource: "served_by_provider" | "project_config" | "unknown";
    endpointLabel?: string;
    evidenceRefs: EvidenceRef[];
  };
};
```

## Settings Projection

The drawer and header controls read provider-neutral descriptors:

```ts
type RuntimeSettingScopeSupport = {
  nextTurn: boolean;
  sessionDefault: boolean;
  projectDefault: boolean;
  liveThread: boolean;
  evidenceRefs: EvidenceRef[];
  unsupportedReason?: string;
};

type RuntimeSettingsProjection = {
  model: {
    activeLabel?: string;
    configuredDefault?: string;
    canList: boolean;
    availableModels: Array<{
      id: string;
      label: string;
      source: "model_list" | "provider_descriptor" | "configured" | "unknown";
    }>;
    scopes: RuntimeSettingScopeSupport;
    evidenceRefs: EvidenceRef[];
  };
  reasoning: {
    activeLabel?: string;
    configuredDefault?: string;
    availableEfforts: Array<"none" | "minimal" | "low" | "medium" | "high" | "xhigh">;
    scopes: RuntimeSettingScopeSupport;
    evidenceRefs: EvidenceRef[];
  };
  access: {
    approvalPolicies: string[];
    sandboxModes: string[];
    requirements?: {
      status: "ready" | "none" | "failed" | "unknown";
      allowedApprovalPolicies?: string[];
      allowedSandboxModes?: string[];
      evidenceRefs: EvidenceRef[];
    };
    scopes: {
      approvalPolicy: RuntimeSettingScopeSupport;
      sandbox: RuntimeSettingScopeSupport;
    };
    evidenceRefs: EvidenceRef[];
  };
  usage: {
    providerQuota: {
      canRead: boolean;
      readSource?: "account/rateLimits/read" | "served_by_provider";
      eventSource?: "account/rateLimits/updated";
      readOwnedBy: "main_process" | "provider_backend";
      evidenceRefs: EvidenceRef[];
    };
    contextPressure: {
      canRead: boolean;
      source?: "app_server_event" | "served_by_provider";
      evidenceRefs: EvidenceRef[];
    };
  };
};
```

Important distinctions:

- `canList=false` does not imply `cannot set model`.
- Settings may be accepted by scope even when no catalog is available.
- `configRequirements/read` narrows visible/allowed approval and sandbox choices
  when requirements provide allow-lists; absence of allow-lists means
  unrestricted by managed requirements, not unsupported by protocol.
- Renderer must not call arbitrary provider-declared methods. Provider quota
  reads go through an allowlisted bridge path owned by the main process/provider
  backend.

## Transition Contracts

### ChangeProviderKind

```text
User.selectProvider(kind)
  -> validate provider availability
  -> show reload/reconnect consequence
  -> save project config
  -> dispose incompatible current runtime session
  -> build new provider profile
  -> reload Codex surface
  -> rebuild runtime constitution
```

Rules:

- `direct_oai` unavailable cannot commit unless feature/backend exists.
- `codex_executable` unavailable may save, but runtime status becomes unavailable.
- Failed provider startup must not silently fallback to another provider.

### ChangeExecutableFlavor

```text
User.selectExecutableFlavor(flavor)
  -> save configured flavor
  -> do not enable fork controls
  -> run safe provider probes when runtime is next started/refreshed
  -> update provenFlavor only from runtime evidence
```

### RefreshProviderProfile

```text
User.click(refresh profile)
  -> safe probes only
  -> update provider profile evidence
  -> update runtime constitution
```

Safe probes:

- app-server readiness
- initialize/schema
- model/list if supported
- account/read
- account/rateLimits/read only when allowlisted/supported
- version/fork identity probe if supported

Unsafe probes:

- sandbox mutation
- approval-policy mutation
- destructive thread maintenance
- write-permission elevation

## Migration

Existing projects without `surfaceBinding.codex.provider` are migrated as:

- `codex.mode = managed` -> `provider.kind = codex_executable`
- new projects -> `provider.flavor.configuredFlavor = vanilla`
- existing managed project with command `codex` or `codex.cmd` -> configured
  flavor `vanilla`, confidence `configured`
- existing managed project with non-default command -> configured flavor
  `unknown_custom`, confidence `configured`
- `codex.mode = url` -> surface mode `url`, provider unavailable/opaque unless
  a future external provider profile exists
- `codex.mode = fallback` -> surface mode `fallback`, provider unavailable

Migration does not create proven fork identity, enable fork-only controls, or
create provider quota evidence.

## Provider Selector UX

Project edit drawer order:

```text
Runtime provider       [ Codex executable ▾ ]
Executable profile     [ Vanilla Codex executable ▾ ]
Execution environment  [ Auto / Host / WSL ]
Command                [ codex ]
Codex home             [ optional path ]
Capability source      app-server probe · ready
```

When `direct_oai` is unavailable:

```text
Runtime provider [ Direct OAI backend ] disabled
Reserved: no local direct backend profile is available in this build.
```

For a configured fork:

```text
Executable profile [ Lex fork ]
Fork status        Configured as Lex fork · not runtime-proven yet
Fork-only controls Disabled until provider probe confirms fork capability.
```

## Artifact Inventory

| Artifact | Class | Build/import/align | Host-owned semantics |
| --- | --- | --- | --- |
| Runtime provider profile normalizer | support artifact | build | provider identity, capability provenance, fail-closed settings projection |
| Provider selector | surface artifact | build | project-level provider choice with reload consequence |
| Executable flavor projector | support artifact | build | configured vs proven flavor separation |
| Direct provider adapter contract | support artifact | design/build later | direct backend-owned descriptors, no CLI schema inheritance |
| Settings projection | support artifact | build | provider-neutral model/reasoning/access/usage affordances |
| Safe provider probe runner | support artifact | build | read-only probes only, evidence refs, no mutation |

## Implementation Anchors

- Main provider normalization:
  `src/main/runtime-provider-profile.js`
- Executable app-server capability snapshot:
  `src/main/codex-app-server.js`
- Project edit provider selection:
  `src/renderer/index.html`
  `src/renderer/app.js`
- Runtime drawer projection:
  `src/renderer/codex-surface.js`

Recommended dataflow:

```text
Project config
  -> runtime-provider-profile.js
  -> CodexRuntimeProviderProfile
  -> RuntimeSettingsProjection
  -> Runtime constitution builder
  -> Header + Runtime drawer
```

## Acceptance Criteria

- Provider profile includes `schemaVersion`, `projectId`, `updatedAt`, and
  structured `evidenceRefs`.
- Configured executable flavor and runtime-proven flavor are represented
  separately.
- A new project stores `provider.kind = codex_executable` and configured flavor
  `vanilla` by default.
- Selecting `lex_fork` never enables fork-only controls without runtime evidence.
- `unknown_custom` becomes vanilla-compatible only after app-server protocol
  compatibility is observed.
- `project_config`, `bundled_profile`, and `inferred_fallback` may explain labels
  but must not enable mutation controls by themselves.
- Existing `codex.mode` is preserved as `surfaceMode` or explicitly migrated;
  provider kind must not erase URL/fallback behavior.
- Direct OAI remains disabled/unavailable unless a local backend serves a provider
  profile.
- Runtime drawer shows provider kind, configured/proven flavor, compatibility,
  and capability sources.
- The renderer consumes normalized provider/settings projection only; it does
  not derive settings from binary path, command name, or provider label.
- Provider quota reads are allowlisted and main-process mediated; no arbitrary
  renderer method calls from provider profile strings.
- Changing provider kind shows reload/reconnect consequence and never silently
  falls back to another provider.
