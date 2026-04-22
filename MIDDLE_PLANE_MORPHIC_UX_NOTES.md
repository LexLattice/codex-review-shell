# Middle Plane Morphic UX Notes

Status: design note for later implementation work.

This document captures the interaction principles discussed for the three-pane shell so they remain stable when the middle plane is revisited.

## Product posture

The shell is not one big custom super-surface. It is a bounded desktop workbench with three distinct roles:

- **Left plane:** real local Codex chat surface.
- **Middle plane:** governed operator workbench.
- **Right plane:** real remote ChatGPT chat surface.

The left and right planes should behave like mirror chat surfaces at the structural level. The middle plane exists to bind, steer, expose status, and host human-supporting tools. It should not try to impersonate either chat.

## Core doctrine

- Treat the left and right panes as mostly vanilla chat surfaces.
- Put product-specific controls and workflow logic in the middle plane.
- Keep the middle plane desktop-first and expert-operator oriented.
- Preserve explicit status, trust boundaries, and evidence-before-commit behavior.
- Avoid turning the middle plane into one long crammed dashboard column.

## Attention model

The user will rarely compose into both chats at the same time.

The shell should therefore optimize for:

- one active conversation focus
- one secondary conversation kept visible for reference
- fast, legible handoff between them

The two chat panes are peers structurally, but only one is usually the active cognitive locus. The middle plane should reflect that instead of treating both sides as equally active at all times.

## Directional affinity

Middle-plane artifacts are not all neutral. Many have a natural affinity with one chat surface.

Examples:

- **Codex-affine artifacts:** file tree, diff viewer, workspace diagnostics, local command or runtime state, patch staging, Codex launch controls.
- **ChatGPT-affine artifacts:** thread routing, review packet staging, response capture, return-header handling, review handoff tracking.
- **Neutral artifacts:** project identity, top-level binding state, active-focus indication, loop status, relay state.

This means the middle plane should not be designed as one homogeneous stack. Its subviews should be allowed to lean toward the pane they serve.

## Persistent spine vs temporary work surfaces

The middle plane should distinguish between:

- **Persistent spine:** always-relevant state and controls such as project identity, workspace binding, Codex binary/model/effort, backend state, active relay status.
- **Temporary work surfaces:** task-shaped artifacts that deserve real space when active, such as a file tree, diff viewer, watched-artifact inspector, handoff queue, or launch diagnostics.
- **Focused overlays or subviews:** editing or staging surfaces that temporarily dominate part of the middle plane but should still feel same-context and reversible.

A file tree is the canonical example of a temporary work surface. It should not be stuffed into a small card. When invoked, it deserves a full vertical lane or a dominant middle-plane subview.

## Borrowing the inactive pane

One valid desktop morph for this product is:

- if a middle-plane artifact has strong affinity with one chat pane
- and the other chat pane is currently cognitively inactive
- the artifact may temporarily expand over the inactive chat pane footprint

Example:

- while the user is actively working with Codex, a Codex-affine artifact such as the file tree or diff viewer may expand into the normally secondary ChatGPT-side space

This should behave as a reversible workbench expansion, not as a route change.

Required qualities:

- the displaced chat remains clearly parked, not lost
- restore is immediate and obvious
- the middle-plane status spine remains visible
- the expansion clearly communicates which surface is temporarily suppressed

## Intent-shaped surfaces over exhaustive substrate

The UI should not default to raw capability surfaces when task intent is highly predictable.

The file tree example makes this clear:

- the user rarely wants "all markdown files in the repo"
- the user usually wants "one of the most recent review markdown files"

The design implication is:

- primary view should show the high-probability working set
- secondary view should expose broader filtered browse
- full raw tree should remain available as a fallback, not as the default first surface

This pattern should generalize across the shell:

- recent markdown artifacts before full markdown tree
- active handoffs before archived handoffs
- likely relevant diffs before complete changed-file listings
- current runtime target before every possible binary option
- active or recent ChatGPT threads before every archived thread

Do not make the user pay repository-scale navigation costs when the relevant task slice is usually known already.

## Same-context rule for the middle plane

When the middle plane opens a heavier artifact, it should preserve same-context reachability instead of feeling like a page change.

That means:

- no route-like resets for ordinary operator tasks
- no hiding critical status while a temporary work surface is open
- no making the user lose track of which chat is active
- no forcing a full context switch just to inspect a likely-needed artifact

The middle plane should feel like one bounded workbench with a stable spine and a rotating dominant lane.

## Practical implications for later implementation

- Move Codex-specific controls out of the left pane and into the middle plane.
- Keep the left pane as a real Codex web surface, not a custom fake chat.
- Keep the right pane as a real ChatGPT web surface.
- Model the middle plane as a governed operator workbench with persistent spine plus switchable dominant subviews.
- Allow directional overlays that borrow inactive-pane space for affine task artifacts.
- Prefer recent, active, or likely-needed subsets before rendering exhaustive repo or thread structures.
- Treat thread discovery and cross-surface lane binding as a dedicated middle-plane workbench surface rather than another card in the default control tab. See `docs/THREAD_LINKING_SPEC.md`.

## Short version

The middle plane should not be a static dashboard. It should be a governed workbench spine that:

- knows which chat currently has the operator's focus
- gives full space to the task artifact that matters right now
- biases artifacts toward the pane they naturally serve
- borrows inactive pane space when that helps
- defaults to the probable working set rather than exhaustive substrate
