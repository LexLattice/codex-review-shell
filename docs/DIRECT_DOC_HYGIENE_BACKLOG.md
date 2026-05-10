# Direct Documentation Hygiene Backlog

This file tracks broad documentation cleanup surfaced while reviewing the
long-lived direct branch against `main`. These items are intentionally separated
from runtime implementation fixes.

Source: PR #55 Gemini review comments, deferred after closing the mainline PR
for the direct branch.

## Later Dedicated Pass

- Replace user-specific example paths with placeholders such as `<project-root>`,
  `<user-data-root>`, and `<workspace-root>` where the path is not intentionally
  documenting this developer mirror.
- Add or link shared type references for cross-spec names that are currently
  used before definition, such as direct import lineage, projection summaries,
  activation binding snapshots, blocker-code enums, and request/session helper
  types.
- Normalize type ordering in specs where readability suffers from forward
  references.
- Review direct fork/derived preview recovery sections for any stale or
  misleading type names, including `DerivedPreviewForkComposerState` references
  in the derived-preview fork-start spec.
- Revisit repeated forward-reference comments around types such as
  `DirectContextBuildBlocker`, `DirectImportLineage`,
  `DirectImportWorkspaceMatch`, `DirectToolContinuationFailureKind`, and
  `RendererTranscriptProjectionStaleReason`.

These are documentation quality issues, not current runtime blockers.
