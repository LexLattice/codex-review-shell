"use strict";

// The request input items Codex builds from its context, in its wording:
// AGENTS.md as a user message, the skills catalog as a developer message,
// and a mentioned skill's SKILL.md as a user message. All bounded.

const SKILLS_OPEN_TAG = "<skills_instructions>";
const SKILLS_CLOSE_TAG = "</skills_instructions>";
const SKILL_CATALOG_BUDGET_CHARS = 8_000;
const SKILL_DESCRIPTION_MAX_CHARS = 1_024;
const SKILL_BODY_MAX_CHARS = 32 * 1024;

const SKILLS_INTRO = "A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.";
const SKILLS_HOW_TO_USE = [
  "- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.",
  "- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.",
  "- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.",
  "- How to use a skill (progressive disclosure):",
  "  1) After deciding to use a skill, the main agent must open and read its `SKILL.md` completely before taking task actions. If a read is truncated or paginated, continue until EOF.",
  "  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the directory containing that `SKILL.md` first, and only consider other paths if needed.",
  "  3) If `SKILL.md` points to extra folders such as `references/`, use its routing instructions to identify the files required for the task. The main agent must read each required instruction or reference file itself before acting on it. Do not delegate reading, summarizing, or interpreting skill instructions to a subagent. Subagents may still perform task work when the selected skill allows it.",
  "  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.",
  "  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.",
  "- Coordination and sequencing:",
  "  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.",
  "  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.",
  "- Context hygiene:",
  "  - Progressive disclosure applies to selecting relevant files, not partially reading a selected instruction file. Do not load unrelated references, scripts, or assets.",
  "  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.",
  "  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.",
  "- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.",
].join("\n");

function textItem(role, text) {
  return { role, content: [{ type: "input_text", text }] };
}

// Codex's order: the global file, then (after a project-doc marker) one file
// per directory from the project root down to cwd.
function agentsMdItem(agentsMd = {}, directory = "") {
  const global = typeof agentsMd?.global?.text === "string" ? agentsMd.global.text.trim() : "";
  const projectDocs = (Array.isArray(agentsMd?.projectDocs) ? agentsMd.projectDocs : [])
    .map((doc) => (typeof doc?.text === "string" ? doc.text.trim() : ""))
    .filter(Boolean);
  if (!global && !projectDocs.length) return null;
  const parts = [];
  if (global) parts.push(global);
  if (projectDocs.length) parts.push(`${global ? "--- project-doc ---\n\n" : ""}${projectDocs.join("\n\n")}`);
  const heading = directory && projectDocs.length ? `# AGENTS.md instructions for ${directory}` : "# AGENTS.md instructions";
  return textItem("user", `${heading}\n\n<INSTRUCTIONS>\n${parts.join("\n\n")}\n</INSTRUCTIONS>`);
}

// The catalog within a budget: descriptions shorten first, then entries are
// left out (with a note), as Codex's renderer does.
function skillsCatalogItem(skills = []) {
  const list = (Array.isArray(skills) ? skills : []).filter((skill) => skill?.name && skill?.path);
  if (!list.length) return null;
  const line = (skill, descriptionChars) => {
    const description = String(skill.description || "").slice(0, descriptionChars);
    return `- ${skill.name}: ${description} (file: ${skill.path})`;
  };
  let descriptionChars = SKILL_DESCRIPTION_MAX_CHARS;
  let lines = list.map((skill) => line(skill, descriptionChars));
  while (lines.join("\n").length > SKILL_CATALOG_BUDGET_CHARS && descriptionChars > 80) {
    descriptionChars = Math.floor(descriptionChars / 2);
    lines = list.map((skill) => line(skill, descriptionChars));
  }
  let omitted = 0;
  while (lines.join("\n").length > SKILL_CATALOG_BUDGET_CHARS && lines.length > 1) {
    lines.pop();
    omitted += 1;
  }
  if (omitted) lines.push(`- (${omitted} more skill${omitted === 1 ? "" : "s"} omitted to fit the catalog budget)`);
  const body = ["## Skills", SKILLS_INTRO, "### Available skills", ...lines, "### How to use skills", SKILLS_HOW_TO_USE].join("\n");
  return textItem("developer", `${SKILLS_OPEN_TAG}\n${body}\n${SKILLS_CLOSE_TAG}`);
}

// `$name` mentions in the prompt that name exactly one skill.
function mentionedSkills(promptText = "", skills = []) {
  const names = new Set();
  for (const match of String(promptText).matchAll(/\$([A-Za-z0-9_][A-Za-z0-9_.:-]*)/g)) names.add(match[1].replace(/[.:]+$/, ""));
  const out = [];
  for (const name of names) {
    const matches = (Array.isArray(skills) ? skills : []).filter((skill) => skill?.name === name);
    if (matches.length === 1) out.push(matches[0]);
  }
  return out;
}

function skillBodyItem(skill = {}, body = {}) {
  const text = String(body?.text || "").slice(0, SKILL_BODY_MAX_CHARS);
  return textItem("user", `<skill>\n<name>${skill.name}</name>\n<path>${skill.path}</path>\n${text}\n</skill>`);
}

module.exports = {
  agentsMdItem,
  mentionedSkills,
  skillBodyItem,
  skillsCatalogItem,
};
