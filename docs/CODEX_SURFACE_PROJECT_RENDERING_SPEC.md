# Codex Surface Project And Rendering Spec

Status: implementation spec for the next standalone shell pass.

## Purpose

Bring the Codex lane closer to vanilla Codex behavior while preserving the standalone shell boundary:

- project activation should open the linked Codex thread as well as the linked ChatGPT thread
- live Codex answers should show unfolding thought/tool activity while a turn is running
- completed turns should collapse thought/tool activity above the final answer
- robustly identifiable content such as links and files should become typed, color-coded, and actionable

This is a Codex-surface compatibility pass, not a deep ADEU Studio type system.

## Project Activation

When a project is selected, the shell should resolve the project's active lane binding and activate both partners.

Binding resolution order:

1. A lane binding marked `openOnProjectActivate`.
2. The default binding for the active lane.
3. The first binding with either a Codex thread ref or a ChatGPT thread id.

Activation behavior:

- Keep opening the linked ChatGPT thread as today.
- Also open the linked Codex thread when the chosen binding has `codexThreadRef`.
- Do not clobber the current Codex panel when the project has no linked Codex thread.
- Treat project activation as a single operation with a request/version guard so slower async opens cannot overwrite a newer project selection.

Codex thread refs should persist enough location data to disambiguate homes:

```ts
type CodexThreadRef = {
  threadId: string;
  originator?: string;
  titleSnapshot?: string;
  cwdSnapshot?: string;
  sourceHome?: string;
  sessionFilePath?: string;
};
```

`sourceHome` and `sessionFilePath` are important because desktop and VS Code Codex homes can both expose threads with similar identifiers while requiring different backing transcript files.

Acceptance criteria:

- Clicking a project with a valid open-on-activate binding opens both the GPT thread and the linked Codex thread.
- Clicking a project without a linked Codex thread does not clear or replace the existing Codex panel.
- Switching projects rapidly cannot leave the Codex panel attached to the wrong project.

## Live Thought Rendering

Current rendering collapses thought items too early. The Codex surface should distinguish live turn rendering from completed turn rendering.

During an active turn:

- Render reasoning, commentary, tool calls, file changes, MCP calls, web search, and other tool-like items sequentially as they arrive.
- Keep the turn-level thought area expanded while the assistant is still working.
- Tool calls inside the live thought stream may be individually collapsed, but the root live thought stream remains visible.
- Render final assistant output separately as a normal assistant message.
- Do not classify final assistant output as thought. Only commentary/reasoning/tool-like items belong in the thought process.

On `turn/completed`:

- Collapse all non-final turn items into a single `Thought process (N)` block.
- Keep nested tool/tool-output details collapsed by default inside that block.
- Leave the final assistant output visible as the normal answer.
- If a turn has thought/tool output but no final answer, show the thought block plus a compact completion/status notice.

Recommended render state:

```ts
type LiveTurnRenderState = {
  turnId: string;
  finalItemId?: string;
  finalStarted: boolean;
  finalCompleted: boolean;
  thoughtItems: CodexItem[];
  thoughtContainer?: HTMLElement;
  finalContainer?: HTMLElement;
  collapsed: boolean;
};
```

Acceptance criteria:

- While Codex is answering, the thought stream unfolds in order.
- After completion, thought/tool activity collapses automatically.
- The assistant final answer is never lumped inside the collapsed thought process.

## Completed Turn Ordering

Completed turns should render in this order:

```text
User message
Thought process
Assistant final output
```

Implementation rules:

- In stored transcript rendering, split turn items into thought items and regular/final items.
- Render the collapsed thought process before the final assistant output.
- In live rendering, create or reserve the thought container before the final assistant bubble when the first thought item arrives.
- Avoid unnecessary DOM reordering that causes scroll jumps; prefer stable per-turn containers or `insertBefore` on the final bubble.

Acceptance criteria:

- Reloaded transcripts show `Thought process` above the final answer.
- Live turns complete into the same order without a second render pass visible to the user.
- Final-only turns do not render an empty thought block.

## Typed Content Rendering

Introduce a safe typed-content renderer for Codex messages, thought blocks, tool summaries, file changes, and approval cards.

Recognized v0 token types:

- `url`: clickable `http` and `https` links opened externally.
- `file_path`: project-relative, absolute WSL, or absolute Windows paths.
- `line_ref`: file paths with `:line` or `:line:col`.
- `diff_path`: file paths from structured file-change items.
- `command`: shell command text, color-coded only.
- `symbol`: code identifiers and backticked names, color-coded only.
- `commit_hash`: color-coded initially, with repository actions deferred.

Detection order:

1. Prefer structured Codex data, such as file-change paths, command cwd/command, tool payload fields, and approval request paths.
2. Parse plain text with conservative regex tokenization.
3. Fall back to plain text when detection is ambiguous.

Security rules:

- Never use `innerHTML` for model, tool, command, diff, or request content.
- Render typed content with `textContent`, spans, buttons, and event listeners.
- Only open `http` and `https` URLs externally.
- File actions must be constrained to the active project, active worktree, known session files, or configured safe roots.
- Do not execute commands from rendered content.
- Do not attach click behavior to hidden or truncated command text.

Renderer API shape:

```ts
type TypedToken =
  | { type: "text"; text: string }
  | { type: "url"; text: string; href: string }
  | { type: "file_path"; text: string; path: string }
  | { type: "line_ref"; text: string; path: string; line: number; column?: number }
  | { type: "command"; text: string }
  | { type: "symbol"; text: string }
  | { type: "commit_hash"; text: string; hash: string };

function renderTypedContent(container: HTMLElement, text: string, context: RenderContext): void;
```

Needed IPC additions for the Codex surface preload:

- `openExternalUrl(url)`
- `revealProjectFile(projectId, path)`
- optional later: `openProjectFile(projectId, path, line?, column?)`

Visual classes:

- `.typed-token-url`
- `.typed-token-file`
- `.typed-token-line-ref`
- `.typed-token-command`
- `.typed-token-symbol`
- `.typed-token-commit`

Acceptance criteria:

- URLs in assistant output, tool output, and thought details are clickable and open in the browser.
- File paths and line refs are visually distinct and can reveal/open the file through validated IPC.
- Commands and symbols are color-coded but not executable.
- All token rendering remains safe against HTML injection.

## Implementation Order

1. Fix project activation to open the linked Codex thread.
2. Refactor Codex turn rendering into live and completed states.
3. Move completed thought process blocks above final assistant answers.
4. Add typed-content rendering and safe IPC actions.
5. Validate with `npm run validate`.
6. Smoke-test project activation, live Codex turns, restored transcripts, links, and files.

## Non-Goals

- No command execution from rendered content.
- No full Markdown renderer.
- No auto-approval policy system.
- No generic ADEU ontology editor.
- No deep provider-internal policy UI.
