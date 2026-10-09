"use strict";

// Codex's command rules (execpolicy prefix_rule) for exec_command: a shell
// command is split into its commands (across &&, ||, ;, and pipes) only when
// every word is a plain literal; anything with expansions, redirects,
// substitutions, or control flow stays unsplit and matches no rule. A rule
// matches a command whose argument list starts with the rule's tokens. A
// command runs outside the sandbox without asking only when every one of its
// commands matches an allow rule.

const path = require("node:path");

// Prefixes Codex won't offer to remember: they'd allow nearly anything.
const BANNED_PREFIXES = [
  ["bash"], ["sh"], ["zsh"], ["dash"], ["fish"], ["env"], ["sudo"], ["su"], ["doas"], ["rm"], ["git"],
  ["python"], ["python3"], ["node"], ["perl"], ["ruby"], ["php"], ["deno"], ["bun"], ["npx"],
  ["npm", "run"], ["npm", "exec"], ["yarn", "run"], ["pnpm", "run"], ["pnpm", "exec"],
  ["pwsh"], ["powershell"], ["powershell.exe"], ["pwsh.exe"], ["cmd"], ["cmd.exe"], ["wsl"], ["wsl.exe"],
  ["Invoke-Expression"], ["iex"], ["Start-Process"], ["xargs"], ["find"], ["eval"], ["exec"], ["nohup"], ["timeout"],
].map((pattern) => pattern.map((token) => token.toLowerCase()));

const BASH_SEPARATORS = ["&&", "||", ";", "|", "\n"];

// Splits a Bash command into argument lists, or returns null when any part
// isn't a plain literal.
function parseBashSegments(source) {
  const text = String(source ?? "");
  if (!text.trim() || text.length > 16_384) return null;
  const segments = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (!words.length) return false;
    segments.push(words);
    words = [];
    return true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const separator = BASH_SEPARATORS.find((sep) => text.startsWith(sep, i));
    if (separator) {
      if (!endSegment()) return null;
      i += separator.length - 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      endWord();
      continue;
    }
    if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) return null;
      word = (word ?? "") + text.slice(i + 1, close);
      i = close;
      continue;
    }
    if (ch === '"') {
      let value = "";
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j += 1) {
        if (text[j] === "$" || text[j] === "`") return null;
        if (text[j] === "\\") {
          const next = text[j + 1];
          if (next === undefined) return null;
          if (["\\", '"', "$", "`"].includes(next)) {
            value += next;
            j += 1;
            continue;
          }
        }
        value += text[j];
      }
      if (j >= text.length) return null;
      word = (word ?? "") + value;
      i = j;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined || next === "\n") return null;
      word = (word ?? "") + next;
      i += 1;
      continue;
    }
    // Expansions, redirects, background jobs, subshells, globs, comments.
    if ("$`<>&(){}*?[]#!".includes(ch)) return null;
    if (ch === "~" && word === null) return null;
    word = (word ?? "") + ch;
  }
  if (!endSegment() && !segments.length) return null;
  if (words.length) return null;
  // `VAR=value cmd` changes the command's environment: not a plain command.
  if (segments.some((argv) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]))) return null;
  return segments;
}

// The same for PowerShell, more conservatively: bare words, '…' literals,
// and "…" without $ or backticks; commands separated by ;, |, &&, ||.
function parsePowerShellSegments(source) {
  const text = String(source ?? "");
  if (!text.trim() || text.length > 16_384) return null;
  const segments = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (!words.length) return false;
    segments.push(words);
    words = [];
    return true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const separator = ["&&", "||", ";", "|", "\n"].find((sep) => text.startsWith(sep, i));
    if (separator) {
      if (!endSegment()) return null;
      i += separator.length - 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      endWord();
      continue;
    }
    if (ch === "'") {
      let value = "";
      let j = i + 1;
      for (; j < text.length; j += 1) {
        if (text[j] === "'" && text[j + 1] === "'") {
          value += "'";
          j += 1;
        } else if (text[j] === "'") {
          break;
        } else {
          value += text[j];
        }
      }
      if (j >= text.length) return null;
      word = (word ?? "") + value;
      i = j;
      continue;
    }
    if (ch === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) return null;
      const value = text.slice(i + 1, close);
      if (/[$`]/.test(value)) return null;
      word = (word ?? "") + value;
      i = close;
      continue;
    }
    if (!/[A-Za-z0-9_\-./:\\=,+%^]/.test(ch)) return null;
    word = (word ?? "") + ch;
  }
  if (!endSegment() && !segments.length) return null;
  if (words.length) return null;
  return segments;
}

function commandSegments(cmd, shell = "bash") {
  return shell === "powershell" ? parsePowerShellSegments(cmd) : parseBashSegments(cmd);
}

function tokenEquals(a, b, shell) {
  return shell === "powershell" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// A rule naming a program matches it by its path too (`/usr/bin/git` for
// a `git` rule), as Codex falls back to the basename.
function ruleMatches(argv = [], pattern = [], shell = "bash") {
  if (!Array.isArray(pattern) || !pattern.length || argv.length < pattern.length) return false;
  return pattern.every((token, index) => {
    if (tokenEquals(argv[index], token, shell)) return true;
    if (index !== 0 || /[\\/]/.test(token)) return false;
    const api = shell === "powershell" ? path.win32 : path.posix;
    const base = api.basename(argv[0]);
    return tokenEquals(base, token, shell) || (shell === "powershell" && tokenEquals(base.replace(/\.exe$/i, ""), token, shell));
  });
}

function evaluateCommandRules(segments, rules = [], shell = "bash") {
  if (!Array.isArray(segments) || !segments.length) return { parsed: false, allAllowed: false, unmatched: [] };
  const unmatched = segments.filter((argv) => !rules.some((rule) => rule.decision === "allow" && ruleMatches(argv, rule.pattern, shell)));
  return { parsed: true, allAllowed: unmatched.length === 0, unmatched };
}

function bannedPrefix(pattern = []) {
  const lowered = pattern.map((token) => String(token).toLowerCase());
  return BANNED_PREFIXES.some((banned) => banned.length === lowered.length && banned.every((token, index) => token === lowered[index]));
}

// The prefix to offer for "don't ask again": the model's prefix_rule when it
// is reasonable, otherwise the whole command; only when that one rule (with
// the rules already saved) would cover every command in the line.
function proposeCommandRule(segments, rules = [], requested = null, shell = "bash") {
  const evaluation = evaluateCommandRules(segments, rules, shell);
  if (!evaluation.parsed || evaluation.allAllowed) return null;
  const covers = (pattern) => evaluation.unmatched.every((argv) => ruleMatches(argv, pattern, shell));
  const candidates = [];
  if (Array.isArray(requested) && requested.length && requested.every((token) => typeof token === "string" && token && !/[\r\n]/.test(token))) {
    candidates.push(requested.slice(0, 64));
  }
  if (evaluation.unmatched.length === 1) candidates.push(evaluation.unmatched[0].slice(0, 64));
  return candidates.find((pattern) => !bannedPrefix(pattern) && covers(pattern)) || null;
}

module.exports = {
  bannedPrefix,
  commandSegments,
  evaluateCommandRules,
  parseBashSegments,
  parsePowerShellSegments,
  proposeCommandRule,
  ruleMatches,
};
